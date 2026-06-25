import React from 'react';
import { ROOT_CONTAINER_ID, DEFAULT_COORD, DEFAULT_SLOT, BASE_TIER_ID } from './containerModel';
import { getLayoutStyle, getCoordStyle, getSlotStyle, getPageTypeStyle } from './containerStyles';
import { buildDefaultCells } from './GridEditor';
import { isLockedOrAncestorLocked } from './containerTree';
import GridEditor from './GridEditor';
import WidgetPreview from './WidgetPreview';

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

function useResizeEdge(containerId, onUpdate, edge, isCoord) {
  return React.useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest('.container-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const parentRect = card.parentElement?.getBoundingClientRect() || rect;
    const start = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
      left: rect.left - parentRect.left,
      top: rect.top - parentRect.top,
    };

    const onMouseMove = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const update = isCoord ? {} : { flexGrow: 0, flexShrink: 0 };

      if (edge === 'se') {
        isCoord
          ? Object.assign(update, { width: Math.max(40, Math.round(start.w + dx)), height: Math.max(40, Math.round(start.h + dy)) })
          : Object.assign(update, { width: `${Math.max(40, Math.round(start.w + dx))}px`, height: `${Math.max(40, Math.round(start.h + dy))}px` });
      } else if (edge === 'sw') {
        const newW = Math.max(40, Math.round(start.w - dx));
        const newH = Math.max(40, Math.round(start.h + dy));
        isCoord
          ? Object.assign(update, { width: newW, height: newH, left: Math.max(0, Math.round(start.left + dx)) })
          : Object.assign(update, { width: `${newW}px`, height: `${newH}px` });
      } else if (edge === 'ne') {
        const newW = Math.max(40, Math.round(start.w + dx));
        const newH = Math.max(40, Math.round(start.h - dy));
        isCoord
          ? Object.assign(update, { width: newW, height: newH, top: Math.max(0, Math.round(start.top + dy)) })
          : Object.assign(update, { width: `${newW}px`, height: `${newH}px` });
      } else if (edge === 'nw') {
        const newW = Math.max(40, Math.round(start.w - dx));
        const newH = Math.max(40, Math.round(start.h - dy));
        isCoord
          ? Object.assign(update, { width: newW, height: newH, left: Math.max(0, Math.round(start.left + dx)), top: Math.max(0, Math.round(start.top + dy)) })
          : Object.assign(update, { width: `${newW}px`, height: `${newH}px` });
      } else if (edge === 'e') {
        isCoord ? (update.width = Math.max(40, Math.round(start.w + dx))) : (update.width = `${Math.max(40, Math.round(start.w + dx))}px`);
      } else if (edge === 'w') {
        const newW = Math.max(40, Math.round(start.w - dx));
        isCoord
          ? Object.assign(update, { width: newW, left: Math.max(0, Math.round(start.left + dx)) })
          : (update.width = `${newW}px`);
      } else if (edge === 's') {
        isCoord ? (update.height = Math.max(40, Math.round(start.h + dy))) : (update.height = `${Math.max(40, Math.round(start.h + dy))}px`);
      } else if (edge === 'n') {
        const newH = Math.max(40, Math.round(start.h - dy));
        isCoord
          ? Object.assign(update, { height: newH, top: Math.max(0, Math.round(start.top + dy)) })
          : (update.height = `${newH}px`);
      }
      onUpdate(containerId, update);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [containerId, onUpdate, edge, isCoord]);
}

