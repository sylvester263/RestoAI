import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Orders from './pages/Orders';
import Kitchen from './pages/Kitchen';
import Insights from './pages/Insights';
import WhatsAppDemo from './pages/WhatsAppDemo';
import PublicMenu from './pages/public/PublicMenu';
import Checkout from './pages/public/Checkout';
import TrackOrder from './pages/public/TrackOrder';
import TableOrder from './pages/public/TableOrder';
import Reservation from './pages/public/Reservation';
import Loyalty from './pages/public/Loyalty';
import Tables from './pages/Tables';
import Reservations from './pages/Reservations';
import Inventory from './pages/Inventory';
import Campaigns from './pages/Campaigns';
import TokenBoard from './pages/display/TokenBoard';
import MenuBoard from './pages/display/MenuBoard';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/order/:tenantSlug" element={<PublicMenu />} />
      <Route path="/order/:tenantSlug/checkout" element={<Checkout />} />
      <Route path="/order/:tenantSlug/track/:orderId" element={<TrackOrder />} />
      <Route path="/table/:qrToken" element={<TableOrder />} />
      <Route path="/order/:tenantSlug/reserve" element={<Reservation />} />
      <Route path="/order/:tenantSlug/loyalty" element={<Loyalty />} />
      <Route path="/display/token-board/:branchId" element={<TokenBoard />} />
      <Route path="/display/menu-board/:branchId" element={<MenuBoard />} />
      <Route path="/kitchen" element={<ProtectedRoute><Kitchen /></ProtectedRoute>} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/menu" element={<Menu />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/tables" element={<Tables />} />
                <Route path="/reservations" element={<Reservations />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/insights" element={<Insights />} />
                <Route path="/whatsapp" element={<WhatsAppDemo />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
