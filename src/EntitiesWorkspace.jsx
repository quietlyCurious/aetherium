// EntitiesWorkspace.jsx
// Left-panel grid list of entities + right-panel editor with two modes:
//   - Columns editor (forced for a brand-new entity with no schema yet; also
//     reachable via "Edit Columns" for an existing entity) — reuses the shared
//     ParamListEditor component, since Field+Type is exactly the same shape as
//     a query's input/output list. Keeps its own explicit Save/Cancel.
//   - Data editor — a real DevExtreme DataGrid in BATCH editing mode, so tab
//     moves continuously across cells and across row boundaries, there's no
//     per-row edit/save UI (just a trash-can delete per row), bulk-adding many
//     blank rows at once is supported, and saving is triggered externally via
//     an imperative ref — wired up so the app's top title-bar Save button can
//     commit entity data when this workspace is the active view.
//
// Note: DevExtreme's own batch-mode toolbar may still show its native
// Save/Revert buttons when there are pending edits — that's the grid's default
// safety net alongside the external title-bar Save, not a duplicate we're
// trying to hide. Worth a look once this is live; easy to suppress later if
// it feels redundant in practice.

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Splitter, Item as SplitterItem } from 'devextreme-react/splitter';
import DataGrid, { Column, Editing as GridEditing } from 'devextreme-react/data-grid';
import notify from 'devextreme/ui/notify';
import { SectionTitle } from './FormFields';
import DataListGrid from './DataListGrid';
import ParamListEditor from './ParamListEditor';
import { generateDataId } from './dataModel';
import {
  ENTITY_TYPE_OPTIONS, makeBlankColumn, makeBlankRow, defaultValueForType,
  reconcileRowsForColumns, toDxDataType,
} from './entityModel';

