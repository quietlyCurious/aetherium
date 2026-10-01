// connections/useQueryCatalog.js
// What each connection offers right now, fetched live from the source.
//
// Each connection's list is fetched the first time anything asks for it and
// then kept for the rest of the session, so switching tabs or screens
// doesn't re-fetch; refresh() fetches again on request. A connection whose
// settings change (proxy URL, group…) is fetched again automatically.
//
// The cache lives at module level, outside React, so every component that
// uses this hook sees the same lists and the same in-flight fetch.
//
//   const { entries, refresh } = useQueryCatalog(connections);
//   entries: [{ connection, status: 'loading'|'ok'|'error', items, error }]
//   items:   [{ sourceKey, group, definition }]

import { useEffect, useReducer } from 'react';
import { connectorFor } from './connectionKinds';

const cache = new Map();          // connection id → { signature, status, items, error }
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

// What a fetch depends on. Name changes don't re-fetch.
const signatureOf = ({ name, id, ...settings }) => JSON.stringify(settings);

async function fetchCatalog(connection) {
  const signature = signatureOf(connection);
  cache.set(connection.id, { signature, status: 'loading', items: [], error: null });
  notify();
  try {
    const connector = connectorFor(connection);
    if (!connector) throw new Error(`Unknown connection kind "${connection.kind}"`);
    const items = await connector.browse(connection);
    if (cache.get(connection.id)?.signature !== signature) return; // settings changed mid-fetch
    cache.set(connection.id, { signature, status: 'ok', items, error: null });
  } catch (err) {
    if (cache.get(connection.id)?.signature !== signature) return;
    cache.set(connection.id, { signature, status: 'error', items: [], error: err.message });
  }
  notify();
}

// For a one-off check, e.g. the Connections editor's Test button: fetches
// with the given (possibly unsaved) settings without touching the cache.
export async function browseConnection(connection) {
  const connector = connectorFor(connection);
  if (!connector) throw new Error(`Unknown connection kind "${connection.kind}"`);
  return connector.browse(connection);
}

export function useQueryCatalog(connections) {
  const [, rerender] = useReducer(n => n + 1, 0);

  useEffect(() => {
    listeners.add(rerender);
    return () => listeners.delete(rerender);
  }, []);

  useEffect(() => {
    connections.forEach(c => {
      if (cache.get(c.id)?.signature !== signatureOf(c)) fetchCatalog(c);
    });
  }, [connections]);

  const entries = connections.map(connection => {
    const cached = cache.get(connection.id);
    const current = cached?.signature === signatureOf(connection);
    return { connection, ...(current ? cached : { status: 'loading', items: [], error: null }) };
  });

  const refresh = (connectionId = null) => {
    connections
      .filter(c => connectionId === null || c.id === connectionId)
      .forEach(fetchCatalog);
  };

  return { entries, refresh };
}
