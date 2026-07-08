import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const VIA = { local: '이메일', kakao: '카카오', naver: '네이버', google: 'Google', apple: 'Apple' };

export default function Welcome() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  // 2.2초 후 메인으로 자동 이동
  useEffect(() => {
    if (!user) return undefined;
    const t = setTimeout(() => nav('/', { replace: true }), 2200);
    return () => clearTimeout(t);
  }, [user, nav]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const name = user.nickname || user.name;

  return (
    <div className="mx-auto flex min-h-[72vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <p className="animate-[fadeUp_0.6s_ease-out] text-[12px] font-medium tracking-[0.25em] text-mute">
        WELCOME
      </p>
      <h1 className="mt-4 animate-[fadeUp_0.6s_ease-out_0.1s_both] text-3xl font-bold leading-snug tracking-tight">
        {name}님,<br />
        환영합니다
      </h1>
      <p className="mt-4 animate-[fadeUp_0.6s_ease-out_0.2s_both] text-[14px] leading-relaxed text-mute">
        {VIA[user.provider] || '소셜'} 계정으로 로그인되었습니다.<br />
        잠시 후 메인 페이지로 이동합니다.
      </p>
      <button
        onClick={() => nav('/', { replace: true })}
        className="mt-9 animate-[fadeUp_0.6s_ease-out_0.3s_both] border border-ink px-8 py-3 text-sm font-medium transition-colors hover:bg-ink hover:text-paper"
      >
        메인으로 가기
      </button>

      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
