import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // 프로덕션 빌드에 VITE_API_URL이 없거나 '/api' 폴백이면 배포처에서 SPA HTML을 API로 받는
  // 조용한 오배포가 된다. 빌드 단계에서 즉시 실패시켜 조기 감지한다(server.js env 가드와 대칭).
  // process.env만 보면 .env.production 파일 워크플로(DEPLOY.md 문서)를 못 읽어 정상 빌드를
  // 오차단하므로, loadEnv로 .env* 파일과 실제 환경변수(Vercel 대시보드)를 모두 병합해 검사한다.
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL;
  if (command === 'build' && (!apiUrl || apiUrl === '/api')) {
    throw new Error(
      'VITE_API_URL 환경변수가 필요합니다(프로덕션 빌드). Render 백엔드 루트 URL을 지정하세요. 예: VITE_API_URL=https://<render>.onrender.com',
    );
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Proxy API requests to the Express server during development.
      // Frontend calls "/api/..." and Vite forwards to localhost:4000.
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
