// operator/properties/PropertyTileCanvas.jsx
// Manual layout for property tiles: the shared ManualLayoutCanvas, with
// the node that draws one PropertyTile and the grid spacing that suits
// tile-sized things.

import { forwardRef } from 'react';
import { ManualLayoutCanvas } from '../canvas/ManualLayoutCanvas';
import { PropertyTile } from './PropertyTile';

// One property tile per node, positioned freely. No Handle elements at
// all: unlike AssetDiagramNode, this graph never has edges (properties
// don't relate to each other the way types do), so there is nothing to
// connect.
function PropertyTileNode({ data }) {
  return (
    <div className={`op-property-layout-node${data.selected ? ' op-prop-tile-select--selected' : ''}`}>
      <PropertyTile {...data.tileProps} />
    </div>
  );
}

// Built once at module scope — React Flow warns (and can misbehave) if
// nodeTypes is a fresh object on every render.
const PROPERTY_TILE_NODE_TYPES = { propertyLayoutNode: PropertyTileNode };

// "Arrange in Grid" spacing — generous enough for the tallest tile type
// (indicator, ~110-130px content) without overlap at default sizes.
const ARRANGE = { columns: 4, cellWidth: 150, cellHeight: 140 };

export const PropertyTileCanvas = forwardRef(function PropertyTileCanvas({ tiles, manualPositions, onPositionsChange, onSelectTile }, ref) {
  // A tile's view mode and its selected state can both change while its
  // key stays the same, so both belong in the signature the canvas syncs
  // on — without them, switching view mode in manual layout would
  // silently do nothing.
  const items = tiles.map(t => ({
    key: t.key,
    data: { tileProps: t.tileProps, selected: !!t.selected },
    signature: `${t.key}:${t.tileProps?.viewMode ?? ''}:${t.selected ? 1 : 0}`,
  }));
  return (
    <ManualLayoutCanvas
      ref={ref}
      items={items}
      manualPositions={manualPositions}
      onPositionsChange={onPositionsChange}
      onSelectItem={onSelectTile}
      nodeType="propertyLayoutNode"
      nodeTypes={PROPERTY_TILE_NODE_TYPES}
      arrange={ARRANGE}
      itemNoun="properties"
    />
  );
});
