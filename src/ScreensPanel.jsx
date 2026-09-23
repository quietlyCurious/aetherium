// ScreensPanel.jsx
// Left-panel content for the Screens tab: a folder tree of saved pages, with
// native HTML5 drag-and-drop to move a screen into (or out of) a folder.
// Built as its own component rather than stretching the shared DataListGrid —
// the hierarchical folder/expand-collapse/drag-drop needs here are meaningfully
// different from the flat lists Data Sources/Queries/Theme use.
//
// Folders and pages are sorted alphabetically by name (folders keep their own
// relative order among themselves; pages sort within their folder, and
// separately within the root/ungrouped section). A search box filters pages
// by name — while searching, folders with no matching pages are hidden
// entirely, and folders that DO have matches auto-expand so results are
// never hidden behind a collapsed folder.

import React, { useState } from 'react';
import { DEFAULT_SCREEN_SIZE, pageSizeOf, sizeLabel } from './designer/screens/screenSizes';

function sortByName(arr) {
  return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function FolderRow({ folder, isExpanded, onToggle, onRename, onDelete, isDropTarget, onDragOver, onDragLeave, onDrop }) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        background: isDropTarget ? '#e3eaf6' : 'transparent',
        borderRadius: 4,
        userSelect: 'none',
      }}
    >
      <span onClick={onToggle} style={{ fontSize: 10, color: '#888', width: 12, flexShrink: 0 }}>
        {isExpanded ? '▾' : '▸'}
      </span>
      <span onClick={onToggle} style={{ fontSize: 13, flexShrink: 0 }}>📁</span>
      <span onClick={onToggle} style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {folder.name}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onRename(folder); }}
        title="Rename folder"
        style={{ flexShrink: 0, width: 18, height: 18, border: '1px solid #ddd', borderRadius: 4, background: '#fafafa', color: '#666', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 }}
      >✎</button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(folder); }}
        title="Delete folder"
        style={{ flexShrink: 0, width: 18, height: 18, border: '1px solid #e0b0b0', borderRadius: 4, background: '#fff5f5', color: '#c0392b', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}
      >×</button>
    </div>
  );
}

function ScreenRow({ page, isActive, isActiveDirty, indent, onOpen, onDelete, onDragStart, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(page.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        paddingLeft: 10 + indent,
        cursor: 'grab',
        background: isActive ? '#e3eaf6' : 'transparent',
        borderLeft: isActive ? '3px solid #0078d4' : '3px solid transparent',
        borderRadius: 4,
      }}
    >
      {isActiveDirty && (
        <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: '#e08a00', flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 12, color: page.name ? '#222' : '#aaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {page.name || '(untitled)'}
      </span>
      {/* A type usually has more than one screen now — its Card and its
          Tile — so the size is what tells them apart in the list. Page is
          the default and goes unmarked. */}
      {pageSizeOf(page.containers) !== DEFAULT_SCREEN_SIZE && (
        <span className="tree-item-badge" style={{ flexShrink: 0 }}>{sizeLabel(pageSizeOf(page.containers))}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(page.id); }}
        title="Delete screen"
        style={{ flexShrink: 0, width: 18, height: 18, border: '1px solid #e0b0b0', borderRadius: 4, background: '#fff5f5', color: '#c0392b', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}
      >×</button>
    </div>
  );
}

export default function ScreensPanel({
  pages, folders, activePageId, isDirty,
  onOpenPage, onCreatePage, onDeletePage,
  onCreateFolder, onRenameFolder, onDeleteFolder,
  onMovePageToFolder,
}) {
  const [expanded, setExpanded] = useState(() => new Set(folders.map(f => f.id)));
  const [draggingPageId, setDraggingPageId] = useState(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState(undefined); // undefined = none; null = root drop zone
  const [search, setSearch] = useState('');

  const toggleFolder = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (page) => !searchLower || (page.name || '').toLowerCase().includes(searchLower);

  const sortedFolders = sortByName(folders);
  const rootPages = sortByName(pages.filter(p => !p.folderId && matchesSearch(p)));

  const handleDragStart = (pageId) => (e) => {
    setDraggingPageId(pageId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnd = () => {
    setDraggingPageId(null);
    setDropTargetFolderId(undefined);
  };
  const handleDragOverFolder = (folderId) => (e) => {
    e.preventDefault();
    setDropTargetFolderId(folderId);
  };
  const handleDragLeaveFolder = () => setDropTargetFolderId(undefined);
  const handleDropOnFolder = (folderId) => (e) => {
    e.preventDefault();
    if (draggingPageId) onMovePageToFolder(draggingPageId, folderId);
    setDraggingPageId(null);
    setDropTargetFolderId(undefined);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0, gap: 6 }}>
        <p className="panel-label" style={{ margin: 0 }}>Screens</p>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="focus-mode-btn" style={{ fontSize: 11, padding: '2px 8px' }} title="New folder" onClick={onCreateFolder}>📁+</button>
          <button className="focus-mode-btn" style={{ fontSize: 16, padding: '0 6px', lineHeight: 1 }} title="New screen" onClick={onCreatePage}>+</button>
        </div>
      </div>

      <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
        <input
          className="details-input"
          style={{ width: '100%' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search screens…"
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto', paddingTop: 6 }}>
        {pages.length === 0 && folders.length === 0 ? (
          <p style={{ padding: '12px 16px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 }}>
            No screens yet. Click + to add one.
          </p>
        ) : (
          <>
            {sortedFolders.map(folder => {
              const folderPages = sortByName(pages.filter(p => p.folderId === folder.id && matchesSearch(p)));
              if (searchLower && folderPages.length === 0) return null; // hide empty folders while searching
              const isExpanded = searchLower ? true : expanded.has(folder.id); // auto-expand to reveal matches
              return (
                <div key={folder.id}>
                  <FolderRow
                    folder={folder}
                    isExpanded={isExpanded}
                    onToggle={() => toggleFolder(folder.id)}
                    onRename={onRenameFolder}
                    onDelete={onDeleteFolder}
                    isDropTarget={dropTargetFolderId === folder.id}
                    onDragOver={handleDragOverFolder(folder.id)}
                    onDragLeave={handleDragLeaveFolder}
                    onDrop={handleDropOnFolder(folder.id)}
                  />
                  {isExpanded && folderPages.map(page => (
                    <ScreenRow
                      key={page.id}
                      page={page}
                      indent={18}
                      isActive={page.id === activePageId}
                      isActiveDirty={page.id === activePageId && isDirty}
                      onOpen={onOpenPage}
                      onDelete={onDeletePage}
                      onDragStart={handleDragStart(page.id)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              );
            })}

            {/* Root / ungrouped drop zone — dragging a screen here clears its folder */}
            <div
              onDragOver={handleDragOverFolder(null)}
              onDragLeave={handleDragLeaveFolder}
              onDrop={handleDropOnFolder(null)}
              style={{
                minHeight: rootPages.length === 0 && draggingPageId ? 32 : 0,
                background: dropTargetFolderId === null ? '#e3eaf6' : 'transparent',
                borderRadius: 4,
              }}
            >
              {rootPages.map(page => (
                <ScreenRow
                  key={page.id}
                  page={page}
                  indent={0}
                  isActive={page.id === activePageId}
                  isActiveDirty={page.id === activePageId && isDirty}
                  onOpen={onOpenPage}
                  onDelete={onDeletePage}
                  onDragStart={handleDragStart(page.id)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
