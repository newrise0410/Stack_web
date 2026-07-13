import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import HeroCampaign from '../components/home/HeroCampaign.jsx';
import EditorialModule from '../components/home/EditorialModule.jsx';
import { fetchProducts } from '../lib/products.js';
import { Loading, LoadError } from '../components/Loading.jsx';
import useDocumentTitle from '../lib/useDocumentTitle.js';
import { cldUrl } from '../lib/cloudinary.js';

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
  const { hash } = useLocation();

  useDocumentTitle();

  useEffect(() => {
    fetchProducts({ limit: 100 })
      .then(setProducts)
      .catch(() => setError('상품을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  // 다른 페이지에서 /#best, /#pt 로 진입하면 해당 섹션으로 스크롤
  useEffect(() => {
    if (loading || !hash) return;
    // getElementById는 잘못된 해시에도 throw하지 않고 null 반환
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, hash]);

  if (loading) return <Loading />;
  if (error) return <LoadError message={error} />;
  if (products.length === 0) {
    return <div className="mx-auto max-w-[1280px] px-5 py-24 text-center text-mute">등록된 상품이 없습니다.</div>;
  }

  const byId = (id) => products.find((p) => p.id === id);
  const byType = (t) => products.filter((p) => p.type === t);
  const hero = byId('ola-lamp') || products[0];
  const feature = byId('waveglow-lamp') || products[1] || hero;
  const best = products
    .filter((p) => p.badge === 'BEST')
    .concat(products.filter((p) => p.badge !== 'BEST'));

  const table0 = byType('Table')[0] || hero;
  const pendant0 = byType('Pendant')[0] || hero;
  const moon0 = byType('MoonWall')[0] || hero;

  // 히어로 캠페인 타일 — 3열 롤링 캐러셀용. 이미지/링크는 우리 카탈로그 기반
  const heroTiles = [
    {
      eyebrow: 'Summer Glow',
      title: '여름밤의 낮은 빛',
      subtitle: '테이블 위에 놓는 3D 프린팅 조명',
      cta: '테이블 램프',
      to: '/category/Table',
      image: table0.image,
    },
    {
      eyebrow: 'Spotlight',
      title: feature.ko,
      subtitle: feature.blurb || '이번 주 주목한 램프',
      cta: '제품 보기',
      to: `/objects/${feature.id}`,
      image: feature.image,
    },
    {
      eyebrow: 'Made to order',
      title: '주문 후 한 층씩',
      subtitle: '재고가 아닌 당신의 주문으로 시작됩니다',
      cta: '전체 보기',
      to: '/category/all',
      image: moon0.image,
    },
    {
      eyebrow: 'Weekly Best',
      title: best[0]?.ko || '이번 주 랭킹',
      subtitle: '가장 많이 담긴 램프',
      cta: '랭킹 보기',
      to: best[0] ? `/objects/${best[0].id}` : '/category/all',
      image: (best[0] || feature).image,
    },
    {
      eyebrow: 'Pendant',
      title: '천장에서 내려오는 빛',
      subtitle: '공간의 높이를 바꾸는 펜던트',
      cta: '펜던트 램프',
      to: '/category/Pendant',
      image: pendant0.image,
    },
  ];

  // 3열 에디토리얼 모듈 — 타입별 이미지 카드 + 상품 리스트
  const editorialColumns = [
    { title: '테이블 위의 빛', subtitle: 'Table Lamps', to: '/category/Table', image: table0.image, products: byType('Table').slice(0, 3) },
    { title: '천장에서 내려오는', subtitle: 'Pendant', to: '/category/Pendant', image: pendant0.image, products: byType('Pendant').slice(0, 3) },
    { title: '벽에 걸린 달', subtitle: 'Moon & Wall', to: '/category/MoonWall', image: moon0.image, products: byType('MoonWall').slice(0, 3) },
  ].filter((c) => c.products.length > 0);

  return (
    <>
      {/* ── Hero: 3열 캠페인 (29cm 구조 이식) ─────────────── */}
      <HeroCampaign tiles={heroTiles} />

      {/* ── 에디토리얼 모듈: 3열 이미지 카드 + 상품 리스트 ── */}
      <EditorialModule columns={editorialColumns} />

      {/* ── Best (ranking) ───────────────────────────────── */}
      <section id="best" className="mx-auto max-w-[1280px] px-5 pt-20">
        <SectionHead title="지금 가장 인기 있는" tagline="주간 판매 랭킹" />
        <Grid items={best.slice(0, 4)} ranked />
      </section>

      {/* ── Editorial feature (PT-style) ─────────────────── */}
      <section id="pt" className="mx-auto mt-20 max-w-[1280px] px-5">
        <Link
          to={`/objects/${feature.id}`}
          className="group grid items-stretch overflow-hidden border border-line md:grid-cols-2"
        >
          <div className="overflow-hidden bg-tint">
            <img
              src={cldUrl(feature.image, { w: 1200 })}
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
