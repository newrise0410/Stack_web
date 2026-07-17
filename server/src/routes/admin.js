import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as adminController from '../controllers/adminController.js';
import * as emailController from '../controllers/emailController.js';
import * as couponController from '../controllers/couponController.js';
import * as pointController from '../controllers/pointController.js';
import * as uploadController from '../controllers/uploadController.js';

const router = Router();

// 이미지 업로드용 multer(메모리 버퍼, 5MB 제한). 멀티파트 에러는 400으로 정규화.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '이미지는 5MB 이하만 업로드할 수 있습니다.' });
      }
      return res.status(400).json({ message: '이미지 업로드 처리 중 오류가 발생했습니다.' });
    }
    return next();
  });
}

router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));
router.get('/analytics', requireAuth, requireAdmin, asyncHandler(adminController.getAnalytics));

// 운영 상태 — 조용히 쌓이던 실패를 한곳에서 감지·복구
router.get('/ops', requireAuth, requireAdmin, asyncHandler(adminController.getOps));
router.get('/events', requireAuth, requireAdmin, asyncHandler(adminController.listEvents));
router.post('/events/:id/requeue', requireAuth, requireAdmin, asyncHandler(adminController.requeueEvent));
router.get('/emails', requireAuth, requireAdmin, asyncHandler(emailController.listAllEmails));

// 쿠폰 관리
router.get('/coupons', requireAuth, requireAdmin, asyncHandler(couponController.listCoupons));
router.post('/coupons', requireAuth, requireAdmin, asyncHandler(couponController.createCoupon));
router.patch('/coupons/:id', requireAuth, requireAdmin, asyncHandler(couponController.updateCoupon));
router.delete('/coupons/:id', requireAuth, requireAdmin, asyncHandler(couponController.deleteCoupon));
router.post('/members/:id/coupons', requireAuth, requireAdmin, asyncHandler(couponController.issueToMember));
router.post('/members/:id/points', requireAuth, requireAdmin, asyncHandler(pointController.adjustMemberPoints));

router.get('/members/:id', requireAuth, requireAdmin, asyncHandler(adminController.getMember));

// 업로드 남용 방지: 관리자당 분당 20회(탈취 토큰의 free-tier 소진·메모리 압박 차단). requireAuth 뒤라 user id로 키.
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req) => String(req.user?._id || req.ip),
  message: '이미지 업로드가 너무 잦습니다. 잠시 후 다시 시도해주세요.',
});
router.post('/uploads', requireAuth, requireAdmin, uploadLimiter, uploadSingle, asyncHandler(uploadController.uploadImage));

export default router;
