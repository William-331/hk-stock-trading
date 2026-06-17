import { useEffect, useState } from 'react';
import { getKline, setDailyPlan, getPricePlan, updatePricePlan, dailySummary, getLatestPrice, getStockInfo } from '../../api';
import KlineChart from '../../components/KlineChart';
import OrderBook from '../../components/OrderBook';

interface BatchDay {
  date: string;
  isWeekend: boolean;
  open: string;
  close: string;
  volUp: string;   // 波动上限，如 "1.0" = +1%
  volDown: string; // 波动下限，如 "2.0" = -2%
}

export default function PriceManage() {
  const [kline, setKline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'daily' | 'batch'>('daily');
  const [msg, setMsg] = useState('');
  const [stockInfo, setStockInfo] = useState<any>({ code: '02110.HK', name: '天成控股' });
  const [latestPrice, setLatestPrice] = useState<any>(null);

  // ---- 每日设定 ----
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10));
  const [dailyOpen, setDailyOpen] = useState('');
  const [dailyClose, setDailyClose] = useState('');
  const [dailyVolUp, setDailyVolUp] = useState('1.0');
  const [dailyVolDown, setDailyVolDown] = useState('1.0');

  // ---- 批量设定 ----
  const [batchFrom, setBatchFrom] = useState('');
  const [batchTo, setBatchTo] = useState('');
  const [batchDays, setBatchDays] = useState<BatchDay[]>([]);

  // ---- 二级波动编辑 ----
  const [editDay, setEditDay] = useState<string | null>(null);
  const [editDayPlans, setEditDayPlans] = useState<any[]>([]);
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const [editSlotPrice, setEditSlotPrice] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = () => {
    Promise.all([getKline(), getLatestPrice(), getStockInfo()])
      .then(([kRes, pRes, sRes]) => {
        setKline(kRes.data || []);
        setLatestPrice(pRes.data);
        if (sRes.data) setStockInfo(sRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const loadKline = () => {
    getKline().then(res => setKline(res.data)).catch(console.error);
    getLatestPrice().then(res => setLatestPrice(res.data)).catch(() => {});
  };

  const showMsg = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  const isWeekend = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0 || d.getDay() === 6;
  };

  // 实时交易状态
  const getTradingStatus = () => {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return { label: '周末休市', color: 'bg-gray-100 text-gray-500' };
    const h = now.getHours();
    const m = now.getMinutes();
    const t = h * 60 + m;
    if (t < 9 * 60) return { label: '盘前', color: 'bg-gray-100 text-gray-500' };
    if (t < 9 * 60 + 30) return { label: '集合竞价', color: 'bg-yellow-100 text-yellow-700' };
    if (t < 12 * 60) return { label: '交易中', color: 'bg-red-50 text-[#e15241]' };
    if (t < 13 * 60) return { label: '午间休市', color: 'bg-gray-100 text-gray-500' };
    if (t < 16 * 60) return { label: '交易中', color: 'bg-red-50 text-[#e15241]' };
    if (t < 16 * 60 + 10) return { label: '收盘定价', color: 'bg-yellow-100 text-yellow-700' };
    return { label: '已收盘', color: 'bg-gray-100 text-gray-500' };
  };
  const tradingStatus = getTradingStatus();

  // ========== 每日设定 ==========
  const handleDaily = async () => {
    if (!dailyDate || !dailyOpen || !dailyClose) { showMsg('请填写完整信息'); return; }
    try {
      const res = await setDailyPlan({
        date: dailyDate, open: Number(dailyOpen), close: Number(dailyClose),
        volUp: Number(dailyVolUp), volDown: Number(dailyVolDown),
      });
      showMsg((res.data as any).message);
      loadKline();
    } catch (err: any) { showMsg(err.response?.data?.error || '设定失败'); }
  };

  // ========== 批量设定 ==========
  const handleGenerateList = () => {
    if (!batchFrom || !batchTo) { showMsg('请选择日期范围'); return; }
    const start = new Date(batchFrom + 'T00:00:00');
    const end = new Date(batchTo + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) { showMsg('日期范围无效'); return; }
    const days: BatchDay[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = cur.toISOString().slice(0, 10);
      const wk = isWeekend(ds);
      days.push({ date: ds, isWeekend: wk, open: '', close: '', volUp: '1.0', volDown: '1.0' });
      cur.setDate(cur.getDate() + 1);
    }
    setBatchDays(days);
    showMsg(`已生成 ${days.length} 天，其中 ${days.filter(d => d.isWeekend).length} 天周末`);
  };

  const handleBatchSave = async () => {
    let saved = 0;
    for (const d of batchDays) {
      if (d.isWeekend || !d.open || !d.close) continue;
      try {
        await setDailyPlan({
          date: d.date, open: Number(d.open), close: Number(d.close),
          volUp: Number(d.volUp), volDown: Number(d.volDown),
        });
        saved++;
      } catch {}
    }
    showMsg(`已保存 ${saved} 个交易日`);
    loadKline();
  };

  // ========== 每日汇总 ==========
  const handleDailySummary = async () => {
    try {
      const res = await dailySummary();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily_summary_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      showMsg('每日汇总已下载');
    } catch (err: any) { showMsg('下载失败'); }
  };

  // ========== 二级波动编辑 ==========
  const openDayEdit = async (date: string) => {
    setEditDay(date);
    try {
      const res = await getPricePlan({ date });
      setEditDayPlans(res.data);
    } catch { setEditDayPlans([]); }
  };

  const closeDayEdit = () => {
    setEditDay(null);
    setEditDayPlans([]);
    setEditSlotId(null);
  };

  const handleSlotEdit = (plan: any) => {
    setEditSlotId(plan.id);
    setEditSlotPrice(plan.close);
  };

  const handleSlotSave = async (plan: any) => {
    try {
      const newClose = Number(editSlotPrice);
      const diff = newClose - plan.close;
      await updatePricePlan(plan.id, {
        open: Math.round((plan.open + diff) * 100) / 100,
        high: Math.round((plan.high + diff) * 100) / 100,
        low: Math.round((plan.low + diff) * 100) / 100,
        close: newClose,
      });
      setEditSlotId(null);
      const res = await getPricePlan({ date: editDay! });
      setEditDayPlans(res.data);
      loadKline();
    } catch (err: any) { showMsg(err.response?.data?.error || '更新失败'); }
  };

  // ====== 二级编辑视图 ======
  if (editDay) {
    return (
      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={closeDayEdit} className="text-gray-400 hover:text-gray-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <h2 className="text-lg font-bold">{editDay} 分时波动</h2>
        </div>
        {msg && <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>}
        {editDayPlans.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">该日期暂无价格计划，请先在每日设定或批量设定中生成</div>
        ) : (
          <div className="space-y-1 max-h-[70vh] overflow-y-auto">
            {editDayPlans.map(p => (
              <div key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${p.status === 'executed' ? 'bg-green-50' : p.status === 'skipped' ? 'bg-gray-50' : 'bg-white border border-gray-200'}`}>
                <span className="w-16 text-xs text-gray-500">{p.time_slot.slice(11)}</span>
                {editSlotId === p.id ? (
                  <>
                    <input type="number" step="0.01" value={editSlotPrice}
                      onChange={e => setEditSlotPrice(e.target.value)}
                      className="w-20 px-2 py-1 border border-blue-300 rounded text-sm text-center" autoFocus />
                    <button onClick={() => handleSlotSave(p)} className="text-xs text-blue-600 shrink-0">保存</button>
                    <button onClick={() => setEditSlotId(null)} className="text-xs text-gray-400 shrink-0">取消</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-right font-medium tabular-nums">{p.close.toFixed(2)}</span>
                    <span className={`text-[10px] shrink-0 ${p.status === 'executed' ? 'text-green-500' : p.status === 'skipped' ? 'text-gray-400' : 'text-blue-500'}`}>
                      {p.status === 'executed' ? '已执行' : p.status === 'skipped' ? '已跳过' : '待执行'}
                    </span>
                    {p.status === 'pending' && (
                      <button onClick={() => handleSlotEdit(p)} className="text-xs text-blue-500 shrink-0">改</button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ====== 主视图 ======
  const isUp = (latestPrice?.changePct || 0) >= 0;
  const priceCls = isUp ? 'text-[#e15241]' : 'text-[#47b262]';

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      {/* ---- 股票信息头 ---- */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-base font-bold text-gray-800">{stockInfo.name}</h1>
            <span className="text-[10px] text-gray-400">{stockInfo.code}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${tradingStatus.color}`}>
              {tradingStatus.label}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-2xl font-bold tabular-nums ${priceCls}`}>
              {latestPrice?.close?.toFixed(2) || '-'}
            </span>
            {latestPrice && (
              <span className={`text-xs font-medium ${priceCls}`}>
                {isUp ? '+' : ''}{latestPrice.change?.toFixed(2)} ({isUp ? '+' : ''}{latestPrice.changePct?.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>
        <button onClick={handleDailySummary} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600">
          每日汇总
        </button>
      </div>

      {msg && <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>}

      {/* ---- 左右双栏：走势图 + 五档盘口 ---- */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <KlineChart data={kline} />
        </div>
        <div className="w-44 shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="text-[10px] text-gray-400 px-2 py-1.5 bg-gray-50 border-b border-gray-100">五档盘口</div>
          <OrderBook
            buyLevels={latestPrice?.buyLevels || []}
            sellLevels={latestPrice?.sellLevels || []}
            prevClose={latestPrice?.prevClose || 0}
          />
        </div>
      </div>

      {/* Tab */}
      <div className="flex border-b mb-4">
        {[
          { k: 'daily' as const, label: '每日设定' },
          { k: 'batch' as const, label: '批量设定' },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex-1 py-2 text-center text-sm font-medium ${tab === t.k ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ==================== Tab 1: 每日设定 ==================== */}
      {tab === 'daily' && (
        <div className="space-y-3">
          <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">开盘价</label>
              <input type="number" step="0.01" value={dailyOpen} onChange={e => setDailyOpen(e.target.value)}
                placeholder="如 12.50" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500">收盘价</label>
              <input type="number" step="0.01" value={dailyClose} onChange={e => setDailyClose(e.target.value)}
                placeholder="如 13.00" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">波动上限 %</label>
              <input type="number" step="0.1" value={dailyVolUp} onChange={e => setDailyVolUp(e.target.value)}
                placeholder="1.0" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500">波动下限 %</label>
              <input type="number" step="0.1" value={dailyVolDown} onChange={e => setDailyVolDown(e.target.value)}
                placeholder="1.0" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <button onClick={handleDaily} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            生成当日价格计划
          </button>
        </div>
      )}

      {/* ==================== Tab 2: 批量设定 ==================== */}
      {tab === 'batch' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">起始日期</label>
              <input type="date" value={batchFrom} onChange={e => setBatchFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500">结束日期</label>
              <input type="date" value={batchTo} onChange={e => setBatchTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <button onClick={handleGenerateList} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            生成日期列表
          </button>

          {batchDays.length > 0 && (
            <>
              <div className="text-xs text-gray-400">填写每日开盘价、收盘价，然后保存。周末自动跳过。</div>
              <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-100 rounded text-xs font-medium text-gray-500">
                <span className="w-24">日期</span>
                <span className="flex-1">开盘价</span>
                <span className="flex-1">收盘价</span>
                <span className="w-12">上限%</span>
                <span className="w-12">下限%</span>
                <span className="w-16"></span>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {batchDays.map((d, i) => (
                  <div key={d.date} className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm ${d.isWeekend ? 'bg-gray-100 opacity-50' : 'bg-white border border-gray-200'}`}>
                    <span className={`w-24 text-xs ${d.isWeekend ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      {d.date.slice(5)}{d.isWeekend ? ' 休' : ''}
                    </span>
                    {d.isWeekend ? (
                      <>
                        <span className="flex-1 text-xs text-gray-300">-</span>
                        <span className="flex-1 text-xs text-gray-300">-</span>
                        <span className="w-12 text-xs text-gray-300">-</span>
                        <span className="w-12 text-xs text-gray-300">-</span>
                      </>
                    ) : (
                      <>
                        <input type="number" step="0.01" value={d.open}
                          onChange={e => { const cp = [...batchDays]; cp[i].open = e.target.value; setBatchDays(cp); }}
                          placeholder="开" className="flex-1 w-0 px-2 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <input type="number" step="0.01" value={d.close}
                          onChange={e => { const cp = [...batchDays]; cp[i].close = e.target.value; setBatchDays(cp); }}
                          placeholder="收" className="flex-1 w-0 px-2 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <input type="number" step="0.1" value={d.volUp}
                          onChange={e => { const cp = [...batchDays]; cp[i].volUp = e.target.value; setBatchDays(cp); }}
                          className="w-12 px-1 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <input type="number" step="0.1" value={d.volDown}
                          onChange={e => { const cp = [...batchDays]; cp[i].volDown = e.target.value; setBatchDays(cp); }}
                          className="w-12 px-1 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </>
                    )}
                    <button onClick={() => openDayEdit(d.date)}
                      className="w-16 py-1.5 text-[10px] text-blue-500 border border-blue-200 rounded hover:bg-blue-50 shrink-0">
                      当日波动
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={handleBatchSave} className="w-full py-3 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                全部保存
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
