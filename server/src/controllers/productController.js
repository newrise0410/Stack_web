import Product from '../models/Product.js';
import { pick } from '../utils/pick.js';

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

// READ (list) — GET /products?type=Table&badge=NEW&q=&sort=new&page=1&limit=24
export async function listProducts(req, res) {
  const { type, badge, q, sort } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const filter = { status: 'active' };
  if (type) filter.type = type;
  if (badge) filter.badges = badge;
  if (q) filter.$text = { $search: q };

  const [items, total] = await Promise.all([
    Product.find(filter).sort(SORTS[sort] || { createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// READ (one) — GET /products/:slug
export async function getProduct(req, res) {
  const product = await Product.findOne({ slug: req.params.slug });
  if (!product) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  res.json(product);
}

// CREATE — POST /products (admin)
export async function createProduct(req, res) {
  const product = await Product.create(pick(req.body, FIELDS));
  res.status(201).json(product);
}

// UPDATE — PATCH /products/:slug (admin)
export async function updateProduct(req, res) {
  const product = await Product.findOneAndUpdate(
    { slug: req.params.slug },
    pick(req.body, FIELDS),
    { new: true, runValidators: true },
  );
  if (!product) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  res.json(product);
}

// DELETE — DELETE /products/:slug (admin)
export async function deleteProduct(req, res) {
  const removed = await Product.findOneAndDelete({ slug: req.params.slug });
  if (!removed) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  res.status(204).end();
}
