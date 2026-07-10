import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import SocialButtons from '../components/SocialButtons.jsx';

const inputCls =
  'w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none';

const REQUIRED_AGREEMENTS = [
  { key: 'terms', label: '이용약관 동의', required: true },
  { key: 'privacy', label: '개인정보 수집·이용 동의', required: true },
  { key: 'age', label: '만 14세 이상입니다', required: true },
  { key: 'marketing', label: '마케팅 정보 수신 (선택)', required: false },
];

export default function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();

  const [form, setForm] = useState({
    email: '', password: '', passwordConfirm: '', name: '', phone: '', nickname: '',
  });
  const [agree, setAgree] = useState({ terms: false, privacy: false, age: false, marketing: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const toggle = (key) => setAgree((a) => ({ ...a, [key]: !a[key] }));
  const allChecked = Object.values(agree).every(Boolean);
  const toggleAll = () => {
    const next = !allChecked;
    setAgree({ terms: next, privacy: next, age: next, marketing: next });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) return setError('비밀번호는 8자 이상이어야 합니다.');
    if (form.password !== form.passwordConfirm) return setError('비밀번호가 일치하지 않습니다.');
    if (!agree.terms || !agree.privacy || !agree.age) {
      return setError('필수 약관에 동의해주세요.');
    }

    setBusy(true);
    const now = new Date().toISOString();
    try {
      await signup({
        email: form.email,
        password: form.password,
        name: form.name,
        phone: form.phone,
        nickname: form.nickname || undefined,
        agreements: {
          termsOfService: { agreed: true, at: now, version: '1.0' },
          privacy: { agreed: true, at: now, version: '1.0' },
          ageOver14: { agreed: true, at: now },
          marketing: { email: agree.marketing, sms: agree.marketing, at: now },
        },
      });
      nav('/welcome', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || '회원가입에 실패했습니다.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-center text-2xl font-bold tracking-tight">회원가입</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        <input className={inputCls} type="email" name="email" placeholder="이메일"
          autoComplete="email" value={form.email} onChange={onChange} required />
        <input className={inputCls} type="password" name="password" placeholder="비밀번호 (8자 이상)"
          autoComplete="new-password" value={form.password} onChange={onChange} required />
        <input className={inputCls} type="password" name="passwordConfirm" placeholder="비밀번호 확인"
          autoComplete="new-password" value={form.passwordConfirm} onChange={onChange} required />
        <input className={inputCls} type="text" name="name" placeholder="이름"
          autoComplete="name" value={form.name} onChange={onChange} required />
        <input className={inputCls} type="tel" name="phone" placeholder="휴대폰 번호"
          autoComplete="tel" value={form.phone} onChange={onChange} required />
        <input className={inputCls} type="text" name="nickname" placeholder="닉네임 (선택)"
          value={form.nickname} onChange={onChange} />

        {/* 약관 동의 */}
        <div className="!mt-6 border border-line">
          <label className="flex cursor-pointer items-center gap-2 border-b border-line px-4 py-3 text-sm font-medium">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-ink" />
            전체 동의
          </label>
          <div className="space-y-2 px-4 py-3">
            {REQUIRED_AGREEMENTS.map((a) => (
              <label key={a.key} className="flex cursor-pointer items-center gap-2 text-[13px] text-mute">
                <input type="checkbox" checked={agree[a.key]} onChange={() => toggle(a.key)} className="accent-ink" />
                <span className={a.required ? 'text-ink' : ''}>
                  {a.required && <span className="text-sale">[필수] </span>}
                  {a.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-[13px] text-sale">{error}</p>
        )}

        <button type="submit" disabled={busy}
          className="w-full bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50">
          {busy ? '가입 중…' : '가입하기'}
        </button>
      </form>

      <SocialButtons />

      <p className="mt-6 text-center text-[13px] text-mute">
        이미 회원이신가요?{' '}
        <Link to="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
