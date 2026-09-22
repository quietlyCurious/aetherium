import React from 'react';
import { ROOT_CONTAINER_ID, DEFAULT_COORD, DEFAULT_SLOT, BASE_TIER_ID } from './containerModel';
import { getLayoutStyle, getCoordStyle, getSlotStyle, getPageTypeStyle } from './containerStyles';
import { buildDefaultCells } from './GridEditor';
import { isLockedOrAncestorLocked, findContainerById } from './containerTree';
import GridEditor from './GridEditor';
import WidgetPreview from './WidgetPreview';
import { resolveWidgetProps, hasBrokenAssetBinding } from './designer/screens/widgetBindings';
import { useScreenAsset } from './designer/screens/screenAsset';

function DropZone({ beforeId, parentId, dragState, onDragOver, onDrop, isDragging }) {
  const isActive = dragState.beforeId === beforeId && dragState.overParentId === parentId;
  return (
    <div
      className={`canvas-drop-zone${isActive ? ' canvas-drop-zone--active' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(null, beforeId, parentId); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(null, beforeId, parentId); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(null, beforeId); }}
    />
  );
}

function toHtmlId(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Grid snap only (no element snap) — used by resize handles.
// snapVal rounds a numeric coordinate to the nearest grid increment.
function useResizeEdge(container, containers, selectedIds, onUpdate, edge, isCoord, snapEnabled, snapSize) {
  return React.useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest('.container-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const parentRect = card.parentElement?.getBoundingClientRect() || rect;
    const start = {
      x: e.clientX, y: e.clientY,
      w: rect.width, h: rect.height,
      left: rect.left - parentRect.left,
      top:  rect.top  - parentRect.top,
    };

    const snapVal = (val) => snapEnabled && isCoord
      ? Math.round(val / snapSize) * snapSize
      : val;

    // Pure per-item resize formula — reused for the primary dragged item AND
    // every co-mover in a group resize, each supplying its OWN starting rect
    // (s = {w, h, left, top}) but sharing the same mouse delta (dx, dy).
    const computeUpdate = (s, dx, dy) => {
      const update = isCoord ? {} : { flexGrow: 0, flexShrink: 0 };
      if (edge === 'se') {
        isCoord
          ? Object.assign(update, { width: snapVal(Math.max(40, Math.round(s.w + dx))), height: snapVal(Math.max(40, Math.round(s.h + dy))) })
          : Object.assign(update, { width: `${Math.max(40, Math.round(s.w + dx))}px`, height: `${Math.max(40, Math.round(s.h + dy))}px` });
      } else if (edge === 'sw') {
        isCoord
          ? Object.assign(update, { width: snapVal(Math.max(40, Math.round(s.w - dx))), height: snapVal(Math.max(40, Math.round(s.h + dy))), left: snapVal(Math.max(0, Math.round(s.left + dx))) })
          : Object.assign(update, { width: `${Math.max(40, Math.round(s.w - dx))}px`, height: `${Math.max(40, Math.round(s.h + dy))}px` });
      } else if (edge === 'ne') {
        isCoord
          ? Object.assign(update, { width: snapVal(Math.max(40, Math.round(s.w + dx))), height: snapVal(Math.max(40, Math.round(s.h - dy))), top: snapVal(Math.max(0, Math.round(s.top + dy))) })
          : Object.assign(update, { width: `${Math.max(40, Math.round(s.w + dx))}px`, height: `${Math.max(40, Math.round(s.h - dy))}px` });
      } else if (edge === 'nw') {
        isCoord
          ? Object.assign(update, { width: snapVal(Math.max(40, Math.round(s.w - dx))), height: snapVal(Math.max(40, Math.round(s.h - dy))), left: snapVal(Math.max(0, Math.round(s.left + dx))), top: snapVal(Math.max(0, Math.round(s.top + dy))) })
          : Object.assign(update, { width: `${Math.max(40, Math.round(s.w - dx))}px`, height: `${Math.max(40, Math.round(s.h - dy))}px` });
      } else if (edge === 'e') {
        isCoord ? (update.width = snapVal(Math.max(40, Math.round(s.w + dx)))) : (update.width = `${Math.max(40, Math.round(s.w + dx))}px`);
      } else if (edge === 'w') {
        isCoord
          ? Object.assign(update, { width: snapVal(Math.max(40, Math.round(s.w - dx))), left: snapVal(Math.max(0, Math.round(s.left + dx))) })
          : (update.width = `${Math.max(40, Math.round(s.w - dx))}px`);
      } else if (edge === 's') {
        isCoord ? (update.height = snapVal(Math.max(40, Math.round(s.h + dy)))) : (update.height = `${Math.max(40, Math.round(s.h + dy))}px`);
      } else if (edge === 'n') {
        isCoord
          ? Object.assign(update, { height: snapVal(Math.max(40, Math.round(s.h - dy))), top: snapVal(Math.max(0, Math.round(s.top + dy))) })
          : (update.height = `${Math.max(40, Math.round(s.h - dy))}px`);
      }
      return update;
    };

    // Group resize: if this item is part of a multi-selection, capture every
    // OTHER selected sibling under the same parent, along with its own
    // starting rect (read from the DOM, same as the primary — needed since a
    // flex child's stored size may still be 'auto' rather than a pixel value).
    const isGroupResize = selectedIds && selectedIds.length > 1 && selectedIds.includes(container.id);
    const coMovers = isGroupResize
      ? selectedIds
          .filter(id => id !== container.id)
          .map(id => findContainerById(containers, id))
          .filter(c => c && c.parentId === container.parentId)
          .map(c => {
            const el = card.parentElement?.querySelector(`[data-container-id="${c.id}"]`);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { id: c.id, w: r.width, h: r.height, left: r.left - parentRect.left, top: r.top - parentRect.top };
          })
          .filter(Boolean)
      : [];

    const onMouseMove = (e) => {
      // Self-heal from a missed native mouseup (e.g. the cursor left the browser
      // window mid-drag and the button was released outside it — the browser never
      // delivers that mouseup to us, so these listeners would otherwise stay
      // attached and fire again later from a stale `start` position). If the
      // primary button isn't currently pressed, treat this move as the drag's end.
      if (e.buttons === 0) {
        onMouseUp();
        return;
      }

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;

      onUpdate(container.id, computeUpdate(start, dx, dy));
      coMovers.forEach(cm => onUpdate(cm.id, computeUpdate(cm, dx, dy)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [container, containers, selectedIds, onUpdate, edge, isCoord, snapEnabled, snapSize]);
}

function ContainerCard({
  container, containers, selectedIds, onSelect, onDelete,
  onDragStart, onDragOver, onDrop, onWidgetDrop,
  onUpdateLayout, onUpdateSlot, onUpdateCoord,
  onGridCellDrop, onSetSelectedGridCell, onMergeCellContainers,
  selectedGridCell, parentLayout, childIndex,
  dragState, draggingId, isDragging, coordMode, activeTierId,
  snapEnabled = false, snapSize = 8,
  snapGuides = null, onSnapGuideChange = null,
  queryResults = null, queries = null,
  interactive = true,
  depth = 0,
}) {
  const isSelected = selectedIds ? selectedIds.includes(container.id) : false;
  const isMultiSelected = selectedIds && selectedIds.length > 1 && isSelected;
  const isRoot = container.id === ROOT_CONTAINER_ID;
  const isDragOver = dragState.overId === container.id;
  const htmlId = toHtmlId(container.title);
  const isCoordChild = parentLayout?.layoutType === 'coordinate';

  const isEffectivelyLocked = !isRoot && isLockedOrAncestorLocked(containers || [], container.id);

  // True when this widget has at least one bound property — drives the canvas badge
  const hasBoundProperties = container.isWidget
    && !!container.bindings
    && Object.keys(container.bindings).length > 0;

  // The asset the enclosing screen is showing ("self"), for asset bindings.
  // It comes from context (ScreenAssetProvider), not props, so a repeater
  // can give each item its own.
  const screenAssetId = useScreenAsset();
  const hasBrokenBinding = hasBoundProperties
    && hasBrokenAssetBinding(container.bindings, container.widgetName || container.title, screenAssetId);

  const isHiddenAtTier = activeTierId && activeTierId !== BASE_TIER_ID
    && (container.breakpointOverrides?.[activeTierId]?.hidden ?? false);

  // Coord drag state — must be declared before any conditional return
  const coordDragRef = React.useRef(null);

  const onCoordMouseDown = React.useCallback((e) => {
    if (!isCoordChild) return;
    if (e.target.closest('.resize-handle')) return;
    const targetCard = e.target.closest('.container-card');
    if (targetCard && targetCard !== e.currentTarget) return;
    if (e.altKey || coordMode === 'reparent') return;
    e.preventDefault();
    e.stopPropagation();

    const coord = container.coord || DEFAULT_COORD;
    const cardRect   = e.currentTarget.getBoundingClientRect();
    const parentEl   = e.currentTarget.parentElement; // container-card-body of coord parent
    const parentRect = parentEl ? parentEl.getBoundingClientRect() : cardRect;

    // ── Determine anchor type per axis ────────────────────────────────────────
    // 'left'  = only left is set  → drag updates left
    // 'right' = only right is set → drag updates right (inverted delta)
    // 'both'  = stretch mode      → drag updates both (preserves derived width)
    const isSet = (v) => v !== '' && v !== undefined && v !== null;
    const leftSet   = isSet(coord.left);
    const rightSet  = isSet(coord.right);
    const topSet    = isSet(coord.top);
    const bottomSet = isSet(coord.bottom);
    const xAnchor = leftSet && rightSet ? 'both' : rightSet ? 'right' : 'left';
    const yAnchor = topSet && bottomSet ? 'both' : bottomSet ? 'bottom' : 'top';

    // ── Capture sibling & parent geometry once at drag start ─────────────────
    const siblingRects = [];
    if (parentEl) {
      Array.from(parentEl.querySelectorAll(':scope > .container-card'))
        .filter(el => el !== e.currentTarget)
        .forEach(el => {
          const r = el.getBoundingClientRect();
          siblingRects.push({
            left:    r.left   - parentRect.left,
            top:     r.top    - parentRect.top,
            right:   r.right  - parentRect.left,
            bottom:  r.bottom - parentRect.top,
            centerX: (r.left  + r.right)  / 2 - parentRect.left,
            centerY: (r.top   + r.bottom) / 2 - parentRect.top,
          });
        });
      siblingRects.push({
        left:    0,
        top:     0,
        right:   parentRect.width,
        bottom:  parentRect.height,
        centerX: parentRect.width  / 2,
        centerY: parentRect.height / 2,
      });
    }

    // ── Group drag: if this item is part of a multi-selection, capture the other
    // selected siblings (same parent) so they can be moved by the same delta.
    const isGroupDrag = selectedIds && selectedIds.length > 1 && selectedIds.includes(container.id);
    const coMoverSnapshots = isGroupDrag
      ? selectedIds
          .filter(id => id !== container.id)
          .map(id => findContainerById(containers, id))
          .filter(c => c && c.parentId === container.parentId)
          .map(c => {
            const cc = c.coord || DEFAULT_COORD;
            const cLeftSet = isSet(cc.left), cRightSet = isSet(cc.right);
            const cTopSet = isSet(cc.top), cBottomSet = isSet(cc.bottom);
            return {
              id: c.id,
              origLeft:   cc.left   ?? 0,
              origTop:    cc.top    ?? 0,
              origRight:  cc.right  ?? 0,
              origBottom: cc.bottom ?? 0,
              xAnchor: cLeftSet && cRightSet ? 'both' : cRightSet ? 'right' : 'left',
              yAnchor: cTopSet && cBottomSet ? 'both' : cBottomSet ? 'bottom' : 'top',
            };
          })
      : [];

    coordDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft:   coord.left   ?? 0,
      origTop:    coord.top    ?? 0,
      origRight:  coord.right  ?? 0,
      origBottom: coord.bottom ?? 0,
      xAnchor,
      yAnchor,
      dragW: cardRect.width,
      dragH: cardRect.height,
      parentW: parentRect.width,
      parentH: parentRect.height,
      siblingRects,
      coMoverSnapshots,
    };

    const onMouseMove = (e) => {
      if (!coordDragRef.current) return;
      const {
        startX, startY,
        origLeft, origTop, origRight, origBottom,
        xAnchor, yAnchor,
        dragW, dragH, siblingRects,
        coMoverSnapshots,
      } = coordDragRef.current;

      // Move every other selected sibling by the same left/top-space delta the
      // primary dragged item moved, each respecting its own anchor configuration.
      const moveCoMoversBy = (deltaX, deltaY) => {
        coMoverSnapshots.forEach(cm => {
          const cUpd = {};
          if (cm.xAnchor !== 'right')  cUpd.left   = Math.max(0, Math.round(cm.origLeft   + deltaX));
          if (cm.xAnchor !== 'left')   cUpd.right  = Math.max(0, Math.round(cm.origRight  - deltaX));
          if (cm.yAnchor !== 'bottom') cUpd.top    = Math.max(0, Math.round(cm.origTop    + deltaY));
          if (cm.yAnchor !== 'top')    cUpd.bottom = Math.max(0, Math.round(cm.origBottom - deltaY));
          onUpdateCoord(cm.id, cUpd);
        });
      };

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Raw positions for every anchor property — always compute all four.
      // Right/bottom deltas invert because increasing offset means closer to that edge.
      const rawLeft   = Math.max(0, Math.round(origLeft   + dx));
      const rawRight  = Math.max(0, Math.round(origRight  - dx));
      const rawTop    = Math.max(0, Math.round(origTop    + dy));
      const rawBottom = Math.max(0, Math.round(origBottom - dy));

      if (!snapEnabled) {
        const upd = {};
        if (xAnchor !== 'right')  upd.left   = rawLeft;
        if (xAnchor !== 'left')   upd.right  = rawRight;
        if (yAnchor !== 'bottom') upd.top    = rawTop;
        if (yAnchor !== 'top')    upd.bottom = rawBottom;
        onUpdateCoord(container.id, upd);
        moveCoMoversBy(rawLeft - origLeft, rawTop - origTop);
        if (onSnapGuideChange) onSnapGuideChange(null);
        return;
      }

      // ── Element snap (always in left/top-space — same as sibling rects) ─────
      // snapX/Y.offset is in left/top-space; for right/bottom, the offset inverts.
      const dragPointsX = [rawLeft, rawLeft + dragW / 2, rawLeft + dragW];
      const dragPointsY = [rawTop,  rawTop  + dragH / 2, rawTop  + dragH];

      let bestDistX = snapSize;
      let bestDistY = snapSize;
      let snapX = null;
      let snapY = null;

      for (const sr of siblingRects) {
        const txPoints = [sr.left, sr.centerX, sr.right];
        const tyPoints = [sr.top,  sr.centerY, sr.bottom];
        for (const tp of txPoints) {
          for (const dp of dragPointsX) {
            const dist = Math.abs(dp - tp);
            if (dist < bestDistX) { bestDistX = dist; snapX = { offset: tp - dp, guidePos: tp }; }
          }
        }
        for (const tp of tyPoints) {
          for (const dp of dragPointsY) {
            const dist = Math.abs(dp - tp);
            if (dist < bestDistY) { bestDistY = dist; snapY = { offset: tp - dp, guidePos: tp }; }
          }
        }
      }

      // ── Apply snap to anchor properties ──────────────────────────────────────
      // Element snap offset is in left/top-space: +offset moves element right/down.
      // For right/bottom anchors the sign inverts (closer to right edge = smaller value).
      const gridSnap = (v) => Math.round(v / snapSize) * snapSize;

      const finalLeft   = snapX ? Math.max(0, rawLeft   + snapX.offset) : gridSnap(rawLeft);
      const finalRight  = snapX ? Math.max(0, rawRight  - snapX.offset) : gridSnap(rawRight);
      const finalTop    = snapY ? Math.max(0, rawTop    + snapY.offset) : gridSnap(rawTop);
      const finalBottom = snapY ? Math.max(0, rawBottom - snapY.offset) : gridSnap(rawBottom);

      const upd = {};
      if (xAnchor !== 'right')  upd.left   = finalLeft;
      if (xAnchor !== 'left')   upd.right  = finalRight;
      if (yAnchor !== 'bottom') upd.top    = finalTop;
      if (yAnchor !== 'top')    upd.bottom = finalBottom;

      // ── Guides ────────────────────────────────────────────────────────────────
      const guides = [];
      if (snapX) guides.push({ type: 'v', position: snapX.guidePos });
      if (snapY) guides.push({ type: 'h', position: snapY.guidePos });
      if (onSnapGuideChange) {
        onSnapGuideChange(guides.length > 0 ? { containerId: container.parentId, guides } : null);
      }

      onUpdateCoord(container.id, upd);
      moveCoMoversBy(finalLeft - origLeft, finalTop - origTop);
    };

    const onMouseUp = () => {
      coordDragRef.current = null;
      if (onSnapGuideChange) onSnapGuideChange(null);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isCoordChild, container, containers, selectedIds, onUpdateCoord, coordMode, snapEnabled, snapSize, onSnapGuideChange]);

  // Apply breakpoint slot overrides for preview
  const effectiveSlot = (activeTierId && activeTierId !== BASE_TIER_ID && container.breakpointOverrides?.[activeTierId]?.slot)
    ? { ...container.slot, ...container.breakpointOverrides[activeTierId].slot }
    : container.slot;

  // In stretch mode (both edges on an axis have values), suppress width/height
  // from the CSS so the browser derives the size from the offset pair.
  // The stored width/height is preserved in data — it comes back if stretch exits.
  const coordRaw = container.coord || DEFAULT_COORD;
  const coordIsSet = (v) => v !== '' && v !== undefined && v !== null;
  const coordStretchX = coordIsSet(coordRaw.left) && coordIsSet(coordRaw.right);
  const coordStretchY = coordIsSet(coordRaw.top)  && coordIsSet(coordRaw.bottom);
  const coordForStyle = (coordStretchX || coordStretchY)
    ? { ...coordRaw, ...(coordStretchX ? { width: '' } : {}), ...(coordStretchY ? { height: '' } : {}) }
    : coordRaw;

  const coordStyle = isCoordChild
    ? { ...getCoordStyle(coordForStyle), zIndex: (childIndex ?? 0) + 1 }
    : null;

  const slotStyles = isRoot
    ? { card: getPageTypeStyle(container.pageType || 'fit'), body: {} }
    : (() => {
        // Always compute the slot-based style (border, margin, background, padding,
        // typography) regardless of layout mode. For coordinate children, merge it
        // with coordStyle (position/size) rather than discarding it — coordStyle's
        // position/left/top/right/bottom/width/height/min/max win on any overlap
        // (coordinate sizing should take priority), everything else from the slot
        // (border/margin/background/typography/padding) passes through untouched.
        const base = getSlotStyle(effectiveSlot);
        return isCoordChild
          ? { card: { ...base.card, ...coordStyle }, body: base.body }
          : base;
      })();

  // In runtime only, suppress whatever baseline border a CSS class imposes
  // (the design-time "so you can see container edges to grab them" visual
  // aid) when the user hasn't configured a real one — that aid is necessary
  // in the editor, but shouldn't show up in the actual rendered output.
  // Design time (interactive=true) is completely untouched here.
  const noUserBorder = !effectiveSlot.borderWidth && !effectiveSlot.borderStyle && !effectiveSlot.borderColor;
  const cardStyle = (!interactive && noUserBorder)
    ? { ...slotStyles.card, border: 'none' }
    : slotStyles.card;
  const bodyPaddingStyle = slotStyles.body;
  const layoutStyle    = getLayoutStyle(container.layout);
  const onUpdate       = isCoordChild ? onUpdateCoord : onUpdateSlot;

  // All hooks before any conditional return
  const rNW = useResizeEdge(container, containers, selectedIds, onUpdate, 'nw', isCoordChild, snapEnabled, snapSize);
  const rNE = useResizeEdge(container, containers, selectedIds, onUpdate, 'ne', isCoordChild, snapEnabled, snapSize);
  const rSW = useResizeEdge(container, containers, selectedIds, onUpdate, 'sw', isCoordChild, snapEnabled, snapSize);
  const rSE = useResizeEdge(container, containers, selectedIds, onUpdate, 'se', isCoordChild, snapEnabled, snapSize);
  const rN  = useResizeEdge(container, containers, selectedIds, onUpdate, 'n',  isCoordChild, snapEnabled, snapSize);
  const rS  = useResizeEdge(container, containers, selectedIds, onUpdate, 's',  isCoordChild, snapEnabled, snapSize);
  const rW  = useResizeEdge(container, containers, selectedIds, onUpdate, 'w',  isCoordChild, snapEnabled, snapSize);
  const rE  = useResizeEdge(container, containers, selectedIds, onUpdate, 'e',  isCoordChild, snapEnabled, snapSize);

  // Early return AFTER all hooks
  if (isHiddenAtTier && !isSelected) return null;

  // Dot grid: show on any container whose children live in coordinate space.
  // Uses a CSS variable so the grid interval matches the live snapSize value.
  const showDotGrid = container.layout?.layoutType === 'coordinate' && snapEnabled;

  // Is this container the active guide target? (its direct child is being dragged)
  const isGuideTarget = snapGuides?.containerId === container.id;

  return (
    <div
      id={htmlId}
      data-container-id={container.id}
      className={[
        'container-card',
        isSelected && !isMultiSelected ? 'container-card--selected' : '',
        isMultiSelected                 ? 'container-card--multi-selected' : '',
        isDragOver                      ? 'container-card--drag-over' : '',
        container.isWidget              ? 'container-card--widget' : '',
        isCoordChild                    ? 'container-card--coord' : '',
        isEffectivelyLocked             ? 'container-card--locked' : '',
      ].filter(Boolean).join(' ')}
      style={cardStyle}
      draggable={!isRoot && !isEffectivelyLocked && interactive}
      onDragStart={!isRoot && !isEffectivelyLocked && interactive ? (e) => {
        if (e.target.closest('.container-card') !== e.currentTarget) return;
        if (isCoordChild && !e.altKey && coordMode !== 'reparent') { e.preventDefault(); return; }
        e.stopPropagation();
        onDragStart(container.id, container.parentId);
      } : undefined}
      onMouseDown={isCoordChild && !isEffectivelyLocked && interactive ? onCoordMouseDown : undefined}
      onClick={(e) => { e.stopPropagation(); if (!isEffectivelyLocked) onSelect(container.id, e); }}
      onDragOver={!container.isWidget && interactive ? (e) => { e.preventDefault(); e.stopPropagation(); onDragOver(container.id, null, null); } : undefined}
      onDrop={!container.isWidget && interactive ? (e) => {
        e.preventDefault(); e.stopPropagation();
        const widgetName = e.dataTransfer.getData('dx-widget-name');
        if (widgetName) { onWidgetDrop(container.id, widgetName); } else { onDrop(container.id, null); }
      } : undefined}
      onDragLeave={(e) => { e.stopPropagation(); }}
    >
      <div
        className={`container-card-body${showDotGrid ? ' container-card-body--coord-dots' : ''}`}
        style={{
          ...layoutStyle, ...bodyPaddingStyle,
          minHeight: 0, flex: 1, position: 'relative',
          // Overflow read from slot so user-set values (and breakpoint overrides) apply.
          // Falls back to 'auto' to match the historical hardcoded behaviour.
          overflowX: effectiveSlot?.overflowX || 'auto',
          overflowY: effectiveSlot?.overflowY || 'auto',
          // CSS variable drives dot-grid background-size so it matches snapSize live
          ...(showDotGrid ? { '--snap-size': `${snapSize}px` } : {}),
        }}
      >
        {/* ── Snap guide overlay ─────────────────────────────────────────────
            Renders on the coordinate *parent* (the container whose children
            are snapping). Guides are full-height/width lines, pointer-events
            none so they never interfere with child interaction.           */}
        {isGuideTarget && snapGuides.guides.map((g, i) => (
          <div
            key={i}
            className="snap-guide"
            style={g.type === 'v'
              ? { position: 'absolute', left: g.position, top: 0, bottom: 0, width: 1, zIndex: 50, pointerEvents: 'none' }
              : { position: 'absolute', top: g.position, left: 0, right: 0, height: 1, zIndex: 50, pointerEvents: 'none' }
            }
          />
        ))}

        {/* ── Main content ───────────────────────────────────────────────── */}
        {container.layout?.layoutType === 'grid' ? (() => {
          const cols  = container.layout.gridColumns || 2;
          const rows  = container.layout.gridRows    || 2;
          const cells = container.layout.gridCells   || buildDefaultCells(cols, rows);
          return (
            <>
              <GridEditor
                layout={container.layout}
                onUpdateLayout={(update) => onUpdateLayout(container.id, update)}
                onMergeCellContainers={onMergeCellContainers}
              />
              {cells.map((cell, cellIdx) => {
                const cellChildIds = cell.childIds || (cell.childId != null ? [cell.childId] : []);
                const cellChildren = cellChildIds.map(id => container.children.find(c => c.id === id)).filter(Boolean);
                const isEmpty = cellChildren.length === 0;
                return (
                  <div
                    key={cell.id}
                    className={`grid-cell-slot${selectedGridCell?.containerId === container.id && selectedGridCell?.cellIdx === cellIdx ? ' grid-cell-slot--selected' : ''}`}
                    style={{
                      gridColumn: `${cell.colStart} / ${cell.colEnd}`,
                      gridRow:    `${cell.rowStart} / ${cell.rowEnd}`,
                      position: 'relative', minHeight: 0, minWidth: 0,
                      overflow: cellChildren.length > 1 ? 'auto' : 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}
                    onClick={(e) => {
                      if (isEmpty) {
                        e.stopPropagation();
                        onSelect(null, e);
                        if (onSetSelectedGridCell) onSetSelectedGridCell({ containerId: container.id, cellIdx });
                      }
                    }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('grid-cell-slot--over'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('grid-cell-slot--over'); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      e.currentTarget.classList.remove('grid-cell-slot--over');
                      const wName = e.dataTransfer.getData('dx-widget-name');
                      if (onGridCellDrop) onGridCellDrop(container.id, cellIdx, wName || null, draggingId, cellChildIds);
                    }}
                  >
                    {cellChildren.map((child, ci) => (
                      <ContainerCard
                        key={child.id}
                        container={child}
                        selectedIds={selectedIds}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        onDragStart={onDragStart}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        onWidgetDrop={onWidgetDrop}
                        onUpdateLayout={onUpdateLayout}
                        onUpdateSlot={onUpdateSlot}
                        onUpdateCoord={onUpdateCoord}
                        onGridCellDrop={onGridCellDrop}
                        onSetSelectedGridCell={onSetSelectedGridCell}
                        onMergeCellContainers={onMergeCellContainers}
                        selectedGridCell={selectedGridCell}
                        containers={containers}
                        parentLayout={container.layout}
                        childIndex={ci}
                        dragState={dragState}
                        draggingId={draggingId}
                        isDragging={isDragging}
                        coordMode={coordMode}
                        activeTierId={activeTierId}
                        snapEnabled={snapEnabled}
                        snapSize={snapSize}
                        snapGuides={snapGuides}
                        onSnapGuideChange={onSnapGuideChange}
                        queryResults={queryResults}
                        queries={queries}
                        interactive={interactive}
                        depth={depth + 1}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          );
        })() : container.isWidget && container.children.length === 0 ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {draggingId === container.id ? (
              <div style={{ width: '100%', height: '100%', background: '#dcdcdc', borderRadius: 3 }} />
            ) : (
              <WidgetPreview
                widgetName={container.widgetName || container.title}
                widgetProps={resolveWidgetProps(container.widgetProps, container.bindings, container.widgetName || container.title, { queryResults, queries, assetId: screenAssetId })}
              />
            )}
          </div>
        ) : container.children.length === 0 ? (
          <>
            {container.layout?.layoutType !== 'coordinate' && container.layout?.layoutType !== 'grid' && (
              <DropZone beforeId={null} parentId={container.id} dragState={dragState} onDragOver={onDragOver} onDrop={onDrop} isDragging={isDragging} />
            )}
            <div className="widget-placeholder">
              <i className="dx-icon-dropzone widget-placeholder-icon" />
            </div>
          </>
        ) : (
          <>
            {container.layout?.layoutType !== 'coordinate' && container.layout?.layoutType !== 'grid' && (
              <DropZone beforeId={container.children[0].id} parentId={container.id} dragState={dragState} onDragOver={onDragOver} onDrop={onDrop} isDragging={isDragging} />
            )}
            {container.children.map((child, idx) => (
              <React.Fragment key={child.id}>
                <ContainerCard
                  container={child}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onWidgetDrop={onWidgetDrop}
                  onUpdateLayout={onUpdateLayout}
                  onUpdateSlot={onUpdateSlot}
                  onUpdateCoord={onUpdateCoord}
                  onGridCellDrop={onGridCellDrop}
                  onSetSelectedGridCell={onSetSelectedGridCell}
                  onMergeCellContainers={onMergeCellContainers}
                  selectedGridCell={selectedGridCell}
                  containers={containers}
                  parentLayout={container.layout}
                  childIndex={idx}
                  dragState={dragState}
                  draggingId={draggingId}
                  isDragging={isDragging}
                  coordMode={coordMode}
                  activeTierId={activeTierId}
                  snapEnabled={snapEnabled}
                  snapSize={snapSize}
                  snapGuides={snapGuides}
                  onSnapGuideChange={onSnapGuideChange}
                  queryResults={queryResults}
                  queries={queries}
                  interactive={interactive}
                  depth={depth + 1}
                />
                {container.layout?.layoutType !== 'coordinate' && container.layout?.layoutType !== 'grid' && (
                  <DropZone
                    beforeId={idx < container.children.length - 1 ? container.children[idx + 1].id : null}
                    parentId={container.id}
                    dragState={dragState}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    isDragging={isDragging}
                  />
                )}
              </React.Fragment>
            ))}
          </>
        )}
      </div>

      {isSelected && !isRoot && !isEffectivelyLocked && (
        <>
          <div className="resize-handle resize-handle--nw" onMouseDown={rNW} />
          <div className="resize-handle resize-handle--ne" onMouseDown={rNE} />
          <div className="resize-handle resize-handle--sw" onMouseDown={rSW} />
          <div className="resize-handle resize-handle--se" onMouseDown={rSE} />
          <div className="resize-handle resize-handle--n"  onMouseDown={rN}  />
          <div className="resize-handle resize-handle--s"  onMouseDown={rS}  />
          <div className="resize-handle resize-handle--w"  onMouseDown={rW}  />
          <div className="resize-handle resize-handle--e"  onMouseDown={rE}  />
        </>
      )}
      {hasBoundProperties && interactive && (
        hasBrokenBinding
          ? <div className="binding-badge binding-badge--broken" title="A property is bound to something this asset doesn't have — see the widget's details">⚡!</div>
          : <div className="binding-badge" title="Has bound properties">⚡</div>
      )}
    </div>
  );
}

export default ContainerCard;
