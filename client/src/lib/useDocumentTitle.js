import { useEffect } from 'react';

const BASE = "Stack N' Stak";

const DEFAULT_TITLE = `${BASE} — additive objects`;

// 라우트별 document.title 설정. title 없으면 기본 브랜드명으로.
// 언마운트 시 기본값으로 복원해, 훅을 쓰지 않는 다음 페이지에 이전 제목이 남지 않게 한다.
export default function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${BASE}` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
