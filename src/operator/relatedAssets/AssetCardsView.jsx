// operator/relatedAssets/AssetCardsView.jsx
// The Cards view of related assets: the asset's own box first, then one
// box per visible related asset, either flex-wrapped (auto) or on
// AssetCardCanvas (manual).

import { AssetCardCanvas } from './AssetCardCanvas';
import { AssetCard } from './AssetCard';
import { FitViewport } from '../../viewport/FitViewport';

// Cards — the actual view: a plain flex-wrapped grid of related-asset
// type boxes when cardsLayoutMode is 'auto' (genuinely responsive —
// reflows on window resize, since it's real CSS flexbox), or the canvas
// above when 'manual'. cardsFlexContainerRef/cardsFlexTileRefs are
// populated here so RelatedAssetsEditor's handleSwitchCardsToManual can
// measure real current positions at the moment of switching.
//
// The auto (flex) layout sits in a FitViewport: a set of related assets
// too big for the space opens zoomed out to show all of it, with zoom
// controls, instead of scrolling. A wrapping flow reflows as it zooms
// out (wider rows, or taller columns), so it stays readable; a no-wrap
// line is shrunk as it is. One that fits is drawn exactly as before.
export function AssetCardsView({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, cardsLayoutMode, cardsManualPositions, onCardsPositionsChange, cardsFlexContainerRef, cardsFlexTileRefs, cardsFlowDirection, cardsFlowWrap, cardsAlignContent, cardsLayoutCanvasRef, readOnly, onTitleClick, onGearClick, onFitChange }) {
  // This asset's own box, always shown first regardless of layout mode —
  // same reasoning as the Diagram view's own isCenter node: the point of
  // "related assets" is seeing them in context of the asset they're
  // related TO, which was previously only true in Diagram mode. Cards
  // (both its manual and flex/auto sub-modes) never included it at all.
  const thisAssetBoxProps = {
    relatedTypeId: currentTypeId,
    relatedTypeName: currentTypeName,
    relatedTypeExampleAssetId: currentTypeExampleAssetId,
    typeDisplayTemplates,
    typePropertyConfigs,
    assetDisplayTemplates,
    assetPropertyConfigs,
    evidencePoints,
    onTitleClick,
    onGearClick,
  };

  if (cardsLayoutMode === 'manual') {
    return (
      <div className="op-related-assets-diagram">
        <AssetCardCanvas
          ref={cardsLayoutCanvasRef}
          readOnly={readOnly}
          tiles={[
            { key: currentTypeId, boxProps: thisAssetBoxProps, isCenter: true },
            ...visibleRows.map(row => ({
              key: row.key,
              boxProps: {
                relatedTypeId: row.relatedTypeId,
                relatedTypeName: row.relatedTypeName,
                relatedTypeExampleAssetId: row.relatedTypeExampleAssetId,
                typeDisplayTemplates,
                typePropertyConfigs,
                assetDisplayTemplates,
                assetPropertyConfigs,
                evidencePoints,
                onTitleClick,
                onGearClick,
              },
            })),
          ]}
          manualPositions={cardsManualPositions}
          onPositionsChange={onCardsPositionsChange}
        />
      </div>
    );
  }
  const reflow = cardsFlowWrap === 'nowrap' ? null : (String(cardsFlowDirection).startsWith('column') ? 'column' : 'row');
  return (
    <FitViewport className="op-related-assets-viewport" reflow={reflow} resetKey={`${currentTypeId}|${currentTypeExampleAssetId}`} onFitChange={onFitChange}>
    <div
      className="op-related-assets-box-flow"
      style={{ flexDirection: cardsFlowDirection, flexWrap: cardsFlowWrap, alignContent: cardsAlignContent }}
      ref={cardsFlexContainerRef}
    >
      <div
        key={currentTypeId}
        className="op-asset-card op-asset-card--center"
        ref={el => { cardsFlexTileRefs.current[currentTypeId] = el; }}
      >
        <AssetCard {...thisAssetBoxProps} />
      </div>
      {visibleRows.map(row => (
        <div
          key={row.key}
          className="op-asset-card"
          data-related-key={row.key}
          ref={el => { cardsFlexTileRefs.current[row.key] = el; }}
        >
          <AssetCard
            relatedTypeId={row.relatedTypeId}
            relatedTypeName={row.relatedTypeName}
            relatedTypeExampleAssetId={row.relatedTypeExampleAssetId}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        </div>
      ))}
    </div>
    </FitViewport>
  );
}
