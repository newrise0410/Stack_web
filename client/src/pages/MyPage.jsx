import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { fetchMyOrders, cancelOrder } from '../lib/orders.js';
import { won } from '../lib/format.js';
import PostcodeModal from '../components/PostcodeModal.jsx';

const inputCls =
  'w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none';

// 서버에 되돌려보낼 주소 필드만 정리 (기존 _id는 유지해 동일 주소로 인식)
const cleanAddr = (a) => ({
  ...(a._id ? { _id: a._id } : {}),
  label: a.label,
  recipient: a.recipient,
  phone: a.phone,
  zipcode: a.zipcode,
  address1: a.address1,
  address2: a.address2,
  deliveryMemo: a.deliveryMemo,
  isDefault: !!a.isDefault,
});

// ── 프로필 탭 ──────────────────────────────────────────────
function ProfileTab() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name: user.name || '',
    nickname: user.nickname || '',
    phone: user.phone || '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg(''); setErr(''); setBusy(true);
    try {
      await updateProfile({ name: form.name, nickname: form.nickname, phone: form.phone });
      setMsg('저장되었습니다.');
    } catch (e2) {
      setErr(e2.response?.data?.message || '저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <div>
        <label className="mb-1 block text-[13px] text-mute">이메일</label>
        <input className={`${inputCls} bg-tint text-mute`} value={user.email} disabled />
      </div>
      <div>
        <label className="mb-1 block text-[13px] text-mute">이름</label>
        <input className={inputCls} name="name" value={form.name} onChange={onChange} required />
      </div>
      <div>
        <label className="mb-1 block text-[13px] text-mute">닉네임</label>
        <input className={inputCls} name="nickname" value={form.nickname} onChange={onChange}
          placeholder="공개 표시명 (선택)" />
      </div>
      <div>
        <label className="mb-1 block text-[13px] text-mute">휴대폰</label>
        <input className={inputCls} name="phone" value={form.phone} onChange={onChange} required />
      </div>

      {msg && <p className="text-[13px] text-ink">{msg}</p>}
      {err && <p className="rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{err}</p>}

      <button type="submit" disabled={busy}
        className="bg-ink px-8 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50">
        {busy ? '저장 중…' : '저장'}
      </button>
    </form>
  );
}

// ── 배송지 탭 ──────────────────────────────────────────────
const emptyAddr = {
  label: '', recipient: '', phone: '', zipcode: '',
  address1: '', address2: '', isDefault: false,
};

function AddressTab() {
  const { user, updateProfile } = useAuth();
  const addresses = user.addresses || [];
  const [form, setForm] = useState(emptyAddr);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [postcodeOpen, setPostcodeOpen] = useState(false);

  const save = async (next) => {
    setErr(''); setBusy(true);
    try {
      await updateProfile({ addresses: next.map(cleanAddr) });
    } catch (e) {
      setErr(e.response?.data?.message || '저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const onChange = (e) =>
    setForm((f) => ({
      ...f,
      [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const onPostcodeSelect = ({ zipcode, address1 }) => {
    setErr('');
    setForm((f) => ({ ...f, zipcode, address1 }));
  };

  const addAddress = async (e) => {
    e.preventDefault();
    if (!form.zipcode || !form.address1) {
      setErr('우편번호를 검색해주세요.');
      return;
    }
    let next = [...addresses, { ...form }];
    if (form.isDefault) next = next.map((a, i) => ({ ...a, isDefault: i === next.length - 1 }));
    else if (next.length === 1) next[0].isDefault = true; // 첫 주소는 기본
    await save(next);
    setForm(emptyAddr);
    setAdding(false);
  };

  const removeAddress = (idx) => save(addresses.filter((_, i) => i !== idx));
  const setDefault = (idx) => save(addresses.map((a, i) => ({ ...a, isDefault: i === idx })));

  return (
    <div className="max-w-2xl">
      {addresses.length === 0 && !adding && (
        <p className="text-[14px] text-mute">등록된 배송지가 없습니다.</p>
      )}

      <ul className="space-y-3">
        {addresses.map((a, idx) => (
          <li key={a._id || idx} className="border border-line p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm">
                <p className="font-medium">
                  {a.label || '배송지'} · {a.recipient}
                  {a.isDefault && (
                    <span className="ml-2 border border-ink px-1.5 py-0.5 text-[10px]">기본</span>
                  )}
                </p>
                <p className="mt-1 text-mute">{a.phone}</p>
                <p className="mt-1 text-mute">
                  ({a.zipcode}) {a.address1} {a.address2}
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-[12px]">
                {!a.isDefault && (
                  <button className="text-mute hover:text-ink" onClick={() => setDefault(idx)} disabled={busy}>
                    기본 설정
                  </button>
                )}
                <button className="text-sale hover:opacity-70" onClick={() => removeAddress(idx)} disabled={busy}>
                  삭제
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <form onSubmit={addAddress} className="mt-5 space-y-3 border border-line p-4">
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} name="label" placeholder="배송지명 (집/회사)" value={form.label} onChange={onChange} />
            <input className={inputCls} name="recipient" placeholder="받는 사람" value={form.recipient} onChange={onChange} required />
          </div>
          <input className={inputCls} name="phone" placeholder="연락처" value={form.phone} onChange={onChange} required />
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1 bg-tint`} name="zipcode" placeholder="우편번호" value={form.zipcode} readOnly required />
            <button type="button" onClick={() => setPostcodeOpen(true)}
              className="shrink-0 border border-ink px-4 text-sm font-medium hover:bg-tint">
              우편번호 검색
            </button>
          </div>
          <input className={`${inputCls} bg-tint`} name="address1" placeholder="기본주소 (검색으로 입력)" value={form.address1} readOnly required />
          <input className={inputCls} name="address2" placeholder="상세주소 (직접 입력)" value={form.address2} onChange={onChange} />
          <label className="flex items-center gap-2 text-[13px] text-mute">
            <input type="checkbox" name="isDefault" checked={form.isDefault} onChange={onChange} className="accent-ink" />
            기본 배송지로 설정
          </label>
          {err && <p className="rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy}
              className="bg-ink px-6 py-3 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-50">
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setForm(emptyAddr); }}
              className="border border-line px-6 py-3 text-sm hover:bg-tint">
              취소
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)}
          className="mt-5 border border-ink px-6 py-3 text-sm font-medium hover:bg-tint">
          + 배송지 추가
        </button>
      )}

      <PostcodeModal
        open={postcodeOpen}
        onClose={() => setPostcodeOpen(false)}
        onSelect={onPostcodeSelect}
      />
    </div>
  );
}

// ── 주문내역 탭 ────────────────────────────────────────────
const STATUS_LABEL = {
  pending: '결제 대기',
  paid: '결제 완료',
  preparing: '제작 중',
  shipped: '배송 중',
  delivered: '배송 완료',
  cancelled: '취소',
};

const CANCELLABLE = ['paid', 'preparing'];

function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMyOrders()
      .then(setOrders)
      .catch(() => setError('주문 내역을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const onCancel = async (id) => {
    if (!window.confirm('이 주문을 취소하시겠어요?')) return;
    try {
      const updated = await cancelOrder(id);
      setOrders((prev) => prev.map((o) => (o._id === id ? updated : o)));
    } catch (e) {
      window.alert(e.response?.data?.message || '주문 취소에 실패했습니다.');
    }
  };

  if (loading) return <div className="py-8 text-center text-mute">불러오는 중…</div>;
  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-[14px] text-mute">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">
          다시 시도
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[14px] text-mute">주문 내역이 없습니다.</p>
        <Link to="/" className="mt-6 inline-block border border-ink px-6 py-2.5 text-sm hover:bg-tint">
          쇼핑하러 가기
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {orders.map((o) => (
        <li key={o._id} className="border border-line">
          <div className="flex items-center justify-between border-b border-line bg-tint/50 px-5 py-3 text-[13px]">
            <div>
              <span className="font-semibold">{o.orderNumber}</span>
              <span className="ml-2 text-mute">{o.createdAt?.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`font-medium ${o.status === 'cancelled' ? 'text-faint' : 'text-ink'}`}>
                {STATUS_LABEL[o.status] || o.status}
              </span>
              {CANCELLABLE.includes(o.status) && (
                <button onClick={() => onCancel(o._id)} className="text-[12px] text-mute underline-offset-2 hover:text-sale hover:underline">
                  주문 취소
                </button>
              )}
            </div>
          </div>
          <ul className="divide-y divide-line px-5">
            {o.items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <img src={it.image} alt="" className="h-14 w-14 bg-tint object-cover" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium">{it.name}</p>
                  <p className="text-[12px] text-mute">
                    {it.option && `${it.option} · `}수량 {it.qty}
                  </p>
                </div>
                <span className="text-[13px]">{won(it.price * it.qty)}원</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-line px-5 py-3 text-[13px]">
            <span className="text-mute">
              결제금액 {o.amounts.shippingFee === 0 ? '(무료배송)' : `(배송비 ${won(o.amounts.shippingFee)}원)`}
            </span>
            <span className="font-bold">{won(o.amounts.grandTotal)}원</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TABS = [
  { id: 'profile', label: '내 정보' },
  { id: 'address', label: '배송지 관리' },
  { id: 'orders', label: '주문 내역' },
];

export default function MyPage() {
  const { user, deleteAccount } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState('profile');

  const onDelete = async () => {
    if (!window.confirm('정말 탈퇴하시겠어요? 계정 정보가 삭제됩니다.')) return;
    await deleteAccount();
    nav('/', { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight">마이페이지</h1>
      <p className="mt-1 text-[14px] text-mute">{user.nickname || user.name}님, 안녕하세요.</p>

      <div className="mt-8 grid gap-10 md:grid-cols-[200px_1fr]">
        {/* side nav */}
        <nav className="flex gap-2 md:flex-col md:gap-0 md:border-r md:border-line md:pr-6">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`whitespace-nowrap px-2 py-2.5 text-left text-sm transition-colors ${
                tab === t.id ? 'font-semibold text-ink' : 'text-mute hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
          <button onClick={onDelete}
            className="mt-4 px-2 py-2.5 text-left text-[13px] text-faint hover:text-sale">
            회원 탈퇴
          </button>
        </nav>

        {/* content */}
        <div>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'address' && <AddressTab />}
          {tab === 'orders' && <OrdersTab />}
        </div>
      </div>
    </div>
  );
}
