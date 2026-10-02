// connections/ConnectionsWorkspace.jsx
// The Connections area: the OpHub instances and ThingWorx servers
// whose queries screens can use. A connection is only where to reach a
// source — its queries are browsed live from the Screens Data tab, never
// defined here.
//
// Same list + editor shell as Asset Sets (DefinitionWorkspace): edits go
// into a draft until the title-bar Save. Each kind's own fields come from
// its connector (connectionKinds.js), so a new kind needs no editor code.

import { forwardRef, useImperativeHandle, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import notify from 'devextreme/ui/notify';
import { DefinitionWorkspace, UnsavedDot } from '../designer/DefinitionWorkspace';
import { useDefinitionDraft } from '../designer/useDefinitionDraft';
import { Field, TxtInput, InfoNote, SectionTitle } from '../FormFields';
import { ConnectionsRailIcon } from '../shell/areaIcons';
import { CONNECTOR_LIST, CONNECTORS, connectorFor, connectionLabel } from './connectionKinds';
import { testConnection } from './useQueryCatalog';

function TestResult({ result }) {
  if (!result) return null;
  const ok = result.status === 'ok';
  return (
    <div style={{
      gridColumn: '1 / -1', marginTop: 6, padding: '6px 10px', borderRadius: 4, fontSize: 11,
      background: ok ? '#e8f5e9' : result.status === 'error' ? '#fdecea' : '#f5f5f5',
      color: ok ? '#2e7d32' : result.status === 'error' ? '#c62828' : '#666',
    }}>
      {result.status === 'testing' ? 'Testing…' : result.message}
    </div>
  );
}

const ConnectionEditor = forwardRef(function ConnectionEditor({ connection: committed, savedCopies, usedCount, onUpdate, onDelete, onDirtyChange }, ref) {
  const { draft, setDraft, isDirty } = useDefinitionDraft(committed, onDirtyChange);
  const [test, setTest] = useState(null);
  const connector = connectorFor(draft);

  useImperativeHandle(ref, () => ({
    isDirty: () => isDirty,
    save: () => {
      onUpdate(committed.id, draft);
      notify(`Saved "${connectionLabel(draft)}"`, 'success', 2000);
    },
  }), [isDirty, draft, committed.id, onUpdate]);

  const set = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));

  // Switching kind keeps the name and proxy URL and replaces the old kind's
  // own fields with the new kind's defaults. The old fields are set to
  // undefined rather than left out, because saving merges into the stored
  // connection (and undefined fields aren't written to storage).
  const changeKind = (kind) => setDraft(prev => ({
    ...Object.fromEntries(Object.keys(prev).map(key => [key, undefined])),
    ...CONNECTORS[kind].defaults,
    id: prev.id, name: prev.name, kind,
    ...(prev.proxyUrl ? { proxyUrl: prev.proxyUrl } : {}),
  }));

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      const { count, noun, groups } = await testConnection(draft);
      const inGroups = groups ? ` in ${groups} group${groups === 1 ? '' : 's'}` : '';
      setTest({ status: 'ok', message: `✓ Connected — ${count} ${noun}${inGroups}` });
    } catch (err) {
      setTest({ status: 'error', message: err.message });
    }
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete "${connectionLabel(committed)}"?`)) return;
    if (onDelete(committed.id) === false) {
      window.alert('This connection can\'t be deleted: screens use its queries. Remove those query instances from their pages first.');
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 8, background: '#fafafa', flexShrink: 0 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: connector?.dot || '#bbb', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connectionLabel(draft)}
        </span>
        <button className="focus-mode-btn" style={{ color: '#d00', borderColor: '#d00', fontSize: 11, flexShrink: 0 }} onClick={handleDelete}>
          Delete
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>General</SectionTitle>
            <Field label="Name">
              <TxtInput value={draft.name} placeholder={`e.g. ${connector?.shortLabel || 'OpHub'} · demo server`} onChange={v => set('name', v)} />
            </Field>
            <Field label="Kind">
              <SelectBox
                dataSource={CONNECTOR_LIST}
                valueExpr="kind"
                displayExpr="label"
                value={draft.kind}
                onValueChanged={e => changeKind(e.value)}
                stylingMode="outlined"
                width="100%"
                height={24}
              />
            </Field>
          </div>
        </div>

        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Connection</SectionTitle>
            {(connector?.fields || []).map(f => (
              <Field key={f.key} label={f.label}>
                <TxtInput value={draft[f.key]} placeholder={f.placeholder} mono={f.mono} onChange={v => set(f.key, v)} />
              </Field>
            ))}
            <div style={{ gridColumn: '1 / -1', paddingTop: 4 }}>
              <button className="focus-mode-btn" style={{ fontSize: 11 }} onClick={runTest} disabled={test?.status === 'testing'}>
                Test connection
              </button>
            </div>
            <TestResult result={test} />
            <InfoNote>
              Requests go through the local proxy, which handles sign-in and CORS. Test uses the
              settings above, saved or not.
            </InfoNote>
          </div>
        </div>

        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Used by screens</SectionTitle>
            <InfoNote>
              {savedCopies.length === 0
                ? `No screen uses this connection's ${connector?.itemNoun || 'queries'} yet. Add them from the Screens Data tab.`
                : `${savedCopies.length} saved ${savedCopies.length === 1 ? 'query' : 'queries'}, ${usedCount} used on pages: ${savedCopies.map(q => q.name).join(', ')}`}
            </InfoNote>
          </div>
        </div>
      </div>
    </div>
  );
});

function makeColumns(selectedId, selectedIsDirty) {
  const nameCellRender = ({ data: c }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: connectorFor(c)?.dot || '#bbb', flexShrink: 0 }} />
      {c.id === selectedId && selectedIsDirty && <UnsavedDot />}
      <span style={{ color: c.name ? '#222' : '#aaa' }}>{connectionLabel(c)}</span>
    </div>
  );
  return [
    { dataField: 'name', caption: 'Name', cellRender: nameCellRender, minWidth: 130 },
    { caption: 'Kind', calculateCellValue: c => connectorFor(c)?.shortLabel || c.kind, width: 80 },
  ];
}

const ConnectionsWorkspace = forwardRef(function ConnectionsWorkspace({ connections, queries, queryInstances, onAdd, onUpdate, onDelete }, ref) {
  return (
    <DefinitionWorkspace
      ref={ref}
      items={connections}
      title="Connections"
      noun="connection"
      addTitle="Add connection"
      noDataText="No connections yet. Click + to add one."
      columns={makeColumns}
      placeholder={{ icon: <span style={{ display: 'inline-flex', width: 28, height: 28, color: '#999' }}><ConnectionsRailIcon /></span>, title: 'No connection selected', what: 'a connection' }}
      onAdd={onAdd}
      onDelete={onDelete}
      renderEditor={({ item, editorRef, onDelete: handleDelete, onDirtyChange }) => {
        const savedCopies = queries.filter(q => q.connectionId === item.id);
        const usedCount = savedCopies.filter(q => queryInstances.some(qi => qi.queryId === q.id)).length;
        return (
          // Keyed so a test result doesn't carry over to another connection.
          <ConnectionEditor
            key={item.id}
            ref={editorRef}
            connection={item}
            savedCopies={savedCopies}
            usedCount={usedCount}
            onUpdate={onUpdate}
            onDelete={handleDelete}
            onDirtyChange={onDirtyChange}
          />
        );
      }}
    />
  );
});

export default ConnectionsWorkspace;
