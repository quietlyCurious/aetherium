// operator/relatedAssets/AssetCardsView.jsx
// The Cards view of related assets: the asset's own box first, then one
// box per visible related asset, either flex-wrapped (auto) or placed by
// hand (manual: ManualLayoutEditor in the Configurator, ManualLayoutView
// when read-only — the Operator).

import { AssetCard } from './AssetCard';
import { FitViewport } from '../../viewport/FitViewport';
import { ManualLayoutEditor } from '../canvas/ManualLayoutEditor';
import { ManualLayoutView } from '../canvas/ManualLayoutView';
import { asCoordPositions } from '../canvas/manualLayout';

// A manual card's width when it has none saved (a related asset that
// appeared after the layout was arranged, or a layout saved before widths
// were kept): the cap manual cards always had, so its tiles wrap into a
// card-shaped box. Not for a type whose own properties are placed by hand
// — that arrangement is deliberate and keeps its size.
const UNSIZED_CARD_MAX_WIDTH = 280;

// Cards — the actual view: a plain flex-wrapped grid of related-asset
// type boxes when cardsLayoutMode is 'auto' (genuinely responsive —
// reflows on window resize, since it's real CSS flexbox), or placed by
// hand when 'manual'. cardsFlexContainerRef/cardsFlexTileRefs are
// populated here so RelatedAssetsEditor's handleSwitchCardsToManual can
// measure real current positions at the moment of switching.
//
// The auto (flex) layout sits in a FitViewport: a set of related assets
// too big for the space opens zoomed out to show all of it, with zoom
// controls, instead of scrolling. A wrapping flow reflows as it zooms
// out (wider rows, or taller columns), so it stays readable; a no-wrap
// line is shrunk as it is. One that fits is drawn exactly as before.
// Read-only manual cards sit in one too (shrunk as they are), so the
// Operator fit check can answer for them as well.
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
    // Each box keeps the classes and data-related-key the flex boxes have,
    // so selecting a row highlights it the same way in both.
    const saved = asCoordPositions(cardsManualPositions);
    const capFor = (card) => {
      if (saved[card.key]?.width) return undefined;
      const { relatedTypeId, relatedTypeExampleAssetId } = card.boxProps;
      const template = assetDisplayTemplates?.[relatedTypeExampleAssetId] ?? typeDisplayTemplates?.[relatedTypeId];
      return template?.layoutMode === 'manual' ? undefined : UNSIZED_CARD_MAX_WIDTH;
    };
    const cardItems = [
      { key: currentTypeId, isCenter: true, boxProps: thisAssetBoxProps },
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
    ].map(card => ({
      key: card.key,
      content: (
        <div
          className={`op-asset-card${card.isCenter ? ' op-asset-card--center' : ''}`}
          data-related-key={card.isCenter ? undefined : card.key}
          style={{ maxWidth: capFor(card) }}
        >
          <AssetCard {...card.boxProps} />
        </div>
      ),
    }));
    return readOnly ? (
      <FitViewport className="op-related-assets-viewport" resetKey={`${currentTypeId}|${currentTypeExampleAssetId}`} onFitChange={onFitChange}>
        <ManualLayoutView items={cardItems} positions={cardsManualPositions} />
      </FitViewport>
    ) : (
      <ManualLayoutEditor
        ref={cardsLayoutCanvasRef}
        className="op-related-assets-manual"
        itemNoun="cards"
        resetKey={`${currentTypeId}|${currentTypeExampleAssetId}`}
        items={cardItems}
        positions={cardsManualPositions}
        onPositionsChange={onCardsPositionsChange}
      />
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
