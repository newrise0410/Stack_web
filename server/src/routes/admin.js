import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';
import * as emailController from '../controllers/emailController.js';
import * as couponController from '../controllers/couponController.js';

const router = Router();

router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));
router.get('/analytics', requireAuth, requireAdmin, asyncHandler(adminController.getAnalytics));
router.get('/emails', requireAuth, requireAdmin, asyncHandler(emailController.listAllEmails));

// 쿠폰 관리
router.get('/coupons', requireAuth, requireAdmin, asyncHandler(couponController.listCoupons));
router.post('/coupons', requireAuth, requireAdmin, asyncHandler(couponController.createCoupon));
router.patch('/coupons/:id', requireAuth, requireAdmin, asyncHandler(couponController.updateCoupon));
router.delete('/coupons/:id', requireAuth, requireAdmin, asyncHandler(couponController.deleteCoupon));
router.post('/members/:id/coupons', requireAuth, requireAdmin, asyncHandler(couponController.issueToMember));

router.get('/members/:id', requireAuth, requireAdmin, asyncHandler(adminController.getMember));

export default router;
