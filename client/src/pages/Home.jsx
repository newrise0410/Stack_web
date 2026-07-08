import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { fetchProducts } from '../lib/products.js';

function SectionHead({ title, tagline, href }) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div>
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {tagline && <p className="mt-1 text-[13px] text-mute">{tagline}</p>}
      </div>
      {href && (
        <a href={href} className="shrink-0 text-[13px] text-mute hover:text-ink">
          더보기 +
        </a>
      )}
    </div>
  );
}

function Grid({ items, ranked }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-4">
      {items.map((p, i) => (
        <ProductCard key={p.id} product={p} rank={ranked ? i + 1 : undefined} />
      ))}
    </div>
  );
}

const TYPES = [
  { id: 'table', type: 'Table', title: '테이블 램프', tag: 'Table Lamps' },
  { id: 'pendant', type: 'Pendant', title: '펜던트', tag: 'Pendant Lamps' },
  { id: 'moon', type: 'MoonWall', title: '문 · 월 램프', tag: 'Moon & Wall' },
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProducts({ limit: 100 })
      .then(setProducts)
      .catch(() => setError('상품을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-[1280px] px-5 py-24 text-center text-mute">불러오는 중…</div>;
  }
  if (error || products.length === 0) {
    return (
      <div className="mx-auto max-w-[1280px] px-5 py-24 text-center text-mute">
        {error || '등록된 상품이 없습니다.'}
      </div>
    );
  }

  const byId = (id) => products.find((p) => p.id === id);
  const byType = (t) => products.filter((p) => p.type === t);
  const hero = byId('ola-lamp') || products[0];
  const feature = byId('waveglow-lamp') || products[1] || hero;
  const newDrop = products.filter((p) => p.badge === 'NEW').slice(0, 4);
  const best = products
    .filter((p) => p.badge === 'BEST')
    .concat(products.filter((p) => p.badge !== 'BEST'));

  return (
    <>
      {/* ── Hero banner ──────────────────────────────────── */}
      <section id="best" className="relative">
        <Link to={`/objects/${hero.id}`} className="group block">
          <div className="relative h-[62vh] min-h-[420px] w-full overflow-hidden bg-tint">
            <img
              src={hero.image}
              alt={hero.ko}
              className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            <div className="absolute bottom-0 left-0 p-6 text-paper sm:p-10">
              <p className="text-[12px] font-medium tracking-[0.15em] opacity-90">
                2607 EXCLUSIVE · LAMP COLLECTION
              </p>
              <h1 className="mt-2 max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                한 층씩 쌓아 올린 빛
              </h1>
              <p className="mt-2 max-w-md text-sm text-paper/85">
                테이블 · 펜던트 · 문 램프 — 3D 프린팅 조명 컬렉션
              </p>
            </div>
            <span className="absolute bottom-6 right-6 text-[12px] font-medium text-paper/80">
              01 / {String(products.length).padStart(2, '0')}
            </span>
          </div>
        </Link>
      </section>

      {/* ── New ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1280px] px-5 pt-16">
        <SectionHead title="이번 주 신상" tagline="이번 주 새로 입고된 램프" />
        <Grid items={newDrop} />
      </section>

      {/* ── Editorial feature (PT-style) ─────────────────── */}
      <section id="pt" className="mx-auto mt-20 max-w-[1280px] px-5">
        <Link
          to={`/objects/${feature.id}`}
          className="group grid items-stretch overflow-hidden border border-line md:grid-cols-2"
        >
          <div className="overflow-hidden bg-tint">
            <img
              src={feature.image}
              alt={feature.ko}
              className="h-full min-h-[280px] w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          </div>
          <div className="flex flex-col justify-center p-8 sm:p-12">
            <p className="text-[12px] font-medium tracking-[0.15em] text-mute">PT · 01</p>
            <h2 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">
              층이 굴절시키는 빛
            </h2>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-mute">
              파라메트릭 곡면을 한 층씩 쌓으면 빛이 물결처럼 휩니다. 매끈함 대신
              결을 택한 램프가 어떻게 완성되는지 들여다봅니다.
            </p>
            <span className="mt-6 text-[13px] font-medium text-ink underline-offset-4 group-hover:underline">
              아티클 보기
            </span>
          </div>
        </Link>
      </section>

      {/* ── Best (ranking) ───────────────────────────────── */}
      <section className="mx-auto max-w-[1280px] px-5 pt-20">
        <SectionHead title="지금 가장 인기 있는" tagline="주간 판매 랭킹" />
        <Grid items={best.slice(0, 4)} ranked />
      </section>

      {/* ── Type sections ────────────────────────────────── */}
      {TYPES.map(({ id, type, title, tag }) => (
        <section key={id} id={id} className="mx-auto max-w-[1280px] px-5 pt-20">
          <SectionHead title={title} tagline={tag} href={`#${id}`} />
          <Grid items={byType(type)} />
        </section>
      ))}
    </>
  );
}
