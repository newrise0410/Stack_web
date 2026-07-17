import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Order, { SALES_STATES } from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

function baseOrder(user, n) {
  return {
    orderNumber: `20260717-10000${n}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 3000, pointsUsed: 0, grandTotal: 13000 },
  };
}

describe('Order.payment', () => {
  it('payment 기본값 — provider/refund.status', async () => {
    const user = await createTestUser();
    const o = await Order.create({ ...baseOrder(user, 1), payment: { provider: 'portone' } });
    expect(o.payment.provider).toBe('portone');
    expect(o.payment.refund.status).toBe('none');
    expect(SALES_STATES).toEqual(['paid', 'preparing', 'shipped', 'delivered']);
  });

  it('payment.impUid partial unique — 같은 impUid 두 주문 금지, null 중복은 허용', async () => {
    const user = await createTestUser();
    await Order.syncIndexes();
    await Order.create({ ...baseOrder(user, 2), payment: { provider: 'portone', impUid: 'imp_001' } });
    await expect(
      Order.create({ ...baseOrder(user, 3), payment: { provider: 'portone', impUid: 'imp_001' } }),
    ).rejects.toMatchObject({ code: 11000 });
    // impUid 없는 주문 여러 개는 허용
    await Order.create({ ...baseOrder(user, 4), payment: { provider: 'portone' } });
    await Order.create({ ...baseOrder(user, 5), payment: { provider: 'portone' } });
  });
});

describe('OrderEvent', () => {
  it('uniqueKey 중복 insert는 11000', async () => {
    await OrderEvent.syncIndexes();
    const orderId = new mongoose.Types.ObjectId();
    await OrderEvent.create({ order: orderId, type: 'paid_email', uniqueKey: `${orderId}:paid_email` });
    await expect(
      OrderEvent.create({ order: orderId, type: 'paid_email', uniqueKey: `${orderId}:paid_email` }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
