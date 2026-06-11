import { useEffect, useState } from 'react';
import {
  getTradeRecords, exportTrades, exportTradesWord, exportAudit, exportAuditWord,
  backupTrades, getBackupList, downloadBackup, getSettings, updateSettings, getStockInfo,
} from '../../api';

export default function TradeRecords() {
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [backups, setBackups] = useState<any[]>([]);
  const [showBackups, setShowBackups] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState('');

  // 设置
  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [backupTime, setBackupTime] = useState('');

  useEffect(() => { loadRecords(); }, [page]);

  const loadRecords = () => {
    setLoading(true);
    getTradeRecords({ page, username: username || undefined })
      .then(res => { setRecords(res.data.list); setTotal(res.data.total); })
      .catch(console.error).finally(() => setLoading(false));
  };

  const doExport = (fn: Function, label: string) => async () => {
    try {
      const res = await fn();
      const ext = label.includes('Word') ? '.docx' : '.xlsx';
      const blob = new Blob([res.data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${label}_${Date.now()}${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`${label} 已下载`);
    } catch { setMsg('导出失败'); }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleBackup = async () => {
    try {
      const res = await backupTrades();
      setMsg(`备份完成: ${res.data.files?.join(', ') || res.data.filename}`);
    } catch { setMsg('备份失败'); }
    setTimeout(() => setMsg(''), 2000);
  };

  const loadBackups = async () => {
    try { const res = await getBackupList(); setBackups(res.data); setShowBackups(true); }
    catch { /* ignore */ }
  };

  const loadSettings = async () => {
    try {
      const [sRes, infoRes] = await Promise.all([getSettings(), getStockInfo()]);
      const map: any = {};
      sRes.data.forEach((s: any) => { map[s.key] = s.value; });
      setStockCode(map.stock_code || '02110');
      setStockName(map.stock_name || '模拟标的');
      setBackupTime(map.backup_time || '23:00');
      setShowSettings(true);
    } catch { /* ignore */ }
  };

  const saveSettings = async () => {
    try {
      await updateSettings({ stock_code: stockCode, stock_name: stockName, backup_time: backupTime });
      setMsg('设置已保存，重新登录后生效');
      setShowSettings(false);
    } catch (err: any) { setMsg(err.response?.data?.error || '保存失败'); }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleDownload = async (id: number) => {
    try {
      const res = await downloadBackup(id);
      const blob = new Blob([res.data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup_${id}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { setMsg('下载失败'); }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">交易记录</h1>
        <div className="flex gap-1 flex-wrap justify-end">
          <button onClick={doExport(exportTrades, '交易记录Excel')} className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs font-medium">Excel</button>
          <button onClick={doExport(exportTradesWord, '交易记录Word')} className="px-2 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium">Word</button>
          <button onClick={handleBackup} className="px-2 py-1.5 bg-green-600 text-white rounded text-xs font-medium">备份</button>
          <button onClick={loadBackups} className="px-2 py-1.5 bg-gray-600 text-white rounded text-xs font-medium">历史</button>
          <button onClick={loadSettings} className="px-2 py-1.5 bg-orange-500 text-white rounded text-xs font-medium">设置</button>
        </div>
      </div>

      {msg && <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>}

      {/* 搜索 */}
      <div className="flex gap-2 mb-3">
        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="搜索用户名" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={loadRecords} className="px-4 py-2 bg-gray-200 rounded-lg text-sm">搜索</button>
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="mb-4 bg-white rounded-xl p-4 border shadow-lg space-y-3">
          <h3 className="font-bold text-sm">系统设置</h3>
          <div>
            <label className="text-xs text-gray-500">标的代码</label>
            <input type="text" value={stockCode} onChange={e => setStockCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">标的名称</label>
            <input type="text" value={stockName} onChange={e => setStockName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">每日自动备份时间</label>
            <input type="text" value={backupTime} onChange={e => setBackupTime(e.target.value)}
              placeholder="如 23:00" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveSettings} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm">保存设置</button>
            <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-sm">取消</button>
          </div>
        </div>
      )}

      {/* 备份记录弹窗 */}
      {showBackups && (
        <div className="mb-4 bg-white rounded-xl p-4 border shadow-lg max-h-64 overflow-y-auto">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-sm">备份记录</h3>
            <button onClick={() => setShowBackups(false)} className="text-gray-400 text-sm">关闭</button>
          </div>
          {backups.map(b => (
            <div key={b.id} className="flex justify-between items-center py-1 text-sm border-b last:border-0">
              <div>
                <span className="text-gray-600 text-xs">{b.filename}</span>
                <span className={`ml-2 text-xs px-1 py-0.5 rounded ${b.type.includes('auto') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {b.type.includes('auto') ? '自动' : '手动'}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-gray-400">{b.record_count}条</span>
                <button onClick={() => handleDownload(b.id)} className="text-blue-600 text-xs">下载</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <p className="text-gray-500 text-center py-8">加载中...</p>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-2">📝</p><p>暂无交易记录</p></div>
      ) : (
        <div>
          <div className="space-y-2">
            {records.map(r => (
              <div key={r.id} className="bg-white rounded-lg p-3 shadow-sm border text-sm">
                <div className="flex justify-between">
                  <span className={`font-bold ${r.type === 'buy' ? 'text-red-600' : 'text-green-600'}`}>
                    {r.type === 'buy' ? '买入' : '卖出'}
                  </span>
                  <span className="text-xs text-gray-400">{r.created_at}</span>
                </div>
                <div className="flex justify-between mt-1 text-gray-600">
                  <span><span className="text-blue-600">{r.username}</span> · {r.quantity}股 @ ¥{r.price?.toFixed(2)}</span>
                  <span className="font-bold">¥{r.amount?.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
          {total > 50 && (
            <div className="flex justify-center gap-2 pt-3">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 text-sm">上一页</button>
              <span className="px-3 py-1 text-sm text-gray-500">{page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 text-sm">下一页</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
