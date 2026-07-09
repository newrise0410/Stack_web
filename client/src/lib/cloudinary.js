import api from './api.js';

// Cloudinary delivery URL이면 변환(f_auto,q_auto[,w_N])을 주입, 아니면 원본 그대로 반환.
// 로컬 /products/... 이나 빈 값은 통과 → 기존 이미지가 절대 깨지지 않는다.
export function cldUrl(url, { w } = {}) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const t = ['f_auto', 'q_auto'];
  if (w) t.push(`w_${w}`);
  return url.replace('/upload/', `/upload/${t.join(',')}/`);
}

// 관리자 이미지 업로드 → { url, publicId }. axios가 FormData의 multipart 헤더를 자동 설정한다.
export async function uploadProductImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/admin/uploads', fd);
  return data;
}
