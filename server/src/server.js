import 'dotenv/config';

import { createApp } from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 4000;

// 필수 환경변수 누락 시 조용한 오폴백 대신 즉시 실패한다. (NODE_ENV에 의존하지 않음)
function assertEnv() {
  if (!process.env.JWT_SECRET && process.env.ALLOW_INSECURE_JWT !== '1') {
    throw new Error('JWT_SECRET 미설정 — 기동 중단. (개발은 ALLOW_INSECURE_JWT=1)');
  }
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI 미설정');
    if (!process.env.CLIENT_ORIGIN) {
      console.warn('⚠️  CLIENT_ORIGIN 미설정 — CORS가 모든 오리진에 열립니다. 프론트 도메인을 지정하세요.');
    }
    if (!process.env.PORTONE_IMP_KEY || !process.env.PORTONE_IMP_SECRET) {
      throw new Error('PORTONE_IMP_KEY / PORTONE_IMP_SECRET 미설정 — 결제 서버 기동 중단');
    }
  }
}

async function start() {
  try {
    assertEnv();
    await connectDB(process.env.MONGODB_URI);

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });

    const { startPaymentJobs } = await import('./services/paymentJobs.js');
    startPaymentJobs();
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
