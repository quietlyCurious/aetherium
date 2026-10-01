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
//                content's size. coord null = not placed yet: it's measured
//                and put in the first free spot (coordinatePlacement.js),
//                and onAutoPlace(Map id → { left, top }) says where
//   selectedIds  ids selected; onSelectionChange(ids) changes them
//   onUpdateCoord(id, update)  coord fields to merge into an item, called
//                as it moves (and once per item for align / arrange)
//   snap, snapSize   grid and line-up snapping (default on, 8px)
//   readOnly     no moving or selecting — just draws them where they are
//   trim         draw the items' top-left-most corner at the origin (for a
//                read-only view: no empty band where nothing is)
// ref: { align(mode), distribute(axis), arrangeGrid(), arrange(action, ids) }
// — the first three act on the selection (the object CanvasAlignControls
// drives); arrange takes any ids.
//
// A click that ends a move doesn't count as a click (it would otherwise
// reach whatever is under the pointer), and a moved item becomes selected.
// Buttons and links inside an item work as usual and don't start a move.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { getCoordStyle } from '../containerStyles';
import { arrangeControlsFor, arrangedUpdates, beginCoordinateMove, beginMarquee } from './coordinateCanvasDom';
import { placeUnplaced } from './coordinatePlacement';
import './coordinateCanvas.css';

const ITEM_SELECTOR = '.coord-canvas-item';
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';
const isNum = (v) => v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v));

