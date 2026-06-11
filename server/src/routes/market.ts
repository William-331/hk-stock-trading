import { Router } from 'express';
import https from 'https';
import http from 'http';

const router = Router();

// --------------- http ---------------
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      { headers: { Referer: 'https://quote.eastmoney.com', 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// --------------- cache ---------------
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_MS = 4000;

// --------------- single-stock fetch ---------------
const CODES = [
  '00700', '09988', '00388', '00941', '00005',
  '01810', '02318', '01299', '03690', '00981',
  '02269', '01024', '01347', '02015', '09618',
];

const FIELDS = 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f116,f117,f162,f167,f168,f169,f170,f171';

async function fetchOne(code: string): Promise<any | null> {
  try {
    const raw = await httpGet(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=116.${code}&fields=${FIELDS}`,
    );
    const json = JSON.parse(raw);
    const d = json?.data;
    if (!d || !d.f57) return null;

    const price   = (d.f43 || 0) / 1000;
    const open    = (d.f46 || 0) / 1000;
    const high    = (d.f44 || 0) / 1000;
    const low     = (d.f45 || 0) / 1000;
    const ampl    = open > 0 ? ((high - low) / open * 100) : 0;

    return {
      code:        d.f57,                       // 代码
      name:        d.f58,                       // 名称
      price,                                    // 最新价 (HKD)
      open,                                     // 今开
      high,                                     // 最高
      low,                                      // 最低
      change:      (d.f169 || 0) / 1000,        // 涨跌额
      changePct:   (d.f170 || 0) / 100,         // 涨跌幅(%) — raw / 100
      chgSpeed:    (d.f168 || 0) / 100,         // 涨速(%)  — raw / 100
      turnover:    (d.f167 || 0) / 100,         // 换手率(%) — raw / 100
      volRatio:    (d.f50  || 0) / 100,         // 量比      — raw / 100
      amplitude:   Math.round(ampl * 100) / 100,// 振幅(%)
      volume:      d.f47 || 0,                  // 成交量(股)
      amount:      d.f48 || 0,                  // 成交额(HKD)
      floatCap:    d.f117 || 0,                 // 流通市值(HKD)
      pe:          d.f162 || 0,                 // 市盈率
    };
  } catch {
    return null;
  }
}

// --------------- route ---------------
router.get('/hklist', async (_req, res) => {
  const cached = cache.get('hklist');
  if (cached && Date.now() - cached.ts < CACHE_MS) return res.json(cached.data);

  try {
    const results = (await Promise.all(CODES.map(fetchOne))).filter(Boolean);
    if (results.length === 0) {
      if (cached) return res.json(cached.data);
      return res.json([]);
    }
    results.sort((a: any, b: any) => a.code.localeCompare(b.code));
    cache.set('hklist', { data: results, ts: Date.now() });
    res.json(results);
  } catch (err: any) {
    if (cached) return res.json(cached.data);
    res.status(502).json({ error: '行情获取失败', detail: err.message });
  }
});

export default router;
