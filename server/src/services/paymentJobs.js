import Order from '../models/Order.js';
import * as portone from './portoneService.js';
import { verifyAndCompletePayment } from './paymentService.js';
import { finalizeCancelTxn, executeRefund, reconcileLateRefund } from './cancelService.js';
import { processPendingEvents } from './orderEventService.js';

const BATCH = 20;
const REFUND_RETRY_AFTER_MS = 10 * 60 * 1000; // requested가 10분 넘게 잠겨 있으면 재수렴 대상

// 60초 주기 reconciler/sweeper. 단일 인스턴스 전제(Render 무료 티어) — 분산 락 없음.
// 각 항목은 독립 실패(한 건 오류가 사이클을 멈추지 않음).
export async function runPaymentJobsCycle() {
  const counts = { stale: 0, refunds: 0, events: 0 };
  if (portone.isConfigured()) {
    counts.stale = await sweepStalePending().catch((e) => (logErr('stale', e), 0));
    counts.refunds = await reconcileRefunds().catch((e) => (logErr('refunds', e), 0));
  }
  counts.events = await processPendingEvents(BATCH).catch((e) => (logErr('outbox', e), 0));
  return counts;
}

function logErr(stage, e) {
  console.error(`[paymentJobs:${stage}]`, e?.message || e);
}

// 만료된 미결제 pending — 포트원 선조회 후 paid 확정 / 취소 / 유지로 수렴
async function sweepStalePending() {
  const orders = await Order.find({
    status: 'pending',
    'payment.provider': 'portone',
    'payment.expiresAt': { $lt: new Date() },
  }).limit(BATCH);
  let handled = 0;
  for (const order of orders) {
    try {
      const pmt = await portone.findPayment(order.orderNumber);
      if (pmt && pmt.status === 'paid') {
        await verifyAndCompletePayment(pmt.imp_uid, { merchantUidHint: order.orderNumber });
      } else if (pmt && pmt.status === 'ready') {
        continue; // 아직 결제창 진행 중일 수 있음 — 다음 사이클
      } else {
        await finalizeCancelTxn(order._id, ['pending'], { reason: '미결제 만료 자동취소' });
      }
      handled += 1;
    } catch (e) {
      logErr('stale-item', e);
    }
  }
  return handled;
}

// 결과 불명(processing)·잠긴 지 오래된(requested) 환불을 재조회로 수렴.
// cancelled 주문의 늦은승인 환불(onLatePaid가 남긴 processing)도 함께 스캔 —
// 그렇지 않으면 로컬 status가 이미 'cancelled'라 위 paid/preparing 쿼리에 걸리지 않고 영구 누락된다.
async function reconcileRefunds() {
  const orders = await Order.find({
    'payment.provider': 'portone',
    $or: [
      { status: { $in: ['paid', 'preparing'] }, 'payment.refund.status': 'processing' },
      {
        status: { $in: ['paid', 'preparing'] },
        'payment.refund.status': 'requested',
        'payment.refund.requestedAt': { $lt: new Date(Date.now() - REFUND_RETRY_AFTER_MS) },
      },
      { status: 'cancelled', 'payment.refund.status': 'processing' },
    ],
  }).limit(BATCH);
  let handled = 0;
  for (const order of orders) {
    try {
      if (order.status === 'cancelled') {
        await reconcileLateRefund(order); // 늦은승인 환불 재시도/수렴
      } else {
        await executeRefund(order); // 이미 전액취소면 마무리, 아니면 재시도/processing 유지/review
      }
      handled += 1;
    } catch (e) {
      logErr('refund-item', e);
    }
  }
  return handled;
}

let timer = null;
let cycleRunning = false; // in-flight 가드 — 느린 사이클이 다음 사이클과 겹쳐 같은 주문에 중복 실행되는 것 방지

export function startPaymentJobs({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    if (cycleRunning) return;
    cycleRunning = true;
    runPaymentJobsCycle()
      .catch((e) => logErr('cycle', e))
      .finally(() => { cycleRunning = false; });
  }, intervalMs);
  timer.unref?.(); // 종료를 막지 않게
  console.log(`payment jobs 시작 (interval ${intervalMs / 1000}s)`);
}

export function stopPaymentJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
