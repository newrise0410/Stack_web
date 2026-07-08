// 별점 표시 (읽기 전용). value 0~5, 반올림해 채운다. 모노톤 스타일.
export default function Stars({ value = 0, size = 'text-[13px]' }) {
  const filled = Math.round(value);
  return (
    <span className={`inline-flex leading-none ${size}`} aria-label={`별점 ${value}점 (5점 만점)`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= filled ? 'text-ink' : 'text-line'}>
          ★
        </span>
      ))}
    </span>
  );
}
