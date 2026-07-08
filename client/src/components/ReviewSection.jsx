import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { fetchReviews, createReview, deleteReview } from '../lib/reviews.js';
import Stars from './Stars.jsx';

// 별점 입력 (1~5 클릭)
function StarPicker({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          onClick={() => onChange(n)}
          aria-label={`${n}점`}
          className={`text-2xl leading-none transition-colors ${
            n <= value ? 'text-ink' : 'text-line hover:text-mute'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const PAGE_SIZE = 10;

export default function ReviewSection({ slug, ratingAvg = 0, ratingCount = 0, onChanged }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // p=1이면 처음부터, 그 외엔 뒤에 이어붙인다 (더보기)
  const loadPage = (p) => {
    const setBusyFlag = p === 1 ? setLoading : setLoadingMore;
    setBusyFlag(true);
    fetchReviews(slug, { page: p, limit: PAGE_SIZE })
      .then((d) => {
        setTotal(d.total);
        setItems((prev) => (p === 1 ? d.items : [...prev, ...d.items]));
      })
      .catch(() => {
        if (p === 1) setItems([]);
      })
      .finally(() => setBusyFlag(false));
  };

  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!rating) {
      setErr('별점을 선택해주세요.');
      return;
    }
    if (!content.trim()) {
      setErr('리뷰 내용을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await createReview(slug, { rating, content: content.trim() });
      setRating(0);
      setContent('');
      loadPage(1);
      onChanged?.();
    } catch (e2) {
      setErr(e2.response?.data?.message || '리뷰 등록에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('이 리뷰를 삭제할까요?')) return;
    try {
      await deleteReview(id);
      loadPage(1);
      onChanged?.();
    } catch {
      window.alert('리뷰 삭제에 실패했습니다.');
    }
  };

  return (
    <section className="mx-auto max-w-[900px] px-5 pt-16">
      <div className="flex items-baseline justify-between border-b border-line pb-4">
        <h2 className="text-xl font-bold tracking-tight">
          리뷰 {ratingCount > 0 && <span className="text-mute">{ratingCount}</span>}
        </h2>
        {ratingCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Stars value={ratingAvg} />
            <span className="font-semibold">{ratingAvg.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* 작성 폼 */}
      {user ? (
        <form onSubmit={submit} className="mt-6 border border-line p-5">
          <p className="mb-2 text-[13px] text-mute">별점</p>
          <StarPicker value={rating} onChange={setRating} />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="이 상품에 대한 솔직한 후기를 남겨주세요."
            className="mt-3 w-full resize-none border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none"
          />
          {err && <p className="mt-2 text-[13px] text-sale">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-3 bg-ink px-6 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
          >
            {busy ? '등록 중…' : '리뷰 등록'}
          </button>
        </form>
      ) : (
        <p className="mt-6 text-[13px] text-mute">
          리뷰를 작성하려면{' '}
          <Link to="/login" className="text-ink underline underline-offset-2">
            로그인
          </Link>
          이 필요합니다.
        </p>
      )}

      {/* 목록 */}
      <div className="mt-8">
        {loading ? (
          <p className="py-8 text-center text-mute">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-mute">아직 리뷰가 없습니다. 첫 리뷰를 남겨주세요.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <li key={r._id} className="py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Stars value={r.rating} size="text-[12px]" />
                    <span className="text-[13px] font-medium">{r.userName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-faint">
                    <span>{r.createdAt?.slice(0, 10)}</span>
                    {user && (String(r.user) === String(user._id) || user.role === 'admin') && (
                      <button onClick={() => remove(r._id)} className="hover:text-sale">
                        삭제
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink/80">{r.content}</p>
              </li>
            ))}
          </ul>
        )}

        {items.length < total && (
          <div className="mt-6 text-center">
            <button
              onClick={() => loadPage(Math.floor(items.length / PAGE_SIZE) + 1)}
              disabled={loadingMore}
              className="border border-ink px-8 py-2.5 text-sm font-medium transition-colors hover:bg-tint disabled:opacity-50"
            >
              {loadingMore ? '불러오는 중…' : `리뷰 더보기 (${items.length}/${total})`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
