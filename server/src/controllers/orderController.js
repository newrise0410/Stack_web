import crypto from 'node:crypto';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import UserCoupon from '../models/UserCoupon.js';
import { sendOrderPlaced } from '../services/emailService.js';
import { validateCoupon, computeCoupon } from '../services/couponService.js';
import { applyPoints, EARN_RATE } from '../services/pointService.js';
import PointTransaction from '../models/PointTransaction.js';
import { withTransaction } from '../utils/withTransaction.js';
import { httpError } from '../utils/httpError.js';
import { enqueueEvents, buildPaidEvents } from '../services/orderEventService.js';
import { ensurePrepared } from '../services/checkoutService.js';
import * as portone from '../services/portoneService.js';
import { cancelOrderSaga, finalizeCancelTxn, executeRefund, reconcileLateRefund } from '../services/cancelService.js';
import { applyTransition } from '../services/orderTransitionService.js';

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
      product: p._id, slug: p.slug, sku: p.sku || null, name: p.name, nameKo: p.nameKo,
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
            statusHistory: [{
              status: zeroAmount ? 'paid' : 'pending', at: now, actor: 'system',
              reason: zeroAmount ? '0원 주문 자동 결제' : '주문 생성',
            }],
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
        await finalizeCancelTxn(order._id, ['pending'], { reason: '결제 사전등록 실패' }).catch(() => {});
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

// 상태별 건수 — GET /orders/admin/counts (admin). 탭 뱃지용 경량 집계.
export async function getOrderCounts(req, res) {
  const agg = await Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(agg.map((r) => [r._id, r.n]));
  res.json(Object.fromEntries(ORDER_STATES.map((s) => [s, byStatus[s] || 0])));
}

// 옵션별 제작 집계 — GET /orders/admin/production-summary (admin)
// 미발송(결제완료·제작중) 주문을 상품×옵션으로 합산 — 3D 프린터 출력 계획용.
export async function getProductionSummary(req, res) {
  const items = await Order.aggregate([
    { $match: { status: { $in: ['paid', 'preparing'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: { slug: '$items.slug', option: '$items.option' },
        sku: { $first: '$items.sku' }, // slug와 1:1이라 그룹 키가 아니라 $first
        name: { $first: '$items.name' },
        nameKo: { $first: '$items.nameKo' },
        image: { $first: '$items.image' },
        paidQty: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$items.qty', 0] } },
        preparingQty: { $sum: { $cond: [{ $eq: ['$status', 'preparing'] }, '$items.qty', 0] } },
        totalQty: { $sum: '$items.qty' },
        orders: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0, slug: '$_id.slug', option: '$_id.option', sku: 1,
        name: 1, nameKo: 1, image: 1, paidQty: 1, preparingQty: 1, totalQty: 1,
        orderCount: { $size: '$orders' },
      },
    },
    { $sort: { totalQty: -1, slug: 1 } },
  ]);
  res.json({ items, generatedAt: new Date().toISOString() });
}

// 인쇄용 일괄 조회 — GET /orders/admin/batch?ids=a,b,c (admin, ≤50건)
export async function getOrdersBatch(req, res) {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 50) {
    return res.status(400).json({ message: '인쇄할 주문은 1~50건이어야 합니다.' });
  }
  const valid = ids.filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  const items = await Order.find({ _id: { $in: valid } }).populate('user', 'name email');
  // 요청 순서 보존(인쇄 순서 = 선택 순서)
  const byId = new Map(items.map((o) => [String(o._id), o]));
  res.json({ items: valid.map((id) => byId.get(id)).filter(Boolean) });
}

// 전체 주문 목록 — GET /orders/admin (admin). ?status=&from=&to=&q=&product=&page=&limit=
const ORDER_STATES = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'];

// listAllOrders·export가 공유하는 관리자 주문 필터 빌더 — 해석 규칙이 두 벌이 되지 않게.
export function buildAdminOrderFilter(query) {
  const filter = {};
  const status = String(query.status || '');
  if (ORDER_STATES.includes(status)) filter.status = status;

  // 날짜 경계는 KST로 고정한다. setHours는 프로세스 로컬 TZ라 UTC 배포 시 9시간 어긋나,
  // 같은 CSV 안에서 '주문일' 컬럼(kstDate, KST)과 필터 경계가 불일치했다.
  // date-only 입력('YYYY-MM-DD')에 +09:00을 붙여 KST 자정/자정직전으로 파싱한다.
  const from = query.from ? new Date(`${String(query.from).slice(0, 10)}T00:00:00+09:00`) : null;
  const to = query.to ? new Date(`${String(query.to).slice(0, 10)}T23:59:59.999+09:00`) : null;
  if (from && !Number.isNaN(from.getTime())) {
    filter.createdAt = { ...(filter.createdAt || {}), $gte: from };
  }
  if (to && !Number.isNaN(to.getTime())) {
    filter.createdAt = { ...(filter.createdAt || {}), $lte: to };
  }

  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNumber: rx }, { 'shippingAddress.recipient': rx }];
  }

  const product = String(query.product || '').trim();
  if (product) filter['items.slug'] = product;

  // 환불 상태 필터 — 운영 패널이 review 격리 주문을 바로 걸러 보여주기 위해(데드락 발견 경로).
  const refund = String(query.refund || '').trim();
  if (['requested', 'processing', 'done', 'review'].includes(refund)) {
    filter['payment.refund.status'] = refund;
  }
  return filter;
}

