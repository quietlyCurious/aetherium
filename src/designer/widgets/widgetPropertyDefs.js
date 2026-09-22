// designer/widgets/widgetPropertyDefs.js
// The one place anything asks "which properties does this widget expose?"
// — the Screens details panel (single and multi-select), dropping a new
// widget, binding resolution, and the binding popover all call
// getWidgetPropertyDefs rather than reading widgetProperties.js.
//
// Two layers:
//   shipped   src/widgetProperties.js — committed, what everyone gets
//   saved     the Widgets area's edits (widgetPropertyOverridesStorage),
//             per widget, in this browser only
// A widget with saved edits uses its saved list IN FULL — not a diff
// against the shipped one. That keeps "what you see in the Widgets area is
// exactly what the designer gets" true, at the cost that a later change to
// the shipped list for that widget doesn't show through until you Reset it.
// Export writes the merged result as a new widgetProperties.js; once that's
// committed, saved lists that now match it are dropped on the next load.
//
// A module-level store (like unsavedChangesStore) because its readers are
// scattered through the Screens editor and its writer is a different area.

import { useSyncExternalStore } from 'react';
import { WIDGET_PROPERTIES } from '../../widgetProperties';
import { loadWidgetPropertyOverrides, saveWidgetPropertyOverrides } from '../../widgetPropertyOverridesStorage';
import { stableStringify } from '../../unsavedChangesStore';

export const WIDGET_PROPERTY_TYPES = ['string', 'number', 'bool', 'enum', 'color', 'data'];

const NO_DEFS = [];

// Keeps only well-formed definitions, so a hand-edited or stale storage
// entry can't break the details panel.
export function sanitizeDefs(defs) {
  if (!Array.isArray(defs)) return null;
  const seen = new Set();
  return defs.filter(d => {
    if (!d || typeof d.name !== 'string' || !d.name || seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  }).map(d => ({
    ...d,
    label: typeof d.label === 'string' && d.label ? d.label : d.name,
    type: WIDGET_PROPERTY_TYPES.includes(d.type) ? d.type : 'string',
  }));
}

export function sameDefs(a, b) {
  return stableStringify(a || NO_DEFS) === stableStringify(b || NO_DEFS);
}

// Loaded once; saved lists that match what ships are dropped (that's how an
// exported-and-committed list stops being an override).
function initialOverrides() {
  const raw = loadWidgetPropertyOverrides();
  const clean = {};
  let changed = false;
  Object.entries(raw).forEach(([name, entry]) => {
    const defs = sanitizeDefs(entry?.properties);
    if (!defs || sameDefs(defs, WIDGET_PROPERTIES[name])) { changed = true; return; }
    clean[name] = { ...entry, properties: defs };
  });
  if (changed) saveWidgetPropertyOverrides(clean);
  return clean;
}

let overrides = initialOverrides();
const listeners = new Set();

function publish(next) {
  overrides = next;
  saveWidgetPropertyOverrides(next);
  listeners.forEach(listener => listener());
}

export function getShippedWidgetPropertyDefs(widgetName) {
  return WIDGET_PROPERTIES[widgetName] || NO_DEFS;
}

export function getWidgetPropertyDefs(widgetName) {
  return overrides[widgetName]?.properties || getShippedWidgetPropertyDefs(widgetName);
}

export function getWidgetPropertyDef(widgetName, propName) {
  return getWidgetPropertyDefs(widgetName).find(p => p.name === propName);
}

export function isWidgetCustomized(widgetName) {
  return !!overrides[widgetName];
}

export function saveWidgetPropertyDefs(widgetName, defs) {
  const clean = sanitizeDefs(defs) || [];
  const { [widgetName]: _previous, ...rest } = overrides;
  publish(sameDefs(clean, WIDGET_PROPERTIES[widgetName])
    ? rest
    : { ...rest, [widgetName]: { properties: clean, savedAt: new Date().toISOString() } });
}

export function resetWidgetPropertyDefs(widgetName) {
  if (!overrides[widgetName]) return;
  const { [widgetName]: _dropped, ...rest } = overrides;
  publish(rest);
}

// Every widget's effective list — what Export writes. Widgets with neither
// a shipped nor a saved list are left out.
export function getAllWidgetPropertyDefs() {
  const all = { ...WIDGET_PROPERTIES };
  Object.entries(overrides).forEach(([name, entry]) => { all[name] = entry.properties; });
  return all;
}

export const widgetPropertyDefsStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => overrides,
};

// Re-renders the caller whenever saved lists change. The value is the
// overrides map itself; most callers just want the re-render and then use
// the getters above.
export function useWidgetPropertyOverrides() {
  return useSyncExternalStore(widgetPropertyDefsStore.subscribe, widgetPropertyDefsStore.getSnapshot);
}

// The details panel's sections: properties with no group first, under no
// heading (every shipped list today), then each group in first-seen order.
export function groupWidgetPropertyDefs(defs) {
  const groups = [];
  const byName = new Map();
  (defs || NO_DEFS).forEach(def => {
    const key = def.group || '';
    if (!byName.has(key)) {
      const group = { group: key, defs: [] };
      byName.set(key, group);
      if (key) groups.push(group); else groups.unshift(group);
    }
    byName.get(key).defs.push(def);
  });
  return groups;
}

// A new widget's starting props: every exposed property's default. Ones
// without a default are left unset, so DevExtreme's own default applies.
export function defaultPropsFor(widgetName) {
  const props = {};
  getWidgetPropertyDefs(widgetName).forEach(p => {
    if (p.default !== undefined) props[p.name] = p.default;
  });
  return props;
}
