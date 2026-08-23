import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import CountdownBar from '../components/CountdownBar';
import { useAuth } from '../context/AuthContext';

export default function Checkout() {
  const { groupId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [hold, setHold]       = useState(state?.hold || null);
  const [show, setShow]       = useState(state?.show || null);
  const [form, setForm]       = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState(null);
  const beaconSent = useRef(false);

  // AuthContext resolves /auth/me asynchronously, so on a direct load `user` is still
  // null at mount and the initial state above lands empty. Fill the blanks once it
  // arrives, without clobbering anything already typed.
  useEffect(() => {
    if (!user) return;
    setForm(f => ({
      name:  f.name  || user.name  || '',
      email: f.email || user.email || '',
      phone: f.phone || user.phone || '',
    }));
  }, [user]);

  // Fetch the hold if we didn't arrive with it in router state (direct link, refresh).
  // Both sources now share one shape: { holdGroupId, expiresAt, seats, total }.
  useEffect(() => {
    if (hold) return;
    api.get(`/holds/${groupId}`)
      .then(setHold)
      .catch(err => { setError(err.message); });
  }, [groupId, hold]);

  // Release on page exit (sendBeacon)
  useEffect(() => {
    const release = () => {
      if (beaconSent.current) return;
      beaconSent.current = true;
      const token = localStorage.getItem('token');
      if (!token) return;
      // Beacons are POST-only and cannot carry headers, so the token rides in the
      // query string on a dedicated release endpoint.
      const base = import.meta.env.VITE_API_URL || '/api';
      navigator.sendBeacon(
        `${base}/holds/${groupId}/release?token=${encodeURIComponent(token)}`
      );
    };
    window.addEventListener('beforeunload', release);
    return () => window.removeEventListener('beforeunload', release);
  }, [groupId]);

  const handleExpired = () => {
    const target = show?.id ? `/shows/${show.id}` : '/';
    navigate(target, { replace: true, state: { error: 'Your hold expired. Please select seats again.' } });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      beaconSent.current = true; // don't send beacon now, we're converting
      const result = await api.post('/bookings', {
        holdGroupId: groupId,
        customer: form,
      });
      navigate(`/booking/${result.reference}`, { state: { reference: result.reference, seats: result.seats } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Release your held seats?')) return;
    beaconSent.current = true;
    await api.delete(`/holds/${groupId}`).catch(() => {});
    navigate(-1);
  };

  if (error && !hold) return (
    <div className="page"><div className="container">
      <div className="alert alert-error">{error}</div>
      <button className="btn btn-secondary mt-4" onClick={() => navigate(-1)}>Go back</button>
    </div></div>
  );

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '560px' }}>
        <h1 style={{ marginBottom: '24px' }}>Complete Booking</h1>

        {hold?.expiresAt && (
          <CountdownBar expiresAt={hold.expiresAt} onExpired={handleExpired} />
        )}

        {/* Seat summary */}
        {hold && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-body">
              <h3 style={{ marginBottom: '12px' }}>Your seats</h3>
              {hold.seats?.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--col-border)' }}>
                  <span>{s.row_label}{s.seat_number}</span>
                  <span className="font-semibold">₹{Number(s.price).toFixed(0)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                <span className="font-semibold">Total</span>
                <span className="font-semibold text-accent">
                  {Number.isFinite(Number(hold.total)) ? `₹${Number(hold.total).toFixed(0)}` : '—'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Customer details */}
        <div className="card">
          <div className="card-body">
            <h3 style={{ marginBottom: '20px' }}>Your details</h3>
            <form id="checkout-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="checkout-name">Full Name *</label>
                <input id="checkout-name" className="form-input" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="checkout-email">Email *</label>
                <input id="checkout-email" type="email" className="form-input" required value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                {user?.email && form.email.trim().toLowerCase() !== user.email.toLowerCase() && (
                  <span className="text-xs text-dim">
                    A confirmation also goes to your registered address ({user.email}).
                  </span>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="checkout-phone">Phone</label>
                <input id="checkout-phone" type="tel" className="form-input" value={form.phone}
                  placeholder="9876543210"
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <span className="text-xs text-dim">Used for an SMS confirmation, when enabled.</span>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
                <button id="btn-confirm-booking" type="submit" className="btn btn-primary btn-full" disabled={submitting}>
                  {submitting ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Confirming…</> : 'Confirm Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
