import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { hasRole } from './api';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Platform from './pages/Platform';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Stock from './pages/Stock';
import Purchases from './pages/Purchases';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Profile from './pages/Profile';
import Billing from './pages/Billing';
import { ToastHost } from './components/Toasts';

function Splash() {
  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh', background: '#eef1f6' }}>
      <div className="text-center">
        <div className="spinner-border text-primary mb-2"></div>
        <div className="text-muted small">Loading…</div>
      </div>
    </div>
  );
}

function Protected({ min = 'cashier', children }) {
  const { me, authReady } = useApp();
  if (!authReady) return <Splash />;
  if (!me) return <Navigate to="/login" replace />;
  if (!hasRole(me, min)) return <Navigate to="/dashboard" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { me, authReady } = useApp();
  if (!authReady) return <Splash />;
  if (me) return <Navigate to="/dashboard" replace />;
  return children;
}

function Home() {
  const { me, authReady } = useApp();
  if (!authReady) return <Splash />;
  return me ? <Navigate to="/dashboard" replace /> : <Landing />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
        <Route path="/platform" element={<Platform />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/products" element={<Products />} />
          <Route path="/categories" element={<Protected min="manager"><Categories /></Protected>} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/purchases" element={<Protected min="manager"><Purchases /></Protected>} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/suppliers" element={<Protected min="manager"><Suppliers /></Protected>} />
          <Route path="/reports" element={<Protected min="manager"><Reports /></Protected>} />
          <Route path="/settings" element={<Protected min="manager"><Settings /></Protected>} />
          <Route path="/users" element={<Protected min="admin"><Users /></Protected>} />
          <Route path="/billing" element={<Protected min="admin"><Billing /></Protected>} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  );
}
