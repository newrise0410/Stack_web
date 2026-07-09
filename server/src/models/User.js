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
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // 기본 조회에서 제외(select:false). 로그인 시 .select('+passwordHash') 필요.
    passwordHash: { type: String, select: false },

    provider: {
      type: String,
      enum: ['local', 'kakao', 'naver', 'google', 'apple'],
      default: 'local',
    },
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

    // 계정 상태. suspended면 로그인 차단. 관리자만 변경.
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },

    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    agreements: { type: agreementsSchema, default: () => ({}) },
    addresses: { type: [addressSchema], default: [] },
    wishlist: { type: [String], default: [] }, // 찜한 상품 slug 목록

    // 적립금 잔액. 단일 진실은 이 필드, 이력은 PointTransaction. 음수 불가(0 클램프).
    points: { type: Number, default: 0 },
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
