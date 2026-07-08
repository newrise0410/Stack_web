# Stack N' Stak 관리자 콘솔 설계

작성일: 2026-07-09
상태: 설계 승인 대기
관련 메모리: [[stacknstak-project]]

## 1. 개요 · 목표

현재 어드민(`/admin`)은 단일 페이지 3탭(상품 CRUD / 회원 조회 / 주문 상태변경)이다. 커머스 전 흐름(상품→장바구니→결제→주문→리뷰→위시리스트)은 완성됐지만, **운영자가 실제로 쇼핑몰을 굴리는 도구**가 부족하다. 이 설계는 어드민을 실제 e-커머스 관리 콘솔 수준으로 **4단계에 걸쳐 종합 구축**한다.

목표:
- 운영자가 한눈에 상태를 파악(대시보드)하고, 주문을 처리(상세·배송)하고, 회원·리뷰·상품을 관리할 수 있게 한다.
- 딥링크 가능한 상세 화면(주문/회원)과 확장 가능한 구조를 갖춘다.
- 기존 코드 컨벤션(Express MVC + asyncHandler + requireAdmin, React Router + Context, Tailwind 모노톤)을 그대로 따른다.

비목표(스터디 범위):
- 실 PG 결제/환불(현행 mock 유지, 환불은 상태변경으로 표현)
- 이미지 파일 업로드(현행 URL 입력 유지 — 미리보기·순서조정만 보강)
- 어드민 하위 권한(staff/superadmin 등 세분화), 감사 로그(audit trail)
- 실시간(웹소켓) 갱신

## 2. 아키텍처 (승인된 안 B — 중첩 라우트 + 어드민 셸)

### 라우팅
`/admin`을 레이아웃으로 만들고 하위를 중첩 라우트로 구성한다. 전체를 `RequireAdmin`으로 감싼다.

```
/admin                     → Dashboard (index)
/admin/orders              → OrdersAdmin (목록 + 필터)
/admin/orders/:id          → OrderDetail
/admin/products            → ProductsAdmin (기존 로직 이관)
/admin/members             → MembersAdmin
/admin/members/:id         → MemberDetail
/admin/reviews             → ReviewsAdmin
/admin/analytics           → Analytics
```

App.jsx:
```jsx
<Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
  <Route index element={<Dashboard />} />
  <Route path="orders" element={<OrdersAdmin />} />
  <Route path="orders/:id" element={<OrderDetail />} />
  <Route path="products" element={<ProductsAdmin />} />
  <Route path="members" element={<MembersAdmin />} />
  <Route path="members/:id" element={<MemberDetail />} />
  <Route path="reviews" element={<ReviewsAdmin />} />
  <Route path="analytics" element={<Analytics />} />
</Route>
```

### 화면 골격
```
┌─────────────────────────────────────────────┐
│ STACK N' STAK · 관리자            김철수님 ▾  │
├────────────┬────────────────────────────────┤
│ 대시보드    │  <Outlet /> — 중첩 라우트 콘텐츠 │
│ 주문        │                                │
│ 상품        │                                │
│ 회원        │                                │
│ 리뷰        │                                │
│ 분석        │                                │
└────────────┴────────────────────────────────┘
```
- 데스크톱: 좌측 고정 사이드바(`NavLink` active 강조) + 콘텐츠. 모바일: 사이드바를 상단 가로 스크롤 탭 또는 접이식으로(반응형은 Phase 4에서 다듬음).
- 스토어프론트 `Header`는 어드민 레이아웃에선 숨기고 전용 상단바를 쓴다(어드민은 별개 컨텍스트).

### 파일 배치
```
client/src/
  components/admin/AdminLayout.jsx      (사이드바 + Outlet)
  components/admin/StatCard.jsx, StatusBadge.jsx, DataTable.jsx, Pagination.jsx  (공용)
  pages/admin/Dashboard.jsx
  pages/admin/OrdersAdmin.jsx
  pages/admin/OrderDetail.jsx
  pages/admin/ProductsAdmin.jsx         (기존 pages/Admin.jsx의 상품 로직 이관)
  pages/admin/MembersAdmin.jsx
  pages/admin/MemberDetail.jsx
  pages/admin/ReviewsAdmin.jsx
  pages/admin/Analytics.jsx
  lib/admin.js                          (어드민 API 헬퍼 모음)
  lib/toast.jsx                         (Phase 4 — 토스트 컨텍스트)
server/src/
  controllers/adminController.js        (stats, analytics, member 상세)
  routes/admin.js                       (GET /admin/stats, /admin/analytics, /admin/members/:id)
```
기존 `pages/Admin.jsx`는 폐기하고 로직을 `pages/admin/*`로 분해한다. 기존 `lib/orders.js`의 `fetchAllOrders/updateOrderStatus`는 `lib/admin.js`로 흡수하거나 재사용한다.

