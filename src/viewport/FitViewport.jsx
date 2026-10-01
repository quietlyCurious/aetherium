// viewport/FitViewport.jsx
// A view that shows all of its content when it can, and lets people zoom
// and pan when it can't. Built for runtime screens whose layout was
// generated rather than designed — a feeder that turned out to have 40
// turbines — without changing anything for a screen that already fits:
//
//   - It opens fitted: scaled down only as far as it takes to show
//     everything, never up past 100%. Content that fits sits exactly where
//     it would without a viewport.
//   - Zoom controls (−, %, +, Fit) appear only when the content didn't fit,
//     or once someone has zoomed.
//   - Plain scrolling never zooms: Ctrl + scroll does, around the cursor.
//     Plain scrolling moves the content once it's bigger than the view.
//   - A press has to move a few pixels before it pans, so a tap still
//     reaches what it landed on; a press that panned doesn't also click.
//     Two fingers pinch-zoom.
//   - Nothing is remembered: it re-fits when `resetKey` changes (a
//     different asset) and whenever the view resizes, until someone zooms
//     or pans by hand.
//
// `reflow` is for content that lays itself out against the space it's
// given — a wrapping flex row ('row') or column ('column'). Zooming out
// then also hands it more room per line, so a wrapping row of cards
// becomes a wider, shorter block rather than the same narrow one shrunk.
// Leave it null for fixed-size content (a coordinate layout, a screen of
// set size).
//
// `sizing` 'fill' is for content that should take exactly the view's size
// (a Page on the designer canvas): it's laid out at the view's size and
// opens at 100%, and zooming just magnifies it.
//
// For an editor, where a plain drag already means "move this item":
//   panWith 'modifier'  pans only with Space + drag, the middle button, or a
//                       press on the view's own background (outside the
//                       content) — never a plain drag on the content.
//   controls 'always'   keeps the zoom controls showing even at 100%.
//   align 'center'      content that fits sits in the middle of the view
//                       rather than at its top-left.
//   maxFitZoom          lets Fit zoom small content *in*, up to this (an
//                       editor's Tile at 200%). 1 — never above 100% — is
//                       the runtime rule.
//   onFitChange         called with { zoom, fits } after every fit.
//   fillWidth           fixed-size content is at least as wide as the view
//                       (a box that has always spanned its panel keeps
//                       doing so); only wider content is fitted.
//   Keyboard (editor, while the pointer is over the view): Ctrl/Cmd + = and
//   − zoom in and out, Ctrl/Cmd + 0 is 100%, Shift + 1 fits. The % button
//   opens a list of zoom levels.
// The defaults ('drag', 'auto') are the runtime behaviour above.
//
// A wheel over something inside that can itself scroll that way scrolls it,
// rather than moving the whole view.
//
// The content is drawn scaled with a CSS transform, so anything inside
// that measures itself on screen (getBoundingClientRect) sees scaled
// numbers; `viewportScale(el)` gives the factor to divide by.
//
// The maths is in fitViewportMath.js.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAN_THRESHOLD, clampPan, fitFixed, fitReflow, zoomAround } from './fitViewportMath';
import './fitViewport.css';

const ZOOM_STEP = 1.25;
// The % button's list.
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4];

