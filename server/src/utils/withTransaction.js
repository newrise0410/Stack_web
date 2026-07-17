import mongoose from 'mongoose';

let warnedFallback = false;

function isTxnUnsupported(e) {
  return (
    e?.code === 20 ||
    /Transaction numbers are only allowed/i.test(e?.message || '') ||
    /replica set/i.test(e?.errmsg || '')
  );
}

// Mongo 트랜잭션 실행. 로컬 standalone(mongod 단일)에서는 트랜잭션이 불가하므로
// session=null 로 순차 실행 폴백한다 — 개발 편의용이며 원자성은 보장되지 않는다.
// 프로덕션(Atlas)은 항상 트랜잭션 경로. fn은 재시도-안전해야 한다(driver가 transient 재시도).
export async function withTransaction(fn) {
  let session;
  try {
    session = await mongoose.startSession();
  } catch (e) {
    if (!isTxnUnsupported(e)) throw e;
    session = null;
  }
  if (!session) return runFallback(fn);
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (e) {
    if (isTxnUnsupported(e)) return runFallback(fn);
    throw e;
  } finally {
    session.endSession();
  }
}

function runFallback(fn) {
  if (!warnedFallback) {
    console.warn('⚠️  Mongo 트랜잭션 미지원(standalone) — 비원자 폴백으로 실행합니다. 로컬 개발 전용.');
    warnedFallback = true;
  }
  return fn(null);
}
