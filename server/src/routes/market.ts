import { Router } from 'express';
import { httpGetGBK } from '../utils/http';

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
// 腾讯港股字段(~分隔)的尾部字段位置会随接口版本整体平移，故以「成交时间戳」(YYYY/MM/DD HH:MM:SS)
// 为锚点按相对偏移取值，避免硬编码下标因平移而错位。
// 头部字段位置稳定: [1]名 [3]现价 [4]昨收 [5]今开 [6]量。
// 相对时间戳 T 的偏移: +1涨跌 +2涨跌幅 +3最高 +4最低 +7成交额 +9市盈率 +13振幅
//                      +14流通市值(亿) +15总市值(亿) +18=52周高 +19=52周低 +20量比 +29换手率
function parseTencentHK(f: string[]): {
  T: number;
  price: number; prevClose: number; open: number; volume: number;
  bid: number; ask: number;
} | null {
  if (f.length < 32) return null;
  const T = f.findIndex((x) => /^\d{4}\/\d{2}\/\d{2}\s/.test(x));
  if (T < 0 || f.length < T + 30) return null;
  const p = (i: number) => parseFloat(f[i]) || 0;
  return { T, price: p(3), prevClose: p(4), open: p(5), volume: p(6), bid: p(9), ask: p(19) };
}

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
    const base = parseTencentHK(f);
    if (!base) continue;

    const { T, price, open } = base;
    const p = (i: number) => parseFloat(f[i]) || 0;
    const high = p(T + 3);
    const low  = p(T + 4);

    results.push({
      code,
      name:        f[1] || code,
      price,
      open,
      high,
      low,
      change:      p(T + 1),
      changePct:   p(T + 2),
      chgSpeed:    calcChgSpeed(code, price),
      turnover:    p(T + 29) > 0 ? p(T + 29) : 0,
      volRatio:    p(T + 20) > 0 ? p(T + 20) : 0,
      amplitude:   p(T + 13) > 0 ? p(T + 13) : (open > 0 ? Math.round((high - low) / open * 100 * 100) / 100 : 0),
      volume:      base.volume,
      amount:      p(T + 7) || 0,
      floatCap:    p(T + 14) > 0 ? Math.round(p(T + 14) * 1e8) : 0,
      pe:          p(T + 9),
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
