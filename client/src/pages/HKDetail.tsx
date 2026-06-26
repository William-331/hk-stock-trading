import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getHKQuote, getHKIntraday, getHKNews } from '../api';
import HKChart from '../components/HKChart';

interface QuoteData {
  code: string;
  name: string;
  price: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  amount: number;
  volume: number;
  turnover: number;
  volRatio: number;
  amplitude: number;
  pe: number;
  floatCap: number;
  week52High: number;
  week52Low: number;
  totalCap: number;
}

interface TradeTick {
  time: string;    // "0930"
  price: number;
  volume: number;
  amount: number;
}

interface NewsItem {
  title: string;
  url: string;
  time: string;
  source: string;
}

// ---------- helpers ----------
function fmt(v: number, decimals = 2): string {
  if (!v || v <= 0) return '-';
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

export default function HKDetail() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [trades, setTrades] = useState<TradeTick[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'news' | 'trades'>('news');

  // Poll quote + trades
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    // 切换股票时回到加载态，避免在旧数据/空数据上先闪“未找到”
    setLoading(true);
    setQuote(null);
    setError('');

    const fetchQuote = (initial = false) => {
      getHKQuote(code)
        .then(res => { if (!cancelled) { setQuote(res.data); setError(''); } })
        .catch(() => { if (!cancelled) setError('行情加载失败'); })
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    };

    const fetchTrades = () => {
      getHKIntraday(code)
        .then(res => {
          if (cancelled) return;
          const pts = res.data?.points || [];
          // Show last 30 ticks, most recent first
          setTrades(pts.slice(-30).reverse());
        })
        .catch(() => {});
    };

    // 首次加载：loading 在 quote 请求有结果后才关闭
    fetchQuote(true);
    fetchTrades();

    const timer = setInterval(() => { fetchQuote(); fetchTrades(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [code]);

  // Fetch news once
  useEffect(() => {
    let cancelled = false;
    getHKNews()
      .then(res => { if (!cancelled) setNews(res.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <div className="text-gray-400 text-sm">加载中...</div>
      </div>
    );
  }

  // 仅在「尚无任何行情数据」时才显示错误页；已有数据时轮询偶发失败不应清空页面
  if (!quote) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center gap-3">
        <span className="text-3xl">📡</span>
        <p className="text-gray-400 text-sm">{error || '未找到该股票'}</p>
        <button onClick={() => navigate('/hk')} className="text-blue-500 text-xs">返回列表</button>
      </div>
    );
  }

  const isUp = quote.changePct >= 0;
  const priceCls = isUp ? 'text-[#e15241]' : 'text-[#47b262]';

  const dataItems = [
    { label: '今开', value: fmt(quote.open) },
    { label: '昨收', value: fmt(quote.prevClose) },
    { label: '最高', value: fmt(quote.high), cls: chgCls(quote.high - quote.prevClose) },
    { label: '最低', value: fmt(quote.low), cls: chgCls(quote.low - quote.prevClose) },
    { label: '成交量', value: fmtBigNum(quote.volume) },
    { label: '成交额', value: fmtBigNum(quote.amount) },
    { label: '涨跌幅', value: (quote.changePct >= 0 ? '+' : '') + fmt(quote.changePct) + '%', cls: priceCls },
    { label: '换手率', value: quote.turnover > 0 ? fmt(quote.turnover) + '%' : '-' },
    { label: '振幅', value: quote.amplitude > 0 ? fmt(quote.amplitude) + '%' : '-' },
    { label: '量比', value: quote.volRatio > 0 ? fmt(quote.volRatio) : '-' },
    { label: '市盈率', value: fmt(quote.pe, 2) },
    { label: '总市值', value: fmtBigNum(quote.totalCap) },
    { label: '流通市值', value: fmtBigNum(quote.floatCap) },
    { label: '52周高', value: fmt(quote.week52High) },
    { label: '52周低', value: fmt(quote.week52Low) },
  ];

  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">
      {/* ---- Header ---- */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="flex items-center px-3 py-3 gap-3">
          <button onClick={() => navigate('/hk')} className="text-gray-400 hover:text-gray-600 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-800 truncate">{quote.name}</h1>
            <p className="text-[10px] text-gray-400">{quote.code}</p>
          </div>
          <div className="text-right">
            <p className={`text-xl font-bold tabular-nums ${priceCls}`}>{fmt(quote.price)}</p>
            <p className={`text-xs font-medium tabular-nums ${priceCls}`}>
              {isUp ? '+' : ''}{fmt(quote.change)} ({isUp ? '+' : ''}{fmt(quote.changePct)}%)
            </p>
          </div>
        </div>
      </div>

      {/* ---- Data Grid ---- */}
      <div className="bg-white mx-2 mt-2 rounded-lg shadow-sm p-3">
        <div className="grid grid-cols-4 gap-x-2 gap-y-1.5">
          {dataItems.map((it, i) => (
            <div key={i} className="text-center">
              <p className="text-[10px] text-gray-400">{it.label}</p>
              <p className={`text-xs font-medium tabular-nums ${it.cls || 'text-gray-700'} truncate`}>{it.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Bid / Ask (single level) ---- */}
      <div className="mx-2 mt-2 grid grid-cols-2 gap-2">
        <div className="bg-white rounded-lg shadow-sm p-3">
          <p className="text-[10px] text-gray-400 mb-1">买一</p>
          <p className="text-sm font-bold text-[#e15241] tabular-nums">{fmt(quote.bid)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-3">
          <p className="text-[10px] text-gray-400 mb-1">卖一</p>
          <p className="text-sm font-bold text-[#47b262] tabular-nums">{fmt(quote.ask)}</p>
        </div>
      </div>

      {/* ---- Chart ---- */}
      <div className="mx-2 mt-2">
        <HKChart code={code!} />
      </div>

      {/* ---- Bottom tabs: 新闻 / 成交明细 ---- */}
      <div className="mx-2 mt-2 bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('news')}
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              activeTab === 'news' ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-400'
            }`}
          >
            热点新闻
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

        {activeTab === 'news' ? (
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {news.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">暂无新闻</div>
            ) : (
              news.map((n, i) => (
                <a
                  key={i}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2.5 hover:bg-gray-50 transition"
                >
                  <p className="text-xs text-gray-700 line-clamp-2 leading-relaxed">{n.title}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {n.source}
                    {n.time && ` · ${new Date(n.time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </a>
              ))
            )}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">暂无成交数据</div>
            ) : (
              <div className="text-[11px]">
                {/* Header */}
                <div className="flex px-3 py-1.5 bg-gray-50 text-gray-400 font-medium">
                  <span className="w-16">时间</span>
                  <span className="flex-1 text-right">价格</span>
                  <span className="flex-1 text-right">数量</span>
                  <span className="flex-1 text-right">金额</span>
                </div>
                {trades.map((t, i) => (
                  <div key={i} className="flex px-3 py-1.5 border-b border-gray-50 tabular-nums">
                    <span className="w-16 text-gray-500">{t.time}</span>
                    <span className={`flex-1 text-right font-medium ${t.price >= (quote.prevClose || t.price) ? 'text-[#e15241]' : 'text-[#47b262]'}`}>
                      {fmt(t.price)}
                    </span>
                    <span className="flex-1 text-right text-gray-500">{t.volume.toLocaleString()}</span>
                    <span className="flex-1 text-right text-gray-500">{fmtBigNum(t.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mx-2 mt-3 pb-4">
        <p className="text-center text-[10px] text-gray-300">
          数据来源: 新浪财经 · 腾讯财经 · 每 5 秒刷新
        </p>
      </div>
    </div>
  );
}
