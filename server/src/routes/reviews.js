import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as reviewController from '../controllers/reviewController.js';

const router = Router();

router.delete('/:id', requireAuth, asyncHandler(reviewController.deleteReview));

export default router;
