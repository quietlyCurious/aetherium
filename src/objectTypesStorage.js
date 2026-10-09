// objectTypesStorage.js
// Browser localStorage-backed persistence for Object Types (see
// designer/objectTypes/objectTypes.js). Same pattern as connectionsStorage.js.

const OBJECT_TYPES_STORAGE_KEY = 'aetherium_object_types';

export function loadObjectTypes() {
  try {
    const raw = window.localStorage.getItem(OBJECT_TYPES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveObjectTypes(objectTypes) {
  try {
    window.localStorage.setItem(OBJECT_TYPES_STORAGE_KEY, JSON.stringify(objectTypes));
    return true;
  } catch {
    return false;
  }
}
