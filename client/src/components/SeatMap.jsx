import '../styles/seatmap.css';

/**
 * SeatMap — Visual grid of seats rendered from grid_row/grid_col coordinates.
 * Aisles appear as natural gaps in the grid.
 */
export default function SeatMap({ seats, selected, onToggle, userId, maxSeats = 6 }) {
  if (!seats?.length) return (
    <div className="empty-state"><p>No seat data available.</p></div>
  );

  // Build grid dimensions
  const maxCol = Math.max(...seats.map(s => s.grid_col));
  const maxRow = Math.max(...seats.map(s => s.grid_row));

  // Index seats by grid position for fast lookup
  const seatGrid = {};
  for (const s of seats) {
    seatGrid[`${s.grid_row}-${s.grid_col}`] = s;
  }

  // Unique row labels in order
  const rowLabels = [...new Set(
    seats.slice().sort((a, b) => a.grid_row - b.grid_row).map(s => s.row_label)
  )];

  const isSelectable = (s) => {
    const effStatus = (s.status === 'HELD' && s.hold_expires_at && new Date(s.hold_expires_at) <= new Date())
      ? 'AVAILABLE' : s.status;
    if (effStatus !== 'AVAILABLE') return false;
    if (selected.has(s.id)) return true; // can deselect
    if (selected.size >= maxSeats) return false;
    return true;
  };

  const getCategoryStyle = (seat) => {
    const col = seat.category_colour || '#888';
    const hex = col.replace('#', '');
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    return {
      '--seat-bg': `rgba(${r},${g},${b},0.12)`,
      '--seat-border': `rgba(${r},${g},${b},0.5)`,
      '--seat-text': col,
      '--seat-bg-hover': `rgba(${r},${g},${b},0.22)`,
    };
  };

  return (
    <div className="seatmap-wrapper">
      <div className="screen-bar">SCREEN / STAGE</div>

      <div className="seatmap-outer">
        {/* Row labels */}
        <div className="seatmap-row-labels">
          {rowLabels.map(label => (
            <div key={label} className="row-label-item">{label}</div>
          ))}
        </div>

        {/* Seat grid */}
        <div
          className="seat-grid"
          style={{
            gridTemplateColumns: `repeat(${maxCol}, var(--seat-size))`,
            gridTemplateRows: `repeat(${maxRow}, var(--seat-size))`,
          }}
        >
          {Array.from({ length: maxRow }, (_, ri) =>
            Array.from({ length: maxCol }, (_, ci) => {
              const key = `${ri+1}-${ci+1}`;
              const seat = seatGrid[key];
              if (!seat) return <div key={key} style={{ gridRow: ri+1, gridColumn: ci+1 }} />;

              const isSel = selected.has(seat.id);
              const effStatus = (seat.status === 'HELD' && seat.hold_expires_at && new Date(seat.hold_expires_at) <= new Date())
                ? 'AVAILABLE' : seat.status;
              const selectable = isSelectable(seat);

              return (
                <button
                  key={seat.id}
                  id={`seat-${seat.id}`}
                  className={`seat seat--${effStatus.toLowerCase()}${isSel ? ' is-selected' : ''}`}
                  style={{
                    gridRow: ri+1,
                    gridColumn: ci+1,
                    ...(effStatus === 'AVAILABLE' && !isSel ? getCategoryStyle(seat) : {}),
                  }}
                  disabled={!selectable}
                  onClick={() => selectable && onToggle(seat)}
                  title={`${seat.row_label}${seat.seat_number} · ${seat.category_name} · ₹${seat.price}`}
                  aria-label={`Seat ${seat.row_label}${seat.seat_number}, ${effStatus.toLowerCase()}`}
                >
                  {seat.seat_number}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
