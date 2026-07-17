# 관리자 주문관리 업그레이드 설계 (스마트스토어 스타일)

날짜: 2026-07-17
상태: 승인됨
범위: 상태별 탭+일괄처리, 옵션별 제작 집계, 포장용 주문서 출력, CSV 내보내기/송장 CSV 업로드. 접근 방식 A — 기존 `admin/orders`를 작업대로 확장, 제작·인쇄는 전용 라우트.

## 1. 목표

단일 운영자가 한 화면에서 주문 작업 흐름(신규 확인 → 제작 시작 → 송장 입력 → 배송처리 → 완료)을 일괄로 처리하고, 3D 프린터 출력 계획용 제작 리스트와 포장용 주문서를 뽑을 수 있게 한다. 기존 상태머신·환불 잠금·취소 saga를 그대로 재사용한다 — 일괄이라고 검증이 약해지지 않는다.

## 2. 서버

### 2.1 전이 서비스 추출 (`server/src/services/orderTransitionService.js` 신규)

`updateOrderStatus` 컨트롤러의 핵심을 `applyTransition(orderId, next, { courier, trackingNumber, actor = 'admin' })`로 추출:

1. 주문 로드 → TRANSITIONS 허용 검증
2. refund 잠금(requested/processing/review) 가드
3. `next === 'cancelled'` → `cancelOrderSaga` 위임 (cancelled/already_cancelled만 ok로 매핑)
4. shipped 전이 시 trackingNumber 필수, courier/trackingNumber $set
5. 조건부 CAS(`{_id, status: prev}`) — 경합 패배는 실패 반환
6. delivered 전이 시 적립 확정(기존 로직 이동), shipped/delivered 상태 메일(기존 로직 이동)

반환: `{ ok: true, order }` | `{ ok: false, code, message }` (code: `not_found | invalid_transition | refund_locked | tracking_required | conflict | refund_pending | review`)

`updateOrderStatus` 컨트롤러는 이 함수의 thin wrapper가 된다(HTTP 매핑만). 기존 단건 API 응답 계약(200 주문 | 202 {message, order} | 400/409)은 불변.

### 2.2 신규 엔드포인트 (전부 requireAuth + requireAdmin)

| 엔드포인트 | 사양 |
|---|---|
| `POST /orders/bulk/status` | body `{ ids: string[], status, trackings?: { [orderId]: { courier, trackingNumber } } }`. ids 1~100(초과 400). 건별 `applyTransition` 순차 실행. 응답 `{ succeeded, failed: [{ orderId, orderNumber, message }] }` — 부분 성공. cancelled 일괄도 허용(saga 경유) |
| `POST /orders/bulk/tracking` | body `{ rows: [{ orderNumber, courier, trackingNumber }] }` (1~100행). orderNumber로 주문 해석 후 `applyTransition(id, 'shipped', ...)`. 미존재 주문·형식 불량은 failed에 사유로. 응답 형식 동일 |
| `GET /orders/admin/counts` | `{ pending, paid, preparing, shipped, delivered, cancelled }` — `$group` 단일 aggregation |
| `GET /orders/admin/export` | 쿼리 status/from/to/q(기존 listAllOrders와 동일 해석) 전체(페이지네이션 없음, 상한 5,000행 — 초과 시 앞 5,000 + 마지막 행에 안내). `Content-Type: text/csv; charset=utf-8`, UTF-8 BOM. 컬럼: 주문번호, 주문일(KST), 상태(한글), 주문자, 수취인, 연락처, 우편번호, 주소, 품목(멀티 품목은 `이름(옵션)x수량 / …` 병기), 결제금액, 택배사, 송장번호. 필드 내 쉼표·따옴표·개행은 RFC4180 이스케이프 |
| `GET /orders/admin/production-summary` | status ∈ [paid, preparing] 주문 `$unwind items` → `{slug, option}` 그룹. 응답 `{ items: [{ slug, name, nameKo, image, option, paidQty, preparingQty, totalQty, orderCount }], generatedAt }` — totalQty 내림차순 |
| `GET /orders/admin/batch?ids=a,b,c` | 인쇄용 일괄 조회. ids ≤ 50(초과 400), user populate(name,email). 응답 `{ items: Order[] }` |

`listAllOrders`에 `?product=<slug>` 필터 추가(`items.slug` 매칭) — 제작 리스트에서 주문 목록으로 드릴다운용.

### 2.3 라우트 순서 주의

`/orders/admin/*` 신규 경로는 기존 `GET /orders/admin` 및 `/:id` 라우트보다 먼저 선언(`counts`, `export`, `production-summary`, `batch`). `POST /orders/bulk/*`도 `/:id/cancel`보다 먼저.

## 3. 클라이언트 — OrdersAdmin 재구성

### 3.1 구조 분리

