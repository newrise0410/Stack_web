import mongoose from 'mongoose';

const { Schema } = mongoose;

// 회원이 보유한 쿠폰 1장 = 사용 상태 추적. unique(user, coupon)로 1인 1회.
const userCouponSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    used: { type: Boolean, default: false },
    usedOrder: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    usedAt: { type: Date, default: null },
    issuedBy: { type: String, enum: ['admin', 'self'], default: 'self' }, // 발급 경로
  },
  { timestamps: true },
);

userCouponSchema.index({ user: 1, coupon: 1 }, { unique: true });

userCouponSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const UserCoupon = mongoose.model('UserCoupon', userCouponSchema);

export default UserCoupon;
