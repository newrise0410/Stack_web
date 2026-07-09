# Cloudinary 이미지 통합 설계

> Stack N' Stak (스터디용 3D 프린팅 조명 쇼핑몰). 상품 이미지를 Cloudinary로 업로드·전송한다.

**목표:** 관리자가 상품 이미지 **파일을 직접 업로드**하고(현재는 URL 붙여넣기만 가능), 기존 로컬 14장을 Cloudinary로 **마이그레이션**하며, 스토어프론트가 Cloudinary 자동 최적화(`f_auto,q_auto`)로 이미지를 전송한다.

**아키텍처:** 서버 서명 업로드(A안) — 브라우저 → Express(`requireAdmin`) → Cloudinary SDK. API secret은 서버에만 둔다. 같은 SDK 설정으로 마이그레이션 스크립트도 실행한다.

**기술 스택:** Node/Express(ESM) + Mongoose, React/Vite. 신규 의존성: 서버 `cloudinary`(공식 SDK) + `multer`(멀티파트, memoryStorage). 클라이언트 추가 의존성 없음(기존 axios).

## 전역 제약 (Global Constraints)

- 상품 이미지는 `Product.images: [String]`(URL 문자열 배열)로 저장. **스키마 변경 없음.**
- 돈/권한 등 기존 서버권위 패턴 유지: 업로드는 `requireAuth + requireAdmin`.
- `.env`는 `.gitignore`됨 — 자격증명은 절대 커밋/채팅에 노출 금지. 각 커밋 전 `git status --porcelain | grep -E "\.env$"`로 확인.
- Cloudinary 폴더: `stacknstak/products`.
- 허용 형식: `image/jpeg`, `image/png`, `image/webp`, `image/gif`. 최대 용량: 5MB.
- env 미설정 시 업로드 엔드포인트는 크래시하지 않고 **503**(기능 비활성) 반환.
- Cloudinary URL이 아닌 값(로컬 `/products/lamp/...`, 빈 문자열)은 변환 헬퍼가 **그대로 통과**시켜 절대 깨지지 않게 한다(하위호환).

---

## 데이터 모델

`Product.images: [String]` 그대로 사용. 각 원소는 하나의 이미지 URL이며 `images[0]`이 대표 이미지.

- 마이그레이션은 로컬 경로 문자열(`/products/lamp/x.webp`)을 Cloudinary `secure_url`로 **교체**만 한다.
- 저장값은 Cloudinary가 돌려준 **원본 `secure_url`**(변환 미포함). 변환은 렌더 시점에 URL에 주입한다(eager 변환 안 씀).
- 로컬 URL과 Cloudinary URL이 섞여 있어도 정상 동작.

## 컴포넌트 및 파일 구조

**서버**
- `server/src/config/cloudinary.js` — env로 SDK 설정. `isConfigured()`(3개 env 존재 여부)와 `cloudinary` 인스턴스 export.
- `server/src/controllers/uploadController.js` — `uploadImage(req,res)`: 파일 검증 → `upload_stream` → `{ url, publicId }` 반환.
- `server/src/routes/uploads.js` — `POST /uploads` (multer single('file') + requireAuth + requireAdmin). `admin.js`에 `router.use('/uploads', ...)`로 마운트하거나 `app.js`에서 `/admin/uploads`로 마운트. **결정: `admin.js` 라우터에 통합**(기존 admin 라우트와 일관).
- `server/src/scripts/migrateImagesToCloudinary.mjs` — 로컬 이미지 → Cloudinary 업로드 후 Product.images URL 교체. `MIGRATE_CONFIRM=yes` 가드.

**클라이언트**
- `client/src/lib/cloudinary.js` — `cldUrl(url, { w })`: Cloudinary delivery URL이면 `/upload/` 뒤에 `f_auto,q_auto`(+선택 `w_<n>`) 주입, 아니면 그대로 반환. `uploadProductImage(file)`: `POST /admin/uploads`에 FormData 전송, `{ url, publicId }` 반환.
- `client/src/pages/admin/ProductsAdmin.jsx` — 이미지 편집기 각 슬롯에 "업로드" 파일 버튼 추가(성공 시 반환 URL을 슬롯 `url`에 채움). 기존 URL 텍스트 입력 **유지**. 업로드 중 비활성/스피너 + 토스트.
- 표시 최적화: `client/src/lib/products.js`의 `normalizeProduct` 또는 표시 컴포넌트에서 `cldUrl` 적용 — ProductCard `w_600`, PDP 메인 `w_1200`, PDP 썸네일 `w_160`.

## 데이터 흐름

