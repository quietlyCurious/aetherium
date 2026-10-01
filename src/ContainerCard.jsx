import React from 'react';
import { ROOT_CONTAINER_ID, DEFAULT_COORD, DEFAULT_SLOT, BASE_TIER_ID } from './containerModel';
import { getLayoutStyle, getCoordStyle, getSlotStyle, getPageTypeStyle } from './containerStyles';
import { buildDefaultCells } from './GridEditor';
import { isLockedOrAncestorLocked, findContainerById } from './containerTree';
import GridEditor from './GridEditor';
import WidgetPreview from './WidgetPreview';
import { resolveWidgetProps, hasBrokenBinding } from './designer/screens/widgetBindings';
import { useScreenAsset } from './designer/screens/screenAsset';
import { useScreenProperty } from './designer/screens/screenProperty';
import { viewportScale } from './viewport/FitViewport';
import { beginCoordinateMove, beginMarquee } from './coordinate/coordinateCanvasDom';
import './coordinate/coordinateCanvas.css';
import { RepeaterBody, isRepeater } from './designer/screens/screenRepeat';

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
    // The canvas may be zoomed (viewport/FitViewport): everything measured
    // on screen, and every mouse movement, is divided by the zoom to get
    // back to the layout pixels the sizes are stored in.
    const k = viewportScale(card);
    const start = {
      x: e.clientX, y: e.clientY,
      w: rect.width / k, h: rect.height / k,
      left: (rect.left - parentRect.left) / k,
      top:  (rect.top  - parentRect.top) / k,
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
            return { id: c.id, w: r.width / k, h: r.height / k, left: (r.left - parentRect.left) / k, top: (r.top - parentRect.top) / k };
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

      const dx = (e.clientX - start.x) / k;
      const dy = (e.clientY - start.y) / k;

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
  container, containers, selectedIds, onSelect, onSelectMany = null, onDelete,
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
  // The property a screen about a property is showing (screenProperty.jsx),
  // the same way — a property tile gives each screen its own.
  const screenProperty = useScreenProperty();
  const bindingBroken = hasBoundProperties
    && hasBrokenBinding(container.bindings, container.widgetName || container.title, { assetId: screenAssetId, property: screenProperty });

  const isHiddenAtTier = activeTierId && activeTierId !== BASE_TIER_ID
    && (container.breakpointOverrides?.[activeTierId]?.hidden ?? false);

  // ── Box-select ─────────────────────────────────────────────────────────────
  // Dragging across the empty part of a coordinate container draws a rubber
  // band and selects the items it touches (Shift/Ctrl/Cmd adds to the
  // selection). On a container that can itself be moved (it sits in a
  // coordinate parent), a plain drag still moves it, so box-select there
  // takes Shift + drag. Measured in layout pixels, so it works zoomed.
  const [marquee, setMarquee] = React.useState(null); // { x, y, w, h } in the body's content box
  const marqueeEndedRef = React.useRef(false);
  const isCoordParent = container.layout?.layoutType === 'coordinate';
  const onBodyMouseDown = React.useCallback((e) => {
    if (!isCoordParent || !interactive || e.button !== 0) return;
    const body = e.currentTarget;
    if (e.target !== body) return; // empty space only, not an item in it
    if (isCoordChild && !e.shiftKey) return; // leave the drag to move this container
    e.preventDefault();
    e.stopPropagation();
    beginMarquee(e, {
      container: body,
      itemSelector: '.container-card',
      idOf: el => el.getAttribute('data-container-id'),
      onBand: setMarquee,
      onDone: (touched, { add }) => {
        marqueeEndedRef.current = true;
        const ids = (container.children || []).filter(c => touched.includes(String(c.id))).map(c => c.id);
        if (onSelectMany) onSelectMany(ids, { add });
      },
    });
  }, [isCoordParent, isCoordChild, interactive, container.children, onSelectMany]);

  // ── Moving a coordinate child ──────────────────────────────────────────────
  // Drag moves it (and the rest of a multi-selection under the same parent),
  // snapping to the grid and to its siblings with guides — the coordinate
  // layout's own move (coordinate/coordinateCanvasDom.js), shared with
  // CoordinateCanvas.
  const onCoordMouseDown = React.useCallback((e) => {
    if (!isCoordChild) return;
    // Only the primary button moves things; the middle button pans the
    // canvas (viewport/FitViewport).
    if (e.button !== 0) return;
    if (e.target.closest('.resize-handle')) return;
    const targetCard = e.target.closest('.container-card');
    if (targetCard && targetCard !== e.currentTarget) return;
    if (e.altKey || coordMode === 'reparent') return;
    e.preventDefault();
    e.stopPropagation();

    const isGroupMove = selectedIds && selectedIds.length > 1 && selectedIds.includes(container.id);
    const coMovers = isGroupMove
      ? selectedIds
          .filter(id => id !== container.id)
          .map(id => findContainerById(containers, id))
          .filter(c => c && c.parentId === container.parentId)
          .map(c => ({ id: c.id, coord: c.coord || DEFAULT_COORD }))
      : [];

    beginCoordinateMove(e, {
      itemEl: e.currentTarget,
      id: container.id,
      coord: container.coord || DEFAULT_COORD,
      coMovers,
      itemSelector: '.container-card',
      snap: snapEnabled,
      snapSize,
      onUpdate: onUpdateCoord,
      onGuides: onSnapGuideChange
        ? (guides) => onSnapGuideChange(guides ? { containerId: container.parentId, guides } : null)
        : null,
    });
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
      onClick={(e) => {
        e.stopPropagation();
        // The mouseup that ends a box-select also clicks the container it
        // was drawn in; that click mustn't replace the selection just made.
        if (marqueeEndedRef.current) { marqueeEndedRef.current = false; return; }
        if (!isEffectivelyLocked) onSelect(container.id, e);
      }}
      onDragOver={!container.isWidget && interactive ? (e) => { e.preventDefault(); e.stopPropagation(); onDragOver(container.id, null, null); } : undefined}
      onDrop={!container.isWidget && interactive ? (e) => {
        e.preventDefault(); e.stopPropagation();
        const widgetName = e.dataTransfer.getData('dx-widget-name');
        if (widgetName) { onWidgetDrop(container.id, widgetName); } else { onDrop(container.id, null); }
      } : undefined}
      onDragLeave={(e) => { e.stopPropagation(); }}
    >
      <div
        className={`container-card-body${showDotGrid ? ' coord-dots' : ''}`}
        onMouseDown={isCoordParent && interactive ? onBodyMouseDown : undefined}
        style={{
          ...layoutStyle, ...bodyPaddingStyle,
          minHeight: 0, flex: 1, position: 'relative',
          // A repeater's items are fixed boxes, so wrapped rows pack at
          // the top rather than being spread down a tall container —
          // otherwise five Tiles in a full-height container come out as
          // one row at the top and one at the bottom.
          ...(isRepeater(container) ? { alignContent: 'flex-start' } : null),
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

        {marquee && (
          <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
        )}

        {/* ── Main content ───────────────────────────────────────────────── */}
        {/* A repeater draws an item per asset in its set, or per property
            of its asset, instead of its own children — flowed, or placed
            by hand when this container is Manual (coordinate)
            (designer/screens/screenRepeat.jsx). */}
        {isRepeater(container) ? (
          <RepeaterBody
            container={container}
            selfAssetId={screenAssetId}
            queryResults={queryResults}
            queries={queries}
            interactive={interactive}
            snap={snapEnabled}
            snapSize={snapSize}
          />
        ) : container.layout?.layoutType === 'grid' ? (() => {
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
                        onSelectMany={onSelectMany}
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
                widgetProps={resolveWidgetProps(container.widgetProps, container.bindings, container.widgetName || container.title, { queryResults, queries, assetId: screenAssetId, property: screenProperty })}
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
                  onSelectMany={onSelectMany}
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
        bindingBroken
          ? <div className="binding-badge binding-badge--broken" title="A property is bound to something this screen isn't showing — see the widget's details">⚡!</div>
          : <div className="binding-badge" title="Has bound properties">⚡</div>
      )}
    </div>
  );
}

export default ContainerCard;
