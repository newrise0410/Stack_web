# 포트원 v1 PG 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모의 결제를 포트원 v1(IMP.request_pay, KG이니시스 테스트 채널) 실 결제 플로우로 대체 — 선주문(pending) → 결제창 → 서버 검증 → paid, 환불 saga·outbox·reconciler 포함.

**Architecture:** 서버가 금액의 유일한 출처. 주문 생성(트랜잭션: 주문+쿠폰+포인트) 후 포트원 사전등록, 클라이언트 결제, imp_uid 재조회 검증으로 paid 확정. 부수효과는 OrderEvent outbox로 exactly-once, 취소는 단일 saga, 미확정 상태는 60초 주기 reconciler가 수렴.

**Tech Stack:** Express 4 + Mongoose 8(ESM, Node≥18 — HTTP는 내장 fetch), React/Vite, 포트원 v1 REST(api.iamport.kr), vitest + mongodb-memory-server(replset) + supertest 신규 도입.

**Spec:** `docs/superpowers/specs/2026-07-17-portone-pg-design.md` — 결정표·상태 규칙은 스펙이 권위.

## Global Constraints

- ESM only (`"type": "module"`), Node >= 18, 외부 HTTP 클라이언트 추가 금지(내장 fetch 사용).
- 사용자 노출 문구는 전부 한국어, 기존 파일의 주석 스타일(한국어, 이유 중심) 유지.
- 포트원 v1 REST 규약: base `https://api.iamport.kr`, `Authorization`에 access_token 원문(Bearer 없음), 응답 envelope `{code, message, response}`에서 `code===0`만 성공, 필드는 snake_case, `paid_at`/`expired_at`은 Unix seconds.
- 카드 최소 결제금액 `MIN_CARD_AMOUNT = 100`(원). 주문 만료 `PENDING_TTL_MS = 30*60*1000`. 사용자별 활성 pending 상한 3건.
- Order.status enum은 불변: `pending, paid, preparing, shipped, delivered, cancelled`. 세부 상태는 `payment.*`.
- 매출 집계 상태 `SALES_STATES = ['paid','preparing','shipped','delivered']`.
- 시크릿(`PORTONE_IMP_SECRET`, 토큰)은 에러 객체·로그에 절대 포함 금지 — portoneService 경계에서 정제.
- 테스트: `cd server && npm test` (vitest run). 모든 서버 태스크는 테스트 선행(TDD). 클라이언트는 테스트 인프라가 없으므로 수동 검증 단계로 대체.
- 커밋은 태스크당 1회 이상, conventional commit 한국어 설명. 모든 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 서버 테스트 인프라 (vitest + mongodb-memory-server replset)

**Files:**
- Modify: `server/package.json`
- Create: `server/vitest.config.js`
- Create: `server/tests/setup.js`
- Create: `server/tests/helpers.js`
- Test: `server/tests/smoke.test.js`

**Interfaces:**
- Produces: 전역 테스트 DB(replica set — 트랜잭션 동작), `createTestUser(overrides)`, `authHeader(user)` 헬퍼. 이후 모든 서버 태스크의 테스트가 이 셋업을 사용.

- [ ] **Step 1: devDependencies·스크립트 추가**

```bash
cd /Users/sw/project/stacknstak/server
npm install -D vitest@^2 mongodb-memory-server@^10 supertest@^7
```

`server/package.json`의 scripts에 추가:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: vitest 설정 작성**

`server/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false, // 단일 in-memory DB 공유 — 파일 간 동시 실행 금지
    testTimeout: 30000,
    hookTimeout: 120000, // 첫 실행 시 mongod 바이너리 다운로드 여유
  },
});
```

- [ ] **Step 3: 전역 셋업 작성**

`server/tests/setup.js`:

```js
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
```

- [ ] **Step 4: 테스트 헬퍼 작성**

`server/tests/helpers.js`:

```js
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';

let seq = 0;

// 필수 필드만 채운 테스트 사용자. User 스키마의 required 검증에 걸리면
// 해당 필드를 여기 한 곳에만 추가한다.
export async function createTestUser(overrides = {}) {
  seq += 1;
  return User.create({
    name: `테스터${seq}`,
    email: `tester${seq}-${Date.now()}@test.local`,
    password: 'test-password-hash',
    ...overrides,
  });
}

export function authHeader(user) {
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

export const TEST_ADDRESS = {
  recipient: '홍길동',
  phone: '010-1234-5678',
  zipcode: '06236',
  address1: '서울시 강남구 테헤란로 1',
  address2: '101호',
  deliveryMemo: '',
};
```

- [ ] **Step 5: 스모크 테스트 작성 후 실행**

`server/tests/smoke.test.js`:

```js
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
```

Run: `cd server && npm test`
Expected: PASS (첫 실행은 mongod 다운로드로 수십 초 소요 가능). `createTestUser`가 User 스키마 required 검증에 걸리면 helpers.js에 해당 필드를 추가해 통과시킨다.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/vitest.config.js server/tests/
git commit -m "test(server): vitest + mongodb-memory-server(replset) 테스트 인프라 도입"
```

---

### Task 2: withTransaction 헬퍼 + httpError 유틸

**Files:**
- Create: `server/src/utils/withTransaction.js`
- Create: `server/src/utils/httpError.js`
- Test: `server/tests/withTransaction.test.js`

**Interfaces:**
- Produces: `withTransaction(fn: (session|null) => Promise<T>): Promise<T>` — replica set이면 트랜잭션, standalone이면 `fn(null)` 폴백(1회 경고 로그). `httpError(status, message): Error` — `err.status`를 읽는 기존 errorHandler와 호환.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/withTransaction.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/withTransaction.test.js`
Expected: FAIL — `withTransaction.js` 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/utils/withTransaction.js`:

```js
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
```

`server/src/utils/httpError.js`:

```js
// errorHandler가 err.status/err.message를 읽으므로 이 형태만 맞추면 된다.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run tests/withTransaction.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/withTransaction.js server/src/utils/httpError.js server/tests/withTransaction.test.js
git commit -m "feat(server): withTransaction 헬퍼(standalone 폴백) + httpError 유틸"
```

---

### Task 3: Order 모델 확장 + OrderEvent·WebhookLog 모델

**Files:**
- Modify: `server/src/models/Order.js`
- Create: `server/src/models/OrderEvent.js`
- Create: `server/src/models/WebhookLog.js`
- Test: `server/tests/models.payment.test.js`

**Interfaces:**
- Produces: `Order.payment` 서브도큐먼트(아래 스키마), `Order` named export `SALES_STATES`, `OrderEvent`(uniqueKey unique), `WebhookLog`. 이후 태스크 전부가 이 필드명을 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/models.payment.test.js`:

```js
import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Order, { SALES_STATES } from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

function baseOrder(user, n) {
  return {
    orderNumber: `20260717-10000${n}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 3000, pointsUsed: 0, grandTotal: 13000 },
  };
}

describe('Order.payment', () => {
  it('payment 기본값 — provider/refund.status', async () => {
    const user = await createTestUser();
    const o = await Order.create({ ...baseOrder(user, 1), payment: { provider: 'portone' } });
    expect(o.payment.provider).toBe('portone');
    expect(o.payment.refund.status).toBe('none');
    expect(SALES_STATES).toEqual(['paid', 'preparing', 'shipped', 'delivered']);
  });

  it('payment.impUid partial unique — 같은 impUid 두 주문 금지, null 중복은 허용', async () => {
    const user = await createTestUser();
    await Order.syncIndexes();
    await Order.create({ ...baseOrder(user, 2), payment: { provider: 'portone', impUid: 'imp_001' } });
    await expect(
      Order.create({ ...baseOrder(user, 3), payment: { provider: 'portone', impUid: 'imp_001' } }),
    ).rejects.toMatchObject({ code: 11000 });
    // impUid 없는 주문 여러 개는 허용
    await Order.create({ ...baseOrder(user, 4), payment: { provider: 'portone' } });
    await Order.create({ ...baseOrder(user, 5), payment: { provider: 'portone' } });
  });
});

describe('OrderEvent', () => {
  it('uniqueKey 중복 insert는 11000', async () => {
    await OrderEvent.syncIndexes();
    const orderId = new mongoose.Types.ObjectId();
    await OrderEvent.create({ order: orderId, type: 'paid_email', uniqueKey: `${orderId}:paid_email` });
    await expect(
      OrderEvent.create({ order: orderId, type: 'paid_email', uniqueKey: `${orderId}:paid_email` }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/models.payment.test.js`
Expected: FAIL — SALES_STATES export 없음 / OrderEvent 모듈 없음.

- [ ] **Step 3: Order.js 수정**

`server/src/models/Order.js`의 `paymentMethod` 필드 위에 payment 서브도큐먼트를 추가하고, 파일 하단에 인덱스·export를 추가한다.

orderSchema 내 `paymentMethod` 라인을 다음으로 교체:

```js
    paymentMethod: { type: String, default: 'card' }, // 'card'(포트원) | 'points'(0원 주문) | 'mock'(레거시)
    // 포트원 결제·환불 상태 (status enum은 불변 — 세부 상태는 여기서 관리)
    payment: {
      provider: { type: String, default: null }, // 'portone' | 'none'(0원) | null(레거시 mock)
      pg: { type: String, default: '' }, // 포트원 응답 pg_provider 스냅샷
      method: { type: String, default: '' }, // 'card' | 'points'
      impUid: { type: String, default: null },
      paidAt: { type: Date, default: null },
      receiptUrl: { type: String, default: '' },
      failReason: { type: String, default: '' },
      prepareStatus: { type: String, enum: ['preparing', 'prepared', 'failed', null], default: null },
      preparedAmount: { type: Number, default: null },
      expiresAt: { type: Date, default: null }, // pending 만료(sweeper 기준)
      refund: {
        status: { type: String, enum: ['none', 'requested', 'processing', 'done', 'review'], default: 'none' },
        reason: { type: String, default: '' },
        requestedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelAmount: { type: Number, default: 0 },
      },
    },
    // 같은 멱등키 + 다른 본문 재사용 감지용(sha256 hex)
    requestHash: { type: String, default: null },
```

기존 `orderSchema.index({ user: 1, idempotencyKey: 1 }, ...)` 아래에 추가:

```js
// 같은 결제(impUid)가 두 주문에 매핑되는 것을 차단 — 문자열일 때만(partial)
orderSchema.index(
  { 'payment.impUid': 1 },
  { unique: true, partialFilterExpression: { 'payment.impUid': { $type: 'string' } } },
);
// sweeper 스캔용
orderSchema.index({ status: 1, 'payment.expiresAt': 1 });
```

`const Order = mongoose.model(...)` 위에 추가:

```js
// 매출로 집계되는 상태(결제 확정 이후). pending·cancelled 제외.
export const SALES_STATES = ['paid', 'preparing', 'shipped', 'delivered'];
```

- [ ] **Step 4: OrderEvent.js 생성**

`server/src/models/OrderEvent.js`:

```js
import mongoose from 'mongoose';

const { Schema } = mongoose;

// 주문 부수효과 outbox — paid/cancelled 전이와 같은 트랜잭션으로 insert되고,
// 워커가 claim(pending→processing)해 실행한다. uniqueKey가 exactly-once 장벽.
const orderEventSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['paid_email', 'paid_sales_inc', 'cancel_email', 'cancel_sales_dec'],
    },
    uniqueKey: { type: String, required: true, unique: true }, // `${orderId}:${type}`
    payload: { type: Schema.Types.Mixed, default: {} }, // 수신자 스냅샷 등(웹훅 경로엔 req.user가 없음)
    status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderEventSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model('OrderEvent', orderEventSchema);
```

- [ ] **Step 5: WebhookLog.js 생성**

`server/src/models/WebhookLog.js`:

```js
import mongoose from 'mongoose';

// 포트원 웹훅 수신 감사 로그(inbox). 판정은 항상 API 재조회로 하므로 body는 참고값만 저장.
const webhookLogSchema = new mongoose.Schema(
  {
    impUid: { type: String, default: '', index: true },
    merchantUid: { type: String, default: '' },
    rawStatus: { type: String, default: '' },
    result: { type: String, enum: ['received', 'processed', 'ignored', 'error'], default: 'received' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('WebhookLog', webhookLogSchema);
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd server && npx vitest run tests/models.payment.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add server/src/models/Order.js server/src/models/OrderEvent.js server/src/models/WebhookLog.js server/tests/models.payment.test.js
git commit -m "feat(server): Order.payment 서브도큐먼트 + OrderEvent(outbox)·WebhookLog 모델"
```

---

### Task 4: portoneService (토큰 캐시·envelope·에러 정제)

**Files:**
- Create: `server/src/services/portoneService.js`
- Test: `server/tests/portoneService.test.js`

**Interfaces:**
- Produces:
  - `isConfigured(): boolean`
  - `getPayment(impUid): Promise<pmt>` — 포트원 결제 객체(snake_case) 반환
  - `findPayment(merchantUid): Promise<pmt|null>` — 없으면 null
  - `prepare(merchantUid, amount): Promise<void>`, `getPrepared(merchantUid): Promise<{merchant_uid, amount}|null>`
  - `cancel({ impUid, amount, checksum, reason }): Promise<pmt>`
  - `PortoneError`(확정 실패, `status=502`, `portoneCode`), `PortoneUnknownError`(결과 불명 — 타임아웃/5xx/네트워크)
  - `_resetTokenCache()` (테스트용)
- 호출부 규약: `PortoneError` = 실패 확정으로 처리 가능, `PortoneUnknownError` = 상태를 바꾸지 말고 재조회로 수렴.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/portoneService.test.js` — 전역 fetch를 vi.stubGlobal로 목킹:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as portone from '../src/services/portoneService.js';

function jsonRes(body, status = 200) {
  return { status, json: async () => body };
}
const TOKEN_RES = jsonRes({ code: 0, message: null, response: { access_token: 'tok-1', expired_at: Math.floor(Date.now() / 1000) + 1800, now: Math.floor(Date.now() / 1000) } });

describe('portoneService', () => {
  let fetchMock;
  beforeEach(() => {
    portone._resetTokenCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getPayment — 토큰 발급 후 Authorization 원문으로 조회, response를 반환', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 0, message: null, response: { imp_uid: 'imp_1', status: 'paid', amount: 13000 } }));
    const pmt = await portone.getPayment('imp_1');
    expect(pmt.amount).toBe(13000);
    const [, opts] = fetchMock.mock.calls[1];
    expect(opts.headers.Authorization).toBe('tok-1'); // Bearer 접두사 없음
  });

  it('토큰은 만료 전 캐시된다(2회 호출에 getToken 1회)', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 0, response: { imp_uid: 'a' } }))
      .mockResolvedValueOnce(jsonRes({ code: 0, response: { imp_uid: 'b' } }));
    await portone.getPayment('a');
    await portone.getPayment('b');
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/users/getToken'));
    expect(tokenCalls.length).toBe(1);
  });

  it('code!==0이면 PortoneError(시크릿 미포함)', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 1, message: '존재하지 않는 결제정보입니다.', response: null }));
    const err = await portone.getPayment('imp_x').catch((e) => e);
    expect(err).toBeInstanceOf(portone.PortoneError);
    expect(JSON.stringify(err)).not.toContain('test-imp-secret');
  });

  it('5xx/네트워크 오류는 PortoneUnknownError', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_RES).mockResolvedValueOnce(jsonRes({}, 502));
    await expect(portone.getPayment('imp_y')).rejects.toBeInstanceOf(portone.PortoneUnknownError);
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(portone.getPayment('imp_z')).rejects.toBeInstanceOf(portone.PortoneUnknownError);
  });

  it('findPayment — 미존재(code!==0)면 null', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 1, message: '없음', response: null }));
    expect(await portone.findPayment('20260717-1')).toBe(null);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/portoneService.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/services/portoneService.js`:

```js
// 포트원(아임포트) v1 REST 클라이언트.
// 규약: Authorization=access_token 원문, 응답 envelope {code,message,response}에서 code===0만 성공.
// 에러는 이 경계에서 정제해 던진다 — imp_secret·토큰·요청 config가 로그로 새지 않게.
const BASE = 'https://api.iamport.kr';
const TIMEOUT_MS = 10000;

