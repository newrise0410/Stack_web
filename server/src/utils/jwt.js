import jwt from 'jsonwebtoken';

// 시크릿/만료는 호출 시점에 읽는다(dotenv 로드 순서 안전).
const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';
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
