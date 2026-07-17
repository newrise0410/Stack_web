import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { applyPoints } from '../src/services/pointService.js';
import User from '../src/models/User.js';
import PointTransaction from '../src/models/PointTransaction.js';
import { withTransaction } from '../src/utils/withTransaction.js';
import { createTestUser } from './helpers.js';

describe('applyPoints (트랜잭션)', () => {
  it('잔액 증감 + 원장 기록이 함께 성립한다', async () => {
    const user = await createTestUser({ points: 1000 });
    const r = await applyPoints(user._id, -300, 'spend', { note: '테스트' });
    expect(r.amount).toBe(-300);
    expect(r.balance).toBe(700);
    expect((await User.findById(user._id)).points).toBe(700);
    expect(await PointTransaction.countDocuments({ user: user._id })).toBe(1);
  });

  it('0 클램프 — 잔액보다 큰 차감은 잔액까지만', async () => {
    const user = await createTestUser({ points: 100 });
    const r = await applyPoints(user._id, -500, 'spend', {});
    expect(r.amount).toBe(-100);
    expect(r.balance).toBe(0);
  });

  it('{order,type} unique 위반(11000) 시 잔액 변경 없이 null — 이중 지급 차단', async () => {
    // 전제: PointTransaction에 {order,type} partial unique 인덱스 존재(기존 스키마)
    await PointTransaction.syncIndexes();
    const user = await createTestUser({ points: 0 });
    const orderId = new mongoose.Types.ObjectId();
    const r1 = await applyPoints(user._id, 500, 'earn', { order: orderId });
    expect(r1.amount).toBe(500);
    const r2 = await applyPoints(user._id, 500, 'earn', { order: orderId });
    expect(r2).toBe(null); // 멱등 no-op
    expect((await User.findById(user._id)).points).toBe(500); // 이중 적립 없음
  });

  it('호출자 세션 참여 — 호출자 트랜잭션 abort 시 잔액도 롤백', async () => {
    const user = await createTestUser({ points: 1000 });
    await expect(
      withTransaction(async (session) => {
        await applyPoints(user._id, -400, 'spend', { session });
        throw new Error('caller abort');
      }),
    ).rejects.toThrow('caller abort');
    expect((await User.findById(user._id)).points).toBe(1000);
    expect(await PointTransaction.countDocuments({ user: user._id })).toBe(0);
  });
});
