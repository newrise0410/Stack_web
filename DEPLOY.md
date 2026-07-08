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
MONGODB_URI="<위 Atlas 문자열>" npm run seed
# → Seeded 14 products.
```

> 관리자 계정은 배포 후 회원가입 → Atlas(Compass 또는 Atlas UI)에서 해당 유저의 `role`을 `admin`으로 변경.

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

   ```bash
   openssl rand -hex 32   # JWT_SECRET 생성용
   ```
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

## 5. 확인

- Vercel 주소 접속 → 홈에 상품 노출 (Atlas에서 옴)
- 회원가입 / 로그인 / 소셜로그인 → 환영페이지 → 메인
- 마이페이지 배송지, 관리자(`/admin`) 동작

## 이후 배포

`git push` 하면 Vercel·Render 둘 다 자동 재배포됩니다.

## 주의 (스터디 배포)

- 소셜로그인은 **mock**(데모 계정)이라 실제 구글/카카오 인증이 아닙니다.
- 결제/주문은 아직 미구현.
- MakerWorld 이미지는 `client/public/`에 포함되어 함께 배포됩니다.
