import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const KakaoIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 3C6.48 3 2 6.58 2 10.95c0 2.79 1.86 5.24 4.65 6.63-.15.53-.97 3.35-1 3.57 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.68-2.42 4.26-2.82.56.08 1.14.12 1.71.12 5.52 0 10-3.58 10-7.95S17.52 3 12 3z" />
  </svg>
);
const NaverIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.27 12.84 7.38 0H0v24h7.73V11.16L16.62 24H24V0h-7.73v12.84z" />
  </svg>
);
const AppleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.86.99-2.28 1.76-3.44 1.66-.14-1.11.44-2.29 1.11-3.02.75-.83 2.06-1.46 3.13-1.53.02.29.02.58.02.87zM20.79 17.3c-.6 1.38-.88 2-1.65 3.22-1.08 1.7-2.6 3.82-4.49 3.83-1.68.02-2.11-1.09-4.39-1.08-2.28.01-2.75 1.1-4.43 1.08-1.88-.02-3.32-1.93-4.4-3.63C-1.02 18.24-.36 12.6 2.8 10.9c1.29-.7 2.65-1.02 3.9-1.02 1.28 0 2.61.65 3.44.65.8 0 2.46-.8 4.15-.68.71.03 2.7.29 3.98 2.16-3.5 1.92-2.94 6.92.52 8.31z" />
  </svg>
);
const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const PROVIDERS = [
  { id: 'kakao', label: '카카오로 시작하기', cls: 'bg-[#FEE500] text-black hover:brightness-95', icon: <KakaoIcon /> },
  { id: 'naver', label: '네이버로 시작하기', cls: 'bg-[#03C75A] text-white hover:brightness-95', icon: <NaverIcon /> },
  { id: 'google', label: 'Google로 시작하기', cls: 'border border-line bg-white text-ink hover:bg-tint', icon: <GoogleIcon /> },
  { id: 'apple', label: 'Apple로 계속하기', cls: 'bg-black text-white hover:brightness-125', icon: <AppleIcon /> },
];

export default function SocialButtons() {
  const { socialLogin } = useAuth();
  const nav = useNavigate();
  const from = useLocation().state?.from;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const onClick = async (id) => {
    setErr(''); setBusy(id);
    try {
      await socialLogin(id);
      nav(from || '/welcome', { replace: true });
    } catch {
      setErr('소셜 로그인에 실패했습니다.');
      setBusy('');
    }
  };

  return (
    <div>
      <div className="my-6 flex items-center gap-3 text-[12px] text-faint">
        <span className="h-px flex-1 bg-line" />
        간편 로그인
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-2.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onClick(p.id)}
            disabled={!!busy}
            className={`flex w-full items-center justify-center gap-2 py-3.5 text-sm font-medium transition disabled:opacity-60 ${p.cls}`}
          >
            {p.icon}
            {busy === p.id ? '연결 중…' : p.label}
          </button>
        ))}
      </div>

      {err && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{err}</p>}
    </div>
  );
}
