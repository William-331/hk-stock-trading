import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Market from './pages/Market';
import OrderForm from './pages/OrderForm';
import MyOrders from './pages/MyOrders';
import MyPositions from './pages/MyPositions';
import HKMarket from './pages/HKMarket';
import AuditManage from './pages/admin/AuditManage';
import PriceManage from './pages/admin/PriceManage';
import TradeRecords from './pages/admin/TradeRecords';
import AdminDashboard from './pages/admin/Dashboard';
import Navbar from './components/Navbar';

function ProtectedRoute({ children, adminOnly }: { children: JSX.Element; adminOnly?: boolean }) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-16">
      {children}
      <Navbar />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = localStorage.getItem('user');
    if (u) setUser(JSON.parse(u));
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="/" element={<ProtectedRoute><Layout><Market /></Layout></ProtectedRoute>} />
        <Route path="/hk" element={<ProtectedRoute><Layout><HKMarket /></Layout></ProtectedRoute>} />
        <Route path="/order/:type" element={<ProtectedRoute><Layout><OrderForm /></Layout></ProtectedRoute>} />
        <Route path="/my-orders" element={<ProtectedRoute><Layout><MyOrders /></Layout></ProtectedRoute>} />
        <Route path="/positions" element={<ProtectedRoute><Layout><MyPositions /></Layout></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
        <Route path="/admin/audit" element={<ProtectedRoute adminOnly><Layout><AuditManage /></Layout></ProtectedRoute>} />
        <Route path="/admin/price" element={<ProtectedRoute adminOnly><Layout><PriceManage /></Layout></ProtectedRoute>} />
        <Route path="/admin/trades" element={<ProtectedRoute adminOnly><Layout><TradeRecords /></Layout></ProtectedRoute>} />
      </Routes>
    </HashRouter>
  );
}
