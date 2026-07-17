import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import UserCoupon from '../models/UserCoupon.js';
import { sendOrderPlaced, sendOrderStatus } from '../services/emailService.js';
import { validateCoupon, computeCoupon } from '../services/couponService.js';
import { applyPoints, EARN_RATE } from '../services/pointService.js';
import { adjustSales } from '../services/salesService.js';
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

// 취소 시 혜택 원복 — 쿠폰 복구 + 적립금(사용분 환급·적립분 회수).
// 멱등(refund/reclaim 원장 존재 시 재실행 안 함)하므로 부분 실패 후 안전하게 재수렴 가능.
// 모든 단계 성공 시에만 order.benefitsReversed=true 확정 — 중간 실패는 flag=false로 남아 재시도 대상.
async function reverseOrderBenefits(order) {
  if (order.benefitsReversed) return; // 이미 원복 완료
  const userId = order.user?._id || order.user;

  // 쿠폰 복구 (used:false 세팅이라 재실행 안전)
  if (order.coupon?.code) {
    await UserCoupon.updateOne(
      { usedOrder: order._id },
      { used: false, usedOrder: null, usedAt: null },
    );
  }
  // 사용분 환급 — 이미 환급 원장이 있으면 재환급 금지(멱등). pointsUsed는 생성 전 실제 차감량.
  const pointsUsed = order.amounts?.pointsUsed || 0;
  if (pointsUsed > 0 && !(await PointTransaction.exists({ order: order._id, type: 'refund' }))) {
    await applyPoints(userId, pointsUsed, 'refund', { order: order._id, note: `주문 ${order.orderNumber} 취소 환급` });
  }
  // 적립분 회수 — 예정치가 아니라 "실제 적립된 원장 합계"만, 이미 회수 원장이 있으면 재회수 금지(멱등).
  const earnTxns = await PointTransaction.find({ order: order._id, type: 'earn' }).select('amount');
  const actualEarned = earnTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
  if (actualEarned > 0 && !(await PointTransaction.exists({ order: order._id, type: 'reclaim' }))) {
    await applyPoints(userId, -actualEarned, 'reclaim', { order: order._id, note: `주문 ${order.orderNumber} 취소 적립회수` });
  }
  // 모든 원복 단계가 성공했을 때만 플래그 확정
  await Order.updateOne({ _id: order._id }, { $set: { benefitsReversed: true } });
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

  // 멱등키(재시도 방어): 같은 사용자+키의 주문이 이미 있으면 부작용 없이 그 주문을 반환한다.
  // (응답 유실 후 동일 요청 재시도 시 중복 주문·중복 적립/판매 방지 — 부작용 실행 전에 선차단)
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim().slice(0, 100) || null;
  if (idempotencyKey) {
    const existing = await Order.findOne({ user: req.user._id, idempotencyKey });
    if (existing) return res.status(200).json(existing);
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
    // 옵션이 있는 상품은 유효 옵션을 반드시 지정해야 한다(누락·비유효 모두 거절)
    if (p.options.length > 0 && (!it.option || !p.options.includes(it.option))) {
      return res.status(400).json({ message: `옵션을 선택해주세요: ${p.nameKo || p.name}` });
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
      if (e.code === 11000) {
        // 동시 중복요청(같은 멱등키)에서 쿠폰 선점 패자가 여기 도달할 수 있다. 승자 주문이 이미
        // 있으면 '이미 사용한 쿠폰' 400 대신 그 주문으로 멱등 수렴시킨다(초입 findOne을 이 경합
        // 지점에도 복제). 아직 승자 주문 생성 전인 좁은 창이면 400이 나가되, 재시도 시 초입에서 수렴.
        if (idempotencyKey) {
          const existing = await Order.findOne({ user: req.user._id, idempotencyKey });
          if (existing) return res.status(200).json(existing);
        }
        return res.status(400).json({ message: '이미 사용한 쿠폰입니다.' });
      }
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
    idempotencyKey,
    status: 'paid', // mock 결제 즉시 완료
    paymentMethod: 'mock',
  };

  // 이 요청이 선차감/선점한 혜택을 원복한다(주문 생성 실패·중복 감지 공통 정리)
  const refundReservedBenefits = async (note) => {
    if (consumedUserCoupon) {
      await UserCoupon.updateOne({ _id: consumedUserCoupon._id }, { used: false, usedAt: null }).catch(() => {});
    }
    if (pointsUsed > 0) {
      await applyPoints(req.user._id, pointsUsed, 'refund', { note }).catch(() => {});
      if (spendTxnId) await PointTransaction.deleteOne({ _id: spendTxnId }).catch(() => {});
    }
  };

  // 주문번호 랜덤 충돌(E11000) 시 재시도
  let order;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        order = await Order.create({ ...payload, orderNumber: genOrderNumber() });
        break;
      } catch (e) {
        // 동시 중복 요청(같은 멱등키) — 승자 주문을 반환하고 이 요청의 선차감분은 원복
        if (e.code === 11000 && e.keyPattern?.idempotencyKey && idempotencyKey) {
          const existing = await Order.findOne({ user: req.user._id, idempotencyKey });
          if (existing) {
            await refundReservedBenefits('중복 주문 취소 환급');
            return res.status(200).json(existing);
          }
        }
        if (e.code === 11000 && attempt < 3) continue; // orderNumber 충돌 → 재시도
        throw e;
      }
    }
  } catch (e) {
    // 주문 생성 실패 → 선점/선차감한 혜택을 원복(사용자가 쿠폰·적립금을 잃지 않게)
    await refundReservedBenefits('주문 생성 실패 환급');
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
  // 구매 적립은 여기서 지급하지 않고 배송완료(delivered) 전이 시점에 확정한다(updateOrderStatus).
  // 생성 즉시 적립하면, 그 적립분을 다른 주문에 사용한 뒤 이 주문을 취소할 때 회수가 0으로
  // 클램프되어 혜택이 영구히 남는 누수가 생기기 때문(적립은 배송확정 후에만 소진 가능해야 함).

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
  // 이미 취소됐지만 혜택 원복이 미완(부분 실패)이면 멱등 재실행으로 재수렴시킨다 — in-app 복구 경로.
  if (order.status === 'cancelled') {
    if (order.benefitsReversed) {
      return res.status(400).json({ message: '이미 취소된 주문입니다.' });
    }
    try {
      await reverseOrderBenefits(order);
    } catch (e) {
      console.error('[cancelOrder] 혜택 원복 재시도 실패:', order.orderNumber, e?.message);
    }
    const refreshed = await Order.findById(order._id).populate('user', 'name email');
    return res.json(refreshed);
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

  // 쿠폰(·적립금) 원복 — 실패해도 취소는 성립(멱등이라 재시도로 재수렴). 삼키지 말고 로깅.
  try {
    await reverseOrderBenefits(cancelled);
  } catch (e) {
    console.error('[cancelOrder] 혜택 원복 실패:', cancelled.orderNumber, e?.message);
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
  delivered: ['delivered'], // 동일상태 재요청 = 적립 지급 재시도용(멱등, 이메일 재발송 없음)
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
    } catch (e) {
      console.error('[updateOrderStatus] 혜택 원복 실패:', updated.orderNumber, e?.message);
    }
  }

  // 배송완료 전이 시 구매 적립 확정 지급 — 멱등(이미 적립 원장이 있으면 재지급 안 함).
  // 생성 시점이 아닌 배송완료 시점에 적립해야, 취소 가능한 주문의 적립분 누수를 원천 차단한다.
  // 지급 순간 일시 장애로 실패해도 delivered→delivered 재요청으로 다시 태울 수 있고(멱등),
  // 동시 재요청은 {order,type:earn} unique 로 직렬화되어 이중 적립되지 않는다.
  if (next === 'delivered' && updated.pointsEarned > 0) {
    try {
      const earned = await PointTransaction.exists({ order: updated._id, type: 'earn' });
      if (!earned) {
        await applyPoints(updated.user?._id || updated.user, updated.pointsEarned, 'earn', {
          order: updated._id, note: `주문 ${updated.orderNumber} 적립`,
        });
      }
    } catch (e) {
      console.error('[updateOrderStatus] 적립 지급 실패:', updated.orderNumber, e?.message);
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
