import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { runPaymentJobsCycle } from '../src/services/paymentJobs.js';
import Order from '../src/models/Order.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 900;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-6${seq}`, user: user._id,
    items: [{ price: 13000, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 13000 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared', expiresAt: new Date(Date.now() - 60_000) },
    ...over,
  });
}

describe('runPaymentJobsCycle', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  it('만료 pending + 결제 없음 → 취소 수렴', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.findPayment.mockResolvedValue(null);
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('cancelled');
  });

  it('만료 pending + 늦은 paid → paid 수렴', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const pmt = { imp_uid: `imp_j${seq}`, merchant_uid: order.orderNumber, status: 'paid', amount: 13000, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis', pay_method: 'card', paid_at: 1752700000, receipt_url: '' };
    portone.findPayment.mockResolvedValue(pmt);
    portone.getPayment.mockResolvedValue(pmt);
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('paid');
  });

  it('refund processing → 원격 전액취소 확인되면 cancelled 마무리', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, {
      status: 'paid',
      payment: {
        provider: 'portone', method: 'card', impUid: `imp_rp${seq}`,
        refund: { status: 'processing', requestedAt: new Date(Date.now() - 11 * 60_000), reason: '취소' },
      },
    });
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'cancelled', amount: 13000, cancel_amount: 13000, currency: 'KRW' });
    await runPaymentJobsCycle();
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('cancelled');
    expect(saved.payment.refund.status).toBe('done');
  });

  it('만료 안 된 pending은 건드리지 않는다', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { payment: { provider: 'portone', prepareStatus: 'prepared', expiresAt: new Date(Date.now() + 60_000) } });
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('pending');
    expect(portone.findPayment).not.toHaveBeenCalled();
  });
});
