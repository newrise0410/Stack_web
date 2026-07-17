# 관리자 주문관리 업그레이드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 주문 페이지를 스마트스토어식 작업대(상태 탭+일괄처리+인라인 송장+CSV)로 확장하고, 옵션별 제작 집계와 포장용 주문서 인쇄를 추가한다.

**Architecture:** 단건 상태전이 로직을 `applyTransition` 서비스로 추출해 단건 API와 신규 bulk API가 공유(상태머신·환불잠금·취소 saga 우회 없음, 부분 성공). 조회 계열(counts/summary/batch/export)은 read-only aggregation. 클라이언트는 기존 URL-동기화 패턴 위에 탭바·체크박스·액션바를 얹고, 제작 리스트와 인쇄는 전용 라우트.

**Tech Stack:** Express 4 + Mongoose 8(ESM), React/Vite. 신규 의존성 금지(CSV 파싱·생성 모두 자체 구현).

**Spec:** `docs/superpowers/specs/2026-07-17-admin-orders-upgrade-design.md`

## Global Constraints

- 일괄 처리도 건별로 기존 상태머신·refund 잠금·cancelOrderSaga를 통과 — 우회 금지. 부분 성공 + `{succeeded, failed:[{orderId, orderNumber, message}]}` 반환.
- 상한: bulk ids 1~100, bulk/tracking rows 1~100, batch(인쇄) ids ≤ 50, export ≤ 5,000행. 초과 시 400(export는 앞 5,000 + 안내행).
- 기존 단건 API 계약 불변: `PATCH /orders/:id/status` → 200 주문 | 202 {message, order} | 400/404/409 {message}.
- 신규 라우트는 전부 requireAuth+requireAdmin. `/orders/admin/<이름>` 라우트는 기존 `GET /orders/admin`·`/:id`보다 먼저 선언.
- CSV: UTF-8 BOM(`﻿`), RFC4180 이스케이프(쉼표·따옴표·개행 → 큰따옴표 감싸고 내부 `"` 는 `""`).
- 주문번호 형식 `^\d{8}-\d{6}$`. 택배사 선택지: CJ대한통운/우체국택배/한진택배/롯데택배/로젠택배/기타.
- 주문서 인쇄는 포장용 — 금액 미포함. 주문당 1페이지(`page-break-after: always`).
- 사용자 문구 한국어, 기존 주석 스타일(한국어, 이유 중심) 유지, 신규 npm 의존성 금지.
- 테스트: `cd server && npm test` (현재 61 green). 서버 태스크는 TDD. 클라는 `cd client && VITE_API_URL=https://example.onrender.com npx vite build` + 수동 확인.
- 커밋 conventional + 한국어, 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: orderTransitionService 추출 + updateOrderStatus 재배선

**Files:**
- Create: `server/src/services/orderTransitionService.js`
- Modify: `server/src/controllers/orderController.js` (updateOrderStatus를 thin wrapper로, TRANSITIONS 정의 이동)
- Test: `server/tests/orderTransition.test.js`

**Interfaces:**
- Produces: `applyTransition(orderId, next, { courier = '', trackingNumber = '', actor = 'admin' }) → Promise<{ ok:true, order } | { ok:false, code, message, order? }>`
  - code ∈ `'not_found' | 'refund_locked' | 'invalid_transition' | 'tracking_required' | 'conflict' | 'refund_pending' | 'review'`
  - `TRANSITIONS` named export(기존 표와 동일). Task 2가 둘 다 사용.
- 기존 단건 API 응답 계약 불변(200/202/400/404/409 + 메시지 동일).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/orderTransition.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getPayment: vi.fn(), findPayment: vi.fn(async () => null), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import { applyTransition, TRANSITIONS } from '../src/services/orderTransitionService.js';
import Order from '../src/models/Order.js';
import { createTestUser, TEST_ADDRESS } from './helpers.js';

let seq = 0;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260718-10${String(seq).padStart(4, '0')}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 10000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_tr${seq}` },
    ...over,
  });
}

describe('applyTransition', () => {
  it('paid → preparing 정상 전이', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user);
    const r = await applyTransition(order._id, 'preparing');
    expect(r.ok).toBe(true);
    expect(r.order.status).toBe('preparing');
  });

  it('허용되지 않는 전이 — invalid_transition', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'delivered' });
    const r = await applyTransition(order._id, 'preparing');
    expect(r).toMatchObject({ ok: false, code: 'invalid_transition' });
  });

  it('shipped 전이에 송장 필수 — tracking_required', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { status: 'preparing' });
    const r = await applyTransition(order._id, 'shipped', {});
    expect(r).toMatchObject({ ok: false, code: 'tracking_required' });
    const ok = await applyTransition(order._id, 'shipped', { courier: 'CJ대한통운', trackingNumber: '123456' });
    expect(ok.ok).toBe(true);
    expect(ok.order.trackingNumber).toBe('123456');
  });

  it('refund 잠금 — refund_locked', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { payment: { provider: 'portone', impUid: 'imp_lk1', refund: { status: 'processing' } } });
    const r = await applyTransition(order._id, 'preparing');
    expect(r).toMatchObject({ ok: false, code: 'refund_locked' });
  });

  it('cancelled 전이는 saga 경유(레거시 mock 주문 즉시 취소)', async () => {
    const user = await createTestUser();
    const order = await makeOrder(user, { paymentMethod: 'mock', payment: undefined });
    const r = await applyTransition(order._id, 'cancelled');
    expect(r.ok).toBe(true);
    expect(r.order.status).toBe('cancelled');
  });

  it('TRANSITIONS export — pending에 paid 없음(검증 우회 금지)', () => {
    expect(TRANSITIONS.pending).toEqual(['cancelled']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/orderTransition.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 서비스 구현**

`server/src/services/orderTransitionService.js`:

```js
import Order from '../models/Order.js';
import PointTransaction from '../models/PointTransaction.js';
import { applyPoints } from './pointService.js';
import { sendOrderStatus } from './emailService.js';
import { cancelOrderSaga } from './cancelService.js';

