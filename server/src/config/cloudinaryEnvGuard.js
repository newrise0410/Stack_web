// cloudinary 패키지는 import(로드) 시점에 process.env.CLOUDINARY_URL을 즉시 파싱하며,
// 형식이 틀리면(스킴 누락·따옴표·개행 등) 동기 throw한다 → 서버가 부팅 단계에서 죽는다.
// 그래서 cloudinary import보다 "먼저" 실행되도록 이 모듈을 config/cloudinary.js 최상단에서 import해,
// 값을 검사·정리한다. 유효하면 앞뒤 공백만 제거해 되돌려 넣고, 유효하지 않으면 제거(→ 미설정=503 처리).
const raw = process.env.CLOUDINARY_URL;
if (raw != null) {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('cloudinary://')) {
    process.env.CLOUDINARY_URL = trimmed; // 주변 공백/개행 제거해 SDK 파싱 실패 방지
  } else {
    delete process.env.CLOUDINARY_URL; // 형식 오류 → 미설정 처리(부팅 크래시 방지)
  }
}
