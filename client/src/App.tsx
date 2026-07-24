import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Market from './pages/Market';
import OrderForm from './pages/OrderForm';
import MyOrders from './pages/MyOrders';
import MyPositions from './pages/MyPositions';
import HKMarket from './pages/HKMarket';
import HKDetail from './pages/HKDetail';
import AuditManage from './pages/admin/AuditManage';
import PriceManage from './pages/admin/PriceManage';
import TradeRecords from './pages/admin/TradeRecords';
import AdminDashboard from './pages/admin/Dashboard';
import UserManage from './pages/admin/UserManage';
import Navbar from './components/Navbar';
import LegalDisclaimer from './components/LegalDisclaimer';
import { ComplianceAcknowledgementModal } from './components/compliance';
import { LEGAL_NOTICE_VERSION } from './compliance/notices';
import { acknowledgeCompliance, getComplianceStatus } from './api';

function ProtectedRoute({ children, adminOnly }: { children: JSX.Element; adminOnly?: boolean }) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Layout({ children }: { children: React.ReactNode }) {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getComplianceStatus(LEGAL_NOTICE_VERSION)
      .then(res => {
        if (!cancelled) setAcknowledged(!!res.data.acknowledged);
      })
      .catch(() => {
        if (!cancelled) {
          setAcknowledged(false);
          setError('合规声明状态加载失败，请点击“已知晓”重试');
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleAcknowledge = async () => {
    setSubmitting(true);
    setError('');
    try {
      await acknowledgeCompliance(LEGAL_NOTICE_VERSION);
      setAcknowledged(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || '确认失败，请检查网络后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const complianceReady = acknowledged === true;

  return (
    <div className="flex min-h-screen flex-col pb-16">
      {acknowledged !== true && (
        <ComplianceAcknowledgementModal
          submitting={submitting || acknowledged === null}
          error={error}
          onAcknowledge={handleAcknowledge}
        />
      )}
      <main className="flex-1">{children}</main>
      <LegalDisclaimer />
      <Navbar complianceReady={complianceReady} />
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
        <Route path="/hk/:code" element={<ProtectedRoute><Layout><HKDetail /></Layout></ProtectedRoute>} />
        <Route path="/hk" element={<ProtectedRoute><Layout><HKMarket /></Layout></ProtectedRoute>} />
        <Route path="/order/:type" element={<ProtectedRoute><Layout><OrderForm /></Layout></ProtectedRoute>} />
        <Route path="/my-orders" element={<ProtectedRoute><Layout><MyOrders /></Layout></ProtectedRoute>} />
        <Route path="/positions" element={<ProtectedRoute><Layout><MyPositions /></Layout></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
        <Route path="/admin/audit" element={<ProtectedRoute adminOnly><Layout><AuditManage /></Layout></ProtectedRoute>} />
        <Route path="/admin/price" element={<ProtectedRoute adminOnly><Layout><PriceManage /></Layout></ProtectedRoute>} />
        <Route path="/admin/trades" element={<ProtectedRoute adminOnly><Layout><TradeRecords /></Layout></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute adminOnly><Layout><UserManage /></Layout></ProtectedRoute>} />
      </Routes>
    </HashRouter>
  );
}
