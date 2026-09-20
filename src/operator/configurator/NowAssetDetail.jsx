// operator/configurator/NowAssetDetail.jsx
// The Configurator's centre column for the current selection: the title
// row with its customization controls, and NowTypeMainPreview below it.
// Remounts the preview (its React key) whenever the selection or the
// saved template changes, so editors always start from saved state.

import { useState } from 'react';
import { resolveAssetProperties } from '../model/assetQueries';
import { CURRENT_ASSET_MAP, CURRENT_TIMESTAMPS } from '../model/modelData';
import { NowTypeMainPreview } from './NowTypeMainPreview';

// Center preview for the Now area's own Assets tab, mirroring the type
// side's NowTypeMainPreview exactly (same component, generalized) — full
// per-asset visual-preference editing, not a placeholder.
export function NowAssetDetail({ selectedThing, typeList, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, assetDisplayTemplates, onSaveAssetDisplayTemplate, assetRelatedAssetsTemplates, onSaveAssetRelatedAssetsTemplate, activeSaveHandlerRef, activeTabIndex, onViewModeChange, hiddenAssetIds, relatedAssetsTemplates, onSaveRelatedAssetsTemplate, allAssetsTemplate, onSaveAllAssetsTemplate, onTitleClick, propertyVisuals, previewRevision = 0 }) {
  // Lifted up here (rather than local state inside NowTypeMainPreview,
  // which remounts on every type switch via its own key={selectedThing.id})
  // so the toolbar's open/closed state survives flipping between types —
  // once the user opens it, it stays open. Still collapsed by default on
  // first load, since this component's own state starts false either way.
  const [toolbarExpanded, setToolbarExpanded] = useState(false);

  if (!selectedThing) {
    return (
      <div className="op-panel op-investigate-panel op-now-detail-empty">
        <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
      </div>
    );
  }

  const isAssetEntity = selectedThing.kind === 'asset';
  let title, assetIdForProperties, relationshipTypeId, thisAssetExampleId;

  if (!isAssetEntity) {
    const typeEntry = typeList.find(t => t.id === selectedThing.id);
    if (!typeEntry) {
      return (
        <div className="op-panel op-investigate-panel op-now-detail-empty">
          <div className="op-now-detail-placeholder-note">Select a type from the list to view it.</div>
        </div>
      );
    }
    title = typeEntry.name;
    assetIdForProperties = typeEntry.exampleAssetId;
    relationshipTypeId = selectedThing.id;
    thisAssetExampleId = typeEntry.exampleAssetId;
  } else {
    const asset = CURRENT_ASSET_MAP[selectedThing.id];
    if (!asset) {
      return (
        <div className="op-panel op-investigate-panel op-now-detail-empty">
          <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
        </div>
      );
    }
    title = asset.name;
    assetIdForProperties = selectedThing.id;
    // This asset's own real type — used for relationship lookups and as
    // the type-level fallback key, same TYPE_<level>_<type> shape
    // attentionAssetToTypeId uses elsewhere for the same purpose.
    relationshipTypeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
    thisAssetExampleId = selectedThing.id;
  }

  // No single narrative/event window here (unlike Investigate) — show the
  // full available trend instead of slicing to nothing.
  const fullRangeEvidencePoints = CURRENT_TIMESTAMPS.length
    ? [{ time: CURRENT_TIMESTAMPS[0] }, { time: CURRENT_TIMESTAMPS[CURRENT_TIMESTAMPS.length - 1] }]
    : [];

  const { properties, sparklineSource } = resolveAssetProperties(assetIdForProperties);

  // Main preview area — the visual playground matching whichever Details-
  // panel tab is active (Properties/Related Assets/All Assets). Editing
  // the underlying config lists happens in the Details panel (right
  // rail) instead of here — this is the "play with layout" half. One
  // shared component for both types and real assets now: entityId is the
  // storage key (type id or asset id) for this thing's own saved
  // preferences, while typeDisplayTemplates/typePropertyConfigs/
  // typeRelatedAssetConfigs stay the real type-level maps regardless
  // (every OTHER related box shown alongside this one is always a type-
  // level thing), and the asset-level maps ride along so
  // AssetCard's own fallback can apply to every box,
  // including this one's.
  return (
    <NowTypeMainPreview
      // previewRevision: bumped when this asset's saved settings are
      // reverted, remounting the editors onto the type's settings (they
      // only read their saved template on mount).
      key={`${selectedThing.id}:${previewRevision}`}
      activeTabIndex={activeTabIndex}
      title={title}
      entityId={selectedThing.id}
      isAssetEntity={isAssetEntity}
      relationshipTypeId={relationshipTypeId}
      thisAssetExampleId={thisAssetExampleId}
      typeList={typeList}
      properties={properties}
      sparklineSource={sparklineSource}
      evidencePoints={fullRangeEvidencePoints}
      typePropertyConfigs={typePropertyConfigs}
      typeRelatedAssetConfigs={typeRelatedAssetConfigs}
      typeDisplayTemplates={typeDisplayTemplates}
      typeRelatedAssetsTemplates={relatedAssetsTemplates}
      onSaveTypeDisplayTemplate={onSaveTypeDisplayTemplate}
      onSaveTypeRelatedAssetsTemplate={onSaveRelatedAssetsTemplate}
      assetPropertyConfigs={assetPropertyConfigs}
      assetRelatedAssetConfigs={assetRelatedAssetConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
      onSaveAssetDisplayTemplate={onSaveAssetDisplayTemplate}
      onSaveAssetRelatedAssetsTemplate={onSaveAssetRelatedAssetsTemplate}
      activeSaveHandlerRef={activeSaveHandlerRef}
      onViewModeChange={onViewModeChange}
      hiddenAssetIds={hiddenAssetIds}
      allAssetsTemplate={allAssetsTemplate}
      onSaveAllAssetsTemplate={onSaveAllAssetsTemplate}
      onTitleClick={onTitleClick}
      toolbarExpanded={toolbarExpanded}
      onToolbarExpandedChange={setToolbarExpanded}
      propertyVisuals={propertyVisuals}
    />
  );
}
