import { useLocation, useNavigate } from 'react-router-dom';

const userTabs = [
  { path: '/', label: '行情', icon: '📈' },
  { path: '/hk', label: '港股', icon: '🇭🇰' },
  { path: '/positions', label: '持仓', icon: '💼' },
  { path: '/my-orders', label: '申请', icon: '📋' },
];

const adminTabs = [
  { path: '/admin', label: '仪表盘', icon: '📊' },
  { path: '/admin/audit', label: '审批', icon: '✅' },
  { path: '/admin/price', label: '控价', icon: '🎯' },
  { path: '/admin/trades', label: '记录', icon: '📝' },
];

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const tabs = user?.role === 'admin' ? adminTabs : userTabs;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {tabs.map(tab => (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`flex flex-col items-center py-2 px-3 text-xs transition-colors ${
              location.pathname === tab.path
                ? 'text-blue-600 font-bold'
                : 'text-gray-500 hover:text-blue-500'
            }`}
          >
            <span className="text-lg mb-0.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
        <button
          onClick={handleLogout}
          className="flex flex-col items-center py-2 px-3 text-xs text-gray-400 hover:text-red-500"
        >
          <span className="text-lg mb-0.5">🚪</span>
          退出
        </button>
      </div>
    </nav>
  );
}
