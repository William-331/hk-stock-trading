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
      chgSpeed:    0,   // Sina 不提供
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

// --------------- EastMoney (enrich with extra fields) ---------------
async function enrichEastMoney(results: any[]): Promise<void> {
  try {
    const secids = CODES.map((c) => `116.${c}`).join(',');
    const fields = 'f57,f168,f167,f50,f48,f117,f162,f171';
    const json = await httpGetJSON(
      `https://push2.eastmoney.com/api/qt/stock/get?secids=${secids}&fields=${fields}`,
      'https://quote.eastmoney.com',
    );
    const diff = json?.data?.diff;
    if (!Array.isArray(diff)) return;

    const map = new Map(diff.map((d: any) => [d.f57, d]));
    for (const r of results) {
      const d = map.get(r.code);
      if (!d) continue;
      if (d.f168) r.chgSpeed  = (d.f168 || 0) / 100;
      if (d.f167) r.turnover  = (d.f167 || 0) / 100;
      if (d.f50)  r.volRatio  = (d.f50  || 0) / 100;
      if (d.f48)  r.amount    = d.f48 || r.amount;
      if (d.f117) r.floatCap  = d.f117 || 0;
      if (d.f162) r.pe        = d.f162 || 0;
      if (d.f171) r.floatShares = d.f171 || 0;
    }
  } catch {
    // EastMoney failed → keep Sina data as-is
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
      // Try EastMoney enrichment (non-blocking, fast timeout handled inside)
      enrichEastMoney(results).catch(() => {});

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
