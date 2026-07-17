import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// 포트원을 목킹한다 — retry-refund가 executeRefund를 통해 실제 PG 상태를 진실의 원천으로
// 삼는지 검증하기 위해. 실제 네트워크 없이 시나리오별 응답을 주입한다.
vi.mock('../src/services/portoneService.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    isConfigured: () => true,
    getPayment: vi.fn(),
    findPayment: vi.fn(),
    cancel: vi.fn(),
  };
});

const portone = await import('../src/services/portoneService.js');
const { createApp } = await import('../src/app.js');
const { default: Order } = await import('../src/models/Order.js');
const { cancelOrderSaga } = await import('../src/services/cancelService.js');
const { createTestUser, authHeader } = await import('./helpers.js');

const app = createApp();

function mkPaidOrder(user, over = {}) {
  return Order.create({
    user,
    orderNumber: `20260718-${Math.floor(100000 + Math.random() * 899999)}`,
    status: 'paid',
    items: [{ slug: 'ola-lamp', name: 'OLA', price: 10000, qty: 1 }],
    shippingAddress: { recipient: '홍길동', phone: '010-1234-5678', zipcode: '06236', address1: '서울' },
    amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
    payment: {
      provider: 'portone', impUid: 'imp_test', pg: 'html5_inicis',
      refund: { status: 'review', reason: '환불 실패: 이전 거절' },
    },
    ...over,
  });
}

async function adminHeader() {
  return authHeader(await createTestUser({ role: 'admin' }));
}

beforeEach(() => {
  portone.getPayment.mockReset();
  portone.findPayment.mockReset();
  portone.cancel.mockReset();
});

describe('POST /orders/:id/retry-refund — review 데드락 해소', () => {
  it('포트원에서 이미 환불됐으면(remaining<=0) 재환불 없이 done으로 수렴한다', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id);
    // 관리자가 포트원 콘솔에서 이미 전액 환불한 상태
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'cancelled', amount: 10000, cancel_amount: 10000 });

    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(h);
    expect(res.status).toBe(200);

    const after = await Order.findById(o._id);
    expect(after.payment.refund.status).toBe('done');
    expect(after.status).toBe('cancelled'); // finalizeCancelTxn이 취소 확정
    expect(portone.cancel).not.toHaveBeenCalled(); // 이중 환불 안 함 — 핵심
  });

  it('아직 환불 안 됐으면 재환불을 시도하고 성공 시 done', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id);
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'paid', amount: 10000, cancel_amount: 0 });
    portone.cancel.mockResolvedValue({ cancel_amount: 10000 });

    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(h);
    expect(res.status).toBe(200);

    expect(portone.cancel).toHaveBeenCalledOnce();
    const after = await Order.findById(o._id);
    expect(after.payment.refund.status).toBe('done');
    expect(after.status).toBe('cancelled');
  });

  it('포트원이 다시 거절하면 review를 유지한다 (장부 불변)', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id);
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'paid', amount: 10000, cancel_amount: 0 });
    portone.cancel.mockRejectedValue(new portone.PortoneError('환불 거절'));

    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('review');

    const after = await Order.findById(o._id);
    expect(after.payment.refund.status).toBe('review'); // 여전히 격리 — 다시 시도 가능
    expect(after.status).toBe('paid'); // 취소 확정 안 됨
  });

  it('이미 취소된(cancelled) review 주문은 reconcileLateRefund 경로로 수렴한다', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id, { status: 'cancelled' });
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'cancelled', amount: 10000, cancel_amount: 10000 });

    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(h);
    expect(res.status).toBe(200);
    const after = await Order.findById(o._id);
    expect(after.payment.refund.status).toBe('done');
    expect(after.status).toBe('cancelled');
  });

  it('review가 아닌 주문은 400으로 거부한다', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id, { 'payment.refund.status': 'none' });
    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(h);
    expect(res.status).toBe(400);
    expect(portone.getPayment).not.toHaveBeenCalled();
  });

  it('비관리자는 거부된다', async () => {
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id);
    const res = await request(app).post(`/orders/${o._id}/retry-refund`).set(authHeader(buyer));
    expect(res.status).toBe(403);
  });

  it('실결제 B경로 취소가 statusHistory에 원래 actor를 남긴다 (system 아님)', async () => {
    const buyer = await createTestUser();
    // 깨끗한 결제완료 주문(refund none) — 신규 취소가 B경로 락을 잡을 수 있게.
    const o = await mkPaidOrder(buyer._id, {
      payment: { provider: 'portone', impUid: 'imp_test', pg: 'html5_inicis', refund: { status: 'none' } },
    });
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'paid', amount: 10000, cancel_amount: 0 });
    portone.cancel.mockResolvedValue({ cancel_amount: 10000 });

    // 관리자 취소 — executeRefund→finalizeCancelTxn 경유
    const r = await cancelOrderSaga(o._id, { actor: 'admin', reason: '관리자 직접 취소' });
    expect(r.outcome).toBe('cancelled');

    const after = await Order.findById(o._id);
    const last = after.statusHistory.at(-1);
    expect(last.status).toBe('cancelled');
    expect(last.actor).toBe('admin'); // ★ B경로에서도 actor 복원 — 'system' 아님
    expect(after.payment.refund.actor).toBe('admin'); // 락 시점에 영속화됨
  });

  it('동시 재시도는 CAS로 직렬화된다 — 한쪽만 진행, portone.cancel 1회', async () => {
    const h = await adminHeader();
    const buyer = await createTestUser();
    const o = await mkPaidOrder(buyer._id);
    // 첫 승자가 재환불 성공, 둘째는 CAS 패배(409)로 cancel 미도달이어야 한다.
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_test', status: 'paid', amount: 10000, cancel_amount: 0 });
    portone.cancel.mockResolvedValue({ cancel_amount: 10000 });

    const [a, b] = await Promise.all([
      request(app).post(`/orders/${o._id}/retry-refund`).set(h),
      request(app).post(`/orders/${o._id}/retry-refund`).set(h),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]); // 한쪽 성공, 한쪽 CAS 패배
    expect(portone.cancel).toHaveBeenCalledOnce(); // ★ 이중 환불 없음 — 핵심
    const after = await Order.findById(o._id);
    expect(after.payment.refund.status).toBe('done');
  });
});
