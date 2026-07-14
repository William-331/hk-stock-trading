import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// ================================================================
// 工具：生成某个交易日所有交易时间点（30 分钟粒度）
//   早盘 9:00-12:00：9:00 9:30 10:00 10:30 11:00 11:30 12:00
//   午休 12:00-13:00 休市
//   午盘 13:00-16:00：13:00 13:30 ... 16:00，另加收盘 16:10
//   开盘 9:00，收盘 16:10
// ================================================================
const SLOT_STEP_MIN = 30; // 时间点间隔（分钟）

function tradingSlots(dateStr: string): string[] {
  const slots: string[] = [];
  const push = (h: number, m: number) =>
    slots.push(`${dateStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  // 上午 9:00 - 12:00（含 12:00）
  for (let h = 9; h < 12; h++) for (let m = 0; m < 60; m += SLOT_STEP_MIN) push(h, m);
  push(12, 0);
  // 下午 13:00 - 16:00（含 16:00）
  for (let h = 13; h < 16; h++) for (let m = 0; m < 60; m += SLOT_STEP_MIN) push(h, m);
  push(16, 0);
  push(16, 10); // 收盘点
  return slots;
}

// 判断是否周末
function isWeekend(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

// 本地日期格式化为 YYYY-MM-DD（不要用 toISOString，那是 UTC 会在东八区偏成前一天）
function toLocalDate(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 判断时间是否在交易时段外（午休12:00-13:00可以存12:00，跳过12:05-12:55）
function isTradingTime(timeStr: string): boolean {
  const hh = parseInt(timeStr.split(' ')[1].split(':')[0], 10);
  const mm = parseInt(timeStr.split(' ')[1].split(':')[1], 10);
  if (hh === 12 && mm > 0) return false; // 12:05-12:55 跳过
  return true;
}

// 生成一整天的连续走势（多锚点布朗桥）
//
// 逻辑（可完整解释给运营看）：
//   1. 关键锚点：开盘(第0点) / 收盘(末点) 必有；若给了当日最高/最低价，它们也是锚点，
//      并可由 opts.highIdx / lowIdx 精确指定出现在第几个5分钟点（留空则系统在盘中随机安排）。
//   2. 基线：把这些锚点按时间顺序用「折线」连起来 —— 锚点时刻的价格精确命中设定值，
//      锚点之间线性过渡（例：开盘→盘中最低→盘中最高→收盘）。
//   3. 波动：在折线基线上叠加分段布朗桥噪声（每个锚点处噪声归零，保证锚点不被扰动）。
//      volUp/volDown% 只决定这层噪声的“毛刺”粗细，噪声再大也不会突破当日最高/最低、不挪动锚点。
//
// volUp: 相对基线向上最大偏离% (如1.0=+1%)  volDown: 向下最大偏离%
// opts.highIdx/lowIdx: 最高/最低价出现的时间点下标（0-based，落在 [1, total-2] 内有效）
// 返回每个时间点的 {open, high, low, close, volume}，且每根开盘=上一根收盘（K线连续）
function generateDaySeries(
  openPrice: number,
  closePrice: number,
  total: number,
  volUp = 1.0,
  volDown = 1.0,
  dayHigh?: number,
  dayLow?: number,
  opts?: { highIdx?: number; lowIdx?: number },
): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  if (total <= 0) return [];
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const hasHigh = dayHigh !== undefined && Number.isFinite(dayHigh) && dayHigh > 0;
  const hasLow = dayLow !== undefined && Number.isFinite(dayLow) && dayLow > 0;
  const lastIdx = total - 1;
  // 把下标夹在盘中区间 [1, lastIdx-1]，避免极值退化到开/收盘那一刻
  const clampIdx = (i: number) => Math.min(Math.max(i, 1), Math.max(1, lastIdx - 1));

  // ---- 1. 确定最高/最低价的时间下标 ----
  let highIdx: number | undefined;
  let lowIdx: number | undefined;
  if (hasHigh && total > 2) {
    highIdx = opts?.highIdx !== undefined && opts.highIdx >= 0
      ? clampIdx(opts.highIdx)
      : clampIdx(Math.round(total * (0.2 + Math.random() * 0.6))); // 未指定：盘中随机
  }
  if (hasLow && total > 2) {
    lowIdx = opts?.lowIdx !== undefined && opts.lowIdx >= 0
      ? clampIdx(opts.lowIdx)
      : clampIdx(Math.round(total * (0.2 + Math.random() * 0.6)));
    // 高低点撞在同一时刻则错开一格；仍冲突（点太少）则舍弃最低点锚
    if (highIdx !== undefined && lowIdx === highIdx) {
      const nudged = clampIdx(lowIdx + (lowIdx < lastIdx - 1 ? 1 : -1));
      lowIdx = nudged === highIdx ? undefined : nudged;
    }
  }

  // ---- 2. 组装锚点（按时间下标升序）：开盘 → [盘中高/低] → 收盘 ----
  const anchors: Array<{ idx: number; price: number }> = [{ idx: 0, price: openPrice }];
  const mids: Array<{ idx: number; price: number }> = [];
  if (highIdx !== undefined) mids.push({ idx: highIdx, price: dayHigh! });
  if (lowIdx !== undefined) mids.push({ idx: lowIdx, price: dayLow! });
  mids.sort((a, b) => a.idx - b.idx);
  for (const m of mids) anchors.push(m);
  anchors.push({ idx: lastIdx, price: closePrice });

  // ---- 3. 折线基线：锚点处精确命中，锚点之间线性过渡 ----
  const baseline = new Array<number>(total).fill(0);
  for (let s = 0; s < anchors.length - 1; s++) {
    const a = anchors[s], b = anchors[s + 1];
    const span = b.idx - a.idx;
    for (let i = a.idx; i <= b.idx; i++) {
      const t = span > 0 ? (i - a.idx) / span : 0;
      baseline[i] = a.price + (b.price - a.price) * t;
    }
  }

  // ---- 4. 分段布朗桥噪声：每段两端（锚点）噪声归零，中间连续随机游走 ----
  const avgBase = (openPrice + closePrice) / 2;
  const maxDev = avgBase * (Math.max(volUp, volDown) / 100);
  const noise = new Array<number>(total).fill(0);
  for (let s = 0; s < anchors.length - 1; s++) {
    const a = anchors[s].idx, b = anchors[s + 1].idx;
    const len = b - a;
    if (len <= 1) continue;
    const step = maxDev / Math.max(2, Math.sqrt(len));
    const w = new Array<number>(len + 1).fill(0);
    for (let k = 1; k <= len; k++) w[k] = w[k - 1] + (Math.random() - 0.5) * 2 * step;
    const last = w[len];
    for (let k = 0; k <= len; k++) {
      w[k] -= last * (k / len);   // 钉死两端为 0（布朗桥）
      noise[a + k] = w[k];
    }
  }

  // ---- 5. 收盘 = 基线 + 受限噪声；再套硬性包络与锚点 ----
  const closes = new Array<number>(total);
  for (let i = 0; i < total; i++) {
    const up = baseline[i] * (volUp / 100);
    const dn = baseline[i] * (volDown / 100);
    let n = noise[i];
    if (n > up) n = up;
    if (n < -dn) n = -dn;
    closes[i] = baseline[i] + n;
  }
  closes[0] = openPrice;
  closes[lastIdx] = closePrice;
  if (hasHigh || hasLow) {
    const hi = hasHigh ? dayHigh! : Infinity;
    const lo = hasLow ? dayLow! : -Infinity;
    for (let i = 0; i < total; i++) {
      if (closes[i] > hi) closes[i] = hi;
      if (closes[i] < lo) closes[i] = lo;
    }
  }
  // 锚点精确命中（保证最高/最低价出现在设定的时间点上）
  if (highIdx !== undefined) closes[highIdx] = dayHigh!;
  if (lowIdx !== undefined) closes[lowIdx] = dayLow!;

  // ---- 6. 组装 OHLC：开盘=上一根收盘（K线连续），影线小幅外扩且不破包络 ----
  const series = [];
  for (let i = 0; i < total; i++) {
    const o = i === 0 ? openPrice : closes[i - 1];
    const c = r2(closes[i]);
    const wick = avgBase * (Math.max(volUp, volDown) / 100) * 0.15 * Math.random();
    let h = r2(Math.max(o, c) + wick);
    let l = r2(Math.min(o, c) - wick);
    if (hasHigh) h = r2(Math.min(h, dayHigh!));
    if (hasLow) l = r2(Math.max(l, dayLow!));
    const v = Math.floor(Math.random() * 5000) + 2000;
    series.push({ open: r2(o), high: h, low: l, close: c, volume: v });
  }
  return series;
}

function toRangeStart(dateStr: string) {
  return `${dateStr} 00:00`;
}

function toRangeEnd(dateStr: string) {
  return `${dateStr} 23:59`;
}

function getLatestTimeSlot() {
  const latest = db.prepare(
    'SELECT time_slot FROM stock_prices ORDER BY time_slot DESC, id DESC LIMIT 1'
  ).get() as any;
  return latest?.time_slot || null;
}

// 把 "HH:MM" 映射到当天 slots 数组的下标；无效/不在时段内返回 undefined
function slotIndexOfTime(slots: string[], date: string, t?: string): number | undefined {
  if (!t || typeof t !== 'string') return undefined;
  const hhmm = t.trim();
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return undefined;
  const [h, m] = hhmm.split(':').map(Number);
  const target = `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const idx = slots.indexOf(target);
  return idx >= 0 ? idx : undefined;
}

function buildSlotsForDay(
  date: string, open: number, close: number, volUp = 1.0, volDown = 1.0,
  opts?: { high?: number; low?: number; highTime?: string; lowTime?: string },
) {
  const slots = tradingSlots(date).filter(isTradingTime);
  const highIdx = opts?.high !== undefined ? slotIndexOfTime(slots, date, opts.highTime) : undefined;
  const lowIdx = opts?.low !== undefined ? slotIndexOfTime(slots, date, opts.lowTime) : undefined;
  const series = generateDaySeries(open, close, slots.length, volUp, volDown, opts?.high, opts?.low, { highIdx, lowIdx });
  return slots.map((timeSlot, index) => ({
    time_slot: timeSlot,
    ...series[index],
  }));
}

// ================================================================
//  GET /api/price-plan — 查询价格计划
// ================================================================
router.get('/', requireAuth, (req: Request, res: Response) => {
  const { date, from, to, status } = req.query;
  let sql = 'SELECT * FROM price_plan WHERE 1=1';
  const params: any[] = [];

  if (date) {
    sql += ' AND time_slot LIKE ?';
    params.push(`${date}%`);
  }
  if (from) {
    sql += ' AND time_slot >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND time_slot <= ?';
    params.push(to);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY time_slot ASC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ================================================================
//  POST /api/price-plan/daily — 设定某日开盘价+收盘价，自动生成
//  Body: { date, open, close, volUp?, volDown? }
// ================================================================
router.post('/daily', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { date, open, close, volUp, volDown, high, low } = req.body;
  if (!date || !open || !close) {
    return res.status(400).json({ error: '日期、开盘价、收盘价必填' });
  }

  if (isWeekend(date)) {
    return res.status(400).json({ error: '周末不可设定交易计划' });
  }

  const slots = tradingSlots(date).filter(isTradingTime);
  if (slots.length === 0) {
    return res.status(400).json({ error: '该日期无有效交易时段' });
  }

  const up = volUp !== undefined ? Number(volUp) : 1.0;
  const down = volDown !== undefined ? Number(volDown) : 1.0;

  // 当日最高/最低价（可选）。若填写则校验区间合法性
  const dayHigh = high !== undefined && high !== '' ? Number(high) : undefined;
  const dayLow = low !== undefined && low !== '' ? Number(low) : undefined;
  if (dayHigh !== undefined && (!Number.isFinite(dayHigh) || dayHigh <= 0)) {
    return res.status(400).json({ error: '当日最高价无效' });
  }
  if (dayLow !== undefined && (!Number.isFinite(dayLow) || dayLow <= 0)) {
    return res.status(400).json({ error: '当日最低价无效' });
  }
  if (dayHigh !== undefined && dayLow !== undefined && dayHigh < dayLow) {
    return res.status(400).json({ error: '当日最高价不能低于最低价' });
  }
  const o = Number(open), c = Number(close);
  if (dayHigh !== undefined && (o > dayHigh || c > dayHigh)) {
    return res.status(400).json({ error: '开盘价/收盘价不能高于当日最高价' });
  }
  if (dayLow !== undefined && (o < dayLow || c < dayLow)) {
    return res.status(400).json({ error: '开盘价/收盘价不能低于当日最低价' });
  }

  // 最高/最低价的出现时间（可选，"HH:MM"）。映射到 slots 下标；
  // 空/不在交易时段则留空，交给算法在盘中随机安排。
  const slotIdxOfTime = (t?: string): number | undefined => {
    if (!t || typeof t !== 'string') return undefined;
    const hhmm = t.trim();
    if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return undefined;
    const [h, m] = hhmm.split(':').map(Number);
    const target = `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const idx = slots.indexOf(target);
    return idx >= 0 ? idx : undefined;
  };
  const { highTime, lowTime } = req.body;
  const highIdx = dayHigh !== undefined ? slotIdxOfTime(highTime) : undefined;
  const lowIdx = dayLow !== undefined ? slotIdxOfTime(lowTime) : undefined;
  if (highTime && dayHigh !== undefined && highIdx === undefined) {
    return res.status(400).json({ error: '最高价出现时间不在交易时段内（9:00-12:00 / 13:00-16:10，5分钟为一格）' });
  }
  if (lowTime && dayLow !== undefined && lowIdx === undefined) {
    return res.status(400).json({ error: '最低价出现时间不在交易时段内（9:00-12:00 / 13:00-16:10，5分钟为一格）' });
  }
  if (highIdx !== undefined && lowIdx !== undefined && highIdx === lowIdx) {
    return res.status(400).json({ error: '最高价与最低价不能设在同一时间点' });
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO price_plan (time_slot, open, high, low, close, volume, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  // 生成后当场把「已到点」(time_slot <= 现在) 的计划回填到可见 K 线，
  // 使当日修改立即反映到图表；未来时刻的点仍标 pending，留给 cron 到点回填。
  const upsertStock = db.prepare(
    'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const markStatus = db.prepare('UPDATE price_plan SET status = ? WHERE time_slot = ?');

  try {
    const series = generateDaySeries(Number(open), Number(close), slots.length, up, down, dayHigh, dayLow, { highIdx, lowIdx });
    const nowStr = nowSlotStr();
    let synced = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < slots.length; i++) {
        const p = series[i];
        insert.run(slots[i], p.open, p.high, p.low, p.close, p.volume, 'pending', req.user?.id || 1);
        // 已到点的立即同步到 stock_prices 并标 executed
        if (slots[i] <= nowStr) {
          upsertStock.run(slots[i], p.open, p.high, p.low, p.close, p.volume, req.user?.id || 1);
          markStatus.run('executed', slots[i]);
          synced++;
        }
      }
    });
    tx();
    res.json({ message: `已生成 ${slots.length} 个价格计划点（${synced} 个已到点，立即生效）`, count: slots.length, synced });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ================================================================
//  POST /api/price-plan/batch — 批量设定日期范围
//  Body: { from, to, open, close }   // 每日统一开盘收盘价
// ================================================================
router.post('/batch', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { from, to, open, close } = req.body;
  if (!from || !to || !open || !close) {
    return res.status(400).json({ error: '日期范围、开盘价、收盘价必填' });
  }

  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return res.status(400).json({ error: '日期范围无效' });
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO price_plan (time_slot, open, high, low, close, volume, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let totalSlots = 0;
  try {
    const tx = db.transaction(() => {
      const current = new Date(start);
      while (current <= end) {
        const dateStr = toLocalDate(current);
        if (!isWeekend(dateStr)) {
          const slots = tradingSlots(dateStr).filter(isTradingTime);
          const series = generateDaySeries(Number(open), Number(close), slots.length);
          for (let i = 0; i < slots.length; i++) {
            const p = series[i];
            insert.run(slots[i], p.open, p.high, p.low, p.close, p.volume, 'pending', req.user?.id || 1);
            totalSlots++;
          }
        }
        current.setDate(current.getDate() + 1);
      }
    });
    tx();
    res.json({ message: `已生成 ${totalSlots} 个价格计划点`, count: totalSlots });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ================================================================
//  POST /api/price-plan/rebuild-range — 重建历史区间计划并可同步覆盖K线
// ================================================================
router.post('/rebuild-range', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { from, to, days, applyToStockPrices, reason } = req.body as {
    from?: string;
    to?: string;
    applyToStockPrices?: boolean;
    reason?: string;
    days?: Array<{ date: string; open: number; close: number; volUp?: number; volDown?: number; skip?: boolean; high?: number; low?: number; highTime?: string; lowTime?: string }>;
  };

  if (!from || !to) {
    return res.status(400).json({ error: '起始日期和结束日期必填' });
  }
  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: '重建日期列表不能为空' });
  }

  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return res.status(400).json({ error: '日期范围无效' });
  }

  const dayMap = new Map(days.map(day => [day.date, day]));
  const activeDays: Array<{ date: string; open: number; close: number; volUp: number; volDown: number; high?: number; low?: number; highTime?: string; lowTime?: string }> = [];
  const skippedDays: string[] = [];
  const warnings: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dateStr = toLocalDate(current);
    const isWk = isWeekend(dateStr);
    const input = dayMap.get(dateStr);

    if (isWk || input?.skip) {
      skippedDays.push(dateStr);
      current.setDate(current.getDate() + 1);
      continue;
    }

    if (!input) {
      return res.status(400).json({ error: `${dateStr} 缺少重建参数` });
    }

    const open = Number(input.open);
    const close = Number(input.close);
    const volUp = input.volUp !== undefined ? Number(input.volUp) : 1.0;
    const volDown = input.volDown !== undefined ? Number(input.volDown) : 1.0;

    if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(close) || close <= 0) {
      return res.status(400).json({ error: `${dateStr} 的开盘价/收盘价无效` });
    }
    if (!Number.isFinite(volUp) || volUp < 0 || !Number.isFinite(volDown) || volDown < 0) {
      return res.status(400).json({ error: `${dateStr} 的波动参数无效` });
    }

    // 逐日最高/最低价（可选）及出现时间校验
    const high = input.high !== undefined && (input.high as any) !== '' ? Number(input.high) : undefined;
    const low = input.low !== undefined && (input.low as any) !== '' ? Number(input.low) : undefined;
    if (high !== undefined && (!Number.isFinite(high) || high <= 0)) {
      return res.status(400).json({ error: `${dateStr} 的当日最高价无效` });
    }
    if (low !== undefined && (!Number.isFinite(low) || low <= 0)) {
      return res.status(400).json({ error: `${dateStr} 的当日最低价无效` });
    }
    if (high !== undefined && low !== undefined && high < low) {
      return res.status(400).json({ error: `${dateStr} 的当日最高价不能低于最低价` });
    }
    if (high !== undefined && (open > high || close > high)) {
      return res.status(400).json({ error: `${dateStr} 的开盘价/收盘价不能高于当日最高价` });
    }
    if (low !== undefined && (open < low || close < low)) {
      return res.status(400).json({ error: `${dateStr} 的开盘价/收盘价不能低于当日最低价` });
    }

    activeDays.push({ date: dateStr, open, close, volUp, volDown, high, low, highTime: input.highTime, lowTime: input.lowTime });
    current.setDate(current.getDate() + 1);
  }

  if (activeDays.length === 0) {
    return res.status(400).json({ error: '没有可重建的交易日' });
  }

  const planRows = activeDays.flatMap(day => buildSlotsForDay(
    day.date, day.open, day.close, day.volUp, day.volDown,
    { high: day.high, low: day.low, highTime: day.highTime, lowTime: day.lowTime },
  ));
  if (planRows.length === 0) {
    return res.status(400).json({ error: '未生成任何价格计划点' });
  }

  const uniquePlanRows = Array.from(
    new Map(planRows.map(row => [row.time_slot, row])).values()
  );

  if (uniquePlanRows.length !== planRows.length) {
    warnings.push(`检测到 ${planRows.length - uniquePlanRows.length} 个重复时间点，已在重建前自动去重`);
  }

  const deletePlanRange = db.prepare('DELETE FROM price_plan WHERE time_slot >= ? AND time_slot <= ?');
  const deletePlanBySlots = db.prepare(
    `DELETE FROM price_plan WHERE time_slot IN (${uniquePlanRows.map(() => '?').join(', ')})`
  );
  const deleteStockRange = db.prepare('DELETE FROM stock_prices WHERE time_slot >= ? AND time_slot <= ?');
  const deleteStockBySlots = db.prepare(
    `DELETE FROM stock_prices WHERE time_slot IN (${uniquePlanRows.map(() => '?').join(', ')})`
  );
  const insertPlan = db.prepare(
    'INSERT OR REPLACE INTO price_plan (time_slot, open, high, low, close, volume, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    'INSERT INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  try {
    const tx = db.transaction(() => {
      deletePlanRange.run(toRangeStart(from), toRangeEnd(to));
      deletePlanBySlots.run(...uniquePlanRows.map(row => row.time_slot));
      if (applyToStockPrices) {
        deleteStockRange.run(toRangeStart(from), toRangeEnd(to));
        deleteStockBySlots.run(...uniquePlanRows.map(row => row.time_slot));
      }

      for (const row of uniquePlanRows) {
        insertPlan.run(row.time_slot, row.open, row.high, row.low, row.close, row.volume, 'pending', req.user?.id || 1);
        // 只把「已到点」的写进真实 K 线，未来点留给 cron 到点回填，
        // 保证用户行情严格按时间显示、不提前出现未来走势
        if (applyToStockPrices && row.time_slot <= nowSlotStr()) {
          insertStock.run(row.time_slot, row.open, row.high, row.low, row.close, row.volume, req.user?.id || 1);
        }
      }

      logOperation(
        req.user?.id || 0,
        req.user?.username || '',
        'rebuild_price_range',
        JSON.stringify({
          from,
          to,
          tradingDays: activeDays.length,
          skippedDays: skippedDays.length,
          planSlotsRebuilt: uniquePlanRows.length,
          stockSlotsRebuilt: applyToStockPrices ? uniquePlanRows.length : 0,
          applyToStockPrices: !!applyToStockPrices,
          reason: (reason || '').trim(),
        })
      );
    });
    tx();

    if (!applyToStockPrices) {
      warnings.push('本次仅重建价格计划，未同步覆盖真实K线');
    }

    res.json({
      message: `已重建 ${activeDays.length} 个交易日`,
      summary: {
        tradingDays: activeDays.length,
        skippedDays: skippedDays.length,
        planSlotsRebuilt: uniquePlanRows.length,
        stockSlotsRebuilt: applyToStockPrices ? uniquePlanRows.length : 0,
        latestTimeSlotAfterRebuild: getLatestTimeSlot(),
      },
      warnings,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message || '历史重建失败' });
  }
});

router.put('/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const plan = db.prepare('SELECT * FROM price_plan WHERE id = ?').get(req.params.id) as any;
  if (!plan) return res.status(404).json({ error: '不存在' });
  if (plan.status !== 'pending') return res.status(400).json({ error: '已执行或已跳过的计划不可修改' });

  const { open, high, low, close, volume } = req.body;
  db.prepare(
    'UPDATE price_plan SET open=?, high=?, low=?, close=?, volume=? WHERE id=?'
  ).run(
    open ?? plan.open,
    high ?? plan.high,
    low ?? plan.low,
    close ?? plan.close,
    volume ?? plan.volume,
    req.params.id
  );
  res.json({ message: '已更新' });
});

// ================================================================
//  POST /api/price-plan/adjust-smooth — 改某点价格并平滑带动邻域
//  Body: { id, close, window? }  window=单侧影响点数(默认6≈半小时)
//
//  设计：图表读取的是 stock_prices，价格计划存于 price_plan。逐点改价需
//  同时写两张表：
//   - price_plan：始终更新（计划层，后续 cron 据此回填）
//   - stock_prices：仅对「已到点」(time_slot <= 现在) 的点做 upsert，
//     这样可见 K 线立即生效；未来未执行的点不提前写入 stock_prices，
//     避免 /latest 把未来计划价当成实时最新价泄露出去（到点后由 cron 回填）。
//  允许改写任意状态(含 executed/skipped)的点——用于重塑历史走势。
// ================================================================
function nowSlotStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

router.post('/adjust-smooth', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { id, close, window } = req.body;
  const target = db.prepare('SELECT * FROM price_plan WHERE id = ?').get(id) as any;
  if (!target) return res.status(404).json({ error: '该价格点不存在' });

  const newClose = Number(close);
  if (!Number.isFinite(newClose) || newClose <= 0) return res.status(400).json({ error: '价格无效' });

  const W = Math.min(Math.max(Number(window) || 6, 0), 30);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // 取目标点当天的全部计划点（按时间排序）
  const date = target.time_slot.slice(0, 10);
  const day = db.prepare(
    'SELECT * FROM price_plan WHERE time_slot LIKE ? ORDER BY time_slot ASC'
  ).all(`${date}%`) as any[];
  const idx = day.findIndex(p => p.id === target.id);
  if (idx === -1) return res.status(404).json({ error: '定位失败' });

  const delta = newClose - target.close;
  const lo = Math.max(0, idx - W);
  const hi = Math.min(day.length - 1, idx + W);

  // 1. 邻域按余弦权重分摊 delta（中心=1，边缘→0）。改写任意点，不再跳过非 pending。
  const newCloses = day.map(p => p.close);
  for (let j = lo; j <= hi; j++) {
    const dist = Math.abs(j - idx);
    const weight = W === 0 ? (j === idx ? 1 : 0) : (Math.cos((Math.PI * dist) / W) + 1) / 2;
    newCloses[j] = day[j].close + delta * weight;
  }
  newCloses[idx] = newClose; // 中心点钉死为用户输入值

  // 2. 重算受影响点的 OHLC：开盘=上一根收盘（保 K 线连续），保留原振幅特征
  const nowStr = nowSlotStr();
  const updatePlan = db.prepare('UPDATE price_plan SET open=?, high=?, low=?, close=? WHERE id=?');
  const upsertStock = db.prepare(
    'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  let changed = 0;
  let stockSynced = 0;
  const tx = db.transaction(() => {
    for (let j = lo; j <= hi; j++) {
      const c = r2(newCloses[j]);
      const o = j > 0 ? r2(newCloses[j - 1]) : r2(day[0].open);
      const highWick = Math.max(0, day[j].high - Math.max(day[j].open, day[j].close));
      const lowWick = Math.max(0, Math.min(day[j].open, day[j].close) - day[j].low);
      const h = r2(Math.max(o, c) + highWick);
      const l = r2(Math.min(o, c) - lowWick);

      updatePlan.run(o, h, l, c, day[j].id);
      changed++;

      // 已到点的才同步进可见 K 线；未来点留给 cron 回填
      if (day[j].time_slot <= nowStr) {
        upsertStock.run(day[j].time_slot, o, h, l, c, day[j].volume, day[j].created_by || req.user?.id || 1);
        stockSynced++;
      }
    }
  });
  tx();

  try {
    logOperation(req.user!.id, req.user!.username, 'adjust_price_smooth',
      `${target.time_slot} 改为 ${newClose}，平滑带动 ${changed} 个计划点，同步 ${stockSynced} 个K线点`);
  } catch { /* 写操作日志失败不应影响改价结果 */ }
  res.json({ message: `已调整，平滑带动 ${changed} 个点（${stockSynced} 个已同步到K线）`, changed, stockSynced });
});


router.delete('/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const plan = db.prepare('SELECT * FROM price_plan WHERE id = ?').get(req.params.id) as any;
  if (!plan) return res.status(404).json({ error: '不存在' });
  if (plan.status !== 'pending') return res.status(400).json({ error: '已执行的计划不可删除' });
  db.prepare('DELETE FROM price_plan WHERE id = ?').run(req.params.id);
  res.json({ message: '已删除' });
});

// ================================================================
//  POST /api/price-plan/trigger — 手动触发（也供 cron 调用）
// ================================================================
export function triggerPricePlan() {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const pending = db.prepare(
    "SELECT * FROM price_plan WHERE status = 'pending' AND time_slot <= ? ORDER BY time_slot ASC LIMIT 5000"
  ).all(nowStr) as any[];

  const insertPrice = db.prepare(
    'INSERT OR REPLACE INTO stock_prices (time_slot, open, high, low, close, volume, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const markStatus = db.prepare("UPDATE price_plan SET status = ? WHERE id = ?");

  for (const p of pending) {
    // 跳过午休时段
    const slotTime = p.time_slot.split(' ')[1];
    const hh = parseInt(slotTime.split(':')[0], 10);
    const mm = parseInt(slotTime.split(':')[1], 10);
    if (hh === 12 && mm > 0) continue;

    try {
      insertPrice.run(p.time_slot, p.open, p.high, p.low, p.close, p.volume, p.created_by || 1);
      markStatus.run('executed', p.id);
    } catch (e) {
      markStatus.run('skipped', p.id);
    }
  }

  return pending.length;
}

export default router;
