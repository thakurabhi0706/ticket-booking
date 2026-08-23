import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, role }) {
  const { isLoggedIn, user, loading } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  );

  // Remember where they were going so Login can send them back.
  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (role && user?.role !== role && !(role === 'ORGANISER' && user?.role === 'ADMIN')) {
    return <Navigate to="/" replace />;
  }

  return children;
}
