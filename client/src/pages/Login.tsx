import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../api';

interface Props { onLogin: (user: any) => void; }

export default function Login({ onLogin }: Props) {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('user1');
  const [password, setPassword] = useState('123456');
  const [realName, setRealName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, password, realName || username);
        setIsRegister(false);
        setError('注册成功，请登录');
      } else {
        const res = await login(username, password);
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onLogin(res.data.user);
        navigate(res.data.user.role === 'admin' ? '/admin' : '/', { replace: true });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center px-4">
      {/* Logo 区 */}
      <div className="mb-8 text-center relative">
        <span className="absolute -top-7 -left-2 text-sm text-blue-600 font-bold whitespace-nowrap">天诚控股02110.HK</span>
        <div className="text-5xl mb-3">📈</div>
        <h1 className="text-xl font-bold text-gray-800">内盘交易系统</h1>
      </div>

      {/* 卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 w-full max-w-sm">
        <h2 className="text-base font-semibold text-gray-700 mb-5">
          {isRegister ? '创建账户' : '登录账户'}
        </h2>

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
          {isRegister && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">姓名（选填）</label>
              <input
                type="text" value={realName} onChange={e => setRealName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
                placeholder="请输入姓名"
              />
            </div>
          )}

          {error && (
            <p className={`text-xs text-center py-1.5 rounded ${error.includes('成功') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
              {error}
            </p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#1a5ce0] text-white rounded-lg text-sm font-medium hover:bg-[#154ec5] disabled:opacity-50 transition mt-2"
          >
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <p className="text-center mt-4">
          <button onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="text-xs text-[#1a5ce0] hover:underline">
            {isRegister ? '已有账户？去登录' : '没有账户？免费注册'}
          </button>
        </p>
      </div>

      <p className="mt-6 text-xs text-gray-300">测试账户: user1 / 123456 ｜ admin / 123456</p>
    </div>
  );
}
