import api from './api.js';

// Cloudinary delivery URL 여부 + 이미 변환이 붙었는지 판별(로컬/외부/빈 값은 통과).
function isCld(url) {
  return Boolean(url) && url.includes('res.cloudinary.com') && url.includes('/upload/');
}
// /upload/ 바로 뒤 세그먼트가 변환(f_auto,q_auto,w_… 등)이면 이미 변환된 URL이다.
// 버전(v123)·폴더(stacknstak)·public_id(1234-name)는 이 프리픽스에 걸리지 않는다.
function hasTransform(url) {
  const firstSeg = (url.split('/upload/')[1] || '').split('/')[0];
  return /(^|,)(f_|q_|w_|h_|c_|dpr_|ar_|e_|g_)/.test(firstSeg);
}

// Cloudinary delivery URL이면 변환(f_auto,q_auto[,w_N][,c_fill,ar_1:1][,dpr_2.0])을 주입, 아니면 원본 그대로.
// 로컬 /products/... 이나 빈 값은 통과 → 기존 이미지가 절대 깨지지 않는다.
// 이미 변환이 붙은 URL은 그대로 반환(이중 변환 방지).
export function cldUrl(url, { w, square } = {}) {
  if (!isCld(url) || hasTransform(url)) return url;
  const t = ['f_auto', 'q_auto'];
  if (w) t.push(`w_${w}`);
  if (square) t.push('c_fill', 'ar_1:1'); // 정사각 슬롯은 서버측 크롭으로 바이트↓
  // 작은 이미지(카드·썸네일)는 레티나에서 흐려지므로 2x로 선명하게.
  // 히어로·상세(대형)는 이미 커서 dpr까지 올리면 LCP 바이트만 늘어 제외.
  if (w && w <= 900) t.push('dpr_2.0');
  return url.replace('/upload/', `/upload/${t.join(',')}/`);
}

// 반응형 srcset 문자열(폭 서술자). 폭 서술자가 밀도(레티나)까지 처리하므로 dpr는 넣지 않는다.
// Cloudinary URL이 아니거나 이미 변환됐으면 undefined → <img>가 속성을 생략(src 폴백).
export function cldSrcSet(url, widths) {
  if (!isCld(url) || hasTransform(url)) return undefined;
  return widths
    .map((w) => `${url.replace('/upload/', `/upload/f_auto,q_auto,w_${w}/`)} ${w}w`)
    .join(', ');
}

// LQIP(저해상 blur 미리보기) URL — 카드 로딩 중 placeholder 배경용. 아니면 undefined.
export function cldLqip(url) {
  if (!isCld(url) || hasTransform(url)) return undefined;
  return url.replace('/upload/', '/upload/f_auto,q_auto:low,w_32,e_blur:1200/');
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
