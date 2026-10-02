// connections/useQueryCatalog.js
// What each connection offers right now, fetched live from the source.
//
// Each connection's list is fetched the first time anything asks for it and
// then kept for the rest of the session, so switching tabs or screens
// doesn't re-fetch; refresh() fetches again on request. A connection whose
// settings change (proxy URL, filter…) is fetched again automatically.
//
// Two ways a connector can list its queries (see connectionKinds.js):
//   browse(connection)              everything at once (OpHub flows); the
//                                   items are grouped here by item.group
//   listGroups(connection) +        groups first, each group's queries when
//   listGroup(connection, key)      it's opened (ThingWorx: Things, then a
//                                   Thing's services) — loadGroup() fetches one
//
// The cache lives at module level, outside React, so every component that
// uses this hook sees the same lists and the same in-flight fetches.
//
//   const { entries, refresh, loadGroup } = useQueryCatalog(connections);
//   entries: [{ connection, lazy, status: 'loading'|'ok'|'error', error,
//               groups: [{ key, label, status: 'idle'|'loading'|'ok'|'error', items, error }] }]
//   items:   [{ sourceKey, group, definition }]

import { useEffect, useReducer } from 'react';
import { connectorFor } from './connectionKinds';

const cache = new Map();          // connection id → { signature, status, error, groups }
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

// What a fetch depends on. Name changes don't re-fetch.
const signatureOf = ({ name, id, ...settings }) => JSON.stringify(settings);

const isLazy = (connector) => typeof connector?.listGroups === 'function';

// Everything-at-once items → groups, by item.group.
function groupItems(items) {
  const byKey = new Map();
  items.forEach(item => {
    if (!byKey.has(item.group)) byKey.set(item.group, { key: item.group, label: item.group, status: 'ok', items: [], error: null });
    byKey.get(item.group).items.push(item);
  });
  return [...byKey.values()];
}

async function fetchCatalog(connection) {
  const signature = signatureOf(connection);
  cache.set(connection.id, { signature, status: 'loading', error: null, groups: [] });
  notify();
  try {
    const connector = connectorFor(connection);
    if (!connector) throw new Error(`Unknown connection kind "${connection.kind}"`);
    const groups = isLazy(connector)
      ? (await connector.listGroups(connection)).map(g => ({ ...g, status: 'idle', items: [], error: null }))
      : groupItems(await connector.browse(connection));
    if (cache.get(connection.id)?.signature !== signature) return; // settings changed mid-fetch
    cache.set(connection.id, { signature, status: 'ok', error: null, groups });
  } catch (err) {
    if (cache.get(connection.id)?.signature !== signature) return;
    cache.set(connection.id, { signature, status: 'error', error: err.message, groups: [] });
  }
  notify();
}

async function fetchGroup(connection, key) {
  const entry = cache.get(connection.id);
  if (!entry || entry.signature !== signatureOf(connection)) return;
  // Applies only while the connection still has the same settings.
  const setGroup = (changes) => {
    const current = cache.get(connection.id);
    if (!current || current.signature !== entry.signature) return false;
    cache.set(connection.id, { ...current, groups: current.groups.map(g => (g.key === key ? { ...g, ...changes } : g)) });
    notify();
    return true;
  };
  if (!setGroup({ status: 'loading', error: null })) return;
  try {
    const items = await connectorFor(connection).listGroup(connection, key);
    setGroup({ status: 'ok', items });
  } catch (err) {
    setGroup({ status: 'error', error: err.message });
  }
}

// For a one-off check, e.g. the Connections editor's Test button: lists with
// the given (possibly unsaved) settings without touching the cache.
// → { count, noun } — "38 queries", "212 Things".
export async function testConnection(connection) {
  const connector = connectorFor(connection);
  if (!connector) throw new Error(`Unknown connection kind "${connection.kind}"`);
  if (isLazy(connector)) {
    const groups = await connector.listGroups(connection);
    return { count: groups.length, noun: connector.groupNoun };
  }
  const items = await connector.browse(connection);
  return { count: items.length, noun: connector.itemNoun, groups: new Set(items.map(i => i.group)).size };
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
    return {
      connection,
      lazy: isLazy(connectorFor(connection)),
      ...(current ? cached : { status: 'loading', error: null, groups: [] }),
    };
  });

  const refresh = (connectionId = null) => {
    connections
      .filter(c => connectionId === null || c.id === connectionId)
      .forEach(fetchCatalog);
  };

  const loadGroup = (connectionId, key) => {
    const connection = connections.find(c => c.id === connectionId);
    if (connection) fetchGroup(connection, key);
  };

  return { entries, refresh, loadGroup };
}
