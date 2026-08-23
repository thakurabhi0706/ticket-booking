import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import EventCard from '../components/EventCard';

export default function Home() {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filters, setFilters] = useState({ type: '', city: '', q: '', dateFrom: '' });

  const fetchEvents = async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
      const data = await api.get(`/events?${params}`);
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, [filters]);

  const cities = [...new Set(events.map(e => e.city).filter(Boolean))];

  const handleFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }));
  const clearFilters = () => setFilters({ type: '', city: '', q: '', dateFrom: '' });

  return (
    <div className="page">
      <div className="container">
        {/* Hero */}
        <header className="hero rise">
          <span className="hero-eyebrow">● Live seat availability</span>
          <h1 className="hero-title">Movies & concerts, <em>seat by seat</em>.</h1>
          <p className="hero-sub">
            Pick your exact seat on a live map, hold it while you check out, and get a QR
            ticket in your inbox the moment it is confirmed.
          </p>
          <div className="hero-stats">
            <div>
              <div className="hero-stat-value">{loading ? '—' : events.length}</div>
              <div className="hero-stat-label">Events on sale</div>
            </div>
            <div>
              <div className="hero-stat-value">{loading ? '—' : cities.length}</div>
              <div className="hero-stat-label">Cities</div>
            </div>
            <div>
              <div className="hero-stat-value">Real-time</div>
              <div className="hero-stat-label">Seat updates</div>
            </div>
          </div>
        </header>

        {/* Filters */}
        <div className="filter-bar rise">
          <input
            id="search-events"
            className="form-input"
            style={{ minWidth: '200px', flex: 1 }}
            placeholder="Search events..."
            value={filters.q}
            onChange={e => handleFilter('q', e.target.value)}
          />
          <select
            id="filter-type"
            className="form-input"
            style={{ minWidth: '130px' }}
            value={filters.type}
            onChange={e => handleFilter('type', e.target.value)}
          >
            <option value="">All types</option>
            <option value="MOVIE">Movies</option>
            <option value="CONCERT">Concerts</option>
          </select>
          <input
            id="filter-city"
            className="form-input"
            style={{ minWidth: '130px' }}
            placeholder="City"
            value={filters.city}
            onChange={e => handleFilter('city', e.target.value)}
          />
          <input
            id="filter-date"
            type="date"
            className="form-input"
            style={{ minWidth: '160px' }}
            value={filters.dateFrom}
            onChange={e => handleFilter('dateFrom', e.target.value)}
          />
          {(filters.q || filters.type || filters.city || filters.dateFrom) && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear</button>
          )}
        </div>

        {/* Content */}
        {loading && (
          <div className="grid-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card">
                <div className="skeleton" style={{ height: '230px' }} />
                <div className="card-body">
                  <div className="skeleton" style={{ height: '20px', marginBottom: '8px' }} />
                  <div className="skeleton" style={{ height: '14px', width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && events.length === 0 && (
          <div className="empty-state">
            <div className="icon">🎭</div>
            <h3>No events found</h3>
            <p>Try adjusting your filters or check back later.</p>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div className="grid-3">
            {events.map(e => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </div>
    </div>
  );
}
