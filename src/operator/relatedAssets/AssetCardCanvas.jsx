// operator/relatedAssets/AssetCardCanvas.jsx
// Manual layout for the Cards view: the shared ManualLayoutCanvas, with
// the node that draws one AssetCard and the wider grid spacing cards
// need. Read-only in the Operator's views, draggable in the Configurator.

import { forwardRef } from 'react';
import { ManualLayoutCanvas } from '../canvas/ManualLayoutCanvas';
import { AssetCard } from './AssetCard';

// One asset card per node, same no-edges reasoning as PropertyTileNode:
// cards don't relate to each other spatially the way types do — that's
// what the diagram is for. The card's own wrapper classes are applied
// here rather than inside AssetCard, since the diagram wraps the same
// card differently (with Handles around it).
function AssetCardNode({ data }) {
  const effectiveTemplate = data.boxProps?.assetDisplayTemplates?.[data.boxProps?.relatedTypeExampleAssetId] ?? data.boxProps?.typeDisplayTemplates?.[data.boxProps?.relatedTypeId];
  const isManual = effectiveTemplate?.layoutMode === 'manual';
  return (
    <div className={`op-related-asset-box op-property-layout-node${data.isCenter ? ' op-related-asset-box--center' : ''}${isManual ? ' op-related-asset-box--manual' : ''}`}>
      <AssetCard {...data.boxProps} />
    </div>
  );
}

const ASSET_CARD_NODE_TYPES = { cardsLayoutNode: AssetCardNode };

// Wider cells than the property grid — a card holds several tiles.
const ARRANGE = { columns: 3, cellWidth: 300, cellHeight: 220 };

export const AssetCardCanvas = forwardRef(function AssetCardCanvas({ tiles, manualPositions, onPositionsChange, readOnly }, ref) {
  const items = tiles.map(t => ({
    key: t.key,
    data: { boxProps: t.boxProps, isCenter: t.isCenter },
  }));
  return (
    <ManualLayoutCanvas
      ref={ref}
      items={items}
      manualPositions={manualPositions}
      onPositionsChange={onPositionsChange}
      nodeType="cardsLayoutNode"
      nodeTypes={ASSET_CARD_NODE_TYPES}
      arrange={ARRANGE}
      itemNoun="cards"
      readOnly={readOnly}
    />
  );
});