// 확정 실패(포트원이 명시적으로 거절) — 호출부는 실패로 처리해도 된다.
export class PortoneError extends Error {
  constructor(message, { portoneCode = null } = {}) {
    super(message);
    this.name = 'PortoneError';
    this.status = 502;
    this.portoneCode = portoneCode;
  }
}

// 결과 불명(타임아웃·5xx·네트워크) — 성공/실패를 알 수 없으므로 상태를 바꾸지 말고 재조회로 수렴할 것.
export class PortoneUnknownError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PortoneUnknownError';
    this.status = 502;
  }
}

let tokenCache = null; // { token, expiresAtMs }

export function _resetTokenCache() {
  tokenCache = null;
}

export function isConfigured() {
  return Boolean(process.env.PORTONE_IMP_KEY && process.env.PORTONE_IMP_SECRET);
}

async function rawFetch(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = await getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new PortoneUnknownError(`포트원 요청 실패(${path}): ${e?.name === 'AbortError' ? '타임아웃' : '네트워크 오류'}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw new PortoneUnknownError(`포트원 서버 오류(${res.status}, ${path})`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new PortoneUnknownError(`포트원 응답 파싱 실패(${path})`);
  }
  if (data.code !== 0) throw new PortoneError(data.message || `포트원 오류(code ${data.code})`, { portoneCode: data.code });
  return data.response;
}

async function getToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAtMs) return tokenCache.token;
  const r = await rawFetch('/users/getToken', {
    method: 'POST',
    auth: false,
    body: { imp_key: process.env.PORTONE_IMP_KEY, imp_secret: process.env.PORTONE_IMP_SECRET },
  });
  // expired_at은 Unix seconds — 60초 여유를 두고 갱신
  tokenCache = { token: r.access_token, expiresAtMs: (r.expired_at - 60) * 1000 };
  return tokenCache.token;
}

export async function getPayment(impUid) {
  return rawFetch(`/payments/${encodeURIComponent(impUid)}`);
}

// merchant_uid로 최신 결제 조회. "결제 없음"은 정상 케이스라 null로 반환.
export async function findPayment(merchantUid) {
  try {
    return await rawFetch(`/payments/find/${encodeURIComponent(merchantUid)}`);
  } catch (e) {
    if (e instanceof PortoneError) return null;
    throw e;
  }
}

export async function prepare(merchantUid, amount) {
  await rawFetch('/payments/prepare', { method: 'POST', body: { merchant_uid: merchantUid, amount } });
}

export async function getPrepared(merchantUid) {
  try {
    return await rawFetch(`/payments/prepare/${encodeURIComponent(merchantUid)}`);
  } catch (e) {
    if (e instanceof PortoneError) return null;
    throw e;
  }
}

export async function cancel({ impUid, amount, checksum, reason = '' }) {
  return rawFetch('/payments/cancel', {
    method: 'POST',
    body: { imp_uid: impUid, amount, checksum, reason },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run tests/portoneService.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/portoneService.js server/tests/portoneService.test.js
git commit -m "feat(server): 포트원 v1 REST 클라이언트 — 토큰 캐시·envelope 검증·에러 정제"
```

---

### Task 5: pointService 트랜잭션화

**Files:**
- Modify: `server/src/services/pointService.js`
- Test: `server/tests/pointService.test.js`

**Interfaces:**
- Consumes: `withTransaction` (Task 2)
- Produces: `applyPoints(userId, delta, type, { order, note, session })` — 시그니처·반환값(`{balance, amount, txnId} | null`) 유지, `session` 옵션 추가. 세션 전달 시 호출자 트랜잭션에 참여(11000은 rethrow — 호출자가 abort 판단), 미전달 시 자체 트랜잭션(11000 → null 멱등 수렴). `SIGNUP_BONUS`, `EARN_RATE`, `grantSignupBonus` 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/pointService.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/pointService.test.js`
Expected: FAIL — session 옵션 미지원(4번째 테스트) 또는 11000 경로에서 잔액 이중 반영(3번째 테스트는 기존 구현도 통과할 수 있음 — 4번째가 핵심).

- [ ] **Step 3: 구현 — applyPoints 재작성**

`server/src/services/pointService.js` 전체를 다음으로 교체:

```js
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
  // { new:false }로 갱신 직전(pre-image) 문서를 받아 실제 반영량을 계산
  const prev = await User.findOneAndUpdate(
    { _id: userId },
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
```

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `cd server && npm test`
Expected: PASS — pointService 4개 포함 기존 테스트 전부. (기존 호출부는 session 미전달이라 동작 동일.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pointService.js server/tests/pointService.test.js
git commit -m "refactor(server): applyPoints를 트랜잭션 기반으로 — 동시 환불 이중 증가 창 제거"
```

---

### Task 6: salesService + orderEventService (outbox 워커)

**Files:**
- Create: `server/src/services/salesService.js`
- Create: `server/src/services/orderEventService.js`
- Modify: `server/src/controllers/orderController.js` (adjustSales 제거 → salesService import로 교체)
- Test: `server/tests/orderEventService.test.js`

**Interfaces:**
- Consumes: `OrderEvent`(Task 3), `withTransaction`(Task 2), `sendOrderPlaced`/`sendOrderStatus`(기존 emailService)
- Produces:
  - `adjustSales(items, sign)` — orderController에서 이동(로직 동일, salesService.js로)
  - `buildPaidEvents(order, user)` / `buildCancelEvents(order)` → `[{type, payload}]`
  - `enqueueEvents(orderId, events, session)` — uniqueKey `${orderId}:${type}`로 insert, 11000은 무시(이미 예약됨)
  - `processPendingEvents(limit=20): Promise<number>` — pending claim 후 실행, 처리 건수 반환. 5회 실패 시 failed.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/orderEventService.test.js`:

```js
import { describe, it, expect } from 'vitest';
import Order from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import Product from '../src/models/Product.js';
import EmailMessage from '../src/models/EmailMessage.js';
import { enqueueEvents, buildPaidEvents, buildCancelEvents, processPendingEvents } from '../src/services/orderEventService.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

async function makePaidOrder(user, product) {
  return Order.create({
    orderNumber: `20260717-2${Math.floor(Math.random() * 90000) + 10000}`,
    user: user._id,
    items: [{ product: product._id, slug: product.slug, name: product.name, price: 10000, qty: 2 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 20000, couponDiscount: 0, shippingFee: 3000, pointsUsed: 0, grandTotal: 23000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_t${Math.random().toString(36).slice(2, 8)}` },
  });
}

async function makeProduct() {
  // Product 스키마 required 필드가 더 있으면 여기서 채운다
  return Product.create({ name: 'Test Lamp', slug: `lamp-${Math.random().toString(36).slice(2, 8)}`, price: 10000, status: 'active', salesCount: 0 });
}

describe('orderEventService', () => {
  it('enqueue는 중복 키를 무시한다(재호출 안전)', async () => {
    await OrderEvent.syncIndexes();
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    const events = buildPaidEvents(order, user);
    await enqueueEvents(order._id, events, null);
    await enqueueEvents(order._id, events, null); // 중복 — 11000 무시
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(events.length);
  });

  it('paid 이벤트 처리 — salesCount 증가 + 주문접수 메일 1회, 재실행해도 1회', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await enqueueEvents(order._id, buildPaidEvents(order, user), null);
    await processPendingEvents(10);
    await processPendingEvents(10); // 이미 done — no-op
    expect((await Product.findById(product._id)).salesCount).toBe(2); // qty 2, 1회만
    expect(await EmailMessage.countDocuments({})).toBe(1);
    const done = await OrderEvent.find({ order: order._id });
    expect(done.every((e) => e.status === 'done')).toBe(true);
  });

  it('cancel 이벤트 처리 — salesCount 감소', async () => {
    const user = await createTestUser();
    const product = await makeProduct();
    const order = await makePaidOrder(user, product);
    await Product.updateOne({ _id: product._id }, { $set: { salesCount: 5 } });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    const cancelled = await Order.findById(order._id);
    await enqueueEvents(order._id, buildCancelEvents(cancelled), null);
    await processPendingEvents(10);
    expect((await Product.findById(product._id)).salesCount).toBe(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/orderEventService.test.js`
Expected: FAIL — 모듈 없음. (EmailMessage import 경로가 다르면 `server/src/models/`에서 실제 파일명 확인해 맞춘다. Product required 필드 오류가 나면 makeProduct에 필드 추가.)

- [ ] **Step 3: salesService 생성 + orderController에서 adjustSales 이동**

`server/src/services/salesService.js`:

```js
import Product from '../models/Product.js';

// 판매량(salesCount) 가감. sign=+1 결제 확정, -1 취소. (orderController에서 이동)
export async function adjustSales(items, sign) {
  if (!items?.length) return;
  await Product.bulkWrite(
    items
      .filter((i) => i.product)
      .map((i) => ({
        updateOne: { filter: { _id: i.product }, update: { $inc: { salesCount: sign * i.qty } } },
      })),
  );
}
```

`server/src/controllers/orderController.js`에서:
- 파일 내 `adjustSales` 함수 정의(25~35행 부근)를 삭제
- 상단에 `import { adjustSales } from '../services/salesService.js';` 추가
- 기존 호출부(`adjustSales(orderItems, +1)`, `adjustSales(cancelled.items, -1)`, `adjustSales(updated.items, -1)`)는 그대로 동작 (Task 7·10에서 재구성됨)

- [ ] **Step 4: orderEventService 구현**

`server/src/services/orderEventService.js`:

```js
import OrderEvent from '../models/OrderEvent.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { adjustSales } from './salesService.js';
import { sendOrderPlaced, sendOrderStatus } from './emailService.js';

const MAX_ATTEMPTS = 5;

// paid 확정 시 예약할 부수효과. payload에 수신자 스냅샷을 넣는다 — 웹훅/잡 경로엔 req.user가 없다.
export function buildPaidEvents(order, user) {
  const snapshot = user ? { name: user.name, email: user.email } : null;
  return [
    { type: 'paid_email', payload: { user: snapshot } },
    { type: 'paid_sales_inc', payload: {} },
  ];
}

export function buildCancelEvents(order) {
  return [
    { type: 'cancel_email', payload: {} },
    { type: 'cancel_sales_dec', payload: {} },
  ];
}

// 상태 전이와 같은 트랜잭션에서 호출. uniqueKey가 exactly-once 장벽 — 중복(11000)은 정상.
export async function enqueueEvents(orderId, events, session) {
  if (!events?.length) return;
  const docs = events.map((e) => ({
    order: orderId,
    type: e.type,
    uniqueKey: `${orderId}:${e.type}`,
    payload: e.payload || {},
  }));
  try {
    await OrderEvent.insertMany(docs, { session: session || undefined, ordered: false });
  } catch (e) {
    // ordered:false — 중복 키만 걸러지고 나머지는 insert됨. 중복 외 오류는 전파.
    if (e.code !== 11000 && !e.writeErrors?.every?.((w) => w.code === 11000)) throw e;
  }
}

async function loadRecipient(order, payload) {
  if (payload?.user?.email) return payload.user;
  const u = await User.findById(order.user).select('name email');
  return u ? { name: u.name, email: u.email } : null;
}

async function runEvent(event) {
  const order = await Order.findById(event.order);
  if (!order) throw new Error(`주문 없음: ${event.order}`);
  switch (event.type) {
    case 'paid_sales_inc':
      return adjustSales(order.items, +1);
    case 'cancel_sales_dec':
      return adjustSales(order.items, -1);
    case 'paid_email': {
      const user = await loadRecipient(order, event.payload);
      if (user) await sendOrderPlaced(order, user);
      return undefined;
    }
    case 'cancel_email': {
      const user = await loadRecipient(order, event.payload);
      if (user) await sendOrderStatus(order, user);
      return undefined;
    }
    default:
      throw new Error(`알 수 없는 이벤트: ${event.type}`);
  }
}

// pending 이벤트를 CAS로 claim해 순차 실행. 반환: 처리 시도 건수.
// 실행 성공→done, 실패→attempts+1 후 pending 복귀(MAX_ATTEMPTS 도달 시 failed).
export async function processPendingEvents(limit = 20) {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const event = await OrderEvent.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { new: true, sort: { updatedAt: 1 } },
    );
    if (!event) break;
    processed += 1;
    try {
      await runEvent(event);
      await OrderEvent.updateOne(
        { _id: event._id },
        { $set: { status: 'done', processedAt: new Date(), lastError: '' } },
      );
    } catch (e) {
      const failed = event.attempts >= MAX_ATTEMPTS;
      await OrderEvent.updateOne(
        { _id: event._id },
        { $set: { status: failed ? 'failed' : 'pending', lastError: String(e?.message || e).slice(0, 300) } },
      );
      if (failed) console.error('[outbox] 이벤트 영구 실패:', event.uniqueKey, e?.message);
    }
  }
  return processed;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && npm test`
Expected: PASS 전체 (orderEventService 3개 포함).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/salesService.js server/src/services/orderEventService.js server/src/controllers/orderController.js server/tests/orderEventService.test.js
git commit -m "feat(server): OrderEvent outbox 워커 + adjustSales를 salesService로 분리"
```

---

### Task 7: createOrder 재구성 (트랜잭션·pending·0원 분기·prepare)

**Files:**
- Modify: `server/src/controllers/orderController.js` (createOrder 및 상단 상수)
- Create: `server/src/services/checkoutService.js` (ensurePrepared)
- Test: `server/tests/createOrder.test.js`

**Interfaces:**
- Consumes: `withTransaction`, `httpError`, `applyPoints(session)`, `enqueueEvents`/`buildPaidEvents`, `portoneService.prepare/getPrepared`, `PortoneError/PortoneUnknownError`
- Produces:
  - `POST /orders` 응답: `{ order, checkout: { orderId, orderNumber, amount, orderName } | null }` — `checkout===null`이면 0원 즉시 paid(클라이언트는 결제창 생략). **기존 “주문 객체 단독 반환”에서 변경 — 클라이언트는 Task 14에서 맞춘다.**
  - `ensurePrepared(order): Promise<void>` — prepared 보장(재호출 멱등). Task 10·11도 사용.
  - 에러: 400(1~99원/검증), 409(같은 키+다른 본문, 취소된 키 재사용), 429(활성 pending 3건 초과), 502(prepare 실패/불명)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/createOrder.test.js` — supertest로 실제 라우트 호출, portoneService는 vi.mock:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isConfigured: () => true,
    prepare: vi.fn(async () => {}),
    getPrepared: vi.fn(async () => null),
    getPayment: vi.fn(),
    findPayment: vi.fn(async () => null),
    cancel: vi.fn(),
  };
});

import * as portone from '../src/services/portoneService.js';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import UserCoupon from '../src/models/UserCoupon.js';
import PointTransaction from '../src/models/PointTransaction.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();

async function seedProduct(price = 30000) {
  return Product.create({
    name: 'Stack Lamp', slug: `stack-${Math.random().toString(36).slice(2, 8)}`,
    price, status: 'active', options: [],
  });
}

function orderBody(product, extra = {}) {
  return {
    items: [{ slug: product.slug, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    ...extra,
  };
}

describe('POST /orders (포트원 선주문)', () => {
  beforeEach(() => {
    portone.prepare.mockClear();
    portone.prepare.mockResolvedValue(undefined);
  });

  it('pending 주문 생성 + prepare 호출 + checkout DTO 반환', async () => {
    const user = await createTestUser();
    const product = await seedProduct(30000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-1')
      .send(orderBody(product));
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('pending');
    expect(res.body.checkout.amount).toBe(30000); // 5만원 미만 아님? 30000+3000 배송비 = 33000
  });

  it('멱등 재요청 — 같은 키는 같은 주문, 다른 본문은 409', async () => {
    const user = await createTestUser();
    const product = await seedProduct();
    const h = authHeader(user);
    const r1 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2').send(orderBody(product));
    const r2 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2').send(orderBody(product));
    expect(r2.status).toBe(200);
    expect(r2.body.order.orderNumber).toBe(r1.body.order.orderNumber);
    const r3 = await request(app).post('/orders').set(h).set('Idempotency-Key', 'k-2')
      .send(orderBody(product, { items: [{ slug: product.slug, qty: 2 }] }));
    expect(r3.status).toBe(409);
  });

  it('0원 주문(포인트 전액) — 결제창 없이 즉시 paid, checkout null', async () => {
    const user = await createTestUser({ points: 100000 });
    const product = await seedProduct(60000); // 5만 이상 → 배송비 0
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-3')
      .send(orderBody(product, { pointsToUse: 60000 }));
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('paid');
    expect(res.body.checkout).toBe(null);
    expect(res.body.order.payment.provider).toBe('none');
    expect(portone.prepare).not.toHaveBeenCalled();
  });

  it('1~99원 주문은 400 (카드 최소금액)', async () => {
    const user = await createTestUser({ points: 100000 });
    const product = await seedProduct(60000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-4')
      .send(orderBody(product, { pointsToUse: 59950 })); // grandTotal 50원
    expect(res.status).toBe(400);
    // 포인트 미차감 확인
    expect((await User.findById(user._id)).points).toBe(100000);
  });

  it('prepare 확정 실패 시 주문 취소 + 쿠폰·포인트 원복 + 502', async () => {
    const { PortoneError } = await vi.importActual('../src/services/portoneService.js');
    portone.prepare.mockRejectedValueOnce(new PortoneError('사전등록 거절'));
    const user = await createTestUser({ points: 5000 });
    const product = await seedProduct(30000);
    const res = await request(app)
      .post('/orders').set(authHeader(user)).set('Idempotency-Key', 'k-5')
      .send(orderBody(product, { pointsToUse: 2000 }));
    expect(res.status).toBe(502);
    const order = await Order.findOne({ user: user._id });
    expect(order.status).toBe('cancelled');
    expect((await User.findById(user._id)).points).toBe(5000); // 원복 완료
  });

  it('멱등키 없는 결제 주문은 400', async () => {
    const user = await createTestUser();
    const product = await seedProduct();
    const res = await request(app).post('/orders').set(authHeader(user)).send(orderBody(product));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/createOrder.test.js`
Expected: FAIL — 응답이 `{order, checkout}` 형태가 아니고 status가 'paid'(mock).

- [ ] **Step 3: checkoutService.ensurePrepared 구현**

`server/src/services/checkoutService.js`:

```js
import Order from '../models/Order.js';
import * as portone from './portoneService.js';

// 포트원 사전등록(금액 변조 1차 차단)을 보장한다. 재호출 멱등.
// - 이미 prepared → no-op
// - prepare 성공 → prepared 마킹
// - "이미 등록됨" 오류 → 등록된 금액이 현재 grandTotal과 같은지 확인 후 prepared 마킹
// PortoneUnknownError는 그대로 전파 — 호출부가 preparing 유지 후 재시도 유도.
export async function ensurePrepared(order) {
  if (order.payment?.prepareStatus === 'prepared') return;
  try {
    await portone.prepare(order.orderNumber, order.amounts.grandTotal);
  } catch (e) {
    if (!(e instanceof portone.PortoneError)) throw e;
    const prep = await portone.getPrepared(order.orderNumber);
    if (!prep || prep.amount !== order.amounts.grandTotal) throw e;
  }
  await Order.updateOne(
    { _id: order._id },
    { $set: { 'payment.prepareStatus': 'prepared', 'payment.preparedAmount': order.amounts.grandTotal } },
  );
  if (order.payment) order.payment.prepareStatus = 'prepared';
}
```

- [ ] **Step 4: createOrder 재작성**

`server/src/controllers/orderController.js` 수정. 상단 import에 추가:

```js
import crypto from 'node:crypto';
import { withTransaction } from '../utils/withTransaction.js';
import { httpError } from '../utils/httpError.js';
import { enqueueEvents, buildPaidEvents } from '../services/orderEventService.js';
import { ensurePrepared } from '../services/checkoutService.js';
import * as portone from '../services/portoneService.js';
```

상수 추가(SHIPPING_FEE 아래):

```js
const MIN_CARD_AMOUNT = 100; // 카드 최소 결제금액(원)
const PENDING_TTL_MS = 30 * 60 * 1000; // 미결제 pending 만료
const MAX_ACTIVE_PENDING = 3; // 사용자별 활성 pending 상한
```

`createOrder` 함수 전체를 다음으로 교체 (검증·금액 계산 로직은 기존 코드 재사용, 소비/생성부가 트랜잭션으로 바뀜):

```js
// 주문 생성 — POST /orders (requireAuth)
// 클라가 보낸 가격은 무시하고 서버가 DB 상품가로 합계를 재계산한다.
// 주문 insert + 쿠폰 소진 + 포인트 차감을 한 트랜잭션으로 묶고(부분 실패 없음),
// grandTotal>0이면 status:'pending'으로 만들어 포트원 사전등록 후 결제창 DTO를 반환한다.
// grandTotal===0(포인트 전액)이면 PG 없이 즉시 paid.
export async function createOrder(req, res) {
  const { items, shippingAddress } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: '주문할 상품이 없습니다.' });
  }
  if (items.length > MAX_ITEM_KINDS) {
    return res.status(400).json({ message: '한 번에 주문할 수 있는 상품 종류를 초과했습니다.' });
  }
  if (!shippingAddress?.recipient || !shippingAddress?.address1) {
    return res.status(400).json({ message: '배송지 정보를 입력해주세요.' });
  }

  // 결제 주문은 멱등키 필수 — 결제창·검증·재시도 전 구간의 기준 키.
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim().slice(0, 100) || null;
  if (!idempotencyKey) {
    return res.status(400).json({ message: '멱등키(Idempotency-Key)가 필요합니다. 새로고침 후 다시 시도해주세요.' });
  }

  // 같은 키 + 다른 본문 재사용 감지용 해시
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({ items, couponCode: req.body.couponCode || '', pointsToUse: req.body.pointsToUse || 0, shippingAddress }))
    .digest('hex');

  const existing = await Order.findOne({ user: req.user._id, idempotencyKey });
  if (existing) return respondExistingOrder(res, existing, requestHash);

  // 미결제 pending 폭주 방지(쿠폰·포인트 잠금 남용 차단)
  const activePending = await Order.countDocuments({ user: req.user._id, status: 'pending', 'payment.provider': 'portone' });
  if (activePending >= MAX_ACTIVE_PENDING) {
    return res.status(429).json({ message: '결제가 완료되지 않은 주문이 많습니다. 마이페이지에서 정리 후 다시 시도해주세요.' });
  }

  // 항목 정규화 + 검증 (기존과 동일)
  const cleanItems = [];
  for (const it of items) {
    if (!it || typeof it.slug !== 'string') {
      return res.status(400).json({ message: '잘못된 주문 항목이 있습니다.' });
    }
    cleanItems.push({
      slug: it.slug,
      qty: Math.min(MAX_QTY, Math.max(1, parseInt(it.qty, 10) || 1)),
      option: it.option != null ? String(it.option).slice(0, 100) : null,
    });
  }

  const products = await Product.find({ slug: { $in: cleanItems.map((i) => i.slug) }, status: 'active' });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const orderItems = [];
  for (const it of cleanItems) {
    const p = bySlug.get(it.slug);
    if (!p) return res.status(400).json({ message: `현재 구매할 수 없는 상품이 있습니다: ${it.slug}` });
    if (p.options.length > 0 && (!it.option || !p.options.includes(it.option))) {
      return res.status(400).json({ message: `옵션을 선택해주세요: ${p.nameKo || p.name}` });
    }
    orderItems.push({
      product: p._id, slug: p.slug, name: p.name, nameKo: p.nameKo,
      image: p.images?.[0], option: it.option || null, price: p.price, qty: it.qty,
    });
  }

  // 금액 안전성 — KRW 정수만
  if (!orderItems.every((i) => Number.isSafeInteger(i.price) && i.price > 0)) {
    return res.status(400).json({ message: '상품 가격 정보에 문제가 있습니다. 관리자에게 문의해주세요.' });
  }

  const itemsTotal = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
  const baseShipping = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;

  // 쿠폰 검증(소비는 트랜잭션 안에서)
  const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
  let couponDoc = null;
  let couponResult = { itemDiscount: 0, shippingFee: baseShipping, discountTotal: 0 };
  if (couponCode) {
    couponDoc = await Coupon.findOne({ code: couponCode });
    const err = validateCoupon(couponDoc, itemsTotal);
    if (err) return res.status(400).json({ message: err });
    couponResult = computeCoupon(couponDoc, itemsTotal, baseShipping);
  }

  const couponDiscount = couponResult.itemDiscount;
  const shippingFee = couponResult.shippingFee;
  const payableBeforePoints = Math.max(0, itemsTotal - couponDiscount + shippingFee);

  // 포인트 사용 요청 클램프 + 카드 최소금액 규칙(0원 또는 100원 이상)
  const requestedPoints = Math.min(Math.max(0, parseInt(req.body.pointsToUse, 10) || 0), payableBeforePoints);
  const remainderPreview = payableBeforePoints - requestedPoints;
  if (remainderPreview > 0 && remainderPreview < MIN_CARD_AMOUNT) {
    return res.status(400).json({ message: `카드 결제 최소 금액(${MIN_CARD_AMOUNT}원) 미만입니다. 적립금 사용액을 조정해주세요.` });
  }

  // ── 생성 트랜잭션: 주문 insert + 쿠폰 소진(usedOrder 연결) + 포인트 차감 ──
  const orderId = new Order.base.Types.ObjectId();
  let order;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        order = await withTransaction(async (session) => {
          // 포인트 선차감(잔액 클램프 반영량이 확정 금액) — 같은 트랜잭션이라 실패 시 자동 원복
          let pointsUsed = 0;
          if (requestedPoints > 0) {
            const r = await applyPoints(req.user._id, -requestedPoints, 'spend', {
              order: orderId, note: '주문 적립금 사용', session,
            });
            if (r) pointsUsed = -r.amount;
          }
          const grandTotal = Math.max(0, payableBeforePoints - pointsUsed);
          if (grandTotal > 0 && grandTotal < MIN_CARD_AMOUNT) {
            throw httpError(400, '적립금 잔액이 변동되어 결제 금액이 카드 최소 금액 미만이 되었습니다. 다시 시도해주세요.');
          }

          // 쿠폰 원자적 소진 + usedOrder 즉시 연결(원자성 — 복구는 usedOrder 기준)
          if (couponDoc) {
            await UserCoupon.findOneAndUpdate(
              { user: req.user._id, coupon: couponDoc._id, used: false },
              { $set: { used: true, usedAt: new Date(), usedOrder: orderId }, $setOnInsert: { issuedBy: 'self' } },
              { new: true, upsert: true, session },
            );
          }

          const zeroAmount = grandTotal === 0;
          const now = new Date();
          const [created] = await Order.create([{
            _id: orderId,
            orderNumber: genOrderNumber(),
            user: req.user._id,
            items: orderItems,
            shippingAddress: {
              recipient: shippingAddress.recipient, phone: shippingAddress.phone,
              zipcode: shippingAddress.zipcode, address1: shippingAddress.address1,
              address2: shippingAddress.address2, deliveryMemo: shippingAddress.deliveryMemo,
            },
            amounts: { itemsTotal, couponDiscount, shippingFee, pointsUsed, grandTotal },
            coupon: { code: couponDoc ? couponCode : '', discount: couponResult.discountTotal },
            pointsEarned: Math.floor(grandTotal * EARN_RATE),
            idempotencyKey,
            requestHash,
            status: zeroAmount ? 'paid' : 'pending',
            paymentMethod: zeroAmount ? 'points' : 'card',
            payment: zeroAmount
              ? { provider: 'none', method: 'points', paidAt: now }
              : { provider: 'portone', method: 'card', prepareStatus: 'preparing', expiresAt: new Date(now.getTime() + PENDING_TTL_MS) },
          }], { session: session || undefined });

          // 0원 주문은 즉시 paid — 부수효과(메일·판매량)를 같은 트랜잭션에 예약
          if (zeroAmount) await enqueueEvents(created._id, buildPaidEvents(created, req.user), session);
          return created;
        });
        break;
      } catch (e) {
        // 같은 멱등키 동시 요청 — 승자 주문으로 수렴(트랜잭션이라 이 요청의 차감분은 이미 롤백됨)
        if (e.code === 11000 && e.keyPattern?.idempotencyKey) {
          const winner = await Order.findOne({ user: req.user._id, idempotencyKey });
          if (winner) return respondExistingOrder(res, winner, requestHash);
        }
        // 쿠폰 1인 1회 unique 위반 — 이미 사용한 쿠폰
        if (e.code === 11000 && !e.keyPattern?.orderNumber) {
          return res.status(400).json({ message: '이미 사용한 쿠폰입니다.' });
        }
        if (e.code === 11000 && attempt < 3) continue; // orderNumber 충돌 → 재시도
        throw e;
      }
    }
  } catch (e) {
    // standalone 폴백(비원자)에서 부분 실패했을 수 있으므로 orderId 기준 보상 정리(프로덕션 트랜잭션 경로는 no-op)
    await compensateFailedCreate(orderId, req.user._id).catch(() => {});
    throw e;
  }

  // ── 트랜잭션 밖: 포트원 사전등록(HTTP) ──
  if (order.status === 'pending') {
    try {
      await ensurePrepared(order);
    } catch (e) {
      if (e instanceof portone.PortoneError) {
        // 확정 실패 → 주문을 닫고 혜택 원복(취소 트랜잭션은 Task 10의 finalizeCancelTxn)
        const { finalizeCancelTxn } = await import('../services/cancelService.js');
        await finalizeCancelTxn(order._id, ['pending'], { reason: '결제 사전등록 실패' }).catch(() => {});
        throw httpError(502, '결제 준비에 실패했습니다. 다시 시도해주세요.');
      }
      // 결과 불명 — preparing 유지. 같은 멱등키 재요청이 ensurePrepared를 재시도한다.
      throw httpError(502, '결제 준비 확인이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  return res.status(201).json(orderResponse(order));
}

// 멱등 재요청/경합 수렴 공통 응답
async function respondExistingOrder(res, existing, requestHash) {
  if (existing.requestHash && requestHash && existing.requestHash !== requestHash) {
    return res.status(409).json({ message: '같은 요청 키로 다른 내용의 주문이 진행 중입니다. 새로고침 후 다시 시도해주세요.' });
  }
  if (existing.status === 'cancelled') {
    return res.status(409).json({ message: '이전 주문 시도가 취소되었습니다. 다시 주문해주세요.', code: 'ORDER_CANCELLED' });
  }
  if (existing.status === 'pending' && existing.payment?.provider === 'portone') {
    try {
      await ensurePrepared(existing);
    } catch {
      return res.status(502).json({ message: '결제 준비 확인이 지연되고 있습니다. 잠시 후 다시 시도해주세요.' });
    }
  }
  return res.status(200).json(orderResponse(existing));
}

function orderResponse(order) {
  const needsPayment = order.status === 'pending' && order.payment?.provider === 'portone';
  return {
    order,
    checkout: needsPayment
      ? {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        amount: order.amounts.grandTotal,
        orderName: orderName(order),
      }
      : null,
  };
}

function orderName(order) {
  const first = order.items[0];
  const name = first?.nameKo || first?.name || '주문 상품';
  return order.items.length > 1 ? `${name} 외 ${order.items.length - 1}건` : name;
}

// standalone 폴백(비원자 실행)에서 생성 실패 시 orderId 기준 보상 정리. 로컬 개발 전용 안전망.
async function compensateFailedCreate(orderId, userId) {
  const created = await Order.exists({ _id: orderId });
  if (created) return; // 주문이 성립했으면 보상 불필요
  await UserCoupon.updateOne({ usedOrder: orderId }, { used: false, usedOrder: null, usedAt: null }).catch(() => {});
  const spend = await PointTransaction.findOne({ order: orderId, type: 'spend' });
  if (spend) {
    await applyPoints(userId, -spend.amount, 'refund', { note: '주문 생성 실패 환급' }).catch(() => {});
    await PointTransaction.deleteOne({ _id: spend._id }).catch(() => {});
  }
}
```

기존 createOrder 안에 있던 `refundReservedBenefits`·선점 소비 코드·`adjustSales(+1)`·`sendOrderPlaced` 블록은 전부 삭제한다(트랜잭션·outbox가 대체). `reverseOrderBenefits`는 Task 10에서 cancelService로 이동하니 이 태스크에서는 그대로 둔다.

주의: Task 10 전까지 `../services/cancelService.js`가 없으므로, 이 태스크에서는 prepare 확정 실패 경로의 dynamic import 대신 임시로 다음을 사용한다(Task 10에서 교체):

```js
        await Order.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'cancelled', 'payment.failReason': '결제 사전등록 실패' } });
        await reverseOrderBenefits(await Order.findById(order._id)).catch(() => {});
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && npx vitest run tests/createOrder.test.js`
Expected: PASS (6 tests). 첫 번째 테스트의 amount 기대값은 33000(상품 30000 + 배송비 3000)으로 작성돼 있는지 확인 — 주석과 코드가 다르면 코드를 33000으로 맞춘다.

- [ ] **Step 6: 전체 테스트 회귀 확인 후 Commit**

Run: `cd server && npm test`

```bash
git add server/src/controllers/orderController.js server/src/services/checkoutService.js server/tests/createOrder.test.js
git commit -m "feat(server): createOrder 재구성 — 생성 트랜잭션·pending 선주문·0원 분기·포트원 사전등록"
```

---

### Task 8: 결제 검증 서비스 (verifier — 결정표)

**Files:**
- Create: `server/src/services/paymentService.js`
- Test: `server/tests/paymentService.test.js`

**Interfaces:**
- Consumes: `portoneService`(vi.mock 대상), `withTransaction`, `enqueueEvents/buildPaidEvents`, `Order`
- Produces: `verifyAndCompletePayment(impUid, { requesterId = null } = {}): Promise<{ outcome, order|null }>`
  - outcome ∈ `'paid' | 'already_paid' | 'ready' | 'failed_cancelled' | 'external_cancelled' | 'late_refund_started' | 'duplicate_refunded' | 'review' | 'not_found' | 'noop'`
  - `requesterId` 전달 시(=/payments/complete 경로) 주문 소유자 불일치는 `httpError(403)` throw
  - `PortoneUnknownError`는 그대로 전파(호출부가 재시도 판단)
- 주의: 취소 트랜잭션·환불은 Task 10의 cancelService가 담당. 이 태스크에서는 verifier가 취소가 필요한 분기에서 **콜백 주입**(`onCancelPending`, `onLatePaid`)을 받도록 만들어 순환 의존을 피한다. Task 10에서 실제 구현을 주입한다.

**verifyAndCompletePayment 결정표(스펙 §5.3)** — 구현·테스트의 기준:

| 포트원 결과 / 로컬 상태 | outcome | 처리 |
|---|---|---|
| merchant_uid로 주문 없음 | not_found | 보안 로그만, 아무 변경 없음 |
| paid / pending, 금액·통화·cancel_amount 통과 | paid | 트랜잭션: CAS pending→paid + payment 필드 + outbox |
| paid / paid+, 동일 impUid | already_paid | 멱등 성공 |
| paid / paid+, 다른 impUid | duplicate_refunded | 새 결제 전액 자동환불 시도 + refund.status='review' |
| paid + cancel_amount>0 | review | refund.status='review', 자동 처리 금지 |
| paid / cancelled(로컬) | late_refund_started | onLatePaid 콜백(환불 saga) 기동 |
| 금액·통화 불일치 / pending | review | refund.status='review' + 보안 로그, **자동 취소 금지** |
| ready / pending | ready | 유지 |
| failed / pending | failed_cancelled | onCancelPending 콜백(취소+원복) |
| cancelled(전액) / pending·paid | external_cancelled | onCancelPending 콜백으로 로컬 수렴 |
| cancelled(전액) / shipped+ | review | refund.status='review' |

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/paymentService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { verifyAndCompletePayment, _setCancelHooks } from '../src/services/paymentService.js';
import Order from '../src/models/Order.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 100;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-3${seq}`,
    user: user._id,
    items: [{ price: 13000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 13000 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared' },
    ...over,
  });
}

function pmt(order, over = {}) {
  return {
    imp_uid: `imp_${seq}`, merchant_uid: order.orderNumber, status: 'paid',
    amount: 13000, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis',
    pay_method: 'card', paid_at: Math.floor(Date.now() / 1000), receipt_url: 'https://r', fail_reason: null,
    ...over,
  };
}

describe('verifyAndCompletePayment', () => {
  beforeEach(() => {
    portone.getPayment.mockReset();
    _setCancelHooks({ onCancelPending: vi.fn(async () => {}), onLatePaid: vi.fn(async () => {}) });
  });

  it('정상 paid — pending→paid 전환 + outbox 2건', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    const r = await verifyAndCompletePayment(p.imp_uid);
    expect(r.outcome).toBe('paid');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('paid');
    expect(saved.payment.impUid).toBe(p.imp_uid);
    expect(saved.payment.paidAt).toBeInstanceOf(Date);
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('멱등 — 이미 paid + 동일 impUid는 already_paid, outbox 중복 없음', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    await verifyAndCompletePayment(p.imp_uid);
    const r2 = await verifyAndCompletePayment(p.imp_uid);
    expect(r2.outcome).toBe('already_paid');
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('경합 — complete와 webhook 동시 검증에도 paid 1회·outbox 2건', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const p = pmt(order);
    portone.getPayment.mockResolvedValue(p);
    const [a, b] = await Promise.all([
      verifyAndCompletePayment(p.imp_uid),
      verifyAndCompletePayment(p.imp_uid),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['already_paid', 'paid']);
    expect(await OrderEvent.countDocuments({ order: order._id })).toBe(2);
  });

  it('금액 불일치 — review 마킹, 취소 API 호출 금지', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(order, { amount: 999999 }));
    const r = await verifyAndCompletePayment('imp_bad');
    expect(r.outcome).toBe('review');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('pending'); // 자동 취소 없음
    expect(saved.payment.refund.status).toBe('review');
    expect(portone.cancel).not.toHaveBeenCalled();
  });

  it('소유자 불일치 — 403', async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const order = await makeOrder(owner);
    portone.getPayment.mockResolvedValue(pmt(order));
    await expect(
      verifyAndCompletePayment('imp_x', { requesterId: attacker._id }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await Order.findById(order._id)).status).toBe('pending');
  });

  it('주문 없음(남의 merchant_uid 아님) — not_found, 취소 호출 금지', async () => {
    portone.getPayment.mockResolvedValue({ imp_uid: 'imp_z', merchant_uid: 'unknown-uid', status: 'paid', amount: 1, cancel_amount: 0, currency: 'KRW' });
    const r = await verifyAndCompletePayment('imp_z');
    expect(r.outcome).toBe('not_found');
    expect(portone.cancel).not.toHaveBeenCalled();
  });

  it('중복 결제 — 이미 paid인 주문에 다른 impUid면 새 결제 환불 + review', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'paid', payment: { provider: 'portone', impUid: 'imp_first' } });
    portone.getPayment.mockResolvedValue(pmt(order, { imp_uid: 'imp_second' }));
    portone.cancel.mockResolvedValue({ status: 'cancelled' });
    const r = await verifyAndCompletePayment('imp_second');
    expect(r.outcome).toBe('duplicate_refunded');
    expect(portone.cancel).toHaveBeenCalledWith(expect.objectContaining({ impUid: 'imp_second' }));
    expect((await Order.findById(order._id)).payment.refund.status).toBe('review');
    expect((await Order.findById(order._id)).payment.impUid).toBe('imp_first'); // 원 결제 유지
  });

  it('failed / cancelled(전액) / ready 분기', async () => {
    const user = await createTestUser();
    const o1 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o1, { status: 'failed', fail_reason: '한도초과' }));
    expect((await verifyAndCompletePayment('imp_f')).outcome).toBe('failed_cancelled');

    const o2 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o2, { status: 'cancelled', cancel_amount: 13000 }));
    expect((await verifyAndCompletePayment('imp_c')).outcome).toBe('external_cancelled');

    const o3 = await makeOrder(user);
    portone.getPayment.mockResolvedValue(pmt(o3, { status: 'ready' }));
    expect((await verifyAndCompletePayment('imp_r')).outcome).toBe('ready');
    expect((await Order.findById(o3._id)).status).toBe('pending');
  });

  it('로컬 cancelled + 늦은 paid — onLatePaid 기동', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'cancelled' });
    const onLatePaid = vi.fn(async () => {});
    _setCancelHooks({ onCancelPending: vi.fn(), onLatePaid });
    portone.getPayment.mockResolvedValue(pmt(order));
    const r = await verifyAndCompletePayment('imp_late');
    expect(r.outcome).toBe('late_refund_started');
    expect(onLatePaid).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/paymentService.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/services/paymentService.js`:

```js
import Order from '../models/Order.js';
import * as portone from './portoneService.js';
import { withTransaction } from '../utils/withTransaction.js';
import { httpError } from '../utils/httpError.js';
import { enqueueEvents, buildPaidEvents } from './orderEventService.js';
import User from '../models/User.js';

