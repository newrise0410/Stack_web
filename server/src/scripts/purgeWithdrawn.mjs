import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { purgeExpiredWithdrawals } from '../services/withdrawalService.js';

// 5년 보관기간이 만료된 탈퇴 회원을 완전 파기한다. 전자상거래법상 보관 종료 후 지체 없이 파기.
// cron 일 1회 실행 권장. 파괴적이라 기본 dry-run — 실제 삭제는 PURGE_CONFIRM=yes 필요.
//   MONGODB_URI=<atlas> npm run purge:withdrawn                 # 대상 건수만 (dry-run)
//   MONGODB_URI=<atlas> PURGE_CONFIRM=yes npm run purge:withdrawn  # 실제 파기

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';
const CONFIRM = process.env.PURGE_CONFIRM === 'yes';
const RETENTION_MS = 5 * 365 * 24 * 3600 * 1000;

await mongoose.connect(uri);

const cutoff = new Date(Date.now() - RETENTION_MS);
const candidates = await User.countDocuments({ status: 'withdrawn', withdrawnAt: { $lte: cutoff } });

if (!CONFIRM) {
  console.log(`dry-run — 5년 만료 파기 대상 ${candidates}명. 실제 파기하려면 PURGE_CONFIRM=yes 로 재실행.`);
} else {
  const purged = await purgeExpiredWithdrawals();
  console.log(`파기 완료 — ${purged}명 (주문·적립금·쿠폰·리뷰·메일·tombstone 삭제).`);
}
await mongoose.disconnect();
