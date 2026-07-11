// Netlify Function — /netlify/functions/proxy.js
// Proxies EMA and FDA requests server-side to bypass browser CORS.
// EMA intermittently returns 401/403/500 due to bot-detection — this version
// retries with slightly varied headers and a short backoff before giving up.
//
// Netlify Functions (v2 format): default export receives a standard Request,
// returns a standard Response — same API surface as Vercel Edge, so the core
// logic is unchanged. Only the export signature differs.

const ALLOWED_ORIGINS = [
  'https://www.ema.europa.eu',
  'https://api.fda.gov',
];

const BROWSER_PROFILES = [
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.ema.europa.eu/en/medicines',
    'Origin': 'https://www.ema.europa.eu',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
  },
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Accept': 'application/json',
    'Accept-Language': 'en-GB,en;q=0.8',
    'Referer': 'https://www.ema.europa.eu/',
    'Cache-Control': 'no-cache',
  },
];

async function fetchWithRetry(target, attempts = 2) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const profile = BROWSER_PROFILES[i % BROWSER_PROFILES.length];
      const response = await fetch(target, { method: 'GET', headers: profile });
      if (response.ok) return response;
      lastError = { status: response.status, statusText: response.statusText };
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      lastError = { status: 0, statusText: e.message };
    }
  }
  return { ok: false, status: lastError?.status || 500, statusText: lastError?.statusText || 'unknown' };
}

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isAllowed = ALLOWED_ORIGINS.some(origin => target.startsWith(origin));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const response = await fetchWithRetry(target, 2);

  if (!response.ok) {
    return new Response(
      JSON.stringify({
        error: `Upstream error: ${response.status}`,
        url: target,
        note: 'EMA intermittently rate-limits/bot-blocks. Retry in a few minutes if this persists.',
      }),
      {
        status: response.status || 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  const data = await response.text();

  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
    },
  });
};
