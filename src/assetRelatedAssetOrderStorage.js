// assetRelatedAssetOrderStorage.js
// Browser localStorage-backed persistence for per-asset related-assets
// display order — the asset-level counterpart of
// typeRelatedAssetOrderStorage.js, keyed by real asset id; replaces its
// type's order as a whole when present. Same pattern as
// typePropertyConfigsStorage.js, including applying immediately (auto-
// saved on every change, like the Show column) rather than waiting for the
// title-bar Save.

const ASSET_RELATED_ASSET_ORDER_STORAGE_KEY = 'aetherium_asset_related_asset_order';

export function loadAssetRelatedAssetOrders() {
  try {
    const raw = window.localStorage.getItem(ASSET_RELATED_ASSET_ORDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetRelatedAssetOrders(orders) {
  try {
    window.localStorage.setItem(ASSET_RELATED_ASSET_ORDER_STORAGE_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}
