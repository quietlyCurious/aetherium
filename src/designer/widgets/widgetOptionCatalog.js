// designer/widgets/widgetOptionCatalog.js
// Everything a widget COULD expose — the Widgets area's "Available options"
// list — and how a newly exposed option starts out.
//
// Today the source is widgetConfigs.js (each widget's full DevExtreme
// configuration, flattened into dot paths), plus whatever the widget
// already exposes. That file has gaps: it covers 40 of the 75 widgets,
// charts and gauges are shallow, and many values are null so their type
// can't be read. Where the value doesn't say, the type is guessed from the
// option's name and flagged (`guessed`), and an option can always be added
// by typing its path. A catalog generated from DevExtreme's own typings is
// the planned replacement; it only needs to produce the same entries.
//
// An option: { name, type, value, group, source, guessed? }
//   type    one of WIDGET_PROPERTY_TYPES, or 'unknown' (no value and no
//           name hint). An option whose value is a list or an object (a
//           grid's columns, a gauge's ranges) comes back as 'json' and is
//           edited as raw JSON — there's no form for those.
//   value   the configuration's default, when it has a real one
//   group   for the list: the first path segment, or 'General'
//           (optionNaming.groupForOption — the details panel groups by the
//           same thing)
//   source  'config' | 'exposed'

import WIDGET_CONFIGS from '../../widgetConfigs';
import { labelForOption, groupForOption } from './optionNaming';

// Options that hold the widget's rows/items — collections, bind-only.
const DATA_OPTION_NAMES = new Set(['dataSource', 'items', 'formData']);
// Not worth offering: event handlers and raw DOM attributes.
const SKIPPED = (name, value) => /^on[A-Z]/.test(name.split('.').pop()) || name === 'elementAttr' || typeof value === 'function';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// A type from the option's name alone, for options whose default doesn't
// say (null/undefined). Order matters: colour before the generic endings.
function guessTypeFromName(name) {
  const last = name.split('.').pop();
  if (/color$/i.test(last)) return 'color';
  if (/^(visible|enabled|disabled|readOnly)$|^(show|allow|is|has|use)[A-Z]|Enabled$|Visible$/.test(last)) return 'bool';
  if (/(width|height|size|count|interval|duration|index|angle|opacity|margin|offset|min|max|step|value)$/i.test(last)) return 'number';
  if (/(text|title|label|hint|placeholder|format|name|field|expr|caption|message|src|url|key)$/i.test(last)) return 'string';
  return 'unknown';
}

export function inferOptionType(name, value) {
  const last = name.split('.').pop();
  if (DATA_OPTION_NAMES.has(last)) return { type: 'data' };
  if (value === null || value === undefined) {
    const type = guessTypeFromName(name);
    return type === 'unknown' ? { type } : { type, guessed: true };
  }
  if (typeof value === 'boolean') return { type: 'bool' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'string') return { type: HEX.test(value) || /color$/i.test(last) ? 'color' : 'string' };
  return { type: 'json' };
}

function flatten(config, prefix, out) {
  Object.entries(config).forEach(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (SKIPPED(name, value)) return;
    const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject && Object.keys(value).length > 0 && !DATA_OPTION_NAMES.has(key)) {
      flatten(value, name, out);
      return;
    }
    const { type, guessed } = inferOptionType(name, value);
    const option = { name, type, group: groupForOption(name), source: 'config' };
    if (value !== null && value !== undefined) option.value = value;
    if (guessed) option.guessed = true;
    out.push(option);
  });
  return out;
}

export function hasConfigCatalog(widgetName) {
  return !!WIDGET_CONFIGS[widgetName];
}

// The available options for one widget: its configuration's, plus any
// exposed property the configuration doesn't list (so everything exposed
// always has a row to untick). Sorted by group, 'General' first, then name.
export function getWidgetOptionCatalog(widgetName, exposedDefs = []) {
  const options = WIDGET_CONFIGS[widgetName] ? flatten(WIDGET_CONFIGS[widgetName], '', []) : [];
  const known = new Set(options.map(o => o.name));
  exposedDefs.forEach(def => {
    if (known.has(def.name)) return;
    options.push({ name: def.name, type: def.type, group: groupForOption(def.name), source: 'exposed' });
  });
  return options.sort((a, b) => (
    (a.group === 'General' ? -1 : 0) - (b.group === 'General' ? -1 : 0)
    || a.group.localeCompare(b.group)
    || a.name.localeCompare(b.name)
  ));
}

// ── A newly exposed option's definition ────────────────────────────────────

const DEFAULT_BY_TYPE = { string: '', number: 0, bool: false, color: '', data: [], enum: undefined, json: undefined };

export function defaultForType(type, options) {
  if (type === 'enum') return options?.[0];
  return DEFAULT_BY_TYPE[type];
}

// The definition a ticked option starts with. 'unknown' starts as a
// string — the type is under the row's ⋯ to change. Label and group are
// left off: both are derived from the path (optionNaming), and storing
// them would only pin down what's already right.
export function defFromOption(option) {
  const type = option.type === 'unknown' ? 'string' : option.type;
  const def = { name: option.name, label: labelForOption(option.name), type };
  const fallback = defaultForType(type);
  const value = option.value !== undefined ? option.value : fallback;
  if (value !== undefined) def.default = value;
  return def;
}

// A typed-in option path: letters, digits, _ and $, dot-separated.
export function isValidOptionPath(path) {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path);
}
