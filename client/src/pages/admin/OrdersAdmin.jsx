import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchAdminOrders, ORDER_STATUS_LABEL } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import Pagination from '../../components/admin/Pagination.jsx';

const STATUSES = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'];

export default function OrdersAdmin() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 30 });
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(q);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAdminOrders({ status: status || undefined, q: q || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setData({ items: [], total: 0, limit: 30 }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, q, page]);

  // 필터 변경 시 page 초기화(page 자체 변경만 유지)
  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  useEffect(() => { setTerm(q); }, [q]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">주문</h1>

      <div className="mt-5 flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => patch({ status: e.target.value })}
          className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
        >
          <option value="">전체 상태</option>
          {STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }} className="flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="주문번호·받는사람"
            className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
        </form>
      </div>

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : data.items.length === 0 ? (
        <p className="py-10 text-center text-mute">주문이 없습니다.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}건</p>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[12px] text-mute">
                <th className="py-2 pr-3">주문번호</th>
                <th className="py-2 pr-3">일자</th>
                <th className="py-2 pr-3">고객</th>
                <th className="py-2 pr-3">금액</th>
                <th className="py-2 pr-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr
                  key={o._id}
                  onClick={() => nav(`/admin/orders/${o._id}`)}
                  className="cursor-pointer border-b border-line hover:bg-tint/40"
                >
                  <td className="py-3 pr-3 font-medium">{o.orderNumber}</td>
                  <td className="py-3 pr-3 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</td>
                  <td className="py-3 pr-3">{o.user?.name || o.shippingAddress?.recipient || '-'}</td>
                  <td className="py-3 pr-3">{won(o.amounts.grandTotal)}원</td>
                  <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