const COLUMN_FIELDS = [
  { key: 'field', label: 'Field', type: 'text',   placeholder: 'columnName', width: 2 },
  { key: 'type',  label: 'Type',  type: 'select', options: ENTITY_TYPE_OPTIONS, width: 1.5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// List grid columns
// ─────────────────────────────────────────────────────────────────────────────

function makeListColumns() {
  const nameCellRender = (cellInfo) => {
    const e = cellInfo.data;
    return <span style={{ color: e.name ? '#222' : '#aaa' }}>{e.name || '(unnamed)'}</span>;
  };
  return [
    { dataField: 'name', caption: 'Name', cellRender: nameCellRender, minWidth: 120 },
    { dataField: 'columns', caption: 'Cols', width: 50, calculateCellValue: (e) => e.columns.length },
    { dataField: 'rows', caption: 'Rows', width: 50, calculateCellValue: (e) => e.rows.length },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity detail editor
// ─────────────────────────────────────────────────────────────────────────────

const EntityEditor = forwardRef(function EntityEditor({ entity, onUpdate, onDelete }, ref) {
  const [draftColumns, setDraftColumns] = useState(() => [...entity.columns]);
  const [draftRows, setDraftRows] = useState(() => [...entity.rows]);
  const [editingColumns, setEditingColumns] = useState(entity.columns.length === 0);
  const [bulkCount, setBulkCount] = useState(5);

  const dataGridRef = useRef(null);
  // Mirrors draftRows synchronously (updated inside each grid event handler,
  // not just via effect) so an async save triggered externally always reads
  // the freshest rows, even if React hasn't re-rendered yet.
  const draftRowsRef = useRef(draftRows);

  // Reset local draft state whenever the SELECTED entity changes (not on every
  // keystroke — those only live in draft state until an explicit Save).
  useEffect(() => {
    setDraftColumns([...entity.columns]);
    setDraftRows([...entity.rows]);
    draftRowsRef.current = [...entity.rows];
    setEditingColumns(entity.columns.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id]);

  const isNewEntity = entity.columns.length === 0;

  // ── Imperative save, triggered by the app's top title-bar Save button ────
  useImperativeHandle(ref, () => ({
    save: () => {
      if (editingColumns) {
        notify('You\u2019re editing columns \u2014 use the Save/Cancel buttons below.', 'warning', 2500);
        return;
      }
      const instance = dataGridRef.current?.instance();
      const commit = () => {
        onUpdate(entity.id, { rows: draftRowsRef.current });
        notify('Entity data saved', 'success', 2000);
      };
      if (instance) {
        instance.saveEditData().then(commit);
      } else {
        commit();
      }
    },
  }), [editingColumns, entity.id, onUpdate]);

  const handleSaveColumns = () => {
    const cleaned = draftColumns.filter(c => c.field.trim() !== '');
    if (cleaned.length === 0) {
      window.alert('Add at least one column before saving.');
      return;
    }
    const newRows = isNewEntity ? [] : reconcileRowsForColumns(draftRows, entity.columns, cleaned);
    onUpdate(entity.id, { columns: cleaned, rows: newRows });
    setDraftRows(newRows);
    draftRowsRef.current = newRows;
    setEditingColumns(false);
  };

  const handleCancelColumns = () => {
    if (isNewEntity) {
      // Never given a real schema — discard the draft entity entirely.
      onDelete(entity.id);
      return;
    }
    setDraftColumns([...entity.columns]);
    setEditingColumns(false);
  };

  const handleAddBulkRows = () => {
    const n = Math.max(1, Math.min(200, Number(bulkCount) || 1));
    const newRows = Array.from({ length: n }, () => makeBlankRow(entity.columns, generateDataId));
    setDraftRows(prev => {
      const next = [...prev, ...newRows];
      draftRowsRef.current = next;
      return next;
    });
  };

  const handleDeleteEntity = () => {
    const confirmed = window.confirm(`Delete "${entity.name || 'this entity'}"? This can't be undone.`);
    if (!confirmed) return;
    onDelete(entity.id);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Editor header */}
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid #e0e0e0', display: 'flex',
        alignItems: 'center', gap: 8, background: '#fafafa', flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>🗂️</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entity.name || '(unnamed entity)'}
        </span>
        {!isNewEntity && (
          <button
            className="focus-mode-btn"
            style={{ color: '#d00', borderColor: '#d00', fontSize: 11, flexShrink: 0 }}
            onClick={handleDeleteEntity}
          >Delete</button>
        )}
      </div>

      {editingColumns ? (
        // ── Columns editor ────────────────────────────────────────────────
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
          <div className="details-section">
            <div className="details-grid">
              <SectionTitle>Entity Columns</SectionTitle>
              <ParamListEditor
                items={draftColumns}
                onChange={setDraftColumns}
                fields={COLUMN_FIELDS}
                addLabel="+ Add Column"
                emptyText="No columns defined."
                newItemFactory={() => makeBlankColumn(generateDataId)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="focus-mode-btn focus-mode-btn--active" onClick={handleSaveColumns}>Save</button>
            <button className="focus-mode-btn" onClick={handleCancelColumns}>Cancel</button>
          </div>
        </div>
      ) : (
        // ── Data editor ────────────────────────────────────────────────────
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexShrink: 0, alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={200}
              value={bulkCount}
              onChange={(e) => setBulkCount(e.target.value)}
              className="details-input"
              style={{ width: 56 }}
            />
            <button className="focus-mode-btn" onClick={handleAddBulkRows}>+ Add Rows</button>
            <button
              className="focus-mode-btn"
              style={{ marginLeft: 'auto' }}
              onClick={() => { setDraftColumns([...entity.columns]); setEditingColumns(true); }}
            >Edit Columns</button>
          </div>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6, flexShrink: 0 }}>
            Tab moves across cells and into the next row. Use the Save button in the title bar to commit changes.
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <DataGrid
              ref={dataGridRef}
              dataSource={draftRows}
              keyExpr="__rowId"
              showBorders={true}
              height="100%"
              onInitNewRow={(e) => {
                e.data.__rowId = generateDataId();
                entity.columns.forEach(col => {
                  if (e.data[col.field] === undefined) e.data[col.field] = defaultValueForType(col.type);
                });
              }}
              onRowInserted={(e) => setDraftRows(prev => {
                const next = [...prev, e.data];
                draftRowsRef.current = next;
                return next;
              })}
              onRowUpdated={(e) => setDraftRows(prev => {
                const next = prev.map(r => r.__rowId === e.key ? { ...r, ...e.data } : r);
                draftRowsRef.current = next;
                return next;
              })}
              onRowRemoved={(e) => setDraftRows(prev => {
                const next = prev.filter(r => r.__rowId !== e.key);
                draftRowsRef.current = next;
                return next;
              })}
            >
              <GridEditing
                mode="batch"
                allowAdding={true}
                allowUpdating={true}
                allowDeleting={true}
                useIcons={true}
                selectTextOnEditStart={true}
              />
              {entity.columns.map(col => (
                <Column key={col.id} dataField={col.field} caption={col.field} dataType={toDxDataType(col.type)} />
              ))}
            </DataGrid>
          </div>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace component
// ─────────────────────────────────────────────────────────────────────────────

const EntitiesWorkspace = forwardRef(function EntitiesWorkspace({ entities, onAdd, onUpdate, onDelete }, ref) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = entities.find(e => e.id === selectedId) || null;
  const columns = makeListColumns();
  const editorRef = useRef(null);

  useImperativeHandle(ref, () => ({
    save: () => editorRef.current?.save(),
  }), []);

  const handleAdd = () => {
    const id = onAdd();
    setSelectedId(id);
  };

  const handleDelete = (id) => {
    onDelete(id);
    if (id === selectedId) setSelectedId(null);
  };

  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>

      {/* ── Left panel: entity list ──────────────────────────────────────── */}
      <SplitterItem size="260px" minSize="180px" resizable={true}>
        <div className="app-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0 }}>
            <p className="panel-label" style={{ margin: 0 }}>Entities</p>
            <button
              className="focus-mode-btn"
              style={{ fontSize: 16, padding: '0 6px', lineHeight: 1 }}
              title="Add entity"
              onClick={handleAdd}
            >+</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
            <DataListGrid
              items={entities}
              columns={columns}
              selectedId={selectedId}
              onSelect={setSelectedId}
              noDataText="No entities yet. Click + to add one."
            />
          </div>
        </div>
      </SplitterItem>

      {/* ── Right panel: detail editor ───────────────────────────────────── */}
      <SplitterItem resizable={true}>
        <div className="app-panel" style={{ height: '100%', overflow: 'hidden' }}>
          {selected ? (
            <EntityEditor ref={editorRef} entity={selected} onUpdate={onUpdate} onDelete={handleDelete} />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="data-workspace-placeholder">
                <div className="data-workspace-placeholder-icon">🗂️</div>
                <div className="data-workspace-placeholder-title" style={{ fontSize: 14 }}>No entity selected</div>
                <div className="data-workspace-placeholder-desc">
                  Select an entity from the list, or click <strong>+</strong> to create a new one.
                </div>
              </div>
            </div>
          )}
        </div>
      </SplitterItem>

    </Splitter>
  );
});

export default EntitiesWorkspace;
