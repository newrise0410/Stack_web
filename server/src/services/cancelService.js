import Order from '../models/Order.js';
import UserCoupon from '../models/UserCoupon.js';
import PointTransaction from '../models/PointTransaction.js';
import { applyPoints } from './pointService.js';
import { withTransaction } from '../utils/withTransaction.js';
import { enqueueEvents, buildCancelEvents } from './orderEventService.js';
import * as portone from './portoneService.js';
import { verifyAndCompletePayment, _setCancelHooks } from './paymentService.js';

// 취소 시 혜택 원복 — 쿠폰 복구 + 적립금(사용분 환급·적립분 회수). orderController에서 이동.
// 멱등(원장 존재 시 재실행 안 함). 세션 전달 시 취소 트랜잭션에 참여.
export async function reverseOrderBenefits(order, session = null) {
  if (order.benefitsReversed) return;
  const userId = order.user?._id || order.user;
  const sess = session || undefined;

  if (order.coupon?.code) {
    await UserCoupon.updateOne(
      { usedOrder: order._id },
      { used: false, usedOrder: null, usedAt: null },
      { session: sess },
    );
  }
  const pointsUsed = order.amounts?.pointsUsed || 0;
  if (pointsUsed > 0 && !(await PointTransaction.exists({ order: order._id, type: 'refund' }).session(sess || null))) {
    await applyPoints(userId, pointsUsed, 'refund', { order: order._id, note: `주문 ${order.orderNumber} 취소 환급`, session });
  }
  const earnTxns = await PointTransaction.find({ order: order._id, type: 'earn' }).select('amount').session(sess || null);
  const actualEarned = earnTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
  if (actualEarned > 0 && !(await PointTransaction.exists({ order: order._id, type: 'reclaim' }).session(sess || null))) {
    await applyPoints(userId, -actualEarned, 'reclaim', { order: order._id, note: `주문 ${order.orderNumber} 취소 적립회수`, session });
  }
  await Order.updateOne({ _id: order._id }, { $set: { benefitsReversed: true } }, { session: sess });
}

// 취소 확정 트랜잭션: CAS 상태 전이 + 혜택 원복 + cancel outbox. null = CAS 패배.
export async function finalizeCancelTxn(orderId, fromStatuses, { reason = '', refund = null } = {}) {
  return withTransaction(async (session) => {
    const set = { status: 'cancelled' };
    if (reason) set['payment.failReason'] = reason;
    if (refund) {
      set['payment.refund.status'] = refund.status;
      set['payment.refund.completedAt'] = refund.completedAt || new Date();
      set['payment.refund.cancelAmount'] = refund.cancelAmount || 0;
      if (reason) set['payment.refund.reason'] = reason;
    }
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: fromStatuses } },
      { $set: set },
      { new: true, session },
    );
    if (!order) return null;
    await reverseOrderBenefits(order, session);
    await enqueueEvents(order._id, buildCancelEvents(order), session);
    return order;
  });
}

// 모든 취소 경로의 단일 진입점.
// pending(A): 포트원 선조회로 "청구됐는데 주문만 취소" 경합 차단.
// paid+(B): refund 락 → 포트원 전액취소 확인 후에만 로컬 cancelled.
export async function cancelOrderSaga(orderId, { actor = 'user', reason = '' } = {}) {
  const order = await Order.findById(orderId);
  if (!order) return { outcome: 'not_cancellable', order: null };

  if (order.status === 'cancelled') {
    if (!order.benefitsReversed) await reverseOrderBenefits(order).catch((e) => console.error('[cancel] 원복 재시도 실패:', order.orderNumber, e?.message));
    return { outcome: 'already_cancelled', order: await Order.findById(orderId) };
  }

  const isPortone = order.payment?.provider === 'portone';

  if (order.status === 'pending') {
    if (isPortone) {
      const pmt = await portone.findPayment(order.orderNumber);
      if (pmt && pmt.status === 'paid') {
        // 승인은 됐는데 콜백이 아직 — 취소 대신 결제 확정으로 수렴
        await verifyAndCompletePayment(pmt.imp_uid);
        return { outcome: 'became_paid', order: await Order.findById(orderId) };
      }
      if (pmt && pmt.status === 'ready') {
        return { outcome: 'payment_in_progress', order };
      }
    }
    const cancelled = await finalizeCancelTxn(orderId, ['pending'], { reason: reason || '미결제 취소' });
    if (!cancelled) return cancelOrderSaga(orderId, { actor, reason }); // 경합 — 최신 상태로 재판정
    return { outcome: 'cancelled', order: cancelled };
  }

  if (!['paid', 'preparing'].includes(order.status)) {
    return { outcome: 'not_cancellable', order };
  }

  // 실결제 없는 주문(0원·레거시 mock) — PG 없이 로컬 취소
  if (!isPortone || !order.payment?.impUid) {
    const cancelled = await finalizeCancelTxn(orderId, ['paid', 'preparing'], {
      reason, refund: isPortone ? null : undefined,
    });
    if (!cancelled) return { outcome: 'not_cancellable', order: await Order.findById(orderId) };
    return { outcome: 'cancelled', order: cancelled };
  }

  // ── B 경로: refund 락(단일 승자) ──
  const locked = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: { $in: ['paid', 'preparing'] },
      $or: [{ 'payment.refund.status': 'none' }, { 'payment.refund.status': null }],
    },
    { $set: { 'payment.refund.status': 'requested', 'payment.refund.requestedAt': new Date(), 'payment.refund.reason': reason || `${actor} 취소` } },
    { new: true },
  );
  if (!locked) return { outcome: 'payment_in_progress', order: await Order.findById(orderId) };

  return executeRefund(locked);
}

