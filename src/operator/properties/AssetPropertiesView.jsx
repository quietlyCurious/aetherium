// operator/properties/AssetPropertiesView.jsx
// One asset's properties as the Operator sees them: its box (AssetCard,
// through its type's or its own saved display template) inside a
// FitViewport, so a box too big for the space opens zoomed out with zoom
// controls instead of scrolling — the Properties counterpart of Related
// Assets' Cards view. One that fits is drawn exactly as before: the box
// spans the panel, content at 100%.
//
// Used by the Operator's Assets area, and by Configure's Properties tab to
// check and show how that will look on a given display
// (configurator/OperatorFitCheck.jsx) — the same component in both, so the
// check can't drift from what operators get.
//
// A wrapping row of tiles (the default) reflows as it zooms out — wider
// rows, fewer of them; a no-wrap row, a column or a manual layout keeps
// its shape and is shrunk.

import { AssetCard } from '../relatedAssets/AssetCard';
import { FitViewport } from '../../viewport/FitViewport';

// Whether the box's tiles wrap into rows, so zooming out should also give
// them more width — same defaults as AssetCard.
function reflowFor(template) {
  if (template?.layoutMode === 'manual') return null;
  const direction = template?.flowDirection ?? 'row';
  const wrap = template?.flowWrap ?? 'wrap';
  return wrap !== 'nowrap' && !String(direction).startsWith('column') ? 'row' : null;
}

export function AssetPropertiesView({ className = '', onFitChange, ...cardProps }) {
  const { relatedTypeId, relatedTypeExampleAssetId, typeDisplayTemplates, assetDisplayTemplates } = cardProps;
  // The same template AssetCard will use: the asset's own, else its type's.
  const template = assetDisplayTemplates?.[relatedTypeExampleAssetId] ?? typeDisplayTemplates?.[relatedTypeId];
  const manual = template?.layoutMode === 'manual';
  return (
    <FitViewport
      className={`op-properties-viewport ${className}`}
      reflow={reflowFor(template)}
      fillWidth
      resetKey={`${relatedTypeId}|${relatedTypeExampleAssetId}`}
      onFitChange={onFitChange}
    >
      <div className={`op-property-tiles-singlebox${manual ? ' op-property-tiles-singlebox--manual' : ''}`}>
        <AssetCard {...cardProps} />
      </div>
    </FitViewport>
  );
}
