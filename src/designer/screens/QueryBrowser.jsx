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
//
// A connection listed in two steps (ThingWorx) shows its groups (Things)
// collapsed and fetches a group's queries (services) the first time it's
// opened. Search matches group names as well as query names. Services every
// Thing inherits from the platform sit behind a "built-in" toggle.

import { useState } from 'react';
import notify from 'devextreme/ui/notify';
import { useQueryCatalog } from '../../connections/useQueryCatalog';
import { connectorFor, connectionLabel } from '../../connections/connectionKinds';

const TYPE_BADGES = {
  opcua_read: 'OPC UA', opcua_write: 'OPC UA write', sql_sproc: 'SQL',
  rest_get: 'REST', rest_post: 'REST', rest_put: 'REST', rest_delete: 'REST',
  entity_read: 'Entity', entity_write: 'Entity write',
  twx_service: 'Service',
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

function Group({ title, countText, hint, startCollapsed = false, forceOpen = false, onOpen, children }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const open = forceOpen || !collapsed;
  const toggle = () => {
    if (!open) onOpen?.();
    setCollapsed(open);
  };
  return (
    <>
      <div
        style={{ padding: '5px 10px 5px 12px', fontSize: 11, fontWeight: 600, color: '#555', cursor: 'pointer', userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={hint || title}
        onClick={toggle}
      >
        {open ? '▾' : '▸'} {title} {countText && <span style={{ color: '#aaa', fontWeight: 400 }}>({countText})</span>}
      </div>
      {open && children}
    </>
  );
}

// A group's items: its main ones, then the minor (built-in) ones behind a toggle.
function GroupItems({ items, renderItem, showMinor }) {
  const [minorOpen, setMinorOpen] = useState(false);
  const main = items.filter(i => !i.minor);
  const minor = items.filter(i => i.minor);
  const minorShown = showMinor || minorOpen || main.length === 0;
  return (
    <>
      {main.map(renderItem)}
      {minor.length > 0 && !minorShown && (
        <div
          style={{ padding: '3px 10px 5px 26px', fontSize: 10, color: '#0f6cbd', cursor: 'pointer' }}
          onClick={() => setMinorOpen(true)}
        >
          + {minor.length} built-in service{minor.length === 1 ? '' : 's'}
        </div>
      )}
      {minorShown && minor.map(renderItem)}
    </>
  );
}

const byName = (a, b) => a.definition.name.localeCompare(b.definition.name);

function ConnectionSection({ entry, savedCopies, search, editor, onSaveQuery, onRefresh, onLoadGroup }) {
  const { connection, status, error, groups, lazy } = entry;
  const connector = connectorFor(connection);
  const { activePageId, queryInstances } = editor;
  const matches = (name) => !search || (name || '').toLowerCase().includes(search);
  const countOnPage = (queryId) => queryId ? queryInstances.filter(qi => qi.pageId === activePageId && qi.queryId === queryId).length : 0;
  const savedFor = (sourceKey) => savedCopies.find(q => q.sourceKey === sourceKey);
  const itemNoun = connector?.itemNoun || 'queries';

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
  const asItem = (saved) => ({ sourceKey: saved.sourceKey, group: saved.group, definition: saved });

  // What search leaves of each group: a group whose name matches keeps all
  // its items.
  const shownGroups = groups
    .map(group => {
      const labelMatches = matches(group.label);
      const items = (labelMatches ? group.items : group.items.filter(i => matches(i.definition.name))).slice().sort(byName);
      return { ...group, items, show: !search || labelMatches || items.length > 0 };
    })
    .filter(g => g.show)
    .sort((a, b) => a.label.localeCompare(b.label));

  // Saved copies the source no longer offers. For a two-step source this is
  // only known once the copy's group is loaded (or the group itself is gone).
  const liveKeys = new Set(groups.flatMap(g => g.items.map(i => i.sourceKey)));
  const groupByKey = new Map(groups.map(g => [g.key, g]));
  const missing = status !== 'ok' ? [] : savedCopies.filter(q => {
    if (liveKeys.has(q.sourceKey) || !matches(q.name)) return false;
    if (!lazy) return true;
    const group = groupByKey.get(q.group);
    return !group || group.status === 'ok';
  });
  const offline = status === 'error' ? savedCopies.filter(q => matches(q.name)) : [];

  const total = lazy ? groups.length : groups.reduce((n, g) => n + g.items.length, 0);
  const shown = lazy ? shownGroups.length : shownGroups.reduce((n, g) => n + g.items.length, 0);
  const statusText = status === 'loading' ? 'loading…'
    : status === 'error' ? 'unreachable'
    : `${search ? `${shown} of ` : ''}${total} ${lazy ? connector.groupNoun : itemNoun}`;

  const renderItem = (item) => {
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
  };

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
          title={`Fetch this connection's ${lazy ? connector.groupNoun : itemNoun} again`}
          disabled={status === 'loading'}
          onClick={onRefresh}
        >⟳</button>
      </div>

      {status === 'loading' && <p style={{ ...note, fontStyle: 'italic' }}>Fetching {lazy ? connector.groupNoun : itemNoun}…</p>}

      {status === 'error' && (
        <>
          <p style={{ ...note, color: '#c62828' }}>{error}</p>
          {offline.length > 0 && (
            <Group title="Saved copies" countText={offline.length}>
              {offline.map(q => (
                <QueryRow key={q.id} item={asItem(q)} saved={q} countOnPage={countOnPage(q.id)} canAdd={!!activePageId} onAdd={() => add(asItem(q))} />
              ))}
            </Group>
          )}
        </>
      )}

      {status === 'ok' && shownGroups.length === 0 && missing.length === 0 && (
        <p style={note}>{search ? 'No matches.' : `This connection offers no ${lazy ? connector.groupNoun : itemNoun}.`}</p>
      )}

      {status === 'ok' && shownGroups.map(group => (
        <Group
          key={group.key}
          title={group.label}
          hint={group.description}
          countText={group.status === 'ok' ? group.items.length : null}
          startCollapsed={lazy}
          forceOpen={!!search && group.items.length > 0}
          onOpen={() => { if (lazy && (group.status === 'idle' || group.status === 'error')) onLoadGroup(group.key); }}
        >
          {group.status === 'loading' && <p style={{ ...note, padding: '4px 10px 6px 26px', fontStyle: 'italic' }}>Fetching {itemNoun}…</p>}
          {group.status === 'error' && <p style={{ ...note, padding: '4px 10px 6px 26px', color: '#c62828' }}>{group.error}</p>}
          {group.status === 'ok' && group.items.length === 0 && <p style={{ ...note, padding: '4px 10px 6px 26px' }}>No {itemNoun}.</p>}
          {group.status === 'ok' && <GroupItems items={group.items} renderItem={renderItem} showMinor={!!search} />}
        </Group>
      ))}

      {missing.length > 0 && (
        <Group title="No longer at the source" countText={missing.length}>
          {missing.map(q => <QueryRow key={q.id} saved={q} missing countOnPage={countOnPage(q.id)} />)}
        </Group>
      )}
    </div>
  );
}

export function QueryBrowser({ editor, connections, queries, onSaveQuery }) {
  const { entries, refresh, loadGroup } = useQueryCatalog(connections);
  const search = editor.dataTabSearch.trim().toLowerCase();

  if (connections.length === 0) {
    return <p style={note}>No connections yet. Add one in the Connections area.</p>;
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
          onLoadGroup={(key) => loadGroup(entry.connection.id, key)}
        />
      ))}
    </div>
  );
}
