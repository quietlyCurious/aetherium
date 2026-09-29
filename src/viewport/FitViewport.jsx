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
// The content is drawn scaled with a CSS transform, so anything inside
// that measures itself on screen (getBoundingClientRect) sees scaled
// numbers; `viewportScale(el)` gives the factor to divide by.
//
// The maths is in fitViewportMath.js.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAN_THRESHOLD, clampPan, fitFixed, fitReflow, zoomAround } from './fitViewportMath';
import './fitViewport.css';

const ZOOM_STEP = 1.25;

export function FitViewport({ className = '', reflow = null, resetKey, children }) {
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const fits = useRef(true);
  const userAdjusted = useRef(false);
  const measuring = useRef(false);
  const [controls, setControls] = useState({ shown: false, pct: 100 });

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
    const shown = !fits.current || Math.abs(zoom - 1) > 0.001;
    const pct = Math.round(zoom * 100);
    setControls(prev => (prev.shown === shown && prev.pct === pct ? prev : { shown, pct }));
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const el = viewRef.current;
    if (!stage || !el) return;
    measuring.current = true;
    const v = { w: el.clientWidth, h: el.clientHeight };
    let result;
    if (reflow === 'row' || reflow === 'column') {
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
      result = fitFixed(v, { w: stage.offsetWidth, h: stage.offsetHeight });
    }
    fits.current = result.fits;
    view.current = { zoom: result.zoom, x: result.x, y: result.y };
    userAdjusted.current = false;
    apply();
    // Let the ResizeObserver callbacks our own measuring caused go by.
    requestAnimationFrame(() => { measuring.current = false; });
  }, [reflow, apply]);

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
      frame = requestAnimationFrame(() => (userAdjusted.current ? apply() : fit()));
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    if (stage.firstElementChild) observer.observe(stage.firstElementChild);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [fit, apply]);

  const zoomTo = useCallback((nextZoom, cx, cy) => {
    view.current = zoomAround(view.current, nextZoom, cx, cy);
    userAdjusted.current = true;
    apply();
  }, [apply]);

  const zoomAtCentre = (nextZoom) => {
    const el = viewRef.current;
    zoomTo(nextZoom, el.clientWidth / 2, el.clientHeight / 2);
  };

  // Wheel: Ctrl zooms around the cursor; plain wheel moves the content once
  // it's bigger than the view, and otherwise leaves the page to scroll.
  // Attached by hand because React's onWheel is passive and can't stop the
  // browser's own zoom.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey) {
        e.preventDefault();
        zoomTo(view.current.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
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

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.fit-viewport-controls')) return;
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
      zoomTo(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      suppressClick.current = true;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.active) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
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
      className={`fit-viewport${panning ? ' fit-viewport--panning' : ''} ${className}`}
      onPointerDown={onPointerDown}
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
          <button type="button" className="fit-viewport-pct" title="Back to 100%" onClick={() => zoomAtCentre(1)}>{controls.pct}%</button>
          <button type="button" title="Zoom in" onClick={() => zoomAtCentre(view.current.zoom * ZOOM_STEP)}>+</button>
          <button type="button" className="fit-viewport-fit" title="Fit everything in view" onClick={fit}>Fit</button>
        </div>
      )}
    </div>
  );
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
