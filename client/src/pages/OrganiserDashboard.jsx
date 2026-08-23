import { useState, useEffect } from 'react';
import api from '../api';
import CreateShowForm from '../components/CreateShowForm';
import { useAuth } from '../context/AuthContext';

export default function OrganiserDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [organisers, setOrganisers] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selEvent, setSelEvent] = useState(null);
  const [loading, setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showShowForm, setShowShowForm] = useState(false);
  const [form, setForm]        = useState({ title: '', type: 'MOVIE', description: '', language: '', duration_min: '', organiserId: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError]      = useState(null);

  const loadEvents = () =>
    api.get('/organiser/events').then(setEvents);

  useEffect(() => {
    loadEvents()
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Only an admin may assign an event to someone else; the endpoint returns [] otherwise.
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/organiser/organisers').then(setOrganisers).catch(() => setOrganisers([]));
  }, [isAdmin]);

  const refreshSummary = (eventId) =>
    api.get(`/organiser/events/${eventId}/summary`)
      .then(setSummary)
      .catch(err => setError(err.message));

  const loadSummary = (eventId) => {
    setSelEvent(eventId);
    setSummary(null);
    setShowShowForm(false);
    refreshSummary(eventId);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      const event = await api.post('/organiser/events', {
        ...form,
        duration_min: form.duration_min ? parseInt(form.duration_min) : undefined,
        organiserId: form.organiserId || undefined,
      });
      // The POST response has no organiser_name; refetch so the list stays accurate for
      // an admin, who sees an owner label on every row.
      await loadEvents().catch(() => setEvents(prev => [event, ...prev]));
      setShowForm(false);
      setForm({ title: '', type: 'MOVIE', description: '', language: '', duration_min: '', organiserId: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="page"><div className="container"><div className="spinner" style={{ margin: '60px auto', width: '32px', height: '32px' }} /></div></div>;

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1>{isAdmin ? 'Event Administration' : 'Organiser Dashboard'}</h1>
            <p className="text-muted text-sm" style={{ marginTop: '4px' }}>
              {isAdmin
                ? 'Create, schedule and report on events across every organiser.'
                : 'Create events, schedule shows and track revenue.'}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ New Event'}
          </button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

        {/* Create Event Form */}
        {showForm && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-body">
              <h3 style={{ marginBottom: '20px' }}>Create Event</h3>
              <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Title *</label>
                  <input className="form-input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="MOVIE">Movie</option>
                    <option value="CONCERT">Concert</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Language</label>
                  <input className="form-input" value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Duration (min)</label>
                  <input type="number" className="form-input" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} />
                </div>
                {isAdmin && (
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label className="form-label">Organiser</label>
                    <select
                      className="form-input"
                      value={form.organiserId}
                      onChange={e => setForm(f => ({ ...f, organiserId: e.target.value }))}
                    >
                      <option value="">Myself ({user?.name})</option>
                      {organisers
                        .filter(o => o.id !== user?.id)
                        .map(o => (
                          <option key={o.id} value={o.id}>{o.name} — {o.email}</option>
                        ))}
                    </select>
                    <span className="text-xs text-dim">Publish this event under another organiser's account.</span>
                  </div>
                )}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Description</label>
                  <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <button type="submit" className="btn btn-primary" disabled={creating}>
                    {creating ? 'Creating…' : 'Create Event'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Events list */}
          <div>
            <h3 style={{ marginBottom: '12px' }}>{isAdmin ? 'All Events' : 'Your Events'}</h3>
            {events.length === 0 && <p className="text-muted text-sm">No events yet.</p>}
            {events.map(e => (
              <div key={e.id} className="card card-sm card-lift" style={{ marginBottom: '10px', cursor: 'pointer', borderColor: selEvent === e.id ? 'var(--col-accent)' : undefined }}
                onClick={() => loadSummary(e.id)}>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                    <span className="badge badge-neutral text-xs">{e.type}</span>
                  </div>
                  <p className="font-semibold text-sm">{e.title}</p>
                  <p className="text-xs text-muted">
                    {e.show_count} show{e.show_count != 1 ? 's' : ''}
                    {isAdmin && e.organiser_name ? ` · ${e.organiser_name}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary panel */}
          <div>
            {!selEvent && (
              <div className="empty-state" style={{ padding: '40px' }}>
                <div className="icon">📊</div>
                <p>Select an event to view revenue summary</p>
              </div>
            )}
            {selEvent && !summary && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="spinner" style={{ margin: '0 auto', width: '28px', height: '28px' }} />
              </div>
            )}
            {summary && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3>{summary.event.title}</h3>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowShowForm(v => !v)}
                  >
                    {showShowForm ? 'Close' : '+ Add Show'}
                  </button>
                </div>

                {showShowForm && (
                  <div className="card" style={{ marginBottom: '20px' }}>
                    <div className="card-body">
                      <h4 style={{ marginBottom: '16px' }}>Schedule a show</h4>
                      <CreateShowForm
                        eventId={selEvent}
                        onCreated={() => { loadEvents(); refreshSummary(selEvent); }}
                      />
                    </div>
                  </div>
                )}

                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                  {[
                    { label: 'Tickets Sold', value: summary.totals.tickets_sold },
                    { label: 'Gross Revenue', value: `₹${parseInt(summary.totals.gross_revenue).toLocaleString()}` },
                    { label: 'Cancellations', value: summary.totals.cancellations },
                    { label: 'Refunded', value: `₹${parseInt(summary.totals.refunded_value).toLocaleString()}` },
                  ].map(c => (
                    <div key={c.label} className="card card-sm">
                      <div className="card-body" style={{ padding: '14px' }}>
                        <p className="text-xs text-muted" style={{ marginBottom: '4px' }}>{c.label}</p>
                        <p className="font-semibold" style={{ fontSize: '1.25rem' }}>{c.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Category breakdown */}
                <div className="card" style={{ marginBottom: '16px' }}>
                  <div className="card-body">
                    <h4 style={{ marginBottom: '16px' }}>By Category</h4>
                    {summary.byCategory.map(cat => (
                      <div key={cat.category} style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span className="text-sm font-semibold">{cat.category}</span>
                          <span className="text-sm">{cat.tickets} sold · ₹{parseInt(cat.revenue).toLocaleString()}</span>
                        </div>
                        {/* CSS bar */}
                        <div style={{ background: 'var(--col-border)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                          <div style={{
                            background: cat.colour_hex || 'var(--col-accent)',
                            width: `${Math.min(100, parseFloat(cat.occupancy_pct) || 0)}%`,
                            height: '100%',
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                        <p className="text-xs text-muted" style={{ marginTop: '2px' }}>{cat.occupancy_pct}% occupancy</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Per-show */}
                <div className="card">
                  <div className="card-body">
                    <h4 style={{ marginBottom: '12px' }}>By Show</h4>
                    <div className="table-wrap">
                      <table>
                        <thead><tr>
                          <th>Date</th><th>Venue</th><th>Sold</th><th>Revenue</th><th>Waitlist</th>
                        </tr></thead>
                        <tbody>
                          {summary.byShow.map(s => (
                            <tr key={s.id}>
                              <td className="text-sm">{new Date(s.starts_at).toLocaleDateString('en-IN')}</td>
                              <td className="text-sm">{s.venue_name}</td>
                              <td className="text-sm">{s.tickets_sold}/{s.total_seats}</td>
                              <td className="text-sm">₹{parseInt(s.revenue).toLocaleString()}</td>
                              <td className="text-sm">{s.waitlist_depth}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
