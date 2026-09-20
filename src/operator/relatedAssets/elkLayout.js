// operator/relatedAssets/elkLayout.js
// Auto-layout for the related-assets diagram: the elkjs instance, the
// algorithm / direction / edge-routing choices the diagram toolbar offers
// (and which algorithms honour which options), and getElkLayoutedElements,
// which runs nodes and edges through ELK and returns React Flow positions.

import ELK from 'elkjs/lib/elk.bundled.js';
import { LayeredAlgorithmIcon, TreeAlgorithmIcon, RadialAlgorithmIcon, ForceAlgorithmIcon, ColumnFlowIcon, RowFlowIcon, OrthogonalRoutingIcon, PolylineRoutingIcon } from '../icons';
import { RELATED_ASSETS_DIAGRAM_NODE_HEIGHT, RELATED_ASSETS_DIAGRAM_NODE_WIDTH } from '../canvas/canvasGeometry';

const elk = new ELK();

// Algorithm choices offered in the diagram view's toolbar. 'disco' isn't
// included since elkjs dropped it from this bundled build after 0.8.2
// (confirmed directly — it throws "Layout algorithm 'disco' not found" on
// this exact installed version); 'box'/'rectpacking' are rectangle-packing
// algorithms rather than relationship-aware layouts, so left out as not a
// good fit for a node-link diagram.
export const RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS = [
  { value: 'layered', label: 'Layered', text: 'Layered', Icon: LayeredAlgorithmIcon },
  { value: 'mrtree', label: 'Tree', text: 'Tree', Icon: TreeAlgorithmIcon },
  { value: 'radial', label: 'Radial', text: 'Radial', Icon: RadialAlgorithmIcon },
  { value: 'force', label: 'Force', text: 'Force', Icon: ForceAlgorithmIcon },
];

// Only 'layered' and 'mrtree' actually respect elk.direction — verified
// directly by comparing DOWN vs RIGHT output for each algorithm; radial,
// force, and stress produced byte-identical positions regardless, since
// they're organic/physics-style layouts with no inherent "flow" direction.
export const RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS = new Set(['layered', 'mrtree']);

export const RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS = [
  { text: 'Vertical', value: 'DOWN', Icon: ColumnFlowIcon },
  { text: 'Horizontal', value: 'RIGHT', Icon: RowFlowIcon },
];

// Gates the edge routing and both spacing controls below — all three use
// layered-specific ELK options. Verified directly: the other four
// algorithms produced byte-identical output regardless of any of these
// three settings, since each has its own internal routing/spacing logic
// that doesn't use them at all.
export const RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS = new Set(['layered']);

// Simplified to just the two ELK actually computes distinct bend-point
// routing for (verified earlier: ORTHOGONAL gives hard right angles,
// POLYLINE gives angled-but-straight segments — 'Default'/UNDEFINED and
// SPLINES were dropped as unnecessary choices here).
export const RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS = [
  { text: 'Orthogonal', value: 'ORTHOGONAL', Icon: OrthogonalRoutingIcon },
  { text: 'Polyline', value: 'POLYLINE', Icon: PolylineRoutingIcon },
];

// Direct control over the two spacing settings that actually, always
// govern compactness — replaced an earlier edge-node/edge-edge spacing
// pair that turned out to be "floor" constraints only binding once they
// exceeded these two values anyway (verified directly: bounds stayed
// completely flat until the edge-spacing value exceeded 80, the
// nodeNodeBetweenLayers value below), making them invisible at any
// preset that made sense on their own. These two are direct, unconditional
// constraints instead — every value tested here produced a real,
// verified change in the laid-out bounds. Rendered as sliders (0-200,
// verified safe including both at 0 simultaneously — no error, nodes
// just pack as tight as their own sizes allow) rather than discrete
// presets, for finer control across the range.
// elk.spacing.nodeNode: general gap between nodes. Verified to
// meaningfully affect layered, mrtree, and force; a smaller but still
// real effect on radial; negligible on stress — shown for every
// algorithm since it's a core (non-layered-specific) option.
// elk.layered.spacing.nodeNodeBetweenLayers: gap specifically between
// layers (columns/rows). Verified to affect only 'layered' — even
// mrtree, also direction-aware, showed zero change — so this control is
// scoped to 'layered' only, same as the other RELATED_ASSETS_DIAGRAM_
// LAYERED_ONLY_CONTROLS.
// (The two sliders themselves live in RelatedAssetsEditor's toolbar.)

