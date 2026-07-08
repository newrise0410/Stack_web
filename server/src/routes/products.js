import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as productController from '../controllers/productController.js';

const router = Router();

// 공개 조회
router.get('/', asyncHandler(productController.listProducts));
// 관리용 전체 목록 (:slug 보다 먼저 등록해야 함)
router.get('/admin', requireAuth, requireAdmin, asyncHandler(productController.listAllProducts));
router.get('/:slug', asyncHandler(productController.getProduct));

// 관리자 전용
router.post('/', requireAuth, requireAdmin, asyncHandler(productController.createProduct));
router.patch('/:slug', requireAuth, requireAdmin, asyncHandler(productController.updateProduct));
router.delete('/:slug', requireAuth, requireAdmin, asyncHandler(productController.deleteProduct));

export default router;
