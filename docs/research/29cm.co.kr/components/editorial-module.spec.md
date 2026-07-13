# Component Spec — EditorialModule (3열 에디토리얼 + 상품 리스트)

- 타깃 파일: `client/src/components/home/EditorialModule.jsx`
- 소스 구조: 29cm 홈 히어로 아래 모듈 — 3열, 각 열 = 상단 이미지 카드 + 제목 +
  서브카피 + 세로 상품 리스트(썸네일·브랜드·이름·할인%·가격·찜).
- 모드: **구조 이식** (레이아웃만; 콘텐츠는 우리 카탈로그).

## 레이아웃
- 컨테이너: `mx-auto max-w-[1280px] px-5`, `grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-10`.
- 열: 이미지 카드 `aspect-[4/3]` hover scale + 제목(lg bold) + 서브카피(mute).
- 상품 리스트: `divide-y divide-line`, 행 = 썸네일 56px + 브랜드(11 mute) +
  이름(13 truncate) + 할인%(sale) + 가격(bold) + `WishButton`.

## Props
`columns: [{ title, subtitle, to, image, products: [] }]` — Home에서 타입별 구성.
빈 열(products 없음)은 Home에서 filter로 제외.

## 반응형
- 데스크톱(md): 3열 / 모바일: 1열 스택.

## 재사용
- `WishButton`(실제 찜 토글), `won`·`discountRate`, `cldUrl` — 기존 유틸 그대로.
