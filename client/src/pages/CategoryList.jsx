import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { fetchProducts } from '../lib/products.js';
import { Loading, LoadError } from '../components/Loading.jsx';
import useDocumentTitle from '../lib/useDocumentTitle.js';

const TYPE_LABEL = {
  Table: '테이블 램프',
  Pendant: '펜던트',
  MoonWall: '문 · 월 램프',
  all: '전체 상품',
};

const SORTS = [
  { id: 'new', label: '신상품순' },
  { id: 'best', label: '인기순' },
  { id: 'priceAsc', label: '낮은 가격순' },
  { id: 'priceDesc', label: '높은 가격순' },
];

export default function CategoryList() {
  const { type } = useParams();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || 'new';

  useDocumentTitle(TYPE_LABEL[type] || '카테고리');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    const query = { limit: 100, sort };
    if (type && type !== 'all') query.type = type;
    fetchProducts(query)
      .then((r) => active && setItems(r))
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [type, sort]);

  if (loading) return <Loading />;
  if (error) return <LoadError message="상품을 불러오지 못했습니다." />;

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-12">
      <div className="flex items-end justify-between border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{TYPE_LABEL[type] || type}</h1>
          <p className="mt-1 text-[13px] text-mute">{items.length}개 상품</p>
        </div>
        <select
          value={sort}
          onChange={(e) => setParams({ sort: e.target.value })}
          className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="py-20 text-center text-mute">상품이 없습니다.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
