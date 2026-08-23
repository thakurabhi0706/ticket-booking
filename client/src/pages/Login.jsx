import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [form, setForm]     = useState({ email: '', password: '' });
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const { login }           = useAuth();
  const navigate            = useNavigate();
  const { state }           = useLocation();
  // Send the user back where they were headed (e.g. a waitlist offer link).
  const redirectTo          = state?.from || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const { token, user } = await api.post('/auth/login', form);
      login(token, user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '0 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ marginBottom: '8px' }}>Welcome back</h1>
          <p className="text-muted">Sign in to your CineWave account</p>
        </div>

        <div className="card">
          <div className="card-body">
            <form id="login-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="login-email">Email</label>
                <input id="login-email" type="email" className="form-input" required
                  value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">Password</label>
                <input id="login-password" type="password" className="form-input" required
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button id="btn-login" type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Signing in…</> : 'Sign In'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-muted text-sm" style={{ textAlign: 'center', marginTop: '20px' }}>
          Don't have an account?{' '}
          <Link to="/register">Register</Link>
        </p>

        <div style={{ marginTop: '24px', padding: '16px', background: 'var(--col-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--col-border)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demo credentials</p>
          {[
            { label: 'Admin', email: 'admin@ticketing.dev', pass: 'Admin@12345' },
            { label: 'Organiser', email: 'organiser@ticketing.dev', pass: 'Organiser@123' },
            { label: 'Customer', email: 'alice@example.com', pass: 'Customer@123' },
          ].map(d => (
            <button key={d.label} type="button" className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '4px', fontSize: '0.75rem' }}
              onClick={() => setForm({ email: d.email, password: d.pass })}>
              {d.label}: {d.email}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
