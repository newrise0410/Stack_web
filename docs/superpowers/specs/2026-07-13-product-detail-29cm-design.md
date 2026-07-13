# 상품 디테일 페이지 · 풀 29cm 리빌드 — 설계 스펙

날짜: 2026-07-13
대상: `client/src/pages/Product.jsx` 및 신규 `client/src/components/product/*`

## 목표
상품 디테일 페이지를 29cm PDP 경험에 맞춰 재구성한다. 기존 골격(브레드크럼 ·
2단 갤러리+스티키 구매패널 · 스펙 · 상세이미지 · 리뷰 · 관련상품)은 유지하되,
29cm 시그니처 요소(혜택 블록 · 배송정보 · 스티키 탭 내비 · 모바일 하단 고정
구매바 · 별점 분포바)를 추가한다.

## 제약
- 디자인 토큰 그대로: `ink/paper/tint/mute/faint/line/sale`, Pretendard. 신규 색 없음.
- 백엔드 변경 없음 — 전부 기존 데이터/상수 사용.
- 스터디 프로젝트, 목결제/목소셜 스코프. 29cm를 레퍼런스로 충실히 따른다.

## 실제 데이터 소스 (가짜 숫자 금지)
- 적립률: `EARN_RATE = 0.03` (결제액 3%). 표기 = `Math.floor(price * 0.03)`.
- 무료배송: `FREE_SHIPPING_THRESHOLD = 50000`. 미만이면 배송비 표기 + "5만원↑ 무료".
- 신규가입 적립: `SIGNUP_BONUS = 3000` → 쿠폰/혜택 안내 문구.

## 레이아웃 (위→아래)
1. Breadcrumb
2. 2단: 갤러리(좌) / 구매패널(우, sticky)
3. 스티키 탭 내비: 상품정보 | 리뷰(N) | 배송·반품 (스크롤 스파이, 헤더 아래 고정)
4. #상품정보 — 상세 이미지 스택 + 카피
5. #리뷰 — 별점 요약 카드(평균 + 5→1 분포바) + 리뷰 리스트
6. #배송·반품 — 배송/교환/반품 안내 테이블
7. 함께 보면 좋은 (관련 4개)
8. [모바일 전용] 하단 고정 구매바

## 컴포넌트 분리 (단일 책임)
- `product/Gallery.jsx` — 메인 이미지 + 썸네일 스트립 (mainImg 상태)
- `product/BuyPanel.jsx` — 우측 sticky 패널 컨테이너(브랜드/제목/평점/가격/혜택/옵션/수량/버튼/스펙)
- `product/BenefitBox.jsx` — 적립금/배송/쿠폰 3행 혜택 블록
- `product/StickyTabs.jsx` — 스티키 탭 + IntersectionObserver 스크롤 스파이
- `product/MobileBuyBar.jsx` — `md:hidden fixed bottom-0` 가격+버튼
- `product/ShippingInfo.jsx` — 배송·교환·반품 안내 테이블
- `RatingSummary.jsx` — 별점 평균 + 분포바 (ReviewSection 상단에 삽입)

## 세부 사양
### 혜택 블록 (BenefitBox)
`bg-tint` 박스, 라벨-값 3행. 라벨 `text-mute w-16`, 값 `text-ink`.
- 적립금: `3% (3,840원)`
- 배송: 5만원↑ `무료배송` / 미만 `{fee}원 · 5만원 이상 무료`
- 쿠폰: 비로그인 "회원가입 시 3,000원 적립금" / 로그인 시 생략 또는 "회원 혜택"

### 스티키 탭 (StickyTabs)
`sticky top-[헤더높이]` `bg-paper/95 backdrop-blur` border-b. 탭 클릭 → 섹션으로
`scrollIntoView({behavior:'smooth'})`. `IntersectionObserver`(rootMargin 상단 오프셋)로
현재 섹션 active 언더라인(`ink`). 탭: 상품정보 / 리뷰(N) / 배송·반품.

### 모바일 하단 고정바 (MobileBuyBar)
`md:hidden fixed inset-x-0 bottom-0 z-40 bg-paper border-t`. 좌측 가격, 우측
[장바구니][바로구매]. 품절 시 단일 비활성 버튼. 데스크톱은 sticky 패널이 대체.

### 별점 분포바 (RatingSummary)
좌: 큰 평균 숫자 + 별. 우: 5→1점 막대(`line` 트랙 위 `ink` 채움) + 카운트.
분포는 리뷰 목록 집계(ReviewSection이 이미 목록 보유) 또는 상품 집계값 사용.

## 스코프 제외 (YAGNI)
- Q&A 탭 (백엔드 없음)
- 포토리뷰 그리드 (리뷰 이미지 없음)
- 쿠폰 다운로드 (계정 단위, 상품별 없음)

## 검증
- 로컬 dev 빌드 후 데스크톱/모바일 뷰포트에서 렌더 확인(Playwright 스크린샷).
- 콘솔 에러 0, 스크롤 스파이 동작, 모바일 바 노출/데스크톱 숨김 확인.
