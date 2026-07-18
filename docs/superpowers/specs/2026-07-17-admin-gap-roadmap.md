# 관리자 기능 — 간극 분석 및 로드맵

날짜: 2026-07-17 (P0·P1·P2 구현 2026-07-18)
상태: **P0·P1·P2 구현 완료.** 로드맵 전 항목 소진. 남은 부채는 아래 P0 outbox 멱등화(별도 작업).
범위: 기존 관리자 12화면·30개 admin API 전수 조사 → 부재·조용한 실패 식별 → P0~P2 우선순위. **1인 운영 전제.**

## 1. 배경

관리자 화면은 이미 **12개 페이지 + 6개 공통 컴포넌트**(약 2,000줄)로 구축돼 있다. 내비 9개가 실제 페이지 9개와 100% 일치하고 깨진 링크가 없으며, **관리자 영역 전체에 TODO/FIXME 주석이 0건**이다.

TODO가 0건인 이유는 완성돼서가 아니다 — **만든 것은 끝까지 만들고, 안 만든 것은 시작도 안 했기 때문**이다. 그래서 미완성이 주석이 아니라 **부재**의 형태로 존재하고, 코드를 읽어서는 보이지 않는다. 이 문서의 목적이 그 부재를 찾아 우선순위를 매기는 것이다.

조사로 드러난 경계선은 선명하다:

> **주문 처리 파이프라인(주문→제작→배송)은 완성도가 높다** — 일괄 전이, 송장 CSV 양방향, 부분 실패 사유, 제작 집계, 포장 주문서. 반면 **운영(장애 감지·복구)과 CRM(이메일·쿠폰 성과·등급)은 껍데기이거나 목업**이다.

기존 Phase 1~4(`2026-07-09-admin-console-design.md:180-188`)와 Phase A/B/C(`2026-07-09-email-coupon-points-design.md:8`)는 **전부 소진됐다.** 이 로드맵은 그 다음 단계이며, 번호 충돌을 피해 P0~P2로 표기한다.

## 2. 핵심 발견 — 화면이 문제를 보여주고 해결책을 안 준다

**실패가 조용히 쌓이는 곳이 5곳이고, 전부 stdout에만 존재한다.**

| 실패 | 저장 | 통보 | 결과 |
|---|---|---|---|
| `OrderEvent.status='failed'` | DB | `console.error`<br>(`orderEventService.js:113`) | **`Product.salesCount`가 실제 판매량과 영구히 어긋남**(베스트셀러·정렬에 반영). 주문 접수 메일 미발송 |
| `WebhookLog.result='error'` | DB | 없음 — **읽는 코드 0건** | 포트원 재전송이 끊기면 결제 영구 미확정 |
| `payment.refund.status='review'` | DB | 상세 화면에만 | **데드락** — 아래 참조 |
| `benefitsReversed:false` | DB | `console.error`<br>(`cancelService.js:75`) | 취소했는데 쿠폰·적립금이 안 돌아감. 재시도가 "다음 취소 요청 시"뿐인데 **취소된 주문은 다시 취소되지 않음** → 영구 방치. 고객은 CS로만 발견 |
| paymentJobs 사이클 실패 | 없음 | `console.error` | **잡이 죽어도 아무도 모름.** `runPaymentJobsCycle()`의 반환값 `counts`가 버려짐(`paymentJobs.js:89-95`). `portone.isConfigured()`가 false면 스윕이 **조용히 통째로 스킵**(`:14`) |

### `review`는 구조적 데드락이다

`orderTransitionService.js:25-28`이 `['requested','processing','review']`를 `refund_locked`로 **모든 상태 전이를 차단**한다. 그런데:

- **해제 액션이 UI에 없다.** `OrderDetail.jsx:93-95`가 빨간 사유까지 띄우지만 버튼이 없다
- **목록 필터가 없다.** `buildAdminOrderFilter`(`orderController.js:349-374`)는 `status/from/to/q/product`만 지원 → 상세를 하나씩 열어야 발견
- **유일한 탈출구가 DB 직접 수정**

`portone-pg-design.md:271`이 이를 인정한다: *"`review` 상태 해소는 관리자 수동(콘솔 확인 후 DB/포트원 조작). 자동 해소 도구는 후속."* 시스템이 "사람이 처리하라"고 격리해놓고 처리 수단을 안 준 상태다.

