/**
 * sse.js — Server-Sent Events registry.
 *
 * All seat-state mutations call broadcastSeatUpdate(showId) after committing.
 * The client merges deltas into its local seat map and only re-fetches on reconnect.
 */

// showId → Set<res>
const clients = new Map();

export function addClient(showId, res) {
  if (!clients.has(showId)) clients.set(showId, new Set());
  clients.get(showId).add(res);
}

export function removeClient(showId, res) {
  clients.get(showId)?.delete(res);
}

/**
 * Broadcast a seat-status update to all listeners of a show.
 * @param {string} showId
 * @param {Array<{seatId:string, status:string}>} seats  Changed seats only
 */
export function broadcastSeatUpdate(showId, seats = []) {
  const group = clients.get(showId);
  if (!group?.size) return;

  const payload = JSON.stringify({ type: 'seat_update', seats, ts: Date.now() });
  const msg = `event: seat_update\ndata: ${payload}\n\n`;

  for (const res of group) {
    try { res.write(msg); } catch { group.delete(res); }
  }
}

export function broadcastShowSoldout(showId) {
  const group = clients.get(showId);
  if (!group?.size) return;
  const msg = `event: show_soldout\ndata: ${JSON.stringify({ showId })}\n\n`;
  for (const res of group) {
    try { res.write(msg); } catch { group.delete(res); }
  }
}

export function sendWaitlistOffer(userId, token, showId) {
  // Targeted: we send to any SSE connection that belongs to this user
  for (const [sid, group] of clients.entries()) {
    if (sid !== showId) continue;
    for (const res of group) {
      if (res.__userId === userId) {
        try {
          res.write(`event: waitlist_offer\ndata: ${JSON.stringify({ token, showId })}\n\n`);
        } catch { group.delete(res); }
      }
    }
  }
}

export function clientCount() {
  let n = 0;
  for (const g of clients.values()) n += g.size;
  return n;
}
