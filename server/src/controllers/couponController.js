import Coupon from '../models/Coupon.js';
import UserCoupon from '../models/UserCoupon.js';
import User from '../models/User.js';
import { validateCoupon, computeCoupon } from '../services/couponService.js';

const TYPES = ['fixed', 'percent', 'free_shipping'];
const SHIPPING_FEE = 3000;
const FREE_SHIPPING_THRESHOLD = 50000;

function couponFromBody(body) {
  const discountType = TYPES.includes(body.discountType) ? body.discountType : 'fixed';
  return {
    code: String(body.code || '').trim().toUpperCase(),
    name: String(body.name || '').trim(),
    discountType,
    discountValue: Math.max(0, parseInt(body.discountValue, 10) || 0),
    maxDiscount: Math.max(0, parseInt(body.maxDiscount, 10) || 0),
    minOrderAmount: Math.max(0, parseInt(body.minOrderAmount, 10) || 0),
    // 'YYYY-MM-DD'를 KST 그날의 끝(23:59:59)으로 저장 → UTC 자정 파싱으로 인한 하루 조기 만료 방지
    expiresAt: body.expiresAt ? new Date(`${String(body.expiresAt).slice(0, 10)}T23:59:59+09:00`) : null,
    active: body.active !== false,
  };
}

// create/update 공통 값 검증. 통과하면 null, 실패하면 사유 메시지.
function validateCouponData(data) {
  if (!data.code) return '쿠폰 코드를 입력해주세요.';
  if (!data.name) return '쿠폰 이름을 입력해주세요.';
  if (data.discountType === 'fixed' && data.discountValue <= 0) return '할인 금액을 입력해주세요.';
  if (data.discountType === 'percent' && (data.discountValue <= 0 || data.discountValue > 100)) {
    return '할인율은 1~100 사이여야 합니다.';
  }
  return null;
}

// ── 관리자 ─────────────────────────────────────────────────

// GET /admin/coupons
export async function listCoupons(req, res) {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json({ items: coupons });
}

// POST /admin/coupons
export async function createCoupon(req, res) {
  const data = couponFromBody(req.body);
  const err = validateCouponData(data);
  if (err) return res.status(400).json({ message: err });
  try {
    const coupon = await Coupon.create(data);
    res.status(201).json(coupon);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: '이미 존재하는 쿠폰 코드입니다.' });
    throw e;
  }
}

// PATCH /admin/coupons/:id
export async function updateCoupon(req, res) {
  const data = couponFromBody(req.body);
  const err = validateCouponData(data);
  if (err) return res.status(400).json({ message: err });
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ message: '쿠폰을 찾을 수 없습니다.' });
    res.json(coupon);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: '이미 존재하는 쿠폰 코드입니다.' });
    throw e;
  }
}

// DELETE /admin/coupons/:id
export async function deleteCoupon(req, res) {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return res.status(404).json({ message: '쿠폰을 찾을 수 없습니다.' });
  res.status(204).end();
}

// POST /admin/members/:id/coupons { couponId } — 회원에게 발급
export async function issueToMember(req, res) {
  const user = await User.findById(req.params.id).select('_id');
  if (!user) return res.status(404).json({ message: '회원을 찾을 수 없습니다.' });
  const coupon = await Coupon.findById(req.body.couponId).select('_id');
  if (!coupon) return res.status(404).json({ message: '쿠폰을 찾을 수 없습니다.' });
  try {
    const uc = await UserCoupon.create({ user: user._id, coupon: coupon._id, issuedBy: 'admin' });
    res.status(201).json(uc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: '이미 보유한 쿠폰입니다.' });
    throw e;
  }
}

// ── 사용자 ─────────────────────────────────────────────────

// GET /coupons/me — 보유/사용 목록
export async function listMyCoupons(req, res) {
  const items = await UserCoupon.find({ user: req.user._id })
    .populate('coupon')
    .sort({ used: 1, createdAt: -1 });
  // 정의가 삭제된 쿠폰(coupon=null)은 제외
  res.json({ items: items.filter((uc) => uc.coupon) });
}

// POST /coupons/claim { code } — 코드로 쿠폰 획득
export async function claimCoupon(req, res) {
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ message: '쿠폰 코드를 입력해주세요.' });
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.active) return res.status(404).json({ message: '유효하지 않은 쿠폰 코드입니다.' });
  if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) {
    return res.status(400).json({ message: '만료된 쿠폰입니다.' });
  }
  try {
    const uc = await UserCoupon.create({ user: req.user._id, coupon: coupon._id, issuedBy: 'self' });
    res.status(201).json(await uc.populate('coupon'));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: '이미 보유한 쿠폰입니다.' });
    throw e;
  }
}

// GET /coupons/available?itemsTotal= — 체크아웃 적용 가능 목록(할인 계산 포함)
export async function listAvailableForOrder(req, res) {
  const itemsTotal = Math.max(0, parseInt(req.query.itemsTotal, 10) || 0);
  const baseShipping = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const held = await UserCoupon.find({ user: req.user._id, used: false }).populate('coupon');
  const now = new Date();
  const items = held
    .filter((uc) => uc.coupon)
    .map((uc) => {
      const reason = validateCoupon(uc.coupon, itemsTotal, now);
      const calc = reason ? null : computeCoupon(uc.coupon, itemsTotal, baseShipping);
      return {
        code: uc.coupon.code,
        name: uc.coupon.name,
        discountType: uc.coupon.discountType,
        applicable: !reason,
        reason,
        discountTotal: calc ? calc.discountTotal : 0,
      };
    });
  res.json({ items });
}
