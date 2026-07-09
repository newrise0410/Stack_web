# 주문 이메일 · 쿠폰 · 적립금 설계 (Stack N' Stak)

> 스터디용 쇼핑몰. 실 PG 미연동(mock 결제), mock 소셜 로그인 전례를 따름.
> 서버 권위 가격(클라이언트 금액 불신) 원칙 유지. 통화는 정수 KRW.

**Goal:** 주문 이메일 알림(목업), 쿠폰(정액/정률/무료배송), 적립금(적립·사용·가입보너스)을 추가하고 체크아웃·관리자·마이페이지에 통합한다.

**빌드 순서:** Phase A 이메일 → Phase B 쿠폰 → Phase C 적립금. 각 Phase는 구현 → 적대적 리뷰 → 수정 → E2E → 커밋·푸시.

---

## 전역 제약 (모든 Phase 공통)

- 금액은 정수 KRW. 모든 할인·적립·차감은 서버가 DB 기준으로 재계산. 클라이언트는 `couponCode`, `pointsToUse`만 전송.
- 신규 부작용(이메일 생성, salesCount 등)은 주문 성공을 막지 않도록 try/catch로 분리.
- 관리자 전용 라우트는 `requireAuth, requireAdmin`, `/:id` 파라미터 라우트보다 먼저 등록.
- `.env` 커밋 금지(기존 정책).
- 신규 모델은 `timestamps:true`, `toJSON`에서 `__v` 제거(기존 패턴).

---

## 데이터 모델

### 신규 컬렉션

**EmailMessage** (`models/EmailMessage.js`)
```
to: String (수신 이메일)
subject: String
body: String (평문/간단 텍스트)
type: enum ['order_placed','order_status']   // 확장 여지: 'welcome'
statusLabel: String (order_status일 때 '배송중' 등, 표시용)
order: ObjectId ref Order (nullable)
user: ObjectId ref User (nullable)
createdAt (timestamps)
```

**Coupon** (`models/Coupon.js`)
```
code: String, required, unique, uppercase, trim   // 예 'WELCOME10'
name: String, required                            // 표시명
discountType: enum ['fixed','percent','free_shipping'], required
discountValue: Number, default 0                  // fixed=원, percent=%, free_shipping=미사용
maxDiscount: Number, default 0                    // percent 상한(0=무제한)
minOrderAmount: Number, default 0                 // 상품금액 기준 최소주문
expiresAt: Date, nullable                         // null=무기한
active: Boolean, default true
timestamps
```

**UserCoupon** (`models/UserCoupon.js`) — 회원 보유/사용 상태 = 1인 1회 근거
```
user: ObjectId ref User, required, index
coupon: ObjectId ref Coupon, required
used: Boolean, default false
usedOrder: ObjectId ref Order, nullable
usedAt: Date, nullable
issuedBy: enum ['admin','self']  // 발급 경로(관리자 발급 / 코드 입력)
timestamps
index: unique(user, coupon)      // 한 회원은 같은 쿠폰 1장
```

**PointTransaction** (`models/PointTransaction.js`) — 적립금 원장
```
user: ObjectId ref User, required, index
amount: Number, required                 // +적립 / -사용·회수
type: enum ['signup','earn','spend','reclaim','refund','admin_adjust'], required
order: ObjectId ref Order, nullable
balanceAfter: Number, required           // 거래 직후 잔액(감사용)
note: String, default ''
timestamps
```

### 기존 모델 확장

**User** — `points: { type: Number, default: 0 }` 추가(role/status 인근). 잔액의 단일 진실은 `User.points`, 이력은 `PointTransaction`.

**Order** — 아래 추가. `amounts` 하위 필드 확장.
```
coupon: { code: String default '', discount: Number default 0 } // 적용 쿠폰 스냅샷(상품/배송 할인 합)
pointsUsed:   Number, default 0
pointsEarned: Number, default 0
amounts: { itemsTotal, couponDiscount(default 0), shippingFee, pointsUsed(default 0), grandTotal }
```
> 하위호환: 기존 주문은 신규 필드 기본값(0/'')로 안전. 재시드 불필요.

---

## Phase A — 주문 이메일 (목업)

### 서비스
`services/emailService.js`
- `renderOrderPlaced(order)` → `{subject, body}` : 주문번호·수신자·품목·금액 요약.
- `renderOrderStatus(order, statusLabel)` → `{subject, body}` : 상태 변경 안내(배송중이면 택배사·송장 포함).
- `sendMock({ to, subject, body, type, statusLabel, order, user })` → `EmailMessage.create(...)`. 예외는 호출부에서 try/catch로 삼킴.
- 수신 이메일은 주문의 `user.email`(populate) 사용.

