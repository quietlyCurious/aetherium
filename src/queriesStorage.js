// queriesStorage.js
// Browser localStorage-backed persistence for saved query copies: the
// definition (inputs, outputs, type) of each query a screen has used, taken
// from its connection when it was added. Keyed for re-fetching by sourceKey
// ('ophub:<flowUuid>'). Same pattern as pagesStorage.js / connectionsStorage.js.

import { migrateToConnections } from './dataMigration';

const QUERIES_STORAGE_KEY = 'aetherium_queries';

export function loadQueries() {
  migrateToConnections();
  try {
    const raw = window.localStorage.getItem(QUERIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveQueries(queries) {
  try {
    window.localStorage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(queries));
    return true;
  } catch {
    return false;
  }
}
