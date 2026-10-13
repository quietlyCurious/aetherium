// designer/objectTypes/ObjectTypeEditor.jsx
// One object type, in three short sections:
//   1. What it is            name and description
//   2. Where the list comes from
//                            a connection, then — for OpHub — an entity
//                            (ID + display column + a read query of it) or
//                            any query (key + display field); for ThingWorx
//                            a service or "its Things"
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
import { entitiesFromCatalog, outputForColumn, rankListQueries, describeEntityQueries } from '../../connections/ophubEntities';

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

// The list query's inputs, when it has any.
function ListInputs({ query, listedBy, setListedBy }) {
  if (!(query?.inputs || []).length) return null;
  return (
    <>
      <div className="ot-grid-sub">List inputs <span className="ot-muted">— blank uses the input's default</span></div>
      {query.inputs.map(input => (
        <ListInput
          key={input.name}
          input={input}
          value={listedBy.inputValues?.[input.name] ?? ''}
          onChange={v => setListedBy({ inputValues: { ...(listedBy.inputValues || {}), [input.name]: v } })}
        />
      ))}
    </>
  );
}

// Fields every source resets when it changes.
const CLEAR_LIST = { queryId: null, sourceKey: null, keyField: '', displayField: '', inputValues: {} };
const CLEAR_ENTITY = { entityId: null, entityName: '', keyColumn: '', displayColumn: '' };

// A good first guess at an entity's ID and display columns.
const guessKeyColumn = (columns) => columns.find(c => /(^|[^a-z])id$/i.test(c) || /ID$/.test(c)) || columns[0] || '';
const guessDisplayColumn = (columns, key) => columns.find(c => c !== key && /name|title|description/i.test(c)) || '';

// OpHub: an entity, its ID and display columns, and one of its read queries
// to list them. Picking an entity fills in likely columns and the best list
// query (one that returns both columns and needs no inputs), all changeable.
function EntitySource({ listedBy, setListedBy, entry, queries, onSaveQuery }) {
  const entities = entitiesFromCatalog(entry);
  const entity = entities.find(e => e.id === listedBy.entityId) || null;
  const listQuery = queries.find(q => q.id === listedBy.queryId);
  const ranked = rankListQueries(entity, listedBy.keyColumn, listedBy.displayColumn);

  const chooseListQuery = (item, keyColumn, displayColumn, extra = {}) => {
    const queryId = onSaveQuery(listedBy.connectionId, item);
    setListedBy({
      ...extra, keyColumn, displayColumn,
      queryId, sourceKey: item.sourceKey, inputValues: {},
      keyField: outputForColumn(item.definition, keyColumn),
      displayField: outputForColumn(item.definition, displayColumn),
    });
  };

  const pickEntity = (id) => {
    const e = entities.find(x => x.id === id);
    if (!e) return;
    const keyColumn = guessKeyColumn(e.columns);
    const displayColumn = guessDisplayColumn(e.columns, keyColumn);
    const best = rankListQueries(e, keyColumn, displayColumn)[0];
    const extra = { entityId: e.id, entityName: e.name };
    if (best && best.returnsKey && best.returnsDisplay && best.required.length === 0) chooseListQuery(best.item, keyColumn, displayColumn, extra);
    else setListedBy({ ...CLEAR_LIST, ...extra, keyColumn, displayColumn });
  };

  // A column change keeps the list query, re-reading which outputs carry them.
  const pickColumns = (keyColumn, displayColumn) => setListedBy({
    keyColumn, displayColumn,
    keyField: outputForColumn(listQuery, keyColumn),
    displayField: outputForColumn(listQuery, displayColumn),
  });

  if (entry?.status === 'loading') return <><label>Entity</label><div className="ot-muted">Loading…</div></>;
  if (entry?.status === 'error') return <><label>Entity</label><div className="ot-error">{entry.error}</div></>;
  if (entities.length === 0) {
    return <><label>Entity</label><div className="ot-muted">No entity queries on this connection yet. Use "From any query" instead.</div></>;
  }

  const queryHint = (r) => (!r.returnsKey || !r.returnsDisplay)
    ? `  — doesn't return ${[!r.returnsKey && listedBy.keyColumn, !r.returnsDisplay && listedBy.displayColumn].filter(Boolean).join(' or ')}`
    : r.required.length ? `  — needs ${r.required.map(i => i.name).join(', ')}` : '  ✓';
  const columnsWithBlank = ['', ...(entity?.columns || [])];

  return (
    <>
      <label>Entity</label>
      <SelectBox
        {...box}
        searchEnabled
        dataSource={entities.map(e => ({ id: e.id, label: `${e.name}  ·  ${e.reads.length} read quer${e.reads.length === 1 ? 'y' : 'ies'}` }))}
        valueExpr="id" displayExpr="label"
        value={listedBy.entityId || null}
        placeholder="Choose an entity…"
        onValueChanged={e => pickEntity(e.value)}
      />
      {entity && (
        <>
          <label>ID column</label>
          <SelectBox {...box} dataSource={entity.columns} value={listedBy.keyColumn || null} placeholder="Which column identifies one?"
            onValueChanged={e => pickColumns(e.value || '', listedBy.displayColumn)} />
          <label>Display column</label>
          <SelectBox {...box} dataSource={columnsWithBlank} value={listedBy.displayColumn || ''} displayExpr={v => (v ? v : '(same as ID)')}
            onValueChanged={e => pickColumns(listedBy.keyColumn, e.value || '')} />
          <label>List query</label>
          {ranked.length === 0 ? (
            <div className="ot-muted">No query reads {entity.name}. Use "From any query" instead.</div>
          ) : (
            <SelectBox
              {...box}
              dataSource={ranked.map(r => ({ id: r.item.sourceKey, label: `${r.item.definition.name}${queryHint(r)}` }))}
              valueExpr="id" displayExpr="label"
              value={listedBy.sourceKey || null}
              placeholder="Choose the query that lists them…"
              onValueChanged={e => {
                const r = ranked.find(x => x.item.sourceKey === e.value);
                if (r && r.item.sourceKey !== listedBy.sourceKey) chooseListQuery(r.item, listedBy.keyColumn, listedBy.displayColumn);
              }}
            />
          )}
          {listQuery && listedBy.keyColumn && !listedBy.keyField && (
            <div className="ot-error" style={{ gridColumn: '1 / -1' }}>{listQuery.name} doesn't return {listedBy.keyColumn} — choose another list query.</div>
          )}
          <ListInputs query={listQuery} listedBy={listedBy} setListedBy={setListedBy} />
        </>
      )}
    </>
  );
}

