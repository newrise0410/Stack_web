# 포트원(아임포트) v1 PG 연동 설계

날짜: 2026-07-17
상태: 승인 대기
범위: 모의 결제(mock)를 포트원 v1 SDK + KG이니시스 테스트 채널 카드결제로 완전 대체. Codex 교차검증에서 나온 결함 전부 반영(트랜잭션·outbox·환불 saga·reconciler·sweeper 포함).

## 1. 목표와 전제

- 결제 플로우: **선주문(pending) → IMP.request_pay 결제창 → 서버 검증 → paid 확정**.
- 서버가 금액의 유일한 출처(현행 유지). 포트원 사전등록(prepare)이 1차, 서버 재조회 검증이 2차로 금액 변조 차단.
- 포트원 계정 보유, 테스트 모드(실청구 없음). SDK는 v1(`IMP.request_pay`), REST는 v1(`api.iamport.kr`).
- 프로덕션 DB는 Atlas(replica set — 트랜잭션 가능), 로컬은 standalone일 수 있음 → 트랜잭션 헬퍼에 폴백 내장.
- 배포 백엔드는 Render 단일 인스턴스 → 백그라운드 잡은 in-process interval로 충분(분산 락 불필요, 문서화된 전제).

## 2. 데이터 모델

### 2.1 Order 변경 (`server/src/models/Order.js`)

`status` enum은 유지(`pending, paid, preparing, shipped, delivered, cancelled`). 결제·환불의 세부 상태는 `payment` 서브도큐먼트로 관리한다.

```js
payment: {
  provider: String,            // 'portone' | 'none'(0원 주문)
  pg: String,                  // 'html5_inicis' 등 (포트원 응답 pg_provider 스냅샷)
  method: String,              // 'card' | 'points'(0원)
  impUid: String,              // partial unique index ($type: 'string')
  paidAt: Date,                // 포트원 paid_at(Unix seconds) * 1000
  receiptUrl: String,
  failReason: String,
  prepareStatus: String,       // 'preparing' | 'prepared' | 'failed'
  preparedAmount: Number,      // prepare에 등록한 금액(멱등 재검사용)
  expiresAt: Date,             // 생성 + 30분. sweeper 대상 판정 기준
  refund: {
    status: String,            // 'none'|'requested'|'processing'|'done'|'review'
    reason: String,            // 사용자/관리자/금액불일치/중복결제/외부취소 등
    requestedAt: Date,
    completedAt: Date,
    cancelAmount: Number,      // 포트원에 요청/확인된 취소 금액
  },
}
```

인덱스:

```js
orderSchema.index(
  { 'payment.impUid': 1 },
  { unique: true, partialFilterExpression: { 'payment.impUid': { $type: 'string' } } },
);
orderSchema.index({ status: 1, 'payment.expiresAt': 1 });   // sweeper 스캔용
```

규칙:

- `paymentMethod` 필드는 `'card'` 또는 `'points'`로 저장(mock 폐기).
- `refund.status`가 `requested|processing|review`인 동안 외부 경로(사용자/관리자 API)의 상태 전이를 차단한다. 환불 saga·reconciler 내부 전이는 예외.
- `refund.status='review'`는 자동 처리 불가 사고 상태(중복 결제, 부분취소 감지, 배송 후 외부취소 등). 관리자 화면에 플래그 노출, 해소는 수동.

### 2.2 OrderEvent (outbox, 신규 `server/src/models/OrderEvent.js`)

paid/cancelled 전이의 부수효과를 crash-safe·exactly-once로 만들기 위한 outbox.

```js
{
  orderId: ObjectId,
  type: String,        // 'paid_email' | 'paid_sales_inc' | 'cancel_email' | 'cancel_sales_dec' | 'status_email:<status>'
  uniqueKey: String,   // `${orderId}:${type}` — unique index
  payload: Object,     // 수신자 스냅샷(email, name), items 스냅샷 등 — 웹훅 경로엔 req.user가 없으므로 필수
  status: String,      // 'pending' | 'done' | 'failed'
  attempts: Number,
  lastError: String,
  createdAt / processedAt,
}
```

- 상태 전이 트랜잭션 안에서 insert(unique 충돌 시 무시 = 이미 예약됨).
- in-process worker가 30초 간격으로 `pending` 이벤트를 CAS(`findOneAndUpdate status:'pending'→'processing'`)로 claim 후 실행. 5회 실패 시 `failed`(로그).
- salesCount 증감은 outbox 이벤트로만 수행 → 중복 증감·음수 방지(이벤트가 exactly-once 장벽).

