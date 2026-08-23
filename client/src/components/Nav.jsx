import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Nav() {
  const { user, logout, isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="nav">
      <div className="nav-inner">
        <NavLink to="/" className="nav-logo">
          Cine<span>Wave</span>
        </NavLink>
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Events
          </NavLink>
          {isLoggedIn && (
            <NavLink to="/my/bookings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              My Bookings
            </NavLink>
          )}
          {isLoggedIn && (
            <NavLink to="/my/waitlist" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Waitlist
            </NavLink>
          )}
          {user?.role === 'ORGANISER' && (
            <NavLink to="/organiser" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Dashboard
            </NavLink>
          )}
          {/* Admins get their own control centre rather than the organiser dashboard —
              same powers, but scoped to every organiser instead of one. */}
          {user?.role === 'ADMIN' && (
            <>
              <NavLink to="/admin" end className={({ isActive }) => `nav-link nav-link-admin${isActive ? ' active' : ''}`}>
                Admin
              </NavLink>
              <NavLink to="/admin/venues" className={({ isActive }) => `nav-link nav-link-admin${isActive ? ' active' : ''}`}>
                Venues
              </NavLink>
            </>
          )}
        </div>
        <div className="nav-actions">
          {isLoggedIn ? (
            <>
              <span className="text-muted text-sm hide-mobile">{user?.name}</span>
              {user?.role !== 'CUSTOMER' && (
                <span className={`role-pill role-pill-${(user?.role || '').toLowerCase()} hide-mobile`}>
                  {user?.role}
                </span>
              )}
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign out</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="btn btn-ghost btn-sm">Sign in</NavLink>
              <NavLink to="/register" className="btn btn-primary btn-sm">Register</NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