// 허용 전이만 강제하는 상태머신(orderController에서 이동).
// pending→paid는 결제 verifier 전용 — 관리자 수동 전환 금지.
export const TRANSITIONS = {
  pending: ['cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'shipped'], // 동일상태 재요청 = 송장 수정용
  delivered: ['delivered'], // 동일상태 재요청 = 적립 지급 재시도용(멱등)
  cancelled: [],
};

// 관리자 상태 전이의 단일 진입점 — 단건 API와 일괄 API가 공유한다.
// 검증(전이표·환불잠금·송장)→CAS→부수효과(적립·메일)를 모두 포함하므로
// 어느 경로로 와도 규칙이 동일하다. cancelled는 cancelOrderSaga에 위임.
export async function applyTransition(orderId, next, { courier = '', trackingNumber = '', actor = 'admin' } = {}) {
  const order = await Order.findById(orderId).catch(() => null);
  if (!order) return { ok: false, code: 'not_found', message: '주문을 찾을 수 없습니다.' };

  const refundStatus = order.payment?.refund?.status;
  if (['requested', 'processing', 'review'].includes(refundStatus)) {
    return { ok: false, code: 'refund_locked', message: '환불 처리 중인 주문입니다. 완료 후 다시 시도해주세요.' };
  }

  const prev = order.status;
  const allowed = TRANSITIONS[prev] || [];
  if (!allowed.includes(next)) {
    return { ok: false, code: 'invalid_transition', message: `'${prev}' 상태에서 '${next}'(으)로 변경할 수 없습니다.` };
  }

  if (next === 'cancelled') {
    const r = await cancelOrderSaga(order._id, { actor, reason: `${actor} 취소` });
    if (['cancelled', 'already_cancelled'].includes(r.outcome)) {
      const populated = await Order.findById(order._id).populate('user', 'name email');
      return { ok: true, order: populated };
    }
    if (r.outcome === 'refund_pending') {
      return { ok: false, code: 'refund_pending', message: '환불 접수됨 — 처리 완료 후 자동 취소됩니다.', order: r.order };
    }
    return { ok: false, code: 'review', message: '취소를 완료하지 못했습니다. 환불 상태를 확인해주세요.' };
  }

  const setFields = { status: next };
  if (next === 'shipped') {
    const tn = String(trackingNumber || '').trim();
    if (!tn) return { ok: false, code: 'tracking_required', message: '송장번호를 입력해주세요.' };
    setFields.courier = String(courier || '').trim();
    setFields.trackingNumber = tn;
  }

  // 조건부 원자적 전이 — 경합 패배는 conflict
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: prev },
    { $set: setFields },
    { new: true },
  );
  if (!updated) return { ok: false, code: 'conflict', message: '주문 상태가 이미 변경되었습니다. 다시 시도해주세요.' };

  // 배송완료 전이 시 구매 적립 확정 지급 — 멱등({order,type:earn} unique)
  if (next === 'delivered' && updated.pointsEarned > 0) {
    try {
      const earned = await PointTransaction.exists({ order: updated._id, type: 'earn' });
      if (!earned) {
        await applyPoints(updated.user?._id || updated.user, updated.pointsEarned, 'earn', {
          order: updated._id, note: `주문 ${updated.orderNumber} 적립`,
        });
      }
    } catch (e) {
      console.error('[applyTransition] 적립 지급 실패:', updated.orderNumber, e?.message);
    }
  }

  // populate + 상태 메일(실제 전이일 때만 — 송장 수정 재발송 방지). 실패해도 전이는 성립.
  try {
    await updated.populate('user', 'name email');
    if (next !== prev && ['shipped', 'delivered'].includes(next)) {
      await sendOrderStatus(updated, updated.user);
    }
  } catch { /* 무시 */ }
  return { ok: true, order: updated };
}
```

- [ ] **Step 4: updateOrderStatus를 wrapper로 교체**

`server/src/controllers/orderController.js`:
1. 파일 내 `const TRANSITIONS = {...}` 정의 삭제, import 추가: `import { applyTransition } from '../services/orderTransitionService.js';`
2. `updateOrderStatus` 함수 전체를 교체(기존 본문 로직은 서비스로 이동했음):

```js
// 주문 상태 변경 — PATCH /orders/:id/status (admin). 로직은 orderTransitionService 공유.
export async function updateOrderStatus(req, res) {
  const r = await applyTransition(req.params.id, String(req.body.status || ''), {
    courier: req.body.courier,
    trackingNumber: req.body.trackingNumber,
    actor: 'admin',
  });
  if (r.ok) return res.json(r.order);
  switch (r.code) {
    case 'not_found':
      return res.status(404).json({ message: r.message });
    case 'invalid_transition':
    case 'tracking_required':
      return res.status(400).json({ message: r.message });
    case 'refund_pending':
      return res.status(202).json({ message: r.message, order: r.order });
    default: // refund_locked, conflict, review
      return res.status(409).json({ message: r.message });
  }
}
```

3. 이제 orderController에서 사용되지 않게 된 import(`PointTransaction`, `applyPoints`, `sendOrderStatus`, `cancelOrderSaga` 등)를 확인해 실제 미사용이면 제거(createOrder 등 다른 함수가 쓰는 것은 유지 — grep으로 확인).

- [ ] **Step 5: 테스트 통과 + 전체 회귀**

Run: `cd server && npx vitest run tests/orderTransition.test.js` → PASS (6 tests)
Run: `npm test` → 전체 PASS (기존 61 + 6).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/orderTransitionService.js server/src/controllers/orderController.js server/tests/orderTransition.test.js
git commit -m "refactor(server): 주문 상태전이를 orderTransitionService로 추출 — 단건·일괄 공유 기반"
```

---

### Task 2: bulk 엔드포인트 (bulk/status + bulk/tracking)

**Files:**
- Create: `server/src/controllers/orderBulkController.js`
- Modify: `server/src/routes/orders.js`
- Test: `server/tests/orderBulk.test.js`

**Interfaces:**
- Consumes: `applyTransition`, `TRANSITIONS` (Task 1)
- Produces:
  - `POST /orders/bulk/status` body `{ ids: string[], status, trackings?: {[orderId]: {courier, trackingNumber}} }` → 200 `{ succeeded, failed: [{orderId, orderNumber, message}] }` | 400(건수/상태 오류)
  - `POST /orders/bulk/tracking` body `{ rows: [{orderNumber, courier, trackingNumber}] }` → 동일 응답(orderId 자리에 해당 주문 _id 또는 '')
  - 클라(Task 5·6)가 이 계약 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/orderBulk.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/portoneService.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, isConfigured: () => true, getPayment: vi.fn(), findPayment: vi.fn(async () => null), cancel: vi.fn(), prepare: vi.fn(), getPrepared: vi.fn() };
});

import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 0;
async function makeOrder(user, over = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `20260718-20${String(seq).padStart(4, '0')}`,
    user: user._id,
    items: [{ price: 10000, qty: 1 }],
    shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal: 10000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 10000 },
    status: 'paid',
    payment: { provider: 'portone', impUid: `imp_bk${seq}` },
    ...over,
  });
}

describe('POST /orders/bulk/status', () => {
  it('부분 성공 — 정상 2건 + 전이불가 1건 + refund잠금 1건', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer);
    const b = await makeOrder(buyer);
    const c = await makeOrder(buyer, { status: 'delivered' });
    const d = await makeOrder(buyer, { payment: { provider: 'portone', impUid: 'imp_bkl', refund: { status: 'review' } } });
    const res = await request(app).post('/orders/bulk/status').set(authHeader(admin))
      .send({ ids: [a._id, b._id, c._id, d._id], status: 'preparing' });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.failed).toHaveLength(2);
    expect(res.body.failed.map((f) => f.orderNumber).sort()).toEqual([c.orderNumber, d.orderNumber].sort());
    expect((await Order.findById(a._id)).status).toBe('preparing');
  });

  it('일반 사용자 — 403', async () => {
    const user = await createTestUser();
    const res = await request(app).post('/orders/bulk/status').set(authHeader(user)).send({ ids: ['x'], status: 'preparing' });
    expect(res.status).toBe(403);
  });

  it('빈 ids / 101건 / 잘못된 상태 — 400', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const h = authHeader(admin);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: [], status: 'preparing' })).status).toBe(400);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: Array(101).fill('a'.repeat(24)), status: 'preparing' })).status).toBe(400);
    expect((await request(app).post('/orders/bulk/status').set(h).send({ ids: ['a'.repeat(24)], status: 'paid' })).status).toBe(400); // 전이표에 없는 목표(pending→paid 등)는 건별 판정이지만, 존재하지 않는 status 값은 400
  });
});

