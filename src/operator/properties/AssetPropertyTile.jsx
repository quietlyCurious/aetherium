// operator/properties/AssetPropertyTile.jsx
// One of an asset's properties as a PropertyTile, with everything a tile
// needs looked up from the model: label, unit, decimals, range, and the
// sparkline over evidencePoints' time range. Used by AssetCard and by the
// designer's property repeater, so a property's tile looks the same in
// both.

import { getAssetPropertySeries, sliceSeriesToRange } from '../../model/assetQueries';
import { PROPERTY_DECIMALS, PROPERTY_LABELS, PROPERTY_RANGES, PROPERTY_UNITS } from '../../model/modelData';
import { PropertyTile } from './PropertyTile';

export function AssetPropertyTile({ assetId, propertyKey, value, viewMode, evidencePoints }) {
  const range = PROPERTY_RANGES[propertyKey];
  const rangeStart = evidencePoints?.length ? evidencePoints[0].time : null;
  const rangeEnd = evidencePoints?.length ? evidencePoints[evidencePoints.length - 1].time : null;
  const fullSeries = getAssetPropertySeries(assetId, propertyKey);
  const sparkline = (fullSeries && rangeStart && rangeEnd) ? sliceSeriesToRange(fullSeries, rangeStart, rangeEnd) : null;
  return (
    <PropertyTile
      label={PROPERTY_LABELS[propertyKey] || propertyKey}
      value={value}
      min={range ? range[0] : undefined}
      max={range ? range[1] : undefined}
      sparkline={sparkline && sparkline.length > 2 ? sparkline : null}
      unit={PROPERTY_UNITS[propertyKey]}
      decimals={PROPERTY_DECIMALS[propertyKey]}
      horizontal
      labelFirst
      viewMode={viewMode}
      assetId={assetId}
      propertyKey={propertyKey}
    />
  );
}
