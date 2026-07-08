import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fetchProducts } from '../lib/products.js';
import { createOrder } from '../lib/orders.js';
import { won } from '../lib/format.js';
import { Loading, LoadError } from '../components/Loading.jsx';

const FREE_SHIPPING = 50000;
const SHIPPING_FEE = 3000;

export default function Checkout() {
  const { lines, clear } = useCart();
  const { user } = useAuth();
  const nav = useNavigate();

  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [addrId, setAddrId] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null); // 완료된 주문

  useEffect(() => {
    fetchProducts({ limit: 100 })
      .then(setCatalog)
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  }, []);

  const addresses = user?.addresses || [];
  // 기본 배송지 선택
  useEffect(() => {
    if (!addrId && addresses.length) {
      setAddrId(String((addresses.find((a) => a.isDefault) || addresses[0])._id));
    }
  }, [addresses, addrId]);

  const rows = useMemo(
    () =>
      lines
        .map((l) => ({ ...l, product: catalog.find((p) => p.id === l.id) }))
        .filter((r) => r.product),
    [lines, catalog],
  );

  const itemsTotal = rows.reduce((s, r) => s + r.product.price * r.qty, 0);
  const shippingFee = itemsTotal >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
  const grandTotal = itemsTotal + shippingFee;

  const selectedAddr = addresses.find((a) => String(a._id) === addrId);

  const onPay = async () => {
    setErr('');
    if (!selectedAddr) return setErr('배송지를 선택해주세요.');
    setBusy(true);
    try {
      const order = await createOrder({
        items: rows.map((r) => ({ slug: r.id, qty: r.qty, option: r.option })),
        shippingAddress: {
          recipient: selectedAddr.recipient,
          phone: selectedAddr.phone,
          zipcode: selectedAddr.zipcode,
          address1: selectedAddr.address1,
          address2: selectedAddr.address2,
          deliveryMemo: memo || selectedAddr.deliveryMemo,
        },
      });
      clear();
      setDone(order);
    } catch (e) {
      setErr(e.response?.data?.message || '결제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  if (loading) return <Loading />;
  if (loadErr) return <LoadError message="주문 정보를 불러오지 못했습니다." />;

  // ── 주문 완료 화면 ──────────────────────────────
  if (done) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
        <p className="text-[12px] font-medium tracking-[0.2em] text-mute">ORDER COMPLETE</p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">주문이 완료되었습니다</h1>
        <p className="mt-3 text-[14px] text-mute">주문번호 {done.orderNumber}</p>
        <p className="mt-1 text-[14px]">결제금액 <b>{won(done.amounts.grandTotal)}원</b></p>
        <div className="mt-8 flex gap-2.5">
          <Link to="/mypage" className="border border-ink px-6 py-3 text-sm font-medium hover:bg-tint">
            주문내역 보기
          </Link>
          <Link to="/" className="bg-ink px-6 py-3 text-sm font-medium text-paper hover:bg-ink/85">
            쇼핑 계속하기
          </Link>
        </div>
      </div>
    );
  }

  // 빈 장바구니로 직접 들어온 경우
  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-24 text-center">
        <p className="text-[14px] text-mute">주문할 상품이 없습니다.</p>
        <Link to="/" className="mt-6 inline-block border border-ink px-8 py-3 text-sm hover:bg-tint">홈으로</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight">주문 / 결제</h1>

      <div className="mt-8 grid gap-10 md:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {/* 배송지 */}
          <section>
            <h2 className="mb-3 text-sm font-bold">배송지</h2>
            {addresses.length === 0 ? (
              <div className="border border-line p-5 text-[13px] text-mute">
                등록된 배송지가 없습니다.{' '}
                <Link to="/mypage" className="font-medium text-ink underline-offset-4 hover:underline">
                  마이페이지에서 배송지 추가
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {addresses.map((a) => (
                  <li key={a._id}>
                    <label className="flex cursor-pointer gap-3 border border-line p-4 text-[13px] hover:bg-tint">
                      <input
                        type="radio"
                        name="addr"
                        className="mt-0.5 accent-ink"
                        checked={String(a._id) === addrId}
                        onChange={() => setAddrId(String(a._id))}
                      />
                      <div>
                        <p className="font-medium text-ink">
                          {a.recipient} {a.label && <span className="text-mute">· {a.label}</span>}
                          {a.isDefault && <span className="ml-2 text-[11px] text-faint">기본</span>}
                        </p>
                        <p className="mt-0.5 text-mute">
                          ({a.zipcode}) {a.address1} {a.address2}
                        </p>
                        <p className="text-mute">{a.phone}</p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <input
              className="mt-2 w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none"
              placeholder="배송 메모 (예: 문 앞에 놓아주세요)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </section>

          {/* 주문 상품 */}
          <section>
            <h2 className="mb-3 text-sm font-bold">주문 상품 {rows.length}건</h2>
            <ul className="divide-y divide-line border-y border-line">
              {rows.map((r) => (
                <li key={`${r.id}-${r.option || ''}`} className="flex items-center gap-3 py-3">
                  <img src={r.product.image} alt="" className="h-16 w-16 bg-tint object-cover" />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium">{r.product.name}</p>
                    <p className="text-[12px] text-mute">
                      {r.option && `${r.option} · `}수량 {r.qty}
                    </p>
                  </div>
                  <span className="text-[13px] font-semibold">{won(r.product.price * r.qty)}원</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* 결제 요약 */}
        <aside className="md:sticky md:top-36 md:self-start">
          <div className="border border-line p-6">
            <h2 className="text-sm font-bold">결제 금액</h2>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-mute">상품 금액</dt>
                <dd>{won(itemsTotal)}원</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">배송비</dt>
                <dd>{shippingFee === 0 ? '무료' : `${won(shippingFee)}원`}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[13px] text-mute">최종 결제</span>
              <span className="text-xl font-bold">{won(grandTotal)}원</span>
            </div>

            {err && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{err}</p>}

            <button
              onClick={onPay}
              disabled={busy || !selectedAddr}
              className="mt-5 w-full bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
            >
              {busy ? '결제 중…' : `${won(grandTotal)}원 결제하기`}
            </button>
            <p className="mt-3 text-center text-[11px] text-faint">스터디용 모의 결제 (실제 청구 없음)</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
