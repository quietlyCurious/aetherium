// queryInstancesStorage.js
// Browser localStorage-backed persistence for QueryInstances (page-scoped and
// app-scoped alike — a flat array, each tagged with a `pageId`, or `null` for
// app-scoped instances shared across all pages). Same pattern as
// pagesStorage.js / entitiesStorage.js / dataSourcesStorage.js / queriesStorage.js.

const QUERY_INSTANCES_STORAGE_KEY = 'aetherium_query_instances';

export function loadQueryInstances() {
  try {
    const raw = window.localStorage.getItem(QUERY_INSTANCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveQueryInstances(queryInstances) {
  try {
    window.localStorage.setItem(QUERY_INSTANCES_STORAGE_KEY, JSON.stringify(queryInstances));
    return true;
  } catch {
    return false;
  }
}
