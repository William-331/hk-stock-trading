import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getKline, getLatestPrice, getStockInfo } from '../api';
import KlineChart from '../components/KlineChart';

export default function Market() {
  const navigate = useNavigate();
  const [kline, setKline] = useState<any[]>([]);
  const [price, setPrice] = useState<any>(null);
  const [stockInfo, setStockInfo] = useState<any>({ code: '02110', name: '模拟标的' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getKline(), getLatestPrice(), getStockInfo()])
      .then(([kRes, pRes, sRes]) => {
        setKline(kRes.data);
        setPrice(pRes.data);
        setStockInfo(sRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    const timer = setInterval(() => {
      getLatestPrice().then(pRes => setPrice(pRes.data)).catch(() => {});
      getKline().then(kRes => setKline(kRes.data)).catch(() => {});
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
  const changeColor = isUp ? 'text-[#e15241]' : 'text-[#47b262]';

  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">
      {/* 标的头部 */}
      <div className="bg-white border-b border-gray-100 px-4 py-5">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between items-end">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base font-bold text-gray-800">{stockInfo.code}</span>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">模拟盘</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-gray-900 tabular-nums">
                {price?.close?.toFixed(2) || '-'}
              </p>
              <p className={`text-sm font-medium ${changeColor}`}>
                {isUp ? '+' : ''}{price?.change?.toFixed(2) || '0.00'}
                <span className="ml-1">({isUp ? '+' : ''}{price?.changePct?.toFixed(2) || '0.00'}%)</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 行情数据栏 */}
      <div className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-lg mx-auto grid grid-cols-4 text-center">
          {[
            ['开盘', price?.open, 'text-gray-500'],
            ['昨收', price?.prevClose, 'text-gray-500'],
            ['最高', price?.high, 'text-[#e15241]'],
            ['最低', price?.low, 'text-[#47b262]'],
          ].map(([label, val, cls]) => (
            <div key={label as string}>
              <p className="text-xs text-gray-400 mb-0.5">{label}</p>
              <p className={`text-sm font-semibold ${cls}`}>{(val as number)?.toFixed(2) || '-'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* K线 */}
      <div className="px-2 mt-3 max-w-lg mx-auto">
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <KlineChart data={kline} />
        </div>
      </div>

      {/* 买卖按钮 */}
      <div className="fixed bottom-14 left-0 right-0 z-30 px-4">
        <div className="flex max-w-lg mx-auto gap-3">
          <button
            onClick={() => navigate('/order/buy')}
            className="flex-1 py-3.5 bg-[#e15241] hover:bg-[#d04334] text-white rounded-lg font-bold text-base shadow-sm active:scale-[0.98] transition"
          >
            买入
          </button>
          <button
            onClick={() => navigate('/order/sell')}
            className="flex-1 py-3.5 bg-[#47b262] hover:bg-[#3a9e54] text-white rounded-lg font-bold text-base shadow-sm active:scale-[0.98] transition"
          >
            卖出
          </button>
        </div>
      </div>
    </div>
  );
}
