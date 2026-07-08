import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as reviewController from '../controllers/reviewController.js';

const router = Router();

// 관리자 (:id 보다 먼저)
router.get('/admin', requireAuth, requireAdmin, asyncHandler(reviewController.listAllReviews));
router.patch('/:id/hidden', requireAuth, requireAdmin, asyncHandler(reviewController.setReviewHidden));

router.delete('/:id', requireAuth, asyncHandler(reviewController.deleteReview));

export default router;
