// coordinate/CoordinateCanvas.jsx
// A coordinate layout you can edit, outside the designer: items placed by
// the designer's own coord fields, moved the designer's way — snapping to
// the grid and to each other with guides, box-select on empty space, a
// multi-selection moving together, align / distribute / arrange from
// CanvasAlignControls. The maths and mouse handling are shared with
// ContainerCard (coordinateMove.js, coordinateCanvasDom.js), so placing a
// tile here and a widget in the designer feel the same.
//
// It's the canvas only: put it in a FitViewport for zoom and pan (the
// moves divide the zoom out). It grows to hold its items plus `margin`, and
// is at least minWidth × minHeight.
//
// Props:
//   items        [{ id, coord, content }] — content is what's drawn there;
//                an item without width/height in its coord is its
//                content's size
//   selectedIds  ids selected; onSelectionChange(ids) changes them
//   onUpdateCoord(id, update)  coord fields to merge into an item, called
//                as it moves (and once per item for align / arrange)
//   snap, snapSize   grid and line-up snapping (default on, 8px)
//   readOnly     no moving or selecting — just draws them where they are
// ref: { align(mode), distribute(axis), arrangeGrid() } on the selection —
// the object CanvasAlignControls drives.

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { getCoordStyle } from '../containerStyles';
import { arrangeControlsFor, arrangedUpdates, beginCoordinateMove, beginMarquee } from './coordinateCanvasDom';
import './coordinateCanvas.css';

const ITEM_SELECTOR = '.coord-canvas-item';

export const CoordinateCanvas = forwardRef(function CoordinateCanvas({
  items,
  selectedIds = [],
  onSelectionChange,
  onUpdateCoord,
  snap = true,
  snapSize = 8,
  readOnly = false,
  minWidth = 0,
  minHeight = 0,
  margin = 40,
  className = '',
}, ref) {
  const canvasRef = useRef(null);
  const [guides, setGuides] = useState(null);
  const [band, setBand] = useState(null);
  const bandEndedRef = useRef(false);
  const [extent, setExtent] = useState({ w: 0, h: 0 });

  const idOf = (el) => {
    const key = el.getAttribute('data-coord-id');
    return items.find(it => String(it.id) === key)?.id;
  };
  const elOf = (id) => canvasRef.current?.querySelector(`:scope > [data-coord-id="${CSS.escape(String(id))}"]`);
  const select = (ids) => onSelectionChange?.(ids);

  // Grow to hold the items, as drawn.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let w = 0;
    let h = 0;
    canvas.querySelectorAll(`:scope > ${ITEM_SELECTOR}`).forEach(el => {
      w = Math.max(w, el.offsetLeft + el.offsetWidth);
      h = Math.max(h, el.offsetTop + el.offsetHeight);
    });
    if (w !== extent.w || h !== extent.h) setExtent({ w, h });
  });

  useImperativeHandle(ref, () => arrangeControlsFor((action) => {
    const canvas = canvasRef.current;
    if (!canvas || readOnly) return;
    const chosen = items.filter(it => selectedIds.includes(it.id));
    const updates = arrangedUpdates(canvas, chosen.map(it => ({ id: it.id, coord: it.coord, el: elOf(it.id) })), action);
    updates?.forEach((update, id) => onUpdateCoord?.(id, update));
  }), [items, selectedIds, readOnly, onUpdateCoord]); // eslint-disable-line react-hooks/exhaustive-deps

  const onItemMouseDown = (e, item) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const isGroupMove = selectedIds.length > 1 && selectedIds.includes(item.id);
    const coMovers = isGroupMove
      ? items.filter(it => it.id !== item.id && selectedIds.includes(it.id)).map(it => ({ id: it.id, coord: it.coord }))
      : [];
    beginCoordinateMove(e, {
      itemEl: e.currentTarget,
      id: item.id,
      coord: item.coord,
      coMovers,
      itemSelector: ITEM_SELECTOR,
      snap,
      snapSize,
      onUpdate: (id, update) => onUpdateCoord?.(id, update),
      onGuides: setGuides,
    });
  };

  const onItemClick = (e, item) => {
    e.stopPropagation();
    if (readOnly) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      select(selectedIds.includes(item.id) ? selectedIds.filter(id => id !== item.id) : [...selectedIds, item.id]);
    } else if (!(selectedIds.length > 1 && selectedIds.includes(item.id))) {
      // A click on part of a multi-selection keeps it (it may have just
      // been dragged as a group); anywhere else selects just this one.
      select([item.id]);
    }
  };

  const onCanvasMouseDown = (e) => {
    if (readOnly || e.button !== 0 || e.target !== e.currentTarget) return;
    e.preventDefault();
    beginMarquee(e, {
      container: e.currentTarget,
      itemSelector: ITEM_SELECTOR,
      idOf,
      onBand: setBand,
      onDone: (ids, { add }) => {
        bandEndedRef.current = true;
        const touched = ids.filter(id => id !== undefined);
        select(add ? [...new Set([...selectedIds, ...touched])] : touched);
      },
    });
  };

  const onCanvasClick = (e) => {
    if (bandEndedRef.current) { bandEndedRef.current = false; return; }
    if (!readOnly && e.target === e.currentTarget && selectedIds.length) select([]);
  };

  return (
    <div
      ref={canvasRef}
      className={['coord-canvas', snap && !readOnly ? 'coord-dots' : '', readOnly ? 'coord-canvas--readonly' : '', className].filter(Boolean).join(' ')}
      style={{
        width: Math.max(minWidth, extent.w + margin),
        height: Math.max(minHeight, extent.h + margin),
        '--snap-size': `${snapSize}px`,
      }}
      onMouseDown={onCanvasMouseDown}
      onClick={onCanvasClick}
    >
      {guides && guides.map((g, i) => (
        <div
          key={i}
          className="snap-guide"
          style={g.type === 'v'
            ? { position: 'absolute', left: g.position, top: 0, bottom: 0, width: 1, zIndex: 50, pointerEvents: 'none' }
            : { position: 'absolute', top: g.position, left: 0, right: 0, height: 1, zIndex: 50, pointerEvents: 'none' }}
        />
      ))}
      {band && <div className="canvas-marquee" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
      {items.map((item, i) => (
        <div
          key={item.id}
          data-coord-id={String(item.id)}
          className={`coord-canvas-item${!readOnly && selectedIds.includes(item.id) ? ' coord-canvas-item--selected' : ''}`}
          style={{ ...getCoordStyle(item.coord || {}), zIndex: i + 1 }}
          onMouseDown={e => onItemMouseDown(e, item)}
          onClick={e => onItemClick(e, item)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
});
