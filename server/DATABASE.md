# Stack N' Stak — 데이터베이스 설계 (MongoDB / Mongoose)

주문제작(made-to-order) 3D 프린팅 램프 쇼핑몰. 금액은 모두 **정수 KRW(원)**로 저장한다(소수점 없음).

## 컬렉션 개요 & 관계

```
User ──1:N──> Order            (한 유저가 여러 주문)
User ──1:N──> Review           (한 유저가 여러 리뷰)
User ──1:1──> Cart             (유저당 장바구니 1개)
User ──N:M──> Product          (wishlist: 유저.wishlist[] = 상품 참조)
User  embeds  Address[]        (배송지 임베드)

Category ──1:N──> Product      (카테고리별 상품)
Product  ──1:N──> Review       (상품별 리뷰)
Product  embeds  Option[] / Variant[]   (컬러/사이즈 옵션·변형)

Order ──N:1──> User            (비회원 주문이면 null)
Order ──N:1──> Coupon          (선택)
Order  embeds  OrderItem[]     (구매 시점 스냅샷 — 상품이 바뀌어도 불변)
Order  embeds  Address, Payment
```

핵심 컬렉션: **users, products, categories, carts, orders, reviews, coupons**

---

## 1. `users`

| 필드 | 타입 | 설명 |
|---|---|---|
| `_id` | ObjectId | |
| `email` | String | **unique index**, 로그인 ID (소문자 정규화) |
| `passwordHash` | String | bcrypt (provider=local일 때) |
| `provider` | String enum | `local` \| `kakao` \| `naver` (기본 local) |
| `providerId` | String \| null | 소셜 로그인 고유 ID |
| `name` | String | **실명** — 주문/배송용 |
| `nickname` | String \| null | **선택** — 리뷰 등 공개 표시명(미입력 시 실명 마스킹) |
| `phone` | String | |
| `role` | String enum | `client` \| `admin` (기본 **client**) — 접근권한 구분 |
| `emailVerified` | Boolean | 기본 false |
| `phoneVerified` | Boolean | 기본 false |
| `agreements` | Object | 약관 동의 이력 (아래) |
| `addresses` | \[Address] | 배송지 임베드 (아래) |
| `wishlist` | \[ObjectId→Product] | 찜 목록 |
| `createdAt / updatedAt` | Date | timestamps |

**Address (임베드)**: `{ label, recipient, phone, zipcode, address1, address2, deliveryMemo, isDefault:Boolean }`
- `zipcode`·`address1`은 우편번호 검색 API(카카오/다음)로 자동 입력, `address2`(상세주소)만 직접 입력.

**agreements (임베드)** — 각 동의는 동의여부+시각+약관버전을 저장(법적 요건):
```
{
  termsOfService: { agreed:Boolean, at:Date, version:String },  // 필수
  privacy:        { agreed:Boolean, at:Date, version:String },  // 필수
  ageOver14:      { agreed:Boolean, at:Date },                  // 필수
  marketing:      { email:Boolean, sms:Boolean, at:Date },      // 선택
  thirdParty:     { agreed:Boolean, at:Date },                  // 선택
}
```

**회원가입 수집 항목**: (필수) 이메일·비밀번호·이름·휴대폰 + 필수동의 3개 / (선택) 닉네임·마케팅동의 · 주소는 결제 또는 마이페이지에서 등록.

**역할(role) — 접근 권한**:
- `client` (일반 회원): 주문·장바구니·리뷰·본인 정보. 가입 시 기본값.
- `admin` (관리자): 상품 등록/수정, 주문 상태 변경, 회원·쿠폰 관리.
- API에서 `requireAuth`(로그인) / `requireAdmin`(role==='admin') 미들웨어로 보호. **role은 클라이언트가 지정 불가** — 회원가입 시 서버가 항상 `client`로 강제하고, admin 승격은 별도 관리자 경로로만.

인덱스: `email` unique.

---

## 2. `categories`

카테고리를 enum이 아닌 컬렉션으로 두어 확장(향후 시계·오브제 재도입) 대비. 현재는 Lighting 하위에 램프 타입.

| 필드 | 타입 | 설명 |
|---|---|---|
| `_id` | ObjectId | |
| `slug` | String | **unique** (`lighting`, `table`, `pendant`, `moon-wall`) |
| `name / nameKo` | String | 표시명 |
| `parent` | ObjectId→Category \| null | 트리 구조 |
| `order` | Int | 정렬 순서 |

인덱스: `slug` unique, `parent`.

---

## 3. `products`

현재 `client/src/data/products.js` 필드를 그대로 흡수한다.

| 필드 | 타입 | 프론트 대응 | 설명 |
|---|---|---|---|
| `_id` | ObjectId | | |
| `slug` | String | `id` | **unique index** (`ola-lamp`) |
| `brand` | String | `brand` | 기본 "STACK N' STAK" |
| `name` | String | `name` | 영문명 |
| `nameKo` | String | `ko` | 국문명 |
| `category` | ObjectId→Category | `category` | Lighting |
| `type` | String enum | `type` | `Table`\|`Pendant`\|`MoonWall` |
| `description` | String | `blurb` | |
| `images` | \[String] | `image` | 갤러리(첫 장이 대표) |
| `price` | Int | `price` | 기본가(원) |
| `compareAtPrice` | Int \| null | `compareAt` | 할인 표시용 정가 |
| `badges` | \[String enum] | `badge` | `NEW`\|`BEST`\|`SALE` |
| `specs` | Object | material/dims/feature/made | `{ material, dimensions, feature, leadTime }` |
| `madeToOrder` | Boolean | (도메인) | 기본 true |
| `leadTimeDays` | `{ min, max }` | `made` 파싱 | 제작 소요일 |
| `options` | \[OptionGroup] | `options` | `{ name, values:[] }` (예: Colorway) |
| `variants` | \[Variant] | — | 옵션 조합별 SKU/가격차/재고 |
| `status` | String enum | — | `active`\|`draft`\|`soldout`\|`archived` |
| `ratingAvg` | Number | — | 리뷰 집계(비정규화) |
| `ratingCount` | Int | — | 리뷰 수 |
| `salesCount` | Int | — | 판매량(BEST 랭킹용) |
| `createdAt/updatedAt` | Date | | timestamps |

