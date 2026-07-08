import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import productsRouter from './routes/products.js';
import ordersRouter from './routes/orders.js';
import reviewsRouter from './routes/reviews.js';
import wishlistRouter from './routes/wishlist.js';
import adminRouter from './routes/admin.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

// Build and configure the Express application.
// Kept separate from server.js so it can be imported for testing.
export function createApp() {
  const app = express();

  // 허용 오리진: CLIENT_ORIGIN(쉼표구분)에 프론트 도메인 지정.
  // 미설정 시 전체 허용(로컬 개발 편의).
  const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: allowedOrigins.length ? allowedOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/products', productsRouter);
  app.use('/orders', ordersRouter);
  app.use('/reviews', reviewsRouter);
  app.use('/wishlist', wishlistRouter);
  app.use('/admin', adminRouter);

  app.use(notFound); // 404 fallback
  app.use(errorHandler); // 중앙 에러 핸들러

  return app;
}
