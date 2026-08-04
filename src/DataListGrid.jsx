// DataListGrid.jsx
// Shared DevExtreme DataGrid-based list view for the left panel of definition workspaces
// (Data Sources, Queries, Scripts, ...). Replaces hand-rolled <div> list rows with a real
// grid so search, paging, and multi-column display come for free and stay consistent
// across every workspace that needs a "pick one item from a list" panel.
//
// Visual density is tightened via CSS in App.data.css (.data-list-grid ...) to match
// Aetherium's compact panel style rather than DevExtreme's default grid chrome.

import React from 'react';
import DataGrid, { Column, Selection, SearchPanel, Paging, Scrolling, Toolbar, Item as ToolbarItem } from 'devextreme-react/data-grid';

export default function DataListGrid({
  items,
  columns,           // [{ dataField, caption, width?, minWidth?, cellRender?, calculateCellValue? }]
  keyExpr = 'id',
  selectedId,
  onSelect,
  searchEnabled = true,
  pageSize = 50,
  noDataText = 'No items yet.',
  toolbarExtra,       // optional React node — rendered anchored left, inline with the search box
}) {
  return (
    <DataGrid
      className="data-list-grid"
      dataSource={items}
      keyExpr={keyExpr}
      height="100%"
      showBorders={false}
      showRowLines={false}
      showColumnLines={false}
      rowAlternationEnabled={false}
      hoverStateEnabled={true}
      columnAutoWidth={true}
      noDataText={noDataText}
      selectedRowKeys={selectedId != null ? [selectedId] : []}
      onSelectionChanged={(e) => onSelect(e.selectedRowKeys[0] ?? null)}
      onRowClick={(e) => onSelect(e.key)}
    >
      <Selection mode="single" />
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
}
