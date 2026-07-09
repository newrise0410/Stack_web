import Product from '../models/Product.js';
import { pick } from '../utils/pick.js';
import { destroyUnreferenced, publicIdFromUrl } from '../utils/cloudinaryUrl.js';

// 후보 URL 중 "다른 상품이 더는 참조하지 않는" Cloudinary 자산만 골라 정리한다.
// 같은 URL을 여러 상품이 공유하는 경우(복제·수동 입력) 살아있는 자산을 오삭제하지 않도록 방어.
async function cleanupOrphanImages(candidateUrls) {
  const cloud = (candidateUrls || []).filter((u) => publicIdFromUrl(u)); // Cloudinary URL만
  if (cloud.length === 0) return;
  const stillUsed = await Product.find({ images: { $in: cloud } }, { images: 1 });
  const used = new Set(stillUsed.flatMap((p) => p.images || []));
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
const PRODUCT_TYPES = ['Table', 'Pendant', 'MoonWall'];
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
  const product = await Product.create(pick(req.body, FIELDS));
  res.status(201).json(product);
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
export async function deleteProduct(req, res) {
  const removed = await Product.findOneAndDelete({ slug: req.params.slug });
  if (!removed) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  // 삭제된 상품의 Cloudinary 자산 정리(best-effort) — DB 참조가 사라지면 회수 불가
  await cleanupOrphanImages(removed.images);
  res.status(204).end();
}