## 3. 로드맵

### P0 — 지금 DB를 직접 열어야만 되는 일

**P0-1. 운영 상태 패널** — 대시보드에 카드 4장
`OrderEvent{status:'failed'}` · `WebhookLog{result:'error'}` · `Order{payment.refund.status:'review'}` · `Order{benefitsReversed:false, status:'cancelled'}` 건수 + paymentJobs 최종 실행 시각·결과.
**건수만 세면 되는 일**이라 비용 대비 효과가 가장 크다. `GET /admin/ops` 신설 + `runPaymentJobsCycle()`의 `counts`를 버리지 말고 마지막 결과를 보관.

**P0-2. `review` 데드락 해소**
- 목록 필터: `buildAdminOrderFilter`에 `refund` 파라미터 → OrdersAdmin에 "환불 확인 필요" 탭
- 해제 액션: `OrderDetail`에 "환불 완료로 표시" / "환불 재시도". 포트원 콘솔에서 수동 환불한 뒤 상태를 맞추는 경로가 필요하다
- 재시도는 `cancelService`의 기존 saga 재사용 — 새 경로를 만들지 말 것

**P0-3. outbox 조회 + 수동 재큐**
`GET /admin/events?status=failed` + `POST /admin/events/:id/requeue`(`status:'pending'`, `attempts:0`).
`salesCount` 영구 불일치를 막는 유일한 수단.

> **P0 구현 결과 (2026-07-18)**: 세 항목 모두 구현·검증(서버 105개 테스트). `GET /admin/ops`,
> `/admin/events`+`/events/:id/requeue`, `POST /orders/:id/retry-refund`(review→processing 단일승자
> CAS로 동시 재시도 직렬화), OrdersAdmin `refund` 필터, OpsAdmin 페이지, Dashboard 배너.
> 적대적 리뷰(6에이전트)가 major 3건을 잡아 반영: retryRefund 이중환불 CAS(수정), 그 패자의
> review 덮어쓰기(같은 CAS로 해소), requeue 멱등성 거짓 주석(정직화+UI 경고).
>
> **남은 부채 — outbox 부수효과 멱등화(P1로 승격 필요)**: `runEvent`의 부수효과(`adjustSales`의
> `$inc`, `sendMock`의 create)와 done-write가 원자적이지 않다. 부수효과 성공 후 done-write만
> 실패하면 재실행 시 `salesCount` 이중 가산·메일 중복이 가능하다. 이건 재큐가 만든 게 아니라
> outbox의 기존 at-least-once 성질(stale-processing 재큐도 동일)이라 지금은 UI 경고로 완충했다.
> 근본 해법은 `runEvent`+done-write의 트랜잭션 원자화(부수효과 함수에 session 전달) — outbox
> 핵심 변경이라 신중한 별도 작업. 그전까지 재큐는 '진짜 미적용 실패'에만.

### P1 — CS 대응이 안 되는 것

**P1-4. 주문 상세 금액 분해**
지금 **배송비와 결제금액 둘만** 보여준다(`OrderDetail.jsx:128-135`). 상품합계 5만원인데 결제 3만원이면 **관리자가 그 2만원이 쿠폰인지 적립금인지 알 수 없다.** 고객이 "왜 이 금액이죠?"라 물으면 답할 수 없다.
노출할 것(전부 이미 DB에 있음): `amounts.itemsTotal` · `couponDiscount` · `pointsUsed` · `coupon.code` · `pointsEarned` · `payment.paidAt` · **`payment.failReason`(취소 사유 — `cancelService.js:40`이 저장하는데 화면에 없다)**. CSV 컬럼에도 추가.

**P1-5. 주문 날짜 범위 필터** — 가장 싼 기능
**서버는 이미 지원한다.** `client/src/lib/admin.js:24` 주석이 `from`/`to`를 명시하는데 UI가 한 번도 안 보낸다. 입력 2개면 끝.

**P1-6. `Order.statusHistory` 신설**
"누가 언제 이 주문을 취소했나"를 볼 수 없다. `actor`가 `applyTransition`까지 이미 전달되는데(`orderTransitionService.js:21`) 저장을 안 한다. `DATABASE.md:181`엔 이 필드가 있다고 적혀 있다 — **문서가 코드보다 앞선 stale spec**.

