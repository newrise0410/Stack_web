import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();

describe('GET /orders/admin/export', () => {
  it('CSV 헤더·BOM·이스케이프·필터', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await Order.create({
      orderNumber: '20260718-400001', user: buyer._id,
      items: [{ slug: 'zen', name: 'Zen', nameKo: '젠, "특별판"', option: 'Bone', price: 10000, qty: 2 }],
      shippingAddress: { ...TEST_ADDRESS, address1: '서울, 강남구' },
      amounts: { itemsTotal: 20000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 20000 },
      status: 'paid', courier: 'CJ대한통운', trackingNumber: 'T1',
    });
    await Order.create({
      orderNumber: '20260718-400002', user: buyer._id,
      items: [{ price: 5000, qty: 1 }], shippingAddress: TEST_ADDRESS,
      amounts: { itemsTotal: 5000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 5000 },
      status: 'cancelled',
    });
    const res = await request(app).get('/orders/admin/export?status=paid').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = text.slice(1).trim().split('\n');
    expect(lines[0]).toBe('주문번호,주문일,상태,주문자,수취인,연락처,우편번호,주소,품목,결제금액,택배사,송장번호');
    expect(lines).toHaveLength(2); // 헤더 + paid 1건 (cancelled 필터 제외)
    expect(lines[1]).toContain('20260718-400001');
    expect(lines[1]).toContain('"젠, ""특별판""(Bone)x2"'); // 이스케이프
    expect(lines[1]).toContain('"서울, 강남구'); // 주소 쉼표 이스케이프
  });

  it('일반 사용자 — 403', async () => {
    const user = await createTestUser();
    expect((await request(app).get('/orders/admin/export').set(authHeader(user))).status).toBe(403);
  });
});
