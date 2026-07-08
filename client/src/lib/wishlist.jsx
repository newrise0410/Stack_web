import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from './api.js';
import { useAuth } from './auth.jsx';
import { normalizeProduct } from './products.js';

// ── API 헬퍼 ───────────────────────────────────────────────
export async function fetchWishlist() {
  const { data } = await api.get('/wishlist');
  return { slugs: data.slugs || [], items: (data.items || []).map(normalizeProduct) };
}

async function toggleWishlistApi(slug) {
  const { data } = await api.post(`/wishlist/${slug}`);
  return data; // { slugs, wished }
}

// ── Context ────────────────────────────────────────────────
const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const [slugs, setSlugs] = useState([]);
  const pending = useRef(new Set()); // 진행 중인 토글 slug (연타 방지)

  // 로그인 상태 변화 시 서버 찜 목록 동기화 (로그아웃 시 비움)
  useEffect(() => {
    let active = true;
    if (!user) {
      setSlugs([]);
      return undefined;
    }
    fetchWishlist()
      .then((d) => active && setSlugs(d.slugs))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const isWished = useCallback((slug) => slugs.includes(slug), [slugs]);

  const toggle = useCallback(async (slug) => {
    // 같은 slug 요청이 진행 중이면 무시 (연타로 인한 순서 꼬임/서버 경합 방지)
    if (pending.current.has(slug)) return;
    pending.current.add(slug);
    // 낙관적 업데이트 후 서버 응답으로 확정
    setSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
    try {
      const d = await toggleWishlistApi(slug);
      setSlugs(d.slugs || []);
    } catch {
      // 실패 시 서버 상태로 롤백
      fetchWishlist()
        .then((d) => setSlugs(d.slugs))
        .catch(() => {});
    } finally {
      pending.current.delete(slug);
    }
  }, []);

  return (
    <WishlistContext.Provider value={{ slugs, isWished, toggle, loggedIn: !!user }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
