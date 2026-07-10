import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from './api.js';

const AuthContext = createContext(null);
const TOKEN_KEY = 'sns_token';
const DEVICE_KEY = 'sns_device';

// 브라우저별 고유 식별자 (mock 소셜 계정 분리용). 없으면 생성해 저장.
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (window.crypto?.randomUUID?.() || `d${Date.now()}${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// axios 기본 헤더에 Bearer 토큰 설정/해제
function setAuthHeader(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(Boolean(token)); // 토큰 있으면 복원 중

  // 새로고침 시 토큰으로 세션 복원.
  // 만료·무효·정지(401/403)만 즉시 세션 정리한다. 네트워크/5xx/Render 콜드스타트 같은 일시
  // 장애로는 토큰을 지우지 않고 지수 백오프로 몇 차례 재시도해 자동 복원한다(강제 로그아웃 방지).
  // 백오프 소진 후에도 실패하면 토큰은 보존하되 loading만 종료하고, 아래 복구 리스너가 포커스/
  // 온라인 복귀 시 다시 시도한다(장시간 콜드스타트 대비). user가 채워질 때까지 token은 유지된다.
  useEffect(() => {
    let active = true;
    if (!token) return undefined;
    setAuthHeader(token);
    let timer = null;
    let attempt = 0;
    const backoff = [1000, 2000, 4000]; // 1s → 2s → 4s (첫 시도 제외 최대 3회 재시도)

    const restore = () => {
      api
        .get('/auth/me')
        .then(({ data }) => {
          if (!active) return;
          setUser(data.user);
          setLoading(false);
        })
        .catch((e) => {
          if (!active) return;
          const status = e.response?.status;
          if (status === 401 || status === 403) {
            localStorage.removeItem(TOKEN_KEY);
            setAuthHeader(null);
            setToken(null);
            setLoading(false);
            return;
          }
          // 일시 장애: 백오프 재시도. 상한 도달 시 토큰 보존한 채 loading만 종료(복구 리스너가 이어받음).
          if (attempt < backoff.length) {
            const delay = backoff[attempt];
            attempt += 1;
            timer = setTimeout(restore, delay);
          } else {
            setLoading(false);
          }
        });
    };

    restore();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // 최초 1회만 (마운트 시 저장된 토큰 기준)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 일시 장애로 복원이 미완(token은 있는데 user=null)인 동안, 포커스·온라인 복귀 시 /auth/me를
  // 다시 시도해 백엔드가 살아나면 세션을 자동 회복한다. user가 채워지면 이 효과는 정리된다.
  useEffect(() => {
    if (!token || user) return undefined;
    let active = true;
    const retry = () => {
      if (document.visibilityState === 'hidden') return;
      api
        .get('/auth/me')
        .then(({ data }) => active && setUser(data.user))
        .catch(() => {}); // 계속 실패면 다음 이벤트에서 다시 시도
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      active = false;
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [token, user]);

  // 401 인터셉터가 알린 세션 만료 → 로컬 상태 정리 (보호 페이지는 자동으로 /login 유도됨)
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setToken(null);
    };
    window.addEventListener('sns-unauthorized', onUnauthorized);
    return () => window.removeEventListener('sns-unauthorized', onUnauthorized);
  }, []);

  const applyAuth = useCallback((tok, usr) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setAuthHeader(tok);
    setToken(tok);
    setUser(usr);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post('/auth/login', { email, password });
      applyAuth(data.token, data.user);
      return data.user;
    },
    [applyAuth],
  );

  const signup = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/signup', payload);
      applyAuth(data.token, data.user);
      return data.user;
    },
    [applyAuth],
  );

  // 소셜 로그인 (POST /auth/social) — mock 제공자로 로그인/가입
  const socialLogin = useCallback(
    async (provider) => {
      const { data } = await api.post('/auth/social', { provider, deviceId: getDeviceId() });
      applyAuth(data.token, data.user);
      return data.user;
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthHeader(null);
    setToken(null);
    setUser(null);
  }, []);

  // 내 정보/배송지 수정 (PATCH /users/:id) → 응답 유저로 갱신
  const updateProfile = useCallback(
    async (data) => {
      const { data: updated } = await api.patch(`/users/${user._id}`, data);
      setUser(updated);
      return updated;
    },
    [user],
  );

  // 회원 탈퇴 (DELETE /users/:id) → 로그아웃
  const deleteAccount = useCallback(async () => {
    await api.delete(`/users/${user._id}`);
    logout();
  }, [user, logout]);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, signup, socialLogin, logout, updateProfile, deleteAccount }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
