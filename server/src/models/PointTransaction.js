import mongoose from 'mongoose';

const { Schema } = mongoose;

// 적립금 원장. amount는 +적립 / -사용·회수. balanceAfter는 거래 직후 잔액(감사용).
const pointTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    type: {
      type: String,
      enum: ['signup', 'earn', 'spend', 'reclaim', 'refund', 'admin_adjust'],
      required: true,
    },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    balanceAfter: { type: Number, required: true },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

pointTransactionSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const PointTransaction = mongoose.model('PointTransaction', pointTransactionSchema);

export default PointTransaction;
