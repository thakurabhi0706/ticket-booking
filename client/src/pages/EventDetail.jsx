import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

function formatDate(d) {
  return new Date(d).toLocaleString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/events/${id}`)
      .then(setEvent)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="page"><div className="container">
      <div className="skeleton" style={{ height: '300px', marginBottom: '24px' }} />
      <div className="skeleton" style={{ height: '24px', width: '40%' }} />
    </div></div>
  );
  if (error) return <div className="page"><div className="container"><div className="alert alert-error">{error}</div></div></div>;
  if (!event) return null;

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '32px', alignItems: 'start' }}>

          {/* Left — Details */}
          <div>
            <div style={{ marginBottom: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className={`badge ${event.type === 'MOVIE' ? 'badge-neutral' : 'badge-accent'}`}>{event.type}</span>
              {event.language && <span className="badge badge-neutral">{event.language}</span>}
              {event.duration_min && <span className="badge badge-neutral">{event.duration_min} min</span>}
            </div>
            <h1 style={{ marginBottom: '16px' }}>{event.title}</h1>
            <p className="text-muted" style={{ marginBottom: '24px', lineHeight: '1.7' }}>
              {event.description || 'No description available.'}
            </p>
            <p className="text-sm text-muted">Organised by <strong style={{ color: 'var(--col-text)' }}>{event.organiser_name}</strong></p>
          </div>

          {/* Right — Shows */}
          <div>
            <h2 style={{ marginBottom: '16px' }}>Upcoming Shows</h2>
            {event.shows?.length === 0 && (
              <div className="empty-state" style={{ padding: '32px 16px' }}>
                <p>No upcoming shows scheduled.</p>
              </div>
            )}
            {event.shows?.map(show => (
              <div key={show.id} className="card card-lift" style={{ marginBottom: '14px' }}>
                <div className="card-body" style={{ padding: '16px' }}>
                  <p className="font-semibold" style={{ marginBottom: '4px' }}>{formatDate(show.starts_at)}</p>
                  <p className="text-muted text-sm" style={{ marginBottom: '12px' }}>
                    📍 {show.venue_name}, {show.city}
                  </p>
                  {/* Category availability chips */}
                  <div className="price-chips" style={{ marginBottom: '12px' }}>
                    {show.categories?.filter(c => c && c.category_name).map(cat => (
                      <div key={cat.category_id} className="price-chip">
                        <div className="price-chip-dot" style={{ background: 'var(--col-border-md)' }} />
                        <span>{cat.category_name}</span>
                        <span className="price-chip-price">₹{cat.price}</span>
                        <span className="price-chip-avail">
                          {cat.available > 0 ? `${cat.available} left` : 'Sold out'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Link
                    to={`/shows/${show.id}`}
                    className="btn btn-primary btn-sm btn-full"
                    id={`book-show-${show.id}`}
                  >
                    Select Seats
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
