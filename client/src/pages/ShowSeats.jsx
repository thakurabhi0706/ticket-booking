import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import SeatMap from '../components/SeatMap';
import SeatLegend from '../components/SeatLegend';
import WaitlistPanel from '../components/WaitlistPanel';
import { useShowStream } from '../hooks/useShowStream';
import { useAuth } from '../context/AuthContext';
import '../styles/seatmap.css';

export default function ShowSeats() {
  const { id: showId } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { isLoggedIn } = useAuth();

  const [show, setShow]     = useState(null);
  const [seats, setSeats]   = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [holding, setHolding]   = useState(false);
  const [error, setError]       = useState(state?.error || null);
  const [loading, setLoading]   = useState(true);

  // Fetch show info
  useEffect(() => {
    api.get(`/shows/${showId}`)
      .then(setShow)
      .catch(err => setError(err.message));
  }, [showId]);

  // Initial seat fetch
  useEffect(() => {
    api.get(`/shows/${showId}/seats`)
      .then(s => { setSeats(s); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [showId]);

  // SSE updates
  const handleUpdate = useCallback((updated, isFullReplace) => {
    if (isFullReplace) {
      setSeats(updated);
      return;
    }
    // Delta merge — only update changed seats
    setSeats(prev => {
      const map = new Map(prev.map(s => [s.id, s]));
      for (const delta of updated) {
        const existing = map.get(delta.seatId);
        if (existing) map.set(delta.seatId, { ...existing, status: delta.status });
      }
      return [...map.values()];
    });
  }, []);

  useShowStream(isLoggedIn ? showId : null, handleUpdate);

  const toggleSeat = useCallback((seat) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }, []);

  const handleHold = async () => {
    if (!isLoggedIn) return navigate('/login');
    if (selected.size === 0) return;
    setHolding(true); setError(null);
    try {
      const seatIds = [...selected];
      const result = await api.post(`/shows/${showId}/holds`, { seatIds });
      navigate(`/checkout/${result.holdGroupId}`, { state: { hold: result, show } });
    } catch (err) {
      setError(err.message);
    } finally {
      setHolding(false);
    }
  };

  const selectedSeats = seats.filter(s => selected.has(s.id));
  const total = selectedSeats.reduce((sum, s) => sum + parseFloat(s.price), 0);

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        {show && (
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ marginBottom: '4px' }}>{show.event_title}</h1>
            <p className="text-muted">
              {show.venue_name} · {new Date(show.starts_at).toLocaleString('en-IN', {
                weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })} IST
            </p>
          </div>
        )}

        {/* Category chips */}
        {show?.categories && (
          <div className="price-chips" style={{ marginBottom: '24px' }}>
            {[...show.categories].sort((a, b) => a.display_rank - b.display_rank).map(cat => (
              <div key={cat.category_id} className="price-chip">
                <div className="price-chip-dot" style={{ background: cat.colour_hex }} />
                <span>{cat.category_name}</span>
                <span className="price-chip-price">₹{cat.price}</span>
              </div>
            ))}
          </div>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto' }} />
            <p className="text-muted" style={{ marginTop: '16px' }}>Loading seat map…</p>
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
              <SeatMap
                seats={seats}
                selected={selected}
                onToggle={toggleSeat}
                maxSeats={show?.max_seats_per_booking || 6}
              />
              <SeatLegend />
            </div>

            <WaitlistPanel
              showId={showId}
              categories={show?.categories}
              seats={seats}
              isLoggedIn={isLoggedIn}
            />

            {/* Selection tray */}
            {selected.size > 0 && (
              <div className="selection-tray">
                <div className="tray-seats">
                  {selectedSeats.map(s => (
                    <span key={s.id} className="tray-seat-chip">
                      {s.row_label}{s.seat_number}
                    </span>
                  ))}
                </div>
                <div className="tray-total">₹{total.toFixed(0)}</div>
                <button
                  id="btn-hold-seats"
                  className="btn btn-primary"
                  onClick={handleHold}
                  disabled={holding}
                >
                  {holding ? <><span className="spinner" style={{ width: '16px', height: '16px' }} /> Holding…</> : `Hold ${selected.size} seat${selected.size > 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
