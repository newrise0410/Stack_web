import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

// 로그인한 사용자만 접근. 세션 복원 중이면 대기, 미로그인 시 /login으로.
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] px-5 py-24 text-center text-mute">
        불러오는 중…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  return children;
}
