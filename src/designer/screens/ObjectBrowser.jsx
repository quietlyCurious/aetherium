// designer/screens/ObjectBrowser.jsx
// The Data tab's Objects mode: pick an object type, then drag one of its
// objects onto a widget on the canvas (ObjectDropPopover takes it from
// there). The objects come live from the type's list (listObjects) and are
// kept for the session per type; ⟳ fetches them again.
//
// Search filters the fetched list. Long lists show the first
// MAX_SHOWN — searching narrows them — rather than drawing thousands of rows.

import { useEffect, useReducer, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { listObjects } from '../objectTypes/objectTypes';
import { OBJECT_MIME } from './objectDropContext';

const MAX_SHOWN = 300;

// Session cache: type id → { signature, status, objects, error }.
const cache = new Map();
const listeners = new Set();
const notifyAll = () => listeners.forEach(fn => fn());
let rememberedTypeId = null;

const signatureOf = (type, connections) => JSON.stringify([type.listedBy, connections.find(c => c.id === type.listedBy?.connectionId)]);

async function fetchObjects(type, context) {
  const signature = signatureOf(type, context.connections);
  cache.set(type.id, { signature, status: 'loading', objects: [], error: null });
  notifyAll();
  try {
    const objects = await listObjects(type, context);
    if (cache.get(type.id)?.signature === signature) cache.set(type.id, { signature, status: 'ok', objects, error: null });
  } catch (err) {
    if (cache.get(type.id)?.signature === signature) cache.set(type.id, { signature, status: 'error', objects: [], error: err.message });
  }
  notifyAll();
}

const note = { padding: '8px 12px', fontSize: 11, color: '#999', margin: 0, lineHeight: 1.5 };

export function ObjectBrowser({ editor, objectTypes, connections, queries }) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const [typeId, setTypeId] = useState(() => (objectTypes.some(t => t.id === rememberedTypeId) ? rememberedTypeId : objectTypes[0]?.id ?? null));
  const type = objectTypes.find(t => t.id === typeId) || null;

  useEffect(() => {
    listeners.add(rerender);
    return () => listeners.delete(rerender);
  }, []);

  useEffect(() => {
    if (type && cache.get(type.id)?.signature !== signatureOf(type, connections)) fetchObjects(type, { connections, queries });
    // queries only matter for the list query's saved copy, which the type's
    // listedBy.queryId already pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, connections]);

  if (objectTypes.length === 0) {
    return <p style={note}>No object types yet. Define one in the Object Types area (under Data), then its objects appear here to drag onto widgets.</p>;
  }

  const entry = type ? cache.get(type.id) : null;
  const current = entry && entry.signature === signatureOf(type, connections) ? entry : { status: 'loading', objects: [] };
  const search = editor.dataTabSearch.trim().toLowerCase();
  const matching = current.objects.filter(o => !search || o.label.toLowerCase().includes(search) || o.key.toLowerCase().includes(search));
  const shown = matching.slice(0, MAX_SHOWN);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, padding: '0 12px 6px', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SelectBox
            dataSource={objectTypes.map(t => ({ id: t.id, label: t.name || '(unnamed)' }))}
            valueExpr="id" displayExpr="label"
            value={typeId}
            onValueChanged={e => { setTypeId(e.value); rememberedTypeId = e.value; }}
            stylingMode="outlined" height={24}
          />
        </div>
        <button
          className="focus-mode-btn"
          style={{ fontSize: 12, padding: '0 5px', lineHeight: '16px', flexShrink: 0 }}
          title="Fetch this type's objects again"
          disabled={!type || current.status === 'loading'}
          onClick={() => type && fetchObjects(type, { connections, queries })}
        >⟳</button>
      </div>
      {type?.description && <p style={{ ...note, paddingTop: 0 }}>{type.description}</p>}

      {current.status === 'loading' && <p style={{ ...note, fontStyle: 'italic' }}>Fetching…</p>}
      {current.status === 'error' && <p style={{ ...note, color: '#c62828' }}>{current.error}</p>}
      {current.status === 'ok' && (
        <>
          <p style={{ ...note, paddingTop: 0, paddingBottom: 4 }}>
            {search ? `${matching.length} of ${current.objects.length}` : current.objects.length} · drag one onto a widget
          </p>
          {shown.length === 0 && <p style={note}>{search ? 'No matches.' : 'The list is empty.'}</p>}
          {shown.map(o => (
            <div
              key={o.key}
              className="object-list-item"
              draggable
              title={`Drag onto a widget to show ${o.label} with a related query`}
              onDragStart={e => {
                e.dataTransfer.setData(OBJECT_MIME, JSON.stringify({ typeId: type.id, key: o.key, label: o.label }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="grip">⋮⋮</span>
              <span className="label">{o.label}</span>
              {o.label !== o.key && <span className="key">{o.key}</span>}
            </div>
          ))}
          {matching.length > MAX_SHOWN && <p style={note}>Showing the first {MAX_SHOWN} — search to narrow the list.</p>}
        </>
      )}
    </div>
  );
}
