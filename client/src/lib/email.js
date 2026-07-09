import api from './api.js';

export const EMAIL_TYPE_LABEL = {
  order_placed: '주문접수',
  order_status: '주문상태',
};

// 관리자 전체 목록
export async function fetchAdminEmails(params = {}) {
  const { data } = await api.get('/admin/emails', { params });
  return data;
}

// 내 받은메일함
export async function fetchMyEmails(params = {}) {
  const { data } = await api.get('/emails/me', { params });
  return data;
}
