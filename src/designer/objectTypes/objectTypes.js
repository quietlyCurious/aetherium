// designer/objectTypes/objectTypes.js
// Object types: kinds of things a user can browse and drop on a widget —
// equipment, car models, tags — no matter which source knows about them.
// A type stands alone (it isn't owned by a connection) because one type can
// span sources: an OpHub equipmentID and a ThingWorx Thing name can be the
// same thing.
//
//   {
//     id, name, description,
//     listedBy: {
//       connectionId,
//       source: 'query' | 'things',
//       queryId, sourceKey,           // source 'query': the saved copy that lists them
//       keyField, displayField,       //   …which column identifies one, and which to show
//       inputValues: { name: value }, //   …and what its inputs get (over their defaults)
//       nameFilter,                   // source 'things': ThingWorx Things whose name contains this
//     },
//     references: [{                  // every place another query means this type's key
//       id, connectionId,
//       side: 'input' | 'output' | 'thing',
//       queryId, sourceKey, field,    // 'input'/'output': which query and field
//     }],                             // 'thing': each object IS a Thing on this connection
//     dismissed: [suggestionKey],     // suggestions the user said no to
//   }
//
// The pieces built on this: ObjectTypesWorkspace (define them), the Screens
// Data tab's Objects mode (browse and drag them), and ObjectDropPopover
// (drop one on a widget → pick a related query → instance added and bound).

import { generateDataId, inferResultCardinality, RESULT_CARDINALITIES } from '../../dataModel';
import { connectorFor } from '../../connections/connectionKinds';
import { getWidgetPropertyDefs } from '../widgets/widgetPropertyDefs';

export const makeObjectType = (extra = {}) => ({
  id: generateDataId(),
  name: '',
  description: '',
  listedBy: { connectionId: null, source: 'query', queryId: null, sourceKey: null, keyField: '', displayField: '', inputValues: {}, nameFilter: '' },
  references: [],
  dismissed: [],
  ...extra,
});

// "Boston-Snowmobile › GetTelemetry" for a ThingWorx service, else the name.
export function queryLabel(query) {
  if (!query) return '(missing query)';
  return query.config?.thing ? `${query.config.thing} › ${query.name}` : query.name;
}

// Same reference = same connection, side, query and field.
export const referenceKey = (r) => [r.connectionId, r.side, r.sourceKey || '', r.field || ''].join('|');

export function connectionsOf(type) {
  return [...new Set([type.listedBy?.connectionId, ...(type.references || []).map(r => r.connectionId)].filter(Boolean))];
}

// ── Listing a type's objects ─────────────────────────────────────────────────

// Inputs a list query runs with: the values set on the type, else each
// input's default. Some list services need real values to return everything
// — e.g. a ThingWorx Apps equipment search takes every equipment type in a
// JSON string, and a page size.
export const listInputValues = (query, listedBy) => Object.fromEntries((query.inputs || []).map(i => {
  const set = listedBy?.inputValues?.[i.name];
  return [i.name, set !== undefined && set !== '' ? set : (i.defaultValue ?? '')];
}));

