import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getKline, getLatestPrice, getStockInfo, getTrades } from '../api';
import KlineChart from '../components/KlineChart';
import OrderBook from '../components/OrderBook';

interface LevelData {
  price: number;
  volume: number;
}

interface PriceData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time_slot: string;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  prevClose: number;
  buyLevels: LevelData[];
  sellLevels: LevelData[];
}

interface StockInfo {
  code: string;
  name: string;
}

// ---------- helpers ----------
function fmt(v: number | undefined, decimals = 2): string {
  if (!v && v !== 0) return '-';
  return v.toFixed(decimals);
}

function fmtBigNum(v: number): string {
  if (!v || v <= 0) return '-';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return v.toFixed(0);
}

function chgCls(v: number) {
  if (v > 0) return 'text-[#e15241]';
  if (v < 0) return 'text-[#47b262]';
  return 'text-gray-500';
}

export default function Market() {
  const navigate = useNavigate();

  const [kline, setKline] = useState<any[]>([]);
  const [price, setPrice] = useState<PriceData | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [stockInfo, setStockInfo] = useState<StockInfo>({ code: '02110.HK', name: '天成控股' });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'orderbook' | 'trades'>('orderbook');
  const [isFavorite, setIsFavorite] = useState(false);

  // Fetch initial data
  useEffect(() => {
    Promise.all([getKline(), getLatestPrice(), getStockInfo()])
      .then(([kRes, pRes, sRes]) => {
        setKline(kRes.data || []);
        setPrice(pRes.data);
        if (sRes.data) setStockInfo(sRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    getTrades().then(tRes => setTrades(tRes.data || [])).catch(() => {});

    // Poll every 30s
    const timer = setInterval(() => {
      getLatestPrice().then(pRes => setPrice(pRes.data)).catch(() => {});
      getKline().then(kRes => setKline(kRes.data || [])).catch(() => {});
      getTrades().then(tRes => setTrades(tRes.data || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  const isUp = (price?.changePct || 0) >= 0;
  const priceCls = isUp ? 'text-[#e15241]' : 'text-[#47b262]';

  const indicatorCards = [
    { label: '今开', value: fmt(price?.open) },
    { label: '最高', value: fmt(price?.high), cls: chgCls((price?.high || 0) - (price?.prevClose || 0)) },
    { label: '成交量', value: fmtBigNum(price?.volume || 0) },
    { label: '涨跌幅', value: (isUp ? '+' : '') + fmt(price?.changePct) + '%', cls: priceCls },
    { label: '最低', value: fmt(price?.low), cls: chgCls((price?.low || 0) - (price?.prevClose || 0)) },
    { label: '昨收', value: fmt(price?.prevClose) },
  ];

  const quickTags = ['日内高低点', '顶底猎手', '择时决策', '涨停先锋', '神奇九转', '事件'];

  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">

      {/* ===== 1. App Bar ===== */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="flex items-center px-3 py-2.5 gap-2">
          {/* Name + code + tags */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-gray-800 truncate">{stockInfo.name}</h1>
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">港股</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-orange-50 text-orange-500 border border-orange-100">融资</span>
            </div>
            <p className="text-[10px] text-gray-400">{stockInfo.code}</p>
          </div>

          {/* Search + Favorite */}
          <button onClick={() => navigate('/hk')} className="text-gray-400 hover:text-gray-600 p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
          <button onClick={() => setIsFavorite(!isFavorite)} className={`p-1 ${isFavorite ? 'text-[#e15241]' : 'text-gray-400'} hover:text-[#e15241]`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ===== 2. Price Summary ===== */}
      <div className="bg-white mx-2 mt-2 rounded-lg shadow-sm p-4">
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold tabular-nums ${priceCls}`}>
            {fmt(price?.close)}
          </span>
          <span className={`text-sm font-medium tabular-nums ${priceCls}`}>
            {isUp ? '+' : ''}{fmt(price?.change)}
          </span>
          <span className={`text-sm font-medium tabular-nums px-1.5 py-0.5 rounded ${isUp ? 'bg-red-50 text-[#e15241]' : 'bg-green-50 text-[#47b262]'}`}>
            {isUp ? '+' : ''}{fmt(price?.changePct)}%
          </span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">昨收 {fmt(price?.prevClose)}</p>
      </div>

      {/* ===== 3. Indicator Cards (2×3) ===== */}
      <div className="bg-white mx-2 mt-2 rounded-lg shadow-sm p-3">
        <div className="grid grid-cols-3 gap-x-2 gap-y-2">
          {indicatorCards.map((it, i) => (
            <div key={i} className="text-center">
              <p className="text-[10px] text-gray-400">{it.label}</p>
              <p className={`text-xs font-semibold tabular-nums ${it.cls || 'text-gray-700'} truncate`}>
                {it.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 4. Chart ===== */}
      <div className="mx-2 mt-2">
        <KlineChart data={kline} />
      </div>

      {/* ===== 5. Quick Tags ===== */}
      <div className="mx-2 mt-2">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {quickTags.map(tag => (
            <button
              key={tag}
              className="shrink-0 px-3 py-1.5 text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full hover:border-gray-300 hover:text-gray-700 transition"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 6. OrderBook / Trade Detail Tabs ===== */}
      <div className="mx-2 mt-2 bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('orderbook')}
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              activeTab === 'orderbook' ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-400'
            }`}
          >
            五档委托
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              activeTab === 'trades' ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-400'
            }`}
          >
            成交明细
          </button>
        </div>

        {activeTab === 'orderbook' ? (
          <OrderBook
            buyLevels={price?.buyLevels || []}
            sellLevels={price?.sellLevels || []}
            prevClose={price?.prevClose || 0}
          />
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">暂无成交数据</div>
            ) : (
              <div className="text-[11px]">
                <div className="flex px-3 py-1.5 bg-gray-50 text-gray-400 font-medium">
                  <span className="w-32">时间</span>
                  <span className="w-10">方向</span>
                  <span className="flex-1 text-right">价格</span>
                  <span className="flex-1 text-right">数量</span>
                </div>
                {trades.map((t, i) => {
                  const isBuy = t.type === 'buy';
                  return (
                    <div key={i} className="flex px-3 py-1.5 border-b border-gray-50 tabular-nums">
                      <span className="w-32 text-gray-500">{(t.created_at || '').replace('T', ' ').slice(0, 19)}</span>
                      <span className={`w-10 font-medium ${isBuy ? 'text-[#e15241]' : 'text-[#47b262]'}`}>{isBuy ? '买' : '卖'}</span>
                      <span className={`flex-1 text-right font-medium ${isBuy ? 'text-[#e15241]' : 'text-[#47b262]'}`}>
                        {fmt(t.price)}
                      </span>
                      <span className="flex-1 text-right text-gray-500">{t.quantity?.toLocaleString() || '-'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== 7. Bottom Action Buttons ===== */}
      <div className="sticky bottom-16 z-20 bg-white border-t border-gray-100 shadow-lg mx-2 mt-2 rounded-lg">
        <div className="flex items-stretch divide-x divide-gray-100">
          <button
            onClick={() => navigate('/order/buy')}
            className="flex-1 py-3 text-sm font-bold text-white bg-[#e15241] hover:bg-red-600 active:scale-95 transition rounded-l-lg"
          >
            买入
          </button>
          <button
            onClick={() => navigate('/order/sell')}
            className="flex-1 py-3 text-sm font-bold text-white bg-[#47b262] hover:bg-green-700 active:scale-95 transition"
          >
            卖出
          </button>
          <button
            onClick={() => navigate('/my-orders')}
            className="flex-1 py-3 text-xs text-gray-600 bg-white hover:bg-gray-50 active:scale-95 transition"
          >
            撤单
          </button>
          <button
            onClick={() => setIsFavorite(!isFavorite)}
            className="flex-1 py-3 text-xs text-gray-500 bg-white hover:bg-gray-50 active:scale-95 transition"
          >
            加自选
          </button>
          <button
            onClick={() => {}}
            className="flex-1 py-3 text-xs text-gray-400 bg-white hover:bg-gray-50 active:scale-95 transition rounded-r-lg"
          >
            更多
          </button>
        </div>
      </div>

      {/* ===== 8. Footer ===== */}
      <div className="mx-2 mt-3 pb-4">
        <p className="text-center text-[10px] text-gray-300">
          数据来源: 内部交易系统 · 每 30 秒刷新
        </p>
      </div>
    </div>
  );
}