// Runs nodes/edges through ELK's layered algorithm and returns them in
// React Flow's shape (position: {x, y} instead of bare x/y fields).
// Mirrors React Flow's own documented elkjs integration pattern exactly
// (https://reactflow.dev/examples/layout/elkjs) — verified directly
// against a real render, not just read. Each node's own width/height
// (real measured dimensions, by the time this is called) are used as-is;
// only falls back to the stub size above if a node genuinely has none.
export function getElkLayoutedElements(nodes, edges, layoutOptions) {
  const { algorithm, direction, edgeRouting, nodeSpacing, layerSpacing, aspectRatio } = layoutOptions;
  const isVertical = direction === 'DOWN';
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': algorithm,
      'elk.direction': direction,
      // Direct, unconditional spacing controls — unlike the earlier
      // edge-node/edge-edge spacing pair (removed), these two always
      // affect the laid-out bounds, verified directly across a wide
      // range of values on real graph data.
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.nodeNode': String(nodeSpacing),
      // elk.aspectRatio only reshapes the drawing (into multiple rows)
      // when paired with wrapping.strategy — verified directly: without
      // it, aspectRatio only ever has a binary "wrap once, all the way"
      // effect; with MULTI_EDGE wrapping enabled, values from ~0.3
      // (near-square) up through the graph's natural ratio produce a
      // real, smooth range of shapes. Both are only respected by
      // 'layered' — the other four algorithms produced byte-identical
      // output regardless. Safe to always enable wrapping alongside a
      // high aspectRatio value (like the default here) — verified this
      // produces the exact same bounds as not setting either at all,
      // since ELK only wraps when the natural shape doesn't already
      // satisfy the requested ratio.
      'elk.aspectRatio': String(aspectRatio),
      'elk.layered.wrapping.strategy': 'MULTI_EDGE',
      // Only 'layered' actually respects this — verified directly by
      // comparing output across all five algorithms; the other four
      // produced byte-identical results regardless, since each has its
      // own internal routing logic that doesn't use this option at all.
      // Passing it regardless is harmless (silently ignored elsewhere),
      // but the toolbar only shows this control for 'layered' so the
      // choice isn't misleading.
      'elk.edgeRouting': edgeRouting,
      // Every edge now finds its own real closest side on each node —
      // "Fixed Sides" mode (one fixed slot per node regardless of where
      // a given edge's other end actually was) has been removed
      // entirely. Verified to run cleanly (no error) on all five
      // algorithms. Pairs with the AssetDiagramFloatingEdge component,
      // which does the React Flow side of actually drawing to a real
      // point on each node's border instead of one fixed Handle.
      'elk.portConstraints': 'FREE',
    },
    children: nodes.map(n => ({
      ...n,
      // These two are no longer used for actual edge rendering —
      // AssetDiagramFloatingEdge always computes its own connection
      // point now — but ELK's node input still expects some values here.
      targetPosition: isVertical ? 'top' : 'left',
      sourcePosition: isVertical ? 'bottom' : 'right',
      width: n.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH,
      height: n.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT,
    })),
    edges,
  };
  return elk.layout(graph).then(layoutedGraph => ({
    nodes: layoutedGraph.children.map(n => ({ ...n, position: { x: n.x, y: n.y } })),
    edges: layoutedGraph.edges,
  }));
}
