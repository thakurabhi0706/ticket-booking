import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import EventFormModal from '../components/EventFormModal';
import CreateShowForm from '../components/CreateShowForm';

/**
 * AdminDashboard — the platform control centre at /admin.
 *
 * Deliberately a different surface from the customer app and from the organiser's own
 * dashboard: violet chrome (via .admin-scope, which re-points --col-accent), platform-wide
 * counters, and every event regardless of owner.
 *
 * The publish model is the thing this screen exists to make obvious. /api/events only
 * returns events that have a future SCHEDULED show, so a freshly created event is
 * invisible to customers until a show is added. Each row is therefore badged LIVE or
 * DRAFT, and creating an event drops straight into show scheduling.
 */

function StatTile({ label, value, hint, accent }) {
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className={`stat-tile-value${accent ? ' stat-tile-value-accent' : ''}`}>{value}</p>
      {hint && <p className="stat-tile-hint">{hint}</p>}
    </div>
  );
}

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const formatDate = (d) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminDashboard() {
  const { user } = useAuth();

  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [organisers, setOrganisers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // The event whose show-scheduling panel is expanded. Set automatically right after a
  // create, because that is the step that actually puts the event in front of customers.
  const [schedulingFor, setSchedulingFor] = useState(null);

  const [summaryFor, setSummaryFor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadAll = useCallback(async () => {
    // Settled, not all: a failing stats query should not blank the event list too.
    const [statsRes, eventsRes, orgsRes] = await Promise.allSettled([
      api.get('/admin/stats'),
      api.get('/organiser/events'),
      api.get('/organiser/organisers'),
    ]);
    if (statsRes.status === 'fulfilled') setStats(statsRes.value);
    if (eventsRes.status === 'fulfilled') setEvents(eventsRes.value);
    else setError(eventsRes.reason?.message || 'Could not load events.');
    if (orgsRes.status === 'fulfilled') setOrganisers(orgsRes.value);
  }, []);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (ev) => { setEditing(ev); setModalOpen(true); };

  const handleSaved = async (saved, { created }) => {
    setModalOpen(false);
    setEditing(null);
    await loadAll();
    if (created) {
      // Straight into step 2 — an event with no show reaches nobody.
      setSchedulingFor(saved.id);
      setNotice(`"${saved.title}" created. Schedule its first show below to put it on sale.`);
    } else {
      setNotice(`"${saved.title}" updated.`);
    }
  };

  const handleDelete = async (ev) => {
    if (!window.confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
    setBusyId(ev.id);
    setError(null);
    try {
      await api.delete(`/organiser/events/${ev.id}`);
      setNotice(`"${ev.title}" deleted.`);
      if (summaryFor === ev.id) { setSummaryFor(null); setSummary(null); }
      if (schedulingFor === ev.id) setSchedulingFor(null);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSummary = async (ev) => {
    if (summaryFor === ev.id) { setSummaryFor(null); setSummary(null); return; }
    setSummaryFor(ev.id);
    setSummary(null);
    try {
      setSummary(await api.get(`/organiser/events/${ev.id}/summary`));
    } catch (err) {
      setError(err.message);
      setSummaryFor(null);
    }
  };

  const onShowCreated = async () => {
    await loadAll();
    setNotice('Show scheduled — the event is now live and visible to customers.');
    setSchedulingFor(null);
  };

  const liveCount = events.filter(e => e.upcoming_show_count > 0).length;
  const draftCount = events.length - liveCount;

  if (loading) {
    return (
      <div className="page admin-scope">
        <div className="container"><div className="spinner spinner-lg" /></div>
      </div>
    );
  }

  return (
    <div className="page admin-scope">
      <div className="container">

        {/* ── Control-centre header ── */}
        <header className="admin-header rise">
          <div>
            <span className="admin-chip">◆ Admin control centre</span>
            <h1 className="admin-title">Platform administration</h1>
            <p className="text-muted">
              Signed in as <strong>{user?.name}</strong> — you are managing events across every
              organiser on CineWave.
            </p>
          </div>
          <div className="admin-header-actions">
            <Link to="/admin/venues" className="btn btn-secondary">Manage venues</Link>
            <button className="btn btn-primary btn-lg" onClick={openCreate}>＋ Create event</button>
          </div>
        </header>

        {notice && (
          <div className="alert alert-success mb-4" role="status">
            {notice}
            <button className="alert-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}
        {error && (
          <div className="alert alert-error mb-4" role="alert">
            {error}
            <button className="alert-dismiss" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* ── Platform stats ── */}
        {stats && (
          <section className="stat-grid rise">
            <StatTile label="Events live" value={stats.events_live} hint={`${stats.events_total} total`} accent />
            <StatTile label="Upcoming shows" value={stats.shows_upcoming} hint={`${stats.venues_total} venues`} />
            <StatTile label="Tickets sold" value={stats.tickets_sold} hint={`${stats.bookings_confirmed} bookings`} />
            <StatTile label="Gross revenue" value={money(stats.gross_revenue)} hint="confirmed only" accent />
            <StatTile label="Customers" value={stats.customers} hint={`${stats.organisers} organisers`} />
            <StatTile label="Seats held now" value={stats.seats_held_now} hint={`${stats.waitlist_waiting} waiting`} />
          </section>
        )}

        {/* ── Events ── */}
        <section className="admin-section">
          <div className="admin-section-head">
            <div>
              <h2>Events</h2>
              <p className="text-sm text-muted">
                {liveCount} live · {draftCount} draft
                {draftCount > 0 && ' — drafts have no upcoming show, so customers cannot see them yet.'}
              </p>
            </div>
            <button className="btn btn-primary" onClick={openCreate}>＋ Create event</button>
          </div>

          {events.length === 0 && (
            <div className="empty-state card">
              <div className="icon">🎬</div>
              <h3>No events yet</h3>
              <p>Create the first event, then schedule a show to put it on sale.</p>
              <button className="btn btn-primary mt-4" onClick={openCreate}>＋ Create event</button>
            </div>
          )}

          {events.map(ev => {
            const live = ev.upcoming_show_count > 0;
            return (
              <div key={ev.id} className="admin-event card">
                <div className="admin-event-main">
                  <div className="admin-event-info">
                    <div className="admin-event-badges">
                      <span className={`badge ${live ? 'badge-live' : 'badge-draft'}`}>
                        {live ? '● LIVE' : '○ DRAFT'}
                      </span>
                      <span className="badge badge-neutral">{ev.type}</span>
                      {ev.language && <span className="badge badge-neutral">{ev.language}</span>}
                    </div>
                    <h3 className="admin-event-title">{ev.title}</h3>
                    <p className="text-sm text-muted">
                      Organiser: <strong>{ev.organiser_name}</strong> · {ev.show_count} show
                      {ev.show_count !== 1 ? 's' : ''}
                      {live
                        ? ` · next ${formatDate(ev.next_show_at)}`
                        : ' · not visible to customers'}
                    </p>
                  </div>

                  <div className="admin-event-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setSchedulingFor(schedulingFor === ev.id ? null : ev.id)}
                    >
                      {schedulingFor === ev.id ? 'Close' : '＋ Add show'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleSummary(ev)}>
                      {summaryFor === ev.id ? 'Hide revenue' : 'Revenue'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                    {live
                      ? <Link to={`/events/${ev.id}`} className="btn btn-ghost btn-sm">View</Link>
                      : (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(ev)}
                          disabled={busyId === ev.id}
                        >
                          {busyId === ev.id ? '…' : 'Delete'}
                        </button>
                      )}
                  </div>
                </div>

                {!live && (
                  <p className="admin-event-hint">
                    ⓘ This event has no upcoming show. Add one — with a venue, a start time and a
                    price for every seat category — and it appears on the public events page
                    immediately.
                  </p>
                )}

                {schedulingFor === ev.id && (
                  <div className="admin-event-panel">
                    <h4 className="mb-4">Schedule a show for “{ev.title}”</h4>
                    <CreateShowForm eventId={ev.id} onCreated={onShowCreated} />
                  </div>
                )}

                {summaryFor === ev.id && (
                  <div className="admin-event-panel">
                    {!summary && <div className="spinner" />}
                    {summary && (
                      <>
                        <div className="stat-grid stat-grid-compact mb-4">
                          <StatTile label="Tickets sold" value={summary.totals.tickets_sold} />
                          <StatTile label="Gross" value={money(summary.totals.gross_revenue)} accent />
                          <StatTile label="Cancellations" value={summary.totals.cancellations} />
                          <StatTile label="Refunded" value={money(summary.totals.refunded_value)} />
                        </div>

                        {summary.byShow.length > 0 && (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr><th>Date</th><th>Venue</th><th>Sold</th><th>Revenue</th><th>Waitlist</th></tr>
                              </thead>
                              <tbody>
                                {summary.byShow.map(s => (
                                  <tr key={s.id}>
                                    <td>{formatDate(s.starts_at)}</td>
                                    <td>{s.venue_name}</td>
                                    <td>{s.tickets_sold}/{s.total_seats}</td>
                                    <td>{money(s.revenue)}</td>
                                    <td>{s.waitlist_depth}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {modalOpen && (
        <EventFormModal
          event={editing}
          organisers={organisers}
          currentUser={user}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
