import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// ================================================================
// 工具：生成某个交易日所有5分钟时间点（9:30-12:00, 13:00-16:00）
// ================================================================
function tradingSlots(dateStr: string): string[] {
  const slots: string[] = [];
  // 上午 9:30 - 12:00（含）
  for (let h = 9; h < 12; h++) {
    const startM = h === 9 ? 30 : 0;
    for (let m = startM; m < 60; m += 5) {
      if (h === 11 && m > 55) continue; // 12:00 是最后一个
      slots.push(`${dateStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  // 12:00
  slots.push(`${dateStr} 12:00`);
  // 下午 13:00 - 16:00（含）
  for (let h = 13; h <= 16; h++) {
    const endM = h === 16 ? 5 : 60; // 16:00 后到 16:05 结束（含16:00）
    for (let m = 0; m < endM; m += 5) {
      slots.push(`${dateStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

// 判断是否周末
function isWeekend(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

// 判断时间是否在交易时段外（午休12:00-13:00可以存12:00，跳过12:05-12:55）
function isTradingTime(timeStr: string): boolean {
  const hh = parseInt(timeStr.split(' ')[1].split(':')[0], 10);
  const mm = parseInt(timeStr.split(' ')[1].split(':')[1], 10);
  if (hh === 12 && mm > 0) return false; // 12:05-12:55 跳过
  return true;
}

// 生成价格：从 open 到 close 平滑过渡 + 波动区间内随机
// volUp: 上涨百分比上限（如1.0 = +1%）  volDown: 下跌百分比下限（如2.0 = -2%）
function generatePrice(openPrice: number, closePrice: number, index: number, total: number, volUp = 1.0, volDown = 1.0) {
  const ratio = total > 1 ? index / (total - 1) : 0;
  const base = openPrice + (closePrice - openPrice) * ratio;
  // 在波动区间内随机
  const maxUp = base * (volUp / 100);
  const maxDown = base * (volDown / 100);
  const noise = (Math.random() * (maxUp + maxDown)) - maxDown;
  const c = Math.round((base + noise) * 100) / 100;
  const o = Math.round((base + (Math.random() - 0.5) * (maxUp + maxDown) * 0.5) * 100) / 100;
  const h = Math.round(Math.max(o, c) * (1 + volUp / 200) * 100) / 100;
  const l = Math.round(Math.min(o, c) * (1 - volDown / 200) * 100) / 100;
  const v = Math.floor(Math.random() * 5000) + 2000;
  return { open: o, high: h, low: l, close: c, volume: v };
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

function buildSlotsForDay(date: string, open: number, close: number, volUp = 1.0, volDown = 1.0) {
  const slots = tradingSlots(date).filter(isTradingTime);
  return slots.map((timeSlot, index) => ({
    time_slot: timeSlot,
    ...generatePrice(open, close, index, slots.length, volUp, volDown),
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
router.post('/daily', requireAuth, (req: Request, res: Response) => {
  const { date, open, close, volUp, volDown } = req.body;
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

  const insert = db.prepare(
    'INSERT OR REPLACE INTO price_plan (time_slot, open, high, low, close, volume, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  try {
    const tx = db.transaction(() => {
      for (let i = 0; i < slots.length; i++) {
        const p = generatePrice(Number(open), Number(close), i, slots.length, up, down);
        insert.run(slots[i], p.open, p.high, p.low, p.close, p.volume, 'pending', req.user?.id || 1);
      }
    });
    tx();
    res.json({ message: `已生成 ${slots.length} 个价格计划点`, count: slots.length });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ================================================================
//  POST /api/price-plan/batch — 批量设定日期范围
//  Body: { from, to, open, close }   // 每日统一开盘收盘价
// ================================================================
router.post('/batch', requireAuth, (req: Request, res: Response) => {
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
        const dateStr = current.toISOString().slice(0, 10);
        if (!isWeekend(dateStr)) {
          const slots = tradingSlots(dateStr).filter(isTradingTime);
          for (let i = 0; i < slots.length; i++) {
            const p = generatePrice(Number(open), Number(close), i, slots.length);
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
    days?: Array<{ date: string; open: number; close: number; volUp?: number; volDown?: number; skip?: boolean }>;
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
  const activeDays: Array<{ date: string; open: number; close: number; volUp: number; volDown: number }> = [];
  const skippedDays: string[] = [];
  const warnings: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
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

    activeDays.push({ date: dateStr, open, close, volUp, volDown });
    current.setDate(current.getDate() + 1);
  }

  if (activeDays.length === 0) {
    return res.status(400).json({ error: '没有可重建的交易日' });
  }

  const planRows = activeDays.flatMap(day => buildSlotsForDay(day.date, day.open, day.close, day.volUp, day.volDown));
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
        if (applyToStockPrices) {
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

router.put('/:id', requireAuth, (req: Request, res: Response) => {
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
//  DELETE /api/price-plan/:id — 删除单个计划
// ================================================================
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
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
    "SELECT * FROM price_plan WHERE status = 'pending' AND time_slot <= ? ORDER BY time_slot ASC LIMIT 50"
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
