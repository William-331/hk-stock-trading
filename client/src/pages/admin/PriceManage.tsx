import { useEffect, useState } from 'react';
import { getKline, addPrice, batchAddPrice } from '../../api';
import KlineChart from '../../components/KlineChart';

export default function PriceManage() {
  const [kline, setKline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'single' | 'batch'>('single');

  // 单个添加
  const [timeSlot, setTimeSlot] = useState('');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState('');

  // 批量生成
  const [batchStart, setBatchStart] = useState('');
  const [batchBasePrice, setBatchBasePrice] = useState('');
  const [batchCount, setBatchCount] = useState('24');
  const [batchVolatility, setBatchVolatility] = useState('0.3');

  useEffect(() => {
    loadKline();
  }, []);

  const loadKline = () => {
    getKline().then(res => setKline(res.data)).catch(console.error).finally(() => setLoading(false));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timeSlot || !price) return;
    try {
      const o = Number(price);
      await addPrice({
        time_slot: timeSlot.replace('T', ' '),
        open: o,
        high: Math.round(o * 1.005 * 100) / 100,
        low: Math.round(o * 0.995 * 100) / 100,
        close: Math.round(o * 1.002 * 100) / 100,
        volume: Math.floor(Math.random() * 3000) + 2000,
      });
      setMsg('价格点已添加');
      setTimeSlot('');
      setPrice('');
      loadKline();
    } catch (err: any) {
      setMsg(err.response?.data?.error || '添加失败');
    }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleBatch = async () => {
    if (!batchStart || !batchBasePrice) return;
    const base = Number(batchBasePrice);
    const count = Number(batchCount);
    const vol = Number(batchVolatility);

    const startDate = new Date(batchStart);
    const prices: any[] = [];

    for (let i = 0; i < count; i++) {
      const t = new Date(startDate.getTime() + i * 10 * 60 * 1000);
      const slot = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;

      const change = (Math.random() - 0.48) * vol;
      const p = Math.max(0.01, base + change);
      const o = Math.round(p * 100) / 100;
      const c = Math.round((p + (Math.random() - 0.5) * vol * 0.8) * 100) / 100;
      const h = Math.round(Math.max(o, c) * 1.005 * 100) / 100;
      const l = Math.round(Math.min(o, c) * 0.995 * 100) / 100;

      prices.push({
        time_slot: slot,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: Math.floor(Math.random() * 5000) + 1000,
      });
    }

    try {
      await batchAddPrice(prices);
      setMsg(`已生成 ${count} 个价格点`);
      loadKline();
    } catch (err: any) {
      setMsg(err.response?.data?.error || '生成失败');
    }
    setTimeout(() => setMsg(''), 2000);
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <h1 className="text-xl font-bold mb-4">价格控制</h1>

      {msg && <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">{msg}</div>}

      {/* K 线预览 */}
      <div className="mb-4">
        <KlineChart data={kline} />
      </div>

      {/* Tab */}
      <div className="flex border-b mb-4">
        <button
          onClick={() => setTab('single')}
          className={`flex-1 py-2 text-center text-sm font-medium ${tab === 'single' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          添加单个
        </button>
        <button
          onClick={() => setTab('batch')}
          className={`flex-1 py-2 text-center text-sm font-medium ${tab === 'batch' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          批量生成
        </button>
      </div>

      {tab === 'single' ? (
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={timeSlot}
              onChange={e => setTimeSlot(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const tz = now.getFullYear() + '-' +
                  String(now.getMonth()+1).padStart(2,'0') + '-' +
                  String(now.getDate()).padStart(2,'0') + 'T' +
                  String(now.getHours()).padStart(2,'0') + ':' +
                  String(now.getMinutes()).padStart(2,'0');
                setTimeSlot(tz);
              }}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 shrink-0"
            >
              现在
            </button>
          </div>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="价格"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            添加价格点
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <input
            type="datetime-local"
            value={batchStart}
            onChange={e => setBatchStart(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number"
            step="0.01"
            value={batchBasePrice}
            onChange={e => setBatchBasePrice(e.target.value)}
            placeholder="基准价格"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">数量（个）</label>
              <input
                type="number"
                value={batchCount}
                onChange={e => setBatchCount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">波动幅度</label>
              <input
                type="number"
                step="0.1"
                value={batchVolatility}
                onChange={e => setBatchVolatility(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <button onClick={handleBatch} className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
            批量生成 K 线数据
          </button>
        </div>
      )}
    </div>
  );
}
