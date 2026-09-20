// operator/settings/customizations.js
// "Which assets differ from their type": computeAssetCustomizations works
// out, per asset, per type and per property, what an asset sets
// differently from its type; the workspace publishes the result (plus the
// Match type / Update type actions) through assetCustomizationStore for the
// tree dots, type counts, title chip and checklists to read.

import { useSyncExternalStore } from 'react';
import { assetTypeIdOf, getRelatedAssetsForType } from '../model/assetQueries';
import { CURRENT_ASSET_DATA, CURRENT_ASSET_MAP } from '../model/modelData';
import { applySavedOrder, categoryOrderedPropertyKeys } from './displayOrder';
import { KPI_VIEW_MODE_ITEMS, VISIBILITY_LABEL } from './propertyDisplay';

// ─── Asset customizations: which assets differ from their type ─────────
//
// "Customized" deliberately means "renders differently from its type",
// not merely "has asset-level entries stored". Saving an asset writes its
// whole display template — layout fields copied straight from the type —
// so an asset whose only change was one property's visual would otherwise
// also read as having a customized layout. Comparing against the type
// keeps the indicators honest. (Revert still clears every asset-level
// entry, matching or not — see hasOwn below — so a reverted asset follows
// all future type changes again.)

// A display template's layout fields with the same defaults every
// renderer uses, so "no template" and "a template holding the defaults"
// compare equal. Manual positions only matter in manual mode.
export function normalizedLayout(template) {
  const layoutMode = template?.layoutMode ?? 'auto';
  return JSON.stringify({
    viewMode: template?.viewMode ?? 'text',
    flowDirection: template?.flowDirection ?? 'row',
    flowWrap: template?.flowWrap ?? 'wrap',
    alignContent: template?.alignContent ?? 'flex-start',
    layoutMode,
    manualPositions: layoutMode === 'manual' ? (template?.manualPositions ?? {}) : {},
  });
}

// One pass over the current model's assets. Returns:
//   byAsset[assetId] = { typeId, layout, visuals: [keys], visibility: [keys],
//                        related, differs, hasOwn, summary }
//   byType[typeId] = [assetIds that differ]
//   byTypeProperty[typeId][propertyKey] = [assetIds whose visual or
//                        visibility for that one property differs]
export function computeAssetCustomizations({ typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, typeList }) {
  // An asset's own order differs from its type's when, over the keys the
  // asset's order lists, the type's effective order (its saved one, else
  // the default) puts them differently. Default related-asset order is per
  // type, so it's worked out once per type, on demand.
  const defaultRelatedOrderByType = new Map();
  const defaultRelatedOrder = typeId => {
    if (!defaultRelatedOrderByType.has(typeId)) {
      defaultRelatedOrderByType.set(typeId, typeList ? getRelatedAssetsForType(typeId, typeList).map(r => r.key) : []);
    }
    return defaultRelatedOrderByType.get(typeId);
  };
  const orderDiffers = (own, typeKeysInOrder) => {
    const ownSet = new Set(own);
    const typeSeq = typeKeysInOrder.filter(k => ownSet.has(k));
    const ownSeq = own.filter(k => typeSeq.includes(k));
    return ownSeq.join('|') !== typeSeq.join('|');
  };
  const byAsset = {};
  const byType = {};
  const byTypeProperty = {};
  const containsCustomized = {}; // ancestor asset id -> count of customized descendants
  (CURRENT_ASSET_DATA || []).forEach(asset => {
    const id = asset.id;
    const assetTemplate = assetDisplayTemplates?.[id];
    const ownVisibility = assetPropertyConfigs?.[id] || {};
    const ownRelated = assetRelatedAssetConfigs?.[id] || {};
    const ownRelatedTemplate = assetRelatedAssetsTemplates?.[id];
    const ownPropertyOrder = assetPropertyOrders?.[id];
    const ownRelatedOrder = assetRelatedAssetOrders?.[id];
    const hasOwn = !!assetTemplate || Object.keys(ownVisibility).length > 0 || Object.keys(ownRelated).length > 0 || !!ownRelatedTemplate
      || !!ownPropertyOrder || !!ownRelatedOrder;
    if (!hasOwn) return;

    const typeId = assetTypeIdOf(asset);
    const propertyOrder = !!ownPropertyOrder && orderDiffers(
      ownPropertyOrder,
      applySavedOrder(categoryOrderedPropertyKeys(ownPropertyOrder), typePropertyOrders?.[typeId]),
    );
    const relatedOrder = !!ownRelatedOrder && orderDiffers(
      ownRelatedOrder,
      applySavedOrder(defaultRelatedOrder(typeId), typeRelatedAssetOrders?.[typeId]),
    );
    const typeTemplate = typeDisplayTemplates?.[typeId];
    const layout = !!assetTemplate && normalizedLayout(assetTemplate) !== normalizedLayout(typeTemplate);
    const typeDefaultView = typeTemplate?.viewMode ?? 'text';
    const visuals = Object.entries(assetTemplate?.propertyViewModes || {})
      .filter(([key, mode]) => mode !== (typeTemplate?.propertyViewModes?.[key] ?? typeDefaultView))
      .map(([key]) => key);
    const typeVisibility = typePropertyConfigs?.[typeId] || {};
    const visibility = Object.entries(ownVisibility)
      .filter(([key, v]) => v !== (typeVisibility[key] || 'always'))
      .map(([key]) => key);
    const typeRelated = typeRelatedAssetConfigs?.[typeId] || {};
    const related = Object.entries(ownRelated).some(([key, v]) => v !== (typeRelated[key] || 'always'))
      || (!!ownRelatedTemplate && JSON.stringify(ownRelatedTemplate) !== JSON.stringify(relatedAssetsTemplates?.[typeId] ?? null));
    const differs = layout || visuals.length > 0 || visibility.length > 0 || related || propertyOrder || relatedOrder;

    const summaryParts = [];
    if (layout) summaryParts.push('layout');
    if (visuals.length) summaryParts.push(`${visuals.length} property visual${visuals.length > 1 ? 's' : ''}`);
    if (visibility.length) summaryParts.push(`${visibility.length} property visibilit${visibility.length > 1 ? 'ies' : 'y'}`);
    if (related) summaryParts.push('related assets');
    if (propertyOrder) summaryParts.push('property order');
    if (relatedOrder) summaryParts.push('related asset order');
    const propertyDetails = {};
    new Set([...visuals, ...visibility]).forEach(key => {
      propertyDetails[key] = describePropertyDifference(id, key, assetDisplayTemplates, assetPropertyConfigs);
    });
    byAsset[id] = { typeId, layout, visuals, visibility, related, propertyOrder, relatedOrder, differs, hasOwn, summary: summaryParts.join(', '), propertyDetails };

    if (differs) {
      (byType[typeId] = byType[typeId] || []).push(id);
      const seen = new Set([id]);
      let parentId = asset.parentId;
      while (parentId != null && CURRENT_ASSET_MAP[parentId] && !seen.has(parentId)) {
        seen.add(parentId);
        containsCustomized[parentId] = (containsCustomized[parentId] || 0) + 1;
        parentId = CURRENT_ASSET_MAP[parentId].parentId;
      }
      const perProperty = (byTypeProperty[typeId] = byTypeProperty[typeId] || {});
      new Set([...visuals, ...visibility]).forEach(key => {
        (perProperty[key] = perProperty[key] || []).push(id);
      });
    }
  });
  return { byAsset, byType, byTypeProperty, containsCustomized };
}

