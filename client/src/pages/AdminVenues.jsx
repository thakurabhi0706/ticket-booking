import { useState, useEffect } from 'react';
import api from '../api';
import VenueBuilder from '../components/VenueBuilder';

export default function AdminVenues() {
  const [venues, setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]    = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]      = useState({ name: '', city: '', address: '' });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);

  const fetchVenues = () => {
    setLoading(true);
    api.get('/admin/venues')
      .then(setVenues)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchVenues(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      await api.post('/admin/venues', form);
      setShowForm(false);
      setForm({ name: '', city: '', address: '' });
      fetchVenues();
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
          <h1>Venue Management</h1>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ New Venue'}
          </button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

        {showForm && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-body">
              <h3 style={{ marginBottom: '20px' }}>Create Venue</h3>
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px' }}>
                <div className="form-group">
                  <label className="form-label">Venue Name *</label>
                  <input className="form-input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">City *</label>
                  <input className="form-input" required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Address</label>
                  <input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create Venue'}
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Name</th><th>City</th><th>Address</th><th>Seats</th><th>Created by</th>
              </tr></thead>
              <tbody>
                {venues.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--col-text-muted)' }}>No venues yet</td></tr>
                )}
                {venues.map(v => (
                  <tr
                    key={v.id}
                    onClick={() => setSelected(sel => (sel?.id === v.id ? null : v))}
                    style={{
                      cursor: 'pointer',
                      background: selected?.id === v.id ? 'var(--col-bg)' : undefined,
                    }}
                  >
                    <td className="font-semibold">{v.name}</td>
                    <td>{v.city}</td>
                    <td className="text-muted text-sm">{v.address || '—'}</td>
                    <td>{v.seat_count}</td>
                    <td className="text-muted text-sm">{v.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-muted text-sm" style={{ marginTop: '12px' }}>
          Select a venue to define its seat categories and generate its seat grid.
        </p>

        {selected && (
          <VenueBuilder venue={selected} onChanged={fetchVenues} />
        )}
      </div>
    </div>
  );
}
