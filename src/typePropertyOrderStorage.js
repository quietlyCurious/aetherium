// typePropertyOrderStorage.js
// Browser localStorage-backed persistence for per-type property display
// order — an array of property keys per type id, set by dragging rows in
// the Details panel's Properties table while a type is selected. Same
// pattern as typePropertyConfigsStorage.js, including applying immediately
// (auto-saved on every change, like the Show column) rather than waiting
// for the title-bar Save.

const TYPE_PROPERTY_ORDER_STORAGE_KEY = 'aetherium_type_property_order';

export function loadTypePropertyOrders() {
  try {
    const raw = window.localStorage.getItem(TYPE_PROPERTY_ORDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveTypePropertyOrders(orders) {
  try {
    window.localStorage.setItem(TYPE_PROPERTY_ORDER_STORAGE_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}
