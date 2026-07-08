import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchStats } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatCard from '../../components/admin/StatCard.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchStats().then(setS).catch(() => setErr('통계를 불러오지 못했습니다.'));
  }, []);

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!s) return <p className="py-12 text-center text-mute">불러오는 중…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="오늘 매출" value={`${won(s.sales.today)}원`} />
        <StatCard label="이번 달 매출" value={`${won(s.sales.month)}원`} />
        <StatCard label="처리 필요 주문" value={`${s.toHandle}건`} sub="결제완료·제작중" />
        <StatCard label="오늘 신규 회원" value={`${s.members.newToday}명`} sub={`총 ${s.members.total}명`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="판매중 상품" value={s.products.active} />
        <StatCard label="품절" value={s.products.soldout} />
        <StatCard label="미공개(draft)" value={s.products.draft} />
        <StatCard label="총 상품" value={s.products.total} />
      </div>

      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">최근 주문</h2>
          <Link to="/admin/orders" className="text-[13px] text-mute hover:text-ink">전체 보기</Link>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {s.recentOrders.map((o) => (
            <Link
              key={o._id}
              to={`/admin/orders/${o._id}`}
              className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-tint/40"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{o.orderNumber}</span>
              <span className="w-20 shrink-0 truncate text-mute">{o.recipient}</span>
              <span className="w-24 shrink-0 text-right">{won(o.grandTotal)}원</span>
              <span className="w-16 shrink-0 text-right"><StatusBadge status={o.status} /></span>
            </Link>
          ))}
          {s.recentOrders.length === 0 && <p className="py-6 text-center text-mute">주문이 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