export async function listAllOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

  const filter = buildAdminOrderFilter(req.query);

  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 주문 취소 — POST /orders/:id/cancel (본인/admin). 모든 취소는 saga 경유.
export async function cancelOrder(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (String(order.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  const r = await cancelOrderSaga(order._id, { actor: req.user.role === 'admin' ? 'admin' : 'user' });
  switch (r.outcome) {
    case 'cancelled':
      return res.json(r.order);
    case 'became_paid':
      return res.json(r.order); // 클라이언트는 status==='paid'로 구분
    case 'already_cancelled':
      if (r.order?.benefitsReversed) return res.status(400).json({ message: '이미 취소된 주문입니다.' });
      return res.json(r.order);
    case 'payment_in_progress':
      return res.status(409).json({ message: '결제 확인이 진행 중입니다. 잠시 후 다시 시도해주세요.' });
    case 'refund_pending':
      return res.status(202).json({ message: '환불이 접수되었습니다. 처리 완료까지 잠시 걸릴 수 있습니다.', order: r.order });
    case 'review':
      return res.status(409).json({ message: '환불 처리에 확인이 필요합니다. 관리자에게 문의해주세요.' });
    default:
      return res.status(400).json({ message: '이미 배송이 진행되어 취소할 수 없습니다.' });
  }
}

// 주문 상태 변경 — PATCH /orders/:id/status (admin). 로직은 orderTransitionService 공유.
export async function updateOrderStatus(req, res) {
  const r = await applyTransition(req.params.id, String(req.body.status || ''), {
    courier: req.body.courier,
    trackingNumber: req.body.trackingNumber,
    reason: String(req.body.reason || '').slice(0, 200), // 취소 사유(선택) — statusHistory·failReason에 저장
    actor: 'admin',
  });
  if (r.ok) return res.json(r.order);
  switch (r.code) {
    case 'not_found':
      return res.status(404).json({ message: r.message });
    case 'invalid_transition':
    case 'tracking_required':
      return res.status(400).json({ message: r.message });
    case 'refund_pending':
      return res.status(202).json({ message: r.message, order: r.order });
    default: // refund_locked, conflict, review
      return res.status(409).json({ message: r.message });
  }
}

// 환불 재시도 — POST /orders/:id/retry-refund (admin)
// 'review'로 격리된 주문의 데드락을 푸는 유일한 화면 수단. refund_locked가 모든 전이를
// 막으므로 이전엔 DB 직접 수정이 유일한 탈출구였다.
//
// ⚠️ 실제 환불 없이 상태만 바꾸는 '완료로 표시'는 만들지 않는다 — 고객 돈을 안 돌려주게 된다.
// 대신 executeRefund/reconcileLateRefund가 **포트원을 진실의 원천으로** 재조회한다:
//   - 관리자가 포트원 콘솔에서 이미 환불했다면 remaining<=0을 감지해 done으로 수렴
//   - 아직이면 재환불을 시도, 또 실패하면 review 유지(장부는 절대 어긋나지 않음)
// status 분기는 paymentJobs.reconcileRefunds와 동일하다: cancelled면 reconcileLateRefund,
// 아직 paid/preparing이면 executeRefund(finalizeCancelTxn까지 수행해 취소 확정).
export async function retryRefund(req, res) {
  const order = await Order.findById(req.params.id).catch(() => null);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (order.payment?.refund?.status !== 'review') {
    return res.status(400).json({ message: '환불 확인이 필요한 주문이 아닙니다.' });
  }
  // 단일 승자 CAS — review→processing으로 선점한 요청만 진행한다. 이게 없으면 두 탭/두 관리자의
  // 동시 재시도가 각각 portone.cancel을 호출해 이중환불 방어가 포트원 checksum에만 의존하게 되고,
  // 패자가 승자의 done을 review로 되돌려 cancelled+review 고아 상태를 만든다(적대 리뷰 CONFIRMED).
  // cancelService의 모든 환불 경로가 refund.status CAS로 단일 승자를 보장하는데, 이 경로만 빠져 있었다.
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.refund.status': 'review' },
    { $set: { 'payment.refund.status': 'processing' } },
    { new: true },
  );
  if (!claimed) return res.status(409).json({ message: '이미 환불 처리가 진행 중입니다.' });

  // processing으로 바꿔 진입한다 — executeRefund/reconcileLateRefund는 포트원을 재조회해 수렴하고,
  // 실패 시 다시 review로 되돌린다(자동 잡이 이어받을 수 있게 processing으로 남기기도 함).
  const result = claimed.status === 'cancelled'
    ? await reconcileLateRefund(claimed)
    : await executeRefund(claimed);
  const updated = await Order.findById(order._id).populate('user', 'name email status');
  return res.json({ outcome: result.outcome, order: updated });
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
