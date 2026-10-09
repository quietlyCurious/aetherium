// Classic data-source objects  ->  new-designer plugin binding objects.
//
// Classic native widgets describe a value as   { type: 'manual'|'flow'|'formula'|'upload', value, ...LastValue }
// where a 'flow' value points at a query output ({ioType:'outputs', flowInstanceId, fieldName})
// or at a global ({ioType:'globals', id, fieldName}).
// New-designer plugins describe it as          { type: 'manual'|'query'|'global'|'formula', manual, query, global, id }.

import { newId } from './util.js';
import { SEVERITY } from './report.js';

const EMPTY_QUERY = () => ({ outputFields: [null], outputFieldsAliases: [null] });

/** Lookup of a page's queries by flowInstanceId (the key every binding uses). */
export class FlowIndex {
  constructor(pageFlows) {
    this.byInstance = new Map();
    for (const f of pageFlows || []) {
      const id = f?.flow_metadata?.flowInstanceId;
      if (id != null) this.byInstance.set(Number(id), f);
    }
  }

  get(flowInstanceId) { return this.byInstance.get(Number(flowInstanceId)); }

  /** Output-field definition as plugins store it; synthesized if the query doesn't list the field. */
  outputField(flow, fieldName) {
    const outs = flow?.flow_metadata?.outputs || [];
    const found = outs.find((o) => o.fieldName === fieldName);
    if (found) {
      return {
        fieldName: found.fieldName,
        fieldType: found.fieldType || 'String',
        manualValueType: found.manualValueType || 'text',
        defaultValueType: { type: found.manualValueType || 'text', value: found.fieldName },
      };
    }
    return { fieldName, fieldType: 'String', manualValueType: 'text', defaultValueType: { type: 'text', value: fieldName } };
  }
}

/** Lookup of app globals by id, for binding display names. */
export class GlobalIndex {
  constructor(globals) {
    this.byId = new Map((globals || []).map((g) => [g.id, g]));
  }
  name(id, fallback) { return this.byId.get(id)?.name ?? fallback ?? ''; }
  has(id) { return this.byId.has(id); }
}

export function manualBinding(value) {
  return { type: 'manual', manual: value ?? '', global: {}, query: EMPTY_QUERY(), id: newId() };
}

export function globalBinding(id, name) {
  return { type: 'global', global: { id, name }, query: EMPTY_QUERY(), id: newId() };
}

/** Binding to one or more output fields of a query (empty field list = all outputs). */
export function queryBinding(ctx, flowInstanceId, fieldNames, notes) {
  const flow = ctx.flows.get(flowInstanceId);
  if (!flow) {
    notes?.push({ severity: SEVERITY.WARN, text: `Bound to query instance #${flowInstanceId}, which is not on this page; binding left empty.` });
    return { type: 'query', global: {}, query: EMPTY_QUERY(), id: newId() };
  }
  const names = fieldNames && fieldNames.length
    ? fieldNames
    : (flow.flow_metadata.outputs || []).map((o) => o.fieldName);
  const outputFields = names.map((n) => ctx.flows.outputField(flow, n));
  return {
    type: 'query',
    global: {},
    query: {
      outputFields: outputFields.length ? outputFields : [null],
      outputFieldsAliases: outputFields.length ? outputFields.map(() => null) : [null],
      name: flow.alias || flow.flow_metadata.name,
      query_id: flow.flow_id,
      flowInstanceId: Number(flowInstanceId),
    },
    id: newId(),
  };
}

function formulaBinding(value, notes) {
  notes?.push({ severity: SEVERITY.WARN, text: 'Formula binding carried over as-is; open it in the new designer to confirm it evaluates.' });
  const data = { type: 'formula', lastType: 'formula', flowLastValue: '', value, formulaLastValue: value };
  return { type: 'formula', formula: { data, source: data }, global: {}, query: EMPTY_QUERY(), id: newId() };
}

/** True when a classic flow reference points at a global rather than a query output. */
function isGlobalRef(v) {
  return v && (v.ioType === 'globals' || v.type === 'globals');
}

/**
 * Convert a classic `source` object to a plugin binding.
 * @param ctx   { flows: FlowIndex, globals: GlobalIndex }
 * @param notes array that receives {severity, text} for anything lossy
 */
export function toPluginBinding(ctx, source, notes) {
  if (!source || typeof source !== 'object') return manualBinding('');
  switch (source.type) {
    case 'manual':
      return manualBinding(source.value ?? source.manualLastValue ?? '');
    case 'flow': {
      const v = source.value;
      if (!v || typeof v !== 'object' || (v.flowInstanceId == null && !isGlobalRef(v))) return manualBinding('');
      if (isGlobalRef(v)) return globalBinding(v.id, ctx.globals.name(v.id, v.fieldName));
      return queryBinding(ctx, v.flowInstanceId, [v.fieldName], notes);
    }
    case 'global':
      return globalBinding(source.value?.id ?? source.value, ctx.globals.name(source.value?.id ?? source.value));
    case 'formula':
      return formulaBinding(source.value, notes);
    default:
      notes?.push({ severity: SEVERITY.WARN, text: `Unrecognized data source type "${source.type}"; binding left empty.` });
      return manualBinding('');
  }
}
