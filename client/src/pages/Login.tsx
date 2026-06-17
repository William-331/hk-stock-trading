import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api';

interface Props { onLogin: (user: any) => void; }

export default function Login({ onLogin }: Props) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(username, password);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      onLogin(res.data.user);
      navigate(res.data.user.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 text-center relative">
        <span className="absolute -top-7 -left-2 text-sm text-blue-600 font-bold whitespace-nowrap">天成控股02110.HK</span>
        <div className="text-5xl mb-3">📈</div>
        <h1 className="text-xl font-bold text-gray-800">内盘交易系统</h1>
      </div>

      {/* 登录卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 w-full max-w-sm">
        <h2 className="text-base font-semibold text-gray-700 mb-5">登录账户</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">用户名</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
              placeholder="请输入用户名" required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">密码</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
              placeholder="请输入密码" required
            />
          </div>

          {error && (
            <p className="text-xs text-center py-1.5 rounded bg-red-50 text-red-500">{error}</p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#1a5ce0] text-white rounded-lg text-sm font-medium hover:bg-[#154ec5] disabled:opacity-50 transition mt-2"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
