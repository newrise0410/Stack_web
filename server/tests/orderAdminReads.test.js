import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 0;
async function makeOrder(user, status, items) {
  seq += 1;
  const itemsTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  return Order.create({
    orderNumber: `20260718-30${String(seq).padStart(4, '0')}`,
    user: user._id, items, shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: itemsTotal },
    status,
  });
}
const lamp = (slug, option, qty) => ({ slug, name: slug, nameKo: slug, option, price: 10000, qty, image: 'x.jpg' });

describe('admin 조회 엔드포인트', () => {
  it('counts — 상태별 건수(없는 상태는 0)', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    await makeOrder(buyer, 'preparing', [lamp('a', null, 1)]);
    const res = await request(app).get('/orders/admin/counts').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paid: 2, preparing: 1, pending: 0, shipped: 0, delivered: 0, cancelled: 0 });
  });

  it('production-summary — 상품×옵션 그룹, 상태별 수량 분리', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('zen', 'Bone', 2), lamp('zen', 'Charcoal', 1)]);
    await makeOrder(buyer, 'preparing', [lamp('zen', 'Bone', 3)]);
    await makeOrder(buyer, 'shipped', [lamp('zen', 'Bone', 9)]); // 미발송 아님 — 제외
    const res = await request(app).get('/orders/admin/production-summary').set(authHeader(admin));
    expect(res.status).toBe(200);
    const bone = res.body.items.find((i) => i.slug === 'zen' && i.option === 'Bone');
    expect(bone).toMatchObject({ paidQty: 2, preparingQty: 3, totalQty: 5, orderCount: 2 });
    expect(res.body.items.find((i) => i.option === 'Charcoal').totalQty).toBe(1);
  });

  it('batch — 인쇄용 일괄 조회, 51건 초과 400', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    const b = await makeOrder(buyer, 'paid', [lamp('b', null, 1)]);
    const res = await request(app).get(`/orders/admin/batch?ids=${a._id},${b._id}`).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].user.name).toBeTruthy();
    const tooMany = Array(51).fill(String(a._id)).join(',');
    expect((await request(app).get(`/orders/admin/batch?ids=${tooMany}`).set(authHeader(admin))).status).toBe(400);
  });

  it('listAllOrders product 필터', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('target-lamp', null, 1)]);
    await makeOrder(buyer, 'paid', [lamp('other-lamp', null, 1)]);
    const res = await request(app).get('/orders/admin?product=target-lamp').set(authHeader(admin));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].items[0].slug).toBe('target-lamp');
  });
});
