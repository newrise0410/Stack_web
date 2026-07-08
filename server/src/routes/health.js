import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

// Simple liveness/readiness check.
// readyState 1 === connected
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

export default router;
