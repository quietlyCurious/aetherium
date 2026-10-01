// operator/canvas/ManualLayoutView.jsx
// A manual layout as the Operator draws it: each item at its saved
// position (manualLayout.js), read-only, in a box exactly as big as the
// items — no empty band above or left of them, no extra margin. The
// coordinate layout's own canvas (coordinate/CoordinateCanvas) with editing
// off, so it's drawn the same way ManualLayoutEditor draws it. A key with
// no position goes in the first free spot, the same spot the editor gives
// it.
//
// items: [{ key, content }]; positions: { key: { left, top } } (either
// form — old { x, y } saves are read too).

import { CoordinateCanvas } from '../../coordinate/CoordinateCanvas';
import { asCoordPositions } from './manualLayout';

export function ManualLayoutView({ items, positions, className = '' }) {
  const coords = asCoordPositions(positions);
  return (
    <CoordinateCanvas
      className={className}
      readOnly
      trim
      margin={0}
      items={items.map(it => ({ id: it.key, coord: coords[it.key] ?? null, content: it.content }))}
    />
  );
}
