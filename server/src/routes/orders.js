import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as orderController from '../controllers/orderController.js';

const router = Router();

router.post('/', requireAuth, asyncHandler(orderController.createOrder));
router.get('/', requireAuth, asyncHandler(orderController.listMyOrders));
// 관리용 (:id 보다 먼저)
router.get('/admin', requireAuth, requireAdmin, asyncHandler(orderController.listAllOrders));
router.post('/:id/cancel', requireAuth, asyncHandler(orderController.cancelOrder));
router.patch('/:id/status', requireAuth, requireAdmin, asyncHandler(orderController.updateOrderStatus));
router.get('/:id', requireAuth, asyncHandler(orderController.getOrder));

export default router;
