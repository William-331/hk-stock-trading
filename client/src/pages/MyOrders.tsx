import { useEffect, useState } from 'react';
import { getMyOrders } from '../api';

const statusMap: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审核', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
  approved: { label: '已通过', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  rejected: { label: '已驳回', cls: 'bg-red-50 text-red-500 border-red-200' },
};

export default function MyOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    getMyOrders(page)
      .then(res => { setOrders(res.data.list); setTotal(res.data.total); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div className="min-h-screen bg-[#f0f2f5] pb-20">
      <div className="max-w-lg mx-auto px-4 py-4">
        <h1 className="text-lg font-bold text-gray-800 mb-4">我的申请</h1>

        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">加载中...</p>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-3">📭</p>
            <p className="text-sm">暂无申请记录</p>
            <p className="text-xs mt-1">在行情页点击买入或卖出提交申请</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusMap[order.status]?.cls || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {statusMap[order.status]?.label || order.status}
                    </span>
                    <span className={`text-sm font-bold ${order.type === 'buy' ? 'text-[#e15241]' : 'text-[#47b262]'}`}>
                      {order.type === 'buy' ? '买入' : '卖出'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{order.created_at}</span>
                </div>
                <div className="mt-3 flex justify-between text-sm">
                  <span className="text-gray-600">{order.quantity} 股</span>
                  <span className="text-gray-600">@ ¥{order.price?.toFixed(2)}</span>
                  <span className="font-semibold text-gray-800">
                    ¥{((order.quantity || 0) * (order.price || 0)).toFixed(2)}
                  </span>
                </div>
                {order.audit_comment && (
                  <p className="mt-2 text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
                    备注: {order.audit_comment}
                  </p>
                )}
              </div>
            ))}

            {total > 20 && (
              <div className="flex justify-center items-center gap-3 pt-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition">
                  上一页
                </button>
                <span className="text-xs text-gray-400">{page} / {Math.ceil(total / 20)}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition">
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
