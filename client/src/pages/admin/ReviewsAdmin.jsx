import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAdminReviews, setReviewHidden, deleteReviewAdmin } from '../../lib/admin.js';
import Stars from '../../components/Stars.jsx';
import Pagination from '../../components/admin/Pagination.jsx';

export default function ReviewsAdmin() {
  const [params, setParams] = useSearchParams();
  const product = params.get('product') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 30 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState(product);

  const load = () => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAdminReviews({ product: product || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setError('리뷰를 불러오지 못했습니다.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  };

  useEffect(load, [product, page]);
  useEffect(() => { setTerm(product); }, [product]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  const toggleHidden = async (r) => {
    try {
      const updated = await setReviewHidden(r._id, !r.hidden);
      setData((d) => ({ ...d, items: d.items.map((x) => (x._id === r._id ? { ...x, hidden: updated.hidden } : x)) }));
    } catch {
      window.alert('숨김 처리에 실패했습니다.');
    }
  };

  const remove = async (r) => {
    if (!window.confirm('이 리뷰를 삭제할까요?')) return;
    try {
      await deleteReviewAdmin(r._id);
      setData((d) => ({ ...d, items: d.items.filter((x) => x._id !== r._id), total: d.total - 1 }));
    } catch {
      window.alert('삭제에 실패했습니다.');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">리뷰 관리</h1>

      <form
        onSubmit={(e) => { e.preventDefault(); patch({ product: term.trim() }); }}
        className="mt-5 flex gap-2"
      >
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="상품 slug (예: ola-lamp)"
          className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">필터</button>
        {product && (
          <button type="button" onClick={() => patch({ product: '' })} className="px-3 py-2 text-sm text-mute hover:text-ink">
            초기화
          </button>
        )}
      </form>

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={load} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : data.total === 0 ? (
        <p className="py-10 text-center text-mute">리뷰가 없습니다.</p>
      ) : (
        <div className="mt-5">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}건</p>
          <ul className="divide-y divide-line border-y border-line">
            {data.items.map((r) => (
              <li key={r._id} className={`py-4 ${r.hidden ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-mute">
                        {r.product?.nameKo || r.product?.name || r.product?.slug || '(삭제된 상품)'}
                      </span>
                      <Stars value={r.rating} size="text-[12px]" />
                      <span className="text-[13px] font-medium">{r.userName}</span>
                      {r.hidden && <span className="border border-line px-1.5 py-0.5 text-[10px] text-sale">숨김</span>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-ink/80">{r.content}</p>
                    <p className="mt-1 text-[12px] text-faint">{r.createdAt?.slice(0, 10)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 text-[12px]">
                    <button className="text-ink hover:underline" onClick={() => toggleHidden(r)}>
                      {r.hidden ? '숨김 해제' : '숨기기'}
                    </button>
                    <button className="text-sale hover:underline" onClick={() => remove(r)}>삭제</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
