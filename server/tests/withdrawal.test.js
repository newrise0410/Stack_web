import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import Review from '../src/models/Review.js';
import UserCoupon from '../src/models/UserCoupon.js';
import Coupon from '../src/models/Coupon.js';
import EmailMessage from '../src/models/EmailMessage.js';
import OrderEvent from '../src/models/OrderEvent.js';
import PointTransaction from '../src/models/PointTransaction.js';
import { withdrawUser, WithdrawalBlockedError } from '../src/services/withdrawalService.js';
import { applyPoints } from '../src/services/pointService.js';
import { createTestUser } from './helpers.js';

function mkOrder(user, status = 'delivered') {
  return Order.create({
    user,
    orderNumber: `20260717-${Math.floor(100000 + Math.random() * 899999)}`,
    status,
    items: [{ slug: 'ola-lamp', name: 'OLA', nameKo: '올라', price: 10000, qty: 1 }],
    shippingAddress: {
      recipient: '홍길동', phone: '010-1234-5678', zipcode: '06236', address1: '서울시 강남구',
    },
    amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
  });
}

describe('회원 탈퇴 — tombstone 전환', () => {
  it('진행 중 주문이 있으면 409로 거부한다', async () => {
    const u = await createTestUser();
    await mkOrder(u._id, 'shipped');
    await expect(withdrawUser(u._id)).rejects.toBeInstanceOf(WithdrawalBlockedError);
    expect((await User.findById(u._id)).status).toBe('active'); // 아무것도 파기되지 않음
  });

  it('PII를 파기하고 tombstone으로 전환한다', async () => {
    const u = await createTestUser({
      nickname: '철수', birthday: '1990-05-15', gender: 'male', lastLoginAt: new Date(),
      addresses: [{ recipient: '김철수', phone: '010-1111-2222', zipcode: '06236', address1: '서울' }],
      wishlist: ['ola-lamp'],
    });
    const t = await withdrawUser(u._id);

    expect(t.email).toBe(`withdrawn_${u._id}@deleted.local`);
    expect(t.name).toBe('탈퇴한 회원');
    expect(t.status).toBe('withdrawn');
    expect(t.withdrawnAt).toBeInstanceOf(Date);
    expect(t.nickname).toBeNull();
    expect(t.phone).toBeUndefined();
    expect(t.birthday).toBeNull();
    expect(t.gender).toBeNull();
    expect(t.lastLoginAt).toBeNull();
    expect(t.addresses).toHaveLength(0);
    expect(t.wishlist).toHaveLength(0);
    expect((await User.findById(u._id).select('+passwordHash')).passwordHash).toBeFalsy();
  });

  it('주문은 한 필드도 건드리지 않는다 (전자상거래법 5년 보관)', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await withdrawUser(u._id);

    const after = await Order.findById(o._id);
    expect(after.shippingAddress.recipient).toBe('홍길동'); // 배송지 스냅샷이 법정 기록
    expect(after.shippingAddress.phone).toBe('010-1234-5678');
    expect(String(after.user)).toBe(String(u._id)); // required 참조가 고아가 되지 않음
    expect(await User.findById(after.user)).not.toBeNull();
  });

  it('리뷰는 삭제하지 않고 익명화한다', async () => {
    const u = await createTestUser();
    await Review.create({
      product: new mongoose.Types.ObjectId(), user: u._id,
      userName: '김**', rating: 5, content: '좋아요',
    });
    await withdrawUser(u._id);

    const r = await Review.findOne({ user: u._id });
    expect(r.userName).toBe('탈퇴한 회원');
    expect(r.content).toBe('좋아요'); // 공개 콘텐츠는 남는다
  });

  it('적립금을 소멸시키고 원장에 흔적을 남긴다', async () => {
    const u = await createTestUser();
    await applyPoints(u._id, 3000, 'signup');
    await withdrawUser(u._id);

    expect((await User.findById(u._id)).points).toBe(0);
    const wd = await PointTransaction.findOne({ user: u._id, type: 'withdraw' });
    expect(wd.amount).toBe(-3000);
    expect(wd.balanceAfter).toBe(0);
    // 기존 원장은 대금결제 기록의 일부라 보존
    expect(await PointTransaction.countDocuments({ user: u._id, type: 'signup' })).toBe(1);
  });

  it('잔액이 0이면 withdraw 원장을 만들지 않는다', async () => {
    // pointService는 반영량 0이면 오해를 부르는 0원 원장을 남기지 않는다 — 이게 정상이다.
    const u = await createTestUser();
    await withdrawUser(u._id);
    expect(await PointTransaction.countDocuments({ user: u._id, type: 'withdraw' })).toBe(0);
  });

  it('미사용 쿠폰만 소멸시키고 사용한 쿠폰은 남긴다', async () => {
    const u = await createTestUser();
    // UserCoupon은 unique(user, coupon)이라 한 회원이 같은 쿠폰을 2장 가질 수 없다 → 2종으로.
    const unused = await Coupon.create({
      code: 'UNUSED10', name: '미사용', discountType: 'fixed', discountValue: 1000,
    });
    const spent = await Coupon.create({
      code: 'SPENT10', name: '사용함', discountType: 'fixed', discountValue: 1000,
    });
    await UserCoupon.create({ user: u._id, coupon: unused._id, used: false });
    await UserCoupon.create({ user: u._id, coupon: spent._id, used: true });
    await withdrawUser(u._id);

    expect(await UserCoupon.countDocuments({ user: u._id, used: false })).toBe(0);
    expect(await UserCoupon.countDocuments({ user: u._id, used: true })).toBe(1); // 결제 기록
  });

  it('user가 null인 outbox 메일까지 파기한다', async () => {
    // ⚠️ 회귀 방지의 핵심. orderEventService의 loadRecipient가 _id를 버려서 outbox 경로로
    //    생성된 메일은 user가 null이다. deleteMany({user})만 쓰면 여기 걸리지 않아
    //    이메일 원문과 주문 내역이 평문으로 영구히 남는다.
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await EmailMessage.create({
      to: u.email, subject: '주문 접수', body: '주문 내역 평문',
      type: 'order_placed', order: o._id, user: null, // ← outbox 경로 재현
    });
    await withdrawUser(u._id);

    expect(await EmailMessage.countDocuments({ order: o._id })).toBe(0);
    expect(await EmailMessage.countDocuments({ to: u.email })).toBe(0);
  });

  it('outbox 페이로드의 수신자 스냅샷을 파기한다', async () => {
    const u = await createTestUser();
    const o = await mkOrder(u._id);
    await OrderEvent.create({
      order: o._id, type: 'paid_email', uniqueKey: `${o._id}:paid_email`,
      payload: { user: { name: u.name, email: u.email } }, // 실명·이메일 평문
    });
    await withdrawUser(u._id);

    const ev = await OrderEvent.findOne({ order: o._id });
    expect(ev.payload.user).toBeUndefined();
  });

  it('tombstone에는 적립금이 붙지 않는다', async () => {
    // orderTransitionService가 delivered→delivered 재전이를 적립 재시도로 허용하므로,
    // 가드가 없으면 탈퇴 후 관리자가 재전이를 찍을 때 파기한 잔액이 되살아난다.
    const u = await createTestUser();
    await withdrawUser(u._id);

    expect(await applyPoints(u._id, 5000, 'earn')).toBeNull();
    expect((await User.findById(u._id)).points).toBe(0);
    expect(await PointTransaction.countDocuments({ user: u._id, type: 'earn' })).toBe(0);
  });

  it('두 번 호출해도 안전하다 (멱등)', async () => {
    const u = await createTestUser();
    await withdrawUser(u._id);
    const first = await User.findById(u._id);
    await withdrawUser(u._id);
    const second = await User.findById(u._id);

    expect(second.email).toBe(first.email); // 이메일이 두 번 재작성되지 않음
    expect(second.withdrawnAt.getTime()).toBe(first.withdrawnAt.getTime());
  });

  it('탈퇴한 이메일로 재가입할 수 있다', async () => {
    const u = await createTestUser({ email: 'reuse@test.local' });
    await withdrawUser(u._id);
    const again = await User.create({
      email: 'reuse@test.local', name: '최지우', phone: '010-9999-0000', password: 'password123',
    });
    expect(String(again._id)).not.toBe(String(u._id)); // 완전 단절 — 새 계정
    expect(again.points).toBe(0);
  });

  it('없는 회원이면 null을 반환한다', async () => {
    expect(await withdrawUser(new mongoose.Types.ObjectId())).toBeNull();
  });
});
