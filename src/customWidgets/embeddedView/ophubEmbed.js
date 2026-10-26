// customWidgets/embeddedView/ophubEmbed.js
// Everything the Embedded View knows about Operations Hub: what a page's
// runtime URL looks like, how to read one that's pasted in, and where the
// proxy serves OpHub's UI from. Parallel to thingworxEmbed.js; no React.
//
// OpHub pages come through the proxy too, but on a port of their own
// (ophubEmbed.js in the proxy explains why) — not Aetherium's origin. The
// proxy is found through an OpHub connection's Proxy URL, so an embedded
// page belongs to a connection, the same as an OpHub query does.
//
// A page's runtime URL, from a real one:
//   /run/v2/app-name/<app>/page-name/<page>
// A pasted URL keeps its own path exactly, so if some pages are addressed
// differently, pasting one still works.
//
// Parameters: OpHub doesn't yet tell Aetherium which values a page reads
// from its URL, so they're named by hand (or come from a pasted URL), and
// passed in the query string. Whether a page picks them up depends on how it
// was built — that's the thing to check first.

import { loadConnections } from '../../connectionsStorage';
import { encodeParams } from './viewParameters';

export const OPHUB_CONNECTION_KIND = 'ophub';

export function ophubConnections() {
  return loadConnections().filter(c => c.kind === OPHUB_CONNECTION_KIND);
}

// The widget's chosen connection, or the only/first one when it hasn't
// chosen (most setups have one).
export function ophubConnectionFor(connectionId, connections = ophubConnections()) {
  return connections.find(c => c.id === connectionId) || connections[0] || null;
}

// ── Page URLs ────────────────────────────────────────────────────────────────

export function pagePathFor(appName, pageName) {
  if (!appName || !pageName) return null;
  return `/run/v2/app-name/${encodeURIComponent(appName)}/page-name/${encodeURIComponent(pageName)}`;
}

const decode = (segment) => { try { return decodeURIComponent(segment); } catch { return segment; } };

// → { appName, pageName, pagePath, params } | null
export function parsePageUrl(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { return null; }
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  const after = (marker) => {
    const i = segments.indexOf(marker);
    return i >= 0 && segments[i + 1] ? decode(segments[i + 1]) : null;
  };
  let appName = after('app-name');
  let pageName = after('page-name');
  if ((!appName || !pageName) && segments[0] === 'run') {
    // Some other /run/… form: take the last two segments as app and page.
    const rest = segments.slice(segments[1] && /^v\d+$/.test(segments[1]) ? 2 : 1);
    if (rest.length < 2) return null;
    appName = appName || decode(rest[rest.length - 2]);
    pageName = pageName || decode(rest[rest.length - 1]);
  }
  if (!appName || !pageName) return null;
  return { appName, pageName, pagePath: url.pathname, params: Object.fromEntries(url.searchParams) };
}

export function pageUrl({ embedUrl, pagePath, appName, pageName, params, declared }) {
  const path = pagePath || pagePathFor(appName, pageName);
  if (!embedUrl || !path) return null;
  const query = encodeParams(params, declared);
  return `${embedUrl.replace(/\/$/, '')}${path}${query.length ? `?${query.join('&')}` : ''}`;
}

// ── The proxy ────────────────────────────────────────────────────────────────

// → { embedUrl, ophubBaseUrl, cookieConfigured, withCookie, withoutCookie }
// Asked once per proxy per session.
const infoCache = new Map();
export function fetchOphubEmbedInfo(connection) {
  const proxyUrl = (connection?.proxyUrl || '').replace(/\/$/, '');
  if (!proxyUrl) return Promise.reject(new Error('This OpHub connection has no Proxy URL.'));
  if (!infoCache.has(proxyUrl)) {
    const promise = (async () => {
      let response;
      try {
        response = await fetch(`${proxyUrl}/ophub-embed/info`, { headers: { Accept: 'application/json' } });
      } catch (err) {
        throw new Error(`Couldn't reach the proxy at ${proxyUrl} — is it running? (${err.message})`);
      }
      if (response.status === 404) throw new Error('The proxy doesn’t serve OpHub pages yet — hook up ophubEmbed.js in its server.js and restart it.');
      if (!response.ok) throw new Error(`The proxy said ${response.status}.`);
      const info = await response.json();
      if (!info?.embedUrl) throw new Error('The proxy didn’t say where it serves OpHub pages.');
      return info;
    })();
    promise.catch(() => infoCache.delete(proxyUrl));   // try again next time
    infoCache.set(proxyUrl, promise);
  }
  return infoCache.get(proxyUrl);
}
