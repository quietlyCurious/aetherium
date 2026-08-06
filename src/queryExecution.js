// queryExecution.js
// Executes query instances and produces a per-instance results map that
// ContainerCard's resolveWidgetProps() reads from to fill in Query-type
// bindings with real data. This is the piece connecting everything already
// built (the proxy, the resolver, the binding UI, the row-selection adapter)
// into an actual running loop.

import { evaluateExpression } from './expressionEval';
import { executeRestQuery, parseOpHubHistorianResponse } from './restResolver';

// Same "binding > override > default" priority already used to DISPLAY an
// instance's effective input values in QueryInstanceDetailsPanel — this is
// the execution-time counterpart, returning a plain {fieldName: value}
// object suitable for passing straight into executeRestQuery.
export function resolveEffectiveInputValues(instance, query) {
  const values = {};
  (query.inputs || []).forEach(inputDef => {
    const binding = instance.bindings?.[inputDef.name];
    if (binding?.expression) {
      const resolved = evaluateExpression(binding.expression);
      values[inputDef.name] = resolved === '#ERR' ? (inputDef.defaultValue ?? '') : resolved;
      return;
    }
    const override = (instance.inputOverrides || []).find(o => o.fieldName === inputDef.name);
    if (override) {
      values[inputDef.name] = override.value;
      return;
    }
    values[inputDef.name] = inputDef.defaultValue ?? '';
  });
  return values;
}

// Normalizes a raw query response into a flat array of rows. OPC UA and
// historian-style queries return {status, result: [{timestamp, name,
// quality, value}, ...]} — the shape validated against a real OpHub instance
// earlier — reuses that existing, tested parser directly. Other query types
// (SQL, generic REST) haven't been validated against a live response yet in
// this app; this applies a best-effort fallback rather than assuming a
// specific shape — OpHub's {status, result} envelope pattern held true
// across every endpoint tested so far, so unwrap that if present.
function parseQueryResponse(query, rawJson) {
  if (query.type?.startsWith('opcua')) {
    return parseOpHubHistorianResponse(rawJson);
  }
  const result = rawJson?.result;
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') return [result];
  return [];
}

// Runs one query instance: resolves its effective inputs, executes it via
// the proxy, parses the response, and returns a result object ready to store
// in a per-instance results map. Never throws — errors are captured in the
// returned object so a single failing query can't break the whole page.
export async function runQueryInstance({ instance, query, dataSource }) {
  console.log('[queryExecution] Running instance', instance.id, '— queryId:', instance.queryId);
  if (!query) {
    console.log('[queryExecution] STOPPED: no Query found matching queryId', instance.queryId);
    return { status: 'error', error: 'Query not found', data: null, lastRunAt: Date.now() };
  }
  if (!dataSource) {
    console.log('[queryExecution] STOPPED: no Data Source found matching dataSourceId', query.dataSourceId, 'on query', query.name);
    return { status: 'error', error: 'Data source not found', data: null, lastRunAt: Date.now() };
  }
  try {
    const inputValues = resolveEffectiveInputValues(instance, query);
    console.log('[queryExecution] Calling executeRestQuery for', query.name, 'with inputs:', inputValues);
    const rawJson = await executeRestQuery({ dataSource, query, instance, inputValues });
    console.log('[queryExecution] Raw response for', query.name, ':', rawJson);
    const data = parseQueryResponse(query, rawJson);
    console.log('[queryExecution] Parsed rows for', query.name, ':', data);
    return { status: 'success', data, error: null, lastRunAt: Date.now() };
  } catch (err) {
    console.log('[queryExecution] STOPPED: executeRestQuery threw:', err.message);
    return { status: 'error', error: err.message, data: null, lastRunAt: Date.now() };
  }
}

// Runs every given query instance in parallel and returns a map keyed by
// instance id. Used both for the initial on-load run and each poll tick.
export async function runAllQueryInstances(instances, queries, dataSources) {
  const entries = await Promise.all(instances.map(async (instance) => {
    const query = queries.find(q => q.id === instance.queryId);
    const dataSource = query ? dataSources.find(ds => ds.id === query.dataSourceId) : null;
    const result = await runQueryInstance({ instance, query, dataSource });
    return [instance.id, result];
  }));
  return Object.fromEntries(entries);
}
