import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchOrder, setOrderStatus, ORDER_STATUS_LABEL } from '../../lib/admin.js';
import { useToast } from '../../lib/toast.jsx';
import { won } from '../../lib/format.js';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

// 백엔드 TRANSITIONS와 동일 (현재 상태에서 가능한 다음 상태)
// shipped→shipped는 송장 수정용(백엔드 동일상태 재요청 허용)
const NEXT = {
  // pending→paid는 결제 검증(verifier) 전용 — 관리자 수동 전환 금지
  pending: ['cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'shipped'],
  delivered: [],
  cancelled: [],
};

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [o, setO] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');

  const apply = (d) => {
    setO(d);
    setCourier(d.courier || '');
    setTracking(d.trackingNumber || '');
  };

  // 주문 전환/언마운트 시 이전 요청 응답이 새 화면을 덮지 않게 가드
  useEffect(() => {
    let active = true;
    setO(null);
    setErr('');
    fetchOrder(id)
      .then((d) => active && apply(d))
      .catch(() => active && setErr('주문을 불러오지 못했습니다.'));
    return () => { active = false; };
  }, [id]);

  const change = async (next) => {
    if (next === 'cancelled' && !window.confirm('이 주문을 취소할까요?')) return;
    setBusy(true);
    try {
      const body = { status: next };
      if (next === 'shipped') {
        if (!tracking.trim()) {
          toast.error('송장번호를 입력해주세요.');
          setBusy(false);
          return;
        }
        body.courier = courier.trim();
        body.trackingNumber = tracking.trim();
      }
      const updated = await setOrderStatus(id, body);
      apply(updated.order || updated);
      toast.success(updated.message || '주문 상태를 변경했습니다.');
    } catch (e) {
      toast.error(e.response?.data?.message || '상태 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!o) return <p className="py-12 text-center text-mute">불러오는 중…</p>;
  const nexts = NEXT[o.status] || [];
  const showTracking = o.trackingNumber || o.status === 'shipped' || o.status === 'delivered';

  return (
    <div className="max-w-3xl">
      <Link to="/admin/orders" className="text-[13px] text-mute hover:text-ink">← 주문 목록</Link>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{o.orderNumber}</h1>
        <StatusBadge status={o.status} />
        {o.payment?.refund?.status && o.payment.refund.status !== 'none' && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${o.payment.refund.status === 'review' ? 'bg-sale/10 text-sale' : 'bg-tint text-mute'}`}>
            환불 {({ requested: '요청됨', processing: '처리 중', done: '완료', review: '확인 필요' })[o.payment.refund.status]}
          </span>
        )}
        <button
          onClick={() => window.open(`/admin/orders/print?ids=${o._id}`, '_blank')}
          className="ml-auto border border-line px-3 py-1.5 text-[12px] hover:border-ink"
        >
          주문서 인쇄
        </button>
      </div>
      {o.payment?.refund?.status === 'review' && (
        <p className="mt-1 text-[12px] text-sale">{o.payment.refund.reason}</p>
      )}
      <p className="mt-1 text-[13px] text-mute">{o.createdAt?.slice(0, 16).replace('T', ' ')}</p>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="border border-line p-4 text-sm">
          <h2 className="mb-2 font-semibold">고객</h2>
          <p>{o.user?.name || '-'}</p>
          <p className="text-mute">{o.user?.email || '-'}</p>
        </div>
        <div className="border border-line p-4 text-sm">
          <h2 className="mb-2 font-semibold">배송지</h2>
          <p>{o.shippingAddress.recipient} · {o.shippingAddress.phone}</p>
          <p className="text-mute">({o.shippingAddress.zipcode}) {o.shippingAddress.address1} {o.shippingAddress.address2}</p>
          {o.shippingAddress.deliveryMemo && (
            <p className="mt-1 text-[12px] text-faint">메모: {o.shippingAddress.deliveryMemo}</p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">주문 상품</h2>
        <ul className="divide-y divide-line border-y border-line text-sm">
          {o.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 py-3">
              <img src={it.image} alt="" className="h-12 w-12 bg-tint object-cover" />
              <div className="flex-1">
                <p className="font-medium">{it.name}</p>
                <p className="text-[12px] text-mute">{it.option && `${it.option} · `}수량 {it.qty}</p>
              </div>
              <span>{won(it.price * it.qty)}원</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between text-sm">
          <span className="text-mute">배송비</span>
          <span>{o.amounts.shippingFee === 0 ? '무료' : `${won(o.amounts.shippingFee)}원`}</span>
        </div>
        <div className="mt-1 flex justify-between font-bold">
          <span>결제금액</span>
          <span>{won(o.amounts.grandTotal)}원</span>
        </div>
        {o.payment?.impUid && (
          <div className="mt-1 flex justify-between text-[12px] text-mute">
            <span>결제(포트원)</span>
            <span>
              {o.payment.pg || 'card'} · {o.payment.impUid}
              {o.payment.receiptUrl && (
                <a href={o.payment.receiptUrl} target="_blank" rel="noreferrer" className="ml-2 underline-offset-2 hover:underline">영수증</a>
              )}
            </span>
          </div>
        )}
      </section>

      {showTracking && (
        <p className="mt-4 text-[13px] text-mute">송장: {o.courier || '-'} {o.trackingNumber || '-'}</p>
      )}

      {nexts.length > 0 && (
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="mb-3 font-semibold">상태 변경</h2>
          {nexts.includes('shipped') && (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <input
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                placeholder="택배사"
                className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="송장번호 (배송중 전환 시 필수)"
                className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {nexts.map((n) => {
              const isTrackingEdit = o.status === 'shipped' && n === 'shipped';
              return (
                <button
                  key={n}
                  disabled={busy}
                  onClick={() => change(n)}
                  className={`px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${
                    n === 'cancelled'
                      ? 'border border-line text-sale hover:bg-tint'
                      : isTrackingEdit
                        ? 'border border-ink hover:bg-tint'
                        : 'bg-ink text-paper hover:bg-ink/85'
                  }`}
                >
                  {isTrackingEdit ? '송장 수정 저장' : `${ORDER_STATUS_LABEL[n]}(으)로 변경`}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
