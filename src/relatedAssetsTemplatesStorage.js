// relatedAssetsTemplatesStorage.js
// Browser localStorage-backed persistence for per-type Related Assets
// templates (layout mode, Cards/Diagram settings, manual positions) in
// the Now area's Details panel. Same pattern as typeDisplayTemplatesStorage.js.

const RELATED_ASSETS_TEMPLATES_STORAGE_KEY = 'aetherium_related_assets_templates';

export function loadRelatedAssetsTemplates() {
  try {
    const raw = window.localStorage.getItem(RELATED_ASSETS_TEMPLATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveRelatedAssetsTemplates(templates) {
  try {
    window.localStorage.setItem(RELATED_ASSETS_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}
