# Cloudinary 이미지 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 상품 이미지 파일을 직접 업로드하고, 기존 로컬 14장을 Cloudinary로 마이그레이션하며, 스토어프론트가 Cloudinary 자동 최적화로 이미지를 전송한다.

**Architecture:** 서버 서명 업로드 — 브라우저 → Express(`requireAdmin`) → Cloudinary SDK. API secret은 서버에만 둔다. 같은 SDK 설정 모듈을 업로드 엔드포인트와 마이그레이션 스크립트가 공유한다.

**Tech Stack:** Node/Express(ESM) + Mongoose, React/Vite. 신규 의존성: 서버 `cloudinary` + `multer`. 클라이언트 추가 의존성 없음.

## Global Constraints

- 상품 이미지는 `Product.images: [String]`(URL 문자열 배열)로 저장 — **스키마 변경 없음**.
- 업로드 엔드포인트는 `requireAuth + requireAdmin`. 경로는 `/admin/uploads` (admin.js 라우터에 통합).
- Cloudinary 폴더: `stacknstak/products`.
- 허용 형식: `image/jpeg`, `image/png`, `image/webp`, `image/gif`. 최대 용량: **5MB**.
- env 미설정 시 업로드 엔드포인트는 크래시하지 않고 **503** 반환.
- 저장값은 원본 `secure_url`(변환 미포함). 변환은 렌더 시 `cldUrl`이 `f_auto,q_auto[,w_N]` 주입.
- 비-Cloudinary URL(로컬 `/products/lamp/...`, 빈 문자열)은 `cldUrl`이 **그대로 통과** — 절대 안 깨짐.
- `.env`는 `.gitignore`됨 — 자격증명 커밋/채팅 노출 금지. 각 커밋 전 `git status --porcelain | grep -E "\.env$"` 확인.
- **검증 관례:** 이 프로젝트는 유닛 테스트 하네스가 없다. 각 태스크의 "테스트"는 **curl 스모크 / node 스크립트 실행 / 브라우저 E2E**로 하며, 기대 출력까지 명시한다.

## File Structure

**서버 (신규)**
- `server/src/config/cloudinary.js` — env로 SDK 설정. `isConfigured()`, `cloudinary`, `UPLOAD_FOLDER` export.
- `server/src/controllers/uploadController.js` — `uploadImage(req,res)`.
- `server/src/scripts/migrateImagesToCloudinary.mjs` — 로컬 이미지 → Cloudinary, Product.images URL 교체.

**서버 (수정)**
- `server/src/routes/admin.js` — `POST /uploads` 라우트 + multer 래퍼 추가.
- `server/package.json` — deps + `migrate:images` 스크립트.
- `server/.env.example`, `render.yaml` — `CLOUDINARY_*` 3개.

**클라이언트 (신규)**
- `client/src/lib/cloudinary.js` — `cldUrl(url,{w})`, `uploadProductImage(file)`.

**클라이언트 (수정)**
- `client/src/pages/admin/ProductsAdmin.jsx` — 이미지 슬롯에 업로드 버튼.
- `client/src/components/ProductCard.jsx` — 카드 이미지에 `cldUrl` 적용.
- `client/src/pages/Product.jsx` — PDP 메인/썸네일/상세 이미지에 `cldUrl` 적용.

---

### Task 1: Cloudinary 설정 모듈 + 의존성 + env

**Files:**
- Create: `server/src/config/cloudinary.js`
- Modify: `server/package.json` (deps)
- Modify: `server/.env.example`
- Modify: `render.yaml`

**Interfaces:**
- Produces: `isConfigured(): boolean`, `cloudinary` (구성된 v2 인스턴스), `UPLOAD_FOLDER: string = 'stacknstak/products'` from `server/src/config/cloudinary.js`.

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/sw/project/stacknstak/server && npm install cloudinary multer
```

Expected: `cloudinary`, `multer`가 `dependencies`에 추가됨.

- [ ] **Step 2: 설정 모듈 작성**

Create `server/src/config/cloudinary.js`:

```js
import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

// 3개 env가 모두 있을 때만 업로드 기능 활성 — 하나라도 없으면 엔드포인트가 503을 반환한다.
export function isConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

