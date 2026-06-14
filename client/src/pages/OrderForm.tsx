import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { submitOrder, getLatestPrice } from '../api';

export default function OrderForm() {
  const { type } = useParams(); // 'buy' | 'sell'
  const navigate = useNavigate();
  const isBuy = type === 'buy';

  const [latestPrice, setLatestPrice] = useState(0);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getLatestPrice().then(res => {
      const p = res.data.close;
      setLatestPrice(p);
      setPrice(String(p));
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const qty = Number(quantity);
    const prc = Number(price);

    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
      setError('请输入有效的整数数量');
      return;
    }
    if (!prc || prc <= 0) {
      setError('请输入有效的价格');
      return;
    }

    setLoading(true);
    try {
      const res = await submitOrder({ type: type!, quantity: qty, price: prc });
      setSuccess(res.data.message);
      setTimeout(() => navigate('/my-orders'), 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 mb-4 flex items-center gap-1">
        ← 返回
      </button>

      <h1 className={`text-2xl font-bold mb-6 ${isBuy ? 'text-red-600' : 'text-green-600'}`}>
        {isBuy ? '买入' : '卖出'} 02110
      </h1>

      <div className="bg-gray-100 rounded-lg p-3 mb-4 text-sm text-gray-600">
        当前最新价: <span className="font-bold text-gray-900">{latestPrice.toFixed(2)}</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">价格（元）</label>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
            placeholder="请输入价格"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">数量（股）</label>
          <input
            type="number"
            step="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
            placeholder="请输入数量，必须是整数"
            required
          />
        </div>

        {price && quantity && (
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <p className="text-gray-600">
              {isBuy ? '买入' : '卖出'} <span className="font-bold">{quantity || 0}</span> 股 ×
              <span className="font-bold"> ¥{Number(price || 0).toFixed(2)}</span>
            </p>
            <p className="text-gray-800 font-bold mt-1">
              总金额: ¥{((Number(quantity) || 0) * (Number(price) || 0)).toFixed(2)}
            </p>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {success && <p className="text-green-600 text-sm">{success}</p>}

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-4 text-white rounded-xl font-bold text-lg transition active:scale-95 disabled:opacity-50 shadow-lg ${
            isBuy ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
          }`}
        >
          {loading ? '提交中...' : `确认${isBuy ? '买入' : '卖出'}`}
        </button>
      </form>
    </div>
  );
}
