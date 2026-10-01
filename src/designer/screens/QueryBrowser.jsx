// designer/screens/QueryBrowser.jsx
// The Data tab's Queries mode: every connection's queries, fetched live
// (connections/useQueryCatalog), grouped and searchable, each with + Add.
//
// + Add saves a copy of the query's definition (inputs, outputs, type —
// onSaveQuery) and puts an instance of it on the page. Bindings and the
// runtime read that saved copy, so a screen keeps working when the source is
// slow or briefly offline. Adding always takes the source's latest
// definition; a saved copy that has drifted from its source is marked
// "changed" with an Update button, and one whose query has gone from the
// source is listed as "missing".

import { useState } from 'react';
import notify from 'devextreme/ui/notify';
import { useQueryCatalog } from '../../connections/useQueryCatalog';
import { connectorFor, connectionLabel } from '../../connections/connectionKinds';

const TYPE_BADGES = {
  opcua_read: 'OPC UA', opcua_write: 'OPC UA write', sql_sproc: 'SQL',
  rest_get: 'REST', rest_post: 'REST', rest_put: 'REST', rest_delete: 'REST',
  entity_read: 'Entity', entity_write: 'Entity write',
};

// What makes two copies of a query different for a screen's purposes: what
// it's called, what it takes and what it returns. Internal settings aren't
// compared, so a copy saved by an older version isn't flagged for those.
const shapeOf = (d) => JSON.stringify([
  d.name, d.type, d.direction,
  (d.inputs || []).map(i => [i.name, i.type, !!i.optional]),
  (d.outputs || []).map(o => [o.name, o.type || 'String', o.outputGroup || 'default']),
]);

const note = { padding: '8px 12px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 26px', borderBottom: '1px solid #f4f4f4' };
const metaStyle = { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' };
const badge = (bg = '#eef1f4', color = '#555') => ({ fontSize: 9, borderRadius: 3, padding: '1px 5px', background: bg, color, flexShrink: 0 });
const smallBtn = { fontSize: 11, padding: '1px 7px', flexShrink: 0 };

function Signature({ definition }) {
  const inputs = definition.inputs || [];
  const outputs = definition.outputs || [];
  return (
    <div style={{ margin: '0 10px 6px 26px', padding: '6px 8px', border: '1px solid #e6eef7', borderRadius: 4, fontSize: 11, color: '#444', lineHeight: 1.5 }}>
      {definition.description && <div style={{ color: '#777', marginBottom: 2 }}>{definition.description}</div>}
      <div><b style={{ fontWeight: 600, color: '#555' }}>Inputs</b>{' '}
        {inputs.length ? inputs.map(i => `${i.name}${i.optional ? '?' : ''} (${i.type})`).join(', ') : 'none'}
      </div>
      <div><b style={{ fontWeight: 600, color: '#555' }}>Returns</b>{' '}
        {definition.resultCardinality}{outputs.length ? ` · ${outputs.map(o => o.name).join(', ')}` : ''}
      </div>
    </div>
  );
}

function QueryRow({ item, saved, countOnPage, canAdd, missing, onAdd, onUpdate }) {
  const [open, setOpen] = useState(false);
  const definition = item?.definition || saved;
  const changed = !missing && saved && item && shapeOf(saved) !== shapeOf(item.definition);
  return (
    <>
      {/* Name on its own line, so badges and buttons never squeeze it out in a narrow panel. */}
      <div style={{ ...rowStyle, background: open ? '#f7fafd' : undefined }}>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} title="Show inputs and outputs" onClick={() => setOpen(o => !o)}>
          <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{definition.name}</div>
          <div style={metaStyle}>
            <span style={badge()}>{TYPE_BADGES[definition.type] || definition.type}</span>
            {changed && <span style={badge('#fff4e5', '#b26a00')} title="The source's definition differs from the copy your screens use">changed</span>}
            {missing && <span style={badge('#fdecea', '#c62828')} title="No longer offered by this connection. Screens keep using the saved copy.">missing</span>}
            {countOnPage > 0 && <span style={{ fontSize: 9, color: '#888' }} title="Instances already on this page">{countOnPage} on page</span>}
          </div>
        </div>
        {changed && (
          <button className="focus-mode-btn" style={smallBtn} title="Replace the saved copy with the source's definition" onClick={onUpdate}>Update</button>
        )}
        {!missing && (
          <button
            className="focus-mode-btn"
            style={smallBtn}
            disabled={!canAdd}
            title={canAdd ? 'Add an instance of this query to the current page' : 'Save this screen first'}
            onClick={onAdd}
          >+ Add</button>
        )}
      </div>
      {open && <Signature definition={definition} />}
    </>
  );
}

