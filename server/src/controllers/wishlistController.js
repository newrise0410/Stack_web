import Product from '../models/Product.js';
import User from '../models/User.js';

const VISIBLE = ['active', 'soldout']; // 공개 노출 정책과 동일 (draft/archived 제외)

// 내 찜 목록 — GET /wishlist (requireAuth)
// slugs(하트 상태용)와 items(찜 페이지 표시용)를 함께 반환
export async function getWishlist(req, res) {
  const slugs = req.user.wishlist || [];
  const items = slugs.length
    ? await Product.find({ slug: { $in: slugs }, status: { $in: VISIBLE } })
    : [];
  res.json({ slugs, items });
}

// 찜 토글 — POST /wishlist/:slug (requireAuth)
// 배열 통째 저장 대신 $addToSet/$pull 원자적 갱신으로 동시 요청 clobber 방지
export async function toggleWishlist(req, res) {
  const { slug } = req.params;
  const exists = await Product.exists({ slug });
  if (!exists) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });

  const wished = (req.user.wishlist || []).includes(slug);
  const update = wished ? { $pull: { wishlist: slug } } : { $addToSet: { wishlist: slug } };
  const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true }).select('wishlist');
  res.json({ slugs: updated.wishlist || [], wished: !wished });
}
