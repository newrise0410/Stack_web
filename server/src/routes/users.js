import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin, requireSelfOrAdmin } from '../middleware/auth.js';
import * as userController from '../controllers/userController.js';

const router = Router();

// 공개 회원가입은 POST /auth/signup 사용. 여기 POST는 관리자용 생성.
router.post('/', requireAuth, requireAdmin, asyncHandler(userController.createUser));
router.get('/', requireAuth, requireAdmin, asyncHandler(userController.listUsers));

router.get('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.getUser));
router.patch('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.updateUser));
router.delete('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.deleteUser));

export default router;
