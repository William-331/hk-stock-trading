import { useEffect, useState } from 'react';
import { getUsers, updateUser, addUser, deleteUser, batchGenerateUsers } from '../../api';

export default function UserManage() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPwd, setShowPwd] = useState(true);

  // 编辑弹窗
  const [editUser, setEditUser] = useState<any>(null);
  const [editPwd, setEditPwd] = useState('');

  // 新增弹窗
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPwd, setAddPwd] = useState('123456');

  // 批量生成弹窗
  const [showBatch, setShowBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(10);
  const [batchBalance, setBatchBalance] = useState(1000000);
  const [batchPrefix, setBatchPrefix] = useState('user');
  const [batchResult, setBatchResult] = useState<{ username: string; password: string }[] | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  useEffect(() => { loadUsers(); }, [search]);

  const loadUsers = () => {
    setLoading(true);
    getUsers({ search, pageSize: 1000 })
      .then(res => {
        const data = res.data;
        if (Array.isArray(data)) setUsers(data);
        else setUsers(data.list || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const showMsg = (text: string) => { setMsg(text); setTimeout(() => setMsg(''), 2000); };

  const handleEdit = (user: any) => { setEditUser(user); setEditPwd(''); };

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

  const handleBatchGenerate = async () => {
    if (batchCount < 1) { showMsg('数量至少 1'); return; }
    setBatchLoading(true);
    try {
      const res = await batchGenerateUsers({ count: batchCount, balance: batchBalance, prefix: batchPrefix });
      setBatchResult(res.data.users || []);
      loadUsers();
    } catch (err: any) { showMsg(err.response?.data?.error || '生成失败'); }
    finally { setBatchLoading(false); }
  };

  const closeBatch = () => { setShowBatch(false); setBatchResult(null); };

  const copyBatchResult = () => {
    if (!batchResult) return;
    const text = batchResult.map(u => `${u.username}\t${u.password}`).join('\n');
    navigator.clipboard.writeText(text).then(() => showMsg('已复制到剪贴板'));
  };

  // 顶部统计
  const stats = {
    total: users.length,
    admins: users.filter(u => u.role === 'admin').length,
    frozen: users.filter(u => u.status !== 'active').length,
    funds: users.reduce((s, u) => s + (u.balance || 0), 0),
  };
  const fmtMoney = (n: number) =>
    n >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : n.toLocaleString();

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 pb-24">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">用户管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">查看与管理所有账户的密码、资金和持仓</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBatch(true)}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium shadow-sm transition-colors">
            ⚡ 批量生成
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors">
            ＋ 新增用户
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
          <div className="text-[11px] text-gray-400">用户总数</div>
          <div className="text-lg font-bold text-gray-800">{stats.total}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
          <div className="text-[11px] text-gray-400">管理员</div>
          <div className="text-lg font-bold text-rose-500">{stats.admins}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
          <div className="text-[11px] text-gray-400">冻结</div>
          <div className="text-lg font-bold text-amber-500">{stats.frozen}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
          <div className="text-[11px] text-gray-400">资金总额</div>
          <div className="text-lg font-bold text-emerald-600">¥{fmtMoney(stats.funds)}</div>
        </div>
      </div>

      {msg && <div className="mb-3 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm border border-blue-100">{msg}</div>}

      {/* 工具栏 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索用户名 / 姓名..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap select-none">
          <input type="checkbox" checked={showPwd} onChange={e => setShowPwd(e.target.checked)} className="accent-blue-600" />
          显示密码
        </label>
      </div>
      {/* 用户列表 */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">加载中...</div>
      ) : users.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">暂无用户</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* 表头 */}
          <div className="hidden sm:grid grid-cols-[1.6fr_1.4fr_1.3fr_0.8fr_1.1fr] gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-medium text-gray-400 uppercase tracking-wide">
            <span>用户</span>
            <span>密码</span>
            <span>资金</span>
            <span>持仓</span>
            <span className="text-right">操作</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-[58vh] overflow-y-auto">
            {users.map(u => (
              <div key={u.id}
                className={`grid grid-cols-[1.6fr_1.4fr_1.3fr_0.8fr_1.1fr] gap-2 items-center px-4 py-3 text-sm transition-colors hover:bg-gray-50/70 ${u.status !== 'active' ? 'bg-amber-50/40' : ''}`}>
                {/* 用户 */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${u.role === 'admin' ? 'bg-rose-400' : 'bg-blue-400'}`}>
                    {(u.username || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-700 truncate flex items-center gap-1">
                      {u.username}
                      {u.status !== 'active' && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600">冻结</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {u.real_name || '—'} · {u.role === 'admin' ? '管理员' : '用户'}
                    </div>
                  </div>
                </div>
                {/* 密码 */}
                <div className="font-mono text-xs text-gray-600 truncate">
                  {showPwd ? (u.password_plain || '—') : '••••••'}
                </div>
                {/* 资金 */}
                <div className="text-gray-700 font-medium">¥{(u.balance || 0).toLocaleString()}</div>
                {/* 持仓 */}
                <div className="text-gray-500 text-xs">{u.position_qty || 0}股</div>
                {/* 操作 */}
                <div className="flex items-center justify-end gap-3">
                  <button onClick={() => handleEdit(u)} className="text-xs text-blue-500 hover:text-blue-700">编辑</button>
                  <button onClick={() => handleDelete(u)} className="text-xs text-rose-400 hover:text-rose-600">删除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-2xl p-5 mx-4 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">编辑用户</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">用户名</label>
                <input type="text" value={editUser.username} disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500">新密码（留空不修改）</label>
                <input type="text" value={editPwd} onChange={e => setEditPwd(e.target.value)}
                  placeholder={editUser.password_plain ? `当前: ${editUser.password_plain}` : '输入新密码'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">余额</label>
                  <input type="number" value={editUser.balance} onChange={e => setEditUser({ ...editUser, balance: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">角色</label>
                  <select value={editUser.role} onChange={e => setEditUser({ ...editUser, role: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                    <option value="user">用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">状态</label>
                <select value={editUser.status} onChange={e => setEditUser({ ...editUser, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                  <option value="active">正常</option>
                  <option value="frozen">冻结</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditUser(null)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">取消</button>
                <button onClick={handleSaveEdit} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新增弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-5 mx-4 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">新增用户</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">用户名</label>
                <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                  placeholder="如 user501" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div>
                <label className="text-xs text-gray-500">密码</label>
                <input type="text" value={addPwd} onChange={e => setAddPwd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">取消</button>
                <button onClick={handleAdd} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">创建</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量生成弹窗 */}
      {showBatch && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={closeBatch}>
          <div className="bg-white rounded-2xl p-5 mx-4 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            {batchResult ? (
              <>
                <h2 className="text-lg font-bold mb-1">✅ 生成成功</h2>
                <p className="text-xs text-gray-500 mb-3">共 {batchResult.length} 个，密码仅此处完整展示，请及时保存</p>
                <div className="max-h-[45vh] overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50 text-sm">
                  {batchResult.map(u => (
                    <div key={u.username} className="flex items-center justify-between px-3 py-1.5">
                      <span className="font-medium text-gray-700">{u.username}</span>
                      <span className="font-mono text-gray-600">{u.password}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-3">
                  <button onClick={copyBatchResult} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">复制全部</button>
                  <button onClick={closeBatch} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">完成</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold mb-4">批量生成用户</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500">用户名前缀</label>
                    <input type="text" value={batchPrefix} onChange={e => setBatchPrefix(e.target.value)}
                      placeholder="user" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    <p className="text-[10px] text-gray-400 mt-0.5">会自动接续现有编号，如已有 user500 则从 user501 开始</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">生成数量（1-500）</label>
                      <input type="number" value={batchCount} onChange={e => setBatchCount(Number(e.target.value))}
                        min={1} max={500} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">初始资金</label>
                      <input type="number" value={batchBalance} onChange={e => setBatchBalance(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={closeBatch} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">取消</button>
                    <button onClick={handleBatchGenerate} disabled={batchLoading}
                      className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-50">
                      {batchLoading ? '生成中...' : '开始生成'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
