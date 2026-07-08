import { useEffect, useState } from 'react';
import api from '../../lib/api.js';

export default function MembersAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/users', { params: { limit: 100 } })
      .then(({ data }) => setItems(data.items))
      .catch(() => setError('회원 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <p className="py-8 text-center text-mute">불러오는 중…</p>;
  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-mute">{error}</p>
        <button onClick={load} className="mt-4 border border-ink px-6 py-2.5 text-sm hover:bg-tint">다시 시도</button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">회원 <span className="text-[13px] font-normal text-mute">총 {items.length}명</span></h1>
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
