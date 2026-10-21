// setupProxy.js
// Picked up automatically by the dev server (npm start) — restart it after
// adding or changing this file.
//
// Forwards the ThingWorx UI paths to the local proxy, so a mashup iframed into
// an Aetherium page comes from Aetherium's own origin (localhost:3000) rather
// than from the ThingWorx server. Same-origin means no framing refusal, no
// third-party-cookie login problem, and Aetherium can see inside the iframe.
//
// Only these prefixes are forwarded; everything else is Aetherium as usual.
// The existing /api/ophub/* and /api/twx/* calls are untouched — they still go
// to the proxy's URL directly, as configured on each connection.
//
// Plain Node http (no http-proxy-middleware dependency to install).

const http = require('http');

const PROXY_HOST = process.env.AETHERIUM_PROXY_HOST || 'localhost';
const PROXY_PORT = Number(process.env.AETHERIUM_PROXY_PORT || 4000);
const FORWARDED_PREFIXES = ['/Thingworx/', '/Thingworx?', '/twx-embed/'];

module.exports = function setupProxy(app) {
  app.use((req, res, next) => {
    if (req.url !== '/Thingworx' && !FORWARDED_PREFIXES.some(p => req.url.startsWith(p))) return next();

    const upstream = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: req.method,
      path: req.originalUrl || req.url,
      headers: { ...req.headers, host: `${PROXY_HOST}:${PROXY_PORT}` },
    }, (proxied) => {
      res.writeHead(proxied.statusCode || 502, proxied.headers);
      proxied.pipe(res);
    });
    upstream.on('error', (err) => {
      if (res.headersSent) { res.end(); return; }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Couldn't reach the proxy at ${PROXY_HOST}:${PROXY_PORT} — is it running?`, detail: err.message }));
    });
    req.pipe(upstream);
  });
};
