import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

/**
 * WaitlistPanel — shown for every seat category of a show that is sold out.
 *
 * The server is the authority: POST /shows/:id/waitlist refuses with
 * 409 NOT_SOLD_OUT unless the category genuinely has zero claimable seats, so
 * this panel is a convenience, never the gate.
 */
export default function WaitlistPanel({ showId, categories, seats, isLoggedIn, maxSeats = 6 }) {
  const navigate = useNavigate();
  const [seatsWanted, setSeatsWanted] = useState({});
  const [busy, setBusy]     = useState(null);
  const [joined, setJoined] = useState({});
  const [error, setError]   = useState(null);

  // Derived from the live seat map (kept current by SSE) rather than from a
  // snapshot taken at page load, so the panel appears the moment a category sells
  // out. A HELD seat past its TTL counts as claimable — same rule as the server.
  const claimable = (categoryId) => (seats || []).filter(s =>
    s.category_id === categoryId && (
      s.status === 'AVAILABLE' ||
      (s.status === 'HELD' && s.hold_expires_at && new Date(s.hold_expires_at) <= new Date())
    )
  ).length;

  const hasSeats = (categoryId) => (seats || []).some(s => s.category_id === categoryId);

  const soldOut = (categories || []).filter(
    c => hasSeats(c.category_id) && claimable(c.category_id) === 0
  );
  if (soldOut.length === 0) return null;

  const join = async (categoryId) => {
    if (!isLoggedIn) return navigate('/login');
    setBusy(categoryId); setError(null);
    try {
      const res = await api.post(`/shows/${showId}/waitlist`, {
        categoryId,
        seatsWanted: Number(seatsWanted[categoryId] || 1),
      });
      setJoined(j => ({ ...j, [categoryId]: res.position }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-body">
        <h3 style={{ marginBottom: '4px' }}>Sold out — join the waitlist</h3>
        <p className="text-muted text-sm" style={{ marginBottom: '16px' }}>
          If someone cancels, the seats are offered to the queue in order. You&rsquo;ll get an
          email with a time-limited link to claim them.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: '12px' }}>{error}</div>}

        {soldOut.map(cat => (
          <div
            key={cat.category_id}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
              padding: '12px 0', borderBottom: '1px solid var(--col-border)',
            }}
          >
            <div className="price-chip-dot" style={{ background: cat.colour_hex }} />
            <span style={{ flex: 1, minWidth: '120px' }}>
              <strong>{cat.category_name}</strong>
              <span className="text-muted text-sm"> · ₹{cat.price}</span>
            </span>

            {joined[cat.category_id] ? (
              <span className="badge badge-accent">
                In queue · position #{joined[cat.category_id]}
              </span>
            ) : (
              <>
                <label className="text-sm text-muted" htmlFor={`wl-seats-${cat.category_id}`}>
                  Seats
                </label>
                <select
                  id={`wl-seats-${cat.category_id}`}
                  className="form-input"
                  style={{ width: '72px' }}
                  value={seatsWanted[cat.category_id] || 1}
                  onChange={e =>
                    setSeatsWanted(s => ({ ...s, [cat.category_id]: e.target.value }))
                  }
                >
                  {Array.from({ length: maxSeats }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  id={`join-waitlist-${cat.category_id}`}
                  className="btn btn-secondary btn-sm"
                  disabled={busy === cat.category_id}
                  onClick={() => join(cat.category_id)}
                >
                  {busy === cat.category_id ? 'Joining…' : 'Join waitlist'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
