import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

// ── Sub-schemas ──────────────────────────────────────────────

// 배송지. timestamps로 각 주소의 등록/수정 시각도 기록.
const addressSchema = new Schema(
  {
    label: { type: String, trim: true }, // 집 / 회사
    recipient: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    zipcode: { type: String, required: true, trim: true },
    address1: { type: String, required: true, trim: true }, // 우편번호 검색 자동입력
    address2: { type: String, trim: true }, // 상세주소 직접입력
    deliveryMemo: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const consentSchema = new Schema(
  {
    agreed: { type: Boolean, default: false },
    at: Date,
    version: String,
  },
  { _id: false },
);

// 약관 동의 이력 (동의여부 + 시각 + 버전)
const agreementsSchema = new Schema(
  {
    termsOfService: { type: consentSchema, default: () => ({}) }, // 필수
    privacy: { type: consentSchema, default: () => ({}) }, // 필수
    ageOver14: {
      agreed: { type: Boolean, default: false },
      at: Date,
    }, // 필수
    marketing: {
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
      at: Date,
    }, // 선택
    thirdParty: {
      agreed: { type: Boolean, default: false },
      at: Date,
    }, // 선택
  },
  { _id: false },
);

// ── User schema ──────────────────────────────────────────────

const userSchema = new Schema(
  {
    // 탈퇴 시 `withdrawn_<_id>@deleted.local`로 재작성된다(파기 + unique 해소).
    // partial unique index를 쓰지 않는 이유: 이메일 자체가 파기 대상 PII인데 원문을 남기게 되고,
    // 운영 중인 Atlas에서 기존 unique 인덱스를 partial로 바꾸려면 dropIndex→createIndex 사이에
    // 유니크가 사라지는 창이 열린다(autoIndex는 IndexOptionsConflict를 자동 해결하지 않는다).
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // 기본 조회에서 제외(select:false). 로그인 시 .select('+passwordHash') 필요.
    // 탈퇴 시 $unset → comparePassword가 false를 반환해 login이 기존 401로 자연 낙하한다.
    // login에 status 체크를 넣지 않는 이유 — 계정 존재 여부를 노출하지 않으려는 기존 정책.
    passwordHash: { type: String, select: false },

    provider: {
      type: String,
      enum: ['local', 'kakao', 'naver', 'google', 'apple'],
      default: 'local',
    },
    // 탈퇴 시 null로 파기 → socialLogin의 findOne({provider,providerId})이 tombstone을
    // 찾지 못해 재로그인이 새 계정을 만든다(의도된 완전 단절). {provider,providerId}
    // 인덱스는 unique가 아니라 null이 여러 tombstone에 있어도 충돌하지 않는다.
    providerId: { type: String, default: null },

    name: { type: String, required: true, trim: true }, // 실명(주문/배송용)
    nickname: { type: String, default: null, trim: true }, // 선택(공개 표시명)
    // 소셜 가입은 전화번호가 없을 수 있어 로컬 계정만 필수.
    phone: {
      type: String,
      required: function requirePhone() {
        return this.provider === 'local';
      },
      trim: true,
    },

    // 클라이언트가 임의 지정 불가 — 회원가입 라우트에서 항상 client로 강제할 것.
    role: { type: String, enum: ['client', 'admin'], default: 'client' },

    // 계정 상태. suspended면 로그인 차단. withdrawn은 탈퇴 tombstone(PII 파기 완료).
    // 별도 isWithdrawn 불리언을 만들지 않는 이유 — 차단 로직이 이미 전부 status 기반이라
    // (middleware/auth.js, authController) 새 축을 만들면 한쪽을 빠뜨리는 구멍이 생긴다.
    // ⚠️ 관리자 PATCH /users/:id/status는 여전히 ['active','suspended']만 허용한다.
    //    withdrawn을 상태 변경으로 찍으면 파기 절차 없이 PII가 남은 좀비 문서가 된다.
    //    탈퇴는 DELETE /users/:id(withdrawalService) 경로 전용 — 이 비대칭은 사양이다.
    status: { type: String, enum: ['active', 'suspended', 'withdrawn'], default: 'active' },

    // 탈퇴 시각. 전자상거래법 5년 보관 만료 시점을 계산할 유일한 기준점
    // (updatedAt은 다른 수정에도 갱신돼 신뢰할 수 없다).
    // ⚠️ 함정: BSON 비교 순서상 Null < Date라 `withdrawnAt: { $lte: cutoff }`는 null도 매칭한다.
    //    5년 파기 배치를 이 조건만으로 짜면 탈퇴한 적 없는 회원을 전원 파기한다.
    //    반드시 `{ status: 'withdrawn', withdrawnAt: { $lte: cutoff } }`로 status를 함께 걸 것.
    withdrawnAt: { type: Date, default: null },

    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    agreements: { type: agreementsSchema, default: () => ({}) },
    addresses: { type: [addressSchema], default: [] },
    wishlist: { type: [String], default: [] }, // 찜한 상품 slug 목록

    // 적립금 잔액. 단일 진실은 이 필드, 이력은 PointTransaction. 음수 불가(0 클램프).
    points: { type: Number, default: 0 },

    // ── 프로필 (마이페이지 선택 입력) ─────────────────────────
    // 생년월일 — 'YYYY-MM-DD' 문자열. Date가 아닌 이유:
    // 생일은 '순간(instant)'이 아니라 '달력 날짜(civil date)'다. Date로 저장하면 KST 자정이
    // UTC 전날 15:00로 박히고 $month/$dayOfMonth는 timezone 미지정 시 UTC라 하루 앞을 읽는다.
    // 문자열은 타임존 개념이 없어 이 문제가 구조적으로 불가능하고, 사전식 비교가 곧 날짜
    // 순서라 미래·하한·만14세 검증이 전부 문자열 비교로 끝난다.
    // ⚠️ setter가 공백까지 처리하는 이유: Mongoose setter는 push 역순으로 실행돼
    //    `trim: true`가 이 setter보다 **나중에** 돈다. `v === ''`만 보면 '   '가 그대로
    //    통과한 뒤 trim이 ''로 만들고, match 검증자는 ''를 통과시켜(v !== '' 가드)
    //    빈 문자열이 조용히 저장된다. 옵션 키 순서로 고치지 말 것 — 다음 사람이
    //    알파벳순 정렬 한 번으로 되돌린다.
    birthday: {
      type: String,
      default: null,
      trim: true,
      set: (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      match: [/^\d{4}-\d{2}-\d{2}$/, '생년월일은 YYYY-MM-DD 형식이어야 합니다.'],
    },

    // 성별 — 선택. null 하나로 '미입력'을 표현하고 'undisclosed' 센티널을 두지 않는다:
    // '모름' 상태가 둘이면 이후 모든 조회가 $in:[null,'undisclosed'] 이중 처리를 해야 하고
    // 한쪽을 빠뜨리는 순간 조용한 버그가 된다(nickname도 default:null 관습).
    // enum 검증자는 null을 자동 통과시키므로 enum 배열에 null을 넣지 않는다.
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
      set: (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    },

    // 회원등급 — ⚠️ 현재는 **관리자 수동 지정 라벨**이다. 자동 산정 없음.
    // 적립률은 여전히 pointService의 EARN_RATE 전 회원 일률이며 grade와 연결되지 않는다.
    // 이 단서를 지우지 말 것: 등급을 고객에게 표시하고 혜택을 고지하는 순간 표시광고상
    // 이행 의무가 생겨 되돌리기가 코드 롤백보다 훨씬 비싸진다.
    // 자동 산정(주문 집계 재계산)은 도달자가 0일 수 있는 현 규모에서 보류했다.
    grade: { type: String, enum: ['basic', 'silver', 'gold'], default: 'basic' },

    // 마지막 **로그인 성공** 시각. '접속'이 아니다 — JWT가 7일 만료라 토큰만으로
    // 로그인 없이 최대 7일 활동할 수 있다. 화면 라벨도 '최근 로그인'으로 쓸 것.
    // null = 로그인 이력 없음(관리자 생성 계정·이 필드 도입 이전 가입자).
    // createdAt으로 백필하지 않는다 — 과거 로그인 시각은 보유한 적이 없으므로
    // 백필은 '가입=접속'이라는 거짓 기록을 만든다.
    // IP/User-Agent는 수집하지 않는다 — 이상 탐지 로직도 알림 채널도 없어 목적 없는
    // 수집이 되고, 수집항목 고지·보관기간·파기가 따라오는 동의 체계 변경이 된다.
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true, // ← createdAt, updatedAt 자동 생성/갱신
  },
);

// 소셜 로그인 조회용
userSchema.index({ provider: 1, providerId: 1 });

// ── Password handling ────────────────────────────────────────

// 평문 비밀번호를 넣으면 저장 직전 해싱된다: user.password = '...'
userSchema.virtual('password').set(function setPassword(plain) {
  this._password = plain;
});

userSchema.pre('save', async function hashPassword() {
  if (this._password) {
    this.passwordHash = await bcrypt.hash(this._password, 12);
    this._password = undefined;
  }
});

// 로컬 "가입"(신규 문서)인데 비밀번호가 없으면 오류.
// 업데이트 시엔 passwordHash가 select:false로 로드되지 않으므로 isNew로 한정.
userSchema.pre('validate', function requireLocalPassword(next) {
  if (this.isNew && this.provider === 'local' && !this.passwordHash && !this._password) {
    this.invalidate('password', '비밀번호는 필수입니다.');
  }
  // 서버 권위 최소 길이 — 클라 검증을 우회한 직접 API 호출(POST {password:"1"})을 차단
  if (this._password != null && String(this._password).length < 8) {
    this.invalidate('password', '비밀번호는 8자 이상이어야 합니다.');
  }
  next();
});

// 로그인 시 비밀번호 검증. (passwordHash가 로드된 문서에서 호출)
userSchema.methods.comparePassword = function comparePassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

// ── Virtuals & serialization ─────────────────────────────────

// 공개 표시명: 닉네임 우선, 없으면 실명 마스킹(홍길동 → 홍**)
userSchema.virtual('displayName').get(function displayName() {
  if (this.nickname) return this.nickname;
  const n = this.name || '';
  return n.length <= 1 ? n : n[0] + '*'.repeat(n.length - 1);
});

// 응답에서 민감/불필요 필드 제거
userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret._password;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;