// 취소·환불 처리 콜백 — cancelService(Task 10)가 주입한다(순환 의존 회피).
// 주입 전 기본값은 no-op(테스트에서 _setCancelHooks로 대체).
let hooks = {
  onCancelPending: async (order, reason) => {
    console.warn('[paymentService] onCancelPending 미주입:', order.orderNumber, reason);
  },
  onLatePaid: async (order, pmt) => {
    console.warn('[paymentService] onLatePaid 미주입:', order.orderNumber, pmt.imp_uid);
  },
};

export function _setCancelHooks(next) {
  hooks = { ...hooks, ...next };
}

function securityLog(...args) {
  console.error('[SECURITY][payments]', ...args);
}

async function markReview(orderId, reason) {
  await Order.updateOne(
    { _id: orderId },
    { $set: { 'payment.refund.status': 'review', 'payment.refund.reason': reason, 'payment.refund.requestedAt': new Date() } },
  );
}

// 포트원 결제 검증·확정. 클라이언트가 준 merchant_uid는 신뢰하지 않고
// 포트원 응답의 merchant_uid로만 주문을 식별한다(스펙 §5.2 — 타 결제 imp_uid 공격 차단).
export async function verifyAndCompletePayment(impUid, { requesterId = null } = {}) {
  const pmt = await portone.getPayment(impUid); // PortoneError → 호출부에서 not_found 매핑 어려우니 여기서 처리
  return applyVerified(pmt, { requesterId });
}

