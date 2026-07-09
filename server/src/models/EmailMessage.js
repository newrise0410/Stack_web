import mongoose from 'mongoose';

const { Schema } = mongoose;

// 목업 이메일: 실제 발송 대신 DB에 저장하고 관리자/마이페이지에서 미리보기한다.
const emailMessageSchema = new Schema(
  {
    to: { type: String, required: true }, // 수신 이메일
    subject: { type: String, required: true },
    body: { type: String, required: true }, // 평문
    type: {
      type: String,
      enum: ['order_placed', 'order_status'],
      required: true,
    },
    statusLabel: { type: String, default: '' }, // order_status일 때 '배송중' 등 표시용
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true },
);

emailMessageSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const EmailMessage = mongoose.model('EmailMessage', emailMessageSchema);

export default EmailMessage;
