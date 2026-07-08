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
