// designer/assetSets/AssetSetEditor.jsx
// One asset set: its name, its kind (Picked / Rule / Query), the form for
// that kind, and beside it a live preview of what it resolves to.
//
// Edits go into a draft (useDefinitionDraft) until the title-bar Save, like
// the other definition editors. Switching kind keeps the other kind's
// settings in the draft, so flipping back and forth loses nothing.

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { TreeView } from 'devextreme-react/tree-view';
import notify from 'devextreme/ui/notify';
import { useDefinitionDraft } from '../useDefinitionDraft';
import { CURRENT_ASSET_DATA } from '../../model/modelData';
import { DEFAULT_RULE, SET_KINDS, needsStart, suggestStart } from '../../model/assetSets';
import { RuleEditor } from './RuleEditor';
import { AssetSetPreview } from './AssetSetPreview';

function KindSwitch({ value, onChange }) {
  return (
    <div className="asset-set-kinds" role="radiogroup" aria-label="Kind of set">
      {SET_KINDS.map(k => (
        <button
          key={k.value}
          role="radio"
          aria-checked={value === k.value}
          className={`asset-set-kind${value === k.value ? ' asset-set-kind--on' : ''}`}
          disabled={k.disabled}
          title={k.hint}
          onClick={() => onChange(k.value)}
        >
          <span className="asset-set-kind-label">{k.label}</span>
          <span className="asset-set-kind-hint">{k.hint}</span>
        </button>
      ))}
    </div>
  );
}

// A picked set: the model's tree with a checkbox per asset.
function PickedEditor({ assetIds, onChange }) {
  const [search, setSearch] = useState('');
  return (
    <div className="asset-set-section">
      <div className="asset-set-section-title">
        <span className="asset-set-step">✓</span>Choose the assets
        <span className="asset-set-muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>{assetIds.length} chosen</span>
        {assetIds.length > 0 && <button className="focus-mode-btn asset-set-add" onClick={() => onChange([])}>Clear</button>}
      </div>
      <div className="asset-set-picktree">
        <TreeView
          dataSource={CURRENT_ASSET_DATA}
          dataStructure="plain"
          keyExpr="id"
          parentIdExpr="parentId"
          displayExpr="name"
          selectionMode="multiple"
          showCheckBoxesMode="normal"
          selectNodesRecursive={false}
          searchEnabled
          searchValue={search}
          onOptionChanged={e => { if (e.name === 'searchValue') setSearch(e.value); }}
          selectedItemKeys={assetIds}
          onSelectionChanged={e => {
            const keys = e.component.getSelectedNodeKeys();
            if (keys.length !== assetIds.length || keys.some(k => !assetIds.includes(k))) onChange(keys);
          }}
          height="100%"
        />
      </div>
    </div>
  );
}

export const AssetSetEditor = forwardRef(function AssetSetEditor({ set: committed, onUpdate, onDelete, onDirtyChange }, ref) {
  const { draft, setDraft, isDirty } = useDefinitionDraft(committed, onDirtyChange);
  const rule = { ...DEFAULT_RULE, ...draft.rule };
  const takesStart = needsStart(draft);

  // The start asset the preview uses. Until one is chosen, suggest one that
  // gives a non-empty preview.
  const [chosenStart, setChosenStart] = useState(null);
  const suggested = useMemo(
    () => (takesStart && !chosenStart ? suggestStart(draft) : null),
    // Re-suggest only when what the rule looks for changes, not on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [takesStart, chosenStart, draft.id, JSON.stringify(rule.typeIds), rule.depth],
  );
  const start = takesStart ? (chosenStart || suggested) : null;

  useImperativeHandle(ref, () => ({
    isDirty: () => isDirty,
    save: () => {
      onUpdate(committed.id, draft);
      notify(`Saved "${draft.name || 'asset set'}"`, 'success', 2000);
    },
  }), [isDirty, draft, committed.id, onUpdate]);

  const set = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));
  const setRule = (changes) => setDraft(prev => ({ ...prev, rule: { ...DEFAULT_RULE, ...prev.rule, ...changes } }));

  const handleDelete = () => {
    if (!window.confirm(`Delete "${draft.name || 'this asset set'}"?`)) return;
    onDelete(committed.id);
  };

  return (
    <div className="asset-set-editor">
      <div className="asset-set-editor-head">
        <span className="asset-set-editor-title">{draft.name || '(unnamed asset set)'}</span>
        <button className="focus-mode-btn" style={{ color: '#d00', borderColor: '#d00', fontSize: 11 }} onClick={handleDelete}>Delete</button>
      </div>

      <div className="asset-set-body">
        <div className="asset-set-left">
          <div className="asset-set-section">
            <div className="asset-set-form">
              <span className="details-grid-label">Name</span>
              <div className="details-grid-control"><input className="details-input" value={draft.name || ''} placeholder="Worst 5 turbines" onChange={e => set('name', e.target.value)} /></div>
              <span className="details-grid-label">Description</span>
              <div className="details-grid-control"><input className="details-input" value={draft.description || ''} placeholder="Optional" onChange={e => set('description', e.target.value)} /></div>
            </div>
          </div>
          <KindSwitch value={draft.kind} onChange={kind => set('kind', kind)} />
          {draft.kind === 'picked' && (
            <PickedEditor
              assetIds={draft.picked?.assetIds || []}
              onChange={assetIds => setDraft(prev => ({ ...prev, picked: { ...prev.picked, assetIds } }))}
            />
          )}
          {draft.kind === 'rule' && <RuleEditor rule={rule} onChange={setRule} start={start} />}
        </div>

        <div className="asset-set-right">
          <AssetSetPreview set={{ ...draft, rule }} start={start} onStartChange={setChosenStart} />
        </div>
      </div>
    </div>
  );
});
