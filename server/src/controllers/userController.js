import User from '../models/User.js';
import { pick } from '../utils/pick.js';

// 클라이언트가 지정할 수 있는 필드 화이트리스트.
// provider/providerId/role/verified 플래그는 제외 — 소셜계정 선점·권한상승·인증 우회 방지.
const CREATE_FIELDS = [
  'email', 'password', 'name', 'nickname', 'phone',
  'agreements', 'addresses',
];
const UPDATE_FIELDS = [
  'name', 'nickname', 'phone', 'password', 'agreements', 'addresses',
];

// 회원 생성 공용 로직 — 회원가입(auth)과 관리자 생성(users)에서 공유.
// role/provider는 항상 서버가 강제(권한 상승·소셜 계정 위장 방지).
export async function buildAndSaveUser(body) {
  const data = pick(body, CREATE_FIELDS);
  data.role = 'client';
  data.provider = 'local';
  return User.create(data); // save 훅에서 비번 해싱
}

// CREATE — POST /users (관리자용)
export async function createUser(req, res) {
  const user = await buildAndSaveUser(req.body);
  res.status(201).json(user);
}

// READ (list) — GET /users?page=1&limit=20
export async function listUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const [items, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(),
  ]);
  res.json({ page, limit, total, items });
}

// READ (one) — GET /users/:id
export async function getUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  res.json(user);
}

// UPDATE — PATCH /users/:id  (email·role은 변경 불가)
export async function updateUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  Object.assign(user, pick(req.body, UPDATE_FIELDS));
  await user.save(); // 검증·비번 해싱·updatedAt 갱신
  res.json(user);
}

// DELETE — DELETE /users/:id
export async function deleteUser(req, res) {
  const removed = await User.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  res.status(204).end();
}