describe('POST /orders/bulk/tracking', () => {
  it('정상 + 미존재 주문번호 + 송장 없음 혼합', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer, { status: 'preparing' });
    const res = await request(app).post('/orders/bulk/tracking').set(authHeader(admin)).send({
      rows: [
        { orderNumber: a.orderNumber, courier: 'CJ대한통운', trackingNumber: 'T123' },
        { orderNumber: '20991231-999999', courier: 'CJ대한통운', trackingNumber: 'T124' },
        { orderNumber: a.orderNumber, courier: 'CJ대한통운', trackingNumber: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toHaveLength(2);
    const saved = await Order.findById(a._id);
    expect(saved.status).toBe('shipped');
    expect(saved.trackingNumber).toBe('T123');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/orderBulk.test.js` → FAIL (404 라우트 없음).

- [ ] **Step 3: 컨트롤러 구현**

`server/src/controllers/orderBulkController.js`:

```js
import Order from '../models/Order.js';
import { applyTransition, TRANSITIONS } from '../services/orderTransitionService.js';

const MAX_BULK = 100;
const ORDER_NUMBER_RE = /^\d{8}-\d{6}$/;

// 건별 결과 수집 공통 — 실패는 건너뛰고 사유를 모은다(부분 성공).
async function runEach(entries, run) {
  const failed = [];
  let succeeded = 0;
  for (const entry of entries) {
    // 순차 실행 — 같은 주문 중복 선택 등 경합 없이 결정적으로 처리
    // eslint-disable-next-line no-await-in-loop
    const r = await run(entry).catch((e) => ({ ok: false, message: e?.message || '처리 실패' }));
    if (r.ok) succeeded += 1;
    else failed.push({ orderId: r.orderId || '', orderNumber: r.orderNumber || '', message: r.message });
  }
  return { succeeded, failed };
}

// POST /orders/bulk/status (admin) — 선택 주문 일괄 전이. 건별 applyTransition.
export async function bulkStatus(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const status = String(req.body.status || '');
  const trackings = req.body.trackings && typeof req.body.trackings === 'object' ? req.body.trackings : {};

  if (ids.length < 1 || ids.length > MAX_BULK) {
    return res.status(400).json({ message: `처리할 주문은 1~${MAX_BULK}건이어야 합니다.` });
  }
  const validTargets = new Set(Object.values(TRANSITIONS).flat());
  if (!validTargets.has(status)) {
    return res.status(400).json({ message: '잘못된 상태입니다.' });
  }

  const result = await runEach(ids, async (id) => {
    const t = trackings[id] || {};
    const r = await applyTransition(id, status, { courier: t.courier, trackingNumber: t.trackingNumber, actor: 'admin' });
    if (r.ok) return r;
    const o = await Order.findById(id).select('orderNumber').catch(() => null);
    return { ok: false, orderId: id, orderNumber: o?.orderNumber || '', message: r.message };
  });
  return res.json(result);
}

// POST /orders/bulk/tracking (admin) — 송장 CSV 업로드분 일괄 배송처리(preparing→shipped).
export async function bulkTracking(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length < 1 || rows.length > MAX_BULK) {
    return res.status(400).json({ message: `처리할 행은 1~${MAX_BULK}건이어야 합니다.` });
  }

  const result = await runEach(rows, async (row) => {
    const orderNumber = String(row?.orderNumber || '').trim();
    if (!ORDER_NUMBER_RE.test(orderNumber)) {
      return { ok: false, orderNumber, message: '주문번호 형식 오류' };
    }
    const order = await Order.findOne({ orderNumber }).select('_id');
    if (!order) return { ok: false, orderNumber, message: '주문을 찾을 수 없습니다.' };
    const r = await applyTransition(order._id, 'shipped', {
      courier: String(row?.courier || '').trim(),
      trackingNumber: String(row?.trackingNumber || '').trim(),
      actor: 'admin',
    });
    if (r.ok) return r;
    return { ok: false, orderId: String(order._id), orderNumber, message: r.message };
  });
  return res.json(result);
}
```

- [ ] **Step 4: 라우트 등록**

`server/src/routes/orders.js` — `router.get('/admin', ...)` 위에 추가:

```js
import * as orderBulkController from '../controllers/orderBulkController.js';
// ...
// 일괄 처리 (:id 라우트보다 먼저)
router.post('/bulk/status', requireAuth, requireAdmin, asyncHandler(orderBulkController.bulkStatus));
router.post('/bulk/tracking', requireAuth, requireAdmin, asyncHandler(orderBulkController.bulkTracking));
```

- [ ] **Step 5: 테스트 통과 + 회귀**

Run: `cd server && npm test` → 전체 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/orderBulkController.js server/src/routes/orders.js server/tests/orderBulk.test.js
git commit -m "feat(server): 주문 일괄 전이·송장 일괄 배송처리 API — 건별 검증·부분 성공"
```

---

### Task 3: 조회 엔드포인트 (counts·production-summary·batch·product 필터)

**Files:**
- Modify: `server/src/controllers/orderController.js` (listAllOrders product 필터 + 신규 3함수)
- Modify: `server/src/routes/orders.js`
- Test: `server/tests/orderAdminReads.test.js`

**Interfaces:**
- Produces (전부 admin):
  - `GET /orders/admin/counts` → `{ pending, paid, preparing, shipped, delivered, cancelled }` (없으면 0)
  - `GET /orders/admin/production-summary` → `{ items: [{ slug, name, nameKo, image, option, paidQty, preparingQty, totalQty, orderCount }], generatedAt }` (totalQty 내림차순)
  - `GET /orders/admin/batch?ids=a,b,c` → `{ items: Order[] }` (user populate, ids ≤ 50 초과 400)
  - `GET /orders/admin?product=<slug>` — items.slug 필터 추가

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/orderAdminReads.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();
let seq = 0;
async function makeOrder(user, status, items) {
  seq += 1;
  const itemsTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  return Order.create({
    orderNumber: `20260718-30${String(seq).padStart(4, '0')}`,
    user: user._id, items, shippingAddress: TEST_ADDRESS,
    amounts: { itemsTotal, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: itemsTotal },
    status,
  });
}
const lamp = (slug, option, qty) => ({ slug, name: slug, nameKo: slug, option, price: 10000, qty, image: 'x.jpg' });

describe('admin 조회 엔드포인트', () => {
  it('counts — 상태별 건수(없는 상태는 0)', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    await makeOrder(buyer, 'preparing', [lamp('a', null, 1)]);
    const res = await request(app).get('/orders/admin/counts').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paid: 2, preparing: 1, pending: 0, shipped: 0, delivered: 0, cancelled: 0 });
  });

  it('production-summary — 상품×옵션 그룹, 상태별 수량 분리', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('zen', 'Bone', 2), lamp('zen', 'Charcoal', 1)]);
    await makeOrder(buyer, 'preparing', [lamp('zen', 'Bone', 3)]);
    await makeOrder(buyer, 'shipped', [lamp('zen', 'Bone', 9)]); // 미발송 아님 — 제외
    const res = await request(app).get('/orders/admin/production-summary').set(authHeader(admin));
    expect(res.status).toBe(200);
    const bone = res.body.items.find((i) => i.slug === 'zen' && i.option === 'Bone');
    expect(bone).toMatchObject({ paidQty: 2, preparingQty: 3, totalQty: 5, orderCount: 2 });
    expect(res.body.items.find((i) => i.option === 'Charcoal').totalQty).toBe(1);
  });

  it('batch — 인쇄용 일괄 조회, 51건 초과 400', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    const a = await makeOrder(buyer, 'paid', [lamp('a', null, 1)]);
    const b = await makeOrder(buyer, 'paid', [lamp('b', null, 1)]);
    const res = await request(app).get(`/orders/admin/batch?ids=${a._id},${b._id}`).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].user.name).toBeTruthy();
    const tooMany = Array(51).fill(String(a._id)).join(',');
    expect((await request(app).get(`/orders/admin/batch?ids=${tooMany}`).set(authHeader(admin))).status).toBe(400);
  });

  it('listAllOrders product 필터', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await makeOrder(buyer, 'paid', [lamp('target-lamp', null, 1)]);
    await makeOrder(buyer, 'paid', [lamp('other-lamp', null, 1)]);
    const res = await request(app).get('/orders/admin?product=target-lamp').set(authHeader(admin));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].items[0].slug).toBe('target-lamp');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/orderAdminReads.test.js` → FAIL.

- [ ] **Step 3: 컨트롤러 구현**

`server/src/controllers/orderController.js`에 추가(ORDER_STATES 상수는 기존 것 재사용):

```js
// 상태별 건수 — GET /orders/admin/counts (admin). 탭 뱃지용 경량 집계.
export async function getOrderCounts(req, res) {
  const agg = await Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(agg.map((r) => [r._id, r.n]));
  res.json(Object.fromEntries(ORDER_STATES.map((s) => [s, byStatus[s] || 0])));
}

