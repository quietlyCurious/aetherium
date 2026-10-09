// designer/objectTypes/ObjectTypesWorkspace.jsx
// The Object Types area: the kinds of things screens can be built from by
// dragging — "Equipment", "Car model" — each with where its list comes from
// and the queries that take or return it (see objectTypes.js).
//
// Same list + editor shell as Connections and Asset Sets
// (DefinitionWorkspace).

import { forwardRef } from 'react';
import { DefinitionWorkspace, UnsavedDot } from '../DefinitionWorkspace';
import { connectorFor } from '../../connections/connectionKinds';
import { ObjectTypesRailIcon } from '../../shell/areaIcons';
import { ObjectTypeEditor } from './ObjectTypeEditor';
import { connectionsOf } from './objectTypes';
import './objectTypes.css';

function makeColumns(connections) {
  return (selectedId, selectedIsDirty) => {
    const nameCellRender = ({ data: t }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          {connectionsOf(t).map(id => (
            <span key={id} style={{ width: 7, height: 7, borderRadius: '50%', background: connectorFor(connections.find(c => c.id === id))?.dot || '#bbb' }} />
          ))}
        </span>
        {t.id === selectedId && selectedIsDirty && <UnsavedDot />}
        <span style={{ color: t.name ? '#222' : '#aaa' }}>{t.name || '(unnamed)'}</span>
      </div>
    );
    return [
      { dataField: 'name', caption: 'Name', cellRender: nameCellRender, minWidth: 130 },
      { caption: 'Uses', calculateCellValue: t => (t.references || []).length, width: 56 },
    ];
  };
}

const ObjectTypesWorkspace = forwardRef(function ObjectTypesWorkspace({ objectTypes, connections, queries, onAdd, onUpdate, onDelete, onSaveQuery }, ref) {
  return (
    <DefinitionWorkspace
      ref={ref}
      items={objectTypes}
      title="Object Types"
      noun="object type"
      addTitle="Add object type"
      noDataText="No object types yet. Click + to add one."
      columns={makeColumns(connections)}
      placeholder={{ icon: <span className="ot-placeholder-icon"><ObjectTypesRailIcon /></span>, title: 'No object type selected', what: 'an object type' }}
      onAdd={onAdd}
      onDelete={onDelete}
      renderEditor={({ item, editorRef, onDelete: handleDelete, onDirtyChange }) => (
        <ObjectTypeEditor
          key={item.id}
          ref={editorRef}
          type={item}
          connections={connections}
          queries={queries}
          onUpdate={onUpdate}
          onDelete={handleDelete}
          onDirtyChange={onDirtyChange}
          onSaveQuery={onSaveQuery}
        />
      )}
    />
  );
});

export default ObjectTypesWorkspace;
