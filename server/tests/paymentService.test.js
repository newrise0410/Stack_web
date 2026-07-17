import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { verifyAndCompletePayment, _setCancelHooks } from '../src/services/paymentService.js';
import Order from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 100;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-3${seq}`,
    user: user._id,
    items: [{ price: 13000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 13000 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared' },
    ...over,
  });
}

function pmt(order, over = {}) {
  return {
    imp_uid: `imp_${seq}`, merchant_uid: order.orderNumber, status: 'paid',
    amount: 13000, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis',
    pay_method: 'card', paid_at: Math.floor(Date.now() / 1000), receipt_url: 'https://r', fail_reason: null,
    ...over,
  };
}

describe('verifyAndCompletePayment', () => {
  beforeEach(() => {
    portone.getPayment.mockReset();
    _setCancelHooks({ onCancelPending: vi.fn(async () => {}), onLatePaid: vi.fn(async () => {}) });
  });

  it('정상 paid — pending→paid 전환 + outbox 2건', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    const r = await verifyAndCompletePayment(p.imp_uid);
    expect(r.outcome).toBe('paid');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('paid');
    expect(saved.payment.impUid).toBe(p.imp_uid);
    expect(saved.payment.paidAt).toBeInstanceOf(Date);
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('멱등 — 이미 paid + 동일 impUid는 already_paid, outbox 중복 없음', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    await verifyAndCompletePayment(p.imp_uid);
    const r2 = await verifyAndCompletePayment(p.imp_uid);
    expect(r2.outcome).toBe('already_paid');
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('경합 — complete와 webhook 동시 검증에도 paid 1회·outbox 2건', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    const [a, b] = await Promise.all([
      verifyAndCompletePayment(p.imp_uid),
      verifyAndCompletePayment(p.imp_uid),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['already_paid', 'paid']);
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('금액 불일치 — review 마킹, 취소 API 호출 금지', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(order, { amount: 999999 }));
    const r = await verifyAndCompletePayment('imp_bad');
    expect(r.outcome).toBe('review');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('pending'); // 자동 취소 없음
    expect(saved.payment.refund.status).toBe('review');
    expect(portone.cancel).not.toHaveBeenCalled();
  });

  it('소유자 불일치 — 403', async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const order = await makeOrder(owner);
    portone.getPayment.mockResolvedValue(pmt(order));
    await expect(
      verifyAndCompletePayment('imp_x', { requesterId: attacker._id }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await Order.findById(order._id)).status).toBe('pending');
  });

  it('주문 없음(남의 merchant_uid 아님) — not_found, 취소 호출 금지', async () => {
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_z', merchant_uid: 'unknown-uid', status: 'paid', amount: 1, cancel_amount: 0, currency: 'KRW' });
    const r = await verifyAndCompletePayment('imp_z');
    expect(r.outcome).toBe('not_found');
    expect(portone.cancel).not.toHaveBeenCalled();
  });

  it('중복 결제 — 이미 paid인 주문에 다른 impUid면 새 결제 환불 + review', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'paid', payment: { provider: 'portone', impUid: 'imp_first' } });
    portone.getPayment.mockResolvedValue(pmt(order, { imp_uid: 'imp_second' }));
    portone.cancel.mockResolvedValue({ status: 'cancelled' });
    const r = await verifyAndCompletePayment('imp_second');
    expect(r.outcome).toBe('duplicate_refunded');
    expect(portone.cancel).toHaveBeenCalledWith(expect.objectContaining({ impUid: 'imp_second' }));
    expect((await Order.findById(order._id)).payment.refund.status).toBe('review');
    expect((await Order.findById(order._id)).payment.impUid).toBe('imp_first'); // 원 결제 유지
  });

  it('failed / cancelled(전액) / ready 분기', async () => {
    const user = await createTestUser();
    const o1 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o1, { status: 'failed', fail_reason: '한도초과' }));
    expect((await verifyAndCompletePayment('imp_f')).outcome).toBe('failed_cancelled');

    const o2 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o2, { status: 'cancelled', cancel_amount: 13000 }));
    expect((await verifyAndCompletePayment('imp_c')).outcome).toBe('external_cancelled');

    const o3 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o3, { status: 'ready' }));
    expect((await verifyAndCompletePayment('imp_r')).outcome).toBe('ready');
    expect((await Order.findById(o3._id)).status).toBe('pending');
  });

  it('단건조회 404 + merchantUidHint — find 폴백으로 paid 확정 (imp_uid 일치 필수)', async () => {
    const { PortoneError } = await vi.importActual('../src/services/portoneService.js');
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockRejectedValue(new PortoneError('존재하지 않는 결제정보입니다.'));
    portone.findPayment.mockResolvedValue(p);
    const r = await verifyAndCompletePayment(p.imp_uid, { merchantUidHint: order.orderNumber });
    expect(r.outcome).toBe('paid');
    expect((await Order.findById(order._id)).status).toBe('paid');
    // imp_uid 불일치면 폴백 불인정 — 원래 에러 전파
    const order2 = await makeOrder(user);
    portone.findPayment.mockResolvedValue({ ...pmt(order2), imp_uid: 'imp_someone_else' });
    await expect(
      verifyAndCompletePayment('imp_not_matching', { merchantUidHint: order2.orderNumber }),
    ).rejects.toThrow('존재하지 않는');
    expect((await Order.findById(order2._id)).status).toBe('pending');
  });

  it('로컬 cancelled + 늦은 paid — onLatePaid 기동', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'cancelled' });
    const onLatePaid = vi.fn(async () => {});
    _setCancelHooks({ onCancelPending: vi.fn(), onLatePaid });
    portone.getPayment.mockResolvedValue(pmt(order));
    const r = await verifyAndCompletePayment('imp_late');
    expect(r.outcome).toBe('late_refund_started');
    expect(onLatePaid).toHaveBeenCalled();
  });
});
