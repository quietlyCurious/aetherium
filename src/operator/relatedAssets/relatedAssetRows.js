// operator/relatedAssets/relatedAssetRows.js
// The one definition of "which related assets does this entity show, in
// what order". Every related-assets surface needs the same answer: the
// Configurator's Details grid and its editor preview, and the Operator's
// read-only view. They used to each build it inline, which is how the
// Details grid and the preview beside it could disagree about a row.
//
// Two levels, resolved the same way property visibility is: this asset's
// own choice for a relationship wins, otherwise its type's, otherwise
// "always". assetId is optional — without one, no asset-level entry can
// match, which is exactly the type-level behaviour.

import { getRelatedAssetsForType } from '../model/assetQueries';
import { sortRowsByOrder } from '../settings/displayOrder';

export function buildRelatedAssetRows({ typeId, assetId, typeList, typeRelatedAssetConfigs, assetRelatedAssetConfigs, order }) {
  const typeOverrides = typeRelatedAssetConfigs?.[typeId] || {};
  const assetOverrides = (assetId && assetRelatedAssetConfigs?.[assetId]) || {};
  return sortRowsByOrder(
    getRelatedAssetsForType(typeId, typeList).map(row => ({
      ...row,
      visibility: assetOverrides[row.key] || typeOverrides[row.key] || 'always',
    })),
    order
  );
}

// The density filter's two stops: 'always' shows only the relationships
// marked always, 'all' shows every one regardless of its marking. The
// read-only views have no density control, so they take the default.
export function visibleRelatedAssetRows(rows, density = 'always') {
  return density === 'all' ? rows : rows.filter(r => r.visibility === 'always');
}
