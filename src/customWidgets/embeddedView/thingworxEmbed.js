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

export const RUNTIME_PATH = '/Thingworx/Runtime/index.html';

// A parameter becomes a widget property under this prefix — 'params.Site' —
// so the normal binding machinery handles it, and expandDotPaths hands the
// widget one `params` object.
export const PARAM_PREFIX = 'params.';
export const paramPropName = (name) => `${PARAM_PREFIX}${name}`;

// ── Runtime URL ──────────────────────────────────────────────────────────────

// How a value reaches the mashup: everything is text in a URL. Blank values
// are left out so the mashup's own default applies.
export function paramValueToText(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Master first, then mashup, then parameters — the order ThingWorx itself
// writes them in. Only parameters the mashup actually declares are passed,
// so a stale value left behind by a renamed parameter doesn't leak through.
export function runtimeUrl({ mashupName, master, params, declared }) {
  if (!mashupName) return null;
  const allowed = declared ? new Set(declared.map(p => p.name)) : null;
  const parts = [];
  if (master) parts.push(`master=${encodeURIComponent(master)}`);
  parts.push(`mashup=${encodeURIComponent(mashupName)}`);
  Object.entries(params || {}).forEach(([name, value]) => {
    if (allowed && !allowed.has(name)) return;
    const text = paramValueToText(value);
    if (text !== null) parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(text)}`);
  });
  return `${RUNTIME_PATH}#${parts.join('&')}`;
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

// ── Parameters → widget properties ───────────────────────────────────────────

const NUMBER_TYPES = new Set(['NUMBER', 'INTEGER', 'LONG']);
// A table can't travel in a URL; these need the live bridge (step 3).
export const URL_UNSAFE_TYPES = new Set(['INFOTABLE']);

export function isUrlPassable(param) {
  return !URL_UNSAFE_TYPES.has(String(param.baseType || '').toUpperCase());
}

// One widget property per parameter, grouped under "Parameters" in the
// details panel, each bindable like any other property.
export function parameterPropertyDefs(declared) {
  return (declared || []).filter(isUrlPassable).map(p => {
    const base = String(p.baseType || '').toUpperCase();
    return {
      name: paramPropName(p.name),
      label: p.name,
      type: NUMBER_TYPES.has(base) ? 'number' : base === 'BOOLEAN' ? 'bool' : 'string',
      group: 'Parameters',
      ...(p.description ? { description: p.description } : {}),
    };
  });
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

export function sameParameters(a, b) {
  const key = (list) => JSON.stringify((list || []).map(p => [p.name, p.baseType]));
  return key(a) === key(b);
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
