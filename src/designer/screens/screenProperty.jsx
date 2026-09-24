// designer/screens/screenProperty.jsx
// A screen that's about a property: the smallest fragment. Where a screen
// about a type is drawn for one asset at a time, a screen about a property
// is drawn for one property of one asset at a time — "Oil temperature on
// T07's gearbox" — and its widgets bind to that property's value, range,
// unit, history and so on (⚡ → Property). One such screen works for any
// property of any asset, in any model, which is what lets it stand in for
// Text / Indicator / Spark / All as a property's visual
// (operator/properties/PropertyScreenTile.jsx).
//
// The context lives on the root container like a type's does, as
// { kind: 'property' } — no model or type, since it isn't tied to either.
// pageContextOf (screenAsset.jsx) only answers for type screens, so a
// property screen is never found by a repeater's by-type lookup.
//
// Self travels as a React context, the same way the asset self does:
// <ScreenPropertyProvider assetId propertyKey value?> around the screen,
// useScreenProperty() inside it. `value` is optional and wins over the
// model's current value — a box being time-scrubbed passes the reading it
// is showing, so a custom tile moves with the built-in ones.

import { createContext, useContext } from 'react';
import { ROOT_CONTAINER_ID } from '../../containerModel';
import {
  ASSET_TELEMETRY, ASSET_VALUES, CURRENT_ASSET_MAP, CURRENT_TIMESTAMPS,
  PROPERTY_DECIMALS, PROPERTY_LABELS, PROPERTY_RANGES, PROPERTY_UNITS,
} from '../../model/modelData';

export const PROPERTY_CONTEXT_KIND = 'property';

// ─────────────────────────────────────────────────────────────────────────────
// The page's context
// ─────────────────────────────────────────────────────────────────────────────

export const PROPERTY_CONTEXT = { kind: PROPERTY_CONTEXT_KIND };

export function isPropertyContext(context) {
  return context?.kind === PROPERTY_CONTEXT_KIND;
}

// Whether a saved screen (its container tree) is about a property.
export function isPropertyScreen(containers) {
  const root = (containers || []).find(c => c.id === ROOT_CONTAINER_ID);
  return isPropertyContext(root?.context);
}

// ─────────────────────────────────────────────────────────────────────────────
// Self
// ─────────────────────────────────────────────────────────────────────────────

const ScreenPropertyContext = createContext(null);

export function ScreenPropertyProvider({ assetId, propertyKey, value, children }) {
  const self = assetId && propertyKey ? { assetId, propertyKey, value } : null;
  return <ScreenPropertyContext.Provider value={self}>{children}</ScreenPropertyContext.Provider>;
}

