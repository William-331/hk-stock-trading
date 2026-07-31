import db from '../db';

export const VALUATION_TIME_ZONE = 'Asia/Shanghai';
export const SLOT_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]';
export const TRADING_HOURS_SQL =
  "((substr(time_slot,12,5) >= '09:00' AND substr(time_slot,12,5) <= '12:00') " +
  "OR (substr(time_slot,12,5) >= '13:00' AND substr(time_slot,12,5) <= '16:10'))";
export const VALID_SLOT_SQL = `time_slot GLOB ? AND ${TRADING_HOURS_SQL} AND time_slot <= ?`;

export interface EffectiveValuation {
  id: number;
  value: number;
  timeSlot: string;
}

export function shanghaiNowSlot(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VALUATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

export function getLatestEffectiveValuation(now = shanghaiNowSlot()): EffectiveValuation | null {
  const row = db.prepare(
    `SELECT id, close, time_slot
     FROM stock_prices
     WHERE ${VALID_SLOT_SQL} AND close > 0
     ORDER BY time_slot DESC, id DESC
     LIMIT 1`
  ).get(SLOT_GLOB, now) as { id: number; close: number; time_slot: string } | undefined;

  if (!row) return null;
  const value = Number(row.close);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { id: row.id, value, timeSlot: row.time_slot };
}
