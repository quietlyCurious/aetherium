// typeRelatedAssetConfigsStorage.js
// Browser localStorage-backed persistence for per-type related-asset
// visibility overrides (always/never — no "sometimes" here, a deliberately
// simpler 2-state toggle than the properties table's 3-state one), set via
// the icon-cycling buttons in the Now area's Related Assets tab. Same
// pattern as typePropertyConfigsStorage.js.
//
// Auto-saved on every change (no separate Save step), matching the
// properties table's visibility toggle — these apply instantly when
// clicked.

const TYPE_RELATED_ASSET_CONFIGS_STORAGE_KEY = 'aetherium_type_related_asset_configs';

export function loadTypeRelatedAssetConfigs() {
  try {
    const raw = window.localStorage.getItem(TYPE_RELATED_ASSET_CONFIGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveTypeRelatedAssetConfigs(configs) {
  try {
    window.localStorage.setItem(TYPE_RELATED_ASSET_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    return true;
  } catch {
    return false;
  }
}
