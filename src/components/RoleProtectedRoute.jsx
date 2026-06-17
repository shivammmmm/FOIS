import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function RoleProtectedRoute({ allowedRoles, redirectTo = '/' }) {
  const { user } = useAuth();
  const role = user?.role;

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
