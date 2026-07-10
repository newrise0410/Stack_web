import User from '../models/User.js';
import PointTransaction from '../models/PointTransaction.js';

export const SIGNUP_BONUS = 3000; // 가입 축하 적립금
export const EARN_RATE = 0.03; // 구매 적립률 (결제액의 3%)

// 잔액을 증감하고 원장에 기록한다. 잔액은 음수가 되지 않게 0으로 클램프.
// 단일 aggregation-pipeline 업데이트로 클램프까지 원자적으로 처리(read-then-write 창 없음).
// 반환: { balance(최종잔액), amount(실제 반영량), txnId } — 실패 시 null.
export async function applyPoints(userId, delta, type, { order = null, note = '' } = {}) {
  // { new:false }로 갱신 직전(pre-image) 문서를 받아 실제 반영량을 계산
  const prev = await User.findOneAndUpdate(
    { _id: userId },
    [{ $set: { points: { $max: [0, { $add: [{ $ifNull: ['$points', 0] }, delta] }] } } }],
    { new: false },
  );
  if (!prev) return null;

  const before = prev.points || 0;
  const after = Math.max(0, before + delta);
  const amount = after - before; // 0 클램프 반영된 실제 증감량

  // 실제 반영량이 0이면(잔액부족 클램프 등) 오해를 부르는 0원 원장은 남기지 않는다.
  if (amount === 0) return { balance: after, amount: 0, txnId: null };

  let txn;
  try {
    txn = await PointTransaction.create({
      user: userId, amount, type, order, balanceAfter: after, note,
    });
  } catch (e) {
    // 원장 기록 실패 → 방금 반영한 잔액을 역보상(상대 델타라 동시성 안전)해 잔액과 원장이
    // 항상 함께 성립/실패하도록 한다. 보상 실패는 삼키되(잔액만이라도 복구 시도) 원 예외는 rethrow.
    await User.updateOne(
      { _id: userId },
      [{ $set: { points: { $max: [0, { $add: [{ $ifNull: ['$points', 0] }, -amount] }] } } }],
    ).catch(() => {});
    // {order,type} 멱등 장벽(earn/refund/reclaim) 위반 = 이미 다른 요청이 지급/원복 완료.
    // 위에서 이 요청분 잔액 증분을 되돌렸으므로, 중복 없이 idempotent no-op으로 수렴시킨다.
    // (PointTransaction의 유일한 unique 인덱스가 이 partial index뿐이라 11000은 항상 이 경우다.)
    if (e.code === 11000) return null;
    throw e;
  }
  return { balance: after, amount, txnId: txn._id };
}

// 신규 가입 보너스 지급 (실패해도 가입은 성립하도록 호출부에서 try/catch).
export async function grantSignupBonus(userId) {
  return applyPoints(userId, SIGNUP_BONUS, 'signup', { note: '가입 축하 적립금' });
}
