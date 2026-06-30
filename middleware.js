export const config = {
  matcher: '/((?!api/proxy|api/telegram-alert|api/analyze).*)',
};

export default function middleware(req) {
  const url = new URL(req.url);
  const validPassword = process.env.PHARMA_APP_PASSWORD;

  if (!validPassword) return;

  // Check cookie
  const cookie = req.headers.get('cookie') || '';
  const authCookie = cookie.split(';').find(c => c.trim().startsWith('pharma_auth='));
  if (authCookie) {
    const val = authCookie.split('=')[1]?.trim();
    if (val === validPassword) return;
  }

  // Check if submitting password
  if (req.method === 'POST' && url.pathname === '/__auth') {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': `pharma_auth=${validPassword}; Path=/; HttpOnly; SameSite=Strict`,
      },
    });
  }

  // Show login form
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Pharma Signal Monitor</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: Inter, sans-serif; }
    .box { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; width: 100%; max-width: 360px; }
    h1 { color: #f8fafc; font-size: 18px; font-weight: 700; margin-bottom: 6px; }
    p { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    input { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f8fafc; font-size: 14px; margin-bottom: 12px; outline: none; }
    input:focus { border-color: #3b82f6; }
    button { width: 100%; padding: 11px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2563eb; }
    .err { color: #f87171; font-size: 12px; margin-top: 8px; display: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>📊 Pharma Signal Monitor</h1>
    <p>Hedge Fund Intelligence — Private Access</p>
    <form method="POST" action="/__auth">
      <input type="password" name="password" placeholder="Enter password" autofocus />
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}
