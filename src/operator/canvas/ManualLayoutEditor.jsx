// operator/canvas/ManualLayoutEditor.jsx
// Placing things by hand in Visualization — property tiles (the Properties
// tab) and asset cards (Related Assets' Cards): the coordinate layout's own
// canvas (coordinate/CoordinateCanvas), in a FitViewport for zoom and pan,
// so it works the way the designer does — snap to the grid and to
// neighbours with guides, drag on empty space to box-select, move a
// selection together, Space/middle-drag to pan, Ctrl ± to zoom.
// ManualLayoutView is the read-only twin the Operator draws.
//
// Props:
//   items        [{ key, content }]
//   positions    { key: { left, top } } (manualLayout.js); a key without
//                one goes in the first free spot
//   onPositionsChange(update)  update(previous) → next — a function, since
//                a group move changes several items per mouse move
//   itemNoun     for the "select at least N …" messages
//   resetKey     re-fit the view when this changes (another type / asset)
// ref: align(mode), distribute(axis), arrangeGrid() — for
// CanvasAlignControls. Align needs two selected, distribute three; Arrange
// in Grid arranges the selection, or everything when fewer than two are
// selected.
//
// The canvas's own selection (several items, for moving and arranging) is
// shown only when it's more than one: a single item's selection is the
// Details panel's, which the caller highlights in the item itself.

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import notify from 'devextreme/ui/notify';
import { CoordinateCanvas } from '../../coordinate/CoordinateCanvas';
import { FitViewport } from '../../viewport/FitViewport';

export const ManualLayoutEditor = forwardRef(function ManualLayoutEditor({ items, positions, onPositionsChange, itemNoun = 'items', resetKey, className = '' }, ref) {
  const canvasRef = useRef(null);
  const paneRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState([]);
  // The canvas is at least as big as the pane, so there's room to move
  // things anywhere you can see; it grows past that as they go further.
  const [pane, setPane] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return undefined;
    const measure = () => setPane(p => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const shown = selectedIds.filter(id => items.some(it => it.key === id));

  const warn = (n, verb) => notify(`Select at least ${n} ${itemNoun} to ${verb} (drag across empty space, or Shift-click)`, 'warning', 2500);
  useImperativeHandle(ref, () => ({
    align: (mode) => (shown.length < 2 ? warn(2, 'align') : canvasRef.current?.align(mode)),
    distribute: (axis) => (shown.length < 3 ? warn(3, 'distribute') : canvasRef.current?.distribute(axis)),
    arrangeGrid: () => canvasRef.current?.arrange({ type: 'grid' }, shown.length >= 2 ? shown : items.map(it => it.key)),
  }));

  return (
    <div ref={paneRef} className={`op-manual-layout ${className}`}>
      <FitViewport className="op-manual-layout-viewport" panWith="modifier" controls="always" resetKey={resetKey}>
        <CoordinateCanvas
          ref={canvasRef}
          items={items.map(it => ({ id: it.key, coord: positions[it.key] ?? null, content: it.content }))}
          selectedIds={shown}
          onSelectionChange={setSelectedIds}
          onUpdateCoord={(key, update) => onPositionsChange(prev => ({ ...prev, [key]: { ...prev[key], ...update } }))}
          onAutoPlace={(spots) => onPositionsChange(prev => {
            const next = { ...prev };
            spots.forEach((pos, key) => { if (!next[key]) next[key] = pos; });
            return next;
          })}
          minWidth={Math.max(240, pane.w - 2)}
          minHeight={Math.max(160, pane.h - 2)}
        />
      </FitViewport>
    </div>
  );
});