**P1-7. 환불 사유 입력**
`POST /orders/:id/cancel`이 사유를 지원하는데 **관리자 화면이 이 경로를 안 쓴다**. 지금은 `PATCH /status` 경유라 `'관리자 취소'`로 하드코딩(`orderTransitionService.js:37-38`).

> **P1 구현 결과 (2026-07-18)**: 4항목 모두 구현·검증(서버 113개 테스트). 금액 분해(OrderDetail
> +CSV 4컬럼), 주문일 from/to 필터, `Order.statusHistory`(생성·결제·전이·취소 4지점 원자적 $push),
> 취소 사유 입력(window.prompt→reason). 적대적 리뷰(8에이전트)가 major 3건+minor 3건을 잡아 반영:
> ① **실결제 B경로 취소의 actor가 'system'으로 유실**(P1-7 목적 무력화) — refund 락 시점에
> `payment.refund.actor`를 영속화하고 executeRefund가 읽어 복원(동기·비동기 잡 경로 모두).
> ② **날짜 필터 KST skew** — `setHours`(프로세스 로컬 TZ)를 `+09:00` 명시 파싱으로. UTC 배포에서
> 검증. ③ **CSV from/to 누락**. ④ 동일상태 재요청(송장수정·적립재시도)의 유령 이력 — `next!==prev`
> 가드. ⑤ 레거시 itemsTotal 폴백. ⑥ free_shipping 쿠폰 표시.

### P2 — 그 다음

| | 항목 | 근거 |
|---|---|---|
| P2-8 | **상품 소프트 삭제** | `findOneAndDelete` + `cleanupOrphanImages`로 **Cloudinary 원본까지 삭제**(`productController.js:126-129`). 방어는 `window.confirm` 하나. `archived`가 이미 있는데 삭제는 별개로 하드 |
| P2-9 | 회원 보유 쿠폰 조회 | 발급만 되고 보유·사용·회수를 볼 수 없다. 중복 발급해도 모름. `getMember`에 `UserCoupon` 조인 |
| P2-10 | 5년 만료 파기 배치 | 법적 의무 미이행(`DATABASE.md:67`). 쿼리에 **반드시 `status`를 함께 걸 것** — BSON에서 Null < Date라 `$lte`만 쓰면 탈퇴 안 한 회원이 전원 매칭 |
| P2-11 | SKU 자동 생성 | 상품 등록 편의. 별도 기획이 있었으나 결국 관리자 상품 기능이라 여기 흡수 |
| P2-12 | 적립금 내역 페이징 | `adminController.js:165`가 20건에서 자르고 페이징 없음 |

> **P2 구현 결과 (2026-07-18)**: 5항목 모두 구현·검증(서버 137개 테스트). ▸P2-8 상품 소프트삭제
> (하드삭제+이미지파괴 → status:'archived', 복구 가능). ▸P2-9 회원 보유쿠폰 조회(getMember 조인).
> ▸P2-10 5년 만료 파기 배치(purgeExpiredWithdrawals + purge:withdrawn 스크립트, dry-run 기본).
> ▸P2-11 SKU 자동생성(Counter $inc·backfill·79종 소급·주문 스냅샷·폼/목록/제작/주문서/CSV 노출).
> ▸P2-12 적립금 페이징. 적대적 리뷰(5에이전트)가 major 2건+minor 5건을 잡아 반영:
> ① backfill 대상($not:$type:string)과 갱신가드($exists:false) 술어 불일치 — sku:null이 영영
> 미할당+카운터 낭비. 술어 통일. ② 파기 배치 부분실패 시 평점 재계산 비수렴 — 재계산을 리뷰삭제
> 직후로 옮기고 per-user try/catch로 poison 회원 격리. ③ 시드 재실행이 archived를 되살리던 것 —
> status를 $setOnInsert로. 검증: 시드 spawn 재실행 SKU 불변·archived 보존 실측, backfill null 케이스.

### 즉시 수정 (버그 — 로드맵 아님)

