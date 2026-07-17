import crypto from 'node:crypto';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import UserCoupon from '../models/UserCoupon.js';
import { sendOrderPlaced, sendOrderStatus } from '../services/emailService.js';
import { validateCoupon, computeCoupon } from '../services/couponService.js';
import { applyPoints, EARN_RATE } from '../services/pointService.js';
import { adjustSales } from '../services/salesService.js';
import PointTransaction from '../models/PointTransaction.js';
import { withTransaction } from '../utils/withTransaction.js';
import { httpError } from '../utils/httpError.js';
import { enqueueEvents, buildPaidEvents } from '../services/orderEventService.js';
import { ensurePrepared } from '../services/checkoutService.js';
import * as portone from '../services/portoneService.js';

const SHIPPING_FEE = 3000;
const FREE_SHIPPING_THRESHOLD = 50000; // 5만원 이상 무료배송
const MIN_CARD_AMOUNT = 100; // 카드 최소 결제금액(원)
const PENDING_TTL_MS = 30 * 60 * 1000; // 미결제 pending 만료
const MAX_ACTIVE_PENDING = 3; // 사용자별 활성 pending 상한

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
// 주문 insert + 쿠폰 소진 + 포인트 차감을 한 트랜잭션으로 묶고(부분 실패 없음),
// grandTotal>0이면 status:'pending'으로 만들어 포트원 사전등록 후 결제창 DTO를 반환한다.
// grandTotal===0(포인트 전액)이면 PG 없이 즉시 paid.
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

  // 결제 주문은 멱등키 필수 — 결제창·검증·재시도 전 구간의 기준 키.
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim().slice(0, 100) || null;
  if (!idempotencyKey) {
    return res.status(400).json({ message: '멱등키(Idempotency-Key)가 필요합니다. 새로고침 후 다시 시도해주세요.' });
  }

  // 같은 키 + 다른 본문 재사용 감지용 해시
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({ items, couponCode: req.body.couponCode || '', pointsToUse: req.body.pointsToUse || 0, shippingAddress }))
    .digest('hex');

  const existing = await Order.findOne({ user: req.user._id, idempotencyKey });
  if (existing) return respondExistingOrder(res, existing, requestHash);

  // 미결제 pending 폭주 방지(쿠폰·포인트 잠금 남용 차단)
  const activePending = await Order.countDocuments({ user: req.user._id, status: 'pending', 'payment.provider': 'portone' });
  if (activePending >= MAX_ACTIVE_PENDING) {
    return res.status(429).json({ message: '결제가 완료되지 않은 주문이 많습니다. 마이페이지에서 정리 후 다시 시도해주세요.' });
  }

  // 항목 정규화 + 검증 (기존과 동일)
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

  const products = await Product.find({ slug: { $in: cleanItems.map((i) => i.slug) }, status: 'active' });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const orderItems = [];
  for (const it of cleanItems) {
    const p = bySlug.get(it.slug);
    if (!p) return res.status(400).json({ message: `현재 구매할 수 없는 상품이 있습니다: ${it.slug}` });
    if (p.options.length > 0 && (!it.option || !p.options.includes(it.option))) {
      return res.status(400).json({ message: `옵션을 선택해주세요: ${p.nameKo || p.name}` });
    }
    orderItems.push({
      product: p._id, slug: p.slug, name: p.name, nameKo: p.nameKo,
      image: p.images?.[0], option: it.option || null, price: p.price, qty: it.qty,
    });
  }

  // 금액 안전성 — KRW 정수만
  if (!orderItems.every((i) => Number.isSafeInteger(i.price) && i.price > 0)) {
    return res.status(400).json({ message: '상품 가격 정보에 문제가 있습니다. 관리자에게 문의해주세요.' });
  }

  const itemsTotal = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
  const baseShipping = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;

  // 쿠폰 검증(소비는 트랜잭션 안에서)
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

  // 포인트 사용 요청 클램프 + 카드 최소금액 규칙(0원 또는 100원 이상)
  const requestedPoints = Math.min(Math.max(0, parseInt(req.body.pointsToUse, 10) || 0), payableBeforePoints);
  const remainderPreview = payableBeforePoints - requestedPoints;
  if (remainderPreview > 0 && remainderPreview < MIN_CARD_AMOUNT) {
    return res.status(400).json({ message: `카드 결제 최소 금액(${MIN_CARD_AMOUNT}원) 미만입니다. 적립금 사용액을 조정해주세요.` });
  }

  // ── 생성 트랜잭션: 주문 insert + 쿠폰 소진(usedOrder 연결) + 포인트 차감 ──
  const orderId = new Order.base.Types.ObjectId();
  let order;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        order = await withTransaction(async (session) => {
          // 포인트 선차감(잔액 클램프 반영량이 확정 금액) — 같은 트랜잭션이라 실패 시 자동 원복
          let pointsUsed = 0;
          if (requestedPoints > 0) {
            const r = await applyPoints(req.user._id, -requestedPoints, 'spend', {
              order: orderId, note: '주문 적립금 사용', session,
            });
            if (r) pointsUsed = -r.amount;
          }
          const grandTotal = Math.max(0, payableBeforePoints - pointsUsed);
          if (grandTotal > 0 && grandTotal < MIN_CARD_AMOUNT) {
            throw httpError(400, '적립금 잔액이 변동되어 결제 금액이 카드 최소 금액 미만이 되었습니다. 다시 시도해주세요.');
          }

          // 쿠폰 원자적 소진 + usedOrder 즉시 연결(원자성 — 복구는 usedOrder 기준)
          if (couponDoc) {
            await UserCoupon.findOneAndUpdate(
              { user: req.user._id, coupon: couponDoc._id, used: false },
              { $set: { used: true, usedAt: new Date(), usedOrder: orderId }, $setOnInsert: { issuedBy: 'self' } },
              { new: true, upsert: true, session },
            );
          }

          const zeroAmount = grandTotal === 0;
          const now = new Date();
          const [created] = await Order.create([{
            _id: orderId,
            orderNumber: genOrderNumber(),
            user: req.user._id,
            items: orderItems,
            shippingAddress: {
              recipient: shippingAddress.recipient, phone: shippingAddress.phone,
              zipcode: shippingAddress.zipcode, address1: shippingAddress.address1,
              address2: shippingAddress.address2, deliveryMemo: shippingAddress.deliveryMemo,
            },
            amounts: { itemsTotal, couponDiscount, shippingFee, pointsUsed, grandTotal },
            coupon: { code: couponDoc ? couponCode : '', discount: couponResult.discountTotal },
            pointsEarned: Math.floor(grandTotal * EARN_RATE),
            idempotencyKey,
            requestHash,
            status: zeroAmount ? 'paid' : 'pending',
            paymentMethod: zeroAmount ? 'points' : 'card',
            payment: zeroAmount
              ? { provider: 'none', method: 'points', paidAt: now }
              : { provider: 'portone', method: 'card', prepareStatus: 'preparing', expiresAt: new Date(now.getTime() + PENDING_TTL_MS) },
          }], { session: session || undefined });

          // 0원 주문은 즉시 paid — 부수효과(메일·판매량)를 같은 트랜잭션에 예약
          if (zeroAmount) await enqueueEvents(created._id, buildPaidEvents(created, req.user), session);
          return created;
        });
        break;
      } catch (e) {
        // 같은 멱등키 동시 요청 — 승자 주문으로 수렴(트랜잭션이라 이 요청의 차감분은 이미 롤백됨)
        if (e.code === 11000 && e.keyPattern?.idempotencyKey) {
          const winner = await Order.findOne({ user: req.user._id, idempotencyKey });
          if (winner) return respondExistingOrder(res, winner, requestHash);
        }
        // 쿠폰 1인 1회 unique 위반 — 다만 같은 멱등키 동시요청의 패자가 쿠폰 선점에서 먼저
        // 걸릴 수 있으므로, 승자 주문이 있으면 400 대신 그 주문으로 멱등 수렴시킨다.
        if (e.code === 11000 && !e.keyPattern?.orderNumber) {
          const winner = await Order.findOne({ user: req.user._id, idempotencyKey });
          if (winner) return respondExistingOrder(res, winner, requestHash);
          return res.status(400).json({ message: '이미 사용한 쿠폰입니다.' });
        }
        if (e.code === 11000 && attempt < 3) continue; // orderNumber 충돌 → 재시도
        throw e;
      }
    }
  } catch (e) {
    // standalone 폴백(비원자)에서 부분 실패했을 수 있으므로 orderId 기준 보상 정리(프로덕션 트랜잭션 경로는 no-op)
    await compensateFailedCreate(orderId, req.user._id).catch(() => {});
    throw e;
  }

  // ── 트랜잭션 밖: 포트원 사전등록(HTTP) ──
  if (order.status === 'pending') {
    try {
      await ensurePrepared(order);
    } catch (e) {
      if (e instanceof portone.PortoneError) {
        // 확정 실패 → 주문을 닫고 혜택 원복
        // TODO(Task 10): cancelService.finalizeCancelTxn로 교체
        await Order.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'cancelled', 'payment.failReason': '결제 사전등록 실패' } });
        await reverseOrderBenefits(await Order.findById(order._id)).catch(() => {});
        throw httpError(502, '결제 준비에 실패했습니다. 다시 시도해주세요.');
      }
      // 결과 불명 — preparing 유지. 같은 멱등키 재요청이 ensurePrepared를 재시도한다.
      throw httpError(502, '결제 준비 확인이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  return res.status(201).json(orderResponse(order));
}

