import { cloudinary, isConfigured } from '../config/cloudinary.js';

// Cloudinary delivery URL에서 public_id를 복원한다(아니면 null).
// DB에 저장되는 secure_url은 변환이 없는 clean URL이라
//   https://res.cloudinary.com/<cloud>/image/upload/v<digits>/stacknstak/products/<id>.<ext>
// 형태다(f_auto 등 변환은 렌더 시점에만 주입, 저장 안 됨). /upload/ 뒤에서
// 선행 버전(v숫자)과 확장자만 벗기면 public_id(`stacknstak/products/<id>`)가 남는다.
export function publicIdFromUrl(url) {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) {
    return null;
  }
  const after = url.split('/upload/')[1];
  if (!after) return null;
  const segs = after.split('?')[0].split('#')[0].split('/');
  if (segs.length > 1 && /^v\d+$/.test(segs[0])) segs.shift(); // 버전 세그먼트 제거
  const joined = segs.join('/');
  const slash = joined.lastIndexOf('/');
  const dot = joined.lastIndexOf('.');
  return (dot > slash ? joined.slice(0, dot) : joined) || null; // 확장자 제거
}

// 더 이상 참조되지 않는 Cloudinary 자산을 best-effort로 삭제한다.
// 로컬/외부 URL은 publicIdFromUrl이 null을 주므로 자동으로 건너뛴다.
// 실패해도 상위 삭제/수정 흐름은 막지 않는다(코드베이스 swallow 관례) — 단서는 로그로 남긴다.
export async function destroyUnreferenced(urls) {
  if (!isConfigured()) return;
  const ids = [...new Set((urls || []).map(publicIdFromUrl).filter(Boolean))];
  await Promise.all(ids.map(async (publicId) => {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    } catch (err) {
      console.error('[cloudinary destroy]', publicId, err?.http_code, err?.message);
    }
  }));
}
