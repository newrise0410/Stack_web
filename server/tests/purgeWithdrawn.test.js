import { describe, it, expect } from 'vitest';
import Order from '../src/models/Order.js';
import Review from '../src/models/Review.js';
import UserCoupon from '../src/models/UserCoupon.js';
import Coupon from '../src/models/Coupon.js';
import PointTransaction from '../src/models/PointTransaction.js';
import User from '../src/models/User.js';
import Product from '../src/models/Product.js';
import { withdrawUser, purgeExpiredWithdrawals } from '../src/services/withdrawalService.js';
import { applyPoints } from '../src/services/pointService.js';
import { createTestUser } from './helpers.js';

const YEAR = 365 * 24 * 3600 * 1000;

function mkOrder(user, status = 'delivered') {
  return Order.create({
    user, orderNumber: `20210101-${Math.floor(100000 + Math.random() * 899999)}`, status,
    items: [{ slug: 'ola-lamp', name: 'OLA', price: 10000, qty: 1 }],
    shippingAddress: { recipient: '홍길동', phone: '010-1234-5678', zipcode: '06236', address1: '서울' },
    amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
  });
}

describe('purgeExpiredWithdrawals — 5년 만료 파기', () => {
  it('★ 정상 회원(withdrawnAt=null)은 절대 지우지 않는다 (BSON Null<Date 함정)', async () => {
    const active = await createTestUser(); // status active, withdrawnAt null
    // retentionMs=0이면 cutoff=now라 withdrawnAt이 없는 회원이 $lte에 걸릴 수 있는 조건
    const n = await purgeExpiredWithdrawals({ retentionMs: 0 });
    expect(n).toBe(0);
    expect(await User.findById(active._id)).not.toBeNull(); // ★ 살아있음
  });

  it('보관기간이 안 지난 탈퇴 회원은 남긴다', async () => {
    const u = await createTestUser();
    await withdrawUser(u._id); // 방금 탈퇴 → withdrawnAt ≈ now
    const n = await purgeExpiredWithdrawals(); // 기본 5년
    expect(n).toBe(0);
    expect(await User.findById(u._id)).not.toBeNull();
  });

  it('5년 지난 탈퇴 회원의 footprint를 완전 파기한다', async () => {
    const u = await createTestUser();
    await applyPoints(u._id, 3000, 'signup');
    const o = await mkOrder(u._id);
    const c = await Coupon.create({ code: 'OLD1', name: '옛쿠폰', discountType: 'fixed', discountValue: 1000 });
    await UserCoupon.create({ user: u._id, coupon: c._id, used: true });
    await Review.create({ product: new (await import('mongoose')).Types.ObjectId(), user: u._id, userName: '홍**', rating: 5, content: '좋아요' });
    await withdrawUser(u._id);

    // 6년 전에 탈퇴한 것으로 — retentionMs를 6년치보다 짧게(즉 5년) 두고, withdrawnAt을 과거로 밀어 시뮬레이트
    await User.updateOne({ _id: u._id }, { $set: { withdrawnAt: new Date(Date.now() - 6 * YEAR) } });

    const n = await purgeExpiredWithdrawals(); // 5년 보관
    expect(n).toBe(1);
    expect(await User.findById(u._id)).toBeNull(); // tombstone 삭제
    expect(await Order.countDocuments({ user: u._id })).toBe(0);
    expect(await PointTransaction.countDocuments({ user: u._id })).toBe(0);
    expect(await UserCoupon.countDocuments({ user: u._id })).toBe(0);
    expect(await Review.countDocuments({ user: u._id })).toBe(0);
    void o;
  });

  it('리뷰 삭제 후 상품 평점을 재계산한다', async () => {
    const p = await Product.create({ slug: `rlamp-${Math.random().toString(36).slice(2, 7)}`, name: 'R', type: 'Table', price: 1000, ratingAvg: 5, ratingCount: 1 });
    const u = await createTestUser();
    await Review.create({ product: p._id, user: u._id, userName: '홍**', rating: 5, content: '굿' });
    await withdrawUser(u._id);
    await User.updateOne({ _id: u._id }, { $set: { withdrawnAt: new Date(Date.now() - 6 * YEAR) } });

    await purgeExpiredWithdrawals();
    const after = await Product.findById(p._id);
    expect(after.ratingCount).toBe(0); // 리뷰 사라져 재계산됨
    expect(after.ratingAvg).toBe(0);
  });
});
