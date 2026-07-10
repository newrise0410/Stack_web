import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

// Simple liveness/readiness check.
// readyState 1 === connected. DB 미연결 시 503을 반환해 상태코드 기반 모니터가 장애를 감지하게 한다.
router.get('/', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db: connected ? 'connected' : 'disconnected',
  });
});

export default router;
