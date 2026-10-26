// customWidgets/embeddedView/viewParameters.js
// Parameters, the same for every kind of embedded view: a ThingWorx mashup's
// parameters, an OpHub page's. Each one the view declares becomes a property
// of the widget, bound or typed like any other, and its value goes into the
// view's URL.
//
// A declared parameter: { name, baseType, description?, defaultValue? }
// (baseType in ThingWorx's terms — STRING, NUMBER, BOOLEAN… — which is also
// what an OpHub parameter is recorded as).

import { sourceIdOf } from './viewSources';

// A parameter becomes a widget property under this prefix — 'params.Site' —
// so the normal binding machinery handles it, and expandDotPaths hands the
// widget one `params` object.
export const PARAM_PREFIX = 'params.';
export const paramPropName = (name) => `${PARAM_PREFIX}${name}`;

// The parameters a widget's view declares. Each source keeps its own list,
// so switching between them loses nothing:
//   mashupParameters  a ThingWorx mashup's, read from its definition
//   pageParameters    an OpHub page's: its URL Globals (fromOphub) and any
//                     named by hand (byHand)
export function declaredParametersOf(widgetProps) {
  const list = sourceIdOf(widgetProps) === 'ophub' ? widgetProps?.pageParameters : widgetProps?.mashupParameters;
  return Array.isArray(list) ? list : [];
}

// How a value reaches the view: everything is text in a URL. Blank values
// are left out so the view's own default applies.
export function paramValueToText(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// → ['Site=Plant%201', …] for the parameters the view declares — a stale
// value left behind by a renamed parameter doesn't leak through.
export function encodeParams(params, declared) {
  const allowed = declared ? new Set(declared.map(p => p.name)) : null;
  const parts = [];
  Object.entries(params || {}).forEach(([name, value]) => {
    if (allowed && !allowed.has(name)) return;
    const text = paramValueToText(value);
    if (text !== null) parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(text)}`);
  });
  return parts;
}

const NUMBER_TYPES = new Set(['NUMBER', 'INTEGER', 'LONG']);
// A table can't travel in a URL; these need the live bridge (step 3).
export const URL_UNSAFE_TYPES = new Set(['INFOTABLE']);

export function isUrlPassable(param) {
  return !URL_UNSAFE_TYPES.has(String(param.baseType || '').toUpperCase());
}

// One widget property per parameter, grouped under "Parameters" in the
// details panel.
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

export function sameParameters(a, b) {
  const key = (list) => JSON.stringify((list || []).map(p => [p.name, p.baseType]));
  return key(a) === key(b);
}
