import { describe, it, expect } from 'vitest';
import Order from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import Product from '../src/models/Product.js';
import EmailMessage from '../src/models/EmailMessage.js';
import { enqueueEvents, buildPaidEvents, buildCancelEvents, processPendingEvents } from '../src/services/orderEventService.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

async function makePaidOrder(user, product) {
  return Order.create({
    orderNumber: `20260717-2${Math.floor(Math.random() * 90000) + 10000}`,
    user: user._id,
    items: [{ product: product._id, slug: product.slug, name: product.name, price: 10000, qty: 2 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 20000, couponDiscount: 0, shippingFee: 3000, pointsUsed: 0, grandTotal: 23000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_t${Math.random().toString(36).slice(2, 8)}` },
  });
}

async function makeProduct() {
  // Product 스키마 required 필드가 더 있으면 여기서 채운다
  return Product.create({ name: 'Test Lamp', slug: `lamp-${Math.random().toString(36).slice(2, 8)}`, type: 'Table', price: 10000, status: 'active', salesCount: 0 });
}

describe('orderEventService', () => {
  it('enqueue는 중복 키를 무시한다(재호출 안전)', async () => {
    await OrderEvent.syncIndexes();
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    const events = buildPaidEvents(order, user);
    await enqueueEvents(order._id, events, null);
    await enqueueEvents(order._id, events, null); // 중복 — 11000 무시
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(events.length);
  });

  it('paid 이벤트 처리 — salesCount 증가 + 주문접수 메일 1회, 재실행해도 1회', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await enqueueEvents(order._id, buildPaidEvents(order, user), null);
    await processPendingEvents(10);
    await processPendingEvents(10); // 이미 done — no-op
    expect((await Product.findById(product._id)).salesCount).toBe(2); // qty 2, 1회만
    expect(await EmailMessage.countDocuments({})).toBe(1);
    const done = await OrderEvent.find({ order: order._id });
    expect(done.every((e) => e.status === 'done')).toBe(true);
  });

  it('고아 processing 이벤트(claim 후 크래시) — 오래되면 pending으로 재큐돼 실행된다', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await enqueueEvents(order._id, buildPaidEvents(order, user), null);
    // 워커가 claim(pending→processing) 직후 크래시한 상황을 재현
    await OrderEvent.updateMany({ order: order._id }, { $set: { status: 'processing' }, $inc: { attempts: 1 } });
    // timestamps:true라 일반 update로는 updatedAt을 과거로 못 옮긴다 — raw 컬렉션으로 우회
    await OrderEvent.collection.updateMany(
      { order: order._id },
      { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    );
    await processPendingEvents(10);
    expect((await Product.findById(product._id)).salesCount).toBe(2);
    const done = await OrderEvent.find({ order: order._id });
    expect(done.every((e) => e.status === 'done')).toBe(true);
  });

  it('최근 claim된 processing 이벤트는 재큐하지 않는다', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await enqueueEvents(order._id, buildPaidEvents(order, user), null);
    await OrderEvent.updateMany({ order: order._id }, { $set: { status: 'processing' }, $inc: { attempts: 1 } });
    await processPendingEvents(10); // stale 기준 미달 — pending으로 재큐되지 않아 처리 안 됨
    expect((await Product.findById(product._id)).salesCount).toBe(0);
    const stillProcessing = await OrderEvent.find({ order: order._id });
    expect(stillProcessing.every((e) => e.status === 'processing')).toBe(true);
  });

  it('cancel 이벤트 처리 — salesCount 감소', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await Product.updateOne({ _id: product._id }, { $set: { salesCount: 5 } });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    const cancelled = await Order.findById(order._id);
    await enqueueEvents(order._id, buildCancelEvents(cancelled), null);
    await processPendingEvents(10);
    expect((await Product.findById(product._id)).salesCount).toBe(3);
  });
});