async function applyVerified(pmt, { requesterId }) {
  const order = await Order.findOne({ orderNumber: pmt.merchant_uid });
  if (!order) {
    securityLog('merchant_uid 매칭 주문 없음 — 변경·취소 없이 무시:', pmt.merchant_uid, pmt.imp_uid);
    return { outcome: 'not_found', order: null };
  }
  if (requesterId && String(order.user) !== String(requesterId)) {
    securityLog('주문 소유자 불일치:', order.orderNumber, '요청자', String(requesterId));
    throw httpError(403, '접근 권한이 없습니다.');
  }
  if (order.payment?.provider !== 'portone') {
    securityLog('포트원 주문 아님:', order.orderNumber);
    return { outcome: 'noop', order };
  }

  switch (pmt.status) {
    case 'ready':
      return { outcome: 'ready', order };
    case 'failed': {
      if (order.status === 'pending') {
        await hooks.onCancelPending(order, pmt.fail_reason || '결제 실패');
        return { outcome: 'failed_cancelled', order };
      }
      return { outcome: 'noop', order };
    }
    case 'cancelled': {
      const fullyCancelled = (pmt.cancel_amount || 0) >= pmt.amount;
      if (!fullyCancelled) {
        await markReview(order._id, '부분취소 감지(외부)');
        return { outcome: 'review', order };
      }
      if (['pending', 'paid'].includes(order.status)) {
        await hooks.onCancelPending(order, '포트원측 결제 취소');
        return { outcome: 'external_cancelled', order };
      }
      if (['shipped', 'delivered', 'preparing'].includes(order.status)) {
        await markReview(order._id, '배송 진행 중 외부취소 감지');
        return { outcome: 'review', order };
      }
      return { outcome: 'noop', order };
    }
    case 'paid':
      return applyPaid(pmt, order);
    default:
      return { outcome: 'noop', order };
  }
}

async function applyPaid(pmt, order) {
  // 늦은 승인: 주문은 이미 취소(혜택 원복 완료) — 자동 전액환불 경로로
  if (order.status === 'cancelled') {
    await hooks.onLatePaid(order, pmt);
    return { outcome: 'late_refund_started', order };
  }

  // 검증: 금액·통화·부분취소 없음
  if ((pmt.cancel_amount || 0) > 0) {
    await markReview(order._id, '부분취소 상태의 결제 감지');
    return { outcome: 'review', order };
  }
  if (pmt.amount !== order.amounts.grandTotal || pmt.currency !== 'KRW') {
    securityLog('금액/통화 불일치:', order.orderNumber, pmt.imp_uid, pmt.amount, pmt.currency);
    await markReview(order._id, `금액 불일치(결제 ${pmt.amount}, 주문 ${order.amounts.grandTotal})`);
    return { outcome: 'review', order };
  }

  if (order.status === 'pending') {
    try {
      const updated = await withTransaction(async (session) => {
        const u = await Order.findOneAndUpdate(
          { _id: order._id, status: 'pending' },
          {
            $set: {
              status: 'paid',
              paymentMethod: 'card',
              'payment.impUid': pmt.imp_uid,
              'payment.pg': pmt.pg_provider || '',
              'payment.method': pmt.pay_method || 'card',
              'payment.paidAt': pmt.paid_at ? new Date(pmt.paid_at * 1000) : new Date(),
              'payment.receiptUrl': pmt.receipt_url || '',
            },
          },
          { new: true, session },
        );
        if (!u) return null; // CAS 패배 — 아래에서 재판정
        const user = await User.findById(u.user).select('name email');
        await enqueueEvents(u._id, buildPaidEvents(u, user), session);
        return u;
      });
      if (updated) return { outcome: 'paid', order: updated };
    } catch (e) {
      // impUid partial unique 위반 = 같은 결제가 다른 주문에 이미 매핑 — 사고 상태
      if (e.code === 11000) {
        securityLog('impUid 중복 매핑 시도:', pmt.imp_uid, order.orderNumber);
        await markReview(order._id, '결제 imp_uid가 다른 주문에 매핑됨');
        return { outcome: 'review', order };
      }
      throw e;
    }
    // CAS 패배 → 최신 상태로 재판정(경합 상대가 paid 완료했을 가능성)
    const fresh = await Order.findById(order._id);
    return applyPaid(pmt, fresh);
  }

  // paid 이후 상태
  if (order.payment?.impUid === pmt.imp_uid) {
    return { outcome: 'already_paid', order };
  }
  // 같은 주문에 두 번째 결제(다른 impUid) — 새 결제를 전액 자동환불 시도 + 사고 마킹
  securityLog('중복 결제 감지:', order.orderNumber, '기존', order.payment?.impUid, '신규', pmt.imp_uid);
  try {
    await portone.cancel({ impUid: pmt.imp_uid, amount: pmt.amount, checksum: pmt.amount, reason: '중복 결제 자동 환불' });
  } catch (e) {
    securityLog('중복 결제 자동환불 실패 — 수동 처리 필요:', pmt.imp_uid, e?.message);
  }
  await markReview(order._id, `중복 결제(${pmt.imp_uid}) 자동환불 시도`);
  return { outcome: 'duplicate_refunded', order };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run tests/paymentService.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/paymentService.js server/tests/paymentService.test.js
git commit -m "feat(server): 결제 검증 서비스 — merchant_uid 결합·결정표·CAS 확정·중복결제 자동환불"
```

---

### Task 9: /payments 라우트 (complete + webhook) + app 배선

**Files:**
- Create: `server/src/controllers/paymentController.js`
- Create: `server/src/routes/payments.js`
- Modify: `server/src/app.js`
- Test: `server/tests/paymentRoutes.test.js`

**Interfaces:**
- Consumes: `verifyAndCompletePayment`(Task 8), `WebhookLog`, `rateLimit`, `requireAuth`
- Produces:
  - `POST /payments/complete` (requireAuth): body `{ impUid }` → 200 `{ order, outcome }` | 202(ready) | 400(failed) | 404(not_found) | 409(review 계열) | 503(포트원 미설정)
  - `POST /payments/webhook` (무인증): 정상·정상중복·영구무효 → 200, 일시 장애 → 500(포트원 재전송 유도)
  - 클라이언트(Task 13~15)는 이 응답 계약을 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/paymentRoutes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, isConfigured: () => true, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import WebhookLog from '../src/models/WebhookLog.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 500;

async function makePending(user) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-4${seq}`, user: user._id,
    items: [{ price: 13000, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 13000 },
    status: 'pending', payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared' },
  });
}

