import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 950;

async function makeOrder(user, status, grandTotal, paidAt = null) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-7${seq}`, user: user._id,
    items: [{ price: grandTotal, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: grandTotal, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal },
    status,
    payment: { provider: 'portone', paidAt },
  });
}

describe('관리자 통계 — pending 제외', () => {
  it('오늘 매출에 pending·cancelled 미포함', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'pending', 10000);
    await makeOrder(buyer, 'cancelled', 20000);
    await makeOrder(buyer, 'paid', 30000, new Date());
    const res = await request(app).get('/admin/stats').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.sales.today).toBe(30000);
  });

  it('회원 상세 totalSpent도 pending 제외', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'pending', 10000);
    await makeOrder(buyer, 'delivered', 40000, new Date());
    const res = await request(app).get(`/admin/members/${buyer._id}`).set(authHeader(admin));
    expect(res.body.totalSpent).toBe(40000);
  });
});
