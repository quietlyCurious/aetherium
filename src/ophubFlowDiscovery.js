// ophubFlowDiscovery.js
// Fetches OpHub's live flow list (via the proxy's /api/ophub/flows route,
// which forwards to /site/ajax/FlowMgr) and maps each flow into an Aetherium
// Query. The discriminator/mapping logic here was designed months ago from a
// static XML export and validated today against FIVE real, structurally
// distinct live flows (Entity, OPC UA read, SQL stored proc, REST) pulled
// straight from a running OpHub instance — the same rules held for all of
// them, so this is a live version of the same import spec, not a new design.

import { encodeOphubDataField } from './restResolver';
import { inferResultCardinality } from './dataModel';

// ─────────────────────────────────────────────────────────────────────────────
// Fetching
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchOphubFlows({ proxyBaseUrl, groupId = null }) {
  if (!proxyBaseUrl) {
    throw new Error(
      'No proxy Base URL provided — pick a Data Source whose Base URL points at your OpHub proxy (e.g. http://localhost:4000).'
    );
  }
  const payload = { command: 'get_queries', group_id: groupId };
  const { body, contentType } = encodeOphubDataField(payload);
  const url = `${proxyBaseUrl.replace(/\/$/, '')}/api/ophub/flows?=${Date.now()}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Accept': 'application/json' },
      body,
    });
  } catch (networkErr) {
    throw new Error(`Couldn't reach ${url} — is the proxy running? (${networkErr.message})`);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Response wasn't valid JSON (status ${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok || json?.status?.success === false) {
    throw new Error(`Flow discovery failed: ${json?.status?.reason || `HTTP ${response.status}`}`);
  }
  return json.flows || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Type discriminator — validated today against real Entity/OPC UA/SQL/REST
// flows. Deliberately does NOT trust the flow's own top-level `type` field
// alone (confirmed today: OPC UA flows are labeled "Entities" there too) —
// looks at the actual query_contents shape instead, same as the original
// static-export import spec.
// ─────────────────────────────────────────────────────────────────────────────

function resolveDiscoveredQueryType(flow) {
  const qc = flow.query_contents || {};
  if (qc.ext_query) {
    return qc.ext_query.requestType === 'write' ? 'opcua_write' : 'opcua_read';
  }
  if (qc.query_type === 'StoredProcedure') {
    return 'sql_sproc';
  }
  if (qc.dataSource?.dataSourceUuid) {
    return 'rest_get';
  }
  if (qc.source?.source_id && qc.source.source_id !== 'custom') {
    return 'entity_read';
  }
  // Fallback to the top-level label if none of the structural signals matched.
  if (flow.type === 'Relational Database') return 'sql_sproc';
  if (flow.type === 'REST') return 'rest_get';
  return 'rest_get';
}

// ─────────────────────────────────────────────────────────────────────────────
// Field mapping
// ─────────────────────────────────────────────────────────────────────────────

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

// Handles both flat scalar outputs ({name, type} — OPC UA/REST dot-path style)
// and grouped Resultset/OutputParameter outputs ({name, queryResultType,
// columns} — SQL style), flattening the latter into individual output rows
// exactly the way the Query editor's own Inputs/Outputs list expects.
function mapOutputs(ioOutputs = []) {
  const outputs = [];
  ioOutputs.forEach(out => {
    if (out.queryResultType === 'Resultset' || out.queryResultType === 'OutputParameter') {
      (out.columns || []).forEach(col => {
        outputs.push({
          name: col.name,
          type: col.type || 'String',
          outputGroup: out.name,
          outputType: out.queryResultType,
        });
      });
    } else {
      outputs.push({
        name: out.name,
        type: out.type || 'String',
        outputGroup: 'default',
        outputType: 'scalar',
      });
    }
  });
  return outputs;
}

function mapConfig(flow, queryType) {
  const qc = flow.query_contents || {};
  const config = {};
  if (queryType === 'opcua_read' || queryType === 'opcua_write') {
    config.samplingMode = qc.ext_query?.samplingMode || 'currentvalue';
    config.qualityThreshold = qc.ext_query?.qualityThreshold || 'Uncertain';
  } else if (queryType === 'sql_sproc') {
    config.schemaName = qc.schemaName || 'dbo';
    config.procName = qc.query || '';
    config.convertDatetimeToLocal = !!qc.convertSQLDatetimeToLocal;
  } else if (queryType === 'rest_get') {
    config.path = qc.api?.url || '';
    config.verb = (qc.api?.verb || 'get').toLowerCase();
    config.request = qc.api?.name || '';
  } else if (queryType === 'entity_read') {
    config.conditions = (qc.conditions || []).map(c => ({
      fieldName: c.field?.column_name,
      paramName: c.comparer?.value,
      operator: c.operator,
    }));
  }
  return config;
}

function mapDirection(queryType, flow) {
  if (queryType === 'opcua_write') return 'write';
  const hasOutputParam = (flow.io?.outputs || []).some(o => o.queryResultType === 'OutputParameter');
  return hasOutputParam ? 'readwrite' : 'read';
}

// Links to an already-synced Aetherium DataSource by matching its stored
// _ophubUuid against the flow's real data source UUID. Returns null (never
// guesses) if no match is found — most commonly because that data source
// hasn't been synced/created in Aetherium yet, or (for OPC UA flows, which
// link via a data_channel rather than a dataSourceUuid) because that linkage
// isn't built yet at all.
function findLinkedDataSourceId(flow, dataSources, queryType) {
  const qc = flow.query_contents || {};
  let targetUuid = null;
  if (queryType === 'rest_get' || queryType === 'sql_sproc') {
    targetUuid = qc.dataSource?.dataSourceUuid || null;
  } else if (queryType === 'entity_read') {
    targetUuid = qc.source?.source_id || null;
  }
  if (!targetUuid) return null;
  const match = dataSources.find(ds => ds._ophubUuid === targetUuid);
  return match ? match.id : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main mapper
// ─────────────────────────────────────────────────────────────────────────────

export function mapOphubFlowToQuery(flow, dataSources, generateId) {
  const queryType = resolveDiscoveredQueryType(flow);
  const inputs = mapInputs(flow.io?.inputs);
  const outputs = mapOutputs(flow.io?.outputs);
  const config = mapConfig(flow, queryType);
  const direction = mapDirection(queryType, flow);
  const dataSourceId = findLinkedDataSourceId(flow, dataSources, queryType);

  const query = {
    id: generateId(),
    name: flow.name || 'Untitled Query',
    description: flow.description || '',
    dataSourceId,
    secondaryDataSourceId: null,
    type: queryType,
    direction,
    inputs,
    outputs,
    config,
    pollInterval: null,
    pushEnabled: false,
    // Import traceability — query_id is the stable external identifier used
    // to detect "already synced this one before" on future syncs.
    _ophubFlowId: null,
    _ophubFlowUuid: flow.query_id,
    _ophubFlowType: flow.type,
  };
  query.resultCardinality = inferResultCardinality(query);
  return query;
}
