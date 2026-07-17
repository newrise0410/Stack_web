import User from '../models/User.js';
import PointTransaction from '../models/PointTransaction.js';
import { applyPoints } from '../services/pointService.js';

const TYPE_LABEL = {
  signup: '가입 적립',
  earn: '구매 적립',
  spend: '사용',
  reclaim: '취소 회수',
  refund: '취소 환급',
  admin_adjust: '관리자 조정',
  withdraw: '탈퇴 소멸',
};

// GET /points/me?page=&limit= — 내 잔액 + 내역
export async function getMyPoints(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const user = await User.findById(req.user._id).select('points');
  const filter = { user: req.user._id };
  // _id 보조정렬로 안정 정렬 — 같은 createdAt 다수 시 페이지 경계 중복/누락 방지
  const [items, total] = await Promise.all([
    PointTransaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    PointTransaction.countDocuments(filter),
  ]);
  res.json({ balance: user?.points || 0, page, limit, total, items });
}

// POST /admin/members/:id/points { amount, note } — 관리자 수동 지급/차감
export async function adjustMemberPoints(req, res) {
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({ message: '조정할 적립금(0이 아닌 정수)을 입력해주세요.' });
  }
  const target = await User.findById(req.params.id).select('_id');
  if (!target) return res.status(404).json({ message: '회원을 찾을 수 없습니다.' });
  const note = String(req.body.note || '').slice(0, 200) || '관리자 조정';
  const result = await applyPoints(target._id, amount, 'admin_adjust', { note });
  // applied: 0 클램프 반영된 실제 증감량 — 클라가 "정말 반영됐는지"로 안내문구를 정한다
  res.json({ balance: result?.balance || 0, applied: result?.amount || 0 });
}

export { TYPE_LABEL };
