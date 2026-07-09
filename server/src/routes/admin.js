import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';

const router = Router();

router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));
router.get('/analytics', requireAuth, requireAdmin, asyncHandler(adminController.getAnalytics));
router.get('/members/:id', requireAuth, requireAdmin, asyncHandler(adminController.getMember));

export default router;
