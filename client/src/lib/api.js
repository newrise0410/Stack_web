import axios from 'axios';

// Shared axios instance. Base URL comes from VITE_API_URL,
// which defaults to "/api" (proxied to the server in dev).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

export default api;
