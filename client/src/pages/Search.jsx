import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { fetchProducts } from '../lib/products.js';
import useDocumentTitle from '../lib/useDocumentTitle.js';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';

  useDocumentTitle(q ? `'${q}' 검색` : '검색');

  const [input, setInput] = useState(q);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setInput(q);
    if (!q.trim()) {
      setItems([]);
      setSearched(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setSearched(true);
    fetchProducts({ q, limit: 100 })
      .then((r) => active && setItems(r))
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [q]);

  const onSubmit = (e) => {
    e.preventDefault();
    setParams(input.trim() ? { q: input.trim() } : {});
  };

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight">검색</h1>
      <form onSubmit={onSubmit} className="mt-5 flex gap-2">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="상품명으로 검색 (예: lamp, moon, pendant)"
          className="flex-1 border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none"
        />
        <button className="shrink-0 bg-ink px-6 text-sm font-medium text-paper hover:bg-ink/85">검색</button>
      </form>

      {loading && <p className="py-20 text-center text-mute">검색 중…</p>}

      {!loading && searched && (
        items.length === 0 ? (
          <p className="py-20 text-center text-mute">‘{q}’에 대한 검색 결과가 없습니다.</p>
        ) : (
          <>
            <p className="mt-8 text-[13px] text-mute">{items.length}개 결과</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-4">
              {items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </>
        )
      )}

      {!searched && (
        <p className="py-20 text-center text-[13px] text-faint">상품명을 입력해 검색하세요.</p>
      )}
    </div>
  );
}