### 트리거 (주문 성공/상태변경을 막지 않도록 try/catch)
- `createOrder` 말미: `order_placed` 메일 1건.
- `updateOrderStatus`(admin): `paid/preparing 제외 실질 안내가 필요한` 전이 시 `order_status` 메일 — **shipped(송장 포함)·delivered·cancelled**. statusLabel은 한글 라벨.
- (cancelOrder 사용자 취소 시에도 `order_status`=취소 메일 1건.)

### API
- 관리자: `GET /admin/emails?type=&page=&limit=` — 전체 목록(`user`,`order` 최소 populate), 페이지네이션.
- 사용자: `GET /emails/me?page=` — 본인 앞으로 온 메일만.
- 라우트: `routes/emails.js`(`/emails/me` requireAuth) + `routes/admin.js`에 `/emails`.

### 프론트
- `lib/email.js`(fetchAdminEmails, fetchMyEmails).
- 관리자 **이메일 탭** `pages/admin/EmailsAdmin.jsx` : 목록 + 행 클릭 시 미리보기(제목/받는이/본문/주문 링크). AdminLayout NAV + App 라우트 `/admin/emails`.
- 마이페이지 **받은메일함 탭**(`?tab=emails`) : 본인 메일 목록 + 펼침 미리보기.

### 수용 기준
- 주문하면 order_placed 1건 저장, 수신자=본인 이메일. 관리자가 배송중/배송완료/취소 처리 시 각 1건. 메일 서비스 강제 실패해도 주문/상태변경은 성공.

---

## Phase B — 쿠폰

### 획득
- **관리자 발급**: 관리자가 회원에게 쿠폰 지급 → UserCoupon(available, issuedBy 'admin').
- **코드 입력**: 체크아웃/쿠폰함에서 코드 입력 → 유효하면 UserCoupon(available, issuedBy 'self') 생성(이미 보유면 재사용, used면 거절).

### 할인 계산 (서버, `services/couponService.js`)
`computeCoupon(coupon, itemsTotal, baseShipping)` →
```
검증: coupon.active && (!expiresAt || now<=expiresAt) && itemsTotal>=minOrderAmount
fixed:          itemDiscount = min(discountValue, itemsTotal)
percent:        raw = round(itemsTotal * discountValue/100);
                itemDiscount = maxDiscount>0 ? min(raw, maxDiscount) : raw
free_shipping:  itemDiscount = 0; shippingFee = 0
반환: { itemDiscount, shippingFee, discountTotal }   // discountTotal = itemDiscount + (배송할인분)
검증 실패 시 사유 메시지와 함께 throw/return null → 호출부 400
```

### 체크아웃 통합 (createOrder)
클라이언트 `couponCode`(선택) 전달. 서버:
1. itemsTotal 계산(기존).
2. couponCode 있으면 UserCoupon 조회(본인·미사용) + Coupon 로드 → `computeCoupon`. 유효하지 않으면 400.
3. baseShipping = 기존 규칙(3000, 5만↑무료). free_shipping이면 0.
4. `Order.coupon = {code, discount: discountTotal}`, `amounts.couponDiscount = itemDiscount`.
5. 주문 성공 후 UserCoupon → used(usedOrder/usedAt).

### 취소 원복
`cancelOrder` / `updateOrderStatus(cancelled)`: 적용된 UserCoupon을 available로 되돌림(used=false, usedOrder/usedAt null). (공통 헬퍼 `reverseOrderBenefits`.)

### API
- 관리자: `GET/POST /admin/coupons`, `PATCH /admin/coupons/:id`, `DELETE /admin/coupons/:id`, `POST /admin/members/:id/coupons {couponId}`(회원 발급).
- 사용자: `GET /coupons/me`(보유·사용 내역), `POST /coupons/claim {code}`(코드로 획득), `GET /coupons/available?itemsTotal=`(체크아웃 적용 가능 목록, 선택).
- 라우트: `routes/coupons.js` + `routes/admin.js` 확장.

### 프론트
- `lib/coupon.js`.
- 관리자 **쿠폰 탭** `pages/admin/CouponsAdmin.jsx`: CRUD 폼(코드·유형·값·최소주문·만료·활성) + 목록.
- MemberDetail: **쿠폰 발급** 섹션(회원에게 쿠폰 선택 발급).
- 마이페이지 **쿠폰함 탭**(`?tab=coupons`): 보유/사용, 코드 입력 폼.
- Checkout: 쿠폰 선택 드롭다운(보유 available) + 코드 입력 → 적용, 요약에 `쿠폰할인 −` 반영.

### 수용 기준
- 정액/정률/무료배송 각각 서버 계산이 정확(최소주문 미달·만료·중복사용 거절). 주문에 스냅샷 저장. 취소 시 쿠폰 복구.

---

## Phase C — 적립금 (포인트)

