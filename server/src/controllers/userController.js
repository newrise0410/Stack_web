import User from '../models/User.js';
import { pick } from '../utils/pick.js';
import { withdrawUser, WithdrawalBlockedError } from '../services/withdrawalService.js';

// 클라이언트가 지정할 수 있는 필드 화이트리스트.
// provider/providerId/role/verified 플래그는 제외 — 소셜계정 선점·권한상승·인증 우회 방지.
const CREATE_FIELDS = [
  'email', 'password', 'name', 'nickname', 'phone',
  'agreements', 'addresses',
];
// birthday·gender는 여기(마이페이지 수정)에만 있고 CREATE_FIELDS엔 없다 — 가입 시 수집하지
// 않는 것이 개인정보 최소수집이고, 램프 배송에 생년월일은 불필요하다. 화이트리스트 분리로
// 코드가 이를 강제한다(POST /users에 birthday를 실어도 pick이 떨군다).
// grade는 어느 쪽에도 없다 — 관리자 전용 라우트로만 바꾼다(본인이 자기 등급을 올릴 수 없게).
const UPDATE_FIELDS = [
  'name', 'nickname', 'phone', 'password', 'agreements', 'addresses',
  'birthday', 'gender',
];

// 회원 생성 공용 로직 — 회원가입(auth)과 관리자 생성(users)에서 공유.
// role/provider는 항상 서버가 강제(권한 상승·소셜 계정 위장 방지).
export async function buildAndSaveUser(body) {
  const data = pick(body, CREATE_FIELDS);
  data.role = 'client';
  data.provider = 'local';
  // 가입 보너스는 실제 셀프 가입(authController.signup)에서만 지급 — 관리자 생성 계정은 제외
  return User.create(data); // save 훅에서 비번 해싱
}

// CREATE — POST /users (관리자용)
export async function createUser(req, res) {
  const user = await buildAndSaveUser(req.body);
  res.status(201).json(user);
}

// READ (list) — GET /users?page=1&limit=20&q=
export async function listUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ email: rx }, { name: rx }, { nickname: rx }];
  }
  // 생년월일·성별은 관리자 목록에서 제외 — 목록은 전 회원의 민감정보가 한 응답에 실리는
  // 최악의 케이스다. 회원 관리에 필요한 정보가 아니라 개인정보 열람을 최소화한다.
  // (심층방어이지 완전한 차단은 아니다 — 이 저장소엔 응답 화이트리스트가 없어
  //  getUser는 여전히 전체 문서를 돌려준다. 본인 조회라 의도된 동작.)
  const [items, total] = await Promise.all([
    User.find(filter).select('-birthday -gender').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
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

// 역할 변경 — PATCH /users/:id/role (admin). 권한 상승은 프로필 수정과 분리.
export async function setUserRole(req, res) {
  const role = String(req.body.role || '');
  if (!['client', 'admin'].includes(role)) {
    return res.status(400).json({ message: '허용되지 않은 역할입니다.' });
  }
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({ message: '본인의 역할은 변경할 수 없습니다.' });
  }
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  res.json(user);
}

// 계정 상태(정지/해제) — PATCH /users/:id/status (admin).
// 회원등급 지정 — ⚠️ 관리자 **수동** 전용이다. 자동 산정 없음(User.js의 grade 주석 참조).
// 적립률은 pointService의 EARN_RATE 일률이며 등급과 연결돼 있지 않다.
// 본인 제한을 두지 않는 이유: role·status와 달리 등급은 권한이 아니라 라벨이라
// 관리자가 자기 등급을 바꿔도 얻는 권한이 없다.
export async function setUserGrade(req, res) {
  const grade = String(req.body.grade || '');
  if (!['basic', 'silver', 'gold'].includes(grade)) {
    return res.status(400).json({ message: '허용되지 않은 등급입니다.' });
  }
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, status: { $ne: 'withdrawn' } }, // 탈퇴 tombstone은 건드리지 않는다
    { grade },
    { new: true },
  );
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  res.json(user);
}

export async function setUserStatus(req, res) {
  const status = String(req.body.status || '');
  // ⚠️ 'withdrawn'을 여기서 허용하지 말 것 — 파기 절차 없이 PII가 남은 좀비 문서가 된다.
  //    탈퇴는 DELETE /users/:id(withdrawalService) 경로 전용이다.
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ message: '허용되지 않은 상태입니다.' });
  }
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({ message: '본인 계정은 정지할 수 없습니다.' });
  }
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  res.json(user);
}

// DELETE — DELETE /users/:id
// 회원 탈퇴. 문서를 지우지 않고 PII만 파기한 tombstone으로 전환한다 — Order.user가 required라
// 하드 삭제는 주문·리뷰·적립금 참조를 고아로 만들고, 전자상거래법상 5년 보관 의무와도 충돌한다.
// 자세한 근거는 services/withdrawalService.js 상단 주석 참조.
export async function deleteUser(req, res) {
  try {
    const user = await withdrawUser(req.params.id);
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    return res.status(204).end();
  } catch (e) {
    if (e instanceof WithdrawalBlockedError) {
      return res.status(e.status).json({ message: e.message });
    }
    throw e;
  }
}