function paidPmt(order, impUid = `imp_${seq}`) {
  return { imp_uid: impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 13000, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis', pay_method: 'card', paid_at: 1752700000, receipt_url: '' };
}

describe('POST /payments/complete', () => {
  beforeEach(() => portone.getPayment.mockReset());

  it('정상 완료 — 200 + paid 주문', async () => {
    const user = await createTestUser();
    const order = await makePending(user);
    portone.getPayment.mockResolvedValue(paidPmt(order));
    const res = await request(app).post('/payments/complete').set(authHeader(user)).send({ impUid: paidPmt(order).imp_uid });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('paid');
  });

  it('impUid 형식 오류 — 400, 포트원 호출 없음', async () => {
    const user = await createTestUser();
    const res = await request(app).post('/payments/complete').set(authHeader(user)).send({ impUid: '$where:1' });
    expect(res.status).toBe(400);
    expect(portone.getPayment).not.toHaveBeenCalled();
  });

  it('타인 결제 — 403', async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const order = await makePending(owner);
    portone.getPayment.mockResolvedValue(paidPmt(order));
    const res = await request(app).post('/payments/complete').set(authHeader(attacker)).send({ impUid: 'imp_4501' });
    expect(res.status).toBe(403);
  });

  it('미로그인 — 401', async () => {
    const res = await request(app).post('/payments/complete').send({ impUid: 'imp_1' });
    expect(res.status).toBe(401);
  });
});

describe('POST /payments/webhook', () => {
  beforeEach(() => portone.getPayment.mockReset());

  it('정상 처리 — 200 + WebhookLog processed', async () => {
    const user = await createTestUser();
    const order = await makePending(user);
    const p = paidPmt(order);
    portone.getPayment.mockResolvedValue(p);
    const res = await request(app).post('/payments/webhook').send({ imp_uid: p.imp_uid, merchant_uid: order.orderNumber, status: 'paid' });
    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe('paid');
    const log = await WebhookLog.findOne({ impUid: p.imp_uid });
    expect(log.result).toBe('processed');
  });

  it('형식 불량 imp_uid — 200(무시), 포트원 호출 없음', async () => {
    const res = await request(app).post('/payments/webhook').send({ imp_uid: { $gt: '' } });
    expect(res.status).toBe(200);
    expect(portone.getPayment).not.toHaveBeenCalled();
  });

  it('포트원 결과 불명(타임아웃) — 500으로 재전송 유도', async () => {
    const { PortoneUnknownError } = await vi.importActual('../src/services/portoneService.js');
    portone.getPayment.mockRejectedValue(new PortoneUnknownError('타임아웃'));
    const res = await request(app).post('/payments/webhook').send({ imp_uid: 'imp_99999999' });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/paymentRoutes.test.js`
Expected: FAIL — /payments 라우트 없음(404).

- [ ] **Step 3: 컨트롤러 구현**

`server/src/controllers/paymentController.js`:

```js
import WebhookLog from '../models/WebhookLog.js';
import { verifyAndCompletePayment } from '../services/paymentService.js';
import * as portone from '../services/portoneService.js';

// imp_uid 형식 화이트리스트 — 웹훅/complete body를 Mongo·포트원에 넘기기 전 차단
const IMP_UID_RE = /^imps?_[0-9A-Za-z_-]{4,40}$/;

function outcomeToHttp(res, r) {
  switch (r.outcome) {
    case 'paid':
    case 'already_paid':
      return res.json({ order: r.order, outcome: r.outcome });
    case 'ready':
      return res.status(202).json({ outcome: r.outcome, message: '결제가 아직 완료되지 않았습니다. 잠시 후 다시 확인해주세요.' });
    case 'failed_cancelled':
      return res.status(400).json({ outcome: r.outcome, message: '결제에 실패해 주문이 취소되었습니다.', order: r.order });
    case 'external_cancelled':
      return res.status(400).json({ outcome: r.outcome, message: '결제가 취소되어 주문이 취소되었습니다.', order: r.order });
    case 'not_found':
      return res.status(404).json({ outcome: r.outcome, message: '결제에 해당하는 주문을 찾을 수 없습니다.' });
    default: // review, duplicate_refunded, late_refund_started, noop
      return res.status(409).json({ outcome: r.outcome, message: '결제 확인이 필요합니다. 고객센터(관리자)에 문의해주세요.' });
  }
}

// POST /payments/complete (requireAuth) — 결제창 콜백/모바일 리다이렉트의 서버 검증 진입점
export async function completePayment(req, res) {
  if (!portone.isConfigured()) {
    return res.status(503).json({ message: '결제 모듈이 설정되지 않았습니다.' });
  }
  const impUid = typeof req.body?.impUid === 'string' ? req.body.impUid.trim() : '';
  if (!IMP_UID_RE.test(impUid)) {
    return res.status(400).json({ message: '잘못된 결제 식별자입니다.' });
  }
  const r = await verifyAndCompletePayment(impUid, { requesterId: req.user._id });
  return outcomeToHttp(res, r);
}

// POST /payments/webhook (무인증) — v1 웹훅은 서명이 없으므로 body를 신뢰하지 않고
// imp_uid로 포트원 API 재조회 검증만 한다. 일시 장애는 500으로 재전송을 살린다.
export async function portoneWebhook(req, res) {
  const impUid = typeof req.body?.imp_uid === 'string' ? req.body.imp_uid.trim() : '';
  if (!IMP_UID_RE.test(impUid)) {
    return res.status(200).json({ ok: true, ignored: true }); // 영구 무효 — 재전송 불필요
  }
  let log = null;
  try {
    log = await WebhookLog.create({
      impUid,
      merchantUid: typeof req.body?.merchant_uid === 'string' ? req.body.merchant_uid.slice(0, 64) : '',
      rawStatus: typeof req.body?.status === 'string' ? req.body.status.slice(0, 32) : '',
    });
  } catch { /* 감사 로그 실패는 처리 지속 */ }

  const setLog = (result, note) =>
    log && WebhookLog.updateOne({ _id: log._id }, { $set: { result, note: String(note || '').slice(0, 200) } }).catch(() => {});

  try {
    const r = await verifyAndCompletePayment(impUid);
    await setLog('processed', r.outcome);
    return res.status(200).json({ ok: true, outcome: r.outcome });
  } catch (e) {
    if (e instanceof portone.PortoneError) {
      // 포트원이 명시 거절(존재하지 않는 imp_uid 등) — 영구 무효, 재전송 불필요
      await setLog('ignored', e.message);
      return res.status(200).json({ ok: true, ignored: true });
    }
    // PortoneUnknownError·DB 오류 — 일시 장애로 보고 재전송 유도
    await setLog('error', e?.message);
    return res.status(500).json({ ok: false });
  }
}
```

- [ ] **Step 4: 라우트 + app 배선**

`server/src/routes/payments.js`:

```js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as paymentController from '../controllers/paymentController.js';

const router = Router();

router.post(
  '/complete',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20, key: (req) => String(req.user?._id || req.ip), message: '결제 확인 요청이 너무 많습니다.' }),
  asyncHandler(paymentController.completePayment),
);

// 포트원 서버가 호출 — 무인증(검증은 API 재조회로). IP 기준 제한.
router.post(
  '/webhook',
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(paymentController.portoneWebhook),
);

export default router;
```

`server/src/app.js`: import 목록에 `import paymentsRouter from './routes/payments.js';` 추가, `app.use('/orders', ordersRouter);` 아래에 `app.use('/payments', paymentsRouter);` 추가.

`POST /orders`에도 rate limit 추가 — `server/src/routes/orders.js`의 create 라인을 다음으로 교체:

```js
import { rateLimit } from '../middleware/rateLimit.js';
// ...
router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10, key: (req) => String(req.user?._id || req.ip), message: '주문 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }),
  asyncHandler(orderController.createOrder),
);
```

- [ ] **Step 5: 테스트 통과 확인 + 회귀**

Run: `cd server && npm test`
Expected: PASS 전체. (rateLimit 때문에 반복 테스트가 429 나면 테스트별 사용자 분리로 회피 — createTestUser가 매번 새 사용자라 기본으로 안전.)

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/paymentController.js server/src/routes/payments.js server/src/app.js server/src/routes/orders.js server/tests/paymentRoutes.test.js
git commit -m "feat(server): /payments/complete·webhook 라우트 + rate limit 배선"
```

---

### Task 10: 취소·환불 saga (cancelService) + 컨트롤러 재배선

**Files:**
- Create: `server/src/services/cancelService.js`
- Modify: `server/src/controllers/orderController.js` (cancelOrder·updateOrderStatus·reverseOrderBenefits 이동, prepare 실패 경로 교체)
- Modify: `server/src/server.js` (hook 주입은 Task 11에서 — 여기서는 cancelService가 paymentService에 직접 주입)
- Test: `server/tests/cancelService.test.js`

**Interfaces:**
- Consumes: `withTransaction`, `applyPoints(session)`, `enqueueEvents/buildCancelEvents`, `portone.findPayment/getPayment/cancel`, `verifyAndCompletePayment`, `_setCancelHooks`
- Produces:
  - `finalizeCancelTxn(orderId, fromStatuses, { reason, refund }) → Promise<Order|null>` — 취소 트랜잭션(CAS + 혜택 원복 + cancel outbox). null = CAS 패배.
  - `cancelOrderSaga(orderId, { actor, reason }) → Promise<{ outcome, order }>`
    - outcome ∈ `'cancelled' | 'already_cancelled' | 'became_paid' | 'payment_in_progress' | 'refund_pending' | 'review' | 'not_cancellable'`
  - `reverseOrderBenefits(order, session)` — orderController에서 이동(세션 지원)
  - 모듈 로드 시 `_setCancelHooks({ onCancelPending, onLatePaid })` 주입 완료
- 컨트롤러 계약(클라이언트 Task 14~16이 사용):
  - `POST /orders/:id/cancel` → 200(주문 반환: cancelled 또는 became_paid면 paid 주문) | 202(refund_pending) | 400(not_cancellable/이미취소) | 409(payment_in_progress/review)
  - `PATCH /orders/:id/status` — `pending→paid` 금지, `→cancelled`는 saga 경유, refund 잠금 중 409

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/cancelService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { cancelOrderSaga, finalizeCancelTxn } from '../src/services/cancelService.js';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';
import UserCoupon from '../src/models/UserCoupon.js';
import Coupon from '../src/models/Coupon.js';
import PointTransaction from '../src/models/PointTransaction.js';
import OrderEvent from '../src/models/OrderEvent.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 700;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-5${seq}`, user: user._id,
    items: [{ price: 13000, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 500, grandTotal: 12500 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared' },
    ...over,
  });
}

describe('cancelOrderSaga — pending(A 경로)', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  it('결제 없음 — 취소 + 포인트 원복 + cancel outbox', async () => {
    const user = await createTestUser({ points: 0 });
    const order = await makeOrder(user);
    // 주문 시 500P 사용된 상태를 재현
    await PointTransaction.create({ user: user._id, amount: -500, type: 'spend', order: order._id, balanceAfter: 0 });
    portone.findPayment.mockResolvedValue(null);
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    expect(r.order.status).toBe('cancelled');
    expect((await User.findById(user._id)).points).toBe(500); // 환급
    expect(await OrderEvent.countDocuments({ order: order._id, type: 'cancel_sales_dec' })).toBe(1);
  });

  it('늦은 결제 발견 — 취소 대신 paid 확정(became_paid)', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const pmt = { imp_uid: 'imp_late1', merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis', pay_method: 'card', paid_at: 1752700000, receipt_url: '' };
    portone.findPayment.mockResolvedValue(pmt);
    portone.getPayment.mockResolvedValue(pmt);
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('became_paid');
    expect((await Order.findById(order._id)).status).toBe('paid');
  });

  it('결제 진행 중(ready) — 409용 payment_in_progress', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.findPayment.mockResolvedValue({ status: 'ready', imp_uid: 'imp_r', merchant_uid: order.orderNumber, amount: 12500, cancel_amount: 0 });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('payment_in_progress');
    expect((await Order.findById(order._id)).status).toBe('pending');
  });
});

