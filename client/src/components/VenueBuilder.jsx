import { useState, useEffect, useMemo } from 'react';
import api from '../api';

const PALETTE = ['#B45309', '#374151', '#1E3A5F', '#4C1D95', '#065F46'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * VenueBuilder — the admin's seat-layout editor for one venue.
 *
 *  1. Define seat categories (name + colour).
 *  2. Generate a grid: N rows × M seats, assigning a contiguous row range to each
 *     category, with optional aisles.
 *  3. Preview it, then POST /admin/venues/:id/seats/bulk.
 *
 * Aisles are rendered as real gaps by skipping a grid column, which is exactly
 * what the customer-facing seat map does with the stored grid_col values.
 */
export default function VenueBuilder({ venue, onChanged }) {
  const [categories, setCategories] = useState([]);
  const [layout, setLayout] = useState([]);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  const [catForm, setCatForm] = useState({ name: '', colour_hex: PALETTE[0] });
  const [grid, setGrid] = useState({ rowCount: 10, seatsPerRow: 12, aisles: '4,8' });
  const [rowCats, setRowCats] = useState({});

  const load = () => {
    Promise.all([
      api.get(`/admin/venues/${venue.id}`),
      api.get(`/admin/venues/${venue.id}/layout`),
    ]).then(([v, seats]) => {
      setCategories(v.categories || []);
      setLayout(seats || []);
    }).catch(err => setError(err.message));
  };

  useEffect(load, [venue.id]);

  const rowLabels = useMemo(
    () => ALPHABET.slice(0, Math.min(26, Math.max(1, Number(grid.rowCount) || 0))).split(''),
    [grid.rowCount]
  );

  const aisleCols = useMemo(
    () => String(grid.aisles).split(',')
      .map(n => parseInt(n.trim(), 10))
      .filter(Number.isInteger),
    [grid.aisles]
  );

  const addCategory = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/venues/${venue.id}/categories`, {
        name: catForm.name,
        colour_hex: catForm.colour_hex,
        display_rank: categories.length,
      });
      setCatForm({ name: '', colour_hex: PALETTE[(categories.length + 1) % PALETTE.length] });
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setError(null);
    if (categories.length === 0) return setError('Add at least one seat category first.');

    const categoryMap = {};
    for (const label of rowLabels) {
      const catId = rowCats[label] || categories[0].id;
      categoryMap[label] = catId;
    }

    setBusy(true);
    try {
      const res = await api.post(`/admin/venues/${venue.id}/seats/bulk`, {
        rows: rowLabels,
        seatsPerRow: Number(grid.seatsPerRow),
        categoryMap,
        aisleAfterCols: aisleCols,
      });
      setError(null);
      load();
      onChanged?.();
      alert(`Created ${res.created} new seat(s) of ${res.requested} requested. ` +
            `Existing seats were left untouched.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Live preview of the grid about to be generated.
  const preview = useMemo(() => {
    const cells = [];
    rowLabels.forEach((label, ri) => {
      let col = 1;
      for (let n = 1; n <= Number(grid.seatsPerRow || 0); n++) {
        const catId = rowCats[label] || categories[0]?.id;
        const colour = categories.find(c => c.id === catId)?.colour_hex || '#888';
        cells.push({ key: `${label}${n}`, row: ri + 1, col, colour });
        col++;
        if (aisleCols.includes(n)) col++;
      }
    });
    return cells;
  }, [rowLabels, grid.seatsPerRow, rowCats, categories, aisleCols]);

  const maxCol = preview.reduce((m, c) => Math.max(m, c.col), 0);

  return (
    <div className="card" style={{ marginTop: '16px' }}>
      <div className="card-body">
        <h3 style={{ marginBottom: '4px' }}>{venue.name} — layout</h3>
        <p className="text-muted text-sm" style={{ marginBottom: '20px' }}>
          {layout.length} seat{layout.length === 1 ? '' : 's'} currently defined.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

        {/* ── Categories ─────────────────────────────────────────── */}
        <h4 style={{ marginBottom: '12px' }}>Seat categories</h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {categories.length === 0 && <span className="text-muted text-sm">None yet.</span>}
          {categories.map(c => (
            <span key={c.id} className="price-chip">
              <span className="price-chip-dot" style={{ background: c.colour_hex }} />
              {c.name}
            </span>
          ))}
        </div>

        <form onSubmit={addCategory} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '28px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="cat-name">Category name</label>
            <input
              id="cat-name" className="form-input" required style={{ width: '180px' }}
              placeholder="Premium"
              value={catForm.name}
              onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="cat-colour">Colour</label>
            <input
              id="cat-colour" type="color" className="form-input"
              style={{ width: '64px', padding: '2px' }}
              value={catForm.colour_hex}
              onChange={e => setCatForm(f => ({ ...f, colour_hex: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
            Add category
          </button>
        </form>

        {/* ── Grid generator ─────────────────────────────────────── */}
        <h4 style={{ marginBottom: '12px' }}>Generate seat grid</h4>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="grid-rows">Rows (A…)</label>
            <input
              id="grid-rows" type="number" min="1" max="26" className="form-input"
              style={{ width: '100px' }}
              value={grid.rowCount}
              onChange={e => setGrid(g => ({ ...g, rowCount: e.target.value }))}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="grid-seats">Seats per row</label>
            <input
              id="grid-seats" type="number" min="1" max="50" className="form-input"
              style={{ width: '120px' }}
              value={grid.seatsPerRow}
              onChange={e => setGrid(g => ({ ...g, seatsPerRow: e.target.value }))}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="grid-aisles">Aisle after seat #</label>
            <input
              id="grid-aisles" className="form-input" style={{ width: '140px' }}
              placeholder="4,8"
              value={grid.aisles}
              onChange={e => setGrid(g => ({ ...g, aisles: e.target.value }))}
            />
          </div>
        </div>

        {/* Per-row category assignment */}
        {categories.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {rowLabels.map(label => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="text-sm font-semibold" style={{ width: '18px' }}>{label}</span>
                <select
                  className="form-input" style={{ width: '120px', padding: '4px 6px' }}
                  value={rowCats[label] || categories[0].id}
                  onChange={e => setRowCats(r => ({ ...r, [label]: e.target.value }))}
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        {/* Live preview */}
        {maxCol > 0 && (
          <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${maxCol}, 16px)`,
                gap: '3px',
                width: 'max-content',
              }}
            >
              {preview.map(c => (
                <div
                  key={c.key}
                  title={c.key}
                  style={{
                    gridRow: c.row, gridColumn: c.col,
                    height: '16px', borderRadius: '3px',
                    background: c.colour, opacity: 0.75,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : `Generate ${rowLabels.length * Number(grid.seatsPerRow || 0)} seats`}
        </button>
      </div>
    </div>
  );
}
