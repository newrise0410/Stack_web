import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';

const router = Router();

router.post('/signup', asyncHandler(authController.signup));
router.post('/login', asyncHandler(authController.login));
router.post('/social', asyncHandler(authController.socialLogin));
router.get('/me', requireAuth, asyncHandler(authController.me));

export default router;
