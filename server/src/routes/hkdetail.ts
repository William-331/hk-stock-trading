import { Router } from 'express';
import { httpGetGBK, httpGetJSON } from '../utils/http';

const router = Router();

// --------------- cache ---------------
const cache = new Map<string, { data: any; ts: number }>();
function cached(key: string, ms: number): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ms) return entry.data;
  return null;
}
function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

// ================================================================
//  GET /api/hk/quote/:code
//  Real-time quote: Sina (OHLCV + bid/ask) + Tencent (PE/turnover/volRatio)
// ================================================================
router.get('/quote/:code', async (req, res) => {
  const code = req.params.code;
  const ck = `quote_${code}`;
  const hit = cached(ck, 3000);
  if (hit) return res.json(hit);

  try {
    // 1. Sina — OHLCV + bid/ask
    const sinaText = await httpGetGBK(
      `https://hq.sinajs.cn/list=hk${code}`,
      'https://finance.sina.com.cn',
    );
    const re = new RegExp(`hk${code}[^"]*"([^"]*)"`);
    const m = re.exec(sinaText);
    if (!m) return res.status(404).json({ error: '未找到该股票' });

    const f = m[1].split(',');
    const sp = (i: number) => parseFloat(f[i]) || 0;

    const result: any = {
      code,
      name: f[1] || code,
      price: sp(6),
      open: sp(2),
      prevClose: sp(3),
      high: sp(4),
      low: sp(5),
      change: sp(7),
      changePct: sp(8),
      bid: sp(9),
      ask: sp(10),
      amount: sp(11),
      volume: parseInt(f[12]) || 0,
      turnover: 0,
      volRatio: 0,
      amplitude: 0,
      pe: 0,
      floatCap: 0,
      week52High: 0,
      week52Low: 0,
      totalCap: 0,
    };
    // 52-week high/low from Sina — f[15]=高, f[16]=低
    if (f.length > 15) result.week52High = sp(15);
    if (f.length > 16) result.week52Low = sp(16);

    // 2. Tencent — enrichment
    try {
      const tText = await httpGetGBK(
        `https://qt.gtimg.cn/q=hk${code}`,
        'https://gu.qq.com',
      );
      const tRe = new RegExp(`hk${code}[^"]*"([^"]*)"`);
      const tM = tRe.exec(tText);
      if (tM) {
        const tf = tM[1].split('~');
        const tp = (i: number) => parseFloat(tf[i]) || 0;
        if (tp(39) > 0) result.turnover = tp(39);
        if (tp(50) > 0) result.volRatio = tp(50);
        if (tp(43) > 0) result.amplitude = tp(43);
        if (tp(37) > 0) result.amount = tp(37);
        if (tp(64)) result.pe = tp(64);
        if (tp(69) > 0) result.totalCap = Math.round(result.price * tp(69));
        const floatShares = tp(69);
        if (floatShares > 0) result.floatCap = Math.round(result.price * floatShares);
      }
    } catch {
      // Tencent failed — keep Sina data
    }

    setCache(ck, result);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: '行情获取失败', detail: err.message });
  }
});

// ================================================================
//  GET /api/hk/kline/:code?period=day|week|month
//  Tencent HTTPS K-line (前复权)
// ================================================================
router.get('/kline/:code', async (req, res) => {
  const code = req.params.code;
  const period = (req.query.period as string) || 'day';
  const ck = `kline_${code}_${period}`;
  const hit = cached(ck, 300_000); // 5 min cache
  if (hit) return res.json(hit);

  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hk${code},${period},,,320,qfq`;
    const data = await httpGetJSON(url, 'https://gu.qq.com');

    if (data.code !== 0 || !data.data?.[`hk${code}`]) {
      return res.status(502).json({ error: 'K线数据获取失败' });
    }

    const stockData = data.data[`hk${code}`];
    // Period key may be "day", "week", "month", or "qfqday", "qfqweek", "qfqmonth"
    const raw =
      stockData[`qfq${period}`] ||
      stockData[period] ||
      stockData[period.toLowerCase()] ||
      [];

    // Convert to standard OHLCV format
    // Tencent format: [date, open, close, high, low, volume, ...extra]
    const candles = raw
      .filter((r: any) => Array.isArray(r) && r.length >= 6)
      .map((r: any[]) => ({
        time: r[0], // "2025-02-21"
        open: parseFloat(r[1]) || 0,
        close: parseFloat(r[2]) || 0,
        high: parseFloat(r[3]) || 0,
        low: parseFloat(r[4]) || 0,
        volume: parseFloat(r[5]) || 0,
      }));

    setCache(ck, candles);
    res.json(candles);
  } catch (err: any) {
    res.status(502).json({ error: 'K线获取失败', detail: err.message });
  }
});

// ================================================================
//  GET /api/hk/intraday/:code
//  Tencent minute-by-minute data for today
// ================================================================
router.get('/intraday/:code', async (req, res) => {
  const code = req.params.code;
  const ck = `intraday_${code}`;
  const hit = cached(ck, 30_000); // 30s cache
  if (hit) return res.json(hit);

  try {
    const url = `https://ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=hk${code}`;
    const text = await httpGetGBK(url, 'https://gu.qq.com');

    // Response format: min_data={...}
    const jsonStr = text.replace(/^min_data=/, '').trim();
    const data = JSON.parse(jsonStr);

    if (data.code !== 0 || !data.data?.[`hk${code}`]?.data?.data) {
      return res.status(502).json({ error: '分时数据获取失败' });
    }

    const raw = data.data[`hk${code}`].data.data as string[];
    // Each entry: "HHMM price volume amount"
    const points = raw.map((s: string) => {
      const [time, price, vol, amt] = s.split(' ');
      return {
        time, // "0930"
        price: parseFloat(price) || 0,
        volume: parseInt(vol) || 0,
        amount: parseFloat(amt) || 0,
      };
    });

    // Also extract prevClose from the quote data if available
    let prevClose = 0;
    try {
      const qt = data.data[`hk${code}`].qt;
      if (qt && Array.isArray(qt) && qt.length > 4) {
        prevClose = parseFloat(qt[4]) || 0;
      }
    } catch {}

    setCache(ck, { points, prevClose });
    res.json({ points, prevClose });
  } catch (err: any) {
    res.status(502).json({ error: '分时获取失败', detail: err.message });
  }
});

// ================================================================
//  GET /api/hk/news
//  Sina HK stock news (general)
// ================================================================
router.get('/news', async (_req, res) => {
  const ck = 'hk_news';
  const hit = cached(ck, 600_000); // 10 min cache
  if (hit) return res.json(hit);

  try {
    const data = await httpGetJSON(
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=15&page=1',
      'https://finance.sina.com.cn',
    );

    if (data.result?.status?.code !== 0) {
      return res.status(502).json({ error: '新闻获取失败' });
    }

    const news = (data.result.data || []).map((item: any) => ({
      title: item.title || '',
      url: item.url || '',
      time: item.ctime ? new Date(parseInt(item.ctime) * 1000).toISOString() : '',
      source: item.media_name || item.source || '新浪财经',
    }));

    setCache(ck, news);
    res.json(news);
  } catch (err: any) {
    res.status(502).json({ error: '新闻获取失败', detail: err.message });
  }
});

export default router;
