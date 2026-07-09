import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as pointController from '../controllers/pointController.js';

const router = Router();

router.get('/me', requireAuth, asyncHandler(pointController.getMyPoints));

export default router;
