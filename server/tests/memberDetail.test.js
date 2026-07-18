import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Coupon from '../src/models/Coupon.js';
import UserCoupon from '../src/models/UserCoupon.js';
import { applyPoints } from '../src/services/pointService.js';
import { createTestUser, authHeader } from './helpers.js';

const app = createApp();

async function adminHeader() {
  return authHeader(await createTestUser({ role: 'admin' }));
}

describe('회원 상세 — 보유 쿠폰(P2-9) · 적립금 페이징(P2-12)', () => {
  it('getMember가 보유 쿠폰을 코드·사용여부와 함께 조인해 준다', async () => {
    const h = await adminHeader();
    const member = await createTestUser();
    const c1 = await Coupon.create({ code: 'HELD1', name: '보유쿠폰', discountType: 'fixed', discountValue: 1000 });
    const c2 = await Coupon.create({ code: 'USED1', name: '사용쿠폰', discountType: 'fixed', discountValue: 2000 });
    await UserCoupon.create({ user: member._id, coupon: c1._id, used: false, issuedBy: 'admin' });
    await UserCoupon.create({ user: member._id, coupon: c2._id, used: true, usedAt: new Date() });

    const res = await request(app).get(`/admin/members/${member._id}`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.userCoupons).toHaveLength(2);
    const codes = res.body.userCoupons.map((u) => u.coupon.code).sort();
    expect(codes).toEqual(['HELD1', 'USED1']);
    const held = res.body.userCoupons.find((u) => u.coupon.code === 'HELD1');
    expect(held.used).toBe(false);
    expect(held.issuedBy).toBe('admin');
  });

  it('getMember가 적립금 첫 페이지와 전체 건수를 준다', async () => {
    const h = await adminHeader();
    const member = await createTestUser();
    for (let i = 0; i < 25; i += 1) {
      await applyPoints(member._id, 100, 'admin_adjust', { note: `조정 ${i}` });
    }
    const res = await request(app).get(`/admin/members/${member._id}`).set(h);
    expect(res.body.pointTransactions).toHaveLength(20); // 첫 페이지
    expect(res.body.pointsTotal).toBe(25); // 전체 건수 → 클라가 '더 보기' 판단
  });

  it('적립금 페이징 엔드포인트가 2페이지를 준다', async () => {
    const h = await adminHeader();
    const member = await createTestUser();
    for (let i = 0; i < 25; i += 1) {
      await applyPoints(member._id, 100, 'admin_adjust', { note: `조정 ${i}` });
    }
    const p2 = await request(app).get(`/admin/members/${member._id}/points?page=2`).set(h);
    expect(p2.status).toBe(200);
    expect(p2.body.total).toBe(25);
    expect(p2.body.items).toHaveLength(5); // 25 - 20
  });

  it('보유 쿠폰·적립금 조회는 관리자 전용', async () => {
    const member = await createTestUser();
    const notAdmin = authHeader(await createTestUser());
    expect((await request(app).get(`/admin/members/${member._id}`).set(notAdmin)).status).toBe(403);
    expect((await request(app).get(`/admin/members/${member._id}/points`).set(notAdmin)).status).toBe(403);
  });
});
