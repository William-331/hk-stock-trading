import { Router } from 'express';
import https from 'https';
import http from 'http';

const router = Router();

// --------------- http ---------------
function httpGetBuffer(url: string, referer: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      { headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// GBK-aware fetch for Sina
async function httpGetGBK(url: string, referer: string): Promise<string> {
  const buf = await httpGetBuffer(url, referer);
  try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString(); }
}

// UTF-8 fetch for EastMoney
async function httpGetJSON(url: string, referer: string): Promise<any> {
  const buf = await httpGetBuffer(url, referer);
  return JSON.parse(buf.toString('utf8'));
}

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

// --------------- stocks ---------------
const CODES = [
  '00700', '09988', '00388', '00941', '00005',
  '01810', '02318', '01299', '03690', '00981',
  '02269', '01024', '01347', '02015', '09618',
];

// --------------- Sina (reliable, basic fields) ---------------
async function fetchSina(): Promise<any[]> {
  const text = await httpGetGBK(
    `https://hq.sinajs.cn/list=${CODES.map((c) => `hk${c}`).join(',')}`,
    'https://finance.sina.com.cn',
  );
  const results: any[] = [];
  for (const code of CODES) {
    const re = new RegExp(`hk${code}[^"]*"([^"]*)"`, 'g');
    const m = re.exec(text);
    if (!m) continue;
    const f = m[1].split(',');
    if (f.length < 12) continue;

    const p = (i: number) => parseFloat(f[i]) || 0;
    const price = p(6);
    const open  = p(2);
    const high  = p(4);
    const low   = p(5);
    const ampl  = open > 0 ? ((high - low) / open * 100) : 0;

    results.push({
      code,
      name:        f[1] || f[0] || code,
      price,
      open,
      high,
      low,
      change:      p(7),
      changePct:   p(8),
      chgSpeed:    calcChgSpeed(code, price),
      turnover:    0,
      volRatio:    0,
      amplitude:   Math.round(ampl * 100) / 100,
      volume:      parseInt(f[11]) || 0,
      amount:      p(12) || 0,
      floatCap:    0,
      pe:          0,
    });
  }
  return results;
}

// --------------- Tencent enrichment ---------------
// Fields: f37=成交额 f39=换手率% f43=振幅% f50=量比 f64=市盈率 f69=流通股本
async function enrichTencent(results: any[]): Promise<void> {
  try {
    const text = await httpGetGBK(
      `https://qt.gtimg.cn/q=${CODES.map((c) => `hk${c}`).join(',')}`,
      'https://gu.qq.com',
    );
    for (const r of results) {
      const re = new RegExp(`hk${r.code}[^"]*"([^"]*)"`, 'g');
      const m = re.exec(text);
      if (!m) continue;
      const f = m[1].split('~');
      if (f.length < 70) continue;
      const p = (i: number) => parseFloat(f[i]) || 0;
      const floatShares = p(69);
      if (p(39) > 0)  r.turnover  = p(39);
      if (p(50) > 0)  r.volRatio  = p(50);
      if (p(43) > 0)  r.amplitude = p(43);
      if (p(37) > 0)  r.amount    = p(37);
      if (p(64))      r.pe        = p(64);
      if (floatShares > 0) r.floatCap = Math.round(r.price * floatShares);
    }
  } catch {
    // Tencent failed → keep Sina data as-is
  }
}

// --------------- route ---------------
router.get('/hklist', async (_req, res) => {
  const cached = cache.get('hklist');
  if (cached && Date.now() - cached.ts < CACHE_MS) return res.json(cached.data);

  try {
    const results = await fetchSina();
    if (results.length > 0) {
      results.sort((a: any, b: any) => a.code.localeCompare(b.code));
      await enrichTencent(results);
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
