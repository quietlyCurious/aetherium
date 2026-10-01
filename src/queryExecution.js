// queryExecution.js
// Runs query instances and produces a per-instance results map that
// ContainerCard's resolveWidgetProps() reads to fill in Query-type bindings
// with real data. Each query runs through its connection's connector
// (connections/connectionKinds.js), so this file never branches on kind.

import { evaluateExpression } from './expressionEval';
import { connectorFor } from './connections/connectionKinds';

// Same "binding > override > default" priority QueryInstanceDetailsPanel
// uses to DISPLAY an instance's effective inputs — this is the execution-time
// counterpart, a plain {fieldName: value} object.
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

const failed = (error) => ({ status: 'error', error, data: null, lastRunAt: Date.now() });

// Runs one query instance. Never throws — an error is captured in the result
// so one failing query can't break the whole page.
export async function runQueryInstance({ instance, query, connection }) {
  if (!query) return failed('Query not found');
  if (!connection) return failed('Connection not found');
  const connector = connectorFor(connection);
  if (!connector) return failed(`Unknown connection kind "${connection.kind}"`);
  try {
    const inputValues = resolveEffectiveInputValues(instance, query);
    const data = await connector.run({ connection, query, instance, inputValues });
    return { status: 'success', data, error: null, lastRunAt: Date.now() };
  } catch (err) {
    return failed(err.message);
  }
}

// Runs every given instance in parallel; returns results keyed by instance
// id. Used for the on-load run and each poll tick.
export async function runAllQueryInstances(instances, queries, connections) {
  const entries = await Promise.all(instances.map(async (instance) => {
    const query = queries.find(q => q.id === instance.queryId);
    const connection = query ? connections.find(c => c.id === query.connectionId) : null;
    return [instance.id, await runQueryInstance({ instance, query, connection })];
  }));
  return Object.fromEntries(entries);
}
