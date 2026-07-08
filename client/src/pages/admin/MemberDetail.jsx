import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchMember, setUserRole, setUserStatus } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatCard from '../../components/admin/StatCard.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

export default function MemberDetail() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setD(null);
    setErr('');
    fetchMember(id)
      .then((res) => active && setD(res))
      .catch(() => active && setErr('회원 정보를 불러오지 못했습니다.'));
    return () => { active = false; };
  }, [id]);

  const updateUser = (u) => setD((prev) => ({ ...prev, user: u }));

  const toggleRole = async () => {
    const next = d.user.role === 'admin' ? 'client' : 'admin';
    if (!window.confirm(`역할을 '${next}'(으)로 변경할까요?`)) return;
    setBusy(true);
    try {
      updateUser(await setUserRole(id, next));
    } catch (e) {
      window.alert(e.response?.data?.message || '역할 변경 실패');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    const next = d.user.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`'${next === 'suspended' ? '정지' : '활성'}' 처리할까요?`)) return;
    setBusy(true);
    try {
      updateUser(await setUserStatus(id, next));
    } catch (e) {
      window.alert(e.response?.data?.message || '상태 변경 실패');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!d) return <p className="py-12 text-center text-mute">불러오는 중…</p>;
  const { user, orders, orderCount, totalSpent } = d;

  return (
    <div className="max-w-3xl">
      <Link to="/admin/members" className="text-[13px] text-mute hover:text-ink">← 회원 목록</Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
        <span className={user.role === 'admin' ? 'text-sm font-medium text-ink' : 'text-sm text-mute'}>{user.role}</span>
        <span className={`text-sm ${user.status === 'suspended' ? 'text-sale' : 'text-mute'}`}>
          {user.status === 'suspended' ? '정지됨' : '활성'}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-mute">{user.email} · 가입 {user.createdAt?.slice(0, 10)}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="주문 수" value={`${orderCount}건`} />
        <StatCard label="총 구매액" value={`${won(totalSpent)}원`} sub="취소 제외" />
        <StatCard label="가입 경로" value={user.provider} />
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={toggleRole} disabled={busy}
          className="border border-ink px-5 py-2.5 text-sm font-medium hover:bg-tint disabled:opacity-50">
          {user.role === 'admin' ? '관리자 해제' : '관리자 지정'}
        </button>
        <button onClick={toggleStatus} disabled={busy}
          className="border border-line px-5 py-2.5 text-sm font-medium text-sale hover:bg-tint disabled:opacity-50">
          {user.status === 'suspended' ? '정지 해제' : '계정 정지'}
        </button>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-bold">주문 내역</h2>
        {orders.length === 0 ? (
          <p className="py-6 text-center text-mute">주문이 없습니다.</p>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {orders.map((o) => (
              <Link
                key={o._id}
                to={`/admin/orders/${o._id}`}
                className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-tint/40"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{o.orderNumber}</span>
                <span className="w-24 shrink-0 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</span>
                <span className="w-24 shrink-0 text-right">{won(o.amounts.grandTotal)}원</span>
                <span className="w-16 shrink-0 text-right"><StatusBadge status={o.status} /></span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
