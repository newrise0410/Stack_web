import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';
import * as emailController from '../controllers/emailController.js';

const router = Router();

router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));
router.get('/analytics', requireAuth, requireAdmin, asyncHandler(adminController.getAnalytics));
router.get('/emails', requireAuth, requireAdmin, asyncHandler(emailController.listAllEmails));
router.get('/members/:id', requireAuth, requireAdmin, asyncHandler(adminController.getMember));

export default router;
