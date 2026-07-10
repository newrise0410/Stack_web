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

// 주문-연계 멱등 지급/원복(earn·refund·reclaim)은 주문당 1건만 허용한다.
// exists() 사전검사만으로는 동시 취소(재수렴 경로 등)에서 check-then-act 경합으로 이중 지급이
// 가능하므로, {order,type} partial unique 로 원장 자체를 직렬화 장벽으로 삼는다. 두 번째 create는
// 11000으로 실패하고 applyPoints 보상 로직이 방금 반영한 잔액을 되돌려 정확히 1건만 남는다.
// spend/signup/admin_adjust(및 order:null인 생성-실패 보상 환급)는 필터에서 제외.
pointTransactionSchema.index(
  { order: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      order: { $type: 'objectId' },
      type: { $in: ['earn', 'refund', 'reclaim'] },
    },
  },
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