### 2.3 WebhookLog (inbox, 신규 `server/src/models/WebhookLog.js`)

감사와 중복 억제용 경량 inbox.

```js
{ impUid, merchantUid, rawStatus, receivedAt, result: 'processed'|'ignored'|'error', note }
```

## 3. 포트원 서비스 (`server/src/services/portoneService.js`)

- `getToken()`: `POST /users/getToken` `{imp_key, imp_secret}`. 만료 전 캐시(expired_at은 Unix seconds).
- `getPayment(impUid)`: `GET /payments/{imp_uid}`.
- `findPayment(merchantUid)`: `GET /payments/find/{merchant_uid}` — pending 취소 전 "결제 존재 여부" 확인용.
- `prepare(merchantUid, amount)`: `POST /payments/prepare`.
- `cancel({ impUid, amount, checksum, reason })`: `POST /payments/cancel`. `checksum`은 직전 조회의 `amount - cancel_amount`.
- 공통 규약:
  - `Authorization` 헤더에 access_token **원문**(Bearer 접두사 없음).
  - 모든 응답은 `{code, message, response}` envelope → HTTP 2xx여도 `code !== 0`이면 에러.
  - axios timeout 10초. 타임아웃/5xx는 `PortoneUnknownError`(결과 불명)로 구분해 던짐 — 호출부가 "실패 확정"과 "재조회 필요"를 구별.
  - 에러는 서비스 경계에서 정제해 던진다: `imp_secret`, 토큰, axios config를 제거한 자체 에러 타입(errorHandler가 에러 객체 전체를 로깅하므로 시크릿 유출 차단).
  - 기동 시 `PORTONE_IMP_KEY/SECRET` 누락이면 fail-fast(프로덕션 기준. 개발 모드는 경고 후 결제 라우트 503).

## 4. 주문 생성 변경 (`orderController.createOrder`)

1. 금액 계산은 현행 유지(서버 재계산, 쿠폰 검증, 포인트 클램프).
2. **포인트 클램프 강화**: `grandTotal`이 `0` 또는 `>= 100`(카드 최소금액)이 되도록 포인트 사용량을 조정. `1~99원` 구간은 400 에러("포인트 사용을 조정해 주세요"). 모든 금액은 `Number.isSafeInteger` + 양수 검증.
3. **생성 트랜잭션**(`withTransaction` 헬퍼): 주문 `_id` 선발급 후 한 트랜잭션으로
   - 주문 insert (`status:'pending'`, `payment.prepareStatus:'preparing'`, `payment.expiresAt = now+30m`)
   - 쿠폰 소진 + `usedOrder` 연결 (`matchedCount` 확인, 0이면 abort)
   - 포인트 차감 + 원장 insert + 주문 연결
   - Idempotency-Key는 기존 partial unique 유지. 결제 주문에서는 헤더 필수화.
4. **0원 주문 분기**: `grandTotal === 0`이면 prepare/결제창 없이 트랜잭션 안에서 바로 `status:'paid'`, `payment.provider:'none'`, `method:'points'` + paid outbox 이벤트. 응답에 `alreadyPaid: true`.
5. 트랜잭션 커밋 후(HTTP 호출은 트랜잭션 밖) `prepare(orderNumber, grandTotal)`:
   - 성공 → `prepareStatus:'prepared'`, `preparedAmount` 기록 → 응답 `{orderId, orderNumber, amount, orderName}`.
   - 확정 실패 → 취소 트랜잭션(주문 cancelled + 혜택 원복) 후 502.
   - 결과 불명(타임아웃) → `prepareStatus:'preparing'` 유지, 502 반환. 멱등 재요청이 `ensurePrepared()`로 재시도.
6. **멱등 재요청**: 같은 Idempotency-Key로 기존 주문 발견 시 — `pending`이면 `ensurePrepared()`(prepared 아니면 prepare 재호출; 같은 merchant_uid+금액 재등록은 포트원에서 허용) 통과 후 같은 DTO 반환. `paid`면 `alreadyPaid: true`. 요청 본문 해시를 저장해 두고, 같은 키+다른 본문이면 409.
7. `sendOrderPlaced` 이메일·`adjustSales`는 생성 시점에서 제거(→ paid outbox로 이동).

