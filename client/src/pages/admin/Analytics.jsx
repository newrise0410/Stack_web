import { useEffect, useState } from 'react';
import { fetchAnalytics } from '../../lib/admin.js';
import { won } from '../../lib/format.js';

const PERIODS = [
  { id: '7d', label: '최근 7일' },
  { id: '30d', label: '최근 30일' },
  { id: '12m', label: '최근 12개월' },
];

// 의존성 없는 인라인 SVG 막대 차트 (모노톤)
function BarChart({ series }) {
  if (!series.length) return <p className="py-10 text-center text-mute">데이터가 없습니다.</p>;
  const max = Math.max(...series.map((d) => d.revenue), 1);
  const W = 720;
  const H = 220;
  const pad = 24;
  const bw = (W - pad * 2) / series.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px]" role="img" aria-label="매출 추이">
        {series.map((d, i) => {
          const h = Math.round(((H - pad * 2) * d.revenue) / max);
          const x = pad + i * bw;
          const y = H - pad - h;
          return (
            <g key={d.label}>
              <rect x={x + bw * 0.15} y={y} width={bw * 0.7} height={h} className="fill-ink">
                <title>{`${d.label} · ${won(d.revenue)}원 · ${d.orders}건`}</title>
              </rect>
              {series.length <= 12 && (
                <text x={x + bw / 2} y={H - pad + 12} textAnchor="middle" className="fill-mute text-[9px]">
                  {d.label.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Analytics() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    fetchAnalytics(period)
      .then((d) => active && setData(d))
      .catch(() => active && setError('분석 데이터를 불러오지 못했습니다.'));
    return () => { active = false; };
  }, [period]);

  const totalRevenue = data ? data.series.reduce((a, d) => a + d.revenue, 0) : 0;
  const typeMax = data ? Math.max(...data.typeSales.map((t) => t.revenue), 1) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">분석</h1>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`border px-3 py-1.5 text-[13px] ${
                period === p.id ? 'border-ink bg-ink text-paper' : 'border-line text-mute hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="py-12 text-center text-mute">{error}</p>
      ) : !data ? (
        <p className="py-12 text-center text-mute">불러오는 중…</p>
      ) : (
        <>
          <p className="mt-4 text-[13px] text-mute">기간 매출 합계 <span className="ml-1 font-bold text-ink">{won(totalRevenue)}원</span></p>

          <section className="mt-4 border border-line p-5">
            <h2 className="mb-3 text-sm font-semibold">매출 추이</h2>
            <BarChart series={data.series} />
          </section>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="mb-3 text-lg font-bold">베스트셀러 (기간)</h2>
              {data.bestSellers.length === 0 ? (
                <p className="py-6 text-center text-mute">판매 데이터가 없습니다.</p>
              ) : (
                <ol className="divide-y divide-line border-y border-line">
                  {data.bestSellers.map((b, i) => (
                    <li key={b.name} className="flex items-center gap-3 py-3 text-sm">
                      <span className="w-5 shrink-0 font-bold text-mute">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      <span className="shrink-0 text-mute">{b.units}개</span>
                      <span className="w-24 shrink-0 text-right font-medium">{won(b.revenue)}원</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">타입별 매출 (기간)</h2>
              {data.typeSales.length === 0 ? (
                <p className="py-6 text-center text-mute">판매 데이터가 없습니다.</p>
              ) : (
                <ul className="space-y-3">
                  {data.typeSales.map((t) => (
                    <li key={t.type}>
                      <div className="mb-1 flex justify-between text-[13px]">
                        <span>{t.type}</span>
                        <span className="text-mute">{won(t.revenue)}원 · {t.units}개</span>
                      </div>
                      <div className="h-2 w-full bg-tint">
                        <div className="h-full bg-ink" style={{ width: `${Math.round((t.revenue / typeMax) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
