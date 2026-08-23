import { useEffect, useRef } from 'react';
import { useCountdown } from '../hooks/useCountdown';
import '../styles/seatmap.css';

/**
 * CountdownBar — server-authoritative countdown for a hold or a waitlist offer.
 *
 * `expiresAt` always comes from the API, never from a client-started timer, so a
 * skewed device clock cannot buy the user extra time (the server re-checks anyway).
 */
export default function CountdownBar({ expiresAt, onExpired, label }) {
  const { formatted, isExpired, isUrgent } = useCountdown(expiresAt);
  const firedRef = useRef(false);

  // Mirror the countdown into the tab title so it stays visible in a background tab.
  useEffect(() => {
    const base = label || 'Checkout';
    document.title = expiresAt && !isExpired
      ? `(${formatted}) ${base} — CineWave`
      : `${base} — CineWave`;
    return () => { document.title = 'CineWave'; };
  }, [formatted, isExpired, expiresAt, label]);

  // Fire the expiry callback as an effect — never during render, which would
  // navigate or setState mid-render. The ref keeps it to exactly one call even
  // though the parent hands us a fresh `onExpired` closure on every render.
  useEffect(() => { firedRef.current = false; }, [expiresAt]);
  useEffect(() => {
    if (expiresAt && isExpired && !firedRef.current) {
      firedRef.current = true;
      onExpired?.();
    }
  }, [isExpired, expiresAt, onExpired]);

  if (isExpired) {
    return (
      <div className="countdown-bar" style={{ borderColor: 'var(--col-danger)' }}>
        <div>
          <div className="countdown-time urgent">00:00</div>
        </div>
        <div className="countdown-label">
          <strong>Time&rsquo;s up</strong>
          Your reservation has expired. Please select seats again.
        </div>
      </div>
    );
  }

  return (
    <div className="countdown-bar" style={{ borderColor: isUrgent ? 'var(--col-danger)' : 'var(--col-border)' }}>
      <div>
        <div className={`countdown-time${isUrgent ? ' urgent' : ''}`}>{formatted}</div>
      </div>
      <div className="countdown-label">
        <strong>Time remaining</strong>
        These seats are reserved for you until the timer runs out.
      </div>
    </div>
  );
}