`withTransaction(fn)` 헬퍼(`server/src/utils/withTransaction.js`): 세션 시작 → `fn(session)`. standalone Mongo에서 "Transaction numbers are only allowed on a replica set" 오류 시 세션 없이 순차 실행 폴백 + 1회 경고 로그(로컬 개발 편의. 프로덕션 Atlas에서는 항상 트랜잭션).

## 5. 결제 검증 (verifier)

### 5.1 엔드포인트

- `POST /payments/complete` (requireAuth, rateLimit): body `{orderId, impUid}`. 소유 주문 조회(`order.user === req.user._id`) 후 verifier 호출.
- `POST /payments/webhook` (무인증, rateLimit): body에서 `imp_uid`만 사용(형식 검증: `^imp_[0-9]+$` 등 문자열·길이·문자셋 검증, Mongo 쿼리에 body 값 직접 전달 금지). WebhookLog 기록 → verifier 호출.
  - 성공/정상 중복/영구 무효(존재하지 않는 결제 등) → 200
  - 일시 장애(DB, 포트원 조회 실패) → 500 (포트원 재전송 유도)

### 5.2 verifier 로직 (`verifyAndCompletePayment(impUid, { requester? })`)

```text
1. 포트원 getPayment(impUid)
2. 응답의 merchant_uid로 주문 조회 (클라이언트가 준 값은 사용하지 않음)
   - 주문 없음 → 보안 로그, 무효 처리 (절대 포트원 취소 호출하지 않음)
   - requester 있으면(=/complete 경로) 소유자 확인, 불일치 → 403 + 보안 로그
3. 결정표 적용 (5.3)
4. paid 확정 시: withTransaction으로
   - CAS: findOneAndUpdate({_id, status:'pending'} → status:'paid', payment.* 채움)
   - outbox insert: paid_email(수신자 스냅샷 포함), paid_sales_inc
   - CAS 실패 → 트랜잭션 abort 후 현재 상태 재조회 → 결정표의 멱등/중복 분기
```

검증 항목: `status === 'paid'`, `amount === order.amounts.grandTotal`, `cancel_amount === 0`, `currency === 'KRW'`. 필드는 snake_case(`imp_uid, merchant_uid, receipt_url, fail_reason, cancel_amount, pg_provider, pay_method, paid_at`).

### 5.3 결정표

| 포트원 결과 / 로컬 상태 | 처리 |
|---|---|
| merchant_uid로 주문 못 찾음 | 변경·취소 금지, 보안 로그만 |
| paid / pending | 트랜잭션으로 paid 확정 + outbox |
| paid / paid·이후 상태, **동일 impUid** | 멱등 성공 200 |
| paid / paid·이후 상태, **다른 impUid** | 중복 결제 → 새 결제 전액 자동환불 시도, `refund.status='review'` 기록 |
| paid + cancel_amount > 0 / any | 부분취소 감지 → `refund.status='review'`, 자동 혜택 복구 금지 |
| paid / cancelled(로컬) | 늦은 승인 → 전액환불 saga 자동 기동 |
| ready / pending | 유지(가상계좌 등), 200 |
| failed / pending | 주문 cancelled + 혜택 원복(취소 트랜잭션), failReason 기록 |
| cancelled(전액) / paid·이후 | 외부(콘솔) 취소 발견 → pending·paid면 로컬 cancelled 수렴 + 혜택 원복, shipped 이후면 `review` |
| 금액/통화 불일치 / pending | `refund.status='review'` + 보안 로그. **자동 취소하지 않음**(오탐 시 정상 결제를 날리는 것 방지, 환불은 관리자 확인 후) |

## 6. 취소·환불 saga

모든 취소 경로(사용자 cancelOrder, 관리자 status→cancelled, verifier의 늦은 승인 발견)가 **하나의 함수** `cancelOrderSaga(order, { actor, reason })`를 사용한다.

