// widgetPropertyOverridesStorage.js
// Browser localStorage-backed persistence for the Widgets area's edits:
// per widget, the full list of properties the designer should expose
// instead of the shipped one in widgetProperties.js.
//   { [widgetName]: { properties: def[], savedAt: ISO string } }
// Read and written only by designer/widgets/widgetPropertyDefs.js.

const WIDGET_PROPERTY_OVERRIDES_STORAGE_KEY = 'aetherium_widget_property_overrides';

export function loadWidgetPropertyOverrides() {
  try {
    const raw = window.localStorage.getItem(WIDGET_PROPERTY_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return {};
  }
}

export function saveWidgetPropertyOverrides(overrides) {
  try {
    window.localStorage.setItem(WIDGET_PROPERTY_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
    return true;
  } catch {
    return false;
  }
}