**업로드**
1. 관리자가 ProductsAdmin 이미지 슬롯에서 파일 선택.
2. 클라이언트가 `FormData`(`file`)를 `POST /admin/uploads`에 axios로 전송(Authorization: Bearer).
3. 서버: multer가 메모리 버퍼로 파싱 → mimetype/용량 검증 → `cloudinary.uploader.upload_stream({ folder: 'stacknstak/products' })`.
4. 서버가 `{ url: result.secure_url, publicId: result.public_id }` 반환.
5. 클라이언트가 해당 슬롯 `url`을 반환 URL로 설정 → 미리보기 표시. 상품 저장 시 기존대로 `PATCH /products/:id`로 `images[]` 저장.

**전송(렌더)**
- 표시 시 `cldUrl(url, { w })`가 Cloudinary URL에 `f_auto,q_auto,w_<n>` 주입 → 브라우저에 최적 포맷/화질/폭으로 전송. 비-Cloudinary URL은 원본 그대로.

**마이그레이션**
1. `MIGRATE_CONFIRM=yes MONGODB_URI=... CLOUDINARY_*=... node server/src/scripts/migrateImagesToCloudinary.mjs`
2. 모든 Product를 순회, 각 `images[]` 원소 중 `/products/lamp/`로 시작하는 것을 `client/public/products/lamp/<basename>` 실제 파일로 해석.
3. `cloudinary.uploader.upload(localPath, { folder:'stacknstak/products', public_id:<basename-without-ext>, overwrite:true })` → 멱등.
4. 성공 시 해당 원소를 `secure_url`로 교체, Product 저장. 실패는 로깅 후 다음 항목 계속(전체 중단 안 함).
5. 요약 출력: 처리 상품 수 / 교체 이미지 수 / 실패 수.

## 에러 처리

- **업로드 엔드포인트**: 400(파일 없음 / 허용 안 된 형식 / 5MB 초과), 401(비로그인)·403(비관리자, 미들웨어), 502(Cloudinary 업로드 실패), 503(Cloudinary env 미설정). 모든 응답은 `{ message }` JSON.
- multer 용량 초과(`LIMIT_FILE_SIZE`)는 400 + "이미지는 5MB 이하만 업로드할 수 있습니다."로 정규화(라우트 레벨 에러 핸들러 또는 컨트롤러 try/catch).
- **클라이언트**: 업로드 실패 시 토스트(`e.response?.data?.message || '업로드에 실패했습니다.'`), 슬롯 값 미변경, 스피너 해제.
- **마이그레이션**: 파일 없음/업로드 실패는 해당 항목만 스킵 + 로깅. 멱등이라 재실행으로 복구.
- **`cldUrl`**: 입력이 falsy거나 `res.cloudinary.com`을 포함하지 않으면 원본 반환 — 기존 이미지 절대 안 깨짐.

## 환경변수 / 설정

- 추가: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- 반영 위치: `server/.env`(값 실제 입력), `server/.env.example`(플레이스홀더), `render.yaml`(3개 `sync:false`).
- `config/cloudinary.js`가 셋 다 있으면 `cloudinary.config()` 호출. 하나라도 없으면 `isConfigured()===false` → 업로드 503, 마이그레이션은 명확한 에러로 조기 종료.

## 검증 (유닛 테스트 하네스 없음 — 프로젝트 관례)

1. **업로드 curl**: 관리자 토큰 + 테스트 이미지로 `POST /admin/uploads` → `secure_url` 반환 확인. 비관리자 토큰 → 403. env 미설정 → 503. 5MB 초과 → 400.
2. **브라우저 E2E**: 관리자 상품 편집 → 파일 업로드 → 미리보기 표시 → 저장 → 스토어프론트에서 해당 이미지 렌더 확인.
3. **마이그레이션**: 로컬 DB에서 먼저 실행 → 14개 상품의 로컬 경로가 Cloudinary URL로 바뀌고 홈/PDP에서 정상 렌더 확인. 재실행 멱등 확인. 이후 Atlas 적용.
4. **전송 최적화**: 렌더된 `<img src>`가 `f_auto,q_auto,w_...`를 포함하는지 확인, 비-Cloudinary(남은 로컬) URL은 원본 그대로인지 확인.

## 범위 밖 (YAGNI)

- 서명 파라미터/브라우저 직접 업로드(B·C안), 업로드 위젯.
- 이미지 크롭/에디팅 UI, 다중 파일 드래그드롭(단순 파일 인풋으로 충분).
- Cloudinary 폴더/에셋 관리 화면, 삭제 시 Cloudinary 원본 제거(상품에서 URL만 제거; 고아 에셋 정리는 범위 밖).
- 반응형 `srcset`(단일 `w_` 주입으로 충분; 필요 시 후속).
