// operator/canvas/canvasGeometry.js
// Node geometry shared by every React Flow canvas in the app (the
// related-assets diagram, the Cards manual canvas, the property manual
// canvas): where an edge meets a node's border for floating edges, node
// bounds, and the align / distribute actions behind the canvas toolbars.
// Pure functions over React Flow node objects; no React.



// Fallback only, for the rare case a node's real measured dimensions
// aren't available for some reason — the normal path now uses each
// node's actual rendered size (node.measured.width/height, via React
// Flow's own measurement), not a fixed stub. See the hide → measure →
// layout → reveal sequence in RelatedAssetsDiagramInner below.
export const RELATED_ASSETS_DIAGRAM_NODE_WIDTH = 160;

export const RELATED_ASSETS_DIAGRAM_NODE_HEIGHT = 50;

// "Free ports" support (letting an edge exit from whichever side of a
// node is actually closest, rather than one fixed side for every edge)
// needs two separate pieces: telling ELK it's allowed to think this way
// (elk.portConstraints: FREE, set in getElkLayoutedElements) and actually
// rendering an edge that connects to a real geometric point on each
// node's border rather than one fixed Handle position. This second part
// is what the functions below do — adapted from xyflow's own official
// floating-edges example (reactflow.dev/examples/edges/floating-edges),
// updated for React Flow v12's InternalNode shape (internals.
// positionAbsolute, measured.width/height) rather than the older v9/v11
// shape those docs were written against. Verified directly against three
// geometric test cases (node to the right, node below, node diagonal)
// before use — all three produced exactly the expected intersection
// points and sides.

// Returns the point where a straight line from intersectionNode's center
// to targetNode's center crosses intersectionNode's own rectangular
// border.
function getNodeIntersection(intersectionNode, targetNode) {
  const iw = intersectionNode.measured?.width ?? intersectionNode.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const ih = intersectionNode.measured?.height ?? intersectionNode.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const iPos = intersectionNode.internals.positionAbsolute;
  const tw = targetNode.measured?.width ?? targetNode.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const th = targetNode.measured?.height ?? targetNode.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const tPos = targetNode.internals.positionAbsolute;

  const w = iw / 2;
  const h = ih / 2;
  const x2 = iPos.x + w;
  const y2 = iPos.y + h;
  const x1 = tPos.x + tw / 2;
  const y1 = tPos.y + th / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1));
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

// Which side (for Handle-position purposes) a given intersection point
// actually falls on, for a given node.
function getFloatingEdgePosition(node, intersectionPoint) {
  const nw = node.measured?.width ?? node.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const nh = node.measured?.height ?? node.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const nPos = node.internals.positionAbsolute;
  const nx = Math.round(nPos.x);
  const ny = Math.round(nPos.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);
  if (px <= nx + 1) return 'left';
  if (px >= nx + nw - 1) return 'right';
  if (py <= ny + 1) return 'top';
  if (py >= ny + nh - 1) return 'bottom';
  return 'top';
}

// The point at the exact middle of one side of a node's border — used
// for "Center" connection point mode. Side is determined the same way
// as "Anywhere" mode (via the real intersection point below), so both
// modes agree on *which* side is closest; they only differ in *where*
// along that side the line actually lands.
function getSideCenterPoint(node, side) {
  const w = node.measured?.width ?? node.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const h = node.measured?.height ?? node.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const pos = node.internals.positionAbsolute;
  if (side === 'left') return { x: pos.x, y: pos.y + h / 2 };
  if (side === 'right') return { x: pos.x + w, y: pos.y + h / 2 };
  if (side === 'top') return { x: pos.x + w / 2, y: pos.y };
  return { x: pos.x + w / 2, y: pos.y + h }; // 'bottom'
}

// connectionPointMode: 'anywhere' uses the real geometric intersection
// point (can land anywhere along the closest side); 'center' uses the
// same closest-side determination but snaps the actual connection point
// to that side's midpoint instead.
export function getFloatingEdgeParams(source, target, connectionPointMode) {
  const sourceIntersectionPoint = getNodeIntersection(source, target);
  const targetIntersectionPoint = getNodeIntersection(target, source);
  const sourcePos = getFloatingEdgePosition(source, sourceIntersectionPoint);
  const targetPos = getFloatingEdgePosition(target, targetIntersectionPoint);
  const sourcePoint = connectionPointMode === 'center' ? getSideCenterPoint(source, sourcePos) : sourceIntersectionPoint;
  const targetPoint = connectionPointMode === 'center' ? getSideCenterPoint(target, targetPos) : targetIntersectionPoint;
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos,
    targetPos,
  };
}

