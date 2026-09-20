// operator/canvas/ManualLayoutCanvas.jsx
// The manual-layout canvas, shared by everything that lets the user place
// things by hand: property tiles (PropertyTileCanvas) and related-asset
// cards (AssetCardCanvas). One React Flow node per item, free drag
// positioning with grid snap, and align / distribute / arrange-in-grid
// exposed through an imperative ref for the parent's toolbar to call.
// Never any edges — these graphs are spatial arrangements, not
// relationships (AssetDiagramView is what exists for those).
//
// What a caller supplies: `nodeTypes` and the matching `nodeType` name
// (built once at module scope, since React Flow warns and misbehaves if
// nodeTypes changes identity), the grid-arrange geometry, and the noun to
// use in the "select at least N …" warnings. What it gets back through
// the ref: align(mode), distribute(axis), arrangeGrid().
//
// Items are `{ key, data, signature }`: `data` becomes the node's data
// (whatever that caller's node component reads), and `signature` is a
// plain string that changes whenever the node needs rebuilding from it.

import { forwardRef, useEffect, useImperativeHandle } from 'react';
import notify from 'devextreme/ui/notify';
import { ReactFlowProvider, useNodesState, ReactFlow, Background } from '@xyflow/react';
import { alignSelectedNodes, distributeSelectedNodes } from './canvasGeometry';

// No saved position yet (an item newly revealed by a filter change, or
// added after positions were last saved) lands here: "stack in the
// corner," never an auto-placement search, matching the no-reflow
// decision for this whole feature.
const DEFAULT_POSITION = { x: 0, y: 0 };

const DEFAULT_GRID_SIZE = 20;

// Self-contained ReactFlowProvider so this can be dropped in anywhere
// without the caller remembering to wrap it — same as AssetDiagramView.
export const ManualLayoutCanvas = forwardRef(function ManualLayoutCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <ManualLayoutCanvasInner ref={ref} {...props} />
    </ReactFlowProvider>
  );
});

const ManualLayoutCanvasInner = forwardRef(function ManualLayoutCanvasInner({
  items,
  manualPositions,
  onPositionsChange,
  nodeType,
  nodeTypes,
  arrange,
  itemNoun,
  gridSize = DEFAULT_GRID_SIZE,
  onSelectItem,
  readOnly,
}, ref) {
  const buildNode = item => ({
    id: item.key,
    type: nodeType,
    position: manualPositions[item.key] ?? DEFAULT_POSITION,
    data: item.data,
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(items.map(buildNode));

  // Keeps the node set in sync when which items are shown changes (a tier
  // filter, a visibility toggle, a property's value changing) without
  // disturbing the working position of anything that stays.
  //
  // Deliberately keyed on a joined string of the items' signatures rather
  // than on the items array itself: that array is rebuilt fresh on every
  // render of the parent whether or not anything actually changed, so
  // depending on its reference re-fired this effect every render, which
  // re-triggered the position reporting below, which re-rendered the
  // parent — an infinite loop, caught by a real component test before it
  // ever reached production. The items themselves are still read fresh
  // inside the effect body for their current data, just not used as the
  // trigger. Each caller decides what belongs in its signature: whatever
  // can change about an item while its key stays the same (a tile's view
  // mode and selected state, say) has to be in there, or the nodes keep
  // stale data and the change silently does nothing on screen.
  const itemsSignature = items.map(item => item.signature ?? item.key).join('|');
  useEffect(() => {
    setNodes(current => {
      const itemMap = new Map(items.map(item => [item.key, item]));
      const kept = current
        .filter(n => itemMap.has(n.id))
        .map(n => ({ ...n, data: itemMap.get(n.id).data }));
      const keptIds = new Set(kept.map(n => n.id));
      const added = items.filter(item => !keptIds.has(item.key)).map(buildNode);
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSignature]);

  // Reports the working position set up to the parent on every change —
  // the parent's Save picks it up as part of its own payload when the
  // user actually saves. This component only owns the live editing
  // canvas, never the saved template.
  useEffect(() => {
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify(`Select at least 2 ${itemNoun} to align (shift+drag to select multiple)`, 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify(`Select at least 3 ${itemNoun} to distribute (shift+drag to select multiple)`, 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  // One-shot convenience, not a persistent layout algorithm — just packs
  // everything currently shown into sequential grid cells in its current
  // order, on top of Align/Distribute's existing node-array plumbing.
  const handleArrangeGrid = () => {
    setNodes(current => current.map((n, i) => ({
      ...n,
      position: {
        x: (i % arrange.columns) * arrange.cellWidth,
        y: Math.floor(i / arrange.columns) * arrange.cellHeight,
      },
    })));
  };

  // Align / Distribute / Arrange in Grid live in the parent's toolbar
  // rather than on a Panel here, so the parent needs a way to trigger
  // them.
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
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        // A plain click (not a drag — React Flow only fires this when the
        // node didn't move) selects the item in the Details panel.
        onNodeClick={onSelectItem ? (_, node) => onSelectItem(node.id) : undefined}
        snapToGrid
        snapGrid={[gridSize, gridSize]}
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
