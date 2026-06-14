import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHKList } from '../api';

interface StockItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  chgSpeed: number;
  turnover: number;
  volRatio: number;
  amplitude: number;
  volume: number;
  amount: number;
  floatShares: number;
  floatCap: number;
  pe: number;
}

const CATEGORIES = [
  { key: 'all', label: '全部', codes: [] as string[] },
  { key: 'tech', label: '科技', codes: ['00700', '09988', '01810', '03690', '01024', '00981', '01347', '09618'] },
  { key: 'finance', label: '金融', codes: ['00388', '00005', '02318', '01299'] },
  { key: 'consume', label: '消费', codes: ['02015', '02269'] },
  { key: 'comm', label: '通信', codes: ['00941'] },
];

// ---------- helpers ----------
function fmtPrice(v: number): string {
  if (!v || v <= 0) return '-';
  return v.toFixed(2);
}
function fmtPct(v: number): { text: string; color: string } {
  if (v === 0) return { text: '0.00%', color: 'text-gray-500' };
  const up = v > 0;
  return { text: `${up ? '+' : ''}${v.toFixed(2)}%`, color: up ? 'text-[#e15241]' : 'text-[#47b262]' };
}
function fmtNum(v: number): string {
  if (!v || v <= 0) return '-';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return v.toFixed(0);
}
function fmtPE(v: number): string {
  if (!v || v <= 0) return '-';
  return v.toFixed(2);
}

export default function HKMarket() {
  const navigate = useNavigate();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await getHKList();
        if (!cancelled) {
          setStocks(res.data);
          setError(false);
          setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const filtered =
    category === 'all'
      ? stocks
      : stocks.filter((s) => {
          const cat = CATEGORIES.find((c) => c.key === category);
          return cat?.codes.includes(s.code);
        });

  /* ---------- each row ---------- */
  const renderRow = (s: StockItem) => {
    const chg = fmtPct(s.changePct);
    const spd = fmtPct(s.chgSpeed);
    const amp = fmtPct(s.amplitude);
    const tor = s.turnover > 0 ? s.turnover.toFixed(2) + '%' : '-';
    const volR = s.volRatio > 0 ? s.volRatio.toFixed(2) : '-';
    const rowBg = s.changePct >= 0 ? 'bg-red-50/30' : 'bg-green-50/30';

    return (
      <div key={s.code} onClick={() => navigate(`/hk/${s.code}`)} className={`flex items-center px-3 py-2.5 hover:bg-gray-50/60 transition border-b border-gray-50 cursor-pointer ${rowBg}`}>
        {/* 股票名 (sticky-ish via min-width) */}
        <div className="w-[110px] shrink-0">
          <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
          <p className="text-[10px] text-gray-400">{s.code}</p>
        </div>
        {/* 最新价 */}
        <div className="w-[70px] shrink-0 text-right">
          <p className={`text-sm font-semibold tabular-nums ${chg.color}`}>{fmtPrice(s.price)}</p>
        </div>
        {/* 涨跌幅 */}
        <div className="w-[72px] shrink-0 text-right">
          <span className={`inline-block px-1 py-0.5 rounded text-xs font-semibold tabular-nums ${
            s.changePct >= 0 ? 'text-[#e15241] bg-red-50' : 'text-[#47b262] bg-green-50'
          }`}>{chg.text}</span>
        </div>
        {/* 涨速 */}
        <div className="w-[58px] shrink-0 text-right">
          <p className={`text-xs tabular-nums ${spd.color}`}>{spd.text}</p>
        </div>
        {/* 换手 */}
        <div className="w-[58px] shrink-0 text-right">
          <p className="text-xs text-gray-600 tabular-nums">{tor}</p>
        </div>
        {/* 量比 */}
        <div className="w-[48px] shrink-0 text-right">
          <p className="text-xs text-gray-600 tabular-nums">{volR}</p>
        </div>
        {/* 振幅 */}
        <div className="w-[62px] shrink-0 text-right">
          <p className="text-xs text-gray-600 tabular-nums">{amp.text}</p>
        </div>
        {/* 成交额 */}
        <div className="w-[75px] shrink-0 text-right">
          <p className="text-xs text-gray-500 tabular-nums">{fmtNum(s.amount)}</p>
        </div>
        {/* 流通市值 */}
        <div className="w-[80px] shrink-0 text-right">
          <p className="text-xs text-gray-500 tabular-nums">{fmtNum(s.floatCap)}</p>
        </div>
        {/* 市盈率 */}
        <div className="w-[58px] shrink-0 text-right">
          <p className="text-xs text-gray-500 tabular-nums">{fmtPE(s.pe)}</p>
        </div>
      </div>
    );
  };

  /* ---------- main render ---------- */
  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">
      {/* 顶栏 */}
      <div className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <h1 className="text-base font-bold text-gray-800">港股行情</h1>
          <span className="text-[10px] text-gray-400">
            {lastUpdate ? `更新于 ${lastUpdate}` : '加载中...'}
          </span>
        </div>
      </div>

      {/* 分类标签 */}
      <div className="bg-white border-b border-gray-100 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 px-3 py-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition ${
                category === c.key
                  ? 'bg-[#1a5ce0] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 表格 */}
      <div className="mt-2 mx-2">
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {/* 表头 */}
          <div className="flex items-center px-3 py-2 bg-gray-50/70 text-[10px] font-medium text-gray-400 whitespace-nowrap">
            <span className="w-[110px] shrink-0">股票</span>
            <span className="w-[70px] shrink-0 text-right">最新价</span>
            <span className="w-[72px] shrink-0 text-right">涨跌幅</span>
            <span className="w-[58px] shrink-0 text-right">涨速</span>
            <span className="w-[58px] shrink-0 text-right">换手</span>
            <span className="w-[48px] shrink-0 text-right">量比</span>
            <span className="w-[62px] shrink-0 text-right">振幅</span>
            <span className="w-[75px] shrink-0 text-right">成交额</span>
            <span className="w-[80px] shrink-0 text-right">流通市值</span>
            <span className="w-[58px] shrink-0 text-right">市盈率</span>
          </div>

          {/* 内容 */}
          <div className="overflow-x-auto scrollbar-hide">
            <div style={{ minWidth: 720 }}>
              {loading ? (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center px-3 py-3 animate-pulse gap-2">
                      <div className="w-[110px] shrink-0 space-y-1.5">
                        <div className="h-3.5 bg-gray-100 rounded w-14" />
                        <div className="h-2.5 bg-gray-50 rounded w-8" />
                      </div>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <div key={j} className="h-3 bg-gray-100 rounded shrink-0" style={{ width: `${50 + j * 5}px` }} />
                      ))}
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex flex-col items-center py-12 text-gray-400">
                  <span className="text-3xl mb-2">📡</span>
                  <p className="text-sm">数据加载失败</p>
                  <p className="text-xs text-gray-300 mt-1">请检查网络后刷新重试</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-gray-400">
                  <span className="text-3xl mb-2">📭</span>
                  <p className="text-sm">暂无数据</p>
                </div>
              ) : (
                filtered.map(renderRow)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部 */}
      <div className="mx-2 mt-3 pb-4">
        <p className="text-center text-[10px] text-gray-300">
          数据来源: 东方财富 · 每 5 秒刷新 · 左右滑动查看更多列
        </p>
      </div>
    </div>
  );
}
