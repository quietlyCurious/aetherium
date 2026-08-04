// dataSourcesStorage.js
// Browser localStorage-backed persistence for Data Source definitions.
// Same pattern as pagesStorage.js / entitiesStorage.js.

const DATA_SOURCES_STORAGE_KEY = 'aetherium_data_sources';

export function loadDataSources() {
  try {
    const raw = window.localStorage.getItem(DATA_SOURCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveDataSources(dataSources) {
  try {
    window.localStorage.setItem(DATA_SOURCES_STORAGE_KEY, JSON.stringify(dataSources));
    return true;
  } catch {
    return false;
  }
}