// 옵션별 제작 집계 — GET /orders/admin/production-summary (admin)
// 미발송(결제완료·제작중) 주문을 상품×옵션으로 합산 — 3D 프린터 출력 계획용.
export async function getProductionSummary(req, res) {
  const items = await Order.aggregate([
    { $match: { status: { $in: ['paid', 'preparing'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: { slug: '$items.slug', option: '$items.option' },
        name: { $first: '$items.name' },
        nameKo: { $first: '$items.nameKo' },
        image: { $first: '$items.image' },
        paidQty: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$items.qty', 0] } },
        preparingQty: { $sum: { $cond: [{ $eq: ['$status', 'preparing'] }, '$items.qty', 0] } },
        totalQty: { $sum: '$items.qty' },
        orders: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0, slug: '$_id.slug', option: '$_id.option',
        name: 1, nameKo: 1, image: 1, paidQty: 1, preparingQty: 1, totalQty: 1,
        orderCount: { $size: '$orders' },
      },
    },
    { $sort: { totalQty: -1, slug: 1 } },
  ]);
  res.json({ items, generatedAt: new Date().toISOString() });
}

// 인쇄용 일괄 조회 — GET /orders/admin/batch?ids=a,b,c (admin, ≤50건)
export async function getOrdersBatch(req, res) {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 50) {
    return res.status(400).json({ message: '인쇄할 주문은 1~50건이어야 합니다.' });
  }
  const valid = ids.filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  const items = await Order.find({ _id: { $in: valid } }).populate('user', 'name email');
  // 요청 순서 보존(인쇄 순서 = 선택 순서)
  const byId = new Map(items.map((o) => [String(o._id), o]));
  res.json({ items: valid.map((id) => byId.get(id)).filter(Boolean) });
}
```

`listAllOrders`의 filter 구성부(q 처리 아래)에 추가:

```js
  const product = String(req.query.product || '').trim();
  if (product) filter['items.slug'] = product;
```

- [ ] **Step 4: 라우트 등록**

`server/src/routes/orders.js` — `router.get('/admin', ...)` 바로 위에(경로가 더 구체적이므로 먼저):

```js
router.get('/admin/counts', requireAuth, requireAdmin, asyncHandler(orderController.getOrderCounts));
router.get('/admin/production-summary', requireAuth, requireAdmin, asyncHandler(orderController.getProductionSummary));
router.get('/admin/batch', requireAuth, requireAdmin, asyncHandler(orderController.getOrdersBatch));
```

- [ ] **Step 5: 테스트 통과 + 회귀 → Commit**

Run: `cd server && npm test` → 전체 PASS.

```bash
git add server/src/controllers/orderController.js server/src/routes/orders.js server/tests/orderAdminReads.test.js
git commit -m "feat(server): 주문 counts·옵션별 제작 집계·인쇄용 batch 조회 + product 필터"
```

---

### Task 4: CSV 내보내기 엔드포인트

**Files:**
- Create: `server/src/controllers/orderExportController.js`
- Modify: `server/src/routes/orders.js`
- Test: `server/tests/orderExport.test.js`

**Interfaces:**
- Produces: `GET /orders/admin/export?status=&from=&to=&q=&product=` (admin) → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="orders-YYYYMMDD.csv"`, UTF-8 BOM. 컬럼: 주문번호,주문일,상태,주문자,수취인,연락처,우편번호,주소,품목,결제금액,택배사,송장번호. 5,000행 초과 시 5,000행 + 마지막 안내행.
- 필터 해석은 listAllOrders와 동일해야 함 — 필터 빌드를 공용 함수로 추출.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/orderExport.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Order from '../src/models/Order.js';
import { createTestUser, authHeader, TEST_ADDRESS } from './helpers.js';

const app = createApp();

describe('GET /orders/admin/export', () => {
  it('CSV 헤더·BOM·이스케이프·필터', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const buyer = await createTestUser();
    await Order.create({
      orderNumber: '20260718-400001', user: buyer._id,
      items: [{ slug: 'zen', name: 'Zen', nameKo: '젠, "특별판"', option: 'Bone', price: 10000, qty: 2 }],
      shippingAddress: { ...TEST_ADDRESS, address1: '서울, 강남구' },
      amounts: { itemsTotal: 20000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 20000 },
      status: 'paid', courier: 'CJ대한통운', trackingNumber: 'T1',
    });
    await Order.create({
      orderNumber: '20260718-400002', user: buyer._id,
      items: [{ price: 5000, qty: 1 }], shippingAddress: TEST_ADDRESS,
      amounts: { itemsTotal: 5000, couponDiscount: 0, shippingFee: 0, pointsUsed: 0, grandTotal: 5000 },
      status: 'cancelled',
    });
    const res = await request(app).get('/orders/admin/export?status=paid').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = text.slice(1).trim().split('\n');
    expect(lines[0]).toBe('주문번호,주문일,상태,주문자,수취인,연락처,우편번호,주소,품목,결제금액,택배사,송장번호');
    expect(lines).toHaveLength(2); // 헤더 + paid 1건 (cancelled 필터 제외)
    expect(lines[1]).toContain('20260718-400001');
    expect(lines[1]).toContain('"젠, ""특별판""(Bone)x2"'); // 이스케이프
    expect(lines[1]).toContain('"서울, 강남구'); // 주소 쉼표 이스케이프
  });

  it('일반 사용자 — 403', async () => {
    const user = await createTestUser();
    expect((await request(app).get('/orders/admin/export').set(authHeader(user))).status).toBe(403);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run tests/orderExport.test.js` → FAIL.

- [ ] **Step 3: 필터 빌드 공용화**

`server/src/controllers/orderController.js`의 `listAllOrders`에서 filter 구성부(status/from/to/q/product)를 추출해 named export로:

```js
// listAllOrders·export가 공유하는 관리자 주문 필터 빌더 — 해석 규칙이 두 벌이 되지 않게.
export function buildAdminOrderFilter(query) {
  const filter = {};
  const status = String(query.status || '');
  if (ORDER_STATES.includes(status)) filter.status = status;

  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) {
    from.setHours(0, 0, 0, 0);
    filter.createdAt = { ...(filter.createdAt || {}), $gte: from };
  }
  if (to && !Number.isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
    filter.createdAt = { ...(filter.createdAt || {}), $lte: to };
  }

  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNumber: rx }, { 'shippingAddress.recipient': rx }];
  }

  const product = String(query.product || '').trim();
  if (product) filter['items.slug'] = product;
  return filter;
}
```

`listAllOrders`는 이 함수를 호출하도록 교체(동작 불변 — 기존 인라인 코드 삭제).

- [ ] **Step 4: export 컨트롤러 구현**

`server/src/controllers/orderExportController.js`:

```js
import Order from '../models/Order.js';
import { buildAdminOrderFilter } from './orderController.js';

const MAX_ROWS = 5000;
const STATUS_LABEL = {
  pending: '결제대기', paid: '결제완료', preparing: '제작중',
  shipped: '배송중', delivered: '배송완료', cancelled: '취소',
};

