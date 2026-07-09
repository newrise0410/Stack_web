import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as emailController from '../controllers/emailController.js';

const router = Router();

// 내 받은메일함
router.get('/me', requireAuth, asyncHandler(emailController.listMyEmails));

export default router;
