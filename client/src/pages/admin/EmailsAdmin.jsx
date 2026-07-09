import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAdminEmails, EMAIL_TYPE_LABEL } from '../../lib/email.js';
import Pagination from '../../components/admin/Pagination.jsx';

const TYPES = [
  { id: '', label: '전체' },
  { id: 'order_placed', label: '주문접수' },
  { id: 'order_status', label: '주문상태' },
];

function fmt(dt) {
  return dt ? dt.slice(0, 16).replace('T', ' ') : '';
}

export default function EmailsAdmin() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAdminEmails({ type: type || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setError('이메일을 불러오지 못했습니다.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [type, page, reloadKey]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">
        이메일 <span className="text-[13px] font-normal text-mute">발송 목업 · 총 {data.total}건</span>
      </h1>
      <p className="mb-4 text-[12px] text-faint">실제 발송 대신 저장된 알림 메일입니다. 클릭하면 내용을 미리볼 수 있어요.</p>

      <div className="mb-4 flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => patch({ type: t.id })}
            className={`border px-3 py-1.5 text-[13px] ${
              type === t.id ? 'border-ink bg-ink text-paper' : 'border-line text-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={() => setReloadKey((k) => k + 1)} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : data.total === 0 ? (
        <p className="py-10 text-center text-mute">발송된 이메일이 없습니다.</p>
      ) : data.items.length === 0 ? (
        <>
          <p className="py-10 text-center text-mute">이 페이지에 표시할 이메일이 없습니다.</p>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </>
      ) : (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {data.items.map((m) => {
              const open = openId === m._id;
              return (
                <li key={m._id}>
                  <button
                    onClick={() => setOpenId(open ? null : m._id)}
                    className="flex w-full items-center gap-3 py-3 text-left text-sm hover:bg-tint/40"
                  >
                    <span className="w-16 shrink-0 border border-line px-1.5 py-0.5 text-center text-[11px] text-mute">
                      {EMAIL_TYPE_LABEL[m.type] || m.type}
                    </span>
                    {m.statusLabel && <span className="shrink-0 text-[12px] text-ink">{m.statusLabel}</span>}
                    <span className="min-w-0 flex-1 truncate">{m.subject}</span>
                    <span className="hidden shrink-0 text-[12px] text-mute sm:inline">{m.to}</span>
                    <span className="w-28 shrink-0 text-right text-[12px] text-faint">{fmt(m.createdAt)}</span>
                  </button>
                  {open && (
                    <div className="mb-3 whitespace-pre-line border border-line bg-tint/30 p-4 text-[13px] leading-relaxed">
                      <p className="mb-2 text-[12px] text-mute">
                        받는이: {m.to}
                        {m.order?.orderNumber && <> · 주문 {m.order.orderNumber}</>}
                      </p>
                      <p className="mb-2 font-semibold">{m.subject}</p>
                      {m.body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
