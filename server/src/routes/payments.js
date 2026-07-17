import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as paymentController from '../controllers/paymentController.js';

const router = Router();

router.post(
  '/complete',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20, key: (req) => String(req.user?._id || req.ip), message: '결제 확인 요청이 너무 많습니다.' }),
  asyncHandler(paymentController.completePayment),
);

// 포트원 서버가 호출 — 무인증(검증은 API 재조회로). IP 기준 제한.
router.post(
  '/webhook',
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(paymentController.portoneWebhook),
);

export default router;
