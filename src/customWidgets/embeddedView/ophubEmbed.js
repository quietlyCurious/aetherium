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
// Parameters are the page's URL Globals — OpHub's globals that are filled
// from the URL — passed in the query string. They're read from the app's
// definition (get_app_details); more can be named by hand.
//
// Apps and pages come from OpHub's own AppMgr service (the calls its site UI
// makes), through the proxy's /api/ophub/apps route.

import { loadConnections } from '../../connectionsStorage';
import { postToOphub } from '../../connections/ophubWire';
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

// ── Apps, pages and URL Globals ──────────────────────────────────────────────
// Read from AppMgr's answers. Their exact shape hasn't been seen yet — only
// the app package export, which stores an app's pages and globals in an
// `items` list (sometimes as a JSON string) — so these readers look through
// whatever comes back for things shaped like apps, pages and globals.

const pick = (o, keys) => keys.map(k => o?.[k]).find(v => v !== undefined && v !== null && v !== '');

// Every object anywhere in `value`, including inside JSON-string fields.
function* objectsIn(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('[') || t.startsWith('{')) && t.length < 5e6) {
      try { yield* objectsIn(JSON.parse(t), depth + 1); } catch { /* not JSON */ }
    }
    return;
  }
  if (Array.isArray(value)) { for (const v of value) yield* objectsIn(v, depth + 1); return; }
  if (typeof value === 'object') {
    yield value;
    for (const v of Object.values(value)) yield* objectsIn(v, depth + 1);
  }
}

// get_apps → [{ id, name }]. The id is the app's UUID — what get_app_details
// and the designer's URLs take.
export function parseApps(json) {
  const seen = new Map();
  for (const o of objectsIn(json)) {
    const name = pick(o, ['appName', 'app_name']);
    const id = pick(o, ['UUID', 'uuid', 'app_uuid', 'appUuid', 'app_id']);
    if (name && id && !seen.has(String(id))) seen.set(String(id), { id: String(id), name: String(name), numericId: o.appId ?? null });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const BASE_TYPE_FROM_OPHUB = { string: 'STRING', number: 'NUMBER', integer: 'INTEGER', int: 'INTEGER', float: 'NUMBER', double: 'NUMBER', boolean: 'BOOLEAN', bool: 'BOOLEAN', date: 'DATETIME', datetime: 'DATETIME' };
const isUrlGlobal = (g) => /url/i.test(String(g.type || g.globalType || g.kind || ''));

// get_app_details → { pages: [{ id, name, displayName }], globals: [...] }
export function parseAppDetails(json) {
  const pages = new Map();
  const globals = new Map();
  for (const o of objectsIn(json)) {
    const pageId = pick(o, ['page_id', 'pageUuid', 'page_uuid']);
    if (pageId && pick(o, ['name', 'displayName']) && !Array.isArray(o.globals)) {
      if (!pages.has(String(pageId))) {
        pages.set(String(pageId), { id: String(pageId), name: String(pick(o, ['name', 'displayName'])), displayName: String(pick(o, ['displayName', 'name'])) });
      }
    }
    if (Array.isArray(o.globals)) {
      o.globals.filter(g => g && g.name).forEach(g => {
        const key = `${g.pageId || ''}|${g.id || g.name}`;
        if (!globals.has(key)) globals.set(key, g);
      });
    }
  }
  return { pages: [...pages.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), globals: [...globals.values()] };
}

// A page's URL Globals, as parameters: its own, and the app-wide ones.
export function urlGlobalsForPage(globals, pageId) {
  const byName = new Map();
  (globals || [])
    .filter(isUrlGlobal)
    .filter(g => g.appGlobal || !g.pageId || g.pageId === pageId)
    .forEach(g => byName.set(g.name, {
      name: g.name,
      baseType: BASE_TYPE_FROM_OPHUB[String(g.dataType || '').toLowerCase()] || 'STRING',
      fromOphub: true,
    }));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// What kinds of global an app has, for saying why none were found.
export const globalTypesOf = (globals) => [...new Set((globals || []).map(g => String(g.type || '?')))].sort();

const appsCache = new Map();
export function listOphubApps(connection, { refresh = false } = {}) {
  const key = connection?.proxyUrl || '';
  if (refresh || !appsCache.has(key)) {
    const promise = postToOphub(connection?.proxyUrl, '/api/ophub/apps', { command: 'get_apps' }).then(parseApps);
    promise.catch(() => appsCache.delete(key));
    appsCache.set(key, promise);
  }
  return appsCache.get(key);
}

export async function fetchOphubAppDetails(connection, appId) {
  const json = await postToOphub(connection?.proxyUrl, '/api/ophub/apps', { command: 'get_app_details', app_id: appId });
  return parseAppDetails(json);
}

// Finds a page by id, or by app and page name (a pasted URL has only
// names). → { app, page, parameters, globalTypes } — app or page null when
// not found.
export async function readOphubPage(connection, { appId, appName, pageId, pageName }) {
  const apps = await listOphubApps(connection);
  const app = apps.find(a => a.id === appId) || apps.find(a => a.name === appName) || null;
  if (!app) return { app: null, page: null, parameters: [], globalTypes: [] };
  const details = await fetchOphubAppDetails(connection, app.id);
  const page = details.pages.find(p => p.id === pageId)
    || details.pages.find(p => p.name === pageName || p.displayName === pageName) || null;
  return {
    app,
    page,
    pages: details.pages,
    parameters: page ? urlGlobalsForPage(details.globals, page.id) : [],
    globalTypes: globalTypesOf(details.globals),
  };
}

// The classic designer, open on one page. New-designer apps have no URL of
// their own, so this only lands on the page for classic apps.
export function ophubEditUrl(ophubBaseUrl, appId, pageId) {
  if (!ophubBaseUrl || !appId || !pageId) return null;
  return `${ophubBaseUrl.replace(/\/$/, '')}/iqp/#/app/${encodeURIComponent(appId)}/pages/${encodeURIComponent(pageId)}`;
}
