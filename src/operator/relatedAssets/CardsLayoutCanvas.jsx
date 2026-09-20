// operator/relatedAssets/CardsLayoutCanvas.jsx
// The Cards view's manual-layout canvas: one React Flow node per
// related-asset box, free drag positioning with grid snap, align /
// distribute / arrange-in-grid via its imperative ref. No edges; the same
// pattern as PropertyLayoutCanvas.

import { forwardRef, useEffect, useImperativeHandle } from 'react';
import notify from 'devextreme/ui/notify';
import { ReactFlowProvider, useNodesState, ReactFlow, Background } from '@xyflow/react';
import { alignSelectedNodes, distributeSelectedNodes } from '../canvas/canvasGeometry';
import { RelatedAssetBoxContent } from './RelatedAssetBoxContent';

// Cards manual mode's own node type — one related-asset type box per
// node, same no-edges reasoning as PropertyLayoutNode above (asset
// cards don't relate to each other spatially the way Diagram's types
// do — that's what Diagram itself is for).
function CardsLayoutNode({ data }) {
  const effectiveTemplate = data.boxProps?.assetDisplayTemplates?.[data.boxProps?.relatedTypeExampleAssetId] ?? data.boxProps?.typeDisplayTemplates?.[data.boxProps?.relatedTypeId];
  const isManual = effectiveTemplate?.layoutMode === 'manual';
  return (
    <div className={`op-related-asset-box op-property-layout-node${data.isCenter ? ' op-related-asset-box--center' : ''}${isManual ? ' op-related-asset-box--manual' : ''}`}>
      <RelatedAssetBoxContent {...data.boxProps} />
    </div>
  );
}

const CARDS_LAYOUT_NODE_TYPES = { cardsLayoutNode: CardsLayoutNode };

// Cards manual layout — same "stack in corner" default and grid-arrange
// spacing reasoning as the property-layout constants above, just for
// asset type boxes (which run somewhat larger than a single StatTile).
const CARDS_LAYOUT_DEFAULT_POSITION = { x: 0, y: 0 };

const CARDS_LAYOUT_GRID_SIZE = 20;

const CARDS_LAYOUT_ARRANGE_CELL_WIDTH = 300;

const CARDS_LAYOUT_ARRANGE_CELL_HEIGHT = 220;

const CARDS_LAYOUT_ARRANGE_COLUMNS = 3;

// Manual Cards-layout canvas — one node per related-asset type box, no
// edges ever (Diagram is what exists for showing relationships between
// types; Cards is purely a spatial arrangement of the same boxes).
// Structurally identical to PropertyLayoutCanvas — same proven pattern,
// third time this shape gets reused (diagram nodes, property tiles,
// now asset cards).
export const CardsLayoutCanvas = forwardRef(function CardsLayoutCanvas({ tiles, manualPositions, onPositionsChange, readOnly }, ref) {
  return (
    <ReactFlowProvider>
      <CardsLayoutCanvasInner ref={ref} tiles={tiles} manualPositions={manualPositions} onPositionsChange={onPositionsChange} readOnly={readOnly} />
    </ReactFlowProvider>
  );
});

const CardsLayoutCanvasInner = forwardRef(function CardsLayoutCanvasInner({ tiles, manualPositions, onPositionsChange, readOnly }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    tiles.map(t => ({
      id: t.key,
      type: 'cardsLayoutNode',
      position: manualPositions[t.key] ?? CARDS_LAYOUT_DEFAULT_POSITION,
      data: { boxProps: t.boxProps, isCenter: t.isCenter },
    }))
  );

  // Same tileKeysSignature fix as PropertyLayoutCanvasInner — depending
  // on the tiles array reference directly caused an infinite loop there
  // (tiles is rebuilt fresh every parent render regardless of whether
  // the visible set actually changed); applying the same fix here from
  // the start rather than waiting to hit it again.
  const tileKeysSignature = tiles.map(t => t.key).join('|');
  useEffect(() => {
    setNodes(current => {
      const tileMap = new Map(tiles.map(t => [t.key, t]));
      const kept = current
        .filter(n => tileMap.has(n.id))
        .map(n => ({ ...n, data: { boxProps: tileMap.get(n.id).boxProps, isCenter: tileMap.get(n.id).isCenter } }));
      const keptIds = new Set(kept.map(n => n.id));
      const added = tiles
        .filter(t => !keptIds.has(t.key))
        .map(t => ({
          id: t.key,
          type: 'cardsLayoutNode',
          position: manualPositions[t.key] ?? CARDS_LAYOUT_DEFAULT_POSITION,
          data: { boxProps: t.boxProps, isCenter: t.isCenter },
        }));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKeysSignature]);

  useEffect(() => {
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify('Select at least 2 cards to align (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify('Select at least 3 cards to distribute (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleArrangeGrid = () => {
    setNodes(current => current.map((n, i) => ({
      ...n,
      position: {
        x: (i % CARDS_LAYOUT_ARRANGE_COLUMNS) * CARDS_LAYOUT_ARRANGE_CELL_WIDTH,
        y: Math.floor(i / CARDS_LAYOUT_ARRANGE_COLUMNS) * CARDS_LAYOUT_ARRANGE_CELL_HEIGHT,
      },
    })));
  };

  // Align/Distribute/Arrange in Grid now live in the parent toolbar
  // (RelatedAssetsPreview's own manual-mode Row 3), same reasoning and
  // pattern as PropertyLayoutCanvasInner's own ref exposure.
  useImperativeHandle(ref, () => ({
    align: handleAlign,
    distribute: handleDistribute,
    arrangeGrid: handleArrangeGrid,
  }));

  return (
    <div className="op-property-layout-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={CARDS_LAYOUT_NODE_TYPES}
        onNodesChange={onNodesChange}
        snapToGrid
        snapGrid={[CARDS_LAYOUT_GRID_SIZE, CARDS_LAYOUT_GRID_SIZE]}
        minZoom={0.1}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        elementsSelectable={!readOnly}
      >
        <Background color="#b0b0b0" />
      </ReactFlow>
    </div>
  );
});
