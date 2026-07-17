import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as orderController from '../controllers/orderController.js';
import * as orderBulkController from '../controllers/orderBulkController.js';

const router = Router();

router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10, key: (req) => String(req.user?._id || req.ip), message: '주문 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }),
  asyncHandler(orderController.createOrder),
);
router.get('/', requireAuth, asyncHandler(orderController.listMyOrders));
// 일괄 처리 (:id 라우트보다 먼저)
router.post('/bulk/status', requireAuth, requireAdmin, asyncHandler(orderBulkController.bulkStatus));
router.post('/bulk/tracking', requireAuth, requireAdmin, asyncHandler(orderBulkController.bulkTracking));
// 관리용 (:id 보다 먼저) — 더 구체적인 경로가 먼저
router.get('/admin/counts', requireAuth, requireAdmin, asyncHandler(orderController.getOrderCounts));
router.get('/admin/production-summary', requireAuth, requireAdmin, asyncHandler(orderController.getProductionSummary));
router.get('/admin/batch', requireAuth, requireAdmin, asyncHandler(orderController.getOrdersBatch));
router.get('/admin', requireAuth, requireAdmin, asyncHandler(orderController.listAllOrders));
router.post('/:id/cancel', requireAuth, asyncHandler(orderController.cancelOrder));
router.patch('/:id/status', requireAuth, requireAdmin, asyncHandler(orderController.updateOrderStatus));
router.get('/:id', requireAuth, asyncHandler(orderController.getOrder));

export default router;
