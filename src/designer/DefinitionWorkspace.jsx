// designer/DefinitionWorkspace.jsx
// The shell every "list of definitions" area shares — Data Sources,
// Queries and Entities today. Left: a titled list with a + button (and an
// optional toolbar under the title). Right: the selected definition's
// editor, or a placeholder when nothing is selected.
//
// What it owns, so no area has to get it right on its own:
//   - selection, and the "you have unsaved changes" prompt before switching
//     to another item or adding a new one;
//   - the unsaved state itself: whether the open editor has edits is
//     published to unsavedChangesStore, which is what lights the title-bar
//     Save's amber dot — the same store the Configurator's editors use;
//   - the checks App.js runs through the ref: save() for the title-bar
//     Save, and confirmLeave() before navigating to another area, so
//     leaving with unsaved edits asks first instead of silently dropping
//     them.
//
// What an area supplies: its nouns, its list columns, and renderEditor.
// An editor must expose isDirty() and save() on its ref and call
// onDirtyChange as its dirty state flips (useDefinitionDraft does both
// halves of that for simple form editors).

import { forwardRef, useState, useRef, useEffect, useImperativeHandle } from 'react';
import { Splitter, Item as SplitterItem } from 'devextreme-react/splitter';
import DataListGrid from '../DataListGrid';
import { unsavedChangesStore } from '../unsavedChangesStore';

// The amber "unsaved changes" dot for a list row — the same colour as the
// title-bar marker, so one mark means one thing everywhere.
export function UnsavedDot() {
  return <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: '#e08a00', flexShrink: 0 }} />;
}

export const DefinitionWorkspace = forwardRef(function DefinitionWorkspace({
  items,
  title,              // 'Data Sources'
  noun,               // 'data source' — used in the prompts
  addTitle,           // tooltip on the + button
  noDataText,
  listWidth = '280px',
  columns,            // (selectedId, selectedIsDirty) => DataListGrid columns
  listToolbar,        // optional node rendered under the title row
  placeholder,        // { icon, title, what } — what: 'a data source'
  onAdd,
  onDelete,
  renderEditor,       // ({ item, editorRef, onDelete, onDirtyChange }) => editor
}, ref) {
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIsDirty, setSelectedIsDirty] = useState(false);
  const editorRef = useRef(null);

  // A deleted item simply stops being found, which clears the editor.
  const selected = items.find(item => item.id === selectedId) || null;
  const editorIsDirty = !!selected && selectedIsDirty;

  useEffect(() => {
    unsavedChangesStore.setDirty(editorIsDirty);
  }, [editorIsDirty]);
  useEffect(() => () => unsavedChangesStore.setDirty(false), []);

  // Asks the editor directly rather than trusting selectedIsDirty, which
  // trails the editor by one render.
  // TODO: use the Configurator's dialog (customDialog with Save / Discard —
  // see resolveUnsavedChanges in OperatorWorkspace) instead of
  // window.confirm, so a dirty definition can be saved on the way out
  // (editorRef.current.save() is already there to call). Unlike the
  // Configurator this can keep a Cancel, since selection here is ours to
  // hold back. The dialog is async, so confirmLeave — and App.js's
  // navigation guard that calls it — become async too. Tracked in TODO.md.
  const confirmDiscardIfDirty = () => {
    if (!editorRef.current?.isDirty?.()) return true;
    return window.confirm(`You have unsaved changes on this ${noun}. Discard them and continue?`);
  };

  useImperativeHandle(ref, () => ({
    save: () => editorRef.current?.save(),
    confirmLeave: confirmDiscardIfDirty,
  }));

  const handleAdd = () => {
    if (!confirmDiscardIfDirty()) return;
    const id = onAdd();
    setSelectedId(id);
  };

  const handleSelect = (id) => {
    if (id === selectedId) return;
    if (!confirmDiscardIfDirty()) return;
    setSelectedId(id);
  };

  const handleDelete = (id) => {
    const result = onDelete(id);
    if (result !== false && id === selectedId) setSelectedId(null);
    return result;
  };

  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>

      <SplitterItem size={listWidth} minSize="180px" resizable={true}>
        <div className="app-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0 }}>
            <p className="panel-label" style={{ margin: 0 }}>{title}</p>
            <button
              className="focus-mode-btn"
              style={{ fontSize: 16, padding: '0 6px', lineHeight: 1 }}
              title={addTitle}
              onClick={handleAdd}
            >+</button>
          </div>
          {listToolbar}
          <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
            <DataListGrid
              items={items}
              columns={columns(selectedId, selectedIsDirty)}
              selectedId={selectedId}
              onSelect={handleSelect}
              noDataText={noDataText}
            />
          </div>
        </div>
      </SplitterItem>

      <SplitterItem resizable={true}>
        <div className="app-panel" style={{ height: '100%', overflow: 'hidden' }}>
          {selected ? (
            renderEditor({ item: selected, editorRef, onDelete: handleDelete, onDirtyChange: setSelectedIsDirty })
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="data-workspace-placeholder">
                <div className="data-workspace-placeholder-icon">{placeholder.icon}</div>
                <div className="data-workspace-placeholder-title" style={{ fontSize: 14 }}>{placeholder.title}</div>
                <div className="data-workspace-placeholder-desc">
                  Select {placeholder.what} from the list, or click <strong>+</strong> to create a new one.
                </div>
              </div>
            </div>
          )}
        </div>
      </SplitterItem>

    </Splitter>
  );
});