// 멱등 재요청/경합 수렴 공통 응답
async function respondExistingOrder(res, existing, requestHash) {
  if (existing.requestHash && requestHash && existing.requestHash !== requestHash) {
    return res.status(409).json({ message: '같은 요청 키로 다른 내용의 주문이 진행 중입니다. 새로고침 후 다시 시도해주세요.' });
  }
  if (existing.status === 'cancelled') {
    return res.status(409).json({ message: '이전 주문 시도가 취소되었습니다. 다시 주문해주세요.', code: 'ORDER_CANCELLED' });
  }
  if (existing.status === 'pending' && existing.payment?.provider === 'portone') {
    try {
      await ensurePrepared(existing);
    } catch {
      return res.status(502).json({ message: '결제 준비 확인이 지연되고 있습니다. 잠시 후 다시 시도해주세요.' });
    }
  }
  return res.status(200).json(orderResponse(existing));
}

function orderResponse(order) {
  const needsPayment = order.status === 'pending' && order.payment?.provider === 'portone';
  return {
    order,
    checkout: needsPayment
      ? {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        amount: order.amounts.grandTotal,
        orderName: orderName(order),
      }
      : null,
  };
}

function orderName(order) {
  const first = order.items[0];
  const name = first?.nameKo || first?.name || '주문 상품';
  return order.items.length > 1 ? `${name} 외 ${order.items.length - 1}건` : name;
}

// standalone 폴백(비원자 실행)에서 생성 실패 시 orderId 기준 보상 정리. 로컬 개발 전용 안전망.
async function compensateFailedCreate(orderId, userId) {
  const created = await Order.exists({ _id: orderId });
  if (created) return; // 주문이 성립했으면 보상 불필요
  await UserCoupon.updateOne({ usedOrder: orderId }, { used: false, usedOrder: null, usedAt: null }).catch(() => {});
  const spend = await PointTransaction.findOne({ order: orderId, type: 'spend' });
  if (spend) {
    await applyPoints(userId, -spend.amount, 'refund', { note: '주문 생성 실패 환급' }).catch(() => {});
    await PointTransaction.deleteOne({ _id: spend._id }).catch(() => {});
  }
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
