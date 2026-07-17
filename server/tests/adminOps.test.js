import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import WebhookLog from '../src/models/WebhookLog.js';
import { createTestUser, authHeader } from './helpers.js';

const app = createApp();

function mkOrder(user, over = {}) {
  return Order.create({
    user,
    orderNumber: `20260718-${Math.floor(100000 + Math.random() * 899999)}`,
    status: 'paid',
    items: [{ slug: 'ola-lamp', name: 'OLA', price: 10000, qty: 1 }],
    shippingAddress: { recipient: '홍길동', phone: '010-1234-5678', zipcode: '06236', address1: '서울' },
    amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
    ...over,
  });
}

async function admin() {
  const u = await createTestUser({ role: 'admin' });
  return authHeader(u);
}

describe('GET /admin/ops — 운영 상태 집계', () => {
  it('조용한 실패 4종을 센다', async () => {
    const h = await admin();
    const buyer = await createTestUser();
    const o = await mkOrder(buyer._id);
    await OrderEvent.create({ order: o._id, type: 'paid_email', uniqueKey: `${o._id}:a`, status: 'failed' });
    await OrderEvent.create({ order: o._id, type: 'paid_sales_inc', uniqueKey: `${o._id}:b`, status: 'done' }); // 카운트 안 됨
    await WebhookLog.create({ impUid: 'imp_1', result: 'error' });
    await mkOrder(buyer._id, { 'payment.refund.status': 'review' });
    await mkOrder(buyer._id, { status: 'cancelled', benefitsReversed: false });

    const res = await request(app).get('/admin/ops').set(h);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      failedEvents: 1, webhookErrors: 1, refundReview: 1, benefitsStuck: 1,
    });
    expect(res.body).toHaveProperty('lastCycle'); // null 또는 {at,ok,counts}
  });

  it('아무 문제 없으면 전부 0', async () => {
    const h = await admin();
    const res = await request(app).get('/admin/ops').set(h);
    expect(res.body.counts).toEqual({ failedEvents: 0, webhookErrors: 0, refundReview: 0, benefitsStuck: 0 });
  });

  it('비관리자는 거부된다', async () => {
    const u = await createTestUser(); // role: client
    const res = await request(app).get('/admin/ops').set(authHeader(u));
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/events — outbox 목록', () => {
  it('status로 필터하고 주문번호를 populate한다', async () => {
    const h = await admin();
    const buyer = await createTestUser();
    const o = await mkOrder(buyer._id);
    await OrderEvent.create({ order: o._id, type: 'paid_email', uniqueKey: `${o._id}:x`, status: 'failed', lastError: '메일 실패' });
    await OrderEvent.create({ order: o._id, type: 'paid_sales_inc', uniqueKey: `${o._id}:y`, status: 'done' });

    const res = await request(app).get('/admin/events?status=failed').set(h);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].lastError).toBe('메일 실패');
    expect(res.body.items[0].order.orderNumber).toBe(o.orderNumber);
  });
});

describe('POST /admin/events/:id/requeue — 수동 재큐', () => {
  it('failed를 pending으로 되돌리고 attempts를 초기화한다', async () => {
    const h = await admin();
    const buyer = await createTestUser();
    const o = await mkOrder(buyer._id);
    const ev = await OrderEvent.create({
      order: o._id, type: 'paid_email', uniqueKey: `${o._id}:z`,
      status: 'failed', attempts: 5, lastError: '5회 실패',
    });

    const res = await request(app).post(`/admin/events/${ev._id}/requeue`).set(h);
    expect(res.status).toBe(200);
    const after = await OrderEvent.findById(ev._id);
    expect(after.status).toBe('pending'); // 잡이 다시 집어갈 수 있는 상태
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBe('');
  });

  it('failed가 아닌 이벤트는 400으로 거부한다', async () => {
    const h = await admin();
    const buyer = await createTestUser();
    const o = await mkOrder(buyer._id);
    const ev = await OrderEvent.create({ order: o._id, type: 'paid_email', uniqueKey: `${o._id}:w`, status: 'done' });
    const res = await request(app).post(`/admin/events/${ev._id}/requeue`).set(h);
    expect(res.status).toBe(400);
    expect((await OrderEvent.findById(ev._id)).status).toBe('done'); // 안 건드림
  });

  it('없는 이벤트는 404', async () => {
    const h = await admin();
    const res = await request(app).post(`/admin/events/${new mongoose.Types.ObjectId()}/requeue`).set(h);
    expect(res.status).toBe(404);
  });
});

describe('GET /orders/admin?refund=review — 환불 격리 주문 필터', () => {
  it('review 상태 주문만 걸러낸다', async () => {
    const h = await admin();
    const buyer = await createTestUser();
    await mkOrder(buyer._id, { 'payment.refund.status': 'review' });
    await mkOrder(buyer._id, { 'payment.refund.status': 'done' });
    await mkOrder(buyer._id); // refund 없음

    const res = await request(app).get('/orders/admin?refund=review').set(h);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].payment.refund.status).toBe('review');
  });
});
