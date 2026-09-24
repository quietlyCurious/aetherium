// operator/properties/propertyScreens.js
// The saved screens that are about a property (designer/screens/
// screenProperty.jsx) — the custom tiles a property's Visual can be set to,
// alongside Text / Indicator / Spark / All.
//
// A property's visual stores one as 'screen:<pageId>' (propertyDisplay.js
// screenViewMode), so it survives the screen being renamed, and a screen
// that's since been deleted or turned into something else falls back to
// the built-in All tile rather than an empty box.
//
// Reads the Screens area's saved pages (pagesStorage.js). Saved only:
// unsaved edits on the Screens canvas don't show up here until Save, the
// same as everywhere else a saved screen is drawn. The parse is cached
// against the raw stored string, so the many tiles and labels that ask on
// one render share one JSON.parse, and a Save in the Screens area is
// picked up the next time anything asks.

import { PAGES_STORAGE_KEY, loadPagesAndFolders } from '../../pagesStorage';
import { isPropertyScreen } from '../../designer/screens/screenProperty';

let cache = { raw: undefined, screens: [] };

function readRaw() {
  try {
    return window.localStorage.getItem(PAGES_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Every saved property screen, as the saved page objects.
export function propertyScreens() {
  const raw = readRaw();
  if (raw !== cache.raw) {
    cache = { raw, screens: loadPagesAndFolders().pages.filter(p => isPropertyScreen(p.containers)) };
  }
  return cache.screens;
}

export function propertyScreenById(pageId) {
  return propertyScreens().find(p => p.id === pageId) || null;
}

export function propertyScreenName(pageId) {
  return propertyScreenById(pageId)?.name ?? null;
}
