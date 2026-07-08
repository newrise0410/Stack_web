import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { useAuth } from '../lib/auth.jsx';

const CATS = ['BEST', 'TABLE', 'PENDANT', 'MOON', 'SHOWCASE', 'PT'];

export default function Header() {
  const { count } = useCart();
  const { user, logout } = useAuth();

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
        <Link to="/" aria-label="Stack N' Stak 홈" className="shrink-0">
          <span className="text-lg font-extrabold tracking-tight">STACK N' STAK</span>
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <button aria-label="검색" className="hidden text-mute hover:text-ink sm:block">
            검색
          </button>
          <button className="relative flex items-center gap-1.5" aria-label={`장바구니 ${count}개`}>
            <span>SHOPPING BAG</span>
            {count > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-sale px-1 text-[10px] font-bold text-paper">
                {count}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* category nav */}
      <nav className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 overflow-x-auto px-5 py-3 text-[13px] font-medium">
          {CATS.map((c) => (
            <a
              key={c}
              href={`#${c.toLowerCase()}`}
              className="whitespace-nowrap text-ink/85 transition-colors hover:text-ink"
            >
              {c}
            </a>
          ))}
        </div>
      </nav>
    </header>
  );
}
