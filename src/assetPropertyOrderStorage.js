// assetPropertyOrderStorage.js
// Browser localStorage-backed persistence for per-asset property display
// order — the asset-level counterpart of typePropertyOrderStorage.js,
// keyed by real asset id. An asset's order, when it has one, replaces its
// type's order as a whole (an order is one list, so there's nothing to
// merge property by property). Same pattern as
// typePropertyConfigsStorage.js, including applying immediately (auto-
// saved on every change, like the Show column) rather than waiting for the
// title-bar Save.

const ASSET_PROPERTY_ORDER_STORAGE_KEY = 'aetherium_asset_property_order';

export function loadAssetPropertyOrders() {
  try {
    const raw = window.localStorage.getItem(ASSET_PROPERTY_ORDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveAssetPropertyOrders(orders) {
  try {
    window.localStorage.setItem(ASSET_PROPERTY_ORDER_STORAGE_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}
