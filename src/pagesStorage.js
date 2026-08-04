// pagesStorage.js
// Browser localStorage-backed persistence for saved pages (Screens) and the
// folders they can be organized into.
//
// MVP scope, deliberately explicit rather than auto-syncing: the canvas's live
// `containers` state is the ACTIVE page's working copy. Nothing is written to
// storage until the user hits Save — there's no continuous/automatic sync back
// into the `pages` array. This avoids a much larger refactor (touching every
// setContainers call site in App.js) for a first pass, at the cost of needing
// an explicit Save click before switching screens or refreshing the browser.
// Autosave / unsaved-changes warnings are natural fast-follows once this loop
// is proven out.

const STORAGE_KEY = 'aetherium_pages';

// Reads { pages, folders }. Backward-compatible with the pre-folders format,
// where the stored value was just a bare array of pages.
export function loadPagesAndFolders() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pages: [], folders: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Old format — bare page array, no folders yet.
      return { pages: parsed, folders: [] };
    }
    return {
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return { pages: [], folders: [] };
  }
}

export function savePagesAndFolders(pages, folders) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pages, folders }));
    return true;
  } catch {
    return false;
  }
}

// Deep-clones via JSON round-trip — containers trees are plain serializable
// data (no functions/dates inside), so this is a safe, simple deep copy that
// prevents the saved snapshot and the live working canvas from ever sharing
// object references.
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function makeNewPage(name, containers, generateId, folderId = null) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: name || 'Untitled Screen',
    folderId,
    containers: deepClone(containers),
    breakpointOverrides: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function snapshotPage(page, containers) {
  return {
    ...page,
    containers: deepClone(containers),
    updatedAt: new Date().toISOString(),
  };
}

export function cloneContainersFromPage(page) {
  return deepClone(page.containers);
}

export function makeNewFolder(name, generateId) {
  return {
    id: generateId(),
    name: name || 'Untitled Folder',
    createdAt: new Date().toISOString(),
  };
}

