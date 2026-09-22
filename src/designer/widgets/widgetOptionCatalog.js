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
//   type    one of WIDGET_PROPERTY_TYPES, 'complex' (arrays of objects,
//           functions, empty objects — needs its own editor, can't be
//           exposed yet) or 'unknown' (no value and no name hint)
//   value   the configuration's default, when it has a real one
//   group   for the list: the first path segment, or 'General'
//   source  'config' | 'exposed'

import WIDGET_CONFIGS from '../../widgetConfigs';

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
  return { type: 'complex' };
}

function groupOf(name) {
  const dot = name.indexOf('.');
  if (dot < 0) return 'General';
  const first = name.slice(0, dot);
  return first.charAt(0).toUpperCase() + first.slice(1);
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
    const option = { name, type, group: groupOf(name), source: 'config' };
    if (value !== null && value !== undefined && type !== 'complex') option.value = value;
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
    options.push({ name: def.name, type: def.type, group: groupOf(def.name), source: 'exposed' });
  });
  return options.sort((a, b) => (
    (a.group === 'General' ? -1 : 0) - (b.group === 'General' ? -1 : 0)
    || a.group.localeCompare(b.group)
    || a.name.localeCompare(b.name)
  ));
}

export function canExpose(option) {
  return option.type !== 'complex';
}

// ── A newly exposed option's definition ────────────────────────────────────

function humanize(word) {
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

// Last segments too generic to be a label on their own: 'title.text' reads
// as "Title", 'tooltip.enabled' as "Tooltip Enabled".
const GENERIC_LAST = new Set(['text', 'visible', 'enabled', 'color', 'width', 'mode', 'position', 'format']);

export function labelForOption(name) {
  const parts = name.split('.');
  const last = parts[parts.length - 1];
  if (parts.length > 1 && GENERIC_LAST.has(last)) {
    const parent = humanize(parts[parts.length - 2]);
    return last === 'text' ? parent : `${parent} ${humanize(last)}`;
  }
  return humanize(last);
}

const DEFAULT_BY_TYPE = { string: '', number: 0, bool: false, color: '', data: [], enum: undefined };

export function defaultForType(type, options) {
  if (type === 'enum') return options?.[0];
  return DEFAULT_BY_TYPE[type];
}

// The definition a ticked option starts with. 'unknown' starts as a
// string — the type column is right there to change it.
export function defFromOption(option) {
  const type = option.type === 'unknown' || option.type === 'complex' ? 'string' : option.type;
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
