// connections/twxConnector.js
// The ThingWorx connector. A ThingWorx "query" is a service on a Thing, so
// browsing is two steps, like Composer's Add Data dialog: list the Things,
// then a Thing's services when it's opened (listGroups / listGroup).
//
// Uses ThingWorx's documented REST API through the proxy's /api/twx route,
// which adds the app key and forwards to <TWX_BASE_URL>/Thingworx/…:
//   GET  Things                         every Thing (an InfoTable of rows)
//   GET  Things/<thing>/Metadata        its services: parameters, result type
//   GET  DataShapes/<shape>             the columns an INFOTABLE result has
//   POST Things/<thing>/Services/<svc>  run one (JSON body of inputs)
//
// NOT YET VALIDATED against a live server (written from the API docs and
// tested against a mock). The response readers below accept both the map
// and array forms ThingWorx uses for definitions, so a first live run is the
// thing to check.

import { QUERY_TYPES, inferResultCardinality } from '../dataModel';

// ── Talking to the proxy ─────────────────────────────────────────────────────

async function twxRequest(connection, path, { method = 'GET', body } = {}) {
  if (!connection.proxyUrl) throw new Error('This connection has no proxy URL (e.g. http://localhost:4000).');
  const url = `${connection.proxyUrl.replace(/\/$/, '')}/api/twx/${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error(`Couldn't reach ${connection.proxyUrl} — is the proxy running? (${networkErr.message})`);
  }
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new Error(`ThingWorx refused the request (${response.status}). Check TWX_APP_KEY in the proxy's .env, and that the key's user can see this.`);
  }
  if (!response.ok) throw new Error(`ThingWorx request failed (${response.status}): ${text.slice(0, 200)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`ThingWorx didn't return JSON (status ${response.status}): ${text.slice(0, 200)}`);
  }
}

const seg = encodeURIComponent;

// ThingWorx lists definitions as a map keyed by name; accept an array too.
const asList = (defs) => (Array.isArray(defs) ? defs : Object.values(defs || {}));
const rowsOf = (json) => (Array.isArray(json?.rows) ? json.rows : Array.isArray(json) ? json : []);

// ── Types ────────────────────────────────────────────────────────────────────

const TYPE_FROM_BASE = {
  STRING: 'String', TEXT: 'String', HTML: 'String', JSON: 'String', THINGNAME: 'String',
  NUMBER: 'Number', INTEGER: 'Number', LONG: 'Number',
  BOOLEAN: 'Boolean',
  DATETIME: 'DateTime',
};
const typeOf = (baseType) => TYPE_FROM_BASE[baseType] || 'String';

// ThingWorx is strict about JSON types, and input values arrive as strings
// from text fields — cast numbers and booleans.
function castInput(value, baseType) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (['NUMBER', 'INTEGER', 'LONG'].includes(baseType)) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (baseType === 'BOOLEAN') return value === true || value === 'true';
  return value;
}

// Services every Thing inherits from the platform (properties, alerts,
// subscriptions, permissions…). Listed after a Thing's own services, behind
// a "built-in" toggle. Categories are what ThingWorx tags them with; the
// template names cover servers that report where a service was defined.
const BUILT_IN_CATEGORIES = new Set([
  'Alerts', 'Bindings', 'Configuration', 'Events', 'Persistence', 'Permissions', 'Projects',
  'Properties', 'Remote', 'Subscriptions', 'Tags', 'Tunneling', 'Visibility', 'Streams',
  'ValueStream', 'Logging', 'Monitoring', 'FileTransfer', 'Federation', 'Metadata',
]);
const BASE_TEMPLATES = new Set([
  'GenericThing', 'RemoteThing', 'RemoteThingWithTunnels', 'RemoteThingWithFileTransfer',
  'RemoteThingWithTunnelsAndFileTransfer',
]);
const isBuiltIn = (svc) => BASE_TEMPLATES.has(svc.sourceName) || BUILT_IN_CATEGORIES.has(svc.category);

// ── Mapping a service to a query definition ──────────────────────────────────

// A service's parameters and result. ThingWorx writes these two ways:
//   parameterDefinitions: { name: {…} }      resultType: { baseType, aspects }
//   Inputs: { fieldDefinitions: { name: {…} } }
//   Outputs: { baseType, aspects }  or  { fieldDefinitions: { result: {…} } }
// (the second is what a live Things/<thing>/Metadata returned — a service
// read the first way came out with no inputs and no outputs). Reads either.
function parametersOf(svc) {
  const defs = svc.parameterDefinitions ?? svc.Inputs?.fieldDefinitions ?? svc.Inputs ?? svc.inputs;
  return asList(defs).filter(p => p && p.name);
}

