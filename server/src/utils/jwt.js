import jwt from 'jsonwebtoken';

// 시크릿/만료는 호출 시점에 읽는다(dotenv 로드 순서 안전).
// JWT_SECRET이 없으면 하드코딩 값으로 조용히 폴백하지 않고 즉시 실패한다
// (폴백 문자열이 리포에 노출되면 admin 토큰 위조가 가능하기 때문).
// NODE_ENV에 의존하지 않는다 — 일부 호스트(Render 등)는 NODE_ENV를 자동 설정하지 않는다.
// 개발 편의가 필요하면 명시적으로 ALLOW_INSECURE_JWT=1 을 지정한다.
function secret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.ALLOW_INSECURE_JWT === '1') {
    return 'dev-only-insecure-secret-do-not-use-in-prod';
  }
  throw new Error('JWT_SECRET 미설정 — 서버를 기동할 수 없습니다. (개발은 ALLOW_INSECURE_JWT=1)');
}
const expiresIn = () => process.env.JWT_EXPIRES_IN || '7d';

// 토큰 페이로드: sub(유저 id), role
export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, secret(), {
    expiresIn: expiresIn(),
  });
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}
