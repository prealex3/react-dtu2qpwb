// Vercel Middleware — /middleware.js (must be in project ROOT, same level as src/)
// Adds simple password protection to the entire app.
// Set PHARMA_APP_PASSWORD in Vercel Environment Variables.

export const config = {
    matcher: '/((?!api/proxy|api/telegram-alert).*)', // protect everything EXCEPT the API endpoints (cron needs unauthenticated access)
  };
  
  export default function middleware(req) {
    const auth = req.headers.get('authorization');
    const validPassword = process.env.PHARMA_APP_PASSWORD;
  
    if (!validPassword) {
      // If no password is set, allow access (fail open so you're never locked out by mistake)
      return;
    }
  
    if (auth) {
      const [scheme, encoded] = auth.split(' ');
      if (scheme === 'Basic' && encoded) {
        const decoded = atob(encoded);
        const [, password] = decoded.split(':');
        if (password === validPassword) {
          return; // access granted
        }
      }
    }
  
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Pharma Signal Monitor — Private"',
      },
    });
  }