function Group({ title, count, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <div
        style={{ padding: '5px 10px 5px 12px', fontSize: 11, fontWeight: 600, color: '#555', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        {collapsed ? '▸' : '▾'} {title} <span style={{ color: '#aaa', fontWeight: 400 }}>({count})</span>
      </div>
      {!collapsed && children}
    </>
  );
}

function ConnectionSection({ entry, savedCopies, search, editor, onSaveQuery, onRefresh }) {
  const { connection, status, items, error } = entry;
  const connector = connectorFor(connection);
  const { activePageId, queryInstances } = editor;
  const matches = (name) => !search || (name || '').toLowerCase().includes(search);
  const countOnPage = (queryId) => queryId ? queryInstances.filter(qi => qi.pageId === activePageId && qi.queryId === queryId).length : 0;
  const savedFor = (sourceKey) => savedCopies.find(q => q.sourceKey === sourceKey);

  const add = (item) => {
    const queryId = onSaveQuery(connection.id, item);
    editor.addQueryInstance({ queryId, alias: item.definition.name });
    notify(`Added "${item.definition.name}" to this page`, 'success', 2000);
  };
  const update = (item) => {
    onSaveQuery(connection.id, item);
    notify(`Updated the saved copy of "${item.definition.name}"`, 'success', 2000);
  };
  // A saved copy offered as if it came from the source — for adding while
  // the source can't be reached.
  const asItem = (saved) => ({ sourceKey: saved.sourceKey, group: 'Saved copies', definition: saved });

  const liveKeys = new Set(items.map(i => i.sourceKey));
  const visible = items.filter(i => matches(i.definition.name));
  const missing = status === 'ok' ? savedCopies.filter(q => !liveKeys.has(q.sourceKey) && matches(q.name)) : [];
  const offline = status === 'error' ? savedCopies.filter(q => matches(q.name)) : [];

  const groups = [];
  visible.forEach(item => {
    let group = groups.find(g => g.title === item.group);
    if (!group) groups.push(group = { title: item.group, items: [] });
    group.items.push(item);
  });
  groups.sort((a, b) => a.title.localeCompare(b.title));
  groups.forEach(g => g.items.sort((a, b) => a.definition.name.localeCompare(b.definition.name)));

  const statusText = status === 'loading' ? 'loading…'
    : status === 'error' ? 'unreachable'
    : search ? `${visible.length} of ${items.length}`
    : `${items.length} ${connector?.itemNoun || 'queries'}`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#fafafa', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: connector?.dot || '#bbb', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={connector?.label}>
          {connectionLabel(connection)}
        </span>
        <span style={{ fontSize: 10, color: status === 'error' ? '#c62828' : '#888', flexShrink: 0 }}>{statusText}</span>
        <button
          className="focus-mode-btn"
          style={{ fontSize: 12, padding: '0 5px', lineHeight: '16px', flexShrink: 0 }}
          title="Fetch this connection's queries again"
          disabled={status === 'loading'}
          onClick={onRefresh}
        >⟳</button>
      </div>

      {status === 'loading' && <p style={{ ...note, fontStyle: 'italic' }}>Fetching {connector?.itemNoun || 'queries'}…</p>}

      {status === 'error' && (
        <>
          <p style={{ ...note, color: '#c62828' }}>{error}</p>
          {offline.length > 0 && (
            <Group title="Saved copies" count={offline.length}>
              {offline.map(q => (
                <QueryRow key={q.id} item={asItem(q)} saved={q} countOnPage={countOnPage(q.id)} canAdd={!!activePageId} onAdd={() => add(asItem(q))} />
              ))}
            </Group>
          )}
        </>
      )}

      {status === 'ok' && visible.length === 0 && missing.length === 0 && (
        <p style={note}>{search ? 'No matches.' : `This connection offers no ${connector?.itemNoun || 'queries'}.`}</p>
      )}

      {status === 'ok' && groups.map(group => (
        <Group key={group.title} title={group.title} count={group.items.length}>
          {group.items.map(item => {
            const saved = savedFor(item.sourceKey);
            return (
              <QueryRow
                key={item.sourceKey}
                item={item}
                saved={saved}
                countOnPage={countOnPage(saved?.id)}
                canAdd={!!activePageId}
                onAdd={() => add(item)}
                onUpdate={() => update(item)}
              />
            );
          })}
        </Group>
      ))}

      {missing.length > 0 && (
        <Group title="No longer at the source" count={missing.length}>
          {missing.map(q => <QueryRow key={q.id} saved={q} missing countOnPage={countOnPage(q.id)} />)}
        </Group>
      )}
    </div>
  );
}

export function QueryBrowser({ editor, connections, queries, onSaveQuery }) {
  const { entries, refresh } = useQueryCatalog(connections);
  const search = editor.dataTabSearch.trim().toLowerCase();

  if (connections.length === 0) {
    return <p style={note}>No connections yet. Add an Operations Hub connection in the Connections area.</p>;
  }
  return (
    <div>
      {!editor.activePageId && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: '#7a6000', background: '#fffbe6', borderBottom: '1px solid #ffe08a' }}>
          Save this screen first — query instances need a real page to belong to.
        </div>
      )}
      {entries.map(entry => (
        <ConnectionSection
          key={entry.connection.id}
          entry={entry}
          savedCopies={queries.filter(q => q.connectionId === entry.connection.id)}
          search={search}
          editor={editor}
          onSaveQuery={onSaveQuery}
          onRefresh={() => refresh(entry.connection.id)}
        />
      ))}
    </div>
  );
}
