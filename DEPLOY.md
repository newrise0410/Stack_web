# 배포 가이드 (중간 배포)

**구성:** 프론트 = Vercel · 백엔드 = Render · DB = MongoDB Atlas (모두 무료 티어)

```
[사용자] → Vercel (React 정적) → Render (Express API) → MongoDB Atlas
```

코드는 이미 배포 준비 완료:
- API 주소 `VITE_API_URL` env화 (`client/src/lib/api.js`)
- DB/JWT/CORS 전부 env화
- `client/vercel.json` (SPA 라우팅), `render.yaml` (백엔드 블루프린트), 루트 `.gitignore`

---

## 0. Git + GitHub (최초 1회)

배포 플랫폼은 GitHub 저장소에서 배포합니다.

```bash
cd /Users/sw/project/stacknstak
git init
git add .
git commit -m "Stack N' Stak: 중간 배포"
# GitHub에서 빈 저장소 생성 후:
git remote add origin https://github.com/<계정>/stacknstak.git
git branch -M main
git push -u origin main
```

> `.env` 파일은 `.gitignore`로 커밋에서 제외됩니다(비밀키 보호). 배포 플랫폼엔 대시보드에서 직접 입력합니다.

---

## 1. MongoDB Atlas (클라우드 DB)

1. https://www.mongodb.com/atlas 가입 → **Create** → **M0 (Free)** 클러스터 생성
2. **Database Access** → 사용자 추가 (username/password 기록)
3. **Network Access** → **Add IP** → `0.0.0.0/0` (어디서나 허용 — Render가 접속)
4. **Connect** → **Drivers** → 연결 문자열 복사:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/stacknstak?retryWrites=true&w=majority
   ```
   끝에 DB 이름 `/stacknstak`를 꼭 넣으세요.

### 상품 데이터 시드 (로컬에서 Atlas로)

```bash
cd /Users/sw/project/stacknstak/server
MONGODB_URI="<위 Atlas 문자열>" SEED_CONFIRM=yes npm run seed
# → Seeded 14 products (removed 0 stale).
# (원격 DB 안전장치: SEED_CONFIRM=yes 없으면 실행 거부. slug 기준 upsert라 카탈로그가 비는 구간 없음)
```

> 관리자 계정은 배포 후 회원가입 → Atlas(Compass 또는 Atlas UI)에서 해당 유저의 `role`을 `admin`으로 변경.

### 이미지 → Cloudinary 마이그레이션 (선택, seed 뒤에)

시드 상품은 `client/public/products/lamp/...` 로컬 경로를 가리킵니다. Cloudinary로 옮기려면
**seed를 먼저 돌린 뒤**(상품이 있어야 함) 아래를 실행하면, 로컬 이미지를 업로드하고 상품의
`images`를 Cloudinary URL로 덮어씁니다. `public_id`가 파일명으로 고정돼 **여러 번 돌려도 안전(멱등)** 합니다.

```bash
cd /Users/sw/project/stacknstak/server
MONGODB_URI="<Atlas 문자열>" CLOUDINARY_URL="<cloudinary URL>" \
  MIGRATE_CONFIRM=yes npm run migrate:images
# → 완료 — 변경 상품 N / 업로드 N / 실패 0
```

> 마이그레이션을 건너뛰어도 됩니다 — 로컬 `/products/...` 이미지는 프론트에서 그대로 렌더되고,
> 렌더 최적화 헬퍼(`cldUrl`)가 로컬 경로는 변환 없이 통과시킵니다.

**고아 자산 청소(선택, 운영 유지보수):** 어떤 상품도 참조하지 않는 Cloudinary 자산(저장 안 한 업로드 등)을 정리한다.
기본은 dry-run(보기만), `SWEEP_CONFIRM=yes`를 줘야 실제 삭제.

```bash
cd /Users/sw/project/stacknstak/server
MONGODB_URI="<Atlas 문자열>" CLOUDINARY_URL="<cloudinary URL>" npm run sweep:images            # dry-run
MONGODB_URI="<Atlas 문자열>" CLOUDINARY_URL="<cloudinary URL>" SWEEP_CONFIRM=yes npm run sweep:images  # 실제 삭제
```

---

## 2. 백엔드 배포 (Render)

1. https://render.com 가입 → **New +** → **Blueprint** → GitHub 저장소 선택
   (저장소의 `render.yaml`을 자동 인식 → `stacknstak-api` 웹 서비스 생성)
2. **Environment**에 값 입력:
   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | Atlas 연결 문자열 |
   | `JWT_SECRET` | 긴 랜덤 문자열 (아래 명령으로 생성) |
   | `CLIENT_ORIGIN` | *(3단계 Vercel 주소 나온 뒤 입력)* |
   | `JWT_EXPIRES_IN` | `7d` (기본값) |
   | `CLOUDINARY_URL` | Cloudinary 대시보드 → API Environment variable (`cloudinary://<key>:<secret>@<cloud>`) *(선택 — 미설정 시 관리자 이미지 업로드만 503)* |
   | `PORTONE_IMP_KEY` | 포트원 REST API Key (콘솔 > 결제연동 > 식별코드·API Keys) |
   | `PORTONE_IMP_SECRET` | 포트원 REST API Secret |

   ```bash
   openssl rand -hex 32   # JWT_SECRET 생성용
   ```

   > **이미지 업로드(Cloudinary):** 관리자 상품 이미지 업로드는 Cloudinary를 씁니다.
   > `CLOUDINARY_URL`을 넣지 않으면 업로드 엔드포인트만 **503**을 반환하고 나머지 기능은 정상 동작합니다.
   > (3개 분리 형식 `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`도 지원)
