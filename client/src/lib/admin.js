import api from './api.js';

export const ORDER_STATUS_LABEL = {
  pending: '결제대기',
  paid: '결제완료',
  preparing: '제작중',
  shipped: '배송중',
  delivered: '배송완료',
  cancelled: '취소',
};

// 대시보드 통계
export async function fetchStats() {
  const { data } = await api.get('/admin/stats');
  return data;
}

// 주문 목록 (필터: status, q, from, to, page, limit)
export async function fetchAdminOrders(params = {}) {
  const { data } = await api.get('/orders/admin', { params });
  return data;
}

// 주문 상세
export async function fetchOrder(id) {
  const { data } = await api.get(`/orders/${id}`);
  return data;
}

// 상태 변경 ({ status, courier?, trackingNumber? })
export async function setOrderStatus(id, body) {
  const { data } = await api.patch(`/orders/${id}/status`, body);
  return data;
}

// ── 회원 ───────────────────────────────────────────────────
export async function fetchMembers(params = {}) {
  const { data } = await api.get('/users', { params });
  return data;
}
export async function fetchMember(id) {
  const { data } = await api.get(`/admin/members/${id}`);
  return data; // { user, orders, orderCount, totalSpent }
}
export async function setUserRole(id, role) {
  const { data } = await api.patch(`/users/${id}/role`, { role });
  return data;
}
export async function setUserStatus(id, status) {
  const { data } = await api.patch(`/users/${id}/status`, { status });
  return data;
}

// ── 상품 ───────────────────────────────────────────────────
export async function fetchAdminProducts(params = {}) {
  const { data } = await api.get('/products/admin', { params });
  return data;
}
export async function patchProduct(slug, body) {
  const { data } = await api.patch(`/products/${slug}`, body);
  return data;
}

// ── 리뷰 관리 ──────────────────────────────────────────────
export async function fetchAdminReviews(params = {}) {
  const { data } = await api.get('/reviews/admin', { params });
  return data;
}
export async function setReviewHidden(id, hidden) {
  const { data } = await api.patch(`/reviews/${id}/hidden`, { hidden });
  return data;
}
export async function deleteReviewAdmin(id) {
  await api.delete(`/reviews/${id}`);
}
