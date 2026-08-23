import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Nav from './components/Nav';
import Background3D from './components/Background3D';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import Home              from './pages/Home';
import EventDetail       from './pages/EventDetail';
import ShowSeats         from './pages/ShowSeats';
import Checkout          from './pages/Checkout';
import BookingSuccess    from './pages/BookingSuccess';
import MyBookings        from './pages/MyBookings';
import MyWaitlist        from './pages/MyWaitlist';
import OfferClaim        from './pages/OfferClaim';
import Login             from './pages/Login';
import Register          from './pages/Register';
import VerifyTicket      from './pages/VerifyTicket';
import OrganiserDashboard from './pages/OrganiserDashboard';
import AdminDashboard    from './pages/AdminDashboard';
import AdminVenues       from './pages/AdminVenues';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Background3D />
        <Nav />
        <Routes>
          {/* Public */}
          <Route path="/"                      element={<Home />} />
          <Route path="/events/:id"            element={<EventDetail />} />
          <Route path="/shows/:id"             element={<ShowSeats />} />
          <Route path="/verify/:reference"     element={<VerifyTicket />} />
          <Route path="/login"                 element={<Login />} />
          <Route path="/register"              element={<Register />} />
          <Route path="/waitlist/offer/:token" element={<OfferClaim />} />

          {/* Customer */}
          <Route path="/checkout/:groupId" element={
            <ProtectedRoute><Checkout /></ProtectedRoute>
          } />
          <Route path="/booking/:reference" element={
            <ProtectedRoute><BookingSuccess /></ProtectedRoute>
          } />
          <Route path="/my/bookings" element={
            <ProtectedRoute><MyBookings /></ProtectedRoute>
          } />
          <Route path="/my/waitlist" element={
            <ProtectedRoute><MyWaitlist /></ProtectedRoute>
          } />

          {/* Organiser */}
          <Route path="/organiser" element={
            <ProtectedRoute role="ORGANISER"><OrganiserDashboard /></ProtectedRoute>
          } />

          {/* Admin — /admin is the control centre; venue tooling moved to /admin/venues */}
          <Route path="/admin" element={
            <ProtectedRoute role="ADMIN"><AdminDashboard /></ProtectedRoute>
          } />
          <Route path="/admin/venues" element={
            <ProtectedRoute role="ADMIN"><AdminVenues /></ProtectedRoute>
          } />

          {/* 404 */}
          <Route path="*" element={
            <div className="page" style={{ textAlign: 'center', paddingTop: '80px' }}>
              <h1 style={{ marginBottom: '8px' }}>404</h1>
              <p className="text-muted">Page not found.</p>
              <a href="/" className="btn btn-primary" style={{ marginTop: '20px', display: 'inline-flex' }}>Go home</a>
            </div>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
