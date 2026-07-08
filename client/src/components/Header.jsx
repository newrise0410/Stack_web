import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { useAuth } from '../lib/auth.jsx';

const CATS = [
  { label: 'BEST', to: '/#best' },
  { label: 'TABLE', to: '/category/Table' },
  { label: 'PENDANT', to: '/category/Pendant' },
  { label: 'MOON', to: '/category/MoonWall' },
  { label: 'SHOWCASE', to: '/category/all' },
  { label: 'PT', to: '/#pt' },
];

export default function Header() {
  const { count } = useCart();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // 라우트 이동 시 모바일 메뉴 닫기 (쿼리스트링만 바뀌는 이동도 포함)
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
      {/* utility row */}
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1280px] items-center justify-end gap-5 px-5 py-2 text-[11px] text-mute">
          {user ? (
            <>
              <span className="text-ink">{user.nickname || user.name}님</span>
              {user.role === 'admin' && (
                <Link to="/admin" className="font-medium text-ink hover:text-sale">ADMIN</Link>
              )}
              <Link to="/mypage?tab=wishlist" className="hover:text-ink">찜</Link>
              <Link to="/mypage" className="hover:text-ink">MY PAGE</Link>
              <button className="hover:text-ink" onClick={logout}>로그아웃</button>
            </>
          ) : (
            <>
              <Link to="/signup" className="hover:text-ink">JOIN</Link>
              <Link to="/login" className="hover:text-ink">LOGIN</Link>
            </>
          )}
        </div>
      </div>

      {/* brand + actions */}
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            className="text-xl leading-none text-ink md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="메뉴 열기"
          >
            ☰
          </button>
          <Link to="/" aria-label="Stack N' Stak 홈" className="shrink-0">
            <span className="text-lg font-extrabold tracking-tight">STACK N' STAK</span>
          </Link>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <Link to="/search" aria-label="검색" className="text-mute hover:text-ink">
            검색
          </Link>
          <Link to="/cart" className="relative flex items-center gap-1.5" aria-label={`장바구니 ${count}개`}>
            <span className="hidden sm:inline">SHOPPING BAG</span>
            <span className="sm:hidden">BAG</span>
            {count > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-sale px-1 text-[10px] font-bold text-paper">
                {count}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* category nav — 데스크톱 */}
      <nav className="hidden border-t border-line md:block">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 overflow-x-auto px-5 py-3 text-[13px] font-medium">
          {CATS.map((c) => (
            <Link
              key={c.label}
              to={c.to}
              className="whitespace-nowrap text-ink/85 transition-colors hover:text-ink"
            >
              {c.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* 모바일 드로어 */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col bg-paper p-6 shadow-xl">
            <button
              className="self-end text-sm text-mute hover:text-ink"
              onClick={() => setMenuOpen(false)}
              aria-label="메뉴 닫기"
            >
              닫기 ✕
            </button>
            <nav className="mt-4 flex flex-col">
              {CATS.map((c) => (
                <Link key={c.label} to={c.to} className="border-b border-line py-3 text-[15px] font-medium text-ink">
                  {c.label}
                </Link>
              ))}
            </nav>
            <div className="mt-6 flex flex-col gap-3 text-sm text-mute">
              <Link to="/search" className="hover:text-ink">검색</Link>
              {user ? (
                <>
                  <Link to="/mypage?tab=wishlist" className="hover:text-ink">찜한 상품</Link>
                  <Link to="/mypage" className="hover:text-ink">마이페이지</Link>
                  {user.role === 'admin' && <Link to="/admin" className="hover:text-ink">관리자</Link>}
                  <button className="text-left hover:text-ink" onClick={() => { setMenuOpen(false); logout(); }}>
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="hover:text-ink">로그인</Link>
                  <Link to="/signup" className="hover:text-ink">회원가입</Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
