import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { cancelOrderSaga, finalizeCancelTxn } from '../src/services/cancelService.js';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';
import UserCoupon from '../src/models/UserCoupon.js';
import Coupon from '../src/models/Coupon.js';
import PointTransaction from '../src/models/PointTransaction.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 700;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-5${seq}`, user: user._id,
    items: [{ price: 13000, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 500, grandTotal: 12500 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared' },
    ...over,
  });
}

describe('cancelOrderSaga — pending(A 경로)', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  it('결제 없음 — 취소 + 포인트 원복 + cancel outbox', async () => {
    const user = await createTestUser({ points: 0 });
    const order = await makeOrder(user);
    // 주문 시 500P 사용된 상태를 재현
    await PointTransaction.create({ user: user._id, amount: -500, type: 'spend', order: order._id, balanceAfter: 0 });
    portone.findPayment.mockResolvedValue(null);
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    expect(r.order.status).toBe('cancelled');
    expect((await User.findById(user._id)).points).toBe(500); // 환급
    expect(await OrderEvent.countDocuments({ order: order._id, type: 'cancel_sales_dec' })).toBe(1);
  });

  it('늦은 결제 발견 — 취소 대신 paid 확정(became_paid)', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const pmt = { imp_uid: 'imp_late1', merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis', pay_method: 'card', paid_at: 1752700000, receipt_url: '' };
    portone.findPayment.mockResolvedValue(pmt);
    portone.getPayment.mockResolvedValue(pmt);
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('became_paid');
    expect((await Order.findById(order._id)).status).toBe('paid');
  });

  it('결제 진행 중(ready) — 409용 payment_in_progress', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.findPayment.mockResolvedValue({ status: 'ready', imp_uid: 'imp_r', merchant_uid: order.orderNumber, amount: 12500, cancel_amount: 0 });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('payment_in_progress');
    expect((await Order.findById(order._id)).status).toBe('pending');
  });
});

describe('cancelOrderSaga — paid(B 경로)', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  async function makePaid(user, over = {}) {
    return makeOrder(user, { status: 'paid', payment: { provider: 'portone', method: 'card', impUid: `imp_p${seq}`, paidAt: new Date(), refund: { status: 'none' } }, ...over });
  }

  it('전액 환불 성공 — cancelled + refund done', async () => {
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockResolvedValue({ status: 'cancelled', cancel_amount: 12500 });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('cancelled');
    expect(saved.payment.refund.status).toBe('done');
    expect(portone.cancel).toHaveBeenCalledWith(expect.objectContaining({ impUid: order.payment.impUid, amount: 12500, checksum: 12500 }));
  });

  it('환불 결과 불명(타임아웃) — 주문 상태 유지 + refund processing', async () => {
    const { PortoneUnknownError } = await vi.importActual('../src/services/portoneService.js');
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockRejectedValue(new PortoneUnknownError('타임아웃'));
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('refund_pending');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('paid'); // 취소 확정 금지
    expect(saved.payment.refund.status).toBe('processing');
  });

  it('동시 취소 요청 — 한 요청만 진행(락 CAS)', async () => {
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockResolvedValue({ status: 'cancelled', cancel_amount: 12500 });
    const [a, b] = await Promise.all([
      cancelOrderSaga(order._id, { actor: 'user' }),
      cancelOrderSaga(order._id, { actor: 'admin' }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toContain('cancelled');
    expect(portone.cancel).toHaveBeenCalledTimes(1);
  });

  it('레거시 mock 주문(provider 없음) — PG 호출 없이 로컬 취소', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'paid', paymentMethod: 'mock', payment: undefined });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    expect(portone.cancel).not.toHaveBeenCalled();
  });

  it('환불 확정 거절(PortoneError) — 주문 paid 유지 + review 격리', async () => {
    const { PortoneError } = await vi.importActual('../src/services/portoneService.js');
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockRejectedValue(new PortoneError('취소 가능 금액 초과'));
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('review');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('paid');
    expect(saved.payment.refund.status).toBe('review');
  });
});