if (isConfigured()) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export { cloudinary };
export const UPLOAD_FOLDER = 'stacknstak/products';
```

- [ ] **Step 3: .env.example 에 키 추가**

`server/.env.example` 끝에 추가:

```
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

- [ ] **Step 4: render.yaml 에 env 추가**

`render.yaml`의 해당 서비스 `envVars:` 목록에 추가(값은 Render 대시보드에서 입력하므로 `sync: false`):

```yaml
      - key: CLOUDINARY_CLOUD_NAME
        sync: false
      - key: CLOUDINARY_API_KEY
        sync: false
      - key: CLOUDINARY_API_SECRET
        sync: false
```

- [ ] **Step 5: 설정 모듈 동작 확인 (검증)**

Run (env 없이 → false):
```bash
cd /Users/sw/project/stacknstak/server && node -e "import('./src/config/cloudinary.js').then(m => console.log('isConfigured(no env):', m.isConfigured(), '| folder:', m.UPLOAD_FOLDER))"
```
Expected: `isConfigured(no env): false | folder: stacknstak/products`

Run (env 있으면 true — 실제 값으로):
```bash
CLOUDINARY_CLOUD_NAME=x CLOUDINARY_API_KEY=y CLOUDINARY_API_SECRET=z node -e "import('./src/config/cloudinary.js').then(m => console.log('isConfigured(with env):', m.isConfigured()))"
```
Expected: `isConfigured(with env): true`

- [ ] **Step 6: 커밋**

```bash
cd /Users/sw/project/stacknstak
git status --porcelain | grep -E "\.env$" && echo "!!! ENV STAGED — ABORT" || echo "env safe"
git add server/src/config/cloudinary.js server/package.json server/package-lock.json server/.env.example render.yaml
git commit -m "feat(cloudinary): SDK 설정 모듈 + 의존성 + env"
```

---

### Task 2: 업로드 엔드포인트 (POST /admin/uploads)

**Files:**
- Create: `server/src/controllers/uploadController.js`
- Modify: `server/src/routes/admin.js`

**Interfaces:**
- Consumes: `isConfigured`, `cloudinary`, `UPLOAD_FOLDER` (Task 1); `requireAuth`, `requireAdmin` from `../middleware/auth.js`; `asyncHandler` from `../utils/asyncHandler.js`.
- Produces: `POST /admin/uploads` — multipart 필드 `file` → `201 { url: string, publicId: string }`. 에러: 400/401/403/502/503.

- [ ] **Step 1: 컨트롤러 작성**

Create `server/src/controllers/uploadController.js`:

```js
import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// POST /admin/uploads (requireAuth + requireAdmin, multer single('file'))
export async function uploadImage(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ message: '이미지 업로드가 설정되지 않았습니다.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: '업로드할 이미지를 선택해주세요.' });
  }
  if (!ALLOWED.includes(req.file.mimetype)) {
    return res.status(400).json({ message: '허용되지 않은 이미지 형식입니다. (jpeg/png/webp/gif)' });
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: UPLOAD_FOLDER, resource_type: 'image' },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
      stream.end(req.file.buffer);
    });
    return res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  } catch {
    return res.status(502).json({ message: '이미지 업로드에 실패했습니다.' });
  }
}
```

- [ ] **Step 2: 라우트 추가 (multer 메모리 저장 + 에러 정규화)**

Modify `server/src/routes/admin.js` — import 블록에 추가:

```js
import multer from 'multer';
import * as uploadController from '../controllers/uploadController.js';
```

`const router = Router();` 아래에 추가:

```js
// 이미지 업로드용 multer(메모리 버퍼, 5MB 제한). 멀티파트 에러는 400으로 정규화.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '이미지는 5MB 이하만 업로드할 수 있습니다.' });
      }
      return res.status(400).json({ message: '이미지 업로드 처리 중 오류가 발생했습니다.' });
    }
    return next();
  });
}
```

`export default router;` 바로 위에 라우트 추가:

```js
router.post('/uploads', requireAuth, requireAdmin, uploadSingle, asyncHandler(uploadController.uploadImage));
```

- [ ] **Step 3: 서버 문법 확인**

```bash
cd /Users/sw/project/stacknstak/server && node --check src/controllers/uploadController.js && node --check src/routes/admin.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: 검증 — env 미설정 시 503**

로컬 서버를 CLOUDINARY_* 없이 기동한 상태에서(관리자 토큰 `$ATOK` 준비), 아무 작은 파일로:
```bash
printf 'x' > /tmp/t.png
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/admin/uploads \
  -H "Authorization: Bearer $ATOK" -F "file=@/tmp/t.png;type=image/png"
