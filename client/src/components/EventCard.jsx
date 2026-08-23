import { useRef } from 'react';
import { Link } from 'react-router-dom';

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Deterministic poster gradient for events with no artwork, keyed off the title. */
function fallbackArt(title = '') {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return `linear-gradient(140deg,
    hsl(${hash}, 26%, 20%) 0%,
    hsl(${(hash + 40) % 360}, 22%, 13%) 60%,
    #171717 100%)`;
}

const MAX_TILT = 7; // degrees — past ~8 the text starts to smear

/** Per-interaction, so a mid-session OS change is honoured. */
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function EventCard({ event }) {
  const ref = useRef(null);

  // Pointer-driven rather than CSS :hover so the card tracks the cursor. Written to
  // style directly to skip a re-render per mousemove.
  const handleMove = (e) => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform =
      `perspective(900px) rotateX(${-py * MAX_TILT}deg) rotateY(${px * MAX_TILT}deg) translateY(-6px) scale(1.015)`;
    el.style.setProperty('--glare-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--glare-y', `${(py + 0.5) * 100}%`);
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
  };

  return (
    <Link to={`/events/${event.id}`} className="event-card-link">
      <div
        ref={ref}
        className="card event-card"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {/* Poster */}
        <div
          className="event-card-poster"
          style={{
            background: event.poster_url
              ? `url(${event.poster_url}) center/cover`
              : fallbackArt(event.title),
          }}
        >
          <div className="event-card-poster-top">
            <span className={`badge ${event.type === 'MOVIE' ? 'badge-neutral' : 'badge-accent'}`}>
              {event.type}
            </span>
            {event.min_price && (
              <span className="badge badge-neutral">from ₹{event.min_price}</span>
            )}
          </div>
          {!event.poster_url && (
            <span className="event-card-poster-glyph">{event.type === 'MOVIE' ? '🎬' : '🎵'}</span>
          )}
        </div>

        <div className="card-body event-card-body">
          <h3 className="event-card-title">{event.title}</h3>
          {event.language && (
            <p className="text-muted text-xs event-card-lang">{event.language}</p>
          )}
          <div className="event-card-meta">
            <span className="event-card-pin">📍</span>
            <span className="text-muted text-sm">{event.city}</span>
          </div>
          {event.next_show_at && (
            <p className="text-sm event-card-next">Next: {formatDate(event.next_show_at)}</p>
          )}
        </div>

        {/* Follows the cursor, so the tilt reads as a lit surface rather than a skew. */}
        <span className="event-card-glare" aria-hidden="true" />
      </div>
    </Link>
  );
}
