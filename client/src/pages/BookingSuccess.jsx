import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

export default function BookingSuccess() {
  const { reference } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Find the booking by reference from user's list
    api.get('/bookings/me')
      .then(bookings => {
        const b = bookings.find(b => b.reference === reference);
        if (b) return api.get(`/bookings/${b.id}`);
        throw new Error('Booking not found.');
      })
      .then(setBooking)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [reference]);

  if (loading) return (
    <div className="page"><div className="container">
      <div className="skeleton" style={{ height: '400px', maxWidth: '560px' }} />
    </div></div>
  );

  if (error) return (
    <div className="page"><div className="container">
      <div className="alert alert-error">{error}</div>
      <Link to="/my/bookings" className="btn btn-secondary mt-4">My Bookings</Link>
    </div></div>
  );

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '560px' }}>
        {/* Success header */}
        <div style={{
          textAlign: 'center', padding: '32px 24px', marginBottom: '24px',
          background: 'var(--col-surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--col-border)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✓</div>
          <h1 style={{ marginBottom: '8px' }}>Booking Confirmed</h1>
          <p className="text-muted">Your seats are reserved. Check your email for the QR ticket.</p>
          <div style={{ marginTop: '20px' }}>
            <span className="badge badge-accent" style={{ fontSize: '1rem', padding: '6px 16px' }}>
              {booking?.reference}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-body">
            <h3 style={{ marginBottom: '16px' }}>Booking Details</h3>
            <table style={{ width: '100%' }}>
              <tbody>
                <tr><td className="text-muted text-sm" style={{ padding: '8px 0', width: '40%' }}>Event</td>
                    <td style={{ padding: '8px 0' }}>{booking?.event_title}</td></tr>
                <tr><td className="text-muted text-sm" style={{ padding: '8px 0' }}>Venue</td>
                    <td style={{ padding: '8px 0' }}>{booking?.venue_name}</td></tr>
                <tr><td className="text-muted text-sm" style={{ padding: '8px 0' }}>Date</td>
                    <td style={{ padding: '8px 0' }}>
                      {new Date(booking?.starts_at).toLocaleString('en-IN', {
                        weekday: 'short', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })} IST
                    </td></tr>
                <tr><td className="text-muted text-sm" style={{ padding: '8px 0' }}>Seats</td>
                    <td style={{ padding: '8px 0' }}>
                      {booking?.seats?.map(s => `${s.row_label}${s.seat_number}`).join(', ')}
                    </td></tr>
                <tr><td className="text-muted text-sm" style={{ padding: '8px 0' }}>Total</td>
                    <td style={{ padding: '8px 0', fontWeight: 700 }}>₹{booking?.total_amount}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* QR code */}
        {booking?.qrDataURL && (
          <div className="card" style={{ marginBottom: '16px', textAlign: 'center' }}>
            <div className="card-body">
              <h3 style={{ marginBottom: '16px' }}>Entry QR Code</h3>
              <img
                src={booking.qrDataURL}
                alt="Booking QR Code"
                style={{ width: '200px', height: '200px', margin: '0 auto', borderRadius: '8px' }}
              />
              <p className="text-muted text-sm" style={{ marginTop: '12px' }}>
                Present this at the venue entrance. Also sent to your email.
              </p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <Link to="/my/bookings" className="btn btn-secondary btn-full">My Bookings</Link>
          <Link to="/" className="btn btn-primary btn-full">Browse More Events</Link>
        </div>
      </div>
    </div>
  );
}
