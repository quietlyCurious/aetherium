// operator/settings/displayOrder.js
// Display order for properties and related assets: the category-grouped
// default, applying a saved order (type- or asset-level), and the shared
// store the workspace publishes the four order maps through.

import { useSyncExternalStore } from 'react';
import { HMI_CATEGORY_ORDER } from '../../model/assetQueries';
import { PROPERTY_CATEGORIES } from '../../model/modelData';

// ─── Display order: properties and related assets ──────────────────────
//
// Both lists can be reordered (drag rows in the Details panel), at the
// type level and per asset. An asset's own order replaces its type's as a
// whole — an order is one list, there's nothing to merge key by key. With
// no saved order at either level, properties keep their default grouping
// by category (the order the Configurator preview has always used) and
// related assets their natural order. Keys a saved order doesn't mention
// (a property or relationship that appeared after it was saved) follow at
// the end, in their default order; keys it mentions that no longer exist
// are simply skipped.

// Default property order: grouped by HMI category, known categories first
// in HMI_CATEGORY_ORDER, then any others in first-seen order — exactly the
// grouping PropertyTilesView has always rendered in.
export function categoryOrderedPropertyKeys(keys) {
  const byCategory = new Map();
  keys.forEach(key => {
    const category = PROPERTY_CATEGORIES[key] || 'Other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(key);
  });
  const known = HMI_CATEGORY_ORDER.filter(c => byCategory.has(c));
  const extra = [...byCategory.keys()].filter(c => !HMI_CATEGORY_ORDER.includes(c));
  return [...known, ...extra].flatMap(c => byCategory.get(c));
}

export function applySavedOrder(keys, order) {
  if (!order || !order.length) return keys;
  const present = new Set(keys);
  const ordered = order.filter(k => present.has(k));
  const orderedSet = new Set(ordered);
  return [...ordered, ...keys.filter(k => !orderedSet.has(k))];
}

export function sortRowsByOrder(rows, order) {
  if (!order || !order.length) return rows;
  const byKey = new Map(rows.map(r => [r.key, r]));
  return applySavedOrder(rows.map(r => r.key), order).map(k => byKey.get(k));
}

// Asset's own order if it has one, else its type's (else undefined =
// default order).
export function resolveEntityOrder(typeOrders, assetOrders, typeId, assetId) {
  return (assetId && assetOrders?.[assetId]) || typeOrders?.[typeId];
}

// Same module-level store pattern as assetCustomizationStore below, for
// the same reason: AssetCard renders inside React Flow nodes
// and a dozen other places, and threading four more maps through every one
// of them would touch most of this file. OperatorWorkspaceInner is the
// only writer.
export const EMPTY_DISPLAY_ORDERS = { typeProperty: {}, assetProperty: {}, typeRelated: {}, assetRelated: {}, setOrder: () => {} };

export const displayOrderStore = {
  snapshot: EMPTY_DISPLAY_ORDERS,
  listeners: new Set(),
  set(next) {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  },
  subscribe: listener => {
    displayOrderStore.listeners.add(listener);
    return () => displayOrderStore.listeners.delete(listener);
  },
  getSnapshot: () => displayOrderStore.snapshot,
};

export function useDisplayOrders() {
  return useSyncExternalStore(displayOrderStore.subscribe, displayOrderStore.getSnapshot);
}
