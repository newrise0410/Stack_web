import api from './api.js';

export const POINT_TYPE_LABEL = {
  signup: '가입 적립',
  earn: '구매 적립',
  spend: '사용',
  reclaim: '취소 회수',
  refund: '취소 환급',
  admin_adjust: '관리자 조정',
  withdraw: '탈퇴 소멸',
};

export async function fetchMyPoints(params = {}) {
  const { data } = await api.get('/points/me', { params });
  return data;
}

export async function adjustMemberPoints(userId, amount, note) {
  const { data } = await api.post(`/admin/members/${userId}/points`, { amount, note });
  return data;
}

// 회원 적립금 내역 페이징 — '더 보기'로 2페이지 이상을 이어 받는다.
export async function fetchMemberPoints(userId, page = 1) {
  const { data } = await api.get(`/admin/members/${userId}/points`, { params: { page } });
  return data; // { page, limit, total, items }
}
