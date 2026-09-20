// typeRelatedAssetOrderStorage.js
// Browser localStorage-backed persistence for per-type related-assets
// display order — an array of related-asset row keys per type id, set by
// dragging rows in the Details panel's Related Assets table while a type
// is selected. Same pattern as typePropertyConfigsStorage.js, including
// applying immediately (auto-saved on every change, like the Show column)
// rather than waiting for the title-bar Save.

const TYPE_RELATED_ASSET_ORDER_STORAGE_KEY = 'aetherium_type_related_asset_order';

export function loadTypeRelatedAssetOrders() {
  try {
    const raw = window.localStorage.getItem(TYPE_RELATED_ASSET_ORDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveTypeRelatedAssetOrders(orders) {
  try {
    window.localStorage.setItem(TYPE_RELATED_ASSET_ORDER_STORAGE_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}
