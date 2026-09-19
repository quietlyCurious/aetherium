// DataListGrid.jsx
// Shared DevExtreme DataGrid-based list view for the left panel of definition workspaces
// (Data Sources, Queries, Scripts, ...). Replaces hand-rolled <div> list rows with a real
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
  columnAutoWidth = true, // opt-out — false lets columns without a fixed width share the leftover space (ellipsis-truncated) instead of sizing to content, which can force a horizontal scrollbar in narrow panels
}, ref) {
  const handleReorder = (e) => {
    const visibleRows = e.component.getVisibleRows();
    const newItems = [...items];
    const toIndex = newItems.findIndex(item => item[keyExpr] === visibleRows[e.toIndex].data[keyExpr]);
    const fromIndex = newItems.findIndex(item => item[keyExpr] === e.itemData[keyExpr]);
    newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, e.itemData);
    onReorder(newItems);
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
      onSelectionChanged={(e) => onSelect(e.selectedRowKeys[0] ?? null)}
      onRowClick={(e) => onSelect(e.key)}
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
      {columns.map(col => (
        <Column
          key={col.dataField}
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
