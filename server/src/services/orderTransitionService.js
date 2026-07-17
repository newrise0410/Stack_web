import Order from '../models/Order.js';
import PointTransaction from '../models/PointTransaction.js';
import { applyPoints } from './pointService.js';
import { sendOrderStatus } from './emailService.js';
import { cancelOrderSaga } from './cancelService.js';

// 허용 전이만 강제하는 상태머신(orderController에서 이동).
// pending→paid는 결제 verifier 전용 — 관리자 수동 전환 금지.
export const TRANSITIONS = {
  pending: ['cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'shipped'], // 동일상태 재요청 = 송장 수정용
  delivered: ['delivered'], // 동일상태 재요청 = 적립 지급 재시도용(멱등)
  cancelled: [],
};

// 관리자 상태 전이의 단일 진입점 — 단건 API와 일괄 API가 공유한다.
// 검증(전이표·환불잠금·송장)→CAS→부수효과(적립·메일)를 모두 포함하므로
// 어느 경로로 와도 규칙이 동일하다. cancelled는 cancelOrderSaga에 위임.
export async function applyTransition(orderId, next, { courier = '', trackingNumber = '', actor = 'admin' } = {}) {
  const order = await Order.findById(orderId).catch(() => null);
  if (!order) return { ok: false, code: 'not_found', message: '주문을 찾을 수 없습니다.' };

  const refundStatus = order.payment?.refund?.status;
  if (['requested', 'processing', 'review'].includes(refundStatus)) {
    return { ok: false, code: 'refund_locked', message: '환불 처리 중인 주문입니다. 완료 후 다시 시도해주세요.' };
  }

  const prev = order.status;
  const allowed = TRANSITIONS[prev] || [];
  if (!allowed.includes(next)) {
    return { ok: false, code: 'invalid_transition', message: `'${prev}' 상태에서 '${next}'(으)로 변경할 수 없습니다.` };
  }

  if (next === 'cancelled') {
    const actorLabel = actor === 'admin' ? '관리자' : actor; // 저장·노출용 한글 라벨
    const r = await cancelOrderSaga(order._id, { actor, reason: `${actorLabel} 취소` });
    if (['cancelled', 'already_cancelled'].includes(r.outcome)) {
      const populated = await Order.findById(order._id).populate('user', 'name email status');
      return { ok: true, order: populated };
    }
    if (r.outcome === 'refund_pending') {
      return { ok: false, code: 'refund_pending', message: '환불 접수됨 — 처리 완료 후 자동 취소됩니다.', order: r.order };
    }
    return { ok: false, code: 'review', message: '취소를 완료하지 못했습니다. 환불 상태를 확인해주세요.' };
  }

  const setFields = { status: next };
  if (next === 'shipped') {
    const tn = String(trackingNumber || '').trim();
    if (!tn) return { ok: false, code: 'tracking_required', message: '송장번호를 입력해주세요.' };
    setFields.courier = String(courier || '').trim();
    setFields.trackingNumber = tn;
  }

  // 조건부 원자적 전이 — 경합 패배는 conflict
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: prev },
    { $set: setFields },
    { new: true },
  );
  if (!updated) return { ok: false, code: 'conflict', message: '주문 상태가 이미 변경되었습니다. 다시 시도해주세요.' };

  // 배송완료 전이 시 구매 적립 확정 지급 — 멱등({order,type:earn} unique)
  if (next === 'delivered' && updated.pointsEarned > 0) {
    try {
      const earned = await PointTransaction.exists({ order: updated._id, type: 'earn' });
      if (!earned) {
        await applyPoints(updated.user?._id || updated.user, updated.pointsEarned, 'earn', {
          order: updated._id, note: `주문 ${updated.orderNumber} 적립`,
        });
      }
    } catch (e) {
      console.error('[applyTransition] 적립 지급 실패:', updated.orderNumber, e?.message);
    }
  }

  // populate + 상태 메일(실제 전이일 때만 — 송장 수정 재발송 방지). 실패해도 전이는 성립.
  // ⚠️ status를 populate 필드에서 빼면 탈퇴 가드가 조용히 무력화된다(undefined !== 'withdrawn').
  try {
    await updated.populate('user', 'name email status');
    if (next !== prev && ['shipped', 'delivered'].includes(next)) {
      // 탈퇴 tombstone에는 보내지 않는다 — withdrawn_<id>@deleted.local로 발송되는 것을 막는다.
      if (updated.user?.status !== 'withdrawn') await sendOrderStatus(updated, updated.user);
    }
  } catch { /* 무시 */ }
  return { ok: true, order: updated };
}