### 적립·사용·보너스
- **가입 보너스**: 신규 회원 생성 시 +3,000P (`grantSignupBonus`). 적용 지점 = `buildAndSaveUser`(signup·admin create) + `socialLogin` 신규 생성 브랜치.
- **적립**: 주문 생성(=mock 결제 완료 paid) 시 `pointsEarned = floor(grandTotal * 0.03)` 지급(type 'earn'). 상수 `EARN_RATE=0.03`.
- **사용**: 체크아웃에서 `pointsToUse`(정수) 전달. 서버가 `clamp(0, min(user.points, payableBeforePoints))`로 제한 후 차감(type 'spend'). payableBeforePoints = itemsTotal − couponItemDiscount + shippingFee.

### 잔액 갱신 규칙 (원장 일관성)
헬퍼 `applyPoints(userId, amount, type, {order, note})`:
- `User.points`를 원자적 증감(`$inc`)한 뒤 새 잔액으로 `balanceAfter` 기록, PointTransaction 생성.
- **음수 방지**: 회수/사용으로 잔액이 음수가 되면 0으로 클램프(스터디 단순화). 실제 차감액을 txn amount에 반영.

### 취소 원복 (공통 `reverseOrderBenefits`)
- 사용분 환급: `applyPoints(+pointsUsed, 'refund', order)`.
- 적립분 회수: `applyPoints(-pointsEarned, 'reclaim', order)` (0 클램프).
- 쿠폰 복구(Phase B).
- 한 번만 실행(cancelled는 종료 상태, cancelOrder는 paid/preparing에서만 허용 → 이중 실행 없음).

### 체크아웃 최종 가격 순서 (createOrder, 서버 권위)
```
itemsTotal            = Σ(price×qty)              (DB 재계산)
− couponItemDiscount  (fixed/percent)
+ shippingFee         (3000 / 5만↑무료 / free_shipping→0)
− pointsUsed          (clamp)
= grandTotal (≥0)
amounts = { itemsTotal, couponDiscount, shippingFee, pointsUsed, grandTotal }
적립 예정 = floor(grandTotal × 0.03)
```

### API
- 사용자: `GET /points/me`(잔액 + 최근 내역 페이지네이션).
- 관리자: `GET /admin/members/:id`(getMember에 points 잔액 + 최근 내역 포함), `POST /admin/members/:id/points {amount, note}`(수동 지급/차감 admin_adjust).
- 라우트: `routes/points.js` + `routes/admin.js` 확장.

### 프론트
- `lib/points.js`.
- MemberDetail: **적립금 카드(잔액)** + 수동 지급/차감 폼(사유) + 내역 리스트.
- 마이페이지 **적립금 탭**(`?tab=points`): 잔액 + 적립/사용 내역.
- Checkout: 적립금 사용 입력(최대 = min(잔액, 결제전금액)) + '모두 사용' 버튼, 요약 `적립금 사용 −` + `적립 예정 XP` 표시.
- 주문완료/상세: 적립 예정/사용 포인트 표기.

### 수용 기준
- 가입 시 3,000P + signup txn. 주문 시 3% 적립 + spend 차감(잔액·payable 초과 불가). 취소 시 환급·회수·0클램프. 관리자 수동 조정이 원장에 남음.

---

## 파일 구조 요약

```
server/src/
  models/          EmailMessage.js  Coupon.js  UserCoupon.js  PointTransaction.js  (+User.points, +Order 필드)
  services/        emailService.js  couponService.js  pointService.js(applyPoints/grantSignupBonus)
  controllers/     emailController.js  couponController.js  pointController.js
                   orderController.js(createOrder/cancel/updateStatus 통합 + reverseOrderBenefits)
                   adminController.js(getMember에 쿠폰·포인트, /admin 서브)
  routes/          emails.js  coupons.js  points.js  admin.js(확장)  orders.js
client/src/
  lib/             email.js  coupon.js  points.js
  pages/admin/     EmailsAdmin.jsx  CouponsAdmin.jsx  (MemberDetail 확장)
  pages/           Checkout.jsx(쿠폰·적립금)  MyPage.jsx(메일함·쿠폰함·적립금 탭)
  components/admin/ AdminLayout.jsx(NAV: 이메일·쿠폰 추가)
```

## 리스크 / 결정 메모
- **적립 시점 = 결제(주문 생성) 시**. createOrder가 즉시 paid 생성이므로 생성 시 적립. 취소 시 회수.
- **음수 잔액은 0 클램프**(스터디 단순화) — 실제 서비스라면 음수 허용/차단 정책 필요.
- **관리자 적립금·쿠폰발급은 회원상세(MemberDetail)에 통합**(별도 화면 X), 쿠폰 정의는 별도 쿠폰 탭.
- 동시성: 포인트/쿠폰은 단일 요청 내 순차 처리 + `$inc`/UserCoupon 상태로 보호. 트랜잭션(replica set 필요)은 스터디 범위에서 생략 — 부작용은 try/catch로 주문 성립 우선.
