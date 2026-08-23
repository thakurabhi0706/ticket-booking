import '../styles/seatmap.css';

export default function SeatLegend({ categories = [] }) {
  return (
    <div className="seatmap-legend">
      <div className="legend-item">
        <div className="legend-swatch available" />
        <span>Available</span>
      </div>
      <div className="legend-item">
        <div className="legend-swatch selected" />
        <span>Selected</span>
      </div>
      <div className="legend-item">
        <div className="legend-swatch held" />
        <span>Held</span>
      </div>
      <div className="legend-item">
        <div className="legend-swatch offered" />
        <span>Waitlist offered</span>
      </div>
      <div className="legend-item">
        <div className="legend-swatch booked" />
        <span>Booked</span>
      </div>
    </div>
  );
}
