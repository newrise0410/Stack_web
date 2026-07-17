import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { createTestUser } from './helpers.js';

describe('test infra', () => {
  it('replica set에 연결되고 트랜잭션이 동작한다', async () => {
    const user = await createTestUser();
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await mongoose.connection.db
        .collection('users')
        .updateOne({ _id: user._id }, { $set: { points: 100 } }, { session });
    });
    session.endSession();
    const updated = await mongoose.connection.db.collection('users').findOne({ _id: user._id });
    expect(updated.points).toBe(100);
  });
});
