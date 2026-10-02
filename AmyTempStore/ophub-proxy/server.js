// server.js
// Minimal reverse proxy between browser-hosted Aetherium and a real Operations
// Hub instance — exists purely to solve two things the browser can't do itself:
//   1. Attach OpHub's session cookie (OpHub authenticates via cookies, not a
//      bearer token — see .env.example for how to obtain one).
//   2. Add an Access-Control-Allow-Origin header, since OpHub's own responses
//      don't include one (confirmed by inspecting a real request — no CORS
//      header present, so a cross-origin browser fetch is blocked outright).
//
// DELIBERATELY DUMB BY DESIGN: this does NOT parse, validate, or reshape the
// request body. Whatever bytes + Content-Type Aetherium sends are forwarded to
// OpHub byte-for-byte. That's a safety choice — we captured OpHub's real
// request shape via DevTools, but DevTools' "Payload" view pretty-prints
// application/x-www-form-urlencoded bodies, so the EXACT wire-level encoding
// isn't 100% certain from that alone. Rather than guess and risk silently
// corrupting the request, this proxy stays a transparent pass-through and lets
// the caller (Aetherium's REST resolver) own getting the body format right.
//
// DEMO-GRADE AUTH — NOT PRODUCTION READY:
// The session cookie is read from an environment variable and attached to
// every forwarded request. There's no login flow, no token refresh, no
// per-user session handling. This is intentionally the fastest path to a
// working demo today, not a real auth architecture — flagging clearly so this
// isn't mistaken for something more finished than it is.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 4000;
const OPHUB_BASE_URL = process.env.OPHUB_BASE_URL || 'https://mes.gedemo.io';
const OPHUB_COOKIE = process.env.OPHUB_COOKIE || '';
// The "site" management layer (/site/ajax/*, e.g. flow discovery) uses a
// DIFFERENT cookie set than the "app" runtime layer (/app/ajax/*, e.g. query
// execution) — confirmed by comparing two real captured requests: the site
// layer's cookie included IQP_SITE and ssm_au_c, the runtime layer's did not
// (had ssm_au_d instead). A cookie captured from a runtime page won't
// naturally include IQP_SITE due to cookie path scoping, even in the same
// browser session. Falls back to OPHUB_COOKIE if not set separately, in case
// your environment doesn't actually need the distinction.
const OPHUB_SITE_COOKIE = process.env.OPHUB_SITE_COOKIE || OPHUB_COOKIE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
// Same-origin request validation (Referer/Origin checks) is common alongside
// cookie-based session auth. Our proxy's outgoing fetch doesn't naturally set
// these the way a real browser page navigating within OpHub would — this is
// the one thing that's stayed constant across every failed attempt so far
// (we've now ruled out body encoding and account_id/flowInstanceId as the
// cause), so it's the next thing worth testing directly.
const OPHUB_ORIGIN = process.env.OPHUB_ORIGIN || OPHUB_BASE_URL;
const OPHUB_REFERER = process.env.OPHUB_REFERER || `${OPHUB_BASE_URL}/`;

if (!OPHUB_COOKIE) {
  console.warn(
    '[ophub-proxy] WARNING: OPHUB_COOKIE is not set in .env — every forwarded ' +
    'request will be unauthenticated and OpHub will likely reject it. ' +
    'See .env.example for how to obtain a cookie value from your own browser session.'
  );
}

app.use(cors({ origin: ALLOWED_ORIGIN }));

// Capture the raw request body regardless of Content-Type, unparsed — see the
// "DELIBERATELY DUMB" note above for why.
app.use(express.raw({ type: '*/*', limit: '5mb' }));

// Simple sanity check — hit this first to confirm the proxy itself is up
// before worrying about whether OpHub calls are working.
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ophubBaseUrl: OPHUB_BASE_URL,
    cookieConfigured: !!OPHUB_COOKIE,
    siteCookieConfigured: !!OPHUB_SITE_COOKIE,
    siteCookieIsSameAsRuntime: OPHUB_SITE_COOKIE === OPHUB_COOKIE,
  });
});

// Shared forwarding logic — used by both /api/ophub/query (execute one known
// flow) and /api/ophub/flows (list every flow available, powering the Queries
// workspace's "Sync from OpHub" feature). Same dumb-passthrough philosophy:
// this function doesn't know or care what upstream path it's hitting, it just
// forwards bytes and adds the auth/CORS pieces a browser can't add itself.
async function forwardToOphub(upstreamPath, cookie, req, res) {
  const targetUrl = `${OPHUB_BASE_URL}${upstreamPath}`;

  console.log(`\n[ophub-proxy] ── Incoming request → ${upstreamPath} ──────────────`);
  console.log('[ophub-proxy] Content-Type received:', req.headers['content-type']);
  console.log('[ophub-proxy] Body byte length:', req.body ? req.body.length : '(no body)');
  console.log('[ophub-proxy] Body as text:', req.body ? req.body.toString('utf8') : '(no body)');

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': cookie,
        'Origin': OPHUB_ORIGIN,
        'Referer': OPHUB_REFERER,
      },
      body: req.body, // raw Buffer, untouched
    });

    console.log('[ophub-proxy] Forwarded to:', targetUrl);
    console.log('[ophub-proxy] Upstream status:', upstreamResponse.status);

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
    const bodyText = await upstreamResponse.text();

    console.log('[ophub-proxy] Upstream response body:', bodyText.slice(0, 500));
    console.log('[ophub-proxy] ──────────────────────────────────────────────\n');

    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', contentType);
    res.send(bodyText);
  } catch (err) {
    console.error('[ophub-proxy] Error forwarding to OpHub:', err.message);
    res.status(502).json({
      error: 'Proxy failed to reach OpHub',
      detail: err.message,
    });
  }
}

// Forwards to OpHub's query-execution endpoint. Aetherium's REST resolver
// calls THIS path (not OpHub directly) — that's the whole point of the proxy.
app.post('/api/ophub/query', (req, res) => forwardToOphub('/app/ajax/Query', OPHUB_COOKIE, req, res));

// Forwards to OpHub's flow-listing endpoint (the "site" management layer,
// not the "app" runtime layer — uses OPHUB_SITE_COOKIE, a different cookie
// set, per the note above).
// Powers the Queries workspace's "Sync from OpHub" button.
app.post('/api/ophub/flows', (req, res) => forwardToOphub('/site/ajax/FlowMgr', OPHUB_SITE_COOKIE, req, res));

app.listen(PORT, () => {
  console.log(`[ophub-proxy] listening on http://localhost:${PORT}`);
  console.log(`[ophub-proxy] forwarding to ${OPHUB_BASE_URL}`);
  console.log(`[ophub-proxy] allowing requests from ${ALLOWED_ORIGIN}`);
});