// RFC4180 — 쉼표·따옴표·개행 포함 시 큰따옴표로 감싸고 내부 "는 ""로.
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function kstDate(d) {
  return new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function itemsSummary(items) {
  return (items || [])
    .map((i) => `${i.nameKo || i.name || i.slug || '상품'}${i.option ? `(${i.option})` : ''}x${i.qty}`)
    .join(' / ');
}

// CSV 내보내기 — GET /orders/admin/export (admin). 필터는 listAllOrders와 동일 해석.
export async function exportOrdersCsv(req, res) {
  const filter = buildAdminOrderFilter(req.query);
  const orders = await Order.find(filter)
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS + 1);

  const truncated = orders.length > MAX_ROWS;
  const rows = (truncated ? orders.slice(0, MAX_ROWS) : orders).map((o) => [
    o.orderNumber,
    kstDate(o.createdAt),
    STATUS_LABEL[o.status] || o.status,
    o.user?.name || '',
    o.shippingAddress?.recipient || '',
    o.shippingAddress?.phone || '',
    o.shippingAddress?.zipcode || '',
    `${o.shippingAddress?.address1 || ''} ${o.shippingAddress?.address2 || ''}`.trim(),
    itemsSummary(o.items),
    o.amounts?.grandTotal ?? '',
    o.courier || '',
    o.trackingNumber || '',
  ].map(csvEscape).join(','));

  const header = '주문번호,주문일,상태,주문자,수취인,연락처,우편번호,주소,품목,결제금액,택배사,송장번호';
  const lines = [header, ...rows];
  if (truncated) lines.push(csvEscape(`※ ${MAX_ROWS}행 초과 — 기간 필터로 나눠 내려받으세요`));

  const stamp = kstDate(new Date()).slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${stamp}.csv"`);
  res.send(`﻿${lines.join('\n')}`);
}
```

- [ ] **Step 5: 라우트 등록**

`server/src/routes/orders.js` — counts 라우트들 옆에:

```js
import * as orderExportController from '../controllers/orderExportController.js';
// ...
router.get('/admin/export', requireAuth, requireAdmin, asyncHandler(orderExportController.exportOrdersCsv));
```

- [ ] **Step 6: 테스트 통과 + 회귀 → Commit**

Run: `cd server && npm test` → 전체 PASS.

```bash
git add server/src/controllers/orderExportController.js server/src/controllers/orderController.js server/src/routes/orders.js server/tests/orderExport.test.js
git commit -m "feat(server): 주문 CSV 내보내기 — BOM·RFC4180 이스케이프·5000행 상한·공용 필터"
```

---

### Task 5: OrdersAdmin 재구성 — 탭바·체크박스·일괄 액션바·인라인 송장

**Files:**
- Modify: `client/src/lib/admin.js` (헬퍼 추가)
- Create: `client/src/components/admin/OrderBulkBar.jsx`
- Modify: `client/src/pages/admin/OrdersAdmin.jsx` (전면 재구성)

**Interfaces:**
- Consumes: `POST /orders/bulk/status`, `GET /orders/admin/counts` (Task 2·3 계약)
- Produces(라이브러리 — Task 6·7·8도 사용):

```js
// lib/admin.js에 추가
export const COURIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', '기타'];
export async function fetchOrderCounts() { const { data } = await api.get('/orders/admin/counts'); return data; }
export async function bulkOrderStatus(body) { const { data } = await api.post('/orders/bulk/status', body); return data; }
export async function bulkTracking(rows) { const { data } = await api.post('/orders/bulk/tracking', { rows }); return data; }
export async function fetchProductionSummary() { const { data } = await api.get('/orders/admin/production-summary'); return data; }
export async function fetchOrdersBatch(ids) { const { data } = await api.get('/orders/admin/batch', { params: { ids: ids.join(',') } }); return data.items; }
export async function downloadOrdersCsv(params = {}) {
  const res = await api.get('/orders/admin/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- `OrderBulkBar` props: `{ tab, count, busy, onAction(action), result, onClearResult }` — action ∈ `'preparing' | 'shipped' | 'delivered' | 'cancelled' | 'print'`. result = bulk 응답(`{succeeded, failed}`) 또는 null.

- [ ] **Step 1: lib/admin.js 헬퍼 추가**

위 Produces 블록의 코드를 `client/src/lib/admin.js` 파일 끝 `// ── 리뷰 관리` 섹션 앞에 `// ── 주문 일괄·집계 ──` 섹션으로 추가.

- [ ] **Step 2: OrderBulkBar 작성**

`client/src/components/admin/OrderBulkBar.jsx`:

```jsx
// 선택 주문 일괄 액션 바 — 탭 맥락에 맞는 버튼만 노출하고, 처리 결과(부분 실패 사유)를 표시한다.
const ACTIONS_BY_TAB = {
  paid: [{ key: 'preparing', label: '제작 시작' }, { key: 'cancelled', label: '주문 취소', danger: true }],
  preparing: [{ key: 'shipped', label: '배송처리' }, { key: 'cancelled', label: '주문 취소', danger: true }],
  shipped: [{ key: 'delivered', label: '배송완료' }],
  pending: [{ key: 'cancelled', label: '주문 취소', danger: true }],
};

export default function OrderBulkBar({ tab, count, busy, onAction, result, onClearResult }) {
  const actions = ACTIONS_BY_TAB[tab] || [];
  return (
    <div className="mt-4">
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-ink bg-tint/40 px-4 py-2.5">
          <span className="text-[13px] font-semibold">{count}건 선택</span>
          {actions.map((a) => (
            <button
              key={a.key}
              disabled={busy}
              onClick={() => onAction(a.key)}
              className={`border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
                a.danger ? 'border-sale/40 text-sale hover:bg-sale/5' : 'border-ink hover:bg-tint'
              }`}
            >
              {a.label}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => onAction('print')}
            className="border border-line px-3.5 py-1.5 text-[13px] hover:border-ink disabled:opacity-50"
          >
            주문서 인쇄
          </button>
        </div>
      )}
      {result && (
        <div className="mt-2 border border-line bg-paper px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between">
            <p>
              <span className="font-semibold">{result.succeeded}건 처리</span>
              {result.failed.length > 0 && <span className="ml-2 text-sale">{result.failed.length}건 실패</span>}
            </p>
            <button onClick={onClearResult} className="text-[12px] text-mute hover:text-ink">닫기</button>
          </div>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-mute">
              {result.failed.map((f, i) => (
                <li key={i}>· {f.orderNumber || f.orderId}: {f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: OrdersAdmin 재구성**

`client/src/pages/admin/OrdersAdmin.jsx` 전체 교체:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchAdminOrders, fetchOrderCounts, bulkOrderStatus, downloadOrdersCsv,
  ORDER_STATUS_LABEL, COURIERS,
} from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import Pagination from '../../components/admin/Pagination.jsx';
import OrderBulkBar from '../../components/admin/OrderBulkBar.jsx';
import TrackingCsvModal from '../../components/admin/TrackingCsvModal.jsx';

// 스마트스토어식 탭 — 값은 status 쿼리파라미터 그대로, '신규주문'은 paid의 운영 라벨
const TABS = [
  { value: '', label: '전체' },
  { value: 'pending', label: '결제대기' },
  { value: 'paid', label: '신규주문' },
  { value: 'preparing', label: '제작중' },
  { value: 'shipped', label: '배송중' },
  { value: 'delivered', label: '배송완료' },
  { value: 'cancelled', label: '취소' },
];

export default function OrdersAdmin() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const product = params.get('product') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 30 });
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(q);
  const [selected, setSelected] = useState(() => new Set());
  const [trackings, setTrackings] = useState({}); // {orderId: {courier, trackingNumber}} — 제작중 탭 인라인 입력
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const load = () => {
    setLoading(true);
    return fetchAdminOrders({ status: status || undefined, q: q || undefined, product: product || undefined, page })
      .then(setData)
      .catch(() => setData({ items: [], total: 0, limit: 30 }))
      .finally(() => setLoading(false));
  };
  const loadCounts = () => fetchOrderCounts().then(setCounts).catch(() => {});

  useEffect(() => {
    let active = true;
    setSelected(new Set()); // 필터·페이지 변경 시 선택 초기화
    setResult(null);
    fetchAdminOrders({ status: status || undefined, q: q || undefined, product: product || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setData({ items: [], total: 0, limit: 30 }))
      .finally(() => active && setLoading(false));
    setLoading(true);
    loadCounts();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q, product, page]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  useEffect(() => { setTerm(q); }, [q]);

  const pageIds = useMemo(() => data.items.map((o) => o._id), [data.items]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(pageIds));
  const toggleOne = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const setTracking = (id, field, value) =>
    setTrackings((prev) => ({ ...prev, [id]: { courier: COURIERS[0], ...prev[id], [field]: value } }));

  const runBulk = async (action) => {
    const ids = [...selected];
    if (action === 'print') {
      window.open(`/admin/orders/print?ids=${ids.join(',')}`, '_blank');
      return;
    }
    if (action === 'cancelled' && !window.confirm(`선택한 ${ids.length}건을 취소할까요?\n(결제된 주문은 전액 환불됩니다)`)) return;

    // 배송처리는 송장 입력분만 서버로 — 미입력분은 클라에서 사전 실패 처리
    let sendIds = ids;
    const preFailed = [];
    const body = { ids, status: action };
    if (action === 'shipped') {
      sendIds = ids.filter((id) => trackings[id]?.trackingNumber?.trim());
      ids.filter((id) => !sendIds.includes(id)).forEach((id) => {
        const o = data.items.find((x) => x._id === id);
        preFailed.push({ orderId: id, orderNumber: o?.orderNumber || '', message: '송장번호 미입력' });
      });
      if (sendIds.length === 0) {
        setResult({ succeeded: 0, failed: preFailed });
        return;
      }
      body.ids = sendIds;
      body.trackings = Object.fromEntries(sendIds.map((id) => [id, trackings[id]]));
    }

    setBusy(true);
    try {
      const r = await bulkOrderStatus(body);
      const merged = { succeeded: r.succeeded, failed: [...preFailed, ...r.failed] };
      setResult(merged);
      toast.success(`${merged.succeeded}건 처리${merged.failed.length ? ` · ${merged.failed.length}건 실패` : ''}`);
      setSelected(new Set());
      await Promise.all([load(), loadCounts()]);
    } catch (e) {
      toast.error(e.response?.data?.message || '일괄 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">주문</h1>
        <div className="flex gap-2">
          {status === 'preparing' && (
            <button onClick={() => setCsvOpen(true)} className="border border-line px-3.5 py-2 text-[13px] hover:border-ink">
              송장 CSV 업로드
            </button>
          )}
          <button
            onClick={() => downloadOrdersCsv({ status: status || undefined, q: q || undefined, product: product || undefined })}
            className="border border-line px-3.5 py-2 text-[13px] hover:border-ink"
          >
            내보내기(CSV)
          </button>
        </div>
      </div>

      {/* 상태 탭 + 건수 뱃지 */}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const active = status === t.value;
          const n = t.value === '' ? null : counts?.[t.value];
          return (
            <button
              key={t.value}
              onClick={() => patch({ status: t.value })}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                active ? 'border-ink font-semibold text-ink' : 'border-transparent text-mute hover:text-ink'
              }`}
            >
              {t.label}
              {n != null && n > 0 && <span className="ml-1.5 rounded-full bg-tint px-1.5 text-[11px] text-mute">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }} className="flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="주문번호·받는사람"
            className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
        </form>
        {product && (
          <button onClick={() => patch({ product: '' })} className="border border-line px-3 py-2 text-[12px] text-mute hover:border-ink">
            상품 필터: {product} ✕
          </button>
        )}
      </div>

      <OrderBulkBar
        tab={status}
        count={selected.size}
        busy={busy}
        onAction={runBulk}
        result={result}
        onClearResult={() => setResult(null)}
      />

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : data.total === 0 ? (
        <p className="py-10 text-center text-mute">주문이 없습니다.</p>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}건</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-mute">
                  <th className="w-8 py-2 pr-2">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-ink" />
                  </th>
                  <th className="py-2 pr-3">주문번호</th>
                  <th className="py-2 pr-3">일자</th>
                  <th className="py-2 pr-3">고객</th>
                  <th className="py-2 pr-3">품목</th>
                  <th className="py-2 pr-3">금액</th>
                  <th className="py-2 pr-3">상태</th>
                  {status === 'preparing' && <th className="py-2 pr-3">택배사 / 송장번호</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o._id} className="border-b border-line hover:bg-tint/40">
                    <td className="py-3 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggleOne(o._id)} className="accent-ink" />
                    </td>
                    <td onClick={() => nav(`/admin/orders/${o._id}`)} className="cursor-pointer py-3 pr-3 font-medium">{o.orderNumber}</td>
                    <td className="py-3 pr-3 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</td>
                    <td className="py-3 pr-3">{o.user?.name || o.shippingAddress?.recipient || '-'}</td>
                    <td className="max-w-[220px] truncate py-3 pr-3 text-[12px] text-mute">
                      {o.items?.[0] ? `${o.items[0].nameKo || o.items[0].name}${o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ''}` : '-'}
                    </td>
                    <td className="py-3 pr-3">{won(o.amounts.grandTotal)}원</td>
                    <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                    {status === 'preparing' && (
                      <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          <select
                            value={trackings[o._id]?.courier || COURIERS[0]}
                            onChange={(e) => setTracking(o._id, 'courier', e.target.value)}
                            className="border border-line px-1.5 py-1 text-[12px] focus:border-ink focus:outline-none"
                          >
                            {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            value={trackings[o._id]?.trackingNumber || ''}
                            onChange={(e) => setTracking(o._id, 'trackingNumber', e.target.value)}
                            placeholder="송장번호"
                            className="w-32 border border-line px-2 py-1 text-[12px] focus:border-ink focus:outline-none"
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}

      {csvOpen && (
        <TrackingCsvModal
          onClose={() => setCsvOpen(false)}
          onDone={async (r) => {
            setResult(r);
            setCsvOpen(false);
            await Promise.all([load(), loadCounts()]);
          }}
        />
      )}
    </div>
  );
}
```

주의: `TrackingCsvModal`은 Task 6에서 만든다 — 이 태스크에서는 임시 스텁 `client/src/components/admin/TrackingCsvModal.jsx`를 함께 생성해 빌드를 깨지 않는다:

```jsx
// Task 6에서 실제 구현으로 교체되는 스텁
export default function TrackingCsvModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30" onClick={onClose}>
      <div className="bg-paper p-6 text-sm">CSV 업로드는 준비 중입니다.</div>
    </div>
  );
}
```

- [ ] **Step 4: 빌드 + 수동 검증**

Run: `cd client && VITE_API_URL=https://example.onrender.com npx vite build` → 성공.

