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
    paymentMethod: { type: String, default: 'card' }, // 'card'(포트원) | 'points'(0원 주문) | 'mock'(레거시)
    // 포트원 결제·환불 상태 (status enum은 불변 — 세부 상태는 여기서 관리)
    payment: {
      provider: { type: String, default: null }, // 'portone' | 'none'(0원) | null(레거시 mock)
      pg: { type: String, default: '' }, // 포트원 응답 pg_provider 스냅샷
      method: { type: String, default: '' }, // 'card' | 'points'
      impUid: { type: String, default: null },
      paidAt: { type: Date, default: null },
      receiptUrl: { type: String, default: '' },
      failReason: { type: String, default: '' },
      prepareStatus: { type: String, enum: ['preparing', 'prepared', 'failed', null], default: null },
      preparedAmount: { type: Number, default: null },
      expiresAt: { type: Date, default: null }, // pending 만료(sweeper 기준)
      refund: {
        status: { type: String, enum: ['none', 'requested', 'processing', 'done', 'review'], default: 'none' },
        reason: { type: String, default: '' },
        requestedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelAmount: { type: Number, default: 0 },
      },
    },
    // 같은 멱등키 + 다른 본문 재사용 감지용(sha256 hex)
    requestHash: { type: String, default: null },
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
// 같은 결제(impUid)가 두 주문에 매핑되는 것을 차단 — 문자열일 때만(partial)
orderSchema.index(
  { 'payment.impUid': 1 },
  { unique: true, partialFilterExpression: { 'payment.impUid': { $type: 'string' } } },
);
// sweeper 스캔용
orderSchema.index({ status: 1, 'payment.expiresAt': 1 });

orderSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

// 매출로 집계되는 상태(결제 확정 이후). pending·cancelled 제외.
export const SALES_STATES = ['paid', 'preparing', 'shipped', 'delivered'];

const Order = mongoose.model('Order', orderSchema);

export default Order;
