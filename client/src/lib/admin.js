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

// 분석 (period: 7d|30d|12m)
export async function fetchAnalytics(period = '30d') {
  const { data } = await api.get('/admin/analytics', { params: { period } });
  return data;
}

// ── 운영 상태 (조용한 실패 감지·복구) ──────────────────────
export async function fetchOps() {
  const { data } = await api.get('/admin/ops');
  return data; // { counts:{failedEvents,webhookErrors,refundReview,benefitsStuck}, lastCycle }
}
export async function fetchEvents(params = {}) {
  const { data } = await api.get('/admin/events', { params });
  return data;
}
export async function requeueEvent(id) {
  const { data } = await api.post(`/admin/events/${id}/requeue`);
  return data;
}
// review로 격리된 주문의 환불 재시도 — 포트원 실제 상태로 수렴(재환불 or 이미완료 감지)
export async function retryRefund(id) {
  const { data } = await api.post(`/orders/${id}/retry-refund`);
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
// 등급은 관리자 수동 지정 전용 — 자동 산정이 없고 적립률과도 연결돼 있지 않다(표시용 라벨).
export async function setUserGrade(id, grade) {
  const { data } = await api.patch(`/users/${id}/grade`, { grade });
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

// ── 주문 일괄·집계 ──────────────────────────────────────────
export const COURIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', '기타'];
export async function fetchOrderCounts() { const { data } = await api.get('/orders/admin/counts'); return data; }
export async function bulkOrderStatus(body) { const { data } = await api.post('/orders/bulk/status', body); return data; }
export async function bulkTracking(rows) { const { data } = await api.post('/orders/bulk/tracking', { rows }); return data; }
export async function fetchProductionSummary() { const { data } = await api.get('/orders/admin/production-summary'); return data; }
export async function fetchOrdersBatch(ids) { const { data } = await api.get('/orders/admin/batch', { params: { ids: ids.join(',') } }); return data.items; }
export async function downloadOrdersCsv(params = {}) {
  const res = await api.get('/orders/admin/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