// { assetId, propertyKey, value? } the enclosing screen is showing, or null.
export function useScreenProperty() {
  return useContext(ScreenPropertyContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// What a property binding can read
// ─────────────────────────────────────────────────────────────────────────────

// A binding is { type: 'property', field }. `collection` fields fit a
// widget's data property (a Chart's or Grid's dataSource); the rest fit
// scalar properties. The popover offers whichever fit.
export const PROPERTY_FIELDS = [
  { id: 'value', label: 'Value', note: 'the current reading' },
  { id: 'display', label: 'Value with unit', note: 'formatted text, e.g. "68.4 °C"' },
  { id: 'label', label: 'Label', note: "the property's name" },
  { id: 'unit', label: 'Unit' },
  { id: 'min', label: 'Min', note: 'bottom of its range' },
  { id: 'max', label: 'Max', note: 'top of its range' },
  { id: 'percent', label: 'Percent of range', note: '0–100, where the value sits between min and max' },
  { id: 'assetName', label: 'Asset name' },
  { id: 'history', label: 'History', note: 'rows of { timestamp, value }', collection: true },
];

export function propertyFieldsFor(wantsCollection) {
  return PROPERTY_FIELDS.filter(f => !!f.collection === !!wantsCollection);
}

export function propertyFieldLabel(fieldId) {
  return PROPERTY_FIELDS.find(f => f.id === fieldId)?.label || fieldId;
}

export const PROPERTY_FIELD_ERRORS = {
  noProperty: "this screen isn't showing a property",
  noValue: 'this asset has no value for it',
  noRange: 'this property has no range',
  notNumber: "this property's value isn't a number",
  noSeries: 'this property has no history',
  unknownField: 'unknown field',
};

function currentValue(self) {
  return self.value !== undefined ? self.value : ASSET_VALUES[self.assetId]?.[self.propertyKey];
}

function formatValue(value, key) {
  const decimals = PROPERTY_DECIMALS[key];
  const text = typeof value === 'number' && decimals != null ? value.toFixed(decimals) : String(value);
  const unit = PROPERTY_UNITS[key];
  return unit ? `${text} ${unit}` : text;
}

// What `field` reads for this self.
// → { value } for scalar fields, { rows } for history, or { error } (a
// PROPERTY_FIELD_ERRORS key).
export function resolvePropertyField(self, field) {
  if (!self?.assetId || !self?.propertyKey) return { error: 'noProperty' };
  const key = self.propertyKey;
  const range = PROPERTY_RANGES[key];
  switch (field) {
    case 'value': {
      const value = currentValue(self);
      return value === undefined ? { error: 'noValue' } : { value };
    }
    case 'display': {
      const value = currentValue(self);
      return value === undefined ? { error: 'noValue' } : { value: formatValue(value, key) };
    }
    case 'label':
      return { value: PROPERTY_LABELS[key] || key };
    case 'unit':
      return { value: PROPERTY_UNITS[key] || '' };
    case 'min':
      return range ? { value: range[0] } : { error: 'noRange' };
    case 'max':
      return range ? { value: range[1] } : { error: 'noRange' };
    case 'percent': {
      const value = currentValue(self);
      if (value === undefined) return { error: 'noValue' };
      if (typeof value !== 'number') return { error: 'notNumber' };
      if (!range || !(range[1] > range[0])) return { error: 'noRange' };
      const pct = ((value - range[0]) / (range[1] - range[0])) * 100;
      return { value: Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10 };
    }
    case 'assetName':
      return { value: CURRENT_ASSET_MAP[self.assetId]?.name || self.assetId };
    case 'history': {
      const series = ASSET_TELEMETRY?.series?.[self.assetId]?.[key];
      if (!Array.isArray(series)) return { error: 'noSeries' };
      return { rows: series.map((value, i) => ({ timestamp: CURRENT_TIMESTAMPS[i], value })) };
    }
    default:
      return { error: 'unknownField' };
  }
}

// "Percent of range", or "Percent of range — this property has no range"
// when it can't resolve for this self.
export function describePropertyBinding(binding, self) {
  const label = propertyFieldLabel(binding?.field);
  if (!self) return { text: label, problem: 'noProperty' };
  const result = resolvePropertyField(self, binding?.field);
  return { text: label, problem: result.error || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Choosing what to preview
// ─────────────────────────────────────────────────────────────────────────────

// Assets worth previewing a property screen with: every asset that has
// values at all.
export function previewableAssetIds() {
  return Object.keys(ASSET_VALUES).filter(id => CURRENT_ASSET_MAP[id]);
}

// An asset's properties, most useful first: numeric ones with a range and a
// history (everything a tile can show), then the rest.
export function previewablePropertyKeys(assetId) {
  const values = ASSET_VALUES[assetId] || {};
  const score = key => {
    let s = 0;
    if (typeof values[key] === 'number') s += 4;
    if (PROPERTY_RANGES[key]) s += 2;
    if (Array.isArray(ASSET_TELEMETRY?.series?.[assetId]?.[key])) s += 1;
    return s;
  };
  return Object.keys(values).sort((a, b) => score(b) - score(a)
    || (PROPERTY_LABELS[a] || a).localeCompare(PROPERTY_LABELS[b] || b));
}

// The default preview: the first asset with a fully-featured property.
export function defaultPreviewAssetId() {
  const ids = previewableAssetIds();
  return ids.find(id => {
    const key = previewablePropertyKeys(id)[0];
    const v = ASSET_VALUES[id]?.[key];
    return typeof v === 'number' && PROPERTY_RANGES[key];
  }) ?? ids[0] ?? null;
}

// For the property picker: [{ id, name }].
export function propertyOptions(assetId) {
  return previewablePropertyKeys(assetId).map(key => ({ id: key, name: PROPERTY_LABELS[key] || key }));
}

// Every property binding on the page: [{ containerId, title, propName, binding }].
export function propertyBindingsOf(containers) {
  const found = [];
  const walk = (list) => (list || []).forEach(c => {
    Object.entries(c.bindings || {}).forEach(([propName, binding]) => {
      if (binding?.type === 'property') found.push({ containerId: c.id, title: c.title, propName, binding });
    });
    walk(c.children);
  });
  walk(containers);
  return found;
}
