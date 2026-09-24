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

// Exported for readers that cache against the raw stored string
// (operator/properties/propertyScreens.js).
export const PAGES_STORAGE_KEY = 'aetherium_pages';
const STORAGE_KEY = PAGES_STORAGE_KEY;

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

// One saved page by id, or undefined — for anything that shows a single
// screen outside the editor (the runtime view, an embedded ScreenView).
export function loadPage(pageId) {
  return loadPagesAndFolders().pages.find(p => p.id === pageId);
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

// One-time repair for a bug in the old container-ID generator (a plain
// counter that reset to 2 on every app load, with no awareness of IDs
// already present in a loaded page — confirmed: two unrelated containers on
// the same page both ended up with id 4). The generator itself is fixed
// (now uses the same UUID scheme as every other Aetherium entity), but that
// only prevents NEW collisions — pages saved before the fix can still carry
// existing duplicates baked into their stored data, which this walks every
// saved page's container tree to find and correct.
//
// For each duplicate found (by walk order — depth-first, matching how the
// tree is naturally traversed elsewhere), the FIRST occurrence of an id
// keeps it; every later occurrence gets a fresh id via generateId(). Direct
// children of a reassigned container have their parentId updated to match,
// since parent/child linkage is tracked both by nesting AND by parentId
// back-reference. Nothing outside the container tree needs updating —
// bindings live on the container itself, and nothing else in the app
// references a container by id externally.
export function repairDuplicateContainerIds(pages, generateId) {
  let totalFixed = 0;

  const repairTree = (nodes, seenIds) => {
    nodes.forEach(node => {
      if (seenIds.has(node.id)) {
        const newId = generateId();
        node.id = newId;
        (node.children || []).forEach(child => { child.parentId = newId; });
        totalFixed++;
      }
      seenIds.add(node.id);
      repairTree(node.children || [], seenIds);
    });
  };

  const repairedPages = pages.map(page => {
    const containers = deepClone(page.containers || []);
    repairTree(containers, new Set());
    return { ...page, containers };
  });

  return { pages: repairedPages, totalFixed };
}

