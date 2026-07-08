import User from '../models/User.js';
import { buildAndSaveUser } from './userController.js';
import { signToken } from '../utils/jwt.js';

// 회원가입 — POST /auth/signup  (가입 후 자동 로그인: 토큰 발급)
export async function signup(req, res) {
  const user = await buildAndSaveUser(req.body);
  const token = signToken(user);
  res.status(201).json({ token, user }); // user.toJSON이 passwordHash 제거
}

// 로그인 — POST /auth/login
export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  }

  // passwordHash는 select:false라 명시적으로 포함시킨다.
  const user = await User.findOne({ email: String(email).toLowerCase() })
    .select('+passwordHash');

  // 사용자 없음/소셜계정/비번 불일치 → 동일 메시지(계정 존재 여부 노출 방지)
  if (!user || user.provider !== 'local' || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  const token = signToken(user);
  res.json({ token, user });
}

// 스터디용 mock 소셜 프로필. 실제 OAuth 연동 시 이 부분을 제공자 응답으로 교체.
const SOCIAL_DEMO = {
  google: { providerId: 'google-demo-001', email: 'google.demo@stacknstak.test', name: '구글 사용자' },
  apple: { providerId: 'apple-demo-001', email: 'apple.demo@stacknstak.test', name: '애플 사용자' },
  kakao: { providerId: 'kakao-demo-001', email: 'kakao.demo@stacknstak.test', name: '카카오 사용자' },
  naver: { providerId: 'naver-demo-001', email: 'naver.demo@stacknstak.test', name: '네이버 사용자' },
};

// 소셜 로그인 — POST /auth/social { provider }
// provider+providerId로 계정을 찾고 없으면 생성(find-or-create) 후 토큰 발급.
export async function socialLogin(req, res) {
  const provider = String(req.body.provider || '').toLowerCase();
  const demo = SOCIAL_DEMO[provider];
  if (!demo) {
    return res.status(400).json({ message: '지원하지 않는 소셜 로그인입니다.' });
  }

  let user = await User.findOne({ provider, providerId: demo.providerId });
  if (!user) {
    const now = new Date();
    user = await User.create({
      provider,
      providerId: demo.providerId,
      email: demo.email,
      name: demo.name,
      agreements: {
        termsOfService: { agreed: true, at: now, version: '1.0' },
        privacy: { agreed: true, at: now, version: '1.0' },
        ageOver14: { agreed: true, at: now },
      },
    });
  }

  const token = signToken(user);
  res.json({ token, user });
}

// 내 정보 — GET /auth/me  (requireAuth)
export async function me(req, res) {
  res.json({ user: req.user });
}
