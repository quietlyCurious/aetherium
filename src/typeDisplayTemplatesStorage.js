// typeDisplayTemplatesStorage.js
// Browser localStorage-backed persistence for per-type display templates
// (view mode, flow direction, flow wrap, align content) in the Now area's
// Types tab. Same pattern as queriesStorage.js / pagesStorage.js.

const TYPE_DISPLAY_TEMPLATES_STORAGE_KEY = 'aetherium_type_display_templates';

export function loadTypeDisplayTemplates() {
  try {
    const raw = window.localStorage.getItem(TYPE_DISPLAY_TEMPLATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveTypeDisplayTemplates(templates) {
  try {
    window.localStorage.setItem(TYPE_DISPLAY_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}