// A tiny module-level store for the result above, plus the actions that
// act on it (revert, open an asset). Some consumers are DevExtreme item
// and cell templates (the Assets tree's rows, the Types grid's cells),
// whose render functions are handed to DevExtreme once and can't take
// fresh props — so rather than thread this through ~6 components and
// force those widgets to repaint, anything that needs it subscribes here.
// OperatorWorkspaceInner is the only writer.
// How long a revert's Undo stays offered.
export const UNDO_TOAST_MS = 10000;

export const EMPTY_CUSTOMIZATIONS = { byAsset: {}, byType: {}, byTypeProperty: {}, containsCustomized: {}, actions: {} };

export const assetCustomizationStore = {
  snapshot: EMPTY_CUSTOMIZATIONS,
  listeners: new Set(),
  set(next) {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  },
  subscribe: listener => {
    assetCustomizationStore.listeners.add(listener);
    return () => assetCustomizationStore.listeners.delete(listener);
  },
  getSnapshot: () => assetCustomizationStore.snapshot,
};

export function useAssetCustomizations() {
  return useSyncExternalStore(assetCustomizationStore.subscribe, assetCustomizationStore.getSnapshot);
}

// Details panel, type view: "N" next to a property that some of this
// type's assets set differently (visual and/or visibility), opening the
// same checklist scoped to just that property.
function describePropertyDifference(assetId, propertyKey, assetDisplayTemplates, assetPropertyConfigs) {
  const parts = [];
  const visual = assetDisplayTemplates?.[assetId]?.propertyViewModes?.[propertyKey];
  if (visual) parts.push(`Visual: ${KPI_VIEW_MODE_ITEMS.find(i => i.value === visual)?.text ?? visual}`);
  const vis = assetPropertyConfigs?.[assetId]?.[propertyKey];
  if (vis) parts.push(`Show: ${VISIBILITY_LABEL[vis] ?? vis}`);
  return parts.join(' · ');
}
