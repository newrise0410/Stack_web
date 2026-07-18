import 'dotenv/config';
import mongoose from 'mongoose';
import { backfillProductSkus } from '../seed/backfillSkus.js';

// 기존 상품에 SKU 소급 부여. 로컬은 npm run seed가 자동 호출하지만, Atlas는 시드를 못 돌리므로
// (deleteMany가 관리자 편집을 날린다) 이 스크립트가 유일한 안전 경로다.
//   MIGRATE_CONFIRM=yes MONGODB_URI=<atlas> npm run backfill:sku

if (process.env.MIGRATE_CONFIRM !== 'yes') {
  console.error('안전장치: MIGRATE_CONFIRM=yes 를 설정해야 실행됩니다.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';
await mongoose.connect(uri);
const assigned = await backfillProductSkus();
console.log(`SKU backfill 완료 — ${assigned}건 발급.`);
await mongoose.disconnect();
