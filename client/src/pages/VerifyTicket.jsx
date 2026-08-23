import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function VerifyTicket() {
  const { reference } = useParams();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sig = new URLSearchParams(window.location.search).get('s');
    api.get(`/bookings/verify/${reference}?s=${sig}`)
      .then(setResult)
      .catch(err => setResult({ valid: false, error: err.message }))
      .finally(() => setLoading(false));
  }, [reference]);

  if (loading) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" style={{ width: '40px', height: '40px' }} />
    </div>
  );

  const isValid = result?.valid && result?.status === 'CONFIRMED';

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: '480px', width: '100%', padding: '0 16px' }}>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '40px 32px' }}>
            <div style={{ fontSize: '4rem', marginBottom: '16px' }}>
              {isValid ? '✓' : '✗'}
            </div>
            <h2 style={{ marginBottom: '8px', color: isValid ? 'var(--col-available)' : 'var(--col-danger)' }}>
              {isValid ? 'Valid Ticket' : 'Invalid Ticket'}
            </h2>

            {isValid && (
              <>
                <p className="text-muted" style={{ marginBottom: '24px' }}>{result.customer_name}</p>
                <div style={{ textAlign: 'left', background: 'var(--col-bg)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
                  <table style={{ width: '100%' }}>
                    <tbody>
                      <tr><td className="text-muted text-sm" style={{ padding: '6px 0' }}>Ref</td>
                          <td style={{ padding: '6px 0', fontWeight: 600 }}>{result.reference}</td></tr>
                      <tr><td className="text-muted text-sm" style={{ padding: '6px 0' }}>Event</td>
                          <td style={{ padding: '6px 0' }}>{result.event_title}</td></tr>
                      <tr><td className="text-muted text-sm" style={{ padding: '6px 0' }}>Venue</td>
                          <td style={{ padding: '6px 0' }}>{result.venue_name}</td></tr>
                      <tr><td className="text-muted text-sm" style={{ padding: '6px 0' }}>Seats</td>
                          <td style={{ padding: '6px 0' }}>
                            {result.seats?.map(s => `${s.row_label}${s.seat_number}`).join(', ')}
                          </td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!isValid && (
              <p className="text-muted">
                {result?.error || (result?.status === 'CANCELLED' ? 'This booking has been cancelled.' : 'Booking not found or signature invalid.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