수동(로컬 dev): /admin/orders에서 탭 전환·뱃지 건수, 신규주문 탭 체크 → `제작 시작` → 제작중 탭에서 송장 입력 → `배송처리` → 배송중 탭 `배송완료`. 미입력 행 포함 배송처리 시 실패 패널에 "송장번호 미입력". 내보내기 버튼으로 CSV 다운로드(엑셀에서 한글 확인).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/admin.js client/src/components/admin/OrderBulkBar.jsx client/src/components/admin/TrackingCsvModal.jsx client/src/pages/admin/OrdersAdmin.jsx
git commit -m "feat(admin): 주문 작업대 — 상태 탭·일괄 전이·인라인 송장·CSV 내보내기"
```

---

### Task 6: TrackingCsvModal — 송장 CSV 업로드

**Files:**
- Create: `client/src/lib/csv.js`
- Modify: `client/src/components/admin/TrackingCsvModal.jsx` (스텁 → 실구현)

**Interfaces:**
- Consumes: `bulkTracking(rows)` (Task 5 lib)
- Produces: `parseTrackingCsv(text) → { rows: [{orderNumber, courier, trackingNumber}], errors: [{line, message}] }` — BOM 제거, 헤더 행 자동 감지, 따옴표 필드 지원. Modal props `{ onClose, onDone(result) }`.

- [ ] **Step 1: CSV 파서 작성**

`client/src/lib/csv.js`:

```js
// 송장 CSV 파서 — 3열(주문번호, 택배사, 송장번호) 고정. 외부 라이브러리 없이
// RFC4180의 따옴표 필드만 지원(필드 내 개행은 미지원 — 송장 데이터에 불필요).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseTrackingCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  const errors = [];
  lines.forEach((line, idx) => {
    const cols = splitCsvLine(line).map((c) => c.trim());
    if (idx === 0 && /주문번호|orderNumber/i.test(cols[0])) return; // 헤더 행
    const [orderNumber = '', courier = '', trackingNumber = ''] = cols;
    if (!/^\d{8}-\d{6}$/.test(orderNumber)) {
      errors.push({ line: idx + 1, message: `주문번호 형식 오류: ${orderNumber || '(빈 값)'}` });
      return;
    }
    if (!trackingNumber) {
      errors.push({ line: idx + 1, message: `송장번호 없음: ${orderNumber}` });
      return;
    }
    rows.push({ orderNumber, courier, trackingNumber });
  });
  return { rows, errors };
}
```

- [ ] **Step 2: Modal 실구현**

`client/src/components/admin/TrackingCsvModal.jsx` 전체 교체:

```jsx
import { useState } from 'react';
import { parseTrackingCsv } from '../../lib/csv.js';
import { bulkTracking } from '../../lib/admin.js';

