// assetPropertyConfigsStorage.js
// Browser localStorage-backed persistence for per-asset property visibility
// overrides (always/sometimes/never), set via the icon-cycling buttons in
// the Now area's Assets tab properties table. Same pattern as
// typePropertyConfigsStorage.js, keyed by real asset id rather than type
// id — merged with the type's own overrides at render time (asset-level
// wins per property when both exist), not a wholesale replacement of them.
//
// Auto-saved on every change, matching typePropertyConfigsStorage.js's own
// immediate-effect behavior.

const ASSET_PROPERTY_CONFIGS_STORAGE_KEY = 'aetherium_asset_property_configs';

export function loadAssetPropertyConfigs() {
  try {
    const raw = window.localStorage.getItem(ASSET_PROPERTY_CONFIGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetPropertyConfigs(configs) {
  try {
    window.localStorage.setItem(ASSET_PROPERTY_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    return true;
  } catch {
    return false;
  }
}
