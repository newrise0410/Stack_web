import axios from 'axios';

// Shared axios instance. Base URL comes from VITE_API_URL,
// which defaults to "/api" (proxied to the server in dev).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// 토큰 만료/무효(401)로 실패하면 세션을 정리한다.
// 단, 로그인·회원가입 등 /auth/* 의 401은 정상 실패이므로 건드리지 않는다.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !url.startsWith('/auth/')) {
      localStorage.removeItem('sns_token');
      delete api.defaults.headers.common.Authorization;
      window.dispatchEvent(new Event('sns-unauthorized'));
    }
    return Promise.reject(error);
  },
);

export default api;
