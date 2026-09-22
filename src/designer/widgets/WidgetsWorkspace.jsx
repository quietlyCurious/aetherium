// designer/widgets/WidgetsWorkspace.jsx
// The Widgets area: choose, per widget, which of its options the Screens
// designer exposes — label, type, default, group, whether it can be bound,
// and their order.
//
//   left     the widget list; a flag on widgets with nothing that names
//            what they show (no title/label), a pencil on edited ones,
//            and Export
//   options  everything the widget could expose (WidgetOptionsPanel)
//   exposed  what it does expose, editable (ExposedPropertiesEditor)
//   preview  the widget itself plus its details panel, drawn by the same
//            components the Screens editor uses (WidgetPropertiesPreview)
//
// Edits to the open widget are a draft until the title-bar Save, which
// writes them through widgetPropertyDefs (this browser only). Export turns
// every saved list into a new src/widgetProperties.js to commit. Leaving
// the area, or picking another widget, with an unsaved draft asks first,
// the same way the definition areas do.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import HierarchyTree from '../../HierarchyTree';
import { DX_WIDGET_DATA } from '../../widgetData';
import { unsavedChangesStore } from '../../unsavedChangesStore';
import {
  getWidgetPropertyDefs, getShippedWidgetPropertyDefs, isWidgetCustomized,
  saveWidgetPropertyDefs, resetWidgetPropertyDefs, sameDefs, useWidgetPropertyOverrides,
} from './widgetPropertyDefs';
import { WidgetOptionsPanel } from './WidgetOptionsPanel';
import { ExposedPropertiesEditor } from './ExposedPropertiesEditor';
import { WidgetPropertiesPreview } from './WidgetPropertiesPreview';
import { WidgetsExportButtons } from './WidgetsExport';
import './widgets.css';

// Options that say what a widget is showing. A widget exposing none of
// these can't be told apart from its neighbours on a card.
const NAMING_OPTIONS = /^(title|title\.text|subtitle\.text|label|text|caption)$/;
export function exposesNamingOption(defs) {
  return defs.some(d => NAMING_OPTIONS.test(d.name));
}

const WIDGETS = DX_WIDGET_DATA.filter(w => w.assetLevel === 'widget');

// Flags and counts reflect saved lists; the open widget's unsaved draft
// shows on the title-bar Save instead. Each item subscribes to the store
// itself, so a Save redraws the flags without handing the tree new data
// (which would collapse and scroll it back to the top).
function WidgetListItem({ item }) {
  useWidgetPropertyOverrides();
  if (item.assetLevel !== 'widget') {
    return <div className="tree-item"><span className="tree-item-name">{item.name}</span></div>;
  }
  const defs = getWidgetPropertyDefs(item.name);
  const hasList = defs.length > 0;
  const unnamed = hasList && !exposesNamingOption(defs);
  return (
    <div className="tree-item widgets-list-item">
      <span className={`widgets-flag${hasList ? '' : ' widgets-flag--none'}`} style={{ visibility: unnamed || !hasList ? 'visible' : 'hidden' }}
        title={hasList ? 'Nothing exposed says what this widget shows (no title or label)' : 'No properties exposed'} />
      <span className="tree-item-name">{item.name}</span>
      {isWidgetCustomized(item.name) && <span className="widgets-edited" title="Edited here — differs from the shipped list">✎</span>}
      <span className="widgets-count">{hasList ? defs.length : '—'}</span>
    </div>
  );
}

