// coordinate/coordinatePlacement.js
// Where an item with no position goes in a coordinate layout: the first
// free spot after what's already placed — on the same row if there's room
// within the arrangement's width, else on a new row below. Never on top of
// anything. Used by CoordinateCanvas for items whose coord is null (a
// property that became visible, a related asset that appeared, after the
// layout was arranged).
//
// placeUnplaced(placed, unplaced, { gap, rowWidth }) → Map(id → { left, top })
//   placed:   [{ x, y, w, h }] — what's already there, in layout pixels
//   unplaced: [{ id, w, h }] — placed in this order; each one placed
//             counts as "already there" for the next
//
// "Room" is the width of the arrangement as it stands (its right-most
// edge), or the widest unplaced item when nothing is placed yet — so a
// layout arranged three wide keeps growing three wide. rowWidth, when
// given, is room there always is (the width of the container), so items
// with nowhere yet fill rows across it, the way a wrapping flow would.

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
  && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

export function placeUnplaced(placed, unplaced, { gap = 16, rowWidth = 0 } = {}) {
  const taken = placed.map(r => ({ ...r }));
  const result = new Map();
  unplaced.forEach(item => {
    const width = Math.max(item.w, rowWidth, ...taken.map(r => r.x + r.w));
    // Candidates: the origin, just right of each item (on its top line),
    // and the start of a new row under everything.
    const bottom = taken.length ? Math.max(...taken.map(r => r.y + r.h)) + gap : 0;
    const candidates = [
      { x: 0, y: 0 },
      ...taken.map(r => ({ x: r.x + r.w + gap, y: r.y })),
      ...taken.map(r => ({ x: 0, y: r.y })),
      { x: 0, y: bottom },
    ]
      .filter(c => c.x + item.w <= width || c.x === 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const spot = candidates.find(c => !taken.some(r => overlaps({ ...c, w: item.w, h: item.h }, r, gap - 0.5)))
      || { x: 0, y: bottom };
    const pos = { left: Math.round(spot.x), top: Math.round(spot.y) };
    result.set(item.id, pos);
    taken.push({ x: pos.left, y: pos.top, w: item.w, h: item.h });
  });
  return result;
}
