import { useEffect, useState } from 'react';
import {
  fetchAdminCoupons, createCoupon, updateCoupon, deleteCoupon,
  couponBenefitText, DISCOUNT_TYPE_LABEL,
} from '../../lib/coupon.js';
import { won } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';

const inputCls = 'w-full border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none';
const label = 'mb-1 block text-[12px] text-mute';

const emptyForm = {
  code: '', name: '', discountType: 'fixed',
  discountValue: '', maxDiscount: '', minOrderAmount: '', expiresAt: '', active: true,
};

function toForm(c) {
  return {
    code: c.code, name: c.name, discountType: c.discountType,
    discountValue: String(c.discountValue ?? ''),
    maxDiscount: c.maxDiscount ? String(c.maxDiscount) : '',
    minOrderAmount: c.minOrderAmount ? String(c.minOrderAmount) : '',
    expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
    active: c.active,
  };
}

function toBody(f) {
  return {
    code: f.code.trim().toUpperCase(),
    name: f.name.trim(),
    discountType: f.discountType,
    discountValue: f.discountType === 'free_shipping' ? 0 : Number(f.discountValue) || 0,
    maxDiscount: f.discountType === 'percent' ? Number(f.maxDiscount) || 0 : 0,
    minOrderAmount: Number(f.minOrderAmount) || 0,
    expiresAt: f.expiresAt || null,
    active: f.active,
  };
}

function CouponForm({ initial, onDone, onCancel }) {
  const editing = Boolean(initial);
  const toast = useToast();
  const [f, setF] = useState(initial ? toForm(initial) : emptyForm);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const on = (e) => set(e.target.name, e.target.value);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) await updateCoupon(initial._id, toBody(f));
      else await createCoupon(toBody(f));
      toast.success(editing ? '쿠폰을 수정했습니다.' : '쿠폰을 생성했습니다.');
      onDone();
    } catch (e2) {
      toast.error(e2.response?.data?.message || '저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-8 border border-line p-5">
      <h3 className="mb-4 text-sm font-bold">{editing ? '쿠폰 수정' : '새 쿠폰'}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label}>쿠폰 코드 *</label>
          <input className={`${inputCls} uppercase`} name="code" value={f.code} onChange={on} placeholder="WELCOME10" required />
        </div>
        <div>
          <label className={label}>이름 *</label>
          <input className={inputCls} name="name" value={f.name} onChange={on} placeholder="가입 축하 10%" required />
        </div>
        <div>
          <label className={label}>할인 유형</label>
          <select className={inputCls} name="discountType" value={f.discountType} onChange={on}>
            <option value="fixed">정액 할인</option>
            <option value="percent">정률 할인</option>
            <option value="free_shipping">무료배송</option>
          </select>
        </div>
        {f.discountType !== 'free_shipping' && (
          <div>
            <label className={label}>{f.discountType === 'percent' ? '할인율 (%)' : '할인 금액 (원)'}</label>
            <input className={inputCls} type="number" name="discountValue" value={f.discountValue} onChange={on} required />
          </div>
        )}
        {f.discountType === 'percent' && (
          <div>
            <label className={label}>최대 할인액 (원, 0=무제한)</label>
            <input className={inputCls} type="number" name="maxDiscount" value={f.maxDiscount} onChange={on} />
          </div>
        )}
        <div>
          <label className={label}>최소 주문금액 (원)</label>
          <input className={inputCls} type="number" name="minOrderAmount" value={f.minOrderAmount} onChange={on} />
        </div>
        <div>
          <label className={label}>만료일 (비우면 무기한)</label>
          <input className={inputCls} type="date" name="expiresAt" value={f.expiresAt} onChange={on} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-ink" checked={f.active} onChange={() => set('active', !f.active)} />
            활성
          </label>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="bg-ink px-6 py-2.5 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-50">
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onCancel} className="border border-line px-6 py-2.5 text-sm hover:bg-tint">취소</button>
      </div>
    </form>
  );
}

export default function CouponsAdmin() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // coupon | 'new' | null
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAdminCoupons()
      .then((d) => active && setItems(d.items))
      .catch(() => active && setError('쿠폰을 불러오지 못했습니다.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [reloadKey]);

  const reload = () => { setEditing(null); setReloadKey((k) => k + 1); };

  const remove = async (c) => {
    if (!window.confirm(`쿠폰 '${c.code}'을(를) 삭제할까요? (발급된 회원 보유분은 사용 불가가 됩니다)`)) return;
    try {
      await deleteCoupon(c._id);
      toast.success('쿠폰을 삭제했습니다.');
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  const isExpired = (c) => c.expiresAt && new Date(c.expiresAt) < new Date();

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">쿠폰 <span className="text-[13px] font-normal text-mute">총 {items.length}개</span></h1>
        {!editing && (
          <button onClick={() => setEditing('new')} className="bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85">+ 새 쿠폰</button>
        )}
      </div>

      {editing === 'new' && <CouponForm onDone={reload} onCancel={() => setEditing(null)} />}
      {editing && editing !== 'new' && <CouponForm initial={editing} onDone={reload} onCancel={() => setEditing(null)} />}

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={() => setReloadKey((k) => k + 1)} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-mute">쿠폰이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[12px] text-mute">
                <th className="py-2 pr-3">코드</th>
                <th className="py-2 pr-3">이름</th>
                <th className="py-2 pr-3">혜택</th>
                <th className="py-2 pr-3">최소주문</th>
                <th className="py-2 pr-3">만료</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c._id} className="border-b border-line">
                  <td className="py-2 pr-3 font-mono font-medium">{c.code}</td>
                  <td className="py-2 pr-3">{c.name}</td>
                  <td className="py-2 pr-3 text-mute">{couponBenefitText(c)}</td>
                  <td className="py-2 pr-3 text-mute">{c.minOrderAmount ? `${won(c.minOrderAmount)}원` : '-'}</td>
                  <td className="py-2 pr-3 text-mute">{c.expiresAt ? c.expiresAt.slice(0, 10) : '무기한'}</td>
                  <td className="py-2 pr-3">
                    {!c.active ? <span className="text-faint">비활성</span>
                      : isExpired(c) ? <span className="text-sale">만료</span>
                      : <span className="text-ink">활성</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2 text-[12px]">
                      <button className="text-ink hover:underline" onClick={() => setEditing(c)}>수정</button>
                      <button className="text-sale hover:underline" onClick={() => remove(c)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
