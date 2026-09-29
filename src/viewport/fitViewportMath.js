// viewport/fitViewportMath.js
// The arithmetic behind FitViewport, as plain functions so it can be tested
// without a DOM. Sizes are in CSS pixels; `zoom` is a scale factor (1 =
// 100%); `x`/`y` are where the content's top-left corner sits inside the
// view.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
// Space kept clear around fitted content, and along the bottom for the
// zoom controls once they appear, so they never sit on top of content.
export const FIT_PAD = 12;
export const CONTROLS_ROOM = 44;
// How far a pointer has to move before a press becomes a pan — below it,
// it's a tap, and taps still reach whatever they landed on.
export const PAN_THRESHOLD = 5;
// However far someone pans, this much of the content stays in view.
export const KEEP_VISIBLE = 80;

export const clampZoom = (zoom) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

// Fixed-size content: the largest scale (never above 1) that shows all of
// it, and where to put it. Content that fits sits exactly where it would
// without a viewport (top-left, 100%) — or, with `align` 'center', in the
// middle of the view, the way an editor shows a framed screen. Content
// that doesn't fit is centred across and starts at the top.
//
// `maxZoom` above 1 lets small content be fitted *up* too — an editor
// showing a 220×140 Tile at 200% so it's comfortable to work on.
export function fitFixed(view, content, align = 'start', maxZoom = 1) {
  if (!content.w || !content.h || !view.w || !view.h) return { zoom: 1, x: 0, y: 0, fits: true };
  if (maxZoom > 1 && content.w <= view.w && content.h <= view.h) {
    const zoom = Math.max(1, Math.min(maxZoom, (view.w - FIT_PAD * 2) / content.w, (view.h - FIT_PAD - CONTROLS_ROOM) / content.h));
    return { zoom, x: (view.w - content.w * zoom) / 2, y: Math.max(0, (view.h - content.h * zoom) / 2), fits: true };
  }
  if (content.w <= view.w && content.h <= view.h) {
    return align === 'center'
      ? { zoom: 1, x: (view.w - content.w) / 2, y: Math.max(0, (view.h - content.h) / 2), fits: true }
      : { zoom: 1, x: 0, y: 0, fits: true };
  }
  const zoom = clampZoom(Math.min(1, (view.w - FIT_PAD * 2) / content.w, (view.h - FIT_PAD - CONTROLS_ROOM) / content.h));
  return { zoom, x: Math.max(0, (view.w - content.w * zoom) / 2), y: FIT_PAD, fits: false };
}

// Content that reflows (a wrapping flex row or column): laid out wider (or
// taller) the smaller it's drawn, so zooming out also lets more fit per
// line. `measure(size)` lays the content out with its flowing axis at
// `size` and returns the other axis. Finds the largest scale that fits by
// bisection — each step is one layout, and a dozen steps is plenty.
//   axis 'row'     flows across: width is set, height measured
//   axis 'column'  flows down: height is set, width measured
export function fitReflow(view, axis, measure) {
  const along = axis === 'column' ? view.h : view.w;
  const across = axis === 'column' ? view.w : view.h;
  if (!along || !across) return { zoom: 1, size: along, x: 0, y: 0, fits: true };
  if (measure(along) <= across) return { zoom: 1, size: along, x: 0, y: 0, fits: true };

  const room = axis === 'column' ? view.w - FIT_PAD * 2 : view.h - FIT_PAD - CONTROLS_ROOM;
  const usable = axis === 'column' ? view.h - FIT_PAD - CONTROLS_ROOM : view.w - FIT_PAD * 2;
  const fitsAt = (zoom) => measure(usable / zoom) * zoom <= room;
  let lo = MIN_ZOOM;
  let hi = 1;
  if (!fitsAt(lo)) return { zoom: lo, size: usable / lo, x: FIT_PAD, y: FIT_PAD, fits: false };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(mid)) lo = mid; else hi = mid;
  }
  const zoom = lo;
  const size = usable / zoom;
  // Re-measure at the answer so the caller is left with this layout.
  const other = measure(size) * zoom;
  return axis === 'column'
    ? { zoom, size, x: Math.max(FIT_PAD, (view.w - other) / 2), y: FIT_PAD, fits: false }
    : { zoom, size, x: FIT_PAD, y: FIT_PAD, fits: false };
}

// Zooming to `nextZoom` while keeping the point under (cx, cy) still.
export function zoomAround({ zoom, x, y }, nextZoom, cx, cy) {
  const z = clampZoom(nextZoom);
  return { zoom: z, x: cx - (cx - x) * (z / zoom), y: cy - (cy - y) * (z / zoom) };
}

// Keeps panned content from sliding entirely out of view.
export function clampPan({ zoom, x, y }, view, content) {
  const w = content.w * zoom;
  const h = content.h * zoom;
  return {
    zoom,
    x: Math.min(view.w - Math.min(KEEP_VISIBLE, w), Math.max(x, Math.min(0, KEEP_VISIBLE - w))),
    y: Math.min(view.h - Math.min(KEEP_VISIBLE, h), Math.max(y, Math.min(0, KEEP_VISIBLE - h))),
  };
}
