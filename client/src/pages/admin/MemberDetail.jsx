import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchMember, setUserRole, setUserStatus } from '../../lib/admin.js';
import { fetchAdminCoupons, issueCouponToMember, couponBenefitText } from '../../lib/coupon.js';
import { adjustMemberPoints, POINT_TYPE_LABEL } from '../../lib/points.js';
import { useToast } from '../../lib/toast.jsx';
import { won } from '../../lib/format.js';
import StatCard from '../../components/admin/StatCard.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

function PointsSection({ userId, balance, transactions, onChanged }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const adjust = async (sign) => {
    const n = parseInt(amount, 10);
    if (!n || n <= 0) return toast.error('조정할 금액을 입력해주세요.');
    setBusy(true);
    try {
      const { applied } = await adjustMemberPoints(userId, sign * n, note.trim());
      // 서버가 0까지만 클램프 — 실제 반영량(applied)이 0이면 "차감할 잔액 부족"을 안내
      if (applied === 0) {
        toast.error('잔액이 부족해 차감된 금액이 없습니다.');
      } else {
        toast.success(applied > 0 ? '적립금을 지급했습니다.' : '적립금을 차감했습니다.');
      }
      setAmount(''); setNote('');
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || '적립금 조정에 실패했습니다.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold">적립금</h2>
      <p className="mb-3 text-sm">현재 잔액 <b className="text-lg">{won(balance)}P</b></p>
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="금액"
          className="w-28 border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="사유 (선택)"
          className="min-w-0 flex-1 border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
        <button onClick={() => adjust(1)} disabled={busy} className="border border-ink px-4 py-2 text-sm hover:bg-tint disabled:opacity-50">지급 +</button>
        <button onClick={() => adjust(-1)} disabled={busy} className="border border-line px-4 py-2 text-sm text-sale hover:bg-tint disabled:opacity-50">차감 −</button>
      </div>
      {transactions.length === 0 ? (
        <p className="text-[13px] text-mute">적립금 내역이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {transactions.map((t) => (
            <li key={t._id} className="flex items-center justify-between py-2.5">
              <span className="text-[12px] text-mute">{POINT_TYPE_LABEL[t.type] || t.type}
                {t.note && <span className="ml-1 text-faint">· {t.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className={t.amount >= 0 ? 'text-ink' : 'text-sale'}>{t.amount >= 0 ? '+' : ''}{won(t.amount)}P</span>
                <span className="w-24 text-right text-[12px] text-faint">{t.createdAt?.slice(0, 10)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueCoupon({ userId }) {
  const toast = useToast();
  const [coupons, setCoupons] = useState([]);
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAdminCoupons()
      .then((d) => setCoupons(d.items.filter((c) => c.active && !(c.expiresAt && new Date(c.expiresAt) < new Date()))))
      .catch(() => setCoupons([]));
  }, []);

  const issue = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await issueCouponToMember(userId, sel);
      toast.success('쿠폰을 발급했습니다.');
      setSel('');
    } catch (e) {
      toast.error(e.response?.data?.message || '발급에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold">쿠폰 발급</h2>
      {coupons.length === 0 ? (
        <p className="text-[13px] text-mute">발급할 활성 쿠폰이 없습니다. 쿠폰 메뉴에서 먼저 생성하세요.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <select value={sel} onChange={(e) => setSel(e.target.value)}
            className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none">
            <option value="">쿠폰 선택</option>
            {coupons.map((c) => (
              <option key={c._id} value={c._id}>{c.code} · {couponBenefitText(c)}</option>
            ))}
          </select>
          <button onClick={issue} disabled={!sel || busy}
            className="border border-ink px-5 py-2 text-sm hover:bg-tint disabled:opacity-50">
            {busy ? '발급 중…' : '발급'}
          </button>
        </div>
      )}
    </section>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setD(null);
    setErr('');
    fetchMember(id)
      .then((res) => active && setD(res))
      .catch(() => active && setErr('회원 정보를 불러오지 못했습니다.'));
    return () => { active = false; };
  }, [id, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const updateUser = (u) => setD((prev) => ({ ...prev, user: u }));

  const toggleRole = async () => {
    const next = d.user.role === 'admin' ? 'client' : 'admin';
    if (!window.confirm(`역할을 '${next}'(으)로 변경할까요?`)) return;
    setBusy(true);
    try {
      updateUser(await setUserRole(id, next));
      toast.success('역할을 변경했습니다.');
    } catch (e) {
      toast.error(e.response?.data?.message || '역할 변경에 실패했습니다.');
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
      toast.success(next === 'suspended' ? '계정을 정지했습니다.' : '정지를 해제했습니다.');
    } catch (e) {
      toast.error(e.response?.data?.message || '상태 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!d) return <p className="py-12 text-center text-mute">불러오는 중…</p>;
  const { user, orders, orderCount, totalSpent, points = 0, pointTransactions = [] } = d;

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

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="주문 수" value={`${orderCount}건`} />
        <StatCard label="총 구매액" value={`${won(totalSpent)}원`} sub="취소 제외" />
        <StatCard label="적립금" value={`${won(points)}P`} />
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

      <PointsSection userId={user._id} balance={points} transactions={pointTransactions} onChanged={reload} />

      <IssueCoupon userId={user._id} />
    </div>
  );
}
