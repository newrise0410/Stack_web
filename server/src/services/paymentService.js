import Order from '../models/Order.js';
import * as portone from './portoneService.js';
import { withTransaction } from '../utils/withTransaction.js';
import { httpError } from '../utils/httpError.js';
import { enqueueEvents, buildPaidEvents } from './orderEventService.js';
import User from '../models/User.js';

// 취소·환불 처리 콜백 — cancelService(Task 10)가 주입한다(순환 의존 회피).
// 주입 전 기본값은 no-op(테스트에서 _setCancelHooks로 대체).
let hooks = {
  onCancelPending: async (order, reason) => {
    console.warn('[paymentService] onCancelPending 미주입:', order.orderNumber, reason);
  },
  onLatePaid: async (order, pmt) => {
    console.warn('[paymentService] onLatePaid 미주입:', order.orderNumber, pmt.imp_uid);
  },
};

export function _setCancelHooks(next) {
  hooks = { ...hooks, ...next };
}

function securityLog(...args) {
  console.error('[SECURITY][payments]', ...args);
}

async function markReview(orderId, reason) {
  await Order.updateOne(
    { _id: orderId },
    { $set: { 'payment.refund.status': 'review', 'payment.refund.reason': reason, 'payment.refund.requestedAt': new Date() } },
  );
}

// 포트원 결제 검증·확정. 클라이언트가 준 merchant_uid는 신뢰하지 않고
// 포트원 응답의 merchant_uid로만 주문을 식별한다(스펙 §5.2 — 타 결제 imp_uid 공격 차단).
// merchantUidHint: 일부 신콘솔 계정에서 GET /payments/{imp_uid} 단건 조회가 404를 반환하는
// 실측 이슈(find/{merchant_uid}는 정상)가 있어, 힌트가 있으면 find로 폴백한다. 힌트는
// "어느 주문번호를 조회할지" 선택에만 쓰이고, 포트원 응답의 imp_uid가 요청 imp_uid와
// 일치할 때만 인정하므로 위조된 힌트로는 아무 것도 얻을 수 없다.
export async function verifyAndCompletePayment(impUid, { requesterId = null, merchantUidHint = null } = {}) {
  const pmt = await resolvePayment(impUid, merchantUidHint);
  return applyVerified(pmt, { requesterId });
}

async function resolvePayment(impUid, merchantUidHint) {
  try {
    return await portone.getPayment(impUid);
  } catch (e) {
    if (!(e instanceof portone.PortoneError) || !merchantUidHint) throw e;
    const found = await portone.findPayment(String(merchantUidHint));
    if (found && found.imp_uid === impUid) return found; // 데이터는 전부 포트원 응답 — 힌트는 선택용
    throw e;
  }
}

async function applyVerified(pmt, { requesterId }) {
  const order = await Order.findOne({ orderNumber: pmt.merchant_uid });
  if (!order) {
    securityLog('merchant_uid 매칭 주문 없음 — 변경·취소 없이 무시:', pmt.merchant_uid, pmt.imp_uid);
    return { outcome: 'not_found', order: null };
  }
  if (requesterId && String(order.user) !== String(requesterId)) {
    securityLog('주문 소유자 불일치:', order.orderNumber, '요청자', String(requesterId));
    throw httpError(403, '접근 권한이 없습니다.');
  }
  if (order.payment?.provider !== 'portone') {
    securityLog('포트원 주문 아님:', order.orderNumber);
    return { outcome: 'noop', order };
  }

  switch (pmt.status) {
    case 'ready':
      return { outcome: 'ready', order };
    case 'failed': {
      if (order.status === 'pending') {
        await hooks.onCancelPending(order, pmt.fail_reason || '결제 실패');
        return { outcome: 'failed_cancelled', order };
      }
      return { outcome: 'noop', order };
    }
    case 'cancelled': {
      const fullyCancelled = (pmt.cancel_amount || 0) >= pmt.amount;
      if (!fullyCancelled) {
        await markReview(order._id, '부분취소 감지(외부)');
        return { outcome: 'review', order };
      }
      if (['pending', 'paid'].includes(order.status)) {
        await hooks.onCancelPending(order, '포트원측 결제 취소');
        return { outcome: 'external_cancelled', order };
      }
      if (['shipped', 'delivered', 'preparing'].includes(order.status)) {
        await markReview(order._id, '배송 진행 중 외부취소 감지');
        return { outcome: 'review', order };
      }
      return { outcome: 'noop', order };
    }
    case 'paid':
      return applyPaid(pmt, order);
    default:
      return { outcome: 'noop', order };
  }
}

