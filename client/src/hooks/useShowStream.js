import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../api';

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * useShowStream — SSE hook for real-time seat map updates.
 * On SSE error/disconnect: reconnects and re-fetches full seat map.
 * Also polls every 20 s as a fallback if SSE is blocked by proxy.
 */
export function useShowStream(showId, onUpdate) {
  const esRef = useRef(null);
  const pollRef = useRef(null);

  const fetchFull = useCallback(async () => {
    try {
      const seats = await api.get(`/shows/${showId}/seats`);
      onUpdate(seats, true); // true = full replace
    } catch { /* ignore — SSE will retry */ }
  }, [showId, onUpdate]);

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || !showId) return;

    if (esRef.current) esRef.current.close();

    const es = new EventSource(`${BASE}/shows/${showId}/stream?token=${token}`);
    esRef.current = es;

    es.addEventListener('seat_update', (e) => {
      try {
        const { seats } = JSON.parse(e.data);
        if (seats.length > 0) {
          onUpdate(seats, false); // false = delta merge
        } else {
          fetchFull(); // empty seats array = trigger full refresh
        }
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 3 s + re-fetch full map
      setTimeout(() => { fetchFull(); connect(); }, 3000);
    };
  }, [showId, onUpdate, fetchFull]);

  useEffect(() => {
    if (!showId) return;

    fetchFull();
    connect();

    // 20 s polling fallback
    pollRef.current = setInterval(fetchFull, 20_000);

    return () => {
      esRef.current?.close();
      clearInterval(pollRef.current);
    };
  }, [showId, connect, fetchFull]);
}
