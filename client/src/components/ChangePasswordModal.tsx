import { useState } from 'react';
import { changePassword } from '../api';

interface Props {
  onClose: () => void;
}

export default function ChangePasswordModal({ onClose }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('新密码至少6位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (oldPassword === newPassword) {
      setError('新密码不能与原密码相同');
      return;
    }

    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] px-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6">
        {success ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-base font-semibold text-gray-800 mb-2">密码修改成功</h2>
            <p className="text-xs text-gray-500 mb-5">请使用新密码重新登录</p>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-[#1a5ce0] text-white rounded-lg text-sm font-medium hover:bg-[#154ec5] transition"
            >
              确定
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-700">修改密码</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">原密码</label>
                <input
                  type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
                  placeholder="请输入原密码" required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">新密码</label>
                <input
                  type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
                  placeholder="至少6位" required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">确认新密码</label>
                <input
                  type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1a5ce0] focus:ring-1 focus:ring-[#1a5ce0] transition"
                  placeholder="再次输入新密码" required
                />
              </div>

              {error && (
                <p className="text-xs text-center py-1.5 rounded bg-red-50 text-red-500">{error}</p>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full py-2.5 bg-[#1a5ce0] text-white rounded-lg text-sm font-medium hover:bg-[#154ec5] disabled:opacity-50 transition mt-2"
              >
                {loading ? '提交中...' : '确认修改'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