async function applyPaid(pmt, order) {
  // 늦은 승인: 주문은 이미 취소(혜택 원복 완료) — 자동 전액환불 경로로
  if (order.status === 'cancelled') {
    await hooks.onLatePaid(order, pmt);
    return { outcome: 'late_refund_started', order };
  }

  // 검증: 금액·통화·부분취소 없음
  if ((pmt.cancel_amount || 0) > 0) {
    await markReview(order._id, '부분취소 상태의 결제 감지');
    return { outcome: 'review', order };
  }
  if (pmt.amount !== order.amounts.grandTotal || pmt.currency !== 'KRW') {
    securityLog('금액/통화 불일치:', order.orderNumber, pmt.imp_uid, pmt.amount, pmt.currency);
    await markReview(order._id, `금액 불일치(결제 ${pmt.amount}, 주문 ${order.amounts.grandTotal})`);
    return { outcome: 'review', order };
  }

  if (order.status === 'pending') {
    try {
      const updated = await withTransaction(async (session) => {
        const u = await Order.findOneAndUpdate(
          { _id: order._id, status: 'pending' },
          {
            $set: {
              status: 'paid',
              paymentMethod: 'card',
              'payment.impUid': pmt.imp_uid,
              'payment.pg': pmt.pg_provider || '',
              'payment.method': pmt.pay_method || 'card',
              'payment.paidAt': pmt.paid_at ? new Date(pmt.paid_at * 1000) : new Date(),
              'payment.receiptUrl': pmt.receipt_url || '',
            },
          },
          { new: true, session },
        );
        if (!u) return null; // CAS 패배 — 아래에서 재판정
        const user = await User.findById(u.user).select('name email');
        await enqueueEvents(u._id, buildPaidEvents(u, user), session);
        return u;
      });
      if (updated) return { outcome: 'paid', order: updated };
    } catch (e) {
      // impUid partial unique 위반 = 같은 결제가 다른 주문에 이미 매핑 — 사고 상태
      if (e.code === 11000) {
        securityLog('impUid 중복 매핑 시도:', pmt.imp_uid, order.orderNumber);
        await markReview(order._id, '결제 imp_uid가 다른 주문에 매핑됨');
        return { outcome: 'review', order };
      }
      throw e;
    }
    // CAS 패배 → 최신 상태로 재판정(경합 상대가 paid 완료했을 가능성)
    const fresh = await Order.findById(order._id);
    return applyPaid(pmt, fresh);
  }

  // paid 이후 상태
  if (order.payment?.impUid === pmt.imp_uid) {
    return { outcome: 'already_paid', order };
  }
  // 같은 주문에 두 번째 결제(다른 impUid) — 새 결제를 전액 자동환불 시도 + 사고 마킹
  securityLog('중복 결제 감지:', order.orderNumber, '기존', order.payment?.impUid, '신규', pmt.imp_uid);
  try {
    await portone.cancel({ impUid: pmt.imp_uid, amount: pmt.amount, checksum: pmt.amount, reason: '중복 결제 자동 환불' });
  } catch (e) {
    securityLog('중복 결제 자동환불 실패 — 수동 처리 필요:', pmt.imp_uid, e?.message);
  }
  await markReview(order._id, `중복 결제(${pmt.imp_uid}) 자동환불 시도`);
  return { outcome: 'duplicate_refunded', order };
}
