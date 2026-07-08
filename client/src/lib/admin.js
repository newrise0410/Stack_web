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
