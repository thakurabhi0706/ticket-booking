import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [form, setForm]     = useState({ name: '', email: '', password: '', role: 'CUSTOMER' });
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const { login }           = useAuth();
  const navigate            = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const { token, user } = await api.post('/auth/register', form);
      login(token, user);
      navigate('/');
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
          <h1 style={{ marginBottom: '8px' }}>Create account</h1>
          <p className="text-muted">Join CineWave and start booking</p>
        </div>
        <div className="card">
          <div className="card-body">
            <form id="register-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-name">Full Name</label>
                <input id="reg-name" className="form-input" required minLength={2}
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-email">Email</label>
                <input id="reg-email" type="email" className="form-input" required
                  value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-password">Password</label>
                <input id="reg-password" type="password" className="form-input" required minLength={8}
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-role">Account type</label>
                <select id="reg-role" className="form-input"
                  value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="ORGANISER">Event Organiser</option>
                </select>
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button id="btn-register" type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Creating account…</> : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
        <p className="text-muted text-sm" style={{ textAlign: 'center', marginTop: '20px' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
