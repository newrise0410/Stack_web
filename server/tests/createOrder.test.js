import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isConfigured: () => true,
    prepare: vi.fn(async () => {}),
    getPrepared: vi.fn(async () => null),
    getPayment: vi.fn(),
    findPayment: vi.fn(async () => null),
    cancel: vi.fn(),
  };
});

import * as portone from '../src/services/portoneService.js';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import UserCoupon from '../src/models/UserCoupon.js';
import PointTransaction from '../src/models/PointTransaction.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();

async function seedProduct(price = 30000) {
  return Product.create({
    name: 'Stack Lamp', slug: `stack-${Math.random().toString(36).slice(2, 8)}`,
    type: 'Table', price, status: 'active', options: [],
  });
}

function orderBody(product, extra = {}) {
  return {
    items: [{ slug: product.slug, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    ...extra,
  };
}

describe('POST /orders (포트원 선주문)', () => {
  beforeEach(() => {
    portone.prepare.mockClear();
    portone.prepare.mockResolvedValue(undefined);
  });

  it('pending 주문 생성 + prepare 호출 + checkout DTO 반환', async () => {
    const user = await createTestUser();
    const product = await seedProduct(30000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-1')
      .send(orderBody(product));
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('pending');
    expect(res.body.checkout.amount).toBe(33000); // 30000 + 배송비 3000
  });

  it('멱등 재요청 — 같은 키는 같은 주문, 다른 본문은 409', async () => {
    const user = await createTestUser();
    const product = await seedProduct();
    const h = authHeader(user);
    const r1 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2').send(orderBody(product));
    const r2 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2').send(orderBody(product));
    expect(r2.status).toBe(200);
    expect(r2.body.order.orderNumber).toBe(r1.body.order.orderNumber);
    const r3 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2')
      .send(orderBody(product, { items: [{ slug: product.slug, qty: 2 }] }));
    expect(r3.status).toBe(409);
  });

  it('0원 주문(포인트 전액) — 결제창 없이 즉시 paid, checkout null', async () => {
    const user = await createTestUser({ points: 100000 });
    const product = await seedProduct(60000); // 5만 이상 → 배송비 0
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-3')
      .send(orderBody(product, { pointsToUse: 60000 }));
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('paid');
    expect(res.body.checkout).toBe(null);
    expect(res.body.order.payment.provider).toBe('none');
    expect(portone.prepare).not.toHaveBeenCalled();
  });

  it('1~99원 주문은 400 (카드 최소금액)', async () => {
    const user = await createTestUser({ points: 100000 });
    const product = await seedProduct(60000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-4')
      .send(orderBody(product, { pointsToUse: 59950 })); // grandTotal 50원
    expect(res.status).toBe(400);
    // 포인트 미차감 확인
    expect((await User.findById(user._id)).points).toBe(100000);
  });

  it('prepare 확정 실패 시 주문 취소 + 쿠폰·포인트 원복 + 502', async () => {
    const { PortoneError } = await vi.importActual('../src/services/portoneService.js');
    portone.prepare.mockRejectedValueOnce(new PortoneError('사전등록 거절'));
    const user = await createTestUser({ points: 5000 });
    const product = await seedProduct(30000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-5')
      .send(orderBody(product, { pointsToUse: 2000 }));
    expect(res.status).toBe(502);
    const order = await Order.findOne({ user: user._id });
    expect(order.status).toBe('cancelled');
    expect((await User.findById(user._id)).points).toBe(5000); // 원복 완료
  });

  it('멱등키 없는 결제 주문은 400', async () => {
    const user = await createTestUser();
    const product = await seedProduct();
    const res = await request(app).post('/orders').set(authHeader(user)).send(orderBody(product));
    expect(res.status).toBe(400);
  });
});
