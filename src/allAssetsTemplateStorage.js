// allAssetsTemplateStorage.js
// Browser localStorage-backed persistence for the single global All Assets
// template (hidden type list, diagram settings, manual positions) in the
// Now area's Details panel. Unlike typeDisplayTemplatesStorage.js and
// relatedAssetsTemplatesStorage.js, this is NOT keyed by type — All Assets
// is one shared view regardless of which type is selected in the tree.

const ALL_ASSETS_TEMPLATE_STORAGE_KEY = 'aetherium_all_assets_template';

export function loadAllAssetsTemplate() {
  try {
    const raw = window.localStorage.getItem(ALL_ASSETS_TEMPLATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return null;
  }
}

export function saveAllAssetsTemplate(template) {
  try {
    window.localStorage.setItem(ALL_ASSETS_TEMPLATE_STORAGE_KEY, JSON.stringify(template));
    return true;
  } catch {
    return false;
  }
}
