import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false, // 단일 in-memory DB 공유 — 파일 간 동시 실행 금지
    testTimeout: 30000,
    hookTimeout: 120000, // 첫 실행 시 mongod 바이너리 다운로드 여유
  },
});
