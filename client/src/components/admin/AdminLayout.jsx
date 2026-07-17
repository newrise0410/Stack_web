import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';

const NAV = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/orders', label: '주문' },
  { to: '/admin/production', label: '제작' },
  { to: '/admin/products', label: '상품' },
  { to: '/admin/members', label: '회원' },
  { to: '/admin/reviews', label: '리뷰' },
  { to: '/admin/emails', label: '이메일' },
  { to: '/admin/coupons', label: '쿠폰' },
  { to: '/admin/analytics', label: '분석' },
];

export default function AdminLayout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-line px-5 py-3 print:hidden">
        <Link to="/" className="text-sm font-extrabold tracking-tight">
          STACK N' STAK · 관리자
        </Link>
        <div className="flex items-center gap-4 text-[13px] text-mute">
          <span className="text-ink">{user?.nickname || user?.name}님</span>
          <Link to="/" className="hover:text-ink">스토어로</Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1280px] gap-8 px-5 py-8">
        {/* 데스크톱 사이드바 */}
        <nav className="hidden w-40 shrink-0 flex-col md:flex print:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `border-l-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive ? 'border-ink font-semibold text-ink' : 'border-transparent text-mute hover:text-ink'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {/* 모바일 가로 탭 */}
          <nav className="mb-6 flex gap-4 overflow-x-auto border-b border-line pb-2 md:hidden">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `whitespace-nowrap text-sm ${isActive ? 'font-semibold text-ink' : 'text-mute'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
