import { Router } from 'express';
import { httpGetGBK } from '../utils/http';
import db from '../db';

const router = Router();

// --------------- cache ---------------
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_MS = 4000;

// --------------- 涨速 (5-min rolling) ---------------
const priceSnapshots = new Map<string, { price: number; time: number }[]>();

function calcChgSpeed(code: string, price: number): number {
  let snap = priceSnapshots.get(code);
  if (!snap) { snap = []; priceSnapshots.set(code, snap); }

  const now = Date.now();
  snap.push({ price, time: now });

  // Keep last 5 min
  const cutoff = now - 5 * 60_000;
  while (snap.length && snap[0].time < cutoff) snap.shift();

  // Need at least 60s of history
  if (snap.length < 2) return 0;
  const oldest = snap[0];
  const dt = (now - oldest.time) / 1000;
  if (dt < 60 || oldest.price <= 0) return 0;

  // Actual change over available window (≤5min)
  return Math.round((price - oldest.price) / oldest.price * 100 * 100) / 100;
}

// --------------- 港股列表 (120只) ---------------
const CODES = [
  // === 科技互联网 (11) ===
  '00700', '09988', '09618', '09888', '01024', '03690', '01810',
  '09999', '00772', '01797', '02013',
  // === 金融 (18) ===
  '00388', '00005', '02318', '01299', '01398', '03988', '02628',
  '00011', '02388', '03328', '00939', '01288', '03968', '06837',
  '06030', '01339', '02601', '06060',
  // === 消费 (12) ===
  '09961', '09626', '09633', '01876', '06862', '02020',
  '02331', '02018', '01698', '09899', '09992', '09901',
  // === 医药 (10) ===
  '02269', '01801', '06160', '09926', '01177', '01093', '02196',
  '03320', '06618', '02607',
  // === 汽车 (8) ===
  '01211', '02015', '09868', '09863', '02333', '00175', '02238', '00489',
  // === 地产 (12) ===
  '00016', '01109', '00688', '00017', '00960', '02007', '00083',
  '00101', '00012', '00004', '00683', '00823',
  // === 能源 (8) ===
  '00883', '00857', '00386', '01088', '02899', '01171', '01899', '01378',
  // === 电信 (4) ===
  '00728', '00762', '00788', '00941',
  // === 公用事业 (6) ===
  '00002', '00003', '00006', '00066', '01038', '02638',
  // === 工业基建 (8) ===
  '00669', '00144', '00152', '00267', '00358', '01186', '01800', '01898',
  // === 博彩娱乐 (6) ===
  '01928', '00880', '01128', '02282', '00027', '06883',
  // === 食品饮料 (7) ===
  '00291', '00168', '00322', '00151', '00220', '01458', '01044',
  // === 综合 (6) ===
  '00001', '01347', '00981', '00179', '00019', '00008',
  // === 服饰零售 (4) ===
  '01929', '00590', '06110', '01368',
];

// --------------- 腾讯为主源（新浪对海外/云机房返回 Forbidden，不可用） ---------------
// 腾讯港股字段(~分隔): [1]名 [3]现价 [4]昨收 [5]今开 [6]量 [32]涨跌 [33]涨跌幅
//                      [34]高 [35]低 [37]额 [38]换手 [39]PE [43]振幅 [44]流通市值(亿) [45]总市值(亿) [49]量比
async function fetchTencent(): Promise<any[]> {
  const text = await httpGetGBK(
    `https://qt.gtimg.cn/q=${CODES.map((c) => `hk${c}`).join(',')}`,
    'https://gu.qq.com',
  );
  const results: any[] = [];
  for (const code of CODES) {
    const re = new RegExp(`v_hk${code}="([^"]*)"`);
    const m = re.exec(text);
    if (!m) continue;
    const f = m[1].split('~');
    if (f.length < 34) continue;

    const p = (i: number) => parseFloat(f[i]) || 0;
    const price = p(3);
    const open  = p(5);
    const high  = p(34);
    const low   = p(35);

    results.push({
      code,
      name:        f[1] || code,
      price,
      open,
      high,
      low,
      change:      p(32),
      changePct:   p(33),
      chgSpeed:    calcChgSpeed(code, price),
      turnover:    p(38) > 0 ? p(38) : 0,
      volRatio:    p(49) > 0 ? p(49) : 0,
      amplitude:   p(43) > 0 ? p(43) : (open > 0 ? Math.round((high - low) / open * 100 * 100) / 100 : 0),
      volume:      p(6),
      amount:      p(37) || 0,
      floatCap:    p(44) > 0 ? Math.round(p(44) * 1e8) : 0,
      pe:          p(39),
    });
  }
  return results;
}

// --------------- route ---------------
router.get('/hklist', async (_req, res) => {
  const cached = cache.get('hklist');
  if (cached && Date.now() - cached.ts < CACHE_MS) return res.json(cached.data);

  try {
    const results = await fetchTencent();
    if (results.length > 0) {
      results.sort((a: any, b: any) => a.code.localeCompare(b.code));

      // 注入 02110.HK 天成控股（内部标的，置顶）
      try {
        const latest = db.prepare('SELECT open, high, low, close, volume FROM stock_prices ORDER BY time_slot DESC, id DESC LIMIT 1').get() as any;
        if (latest) {
          const prev = db.prepare('SELECT close FROM stock_prices ORDER BY time_slot DESC, id DESC LIMIT 1 OFFSET 1').get() as any;
          const change = prev ? (latest.close - prev.close) : 0;
          const changePct = prev ? ((change / prev.close) * 100) : 0;
          results.unshift({
            code: '02110',
            name: '天成控股',
            price: latest.close,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            change: Math.round(change * 100) / 100,
            changePct: Math.round(changePct * 100) / 100,
            chgSpeed: 0,
            turnover: 0,
            volRatio: 0,
            amplitude: latest.open > 0 ? Math.round(((latest.high - latest.low) / latest.open * 100) * 100) / 100 : 0,
            volume: latest.volume,
            amount: Math.round(latest.close * latest.volume * 100) / 100,
            floatCap: 0,
            pe: 0,
          });
        }
      } catch {}

      cache.set('hklist', { data: results, ts: Date.now() });
      return res.json(results);
    }
  } catch (err: any) {
    if (cached) return res.json(cached.data);
    return res.status(502).json({ error: '行情获取失败', detail: err.message });
  }

  if (cached) return res.json(cached.data);
  res.json([]);
});

export default router;
