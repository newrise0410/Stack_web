import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, isConfigured: () => true, getPayment: vi.fn(), findPayment: vi.fn(async () => null), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 0;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260718-20${String(seq).padStart(4, '0')}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 10000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_bk${seq}` },
    ...over,
  });
}

describe('POST /orders/bulk/status', () => {
  it('부분 성공 — 정상 2건 + 전이불가 1건 + refund잠금 1건', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer);
    const b = await makeOrder(buyer);
    const c = await makeOrder(buyer, { status: 'delivered' });
    const d = await makeOrder(buyer, { payment: { provider: 'portone', impUid: 'imp_bkl', refund: { status: 'review' } } });
    const res = await request(app).post('/orders/bulk/status').set(authHeader(admin))
      .send({ ids: [a._id, b._id, c._id, d._id], status: 'preparing' });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.failed).toHaveLength(2);
    expect(res.body.failed.map((f) => f.orderNumber).sort()).toEqual([c.orderNumber, d.orderNumber].sort());
    expect((await Order.findById(a._id)).status).toBe('preparing');
  });

  it('일반 사용자 — 403', async () => {
    const user = await createTestUser();
    const res = await request(app).post('/orders/bulk/status').set(authHeader(user)).send({ ids: ['x'], status: 'preparing' });
    expect(res.status).toBe(403);
  });

  it('빈 ids / 101건 / 잘못된 상태 — 400', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const h = authHeader(admin);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: [], status: 'preparing' })).status).toBe(400);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: Array(101).fill('a'.repeat(24)), status: 'preparing' })).status).toBe(400);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: ['a'.repeat(24)], status: 'paid' })).status).toBe(400); // 전이표에 없는 목표(pending→paid 등)는 건별 판정이지만, 존재하지 않는 status 값은 400
  });
});

describe('POST /orders/bulk/tracking', () => {
  it('정상 + 미존재 주문번호 + 송장 없음 혼합', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer, { status: 'preparing' });
    const res = await request(app).post('/orders/bulk/tracking').set(authHeader(admin)).send({
      rows: [
        { orderNumber: a.orderNumber, courier: 'CJ대한통운', trackingNumber: 'T123' },
        { orderNumber: '20991231-999999', courier: 'CJ대한통운', trackingNumber: 'T124' },
        { orderNumber: a.orderNumber, courier: 'CJ대한통운', trackingNumber: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toHaveLength(2);
    const saved = await Order.findById(a._id);
    expect(saved.status).toBe('shipped');
    expect(saved.trackingNumber).toBe('T123');
  });
});
