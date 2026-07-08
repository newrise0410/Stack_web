import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { fetchProducts } from '../lib/products.js';
import { won } from '../lib/format.js';
import { Loading, LoadError } from '../components/Loading.jsx';

const FREE_SHIPPING = 50000;
const SHIPPING_FEE = 3000;

export default function Cart() {
  const { lines, setQty, remove } = useCart();
  const nav = useNavigate();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchProducts({ limit: 100 })
      .then(setCatalog)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () =>
      lines
        .map((l) => ({ ...l, product: catalog.find((p) => p.id === l.id) }))
        .filter((r) => r.product),
    [lines, catalog],
  );

  const itemsTotal = rows.reduce((s, r) => s + r.product.price * r.qty, 0);
  const shippingFee = rows.length === 0 || itemsTotal >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
  const grandTotal = itemsTotal + shippingFee;

  if (loading) return <Loading />;
  if (error) return <LoadError message="장바구니 정보를 불러오지 못했습니다." />;

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-[1000px] px-5 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">장바구니</h1>
        <p className="mt-4 text-[14px] text-mute">담긴 상품이 없습니다.</p>
        <Link to="/" className="mt-8 inline-block border border-ink px-8 py-3 text-sm font-medium hover:bg-ink hover:text-paper">
          쇼핑 계속하기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight">장바구니</h1>

      <div className="mt-8 grid gap-10 md:grid-cols-[1fr_320px]">
        {/* 상품 목록 */}
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={`${r.id}-${r.option || ''}`} className="flex gap-4 py-5">
              <Link to={`/objects/${r.id}`} className="shrink-0">
                <img src={r.product.image} alt={r.product.ko} className="h-24 w-24 bg-tint object-cover" />
              </Link>

              <div className="flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link to={`/objects/${r.id}`} className="text-sm font-medium hover:underline">
                      {r.product.name}
                    </Link>
                    <p className="mt-0.5 text-[13px] text-mute">{r.product.ko}</p>
                    {r.option && <p className="mt-0.5 text-[12px] text-faint">옵션: {r.option}</p>}
                  </div>
                  <button
                    onClick={() => remove(r.id, r.option)}
                    className="text-[12px] text-faint hover:text-sale"
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-auto flex items-end justify-between pt-3">
                  {/* 수량 */}
                  <div className="flex items-center border border-line">
                    <button
                      className="px-3 py-1.5 text-mute hover:text-ink"
                      onClick={() => setQty(r.id, r.option, r.qty - 1)}
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm">{r.qty}</span>
                    <button
                      className="px-3 py-1.5 text-mute hover:text-ink"
                      onClick={() => setQty(r.id, r.option, r.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-semibold">{won(r.product.price * r.qty)}원</span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* 주문 요약 */}
        <aside className="md:sticky md:top-36 md:self-start">
          <div className="border border-line p-6">
            <h2 className="text-sm font-bold">주문 요약</h2>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-mute">상품 금액</dt>
                <dd>{won(itemsTotal)}원</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">배송비</dt>
                <dd>{shippingFee === 0 ? '무료' : `${won(shippingFee)}원`}</dd>
              </div>
              {itemsTotal < FREE_SHIPPING && (
                <p className="text-[12px] text-faint">
                  {won(FREE_SHIPPING - itemsTotal)}원 더 담으면 무료배송
                </p>
              )}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[13px] text-mute">결제 예정</span>
              <span className="text-xl font-bold">{won(grandTotal)}원</span>
            </div>
            <button
              onClick={() => nav('/checkout')}
              className="mt-5 w-full bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
            >
              주문하기
            </button>
            <Link to="/" className="mt-2 block py-2 text-center text-[13px] text-mute hover:text-ink">
              쇼핑 계속하기
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
