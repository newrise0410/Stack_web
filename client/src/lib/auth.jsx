import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from './api.js';

const AuthContext = createContext(null);
const TOKEN_KEY = 'sns_token';

// axios 기본 헤더에 Bearer 토큰 설정/해제
function setAuthHeader(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(Boolean(token)); // 토큰 있으면 복원 중

  // 새로고침 시 토큰으로 세션 복원
  useEffect(() => {
    let active = true;
    if (!token) return undefined;
    setAuthHeader(token);
    api
      .get('/auth/me')
      .then(({ data }) => active && setUser(data.user))
      .catch(() => {
        // 만료/무효 토큰 정리
        localStorage.removeItem(TOKEN_KEY);
        setAuthHeader(null);
        if (active) setToken(null);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // 최초 1회만 (마운트 시 저장된 토큰 기준)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const { data } = await api.post('/auth/social', { provider });
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
