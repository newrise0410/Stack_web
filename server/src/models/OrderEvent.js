import mongoose from 'mongoose';

const { Schema } = mongoose;

// 주문 부수효과 outbox — paid/cancelled 전이와 같은 트랜잭션으로 insert되고,
// 워커가 claim(pending→processing)해 실행한다. uniqueKey가 exactly-once 장벽.
const orderEventSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['paid_email', 'paid_sales_inc', 'cancel_email', 'cancel_sales_dec'],
    },
    uniqueKey: { type: String, required: true, unique: true }, // `${orderId}:${type}`
    payload: { type: Schema.Types.Mixed, default: {} }, // 수신자 스냅샷 등(웹훅 경로엔 req.user가 없음)
    status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderEventSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model('OrderEvent', orderEventSchema);
