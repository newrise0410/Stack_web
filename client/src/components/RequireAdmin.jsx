import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

// admin 역할만 접근.
export default function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-[1280px] px-5 py-24 text-center text-mute">불러오는 중…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-[1280px] px-5 py-24 text-center">
        <h1 className="text-xl font-bold">접근 권한이 없습니다</h1>
        <p className="mt-2 text-[14px] text-mute">관리자만 이용할 수 있는 페이지입니다.</p>
      </div>
    );
  }
  return children;
}
