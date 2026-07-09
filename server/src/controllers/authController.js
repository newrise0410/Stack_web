import { randomUUID } from 'node:crypto';
import User from '../models/User.js';
import { buildAndSaveUser } from './userController.js';
import { signToken } from '../utils/jwt.js';
import { grantSignupBonus } from '../services/pointService.js';

// 회원가입 — POST /auth/signup  (가입 후 자동 로그인: 토큰 발급)
export async function signup(req, res) {
  const user = await buildAndSaveUser(req.body);
  // 가입 축하 적립금 — 실패해도 가입은 성립
  try {
    const bonus = await grantSignupBonus(user._id);
    if (bonus) user.points = bonus.balance; // 응답에 잔액 반영
  } catch {
    /* 적립금 지급 실패는 가입을 실패시키지 않음 */
  }
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
  if (user.status === 'suspended') {
    return res.status(403).json({ message: '정지된 계정입니다. 고객센터에 문의해주세요.' });
  }

  const token = signToken(user);
  res.json({ token, user });
}

// 스터디용 mock 소셜 로그인. 실제 OAuth 아님.
const SOCIAL_LABEL = { google: '구글', apple: '애플', kakao: '카카오', naver: '네이버' };

// 소셜 로그인 — POST /auth/social { provider, deviceId }
// ⚠️ 계정 분리: 브라우저별 고유 deviceId로 providerId를 만들어 방문자마다 별도 계정 생성.
// (고정 데모계정을 쓰면 공개 배포에서 방문자끼리 배송지·주문내역이 공유돼 PII가 유출됨)
export async function socialLogin(req, res) {
  const provider = String(req.body.provider || '').toLowerCase();
  if (!SOCIAL_LABEL[provider]) {
    return res.status(400).json({ message: '지원하지 않는 소셜 로그인입니다.' });
  }

  // 클라가 보낸 브라우저 식별자만 허용문자로 정제. 없으면 무작위 발급(항상 새 계정).
  const raw = String(req.body.deviceId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const deviceId = raw || randomUUID();
  const providerId = `${provider}-${deviceId}`;

  let user = await User.findOne({ provider, providerId });
  if (!user) {
    const now = new Date();
    try {
      user = await User.create({
        provider,
        providerId,
        // providerId와 동일한 전체 deviceId로 이메일을 만들어 접두 충돌을 피한다
        email: `${provider}.${deviceId.toLowerCase()}@social.demo`,
        name: `${SOCIAL_LABEL[provider]} 사용자`,
        agreements: {
          termsOfService: { agreed: true, at: now, version: '1.0' },
          privacy: { agreed: true, at: now, version: '1.0' },
          ageOver14: { agreed: true, at: now },
        },
      });
      // 신규 소셜 계정 가입 보너스 — 실패해도 로그인은 성립
      try {
        const bonus = await grantSignupBonus(user._id);
        if (bonus) user.points = bonus.balance;
      } catch {
        /* 적립금 지급 실패 무시 */
      }
    } catch (e) {
      // 동시 최초 로그인(탭 2개 등) 경합 → 이미 생성된 계정을 재조회
      if (e.code === 11000) {
        user = await User.findOne({ provider, providerId });
        if (!user) throw e;
      } else {
        throw e;
      }
    }
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ message: '정지된 계정입니다. 고객센터에 문의해주세요.' });
  }

  const token = signToken(user);
  res.json({ token, user });
}

// 내 정보 — GET /auth/me  (requireAuth)
export async function me(req, res) {
  res.json({ user: req.user });
}
