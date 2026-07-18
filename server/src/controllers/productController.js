import Product, { PRODUCT_TYPES } from '../models/Product.js';
import Order from '../models/Order.js';
import { pick } from '../utils/pick.js';
import { destroyUnreferenced, publicIdFromUrl } from '../utils/cloudinaryUrl.js';
import { nextSku } from '../services/skuService.js';

// 후보 URL 중 "더 이상 어디서도 참조하지 않는" Cloudinary 자산만 골라 정리한다.
// 참조로 인정하는 곳: (1) 다른 상품의 images(복제·수동 입력 공유), (2) 과거 주문의 항목 스냅샷 image
// (주문은 주문시점 이미지 URL을 고정 저장하므로, 상품에서 빠졌어도 주문 내역이 여전히 참조 → 오삭제 금지).
async function cleanupOrphanImages(candidateUrls) {
  const cloud = (candidateUrls || []).filter((u) => publicIdFromUrl(u)); // Cloudinary URL만
  if (cloud.length === 0) return;
  const [usedByProducts, usedByOrders] = await Promise.all([
    Product.find({ images: { $in: cloud } }, { images: 1 }),
    Order.find({ 'items.image': { $in: cloud } }, { 'items.image': 1 }),
  ]);
  const used = new Set([
    ...usedByProducts.flatMap((p) => p.images || []),
    ...usedByOrders.flatMap((o) => (o.items || []).map((it) => it.image)),
  ]);
  await destroyUnreferenced(cloud.filter((u) => !used.has(u)));
}

const FIELDS = [
  'slug', 'brand', 'name', 'nameKo', 'category', 'type', 'description',
  'images', 'price', 'compareAtPrice', 'badges', 'specs', 'options', 'status',
];

const SORTS = {
  new: { createdAt: -1 },
  best: { salesCount: -1 },
  priceAsc: { price: 1 },
  priceDesc: { price: -1 },
};
// own 속성만 허용 (__proto__/toString 등 상속 키가 정렬로 새어들지 않게)
const sortSpec = (key) => (Object.prototype.hasOwnProperty.call(SORTS, key) ? SORTS[key] : { createdAt: -1 });

// 쿼리 파라미터를 문자열로 강제해 객체 주입($ne/$text 오염 등)을 차단
const str = (v) => (v == null ? '' : String(Array.isArray(v) ? v[0] : v));

// READ (list) — GET /products?type=Table&badge=NEW&q=&sort=new&page=1&limit=24
export async function listProducts(req, res) {
  const type = str(req.query.type);
  const badge = str(req.query.badge);
  const q = str(req.query.q);
  const sort = str(req.query.sort);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const filter = { status: 'active' };
  if (type) filter.type = type;
  if (badge) filter.badges = badge;
  if (q) filter.$text = { $search: q };

  const [items, total] = await Promise.all([
    Product.find(filter).sort(sortSpec(sort)).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// READ (list, admin) — GET /products/admin?status=&type=&q=&sort=&page=&limit= — 모든 status 대상
const PRODUCT_STATES = ['active', 'draft', 'soldout', 'archived'];
// PRODUCT_TYPES는 모델에서 import — 타입 추가 시 한 곳(Product.js TYPE_CODE)만 고치면 파생된다.
export async function listAllProducts(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const sort = str(req.query.sort);

  const filter = {};
  const status = str(req.query.status);
  if (PRODUCT_STATES.includes(status)) filter.status = status;
  const type = str(req.query.type);
  if (PRODUCT_TYPES.includes(type)) filter.type = type;
  const q = str(req.query.q).trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { nameKo: rx }, { slug: rx }];
  }

  const [items, total] = await Promise.all([
    Product.find(filter).sort(sortSpec(sort)).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// READ (one) — GET /products/:slug — 공개는 active/soldout만, draft/archived는 숨김
export async function getProduct(req, res) {
  const product = await Product.findOne({ slug: req.params.slug });
  if (!product || !['active', 'soldout'].includes(product.status)) {
    return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  }
  res.json(product);
}

// CREATE — POST /products (admin)
export async function createProduct(req, res) {
  const data = pick(req.body, FIELDS); // sku는 FIELDS에 없음 → 클라 값 무시(서버 생성 전용·불변)
  if (!PRODUCT_TYPES.includes(data.type)) {
    return res.status(400).json({ message: '상품 타입을 선택해주세요.' });
  }
  // 흔한 실패(slug 중복)를 카운터를 태우기 전에 걸러 구멍을 줄인다 — 위생이지 정합성 보장은 아니다.
  if (await Product.exists({ slug: data.slug })) {
    return res.status(409).json({ message: '이미 사용 중인 slug입니다. 다른 값을 입력해주세요.' });
  }
  data.sku = await nextSku(data.type);
  try {
    const product = await Product.create(data);
    return res.status(201).json(product);
  } catch (e) {
    if (e.code === 11000) { // 경합으로 뚫린 중복 — slug/sku를 구분해 명확히 안내
      const field = Object.keys(e.keyPattern || {})[0];
      if (field === 'slug') return res.status(409).json({ message: '이미 사용 중인 slug입니다.' });
      return res.status(409).json({ message: 'SKU 채번 충돌이 발생했습니다. 다시 시도해주세요.' });
    }
    throw e;
  }
}

// UPDATE — PATCH /products/:slug (admin)
export async function updateProduct(req, res) {
  const updates = pick(req.body, FIELDS);
  // images를 교체하는 요청만 옛 이미지 정리가 필요하므로, 그때만 이전 images를 미리 읽는다.
  const touchesImages = Object.prototype.hasOwnProperty.call(updates, 'images');
  const before = touchesImages
    ? await Product.findOne({ slug: req.params.slug }, { images: 1 })
    : null;
  const product = await Product.findOneAndUpdate(
    { slug: req.params.slug },
    updates,
    { new: true, runValidators: true },
  );
  if (!product) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  // 더 이상 참조되지 않는 옛 Cloudinary 자산 정리(best-effort)
  if (touchesImages) {
    const kept = new Set(product.images || []);
    await cleanupOrphanImages((before?.images || []).filter((u) => !kept.has(u)));
  }
  res.json(product);
}

// DELETE — DELETE /products/:slug (admin)
// 소프트 삭제 — status를 'archived'로 전환한다. 하드 삭제가 아닌 이유:
// 이전엔 findOneAndDelete + cleanupOrphanImages로 Cloudinary 원본까지 지웠는데(회수 불가),
// window.confirm 하나만 통과하면 실수 한 번에 이미지가 영구 소실됐다. archived는 이미
// 공개 조회(getProduct/listProducts)에서 숨겨지고 관리자가 status 필터로 되돌릴 수 있어,
// 별도 필드 없이 곧 '복구 가능한 삭제'가 된다. 고아 이미지는 sweep:images 스크립트가 따로 정리.
export async function deleteProduct(req, res) {
  const archived = await Product.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: { status: 'archived' } },
    { new: true },
  );
  if (!archived) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  res.status(204).end();
}
