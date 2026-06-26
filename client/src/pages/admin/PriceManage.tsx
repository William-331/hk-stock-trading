import { useEffect, useMemo, useState } from 'react';
import { getKline, setDailyPlan, getPricePlan, adjustPriceSmooth, dailySummary, getLatestPrice, getStockInfo, rebuildPriceRange } from '../../api';
import KlineChart from '../../components/KlineChart';

interface BatchDay {
  date: string;
  isWeekend: boolean;
  open: string;
  close: string;
  volUp: string;   // 波动上限，如 "1.0" = +1%
  volDown: string; // 波动下限，如 "2.0" = -2%
}

interface RebuildSummary {
  tradingDays: number;
  skippedDays: number;
  planSlotsRebuilt: number;
  stockSlotsRebuilt: number;
  latestTimeSlotAfterRebuild: string | null;
}

type RebuildPhase = 'confirm' | 'submitting' | 'success' | 'error';

export default function PriceManage() {
  const [kline, setKline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'daily' | 'batch'>('daily');
  const [msg, setMsg] = useState('');
  const [stockInfo, setStockInfo] = useState<any>({ code: '02110.HK', name: '天成控股' });
  const [latestPrice, setLatestPrice] = useState<any>(null);
  const [planFuture, setPlanFuture] = useState<any[]>([]); // 未来待执行计划点（图上预览）

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
  const [applyToStockPrices, setApplyToStockPrices] = useState(true);
  const [rebuildReason, setRebuildReason] = useState('');
  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  const [rebuildPhase, setRebuildPhase] = useState<RebuildPhase>('confirm');
  const [rebuildError, setRebuildError] = useState('');
  const [rebuildResult, setRebuildResult] = useState<RebuildSummary | null>(null);
  const [rebuildWarnings, setRebuildWarnings] = useState<string[]>([]);

  // ---- 二级波动编辑 ----
  const [editDay, setEditDay] = useState<string | null>(null);
  const [editDayPlans, setEditDayPlans] = useState<any[]>([]);
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const [editSlotPrice, setEditSlotPrice] = useState('');
  const [smoothWindow, setSmoothWindow] = useState(6); // 平滑带动单侧范围（点数）

  useEffect(() => { loadData(); }, []);

  // 当前时间格式化为 "YYYY-MM-DD HH:MM"（与 time_slot 一致），用于筛选未来计划点
  const nowSlot = () => {
    const n = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
  };

  // 拉取「未来待执行」计划点，作为控价图上的预览虚线
  const loadPlanFuture = () => {
    getPricePlan({ from: nowSlot(), status: 'pending' })
      .then(res => setPlanFuture(res.data || []))
      .catch(() => setPlanFuture([]));
  };

  const loadData = () => {
    Promise.all([getKline(2000), getLatestPrice(), getStockInfo()])
      .then(([kRes, pRes, sRes]) => {
        setKline(kRes.data || []);
        setLatestPrice(pRes.data);
        if (sRes.data) setStockInfo(sRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    loadPlanFuture();
  };

  const loadKline = () => {
    getKline(2000).then(res => setKline(res.data)).catch(console.error);
    getLatestPrice().then(res => setLatestPrice(res.data)).catch(() => {});
    loadPlanFuture();
  };

  const showMsg = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  const isWeekend = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
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
  const rebuildSummary = useMemo<RebuildSummary>(() => {
    const tradingDays = batchDays.filter(d => !d.isWeekend && d.open && d.close).length;
    return {
      tradingDays,
      skippedDays: batchDays.filter(d => d.isWeekend || !d.open || !d.close).length,
      planSlotsRebuilt: tradingDays * 68,
      stockSlotsRebuilt: applyToStockPrices ? tradingDays * 68 : 0,
      latestTimeSlotAfterRebuild: null,
    };
  }, [batchDays, applyToStockPrices]);

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

  const closeRebuildModal = () => {
    setConfirmingRebuild(false);
    setRebuildPhase('confirm');
    setRebuildError('');
    setRebuildResult(null);
    setRebuildWarnings([]);
  };

  const handleBatchSave = async () => {
    if (rebuildPhase === 'submitting') {
      showMsg('正在执行历史重建，请稍候');
      return;
    }

    if (!batchFrom || !batchTo || batchDays.length === 0) {
      showMsg('请先生成历史重建日期列表');
      return;
    }

    const invalidDay = batchDays.find(d => !d.isWeekend && (!d.open || !d.close));
    if (invalidDay) {
      showMsg(`${invalidDay.date} 的开盘价和收盘价未填写`);
      return;
    }

    if (rebuildSummary.tradingDays === 0) {
      showMsg('没有可重建的交易日');
      return;
    }

    setRebuildPhase('confirm');
    setRebuildError('');
    setRebuildResult(null);
    setRebuildWarnings([]);
    setConfirmingRebuild(true);
  };

  const handleConfirmRebuild = async () => {
    if (rebuildPhase === 'submitting') return;

    setRebuildPhase('submitting');
    setRebuildError('');
    try {
      await new Promise(resolve => setTimeout(resolve, 0));

      const normalizedDays = Array.from(
        new Map(
          batchDays.map(d => [d.date, {
            date: d.date,
            open: Number(d.open || 0),
            close: Number(d.close || 0),
            volUp: Number(d.volUp || 1),
            volDown: Number(d.volDown || 1),
            skip: d.isWeekend || !d.open || !d.close,
          }])
        ).values()
      );

      const payload = {
        from: batchFrom,
        to: batchTo,
        applyToStockPrices,
        reason: rebuildReason,
        days: normalizedDays,
      };
      const res = await rebuildPriceRange(payload);
      const summary = (res.data as any).summary as RebuildSummary | undefined;
      const warnings = Array.isArray((res.data as any).warnings) ? (res.data as any).warnings as string[] : [];
      setRebuildResult(summary || null);
      setRebuildWarnings(warnings);
      setRebuildPhase('success');
      showMsg(`已重建 ${(summary?.tradingDays ?? 0)} 个交易日，计划 ${(summary?.planSlotsRebuilt ?? 0)} 条${applyToStockPrices ? `，K线 ${(summary?.stockSlotsRebuilt ?? 0)} 条` : ''}`);
      if (warnings.length) {
        setTimeout(() => showMsg(warnings[0]), 800);
      }
      loadKline();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || '历史重建失败';
      setRebuildError(errMsg);
      setRebuildPhase('error');
    }
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
      if (!Number.isFinite(newClose) || newClose <= 0) { showMsg('请输入有效价格'); return; }
      await adjustPriceSmooth({ id: plan.id, close: newClose, window: smoothWindow });
      setEditSlotId(null);
      const res = await getPricePlan({ date: editDay! });
      setEditDayPlans(res.data);
      loadKline();
      showMsg(`已调整 ${plan.time_slot.slice(11)}，前后 ${smoothWindow} 点平滑过渡`);
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
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
          <span className="shrink-0">改价时平滑带动前后</span>
          <select value={smoothWindow} onChange={e => setSmoothWindow(Number(e.target.value))}
            className="px-2 py-1 border border-blue-200 rounded text-xs bg-white">
            <option value={0}>仅当前点</option>
            <option value={3}>3 点（±15分钟）</option>
            <option value={6}>6 点（±30分钟）</option>
            <option value={12}>12 点（±1小时）</option>
            <option value={24}>24 点（±2小时）</option>
          </select>
          <span className="shrink-0 text-blue-400">个点，自动顺势过渡</span>
        </div>
        {editDayPlans.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">该日期暂无价格计划，请先在每日设定或历史重建中生成</div>
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
                    <button onClick={() => handleSlotEdit(p)} className="text-xs text-blue-500 shrink-0">改</button>
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

      {/* ---- 走势图（整宽）---- */}
      <div className="mb-4">
        <KlineChart data={kline} planData={planFuture} />
      </div>

      {/* Tab */}
      <div className="flex border-b mb-4">
        {[
          { k: 'daily' as const, label: '每日设定' },
          { k: 'batch' as const, label: '历史重建' },
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
          <button onClick={() => openDayEdit(dailyDate)} className="w-full py-2 bg-white border border-blue-300 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50">
            编辑该日分时走势（逐点改价）
          </button>
        </div>
      )}

      {/* ==================== Tab 2: 历史重建 ==================== */}
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

          <textarea
            value={rebuildReason}
            onChange={e => setRebuildReason(e.target.value)}
            placeholder="填写本次历史重建原因（建议记录用途/日期段）"
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <label className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <input
              type="checkbox"
              checked={applyToStockPrices}
              onChange={e => setApplyToStockPrices(e.target.checked)}
            />
            <span>同步覆盖真实K线（危险操作）</span>
          </label>

          <button onClick={handleGenerateList} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            生成日期列表
          </button>

          {batchDays.length > 0 && (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                将按区间重建历史价格计划{applyToStockPrices ? '并同步覆盖真实K线' : ''}。周末自动跳过，保存前可继续进入“当日波动”做细调。
              </div>
              <div className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
                <span>预计重建 {rebuildSummary.tradingDays} 个交易日 / {rebuildSummary.planSlotsRebuilt} 个计划点</span>
                <span>{applyToStockPrices ? `同步覆盖 ${rebuildSummary.stockSlotsRebuilt} 个K线点` : '仅重建计划层'}</span>
              </div>
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
                准备重建
              </button>
            </>
          )}
        </div>
      )}

      {confirmingRebuild && (
        <div className="fixed inset-0 z-50 bg-black/40 px-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3">
            <h3 className="text-base font-bold text-gray-800">
              {rebuildPhase === 'success' ? '历史重建完成' : rebuildPhase === 'error' ? '历史重建失败' : '确认历史重建'}
            </h3>

            {(rebuildPhase === 'confirm' || rebuildPhase === 'submitting') && (
              <>
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  该操作将覆盖 {batchFrom} 至 {batchTo} 区间内的历史价格计划{applyToStockPrices ? '与真实K线' : ''}，无法自动撤销。
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>交易日：{rebuildSummary.tradingDays} 天</div>
                  <div>计划点：{rebuildSummary.planSlotsRebuilt} 条</div>
                  <div>K线点：{applyToStockPrices ? `${rebuildSummary.stockSlotsRebuilt} 条` : '本次不覆盖真实K线'}</div>
                  <div>备注：{rebuildReason.trim() || '未填写'}</div>
                </div>
              </>
            )}

            {rebuildPhase === 'submitting' && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-3 text-sm text-blue-700">
                <div className="font-medium">历史重建执行中...</div>
                <div className="mt-1 text-xs text-blue-600">正在提交区间计划并刷新最新行情，请勿关闭当前弹窗。</div>
              </div>
            )}

            {rebuildPhase === 'error' && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700 space-y-1">
                <div className="font-medium">本次历史重建未完成</div>
                <div className="text-xs break-all">{rebuildError || '历史重建失败，请稍后重试'}</div>
              </div>
            )}

            {rebuildPhase === 'success' && rebuildResult && (
              <div className="space-y-3">
                <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-3 text-sm text-green-700 space-y-1">
                  <div className="font-medium">历史重建已完成并刷新图表数据</div>
                  <div>交易日：{rebuildResult.tradingDays} 天</div>
                  <div>计划点：{rebuildResult.planSlotsRebuilt} 条</div>
                  <div>K线点：{applyToStockPrices ? `${rebuildResult.stockSlotsRebuilt} 条` : '本次未覆盖真实K线'}</div>
                  <div>跳过日期：{rebuildResult.skippedDays} 天</div>
                </div>
                {rebuildWarnings.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
                    {rebuildWarnings.map((warning, idx) => (
                      <div key={`${warning}-${idx}`}>{warning}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rebuildPhase === 'confirm' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmRebuild}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600"
                >
                  确认执行
                </button>
                <button
                  type="button"
                  onClick={closeRebuildModal}
                  className="px-4 py-2 bg-gray-200 rounded-lg text-sm"
                >
                  取消
                </button>
              </div>
            )}

            {rebuildPhase === 'submitting' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled
                  className="flex-1 py-2 bg-red-400 text-white rounded-lg text-sm font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  重建中...
                </button>
                <button
                  type="button"
                  disabled
                  className="px-4 py-2 bg-gray-200 rounded-lg text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  请稍候
                </button>
              </div>
            )}

            {rebuildPhase === 'error' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmRebuild}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600"
                >
                  重新尝试
                </button>
                <button
                  type="button"
                  onClick={closeRebuildModal}
                  className="px-4 py-2 bg-gray-200 rounded-lg text-sm"
                >
                  关闭
                </button>
              </div>
            )}

            {rebuildPhase === 'success' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeRebuildModal}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  完成
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
