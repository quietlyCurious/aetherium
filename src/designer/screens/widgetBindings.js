// designer/screens/widgetBindings.js
// Turns a widget's saved props and bindings into the props it renders
// with. Lived as private functions inside ContainerCard; pulled out so
// anything that renders a saved screen resolves bindings exactly the way
// the canvas and the runtime view do.
//
// A binding is `{ type, ... }` per widget property. Each type has one
// resolver in BINDING_RESOLVERS below; a resolver either returns the value
// to use, or LEAVE_STATIC to keep the widget's own static value (still
// loading, errored, no data). Supporting a new kind of binding — say, a
// value taken from the asset a screen is currently showing — is one more
// entry there plus whatever it needs in `context`.
//
// `context` carries the data the resolvers read:
//   queryResults — { [queryInstanceId]: { status, data, error } }, from
//                  running the screen's query instances (see
//                  usePageQueryResults)
//   queries      — the query definitions, for resolvers that need them

import { evaluateExpression } from '../../expressionEval';
import { WIDGET_PROPERTIES } from '../../widgetData';

export const LEAVE_STATIC = Symbol('leave static value');

// Resolves a query-type binding to a concrete value for one widget property.
// A query's result is fundamentally table-shaped (rows) — even a single
// output field can come back as multiple rows (e.g. several historian
// samples) — so this reconciles that against what the property actually
// needs, mirroring the adapter logic built into WidgetBindingPopover:
//  - a stored `pickRow` transform (set when the popover detected a scalar
//    property bound to a multi-row query) reduces the series to one value.
//  - no transform + a naturally-scalar query (one row) → use that value.
//  - a collection-typed property always gets the full array — a single row
//    naturally becomes a one-item list, same as the "auto-wrap" note shown
//    in the popover.
export function resolveQueryBindingValue(binding, queryResults, isCollectionProp) {
  const result = queryResults?.[binding.queryInstanceId];
  if (!result || result.status !== 'success' || !Array.isArray(result.data)) return undefined;

  // Collection-typed properties (chart/grid dataSource, etc.) bind to the
  // query's result set. If specific fields were selected (outputFields),
  // each row is narrowed to just those columns — needed for widgets like a
  // grid where showing every returned column isn't always wanted. No fields
  // selected means "everything" — the raw row objects, unfiltered.
  if (isCollectionProp) {
    const fieldNames = (binding.outputFields || []).map(f => f.fieldName);
    if (fieldNames.length === 0) return result.data;
    return result.data.map(row => {
      const filtered = {};
      fieldNames.forEach(fn => { filtered[fn] = row[fn]; });
      return filtered;
    });
  }

  // Scalar properties: outputField is a genuine COLUMN NAME within each row
  // (flat historian rows {timestamp, name, quality, value} and SQL-ish
  // column-keyed rows alike), never a value to filter rows BY. (An earlier
  // version filtered rows where row.name === outputField, which could never
  // match: row.name holds a tag path like "FIX.SF_WINDTURBINE06>...", never
  // the literal string "value" — that filter always returned nothing.)
  const values = result.data.map(row => row[binding.outputField]).filter(v => v !== undefined);

  const pickRow = binding.transform?.find(t => t.type === 'pickRow');
  if (pickRow) {
    if (values.length === 0) return undefined;
    return pickRow.mode === 'first' ? values[0] : values[values.length - 1];
  }
  // No transform stored — the normal case when the query is naturally
  // scalar. Falls back to the most recent value defensively otherwise.
  return values.length > 0 ? values[values.length - 1] : undefined;
}

export const BINDING_RESOLVERS = {
  // A client-side expression. Evaluated even at design time, so the canvas
  // shows the same value the runtime will.
  expression: (binding) => (
    binding.expression != null ? evaluateExpression(binding.expression) : LEAVE_STATIC
  ),

  // A query instance's output. Undefined (still loading, errored, or no
  // data yet) leaves the static default in place rather than blanking the
  // widget out.
  query: (binding, { propDef, context }) => {
    const value = resolveQueryBindingValue(binding, context.queryResults, propDef?.type === 'data');
    return value === undefined ? LEAVE_STATIC : value;
  },
};

// Converts flat dot-notation keys ("pager.visible": true) into properly
// nested objects ({ pager: { visible: true } }) — DevExtreme's React
// components expect a real nested prop, not a flat key that happens to
// contain a dot in its name, which is genuinely a different thing and gets
// silently ignored (React just passes it through as an unrecognized prop).
// This affects every dot-notation property across the whole widget catalog,
// not just one widget — applied once, centrally, here.
export function expandDotPaths(flatProps) {
  const expanded = {};
  Object.entries(flatProps).forEach(([key, value]) => {
    if (!key.includes('.')) {
      if (typeof expanded[key] === 'object' && expanded[key] !== null && typeof value === 'object' && value !== null) {
        expanded[key] = { ...expanded[key], ...value };
      } else {
        expanded[key] = value;
      }
      return;
    }
    const parts = key.split('.');
    let cursor = expanded;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = { ...(cursor[part] || {}) };
      }
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
  });
  return expanded;
}

// Merges static widgetProps with resolved binding values. Binding values
// take precedence over static props at render time; a binding of a type
// with no resolver is ignored.
export function resolveWidgetProps(widgetProps, bindings, widgetName, context = {}) {
  const resolved = { ...(widgetProps || {}) };
  const propDefs = WIDGET_PROPERTIES[widgetName] || [];
  Object.entries(bindings || {}).forEach(([propName, binding]) => {
    // Own keys only, so a stray type like 'constructor' can't reach an
    // inherited Object method.
    if (!binding || !Object.prototype.hasOwnProperty.call(BINDING_RESOLVERS, binding.type)) return;
    const resolve = BINDING_RESOLVERS[binding.type];
    const propDef = propDefs.find(p => p.name === propName);
    const value = resolve(binding, { propDef, context });
    if (value !== LEAVE_STATIC) resolved[propName] = value;
  });
  return expandDotPaths(resolved);
}