function ContainerCard({ container, containers, selectedIds, onSelect, onDelete, onDragStart, onDragOver, onDrop, onWidgetDrop, onUpdateLayout, onUpdateSlot, onUpdateCoord, onGridCellDrop, onSetSelectedGridCell, onMergeCellContainers, selectedGridCell, parentLayout, childIndex, dragState, draggingId, isDragging, coordMode, activeTierId, depth = 0 }) {
  const isSelected = selectedIds ? selectedIds.includes(container.id) : false;
  const isMultiSelected = selectedIds && selectedIds.length > 1 && isSelected;
  const isRoot = container.id === ROOT_CONTAINER_ID;
  const isDragOver = dragState.overId === container.id;
  const htmlId = toHtmlId(container.title);
  const isCoordChild = parentLayout?.layoutType === 'coordinate';

  // Cascade locking from ancestors
  const isEffectivelyLocked = !isRoot && isLockedOrAncestorLocked(containers || [], container.id);

  // Apply breakpoint visibility override
  const isHiddenAtTier = activeTierId && activeTierId !== BASE_TIER_ID
    && (container.breakpointOverrides?.[activeTierId]?.hidden ?? false);

  // Coord drag state — must be declared before any conditional return
  const coordDragRef = React.useRef(null);

  const onCoordMouseDown = React.useCallback((e) => {
    if (!isCoordChild) return;
    if (e.target.closest('.resize-handle')) return;
    // If the mousedown came from a nested child card, let it handle itself
    const targetCard = e.target.closest('.container-card');
    if (targetCard && targetCard !== e.currentTarget) return;

    // Alt key OR reparent mode = skip reposition, let drag handle it
    if (e.altKey || coordMode === 'reparent') return;
    e.preventDefault();
    e.stopPropagation();
    const coord = container.coord || DEFAULT_COORD;
    coordDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: coord.left,
      origTop: coord.top,
    };
    const onMouseMove = (e) => {
      if (!coordDragRef.current) return;
      const dx = e.clientX - coordDragRef.current.startX;
      const dy = e.clientY - coordDragRef.current.startY;
      onUpdateCoord(container.id, {
        left: Math.max(0, Math.round(coordDragRef.current.origLeft + dx)),
        top: Math.max(0, Math.round(coordDragRef.current.origTop + dy)),
      });
    };
    const onMouseUp = () => {
      coordDragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isCoordChild, container, onUpdateCoord]);

  // Apply breakpoint slot overrides for preview
  const effectiveSlot = (activeTierId && activeTierId !== BASE_TIER_ID && container.breakpointOverrides?.[activeTierId]?.slot)
    ? { ...container.slot, ...container.breakpointOverrides[activeTierId].slot }
    : container.slot;

  const coordStyle = isCoordChild
    ? { ...getCoordStyle(container.coord || DEFAULT_COORD), zIndex: (childIndex ?? 0) + 1 }
    : null;

  const slotStyles = isRoot
    ? { card: getPageTypeStyle(container.pageType || 'fit'), body: {} }
    : isCoordChild
      ? { card: coordStyle, body: {} }
      : getSlotStyle(effectiveSlot);

  const cardStyle = slotStyles.card;
  const bodyPaddingStyle = slotStyles.body;
  const layoutStyle = getLayoutStyle(container.layout);
  const onUpdate = isCoordChild ? onUpdateCoord : onUpdateSlot;
  const rNW = useResizeEdge(container.id, onUpdate, 'nw', isCoordChild);
  const rNE = useResizeEdge(container.id, onUpdate, 'ne', isCoordChild);
  const rSW = useResizeEdge(container.id, onUpdate, 'sw', isCoordChild);
  const rSE = useResizeEdge(container.id, onUpdate, 'se', isCoordChild);
  const rN  = useResizeEdge(container.id, onUpdate, 'n',  isCoordChild);
  const rS  = useResizeEdge(container.id, onUpdate, 's',  isCoordChild);
  const rW  = useResizeEdge(container.id, onUpdate, 'w',  isCoordChild);
  const rE  = useResizeEdge(container.id, onUpdate, 'e',  isCoordChild);

  // Early return AFTER all hooks
  if (isHiddenAtTier && !isSelected) return null;

  return (
    <div
      id={htmlId}
      className={`container-card${isSelected && !isMultiSelected ? ' container-card--selected' : ''}${isMultiSelected ? ' container-card--multi-selected' : ''}${isDragOver ? ' container-card--drag-over' : ''}${container.isWidget ? ' container-card--widget' : ''}${isCoordChild ? ' container-card--coord' : ''}${isEffectivelyLocked ? ' container-card--locked' : ''}`}
      style={cardStyle}
      draggable={!isRoot && !isEffectivelyLocked}
      onDragStart={!isRoot && !isEffectivelyLocked ? (e) => {
        if (e.target.closest('.container-card') !== e.currentTarget) return;
        if (isCoordChild && !e.altKey && coordMode !== 'reparent') { e.preventDefault(); return; }
        e.stopPropagation();
        onDragStart(container.id, container.parentId);
      } : undefined}
      onMouseDown={isCoordChild && !isEffectivelyLocked ? onCoordMouseDown : undefined}
      onClick={(e) => { e.stopPropagation(); if (!isEffectivelyLocked) onSelect(container.id, e); }}
      onDragOver={!container.isWidget ? (e) => { e.preventDefault(); e.stopPropagation(); onDragOver(container.id, null, null); } : undefined}
      onDrop={!container.isWidget ? (e) => {
        e.preventDefault(); e.stopPropagation();
        const widgetName = e.dataTransfer.getData('dx-widget-name');
        if (widgetName) {
          onWidgetDrop(container.id, widgetName);
        } else {
          onDrop(container.id, null);
        }
      } : undefined}
      onDragLeave={(e) => { e.stopPropagation(); }}
    >
      <div className="container-card-body" style={{ ...layoutStyle, ...bodyPaddingStyle, minHeight: 0, flex: 1, overflow: 'auto', position: 'relative' }}>
        {container.layout?.layoutType === 'grid' ? (() => {
          const cols = container.layout.gridColumns || 2;
          const rows = container.layout.gridRows || 2;
          const cells = container.layout.gridCells || buildDefaultCells(cols, rows);
          return (
            <>
              <GridEditor layout={container.layout} onUpdateLayout={(update) => onUpdateLayout(container.id, update)} onMergeCellContainers={onMergeCellContainers} />
              {cells.map((cell, cellIdx) => {
                const cellChildIds = cell.childIds || (cell.childId != null ? [cell.childId] : []);
                const cellChildren = cellChildIds.map(id => container.children.find(c => c.id === id)).filter(Boolean);
                const isEmpty = cellChildren.length === 0;
                return (
                  <div
                    key={cell.id}
                    className={`grid-cell-slot${selectedGridCell?.containerId === container.id && selectedGridCell?.cellIdx === cellIdx ? ' grid-cell-slot--selected' : ''}`}
                    style={{ gridColumn: `${cell.colStart} / ${cell.colEnd}`, gridRow: `${cell.rowStart} / ${cell.rowEnd}`, position: 'relative', minHeight: 0, minWidth: 0, overflow: cellChildren.length > 1 ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column' }}
                    onClick={(e) => {
                      if (isEmpty) {
                        e.stopPropagation();
                        onSelect(null, e); // clear container selection
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
            <WidgetPreview
              widgetName={container.widgetName || container.title}
              widgetProps={container.widgetProps || {}}
            />
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
          <div className="resize-handle resize-handle--n" onMouseDown={rN} />
          <div className="resize-handle resize-handle--s" onMouseDown={rS} />
          <div className="resize-handle resize-handle--w" onMouseDown={rW} />
          <div className="resize-handle resize-handle--e" onMouseDown={rE} />
        </>
      )}
    </div>
  );
}

export default ContainerCard;
