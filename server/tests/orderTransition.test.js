import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(async () => null), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import { applyTransition, TRANSITIONS } from '../src/services/orderTransitionService.js';
import Order from '../src/models/Order.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 0;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260718-10${String(seq).padStart(4, '0')}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 10000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_tr${seq}` },
    ...over,
  });
}

describe('applyTransition', () => {
  it('paid → preparing 정상 전이', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const r = await applyTransition(order._id, 'preparing');
    expect(r.ok).toBe(true);
    expect(r.order.status).toBe('preparing');
  });

  it('허용되지 않는 전이 — invalid_transition', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'delivered' });
    const r = await applyTransition(order._id, 'preparing');
    expect(r).toMatchObject({ ok: false, code: 'invalid_transition' });
  });

  it('shipped 전이에 송장 필수 — tracking_required', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'preparing' });
    const r = await applyTransition(order._id, 'shipped', {});
    expect(r).toMatchObject({ ok: false, code: 'tracking_required' });
    const ok = await applyTransition(order._id, 'shipped', { courier: 'CJ대한통운', trackingNumber: '123456' });
    expect(ok.ok).toBe(true);
    expect(ok.order.trackingNumber).toBe('123456');
  });

  it('refund 잠금 — refund_locked', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { payment: { provider: 'portone', impUid: 'imp_lk1', refund: { status: 'processing' } } });
    const r = await applyTransition(order._id, 'preparing');
    expect(r).toMatchObject({ ok: false, code: 'refund_locked' });
  });

  it('cancelled 전이는 saga 경유(레거시 mock 주문 즉시 취소)', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { paymentMethod: 'mock', payment: undefined });
    const r = await applyTransition(order._id, 'cancelled');
    expect(r.ok).toBe(true);
    expect(r.order.status).toBe('cancelled');
  });

  it('TRANSITIONS export — pending에 paid 없음(검증 우회 금지)', () => {
    expect(TRANSITIONS.pending).toEqual(['cancelled']);
  });
});
