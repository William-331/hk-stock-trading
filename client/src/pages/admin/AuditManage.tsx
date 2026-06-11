import { useEffect, useState } from 'react';
import { getPendingOrders, approveOrder, rejectOrder } from '../../api';

export default function AuditManage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    getPendingOrders()
      .then(res => setOrders(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: number) => {
    try {
      await approveOrder(id);
      setMsg('已通过');
      load();
    } catch (err: any) {
      setMsg(err.response?.data?.error || '操作失败');
    }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleReject = async () => {
    if (!rejectId || !rejectComment.trim()) return;
    try {
      await rejectOrder(rejectId, rejectComment);
      setRejectId(null);
      setRejectComment('');
      setMsg('已驳回');
      load();
    } catch (err: any) {
      setMsg(err.response?.data?.error || '操作失败');
    }
    setTimeout(() => setMsg(''), 2000);
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <h1 className="text-xl font-bold mb-4">待审核申请</h1>

      {msg && (
        <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>
      )}

      {loading ? (
        <p className="text-gray-500 text-center py-8">加载中...</p>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">✅</p>
          <p>没有待审核的申请</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`font-bold ${order.type === 'buy' ? 'text-red-600' : 'text-green-600'}`}>
                    {order.type === 'buy' ? '买入' : '卖出'}
                  </span>
                  <span className="text-gray-500 text-sm ml-2">{order.username}({order.real_name})</span>
                </div>
                <span className="text-xs text-gray-400">{order.created_at}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="font-bold">{order.quantity} 股</span>
                <span>@ ¥{order.price?.toFixed(2)}</span>
                <span className="font-bold">¥{((order.quantity || 0) * (order.price || 0)).toFixed(2)}</span>
              </div>

              {rejectId === order.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={rejectComment}
                    onChange={e => setRejectComment(e.target.value)}
                    placeholder="请输入驳回原因（必填）"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button onClick={handleReject} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium">
                      确认驳回
                    </button>
                    <button onClick={() => { setRejectId(null); setRejectComment(''); }} className="px-4 py-2 bg-gray-200 rounded-lg text-sm">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleApprove(order.id)}
                    className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600"
                  >
                    通过
                  </button>
                  <button
                    onClick={() => setRejectId(order.id)}
                    className="flex-1 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200"
                  >
                    驳回
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
