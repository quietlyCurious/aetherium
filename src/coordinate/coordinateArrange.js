// coordinate/coordinateArrange.js
// Align, distribute and arrange-in-grid for items in a coordinate layout —
// the same actions, maths and icons as Visualization's manual canvases
// (operator/canvas/canvasGeometry.js), applied to designer containers.
//
// Works in two halves so the maths stays testable:
//   arrangedPositions(items, action)  where each item's top-left goes,
//       from items [{ id, x, y, w, h }] in layout pixels (measured by the
//       caller from the DOM, since a stretched item has no stored size)
//   coordUpdateFor(coord, pos, size, parent)  the coord fields that put an
//       item there, respecting how it's anchored: a left-anchored item gets
//       a new left, a right-anchored one a new right, a stretched one both
//       (so its derived width is kept). Same for top/bottom.
//
// Actions: { type: 'align', mode: top|middle|bottom|left|center|right },
// { type: 'distribute', axis: horizontal|vertical }, { type: 'grid' }.

import { alignSelectedNodes, distributeSelectedNodes } from '../operator/canvas/canvasGeometry';
import { isSetCoord } from './coordinateMove';

// Arrange in Grid: the gap between cells, and the most columns it will use.
const GRID_GAP = 8;

const asNode = (it) => ({ id: it.id, selected: true, position: { x: it.x, y: it.y }, measured: { width: it.w, height: it.h } });

// → Map(id → { x, y }), or null when the action needs more items than given
// (align and grid need 2, distribute 3).
export function arrangedPositions(items, action) {
  if (action.type === 'grid') {
    if (items.length < 2) return null;
    // Reading order (rows, then left to right), into a near-square grid of
    // equal cells sized to the largest item, starting where the selection
    // starts.
    const ordered = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const columns = Math.ceil(Math.sqrt(ordered.length));
    const cellW = Math.max(...ordered.map(it => it.w)) + GRID_GAP;
    const cellH = Math.max(...ordered.map(it => it.h)) + GRID_GAP;
    const originX = Math.min(...ordered.map(it => it.x));
    const originY = Math.min(...ordered.map(it => it.y));
    return new Map(ordered.map((it, i) => [it.id, {
      x: originX + (i % columns) * cellW,
      y: originY + Math.floor(i / columns) * cellH,
    }]));
  }
  const nodes = items.map(asNode);
  const moved = action.type === 'align' ? alignSelectedNodes(nodes, action.mode) : distributeSelectedNodes(nodes, action.axis);
  if (!moved) return null;
  return new Map(moved.map(n => [n.id, { x: n.position.x, y: n.position.y }]));
}

const isSet = isSetCoord;

// pos: the new top-left; size: { w, h } as drawn; parent: { w, h } of the
// coordinate container's content box. All in layout pixels. Positions are
// rounded, and never negative.
export function coordUpdateFor(coord, pos, size, parent) {
  const c = coord || {};
  const x = Math.max(0, Math.round(pos.x));
  const y = Math.max(0, Math.round(pos.y));
  const update = {};
  const leftSet = isSet(c.left);
  const rightSet = isSet(c.right);
  const topSet = isSet(c.top);
  const bottomSet = isSet(c.bottom);
  if (leftSet || !rightSet) update.left = x;
  if (rightSet) update.right = Math.max(0, Math.round(parent.w - (x + size.w)));
  if (topSet || !bottomSet) update.top = y;
  if (bottomSet) update.bottom = Math.max(0, Math.round(parent.h - (y + size.h)));
  return update;
}
