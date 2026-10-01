// operator/configurator/OperatorFitCheck.jsx
// "Will this fit for the operator?" — for the views Configure shapes and
// the Operator's Assets area shows: Properties and Related Assets.
//
// The Operator draws both in a FitViewport: a layout too big for the space
// opens zoomed out. That's the safety net for a layout nobody tidied; this
// is the nudge to tidy it. A badge in the view's toolbar says whether the
// current layout fits the Operator's view on a chosen display, or how far
// operators would be zoomed out:
//
//   ✓ Fits the Operator view · Full HD 1920×1080
//   ⚠ Operators will see this at 72% · Full HD 1920×1080
//
// How it knows: the caller renders what the Operator renders there
// (`renderProbe` — the Operator's own component for that view, with the
// draft settings), and this lays it out invisibly in a box the size that
// view has in the Operator on that display, and reports what its
// FitViewport decided. So it can't drift from what operators get.
//
// The Operator area's size is the display minus the panels around that
// view (OPERATOR_VIEWS[view].chrome) — measured in the real app with the
// side panels at their default widths, and constant across display sizes.
// If the Operator layout changes, re-measure: open the Operator's Assets
// area on an asset at a known window size and compare the view's viewport
// (.op-properties-viewport / .op-related-assets-viewport) clientWidth and
// clientHeight with the window.
//
// Seeing it, not just being told: the badge's list starts with "Fill pane"
// (the preview fills Configure's pane, as always — where it opens), then
// the displays. Picking a display also shows it: the caller swaps its
// preview for OperatorDisplayFrame below — a frame exactly the size of
// that Operator view there, holding the Operator's rendering, shrunk to
// fit the pane. Fill pane switches back; the badge keeps checking the last
// display picked.
//
// Every layout can be previewed on a display — the frame just holds
// whatever the Operator draws there. The verdict needs a FitViewport to
// ask, so a view whose Operator rendering is a React Flow canvas (Related
// Assets' Manual and Diagram — they fit themselves, their own way) passes
// no renderProbe: the badge then just offers the preview ("▭ Preview on a
// display"), with no ✓ or %. Those layouts get the verdict when they move
// onto coordinate layouts (Manual) or when Diagram learns to report its
// own fit.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { DEVICE_CATEGORIES } from '../../breakpointConfig';
import { loadOperatorFitDisplay, saveOperatorFitDisplay } from '../../operatorFitDisplayStorage';

// The Operator views this can check, and what surrounds each: window size
// minus the view's viewport, at default panel widths (both measured at
// 1280×800, 1366×768, 1920×1080 and 2560×1440).
export const OPERATOR_VIEWS = {
  properties: { label: 'Properties', chrome: { w: 470, h: 268 } },
  relatedAssets: { label: 'Related Assets', chrome: { w: 470, h: 282 } },
};

const DEFAULT_DISPLAY_ID = 'fhd';

// Displays worth checking against: every device preview at least 1024
// wide (smaller ones are handhelds, which don't get the Operator view).
export function fitCheckDisplays() {
  const seen = new Set();
  return DEVICE_CATEGORIES.flatMap(cat => cat.devices)
    .filter(d => d.width && d.height && d.width >= 1024)
    .filter(d => (seen.has(d.label) ? false : seen.add(d.label)))
    .map(d => ({ id: d.id, label: d.label, width: d.width, height: d.height }));
}

// The size `view` has in the Operator on `display`.
export function operatorAreaFor(display, view) {
  const { chrome } = OPERATOR_VIEWS[view];
  return {
    w: Math.max(0, display.width - chrome.w),
    h: Math.max(0, display.height - chrome.h),
  };
}

// The badge's wording, from the probe's fit result — or, for a layout with
// no probe, just what it offers / is showing.
export function describeOperatorFit(result, display, { checkable = true, showing = false } = {}) {
  const where = `${display.label} ${display.width}×${display.height}`;
  if (!checkable) return { tone: 'neutral', text: showing ? `▭ Operator view · ${where}` : '▭ Preview on a display' };
  if (!result) return { tone: 'pending', text: `Checking the Operator view… · ${where}` };
  if (result.fits) return { tone: 'ok', text: `✓ Fits the Operator view · ${where}` };
  return { tone: 'warn', text: `⚠ Operators will see this at ${Math.round(result.zoom * 100)}% · ${where}` };
}

export const FILL_PANE = 'fill';

