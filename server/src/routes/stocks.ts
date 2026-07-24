import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// 合法 time_slot 形如 "YYYY-MM-DD HH:MM"（GLOB 过滤掉历史脏数据）
const SLOT_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]';

// 交易时段过滤：只保留 09:00-12:00 与 13:00-16:10 的点（substr(time_slot,12,5)=HH:MM）
// 排除早期种子数据里 16:13/17:03 这类非交易时段、时间不规整的点
const TRADING_HOURS_SQL =
  "((substr(time_slot,12,5) >= '09:00' AND substr(time_slot,12,5) <= '12:00') " +
  "OR (substr(time_slot,12,5) >= '13:00' AND substr(time_slot,12,5) <= '16:10'))";

// 行情读取统一过滤：格式合法 + 交易时段内 + 不晚于当前时间（绝不显示未来计划走势）
const VALID_SLOT_SQL = `time_slot GLOB ? AND ${TRADING_HOURS_SQL} AND time_slot <= ?`;

// 当前北京时间格式化为 "YYYY-MM-DD HH:MM"，用于严格按时间截断（不显示未来计划点）
function nowSlot(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

const VALUATION_TIME_ZONE = 'Asia/Shanghai';
const VALUATION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function shanghaiNowSlot(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VALUATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

function parseValidSlot(slot: unknown): { date: string; dayNumber: number } | null {
  if (typeof slot !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(slot);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  return { date: `${yearText}-${monthText}-${dayText}`, dayNumber: Date.UTC(year, month - 1, day) / DAY_MS };
}

function dateFromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function reasonablePrecision(value: number): number {
  return Math.round(value * 1e10) / 1e10;
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

// 最近 30 个自然日的每日估值及基于缺口归一化对数收益波动率的上下沿
router.get('/valuation-range', (_req: Request, res: Response) => {
  const now = shanghaiNowSlot();
  const rows = db.prepare(
    `SELECT id, close, time_slot
     FROM stock_prices
     WHERE ${VALID_SLOT_SQL} AND close > 0
     ORDER BY time_slot DESC, id DESC`
  ).all(SLOT_GLOB, now) as { id: number; close: number; time_slot: string }[];

  const latestByDate = new Map<string, { date: string; dayNumber: number; neutral: number }>();
  for (const row of rows) {
    const parsed = parseValidSlot(row.time_slot);
    const neutral = Number(row.close);
    if (!parsed || !Number.isFinite(neutral) || neutral <= 0 || latestByDate.has(parsed.date)) continue;
    latestByDate.set(parsed.date, { ...parsed, neutral });
  }

  const latestEligibleDay = latestByDate.size
    ? Math.max(...Array.from(latestByDate.values(), point => point.dayNumber))
    : null;
  const windowStartDay = latestEligibleDay === null ? null : latestEligibleDay - (VALUATION_WINDOW_DAYS - 1);
  const dailyPoints = latestEligibleDay === null
    ? []
    : Array.from(latestByDate.values())
        .filter(point => point.dayNumber >= windowStartDay! && point.dayNumber <= latestEligibleDay)
        .sort((a, b) => a.dayNumber - b.dayNumber);

  const returns: number[] = [];
  for (let i = 1; i < dailyPoints.length; i++) {
    const previous = dailyPoints[i - 1];
    const current = dailyPoints[i];
    const calendarDayGap = current.dayNumber - previous.dayNumber;
    if (calendarDayGap <= 0) continue;
    const value = Math.log(current.neutral / previous.neutral) / Math.sqrt(calendarDayGap);
    if (Number.isFinite(value)) returns.push(value);
  }

  let sigma = 0;
  if (returns.length >= 2) {
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    sigma = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
    );
  }
  sigma = reasonablePrecision(sigma);

  res.json({
    window: {
      timeZone: VALUATION_TIME_ZONE,
      naturalDays: VALUATION_WINDOW_DAYS,
      startDate: windowStartDay === null ? null : dateFromDayNumber(windowStartDay),
      endDate: latestEligibleDay === null ? null : dateFromDayNumber(latestEligibleDay),
    },
    sigma,
    method: 'population_stddev_gap_normalized_consecutive_log_returns',
    sampleCount: returns.length,
    points: dailyPoints.map(point => ({
      date: point.date,
      neutral: reasonablePrecision(point.neutral),
      upper: reasonablePrecision(point.neutral * (1 + 0.5 * sigma)),
      lower: reasonablePrecision(point.neutral * (1 - 0.5 * sigma)),
    })),
  });
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

// 后台：添加参考估值点
router.post('/add', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { time_slot, open, high, low, close, volume } = req.body;
  if (!time_slot || !open) {
    return res.status(400).json({ error: '时间和参考估值必填' });
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
      `添加参考估值点: ${time_slot} 期初估值:${o} 估值区间上沿:${h} 估值区间下沿:${l} 当前估值:${c}`
    );

    res.json({ message: '参考估值点已添加' });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

// 后台：批量添加参考估值点
router.post('/batch', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { prices } = req.body;
  if (!prices || !Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: '参考估值数组必填' });
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
      `批量添加 ${prices.length} 个参考估值点`
    );

    res.json({ message: `已添加 ${prices.length} 个参考估值点` });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

// 后台：删除参考估值点
router.delete('/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM stock_prices WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: '不存在' });

  db.prepare('DELETE FROM stock_prices WHERE id = ?').run(req.params.id);
  try {
    logOperation(req.user?.id || 0, req.user?.username || '', 'delete_price', `删除参考估值点: ${row.time_slot}`);
  } catch {}
  res.json({ message: '已删除' });
});

export default router;