export function FitViewport({ className = '', reflow = null, sizing = 'natural', align = 'start', maxFitZoom = 1, fillWidth = false, panWith = 'drag', controls: controlsMode = 'auto', resetKey, onFitChange, children }) {
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const fits = useRef(true);
  const userAdjusted = useRef(false);
  const measuring = useRef(false);
  const [controls, setControls] = useState({ shown: false, pct: 100 });
  // Told the result of every fit — { zoom, fits } — e.g. for a check that
  // lays the content out at another display's size and reports whether it
  // would fit there. Held in a ref so a new callback doesn't re-fit.
  const onFitChangeRef = useRef(onFitChange);
  onFitChangeRef.current = onFitChange;

  const sizes = () => {
    const v = viewRef.current;
    const s = stageRef.current;
    return { view: { w: v.clientWidth, h: v.clientHeight }, content: { w: s.offsetWidth, h: s.offsetHeight } };
  };

  const apply = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !viewRef.current) return;
    const { view: v, content } = sizes();
    view.current = clampPan(view.current, v, content);
    const { zoom, x, y } = view.current;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const shown = controlsMode === 'always' || !fits.current || Math.abs(zoom - 1) > 0.001;
    const pct = Math.round(zoom * 100);
    setControls(prev => (prev.shown === shown && prev.pct === pct ? prev : { shown, pct }));
  }, [controlsMode]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const el = viewRef.current;
    if (!stage || !el) return;
    measuring.current = true;
    const v = { w: el.clientWidth, h: el.clientHeight };
    let result;
    stage.style.minWidth = '';
    if (sizing === 'fill') {
      stage.style.width = `${v.w}px`;
      stage.style.height = `${v.h}px`;
      result = { zoom: 1, x: 0, y: 0, fits: true };
    } else if (reflow === 'row' || reflow === 'column') {
      const measure = (size) => {
        if (reflow === 'column') {
          stage.style.height = `${size}px`;
          stage.style.width = 'max-content';
          return stage.offsetWidth;
        }
        stage.style.width = `${size}px`;
        stage.style.height = '';
        return stage.offsetHeight;
      };
      result = fitReflow(v, reflow, measure);
      measure(result.size);
    } else {
      stage.style.width = 'max-content';
      stage.style.height = '';
      // Content narrower than the view still spans it (a box that's always
      // been full width stays full width); wider content keeps its size.
      stage.style.minWidth = fillWidth ? `${v.w}px` : '';
      result = fitFixed(v, { w: stage.offsetWidth, h: stage.offsetHeight }, align, maxFitZoom);
    }
    fits.current = result.fits;
    view.current = { zoom: result.zoom, x: result.x, y: result.y };
    userAdjusted.current = false;
    apply();
    onFitChangeRef.current?.({ zoom: result.zoom, fits: result.fits });
    // Let the ResizeObserver callbacks our own measuring caused go by.
    requestAnimationFrame(() => { measuring.current = false; });
  }, [reflow, sizing, align, maxFitZoom, fillWidth, apply]);

  // Fit on open, and again for a different subject.
  useLayoutEffect(() => { fit(); }, [fit, resetKey]);

  // Re-fit when the view resizes, or the content does (data arriving, rows
  // shown or hidden) — until someone has taken over by hand.
  useEffect(() => {
    const el = viewRef.current;
    const stage = stageRef.current;
    if (!el || !stage || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const onResize = () => {
      if (measuring.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!userAdjusted.current) { fit(); return; }
        if (sizing === 'fill') {
          stage.style.width = `${el.clientWidth}px`;
          stage.style.height = `${el.clientHeight}px`;
        }
        apply();
      });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    if (stage.firstElementChild) observer.observe(stage.firstElementChild);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [fit, apply, sizing]);

  const zoomTo = useCallback((nextZoom, cx, cy) => {
    view.current = zoomAround(view.current, nextZoom, cx, cy);
    userAdjusted.current = true;
    apply();
  }, [apply]);

  const zoomAtCentre = (nextZoom) => {
    const el = viewRef.current;
    zoomTo(nextZoom, el.clientWidth / 2, el.clientHeight / 2);
  };

  // Keyboard shortcuts reach the current zoom through this ref, so the
  // listener doesn't have to be re-attached on every render.
  const zoomKeyRef = useRef(null);
  zoomKeyRef.current = (action) => {
    if (action === 'in') zoomAtCentre(view.current.zoom * ZOOM_STEP);
    else if (action === 'out') zoomAtCentre(view.current.zoom / ZOOM_STEP);
    else if (action === 'reset') zoomAtCentre(1);
    else if (action === 'fit') fit();
  };
  const [presetsOpen, setPresetsOpen] = useState(false);

  // Wheel: Ctrl zooms around the cursor; plain wheel moves the content once
  // it's bigger than the view, and otherwise leaves the page to scroll.
  // Attached by hand because React's onWheel is passive and can't stop the
  // browser's own zoom.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const r = el.getBoundingClientRect();
      if (!e.ctrlKey && innerCanScroll(e.target, el, e.shiftKey ? 0 : e.deltaY, e.shiftKey ? e.deltaY : e.deltaX)) return;
      if (e.ctrlKey) {
        e.preventDefault();
        const k = outerScale(el, r);
        zoomTo(view.current.zoom * Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / k, (e.clientY - r.top) / k);
        return;
      }
      const { view: v, content } = sizes();
      const { zoom } = view.current;
      if (content.w * zoom <= v.w && content.h * zoom <= v.h) return;
      e.preventDefault();
      view.current = {
        ...view.current,
        x: view.current.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: view.current.y - (e.shiftKey ? 0 : e.deltaY),
      };
      userAdjusted.current = true;
      apply();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo, apply]);

  // Pointers: one pans once it's moved past the threshold, two pinch-zoom.
  const pointers = useRef(new Map());
  const drag = useRef(null);
  const pinch = useRef(null);
  const suppressClick = useRef(false);
  const [panning, setPanning] = useState(false);

  // Space held over the view: pan mode for an editor (the hand cursor, and
  // a drag anywhere pans). Space inside a text field is still just a space.
  const spaceHeld = useRef(false);
  const hovered = useRef(false);
  const [spaceMode, setSpaceMode] = useState(false);
  useEffect(() => {
    if (panWith !== 'modifier') return undefined;
    const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e) => {
      if (!hovered.current || typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomKeyRef.current?.('in'); return; }
      if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomKeyRef.current?.('out'); return; }
      if (mod && e.key === '0') { e.preventDefault(); zoomKeyRef.current?.('reset'); return; }
      if (e.shiftKey && !mod && (e.key === '!' || e.code === 'Digit1')) { e.preventDefault(); zoomKeyRef.current?.('fit'); return; }
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!spaceHeld.current) { spaceHeld.current = true; setSpaceMode(true); }
    };
    const up = (e) => {
      if (e.code !== 'Space') return;
      spaceHeld.current = false;
      setSpaceMode(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [panWith]);

  const onPointerDown = (e) => {
    if (e.target.closest('.fit-viewport-controls')) return;
    if (panWith === 'modifier') {
      // Editor: only Space + drag, the middle button, or a press on the
      // background around the content. Anything else is the editor's.
      const onBackground = e.target === viewRef.current || e.target.classList?.contains('fit-viewport-background');
      const middle = e.pointerType === 'mouse' && e.button === 1;
      if (!(spaceHeld.current || middle || (onBackground && e.button === 0))) return;
      if (middle || spaceHeld.current) e.preventDefault();
    } else if (e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.current.x, oy: view.current.y, active: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: view.current.zoom };
      drag.current = null;
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = viewRef.current.getBoundingClientRect();
      const k = outerScale(viewRef.current, r);
      zoomTo(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d, ((a.x + b.x) / 2 - r.left) / k, ((a.y + b.y) / 2 - r.top) / k);
      suppressClick.current = true;
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < PAN_THRESHOLD) return;
    const k = outerScale(viewRef.current);
    const dx = (e.clientX - d.sx) / k;
    const dy = (e.clientY - d.sy) / k;
    if (!d.active) {
      d.active = true;
      viewRef.current.setPointerCapture?.(d.id);
      setPanning(true);
    }
    view.current = { ...view.current, x: d.ox + dx, y: d.oy + dy };
    userAdjusted.current = true;
    apply();
  };
  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
    if (drag.current?.active) suppressClick.current = true;
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      setPanning(false);
    }
  };
  // A press that panned or pinched shouldn't also click whatever it
  // started on.
  const onClickCapture = (e) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div
      ref={viewRef}
      className={`fit-viewport${panning ? ' fit-viewport--panning' : ''}${spaceMode ? ' fit-viewport--space' : ''} ${className}`}
      onPointerEnter={() => { hovered.current = true; }}
      onPointerLeave={() => { hovered.current = false; }}
      onPointerDownCapture={panWith === 'modifier' ? onPointerDown : undefined}
      onPointerDown={panWith === 'modifier' ? undefined : onPointerDown}
      onMouseDownCapture={panWith === 'modifier' && spaceMode ? (e) => { e.stopPropagation(); e.preventDefault(); } : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      <div ref={stageRef} className="fit-viewport-stage">
        {children}
      </div>
      {controls.shown && (
        <div className="fit-viewport-controls" role="toolbar" aria-label="Zoom">
          <button type="button" title="Zoom out" onClick={() => zoomAtCentre(view.current.zoom / ZOOM_STEP)}>−</button>
          <button type="button" className="fit-viewport-pct" title="Zoom level" aria-haspopup="menu" aria-expanded={presetsOpen} onClick={() => setPresetsOpen(o => !o)}>{controls.pct}%</button>
          {presetsOpen && (
            <div className="fit-viewport-presets" role="menu">
              {ZOOM_PRESETS.map(z => (
                <button key={z} type="button" role="menuitem" className={controls.pct === Math.round(z * 100) ? 'fit-viewport-preset--on' : undefined}
                  onClick={() => { setPresetsOpen(false); zoomAtCentre(z); }}>{Math.round(z * 100)}%</button>
              ))}
              <button type="button" role="menuitem" onClick={() => { setPresetsOpen(false); fit(); }}>Fit</button>
            </div>
          )}
          <button type="button" title="Zoom in" onClick={() => zoomAtCentre(view.current.zoom * ZOOM_STEP)}>+</button>
          <button type="button" className="fit-viewport-fit" title="Fit everything in view" onClick={fit}>Fit</button>
        </div>
      )}
    </div>
  );
}

// How much the view itself is scaled by something around it — a preview
// frame showing a whole display shrunk to fit (OperatorFitCheck). Cursor
// positions and drags are divided by it so zoom and pan track the pointer.
function outerScale(el, rect = el.getBoundingClientRect()) {
  return el.offsetWidth > 0 && rect.width > 0 ? rect.width / el.offsetWidth : 1;
}

// Whether something between `target` and the viewport can scroll in the
// wheel's direction — if so, the wheel is its, not the viewport's.
function innerCanScroll(target, root, dy, dx) {
  for (let el = target; el && el !== root; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (dy && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
      if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
    }
    if (dx && /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) {
      if ((dx < 0 && el.scrollLeft > 0) || (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true;
    }
  }
  return false;
}

// The scale an element is drawn at inside a FitViewport (1 outside one).
// For code that measures elements on screen and needs layout pixels:
// divide by this.
export function viewportScale(el) {
  if (!el) return 1;
  const w = el.offsetWidth;
  const r = el.getBoundingClientRect().width;
  return w > 0 && r > 0 ? r / w : 1;
}
