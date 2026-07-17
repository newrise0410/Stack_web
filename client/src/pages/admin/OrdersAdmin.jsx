import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchAdminOrders, fetchOrderCounts, bulkOrderStatus, downloadOrdersCsv,
  ORDER_STATUS_LABEL, COURIERS,
} from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import Pagination from '../../components/admin/Pagination.jsx';
import OrderBulkBar from '../../components/admin/OrderBulkBar.jsx';
import TrackingCsvModal from '../../components/admin/TrackingCsvModal.jsx';

// 스마트스토어식 탭 — 값은 status 쿼리파라미터 그대로, '신규주문'은 paid의 운영 라벨
const TABS = [
  { value: '', label: '전체' },
  { value: 'pending', label: '결제대기' },
  { value: 'paid', label: '신규주문' },
  { value: 'preparing', label: '제작중' },
  { value: 'shipped', label: '배송중' },
  { value: 'delivered', label: '배송완료' },
  { value: 'cancelled', label: '취소' },
];

export default function OrdersAdmin() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const product = params.get('product') || '';
  const refund = params.get('refund') || ''; // 운영 패널에서 review 격리 주문으로 진입
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 30 });
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(q);
  const [selected, setSelected] = useState(() => new Set());
  const [trackings, setTrackings] = useState({}); // {orderId: {courier, trackingNumber}} — 제작중 탭 인라인 입력
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const load = () => {
    setLoading(true);
    return fetchAdminOrders({ status: status || undefined, q: q || undefined, product: product || undefined, refund: refund || undefined, from: from || undefined, to: to || undefined, page })
      .then(setData)
      .catch(() => setData({ items: [], total: 0, limit: 30 }))
      .finally(() => setLoading(false));
  };
  const loadCounts = () => fetchOrderCounts().then(setCounts).catch(() => {});

  useEffect(() => {
    setSelected(new Set()); // 필터·페이지 변경 시 선택 초기화
    setResult(null);
    load();
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q, product, refund, from, to, page]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  useEffect(() => { setTerm(q); }, [q]);

  const pageIds = useMemo(() => data.items.map((o) => o._id), [data.items]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(pageIds));
  const toggleOne = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const setTracking = (id, field, value) =>
    setTrackings((prev) => ({ ...prev, [id]: { courier: COURIERS[0], ...prev[id], [field]: value } }));

  const runBulk = async (action) => {
    const ids = [...selected];
    if (action === 'print') {
      window.open(`/admin/orders/print?ids=${ids.join(',')}`, '_blank');
      return;
    }
    if (action === 'cancelled' && !window.confirm(`선택한 ${ids.length}건을 취소할까요?\n(결제된 주문은 전액 환불됩니다)`)) return;

    // 배송처리는 송장 입력분만 서버로 — 미입력분은 클라에서 사전 실패 처리
    let sendIds = ids;
    const preFailed = [];
    const body = { ids, status: action };
    if (action === 'shipped') {
      sendIds = ids.filter((id) => trackings[id]?.trackingNumber?.trim());
      ids.filter((id) => !sendIds.includes(id)).forEach((id) => {
        const o = data.items.find((x) => x._id === id);
        preFailed.push({ orderId: id, orderNumber: o?.orderNumber || '', message: '송장번호 미입력' });
      });
      if (sendIds.length === 0) {
        setResult({ succeeded: 0, failed: preFailed });
        return;
      }
      body.ids = sendIds;
      body.trackings = Object.fromEntries(sendIds.map((id) => [id, trackings[id]]));
    }

    setBusy(true);
    try {
      const r = await bulkOrderStatus(body);
      const merged = { succeeded: r.succeeded, failed: [...preFailed, ...r.failed] };
      setResult(merged);
      toast.success(`${merged.succeeded}건 처리${merged.failed.length ? ` · ${merged.failed.length}건 실패` : ''}`);
      setSelected(new Set());
      await Promise.all([load(), loadCounts()]);
    } catch (e) {
      toast.error(e.response?.data?.message || '일괄 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">주문</h1>
        <div className="flex gap-2">
          {status === 'preparing' && (
            <button onClick={() => setCsvOpen(true)} className="border border-line px-3.5 py-2 text-[13px] hover:border-ink">
              송장 CSV 업로드
            </button>
          )}
          <button
            onClick={() => downloadOrdersCsv({ status: status || undefined, q: q || undefined, product: product || undefined, refund: refund || undefined, from: from || undefined, to: to || undefined })}
            className="border border-line px-3.5 py-2 text-[13px] hover:border-ink"
          >
            내보내기(CSV)
          </button>
        </div>
      </div>

      {/* 상태 탭 + 건수 뱃지 */}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const active = status === t.value;
          const n = t.value === '' ? null : counts?.[t.value];
          return (
            <button
              key={t.value}
              onClick={() => patch({ status: t.value })}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                active ? 'border-ink font-semibold text-ink' : 'border-transparent text-mute hover:text-ink'
              }`}
            >
              {t.label}
              {n != null && n > 0 && <span className="ml-1.5 rounded-full bg-tint px-1.5 text-[11px] text-mute">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }} className="flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="주문번호·받는사람"
            className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
        </form>
        {/* 주문일 범위 — 서버는 createdAt 기준 from/to(KST 경계)를 이미 지원한다. */}
        <div className="flex items-center gap-1.5 text-[13px] text-mute">
          <input
            type="date" value={from} max={to || undefined}
            onChange={(e) => patch({ from: e.target.value })}
            className="border border-line px-2 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <span>~</span>
          <input
            type="date" value={to} min={from || undefined}
            onChange={(e) => patch({ to: e.target.value })}
            className="border border-line px-2 py-2 text-sm focus:border-ink focus:outline-none"
          />
          {(from || to) && (
            <button onClick={() => patch({ from: '', to: '' })} className="text-mute hover:text-ink">✕</button>
          )}
        </div>
        {product && (
          <button onClick={() => patch({ product: '' })} className="border border-line px-3 py-2 text-[12px] text-mute hover:border-ink">
            상품 필터: {product} ✕
          </button>
        )}
        {refund && (
          <button onClick={() => patch({ refund: '' })} className="border border-sale px-3 py-2 text-[12px] text-sale hover:bg-sale/5">
            환불 {refund === 'review' ? '확인 필요' : refund} ✕
          </button>
        )}
      </div>

      <OrderBulkBar
        tab={status}
        count={selected.size}
        busy={busy}
        onAction={runBulk}
        result={result}
        onClearResult={() => setResult(null)}
      />

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : data.total === 0 ? (
        <p className="py-10 text-center text-mute">주문이 없습니다.</p>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}건</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-mute">
                  <th className="w-8 py-2 pr-2">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-ink" />
                  </th>
                  <th className="py-2 pr-3">주문번호</th>
                  <th className="py-2 pr-3">일자</th>
                  <th className="py-2 pr-3">고객</th>
                  <th className="py-2 pr-3">품목</th>
                  <th className="py-2 pr-3">금액</th>
                  <th className="py-2 pr-3">상태</th>
                  {status === 'preparing' && <th className="py-2 pr-3">택배사 / 송장번호</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o._id} className="border-b border-line hover:bg-tint/40">
                    <td className="py-3 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggleOne(o._id)} className="accent-ink" />
                    </td>
                    <td onClick={() => nav(`/admin/orders/${o._id}`)} className="cursor-pointer py-3 pr-3 font-medium">{o.orderNumber}</td>
                    <td className="py-3 pr-3 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</td>
                    <td className="py-3 pr-3">{o.user?.name || o.shippingAddress?.recipient || '-'}</td>
                    <td className="max-w-[220px] truncate py-3 pr-3 text-[12px] text-mute">
                      {o.items?.[0] ? `${o.items[0].nameKo || o.items[0].name}${o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ''}` : '-'}
                    </td>
                    <td className="py-3 pr-3">{won(o.amounts.grandTotal)}원</td>
                    <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                    {status === 'preparing' && (
                      <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          <select
                            value={trackings[o._id]?.courier || COURIERS[0]}
                            onChange={(e) => setTracking(o._id, 'courier', e.target.value)}
                            className="border border-line px-1.5 py-1 text-[12px] focus:border-ink focus:outline-none"
                          >
                            {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            value={trackings[o._id]?.trackingNumber || ''}
                            onChange={(e) => setTracking(o._id, 'trackingNumber', e.target.value)}
                            placeholder="송장번호"
                            className="w-32 border border-line px-2 py-1 text-[12px] focus:border-ink focus:outline-none"
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}

      {csvOpen && (
        <TrackingCsvModal
          onClose={() => setCsvOpen(false)}
          onDone={async (r) => {
            setResult(r);
            setCsvOpen(false);
            await Promise.all([load(), loadCounts()]);
          }}
        />
      )}
    </div>
  );
}
