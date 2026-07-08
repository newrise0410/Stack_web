import { useEffect, useRef } from 'react';
import { loadPostcodeScript } from '../lib/daumPostcode.js';

// 다음 우편번호 검색을 모달 안에 임베드.
// onSelect({ zipcode, address1 }) 로 결과 전달 후 닫힘.
export default function PostcodeModal({ open, onClose, onSelect }) {
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    loadPostcodeScript()
      .then(() => {
        if (cancelled || !boxRef.current) return;
        boxRef.current.innerHTML = '';
        new window.daum.Postcode({
          oncomplete: (data) => {
            onSelect({
              zipcode: data.zonecode,
              address1: data.roadAddress || data.jibunAddress,
            });
            onClose();
          },
          width: '100%',
          height: '100%',
        }).embed(boxRef.current);
      })
      .catch(() => onClose());

    return () => {
      cancelled = true;
    };
  }, [open, onClose, onSelect]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div className="w-full max-w-md bg-paper shadow-xl" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-medium">우편번호 검색</span>
          <button onClick={onClose} className="text-mute hover:text-ink" aria-label="닫기">✕</button>
        </div>
        <div ref={boxRef} style={{ height: 460 }} />
      </div>
    </div>
  );
}
