import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

// 두 가지 자격증명 형식을 지원한다:
//  1) CLOUDINARY_URL (대시보드 기본 제공: cloudinary://<key>:<secret>@<cloud>) — SDK가 자동 파싱
//  2) 3개 분리 env (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)
// 둘 중 하나라도 갖춰지면 활성 — 없으면 업로드 엔드포인트가 503을 반환한다.
const has3Part = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
const hasUrl = Boolean(CLOUDINARY_URL);

export function isConfigured() {
  return hasUrl || has3Part;
}

if (has3Part) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
} else if (hasUrl) {
  // SDK가 process.env.CLOUDINARY_URL에서 cloud_name/api_key/api_secret을 파싱한다. secure만 덧붙인다.
  cloudinary.config({ secure: true });
}

export { cloudinary };
export const UPLOAD_FOLDER = 'stacknstak/products';