// → [{ key, label }] — every object of the type, de-duplicated by key.
export async function listObjects(type, { connections, queries }) {
  const { listedBy } = type;
  const connection = connections.find(c => c.id === listedBy?.connectionId);
  if (!connection) throw new Error('Choose where the list comes from (Object Types → Listed by).');
  const connector = connectorFor(connection);

  if (listedBy.source === 'things') {
    const filter = (listedBy.nameFilter || '').trim().toLowerCase();
    return (await connector.listGroups(connection))
      .filter(g => !filter || g.key.toLowerCase().includes(filter))
      .map(g => ({ key: g.key, label: g.label }));
  }

  const query = queries.find(q => q.id === listedBy.queryId);
  if (!query) throw new Error('The list query is missing — pick it again in Object Types.');
  if (!listedBy.keyField) throw new Error('Choose the key field in Object Types.');
  const rows = await connector.run({ connection, query, instance: null, inputValues: listInputValues(query, listedBy) });
  const seen = new Map();
  rows.forEach(row => {
    const key = row?.[listedBy.keyField];
    if (key === undefined || key === null || key === '' || seen.has(String(key))) return;
    const label = listedBy.displayField ? row[listedBy.displayField] : null;
    seen.set(String(key), { key: String(key), label: label === undefined || label === null || label === '' ? String(key) : String(label) });
  });
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ── Suggesting references ────────────────────────────────────────────────────

// From whatever the catalog has loaded (every OpHub flow; ThingWorx services
// of the Things opened so far): inputs and outputs named like the key field,
// and OpHub entity filters on a column of that name.
// → [{ key, connectionId, side, sourceKey, field, item, why }]
export function suggestReferences(type, catalogEntries) {
  const keyField = (type.listedBy?.keyField || '').trim().toLowerCase();
  if (!keyField) return [];
  const taken = new Set([...(type.references || []).map(referenceKey), ...(type.dismissed || [])]);
  const out = [];
  const offer = (s) => {
    const key = referenceKey(s);
    if (taken.has(key)) return;
    taken.add(key);
    out.push({ ...s, key });
  };
  catalogEntries.forEach(({ connection, groups }) => {
    (groups || []).forEach(group => (group.items || []).forEach(item => {
      if (item.sourceKey === type.listedBy?.sourceKey) return;   // the list query itself
      const d = item.definition;
      (d.config?.conditions || []).forEach(c => {
        if ((c.fieldName || '').toLowerCase() === keyField) {
          offer({ connectionId: connection.id, side: 'input', sourceKey: item.sourceKey, field: c.paramName, item, why: `Entity filter: input ${c.paramName} filters column ${c.fieldName}` });
        }
      });
      (d.inputs || []).forEach(i => {
        if (i.name.toLowerCase() === keyField) {
          offer({ connectionId: connection.id, side: 'input', sourceKey: item.sourceKey, field: i.name, item, why: i.name === type.listedBy.keyField ? 'Same name as the key' : 'Same name, different case' });
        }
      });
      (d.outputs || []).forEach(o => {
        if (o.name.toLowerCase() === keyField) {
          offer({ connectionId: connection.id, side: 'output', sourceKey: item.sourceKey, field: o.name, item, why: o.name === type.listedBy.keyField ? 'Same name as the key' : 'Same name, different case' });
        }
      });
    }));
  });
  return out;
}

// ── What a widget wants ──────────────────────────────────────────────────────

const SCALAR_PREFERENCE = ['value', 'text'];

// The property a drop binds: the widget's data property (rows) if it has one,
// otherwise its main single-value property.
// → { propName, label, wantsRows } | null
export function dropTargetOf(widgetName) {
  const defs = getWidgetPropertyDefs(widgetName) || [];
  const data = defs.find(d => d.type === 'data');
  if (data) return { propName: data.name, label: data.label || data.name, wantsRows: true };
  const bindable = defs.filter(d => d.bindable !== false && (d.type === 'number' || d.type === 'string'));
  const preferred = SCALAR_PREFERENCE.map(n => bindable.find(d => d.name === n)).find(Boolean) || bindable[0];
  return preferred ? { propName: preferred.name, label: preferred.label || preferred.name, wantsRows: false } : null;
}

export const returnsRows = (query) => {
  const c = query.resultCardinality || inferResultCardinality(query);
  return c === RESULT_CARDINALITIES.SERIES || c === RESULT_CARDINALITIES.RESULTSET;
};

// The output a single-value widget shows by default.
export function defaultOutputField(query) {
  const outputs = query.outputs || [];
  return (outputs.find(o => o.name === 'value') || outputs.find(o => o.name === 'result')
    || outputs.find(o => o.type === 'Number') || outputs[0])?.name || '';
}

// ── What a drop offers ───────────────────────────────────────────────────────

// → { options: [{ id, kind, connectionId, query?, item?, field?, how }], errors: [string] }
//   kind 'input': a saved query copy whose `field` input takes the object's key
//   kind 'thing': a service on the Thing named by the key (item from the catalog)
export async function dropOptions(type, object, { connections, queries }) {
  const options = [];
  const errors = [];
  for (const ref of type.references || []) {
    const connection = connections.find(c => c.id === ref.connectionId);
    if (!connection) continue;
    if (ref.side === 'input') {
      const query = queries.find(q => q.id === ref.queryId) || queries.find(q => q.connectionId === ref.connectionId && q.sourceKey === ref.sourceKey);
      if (query) options.push({ id: ref.id, kind: 'input', connectionId: connection.id, query, field: ref.field, how: `${ref.field} ← ${object.key}` });
    } else if (ref.side === 'thing') {
      try {
        const items = await connectorFor(connection).listGroup(connection, object.key);
        items
          .filter(item => !item.minor || item.definition.name === 'GetPropertyValues')
          .forEach(item => options.push({ id: `${ref.id}:${item.sourceKey}`, kind: 'thing', connectionId: connection.id, item, query: item.definition, how: 'a service on this Thing' }));
      } catch (err) {
        errors.push(`${connection.name || 'ThingWorx'}: ${err.message}`);
      }
    }
  }
  return { options, errors };
}

// ── Ranking what a drop offers ───────────────────────────────────────────────
// A Thing can offer a hundred services, so the drop list is ordered by what
// is most likely wanted for showing data:
//   +3  fits the widget (rows for a grid/chart, one value for a gauge/text)
//   +2  plainly reads ("Get…", "Query…", "List…", "Find…")
//   +1  reads by working something out ("Calculate…", "Count…", "Check…")
//   +1  used before (a saved copy exists)
//   −1  per required input nobody fills (they'd need setting on Page Data)
// Services that change something ("Set…", "Add…", "Delete…", "Configure…")
// or return nothing go to a separate, collapsed "actions" group.

const READ_VERBS = new Set(['get', 'query', 'read', 'list', 'find', 'search', 'fetch', 'load', 'retrieve', 'lookup', 'select']);
const DERIVE_VERBS = new Set(['calculate', 'calc', 'compute', 'count', 'check', 'is', 'has', 'show', 'view', 'evaluate', 'describe', 'summarize']);
const ACTION_VERBS = new Set(['set', 'add', 'update', 'delete', 'remove', 'create', 'insert', 'write', 'save', 'put', 'post',
  'configure', 'config', 'reset', 'enable', 'disable', 'start', 'stop', 'restart', 'execute', 'run', 'import', 'export', 'purge',
  'clear', 'acknowledge', 'ack', 'assign', 'unassign', 'apply', 'register', 'unregister', 'send', 'notify', 'process', 'handle',
  'init', 'initialize', 'sync', 'generate', 'copy', 'move', 'rename', 'upgrade', 'migrate', 'schedule', 'trigger', 'publish',
  'subscribe', 'unsubscribe', 'lock', 'unlock', 'approve', 'reject', 'close', 'edit', 'modify', 'change', 'push', 'mark',
  'toggle', 'install', 'uninstall', 'deploy', 'cancel', 'submit', 'upload', 'restore', 'refresh', 'invoke', 'fire']);

// "PTC.FSU.Core.GetEquipmentsByType_AFT" → "get"; "add_alert" → "add".
export function leadingVerb(name) {
  const last = String(name || '').split('.').pop().replace(/^[^A-Za-z]+/, '');
  const match = last.match(/^[A-Za-z][a-z]*/);
  return match ? match[0].toLowerCase() : '';
}

// Required inputs a drop leaves empty (no default, not the one it fills).
export function unfilledRequiredInputs(option) {
  return (option.query.inputs || []).filter(i =>
    !i.optional && i.name !== option.field && (i.defaultValue === null || i.defaultValue === undefined || i.defaultValue === ''));
}

export function isAction(query) {
  const verb = leadingVerb(query.name);
  if (ACTION_VERBS.has(verb)) return true;
  if (query.direction === 'write') return true;
  const cardinality = query.resultCardinality || inferResultCardinality(query);
  return cardinality === RESULT_CARDINALITIES.NONE;
}

// → { main: [ranked], actions: [ranked] }, each ranked = { option, score, fits, reads (0–2), needs: [input], usedBefore }
export function rankDropOptions(options, { wantsRows, queries = [] }) {
  const ranked = options.map(option => {
    const fits = wantsRows === undefined ? false : returnsRows(option.query) === wantsRows;
    const verb = leadingVerb(option.query.name);
    const reads = READ_VERBS.has(verb) ? 2 : DERIVE_VERBS.has(verb) ? 1 : 0;
    const needs = unfilledRequiredInputs(option);
    const usedBefore = option.kind === 'input' || queries.some(q => q.connectionId === option.connectionId && q.sourceKey === option.item?.sourceKey);
    const score = (fits ? 3 : 0) + reads + (usedBefore ? 1 : 0) - Math.min(needs.length, 3);
    return { option, score, fits, reads, needs, usedBefore };
  });
  const byScore = (a, b) => b.score - a.score || a.option.query.name.localeCompare(b.option.query.name);
  return {
    main: ranked.filter(r => !isAction(r.option.query)).sort(byScore),
    actions: ranked.filter(r => isAction(r.option.query)).sort(byScore),
  };
}

// The widget binding for a chosen option, once its instance exists.
export function bindingFor({ query, queryId, queryInstanceId, wantsRows, outputField }) {
  if (wantsRows) return { type: 'query', queryInstanceId, queryId, outputFields: [], transform: [] };
  return {
    type: 'query', queryInstanceId, queryId,
    outputField: outputField || defaultOutputField(query),
    transform: returnsRows(query) ? [{ type: 'pickRow', mode: 'last' }] : [],
  };
}
