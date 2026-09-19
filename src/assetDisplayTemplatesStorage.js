// assetDisplayTemplatesStorage.js
// Browser localStorage-backed persistence for per-asset display template
// overrides (view mode, flow direction, flow wrap, align content) in the
// Now area's Assets tab. Same shape as typeDisplayTemplatesStorage.js, but
// keyed by real asset id rather than type id — a specific asset instance's
// own override, falling back to its type's template when no override has
// ever been saved for that asset (see RelatedAssetBoxContent's resolution
// logic, the single place this fallback is actually applied).

const ASSET_DISPLAY_TEMPLATES_STORAGE_KEY = 'aetherium_asset_display_templates';

export function loadAssetDisplayTemplates() {
  try {
    const raw = window.localStorage.getItem(ASSET_DISPLAY_TEMPLATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetDisplayTemplates(templates) {
  try {
    window.localStorage.setItem(ASSET_DISPLAY_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}
