// coordinate/coordinateMove.js
// The maths of moving things in a coordinate layout — shared by the
// designer (ContainerCard) and CoordinateCanvas, so placing an item feels
// the same wherever it happens. No DOM here: coordinateCanvasDom.js
// measures and listens, and calls these.
//
// Everything is in layout pixels (the zoom is divided out by the caller).
//
// An item's coord is the designer's: { left, top, right, bottom, width,
// height, ... }, any of them blank. How it's anchored decides which fields
// a move writes, per axis:
//   'left'  only left is set (or neither)  → move updates left
//   'right' only right is set              → move updates right
//   'both'  left and right (stretched)     → both, so its width is kept
// and the same for top / bottom.
//
// A move starts from moveStartOf(coord, measured) — the coord's fields as
// numbers, its anchors, and where it's drawn ({ x, y, w, h }, measured,
// since a right-anchored or stretched item has no stored left/width).
// Then for each mouse position:
//   movedCoord(start, dx, dy, { snap, snapSize, targets })
//     → { update, delta, guides }
//   update: the coord fields to write; delta: how far it actually moved
//   ({ x, y }, after snapping), which shiftedCoord applies to everything
//   else selected; guides: the snap lines to draw.
//
// Snapping (when on): each axis first tries to line one of the item's
// edges or its centre up with a target's edge or centre within snapSize;
// failing that, each written field rounds to the snapSize grid. Targets
// are the other items and the container itself (snapTargets).

export const isSetCoord = (v) => v !== '' && v !== undefined && v !== null;

const num = (v) => (isSetCoord(v) ? Number(v) || 0 : 0);

// → { x: 'left'|'right'|'both', y: 'top'|'bottom'|'both' }
export function anchorsOf(coord) {
  const c = coord || {};
  const l = isSetCoord(c.left);
  const r = isSetCoord(c.right);
  const t = isSetCoord(c.top);
  const b = isSetCoord(c.bottom);
  return {
    x: l && r ? 'both' : r ? 'right' : 'left',
    y: t && b ? 'both' : b ? 'bottom' : 'top',
  };
}

// measured: { x, y, w, h } — where the item is drawn, in its container.
// Optional; without it the stored left/top stand in for x/y.
export function moveStartOf(coord, measured = null) {
  const c = coord || {};
  const anchors = anchorsOf(c);
  const left = num(c.left);
  const top = num(c.top);
  return {
    left,
    top,
    right: num(c.right),
    bottom: num(c.bottom),
    xAnchor: anchors.x,
    yAnchor: anchors.y,
    x: measured ? measured.x : left,
    y: measured ? measured.y : top,
    w: measured ? measured.w : num(c.width),
    h: measured ? measured.h : num(c.height),
  };
}

// The fields that move `start` by (dx, dy), in its own anchors. Never
// negative. Used for everything else in a group move.
export function shiftedCoord(start, dx, dy) {
  const update = {};
  if (start.xAnchor !== 'right') update.left = Math.max(0, Math.round(start.left + dx));
  if (start.xAnchor !== 'left') update.right = Math.max(0, Math.round(start.right - dx));
  if (start.yAnchor !== 'bottom') update.top = Math.max(0, Math.round(start.top + dy));
  if (start.yAnchor !== 'top') update.bottom = Math.max(0, Math.round(start.bottom - dy));
  return update;
}

// What an item can snap to: each rect's left / centre / right and top /
// centre / bottom. rects: [{ x, y, w, h }] (the other items); container:
// { w, h }, whose edges and centre count too.
export function snapTargets(rects, container = null) {
  const all = container ? [...rects, { x: 0, y: 0, w: container.w, h: container.h }] : rects;
  return {
    xs: all.flatMap(r => [r.x, r.x + r.w / 2, r.x + r.w]),
    ys: all.flatMap(r => [r.y, r.y + r.h / 2, r.y + r.h]),
  };
}

// The nearest line-up within `range` between the item's three points
// (start, centre, end) and the targets: { offset, at } or null.
function nearestLineUp(points, targets, range) {
  let best = null;
  let bestDist = range;
  for (const t of targets) {
    for (const p of points) {
      const dist = Math.abs(p - t);
      if (dist < bestDist) { bestDist = dist; best = { offset: t - p, at: t }; }
    }
  }
  return best;
}

export function movedCoord(start, dx, dy, { snap = false, snapSize = 8, targets = null } = {}) {
  // Each field as the mouse alone would put it.
  const raw = {
    left: Math.max(0, Math.round(start.left + dx)),
    right: Math.max(0, Math.round(start.right - dx)),
    top: Math.max(0, Math.round(start.top + dy)),
    bottom: Math.max(0, Math.round(start.bottom - dy)),
  };
  const final = { ...raw };
  const guides = [];

  if (snap) {
    const grid = (v) => Math.round(v / snapSize) * snapSize;
    // Where it's drawn, moved — what lines up with the targets.
    const x = start.x + dx;
    const y = start.y + dy;
    const lineX = targets ? nearestLineUp([x, x + start.w / 2, x + start.w], targets.xs, snapSize) : null;
    const lineY = targets ? nearestLineUp([y, y + start.h / 2, y + start.h], targets.ys, snapSize) : null;
    // A line-up's offset is in left/top terms: +offset moves right / down,
    // which is a smaller right / bottom.
    final.left = lineX ? Math.max(0, raw.left + lineX.offset) : grid(raw.left);
    final.right = lineX ? Math.max(0, raw.right - lineX.offset) : grid(raw.right);
    final.top = lineY ? Math.max(0, raw.top + lineY.offset) : grid(raw.top);
    final.bottom = lineY ? Math.max(0, raw.bottom - lineY.offset) : grid(raw.bottom);
    if (lineX) guides.push({ type: 'v', position: lineX.at });
    if (lineY) guides.push({ type: 'h', position: lineY.at });
  }

  const update = {};
  if (start.xAnchor !== 'right') update.left = final.left;
  if (start.xAnchor !== 'left') update.right = final.right;
  if (start.yAnchor !== 'bottom') update.top = final.top;
  if (start.yAnchor !== 'top') update.bottom = final.bottom;

  // How far it really moved, in left/top terms, read from the field it
  // writes — so a right-anchored item's group moves with it.
  const delta = {
    x: start.xAnchor === 'right' ? start.right - final.right : final.left - start.left,
    y: start.yAnchor === 'bottom' ? start.bottom - final.bottom : final.top - start.top,
  };
  return { update, delta, guides };
}

// Box-select: the band between two points, and whether a rect touches it.
export function bandBetween(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function touchesBand(rect, band) {
  return rect.x < band.x + band.w && rect.x + rect.w > band.x
    && rect.y < band.y + band.h && rect.y + rect.h > band.y;
}
