import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as couponController from '../controllers/couponController.js';

const router = Router();

router.get('/me', requireAuth, asyncHandler(couponController.listMyCoupons));
router.get('/available', requireAuth, asyncHandler(couponController.listAvailableForOrder));
router.post('/claim', requireAuth, asyncHandler(couponController.claimCoupon));

export default router;
