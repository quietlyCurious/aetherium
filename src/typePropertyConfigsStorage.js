// typePropertyConfigsStorage.js
// Browser localStorage-backed persistence for per-type property visibility
// overrides (always/sometimes/never), set via the icon-cycling buttons in
// the Now area's Types tab properties table. Same pattern as
// typeDisplayTemplatesStorage.js.
//
// Unlike the display template (which requires an explicit Save action),
// these changes apply immediately when clicked — so this is auto-saved on
// every change, matching that immediate-effect behavior, rather than
// requiring its own separate save step.

const TYPE_PROPERTY_CONFIGS_STORAGE_KEY = 'aetherium_type_property_configs';

export function loadTypePropertyConfigs() {
  try {
    const raw = window.localStorage.getItem(TYPE_PROPERTY_CONFIGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveTypePropertyConfigs(configs) {
  try {
    window.localStorage.setItem(TYPE_PROPERTY_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    return true;
  } catch {
    return false;
  }
}
