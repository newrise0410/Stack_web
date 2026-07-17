import mongoose from 'mongoose';

// 포트원 웹훅 수신 감사 로그(inbox). 판정은 항상 API 재조회로 하므로 body는 참고값만 저장.
const webhookLogSchema = new mongoose.Schema(
  {
    impUid: { type: String, default: '', index: true },
    merchantUid: { type: String, default: '' },
    rawStatus: { type: String, default: '' },
    result: { type: String, enum: ['received', 'processed', 'ignored', 'error'], default: 'received' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('WebhookLog', webhookLogSchema);
