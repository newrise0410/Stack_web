import mongoose from 'mongoose';

const { Schema } = mongoose;

// 주문 시점의 상품 스냅샷 (이후 상품이 바뀌어도 주문 내역은 고정)
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    slug: String,
    name: String,
    nameKo: String,
    image: String,
    option: { type: String, default: null },
    price: { type: Number, required: true }, // 단가 스냅샷 (서버가 DB에서 채움)
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const shippingAddressSchema = new Schema(
  {
    recipient: { type: String, required: true },
    phone: String,
    zipcode: String,
    address1: { type: String, required: true },
    address2: String,
    deliveryMemo: String,
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    shippingAddress: { type: shippingAddressSchema, required: true },
    amounts: {
      itemsTotal: { type: Number, required: true }, // 상품 합계
      couponDiscount: { type: Number, default: 0 }, // 쿠폰 상품할인
      shippingFee: { type: Number, required: true }, // 배송비 (free_shipping이면 0)
      pointsUsed: { type: Number, default: 0 }, // 적립금 사용 (Phase C)
      grandTotal: { type: Number, required: true }, // 최종 결제액
    },
    coupon: {
      code: { type: String, default: '' }, // 적용 쿠폰 코드 스냅샷
      discount: { type: Number, default: 0 }, // 총 혜택(상품+배송 할인)
    },
    pointsEarned: { type: Number, default: 0 }, // 적립 예정액(배송완료 시 실제 적립) (Phase C)
    // 취소 시 혜택(쿠폰·적립금) 원복 완료 여부. 부분 실패 시 false로 남아 재수렴(멱등 재실행)의 기준.
    benefitsReversed: { type: Boolean, default: false },
    // 주문 생성 idempotency 키(클라 생성). 재시도 시 중복 주문·중복 적립/판매 방지.
    idempotencyKey: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paymentMethod: { type: String, default: 'mock' }, // 실 PG 미연동(스터디)
    courier: { type: String, default: '' }, // 택배사 (배송중 전환 시)
    trackingNumber: { type: String, default: '' }, // 송장번호
  },
  { timestamps: true },
);

// 동일 사용자+동일 idempotencyKey는 단 하나의 주문만 — 키가 있는 문서에만 적용(partial)
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

orderSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Order = mongoose.model('Order', orderSchema);

export default Order;
