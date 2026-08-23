import { useState, useEffect } from 'react';

/**
 * useCountdown — Server-authoritative countdown to an ISO timestamp.
 * Returns { secondsLeft, formatted, isExpired }.
 * Uses server-provided expiresAt to avoid clock drift.
 */
export function useCountdown(expiresAt) {
  const getSeconds = () => Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));

  const [seconds, setSeconds] = useState(getSeconds);

  useEffect(() => {
    if (!expiresAt) return;
    setSeconds(getSeconds());
    const interval = setInterval(() => {
      const left = getSeconds();
      setSeconds(left);
      if (left === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return {
    secondsLeft: seconds,
    formatted: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    isExpired: seconds === 0,
    isUrgent: seconds > 0 && seconds < 60,
  };
}
