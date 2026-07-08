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
      shippingFee: { type: Number, required: true }, // 배송비
      grandTotal: { type: Number, required: true }, // 최종 결제액
    },
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

orderSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Order = mongoose.model('Order', orderSchema);

export default Order;
