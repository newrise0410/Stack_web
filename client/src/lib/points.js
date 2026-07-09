import api from './api.js';

export const POINT_TYPE_LABEL = {
  signup: '가입 적립',
  earn: '구매 적립',
  spend: '사용',
  reclaim: '취소 회수',
  refund: '취소 환급',
  admin_adjust: '관리자 조정',
};

export async function fetchMyPoints(params = {}) {
  const { data } = await api.get('/points/me', { params });
  return data;
}

export async function adjustMemberPoints(userId, amount, note) {
  const { data } = await api.post(`/admin/members/${userId}/points`, { amount, note });
  return data;
}