function resultOf(svc) {
  const out = svc.resultType ?? svc.Outputs ?? svc.outputs;
  if (!out) return {};
  if (out.baseType) return out;
  const fields = asList(out.fieldDefinitions);
  return fields.find(f => f.name === 'result') || fields[0] || {};
}

async function dataShapeFields(connection, shapeName, cache) {
  if (!shapeName) return [];
  if (!cache.has(shapeName)) {
    cache.set(shapeName, twxRequest(connection, `DataShapes/${seg(shapeName)}`)
      .then(json => asList(json?.fieldDefinitions).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)))
      .catch(() => []));   // unknown columns still leave the service usable
  }
  return cache.get(shapeName);
}

// Built-in services whose result is a table with one column per property of
// the Thing, but which declare no data shape for it — their columns come from
// the Thing's own property list instead.
const PROPERTY_TABLE_SERVICES = new Set(['GetPropertyValues']);

export async function serviceToDefinition(connection, thing, svc, shapeCache = new Map(), propertyFields = []) {
  const result = resultOf(svc);
  const resultBaseType = result.baseType || 'NOTHING';
  const dataShape = result.aspects?.dataShape || '';
  const fields = resultBaseType !== 'INFOTABLE' ? []
    : !dataShape && PROPERTY_TABLE_SERVICES.has(svc.name) ? propertyFields
    : await dataShapeFields(connection, dataShape, shapeCache);
  const definition = {
    name: svc.name,
    description: svc.description || '',
    type: QUERY_TYPES.TWX_SERVICE,
    direction: 'read',
    inputs: parametersOf(svc)
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
      .map(p => ({
        name: p.name,
        type: typeOf(p.baseType),
        optional: !p.aspects?.isRequired,
        defaultValue: p.aspects?.defaultValue ?? null,
        uiHint: 'text',
        paramType: null,
        baseType: p.baseType,
      })),
    outputs: resultBaseType === 'INFOTABLE'
      ? fields.map(f => ({ name: f.name, type: typeOf(f.baseType), outputGroup: 'default', outputType: 'scalar' }))
      : resultBaseType === 'NOTHING' ? [] : [{ name: 'result', type: typeOf(resultBaseType), outputGroup: 'default', outputType: 'scalar' }],
    config: { thing, service: svc.name, resultBaseType, dataShape },
  };
  definition.resultCardinality = inferResultCardinality(definition);
  return definition;
}

// ── The connector ────────────────────────────────────────────────────────────

export const twxConnector = {
  kind: 'twx',
  label: 'ThingWorx',
  shortLabel: 'TWX',
  dot: '#2E7D32',
  itemNoun: 'services',
  groupNoun: 'Things',
  defaults: { proxyUrl: 'http://localhost:4000', nameFilter: '' },
  fields: [
    { key: 'proxyUrl', label: 'Proxy URL', placeholder: 'http://localhost:4000', mono: true },
    { key: 'nameFilter', label: 'Thing name contains', placeholder: 'All Things (e.g. Snowmobile)' },
  ],

  sourceKey: (definition) => `twx:${definition.config.thing}/${definition.name}`,

  // → [{ key, label }] — one per Thing, system Things left out.
  async listGroups(connection) {
    const filter = (connection.nameFilter || '').trim().toLowerCase();
    return rowsOf(await twxRequest(connection, 'Things'))
      .filter(row => row.name && !row.isSystemObject)
      .filter(row => !filter || row.name.toLowerCase().includes(filter))
      .map(row => ({ key: row.name, label: row.name, description: row.description || '' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  // → [{ sourceKey, group, definition, minor }] — a Thing's services; built-in
  // ones are marked minor.
  async listGroup(connection, thing) {
    const metadata = await twxRequest(connection, `Things/${seg(thing)}/Metadata`);
    const propertyFields = asList(metadata?.propertyDefinitions)
      .filter(p => p && p.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    const shapeCache = new Map();
    const services = asList(metadata?.serviceDefinitions).filter(svc => svc.name && !svc.isPrivate);
    return Promise.all(services.map(async svc => {
      const definition = await serviceToDefinition(connection, thing, svc, shapeCache, propertyFields);
      return { sourceKey: twxConnector.sourceKey(definition), group: thing, definition, minor: isBuiltIn(svc) };
    }));
  },

  async run({ connection, query, inputValues }) {
    const body = {};
    (query.inputs || []).forEach(def => {
      const value = castInput(inputValues[def.name] ?? def.defaultValue, def.baseType);
      if (value !== undefined) body[def.name] = value;
    });
    const { thing, service } = query.config;
    const json = await twxRequest(connection, `Things/${seg(thing)}/Services/${seg(service)}`, { method: 'POST', body });
    return rowsOf(json);
  },
};
