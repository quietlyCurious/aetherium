// queriesStorage.js
// Browser localStorage-backed persistence for Query definitions.
// Same pattern as pagesStorage.js / entitiesStorage.js.

const QUERIES_STORAGE_KEY = 'aetherium_queries';

export function loadQueries() {
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
