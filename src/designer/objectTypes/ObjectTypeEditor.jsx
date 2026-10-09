// designer/objectTypes/ObjectTypeEditor.jsx
// One object type, in three short sections:
//   1. What it is            name and description
//   2. Where the list comes from
//                            a connection, then a query (key + display
//                            field) or, for ThingWorx, "its Things"
//   3. Queries that use it   references: inputs that take the key, outputs
//                            that return it, or "each object is a Thing";
//                            suggestions (from the live catalog) sit under
//                            them, shown only when there are some
//
// Edits go into a draft until the title-bar Save, like the other definition
// editors. Picking a query saves a copy of it straight away (onSaveQuery) —
// the same saved copy the Data tab's + Add makes — so references can point
// at it by id.

import { forwardRef, useImperativeHandle, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import notify from 'devextreme/ui/notify';
import { useDefinitionDraft } from '../useDefinitionDraft';
import { useQueryCatalog } from '../../connections/useQueryCatalog';
import { connectorFor, connectionLabel } from '../../connections/connectionKinds';
import { generateDataId } from '../../dataModel';
import { QuerySourcePicker } from './QuerySourcePicker';
import { listObjects, suggestReferences, referenceKey, queryLabel } from './objectTypes';

const box = { stylingMode: 'outlined', height: 24 };

const SIDE_LABELS = { input: 'input', output: 'output', thing: 'is a Thing' };

function Section({ n, title, hint, children }) {
  return (
    <div className="ot-section">
      <div className="ot-section-title"><span className="ot-n">{n}</span>{title}{hint && <span className="ot-hint">{hint}</span>}</div>
      <div className="ot-section-body">{children}</div>
    </div>
  );
}

function Dot({ connection }) {
  return <span className="ot-dot" style={{ background: connectorFor(connection)?.dot || '#bbb' }} />;
}

// ── 2. Listed by ─────────────────────────────────────────────────────────────

// One of the list query's inputs. Long values (pasted JSON) get a text area.
function ListInput({ input, value, onChange }) {
  const placeholder = input.defaultValue !== null && input.defaultValue !== undefined && input.defaultValue !== ''
    ? `default: ${input.defaultValue}` : `${input.type}${input.optional ? ', optional' : ''}`;
  const long = String(value).length > 60 || /json/i.test(input.name);
  return (
    <>
      <label title={input.name}>{input.name}</label>
      {long ? (
        <textarea className="details-input ot-textarea" value={value} placeholder={placeholder} rows={3} onChange={e => onChange(e.target.value)} />
      ) : (
        <input className="details-input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      )}
    </>
  );
}

function ListedBy({ draft, setListedBy, connections, queries, catalog, onSaveQuery }) {
  const { listedBy } = draft;
  const connection = connections.find(c => c.id === listedBy.connectionId);
  const entry = catalog.entries.find(e => e.connection.id === listedBy.connectionId);
  const listQuery = queries.find(q => q.id === listedBy.queryId);
  const outputs = (listQuery?.outputs || []).map(o => o.name);
  const [preview, setPreview] = useState(null);

  const runPreview = async () => {
    setPreview({ status: 'loading' });
    try {
      const objects = await listObjects(draft, { connections, queries });
      setPreview({ status: 'ok', objects });
    } catch (err) {
      setPreview({ status: 'error', error: err.message });
    }
  };

  const extraOptions = entry?.lazy ? [{ value: 'things', label: 'Its Things (each object is a Thing)' }] : [];

  return (
    <>
      <div className="ot-grid">
        <label>Connection</label>
        <SelectBox
          {...box}
          dataSource={connections.map(c => ({ id: c.id, label: connectionLabel(c) }))}
          valueExpr="id" displayExpr="label"
          value={listedBy.connectionId}
          placeholder="Choose a connection…"
          onValueChanged={e => setListedBy({ connectionId: e.value, source: 'query', queryId: null, sourceKey: null, keyField: '', displayField: '', nameFilter: '' })}
        />
        <label>List</label>
        {listedBy.source === 'things' ? (
          <div className="ot-pair">
            <span className="ot-chip">Its Things</span>
            <button className="focus-mode-btn ot-small" onClick={() => setListedBy({ source: 'query' })}>Use a service instead</button>
          </div>
        ) : (
          <QuerySourcePicker
            entry={listedBy.connectionId ? entry : null}
            onLoadGroup={(key) => catalog.loadGroup(listedBy.connectionId, key)}
            value={listedBy.sourceKey}
            extraOptions={extraOptions}
            onPickExtra={() => setListedBy({ source: 'things', queryId: null, sourceKey: null, keyField: '', displayField: '' })}
            onPick={(item) => {
              const queryId = onSaveQuery(listedBy.connectionId, item);
              const names = (item.definition.outputs || []).map(o => o.name);
              setListedBy({ source: 'query', queryId, sourceKey: item.sourceKey, keyField: names[0] || '', displayField: '', inputValues: {} });
            }}
            placeholder="Choose the query that lists them…"
          />
        )}
        {listedBy.source === 'things' ? (
          <>
            <label>Name contains</label>
            <input className="details-input" value={listedBy.nameFilter || ''} placeholder="All Things" onChange={e => setListedBy({ nameFilter: e.target.value })} />
          </>
        ) : listQuery && (
          <>
            <label>Key field</label>
            <SelectBox {...box} dataSource={outputs} value={listedBy.keyField || null} placeholder="Which column identifies one?" onValueChanged={e => setListedBy({ keyField: e.value || '' })} />
            <label>Display field</label>
            <SelectBox {...box} dataSource={['', ...outputs]} value={listedBy.displayField || ''} displayExpr={v => (v ? v : '(same as key)')} onValueChanged={e => setListedBy({ displayField: e.value || '' })} />
            {(listQuery.inputs || []).length > 0 && (
              <>
                <div className="ot-grid-sub">List inputs <span className="ot-muted">— blank uses the input's default</span></div>
                {listQuery.inputs.map(input => (
                  <ListInput
                    key={input.name}
                    input={input}
                    value={listedBy.inputValues?.[input.name] ?? ''}
                    onChange={v => setListedBy({ inputValues: { ...(listedBy.inputValues || {}), [input.name]: v } })}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
      {connection && (listedBy.source === 'things' || listQuery) && (
        <div className="ot-preview">
          <button className="focus-mode-btn ot-small" onClick={runPreview} disabled={preview?.status === 'loading'}>Preview the list</button>
          {preview?.status === 'loading' && <span className="ot-muted">Loading…</span>}
          {preview?.status === 'error' && <span className="ot-error">{preview.error}</span>}
          {preview?.status === 'ok' && (
            <span className="ot-muted">
              {preview.objects.length} object{preview.objects.length === 1 ? '' : 's'}
              {preview.objects.length > 0 && `: ${preview.objects.slice(0, 6).map(o => (o.label === o.key ? o.label : `${o.label} (${o.key})`)).join(', ')}${preview.objects.length > 6 ? '…' : ''}`}
            </span>
          )}
        </div>
      )}
    </>
  );
}

// ── 3. References ────────────────────────────────────────────────────────────

function AddReference({ connections, catalog, onAdd, onSaveQuery }) {
  const [connectionId, setConnectionId] = useState(null);
  const [item, setItem] = useState(null);
  const [field, setField] = useState(null);
  const entry = catalog.entries.find(e => e.connection.id === connectionId);
  const fields = item ? [
    ...(item.definition.inputs || []).map(i => ({ id: `input:${i.name}`, label: `${i.name}  (input)` })),
    ...(item.definition.outputs || []).map(o => ({ id: `output:${o.name}`, label: `${o.name}  (output)` })),
  ] : [];
  const reset = () => { setItem(null); setField(null); };

  const add = () => {
    const [side, ...rest] = field.split(':');
    const queryId = onSaveQuery(connectionId, item);
    onAdd({ connectionId, side, queryId, sourceKey: item.sourceKey, field: rest.join(':') });
    reset();
  };

  return (
    <div className="ot-add">
      <SelectBox
        {...box}
        dataSource={connections.map(c => ({ id: c.id, label: connectionLabel(c) }))}
        valueExpr="id" displayExpr="label"
        value={connectionId}
        placeholder="Connection…"
        width={170}
        onValueChanged={e => { setConnectionId(e.value); reset(); }}
      />
      <div className="ot-add-query">
        {connectionId && (
          <QuerySourcePicker
            entry={entry}
            onLoadGroup={(key) => catalog.loadGroup(connectionId, key)}
            value={item?.sourceKey || null}
            extraOptions={entry?.lazy ? [{ value: 'thing', label: 'Each object is a Thing here' }] : []}
            onPickExtra={() => { onAdd({ connectionId, side: 'thing', queryId: null, sourceKey: null, field: 'Thing name' }); reset(); }}
            onPick={(picked) => { setItem(picked); setField(null); }}
          />
        )}
      </div>
      {item && (
        <SelectBox {...box} dataSource={fields} valueExpr="id" displayExpr="label" value={field} placeholder="Which field?" width={170} onValueChanged={e => setField(e.value)} />
      )}
      <button className="focus-mode-btn ot-small" disabled={!item || !field} onClick={add}>Add</button>
    </div>
  );
}

function References({ draft, setDraft, connections, queries, catalog, onSaveQuery }) {
  const references = draft.references || [];
  const suggestions = suggestReferences(draft, catalog.entries);

  const addReference = (ref) => {
    const withId = { id: generateDataId(), ...ref };
    if (references.some(r => referenceKey(r) === referenceKey(withId))) {
      notify('That reference is already there.', 'warning', 2000);
      return;
    }
    setDraft(prev => ({ ...prev, references: [...(prev.references || []), withId] }));
  };
  const remove = (id) => setDraft(prev => ({ ...prev, references: prev.references.filter(r => r.id !== id) }));
  const accept = (s) => {
    const queryId = onSaveQuery(s.connectionId, s.item);
    addReference({ connectionId: s.connectionId, side: s.side, queryId, sourceKey: s.sourceKey, field: s.field });
  };
  const dismiss = (s) => setDraft(prev => ({ ...prev, dismissed: [...(prev.dismissed || []), s.key] }));

  return (
    <>
      {references.length === 0 ? (
        <div className="ot-muted ot-empty">None yet. Add the queries that take or return this type's key, or accept a suggestion below.</div>
      ) : (
        <table className="ot-table">
          <tbody>
            {references.map(r => {
              const connection = connections.find(c => c.id === r.connectionId);
              const query = queries.find(q => q.id === r.queryId);
              return (
                <tr key={r.id}>
                  <td className="ot-src"><Dot connection={connection} />{connection ? connectionLabel(connection) : '(missing connection)'}</td>
                  <td>{r.side === 'thing' ? <span className="ot-muted">every object, as a Thing</span> : <><b>{queryLabel(query)}</b> · {r.field}</>}</td>
                  <td><span className={`ot-side ot-side--${r.side}`}>{SIDE_LABELS[r.side]}</span></td>
                  <td className="ot-right"><button className="ot-x" title="Remove" onClick={() => remove(r.id)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <AddReference connections={connections} catalog={catalog} onAdd={addReference} onSaveQuery={onSaveQuery} />
      {suggestions.length > 0 && (
        <div className="ot-suggestions">
          <div className="ot-sub">Suggested ({suggestions.length})</div>
          <table className="ot-table">
            <tbody>
              {suggestions.map(s => {
                const connection = connections.find(c => c.id === s.connectionId);
                const d = s.item.definition;
                return (
                  <tr key={s.key} className="ot-suggested">
                    <td className="ot-src"><Dot connection={connection} />{connectionLabel(connection)}</td>
                    <td><b>{queryLabel(d)}</b> · {s.field}<div className="ot-why">{s.why}</div></td>
                    <td><span className={`ot-side ot-side--${s.side}`}>{SIDE_LABELS[s.side]}</span></td>
                    <td className="ot-right">
                      <button className="focus-mode-btn ot-small ot-accept" onClick={() => accept(s)}>Accept</button>
                      <button className="focus-mode-btn ot-small" onClick={() => dismiss(s)}>Dismiss</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── The editor ───────────────────────────────────────────────────────────────

export const ObjectTypeEditor = forwardRef(function ObjectTypeEditor({ type: committed, connections, queries, onUpdate, onDelete, onDirtyChange, onSaveQuery }, ref) {
  const { draft, setDraft, isDirty } = useDefinitionDraft(committed, onDirtyChange);
  const catalog = useQueryCatalog(connections);

  useImperativeHandle(ref, () => ({
    isDirty: () => isDirty,
    save: () => {
      onUpdate(committed.id, draft);
      notify(`Saved "${draft.name || 'object type'}"`, 'success', 2000);
    },
  }), [isDirty, draft, committed.id, onUpdate]);

  const set = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));
  const setListedBy = (changes) => setDraft(prev => ({ ...prev, listedBy: { ...prev.listedBy, ...changes } }));

  const handleDelete = () => {
    if (window.confirm(`Delete "${committed.name || 'this object type'}"?`)) onDelete(committed.id);
  };

  return (
    <div className="ot-editor">
      <div className="ot-head">
        <span className="ot-title">{draft.name || '(unnamed object type)'}</span>
        <button className="focus-mode-btn" style={{ color: '#d00', borderColor: '#d00', fontSize: 11 }} onClick={handleDelete}>Delete</button>
      </div>
      <div className="ot-body">
        <Section n="1" title="What it is">
          <div className="ot-grid">
            <label>Name</label>
            <input className="details-input" value={draft.name} placeholder="e.g. Equipment" onChange={e => set('name', e.target.value)} />
            <label>Description</label>
            <input className="details-input" value={draft.description} placeholder="Optional" onChange={e => set('description', e.target.value)} />
          </div>
        </Section>
        <Section n="2" title="Where the list comes from" hint="what the Data tab's Objects mode shows">
          <ListedBy draft={draft} setListedBy={setListedBy} connections={connections} queries={queries} catalog={catalog} onSaveQuery={onSaveQuery} />
        </Section>
        <Section n="3" title="Queries that use it" hint="dropping an object offers the ones that take it">
          <References draft={draft} setDraft={setDraft} connections={connections} queries={queries} catalog={catalog} onSaveQuery={onSaveQuery} />
        </Section>
      </div>
    </div>
  );
});
