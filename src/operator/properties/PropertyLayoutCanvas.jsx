// operator/properties/PropertyLayoutCanvas.jsx
// The manual-layout canvas for a property listing: one React Flow node per
// visible property tile, free drag positioning with grid snap, plus
// align / distribute / arrange-in-grid via its imperative ref. No edges.

import { forwardRef, useEffect, useImperativeHandle } from 'react';
import notify from 'devextreme/ui/notify';
import { ReactFlowProvider, useNodesState, ReactFlow, Background } from '@xyflow/react';
import { alignSelectedNodes, distributeSelectedNodes } from '../canvas/canvasGeometry';
import { StatTile } from './StatTile';

// Property-layout manual mode's own node type — one property tile per
// node, positioned freely on the canvas. No Handle elements at all: unlike
// RelatedAssetDiagramNode, this graph never has edges (properties don't
// relate to each other the way types do), so there's nothing to connect.
function PropertyLayoutNode({ data }) {
  return (
    <div className={`op-property-layout-node${data.selected ? ' op-prop-tile-select--selected' : ''}`}>
      <StatTile {...data.tileProps} />
    </div>
  );
}

const PROPERTY_LAYOUT_NODE_TYPES = { propertyLayoutNode: PropertyLayoutNode };

// Property manual layout — no saved position yet (a property newly
// revealed by a tier-filter change, or added after positions were last
// saved) lands here: "stack in the corner," never an auto-placement
// search, matching the no-reflow decision for this whole feature.
const PROPERTY_LAYOUT_DEFAULT_POSITION = { x: 0, y: 0 };

const PROPERTY_LAYOUT_GRID_SIZE = 20;

// "Arrange in Grid" spacing — generous enough for the tallest tile type
// (indicator, ~110-130px content) without overlap at default sizes.
const PROPERTY_LAYOUT_ARRANGE_CELL_WIDTH = 150;

const PROPERTY_LAYOUT_ARRANGE_CELL_HEIGHT = 140;

const PROPERTY_LAYOUT_ARRANGE_COLUMNS = 4;

// Manual property-layout canvas — one node per visible property, no
// edges ever (properties don't relate to each other the way types do).
// Self-contained ReactFlowProvider, same reasoning as RelatedAssetsDiagram.
export const PropertyLayoutCanvas = forwardRef(function PropertyLayoutCanvas({ tiles, manualPositions, onPositionsChange, onSelectTile }, ref) {
  return (
    <ReactFlowProvider>
      <PropertyLayoutCanvasInner ref={ref} tiles={tiles} manualPositions={manualPositions} onPositionsChange={onPositionsChange} onSelectTile={onSelectTile} />
    </ReactFlowProvider>
  );
});

const PropertyLayoutCanvasInner = forwardRef(function PropertyLayoutCanvasInner({ tiles, manualPositions, onPositionsChange, onSelectTile }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    tiles.map(t => ({
      id: t.key,
      type: 'propertyLayoutNode',
      position: manualPositions[t.key] ?? PROPERTY_LAYOUT_DEFAULT_POSITION,
      data: { tileProps: t.tileProps, selected: !!t.selected },
    }))
  );

  // Keeps the node set in sync when which properties are visible changes
  // (tier filter, or a property's underlying value changing) without
  // disturbing the working position of any property that stays visible.
  // Deliberately keyed on tileKeysSignature (a plain string) rather than
  // the tiles array itself — tiles is rebuilt fresh on every render of
  // the parent (HmiPropertiesListing) regardless of whether the visible
  // property set actually changed, so depending on the array reference
  // directly caused this effect to re-fire every render, which in turn
  // re-triggered the position-reporting effect below, which triggered
  // the parent to re-render again — an infinite loop, caught directly
  // via a real component test before this ever reached production.
  // tiles itself is still read fresh inside the effect body (via closure)
  // for its actual tileProps content, just not used as the trigger.
  // viewMode is appended here too — it's shared across every tile (all
  // pull it from the same kpiViewMode state), so reading it off the first
  // tile is enough to catch changes without needing a signature per tile;
  // without this, toggling view mode while in manual mode silently did
  // nothing, since the keys themselves never changed so this effect
  // never re-ran and the already-built nodes kept their stale tileProps.
  // Per-property visuals mean viewMode is no longer guaranteed shared
  // across tiles, so it's now part of each tile's own signature entry
  // (along with whether it's the Details panel's selected property) —
  // still a plain string, so the no-infinite-loop reasoning above holds.
  const tileKeysSignature = tiles.map(t => `${t.key}:${t.tileProps?.viewMode ?? ''}:${t.selected ? 1 : 0}`).join('|');
  useEffect(() => {
    setNodes(current => {
      const tileMap = new Map(tiles.map(t => [t.key, t]));
      const kept = current
        .filter(n => tileMap.has(n.id))
        .map(n => ({ ...n, data: { tileProps: tileMap.get(n.id).tileProps, selected: !!tileMap.get(n.id).selected } }));
      const keptIds = new Set(kept.map(n => n.id));
      const added = tiles
        .filter(t => !keptIds.has(t.key))
        .map(t => ({
          id: t.key,
          type: 'propertyLayoutNode',
          position: manualPositions[t.key] ?? PROPERTY_LAYOUT_DEFAULT_POSITION,
          data: { tileProps: t.tileProps, selected: !!t.selected },
        }));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKeysSignature]);

  // Reports the working position set up to the parent on every change —
  // Save Template picks this up as part of its own payload when the user
  // actually saves. This component only owns the live editing canvas,
  // same separation as the diagram's own nodes state vs. Copy Layout.
  useEffect(() => {
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify('Select at least 2 properties to align (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify('Select at least 3 properties to distribute (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  // One-shot convenience, not a persistent layout algorithm — just packs
  // every currently-visible property into sequential grid cells in their
  // current order. Free to build on top of Align/Distribute's existing
  // node-shaped-array plumbing.
  const handleArrangeGrid = () => {
    setNodes(current => current.map((n, i) => ({
      ...n,
      position: {
        x: (i % PROPERTY_LAYOUT_ARRANGE_COLUMNS) * PROPERTY_LAYOUT_ARRANGE_CELL_WIDTH,
        y: Math.floor(i / PROPERTY_LAYOUT_ARRANGE_COLUMNS) * PROPERTY_LAYOUT_ARRANGE_CELL_HEIGHT,
      },
    })));
  };

  // Align/Distribute/Arrange in Grid now live in the parent toolbar
  // (HmiPropertiesListing's own manual-mode row) rather than a Panel on
  // this canvas, so the parent needs a way to actually trigger them here.
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
        nodeTypes={PROPERTY_LAYOUT_NODE_TYPES}
        onNodesChange={onNodesChange}
        // A plain click (not a drag — React Flow only fires this when the
        // node didn't move) selects the property in the Details panel.
        onNodeClick={onSelectTile ? (_, node) => onSelectTile(node.id) : undefined}
        snapToGrid
        snapGrid={[PROPERTY_LAYOUT_GRID_SIZE, PROPERTY_LAYOUT_GRID_SIZE]}
        minZoom={0.1}
        fitView
      >
        <Background color="#b0b0b0" />
      </ReactFlow>
    </div>
  );
});