// view: a key of OPERATOR_VIEWS. renderProbe(onFitChange): what the
// Operator draws in that view, with its FitViewport reporting to
// onFitChange — or nothing, for a layout that can only be previewed. showingId: the display the preview is showing (null = Fill
// pane); onShow(displayId | null) switches it.
export function OperatorFitCheck({ view, renderProbe, showingId = null, onShow }) {
  const displays = useMemo(() => fitCheckDisplays(), []);
  const [displayId, setDisplayId] = useState(() => {
    const saved = loadOperatorFitDisplay();
    return displays.some(d => d.id === saved) ? saved : DEFAULT_DISPLAY_ID;
  });
  const display = displays.find(d => d.id === displayId) || displays[0];
  const area = operatorAreaFor(display, view);
  const [result, setResult] = useState(null);
  const [picking, setPicking] = useState(false);

  const checkable = typeof renderProbe === 'function';
  const { tone, text } = describeOperatorFit(result, display, { checkable, showing: !!showingId });
  const choose = (id) => {
    setPicking(false);
    if (id === FILL_PANE) { onShow?.(null); return; }
    if (id !== displayId) {
      setDisplayId(id);
      saveOperatorFitDisplay(id);
      setResult(null);
    }
    onShow?.(id);
  };
  const choices = [{ id: FILL_PANE, label: 'Fill pane', note: "Configure's own space" }, ...displays];

  return (
    <span className="op-fit-check">
      <button
        type="button"
        className={`op-fit-check-badge op-fit-check-badge--${tone}`}
        title={!checkable
          ? 'See this layout at the size the Operator view has on a display. (The ✓ / % check covers Flex layouts; this layout fits itself in the Operator.)'
          : tone === 'warn'
          ? 'Operators can still see everything — the view opens zoomed out, with zoom controls. Tidy the layout here to avoid it. Click to see it on a display, or check another.'
          : `How the Operator’s ${OPERATOR_VIEWS[view].label} view will open. Click to see it on a display, or check another.`}
        onClick={() => setPicking(p => !p)}
      >
        {text}
      </button>
      {picking && (
        <SelectBox
          className="op-fit-check-display"
          dataSource={choices}
          valueExpr="id"
          displayExpr={d => (d ? (d.id === FILL_PANE ? 'Fill pane' : `${d.label} · ${d.width}×${d.height}`) : '')}
          itemRender={d => (d.id === FILL_PANE
            ? <span>Fill pane <span style={{ color: '#999' }}>· Configure's own space</span></span>
            : <span>{d.label} <span style={{ color: '#999' }}>· {d.width}×{d.height}</span></span>)}
          value={showingId || FILL_PANE}
          onValueChanged={e => e.value && choose(e.value)}
          stylingMode="outlined"
          width={250}
          height={26}
          opened
        />
      )}
      {checkable && (
        <div className="op-fit-check-probe" aria-hidden="true" key={display.id} style={{ width: area.w, height: area.h }}>
          {renderProbe(setResult)}
        </div>
      )}
    </span>
  );
}

// The preview as a display's Operator view: a frame exactly the size of
// `view` in the Operator on `display`, holding whatever the
// Operator draws there (children — the Cards, in their own FitViewport),
// shrunk as needed to fit this pane and centred, with a caption saying
// what it is (plus `note`, e.g. that it's a look-only copy). Nothing
// inside needs to know it's shrunk: FitViewport lays
// out by layout pixels and corrects pointer maths for the outer scale.
export function OperatorDisplayFrame({ display, view, note, children }) {
  const paneRef = useRef(null);
  const area = operatorAreaFor(display, view);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return undefined;
    const CAPTION = 26;
    const PAD = 16;
    const measure = () => {
      const w = pane.clientWidth - PAD * 2;
      const h = pane.clientHeight - PAD * 2 - CAPTION;
      if (w > 0 && h > 0) setScale(Math.min(1, w / area.w, h / area.h));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [area.w, area.h]);
  return (
    <div ref={paneRef} className="op-display-frame-pane">
      <div className="op-display-frame-caption">
        <b>{display.label}</b> · Operator view {area.w}×{area.h}
        {scale < 0.999 && <span> · shown here at {Math.round(scale * 100)}%</span>}
        {note && <span> · {note}</span>}
      </div>
      <div className="op-display-frame-slot" style={{ width: area.w * scale, height: area.h * scale }}>
        <div className="op-display-frame" style={{ width: area.w, height: area.h, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
