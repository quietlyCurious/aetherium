// connections/ophubConnector.js
// The Operations Hub connector: lists a connection's flows as browsable
// query definitions, and runs one. Same shape as every connector (see
// connectionKinds.js) so the Data tab and the runtime never branch on kind.
//
// The flow → query mapping was designed from a static OpHub export and then
// validated against five structurally different live flows (Entity, OPC UA
// read, SQL stored procedure, REST); the same rules held for all of them.

import { postToOphub, buildRunQueryPayload, parseHistorianRows } from './ophubWire';
import { inferResultCardinality, QUERY_TYPE_LABELS } from '../dataModel';

// ── Type discriminator ───────────────────────────────────────────────────────
// Deliberately does NOT trust the flow's top-level `type` alone — live OPC UA
// flows are labelled "Entities" there too. Reads query_contents' shape.
function resolveQueryType(flow) {
  const qc = flow.query_contents || {};
  if (qc.ext_query) return qc.ext_query.requestType === 'write' ? 'opcua_write' : 'opcua_read';
  if (qc.query_type === 'StoredProcedure') return 'sql_sproc';
  if (qc.dataSource?.dataSourceUuid) return 'rest_get';
  if (qc.source?.source_id && qc.source.source_id !== 'custom') return 'entity_read';
  if (flow.type === 'Relational Database') return 'sql_sproc';
  return 'rest_get';
}

function mapInputs(ioInputs = []) {
  return ioInputs.map(inp => ({
    name: inp.name,
    type: inp.type || 'String',
    optional: typeof inp.optional === 'boolean' ? inp.optional : (inp.isOptional === 'true'),
    defaultValue: inp.value ?? null,
    uiHint: inp.defaultValueType?.type || 'text',
    paramType: inp.paramType || null,
  }));
}

// Flat scalar outputs ({name, type} — OPC UA/REST) pass through; grouped
// Resultset/OutputParameter outputs ({name, queryResultType, columns} — SQL)
// flatten into one output per column, tagged with their group.
function mapOutputs(ioOutputs = []) {
  const outputs = [];
  ioOutputs.forEach(out => {
    if (out.queryResultType === 'Resultset' || out.queryResultType === 'OutputParameter') {
      (out.columns || []).forEach(col => outputs.push({
        name: col.name, type: col.type || 'String', outputGroup: out.name, outputType: out.queryResultType,
      }));
    } else {
      outputs.push({ name: out.name, type: out.type || 'String', outputGroup: 'default', outputType: 'scalar' });
    }
  });
  return outputs;
}

// Only what the result shape depends on. The rest of a flow's settings live
// in OpHub, which runs it.
function mapConfig(flow, type) {
  const qc = flow.query_contents || {};
  if (type === 'opcua_read' || type === 'opcua_write') {
    return { samplingMode: qc.ext_query?.samplingMode || 'currentvalue' };
  }
  return {};
}

function mapDirection(type, flow) {
  if (type === 'opcua_write') return 'write';
  const hasOutputParam = (flow.io?.outputs || []).some(o => o.queryResultType === 'OutputParameter');
  return hasOutputParam ? 'readwrite' : 'read';
}

export function flowToDefinition(flow) {
  const type = resolveQueryType(flow);
  const definition = {
    name: flow.name || 'Untitled flow',
    description: flow.description || '',
    type,
    direction: mapDirection(type, flow),
    inputs: mapInputs(flow.io?.inputs),
    outputs: mapOutputs(flow.io?.outputs),
    config: mapConfig(flow, type),
    _ophubFlowUuid: flow.query_id,
  };
  definition.resultCardinality = inferResultCardinality(definition);
  return definition;
}

// SQL and generic REST responses aren't validated against live data yet;
// OpHub's {status, result} envelope held on every endpoint tested, so unwrap
// that. OPC UA uses the validated historian parser.
function toRows(query, json) {
  if (query.type?.startsWith('opcua')) return parseHistorianRows(json);
  if (Array.isArray(json)) return json;
  const result = json?.result;
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') return [result];
  return [];
}

export const ophubConnector = {
  kind: 'ophub',
  label: 'Operations Hub',
  shortLabel: 'OpHub',
  dot: '#1565C0',
  itemNoun: 'queries',
  defaults: { proxyUrl: 'http://localhost:4000', accountId: '', groupId: '' },
  fields: [
    { key: 'proxyUrl', label: 'Proxy URL', placeholder: 'http://localhost:4000', mono: true },
    { key: 'accountId', label: 'Account ID', placeholder: 'e.g. 2' },
    { key: 'groupId', label: 'Query group ID', placeholder: 'All groups' },
  ],

  sourceKey: (definition) => `ophub:${definition._ophubFlowUuid}`,

  // → [{ sourceKey, group, definition }]. Grouped by query type: the live
  // flow list carries only a numeric groupId, not a group name.
  async browse(connection) {
    const json = await postToOphub(connection.proxyUrl, '/api/ophub/flows', {
      command: 'get_queries',
      group_id: connection.groupId === '' || connection.groupId == null ? null : Number(connection.groupId),
    });
    return (json.flows || [])
      .filter(flow => flow.query_id)
      .map(flow => {
        const definition = flowToDefinition(flow);
        return { sourceKey: ophubConnector.sourceKey(definition), group: QUERY_TYPE_LABELS[definition.type] || 'Other', definition };
      });
  },

  async run({ connection, query, instance, inputValues }) {
    const json = await postToOphub(connection.proxyUrl, '/api/ophub/query', buildRunQueryPayload({ connection, query, instance, inputValues }));
    return toRows(query, json);
  },
};
