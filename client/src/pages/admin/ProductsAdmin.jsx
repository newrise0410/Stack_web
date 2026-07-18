import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api.js';
import { won } from '../../lib/format.js';
import { fetchAdminProducts, patchProduct } from '../../lib/admin.js';
import { useToast } from '../../lib/toast.jsx';
import { uploadProductImage, cldUrl } from '../../lib/cloudinary.js';
import Stars from '../../components/Stars.jsx';
import Pagination from '../../components/admin/Pagination.jsx';

const inputCls =
  'w-full border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none';
const label = 'mb-1 block text-[12px] text-mute';

const TYPES = ['Table', 'Pendant', 'MoonWall', 'Tech', 'Clock'];
const STATUSES = ['active', 'draft', 'soldout', 'archived'];
const BADGE_OPTS = ['NEW', 'BEST', 'SALE'];
const SORTS = [
  { id: 'new', label: '최신순' },
  { id: 'best', label: '판매순' },
  { id: 'priceAsc', label: '낮은가격순' },
  { id: 'priceDesc', label: '높은가격순' },
];

// 이미지 행의 안정적 React key (인덱스 key는 삭제/재정렬 시 포커스가 튐)
let imgUid = 0;
const nextImgId = () => (imgUid += 1);

const emptyForm = {
  slug: '', name: '', nameKo: '', type: 'Table', price: '', compareAtPrice: '',
  badges: {}, images: [], description: '',
  material: '', dimensions: '', feature: '', leadTime: '',
  optionsText: '', status: 'active',
};

function toForm(p) {
  return {
    slug: p.slug, name: p.name, nameKo: p.nameKo || '', type: p.type,
    price: String(p.price ?? ''), compareAtPrice: p.compareAtPrice != null ? String(p.compareAtPrice) : '',
    badges: Object.fromEntries((p.badges || []).map((b) => [b, true])),
    images: (p.images || []).map((url) => ({ id: nextImgId(), url })),
    description: p.description || '',
    material: p.specs?.material || '', dimensions: p.specs?.dimensions || '',
    feature: p.specs?.feature || '', leadTime: p.specs?.leadTime || '',
    optionsText: (p.options || []).join(', '),
    status: p.status || 'active',
  };
}