**OptionGroup(임베드)**: `{ name:'Colorway', values:['Warm White','Ivory'] }`
**Variant(임베드)**: `{ sku, optionValues:{Colorway:'Warm White'}, priceDelta:Int(기본0), stock:Int|null }`
→ 주문제작이라 재고 미관리 시 `stock:null`(무제한). 사이즈처럼 가격이 다르면 `priceDelta` 사용.

인덱스: `slug` unique · `{ type, status }`(목록) · `{ salesCount:-1 }`(랭킹) · `name` **text**(검색) · `badges`.

---

## 4. `carts`

유저당 1개(비회원은 `sessionId`). 가격은 조회 시점에 상품에서 계산, 담을 때 스냅샷은 선택.

| 필드 | 타입 | 설명 |
|---|---|---|
| `user` | ObjectId→User \| null | 회원 |
| `sessionId` | String \| null | 비회원 |
| `items` | \[CartItem] | |
| `updatedAt` | Date | TTL(비회원 30일) 후보 |

**CartItem**: `{ product:ObjectId→Product, variantSku:String|null, optionSelections:Object, qty:Int }`

인덱스: `user` unique(sparse), `sessionId`.

---

## 5. `orders`

주문 항목은 **구매 시점 스냅샷**으로 임베드 — 이후 상품/가격이 바뀌거나 삭제돼도 주문 내역은 불변.

| 필드 | 타입 | 설명 |
|---|---|---|
| `orderNo` | String | **unique index**, 사람이 읽는 번호 `20260708-000123` |
| `user` | ObjectId→User \| null | 비회원 주문 허용 |
| `items` | \[OrderItem] | 스냅샷(아래) |
| `amounts` | Object | `{ subtotal, discount, shippingFee, total }` (원) |
| `coupon` | `{ code, discount } \| null` | 적용 쿠폰 |
| `shippingAddress` | Address | 배송지 스냅샷 |
| `payment` | Payment | 결제(아래) |
| `status` | String enum | 주문 상태(아래 플로우) |
| `statusHistory` | \[`{status, at}`] | 상태 변경 로그 |
| `shipping` | `{ carrier, trackingNo }` | 송장 |
| `createdAt/updatedAt` | Date | timestamps |

**OrderItem(스냅샷)**: `{ product:ObjectId, slug, name, nameKo, image, optionSelections, unitPrice:Int, qty:Int, lineTotal:Int }`
**Payment**: `{ method:'card'|'kakaopay'|'tosspay'|'vbank', status:'pending'|'paid'|'failed'|'refunded', paidAt, pgTransactionId }`

**주문 상태 플로우(주문제작 반영)**:
`pending → paid → in_production(제작중) → shipped → delivered`
(취소/환불: `cancelled`, `refunded`)

인덱스: `orderNo` unique · `{ user, createdAt:-1 }`(주문내역) · `status`.

---

## 6. `reviews`

구매 확인 리뷰. 상품 집계(`ratingAvg/Count`)는 저장/삭제 훅에서 갱신.

| 필드 | 타입 | 설명 |
|---|---|---|
| `product` | ObjectId→Product | index |
| `user` | ObjectId→User | |
| `order` | ObjectId→Order | 구매 검증 |
| `rating` | Int 1–5 | |
| `content` | String | |
| `images` | \[String] | 포토리뷰 |
| `createdAt` | Date | |

인덱스: `{ product, createdAt:-1 }` · unique `{ user, order, product }`(중복 방지).

---

## 7. `coupons` (선택)

| 필드 | 타입 | 설명 |
|---|---|---|
| `code` | String | **unique index** |
| `type` | String enum | `percent` \| `fixed` |
| `value` | Int | 퍼센트 또는 원 |
| `minOrderAmount` | Int | 최소 주문금액 |
| `maxDiscount` | Int \| null | 정률 상한 |
| `startsAt / endsAt` | Date | 유효기간 |
| `usageLimit / usedCount` | Int | 전체 사용 한도 |
| `perUserLimit` | Int | 인당 한도 |

---

## 설계 원칙 (요약)

1. **금액은 정수 원(KRW)** — 부동소수점 오차 방지.
2. **주문 항목 스냅샷** — 상품 변경/삭제와 무관하게 주문 내역 불변.
3. **주문제작 재고 모델** — 재고 차감 대신 `madeToOrder`+`leadTimeDays`+`in_production` 상태. 변형 재고는 `null`=무제한.
4. **집계 비정규화** — `ratingAvg/Count`, `salesCount`로 랭킹·정렬을 조인 없이.
5. **slug 사용** — 프론트가 이미 `ola-lamp` 식 id 사용, SEO 겸용.
6. **하드 삭제 대신 상태값** — 상품 `archived`, 주문 `cancelled`.
7. **timestamps 기본** — 모든 컬렉션 `{ timestamps: true }`.
8. **임베드 vs 참조** — 주소·주문항목·상품옵션은 임베드, 유저·상품·쿠폰은 참조.

## 단계 구분

- **Core (MVP)**: users(인증 최소), products, categories, carts, orders
- **Phase 2**: reviews, coupons, 소셜 로그인(kakao/naver), PG(토스/카카오페이) 연동, 비회원 장바구니 TTL
```