export const CoordinateCanvas = forwardRef(function CoordinateCanvas({
  items,
  selectedIds = [],
  onSelectionChange,
  onUpdateCoord,
  onAutoPlace,
  snap = true,
  snapSize = 8,
  readOnly = false,
  trim = false,
  minWidth = 0,
  minHeight = 0,
  margin = 40,
  className = '',
}, ref) {
  const canvasRef = useRef(null);
  const [guides, setGuides] = useState(null);
  const [band, setBand] = useState(null);
  const bandEndedRef = useRef(false);
  const movedRef = useRef(false);
  const [extent, setExtent] = useState({ w: 0, h: 0 });
  // Where the canvas put items that came without a position.
  const [autoPlaced, setAutoPlaced] = useState({});

  const coordOf = (item) => item.coord ?? autoPlaced[item.id] ?? null;

  // trim: the offset that brings the top-left-most item to the origin.
  const placedCoords = items.map(coordOf).filter(Boolean);
  const lefts = placedCoords.map(c => c.left).filter(isNum).map(Number);
  const tops = placedCoords.map(c => c.top).filter(isNum).map(Number);
  const shift = trim ? { x: lefts.length ? Math.min(...lefts) : 0, y: tops.length ? Math.min(...tops) : 0 } : { x: 0, y: 0 };
  // An item with no width of its own is its content's width — not squeezed
  // by how much canvas happens to be to its right (an absolutely placed box
  // otherwise shrinks to fit there, and the canvas only grows after).
  const styleFor = (coord) => {
    if (!coord) return { position: 'absolute', left: 0, top: 0, width: 'max-content', visibility: 'hidden' };
    const c = (shift.x || shift.y)
      ? { ...coord, ...(isNum(coord.left) ? { left: Number(coord.left) - shift.x } : null), ...(isNum(coord.top) ? { top: Number(coord.top) - shift.y } : null) }
      : coord;
    const style = getCoordStyle(c);
    const stretched = isNum(c.left) && isNum(c.right);
    return style.width === undefined && !stretched ? { ...style, width: 'max-content' } : style;
  };

  const idOf = (el) => {
    const key = el.getAttribute('data-coord-id');
    return items.find(it => String(it.id) === key)?.id;
  };
  const elOf = (id) => canvasRef.current?.querySelector(`:scope > [data-coord-id="${CSS.escape(String(id))}"]`);
  const select = (ids) => onSelectionChange?.(ids);

  // Grow to hold everything as drawn — after every render, and whenever an
  // item changes size on its own (its content laid itself out later: a
  // card holding its own manual layout, data arriving).
  const measureExtent = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let w = 0;
    let h = 0;
    canvas.querySelectorAll(`:scope > ${ITEM_SELECTOR}`).forEach(el => {
      w = Math.max(w, el.offsetLeft + el.offsetWidth);
      h = Math.max(h, el.offsetTop + el.offsetHeight);
    });
    setExtent(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
  };
  const measureExtentRef = useRef(measureExtent);
  measureExtentRef.current = measureExtent;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { measureExtent(); });
  const itemsKey = items.map(it => it.id).join('|');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measureExtentRef.current());
    canvas.querySelectorAll(`:scope > ${ITEM_SELECTOR}`).forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [itemsKey]);

  // Place anything that has no position — once every item has settled at
  // its real size. Not during layout, and not on the first frame: what's
  // inside an item can take a frame or two to lay itself out (a card
  // holding its own manual layout places its own tiles first), and a spot
  // worked out before then isn't really free. So: measure every frame
  // until nothing inside is still waiting to be placed and two frames in a
  // row agree (a dozen frames at most), then place.
  const placingRef = useRef(0);
  const pendingKey = items.filter(it => !coordOf(it)).map(it => it.id).join('|');
  useEffect(() => {
    if (!pendingKey) return undefined;
    let frames = 0;
    let last = '';
    const sizesNow = () => items.map(it => {
      const el = elOf(it.id);
      return el ? `${el.offsetWidth}x${el.offsetHeight}` : '';
    }).join('|');
    const place = () => {
      const pending = items.filter(it => !coordOf(it));
      if (!pending.length) return;
      const rectOf = (el) => ({ x: el.offsetLeft + shift.x, y: el.offsetTop + shift.y, w: el.offsetWidth, h: el.offsetHeight });
      const placed = items.filter(it => coordOf(it)).map(it => elOf(it.id)).filter(Boolean).map(rectOf);
      const spots = placeUnplaced(placed, pending.map(it => {
        const el = elOf(it.id);
        return { id: it.id, w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 };
      }));
      setAutoPlaced(current => {
        const next = { ...current };
        spots.forEach((pos, id) => { next[id] = pos; });
        return next;
      });
      onAutoPlace?.(spots);
    };
    const tick = () => {
      const now = sizesNow();
      frames += 1;
      const innerWaiting = !!canvasRef.current?.querySelector(`:scope > ${ITEM_SELECTOR} [data-coord-pending]`);
      if ((now === last && !innerWaiting) || frames >= 12) { place(); return; }
      last = now;
      placingRef.current = requestAnimationFrame(tick);
    };
    placingRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(placingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const arrange = (action, ids) => {
    const canvas = canvasRef.current;
    if (!canvas || readOnly) return;
    const chosen = items.filter(it => ids.includes(it.id) && coordOf(it));
    const updates = arrangedUpdates(canvas, chosen.map(it => ({ id: it.id, coord: coordOf(it), el: elOf(it.id) })), action);
    updates?.forEach((update, id) => onUpdateCoord?.(id, update));
  };
  useImperativeHandle(ref, () => ({
    ...arrangeControlsFor(action => arrange(action, selectedIds)),
    arrange,
  }));

  const onItemMouseDown = (e, item) => {
    if (readOnly || e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    e.preventDefault();
    e.stopPropagation();
    const isGroupMove = selectedIds.length > 1 && selectedIds.includes(item.id);
    const coMovers = isGroupMove
      ? items.filter(it => it.id !== item.id && selectedIds.includes(it.id) && coordOf(it)).map(it => ({ id: it.id, coord: coordOf(it) }))
      : [];
    beginCoordinateMove(e, {
      itemEl: e.currentTarget,
      id: item.id,
      coord: coordOf(item) || { left: 0, top: 0 },
      coMovers,
      itemSelector: ITEM_SELECTOR,
      snap,
      snapSize,
      onUpdate: (id, update) => onUpdateCoord?.(id, update),
      onGuides: setGuides,
      onEnd: (moved) => {
        movedRef.current = moved;
        if (moved && !selectedIds.includes(item.id)) select([item.id]);
      },
    });
  };

  // Swallows the click that ends a move, before anything inside sees it.
  const onItemClickCapture = (e) => {
    if (!movedRef.current) return;
    movedRef.current = false;
    e.stopPropagation();
  };

  const onItemClick = (e, item) => {
    if (readOnly || e.target.closest(INTERACTIVE)) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      select(selectedIds.includes(item.id) ? selectedIds.filter(id => id !== item.id) : [...selectedIds, item.id]);
    } else if (!(selectedIds.length > 1 && selectedIds.includes(item.id))) {
      // A click on part of a multi-selection keeps it; anywhere else
      // selects just this one.
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
      className={[
        'coord-canvas',
        snap && !readOnly ? 'coord-dots' : '',
        readOnly ? 'coord-canvas--readonly' : '',
        selectedIds.length > 1 ? 'coord-canvas--multi' : '',
        className,
      ].filter(Boolean).join(' ')}
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
          data-coord-pending={coordOf(item) ? undefined : ''}
          className={`coord-canvas-item${!readOnly && selectedIds.includes(item.id) ? ' coord-canvas-item--selected' : ''}`}
          style={{ ...styleFor(coordOf(item)), zIndex: i + 1 }}
          onMouseDown={e => onItemMouseDown(e, item)}
          onClickCapture={onItemClickCapture}
          onClick={e => onItemClick(e, item)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
});