3. 배포 완료 후 URL 확인 (예: `https://stacknstak-api.onrender.com`)
   - `https://<render주소>/health` 접속 → `{"status":"ok"}` 뜨면 성공
   - `https://<render주소>/products` → 상품 14개 JSON

> ⚠️ 무료 플랜은 15분 무접속 시 잠들어 **첫 요청이 ~50초** 걸립니다(콜드 스타트). 정상입니다.

---

## 3. 프론트 배포 (Vercel)

1. https://vercel.com 가입 → **Add New** → **Project** → GitHub 저장소 선택
2. **Root Directory** → `client` 로 지정 (중요! 모노레포라서)
   - Framework: Vite (자동 인식), Build: `npm run build`, Output: `dist`
3. **Environment Variables** 추가:
   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | Render 백엔드 루트 URL (예: `https://stacknstak-api.onrender.com`) |

   > 끝에 `/api`를 **붙이지 마세요.** 백엔드 라우트가 `/auth` `/products`로 바로 시작합니다.
4. **Deploy** → 완료되면 주소 확인 (예: `https://stacknstak.vercel.app`)

---

## 4. CORS 연결 (마무리)

1. Render 대시보드 → 백엔드 서비스 → **Environment** → `CLIENT_ORIGIN`에 Vercel 주소 입력
   ```
   CLIENT_ORIGIN=https://stacknstak.vercel.app
   ```
2. 저장 → 자동 재배포. 이제 프론트만 API 호출 허용됩니다.

---

## 5. 포트원(아임포트) 결제 설정

1. https://admin.portone.io 가입 → 결제 연동 > 연동 정보 > **V1 API** 키 확인
   - `가맹점 식별코드(imp...)` → 프론트 `VITE_PORTONE_IMP_CODE`
   - `REST API Key/Secret` → 백엔드 `PORTONE_IMP_KEY` / `PORTONE_IMP_SECRET`
2. 결제 연동 > 채널 관리 → **KG이니시스** 테스트 채널 생성
   - 채널키를 쓰려면 프론트 `VITE_PORTONE_CHANNEL_KEY`에 설정(미설정 시 pg:'html5_inicis' 사용)
3. 웹훅: 결제 연동 > 웹훅 관리 → URL `https://<render-domain>/payments/webhook`, 버전 v1
   - 로컬 개발은 웹훅 없이도 동작(클라이언트 콜백 검증 + 60초 reconciler)
4. 테스트 결제는 실제 승인 후 **당일 자동 취소**된다(실청구 없음).

---

## 6. 확인

- Vercel 주소 접속 → 홈에 상품 노출 (Atlas에서 옴)
- 회원가입 / 로그인 / 소셜로그인 → 환영페이지 → 메인
- 마이페이지 배송지, 관리자(`/admin`) 동작

## 이후 배포

`git push` 하면 Vercel·Render 둘 다 자동 재배포됩니다.

## 주의 (스터디 배포)

- 소셜로그인은 **mock**(데모 계정)이라 실제 구글/카카오 인증이 아닙니다.
- 결제/주문은 아직 미구현.
- MakerWorld 이미지는 `client/public/`에 포함되어 함께 배포됩니다.
