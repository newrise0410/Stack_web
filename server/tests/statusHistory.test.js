import { describe, it, expect } from 'vitest';
import Order from '../src/models/Order.js';
import { applyTransition } from '../src/services/orderTransitionService.js';
import { finalizeCancelTxn } from '../src/services/cancelService.js';
import { createTestUser } from './helpers.js';

// 실결제 없는(레거시 mock) 주문 — cancelOrderSaga가 PG 없이 로컬 취소한다.
function mkOrder(user, over = {}) {
  return Order.create({
    user,
    orderNumber: `20260718-${Math.floor(100000 + Math.random() * 899999)}`,
    status: 'paid',
    items: [{ slug: 'ola-lamp', name: 'OLA', price: 10000, qty: 1 }],
    shippingAddress: { recipient: '홍길동', phone: '010-1234-5678', zipcode: '06236', address1: '서울' },
    amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
    statusHistory: [{ status: 'paid', at: new Date(), actor: 'system', reason: '결제 확정' }],
    ...over,
  });
}

describe('statusHistory — 상태 이력 기록', () => {
  it('관리자 전이가 actor·상태를 이력에 남긴다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await applyTransition(o._id, 'preparing', { actor: 'admin' });

    const after = await Order.findById(o._id);
    expect(after.status).toBe('preparing');
    const last = after.statusHistory.at(-1);
    expect(last.status).toBe('preparing');
    expect(last.actor).toBe('admin');
    expect(last.at).toBeInstanceOf(Date);
  });

  it('여러 전이가 순서대로 누적된다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await applyTransition(o._id, 'preparing', { actor: 'admin' });
    await applyTransition(o._id, 'shipped', { actor: 'admin', courier: 'CJ', trackingNumber: '123' });
    await applyTransition(o._id, 'delivered', { actor: 'admin' });

    const after = await Order.findById(o._id);
    const statuses = after.statusHistory.map((h) => h.status);
    expect(statuses).toEqual(['paid', 'preparing', 'shipped', 'delivered']);
  });

  it('취소 사유가 이력·failReason에 함께 저장된다 (P1-7)', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    // 레거시 mock(payment.provider 없음)이라 applyTransition→cancelOrderSaga가 PG 없이 로컬 취소
    const r = await applyTransition(o._id, 'cancelled', { actor: 'admin', reason: '고객 변심 요청' });
    expect(r.ok).toBe(true);

    const after = await Order.findById(o._id);
    expect(after.status).toBe('cancelled');
    expect(after.payment.failReason).toBe('고객 변심 요청');
    const last = after.statusHistory.at(-1);
    expect(last.status).toBe('cancelled');
    expect(last.reason).toBe('고객 변심 요청');
    expect(last.actor).toBe('admin');
  });

  it('사유 없이 취소하면 기본 라벨이 남는다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await applyTransition(o._id, 'cancelled', { actor: 'admin' });
    const after = await Order.findById(o._id);
    expect(after.statusHistory.at(-1).reason).toBe('관리자 취소');
  });

  it('finalizeCancelTxn이 actor를 이력에 기록한다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await finalizeCancelTxn(o._id, ['paid'], { reason: '미결제 만료', actor: 'system' });
    const after = await Order.findById(o._id);
    const last = after.statusHistory.at(-1);
    expect(last.status).toBe('cancelled');
    expect(last.actor).toBe('system');
    expect(last.reason).toBe('미결제 만료');
  });

  it('동일상태 재요청(shipped→shipped 송장수정)은 유령 이력을 남기지 않는다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id, { status: 'shipped', courier: 'CJ', trackingNumber: '111' });
    await applyTransition(o._id, 'shipped', { actor: 'admin', courier: 'CJ', trackingNumber: '222' }); // 송장 수정
    await applyTransition(o._id, 'shipped', { actor: 'admin', courier: 'CJ', trackingNumber: '333' });

    const after = await Order.findById(o._id);
    expect(after.trackingNumber).toBe('333'); // 수정은 반영
    const shippedCount = after.statusHistory.filter((h) => h.status === 'shipped').length;
    expect(shippedCount).toBe(0); // ★ 초기 이력(paid)만 있고 shipped 재요청은 안 쌓임
  });

  it('전이 경합(CAS 패배) 시 이력이 중복 기록되지 않는다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    // 동시 전이 — 하나만 성공, statusHistory에 preparing이 한 번만
    const [a, b] = await Promise.all([
      applyTransition(o._id, 'preparing', { actor: 'admin' }),
      applyTransition(o._id, 'preparing', { actor: 'admin' }),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    expect(okCount).toBe(1); // 한쪽은 conflict
    const after = await Order.findById(o._id);
    const preparingCount = after.statusHistory.filter((h) => h.status === 'preparing').length;
    expect(preparingCount).toBe(1); // ★ $push가 CAS와 같은 write라 중복 안 됨
  });
});
