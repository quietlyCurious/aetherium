// DataListGrid.jsx
// Shared DevExtreme DataGrid-based list view for the left panel of definition workspaces
// (Data Sources, Queries, Entities, via designer/DefinitionWorkspace), the Theme
// lists, and the Configurator's Types tab and Details grids. Replaces hand-rolled <div> list rows with a real
// grid so search, paging, and multi-column display come for free and stay consistent
// across every workspace that needs a "pick one item from a list" panel.
//
// Visual density is tightened via CSS in App.data.css (.data-list-grid ...) to match
// Aetherium's compact panel style rather than DevExtreme's default grid chrome.

import React from 'react';
import DataGrid, { Column, Selection, SearchPanel, Paging, Scrolling, Toolbar, Item as ToolbarItem, RowDragging } from 'devextreme-react/data-grid';

const DataListGrid = React.forwardRef(function DataListGrid({
  items,
  columns,           // [{ dataField, caption, width?, minWidth?, cellRender?, calculateCellValue? }]
  keyExpr = 'id',
  selectedId,
  onSelect,
  searchEnabled = true,
  pageSize = 50,
  noDataText = 'No items yet.',
  toolbarExtra,       // optional React node — rendered anchored left, inline with the search box
  reorderable = false, // opt-in — enables drag-to-reorder rows via the built-in drag handle
  onReorder,          // (newItemsArray) => void — called with the full items array in its new order
  dragColumnWidth,    // optional — narrower drag-handle column when reorderable (DevExtreme's default is fairly wide for tight side panels)
  columnAutoWidth = true, // opt-out — false lets columns without a fixed width share the leftover space (ellipsis-truncated) instead of sizing to content, which can force a horizontal scrollbar in narrow panels
}, ref) {
  // Stable identity: RowDragging's onReorder is a DataGrid option, and a
  // new function on every render makes the grid repaint all its rows —
  // which, for a grid with interactive cells (a SelectBox, say), closes
  // anything open in them whenever the parent re-renders. Reads the latest
  // items/onReorder through a ref instead.
  const reorderLatestRef = React.useRef({ items, onReorder, keyExpr });
  reorderLatestRef.current = { items, onReorder, keyExpr };
  const handleReorder = React.useCallback((e) => {
    const { items: currentItems, onReorder: currentOnReorder, keyExpr: key } = reorderLatestRef.current;
    const visibleRows = e.component.getVisibleRows();
    const newItems = [...currentItems];
    const toIndex = newItems.findIndex(item => item[key] === visibleRows[e.toIndex].data[key]);
    const fromIndex = newItems.findIndex(item => item[key] === e.itemData[key]);
    newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, e.itemData);
    currentOnReorder?.(newItems);
  }, []);

  // One click raises both onSelectionChanged and onRowClick, so without
  // this every click reached onSelect twice. Harmless for a handler that
  // just sets state, but one that asks first — "you have unsaved changes,
  // discard them?" — asked twice. Passes each choice on once: a repeat of
  // the same key within the same event turn is dropped.
  const lastSelectRef = React.useRef(null);
  const emitSelect = (key) => {
    if (lastSelectRef.current && lastSelectRef.current.key === key) return;
    const marker = { key };
    lastSelectRef.current = marker;
    setTimeout(() => { if (lastSelectRef.current === marker) lastSelectRef.current = null; }, 0);
    onSelect(key);
  };

  return (
    <DataGrid
      ref={ref}
      className="data-list-grid"
      dataSource={items}
      keyExpr={keyExpr}
      height="100%"
      showBorders={false}
      showRowLines={false}
      showColumnLines={false}
      rowAlternationEnabled={false}
      hoverStateEnabled={true}
      columnAutoWidth={columnAutoWidth}
      noDataText={noDataText}
      selectedRowKeys={selectedId != null ? [selectedId] : []}
      onSelectionChanged={(e) => emitSelect(e.selectedRowKeys[0] ?? null)}
      onRowClick={(e) => emitSelect(e.key)}
    >
      <Selection mode="single" />
      {reorderable && <RowDragging allowReordering={true} onReorder={handleReorder} />}
      {searchEnabled && <SearchPanel visible width="auto" placeholder="Search…" />}
      {toolbarExtra && (
        <Toolbar>
          <ToolbarItem location="before" render={() => toolbarExtra} />
          <ToolbarItem name="searchPanel" location="after" />
        </Toolbar>
      )}
      <Scrolling mode="virtual" />
      <Paging defaultPageSize={pageSize} />
      {reorderable && dragColumnWidth && <Column type="drag" width={dragColumnWidth} minWidth={dragColumnWidth} />}
      {columns.map((col, i) => (
        <Column
          // Computed columns (calculateCellValue / cellRender only) have no
          // dataField, so fall back to the caption for a unique key.
          key={col.dataField ?? col.caption ?? i}
          dataField={col.dataField}
          caption={col.caption}
          width={col.width}
          minWidth={col.minWidth ?? 80}
          cellRender={col.cellRender}
          calculateCellValue={col.calculateCellValue}
        />
      ))}
    </DataGrid>
  );
});

export default DataListGrid;
