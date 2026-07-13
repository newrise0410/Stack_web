import Stars from './Stars.jsx';

// 별점 요약 카드 — 평균 + 5→1점 분포바. dist는 { 5:n, 4:n, ... } 실제 집계.
export default function RatingSummary({ avg = 0, count = 0, dist = {} }) {
  if (!count) return null;

  return (
    <div className="flex flex-col items-center gap-8 border border-line bg-tint px-6 py-7 sm:flex-row sm:gap-12">
      <div className="text-center">
        <p className="text-4xl font-bold leading-none">{avg.toFixed(1)}</p>
        <div className="mt-2 flex justify-center">
          <Stars value={avg} />
        </div>
        <p className="mt-1.5 text-[12px] text-mute">리뷰 {count}개</p>
      </div>

      <dl className="w-full max-w-xs space-y-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = dist[star] || 0;
          const pct = count ? Math.round((n / count) * 100) : 0;
          return (
            <div key={star} className="flex items-center gap-3 text-[12px]">
              <dt className="w-6 shrink-0 text-mute">{star}점</dt>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
              </div>
              <dd className="w-7 shrink-0 text-right text-mute">{n}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
