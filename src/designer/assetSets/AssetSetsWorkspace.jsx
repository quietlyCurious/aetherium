// designer/assetSets/AssetSetsWorkspace.jsx
// The Asset Sets area: the loaded model's saved asset sets, and an editor
// for the selected one with a live preview of what it resolves to. The
// sets themselves, and how they resolve, are model/assetSets.js.
//
// Same list + editor shell as Data Sources, Entities and Queries
// (DefinitionWorkspace). Unlike those, a set belongs to one industry model,
// so this area loads the title bar's model (useLoadedModel, as Screens and
// the Operator side do) and lists only that model's sets.

import { forwardRef } from 'react';
import { DefinitionWorkspace, UnsavedDot } from '../DefinitionWorkspace';
import { useLoadedModel } from '../../model/useLoadedModel';
import { describeAssetSet, needsStart, resolveAssetSet } from '../../model/assetSets';
import { AssetSetEditor } from './AssetSetEditor';
import { AssetSetsRailIcon } from '../../shell/areaIcons';
import './assetSets.css';

function makeColumns(selectedId, selectedIsDirty) {
  const nameCellRender = ({ data: set }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {set.id === selectedId && selectedIsDirty && <UnsavedDot />}
      <span style={{ color: set.name ? '#222' : '#aaa' }}>{set.name || '(unnamed)'}</span>
    </div>
  );
  const sizeCellRender = ({ data: set }) => (
    needsStart(set)
      ? <span style={{ color: '#888' }} title="Depends on the start asset it's given">per start</span>
      : resolveAssetSet(set).assetIds.length
  );
  return [
    { dataField: 'name', caption: 'Name', cellRender: nameCellRender, minWidth: 120 },
    { caption: 'Assets', cellRender: sizeCellRender, width: 64 },
    { caption: 'Resolves to', calculateCellValue: describeAssetSet, minWidth: 120 },
  ];
}

const AssetSetsWorkspace = forwardRef(function AssetSetsWorkspace({ assetSets, selectedModel, onAdd, onUpdate, onDelete }, ref) {
  const model = useLoadedModel(selectedModel);

  if (model.error) {
    return <div className="data-workspace"><p className="asset-set-note">Couldn't load the model ({model.error}).</p></div>;
  }
  if (!model.loaded) {
    return <div className="data-workspace"><p className="asset-set-note">Loading model…</p></div>;
  }

  return (
    <DefinitionWorkspace
      // Keyed by model so switching models starts with nothing selected.
      key={model.modelId}
      ref={ref}
      items={assetSets.filter(s => s.modelId === model.modelId)}
      title="Asset Sets"
      noun="asset set"
      addTitle="Add asset set"
      noDataText="No asset sets for this model yet. Click + to add one."
      listWidth="360px"
      columns={makeColumns}
      placeholder={{ icon: <span className="asset-set-placeholder-icon"><AssetSetsRailIcon /></span>, title: 'No asset set selected', what: 'an asset set' }}
      onAdd={() => onAdd({ modelId: model.modelId })}
      onDelete={onDelete}
      renderEditor={({ item, editorRef, onDelete: handleDelete, onDirtyChange }) => (
        // Keyed so the preview's chosen start asset resets per set.
        <AssetSetEditor key={item.id} ref={editorRef} set={item} onUpdate={onUpdate} onDelete={handleDelete} onDirtyChange={onDirtyChange} />
      )}
    />
  );
});

export default AssetSetsWorkspace;
