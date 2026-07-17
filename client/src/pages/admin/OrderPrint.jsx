import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchOrdersBatch } from '../../lib/admin.js';

// 포장용 주문서 — 주문당 1페이지, 금액 미포함(포장 작업장용).
// AdminLayout 밖 전용 라우트라 사이드바 없음. 로드 완료 시 자동 인쇄.
export default function OrderPrint() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const ids = (params.get('ids') || '').split(',').filter(Boolean);
    if (ids.length === 0) { setError('인쇄할 주문이 없습니다.'); return; }
    fetchOrdersBatch(ids)
      .then((items) => {
        setOrders(items);
        // 렌더 완료 후 인쇄 대화상자 — 이미지 없음이라 짧은 지연이면 충분
        setTimeout(() => window.print(), 300);
      })
      .catch((e) => setError(e.response?.data?.message || '주문을 불러오지 못했습니다.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="py-16 text-center text-sm text-mute">{error}</p>;
  if (!orders) return <p className="py-16 text-center text-sm text-mute">주문서를 준비하고 있습니다…</p>;

  return (
    <div className="mx-auto max-w-[720px] px-6 py-4 text-ink">
      <p className="mb-4 text-center text-[12px] text-mute print:hidden">
        인쇄 대화상자가 뜨지 않으면 <button onClick={() => window.print()} className="underline">여기</button>를 누르세요.
      </p>
      {orders.map((o) => (
        <section key={o._id} className="order-sheet mb-10 border border-ink p-6" style={{ pageBreakAfter: 'always' }}>
          <header className="flex items-baseline justify-between border-b-2 border-ink pb-3">
            <h1 className="text-lg font-extrabold tracking-tight">STACK N&apos; STAK 주문서</h1>
            <div className="text-right text-[12px]">
              <p className="font-bold">{o.orderNumber}</p>
              <p className="text-mute">{o.createdAt?.slice(0, 10)}</p>
            </div>
          </header>

          <dl className="mt-4 space-y-1.5 text-[13px]">
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">받는사람</dt><dd className="font-semibold">{o.shippingAddress.recipient}</dd></div>
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">연락처</dt><dd>{o.shippingAddress.phone || '-'}</dd></div>
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">주소</dt><dd>({o.shippingAddress.zipcode}) {o.shippingAddress.address1} {o.shippingAddress.address2}</dd></div>
            {o.shippingAddress.deliveryMemo && (
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-mute">배송메모</dt><dd className="font-bold">{o.shippingAddress.deliveryMemo}</dd></div>
            )}
          </dl>

          <table className="mt-5 w-full text-[13px]">
            <thead>
              <tr className="border-y border-ink text-left text-[12px]">
                <th className="py-1.5 pr-2">품목</th>
                <th className="py-1.5 pr-2">옵션</th>
                <th className="py-1.5 text-right">수량</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-2 pr-2 font-medium">{it.nameKo || it.name}</td>
                  <td className="py-2 pr-2">{it.option || '-'}</td>
                  <td className="py-2 text-right font-bold">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(o.courier || o.trackingNumber) && (
            <p className="mt-4 text-[12px] text-mute">배송: {o.courier || '-'} {o.trackingNumber || ''}</p>
          )}
        </section>
      ))}
    </div>
  );
}