- **`MembersAdmin.jsx:126-128` — 탈퇴 회원이 "활성"으로 표시된다.** 삼항이 `suspended`만 검사. 상세는 "탈퇴"로 맞게 나와 **목록↔상세가 서로 다른 말을 한다**. ← 커밋 `e9eace8`에서 `withdrawn`을 추가하며 목록을 빠뜨린 회귀
- **`Analytics.jsx:31` — 30d에서 x축 라벨이 전부 사라진다.** `series.length <= 12` 조건. **30d가 기본값**이라 첫 화면이 라벨 없는 차트
- **`createAdmin.mjs`가 있는데 아무도 모른다.** `package.json` scripts 미연결 + `DEPLOY.md:55`는 여전히 "Atlas UI에서 직접 role 변경"이라 안내. **두 줄이면 끝**
- `points.js:3-10`·`pointController.js:5-12`에 `withdraw` 라벨 누락 → 화면에 raw `withdraw` 노출
- `DEPLOY.md:165` "결제/주문은 아직 미구현" — 포트원 완전 구현된 지금 거짓

## 4. 명시적으로 하지 않는 것

| 항목 | 이유 |
|---|---|
| 권한 세분화 · 감사 로그 · 웹소켓 | 1인 운영. `admin-console-design.md:19-20`, `admin-orders-upgrade-design.md:101`에서 이미 두 번 거부 |
| 등급 자동 산정 · 적립률 차등 | **표시광고상 이행 의무**가 생겨 되돌리기가 코드 롤백보다 비싸다. 커밋 `e9eace8`에서 의도적으로 뺀 결정 |
| 관리자 수동 결제완료(`pending→paid`) | 명시적으로 제거된 결정. 회귀 테스트로 잠겨 있음(`orderTransitionService.js:8`) |
| 실제 이메일 발송(SMTP) | 목업이 의도(`emailService.js:3`). 붙이려면 별도 기획 — 발송 실패·재시도·수신거부가 따라온다 |
| 재고 관리 | 주문제작이라 재고 개념이 없다(`admin-orders-upgrade-design.md:101` 비범위) |
| 부분 환불 · 반품/교환 | `Order.status` enum과 전이표 확장이 필요한 설계 변경. P0~P1 이후 |

## 5. 검증

- **P0-1·3**: `mongodb-memory-server`로 failed OrderEvent·error WebhookLog·review 주문을 심고 `GET /admin/ops`가 정확히 세는지. 재큐 후 `processPendingEvents`가 실제로 집어가는지
- **P0-2**: `review` 주문에 해제 액션 → `refund_locked`가 풀려 전이가 되는지. **해제가 포트원 실제 환불과 어긋나지 않는지가 핵심** — 실환불 없이 상태만 바꾸면 장부가 틀어진다
- **P1-4**: 쿠폰+적립금을 쓴 주문을 만들어 화면 금액 분해가 `grandTotal`과 산술적으로 맞는지
- **P1-6**: 전이마다 `statusHistory`가 쌓이고 `actor`가 기록되는지
- 기존 **90개 테스트** 통과(`npm test`) + 클라이언트 빌드

## 6. 되돌리기

P0는 전부 **읽기 전용 조회 + 신규 액션**이라 기존 동작을 건드리지 않는다. P1-6(`statusHistory`)만 스키마 가산이고 나머지는 UI. 위험한 건 P0-2(환불 해제)뿐 — **장부에 영향을 주는 유일한 항목**이라 별도 커밋으로 분리한다.

---

## 부록 — 조사 중 발견한 문서 오류

이 저장소의 문서 상당수가 코드보다 낡았다. 기획 근거로 인용하기 전에 코드를 확인할 것.

| 문서 | 문제 |
|---|---|
| `admin-console-design.md:3-4` | 상태가 "설계 승인 대기" — 실제로는 Phase 1~4 전부 구현 완료 |
| `admin-orders-upgrade.md` | Task 1~8 체크박스가 전부 미체크 — git 이력상 전부 커밋 완료. **미완료로 오독 금지** |
| `admin-console-design.md:17-18` | "실 PG 결제/환불 안 함", "이미지 업로드 안 함" — **둘 다 뒤집혀 구현됨**(포트원, Cloudinary) |
| `DATABASE.md:181` | `Order.statusHistory`가 있다고 적혀 있으나 **모델에 없음** |
| `DATABASE.md:240-243` | 단계 구분이 `categories`·`carts`를 Core라 하나 **구현된 적 없음**(같은 문서 `:29-31`이 자백) |
| `DEPLOY.md:165` | "결제/주문은 아직 미구현" — 거짓 |