describe('cancelOrderSaga — paid(B 경로)', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  async function makePaid(user, over = {}) {
    return makeOrder(user, { status: 'paid', payment: { provider: 'portone', method: 'card', impUid: `imp_p${seq}`, paidAt: new Date(), refund: { status: 'none' } }, ...over });
  }

  it('전액 환불 성공 — cancelled + refund done', async () => {
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockResolvedValue({ status: 'cancelled', cancel_amount: 12500 });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('cancelled');
    expect(saved.payment.refund.status).toBe('done');
    expect(portone.cancel).toHaveBeenCalledWith(expect.objectContaining({ impUid: order.payment.impUid, amount: 12500, checksum: 12500 }));
  });

  it('환불 결과 불명(타임아웃) — 주문 상태 유지 + refund processing', async () => {
    const { PortoneUnknownError } = await vi.importActual('../src/services/portoneService.js');
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockRejectedValue(new PortoneUnknownError('타임아웃'));
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('refund_pending');
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('paid'); // 취소 확정 금지
    expect(saved.payment.refund.status).toBe('processing');
  });

  it('동시 취소 요청 — 한 요청만 진행(락 CAS)', async () => {
    const user = await createTestUser();
    const order = await makePaid(user);
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'paid', amount: 12500, cancel_amount: 0, currency: 'KRW' });
    portone.cancel.mockResolvedValue({ status: 'cancelled', cancel_amount: 12500 });
    const [a, b] = await Promise.all([
      cancelOrderSaga(order._id, { actor: 'user' }),
      cancelOrderSaga(order._id, { actor: 'admin' }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toContain('cancelled');
    expect(portone.cancel).toHaveBeenCalledTimes(1);
  });

  it('레거시 mock 주문(provider 없음) — PG 호출 없이 로컬 취소', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'paid', paymentMethod: 'mock', payment: undefined });
    const r = await cancelOrderSaga(order._id, { actor: 'user' });
    expect(r.outcome).toBe('cancelled');
    expect(portone.cancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/cancelService.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: cancelService 구현**

`server/src/services/cancelService.js`:

```js
import Order from '../models/Order.js';
import UserCoupon from '../models/UserCoupon.js';
import PointTransaction from '../models/PointTransaction.js';
import { applyPoints } from './pointService.js';
import { withTransaction } from '../utils/withTransaction.js';
import { enqueueEvents, buildCancelEvents } from './orderEventService.js';
import * as portone from './portoneService.js';
import { verifyAndCompletePayment, _setCancelHooks } from './paymentService.js';

// 취소 시 혜택 원복 — 쿠폰 복구 + 적립금(사용분 환급·적립분 회수). orderController에서 이동.
// 멱등(원장 존재 시 재실행 안 함). 세션 전달 시 취소 트랜잭션에 참여.
export async function reverseOrderBenefits(order, session = null) {
  if (order.benefitsReversed) return;
  const userId = order.user?._id || order.user;
  const sess = session || undefined;

  if (order.coupon?.code) {
    await UserCoupon.updateOne(
      { usedOrder: order._id },
      { used: false, usedOrder: null, usedAt: null },
      { session: sess },
    );
  }
  const pointsUsed = order.amounts?.pointsUsed || 0;
  if (pointsUsed > 0 && !(await PointTransaction.exists({ order: order._id, type: 'refund' }).session(sess || null))) {
    await applyPoints(userId, pointsUsed, 'refund', { order: order._id, note: `주문 ${order.orderNumber} 취소 환급`, session });
  }
  const earnTxns = await PointTransaction.find({ order: order._id, type: 'earn' }).select('amount').session(sess || null);
  const actualEarned = earnTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
  if (actualEarned > 0 && !(await PointTransaction.exists({ order: order._id, type: 'reclaim' }).session(sess || null))) {
    await applyPoints(userId, -actualEarned, 'reclaim', { order: order._id, note: `주문 ${order.orderNumber} 취소 적립회수`, session });
  }
  await Order.updateOne({ _id: order._id }, { $set: { benefitsReversed: true } }, { session: sess });
}

// 취소 확정 트랜잭션: CAS 상태 전이 + 혜택 원복 + cancel outbox. null = CAS 패배.
export async function finalizeCancelTxn(orderId, fromStatuses, { reason = '', refund = null } = {}) {
  return withTransaction(async (session) => {
    const set = { status: 'cancelled' };
    if (reason) set['payment.failReason'] = reason;
    if (refund) {
      set['payment.refund.status'] = refund.status;
      set['payment.refund.completedAt'] = refund.completedAt || new Date();
      set['payment.refund.cancelAmount'] = refund.cancelAmount || 0;
      if (reason) set['payment.refund.reason'] = reason;
    }
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: fromStatuses } },
      { $set: set },
      { new: true, session },
    );
    if (!order) return null;
    await reverseOrderBenefits(order, session);
    await enqueueEvents(order._id, buildCancelEvents(order), session);
    return order;
  });
}

// 모든 취소 경로의 단일 진입점.
// pending(A): 포트원 선조회로 "청구됐는데 주문만 취소" 경합 차단.
// paid+(B): refund 락 → 포트원 전액취소 확인 후에만 로컬 cancelled.
export async function cancelOrderSaga(orderId, { actor = 'user', reason = '' } = {}) {
  const order = await Order.findById(orderId);
  if (!order) return { outcome: 'not_cancellable', order: null };

  if (order.status === 'cancelled') {
    if (!order.benefitsReversed) await reverseOrderBenefits(order).catch((e) => console.error('[cancel] 원복 재시도 실패:', order.orderNumber, e?.message));
    return { outcome: 'already_cancelled', order: await Order.findById(orderId) };
  }

  const isPortone = order.payment?.provider === 'portone';

  if (order.status === 'pending') {
    if (isPortone) {
      const pmt = await portone.findPayment(order.orderNumber);
      if (pmt && pmt.status === 'paid') {
        // 승인은 됐는데 콜백이 아직 — 취소 대신 결제 확정으로 수렴
        await verifyAndCompletePayment(pmt.imp_uid);
        return { outcome: 'became_paid', order: await Order.findById(orderId) };
      }
      if (pmt && pmt.status === 'ready') {
        return { outcome: 'payment_in_progress', order };
      }
    }
    const cancelled = await finalizeCancelTxn(orderId, ['pending'], { reason: reason || '미결제 취소' });
    if (!cancelled) return cancelOrderSaga(orderId, { actor, reason }); // 경합 — 최신 상태로 재판정
    return { outcome: 'cancelled', order: cancelled };
  }

  if (!['paid', 'preparing'].includes(order.status)) {
    return { outcome: 'not_cancellable', order };
  }

  // 실결제 없는 주문(0원·레거시 mock) — PG 없이 로컬 취소
  if (!isPortone || !order.payment?.impUid) {
    const cancelled = await finalizeCancelTxn(orderId, ['paid', 'preparing'], {
      reason, refund: isPortone ? null : undefined,
    });
    if (!cancelled) return { outcome: 'not_cancellable', order: await Order.findById(orderId) };
    return { outcome: 'cancelled', order: cancelled };
  }

  // ── B 경로: refund 락(단일 승자) ──
  const locked = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: { $in: ['paid', 'preparing'] },
      $or: [{ 'payment.refund.status': 'none' }, { 'payment.refund.status': null }],
    },
    { $set: { 'payment.refund.status': 'requested', 'payment.refund.requestedAt': new Date(), 'payment.refund.reason': reason || `${actor} 취소` } },
    { new: true },
  );
  if (!locked) return { outcome: 'payment_in_progress', order: await Order.findById(orderId) };

  return executeRefund(locked);
}

// refund 락을 쥔 주문의 전액환불 실행. reconciler(Task 11)도 processing 주문에 재사용.
export async function executeRefund(order) {
  let pmt;
  try {
    pmt = await portone.getPayment(order.payment.impUid);
  } catch (e) {
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'processing' } });
    return { outcome: 'refund_pending', order: await Order.findById(order._id) };
  }

  const remaining = (pmt.amount || 0) - (pmt.cancel_amount || 0);
  if (pmt.status === 'cancelled' || remaining <= 0) {
    // 이미 전액 취소돼 있음(외부/이전 시도 성공) — 로컬 수렴만
    const cancelled = await finalizeCancelTxn(order._id, ['paid', 'preparing'], {
      reason: order.payment.refund?.reason || '환불 완료',
      refund: { status: 'done', cancelAmount: pmt.cancel_amount || pmt.amount },
    });
    return { outcome: 'cancelled', order: cancelled || (await Order.findById(order._id)) };
  }

  try {
    const result = await portone.cancel({
      impUid: order.payment.impUid,
      amount: remaining,
      checksum: remaining,
      reason: order.payment.refund?.reason || '주문 취소',
    });
    const cancelled = await finalizeCancelTxn(order._id, ['paid', 'preparing'], {
      reason: order.payment.refund?.reason || '주문 취소',
      refund: { status: 'done', cancelAmount: result?.cancel_amount || remaining },
    });
    return { outcome: 'cancelled', order: cancelled || (await Order.findById(order._id)) };
  } catch (e) {
    if (e instanceof portone.PortoneUnknownError) {
      // 결과 불명 — 상태 변경 금지, reconciler가 재조회로 수렴
      await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'processing' } });
      return { outcome: 'refund_pending', order: await Order.findById(order._id) };
    }
    // 확정 거절 — 사고 상태로 격리(수동 처리)
    console.error('[cancel] 포트원 환불 거절:', order.orderNumber, e?.message);
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'review', 'payment.refund.reason': `환불 실패: ${String(e?.message || '').slice(0, 100)}` } });
    return { outcome: 'review', order: await Order.findById(order._id) };
  }
}

// paymentService의 취소 콜백 주입(순환 의존 회피 지점)
_setCancelHooks({
  // 미결제/실패/외부취소 pending 주문 정리
  onCancelPending: async (order, reason) => {
    await finalizeCancelTxn(order._id, ['pending', 'paid'], { reason });
  },
  // 로컬 취소 후 늦은 승인 발견 — 자동 전액환불 기동
  onLatePaid: async (order, pmt) => {
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.impUid': pmt.imp_uid, 'payment.refund.status': 'processing', 'payment.refund.reason': '취소 후 늦은 승인 자동환불', 'payment.refund.requestedAt': new Date() } },
    );
    const fresh = await Order.findById(order._id);
    try {
      await portone.cancel({ impUid: pmt.imp_uid, amount: pmt.amount, checksum: pmt.amount, reason: '주문 취소 후 승인된 결제 자동환불' });
      await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'done', 'payment.refund.completedAt': new Date(), 'payment.refund.cancelAmount': pmt.amount } });
    } catch (e) {
      if (!(e instanceof portone.PortoneUnknownError)) {
        await Order.updateOne({ _id: order._id }, { $set: { 'payment.refund.status': 'review' } });
      }
      // Unknown이면 processing 유지 — reconciler가 수렴
    }
  },
});
```

주의: `PointTransaction.exists(...).session()`이 없는 mongoose 버전 문법 오류가 나면 `PointTransaction.findOne({...}).session(sess || null).lean()`으로 존재 확인으로 바꾼다.

- [ ] **Step 4: orderController 재배선**

`server/src/controllers/orderController.js`:

1. `reverseOrderBenefits` 함수 정의 삭제, `import { cancelOrderSaga, reverseOrderBenefits, finalizeCancelTxn } from '../services/cancelService.js';` 추가.
2. Task 7의 임시 prepare 실패 경로를 `finalizeCancelTxn(order._id, ['pending'], { reason: '결제 사전등록 실패' })` 호출로 교체.
3. `cancelOrder`를 다음으로 교체:

```js
// 주문 취소 — POST /orders/:id/cancel (본인/admin). 모든 취소는 saga 경유.
export async function cancelOrder(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (String(order.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  const r = await cancelOrderSaga(order._id, { actor: req.user.role === 'admin' ? 'admin' : 'user' });
  switch (r.outcome) {
    case 'cancelled':
      return res.json(r.order);
    case 'became_paid':
      return res.json(r.order); // 클라이언트는 status==='paid'로 구분
    case 'already_cancelled':
      if (r.order?.benefitsReversed) return res.status(400).json({ message: '이미 취소된 주문입니다.' });
      return res.json(r.order);
    case 'payment_in_progress':
      return res.status(409).json({ message: '결제 확인이 진행 중입니다. 잠시 후 다시 시도해주세요.' });
    case 'refund_pending':
      return res.status(202).json({ message: '환불이 접수되었습니다. 처리 완료까지 잠시 걸릴 수 있습니다.', order: r.order });
    case 'review':
      return res.status(409).json({ message: '환불 처리에 확인이 필요합니다. 관리자에게 문의해주세요.' });
    default:
      return res.status(400).json({ message: '이미 배송이 진행되어 취소할 수 없습니다.' });
  }
}
```

4. `updateOrderStatus` 수정:
   - `TRANSITIONS`의 pending 라인을 `pending: ['cancelled'],`로 교체(관리자 수동 paid 금지 — 결제 verifier만 paid 전환).
   - 함수 초입 order 조회 직후에 refund 잠금 가드 추가:

```js
  const refundStatus = order.payment?.refund?.status;
  if (['requested', 'processing', 'review'].includes(refundStatus)) {
    return res.status(409).json({ message: '환불 처리 중인 주문입니다. 완료 후 다시 시도해주세요.' });
  }
```

   - `next === 'cancelled'`이면 CAS·willCancel 블록 대신 saga로 위임(함수 상단, allowed 체크 통과 직후):

```js
  if (next === 'cancelled') {
    const r = await cancelOrderSaga(order._id, { actor: 'admin', reason: '관리자 취소' });
    if (['cancelled', 'already_cancelled'].includes(r.outcome)) {
      const populated = await Order.findById(order._id).populate('user', 'name email');
      return res.json(populated);
    }
    if (r.outcome === 'refund_pending') return res.status(202).json({ message: '환불 접수됨 — 처리 완료 후 자동 취소됩니다.', order: r.order });
    return res.status(409).json({ message: '취소를 완료하지 못했습니다. 환불 상태를 확인해주세요.' });
  }
```

   - 기존 `willCancel` 관련 코드(선언·adjustSales(-1)·reverseOrderBenefits 블록) 삭제. cancelled 안내 메일은 saga의 cancel outbox가 담당하므로 `['shipped','delivered']`만 인라인 발송으로 남긴다(`['shipped', 'delivered', 'cancelled']` → `['shipped', 'delivered']`).

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `cd server && npm test`
Expected: PASS 전체 (cancelService 8개 포함). Task 8 테스트의 `_setCancelHooks` 목킹은 cancelService의 실주입을 덮어쓰므로 그대로 통과.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/cancelService.js server/src/controllers/orderController.js server/tests/cancelService.test.js
git commit -m "feat(server): 취소·환불 saga — pending 선조회, refund 락, 전액취소 확인 후 로컬 취소"
```

---

### Task 11: paymentJobs (sweeper·reconciler·outbox 워커) + 서버 기동 배선

**Files:**
- Create: `server/src/services/paymentJobs.js`
- Modify: `server/src/server.js`
- Test: `server/tests/paymentJobs.test.js`

**Interfaces:**
- Consumes: `portone.findPayment/getPayment`, `verifyAndCompletePayment`, `finalizeCancelTxn`, `executeRefund`, `processPendingEvents`
- Produces: `runPaymentJobsCycle(): Promise<{ stale, refunds, events }>` (테스트에서 직접 호출), `startPaymentJobs({ intervalMs = 60000 })` — server.js가 기동. 단일 인스턴스 전제(분산 락 없음 — 스펙 §1).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/paymentJobs.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import * as portone from '../src/services/portoneService.js';
import { runPaymentJobsCycle } from '../src/services/paymentJobs.js';
import Order from '../src/models/Order.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 900;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-6${seq}`, user: user._id,
    items: [{ price: 13000, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 13000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 13000 },
    status: 'pending',
    payment: { provider: 'portone', method: 'card', prepareStatus: 'prepared', expiresAt: new Date(Date.now() - 60_000) },
    ...over,
  });
}

describe('runPaymentJobsCycle', () => {
  beforeEach(() => { portone.findPayment.mockReset(); portone.getPayment.mockReset(); portone.cancel.mockReset(); });

  it('만료 pending + 결제 없음 → 취소 수렴', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    portone.findPayment.mockResolvedValue(null);
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('cancelled');
  });

  it('만료 pending + 늦은 paid → paid 수렴', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const pmt = { imp_uid: `imp_j${seq}`, merchant_uid: order.orderNumber, status: 'paid', amount: 13000, cancel_amount: 0, currency: 'KRW', pg_provider: 'html5_inicis', pay_method: 'card', paid_at: 1752700000, receipt_url: '' };
    portone.findPayment.mockResolvedValue(pmt);
    portone.getPayment.mockResolvedValue(pmt);
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('paid');
  });

  it('refund processing → 원격 전액취소 확인되면 cancelled 마무리', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, {
      status: 'paid',
      payment: {
        provider: 'portone', method: 'card', impUid: `imp_rp${seq}`,
        refund: { status: 'processing', requestedAt: new Date(Date.now() - 11 * 60_000), reason: '취소' },
      },
    });
    portone.getPayment.mockResolvedValue({ imp_uid: order.payment.impUid, merchant_uid: order.orderNumber, status: 'cancelled', amount: 13000, cancel_amount: 13000, currency: 'KRW' });
    await runPaymentJobsCycle();
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('cancelled');
    expect(saved.payment.refund.status).toBe('done');
  });

  it('만료 안 된 pending은 건드리지 않는다', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { payment: { provider: 'portone', prepareStatus: 'prepared', expiresAt: new Date(Date.now() + 60_000) } });
    await runPaymentJobsCycle();
    expect((await Order.findById(order._id)).status).toBe('pending');
    expect(portone.findPayment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/paymentJobs.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/services/paymentJobs.js`:

```js
import Order from '../models/Order.js';
import * as portone from './portoneService.js';
import { verifyAndCompletePayment } from './paymentService.js';
import { finalizeCancelTxn, executeRefund } from './cancelService.js';
import { processPendingEvents } from './orderEventService.js';

const BATCH = 20;
const REFUND_RETRY_AFTER_MS = 10 * 60 * 1000; // requested가 10분 넘게 잠겨 있으면 재수렴 대상

// 60초 주기 reconciler/sweeper. 단일 인스턴스 전제(Render 무료 티어) — 분산 락 없음.
// 각 항목은 독립 실패(한 건 오류가 사이클을 멈추지 않음).
export async function runPaymentJobsCycle() {
  const counts = { stale: 0, refunds: 0, events: 0 };
  if (portone.isConfigured()) {
    counts.stale = await sweepStalePending().catch((e) => (logErr('stale', e), 0));
    counts.refunds = await reconcileRefunds().catch((e) => (logErr('refunds', e), 0));
  }
  counts.events = await processPendingEvents(BATCH).catch((e) => (logErr('outbox', e), 0));
  return counts;
}

function logErr(stage, e) {
  console.error(`[paymentJobs:${stage}]`, e?.message || e);
}

// 만료된 미결제 pending — 포트원 선조회 후 paid 확정 / 취소 / 유지로 수렴
async function sweepStalePending() {
  const orders = await Order.find({
    status: 'pending',
    'payment.provider': 'portone',
    'payment.expiresAt': { $lt: new Date() },
  }).limit(BATCH);
  let handled = 0;
  for (const order of orders) {
    try {
      const pmt = await portone.findPayment(order.orderNumber);
      if (pmt && pmt.status === 'paid') {
        await verifyAndCompletePayment(pmt.imp_uid);
      } else if (pmt && pmt.status === 'ready') {
        continue; // 아직 결제창 진행 중일 수 있음 — 다음 사이클
      } else {
        await finalizeCancelTxn(order._id, ['pending'], { reason: '미결제 만료 자동취소' });
      }
      handled += 1;
    } catch (e) {
      logErr('stale-item', e);
    }
  }
  return handled;
}

// 결과 불명(processing)·잠긴 지 오래된(requested) 환불을 재조회로 수렴
async function reconcileRefunds() {
  const orders = await Order.find({
    status: { $in: ['paid', 'preparing'] },
    'payment.provider': 'portone',
    $or: [
      { 'payment.refund.status': 'processing' },
      { 'payment.refund.status': 'requested', 'payment.refund.requestedAt': { $lt: new Date(Date.now() - REFUND_RETRY_AFTER_MS) } },
    ],
  }).limit(BATCH);
  let handled = 0;
  for (const order of orders) {
    try {
      await executeRefund(order); // 이미 전액취소면 마무리, 아니면 재시도/processing 유지/review
      handled += 1;
    } catch (e) {
      logErr('refund-item', e);
    }
  }
  return handled;
}

let timer = null;

export function startPaymentJobs({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    runPaymentJobsCycle().catch((e) => logErr('cycle', e));
  }, intervalMs);
  timer.unref?.(); // 종료를 막지 않게
  console.log(`payment jobs 시작 (interval ${intervalMs / 1000}s)`);
}

