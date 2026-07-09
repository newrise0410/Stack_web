import api from './api.js';
import { won } from './format.js';

export const DISCOUNT_TYPE_LABEL = {
  fixed: '정액 할인',
  percent: '정률 할인',
  free_shipping: '무료배송',
};

// 쿠폰 혜택을 사람이 읽는 문구로
export function couponBenefitText(c) {
  if (c.discountType === 'fixed') return `${won(c.discountValue)}원 할인`;
  if (c.discountType === 'percent') {
    return `${c.discountValue}% 할인${c.maxDiscount ? ` (최대 ${won(c.maxDiscount)}원)` : ''}`;
  }
  return '무료배송';
}

// ── 관리자 ──
export async function fetchAdminCoupons() {
  const { data } = await api.get('/admin/coupons');
  return data;
}
export async function createCoupon(body) {
  const { data } = await api.post('/admin/coupons', body);
  return data;
}
export async function updateCoupon(id, body) {
  const { data } = await api.patch(`/admin/coupons/${id}`, body);
  return data;
}
export async function deleteCoupon(id) {
  await api.delete(`/admin/coupons/${id}`);
}
export async function issueCouponToMember(userId, couponId) {
  const { data } = await api.post(`/admin/members/${userId}/coupons`, { couponId });
  return data;
}

// ── 사용자 ──
export async function fetchMyCoupons() {
  const { data } = await api.get('/coupons/me');
  return data;
}
export async function claimCoupon(code) {
  const { data } = await api.post('/coupons/claim', { code });
  return data;
}
export async function fetchAvailableCoupons(itemsTotal) {
  const { data } = await api.get('/coupons/available', { params: { itemsTotal } });
  return data;
}
