// entitiesStorage.js
// Browser localStorage-backed persistence for entities (schema + rows).

const ENTITIES_STORAGE_KEY = 'aetherium_entities';

export function loadEntities() {
  try {
    const raw = window.localStorage.getItem(ENTITIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveEntities(entities) {
  try {
    window.localStorage.setItem(ENTITIES_STORAGE_KEY, JSON.stringify(entities));
    return true;
  } catch {
    return false;
  }
}
