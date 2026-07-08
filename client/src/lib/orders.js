import api from './api.js';

// 주문 생성 — 서버가 DB 상품가로 합계를 재계산한다.
export async function createOrder(payload) {
  const { data } = await api.post('/orders', payload);
  return data;
}

export async function fetchMyOrders() {
  const { data } = await api.get('/orders');
  return data.items;
}

export async function cancelOrder(id) {
  const { data } = await api.post(`/orders/${id}/cancel`);
  return data;
}

// 관리자용
export async function fetchAllOrders() {
  const { data } = await api.get('/orders/admin', { params: { limit: 100 } });
  return data.items;
}

export async function updateOrderStatus(id, status) {
  const { data } = await api.patch(`/orders/${id}/status`, { status });
  return data;
}
