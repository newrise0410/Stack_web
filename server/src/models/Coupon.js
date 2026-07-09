import mongoose from 'mongoose';

const { Schema } = mongoose;

// 쿠폰 정의 (코드 + 할인 규칙). 발급/사용 상태는 UserCoupon이 관리.
const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    discountType: { type: String, enum: ['fixed', 'percent', 'free_shipping'], required: true },
    discountValue: { type: Number, default: 0 }, // fixed=원, percent=%, free_shipping=미사용
    maxDiscount: { type: Number, default: 0 }, // percent 상한 (0 = 무제한)
    minOrderAmount: { type: Number, default: 0 }, // 상품금액 기준 최소주문
    expiresAt: { type: Date, default: null }, // null = 무기한
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon;
