// operator/relatedAssets/ReadOnlyViews.jsx
// Read-only renderings of a saved Related Assets template, for the
// Operator side (Assets area, Investigate panel): the same Cards or
// Diagram the Configurator produces, with no toolbar or editing. Also the
// read-only All Assets diagram.

import { useRef } from 'react';
import { getRelatedAssetsForType } from '../model/assetQueries';
import { useDisplayOrders, sortRowsByOrder, resolveEntityOrder } from '../settings/displayOrder';
import { AssetCardsView } from './AssetCardsView';
import { AssetDiagramView } from './AssetDiagramView';

// Read-only Related Assets view for the new Operator-only Assets area —
// shows the same saved template a type's Related Assets tab in
// Visualization produces (Cards or Diagram, with whatever settings were
// saved there), but with no toolbar and no editing capability at all.
// Mirrors RelatedAssetsEditor's own relatedAssetRows/visibleRows
// computation exactly, just without any of the state that exists there
// only to support editing.
export function ReadOnlyRelatedAssetsView({ typeId, assetId, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, evidencePoints, savedTemplate, onTitleClick, onGearClick }) {
  // AssetCardsView's flex-mode rendering writes to these unconditionally
  // (its tile ref callback needs somewhere to write to regardless of
  // whether the manual-switch feature — irrelevant here — is ever used),
  // so real ref objects are required even though nothing here ever reads
  // from them.
  const cardsFlexContainerRef = useRef(null);
  const cardsFlexTileRefs = useRef({});
  // Per-related-type visibility, merged the same way property visibility
  // is elsewhere: this specific asset's own override wins when it has one,
  // otherwise fall back to its type's. assetId is optional (undefined for
  // any caller still passing only a type, e.g. the Now area's own type-
  // level preview reusing this same component) — a missing assetId simply
  // means no asset-level entry can ever match, so behavior is identical to
  // before for those callers.
  const typeRelatedAssetOverrides = typeRelatedAssetConfigs[typeId] || {};
  const assetRelatedAssetOverrides = (assetId && assetRelatedAssetConfigs?.[assetId]) || {};
  const displayOrders = useDisplayOrders();
  const relatedAssetRows = sortRowsByOrder(getRelatedAssetsForType(typeId, typeList).map(row => ({
    ...row,
    visibility: assetRelatedAssetOverrides[row.key] || typeRelatedAssetOverrides[row.key] || 'always',
  })), resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, typeId, assetId));
  const visibleRows = relatedAssetRows.filter(r => r.visibility === 'always');
  // savedTemplate here is already whichever one applies (asset-level
  // override or type-level default) — resolved by the caller, which has
  // both maps and the same all-or-nothing reasoning AssetCard's
  // own display template fallback uses (a cohesive layout choice saved as
  // one unit, not merged field by field).
  const layoutMode = savedTemplate?.layoutMode ?? 'cards';

  if (visibleRows.length === 0) {
    return <div className="op-dash-text op-dash-text--muted">No related assets to show.</div>;
  }

  return layoutMode === 'cards' ? (
    <AssetCardsView
      currentTypeId={typeId}
      currentTypeName={typeList.find(t => t.id === typeId)?.name}
      currentTypeExampleAssetId={assetId || typeList.find(t => t.id === typeId)?.exampleAssetId}
      visibleRows={visibleRows}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      cardsLayoutMode={savedTemplate?.cardsLayoutMode ?? 'auto'}
      cardsManualPositions={savedTemplate?.cardsManualPositions ?? {}}
      onCardsPositionsChange={() => {}}
      cardsFlexContainerRef={cardsFlexContainerRef}
      cardsFlexTileRefs={cardsFlexTileRefs}
      cardsFlowDirection={savedTemplate?.cardsFlowDirection ?? 'row'}
      cardsFlowWrap={savedTemplate?.cardsFlowWrap ?? 'wrap'}
      cardsAlignContent={savedTemplate?.cardsAlignContent ?? 'stretch'}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  ) : (
    <AssetDiagramView
      currentTypeId={typeId}
      currentTypeName={typeList.find(t => t.id === typeId)?.name}
      currentTypeExampleAssetId={assetId || typeList.find(t => t.id === typeId)?.exampleAssetId}
      visibleRows={visibleRows}
      typeList={typeList}
      allTypesMode={false}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      diagramAlgorithm={savedTemplate?.diagramAlgorithm ?? 'layered'}
      diagramDirection={savedTemplate?.diagramDirection ?? 'RIGHT'}
      diagramEdgeRouting={savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL'}
      diagramNodeSpacing={savedTemplate?.diagramNodeSpacing ?? 40}
      diagramLayerSpacing={savedTemplate?.diagramLayerSpacing ?? 80}
      diagramAspectRatio={savedTemplate?.diagramAspectRatio ?? 8}
      diagramShowLabels={savedTemplate?.diagramShowLabels ?? 'hidden'}
      diagramShowArrowheads={savedTemplate?.diagramShowArrowheads ?? 'shown'}
      diagramConnectionPointMode={savedTemplate?.diagramConnectionPointMode ?? 'center'}
      diagramLayoutResetSignal={0}
      onManualEdit={() => {}}
      setDiagramShowLabels={() => {}}
      setDiagramShowArrowheads={() => {}}
      setDiagramConnectionPointMode={() => {}}
      onPositionsChange={undefined}
      savedManualPositions={savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  );
}

// Read-only All Assets view for the new Operator-only Assets area —
// same global saved template and hiddenAssetIds the configurator's own
// All Assets diagram uses, no toolbar, no editing capability.
export function ReadOnlyAllAssetsView({ typeList, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, savedTemplate, onTitleClick, onGearClick }) {
  return (
    <AssetDiagramView
      typeList={typeList}
      allTypesMode
      hiddenAssetIds={hiddenAssetIds}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      diagramAlgorithm={savedTemplate?.diagramAlgorithm ?? 'layered'}
      diagramDirection={savedTemplate?.diagramDirection ?? 'RIGHT'}
      diagramEdgeRouting={savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL'}
      diagramNodeSpacing={savedTemplate?.diagramNodeSpacing ?? 40}
      diagramLayerSpacing={savedTemplate?.diagramLayerSpacing ?? 80}
      diagramAspectRatio={savedTemplate?.diagramAspectRatio ?? 8}
      diagramShowLabels={savedTemplate?.diagramShowLabels ?? 'hidden'}
      diagramShowArrowheads={savedTemplate?.diagramShowArrowheads ?? 'shown'}
      diagramConnectionPointMode={savedTemplate?.diagramConnectionPointMode ?? 'center'}
      diagramLayoutResetSignal={0}
      onManualEdit={() => {}}
      setDiagramShowLabels={() => {}}
      setDiagramShowArrowheads={() => {}}
      setDiagramConnectionPointMode={() => {}}
      onPositionsChange={undefined}
      savedManualPositions={savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  );
}
