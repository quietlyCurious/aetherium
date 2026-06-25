import React, { useState } from 'react';
import { ROOT_CONTAINER_ID } from './containerModel';
import { isDescendant, findContainerById } from './containerTree';

function PageVisualsTreeNode({ node, depth, selectedId, onSelect, dragState, onDragStart, onDragOver, onDrop, onDragEnd, parentLayout, childIndex, onToggleLock }) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedId === node.id;
  const isDragOver = dragState.overId === node.id;
  const isDragBefore = dragState.beforeId === node.id;
  const isRoot = node.id === ROOT_CONTAINER_ID;
  const indent = depth * 16;
  const isCoordChild = parentLayout?.layoutType === 'coordinate';

  return (
    <div className="pvt-node-wrapper">
      {/* Drop zone: before this node */}
      {!isRoot && (
        <div
          className={`pvt-drop-between${isDragBefore ? ' pvt-drop-between--active' : ''}`}
          style={{ marginLeft: indent }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(null, node.id); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(null, node.id); }}
        />
      )}

      {/* The node row */}
      <div
        className={`pvt-node${isSelected ? ' pvt-node--selected' : ''}${isDragOver ? ' pvt-node--drag-over' : ''}`}
        style={{ paddingLeft: indent + 4 }}
        onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!node.isWidget) onDragOver(node.id, null); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (!node.isWidget) onDrop(node.id, null); }}
      >
        {/* Expand/collapse arrow */}
        <span
          className="pvt-arrow"
          onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}
          style={{ visibility: node.children?.length > 0 ? 'visible' : 'hidden' }}
        >
          {expanded ? '▾' : '▸'}
        </span>

        {/* Drag handle */}
        {!isRoot && (
          <span
            className="pvt-drag-handle"
            draggable
            onDragStart={(e) => { e.stopPropagation(); onDragStart(node.id); }}
            onDragEnd={onDragEnd}
          >⠿</span>
        )}

        <span className="pvt-label" style={{ opacity: node.locked ? 0.5 : 1 }}>{node.title}</span>
        {isCoordChild && (
          <span className="pvt-z-badge" title="Z-order (drag to reorder)">z{childIndex + 1}</span>
        )}
        {!isRoot && (
          <span
            className="pvt-lock-btn"
            title={node.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => { e.stopPropagation(); onToggleLock && onToggleLock(node.id); }}
          >
            {node.locked ? '🔒' : '🔓'}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && node.children?.length > 0 && (
        <div className="pvt-children">
          {node.children.map((child, cidx) => (
            <PageVisualsTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              dragState={dragState}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              parentLayout={node.layout}
              childIndex={cidx}
              onToggleLock={onToggleLock}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PageVisualsTabWrapper({ containers, selectedContainerId, onSelect, onReparent, onToggleLock }) {
  const [dragState, setDragState] = useState({ draggingId: null, overId: null, beforeId: null });

  const handleDragStart = (id) => {
    setDragState({ draggingId: id, overId: null, beforeId: null });
  };

  const handleDragOver = (overId, beforeId) => {
    const { draggingId } = dragState;
    if (!draggingId) return;
    if (overId && (overId === draggingId || isDescendant(containers, draggingId, overId))) return;
    // Block dropping onto a widget
    if (overId) {
      const target = findContainerById(containers, overId);
      if (target?.isWidget) return;
    }
    setDragState(s => ({ ...s, overId, beforeId }));
  };

  const handleDrop = (overId, beforeId) => {
    const { draggingId } = dragState;
    setDragState({ draggingId: null, overId: null, beforeId: null });
    if (!draggingId) return;
    if (overId && (overId === draggingId || isDescendant(containers, draggingId, overId))) return;
    // Block dropping onto a widget
    if (overId) {
      const target = findContainerById(containers, overId);
      if (target?.isWidget) return;
    }
    onReparent(draggingId, overId, beforeId);
  };

  const handleDragEnd = () => {
    setDragState({ draggingId: null, overId: null, beforeId: null });
  };

  return (
    <div className="pvt-root">
      {containers.map(node => (
        <PageVisualsTreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedContainerId}
          onSelect={onSelect}
          dragState={dragState}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onToggleLock={onToggleLock}
        />
      ))}
    </div>
  );
}

export default PageVisualsTabWrapper;
export { PageVisualsTreeNode };
