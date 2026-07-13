import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cldUrl } from '../../lib/cloudinary.js';

const AUTOPLAY_MS = 5000;

// 29cm 홈 히어로 구조 이식 — 3열 캠페인 타일 롤링 캐러셀.
// 콘텐츠(이미지/문구/링크)는 전부 우리 카탈로그 기반.
export default function HeroCampaign({ tiles }) {
  const [perView, setPerView] = useState(3);
  const [index, setIndex] = useState(0);
  const hovering = useRef(false);

  // 브레이크포인트별 노출 개수 (lg 3 / sm 2 / mobile 1)
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setPerView(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const maxIndex = Math.max(0, tiles.length - perView);

  // perView 변경 시 인덱스 클램프
  useEffect(() => {
    setIndex((i) => Math.min(i, maxIndex));
  }, [maxIndex]);

  // 자동 재생 (reduced-motion 존중, 호버 시 일시정지)
  useEffect(() => {
    if (tiles.length <= perView) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => {
      if (!hovering.current) setIndex((i) => (i >= maxIndex ? 0 : i + 1));
    }, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [maxIndex, perView, tiles.length]);

  const go = (delta) =>
    setIndex((i) => {
      const n = i + delta;
      if (n < 0) return maxIndex;
      if (n > maxIndex) return 0;
      return n;
    });

  const slideW = 100 / perView;
  const hasControls = tiles.length > perView;

  return (
    <section
      id="hero"
      className="relative overflow-hidden"
      onMouseEnter={() => {
        hovering.current = true;
      }}
      onMouseLeave={() => {
        hovering.current = false;
      }}
    >
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * slideW}%)` }}
      >
        {tiles.map((t, i) => (
          <div key={t.to + i} className="shrink-0" style={{ flexBasis: `${slideW}%` }}>
            <Link to={t.to} className="group relative block overflow-hidden bg-tint">
              <img
                src={cldUrl(t.image, { w: 900 })}
                alt={t.title}
                fetchpriority={i === 0 ? 'high' : undefined}
                className="aspect-[4/5] w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-paper sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/85">{t.eyebrow}</p>
                <h2 className="mt-2 text-2xl font-bold leading-tight tracking-tight">{t.title}</h2>
                <p className="mt-1.5 max-w-[22ch] text-[13px] leading-relaxed text-paper/80">{t.subtitle}</p>
                <span className="mt-4 inline-block text-[12px] font-medium text-paper underline-offset-4 group-hover:underline">
                  {t.cta} →
                </span>
              </div>
            </Link>
          </div>
        ))}
      </div>

      {hasControls && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="이전 캠페인"
            className="absolute left-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-xl text-ink shadow-sm backdrop-blur transition hover:bg-paper sm:grid"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="다음 캠페인"
            className="absolute right-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-xl text-ink shadow-sm backdrop-blur transition hover:bg-paper sm:grid"
          >
            ›
          </button>
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
            {Array.from({ length: maxIndex + 1 }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`${i + 1}번 캠페인 그룹으로`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-6 bg-paper' : 'w-1.5 bg-paper/50 hover:bg-paper/80'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
