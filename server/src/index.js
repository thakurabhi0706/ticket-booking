/**
 * index.js — Express application bootstrap.
 * Registers all routes, middleware, SSE, and starts the sweeper.
 */
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startSweeper } from './worker/sweeper.js';
import { clientCount } from './realtime/sse.js';
import { reportMailConfig } from './services/emailService.js';
import { reportSmsConfig } from './services/smsService.js';

import authRoutes      from './routes/auth.js';
import eventRoutes     from './routes/events.js';
import venueRoutes     from './routes/venues.js';
import showRoutes      from './routes/shows.js';
import holdRoutes      from './routes/holds.js';
import bookingRoutes   from './routes/bookings.js';
import waitlistRoutes  from './routes/waitlist.js';
import organiserRoutes from './routes/organiser.js';
import adminRoutes     from './routes/admin.js';

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.APP_URL,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));

// Trust the proxy so rate limiting sees the real client IP.
app.set('trust proxy', 1);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    env: config.NODE_ENV,
    sseClients: clientCount(),
    ts: new Date().toISOString(),
  });
});

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/events',    eventRoutes);
app.use('/api/venues',    venueRoutes);     // read-only directory for organisers
app.use('/api/shows',     showRoutes);       // /api/shows/:id + /api/shows/:id/stream + /api/shows/:id/seats
app.use('/api',           holdRoutes);       // /api/shows/:showId/holds + /api/holds/:groupId
app.use('/api/bookings',  bookingRoutes);    // /api/bookings/me + /api/bookings/verify/:ref + /api/bookings/:id
app.use('/api',           waitlistRoutes);   // /api/shows/:id/waitlist + /api/waitlist/... + /api/me/waitlist
app.use('/api/organiser', organiserRoutes);
app.use('/api/admin',     adminRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`\n🎟  CineWave API running on port ${PORT} [${config.NODE_ENV}]`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  reportMailConfig();
  reportSmsConfig();
  startSweeper();
});

export default app;
