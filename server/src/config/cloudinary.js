import './cloudinaryEnvGuard.js'; // ⚠️ cloudinary import보다 먼저 — 잘못된 CLOUDINARY_URL을 정리해 부팅 크래시 방지
import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

// 두 가지 자격증명 형식을 지원한다:
//  1) CLOUDINARY_URL (대시보드 기본 제공: cloudinary://<key>:<secret>@<cloud>) — SDK가 자동 파싱
//  2) 3개 분리 env (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)
// 둘 중 하나라도 갖춰지면 활성 — 없으면 업로드 엔드포인트가 503을 반환한다.
const has3Part = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
const hasUrl = Boolean(CLOUDINARY_URL);

// 실제 설정 성공 여부. 잘못된 CLOUDINARY_URL(스킴 누락·따옴표·개행 등)은 SDK가 import 시점에
// 동기 throw하므로, try/catch로 감싸 부팅 크래시 대신 "미설정(→503)"으로 안전하게 강등한다.
let configured = false;

if (has3Part) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
} else if (hasUrl) {
  try {
    // SDK가 process.env.CLOUDINARY_URL에서 cloud_name/api_key/api_secret을 파싱한다. secure만 덧붙인다.
    cloudinary.config({ secure: true });
    configured = Boolean(cloudinary.config().cloud_name); // 파싱 성공(cloud_name 채워짐) 확인
  } catch {
    configured = false; // 형식 오류 → 미설정 처리(엔드포인트가 503 반환)
  }
}

export function isConfigured() {
  return configured;
}

export { cloudinary };
export const UPLOAD_FOLDER = 'stacknstak/products';
