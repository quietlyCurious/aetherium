// assetRelatedAssetsTemplatesStorage.js
// Browser localStorage-backed persistence for per-asset Related Assets
// view templates (layout mode, Cards/Diagram settings, manual positions)
// in the Now area's Assets tab. Same shape as
// relatedAssetsTemplatesStorage.js, but keyed by real asset id rather than
// type id — a specific asset's own override, falling back to its type's
// template when no override has ever been saved for that asset.

const ASSET_RELATED_ASSETS_TEMPLATES_STORAGE_KEY = 'aetherium_asset_related_assets_templates';

export function loadAssetRelatedAssetsTemplates() {
  try {
    const raw = window.localStorage.getItem(ASSET_RELATED_ASSETS_TEMPLATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetRelatedAssetsTemplates(templates) {
  try {
    window.localStorage.setItem(ASSET_RELATED_ASSETS_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}
