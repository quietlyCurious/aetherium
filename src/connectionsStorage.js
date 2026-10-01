// connectionsStorage.js
// Browser localStorage-backed persistence for Connections (an OpHub instance
// or a ThingWorx server reached through the proxy). Same pattern as
// queriesStorage.js / pagesStorage.js.

import { migrateToConnections } from './dataMigration';

const CONNECTIONS_STORAGE_KEY = 'aetherium_connections';

export function loadConnections() {
  migrateToConnections();
  try {
    const raw = window.localStorage.getItem(CONNECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveConnections(connections) {
  try {
    window.localStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(connections));
    return true;
  } catch {
    return false;
  }
}
