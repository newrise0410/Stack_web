import Order from '../models/Order.js';
import * as portone from './portoneService.js';
import { verifyAndCompletePayment } from './paymentService.js';
import { finalizeCancelTxn, executeRefund } from './cancelService.js';
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
        await verifyAndCompletePayment(pmt.imp_uid);
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

// 결과 불명(processing)·잠긴 지 오래된(requested) 환불을 재조회로 수렴
async function reconcileRefunds() {
  const orders = await Order.find({
    status: { $in: ['paid', 'preparing'] },
    'payment.provider': 'portone',
    $or: [
      { 'payment.refund.status': 'processing' },
      { 'payment.refund.status': 'requested', 'payment.refund.requestedAt': { $lt: new Date(Date.now() - REFUND_RETRY_AFTER_MS) } },
    ],
  }).limit(BATCH);
  let handled = 0;
  for (const order of orders) {
    try {
      await executeRefund(order); // 이미 전액취소면 마무리, 아니면 재시도/processing 유지/review
      handled += 1;
    } catch (e) {
      logErr('refund-item', e);
    }
  }
  return handled;
}

let timer = null;

export function startPaymentJobs({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    runPaymentJobsCycle().catch((e) => logErr('cycle', e));
  }, intervalMs);
  timer.unref?.(); // 종료를 막지 않게
  console.log(`payment jobs 시작 (interval ${intervalMs / 1000}s)`);
}

export function stopPaymentJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
