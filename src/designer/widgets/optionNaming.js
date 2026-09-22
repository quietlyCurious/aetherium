// designer/widgets/optionNaming.js
// What a DevExtreme option is called, worked out from its path — the label
// the details panel shows and the group it sits under. Both are derived
// rather than stored, so a property picks them up without anyone typing
// anything; a definition's own `label`/`group` override them.
//
// Its own file because two sides need it: the option catalog (naming a
// newly exposed option) and widgetPropertyDefs (grouping whatever a widget
// exposes today, including the shipped lists, which carry no groups).

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

// The first part of the path — 'Scale' for scale.startValue — and
// 'General' for an option with no path at all. The options list and the
// details panel group by the same thing, so what you tick under Scale
// arrives under Scale.
export const GENERAL_GROUP = 'General';

export function groupForOption(name) {
  const dot = name.indexOf('.');
  if (dot < 0) return GENERAL_GROUP;
  return humanize(name.slice(0, dot));
}

// A definition's effective group: its own, else the one its path implies.
export function groupOfDef(def) {
  return def.group || groupForOption(def.name);
}