// refund 락을 쥔 주문의 전액환불 실행. reconciler(Task 11)도 processing 주문에 재사용.
export async function executeRefund(order) {
  let pmt;
  try {
    pmt = await portone.getPayment(order.payment.impUid);
  } catch (e) {
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'processing' } });
    return { outcome: 'refund_pending', order: await Order.findById(order._id) };
  }

  const remaining = (pmt.amount || 0) - (pmt.cancel_amount || 0);
  if (pmt.status === 'cancelled' || remaining <= 0) {
    // 이미 전액 취소돼 있음(외부/이전 시도 성공) — 로컬 수렴만
    const cancelled = await finalizeCancelTxn(order._id, ['paid', 'preparing'], {
      reason: order.payment.refund?.reason || '환불 완료',
      refund: { status: 'done', cancelAmount: pmt.cancel_amount || pmt.amount },
    });
    return { outcome: 'cancelled', order: cancelled || (await Order.findById(order._id)) };
  }

  try {
    const result = await portone.cancel({
      impUid: order.payment.impUid,
      amount: remaining,
      checksum: remaining,
      reason: order.payment.refund?.reason || '주문 취소',
    });
    const cancelled = await finalizeCancelTxn(order._id, ['paid', 'preparing'], {
      reason: order.payment.refund?.reason || '주문 취소',
      refund: { status: 'done', cancelAmount: result?.cancel_amount || remaining },
    });
    return { outcome: 'cancelled', order: cancelled || (await Order.findById(order._id)) };
  } catch (e) {
    if (e instanceof portone.PortoneUnknownError) {
      // 결과 불명 — 상태 변경 금지, reconciler가 재조회로 수렴
      await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'processing' } });
      return { outcome: 'refund_pending', order: await Order.findById(order._id) };
    }
    // 확정 거절 — 사고 상태로 격리(수동 처리)
    console.error('[cancel] 포트원 환불 거절:', order.orderNumber, e?.message);
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'review', 'payment.refund.reason': `환불 실패: ${String(e?.message || '').slice(0, 100)}` } });
    return { outcome: 'review', order: await Order.findById(order._id) };
  }
}

// 취소된(status='cancelled') 주문에 남은 processing 환불을 재조회로 수렴.
// onLatePaid의 최초 시도와 reconciler(paymentJobs)의 재시도가 이 로직을 공유한다.
// executeRefund와 달리 CAS 대상이 없다 — 로컬 상태는 이미 cancelled로 확정돼 있고
// payment.refund.status 필드만 갱신한다.
export async function reconcileLateRefund(order) {
  const impUid = order.payment?.impUid;
  if (!impUid) return { outcome: 'skip' };

  let pmt;
  try {
    pmt = await portone.getPayment(impUid);
  } catch (e) {
    // 조회 실패 — processing 유지, 다음 사이클에 재시도
    return { outcome: 'refund_pending' };
  }

  const remaining = (pmt.amount || 0) - (pmt.cancel_amount || 0);
  if (remaining <= 0) {
    // 이미 전액 취소돼 있음 — 로컬 수렴만
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.refund.status': 'done', 'payment.refund.completedAt': new Date(), 'payment.refund.cancelAmount': pmt.cancel_amount || pmt.amount } },
    );
    return { outcome: 'done' };
  }

  try {
    const result = await portone.cancel({ impUid, amount: remaining, checksum: remaining, reason: '취소 후 늦은 승인 자동환불' });
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.refund.status': 'done', 'payment.refund.completedAt': new Date(), 'payment.refund.cancelAmount': result?.cancel_amount || remaining } },
    );
    return { outcome: 'done' };
  } catch (e) {
    if (e instanceof portone.PortoneUnknownError) {
      // 결과 불명 — 상태 변경 금지, reconciler가 재조회로 수렴
      return { outcome: 'refund_pending' };
    }
    console.error('[cancel] 늦은승인 환불 거절:', order.orderNumber, e?.message);
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'review', 'payment.refund.reason': `환불 실패: ${String(e?.message || '').slice(0, 100)}` } });
    return { outcome: 'review' };
  }
}

// paymentService의 취소 콜백 주입(순환 의존 회피 지점)
_setCancelHooks({
  // 미결제/실패/외부취소 pending 주문 정리
  onCancelPending: async (order, reason) => {
    await finalizeCancelTxn(order._id, ['pending', 'paid'], { reason });
  },
  // 로컬 취소 후 늦은 승인 발견 — 자동 전액환불 기동(reconcileLateRefund와 로직 공유)
  onLatePaid: async (order, pmt) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id },
      { $set: { 'payment.impUid': pmt.imp_uid, 'payment.refund.status': 'processing', 'payment.refund.reason': '취소 후 늦은 승인 자동환불', 'payment.refund.requestedAt': new Date() } },
      { new: true },
    );
    await reconcileLateRefund(updated);
  },
});