## 3. 데이터 모델 변경

| 모델 | 변경 | 이유 |
|------|------|------|
| `Order` | `trackingNumber: String`, `courier: String` 추가 | 배송중 상태의 송장 관리 |
| `User` | `status: { enum: ['active','suspended'], default 'active' }` 추가 | 회원 정지 |
| `Review` | `hidden: { type: Boolean, default: false }` 추가 | 리뷰 숨김(soft moderation) |

모두 하위호환(기본값 존재, 기존 문서에 필드 없어도 안전). 마이그레이션·재시드 불필요.

## 4. 백엔드 설계 (단계별)

공통: 모든 어드민 엔드포인트는 `requireAuth, requireAdmin`. 응답은 기존 관례(`{ page, limit, total, items }` 또는 리소스 객체).

### Phase 1 — 운영 코어
1. **`GET /admin/stats`** (adminController.getStats) — 대시보드용 집계. `$facet` 단일 쿼리:
   ```json
   {
     "sales":   { "today": 128000, "month": 2400000 },
     "orders":  { "pending":0,"paid":3,"preparing":2,"shipped":1,"delivered":10,"cancelled":1 },
     "toHandle": 5,
     "members": { "total": 42, "newToday": 2 },
     "products":{ "total":14,"active":12,"soldout":1,"draft":1 },
     "recentOrders": [ { "_id","orderNumber","createdAt","recipient","grandTotal","status" } ]
   }
   ```
   - 매출은 `status != cancelled` 주문의 `amounts.grandTotal` 합. today/month 경계는 서버 로컬 자정 기준.
2. **`listAllOrders` 확장** — `?status=&from=&to=&q=&page=&limit=`. `user`를 `name email`로 populate. `q`는 `orderNumber` 또는 `shippingAddress.recipient` 정규식 매칭. 목록 아이템에 고객명 노출.
3. **`updateOrderStatus` 상태머신** — 임의 전이 대신 허용 전이표를 강제:
   ```
   pending   → paid, cancelled
   paid      → preparing, cancelled
   preparing → shipped, cancelled
   shipped   → delivered, shipped(동일상태 재요청=송장 수정용)
   delivered → (종료)
   cancelled → (종료, 되돌리기 없음)
   ```
   - 허용되지 않은 전이는 400. `cancelled`는 종료 상태 → 기존 "취소 해제 시 salesCount 재가산" 경로 제거(더 단순·안전).
4. **송장 저장** — 별도 엔드포인트 없이 `PATCH /orders/:id/status` 바디로 처리한다: `{ status, courier?, trackingNumber? }`. `status === 'shipped'`면 `trackingNumber` 필수(없으면 400). 이미 shipped인 주문의 송장 수정은 같은 엔드포인트에 `status:'shipped'`로 재요청(동일 상태 재전이 허용).

### Phase 2 — 회원 · 리뷰
5. **`PATCH /users/:id/role`** (admin) — `{ role: 'admin'|'client' }`. 가드: **본인 역할 변경 불가**(셀프 강등 잠금 방지). `UPDATE_FIELDS`는 그대로(role 미포함) 두고 별도 엔드포인트로 분리 — 일반 프로필 수정으로 권한 상승 못 하게.
6. **`PATCH /users/:id/status`** (admin) — `{ status: 'active'|'suspended' }`. 본인 정지 불가.
7. **로그인 차단** — `authController.login`(및 socialLogin)에서 `user.status === 'suspended'`면 403("정지된 계정"). 기존 토큰은 만료까지 유효(스터디 범위 — requireAuth 실시간 차단은 선택).
8. **`GET /admin/members/:id`** (admin, adminController.getMember) — 회원 상세용. 응답: 회원 프로필(passwordHash 제외) + 해당 회원 주문 목록 + 집계 `{ orderCount, totalSpent }`(취소 제외 grandTotal 합). 이걸로 회원상세 화면을 단일 호출로 채운다.
9. **`GET /reviews/admin`** (admin) — `?product=&page=&limit=`. 숨김 포함 전체, `product`(name/slug)·`user`(name) populate.
10. **`PATCH /reviews/:id/hidden`** (admin) — `{ hidden: bool }`. 공개 `listReviews`는 `hidden:{$ne:true}`만. `recomputeRating`의 `$match`에도 `hidden:{$ne:true}` 추가(숨긴 리뷰는 평점 미반영).

### Phase 3 — 상품 보강
11. **`listAllProducts` 페이지네이션·필터** — `?status=&type=&q=&sort=&page=&limit=`. 응답에 `{page,limit,total,items}`. 판매수(`salesCount`)·평점(`ratingAvg/ratingCount`)은 이미 문서에 있음 → 컬럼으로 노출.

### Phase 4 — 분석
12. **`GET /admin/analytics`** (adminController.getAnalytics) — `?period=7d|30d|12m`. 기간별 매출 시계열(일/월 버킷, `$group` by date) + 베스트셀러(`salesCount` top N) + 타입별 매출.

