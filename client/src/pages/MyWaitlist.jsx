import { useState, useEffect } from 'react';
import api from '../api';

export default function MyWaitlist() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [leaving, setLeaving] = useState(null);

  const fetch = () => {
    setLoading(true);
    api.get('/waitlist/me')
      .then(setEntries)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); }, []);

  const handleLeave = async (entryId) => {
    if (!confirm('Leave the waitlist?')) return;
    setLeaving(entryId);
    try {
      await api.delete(`/waitlist/${entryId}`);
      fetch();
    } catch (err) {
      alert(err.message);
    } finally {
      setLeaving(null);
    }
  };

  const statusColor = {
    WAITING:   'badge-neutral',
    OFFERED:   'badge-warn',
    FULFILLED: 'badge-accent',
    EXPIRED:   'badge-neutral',
    CANCELLED: 'badge-neutral',
  };

  if (loading) return (
    <div className="page"><div className="container">
      <div className="skeleton" style={{ height: '200px', marginBottom: '12px' }} />
    </div></div>
  );

  return (
    <div className="page">
      <div className="container">
        <h1 style={{ marginBottom: '24px' }}>My Waitlist</h1>

        {error && <div className="alert alert-error">{error}</div>}

        {!error && entries.length === 0 && (
          <div className="empty-state">
            <div className="icon">⏳</div>
            <h3>No waitlist entries</h3>
            <p>When an event sells out, you can join its waitlist.</p>
          </div>
        )}

        {entries.map(e => (
          <div key={e.id} className="card card-lift" style={{ marginBottom: '14px' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span className={`badge ${statusColor[e.status] || 'badge-neutral'}`}>{e.status}</span>
                </div>
                <h3 style={{ marginBottom: '4px' }}>{e.event_title}</h3>
                <p className="text-muted text-sm">{e.venue_name}</p>
                <p className="text-sm" style={{ marginTop: '6px' }}>
                  Category: <strong>{e.category_name}</strong> · Seats wanted: <strong>{e.seats_wanted}</strong>
                </p>
                {e.status === 'WAITING' && (
                  <p className="text-sm" style={{ marginTop: '4px', color: 'var(--col-accent)' }}>
                    Queue position: <strong>#{e.queue_position}</strong>
                  </p>
                )}
                {e.status === 'OFFERED' && (
                  <p className="text-sm" style={{ marginTop: '4px', color: 'var(--col-held)' }}>
                    You have a pending offer — check your email!
                  </p>
                )}
              </div>
              {e.status === 'WAITING' && (
                <button
                  id={`leave-waitlist-${e.id}`}
                  className="btn btn-ghost btn-sm"
                  disabled={leaving === e.id}
                  onClick={() => handleLeave(e.id)}
                >
                  {leaving === e.id ? 'Leaving…' : 'Leave queue'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
