import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin, requireSelfOrAdmin } from '../middleware/auth.js';
import * as userController from '../controllers/userController.js';

const router = Router();

// 공개 회원가입은 POST /auth/signup 사용. 여기 POST는 관리자용 생성.
router.post('/', requireAuth, requireAdmin, asyncHandler(userController.createUser));
router.get('/', requireAuth, requireAdmin, asyncHandler(userController.listUsers));

// 관리자 전용 (권한 상승/정지는 프로필 수정과 분리, :id 보다 구체 경로라 먼저)
router.patch('/:id/role', requireAuth, requireAdmin, asyncHandler(userController.setUserRole));
router.patch('/:id/status', requireAuth, requireAdmin, asyncHandler(userController.setUserStatus));
// 등급은 관리자 수동 지정 전용 — UPDATE_FIELDS에 없어 본인이 PATCH /:id로 올릴 수 없다.
router.patch('/:id/grade', requireAuth, requireAdmin, asyncHandler(userController.setUserGrade));

router.get('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.getUser));
router.patch('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.updateUser));
router.delete('/:id', requireAuth, requireSelfOrAdmin(), asyncHandler(userController.deleteUser));

export default router;
