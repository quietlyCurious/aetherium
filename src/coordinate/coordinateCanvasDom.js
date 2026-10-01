// coordinate/coordinateCanvasDom.js
// The mouse side of editing a coordinate layout: moving items (with
// snapping and group moves) and box-select. Shared by the designer
// (ContainerCard) and CoordinateCanvas; the maths is coordinateMove.js.
//
// Both work on plain DOM: a container element whose direct children
// (matching `itemSelector`) are the items, absolutely positioned. Sizes are
// measured on screen and divided by the zoom (viewportScale), so moves,
// snapping, guides and the band all work in the layout pixels coordinates
// are stored in, at any zoom.

import { viewportScale } from '../viewport/FitViewport';
import { bandBetween, moveStartOf, movedCoord, shiftedCoord, snapTargets, touchesBand } from './coordinateMove';
import { arrangedPositions, coordUpdateFor } from './coordinateArrange';

// Where `el` is drawn inside `container`, in layout pixels (scroll counted).
export function rectIn(el, container, k = viewportScale(container)) {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    x: (r.left - c.left) / k + container.scrollLeft,
    y: (r.top - c.top) / k + container.scrollTop,
    w: r.width / k,
    h: r.height / k,
  };
}

// Starts moving the item `itemEl` from a mousedown. Options:
//   coord        the item's coord
//   coMovers     [{ id, coord }] — the rest of a multi-selection, moved by
//                the same amount, each in its own anchors
//   itemSelector selects the container's items (for snap targets)
//   snap, snapSize
//   onUpdate(id, update)   write coord fields (called for every mouse move)
//   onGuides(guides|null)  the snap lines to draw in the container
//   id           the item's own id, for onUpdate
export function beginCoordinateMove(e, { itemEl, id, coord, coMovers = [], itemSelector, snap = false, snapSize = 8, onUpdate, onGuides }) {
  const container = itemEl.parentElement;
  const k = viewportScale(itemEl);
  const measured = container ? rectIn(itemEl, container, k) : null;
  const start = moveStartOf(coord, measured);
  const others = container
    ? Array.from(container.querySelectorAll(`:scope > ${itemSelector}`)).filter(el => el !== itemEl).map(el => rectIn(el, container, k))
    : [];
  const box = container ? { w: container.getBoundingClientRect().width / k, h: container.getBoundingClientRect().height / k } : null;
  const targets = snapTargets(others, box);
  const coStarts = coMovers.map(m => ({ id: m.id, start: moveStartOf(m.coord) }));
  const sx = e.clientX;
  const sy = e.clientY;

  const onMove = (ev) => {
    const { update, delta, guides } = movedCoord(start, (ev.clientX - sx) / k, (ev.clientY - sy) / k, { snap, snapSize, targets });
    onUpdate(id, update);
    coStarts.forEach(m => onUpdate(m.id, shiftedCoord(m.start, delta.x, delta.y)));
    if (onGuides) onGuides(guides.length ? guides : null);
  };
  const onUp = () => {
    if (onGuides) onGuides(null);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Starts a box-select from a mousedown on the container's empty space.
// Nothing happens until the mouse has moved a few pixels (so a plain click
// stays a click). Options:
//   container     the element the items sit in
//   itemSelector  selects its items
//   idOf(el)      an item element's id
//   onBand(band|null)   the band to draw ({ x, y, w, h } in the container)
//   onDone(ids, { add })  the items the band touched; add = Shift/Ctrl/Cmd
export function beginMarquee(e, { container, itemSelector, idOf, onBand, onDone }) {
  const k = viewportScale(container);
  const rect = container.getBoundingClientRect();
  const toLocal = (cx, cy) => ({ x: (cx - rect.left) / k + container.scrollLeft, y: (cy - rect.top) / k + container.scrollTop });
  const start = toLocal(e.clientX, e.clientY);
  const sx = e.clientX;
  const sy = e.clientY;
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  let active = false;
  const onMove = (ev) => {
    if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
    active = true;
    onBand(bandBetween(start, toLocal(ev.clientX, ev.clientY)));
  };
  const onUp = (ev) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!active) return;
    const band = bandBetween(start, toLocal(ev.clientX, ev.clientY));
    onBand(null);
    // offsetLeft/Top are layout pixels within the container, unaffected by zoom.
    const ids = Array.from(container.querySelectorAll(`:scope > ${itemSelector}`))
      .filter(el => touchesBand({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }, band))
      .map(idOf);
    onDone(ids, { add });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Align / distribute / arrange-in-grid for items drawn in `container`:
// items [{ id, coord, el }] → Map(id → coord update), or null when the
// action needs more items. Sizes and positions are read in layout pixels
// (offset*), which the zoom doesn't affect, then written back through each
// item's own anchors (coordinateArrange.js).
export function arrangedUpdates(container, items, action) {
  const measured = items.filter(it => it.el);
  const positions = arrangedPositions(
    measured.map(it => ({ id: it.id, x: it.el.offsetLeft, y: it.el.offsetTop, w: it.el.offsetWidth, h: it.el.offsetHeight })),
    action,
  );
  if (!positions) return null;
  const box = { w: container.clientWidth, h: container.clientHeight };
  const updates = new Map();
  measured.forEach(it => {
    const pos = positions.get(it.id);
    if (pos) updates.set(it.id, coordUpdateFor(it.coord, pos, { w: it.el.offsetWidth, h: it.el.offsetHeight }, box));
  });
  return updates;
}

// The object Visualization's CanvasAlignControls drives (align / distribute
// / arrangeGrid), running `run(action)` for each.
export function arrangeControlsFor(run) {
  return {
    align: (mode) => run({ type: 'align', mode }),
    distribute: (axis) => run({ type: 'distribute', axis }),
    arrangeGrid: () => run({ type: 'grid' }),
  };
}