```
Expected: `503`

- [ ] **Step 5: 검증 — 정상 업로드 / 권한 / 형식**

서버를 CLOUDINARY_*(실제 값)와 함께 재기동한 뒤, 실제 이미지 파일 `/path/to/real.webp`로:
```bash
# 관리자: 201 + secure_url
curl -s -X POST http://localhost:4000/admin/uploads -H "Authorization: Bearer $ATOK" \
  -F "file=@/path/to/real.webp;type=image/webp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log("url:",d.url,"| publicId:",d.publicId)})'
# 비관리자(clientToken): 403
curl -s -o /dev/null -w "non-admin:%{http_code}\n" -X POST http://localhost:4000/admin/uploads -H "Authorization: Bearer $CLIENT_TOKEN" -F "file=@/path/to/real.webp;type=image/webp"
# 파일 없음: 400
curl -s -o /dev/null -w "no-file:%{http_code}\n" -X POST http://localhost:4000/admin/uploads -H "Authorization: Bearer $ATOK"
```
Expected: `url: https://res.cloudinary.com/.../stacknstak/products/....webp | publicId: stacknstak/products/...`, `non-admin:403`, `no-file:400`.

- [ ] **Step 6: 커밋**

```bash
cd /Users/sw/project/stacknstak
git add server/src/controllers/uploadController.js server/src/routes/admin.js
git commit -m "feat(cloudinary): POST /admin/uploads 서버 서명 업로드 엔드포인트"
```

---

### Task 3: 클라이언트 업로드 라이브러리 + 관리자 편집기 통합

**Files:**
- Create: `client/src/lib/cloudinary.js`
- Modify: `client/src/pages/admin/ProductsAdmin.jsx`

**Interfaces:**
- Consumes: `POST /admin/uploads` (Task 2); `api` from `../../lib/api.js`; `useToast` from `../../lib/toast.jsx`.
- Produces: `cldUrl(url: string, opts?: { w?: number }): string`, `uploadProductImage(file: File): Promise<{ url: string, publicId: string }>` from `client/src/lib/cloudinary.js`.

- [ ] **Step 1: 클라이언트 라이브러리 작성**

Create `client/src/lib/cloudinary.js`:

```js
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
```

- [ ] **Step 2: ProductsAdmin — import + ProductForm 상태/핸들러 추가**

Modify `client/src/pages/admin/ProductsAdmin.jsx`.

상단 import에 추가:
```js
import { uploadProductImage } from '../../lib/cloudinary.js';
```

`function ProductForm({ initial, onDone, onCancel }) {` 본문에서, 기존 `const [busy, setBusy] = useState(false);` 아래에 추가:
```js
  const toast = useToast();
  const [uploadingId, setUploadingId] = useState(null);

  const uploadTo = async (img, file) => {
    if (!file) return;
    setUploadingId(img.id);
    try {
      const { url } = await uploadProductImage(file);
      setF((s) => ({ ...s, images: s.images.map((x) => (x.id === img.id ? { ...x, url } : x)) }));
    } catch (e) {
      toast.error(e.response?.data?.message || '업로드에 실패했습니다.');
    } finally {
      setUploadingId(null);
    }
  };
```

- [ ] **Step 3: ProductsAdmin — 이미지 행에 업로드 버튼 추가**

같은 파일에서, 이미지 행의 URL `<input>`(현재 `placeholder="https://..."`) 바로 뒤, 위/아래 이동 버튼 앞에 업로드 버튼을 삽입한다. 아래 블록의 `<input ... placeholder="https://..." />` 다음 줄에 추가:

```jsx
                <label className="shrink-0 cursor-pointer border border-line px-2 py-2 text-[12px] hover:bg-tint">
                  {uploadingId === img.id ? '…' : '업로드'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => { uploadTo(img, e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
```

라벨 문구도 명확히: `<label className={label}>이미지 URL (순서 = 노출 순서, 첫 장이 대표)</label>` → `이미지 (파일 업로드 또는 URL, 순서 = 노출 순서, 첫 장이 대표)`.