## 5. 프론트엔드 설계 (단계별)

### 공용 컴포넌트
- `StatCard` — 라벨/값/보조텍스트. 대시보드 KPI.
- `StatusBadge` — 주문 상태 라벨+톤(모노톤, cancelled는 흐리게).
- `DataTable` — 반응형 표 래퍼(가로 스크롤 컨테이너 + 헤더/행 슬롯). 각 목록이 재사용.
- `Pagination` — page/total/limit → 이전/다음 + 페이지 표기. `useSearchParams`로 URL 연동.

### Phase 1
- **Dashboard** (`/admin`): 상단 KPI 카드(오늘/이번달 매출, 처리필요 주문, 신규회원, 품절수), 주문 상태별 건수 요약, 최근 주문 5건 표(→상세 링크), "처리 필요"(paid·preparing) 바로가기.
- **OrdersAdmin** (`/admin/orders`): 상태 탭/셀렉트 + 기간 + 검색(주문번호·받는사람) 필터(URL 연동), 표(주문번호/일자/고객/금액/상태/상세링크), Pagination.
- **OrderDetail** (`/admin/orders/:id`): 고객(이름·이메일), 배송지 전체(받는사람·전화·주소·메모), 품목 스냅샷 표, 금액 breakdown, 상태 변경(허용 전이만 셀렉트 노출), shipped 전환 시 택배사·송장번호 입력, 상태 이력은 생략(단순).

### Phase 2
- **MembersAdmin** (`/admin/members`): 검색(이메일·이름), 표(이메일/이름/역할/상태/가입일/상세), 역할·정지 토글(확인 후 PATCH), Pagination.
- **MemberDetail** (`/admin/members/:id`): 프로필, 배송지, 주문 내역·총 구매액, 역할/정지 제어.
- **ReviewsAdmin** (`/admin/reviews`): 상품 필터, 표(상품/작성자/별점/내용/작성일/숨김·삭제), 숨김 토글·삭제.

### Phase 3
- **ProductsAdmin** (`/admin/products`): 기존 CRUD 유지 + 검색/타입·상태 필터/정렬, Pagination, 상태·뱃지 인라인 빠른변경, 이미지 URL 입력 옆 **썸네일 미리보기 + 순서 위/아래 이동**, 판매수·평점 컬럼.

### Phase 4
- **Analytics** (`/admin/analytics`): 기간 선택 + **의존성 없는 인라인 SVG 막대 차트**(모노톤)로 매출 추이, 베스트셀러 표, 타입별 매출 도넛/막대.
- **Toast 시스템**: `lib/toast.jsx`(Provider + `useToast`) + `components/Toast.jsx`. `window.alert/confirm`을 점진 대체(성공/실패 피드백). 파괴적 동작(삭제·역할변경)은 확인 모달 컴포넌트로.
- **반응형 사이드바**: 모바일에서 접이식/오프캔버스. 모든 목록 필터·페이지 상태 URL 연동 마무리.

## 6. 보안 고려
- 모든 어드민 API는 `requireAdmin`. 역할 상승은 프로필 수정과 분리된 전용 엔드포인트로만(권한 상승 경로 차단).
- 본인 역할 강등/정지 금지(운영자 셀프 잠금 방지).
- 정지 회원 로그인 차단.
- 상태 전이 서버측 강제(클라 신뢰 안 함). 금액·집계는 서버 authoritative.

## 7. 검증 전략 (기존 관례 계승)
- 백엔드: 단계별 curl 스모크(권한 401/403, 상태머신 400, 집계 값 확인).
- 프론트: Playwright E2E(대시보드 KPI 렌더, 주문 상세·상태변경, 회원 역할토글, 리뷰 숨김, 상품 필터).
- 각 단계 완료 후 change-review 워크플로(적대적 리뷰)로 회귀 검증 → 확정 버그 수정 → 커밋/푸시.

## 8. 단계별 산출물 요약
| Phase | 백엔드 | 프론트 | 모델 |
|-------|--------|--------|------|
| 1 운영 코어 | stats, orders populate+filter, 상태머신, tracking | AdminLayout, Dashboard, OrdersAdmin, OrderDetail, 공용컴포넌트 | Order.trackingNumber/courier |
| 2 회원·리뷰 | role/status PATCH, 로그인 차단, reviews/admin, hidden | MembersAdmin, MemberDetail, ReviewsAdmin | User.status, Review.hidden |
| 3 상품 보강 | listAllProducts 페이지네이션·필터 | ProductsAdmin 이관+보강 | — |
| 4 분석·UX | analytics 집계 | Analytics, Toast, 반응형 | — |

각 Phase는 독립 배포 가능하며, Phase 1이 운영 가치가 가장 크므로 먼저 구현한다.
