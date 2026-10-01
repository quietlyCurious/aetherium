// operator/properties/shownProperties.js
// Which of an asset's properties are shown, in what order, and as what —
// the way Visualization's Properties tab configured them. One definition,
// read by AssetCard (every box of properties the app draws) and by the
// designer's property repeater (designer/screens/screenRepeat.jsx), so a
// screen that repeats an asset's properties shows the same ones, in the
// same order, with the same visuals, as the Operator does.
//
// shownPropertyEntries({ typeId, assetId, properties, configs, displayOrders, include })
//   properties     the asset's values ({ key: value })
//   configs        Visualization's saved configs: typeDisplayTemplates,
//                  typePropertyConfigs, assetDisplayTemplates,
//                  assetPropertyConfigs (generatedCard.visualizationConfigs)
//   displayOrders  useDisplayOrders()
//   include        'always' (default — what the Operator shows: properties
//                  set to Always; all of them when none are), 'sometimes'
//                  (Always and Sometimes) or 'all'
// → { entries: [[key, value]], viewModeOf(key), template, boxViewMode }
//   entries leaves out properties whose visual is None. The template is the
//   asset's own display template, else its type's (all or nothing).

import { getPropertyVisibilityForType } from '../../model/assetQueries';
import { applySavedOrder, categoryOrderedPropertyKeys, resolveEntityOrder } from '../settings/displayOrder';
import { mergePropertyViewModes, resolvePropertyViewMode } from '../settings/propertyDisplay';

const INCLUDED = {
  always: ['always'],
  sometimes: ['always', 'sometimes'],
  all: ['always', 'sometimes', 'never'],
};

export function shownPropertyEntries({ typeId, assetId, properties, configs, displayOrders, include = 'always' }) {
  const { typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs } = configs || {};
  const template = assetDisplayTemplates?.[assetId] ?? typeDisplayTemplates?.[typeId];
  const boxViewMode = template?.viewMode ?? 'text';
  const viewModes = mergePropertyViewModes(typeDisplayTemplates?.[typeId], assetDisplayTemplates?.[assetId]);
  const viewModeOf = key => resolvePropertyViewMode(viewModes, key, boxViewMode);

  const allowed = INCLUDED[include] || INCLUDED.always;
  const visibility = getPropertyVisibilityForType(typeId, properties, typePropertyConfigs || {}, assetId, assetPropertyConfigs);
  const picked = visibility.filter(p => allowed.includes(p.visibility)).map(p => [p.key, properties[p.key]]);
  // Nothing set to Always: show everything rather than an empty box (what
  // AssetCard has always done).
  const unordered = picked.length || include !== 'always' ? picked : Object.entries(properties || {});
  const valueOf = new Map(unordered);
  const order = resolveEntityOrder(displayOrders?.typeProperty, displayOrders?.assetProperty, typeId, assetId);
  const entries = applySavedOrder(categoryOrderedPropertyKeys(unordered.map(([key]) => key)), order)
    .map(key => [key, valueOf.get(key)])
    .filter(([key]) => viewModeOf(key) !== 'none');
  return { entries, viewModeOf, template, boxViewMode, viewModes };
}