// 송장 CSV 업로드 — 파싱 미리보기(정상/오류 분리) 후 확인 시에만 서버 호출.
// CSV 형식: 주문번호, 택배사, 송장번호 (헤더 행 자동 감지)
export default function TrackingCsvModal({ onClose, onDone }) {
  const [parsed, setParsed] = useState(null); // {rows, errors}
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErr('');
    const text = await file.text();
    const p = parseTrackingCsv(text);
    if (p.rows.length > 100) {
      setErr('한 번에 100건까지 업로드할 수 있습니다. 파일을 나눠주세요.');
      setParsed(null);
      return;
    }
    setParsed(p);
  };

  const submit = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const r = await bulkTracking(parsed.rows);
      // 파싱 단계 오류도 실패 목록에 합쳐 한 번에 보여준다
      onDone({
        succeeded: r.succeeded,
        failed: [
          ...parsed.errors.map((x) => ({ orderId: '', orderNumber: `${x.line}행`, message: x.message })),
          ...r.failed,
        ],
      });
    } catch (e2) {
      setErr(e2.response?.data?.message || '업로드 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md border border-line bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-bold">송장 CSV 업로드</h2>
        <p className="mt-1 text-[12px] text-mute">형식: 주문번호, 택배사, 송장번호 — 내보내기(CSV) 파일에 송장을 채워 올려도 됩니다(앞 3열만 사용… 아님 — 주문번호·택배사·송장 3열로 정리해 주세요).</p>

        <label className="mt-4 block cursor-pointer border border-dashed border-line px-4 py-6 text-center text-[13px] text-mute hover:border-ink">
          {fileName || 'CSV 파일 선택'}
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        </label>

        {err && <p className="mt-2 text-[12px] text-sale">{err}</p>}

        {parsed && (
          <div className="mt-3 text-[13px]">
            <p><span className="font-semibold">{parsed.rows.length}건</span> 배송처리 가능
              {parsed.errors.length > 0 && <span className="ml-2 text-sale">{parsed.errors.length}건 형식 오류</span>}
            </p>
            {parsed.errors.length > 0 && (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-[12px] text-mute">
                {parsed.errors.map((x, i) => <li key={i}>· {x.line}행: {x.message}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-line py-2.5 text-sm hover:border-ink">닫기</button>
          <button
            onClick={submit}
            disabled={busy || !parsed?.rows.length}
            className="flex-1 bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
          >
            {busy ? '처리 중…' : `${parsed?.rows.length || 0}건 배송처리`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(안내 문구의 어색한 괄호 부분은 구현 시 "형식: 주문번호, 택배사, 송장번호 (첫 행이 제목이면 자동으로 건너뜁니다)"로 다듬는다.)

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `cd client && VITE_API_URL=https://example.onrender.com npx vite build` → 성공.
수동: 제작중 탭 → 송장 CSV 업로드 → 정상 2행+오류 1행 파일 → 미리보기 건수 확인 → 배송처리 → 결과 패널·목록 갱신 확인.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/csv.js client/src/components/admin/TrackingCsvModal.jsx
git commit -m "feat(admin): 송장 CSV 업로드 — 자체 파서·미리보기·일괄 배송처리"
```

---

### Task 7: 제작 리스트 페이지 (/admin/production)

**Files:**
- Create: `client/src/pages/admin/Production.jsx`
- Modify: `client/src/components/admin/AdminLayout.jsx` (사이드바 메뉴)
- Modify: `client/src/App.jsx` (라우트)

**Interfaces:**
- Consumes: `fetchProductionSummary()` (Task 5 lib — `{items, generatedAt}`), `cldUrl` (기존 lib/cloudinary.js)
- Produces: `/admin/production` 라우트. 행 클릭 → `/admin/orders?product=<slug>&status=paid`.

- [ ] **Step 1: 페이지 작성**

`client/src/pages/admin/Production.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProductionSummary } from '../../lib/admin.js';
import { cldUrl } from '../../lib/cloudinary.js';

// 옵션별 제작 집계 — 미발송(결제완료·제작중) 주문을 상품×옵션 수량으로 합산.
// 3D 프린터 출력 계획용. 인쇄 시 사이드바·버튼은 print CSS로 숨긴다(AdminLayout에 print:hidden).
export default function Production() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProductionSummary().then(setData).catch(() => setError('집계를 불러오지 못했습니다.'));
  }, []);

  if (error) return <p className="py-12 text-center text-mute">{error}</p>;
  if (!data) return <p className="py-12 text-center text-mute">불러오는 중…</p>;

  const totals = data.items.reduce(
    (a, i) => ({ paid: a.paid + i.paidQty, preparing: a.preparing + i.preparingQty, total: a.total + i.totalQty }),
    { paid: 0, preparing: 0, total: 0 },
  );

  return (
    <div className="production-print">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">제작 리스트</h1>
        <button onClick={() => window.print()} className="border border-ink px-4 py-2 text-sm hover:bg-tint">인쇄</button>
      </div>
      <p className="mt-1 text-[12px] text-mute">
        미발송(결제완료·제작중) 기준 · {new Date(data.generatedAt).toLocaleString('ko-KR')}
      </p>

      {data.items.length === 0 ? (
        <p className="py-12 text-center text-mute">제작할 주문이 없습니다.</p>
      ) : (
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-[12px] text-mute">
              <th className="py-2 pr-3">상품</th>
              <th className="py-2 pr-3">옵션</th>
              <th className="py-2 pr-3 text-right">신규주문</th>
              <th className="py-2 pr-3 text-right">제작중</th>
              <th className="py-2 pr-3 text-right">합계</th>
              <th className="py-2 pr-3 text-right">주문 건수</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr
                key={`${i.slug}-${i.option || ''}`}
                onClick={() => nav(`/admin/orders?product=${encodeURIComponent(i.slug)}&status=paid`)}
                className="cursor-pointer border-b border-line hover:bg-tint/40"
              >
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    {i.image && <img src={cldUrl(i.image, { w: 80, square: true })} alt="" className="h-9 w-9 bg-tint object-cover print:hidden" />}
                    <span className="font-medium">{i.nameKo || i.name}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-mute">{i.option || '-'}</td>
                <td className="py-2.5 pr-3 text-right">{i.paidQty}</td>
                <td className="py-2.5 pr-3 text-right">{i.preparingQty}</td>
                <td className="py-2.5 pr-3 text-right font-bold">{i.totalQty}</td>
                <td className="py-2.5 pr-3 text-right text-mute">{i.orderCount}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-bold">
              <td className="py-2.5 pr-3">합계</td>
              <td className="py-2.5 pr-3" />
              <td className="py-2.5 pr-3 text-right">{totals.paid}</td>
              <td className="py-2.5 pr-3 text-right">{totals.preparing}</td>
              <td className="py-2.5 pr-3 text-right">{totals.total}</td>
              <td className="py-2.5 pr-3" />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 사이드바·라우트 등록**

`client/src/components/admin/AdminLayout.jsx` — 사이드바 NAV 배열(파일 상단의 메뉴 정의)에서 `주문` 항목 다음에 `{ to: '/admin/production', label: '제작' }` 추가. 사이드바 컨테이너(aside 또는 nav 루트 요소)에 `print:hidden` 클래스 추가(Tailwind print variant — 제작 리스트 인쇄 시 메뉴 숨김). 상단 바에도 동일하게 `print:hidden`.

`client/src/App.jsx` — admin 라우트 블록의 `orders/:id` 아래에:

```jsx
        <Route path="production" element={<Production />} />
```

(상단 import: `import Production from './pages/admin/Production.jsx';`)

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `cd client && VITE_API_URL=https://example.onrender.com npx vite build` → 성공.
수동: /admin/production 집계 표·합계 행, 인쇄 미리보기(Cmd+P — 사이드바·버튼·썸네일 숨김), 행 클릭 → 주문 목록 product 필터 진입.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/Production.jsx client/src/components/admin/AdminLayout.jsx client/src/App.jsx
git commit -m "feat(admin): 옵션별 제작 리스트 — 미발송 집계·인쇄·주문 드릴다운"
```

---

### Task 8: 주문서 인쇄 라우트 + OrderDetail 버튼 + 최종 검증

**Files:**
- Create: `client/src/pages/admin/OrderPrint.jsx`
- Modify: `client/src/App.jsx` (AdminLayout 밖 라우트)
- Modify: `client/src/pages/admin/OrderDetail.jsx` (인쇄 버튼)

**Interfaces:**
- Consumes: `fetchOrdersBatch(ids)` (Task 5 lib), `RequireAdmin`
- Produces: `/admin/orders/print?ids=a,b,c` — 주문당 1페이지 포장용 주문서, 자동 window.print().

- [ ] **Step 1: 인쇄 페이지 작성**

`client/src/pages/admin/OrderPrint.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchOrdersBatch } from '../../lib/admin.js';

// 포장용 주문서 — 주문당 1페이지, 금액 미포함(포장 작업장용).
// AdminLayout 밖 전용 라우트라 사이드바 없음. 로드 완료 시 자동 인쇄.
export default function OrderPrint() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const ids = (params.get('ids') || '').split(',').filter(Boolean);
    if (ids.length === 0) { setError('인쇄할 주문이 없습니다.'); return; }
    fetchOrdersBatch(ids)
      .then((items) => {
        setOrders(items);
        // 렌더 완료 후 인쇄 대화상자 — 이미지 없음이라 짧은 지연이면 충분
        setTimeout(() => window.print(), 300);
      })
      .catch((e) => setError(e.response?.data?.message || '주문을 불러오지 못했습니다.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="py-16 text-center text-sm text-mute">{error}</p>;
  if (!orders) return <p className="py-16 text-center text-sm text-mute">주문서를 준비하고 있습니다…</p>;

  return (
    <div className="mx-auto max-w-[720px] px-6 py-4 text-ink">
      <p className="mb-4 text-center text-[12px] text-mute print:hidden">
        인쇄 대화상자가 뜨지 않으면 <button onClick={() => window.print()} className="underline">여기</button>를 누르세요.
      </p>
      {orders.map((o) => (
        <section key={o._id} className="order-sheet mb-10 border border-ink p-6" style={{ pageBreakAfter: 'always' }}>
          <header className="flex items-baseline justify-between border-b-2 border-ink pb-3">
            <h1 className="text-lg font-extrabold tracking-tight">STACK N&apos; STAK 주문서</h1>
            <div className="text-right text-[12px]">
              <p className="font-bold">{o.orderNumber}</p>
              <p className="text-mute">{o.createdAt?.slice(0, 10)}</p>
            </div>
          </header>

          <dl className="mt-4 space-y-1.5 text-[13px]">
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">받는사람</dt><dd className="font-semibold">{o.shippingAddress.recipient}</dd></div>
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">연락처</dt><dd>{o.shippingAddress.phone || '-'}</dd></div>
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">주소</dt><dd>({o.shippingAddress.zipcode}) {o.shippingAddress.address1} {o.shippingAddress.address2}</dd></div>
            {o.shippingAddress.deliveryMemo && (
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">배송메모</dt><dd className="font-bold">{o.shippingAddress.deliveryMemo}</dd></div>
            )}
          </dl>

          <table className="mt-5 w-full text-[13px]">
            <thead>
              <tr className="border-y border-ink text-left text-[12px]">
                <th className="py-1.5 pr-2">품목</th>
                <th className="py-1.5 pr-2">옵션</th>
                <th className="py-1.5 text-right">수량</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-2 pr-2 font-medium">{it.nameKo || it.name}</td>
                  <td className="py-2 pr-2">{it.option || '-'}</td>
                  <td className="py-2 text-right font-bold">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(o.courier || o.trackingNumber) && (
            <p className="mt-4 text-[12px] text-mute">배송: {o.courier || '-'} {o.trackingNumber || ''}</p>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 라우트 등록 (AdminLayout 밖)**

`client/src/App.jsx` — admin 중첩 라우트 블록 **밖**, `/admin` Route와 나란히:

```jsx
        <Route
          path="/admin/orders/print"
          element={
            <RequireAdmin>
              <OrderPrint />
            </RequireAdmin>
          }
        />
```

(import: `import OrderPrint from './pages/admin/OrderPrint.jsx';`)
주의: react-router는 더 구체적 경로를 우선 매칭하므로 선언 순서와 무관하게 `/admin/orders/print`가 중첩 `orders/:id`보다 우선하지만, **`/admin` 중첩 블록보다 앞에 선언**해 명시성을 유지한다.

- [ ] **Step 3: OrderDetail 인쇄 버튼**

`client/src/pages/admin/OrderDetail.jsx` — 헤더의 `<StatusBadge …/>` 옆(환불 뱃지 뒤)에:

```jsx
        <button
          onClick={() => window.open(`/admin/orders/print?ids=${o._id}`, '_blank')}
          className="ml-auto border border-line px-3 py-1.5 text-[12px] hover:border-ink"
        >
          주문서 인쇄
        </button>
```

(헤더 컨테이너가 `flex items-center gap-3`이므로 `ml-auto`로 우측 정렬.)

- [ ] **Step 4: 빌드 + 최종 수동 검증 (전 기능)**

```bash
cd client && VITE_API_URL=https://example.onrender.com npx vite build   # 성공
cd ../server && npm test                                               # 전체 PASS
```

수동 체크리스트(로컬 dev, admin 계정):
1. 탭 뱃지 건수가 실제와 일치, 탭 전환 시 목록·URL 동기화
2. 신규주문 탭: 2건 선택 → 제작 시작 → "2건 처리" + 제작중 탭 뱃지 증가
3. 제작중 탭: 1건 송장 입력 + 1건 미입력 선택 → 배송처리 → "1건 처리 · 1건 실패(송장번호 미입력)"
4. 송장 CSV 업로드: 정상 1행+형식오류 1행 → 미리보기 → 처리 결과 패널
5. 배송중 탭: 배송완료 일괄
6. 환불 review 주문 포함 일괄 시 해당 건 실패 사유 표시
7. 내보내기 CSV를 엑셀로 열어 한글·품목 병기 확인
8. /admin/production: 집계·합계·인쇄 미리보기·드릴다운
9. 주문 2건 선택 → 주문서 인쇄 → 2페이지, 금액 없음, 배송메모 굵게
10. OrderDetail 단건 인쇄 버튼

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/OrderPrint.jsx client/src/App.jsx client/src/pages/admin/OrderDetail.jsx
git commit -m "feat(admin): 포장용 주문서 인쇄 — 일괄/단건, 주문당 1페이지"
```

---

## Self-Review 결과 (계획 작성 시점)

- **스펙 커버리지**: §2.1 전이 추출(T1), §2.2 bulk 2종(T2)·counts/summary/batch(T3)·export(T4)·product 필터(T3), §2.3 라우트 순서(T2·T3 Step 명시), §3 OrdersAdmin·BulkBar·인라인 송장(T5)·CSV 모달(T6)·내보내기 blob(T5 lib), §4 제작 리스트(T7), §5 인쇄(T8), §6 상한·검증(각 태스크), §7 테스트(각 태스크+T8 체크리스트). 누락 없음.
- **선후 의존**: T5가 T6의 TrackingCsvModal을 스텁으로 선생성 — Step에 명시. T5의 lib 헬퍼를 T6·T7·T8이 사용.
- **타입 일치**: applyTransition 반환 코드, bulk 응답 {succeeded, failed[{orderId, orderNumber, message}]}, summary 필드(paidQty/preparingQty/totalQty/orderCount), COURIERS 목록이 태스크 간 동일함 확인.
- T6 모달 안내 문구의 어색한 부분은 구현 시 다듬으라는 지시를 Step에 포함.

## 실행 메모

- 순서 고정 1→8. 서버(1~4) 완료 후 클라(5~8).
- 수동 검증용 시드: 로컬 pgtest 계정으로 주문 3~4건 생성(기존 E2E 데이터 재사용 가능).
