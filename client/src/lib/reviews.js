import api from './api.js';

// 상품 리뷰 목록 (공개) — { page, limit, total, items }
export async function fetchReviews(slug, params = {}) {
  const { data } = await api.get(`/products/${slug}/reviews`, { params });
  return data;
}

// 리뷰 작성 (requireAuth)
export async function createReview(slug, payload) {
  const { data } = await api.post(`/products/${slug}/reviews`, payload);
  return data;
}

// 리뷰 삭제 (본인/admin)
export async function deleteReview(id) {
  await api.delete(`/reviews/${id}`);
}
