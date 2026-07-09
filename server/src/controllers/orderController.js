import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import UserCoupon from '../models/UserCoupon.js';
import { sendOrderPlaced, sendOrderStatus } from '../services/emailService.js';
import { validateCoupon, computeCoupon } from '../services/couponService.js';
import { applyPoints, EARN_RATE } from '../services/pointService.js';
import PointTransaction from '../models/PointTransaction.js';

const SHIPPING_FEE = 3000;
const FREE_SHIPPING_THRESHOLD = 50000; // 5만원 이상 무료배송

// YYYYMMDD-XXXXXX
function genOrderNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${stamp}-${rand}`;
}

const MAX_ITEM_KINDS = 50; // 한 주문의 상품 종류 상한
const MAX_QTY = 99; // 품목당 수량 상한

// 판매량(salesCount) 가감. sign=+1 주문, -1 취소.
async function adjustSales(items, sign) {
  if (!items?.length) return;
  await Product.bulkWrite(
    items
      .filter((i) => i.product)
      .map((i) => ({
        updateOne: { filter: { _id: i.product }, update: { $inc: { salesCount: sign * i.qty } } },
      })),
  );
}

// 취소 시 혜택 원복 — 쿠폰 복구 + 적립금(사용분 환급·적립분 회수). 실패해도 취소는 성립.
async function reverseOrderBenefits(order) {
  if (order.coupon?.code) {
    await UserCoupon.updateOne(
      { usedOrder: order._id },
      { used: false, usedOrder: null, usedAt: null },
    );
  }
  const pointsUsed = order.amounts?.pointsUsed || 0;
  const userId = order.user?._id || order.user;
  if (pointsUsed > 0) {
    // 사용분 환급 — pointsUsed는 주문 생성 전 실제 차감량이라 그대로 되돌린다
    await applyPoints(userId, pointsUsed, 'refund', { order: order._id, note: `주문 ${order.orderNumber} 취소 환급` });
  }
  // 적립분 회수 — 예정치(order.pointsEarned)가 아니라 "실제 적립된 원장 합계"만 회수한다.
  // (적립 applyPoints는 best-effort라 실패로 미적립일 수 있음. 예정치를 회수하면 적립도 안 됐는데
  //  가입보너스 등 무관한 잔액에서 빼가는 비대칭이 생기므로, 실제 earn 트랜잭션 합만 되돌린다.)
  const earnTxns = await PointTransaction.find({ order: order._id, type: 'earn' }).select('amount');
  const actualEarned = earnTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
  if (actualEarned > 0) {
    // 이미 소진돼 잔액이 모자라면 0까지만 회수 — applyPoints가 클램프
    await applyPoints(userId, -actualEarned, 'reclaim', { order: order._id, note: `주문 ${order.orderNumber} 취소 적립회수` });
  }
}

// 주문 생성 — POST /orders (requireAuth)
// 클라가 보낸 가격은 무시하고 서버가 DB 상품가로 합계를 재계산한다.
export async function createOrder(req, res) {
  const { items, shippingAddress } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: '주문할 상품이 없습니다.' });
  }
  if (items.length > MAX_ITEM_KINDS) {
    return res.status(400).json({ message: '한 번에 주문할 수 있는 상품 종류를 초과했습니다.' });
  }
  if (!shippingAddress?.recipient || !shippingAddress?.address1) {
    return res.status(400).json({ message: '배송지 정보를 입력해주세요.' });
  }

  // 항목 정규화 + 검증 (null·타입오염 방지, 수량 상한)
  const cleanItems = [];
  for (const it of items) {
    if (!it || typeof it.slug !== 'string') {
      return res.status(400).json({ message: '잘못된 주문 항목이 있습니다.' });
    }
    cleanItems.push({
      slug: it.slug,
      qty: Math.min(MAX_QTY, Math.max(1, parseInt(it.qty, 10) || 1)),
      option: it.option != null ? String(it.option).slice(0, 100) : null,
    });
  }

  // status:'active' 인 상품만 주문 가능 (품절/미공개/보관 상품 차단)
  const products = await Product.find({
    slug: { $in: cleanItems.map((i) => i.slug) },
    status: 'active',
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const orderItems = [];
  for (const it of cleanItems) {
    const p = bySlug.get(it.slug);
    if (!p) {
      return res.status(400).json({ message: `현재 구매할 수 없는 상품이 있습니다: ${it.slug}` });
    }
    // 옵션이 있는 상품이면 실제 존재하는 옵션만 허용
    if (it.option && p.options.length > 0 && !p.options.includes(it.option)) {
      return res.status(400).json({ message: `선택할 수 없는 옵션입니다: ${it.option}` });
    }
    orderItems.push({
      product: p._id,
      slug: p.slug,
      name: p.name,
      nameKo: p.nameKo,
      image: p.images?.[0],
      option: it.option || null,
      price: p.price, // ← 서버 권위 가격
      qty: it.qty,
    });
  }

  const itemsTotal = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
  const baseShipping = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;

  // 쿠폰 적용 (서버 권위). 소비는 아래에서 원자적으로 선점한다.
  const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
  let couponDoc = null;
  let couponResult = { itemDiscount: 0, shippingFee: baseShipping, discountTotal: 0 };
  if (couponCode) {
    couponDoc = await Coupon.findOne({ code: couponCode });
    const err = validateCoupon(couponDoc, itemsTotal);
    if (err) return res.status(400).json({ message: err });
    couponResult = computeCoupon(couponDoc, itemsTotal, baseShipping);
  }

  const couponDiscount = couponResult.itemDiscount;
  const shippingFee = couponResult.shippingFee;
  const payableBeforePoints = Math.max(0, itemsTotal - couponDiscount + shippingFee);

  // 쿠폰 원자적 선점 (1인 1회) — 주문 생성 전에 소비 확정.
  // 보유·미사용이면 used로, 미보유면 upsert 생성하며 used. 이미 used면 unique 위반(11000) → 거절.
  let consumedUserCoupon = null;
  if (couponDoc) {
    try {
      consumedUserCoupon = await UserCoupon.findOneAndUpdate(
        { user: req.user._id, coupon: couponDoc._id, used: false },
        { $set: { used: true, usedAt: new Date() }, $setOnInsert: { issuedBy: 'self' } },
        { new: true, upsert: true },
      );
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ message: '이미 사용한 쿠폰입니다.' });
      throw e;
    }
  }

  // 적립금 사용 — 결제금액 이내로 요청 클램프 후 "먼저 원자적으로 차감"하고 실제 차감액을 확정.
  // 스테일 잔액에 의존하지 않아 동시 주문 오버스펜드가 없다(applyPoints가 0까지만 차감).
  const requestedPoints = Math.min(Math.max(0, parseInt(req.body.pointsToUse, 10) || 0), payableBeforePoints);
  let pointsUsed = 0;
  let spendTxnId = null;
  if (requestedPoints > 0) {
    try {
      const r = await applyPoints(req.user._id, -requestedPoints, 'spend', { note: '주문 적립금 사용' });
      if (r) { pointsUsed = -r.amount; spendTxnId = r.txnId; } // r.amount는 음수(실제 차감분)
    } catch {
      pointsUsed = 0; /* 차감 실패 시 미사용 처리 */
    }
  }
  const grandTotal = Math.max(0, payableBeforePoints - pointsUsed);
  const pointsEarned = Math.floor(grandTotal * EARN_RATE); // 결제액의 3% 적립 예정

  const payload = {
    user: req.user._id,
    items: orderItems,
    shippingAddress: {
      recipient: shippingAddress.recipient,
      phone: shippingAddress.phone,
      zipcode: shippingAddress.zipcode,
      address1: shippingAddress.address1,
      address2: shippingAddress.address2,
      deliveryMemo: shippingAddress.deliveryMemo,
    },
    amounts: { itemsTotal, couponDiscount, shippingFee, pointsUsed, grandTotal },
    coupon: { code: couponDoc ? couponCode : '', discount: couponResult.discountTotal },
    pointsEarned,
    status: 'paid', // mock 결제 즉시 완료
    paymentMethod: 'mock',
  };

  // 주문번호 랜덤 충돌(E11000) 시 재시도
  let order;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        order = await Order.create({ ...payload, orderNumber: genOrderNumber() });
        break;
      } catch (e) {
        if (e.code === 11000 && attempt < 3) continue;
        throw e;
      }
    }
  } catch (e) {
    // 주문 생성 실패 → 선점/선차감한 혜택을 원복(사용자가 쿠폰·적립금을 잃지 않게)
    if (consumedUserCoupon) {
      await UserCoupon.updateOne({ _id: consumedUserCoupon._id }, { used: false, usedAt: null }).catch(() => {});
    }
    if (pointsUsed > 0) {
      // 선차감분 환급 + 방금 만든 spend 원장 제거(주문이 없으므로 흔적 남기지 않음)
      await applyPoints(req.user._id, pointsUsed, 'refund', { note: '주문 생성 실패 환급' }).catch(() => {});
      if (spendTxnId) await PointTransaction.deleteOne({ _id: spendTxnId }).catch(() => {});
    }
    throw e;
  }

  // 선점한 쿠폰에 주문 연결 (best-effort — 이미 소비는 확정됨)
  if (consumedUserCoupon) {
    try {
      consumedUserCoupon.usedOrder = order._id;
      await consumedUserCoupon.save();
    } catch {
      /* usedOrder 연결 실패는 주문을 실패시키지 않음 */
    }
  }

  // 적립금 사용분은 주문 생성 전에 이미 선(先)차감됨 — 여기서는 그 원장에 주문만 연결(중복 차감 방지)
  if (spendTxnId) {
    try {
      await PointTransaction.updateOne(
        { _id: spendTxnId },
        { order: order._id, note: `주문 ${order.orderNumber} 사용` },
      );
    } catch { /* 원장 주문 연결 실패는 주문을 실패시키지 않음 */ }
  }
  // 구매 적립 — 실패해도 주문은 성립
  if (pointsEarned > 0) {
    try {
      await applyPoints(req.user._id, pointsEarned, 'earn', { order: order._id, note: `주문 ${order.orderNumber} 적립` });
    } catch { /* 적립 실패 무시 */ }
  }

  // 판매량 반영 (BEST 정렬용 salesCount) — 비핵심이므로 실패해도 주문은 성립시킨다
  try {
    await adjustSales(orderItems, +1);
  } catch {
    /* salesCount 갱신 실패는 주문을 실패시키지 않음 */
  }

  // 주문 접수 메일(목업) — 실패해도 주문은 성립
  try {
    await sendOrderPlaced(order, req.user);
  } catch {
    /* 메일 생성 실패는 주문을 실패시키지 않음 */
  }

  res.status(201).json(order);
}

// 내 주문 목록 — GET /orders (requireAuth)
export async function listMyOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { user: req.user._id };
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 전체 주문 목록 — GET /orders/admin (admin). ?status=&from=&to=&q=&page=&limit=
const ORDER_STATES = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'];
export async function listAllOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

  const filter = {};
  const status = String(req.query.status || '');
  if (ORDER_STATES.includes(status)) filter.status = status;

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  // from/to 모두 서버 로컬(TZ=Asia/Seoul) 하루 경계로 정규화해 기준을 맞춘다
  if (from && !Number.isNaN(from.getTime())) {
    from.setHours(0, 0, 0, 0);
    filter.createdAt = { ...(filter.createdAt || {}), $gte: from };
  }
  if (to && !Number.isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
    filter.createdAt = { ...(filter.createdAt || {}), $lte: to };
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNumber: rx }, { 'shippingAddress.recipient': rx }];
  }

  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 주문 취소 — POST /orders/:id/cancel (본인/admin)
export async function cancelOrder(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (String(order.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  if (!['paid', 'preparing'].includes(order.status)) {
    return res.status(400).json({ message: '이미 배송이 진행되어 취소할 수 없습니다.' });
  }

  // 단일 승자(single-winner) 원자적 전이: paid/preparing → cancelled 를 한 번만 성립시킨다.
  // 동시 취소(더블클릭·본인+관리자)가 각각 read-check-save 하면 혜택원복(환급/회수)이 두 번 돌아
  // 적립금이 중복 환급(무상 지급)되므로, 조건부 findOneAndUpdate 로 경합에서 한 요청만 통과시킨다.
  const cancelled = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ['paid', 'preparing'] } },
    { $set: { status: 'cancelled' } },
    { new: true },
  );
  if (!cancelled) {
    return res.status(409).json({ message: '이미 처리된 주문입니다.' }); // 경합에서 진 요청
  }

  // 판매량 원복 — 실패해도 취소·혜택원복은 계속 진행
  try {
    await adjustSales(cancelled.items, -1);
  } catch {
    /* salesCount 원복 실패 무시 */
  }

  // 쿠폰(·적립금) 원복 — 실패해도 취소는 성립
  try {
    await reverseOrderBenefits(cancelled);
  } catch {
    /* 혜택 원복 실패 무시 */
  }

  // 취소 안내 메일(목업, 주문 소유자 앞) — 실패해도 취소는 성립
  try {
    await cancelled.populate('user', 'name email');
    await sendOrderStatus(cancelled, cancelled.user);
  } catch {
    /* 메일 생성 실패 무시 */
  }
  res.json(cancelled);
}

// 주문 상태 변경 — PATCH /orders/:id/status (admin)
// 허용 전이만 강제하는 상태머신. cancelled는 종료(되돌리기 없음).
const TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'shipped'], // 동일상태 재요청 = 송장 수정용
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(req, res) {
  const next = String(req.body.status || '');
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });

  const prev = order.status; // 실제 상태 전이 여부 판단용
  const allowed = TRANSITIONS[prev] || [];
  if (!allowed.includes(next)) {
    return res.status(400).json({ message: `'${prev}' 상태에서 '${next}'(으)로 변경할 수 없습니다.` });
  }

  // 배송중 전환/송장 수정 시 송장번호 필수
  const setFields = { status: next };
  if (next === 'shipped') {
    const tn = String(req.body.trackingNumber || '').trim();
    if (!tn) return res.status(400).json({ message: '송장번호를 입력해주세요.' });
    setFields.courier = String(req.body.courier || '').trim();
    setFields.trackingNumber = tn;
  }

  // 조건부 원자적 전이: 읽은 시점의 prev 상태일 때만 갱신한다.
  // (비원자적 read-check-save 는 취소↔상태변경 경합에서 lost-update 로 cancelled 를 되살려
  //  혜택원복이 두 번 도는 통로를 열어주므로, prev 로 compare-and-set 해 한 요청만 통과시킨다.)
  const willCancel = next === 'cancelled';
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: prev },
    { $set: setFields },
    { new: true },
  );
  if (!updated) {
    return res.status(409).json({ message: '주문 상태가 이미 변경되었습니다. 다시 시도해주세요.' });
  }

  // 취소 전이 시 판매량 원복 (cancelled는 종료라 재가산 경로 없음) + 쿠폰(·적립금) 원복
  if (willCancel) {
    try {
      await adjustSales(updated.items, -1);
    } catch {
      /* salesCount 원복 실패 무시 */
    }
    try {
      await reverseOrderBenefits(updated);
    } catch {
      /* 혜택 원복 실패 무시 */
    }
  }

  // 응답용 populate + 상태 안내 메일(목업) — 둘 다 실패해도 상태변경은 이미 성립
  // 실제 상태 전이(next!==prev)일 때만 발송: shipped→shipped(송장 수정) 재발송 방지
  try {
    await updated.populate('user', 'name email');
    if (next !== prev && ['shipped', 'delivered', 'cancelled'].includes(next)) {
      await sendOrderStatus(updated, updated.user);
    }
  } catch {
    /* populate/메일 실패는 상태변경을 실패시키지 않음 */
  }
  res.json(updated);
}

// 주문 상세 — GET /orders/:id (requireAuth, 본인/admin)
export async function getOrder(req, res) {
  const order = await Order.findById(req.params.id).populate('user', 'name email');
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  // populate 후 order.user는 객체 → 소유권 비교는 _id로
  const ownerId = order.user?._id || order.user;
  if (String(ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  res.json(order);
}
