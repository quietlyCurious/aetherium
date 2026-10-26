// customWidgets/embeddedView/thingworxEmbed.js
// Everything the Embedded View knows about ThingWorx: where the mashup
// runtime lives, how a mashup and its parameters go into a runtime URL, how
// to search for mashups and Masters, and where a mashup's parameters are in
// its definition. No React here, so it's testable on its own.
//
// All of it goes through /Thingworx/* on Aetherium's OWN origin. The dev
// server forwards that to the local proxy (src/setupProxy.js), which adds the
// app key and strips ThingWorx's "don't frame me" headers (twxEmbed.js).
// Being same-origin is what lets the mashup load in an iframe at all — the
// step 1 spike showed a direct iframe is refused.
//
// Parameters work the same for every kind of embedded view (viewParameters.js).

import { encodeParams } from './viewParameters';

export const RUNTIME_PATH = '/Thingworx/Runtime/index.html';

// Master first, then mashup, then parameters — the order ThingWorx itself
// writes them in.
export function runtimeUrl({ mashupName, master, params, declared }) {
  if (!mashupName) return null;
  const parts = [];
  if (master) parts.push(`master=${encodeURIComponent(master)}`);
  parts.push(`mashup=${encodeURIComponent(mashupName)}`);
  return `${RUNTIME_PATH}#${[...parts, ...encodeParams(params, declared)].join('&')}`;
}

// A pasted runtime URL can carry mashup/master in the query string, the
// hash, or both (FSU apps put mashup in both). The hash wins.
const RESERVED = new Set(['mashup', 'master', 'appKey', '__fromLogin']);
export function parseRuntimeUrl(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { return null; }
  const values = new Map(url.searchParams);
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((v, k) => values.set(k, v));
  if (!values.get('mashup')) return null;
  return {
    mashupName: values.get('mashup'),
    master: values.get('master') || '',
    params: Object.fromEntries([...values].filter(([k]) => !RESERVED.has(k))),
  };
}

// ── A mashup's declared parameters ──────────────────────────────────────────

const asList = (defs) => (Array.isArray(defs) ? defs : Object.values(defs || {}));

// Where a mashup definition keeps its parameters varies; these are the places
// the spike found or that older versions use. → [{ name, baseType, description, defaultValue }]
export function parametersFromDefinition(json) {
  let defs = json?.parameterDefinitions ?? json?.parameters;
  if (!defs) {
    try {
      const content = typeof json?.mashupContent === 'string' ? JSON.parse(json.mashupContent) : json?.mashupContent;
      defs = content?.Parameters ?? content?.parameters ?? content?.UI?.Properties?.Parameters;
    } catch { defs = null; }
  }
  return asList(defs)
    .filter(d => d && (d.name || d.ParameterName))
    .map(d => ({
      name: d.name || d.ParameterName,
      baseType: d.baseType || d.BaseType || 'STRING',
      description: d.description || d.Description || '',
      defaultValue: d.aspects?.defaultValue ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Talking to ThingWorx (same-origin) ───────────────────────────────────────

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Couldn't reach ThingWorx through Aetherium — is the proxy running? (${err.message})`);
  }
  const text = await response.text();
  if (response.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!response.ok) throw Object.assign(new Error(`ThingWorx said ${response.status}: ${text.slice(0, 160)}`), { status: response.status });
  try { return text ? JSON.parse(text) : null; } catch {
    throw new Error(`ThingWorx didn't return JSON (${response.status}) — is /Thingworx forwarded to the proxy? (setupProxy.js, then restart npm start)`);
  }
}

const rowsOf = (json) => (Array.isArray(json?.rows) ? json.rows : Array.isArray(json) ? json : []);

export async function fetchMashupParameters(mashupName) {
  return parametersFromDefinition(await request(`/Thingworx/Mashups/${encodeURIComponent(mashupName)}`));
}

// Something that changes whenever the mashup is edited and saved: its
// last-modified time when the definition has one, else the whole definition.
// Compared, never shown (mashupRevisions.js).
export async function fetchMashupSignature(mashupName) {
  const json = await request(`/Thingworx/Mashups/${encodeURIComponent(mashupName)}`);
  return String(json?.lastModifiedDate ?? JSON.stringify(json));
}

// ── Composer ─────────────────────────────────────────────────────────────────
// Composer opens on the ThingWorx server itself, not through Aetherium: the
// person edits as themselves, signed in the usual way, and nothing they do is
// done as the proxy's app key. The link format is from real Composer URLs:
//   <server>/Thingworx/Composer/index.html#/modeler/details/Mashup~<name>/design

export function composerUrl(twxBaseUrl, mashupName) {
  if (!twxBaseUrl || !mashupName) return null;
  return `${twxBaseUrl.replace(/\/$/, '')}/Thingworx/Composer/index.html#/modeler/details/Mashup~${encodeURIComponent(mashupName)}/design`;
}

// The ThingWorx server's own address, which only the proxy knows (its .env).
// Its /twx-embed/diagnose route reports it; asked once per session.
let baseUrlPromise = null;
export function fetchTwxBaseUrl() {
  if (!baseUrlPromise) {
    baseUrlPromise = request('/twx-embed/diagnose')
      .then(json => {
        if (!json?.twxBaseUrl) throw new Error('The proxy didn’t say which ThingWorx server it uses (TWX_BASE_URL).');
        return json.twxBaseUrl;
      })
      .catch(err => { baseUrlPromise = null; throw err; });
  }
  return baseUrlPromise;
}

// Search at the source: the plain /Thingworx/Mashups list stops at 500, so
// it can't be trusted to hold a given mashup (the spike's FSU example wasn't
// in it). SpotlightSearch is ThingWorx's entity search; a couple of forms are
// tried, and the one that answers is remembered for the session. Falls back
// to an exact-name lookup.
const SPOTLIGHT = '/Thingworx/Resources/SearchFunctions/Services/SpotlightSearch';
const SEARCH_FORMS = [
  (term) => ({ searchExpression: term, types: { items: ['Mashup', 'Master'] } }),
  (term) => ({ searchExpression: `*${term}*`, types: { items: ['Mashup', 'Master'] } }),
  (term) => ({ searchExpression: `*${term}*` }),
];
let workingForm = null;

export const isMasterType = (type) => /master/i.test(type || '');
const isVisualType = (type) => !type || /mashup|master/i.test(type);

// → [{ name, kind: 'mashup' | 'master', description }]
export async function searchMashupsAndMasters(term) {
  const query = String(term || '').trim();
  if (query.length < 2) return [];
  const forms = workingForm !== null ? [workingForm, ...SEARCH_FORMS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...SEARCH_FORMS.keys()];
  for (const index of forms) {
    try {
      const json = await request(SPOTLIGHT, {
        method: 'POST',
        body: { ...SEARCH_FORMS[index](query), maxItems: 200, maxSearchItems: 5000, withPermissions: false },
      });
      const rows = rowsOf(json).filter(r => r.name && isVisualType(r.type));
      if (rows.length) {
        workingForm = index;
        return rows
          .map(r => ({ name: r.name, kind: isMasterType(r.type) ? 'master' : 'mashup', description: r.description || '' }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch { /* try the next form */ }
  }
  const exact = [];
  for (const [collection, kind] of [['Mashups', 'mashup'], ['Masters', 'master']]) {
    try {
      const json = await request(`/Thingworx/${collection}/${encodeURIComponent(query)}`);
      exact.push({ name: json?.name || query, kind, description: json?.description || '' });
    } catch { /* not that kind */ }
  }
  return exact;
}