export function stopPaymentJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
```

- [ ] **Step 4: server.js 배선 + 프로덕션 fail-fast**

`server/src/server.js`:
- `assertEnv()`의 production 블록에 추가:

```js
    if (!process.env.PORTONE_IMP_KEY || !process.env.PORTONE_IMP_SECRET) {
      throw new Error('PORTONE_IMP_KEY / PORTONE_IMP_SECRET 미설정 — 결제 서버 기동 중단');
    }
```

- `start()`의 `app.listen(...)` 다음에 추가:

```js
    const { startPaymentJobs } = await import('./services/paymentJobs.js');
    startPaymentJobs();
```

(개발 모드에서 포트원 키가 없으면 runPaymentJobsCycle이 outbox만 돌린다 — isConfigured 가드.)

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `cd server && npm test`
Expected: PASS 전체.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/paymentJobs.js server/src/server.js server/tests/paymentJobs.test.js
git commit -m "feat(server): 결제 reconciler/sweeper + outbox 워커 기동 — 60초 주기 수렴"
```

---

### Task 12: 관리자 통계 보정 (paid 이후 상태·paidAt 기준)

**Files:**
- Modify: `server/src/controllers/adminController.js`
- Test: `server/tests/adminStats.test.js`

**Interfaces:**
- Consumes: `SALES_STATES`(Task 3)
- Produces: `/admin/stats`·`/admin/analytics`·`/admin/members/:id`가 pending을 매출에서 제외하고, 매출 일자를 `payment.paidAt ?? createdAt` 기준으로 집계.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/adminStats.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 950;

async function makeOrder(user, status, grandTotal, paidAt = null) {
  seq += 1;
  return Order.create({
    orderNumber: `20260717-7${seq}`, user: user._id,
    items: [{ price: grandTotal, qty: 1 }], shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: grandTotal, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal },
    status,
    payment: { provider: 'portone', paidAt },
  });
}

describe('관리자 통계 — pending 제외', () => {
  it('오늘 매출에 pending·cancelled 미포함', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'pending', 10000);
    await makeOrder(buyer, 'cancelled', 20000);
    await makeOrder(buyer, 'paid', 30000, new Date());
    const res = await request(app).get('/admin/stats').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.sales.today).toBe(30000);
  });

  it('회원 상세 totalSpent도 pending 제외', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'pending', 10000);
    await makeOrder(buyer, 'delivered', 40000, new Date());
    const res = await request(app).get(`/admin/members/${buyer._id}`).set(authHeader(admin));
    expect(res.body.totalSpent).toBe(40000);
  });
});
```

(admin 라우트 경로가 `/admin/stats`·`/admin/members/:id`가 아니면 `server/src/routes/admin.js`에서 실제 경로 확인해 테스트를 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/adminStats.test.js`
Expected: FAIL — 현재는 `$ne: 'cancelled'` 기준이라 pending 포함(today=40000).

- [ ] **Step 3: adminController 수정**

`server/src/controllers/adminController.js`:

1. import 추가: `import { SALES_STATES } from '../models/Order.js';` (기존 `import Order...`는 default import이므로 `import Order, { SALES_STATES } from '../models/Order.js';`로 교체)
2. `getStats`의 Order.aggregate를 `$addFields`로 매출 기준일 추가 후 상태 필터 교체:

```js
    Order.aggregate([
      { $addFields: { salesDate: { $ifNull: ['$payment.paidAt', '$createdAt'] } } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          salesToday: [
            { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: today } } },
            { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } },
          ],
          salesMonth: [
            { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: month } } },
            { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } },
          ],
          recent: [ /* 기존 그대로 */ ],
        },
      },
    ]),
```

3. `getAnalytics`의 파이프라인 첫 단계를 교체:

```js
  const [agg] = await Order.aggregate([
    { $addFields: { salesDate: { $ifNull: ['$payment.paidAt', '$createdAt'] } } },
    { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: start } } },
    // $facet 내 series의 $dateToString date도 '$salesDate'로 교체
```

`series` 그룹의 `date: '$createdAt'` → `date: '$salesDate'`.

4. `getMember`의 totalSpent 필터 교체:

```js
  const totalSpent = orders
    .filter((o) => SALES_STATES.includes(o.status))
    .reduce((a, o) => a + o.amounts.grandTotal, 0);
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `cd server && npm test`
Expected: PASS 전체.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/adminController.js server/tests/adminStats.test.js
git commit -m "fix(admin): 매출 통계를 결제 확정 상태·paidAt 기준으로 보정 (pending 제외)"
```

---

### Task 13: 클라이언트 기반 — SDK 로드·env·payments 라이브러리

**Files:**
- Modify: `client/index.html`
- Modify: `client/.env.example` (없으면 생성), `client/.env.production.example`
- Create: `client/src/lib/payments.js`

**Interfaces:**
- Produces:
  - `window.IMP` (v1 SDK, index.html에서 로드)
  - `completePayment(impUid) → Promise<{order, outcome}>` (POST /payments/complete)
  - `requestPortonePay({ checkout, buyer }) → Promise<rsp>` — IMP.request_pay Promise 래퍼. 실패 시 `Error(error_msg)` reject.
  - env: `VITE_PORTONE_IMP_CODE`(필수), `VITE_PORTONE_CHANNEL_KEY`(선택 — 있으면 channelKey, 없으면 pg:'html5_inicis')
- Consumes: Task 7 응답 `checkout` DTO(`orderId, orderNumber, amount, orderName`), Task 9 `/payments/complete` 계약

- [ ] **Step 1: index.html에 SDK 추가**

`client/index.html`의 Pretendard `<link ...>` 아래(head 끝)에 추가:

```html
    <!-- 포트원(아임포트) v1 결제 SDK -->
    <script src="https://cdn.iamport.kr/v1/iamport.js"></script>
```

- [ ] **Step 2: env 예시 파일 갱신**

`client/.env.example`에 추가:

```bash
# 포트원 가맹점 식별코드(imp로 시작 — 공개값, REST 키 아님)
VITE_PORTONE_IMP_CODE=imp00000000
# 포트원 콘솔 채널키(선택). 지정 시 channelKey 우선, 미지정 시 pg:'html5_inicis'
VITE_PORTONE_CHANNEL_KEY=
```

`client/.env.production.example`에도 같은 두 줄 추가.

- [ ] **Step 3: payments 라이브러리 작성**

`client/src/lib/payments.js`:

```js
import api from './api.js';

const IMP_CODE = import.meta.env.VITE_PORTONE_IMP_CODE;
const CHANNEL_KEY = import.meta.env.VITE_PORTONE_CHANNEL_KEY;

// 결제 컨텍스트 — 모바일 리다이렉트(페이지 이탈)에서도 살아남도록 sessionStorage에 보관
const PAY_CTX_KEY = 'sns_pay_ctx';

export function savePayContext(ctx) {
  sessionStorage.setItem(PAY_CTX_KEY, JSON.stringify(ctx));
}
export function loadPayContext() {
  try {
    return JSON.parse(sessionStorage.getItem(PAY_CTX_KEY) || 'null');
  } catch {
    return null;
  }
}
export function clearPayContext() {
  sessionStorage.removeItem(PAY_CTX_KEY);
}

// 결제창 콜백/리다이렉트 후 서버 검증 — 서버가 포트원 재조회로 최종 판정한다.
export async function completePayment(impUid) {
  const { data } = await api.post('/payments/complete', { impUid });
  return data;
}

// IMP.request_pay Promise 래퍼. checkout: 서버 createOrder 응답의 checkout DTO.
export function requestPortonePay({ checkout, buyer }) {
  return new Promise((resolve, reject) => {
    const IMP = window.IMP;
    if (!IMP || !IMP_CODE) {
      reject(new Error('결제 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'));
      return;
    }
    IMP.init(IMP_CODE);
    IMP.request_pay(
      {
        ...(CHANNEL_KEY ? { channelKey: CHANNEL_KEY } : { pg: 'html5_inicis' }),
        pay_method: 'card',
        merchant_uid: checkout.orderNumber,
        name: checkout.orderName,
        amount: checkout.amount,
        buyer_email: buyer.email || '',
        buyer_name: buyer.name || '',
        buyer_tel: buyer.tel || '',
        buyer_addr: buyer.addr || '',
        buyer_postcode: buyer.postcode || '',
        m_redirect_url: `${window.location.origin}/checkout/complete`,
      },
      (rsp) => {
        if (rsp.success) resolve(rsp);
        else reject(Object.assign(new Error(rsp.error_msg || '결제가 완료되지 않았습니다.'), { rsp }));
      },
    );
  });
}
```

- [ ] **Step 4: 빌드 확인**

