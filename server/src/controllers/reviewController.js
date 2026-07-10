import Review from '../models/Review.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';

const VISIBLE = ['active', 'soldout']; // 공개 상세와 동일한 노출 정책

// 상품의 평점 집계값을 리뷰들로부터 다시 계산해 Product에 반영 (숨김 리뷰 제외)
async function recomputeRating(productId) {
  const [agg] = await Review.aggregate([
    { $match: { product: productId, hidden: { $ne: true } } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: productId },
    { ratingAvg: agg ? Math.round(agg.avg * 10) / 10 : 0, ratingCount: agg ? agg.count : 0 },
  );
}

// 목록 — GET /products/:slug/reviews (공개)
export async function listReviews(req, res) {
  const product = await Product.findOne({ slug: req.params.slug }).select('_id status');
  if (!product || !VISIBLE.includes(product.status)) {
    return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { product: product._id, hidden: { $ne: true } }; // 숨김 리뷰 제외
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 작성 — POST /products/:slug/reviews (requireAuth)
export async function createReview(req, res) {
  const product = await Product.findOne({ slug: req.params.slug }).select('_id status');
  if (!product || !VISIBLE.includes(product.status)) {
    return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
  }

  // 구매 검증 — 실제 구매(취소 제외)한 상품에만 리뷰 작성 가능
  const purchased = await Order.exists({
    user: req.user._id,
    'items.product': product._id,
    status: { $in: ['paid', 'preparing', 'shipped', 'delivered'] },
  });
  if (!purchased) {
    return res.status(403).json({ message: '구매하신 상품에만 리뷰를 작성할 수 있습니다.' });
  }

  const rating = parseInt(req.body.rating, 10);
  const content = String(req.body.content || '').trim();
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ message: '별점을 선택해주세요.' });
  if (!content) return res.status(400).json({ message: '리뷰 내용을 입력해주세요.' });

  let review;
  try {
    review = await Review.create({
      product: product._id,
      user: req.user._id,
      userName: req.user.displayName, // 마스킹된 표시명
      rating,
      content: content.slice(0, 1000),
    });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: '이미 이 상품에 리뷰를 작성하셨습니다.' });
    }
    throw e;
  }

  // 평점 재계산 실패가 리뷰 등록을 실패시키지 않게 분리 (다음 작성/삭제 때 자가복구)
  try {
    await recomputeRating(product._id);
  } catch {
    /* 평점 갱신 실패는 무시 */
  }
  res.status(201).json(review);
}

// 관리자 리뷰 목록 — GET /reviews/admin?product=&page=&limit= (admin)
// 숨김 포함 전체. product(slug) 필터 옵션. product/user 이름 populate.
export async function listAllReviews(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const filter = {};
  const slug = String(req.query.product || '').trim();
  if (slug) {
    const p = await Product.findOne({ slug }).select('_id');
    filter.product = p ? p._id : null; // 없으면 빈 결과
  }
  const [items, total] = await Promise.all([
    Review.find(filter)
      .populate('product', 'name nameKo slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// 숨김 토글 — PATCH /reviews/:id/hidden (admin)
export async function setReviewHidden(req, res) {
  // 문자열 "false"/"0"이 truthy로 강제변환되지 않게 명시적으로 파싱
  const hidden = req.body.hidden === true || req.body.hidden === 'true';
  const review = await Review.findByIdAndUpdate(req.params.id, { hidden }, { new: true });
  if (!review) return res.status(404).json({ message: '리뷰를 찾을 수 없습니다.' });
  try {
    await recomputeRating(review.product);
  } catch {
    /* 평점 갱신 실패는 무시 */
  }
  res.json(review);
}

// 삭제 — DELETE /reviews/:id (본인/admin)
export async function deleteReview(req, res) {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ message: '리뷰를 찾을 수 없습니다.' });
  if (String(review.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: '접근 권한이 없습니다.' });
  }
  const productId = review.product;
  await review.deleteOne();
  try {
    await recomputeRating(productId);
  } catch {
    /* 평점 갱신 실패는 무시 */
  }
  res.status(204).end();
}
