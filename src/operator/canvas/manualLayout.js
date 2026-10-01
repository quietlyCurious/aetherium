// operator/canvas/manualLayout.js
// Saved manual positions (a display template's manualPositions, a Related
// Assets template's cardsManualPositions): { [itemKey]: { left, top } } —
// coordinates in the designer's own terms, never negative. A card's also
// keeps the width it had in the flex layout ({ left, top, width }), so
// switching to manual doesn't reshape it.
//
// Layouts saved before manual layouts moved onto the coordinate layout hold
// { x, y } instead, from a free-panning canvas where negatives were fine.
// asCoordPositions reads either: { x, y } becomes { left, top }, and if
// anything sits left of or above the origin, everything shifts right / down
// by that much — exactly what the Operator did when it drew them — so no
// layout moves. Saving writes the new form.

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function asCoordPositions(positions) {
  const entries = Object.entries(positions || {}).filter(([, p]) => p && typeof p === 'object');
  if (!entries.length) return {};
  const read = entries.map(([key, p]) => [key, {
    left: finite(p.left ?? p.x),
    top: finite(p.top ?? p.y),
    ...(Number(p.width) > 0 ? { width: Math.round(Number(p.width)) } : null),
  }]);
  const dx = Math.min(0, ...read.map(([, p]) => p.left));
  const dy = Math.min(0, ...read.map(([, p]) => p.top));
  return Object.fromEntries(read.map(([key, p]) => [key, {
    ...p,
    left: Math.round(p.left - dx),
    top: Math.round(p.top - dy),
  }]));
}

// The positions of the elements in `refs` ({ key: element }) inside
// `container`, as manual positions — for "Switch to Manual Layout", so the
// manual layout starts exactly where the flex layout had everything.
// `scale` is the zoom the flex layout is drawn at (viewportScale);
// withWidth keeps each one's width too (cards).
export function measuredPositions(container, refs, scale = 1, { withWidth = false } = {}) {
  const box = container?.getBoundingClientRect();
  if (!box) return {};
  const measured = {};
  Object.entries(refs || {}).forEach(([key, el]) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    measured[key] = { left: (r.left - box.left) / scale, top: (r.top - box.top) / scale, ...(withWidth ? { width: r.width / scale } : null) };
  });
  return asCoordPositions(measured);
}
