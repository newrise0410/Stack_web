import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as productController from '../controllers/productController.js';

const router = Router();

// 공개 조회
router.get('/', asyncHandler(productController.listProducts));
router.get('/:slug', asyncHandler(productController.getProduct));

// 관리자 전용
router.post('/', requireAuth, requireAdmin, asyncHandler(productController.createProduct));
router.patch('/:slug', requireAuth, requireAdmin, asyncHandler(productController.updateProduct));
router.delete('/:slug', requireAuth, requireAdmin, asyncHandler(productController.deleteProduct));

export default router;
