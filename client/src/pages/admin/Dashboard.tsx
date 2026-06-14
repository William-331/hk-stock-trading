import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../../api';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>({ userCount: 0, pendingCount: 0, tradeCount: 0, totalAmount: 0 });

  useEffect(() => {
    getDashboard().then(res => setData(res.data)).catch(console.error);
  }, []);

  const cards = [
    { label: '用户数', value: data.userCount, color: 'bg-blue-500', path: '' },
    { label: '待审核', value: data.pendingCount, color: 'bg-yellow-500', path: '/admin/audit' },
    { label: '成交笔数', value: data.tradeCount, color: 'bg-green-500', path: '/admin/trades' },
    { label: '成交总额', value: '¥' + (data.totalAmount || 0).toFixed(0), color: 'bg-purple-500', path: '/admin/trades' },
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <h1 className="text-xl font-bold mb-4">控制台</h1>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            onClick={() => card.path && navigate(card.path)}
            className={`${card.color} rounded-xl p-4 text-white cursor-pointer hover:opacity-90 transition active:scale-95`}
          >
            <p className="text-sm opacity-80">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <button onClick={() => navigate('/admin/audit')} className="w-full py-3 bg-white border rounded-xl hover:bg-gray-50 text-left px-4 flex justify-between items-center">
          <span className="font-medium">审批管理</span>
          {data.pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">{data.pendingCount} 待审</span>
          )}
          <span className="text-gray-400">→</span>
        </button>
        <button onClick={() => navigate('/admin/price')} className="w-full py-3 bg-white border rounded-xl hover:bg-gray-50 text-left px-4 flex justify-between items-center">
          <span className="font-medium">价格控制</span>
          <span className="text-gray-400">→</span>
        </button>
        <button onClick={() => navigate('/admin/trades')} className="w-full py-3 bg-white border rounded-xl hover:bg-gray-50 text-left px-4 flex justify-between items-center">
          <span className="font-medium">交易记录</span>
          <span className="text-gray-400">→</span>
        </button>
      </div>
    </div>
  );
}
