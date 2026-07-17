import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';

// Authorization: Bearer <token> 검증 → req.user에 사용자 첨부
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: '로그인이 필요합니다.' });

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
    // 정지 계정은 기존 토큰이 남아 있어도 실시간 차단 (로그인 차단만으론 최대 만료까지 유효)
    if (user.status === 'suspended') {
      return res.status(403).json({ message: '정지된 계정입니다. 고객센터에 문의해주세요.' });
    }
    // 탈퇴 계정도 같은 이유로 실시간 차단 — 탈퇴 직전 발급된 JWT가 최대 7일 살아 있다.
    // 401(403 아님)인 이유: 계정이 더는 존재하지 않는다는 의미이고, 클라의 401 인터셉터가
    // 토큰을 정리하고 로그인 화면으로 보낸다.
    if (user.status === 'withdrawn') {
      return res.status(401).json({ message: '탈퇴한 계정입니다.' });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
}

// admin 전용
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '권한이 없습니다.' });
  }
  return next();
}

// 본인 또는 admin만 허용 (:id 파라미터 기준)
export function requireSelfOrAdmin(param = 'id') {
  return (req, res, next) => {
    if (req.user.role === 'admin' || String(req.user._id) === req.params[param]) {
      return next();
    }
    return res.status(403).json({ message: '권한이 없습니다.' });
  };
}
