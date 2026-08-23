import { useState, useEffect } from 'react';
import api from '../api';

/**
 * CreateShowForm — schedules a show for an event: venue, start time, and a price
 * for EVERY seat category in that venue.
 *
 * All categories must be priced: the server fans `show_seats` out by joining
 * venue_seats to show_category_prices, so an unpriced category silently produces
 * no seats. The form therefore requires a price per category rather than
 * defaulting one.
 */
export default function CreateShowForm({ eventId, onCreated }) {
  const [venues, setVenues]   = useState([]);
  const [venueId, setVenueId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [prices, setPrices]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(null);

  useEffect(() => {
    api.get('/venues')
      .then(setVenues)
      .catch(err => setError(err.message));
  }, []);

  const venue = venues.find(v => v.id === venueId);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!venue?.categories?.length) {
      return setError('This venue has no seat categories yet. An admin must add them first.');
    }
    if (!venue.seat_count) {
      return setError('This venue has no seats yet. An admin must generate its seat grid first.');
    }
    const missing = venue.categories.filter(c => prices[c.id] === undefined || prices[c.id] === '');
    if (missing.length) {
      return setError(`Set a price for: ${missing.map(c => c.name).join(', ')}`);
    }

    setSaving(true);
    try {
      const res = await api.post(`/organiser/events/${eventId}/shows`, {
        venueId,
        // datetime-local gives local wall time; send a real instant.
        startsAt: new Date(startsAt).toISOString(),
        prices: venue.categories.map(c => ({ categoryId: c.id, price: Number(prices[c.id]) })),
      });
      setDone(`Show created with ${res.seatsCreated} seats.`);
      setStartsAt(''); setPrices({});
      onCreated?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Default the picker to "tomorrow evening" and forbid scheduling in the past.
  const minLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <div className="alert alert-error">{error}</div>}
      {done  && <div className="alert alert-success">{done}</div>}

      <div className="form-group">
        <label className="form-label" htmlFor="show-venue">Venue *</label>
        <select
          id="show-venue" className="form-input" required
          value={venueId} onChange={e => { setVenueId(e.target.value); setPrices({}); }}
        >
          <option value="">Select a venue…</option>
          {venues.map(v => (
            <option key={v.id} value={v.id}>
              {v.name} — {v.city} ({v.seat_count} seats)
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="show-starts">Date &amp; time *</label>
        <input
          id="show-starts" type="datetime-local" className="form-input" required
          min={minLocal} value={startsAt} onChange={e => setStartsAt(e.target.value)}
        />
      </div>

      {venue && (
        <div className="form-group">
          <label className="form-label">Price per category *</label>
          {venue.categories.length === 0 && (
            <p className="text-muted text-sm">
              This venue has no categories yet — add them from the Admin page.
            </p>
          )}
          {venue.categories.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
              <div className="price-chip-dot" style={{ background: c.colour_hex }} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <input
                type="number" min="0" step="1" required
                className="form-input" style={{ width: '120px' }}
                placeholder="₹"
                value={prices[c.id] ?? ''}
                onChange={e => setPrices(p => ({ ...p, [c.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      <button id="btn-create-show" type="submit" className="btn btn-primary" disabled={saving || !venueId}>
        {saving ? 'Creating…' : 'Create Show'}
      </button>
    </form>
  );
}
