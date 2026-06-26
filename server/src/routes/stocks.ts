import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// 合法 time_slot 形如 "YYYY-MM-DD HH:MM"（GLOB 过滤掉历史脏数据）
const SLOT_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]';

// 交易时段过滤：只保留 09:30-12:00 与 13:00-16:00 的点（substr(time_slot,12,5)=HH:MM）
// 排除早期种子数据里 16:13/17:03 这类非交易时段、时间不规整的点
const TRADING_HOURS_SQL =
  "((substr(time_slot,12,5) >= '09:30' AND substr(time_slot,12,5) <= '12:00') " +
  "OR (substr(time_slot,12,5) >= '13:00' AND substr(time_slot,12,5) <= '16:00'))";

// 行情读取统一过滤：格式合法 + 交易时段内 + 不晚于当前时间（绝不显示未来计划走势）
const VALID_SLOT_SQL = `time_slot GLOB ? AND ${TRADING_HOURS_SQL} AND time_slot <= ?`;

// 当前北京时间格式化为 "YYYY-MM-DD HH:MM"，用于严格按时间截断（不显示未来计划点）
function nowSlot(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

// 获取 K 线数据（价格时间序列）
// 严格：只返回格式合法、交易时段内、且 time_slot <= 当前时间的点
router.get('/kline', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 5000);
  const prices = db.prepare(
    `SELECT open, high, low, close, volume, time_slot, created_at FROM stock_prices WHERE ${VALID_SLOT_SQL} ORDER BY time_slot ASC LIMIT ?`
  ).all(SLOT_GLOB, nowSlot(), limit);
  res.json(prices);
});

// 获取最新价格
router.get('/latest', (_req: Request, res: Response) => {
  const now = nowSlot();
  const latest = db.prepare(
    `SELECT open, high, low, close, volume, time_slot FROM stock_prices WHERE ${VALID_SLOT_SQL} ORDER BY time_slot DESC, id DESC LIMIT 1`
  ).get(SLOT_GLOB, now) as any;

  if (!latest) {
    return res.json({ open: 10.0, high: 10.0, low: 10.0, close: 10.0, volume: 0 });
  }

  // 涨跌幅（与上一根比较）
  const prev = db.prepare(
    `SELECT close FROM stock_prices WHERE ${VALID_SLOT_SQL} ORDER BY time_slot DESC, id DESC LIMIT 1 OFFSET 1`
  ).get(SLOT_GLOB, now) as any;

  const change = prev ? (latest.close - prev.close) : 0;
  const changePct = prev ? ((change / prev.close) * 100) : 0;

  // 五档盘口：聚合真实的待审核(pending)订单
  // 买盘按价格从高到低(买1=最高买价)，卖盘按价格从低到高(卖1=最低卖价)
  const buyLevels = db.prepare(
    "SELECT price, SUM(quantity) AS volume FROM orders WHERE status='pending' AND type='buy' GROUP BY price ORDER BY price DESC LIMIT 5"
  ).all() as { price: number; volume: number }[];
  const sellLevels = db.prepare(
    "SELECT price, SUM(quantity) AS volume FROM orders WHERE status='pending' AND type='sell' GROUP BY price ORDER BY price ASC LIMIT 5"
  ).all() as { price: number; volume: number }[];

  // 买一/卖一：取真实盘口最优价，无挂单则回退到最新价
  const bid = buyLevels[0]?.price || latest.close;
  const ask = sellLevels[0]?.price || latest.close;

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

// 最近成交明细（真实成交，读 trade_records；脱敏，不返回用户信息）
router.get('/trades', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const rows = db.prepare(
    'SELECT type, quantity, price, amount, created_at FROM trade_records ORDER BY created_at DESC, id DESC LIMIT ?'
  ).all(limit);
  res.json(rows);
});

// 后台：添加价格点（每10分钟）
router.post('/add', requireAuth, requireAdmin, (req: Request, res: Response) => {
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

    logOperation(
      req.user?.id || 0,
      req.user?.username || '',
      'add_price',
      `添加价格点: ${time_slot} O:${o} H:${h} L:${l} C:${c}`
    );

    res.json({ message: '价格点已添加' });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

// 后台：批量添加价格点
router.post('/batch', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { prices } = req.body;
  if (!prices || !Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: '价格数组必填' });
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  try {
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
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

// 后台：删除价格点
router.delete('/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM stock_prices WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: '不存在' });

  db.prepare('DELETE FROM stock_prices WHERE id = ?').run(req.params.id);
  try {
    logOperation(req.user?.id || 0, req.user?.username || '', 'delete_price', `删除价格点: ${row.time_slot}`);
  } catch {}
  res.json({ message: '已删除' });
});

export default router;
