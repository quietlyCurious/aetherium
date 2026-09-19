// assetRelatedAssetConfigsStorage.js
// Browser localStorage-backed persistence for per-asset related-asset
// visibility overrides (always/never), set via the icon-cycling buttons in
// the Now area's Assets tab Related Assets list. Same pattern as
// typeRelatedAssetConfigsStorage.js, keyed by real asset id rather than
// type id — merged with the type's own overrides at render time (asset-
// level wins per related-type key when both exist).
//
// Auto-saved on every change, matching typeRelatedAssetConfigsStorage.js's
// own immediate-effect behavior.

const ASSET_RELATED_ASSET_CONFIGS_STORAGE_KEY = 'aetherium_asset_related_asset_configs';

export function loadAssetRelatedAssetConfigs() {
  try {
    const raw = window.localStorage.getItem(ASSET_RELATED_ASSET_CONFIGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetRelatedAssetConfigs(configs) {
  try {
    window.localStorage.setItem(ASSET_RELATED_ASSET_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    return true;
  } catch {
    return false;
  }
}