// Any query: pick it, then which of its outputs is the key and which to show.
function QuerySource({ listedBy, setListedBy, entry, queries, catalog, onSaveQuery }) {
  const listQuery = queries.find(q => q.id === listedBy.queryId);
  const outputs = (listQuery?.outputs || []).map(o => o.name);
  const extraOptions = entry?.lazy ? [{ value: 'things', label: 'Its Things (each object is a Thing)' }] : [];
  return (
    <>
      <label>List query</label>
      <QuerySourcePicker
        entry={listedBy.connectionId ? entry : null}
        onLoadGroup={(key) => catalog.loadGroup(listedBy.connectionId, key)}
        value={listedBy.sourceKey}
        extraOptions={extraOptions}
        onPickExtra={() => setListedBy({ ...CLEAR_LIST, source: 'things' })}
        onPick={(item) => {
          const queryId = onSaveQuery(listedBy.connectionId, item);
          const names = (item.definition.outputs || []).map(o => o.name);
          setListedBy({ ...CLEAR_LIST, source: 'query', queryId, sourceKey: item.sourceKey, keyField: names[0] || '' });
        }}
        placeholder="Choose the query that lists them…"
      />
      {listQuery && (
        <>
          <label>Key field</label>
          <SelectBox {...box} dataSource={outputs} value={listedBy.keyField || null} placeholder="Which column identifies one?" onValueChanged={e => setListedBy({ keyField: e.value || '' })} />
          <label>Display field</label>
          <SelectBox {...box} dataSource={['', ...outputs]} value={listedBy.displayField || ''} displayExpr={v => (v ? v : '(same as key)')} onValueChanged={e => setListedBy({ displayField: e.value || '' })} />
          <ListInputs query={listQuery} listedBy={listedBy} setListedBy={setListedBy} />
        </>
      )}
    </>
  );
}

// ThingWorx: the connection's Things, optionally narrowed by name.
function ThingsSource({ listedBy, setListedBy }) {
  return (
    <>
      <label>List</label>
      <div className="ot-pair">
        <span className="ot-chip">Its Things</span>
        <button className="focus-mode-btn ot-small" onClick={() => setListedBy({ source: 'query' })}>Use a service instead</button>
      </div>
      <label>Name contains</label>
      <input className="details-input" value={listedBy.nameFilter || ''} placeholder="All Things" onChange={e => setListedBy({ nameFilter: e.target.value })} />
    </>
  );
}

// Which ways a connection can list objects. OpHub defaults to its entities.
const sourcesFor = (connection) => (connectorFor(connection)?.kind === 'ophub'
  ? [{ value: 'entity', label: 'From an entity' }, { value: 'query', label: 'From any query' }]
  : []);

