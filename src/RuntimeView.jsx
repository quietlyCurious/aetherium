// RuntimeView.jsx
// A dedicated, chrome-free render of a single saved page — opened in its own
// browser tab via the title bar's Launch button, so page content can be
// tested/viewed full-viewport without any of the editor's own UI around it.
//
// Reuses ContainerCard directly (rather than writing a second, simpler
// renderer) so this is guaranteed to look pixel-identical to the real canvas
// — every editing-related prop below is just a safe no-op, since nothing in
// a read-only view ever triggers selection, drag, or resize.

import React from 'react';
import ContainerCard from './ContainerCard';
import { loadPagesAndFolders } from './pagesStorage';
import { BASE_TIER_ID } from './containerModel';

const NOOP = () => {};

export default function RuntimeView({ pageId }) {
  const { pages } = loadPagesAndFolders();
  const page = pages.find(p => p.id === pageId);

  if (!page) {
    return (
      <div style={{
        width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'sans-serif', color: '#888', fontSize: 14,
      }}>
        Screen not found. It may have been deleted, or this link is out of date.
      </div>
    );
  }

  const containers = page.containers || [];

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'auto', position: 'relative' }}>
      {containers.map(c => (
        <ContainerCard
          key={c.id}
          container={c}
          containers={containers}
          selectedIds={[]}
          onSelect={NOOP}
          onDelete={NOOP}
          onDragStart={NOOP}
          onDragOver={NOOP}
          onDrop={NOOP}
          onWidgetDrop={NOOP}
          onUpdateLayout={NOOP}
          onUpdateSlot={NOOP}
          onUpdateCoord={NOOP}
          onGridCellDrop={NOOP}
          onSetSelectedGridCell={NOOP}
          onMergeCellContainers={NOOP}
          selectedGridCell={null}
          dragState={{}}
          draggingId={null}
          isDragging={false}
          coordMode="reposition"
          activeTierId={BASE_TIER_ID}
          snapEnabled={false}
        />
      ))}
    </div>
  );
}