```text
A. pending(미결제 추정) 취소:
   1. findPayment(merchantUid)로 포트원 선조회
   2. 결제 없음/failed → 취소 트랜잭션(status cancelled + 혜택 원복 + cancel outbox)
   3. paid 발견 → 취소 대신 verifier로 paid 확정 후 사용자에게 안내 (또는 B로 진입)
   4. ready(진행 중 결제창) → 409 "결제가 진행 중입니다" (sweeper가 만료 후 정리)

B. paid/preparing(실결제) 취소:
   1. CAS: refund.status 'none'→'requested' (동시 취소 요청 차단, 전이 잠금)
   2. getPayment로 현재 상태·cancel_amount 확인
   3. cancel({impUid, amount: 잔액, checksum: amount - cancel_amount, reason})
   4-a. 성공(code 0, 전액 취소 확인) → 취소 트랜잭션(status cancelled + 혜택 원복
        + cancel outbox) → refund.status='done', completedAt, cancelAmount 기록
   4-b. 확정 실패(잔액 부족 등) → refund.status='review'
   4-c. 결과 불명(타임아웃) → refund.status='processing' 유지 → reconciler가 재조회로 수렴
```

- 사용자 cancelOrder 허용 상태: `pending, paid, preparing` (pending은 A 경로).
- 혜택 원복은 취소 트랜잭션 안에서: 쿠폰 복구는 `usedOrder=orderId` 기준 `matchedCount` 확인 후 플래그, 포인트 환불은 원장+잔액을 같은 트랜잭션으로.
- `benefitsReversed` 플래그는 유지하되 "복구 대상 확인 후"에만 세움(기존 0건 복구에도 true 되던 결함 수정).

## 7. pointService 트랜잭션화

`applyPoints()`를 재작성: **원장 insert(unique 멱등키) → 잔액 갱신**을 한 트랜잭션으로. unique 충돌 = 이미 처리됨 → no-op. 기존 "잔액 먼저 변경 후 원장, 충돌 시 역보상" 패턴 제거(동시 환불 시 이중 증가 창 제거). 호출부 시그니처는 유지하되 `session` 파라미터 추가.

## 8. Reconciler / Sweeper (`server/src/services/paymentJobs.js`)

in-process `setInterval` 60초, 서버 기동 시 시작. 각 사이클:

1. **stale pending**: `status:'pending' && payment.expiresAt < now && provider:'portone'` → `findPayment(merchantUid)` → paid면 verifier로 확정 / 없음·failed면 취소 트랜잭션 / ready면 다음 사이클로.
2. **refund processing/requested stale**(10분 경과): `getPayment` 재조회 → 전액 취소 확인되면 4-a 마무리, 취소 안 됐으면 cancel 재시도(1회) 또는 `review`.
3. **outbox pending**: worker 실행(2.2).

배치당 상한 20건, 오류는 건별 로그 후 계속. 사용자별 활성 pending 주문 상한 3건(createOrder에서 검증).

## 9. 관리자·통계 보정

- `updateOrderStatus`(관리자): `pending → paid` 수동 전환 **금지**(포트원 주문은 verifier만 paid 가능. `payment.provider:'none'` 0원 주문도 이미 paid로 생성되므로 예외 불필요). 관리자 UI(`OrderDetail.jsx`)의 전이 목록에서도 제거.
- 관리자 `→ cancelled`는 `cancelOrderSaga` 호출로 대체(직접 상태 변경 금지).
- `refund.status`가 `requested|processing|review`면 모든 전이 409.
- 관리자 주문 목록/상세에 `refund.status` 배지 노출(특히 `review`).
- 통계(`adminController`): 매출·구매액 집계를 `status in [paid, preparing, shipped, delivered]`로 제한, 매출 일자는 `payment.paidAt ?? createdAt` 기준.

## 10. 클라이언트

### 10.1 SDK·환경

- `client/index.html`에 `<script src="https://cdn.iamport.kr/v1/iamport.js"></script>`.
- env: `VITE_PORTONE_IMP_CODE`(가맹점 식별코드 — 공개값), `VITE_PORTONE_CHANNEL_KEY`(선택). 호출 시 `channelKey`가 있으면 그것을, 없으면 `pg:'html5_inicis'`를 사용(콘솔 v1 예제 기준 확정).

### 10.2 Checkout 플로우 (`Checkout.jsx` + 신규 `lib/payments.js`)

