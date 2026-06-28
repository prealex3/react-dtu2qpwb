// Vercel Serverless Function — /api/proxy.js
// Proxies EMA and FDA requests to bypass CORS
// Deploy: just commit this file to repo root /api/proxy.js

export const config = {
    runtime: 'edge',
  };
  
  const ALLOWED_ORIGINS = [
    'https://www.ema.europa.eu',
    'https://api.fda.gov',
  ];
  
  export default async function handler(req) {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
  
    // Security: only allow whitelisted origins
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  
    const isAllowed = ALLOWED_ORIGINS.some(origin => target.startsWith(origin));
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  
    try {
      const response = await fetch(target, {
        headers: {
          'User-Agent': 'PharmaSignalMonitor/1.0',
          'Accept': 'application/json',
        },
      });
  
      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Upstream error: ${response.status}` }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
  
      const data = await response.text();
  
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Cache-Control': 'public, s-maxage=1800', // cache 30 min on Vercel edge
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }