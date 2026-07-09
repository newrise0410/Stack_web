import EmailMessage from '../models/EmailMessage.js';

const TYPES = ['order_placed', 'order_status'];

// 관리자 전체 목록 — GET /admin/emails?type=&page=&limit= (admin)
export async function listAllEmails(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  const type = String(req.query.type || '');
  if (TYPES.includes(type)) filter.type = type;

  const [items, total] = await Promise.all([
    EmailMessage.find(filter)
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    EmailMessage.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 내 받은메일함 — GET /emails/me?page=&limit= (requireAuth)
export async function listMyEmails(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { user: req.user._id };

  const [items, total] = await Promise.all([
    EmailMessage.find(filter)
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    EmailMessage.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}
