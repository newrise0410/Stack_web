import Order from '../models/Order.js';
import Product from '../models/Product.js';

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
  const shippingFee = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const grandTotal = itemsTotal + shippingFee;

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
    amounts: { itemsTotal, shippingFee, grandTotal },
    status: 'paid', // mock 결제 즉시 완료
    paymentMethod: 'mock',
  };

  // 주문번호 랜덤 충돌(E11000) 시 재시도
  let order;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      order = await Order.create({ ...payload, orderNumber: genOrderNumber() });
      break;
    } catch (e) {
      if (e.code === 11000 && attempt < 3) continue;
      throw e;
    }
  }

  // 판매량 반영 (BEST 정렬용 salesCount) — 비핵심이므로 실패해도 주문은 성립시킨다
  try {
    await adjustSales(orderItems, +1);
  } catch {
    /* salesCount 갱신 실패는 주문을 실패시키지 않음 */
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

// 전체 주문 목록 — GET /orders/admin (admin)
export async function listAllOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const [items, total] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(),
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
  order.status = 'cancelled';
  await order.save();
  await adjustSales(order.items, -1); // 판매량 원복
  res.json(order);
}

// 주문 상태 변경 — PATCH /orders/:id/status (admin)
const ADMIN_STATUSES = ['paid', 'preparing', 'shipped', 'delivered', 'cancelled'];
export async function updateOrderStatus(req, res) {
  const next = String(req.body.status || '');
  if (!ADMIN_STATUSES.includes(next)) {
    return res.status(400).json({ message: '허용되지 않은 주문 상태입니다.' });
  }
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });

  const wasCancelled = order.status === 'cancelled';
  const willCancel = next === 'cancelled';
  order.status = next;
  await order.save();

  // 취소 전이/취소 해제에 따라 판매량 가감 (중복 가감 방지)
  if (willCancel && !wasCancelled) await adjustSales(order.items, -1);
  else if (!willCancel && wasCancelled) await adjustSales(order.items, +1);

  res.json(order);
}

// 주문 상세 — GET /orders/:id (requireAuth, 본인/admin)
export async function getOrder(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (String(order.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  res.json(order);
}
