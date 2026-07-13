# Component Spec — HeroCampaign (3열 캠페인 히어로)

- 타깃 파일: `client/src/components/home/HeroCampaign.jsx`
- 소스 구조: 29cm 홈 히어로 — 뷰포트 폭 3분할, 타일당 ≈603×723(4:5), xl 좌우 화살표.
- 모드: **구조 이식** (레이아웃만; 이미지·문구·링크는 우리 카탈로그).

## 레이아웃
- 컨테이너: full-bleed `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (max-width 없음, 화면 끝까지).
- 타일: `aspect-[4/5]`, 이미지 `object-cover`, hover `scale-105`(1200ms).
- 오버레이: 하단 다크 그라디언트 `from-black/60`.
- 텍스트: eyebrow(대문자 트래킹) + 제목(2xl bold) + 서브카피(paper/80) + CTA(밑줄 hover).

## Props
`tiles: [{ eyebrow, title, subtitle, cta, to, image }]` — Home에서 카탈로그로 구성.

## 반응형
- 데스크톱(lg): 3열 / 태블릿(sm): 2열 / 모바일: 1열 세로 스택.

## 상태
- 정적. (원본의 롤링 캐러셀은 이번 범위 밖 — VISUAL_QA 갭 참조.)
