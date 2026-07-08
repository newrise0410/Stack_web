import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api.js';
import { won } from '../lib/format.js';
import { fetchAllOrders, updateOrderStatus } from '../lib/orders.js';

const inputCls =
  'w-full border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none';
const label = 'mb-1 block text-[12px] text-mute';

const TYPES = ['Table', 'Pendant', 'MoonWall'];
const STATUSES = ['active', 'draft', 'soldout', 'archived'];
const BADGE_OPTS = ['NEW', 'BEST', 'SALE'];

const emptyForm = {
  slug: '', name: '', nameKo: '', type: 'Table', price: '', compareAtPrice: '',
  badges: {}, imagesText: '', description: '',
  material: '', dimensions: '', feature: '', leadTime: '',
  optionsText: '', status: 'active',
};

// DB 상품 → 폼 상태
function toForm(p) {
  return {
    slug: p.slug, name: p.name, nameKo: p.nameKo || '', type: p.type,
    price: String(p.price ?? ''), compareAtPrice: p.compareAtPrice != null ? String(p.compareAtPrice) : '',
    badges: Object.fromEntries((p.badges || []).map((b) => [b, true])),
    imagesText: (p.images || []).join('\n'),
    description: p.description || '',
    material: p.specs?.material || '', dimensions: p.specs?.dimensions || '',
    feature: p.specs?.feature || '', leadTime: p.specs?.leadTime || '',
    optionsText: (p.options || []).join(', '),
    status: p.status || 'active',
  };
}

// 폼 상태 → API 바디
function toBody(f) {
  return {
    slug: f.slug.trim(),
    name: f.name.trim(),
    nameKo: f.nameKo.trim(),
    type: f.type,
    price: Number(f.price),
    compareAtPrice: f.compareAtPrice ? Number(f.compareAtPrice) : null,
    badges: BADGE_OPTS.filter((b) => f.badges[b]),
    images: f.imagesText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    description: f.description.trim(),
    specs: { material: f.material, dimensions: f.dimensions, feature: f.feature, leadTime: f.leadTime },
    options: f.optionsText.split(',').map((s) => s.trim()).filter(Boolean),
    status: f.status,
  };
}

function ProductForm({ initial, onDone, onCancel }) {
  const editing = Boolean(initial);
  const [f, setF] = useState(initial ? toForm(initial) : emptyForm);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const on = (e) => set(e.target.name, e.target.value);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const body = toBody(f);
      if (editing) await api.patch(`/products/${initial.slug}`, body);
      else await api.post('/products', body);
      onDone();
    } catch (e2) {
      setErr(e2.response?.data?.message || '저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-8 border border-line p-5">
      <h3 className="mb-4 text-sm font-bold">{editing ? '상품 수정' : '새 상품 등록'}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label}>slug (URL id) *</label>
          <input className={`${inputCls} ${editing ? 'bg-tint text-mute' : ''}`} name="slug" value={f.slug} onChange={on} readOnly={editing} required />
        </div>
        <div>
          <label className={label}>타입 *</label>
          <select className={inputCls} name="type" value={f.type} onChange={on}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>상품명 (EN) *</label>
          <input className={inputCls} name="name" value={f.name} onChange={on} required />
        </div>
        <div>
          <label className={label}>상품명 (KO)</label>
          <input className={inputCls} name="nameKo" value={f.nameKo} onChange={on} />
        </div>
        <div>
          <label className={label}>가격 (원) *</label>
          <input className={inputCls} type="number" name="price" value={f.price} onChange={on} required />
        </div>
        <div>
          <label className={label}>정가 (할인표시용)</label>
          <input className={inputCls} type="number" name="compareAtPrice" value={f.compareAtPrice} onChange={on} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>이미지 URL (줄바꿈/쉼표 구분)</label>
          <textarea className={inputCls} name="imagesText" rows={2} value={f.imagesText} onChange={on} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>설명</label>
          <textarea className={inputCls} name="description" rows={2} value={f.description} onChange={on} />
        </div>
        <div><label className={label}>소재</label><input className={inputCls} name="material" value={f.material} onChange={on} /></div>
        <div><label className={label}>크기</label><input className={inputCls} name="dimensions" value={f.dimensions} onChange={on} /></div>
        <div><label className={label}>기능</label><input className={inputCls} name="feature" value={f.feature} onChange={on} /></div>
        <div><label className={label}>제작</label><input className={inputCls} name="leadTime" value={f.leadTime} onChange={on} /></div>
        <div>
          <label className={label}>옵션 (쉼표 구분)</label>
          <input className={inputCls} name="optionsText" value={f.optionsText} onChange={on} />
        </div>
        <div>
          <label className={label}>상태</label>
          <select className={inputCls} name="status" value={f.status} onChange={on}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={label}>뱃지</label>
          <div className="flex gap-4">
            {BADGE_OPTS.map((b) => (
              <label key={b} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="accent-ink" checked={!!f.badges[b]}
                  onChange={() => set('badges', { ...f.badges, [b]: !f.badges[b] })} />
                {b}
              </label>
            ))}
          </div>
        </div>
      </div>

      {err && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="bg-ink px-6 py-2.5 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-50">
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onCancel} className="border border-line px-6 py-2.5 text-sm hover:bg-tint">취소</button>
      </div>
    </form>
  );
}

function ProductsAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // product | 'new' | null

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/products/admin')
      .then(({ data }) => setItems(data.items))
      .catch(() => setError('상품 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDone = () => { setEditing(null); load(); };
  const remove = async (slug) => {
    if (!window.confirm(`'${slug}' 상품을 삭제할까요?`)) return;
    await api.delete(`/products/${slug}`);
    load();
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[13px] text-mute">총 {items.length}개</p>
        {!editing && (
          <button onClick={() => setEditing('new')} className="bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85">
            + 새 상품
          </button>
        )}
      </div>

      {editing === 'new' && <ProductForm onDone={onDone} onCancel={() => setEditing(null)} />}
      {editing && editing !== 'new' && <ProductForm initial={editing} onDone={onDone} onCancel={() => setEditing(null)} />}

      {loading ? (
        <p className="py-8 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={load} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[12px] text-mute">
                <th className="py-2 pr-3">이미지</th>
                <th className="py-2 pr-3">상품명</th>
                <th className="py-2 pr-3">타입</th>
                <th className="py-2 pr-3">가격</th>
                <th className="py-2 pr-3">뱃지</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p._id} className="border-b border-line">
                  <td className="py-2 pr-3">
                    <img src={p.images?.[0]} alt="" className="h-12 w-12 rounded bg-tint object-cover" />
                  </td>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-[12px] text-mute">{p.nameKo}</p>
                  </td>
                  <td className="py-2 pr-3 text-mute">{p.type}</td>
                  <td className="py-2 pr-3">{won(p.price)}원</td>
                  <td className="py-2 pr-3 text-[12px] text-mute">{(p.badges || []).join(', ') || '-'}</td>
                  <td className="py-2 pr-3 text-[12px] text-mute">{p.status}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2 text-[12px]">
                      <button className="text-ink hover:underline" onClick={() => setEditing(p)}>수정</button>
                      <button className="text-sale hover:underline" onClick={() => remove(p.slug)}>삭제</button>
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

function UsersAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users', { params: { limit: 100 } })
      .then(({ data }) => setItems(data.items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="py-8 text-center text-mute">불러오는 중…</p>;

  return (
    <div className="overflow-x-auto">
      <p className="mb-4 text-[13px] text-mute">총 {items.length}명</p>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-y border-line text-left text-[12px] text-mute">
            <th className="py-2 pr-3">이메일</th>
            <th className="py-2 pr-3">이름</th>
            <th className="py-2 pr-3">닉네임</th>
            <th className="py-2 pr-3">역할</th>
            <th className="py-2 pr-3">가입일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u._id} className="border-b border-line">
              <td className="py-2 pr-3">{u.email}</td>
              <td className="py-2 pr-3">{u.name}</td>
              <td className="py-2 pr-3 text-mute">{u.nickname || '-'}</td>
              <td className="py-2 pr-3">
                <span className={u.role === 'admin' ? 'font-medium text-ink' : 'text-mute'}>{u.role}</span>
              </td>
              <td className="py-2 pr-3 text-[12px] text-mute">{u.createdAt?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ORDER_STATUSES = ['paid', 'preparing', 'shipped', 'delivered', 'cancelled'];
const ORDER_STATUS_LABEL = {
  pending: '결제대기', paid: '결제완료', preparing: '제작중',
  shipped: '배송중', delivered: '배송완료', cancelled: '취소',
};

function OrdersAdmin() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAllOrders()
      .then(setOrders)
      .catch(() => setError('주문을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const onChangeStatus = async (id, status) => {
    try {
      const updated = await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o._id === id ? updated : o)));
    } catch (e) {
      window.alert(e.response?.data?.message || '상태 변경 실패');
    }
  };

  if (loading) return <p className="py-8 text-center text-mute">불러오는 중…</p>;
  if (error) return <p className="py-8 text-center text-mute">{error}</p>;
  if (orders.length === 0) return <p className="py-8 text-center text-mute">주문이 없습니다.</p>;

  return (
    <div className="overflow-x-auto">
      <p className="mb-4 text-[13px] text-mute">총 {orders.length}건</p>
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-y border-line text-left text-[12px] text-mute">
            <th className="py-2 pr-3">주문번호</th>
            <th className="py-2 pr-3">일자</th>
            <th className="py-2 pr-3">상품</th>
            <th className="py-2 pr-3">금액</th>
            <th className="py-2 pr-3">상태</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o._id} className="border-b border-line align-top">
              <td className="py-3 pr-3 font-medium">{o.orderNumber}</td>
              <td className="py-3 pr-3 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</td>
              <td className="py-3 pr-3">
                {o.items.map((it, i) => (
                  <p key={i} className="text-[12px]">
                    {it.name} {it.option && `(${it.option})`} × {it.qty}
                  </p>
                ))}
              </td>
              <td className="py-3 pr-3">{won(o.amounts.grandTotal)}원</td>
              <td className="py-3 pr-3">
                <select
                  value={o.status}
                  onChange={(e) => onChangeStatus(o._id, e.target.value)}
                  className="border border-line px-2 py-1.5 text-[13px] focus:border-ink focus:outline-none"
                >
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { id: 'products', label: '상품 관리' },
  { id: 'users', label: '회원' },
  { id: 'orders', label: '주문' },
];

export default function Admin() {
  const [tab, setTab] = useState('products');
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight">관리자</h1>

      <div className="mt-6 flex gap-6 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-1 py-3 text-sm transition-colors ${
              tab === t.id ? 'border-ink font-semibold text-ink' : 'border-transparent text-mute hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-8">
        {tab === 'products' && <ProductsAdmin />}
        {tab === 'users' && <UsersAdmin />}
        {tab === 'orders' && <OrdersAdmin />}
      </div>
    </div>
  );
}