function ListedBy({ draft, setListedBy, connections, queries, catalog, onSaveQuery }) {
  const { listedBy } = draft;
  const connection = connections.find(c => c.id === listedBy.connectionId);
  const entry = catalog.entries.find(e => e.connection.id === listedBy.connectionId);
  const listQuery = queries.find(q => q.id === listedBy.queryId);
  const sources = sourcesFor(connection);
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

  const pickConnection = (id) => {
    const next = connections.find(c => c.id === id);
    setListedBy({ ...CLEAR_LIST, ...CLEAR_ENTITY, connectionId: id, nameFilter: '', source: sourcesFor(next)[0]?.value || 'query' });
  };

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
          onValueChanged={e => pickConnection(e.value)}
        />
        {sources.length > 1 && (
          <>
            <label>List them</label>
            <div className="ot-seg" role="radiogroup">
              {sources.map(o => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={listedBy.source === o.value}
                  className={listedBy.source === o.value ? 'on' : ''}
                  onClick={() => listedBy.source !== o.value && setListedBy({ ...CLEAR_LIST, ...CLEAR_ENTITY, source: o.value })}
                >{o.label}</button>
              ))}
            </div>
          </>
        )}
        {connection && (
          listedBy.source === 'things' ? <ThingsSource listedBy={listedBy} setListedBy={setListedBy} />
          : listedBy.source === 'entity' ? <EntitySource listedBy={listedBy} setListedBy={setListedBy} entry={entry} queries={queries} onSaveQuery={onSaveQuery} />
          : <QuerySource listedBy={listedBy} setListedBy={setListedBy} entry={entry} queries={queries} catalog={catalog} onSaveQuery={onSaveQuery} />
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

// Starts on the connection the type is listed from (step 2) — usually where
// its other queries are too. Changing it is for a type that spans sources
// (e.g. listed from OpHub, with services on ThingWorx Things).
function AddReference({ connections, catalog, onAdd, onSaveQuery, defaultConnectionId }) {
  const [chosenConnectionId, setConnectionId] = useState(null);
  const connectionId = chosenConnectionId ?? defaultConnectionId ?? null;
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

// For a type listed from an OpHub entity: what the entity's other queries
// are, which of them can take an object of this type (they filter by its ID
// column — those are suggested below), and why the rest can't.
function EntityQueriesSummary({ listedBy, catalog }) {
  const [open, setOpen] = useState(false);
  const entry = catalog.entries.find(e => e.connection.id === listedBy.connectionId);
  const entity = entitiesFromCatalog(entry).find(e => e.id === listedBy.entityId);
  if (!entity || !listedBy.keyColumn) return null;
  const described = describeEntityQueries(entity, listedBy.keyColumn, listedBy.sourceKey);
  if (described.length === 0) {
    return <div className="ot-entity-summary">{entity.name} has no other queries yet — only the list query.</div>;
  }
  const taking = described.filter(d => d.takesKeyAs);
  const reason = (d) => d.takesKeyAs ? `takes the ${listedBy.keyColumn} as ${d.takesKeyAs}`
    : d.filtersBy.length ? `filters by ${d.filtersBy.join(', ')}, not ${listedBy.keyColumn}`
    : 'no filter — returns every row';
  return (
    <div className="ot-entity-summary">
      <span>
        {entity.name} has {described.length} other quer{described.length === 1 ? 'y' : 'ies'}:{' '}
        {taking.length
          ? <><b>{taking.length}</b> take{taking.length === 1 ? 's' : ''} a {listedBy.keyColumn} (suggested below)</>
          : <>none filter by {listedBy.keyColumn}, so none can take one on its own</>}
        {taking.length > 0 && taking.length < described.length && <>; {described.length - taking.length} filter{described.length - taking.length === 1 ? 's' : ''} by other columns or not at all</>}.
      </span>
      <button className="ot-link" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show them'}</button>
      {open && (
        <ul className="ot-entity-list">
          {described.map(d => (
            <li key={d.item.sourceKey}>
              <b>{d.item.definition.name}</b>{d.changes && <span className="ot-side ot-side--output" style={{ marginLeft: 6 }}>changes data</span>}
              <span className={d.takesKeyAs ? 'ot-ok' : 'ot-muted'}> — {reason(d)}</span>
            </li>
          ))}
        </ul>
      )}
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
  const acceptAll = () => {
    const added = suggestions.map(s => ({
      id: generateDataId(), connectionId: s.connectionId, side: s.side,
      queryId: onSaveQuery(s.connectionId, s.item), sourceKey: s.sourceKey, field: s.field,
    }));
    setDraft(prev => ({ ...prev, references: [...(prev.references || []), ...added] }));
  };

  return (
    <>
      {draft.listedBy?.source === 'entity' && <EntityQueriesSummary listedBy={draft.listedBy} catalog={catalog} />}
      {references.length === 0 ? (
        <div className="ot-muted ot-empty">
          {suggestions.length
            ? `None added yet — accept the ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} below, or add one.`
            : "None yet. Add the queries that take or return this type's key."}
        </div>
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
      <AddReference connections={connections} catalog={catalog} onAdd={addReference} onSaveQuery={onSaveQuery} defaultConnectionId={draft.listedBy?.connectionId} />
      {suggestions.length > 0 && (
        <div className="ot-suggestions">
          <div className="ot-sub">
            Suggested ({suggestions.length})
            {suggestions.length > 1 && <button className="focus-mode-btn ot-small ot-accept" style={{ marginLeft: 10 }} onClick={acceptAll}>Accept all</button>}
          </div>
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