- `pages/admin/OrdersAdmin.jsx` — 탭·목록·선택 상태·URL 동기화(기존 patch 패턴 유지)
- `components/admin/OrderBulkBar.jsx` — 선택 ≥1일 때 목록 상단 고정 액션 바 + 처리 결과(실패 사유 목록) 표시
- `components/admin/TrackingCsvModal.jsx` — CSV 업로드 파싱·미리보기·확정
- `lib/admin.js` — bulkOrderStatus, bulkTracking, fetchOrderCounts, fetchProductionSummary, fetchOrdersBatch, exportUrl 헬퍼 추가

### 3.2 탭바

`전체 | 결제대기 | 신규주문 | 제작중 | 배송중 | 배송완료 | 취소` — 값은 기존 status 쿼리파라미터('' | pending | paid | preparing | shipped | delivered | cancelled). "신규주문"은 paid의 표시 라벨. 뱃지 건수는 `/orders/admin/counts`(탭 전환·일괄 처리 후 재조회). 기존 status `<select>`는 탭바로 대체.

### 3.3 선택·일괄 액션

- 행 체크박스 + 헤더 전체선택(현재 페이지 한정). 탭·페이지·필터 변경 시 선택 초기화.
- 액션 바 버튼(탭 맥락): paid → `제작 시작(n)` / preparing → `배송처리(n)` / shipped → `배송완료(n)` / 전 탭 공통 → `주문서 인쇄(n)`(새 탭으로 print 라우트), pending·paid·preparing → `주문 취소(n)`(window.confirm 후).
- 처리 후: counts·목록 재조회, 결과 요약 토스트("12건 처리, 2건 실패") + 실패 목록(주문번호·사유)을 액션 바 아래 패널로.

### 3.4 인라인 송장 (제작중 탭)

각 행에 택배사 select(CJ대한통운/우체국택배/한진택배/롯데택배/로젠택배/기타)+송장 input. 로컬 state `{[orderId]: {courier, trackingNumber}}`. `배송처리(n)` 클릭 시 선택 행 중 송장 입력분은 trackings로 전달, 미입력 행은 클라에서 사전 실패 처리("송장번호 미입력")로 결과 패널에 표시(서버 호출은 입력분만).

### 3.5 CSV

- **내보내기**: JWT가 헤더 기반이라 `window.open` 불가 — `api.get('/orders/admin/export', { params: 현재필터, responseType: 'blob' })` 후 blob URL로 `<a download>` 트리거. 파일명 `orders-YYYYMMDD.csv`.
- **송장 업로드**(제작중 탭): 파일 선택 → 클라 파싱(자체 미니 파서 — 헤더 행 자동 감지, 3열: 주문번호/택배사/송장번호, 따옴표·BOM 처리) → 미리보기 모달(정상 n건 / 형식오류 목록) → 확인 시 `bulk/tracking` → 결과 패널. 외부 파싱 라이브러리 추가 금지.

## 4. 제작 리스트 (`/admin/production`)

- AdminLayout 사이드바에 "제작" 메뉴(주문 아래).
- production-summary 테이블: 썸네일 | 상품명 | 옵션 | 신규주문 수량 | 제작중 수량 | 합계 | 주문 건수. 합계 행 표시.
- `인쇄` 버튼 — print CSS로 사이드바·버튼 숨기고 표만.
- 행 클릭 → `/admin/orders?product=<slug>&status=paid` 드릴다운.

## 5. 주문서 인쇄 (`/admin/orders/print?ids=...`)

- App.jsx에 RequireAdmin 라우트, AdminLayout **밖**(사이드바 없음).
- `GET /orders/admin/batch`로 1회 조회 → 주문당 1페이지(포장용): 상호+주문번호+주문일 / 수취인·연락처·(우편번호)주소 / **배송메모 강조** / 품목 표(이름·옵션·수량 — 금액 없음) / 택배사·송장(있으면).
- `@media print { .order-sheet { page-break-after: always } }`, 로드 완료 후 자동 `window.print()`.
- OrderDetail에 단건 `주문서 인쇄` 버튼 추가(새 탭).

## 6. 에러 처리·안전

- 일괄 처리도 건별 상태머신·refund 잠금·saga를 통과 — 우회 경로 없음. 실패는 건너뛰고 사유 수집(부분 성공).
- 상한: bulk 100건, batch 인쇄 50건, export 5,000행.
- counts/summary/export/batch는 read-only.
- bulk/tracking의 orderNumber는 형식 검증(`^\d{8}-\d{6}$`) 후 조회.

## 7. 테스트

- 서버(vitest+supertest): applyTransition 추출 회귀(기존 단건 API 계약 불변 확인), bulk/status 부분 성공(정상+전이불가+refund잠금 혼합), bulk/tracking(정상+미존재 주문번호+송장누락), counts, production-summary(멀티 옵션 그룹·수량 합), export(BOM·헤더·이스케이프), batch(50 초과 400).
- 클라: `vite build` + 수동(탭·일괄 흐름·CSV 왕복·인쇄 미리보기).

## 8. 비범위

반품/교환 관리, 구매확정·정산, 알림톡/문자 발송, 택배사 API 연동(송장 유효성·배송 추적), 다중 운영자 권한 분리, 재고 관리.