- [ ] **Step 4: 클라이언트 빌드 확인**

```bash
cd /Users/sw/project/stacknstak/client && npm run build 2>&1 | tail -3
```
Expected: `✓ built in ...` (에러 없음).

- [ ] **Step 5: 검증 — 브라우저 E2E**

로컬 서버(CLOUDINARY_* 설정) + vite dev 기동, 관리자로 로그인:
1. `/admin/products` → 상품 편집(수정) 폼 열기.
2. 이미지 행의 "업로드" 클릭 → 실제 이미지 파일 선택.
3. 업로드 중 "…" 표시 후, URL 입력칸이 `https://res.cloudinary.com/.../stacknstak/products/...`로 채워지고 좌측 미리보기 썸네일이 뜨는지 확인.
4. 저장 → 목록/스토어프론트에서 해당 이미지가 보이는지 확인.

Expected: 업로드 후 슬롯 URL이 Cloudinary URL로 채워지고 저장·표시됨.

- [ ] **Step 6: 커밋**

```bash
cd /Users/sw/project/stacknstak
git add client/src/lib/cloudinary.js client/src/pages/admin/ProductsAdmin.jsx
git commit -m "feat(cloudinary): 관리자 이미지 파일 업로드 UI + cldUrl 헬퍼"
```

---

### Task 4: 스토어프론트 전송 최적화 (cldUrl 적용)

**Files:**
- Modify: `client/src/components/ProductCard.jsx`
- Modify: `client/src/pages/Product.jsx`

**Interfaces:**
- Consumes: `cldUrl` (Task 3).

- [ ] **Step 1: ProductCard 이미지에 cldUrl 적용**

Modify `client/src/components/ProductCard.jsx`.

상단 import에 추가:
```js
import { cldUrl } from '../lib/cloudinary.js';
```

이미지 `src={product.image}` 를 변경:
```jsx
          src={cldUrl(product.image, { w: 600 })}
```

- [ ] **Step 2: Product(PDP) 이미지들에 cldUrl 적용**

Modify `client/src/pages/Product.jsx`.

상단 import에 추가:
```js
import { cldUrl } from '../lib/cloudinary.js';
```

메인 이미지 `src={images[mainImg]}` 를 변경:
```jsx
            <img src={cldUrl(images[mainImg], { w: 1200 })} alt={product.ko} className="aspect-[4/5] w-full object-cover" />
```

썸네일 `<img src={src} ...>` 를 변경:
```jsx
                  <img src={cldUrl(src, { w: 160 })} alt="" className="h-full w-full object-cover" />
```

하단 상세 이미지 `<img src={product.image} ...>` 를 변경:
```jsx
          <img src={cldUrl(product.image, { w: 1200 })} alt={`${product.ko} 상세`} className="w-full object-cover" />
```

- [ ] **Step 3: 빌드 확인**

```bash
cd /Users/sw/project/stacknstak/client && npm run build 2>&1 | tail -3
```
Expected: `✓ built in ...`.

- [ ] **Step 4: 검증 — 브라우저**

vite dev에서 홈과 PDP 열기 → 개발자도구 또는 `browser_evaluate`로 렌더된 `<img>`의 src 확인:
- (마이그레이션 전) 로컬 이미지는 여전히 `/products/lamp/...` 원본 그대로여야 한다(통과 확인).
- (Task 5 이후) Cloudinary 이미지는 `/upload/f_auto,q_auto,w_600/...`(카드) 등 변환이 포함돼야 한다.

Expected: 비-Cloudinary URL 원본 유지, Cloudinary URL엔 `f_auto,q_auto,w_` 포함.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sw/project/stacknstak
git add client/src/components/ProductCard.jsx client/src/pages/Product.jsx
git commit -m "feat(cloudinary): 스토어프론트 이미지에 f_auto,q_auto,w_ 전송 최적화"
```

---

### Task 5: 마이그레이션 스크립트 (로컬 14장 → Cloudinary)

**Files:**
- Create: `server/src/scripts/migrateImagesToCloudinary.mjs`
- Modify: `server/package.json` (scripts)

**Interfaces:**
- Consumes: `cloudinary`, `isConfigured`, `UPLOAD_FOLDER` (Task 1); `Product` from `../models/Product.js`.

- [ ] **Step 1: 스크립트 작성**

Create `server/src/scripts/migrateImagesToCloudinary.mjs`:

```js
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';

