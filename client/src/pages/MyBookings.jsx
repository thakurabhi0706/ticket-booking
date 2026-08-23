import { useState, useEffect } from 'react';
import api from '../api';

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const fetchBookings = () => {
    setLoading(true);
    api.get('/bookings/me')
      .then(setBookings)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBookings(); }, []);

  const handleCancel = async (b) => {
    if (!confirm(`Cancel booking ${b.reference}?`)) return;
    setCancelling(b.id);
    try {
      await api.post(`/bookings/${b.id}/cancel`);
      fetchBookings();
    } catch (err) {
      alert(err.message);
    } finally {
      setCancelling(null);
    }
  };

  if (loading) return (
    <div className="page"><div className="container">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card" style={{ marginBottom: '12px', padding: '20px' }}>
          <div className="skeleton" style={{ height: '20px', width: '40%', marginBottom: '8px' }} />
          <div className="skeleton" style={{ height: '14px', width: '60%' }} />
        </div>
      ))}
    </div></div>
  );

  return (
    <div className="page">
      <div className="container">
        <h1 style={{ marginBottom: '24px' }}>My Bookings</h1>

        {error && <div className="alert alert-error">{error}</div>}

        {!error && bookings.length === 0 && (
          <div className="empty-state">
            <div className="icon">🎟</div>
            <h3>No bookings yet</h3>
            <p>Browse events and book your first ticket!</p>
          </div>
        )}

        {bookings.map(b => (
          <div key={b.id} className="card card-lift" style={{ marginBottom: '14px' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <span className={`badge ${b.status === 'CONFIRMED' ? 'badge-accent' : 'badge-neutral'}`}>
                    {b.status}
                  </span>
                  <span className="badge badge-neutral">{b.event_type}</span>
                  {b.source === 'WAITLIST' && <span className="badge badge-warn">Waitlist</span>}
                </div>
                <h3 style={{ marginBottom: '4px' }}>{b.event_title}</h3>
                <p className="text-muted text-sm">{b.venue_name} · {formatDate(b.starts_at)}</p>
                <p className="text-sm" style={{ marginTop: '6px', color: 'var(--col-text-dim)' }}>
                  Seats: {b.seats?.map(s => `${s.row_label}${s.seat_number}`).join(', ')}
                </p>
                <p className="text-sm font-semibold" style={{ marginTop: '4px' }}>₹{b.total_amount}</p>
                <p className="text-xs text-muted">Ref: {b.reference}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                {b.status === 'CONFIRMED' && (
                  <button
                    id={`cancel-${b.id}`}
                    className="btn btn-danger btn-sm"
                    disabled={cancelling === b.id}
                    onClick={() => handleCancel(b)}
                  >
                    {cancelling === b.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
