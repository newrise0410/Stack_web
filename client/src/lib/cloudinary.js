import api from './api.js';

// Cloudinary delivery URL이면 변환(f_auto,q_auto[,w_N])을 주입, 아니면 원본 그대로 반환.
// 로컬 /products/... 이나 빈 값은 통과 → 기존 이미지가 절대 깨지지 않는다.
export function cldUrl(url, { w } = {}) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const t = ['f_auto', 'q_auto'];
  if (w) t.push(`w_${w}`);
  // 작은 이미지(카드·썸네일)는 레티나에서 흐려지므로 2x로 선명하게.
  // 히어로·상세(대형)는 이미 커서 dpr까지 올리면 LCP 바이트만 늘어 제외.
  if (w && w <= 900) t.push('dpr_2.0');
  return url.replace('/upload/', `/upload/${t.join(',')}/`);
}

// 관리자 이미지 업로드 → { url, publicId }.
// api 인스턴스 기본 Content-Type이 application/json이라, FormData 전송 시 undefined로 덮어써
// 브라우저가 multipart/form-data 경계(boundary)를 자동 설정하도록 한다(안 그러면 서버가 파일을 못 받음).
export async function uploadProductImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/admin/uploads', fd, {
    headers: { 'Content-Type': undefined },
  });
  return data;
}
