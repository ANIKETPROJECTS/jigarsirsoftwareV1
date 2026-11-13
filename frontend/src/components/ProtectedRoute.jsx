import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// moduleCode: when provided, also checks CanView for that module.
// If the user is logged in but lacks CanView, they are redirected to "/" (home/dashboard).
export default function ProtectedRoute({ children, moduleCode }) {
  const { isAuthenticated, can } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (moduleCode && !can(moduleCode, 'CanView')) return <Navigate to="/" replace />;
  return children;
}
