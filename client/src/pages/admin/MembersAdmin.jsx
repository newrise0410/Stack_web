import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMembers, setUserRole, setUserStatus } from '../../lib/admin.js';
import Pagination from '../../components/admin/Pagination.jsx';

export default function MembersAdmin() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [data, setData] = useState({ items: [], total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState(q);

  const load = () => {
    let active = true;
    setLoading(true);
    setError('');
    fetchMembers({ q: q || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setError('회원 목록을 불러오지 못했습니다.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  };

  useEffect(load, [q, page]);
  useEffect(() => { setTerm(q); }, [q]);

  const patch = (obj) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(obj).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      if (!('page' in obj)) n.delete('page');
      return n;
    });

  const toggleRole = async (u, e) => {
    e.stopPropagation();
    const next = u.role === 'admin' ? 'client' : 'admin';
    if (!window.confirm(`${u.email}의 역할을 '${next}'(으)로 변경할까요?`)) return;
    try {
      const updated = await setUserRole(u._id, next);
      setData((d) => ({ ...d, items: d.items.map((x) => (x._id === u._id ? updated : x)) }));
    } catch (err) {
      window.alert(err.response?.data?.message || '역할 변경 실패');
    }
  };

  const toggleStatus = async (u, e) => {
    e.stopPropagation();
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${u.email}을(를) '${next === 'suspended' ? '정지' : '활성'}' 처리할까요?`)) return;
    try {
      const updated = await setUserStatus(u._id, next);
      setData((d) => ({ ...d, items: d.items.map((x) => (x._id === u._id ? updated : x)) }));
    } catch (err) {
      window.alert(err.response?.data?.message || '상태 변경 실패');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">회원</h1>

      <form
        onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }}
        className="mt-5 flex gap-2"
      >
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="이메일·이름·닉네임"
          className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
      </form>

      {loading ? (
        <p className="py-10 text-center text-mute">불러오는 중…</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-mute">{error}</p>
          <button onClick={load} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
        </div>
      ) : data.total === 0 ? (
        <p className="py-10 text-center text-mute">회원이 없습니다.</p>
      ) : (
        <div className="mt-5">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}명</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-mute">
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">역할</th>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">가입일</th>
                  <th className="py-2 pr-3">관리</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr
                    key={u._id}
                    onClick={() => nav(`/admin/members/${u._id}`)}
                    className="cursor-pointer border-b border-line hover:bg-tint/40"
                  >
                    <td className="py-3 pr-3">{u.email}</td>
                    <td className="py-3 pr-3">{u.name}</td>
                    <td className="py-3 pr-3">
                      <span className={u.role === 'admin' ? 'font-medium text-ink' : 'text-mute'}>{u.role}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className={u.status === 'suspended' ? 'text-sale' : 'text-mute'}>
                        {u.status === 'suspended' ? '정지' : '활성'}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-[12px] text-mute">{u.createdAt?.slice(0, 10)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex gap-2 text-[12px]">
                        <button className="text-ink hover:underline" onClick={(e) => toggleRole(u, e)}>
                          {u.role === 'admin' ? '관리자 해제' : '관리자 지정'}
                        </button>
                        <button className="text-sale hover:underline" onClick={(e) => toggleStatus(u, e)}>
                          {u.status === 'suspended' ? '정지 해제' : '정지'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
