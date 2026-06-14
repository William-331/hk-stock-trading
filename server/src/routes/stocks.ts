import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';

const router = Router();

// 获取 K 线数据（价格时间序列）
router.get('/kline', (_req: Request, res: Response) => {
  const prices = db.prepare(
    'SELECT open, high, low, close, volume, time_slot, created_at FROM stock_prices ORDER BY time_slot ASC LIMIT 200'
  ).all();
  res.json(prices);
});

// 获取最新价格
router.get('/latest', (_req: Request, res: Response) => {
  const latest = db.prepare(
    'SELECT open, high, low, close, volume, time_slot FROM stock_prices ORDER BY id DESC LIMIT 1'
  ).get() as any;

  if (!latest) {
    return res.json({ open: 10.0, high: 10.0, low: 10.0, close: 10.0, volume: 0 });
  }

  // 涨跌幅（与上一根比较）
  const prev = db.prepare(
    'SELECT close FROM stock_prices ORDER BY id DESC LIMIT 1 OFFSET 1'
  ).get() as any;

  const change = prev ? (latest.close - prev.close) : 0;
  const changePct = prev ? ((change / prev.close) * 100) : 0;

  // 生成五档盘口（基于最新价推导）
  const price = latest.close;
  const tickSize =
    price >= 500 ? 0.5 : price >= 100 ? 0.1 : price >= 10 ? 0.02 : 0.01;
  const volBase = (latest.volume || 1000) * 0.0001;
  const bid = parseFloat((price - tickSize).toFixed(3));
  const ask = parseFloat((price + tickSize).toFixed(3));
  const buyLevels: { price: number; volume: number }[] = [];
  const sellLevels: { price: number; volume: number }[] = [];

  for (let i = 0; i < 5; i++) {
    const bp = parseFloat((bid - tickSize * i).toFixed(3));
    buyLevels.push({
      price: bp > 0 ? bp : bid,
      volume: Math.round(volBase * (6 - i) * (0.8 + Math.random() * 0.4)),
    });
    const sp = parseFloat((ask + tickSize * i).toFixed(3));
    sellLevels.push({
      price: sp > 0 ? sp : ask,
      volume: Math.round(volBase * (6 - i) * (0.8 + Math.random() * 0.4)),
    });
  }

  res.json({
    ...latest,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    bid,
    ask,
    prevClose: prev?.close || latest.open,
    buyLevels,
    sellLevels,
  });
});

// 后台：添加价格点（每10分钟）
router.post('/add', (req: Request, res: Response) => {
  const { time_slot, open, high, low, close, volume } = req.body;
  if (!time_slot || !open) {
    return res.status(400).json({ error: '时间和价格必填' });
  }

  const o = open;
  const h = high || o;
  const l = low || o;
  const c = close || o;
  const v = volume || 1000;

  try {
    db.prepare(
      'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(time_slot, o, h, l, c, v, req.user?.id || 1);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }

  logOperation(
    req.user?.id || 0,
    req.user?.username || '',
    'add_price',
    `添加价格点: ${time_slot} O:${o} H:${h} L:${l} C:${c}`
  );

  res.json({ message: '价格点已添加' });
});

// 后台：批量添加价格点
router.post('/batch', (req: Request, res: Response) => {
  const { prices } = req.body;
  if (!prices || !Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: '价格数组必填' });
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (const p of prices) {
      const { time_slot, open, high, low, close, volume } = p;
      insert.run(
        time_slot,
        open,
        high || open,
        low || open,
        close || open,
        volume || 1000,
        req.user?.id || 1
      );
    }
  });
  tx();

  logOperation(
    req.user?.id || 0,
    req.user?.username || '',
    'batch_add_price',
    `批量添加 ${prices.length} 个价格点`
  );

  res.json({ message: `已添加 ${prices.length} 个价格点` });
});

// 后台：删除价格点
router.delete('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM stock_prices WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: '不存在' });

  db.prepare('DELETE FROM stock_prices WHERE id = ?').run(req.params.id);
  logOperation(req.user?.id || 0, req.user?.username || '', 'delete_price', `删除价格点: ${row.time_slot}`);
  res.json({ message: '已删除' });
});

export default router;
