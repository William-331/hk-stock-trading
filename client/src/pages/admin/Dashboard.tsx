import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../../api';
import { ValuationNoticeBanner } from '../../components/compliance';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>({
    userCount: 0, pendingCount: 0, tradeCount: 0, totalAmount: 0,
    todayTradeCount: 0, todayAmount: 0, recentPending: [],
  });

  useEffect(() => {
    getDashboard().then(res => setData(res.data)).catch(console.error);
  }, []);

  // 全局统计卡片（纯展示，导航交给底部标签栏，不再重复跳转）
  const cards = [
    { label: '用户数', value: data.userCount, color: 'bg-blue-500' },
    { label: '待审核', value: data.pendingCount, color: 'bg-yellow-500' },
    { label: '认购与转让完成笔数', value: data.tradeCount, color: 'bg-green-500' },
    { label: '参考金额', value: '¥' + (data.totalAmount || 0).toFixed(0), color: 'bg-purple-500' },
  ];

  const recent = data.recentPending || [];

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <ValuationNoticeBanner />

      <h1 className="text-xl font-bold mb-4">控制台</h1>

      {/* 全局统计 */}
      <div className="grid grid-cols-2 gap-3">
        {cards.map(card => (
          <div key={card.label} className={`${card.color} rounded-xl p-4 text-white`}>
            <p className="text-sm opacity-80">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 今日认购与转让概况 */}
      <div className="mt-4 bg-white border rounded-xl p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">今日认购与转让概况</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-400">认购与转让完成笔数</p>
            <p className="text-xl font-bold text-gray-800 mt-0.5">{data.todayTradeCount || 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">参考金额</p>
            <p className="text-xl font-bold text-gray-800 mt-0.5">¥{(data.todayAmount || 0).toFixed(0)}</p>
          </div>
        </div>
      </div>

      {/* 最近待审申请 */}
      <div className="mt-4 bg-white border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700">最近待审申请</p>
          <button onClick={() => navigate('/admin/audit')} className="text-xs text-blue-500 hover:text-blue-600">
            全部审批 →
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">暂无待审申请</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map((o: any) => (
              <button
                key={o.id}
                onClick={() => navigate('/admin/audit')}
                className="w-full flex items-center justify-between py-2.5 text-left hover:bg-gray-50 transition -mx-1 px-1 rounded"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${o.type === 'buy' ? 'bg-red-50 text-[#e15241]' : 'bg-green-50 text-[#47b262]'}`}>
                    {o.type === 'buy' ? '认购' : '申请转让'}
                  </span>
                  <span className="text-sm text-gray-700 truncate">{o.real_name || o.username}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-sm text-gray-800">{o.quantity} 股 @ ¥{(o.price || 0).toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400">{o.created_at}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