// 안전장치: Atlas 등 원격 DB를 실수로 건드리지 않도록 명시 확인을 요구한다(seed와 동일 패턴).
if (process.env.MIGRATE_CONFIRM !== 'yes') {
  console.error('안전장치: MIGRATE_CONFIRM=yes 를 설정해야 실행됩니다.');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Cloudinary 환경변수(CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)가 필요합니다.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../../client/public'); // repo/client/public
const LOCAL_PREFIX = '/products/lamp/';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';
await mongoose.connect(uri);

const products = await Product.find({});
let changedProducts = 0;
let uploaded = 0;
let failed = 0;

for (const p of products) {
  let dirty = false;
  const next = [];
  for (const url of p.images || []) {
    if (!url.startsWith(LOCAL_PREFIX)) { next.push(url); continue; } // 이미 Cloudinary/외부 URL
    const localPath = path.join(PUBLIC_DIR, url);
    if (!fs.existsSync(localPath)) {
      console.warn('파일 없음, 건너뜀:', url);
      failed += 1; next.push(url); continue;
    }
    const base = path.basename(url, path.extname(url)); // 확장자 제거 → 멱등 public_id
    try {
      const r = await cloudinary.uploader.upload(localPath, {
        folder: UPLOAD_FOLDER, public_id: base, overwrite: true,
      });
      next.push(r.secure_url); uploaded += 1; dirty = true;
    } catch (e) {
      console.error('업로드 실패:', url, e.message);
      failed += 1; next.push(url);
    }
  }
  if (dirty) { p.images = next; await p.save(); changedProducts += 1; }
}

console.log(`완료 — 변경 상품 ${changedProducts} / 업로드 ${uploaded} / 실패 ${failed}`);
await mongoose.disconnect();
```

- [ ] **Step 2: npm 스크립트 추가**

`server/package.json`의 `"scripts"`에 추가:
```json
    "migrate:images": "node src/scripts/migrateImagesToCloudinary.mjs"
```

- [ ] **Step 3: 문법 확인**

```bash
cd /Users/sw/project/stacknstak/server && node --check src/scripts/migrateImagesToCloudinary.mjs && echo OK
```
Expected: `OK`

- [ ] **Step 4: 검증 — 안전장치**

```bash
cd /Users/sw/project/stacknstak/server && node src/scripts/migrateImagesToCloudinary.mjs; echo "exit=$?"
```
Expected: `안전장치: MIGRATE_CONFIRM=yes ...` + `exit=1` (실행 안 됨).

- [ ] **Step 5: 검증 — 로컬 DB 마이그레이션 실행**

`server/.env`에 CLOUDINARY_* 설정 후, 로컬 Mongo 대상으로:
```bash
cd /Users/sw/project/stacknstak/server && MIGRATE_CONFIRM=yes npm run migrate:images
```
Expected: `완료 — 변경 상품 14 / 업로드 14 / 실패 0` (로컬 14개 상품 1장씩).

DB 반영 확인:
```bash
cd /Users/sw/project/stacknstak/server && node -e "import('dotenv/config').then(async()=>{const m=await import('mongoose');await m.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/stacknstak');const P=(await import('./src/models/Product.js')).default;const one=await P.findOne({});console.log('sample images[0]:', one.images[0]);const localLeft=await P.countDocuments({images:{\$regex:'^/products/lamp/'}});console.log('남은 로컬경로 상품 수:', localLeft);await m.disconnect();})"
```
Expected: `sample images[0]: https://res.cloudinary.com/.../stacknstak/products/....webp`, `남은 로컬경로 상품 수: 0`.

- [ ] **Step 6: 검증 — 멱등 재실행 + 렌더**

재실행:
```bash
cd /Users/sw/project/stacknstak/server && MIGRATE_CONFIRM=yes npm run migrate:images
```
Expected: `완료 — 변경 상품 0 / 업로드 0 / 실패 0` (이미 Cloudinary URL이라 변경 없음).

브라우저: 홈/PDP에서 이미지가 Cloudinary URL(+ `f_auto,q_auto,w_`)로 정상 렌더되는지 확인.

- [ ] **Step 7: 커밋**

```bash
cd /Users/sw/project/stacknstak
git add server/src/scripts/migrateImagesToCloudinary.mjs server/package.json
git commit -m "feat(cloudinary): 로컬 이미지 → Cloudinary 마이그레이션 스크립트(멱등)"
```

---

### Task 6: 배포 — Render env + 푸시 + Atlas 마이그레이션 + 라이브 검증

**Files:** (코드 변경 없음 — 운영/배포)

- [ ] **Step 1: 로컬 커밋 푸시**

```bash
cd /Users/sw/project/stacknstak && git push origin main 2>&1 | tail -3
```
Expected: `main -> main`.

- [ ] **Step 2: Render 환경변수 설정 (사용자 작업)**

Render 대시보드 → 서비스 → Environment → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` 값 입력 → 재배포 트리거.

- [ ] **Step 3: 라이브 업로드 엔드포인트 확인**

재배포 후(관리자 라이브 토큰 `$LATOK`):
```bash
API="https://stacknstak-api.onrender.com"
# 미인증: 401
curl -s -o /dev/null -w "noauth:%{http_code}\n" -X POST "$API/admin/uploads"
# 관리자 + 실제 이미지: 201 + secure_url
curl -s -X POST "$API/admin/uploads" -H "Authorization: Bearer $LATOK" -F "file=@/path/to/real.webp;type=image/webp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log("live url:",d.url)})'
```
Expected: `noauth:401`, `live url: https://res.cloudinary.com/...`.

- [ ] **Step 4: Atlas 마이그레이션 실행**

로컬에서 Atlas를 대상으로(스크립트가 CLOUDINARY_*는 `server/.env`에서, MONGODB_URI는 인라인으로):
```bash
cd /Users/sw/project/stacknstak/server && MIGRATE_CONFIRM=yes MONGODB_URI="<ATLAS_URI>" npm run migrate:images
```
Expected: `완료 — 변경 상품 14 / 업로드 0(멱등: public_id 동일) 또는 14 / 실패 0` — 남은 로컬경로 0.

> 참고: public_id가 로컬 실행과 동일(`stacknstak/products/<basename>`)하므로 Cloudinary에는 이미 자산이 있고 `overwrite:true`로 재업로드된다. Atlas의 Product.images만 로컬경로 → secure_url로 교체된다.

- [ ] **Step 5: 라이브 스토어프론트 확인**

Vercel 프론트에서 홈/PDP 열기 → 상품 이미지가 Cloudinary URL로 렌더되고 깨지지 않는지 확인.

Expected: 모든 상품 이미지가 `res.cloudinary.com`에서 로드됨.

---

## Self-Review

**1. Spec coverage:**
- 데이터 모델(변경 없음, URL 교체) → Task 5. ✅
- 서버 업로드 엔드포인트(503/400/403/502, folder, 형식·용량) → Task 2. ✅
- 마이그레이션(멱등, MIGRATE_CONFIRM, 로컬→Atlas) → Task 5, 6. ✅
- 프론트 업로드 UI(슬롯 업로드 버튼, URL 입력 유지, 토스트) → Task 3. ✅
- 전송 최적화(cldUrl f_auto,q_auto,w_; 비-Cloudinary 통과) → Task 3(헬퍼), 4(적용). ✅
- env/의존성(.env.example, render.yaml, cloudinary+multer) → Task 1. ✅
- 검증(curl/브라우저/스크립트) → 각 태스크 검증 스텝. ✅
- 범위 밖(서명 파라미터, 위젯, 크롭, srcset, 고아 자산 정리) → 계획에 미포함(의도적). ✅

**2. Placeholder scan:** `<ATLAS_URI>`, `$ATOK`, `$LATOK`, `/path/to/real.webp`는 실행자가 채우는 실제 자격증명/파일 경로 자리이며 코드 플레이스홀더가 아니다(값 노출 금지 원칙상 명시적으로 비워둠). 코드 스텝은 모두 완전한 코드 포함.

**3. Type consistency:** `cldUrl(url, { w })`·`uploadProductImage(file) → { url, publicId }`·`isConfigured()`·`UPLOAD_FOLDER`·`cloudinary` 이름이 정의(Task 1,3)와 사용처(Task 2,4,5)에서 일치. 업로드 응답 `{ url, publicId }`가 컨트롤러·클라이언트·편집기 핸들러에서 일관.
