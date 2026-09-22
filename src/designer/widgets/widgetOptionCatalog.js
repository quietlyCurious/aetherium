// designer/widgets/widgetOptionCatalog.js
// Everything a widget COULD expose — the Widgets area's option list — and
// how a newly exposed option starts out.
//
// The list comes from public/data/widget-options.json, generated from
// DevExtreme's own declarations (scripts/generateWidgetOptions.js): all 75
// widgets, real types, and an enum's actual choices. Defaults are merged
// into it from widgetConfigs.js where that file has them.
//
// If the file can't be loaded, the area falls back to flattening
// widgetConfigs.js in the browser, which is how this worked before the
// file existed: 40 of the 75 widgets, shallow for charts and gauges, and
// many values null, so types are guessed from the option's name and
// flagged (`guessed`). Either way an option can be added by typing its
// path, so nothing is unreachable.
//
// An option: { name, type, value, choices, group, source, guessed? }
//   type    one of WIDGET_PROPERTY_TYPES, or 'unknown' (fallback only: no
//           value and no name hint). An option holding a list or an object
//           (a grid's columns, a gauge's ranges) is 'json' and is edited as
//           raw JSON — there's no form for those.
//   value   the default the widget starts with, where it's known
//   choices an enum's values, from the declarations
//   group   for the list: the first path segment, or 'General'
//           (optionNaming.groupForOption — the details panel groups by the
//           same thing)
//   source  'catalog' | 'config' | 'exposed'

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

// Whether the fallback has anything for this widget — only meaningful
// when the generated file didn't load.
export function hasConfigCatalog(widgetName) {
  return !!WIDGET_CONFIGS[widgetName];
}

// One generated entry ({ n, t, o?, d? }) as an option.
function fromGenerated(entry) {
  const option = { name: entry.n, type: entry.t, group: groupForOption(entry.n), source: 'catalog' };
  if (entry.o) option.choices = entry.o;
  if (entry.d !== undefined) option.value = entry.d;
  // The generated file types an enum by its choices; with none it's text.
  if (option.type === 'enum' && !option.choices) option.type = 'string';
  return option;
}

// The available options for one widget: the generated list when it loaded
// (`generated` is the file's `widgets` map, or null), else the flattened
// configuration — plus any exposed property neither knows about, so
// everything exposed always has a row to untick. Sorted by group, 'General'
// first, then name.
export function getWidgetOptionCatalog(widgetName, exposedDefs = [], generated = null) {
  const fromFile = generated?.[widgetName];
  const options = fromFile
    ? fromFile.map(fromGenerated)
    : (WIDGET_CONFIGS[widgetName] ? flatten(WIDGET_CONFIGS[widgetName], '', []) : []);
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
  if (type === 'enum' && option.choices) def.options = option.choices;
  const fallback = defaultForType(type, def.options);
  const value = option.value !== undefined ? option.value : fallback;
  if (value !== undefined) def.default = value;
  return def;
}

// A typed-in option path: letters, digits, _ and $, dot-separated.
export function isValidOptionPath(path) {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path);
}