// Both helpers below operate on the full nodes array but only ever move
// nodes where node.selected is true (React Flow's own selection state,
// already tracked for free via onNodesChange/applyNodeChanges — no
// extra wiring needed for multi-select, which is built in via shift+drag
// or ctrl/cmd+click). Unselected nodes are returned unchanged. Verified
// directly against a synthetic case with differently-sized nodes before
// use: align correctly matches edges/centers of the selection's own
// combined bounding box, and distribute produces genuinely equal gaps
// while leaving the two extreme (first/last) nodes' outer edges in
// place — only the nodes in between move.
function getNodeBounds(n) {
  const w = n.measured?.width ?? n.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const h = n.measured?.height ?? n.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  return { left: n.position.x, right: n.position.x + w, top: n.position.y, bottom: n.position.y + h, width: w, height: h };
}

export function alignSelectedNodes(nodes, mode) {
  const selected = nodes.filter(n => n.selected);
  if (selected.length < 2) return null;
  const bounds = new Map(selected.map(n => [n.id, getNodeBounds(n)]));
  const tops = selected.map(n => bounds.get(n.id).top);
  const bottoms = selected.map(n => bounds.get(n.id).bottom);
  const lefts = selected.map(n => bounds.get(n.id).left);
  const rights = selected.map(n => bounds.get(n.id).right);
  let target;
  if (mode === 'top') target = Math.min(...tops);
  else if (mode === 'bottom') target = Math.max(...bottoms);
  else if (mode === 'middle') target = (Math.min(...tops) + Math.max(...bottoms)) / 2;
  else if (mode === 'left') target = Math.min(...lefts);
  else if (mode === 'right') target = Math.max(...rights);
  else if (mode === 'center') target = (Math.min(...lefts) + Math.max(...rights)) / 2;

  return nodes.map(n => {
    if (!n.selected) return n;
    const b = bounds.get(n.id);
    if (mode === 'top') return { ...n, position: { ...n.position, y: target } };
    if (mode === 'bottom') return { ...n, position: { ...n.position, y: target - b.height } };
    if (mode === 'middle') return { ...n, position: { ...n.position, y: target - b.height / 2 } };
    if (mode === 'left') return { ...n, position: { ...n.position, x: target } };
    if (mode === 'right') return { ...n, position: { ...n.position, x: target - b.width } };
    return { ...n, position: { ...n.position, x: target - b.width / 2 } }; // 'center'
  });
}

export function distributeSelectedNodes(nodes, axis) {
  const selected = nodes.filter(n => n.selected);
  if (selected.length < 3) return null;
  const bounds = new Map(selected.map(n => [n.id, getNodeBounds(n)]));
  const posKey = axis === 'horizontal' ? 'left' : 'top';
  const sizeKey = axis === 'horizontal' ? 'width' : 'height';
  const sorted = [...selected].sort((a, b) => bounds.get(a.id)[posKey] - bounds.get(b.id)[posKey]);
  const first = bounds.get(sorted[0].id);
  const last = bounds.get(sorted[sorted.length - 1].id);
  const totalSpan = (last[posKey] + last[sizeKey]) - first[posKey];
  const totalSize = sorted.reduce((sum, n) => sum + bounds.get(n.id)[sizeKey], 0);
  const gap = (totalSpan - totalSize) / (sorted.length - 1);

  let cursor = first[posKey];
  const newPos = new Map();
  sorted.forEach(n => {
    const b = bounds.get(n.id);
    newPos.set(n.id, cursor);
    cursor += b[sizeKey] + gap;
  });

  return nodes.map(n => {
    if (!newPos.has(n.id)) return n;
    return axis === 'horizontal'
      ? { ...n, position: { ...n.position, x: newPos.get(n.id) } }
      : { ...n, position: { ...n.position, y: newPos.get(n.id) } };
  });
}
