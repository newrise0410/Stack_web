import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterAll, afterEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.PORTONE_IMP_KEY = 'test-imp-key';
process.env.PORTONE_IMP_SECRET = 'test-imp-secret';

let replset;

beforeAll(async () => {
  // 트랜잭션 테스트를 위해 단일 노드 replica set으로 기동
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri('stacknstak_test'));
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