export const WidgetsWorkspace = forwardRef(function WidgetsWorkspace(_props, ref) {
  const overrides = useWidgetPropertyOverrides();
  const [selectedId, setSelectedId] = useState(null);
  const selectedName = WIDGETS.find(w => w.id === selectedId)?.name || null;

  // The open widget's draft, re-seeded whenever the selection or its saved
  // list changes (picking another widget, Save, Reset) — derived state,
  // updated during render rather than in an effect so it's never a render
  // behind.
  const savedDefs = selectedName ? getWidgetPropertyDefs(selectedName) : null;
  const [draftState, setDraftState] = useState({ name: selectedName, saved: savedDefs, draft: savedDefs });
  if (draftState.name !== selectedName || draftState.saved !== savedDefs) {
    setDraftState({ name: selectedName, saved: savedDefs, draft: savedDefs });
  }
  const draft = draftState.name === selectedName ? draftState.draft : savedDefs;
  const setDraft = (next) => setDraftState(s => ({ ...s, draft: typeof next === 'function' ? next(s.draft) : next }));
  const isDirty = !!selectedName && !!draft && !sameDefs(draft, savedDefs);

  useEffect(() => { unsavedChangesStore.setDirty(isDirty); }, [isDirty]);
  useEffect(() => () => unsavedChangesStore.setDirty(false), []);

  const latest = useRef({});
  latest.current = { isDirty, selectedName, draft };
  const confirmDiscardIfDirty = () => {
    if (!latest.current.isDirty) return true;
    return window.confirm(`You have unsaved changes to ${latest.current.selectedName}'s properties. Discard them and continue?`);
  };
  const save = () => {
    const { selectedName: name, draft: defs } = latest.current;
    if (name && defs) saveWidgetPropertyDefs(name, defs);
  };

  useImperativeHandle(ref, () => ({ save, confirmLeave: confirmDiscardIfDirty }));

  const handleSelect = (id) => {
    if (id === selectedId) return;
    const item = DX_WIDGET_DATA.find(w => w.id === id);
    if (item?.assetLevel !== 'widget') return;
    if (!confirmDiscardIfDirty()) return;
    setSelectedId(id);
  };

  const handleReset = () => {
    if (!window.confirm(`Go back to the shipped properties for ${selectedName}? Your saved and unsaved changes to it are dropped.`)) return;
    resetWidgetPropertyDefs(selectedName);
    setDraft(getShippedWidgetPropertyDefs(selectedName));
  };

  const editedCount = Object.keys(overrides).length;

  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>
      <SplitterItem size="210px" minSize="150px" resizable={true}>
        <div className="app-panel widgets-list-panel">
          <p className="panel-label">Widgets</p>
          <div className="widgets-legend">
            <span><span className="widgets-flag" /> no title/label</span>
            <span><span className="widgets-flag widgets-flag--none" /> none exposed</span>
          </div>
          <div className="widgets-list-tree">
            <HierarchyTree
              dataSource={DX_WIDGET_DATA}
              displayExpr="name"
              itemRender={(item) => <WidgetListItem item={item} />}
              selectedId={selectedId}
              onSelect={handleSelect}
              expandAll
            />
          </div>
          <WidgetsExportButtons editedCount={editedCount} blockedBy={isDirty ? 'Save or discard your changes first — Export writes saved lists.' : null} />
        </div>
      </SplitterItem>

      <SplitterItem size="26%" minSize="200px" resizable={true}>
        <div className="app-panel widgets-panel">
          {selectedName
            ? <WidgetOptionsPanel widgetName={selectedName} defs={draft} onChange={setDraft} />
            : <p className="step-instructions widgets-empty">Select a widget to choose which of its options the designer exposes.</p>}
        </div>
      </SplitterItem>

      <SplitterItem resizable={true} minSize="320px">
        <div className="app-panel widgets-panel">
          {selectedName && (
            <ExposedPropertiesEditor
              widgetName={selectedName}
              defs={draft}
              onChange={setDraft}
              isCustomized={isWidgetCustomized(selectedName) || !sameDefs(draft, getShippedWidgetPropertyDefs(selectedName))}
              isDirty={isDirty}
              onReset={handleReset}
            />
          )}
        </div>
      </SplitterItem>

      <SplitterItem size="300px" minSize="220px" resizable={true}>
        <div className="app-panel widgets-panel">
          {selectedName && <WidgetPropertiesPreview widgetName={selectedName} defs={draft} />}
        </div>
      </SplitterItem>
    </Splitter>
  );
});