Run: `cd client && npx vite build`
Expected: 빌드 성공 (미사용 모듈이지만 문법 검증).

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/.env.example client/.env.production.example client/src/lib/payments.js
git commit -m "feat(client): 포트원 v1 SDK 로드 + 결제 라이브러리·환경변수 스캐폴딩"
```

---

### Task 14: Checkout 재구성 — 결제창 플로우

**Files:**
- Modify: `client/src/pages/Checkout.jsx`

**Interfaces:**
- Consumes: `createOrder`(응답 `{order, checkout}`— Task 7), `requestPortonePay/completePayment/savePayContext/clearPayContext`(Task 13), `cancelOrder`(became_paid 시 paid 주문 반환 — Task 10)
- Produces: 데스크톱 결제 플로우 완성. 완료 화면(`done`)은 기존 그대로 재사용.

- [ ] **Step 1: import·onPay 교체**

`client/src/pages/Checkout.jsx` 상단 import에 추가:

```js
import { cancelOrder } from '../lib/orders.js';
import { requestPortonePay, completePayment, savePayContext, clearPayContext } from '../lib/payments.js';
```

`onPay` 함수를 다음으로 교체:

```js
  // 성공 마무리 공통 — 장바구니 제거는 서버가 paid를 확인한 뒤에만
  const finishPaid = (order) => {
    rows.forEach((r) => remove(r.id, r.option));
    idemKeyRef.current = null;
    clearPayContext();
    setDone(order);
  };

  const onPay = async () => {
    setErr('');
    if (!selectedAddr) return setErr('배송지를 선택해주세요.');
    if (!idemKeyRef.current) {
      idemKeyRef.current = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setBusy(true);
    try {
      // 1) 서버 선주문(pending) — 금액은 전부 서버 계산
      const { order, checkout } = await createOrder(
        {
          items: rows.map((r) => ({ slug: r.id, qty: r.qty, option: r.option })),
          couponCode: selectedCoupon ? couponCode : undefined,
          pointsToUse: pointsToUse > 0 ? pointsToUse : undefined,
          shippingAddress: {
            recipient: selectedAddr.recipient,
            phone: selectedAddr.phone,
            zipcode: selectedAddr.zipcode,
            address1: selectedAddr.address1,
            address2: selectedAddr.address2,
            deliveryMemo: memo || selectedAddr.deliveryMemo,
          },
        },
        idemKeyRef.current,
      );

      // 0원(포인트 전액) — 결제창 없이 완료
      if (!checkout) return finishPaid(order);

      // 모바일 리다이렉트/새로고침 대비 컨텍스트 보관
      savePayContext({
        orderId: checkout.orderId,
        orderNumber: checkout.orderNumber,
        idemKey: idemKeyRef.current,
        lines: rows.map((r) => ({ id: r.id, option: r.option })),
      });

      // 2) 포트원 결제창
      let rsp;
      try {
        rsp = await requestPortonePay({
          checkout,
          buyer: {
            email: user?.email,
            name: selectedAddr.recipient,
            tel: selectedAddr.phone,
            addr: `${selectedAddr.address1} ${selectedAddr.address2 || ''}`.trim(),
            postcode: selectedAddr.zipcode,
          },
        });
      } catch (payErr) {
        // 창닫힘/실패 — 서버가 결제 존재를 선확인 후 취소한다(청구-취소 경합 차단)
        try {
          const cancelled = await cancelOrder(checkout.orderId);
          if (cancelled?.status === 'paid') return finishPaid(cancelled); // 실제론 승인돼 있었음
          idemKeyRef.current = null; // 취소 확정 → 다음 시도는 새 주문
          clearPayContext();
          setErr(payErr.message);
        } catch (cx) {
          if (cx.response?.status === 409) setErr('결제 확인이 진행 중입니다. 마이페이지에서 주문 상태를 확인해주세요.');
          else setErr(payErr.message);
        }
        return undefined;
      }

      // 3) 서버 검증 — 성공 판정은 서버만 한다
      try {
        const d = await completePayment(rsp.imp_uid);
        return finishPaid(d.order);
      } catch (ve) {
        if (!ve.response) {
          // 네트워크 유실 — 주문을 취소하지 않는다(웹훅/재확인이 확정할 수 있음)
          setErr('결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
        } else if (ve.response.status === 400) {
          idemKeyRef.current = null;
          clearPayContext();
          setErr(ve.response.data?.message || '결제에 실패했습니다.');
        } else {
          setErr(ve.response.data?.message || '결제 확인에 실패했습니다.');
        }
        return undefined;
      }
    } catch (e) {
      if (e.response?.status === 409) idemKeyRef.current = null; // 키 충돌/취소된 키 — 새 키로 재시도 가능
      setErr(e.response?.data?.message || '결제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };
```

- [ ] **Step 2: 문구 교체**

결제 버튼 아래 안내 문구(459행 부근)를 교체:

```jsx
            <p className="mt-3 text-center text-[11px] text-faint">KG이니시스 테스트 결제 — 실제 청구되지 않습니다</p>
```

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `cd client && npx vite build`
Expected: 빌드 성공.

수동 검증(포트원 테스트 채널 키를 client/.env·server/.env에 설정한 뒤):
1. `cd server && npm run dev`, `cd client && npm run dev`
2. 상품 담기 → 주문서 → 결제하기 → 이니시스 테스트 결제창 표시 확인
3. 테스트 카드로 결제 → 완료 화면(주문번호·금액) → 마이페이지에서 status '결제 완료' 확인
4. 결제창 X로 닫기 → 에러 문구 표시 + 마이페이지에서 해당 주문이 '취소' 확인(포인트·쿠폰 원복)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Checkout.jsx
git commit -m "feat(client): 주문서 결제 플로우 — 선주문·포트원 결제창·서버 검증·실패 정리"
```

---

### Task 15: 모바일 리다이렉트 페이지 (/checkout/complete)

**Files:**
- Create: `client/src/pages/CheckoutComplete.jsx`
- Modify: `client/src/App.jsx`

**Interfaces:**
- Consumes: `completePayment/loadPayContext/clearPayContext`(Task 13), `cancelOrder`(Task 10), `useCart().remove`
- Produces: `/checkout/complete` 라우트(RequireAuth). 쿼리 `imp_uid, merchant_uid, imp_success, error_msg` — **imp_success는 참고값일 뿐, 항상 서버 검증으로 판정**.

- [ ] **Step 1: 페이지 작성**

`client/src/pages/CheckoutComplete.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { completePayment, loadPayContext, clearPayContext } from '../lib/payments.js';
import { cancelOrder } from '../lib/orders.js';
import { won } from '../lib/format.js';

// 모바일 결제(m_redirect_url) 복귀 지점. 데스크톱 새로고침 유실 복구도 겸한다.
// 쿼리의 imp_success는 승인 근거가 아니다 — 서버 검증(completePayment)만 믿는다.
export default function CheckoutComplete() {
  const [params] = useSearchParams();
  const { remove } = useCart();
  const [phase, setPhase] = useState('checking'); // checking | done | failed | delayed
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const impUid = params.get('imp_uid');
    const errorMsg = params.get('error_msg');
    const ctx = loadPayContext();

    async function run() {
      if (impUid) {
        try {
          const d = await completePayment(impUid);
          (ctx?.lines || []).forEach((l) => remove(l.id, l.option));
          clearPayContext();
          setOrder(d.order);
          setPhase('done');
          return;
        } catch (e) {
          if (!e.response) {
            // 네트워크 유실 — 취소 금지, 재확인 안내
            setMessage('결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
            setPhase('delayed');
            return;
          }
          // 서버가 실패로 판정(400 등) — 아래 취소 정리로
        }
      }
      // 결제 실패/취소 — pending 주문 정리(서버가 결제 존재를 선확인)
      if (ctx?.orderId) {
        try {
          const cancelled = await cancelOrder(ctx.orderId);
          if (cancelled?.status === 'paid') {
            (ctx?.lines || []).forEach((l) => remove(l.id, l.option));
            clearPayContext();
            setOrder(cancelled);
            setPhase('done');
            return;
          }
          clearPayContext();
        } catch {
          /* 취소 실패(409 등)는 sweeper가 수렴 — 안내만 */
        }
      }
      setMessage(errorMsg || '결제가 완료되지 않았습니다. 장바구니는 그대로 남아 있어요.');
      setPhase('failed');
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'checking') {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-5 text-center">
        <p className="text-[14px] text-mute">결제를 확인하고 있습니다…</p>
      </div>
    );
  }

  if (phase === 'done' && order) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-ink text-2xl leading-none text-paper">✓</div>
        <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Order complete</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">주문이 완료되었습니다</h1>
        <dl className="mt-6 w-full space-y-2.5 border-y border-line py-5 text-[13px]">
          <div className="flex justify-between"><dt className="text-mute">주문번호</dt><dd className="font-medium">{order.orderNumber}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">결제금액</dt><dd className="font-bold">{won(order.amounts.grandTotal)}원</dd></div>
        </dl>
        <div className="mt-7 flex w-full gap-2.5">
          <Link to="/mypage" className="flex-1 border border-ink py-3.5 text-sm font-medium hover:bg-tint">주문내역 보기</Link>
          <Link to="/" className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper hover:bg-ink/85">쇼핑 계속하기</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="text-xl font-bold tracking-tight">{phase === 'delayed' ? '결제 확인 지연' : '결제가 완료되지 않았습니다'}</h1>
      <p className="mt-3 text-[13px] text-mute">{message}</p>
      <div className="mt-7 flex w-full gap-2.5">
        <Link to={phase === 'delayed' ? '/mypage' : '/checkout'} className="flex-1 border border-ink py-3.5 text-sm font-medium hover:bg-tint">
          {phase === 'delayed' ? '마이페이지' : '주문서로 돌아가기'}
        </Link>
        <Link to="/" className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper hover:bg-ink/85">홈으로</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 라우트 등록**

`client/src/App.jsx`: import 추가 `import CheckoutComplete from './pages/CheckoutComplete.jsx';`, `/checkout` Route 아래에 추가:

```jsx
        <Route
          path="/checkout/complete"
          element={
            <RequireAuth>
              <CheckoutComplete />
            </RequireAuth>
          }
        />
```

주의: RequireAuth가 로그인 페이지로 보낼 때 원래 목적지의 **query string까지** 보존하는지 `client/src/components/RequireAuth.jsx`에서 확인한다. `state={{ from: location }}`에 `location.search`가 포함되지 않으면 포함하도록 수정(모바일 결제 복귀 시 세션 만료 대비).

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `cd client && npx vite build` → 성공 확인.

수동(모바일 시뮬레이션): 브라우저 개발자도구 모바일 모드에서 결제 → 이니시스가 리다이렉트 → `/checkout/complete?imp_uid=...&imp_success=true` 도착 → "주문이 완료되었습니다" 확인. 결제 중단 시 `imp_success=false`로 돌아와 실패 화면 + 주문 취소 확인.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CheckoutComplete.jsx client/src/App.jsx
git commit -m "feat(client): 모바일 결제 리다이렉트 완료 페이지 — 서버 검증 단일 판정"
```

---

### Task 16: MyPage·관리자 화면 정비

**Files:**
- Modify: `client/src/pages/MyPage.jsx`
- Modify: `client/src/pages/admin/OrderDetail.jsx`
- Modify: `client/src/lib/admin.js` (라벨 확인만 — 변경 없을 수 있음)

**Interfaces:**
- Consumes: `POST /orders/:id/cancel` 응답(200 주문 | 202 refund_pending | 409), `order.payment.refund.status`, `order.payment.receiptUrl`
- Produces: pending 주문 사용자 취소, 환불 상태 표시, 관리자 수동 pending→paid 제거

- [ ] **Step 1: MyPage 수정**

`client/src/pages/MyPage.jsx`:

1. `const CANCELLABLE = ['paid', 'preparing'];` → `const CANCELLABLE = ['pending', 'paid', 'preparing'];`
2. `onCancel`을 202/409 응답에 대응하도록 교체:

```js
  const onCancel = async (id) => {
    if (!window.confirm('이 주문을 취소하시겠어요?\n(결제된 주문은 전액 환불 후 취소됩니다)')) return;
    try {
      const updated = await cancelOrder(id);
      setOrders((prev) => prev.map((o) => (o._id === id ? updated : o)));
      if (updated.status === 'paid') {
        window.alert('확인 결과 결제가 완료된 주문입니다. 취소를 원하시면 다시 시도해주세요.');
      }
    } catch (e) {
      if (e.response?.status === 202) {
        // 환불 접수 — 주문은 아직 paid, reconciler가 완료 후 취소로 수렴
        window.alert('환불이 접수되었습니다. 처리 완료까지 잠시 걸릴 수 있습니다.');
      } else {
        window.alert(e.response?.data?.message || '주문 취소에 실패했습니다.');
      }
    }
  };
```

(참고: axios는 202를 성공으로 처리하므로 실제로는 catch에 오지 않는다 — 202 응답 body는 `{message, order}` 형태라 `updated.status`가 없다. 아래처럼 성공 경로에서 분기한다:)

```js
      const d = await cancelOrder(id);
      const updated = d.order || d; // 202는 {message, order}, 200은 주문 자체
      setOrders((prev) => prev.map((o) => (o._id === id ? updated : o)));
      if (d.message) window.alert(d.message);
      else if (updated.status === 'paid') window.alert('확인 결과 결제가 완료된 주문입니다.');
```

최종 코드는 두 번째 형태를 사용한다.

3. 주문 카드 상태 표시에 환불 뱃지·영수증 링크 추가 — 상태 라벨 `<span>` 옆에:

```jsx
              {['requested', 'processing'].includes(o.payment?.refund?.status) && o.status !== 'cancelled' && (
                <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] text-mute">환불 처리 중</span>
              )}
              {o.payment?.receiptUrl && (
                <a href={o.payment.receiptUrl} target="_blank" rel="noreferrer" className="text-[12px] text-mute underline-offset-2 hover:underline">
                  영수증
                </a>
              )}
```

- [ ] **Step 2: 관리자 OrderDetail 수정**

`client/src/pages/admin/OrderDetail.jsx`:

1. `NEXT`의 pending 라인을 `pending: ['cancelled'],`로 교체(수동 결제완료 제거 — 서버도 거부함). 주석도 갱신: `// pending→paid는 결제 검증(verifier) 전용 — 관리자 수동 전환 금지`
2. 헤더의 `<StatusBadge status={o.status} />` 옆에 환불 상태 표시 추가:

```jsx
        {o.payment?.refund?.status && o.payment.refund.status !== 'none' && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${o.payment.refund.status === 'review' ? 'bg-sale/10 text-sale' : 'bg-tint text-mute'}`}>
            환불 {({ requested: '요청됨', processing: '처리 중', done: '완료', review: '확인 필요' })[o.payment.refund.status]}
          </span>
        )}
        {o.payment?.refund?.status === 'review' && (
          <p className="mt-1 text-[12px] text-sale">{o.payment.refund.reason}</p>
        )}
```

(reason 문구는 결제 금액 요약 아래 등 적절한 위치에 — 헤더가 좁으면 상태 변경 섹션 위로.)

3. 결제 정보 표시 — `주문 상품` 섹션의 결제금액 아래에 추가:

```jsx
        {o.payment?.impUid && (
          <div className="mt-1 flex justify-between text-[12px] text-mute">
            <span>결제(포트원)</span>
            <span>
              {o.payment.pg || 'card'} · {o.payment.impUid}
              {o.payment.receiptUrl && (
                <a href={o.payment.receiptUrl} target="_blank" rel="noreferrer" className="ml-2 underline-offset-2 hover:underline">영수증</a>
              )}
            </span>
          </div>
        )}
```

4. `change` 함수의 202 대응 — `setOrderStatus` 성공 응답이 `{message, order}`일 수 있으므로:

```js
      const updated = await setOrderStatus(id, body);
      apply(updated.order || updated);
      toast.success(updated.message || '주문 상태를 변경했습니다.');
```

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `cd client && npx vite build` → 성공.

수동: 관리자 주문 상세에서 pending 주문에 '결제완료' 버튼이 없는지, paid 주문 취소 시 환불 후 취소되는지, review 주문에 '확인 필요' 뱃지가 뜨는지 확인.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/MyPage.jsx client/src/pages/admin/OrderDetail.jsx
git commit -m "feat(client): pending 취소·환불 상태 표시 + 관리자 수동 결제완료 제거"
```

---

### Task 17: 환경설정·배포 문서·최종 E2E

**Files:**
- Modify: `server/.env.example`, `render.yaml`, `DEPLOY.md`
- Modify: `docs/superpowers/plans/2026-07-17-portone-pg.md` (E2E 체크 결과 기록)

**Interfaces:**
- Consumes: 전체 구현
- Produces: 배포 가능한 설정 문서 + 검증된 E2E

- [ ] **Step 1: server/.env.example 갱신**

Cloudinary 항목 아래에 추가:

```bash
# 포트원(아임포트) v1 REST API 키 — 콘솔 > 결제연동 > 식별코드·API Keys
PORTONE_IMP_KEY=
PORTONE_IMP_SECRET=
```

- [ ] **Step 2: render.yaml 갱신**

envVars 목록에 추가:

```yaml
      - key: PORTONE_IMP_KEY
        sync: false # 포트원 REST API 키
      - key: PORTONE_IMP_SECRET
        sync: false # 포트원 REST API Secret
```

- [ ] **Step 3: DEPLOY.md에 포트원 섹션 추가**

환경변수 표에 `PORTONE_IMP_KEY`/`PORTONE_IMP_SECRET` 행 추가 + 새 섹션:

```markdown
## 포트원(아임포트) 결제 설정

1. https://admin.portone.io 가입 → 결제 연동 > 연동 정보 > **V1 API** 키 확인
   - `가맹점 식별코드(imp...)` → 프론트 `VITE_PORTONE_IMP_CODE`
   - `REST API Key/Secret` → 백엔드 `PORTONE_IMP_KEY` / `PORTONE_IMP_SECRET`
2. 결제 연동 > 채널 관리 → **KG이니시스** 테스트 채널 생성
   - 채널키를 쓰려면 프론트 `VITE_PORTONE_CHANNEL_KEY`에 설정(미설정 시 pg:'html5_inicis' 사용)
3. 웹훅: 결제 연동 > 웹훅 관리 → URL `https://<render-domain>/payments/webhook`, 버전 v1
   - 로컬 개발은 웹훅 없이도 동작(클라이언트 콜백 검증 + 60초 reconciler)
4. 테스트 결제는 실제 승인 후 **당일 자동 취소**된다(실청구 없음).
```

주의: 웹훅 URL 경로는 프론트 프록시(`/api`)가 아니라 **백엔드 직결** 경로다. Render 서비스가 `/payments/webhook`으로 라우팅되는지 `render.yaml`/백엔드 마운트 기준으로 확인해 문서에 정확히 적는다(app.js 기준 `/payments/webhook`).

- [ ] **Step 4: 전체 테스트 + 최종 수동 E2E**

```bash
cd server && npm test          # 전체 PASS
cd ../client && npx vite build # 빌드 성공
```

수동 E2E 체크리스트(포트원 테스트 키 설정 후, 로컬):
1. PC 결제 성공: 주문 → 결제창 → 테스트 카드 → 완료 화면 → 마이페이지 '결제 완료' → 관리자 매출에 반영
2. 결제창 닫기: 주문 취소 확인, 쿠폰·포인트 원복 확인
3. 쿠폰+포인트 조합 주문 → 취소 → 원복 확인 (포인트 잔액·쿠폰 재사용 가능)
4. 0원 주문(포인트 전액): 결제창 없이 즉시 완료
5. 포인트로 grandTotal 50원 만들기 시도 → 400 안내
6. paid 주문 사용자 취소 → 포트원 콘솔에서 결제 취소됨 확인 → 주문 '취소'
7. 관리자: pending 주문에 결제완료 버튼 없음, paid 취소 시 환불 동작
8. 모바일 모드 결제 → /checkout/complete 복귀 → 완료
9. (배포 후) 웹훅 URL 등록 → 결제 직후 브라우저 강제 종료 → 주문이 paid로 확정되는지
10. 30분 경과(또는 expiresAt 수동 단축) 후 sweeper가 미결제 pending을 취소하는지

- [ ] **Step 5: Commit**

```bash
git add server/.env.example render.yaml DEPLOY.md
git commit -m "docs(deploy): 포트원 키·웹훅 설정 절차 추가"
```

---

## Self-Review 결과 (계획 작성 시점)

- **스펙 커버리지**: §2 모델(Task 3), §3 포트원 서비스(Task 4), §4 주문 생성(Task 7), §5 verifier(Task 8·9), §6 saga(Task 10), §7 포인트(Task 5), §8 jobs(Task 11), §9 관리자·통계(Task 10·12·16), §10 클라이언트(Task 13~16), §11 보안·운영(Task 9·11·17), §12 테스트(각 태스크 + Task 17 E2E). 커버 안 된 항목 없음.
- **선후 의존**: Task 7이 Task 10의 `finalizeCancelTxn`을 임시 코드로 대체 후 Task 10에서 교체 — Step에 명시함.
- **타입 일치 확인**: `checkout` DTO(orderId/orderNumber/amount/orderName), outcome 문자열, refund.status enum이 서버·클라이언트 태스크 간 동일함을 재확인.

## 실행 메모

- 태스크 순서 고정: 1→2→3→4→5→6→7→8→9→10→11→12→(13→14→15→16 클라이언트)→17.
- 모든 서버 태스크 완료 후 `npm test` 회귀 필수. 클라이언트는 `npx vite build` + 수동 확인.
- 포트원 테스트 키가 준비되기 전까지는 vi.mock 기반 테스트만으로 진행 가능 — 실 결제창 확인은 Task 14 이후.
