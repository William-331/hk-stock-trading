import { useEffect, useState } from 'react';
import { getAccount, getPosition, getMyTrades } from '../api';

export default function MyPositions() {
  const [account, setAccount] = useState<any>(null);
  const [position, setPosition] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [tab, setTab] = useState<'position' | 'trades'>('position');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAccount(), getPosition(), getMyTrades()])
      .then(([aRes, pRes, tRes]) => {
        setAccount(aRes.data);
        setPosition(pRes.data);
        setTrades(tRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-gray-50"><p className="text-gray-400 text-sm">加载中...</p></div>;
  }

  const profitColor = (position?.profit || 0) >= 0 ? 'text-[#e15241]' : 'text-[#47b262]';

  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">
      <div className="max-w-lg mx-auto px-4 py-4">
        {/* 资金卡片 */}
        <div className="bg-gradient-to-r from-[#1a3a5c] to-[#1a5ce0] rounded-xl p-5 text-white mb-4 shadow-md">
          <p className="text-sm text-blue-200">账户余额</p>
          <p className="text-3xl font-bold mt-1 tracking-tight">¥{account?.balance?.toFixed(2) || '0.00'}</p>
          <div className="flex justify-between text-xs text-blue-200 mt-3">
            <span>{account?.real_name}</span>
            <span>{account?.username}</span>
          </div>
        </div>

        {/* Tab */}
        <div className="flex bg-white rounded-lg p-1 mb-4 shadow-sm border border-gray-100">
          {['position', 'trades'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`flex-1 py-2 text-sm rounded-md transition font-medium ${
                tab === t ? 'bg-[#1a5ce0] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'position' ? '当前持仓' : '成交记录'}
            </button>
          ))}
        </div>

        {tab === 'position' ? (
          position && position.quantity > 0 ? (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">标的</span>
                <span className="font-semibold text-gray-800">02110 模拟标的</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">持仓数量</span>
                <span className="font-bold text-gray-900">{position.quantity} 股</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">持仓均价</span>
                <span>¥{position.avg_cost?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">最新价</span>
                <span>¥{position.current_price?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">市值</span>
                <span className="font-semibold">¥{position.market_value?.toFixed(2)}</span>
              </div>
              <hr className="border-gray-100" />
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">浮动盈亏</span>
                <span className={`font-bold text-lg ${profitColor}`}>
                  {position.profit >= 0 ? '+' : ''}¥{position.profit?.toFixed(2)}
                  <span className="text-xs ml-1">({position.profit_pct?.toFixed(2)}%)</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <p className="text-5xl mb-3">📦</p>
              <p className="text-sm">暂无持仓</p>
              <p className="text-xs mt-1">提交买卖申请并审批通过后可见</p>
            </div>
          )
        ) : (
          trades.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-5xl mb-3">📝</p>
              <p className="text-sm">暂无成交记录</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trades.map((t: any) => (
                <div key={t.id} className="bg-white rounded-lg p-3.5 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className={`text-sm font-bold ${t.type === 'buy' ? 'text-[#e15241]' : 'text-[#47b262]'}`}>
                      {t.type === 'buy' ? '买入' : '卖出'}
                    </span>
                    <span className="text-xs text-gray-400">{t.created_at}</span>
                  </div>
                  <div className="flex justify-between mt-2 text-sm text-gray-600">
                    <span>{t.quantity} 股 @ ¥{t.price?.toFixed(2)}</span>
                    <span className="font-bold text-gray-800">¥{t.amount?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
