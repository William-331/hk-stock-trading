import https from 'https';
import http from 'http';

/**
 * Fetch raw buffer from URL. Auto-detects http/https.
 */
export function httpGetBuffer(url: string, referer: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      {
        headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
      },
      (res) => {
        // Follow redirects (301/302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (loc) {
            const mod2 = loc.startsWith('https') ? https : http;
            mod2.get(
              loc,
              {
                headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
              },
              (res2) => {
                const chunks: Buffer[] = [];
                res2.on('data', (c: Buffer) => chunks.push(c));
                res2.on('end', () => resolve(Buffer.concat(chunks)));
              },
            ).on('error', reject);
            return;
          }
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/**
 * Fetch URL and decode as GBK (for Sina, Tencent Chinese APIs).
 */
export async function httpGetGBK(url: string, referer: string): Promise<string> {
  const buf = await httpGetBuffer(url, referer);
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString();
  }
}

/**
 * Fetch URL and parse as JSON (UTF-8).
 */
export async function httpGetJSON(url: string, referer: string): Promise<any> {
  const buf = await httpGetBuffer(url, referer);
  return JSON.parse(buf.toString('utf8'));
}
