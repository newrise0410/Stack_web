import mongoose from 'mongoose';

const { Schema } = mongoose;

// 순번 발급용 원자 카운터. _id = 'sku:Tech' 형태.
// $inc가 문서 단위 원자 연산이라 동시 발급이 서로 다른 seq를 받는다 — 트랜잭션 불필요.
const counterSchema = new Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { versionKey: false },
);

export default mongoose.model('Counter', counterSchema);
