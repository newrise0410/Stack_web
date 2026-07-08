import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import * as wishlistController from '../controllers/wishlistController.js';

const router = Router();

router.get('/', requireAuth, asyncHandler(wishlistController.getWishlist));
router.post('/:slug', requireAuth, asyncHandler(wishlistController.toggleWishlist));

export default router;
