import User from '../models/User.js';
import PointTransaction from '../models/PointTransaction.js';
import { withTransaction } from '../utils/withTransaction.js';

export const SIGNUP_BONUS = 3000; // 가입 축하 적립금
export const EARN_RATE = 0.03; // 구매 적립률 (결제액의 3%)

// 잔액 증감 + 원장 기록. 잔액은 0으로 클램프(음수 금지).
// 잔액 변경과 원장 insert를 한 트랜잭션으로 묶어, 동시 환불이 잔액을 이중 증가시키는 창을 없앤다.
// - session 전달 시: 호출자 트랜잭션에 참여. 11000({order,type} 멱등 장벽)은 그대로 던져
//   호출자가 abort/수렴을 결정한다.
// - session 미전달 시: 자체 트랜잭션. 11000이면 잔액 변경이 롤백된 뒤 null 반환(멱등 no-op).
// standalone 폴백(session=null 실행)에서는 원장 실패 시 역보상으로 잔액을 복구한다(로컬 개발 전용).
export async function applyPoints(userId, delta, type, { order = null, note = '', session = null } = {}) {
  if (session !== null) return execApplyPoints(userId, delta, type, { order, note }, session);
  try {
    return await withTransaction((s) => execApplyPoints(userId, delta, type, { order, note }, s));
  } catch (e) {
    if (e.code === 11000) return null; // 멱등 장벽 — 트랜잭션이 잔액 변경을 롤백함
    throw e;
  }
}

async function execApplyPoints(userId, delta, type, { order, note }, session) {
  // { new:false }로 갱신 직전(pre-image) 문서를 받아 실제 반영량을 계산.
  // status: { $ne: 'withdrawn' } — 탈퇴 tombstone에는 적립금이 붙지 않는다.
  // 이 한 줄이 applyPoints의 모든 호출 경로(earn/refund/reclaim/spend/admin_adjust)를 막는다.
  // 없으면 실제로 되살아난다: orderTransitionService는 delivered→delivered 재전이를
  // '적립 지급 재시도'로 허용하므로, 적립이 실패했던 delivered 주문을 가진 회원이 탈퇴한 뒤
  // 관리자가 재전이를 찍으면 tombstone의 points가 올라가고 파기 시각 이후의 원장이 생긴다.
  // ⚠️ 순서 의존: withdrawalService는 status를 'withdrawn'으로 바꾸기 **전에** 소멸분을
  //    기록해야 자기 자신이 이 필터에 걸리지 않는다.
  const prev = await User.findOneAndUpdate(
    { _id: userId, status: { $ne: 'withdrawn' } },
    [{ $set: { points: { $max: [0, { $add: [{ $ifNull: ['$points', 0] }, delta] }] } } }],
    { new: false, session },
  );
  if (!prev) return null;

  const before = prev.points || 0;
  const after = Math.max(0, before + delta);
  const amount = after - before; // 0 클램프 반영된 실제 증감량

  // 실제 반영량이 0이면(잔액부족 클램프 등) 오해를 부르는 0원 원장은 남기지 않는다.
  if (amount === 0) return { balance: after, amount: 0, txnId: null };

  let txn;
  try {
    [txn] = await PointTransaction.create(
      [{ user: userId, amount, type, order, balanceAfter: after, note }],
      { session: session || undefined },
    );
  } catch (e) {
    // standalone 폴백(session 없음)에서는 롤백이 없으므로 잔액을 역보상해 함께-실패를 유지한다.
    if (!session) {
      await User.updateOne(
        { _id: userId },
        [{ $set: { points: { $max: [0, { $add: [{ $ifNull: ['$points', 0] }, -amount] }] } } }],
      ).catch(() => {});
      if (e.code === 11000) return null;
    }
    throw e; // 트랜잭션 경로: 던지면 전체 abort → 잔액 자동 롤백
  }
  return { balance: after, amount, txnId: txn._id };
}

// 신규 가입 보너스 지급 (실패해도 가입은 성립하도록 호출부에서 try/catch).
export async function grantSignupBonus(userId) {
  return applyPoints(userId, SIGNUP_BONUS, 'signup', { note: '가입 축하 적립금' });
}