```text
onPay:
  1. createOrder → {orderId, orderNumber, amount, orderName, alreadyPaid?}
     - alreadyPaid(0원) → 완료 화면
  2. 결제 컨텍스트를 sessionStorage에 저장: {orderId, orderNumber, idemKey}
  3. IMP.init(IMP_CODE) → IMP.request_pay({
       channelKey 또는 pg, pay_method:'card',
       merchant_uid: orderNumber, name: orderName, amount,
       buyer_email/name/tel/addr/postcode: 배송지 폼 값,
       m_redirect_url: `${location.origin}/checkout/complete`
     }, callback)
  4. callback rsp.success → POST /payments/complete {orderId, impUid: rsp.imp_uid}
     - 성공 → sessionStorage 정리, 장바구니 제거(paid 확인 후), 완료 화면
     - 네트워크 실패 → 주문 취소하지 **않음**. "결제 확인 중" 화면 + 재시도 버튼
       (GET /orders/:id 폴링으로 paid 반영 감지 — 웹훅이 확정했을 수 있음)
  5. callback rsp.success === false → cancelOrder(orderId) 시도
     - 서버가 A-3(결제 발견)으로 답하면 완료 화면으로 전환
     - 취소 성공 → 멱등키 리셋, 에러 메시지, 재시도 가능
     - 409(진행 중) → "결제 확인 중" 화면
```

### 10.3 모바일 리다이렉트 (`/checkout/complete` 라우트 신규, `App.jsx` 등록)

- 쿼리 `imp_uid, merchant_uid, imp_success, error_msg` 파싱. **imp_success는 참고값일 뿐 승인 근거가 아님** — 값과 무관하게:
  - sessionStorage에서 컨텍스트 복원(없으면 merchant_uid로 내 주문 조회)
  - `POST /payments/complete` 호출 → 서버 판정에 따라 완료/실패 화면
  - 실패로 판정되면 cancelOrder(A 경로) 후 장바구니 유지 안내
- 로그인 만료로 리다이렉트된 경우: 로그인 후 원래 query string 보존 복귀.

### 10.4 마이페이지

- pending 주문에 "결제 확인/취소" 액션(각각 complete 재시도·cancelOrder).
- 주문 상세에 영수증 링크(receiptUrl), 환불 상태 표시.

## 11. 보안·운영

- rateLimit(기존 미들웨어): `POST /orders` 10회/분/유저, `POST /payments/complete` 20회/분/유저, `POST /payments/webhook` 60회/분/IP.
- 웹훅 body는 형식 검증 후 imp_uid만 사용, 나머지 폐기.
- portoneService 에러 정제(3장) + errorHandler는 수정하지 않음(경계에서 해결).
- env 추가: `server/.env.example`에 `PORTONE_IMP_KEY=`, `PORTONE_IMP_SECRET=`; `client/.env.example`에 `VITE_PORTONE_IMP_CODE=`, `VITE_PORTONE_CHANNEL_KEY=`; `render.yaml`에 sync:false 항목, `DEPLOY.md`에 포트원 콘솔 웹훅 URL(`https://<render>/api/payments/webhook`) 설정 절차 추가.

## 12. 테스트 전략

서버에 테스트 인프라가 없으므로 이번에 vitest + mongodb-memory-server(replica set 모드)를 server에 도입한다. 범위:

- **verifier 결정표 단위 테스트**: portoneService를 목으로 두고 표의 전 분기(멱등, 다른 impUid, 부분취소, 금액 불일치, 늦은 승인) 검증.
- **경합 테스트**: complete↔webhook 동시 호출 → 부수효과 1회. paid CAS 직후 크래시 시뮬레이션 → outbox 재실행으로 이메일/salesCount 회복.
- **saga 테스트**: pending 취소 시 결제 존재 분기, cancel 타임아웃 → processing → reconciler 수렴.
- **createOrder 트랜잭션**: prepare 실패 시 쿠폰·포인트 원복, 0원 분기, 1~99원 거절, 같은 키+다른 본문 409.
- **수동 E2E**(테스트 채널): PC 결제창 성공/창닫힘, 모바일 리다이렉트, 웹훅(배포 환경), 콘솔 취소 → reconciler 수렴. KG이니시스 테스트 결제는 실승인 후 당일 자동 취소됨.

## 13. 비범위·한계

- 부분취소 UI/부분환불 정책(감지 시 review로만 보냄), 가상계좌·간편결제 수단 추가, 재고 수량 차감(현행 없음 유지), 다중 인스턴스 수평 확장(잡 분산 락), 포트원 v2 마이그레이션.
- `review` 상태 해소는 관리자 수동(콘솔 확인 후 DB/포트원 조작). 자동 해소 도구는 후속.
