import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { withTransaction } from '../src/utils/withTransaction.js';
import User from '../src/models/User.js';
import { createTestUser } from './helpers.js';

describe('withTransaction', () => {
  it('콜백 결과를 반환하고 커밋한다', async () => {
    const user = await createTestUser();
    const result = await withTransaction(async (session) => {
      await User.updateOne({ _id: user._id }, { $set: { points: 500 } }, { session });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect((await User.findById(user._id)).points).toBe(500);
  });

  it('콜백이 던지면 롤백한다', async () => {
    const user = await createTestUser({ points: 0 });
    await expect(
      withTransaction(async (session) => {
        await User.updateOne({ _id: user._id }, { $set: { points: 999 } }, { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await User.findById(user._id)).points || 0).toBe(0);
  });

  it('트랜잭션 미지원 오류면 session 없이 폴백 실행한다', async () => {
    const spy = vi.spyOn(mongoose, 'startSession').mockImplementationOnce(async () => {
      const err = new Error('Transaction numbers are only allowed on a replica set member');
      err.code = 20;
      throw err;
    });
    const result = await withTransaction(async (session) => {
      expect(session).toBe(null);
      return 'fallback';
    });
    expect(result).toBe('fallback');
    spy.mockRestore();
  });
});
