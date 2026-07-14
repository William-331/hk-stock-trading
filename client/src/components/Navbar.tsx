import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ChangePasswordModal from './ChangePasswordModal';

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
  const [showChangePassword, setShowChangePassword] = useState(false);
  // 首登软提示：普通用户若从未改过密码，登录后弹一次「建议修改初始密码」
  const [showPwdReminder, setShowPwdReminder] = useState(false);

  useEffect(() => {
    if (!user || user.role === 'admin') return;
    const changedKey = `pwdChanged_${user.username}`;   // 改密成功后永久写入，写了就不再提示
    const shownKey = `pwdReminderShown_${user.username}`; // 本次会话只提示一次，避免切页反复弹
    if (localStorage.getItem(changedKey)) return;
    if (sessionStorage.getItem(shownKey)) return;
    sessionStorage.setItem(shownKey, '1');
    setShowPwdReminder(true);
  }, [user?.username, user?.role]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handlePasswordSuccess = () => {
    // 改密成功：记住这个账号已改过，之后不再提示
    if (user?.username) localStorage.setItem(`pwdChanged_${user.username}`, '1');
    setShowChangePassword(false);
    handleLogout();
  };

  const handleReminderChange = () => {
    setShowPwdReminder(false);
    setShowChangePassword(true);
  };

  return (
    <>
      {showChangePassword && <ChangePasswordModal onClose={handlePasswordSuccess} />}

      {/* 首登软提示：建议修改初始密码（可跳过） */}
      {showPwdReminder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] px-4">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6 text-center">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-base font-semibold text-gray-800 mb-2">为了账户安全</h2>
            <p className="text-xs text-gray-500 mb-5 leading-relaxed">
              检测到您可能仍在使用初始密码，建议尽快修改为专属密码，保护您的账户安全。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowPwdReminder(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                稍后再说
              </button>
              <button
                onClick={handleReminderChange}
                className="flex-1 py-2.5 bg-[#1a5ce0] text-white rounded-lg text-sm font-medium hover:bg-[#154ec5] transition"
              >
                去修改
              </button>
            </div>
          </div>
        </div>
      )}

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
          {user?.role === 'admin' ? (
            <button
              onClick={() => navigate('/admin/users')}
              className={`flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                location.pathname === '/admin/users'
                  ? 'text-blue-600 font-bold'
                  : 'text-gray-500 hover:text-blue-500'
              }`}
            >
              <span className="text-lg mb-0.5">👥</span>
              用户
            </button>
          ) : (
            <button
              onClick={() => setShowChangePassword(true)}
              className="flex flex-col items-center py-2 px-3 text-xs text-gray-400 hover:text-blue-500"
            >
              <span className="text-lg mb-0.5">🔑</span>
              改密
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center py-2 px-3 text-xs text-gray-400 hover:text-red-500"
          >
            <span className="text-lg mb-0.5">🚪</span>
            退出
          </button>
        </div>
      </nav>
    </>
  );
}
