import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';

const router = Router();

router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));

export default router;
