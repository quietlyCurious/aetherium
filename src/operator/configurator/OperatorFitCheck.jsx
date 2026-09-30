// operator/configurator/OperatorFitCheck.jsx
// "Will this fit for the operator?" — for Related Assets in Configure.
//
// The Operator's Assets area draws Related Assets in a FitViewport: a
// layout too big for the space opens zoomed out. That's the safety net for
// a generated layout nobody tidied; this is the nudge to tidy it. A badge
// in the Related Assets toolbar says whether the current layout fits the
// Operator's view on a chosen display, or how far operators would be
// zoomed out:
//
//   ✓ Fits the Operator view · Full HD 1920×1080
//   ⚠ Operators will see this at 72% · Full HD 1920×1080
//
// How it knows: it lays the same Cards out, invisibly, in a box the size
// the Operator's Related Assets area has on that display, inside the same
// FitViewport the Operator uses, and reports what that viewport decided.
// So it can't drift from what operators actually get. It shows the rows
// the Operator shows (the "always" ones), not Configure's density setting.
//
// The Operator area's size is the display minus the panels around it
// (OPERATOR_RELATED_ASSETS_CHROME) — measured in the real app with the
// side panels at their default widths, and constant across display sizes.
// If the Operator layout changes, re-measure: open the Operator's Assets
// area on an asset's Related Assets at a known window size and compare
// .op-related-assets-viewport's clientWidth/clientHeight with the window.
//
// Seeing it, not just being told: the badge's list starts with "Fill pane"
// (the preview fills Configure's pane, as always — where it opens), then
// the displays. Picking a display also shows it: the preview becomes that
// display's Operator view (OperatorDisplayFrame below) — a frame exactly
// the size of the Operator's Related Assets area there, laid out and
// fitted as the Operator does, with the Operator's rows, shrunk to fit the
// pane. Tweak the layout and watch it on the target display. Fill pane
// switches back; the badge keeps checking the last display picked.
//
// Cards (auto) layout only for now: Manual and Diagram are React Flow
// canvases with their own fit-to-view, until they move onto coordinate
// layouts.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { DEVICE_CATEGORIES } from '../../breakpointConfig';
import { loadOperatorFitDisplay, saveOperatorFitDisplay } from '../../operatorFitDisplayStorage';
import { AssetCardsView } from '../relatedAssets/AssetCardsView';

// Window size minus the Operator's Related Assets viewport, at default
// panel widths (measured at 1280×800, 1366×768, 1920×1080 and 2560×1440).
export const OPERATOR_RELATED_ASSETS_CHROME = { w: 470, h: 282 };

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

export function operatorAreaFor(display) {
  return {
    w: Math.max(0, display.width - OPERATOR_RELATED_ASSETS_CHROME.w),
    h: Math.max(0, display.height - OPERATOR_RELATED_ASSETS_CHROME.h),
  };
}

// The badge's wording, from the probe's fit result.
export function describeOperatorFit(result, display) {
  const where = `${display.label} ${display.width}×${display.height}`;
  if (!result) return { tone: 'pending', text: `Checking the Operator view… · ${where}` };
  if (result.fits) return { tone: 'ok', text: `✓ Fits the Operator view · ${where}` };
  return { tone: 'warn', text: `⚠ Operators will see this at ${Math.round(result.zoom * 100)}% · ${where}` };
}

export const FILL_PANE = 'fill';

// cardsProps: what the visible AssetCardsView is drawn with (the Operator
// draws the same saved template); rows: the rows the Operator shows.
// showingId: the display the preview is showing (null = Fill pane);
// onShow(displayId | null) switches it.
export function OperatorFitCheck({ cardsProps, rows, showingId = null, onShow }) {
  const displays = useMemo(() => fitCheckDisplays(), []);
  const [displayId, setDisplayId] = useState(() => {
    const saved = loadOperatorFitDisplay();
    return displays.some(d => d.id === saved) ? saved : DEFAULT_DISPLAY_ID;
  });
  const display = displays.find(d => d.id === displayId) || displays[0];
  const area = operatorAreaFor(display);
  const [result, setResult] = useState(null);
  const [picking, setPicking] = useState(false);
  // AssetCardsView writes to these; nothing reads them here.
  const flexContainerRef = useRef(null);
  const flexTileRefs = useRef({});

  const { tone, text } = describeOperatorFit(result, display);
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
        title={tone === 'warn'
          ? 'Operators can still see everything — the view opens zoomed out, with zoom controls. Tidy the layout here to avoid it. Click to see it on a display, or check another.'
          : 'How the Operator’s Related Assets view will open. Click to see it on a display, or check another.'}
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
      {rows.length > 0 && (
        <div className="op-fit-check-probe" aria-hidden="true" style={{ width: area.w, height: area.h }}>
          <AssetCardsView
            {...cardsProps}
            key={display.id}
            visibleRows={rows}
            cardsLayoutMode="auto"
            cardsFlexContainerRef={flexContainerRef}
            cardsFlexTileRefs={flexTileRefs}
            readOnly
            onTitleClick={undefined}
            onGearClick={undefined}
            onFitChange={setResult}
          />
        </div>
      )}
    </span>
  );
}

// The preview as a display's Operator view: a frame exactly the size of the
// Operator's Related Assets area on `display`, holding whatever the
// Operator draws there (children — the Cards, in their own FitViewport),
// shrunk as needed to fit this pane and centred, with a caption saying
// what it is. Nothing inside needs to know it's shrunk: FitViewport lays
// out by layout pixels and corrects pointer maths for the outer scale.
export function OperatorDisplayFrame({ display, children }) {
  const paneRef = useRef(null);
  const area = operatorAreaFor(display);
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
      </div>
      <div className="op-display-frame-slot" style={{ width: area.w * scale, height: area.h * scale }}>
        <div className="op-display-frame" style={{ width: area.w, height: area.h, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
