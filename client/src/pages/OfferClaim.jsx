import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import CountdownBar from '../components/CountdownBar';
import { useAuth } from '../context/AuthContext';

export default function OfferClaim() {
  const { token } = useParams();
  const navigate  = useNavigate();
  const { user, isLoggedIn } = useAuth();

  const [offer, setOffer]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [form, setForm]     = useState({ name: '', email: '', phone: '' });
  const [claiming, setClaiming] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    api.get(`/waitlist/offers/${token}`)
      .then(o => {
        setOffer(o);
        setForm(f => ({ ...f, name: user?.name || '', email: o.userEmail || user?.email || '' }));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleClaim = async (e) => {
    e.preventDefault();
    setClaiming(true); setError(null);
    try {
      const result = await api.post(`/waitlist/offers/${token}/claim`, { customer: form });
      navigate(`/booking/${result.reference}`);
    } catch (err) {
      setError(err.message);
      setClaiming(false);
    }
  };

  const handleDecline = async () => {
    if (!confirm('Decline this offer? The seat will go to the next person in line.')) return;
    setDeclining(true);
    try {
      await api.post(`/waitlist/offers/${token}/decline`);
      navigate('/', { state: { toast: 'Offer declined. The seat has been passed to the next person.' } });
    } catch (err) {
      setError(err.message);
      setDeclining(false);
    }
  };

  if (loading) return (
    <div className="page"><div className="container">
      <div className="skeleton" style={{ height: '300px', maxWidth: '560px' }} />
    </div></div>
  );

  if (error && !offer) return (
    <div className="page"><div className="container" style={{ maxWidth: '560px' }}>
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
          <h2 style={{ marginBottom: '8px' }}>Offer Expired</h2>
          <p className="text-muted">{error}</p>
          <a href="/" className="btn btn-primary" style={{ marginTop: '20px', display: 'inline-flex' }}>Browse Events</a>
        </div>
      </div>
    </div></div>
  );

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '560px' }}>
        <div style={{ marginBottom: '8px' }}>
          <span className="badge badge-warn">Waitlist Offer</span>
        </div>
        <h1 style={{ marginBottom: '24px' }}>Seat Available for You</h1>

        {offer?.expiresAt && (
          <CountdownBar
            expiresAt={offer.expiresAt}
            label="Waitlist offer"
            onExpired={() => setError('Your offer has expired.')}
          />
        )}

        {offer && !isLoggedIn && (
          <div className="alert alert-warn" style={{ marginBottom: '16px' }}>
            This offer is tied to the account it was emailed to. Please{' '}
            <Link to="/login" state={{ from: `/waitlist/offer/${token}` }}>sign in</Link>{' '}
            as <strong>{offer.userEmail}</strong> to claim it.
          </div>
        )}

        {/* Offer details */}
        {offer && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-body">
              <h3 style={{ marginBottom: '12px' }}>{offer.eventTitle}</h3>
              <p className="text-muted text-sm" style={{ marginBottom: '12px' }}>
                📍 {offer.venueName} · {new Date(offer.startsAt).toLocaleString('en-IN', {
                  weekday: 'short', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })} IST
              </p>
              <div>
                <p className="text-sm text-muted" style={{ marginBottom: '8px' }}>Your offered seats:</p>
                {offer.seats?.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--col-border)' }}>
                    <span>{s.row_label}{s.seat_number} — {s.category_name}</span>
                    <span className="font-semibold">₹{s.price}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Claim form */}
        {offer && !error && isLoggedIn && (
          <div className="card">
            <div className="card-body">
              <h3 style={{ marginBottom: '20px' }}>Claim Your Seat</h3>
              <form onSubmit={handleClaim} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="offer-name">Full Name *</label>
                  <input id="offer-name" className="form-input" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="offer-email">Email *</label>
                  <input id="offer-email" type="email" className="form-input" required value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="offer-phone">Phone</label>
                  <input id="offer-phone" type="tel" className="form-input" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-ghost" onClick={handleDecline} disabled={declining}>
                    {declining ? 'Declining…' : 'Decline'}
                  </button>
                  <button id="btn-claim-offer" type="submit" className="btn btn-primary btn-full" disabled={claiming}>
                    {claiming ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Claiming…</> : 'Claim Seat'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