function toBody(f) {
  return {
    slug: f.slug.trim(),
    name: f.name.trim(),
    nameKo: f.nameKo.trim(),
    type: f.type,
    price: Number(f.price),
    compareAtPrice: f.compareAtPrice ? Number(f.compareAtPrice) : null,
    badges: BADGE_OPTS.filter((b) => f.badges[b]),
    images: f.images.map((s) => s.url.trim()).filter(Boolean),
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
  const toast = useToast();
  const [uploadingIds, setUploadingIds] = useState(() => new Set()); // 동시 업로드 중인 슬롯 id들

  const uploadTo = async (img, file) => {
    if (!file) return;
    setUploadingIds((s) => new Set(s).add(img.id));
    try {
      const { url } = await uploadProductImage(file);
      setF((s) => ({ ...s, images: s.images.map((x) => (x.id === img.id ? { ...x, url } : x)) }));
    } catch (e) {
      toast.error(e.response?.data?.message || '업로드에 실패했습니다.');
    } finally {
      setUploadingIds((s) => { const n = new Set(s); n.delete(img.id); return n; });
    }
  };

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const on = (e) => set(e.target.name, e.target.value);

  // 이미지 배열 편집 (순서 = 노출 순서, 첫 장 = 대표)
  const setImage = (i, v) => setF((s) => ({ ...s, images: s.images.map((x, idx) => (idx === i ? { ...x, url: v } : x)) }));
  const addImage = () => setF((s) => ({ ...s, images: [...s.images, { id: nextImgId(), url: '' }] }));
  const removeImage = (i) => setF((s) => ({ ...s, images: s.images.filter((_, idx) => idx !== i) }));
  const moveImage = (i, dir) => setF((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.images.length) return s;
    const next = [...s.images];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...s, images: next };
  });

  const submit = async (e) => {
    e.preventDefault();
    // 업로드가 끝나기 전 저장하면 아직 안 채워진 옛 URL이 직렬화된다 → 업로드 완료까지 차단
    if (busy || uploadingIds.size > 0) return;
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
      <h3 className="mb-4 text-sm font-bold">
        {editing ? '상품 수정' : '새 상품 등록'}
        {/* SKU는 서버가 자동 부여하는 불변값 — 수정 모드에서만 읽기전용으로 보여준다. */}
        {editing && initial.sku && <span className="ml-2 font-mono text-[12px] text-mute">{initial.sku}</span>}
      </h3>
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
          <label className={label}>이미지 (파일 업로드 또는 URL, 순서 = 노출 순서, 첫 장이 대표)</label>
          <div className="space-y-2">
            {f.images.map((img, i) => (
              <div key={img.id} className="flex items-center gap-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden border border-line bg-tint">
                  {img.url && <img src={cldUrl(img.url, { w: 96, square: true })} alt="" className="h-full w-full object-cover" />}
                </div>
                <input className={inputCls} value={img.url} onChange={(e) => setImage(i, e.target.value)} placeholder="https://..." />
                <label className={`shrink-0 border border-line px-2 py-2 text-[12px] ${uploadingIds.has(img.id) ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-tint'}`}>
                  {uploadingIds.has(img.id) ? '…' : '업로드'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={uploadingIds.has(img.id)}
                    onChange={(e) => { uploadTo(img, e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <button type="button" onClick={() => moveImage(i, -1)} disabled={i === 0}
                  className="px-2 text-mute hover:text-ink disabled:opacity-30" aria-label="위로">↑</button>
                <button type="button" onClick={() => moveImage(i, 1)} disabled={i === f.images.length - 1}
                  className="px-2 text-mute hover:text-ink disabled:opacity-30" aria-label="아래로">↓</button>
                <button type="button" onClick={() => removeImage(i)} className="px-2 text-sale hover:opacity-70" aria-label="삭제">✕</button>
              </div>
            ))}
            <button type="button" onClick={addImage} className="border border-line px-3 py-1.5 text-[13px] hover:bg-tint">
              + 이미지 추가
            </button>
          </div>
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
        <button type="submit" disabled={busy || uploadingIds.size > 0} className="bg-ink px-6 py-2.5 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-50">
          {busy ? '저장 중…' : uploadingIds.size > 0 ? '업로드 중…' : '저장'}
        </button>
        <button type="button" onClick={onCancel} className="border border-line px-6 py-2.5 text-sm hover:bg-tint">취소</button>
      </div>
    </form>
  );
}

export default function ProductsAdmin() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'new';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // product | 'new' | null
  const [term, setTerm] = useState(q);

  const load = () => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAdminProducts({ q: q || undefined, type: type || undefined, status: status || undefined, sort, page })
      .then((d) => active && setData(d))
      .catch(() => active && setError('상품 목록을 불러오지 못했습니다.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  };

  useEffect(load, [q, type, status, sort, page]);
  useEffect(() => { setTerm(q); }, [q]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  const reload = () => { setEditing(null); load(); };
  const remove = async (slug) => {
    // 소프트 삭제 — 보관(archived) 처리라 목록에서 감춰지되 되돌릴 수 있다(이미지도 보존).
    if (!window.confirm(`'${slug}' 상품을 삭제할까요?\n\n보관 처리되어 스토어에서 숨겨집니다. 상태 필터 '보관'에서 되돌릴 수 있습니다.`)) return;
    try {
      await api.delete(`/products/${slug}`);
      toast.success('상품을 보관 처리했습니다.');
      // 현재 페이지의 마지막 항목을 지웠고 첫 페이지가 아니면 이전 페이지로(빈 페이지 갇힘 방지)
      if (data.items.length === 1 && page > 1) patch({ page: String(page - 1) });
      else load();
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  const quickStatus = async (p, next) => {
    try {
      const updated = await patchProduct(p.slug, { status: next });
      setData((d) => ({ ...d, items: d.items.map((x) => (x._id === p._id ? updated : x)) }));
      toast.success('상태를 변경했습니다.');
      // 상태 필터가 걸려 있고 새 상태가 필터와 어긋나면 목록·총계가 어긋나므로 재조회
      if (status && next !== status) load();
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">상품 <span className="text-[13px] font-normal text-mute">총 {data.total}개</span></h1>
        {!editing && (
          <button onClick={() => setEditing('new')} className="bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85">
            + 새 상품
          </button>
        )}
      </div>

      {editing === 'new' && <ProductForm onDone={reload} onCancel={() => setEditing(null)} />}
      {editing && editing !== 'new' && <ProductForm initial={editing} onDone={reload} onCancel={() => setEditing(null)} />}

      {!editing && (
        <div className="mb-4 flex flex-wrap gap-2">
          <form onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }} className="flex gap-2">
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="상품명·slug"
              className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
            <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
          </form>
          <select value={type} onChange={(e) => patch({ type: e.target.value })} className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none">
            <option value="">전체 타입</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={status} onChange={(e) => patch({ status: e.target.value })} className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none">
            <option value="">전체 상태</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => patch({ sort: e.target.value })} className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={load} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : data.total === 0 ? (
        <p className="py-8 text-center text-mute">상품이 없습니다.</p>
      ) : data.items.length === 0 ? (
        <p className="py-8 text-center text-mute">이 페이지에 표시할 상품이 없습니다.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-mute">
                  <th className="py-2 pr-3">이미지</th>
                  <th className="py-2 pr-3">상품명</th>
                  <th className="py-2 pr-3">타입</th>
                  <th className="py-2 pr-3">가격</th>
                  <th className="py-2 pr-3">판매</th>
                  <th className="py-2 pr-3">평점</th>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">관리</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p._id} className="border-b border-line">
                    <td className="py-2 pr-3">
                      <img src={cldUrl(p.images?.[0], { w: 96, square: true })} alt="" className="h-12 w-12 rounded bg-tint object-cover" />
                    </td>
                    <td className="py-2 pr-3">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[12px] text-mute">{p.nameKo}</p>
                      {p.sku && <p className="font-mono text-[11px] text-faint">{p.sku}</p>}
                    </td>
                    <td className="py-2 pr-3 text-mute">{p.type}</td>
                    <td className="py-2 pr-3">{won(p.price)}원</td>
                    <td className="py-2 pr-3 text-mute">{p.salesCount || 0}</td>
                    <td className="py-2 pr-3">
                      {p.ratingCount > 0 ? (
                        <span className="flex items-center gap-1">
                          <Stars value={p.ratingAvg} size="text-[10px]" />
                          <span className="text-[11px] text-faint">({p.ratingCount})</span>
                        </span>
                      ) : <span className="text-faint">-</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <select value={p.status} onChange={(e) => quickStatus(p, e.target.value)}
                        className="border border-line px-2 py-1 text-[12px] focus:border-ink focus:outline-none">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
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
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
