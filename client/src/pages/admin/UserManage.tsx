import { useEffect, useState } from 'react';
import { getUsers, updateUser, addUser, deleteUser } from '../../api';

export default function UserManage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  // 编辑弹窗
  const [editUser, setEditUser] = useState<any>(null);
  const [editPwd, setEditPwd] = useState('');

  // 新增弹窗
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPwd, setAddPwd] = useState('123456');

  useEffect(() => { loadUsers(); }, [search]);

  const loadUsers = () => {
    setLoading(true);
    getUsers({ search, pageSize: 1000 })
      .then(res => {
        const data = res.data;
        if (Array.isArray(data)) { setUsers(data); setTotal(data.length); }
        else { setUsers(data.list || []); setTotal(data.total || 0); }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const showMsg = (text: string) => { setMsg(text); setTimeout(() => setMsg(''), 2000); };

  const handleEdit = (user: any) => {
    setEditUser(user);
    setEditPwd('');
  };

  const handleSaveEdit = async () => {
    try {
      await updateUser(editUser.id, {
        role: editUser.role,
        status: editUser.status,
        balance: editUser.balance,
        ...(editPwd ? { password: editPwd } : {}),
      });
      setEditUser(null);
      showMsg('已更新');
      loadUsers();
    } catch (err: any) { showMsg(err.response?.data?.error || '更新失败'); }
  };

  const handleDelete = async (user: any) => {
    if (!confirm(`确定删除用户 ${user.username}？`)) return;
    try {
      await deleteUser(user.id);
      showMsg('已删除');
      loadUsers();
    } catch (err: any) { showMsg(err.response?.data?.error || '删除失败'); }
  };

  const handleAdd = async () => {
    if (!addName) { showMsg('请输入用户名'); return; }
    try {
      await addUser({ username: addName, password: addPwd, balance: 1000000 });
      setShowAdd(false);
      setAddName(''); setAddPwd('123456');
      showMsg('用户已创建');
      loadUsers();
    } catch (err: any) { showMsg(err.response?.data?.error || '创建失败'); }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">用户管理</h1>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium">
          新增用户
        </button>
      </div>

      {msg && <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>}

      <input
        type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="搜索用户名..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="text-xs text-gray-400 mb-2">共 {total} 个用户</div>

      {loading ? (
        <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
      ) : (
        <div className="space-y-1 max-h-[65vh] overflow-y-auto">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
              <span className="flex-1 text-xs text-gray-700 truncate">{u.username}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                {u.role === 'admin' ? '管理' : '用户'}
              </span>
              <span className="w-16 text-right text-xs text-gray-500">¥{((u.balance || 0) / 10000).toFixed(0)}万</span>
              <button onClick={() => handleEdit(u)} className="text-xs text-blue-500 hover:text-blue-700 shrink-0">编辑</button>
              <button onClick={() => handleDelete(u)} className="text-xs text-red-400 hover:text-red-600 shrink-0">删除</button>
            </div>
          ))}
        </div>
      )}


      {/* 编辑弹窗 */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-xl p-5 mx-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">编辑用户</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">用户名</label>
                <input type="text" value={editUser.username} disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
              </div>
              <div>
                <label className="text-xs text-gray-500">新密码（留空不修改）</label>
                <input type="text" value={editPwd} onChange={e => setEditPwd(e.target.value)}
                  placeholder="输入新密码" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">余额</label>
                  <input type="number" value={editUser.balance} onChange={e => setEditUser({ ...editUser, balance: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">角色</label>
                  <select value={editUser.role} onChange={e => setEditUser({ ...editUser, role: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="user">用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditUser(null)} className="flex-1 py-2 border rounded-lg text-sm">取消</button>
                <button onClick={handleSaveEdit} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新增弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-5 mx-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">新增用户</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">用户名</label>
                <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                  placeholder="如 user501" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500">密码</label>
                <input type="text" value={addPwd} onChange={e => setAddPwd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border rounded-lg text-sm">取消</button>
                <button onClick={handleAdd} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm">创建</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
