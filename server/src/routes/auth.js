import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as authController from '../controllers/authController.js';

const router = Router();

// 인증 시도 남용 방지(무차별 대입·자동가입) — (신원)+IP당 분당 15회. trust proxy로 실제 IP 기준.
// 키를 순수 IP로 잡으면 CGNAT/사내 NAT처럼 공인 IP를 공유하는 무관한 사용자끼리 한 버킷을 나눠
// 써 정상 로그인이 잠긴다. 그래서 email(로그인·가입)/deviceId(소셜)을 IP와 결합해 신원별로 버킷을
// 분리한다. email 단독 키는 특정 계정 표적 잠금(DoS)을 열므로 반드시 IP와 함께 쓴다.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  key: (req) => {
    const id = String(req.body?.email || req.body?.deviceId || '').trim().toLowerCase();
    return id ? `${id}|${req.ip}` : req.ip;
  },
  message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
});

router.post('/signup', authLimiter, asyncHandler(authController.signup));
router.post('/login', authLimiter, asyncHandler(authController.login));
router.post('/social', authLimiter, asyncHandler(authController.socialLogin));
router.get('/me', requireAuth, asyncHandler(authController.me));

export default router;
