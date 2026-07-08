import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import SocialButtons from '../components/SocialButtons.jsx';

const inputCls =
  'w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.email, form.password);
      nav('/welcome', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-center text-2xl font-bold tracking-tight">로그인</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        <input
          className={inputCls}
          type="email"
          name="email"
          placeholder="이메일"
          autoComplete="email"
          value={form.email}
          onChange={onChange}
          required
        />
        <input
          className={inputCls}
          type="password"
          name="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={form.password}
          onChange={onChange}
          required
        />

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
        >
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <SocialButtons />

      <p className="mt-6 text-center text-[13px] text-mute">
        아직 회원이 아니신가요?{' '}
        <Link to="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}
