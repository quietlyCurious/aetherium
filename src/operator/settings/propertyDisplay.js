// operator/settings/propertyDisplay.js
// Per-property display vocabulary: the view modes a property tile can take
// (Text / Indicator / Spark / All / None), how a property's own visual
// resolves against its template's default, how asset and type visuals
// merge, and the Show (visibility) cycle used by the Details panel.

export const KPI_VIEW_MODE_ITEMS = [
  { text: 'None', value: 'none' },
  { text: 'Text', value: 'text' },
  { text: 'Indicator', value: 'indicator' },
  { text: 'Spark', value: 'spark' },
  { text: 'All', value: 'all' },
];

// Per-property visual overrides — the Details panel's Visual column. The
// toolbar's view mode (KPI_VIEW_MODE_ITEMS above) stays the default for
// every property without one of these. "None" is deliberately not offered
// per property: hiding a single property is what the Visibility column
// already does, and two separate ways to hide the same thing would just
// be confusing. "None" as the toolbar default still works, though, and
// reads naturally alongside overrides: "show nothing, except the
// properties I've explicitly given a visual."
export const PROPERTY_VIEW_MODE_DEFAULT = 'default';

// Not a visual — the Visual dropdown's action item for an asset row that
// sets its own visual: "↑ Update type to <that visual>". Intercepted in
// onValueChanged and never stored.
export const PROPERTY_VIEW_MODE_UPDATE_TYPE = '__update_type__';

export const PROPERTY_VIEW_MODE_OVERRIDE_ITEMS = KPI_VIEW_MODE_ITEMS.filter(i => i.value !== 'none');

// The one place a single property's effective visual is decided —
// explicit per-property override first, else the template's (or toolbar's)
// shared default. Used by both HmiPropertiesListing (the Configurator's
// editing preview) and RelatedAssetBoxContent (every read-only box), so
// the two can't drift apart.
export function resolvePropertyViewMode(propertyViewModes, key, defaultViewMode) {
  return propertyViewModes?.[key] ?? defaultViewMode;
}

// Per-property visuals merge property by property, asset over type —
// unlike the rest of the display template (viewMode, flow, manual
// layout), which is still all-or-nothing. An asset stores only the
// properties it has explicitly set itself; every other property keeps
// following its type's per-property choice, even after the asset saves a
// template of its own, and even if the type's choice changes later. A
// property set at neither level falls back to the effective template's
// viewMode (the asset's own if it has a template, else its type's). So
// the full precedence for one property is:
//   asset's own choice > type's choice > effective default viewMode.
// Same shape as property visibility, which has always merged this way.
export function mergePropertyViewModes(typeTemplate, assetTemplate) {
  return { ...(typeTemplate?.propertyViewModes || {}), ...(assetTemplate?.propertyViewModes || {}) };
}

export const VISIBILITY_CYCLE = { always: 'sometimes', sometimes: 'never', never: 'always' };

// Related Assets tab uses a deliberately simpler 2-state toggle — no
// "sometimes". Reuses VISIBILITY_LABEL ('Always'/'Never' are already in
// there) and VisibilityStateIcon (its 'sometimes' branch just never
// matches here, so the same icon component works unmodified).
export const RELATED_ASSET_VISIBILITY_CYCLE = { always: 'never', never: 'always' };

export const VISIBILITY_LABEL = { always: 'Always', sometimes: 'Sometimes', never: 'Never' };
