// designer/screens/generatedCard.jsx
// The card an asset gets when nobody has designed a screen for its type
// yet: the one Visualization already knows how to draw.
//
// Visualization's Properties tab is where a type's properties are given
// their visibility, order and visual (text / indicator / sparkline), and
// operator/relatedAssets/AssetCard.jsx is the component that renders an
// asset through that configuration — the same box the Operator's related-
// assets views draw. A repeater over a mixed asset set would otherwise
// show a placeholder for every type nobody has got to yet; this makes the
// unfinished case useful instead, and it means a screen for a type is an
// improvement on a sensible default rather than a prerequisite.
//
// It reads the same four saved config sets Visualization writes. They're
// read once per repeater mount, not per card — a repeater draws this up to
// `max` times and these are localStorage reads — and never cached beyond
// that, so a change saved in the Visualization area shows up the next time
// you come back to the screen rather than needing a reload.

import { useMemo } from 'react';
import { AssetCard } from '../../operator/relatedAssets/AssetCard';
import { assetTypeIdOf, deslugifyType, getAssetDisplayLabel } from '../../model/assetQueries';
import { CURRENT_ASSET_MAP, CURRENT_TIMESTAMPS } from '../../model/modelData';
import { loadTypeDisplayTemplates } from '../../typeDisplayTemplatesStorage';
import { loadTypePropertyConfigs } from '../../typePropertyConfigsStorage';
import { loadAssetDisplayTemplates } from '../../assetDisplayTemplatesStorage';
import { loadAssetPropertyConfigs } from '../../assetPropertyConfigsStorage';

// What Visualization has saved, read fresh. Callers hold the result for
// as long as they're mounted (see useVisualizationConfigs).
export function visualizationConfigs() {
  return {
    typeDisplayTemplates: loadTypeDisplayTemplates(),
    typePropertyConfigs: loadTypePropertyConfigs(),
    assetDisplayTemplates: loadAssetDisplayTemplates(),
    assetPropertyConfigs: loadAssetPropertyConfigs(),
  };
}

// eslint-disable-next-line react-hooks/exhaustive-deps
export function useVisualizationConfigs() {
  return useMemo(() => visualizationConfigs(), []);
}

// One asset, drawn the way Visualization would draw it. The title is the
// asset's own name rather than its type's: a repeater shows a row of
// these, and which asset each one is is the whole point.
//
// `configs` comes from the repeater so every card in it shares one read;
// without it each card reads for itself, which is what a lone card wants.
export function GeneratedCard({ assetId, configs: given }) {
  const own = useVisualizationConfigs();
  const configs = given || own;
  const asset = CURRENT_ASSET_MAP[assetId];
  // The full available trend, the same choice the Operator's Assets area
  // makes for a box with no particular event window around it.
  const evidencePoints = useMemo(() => (CURRENT_TIMESTAMPS.length
    ? [{ time: CURRENT_TIMESTAMPS[0] }, { time: CURRENT_TIMESTAMPS[CURRENT_TIMESTAMPS.length - 1] }]
    : []), []);
  if (!asset) return null;

  // The "where this came from" line is a tooltip rather than a line of its
  // own: at Tile size a visible caption costs a third of the box, and the
  // repeater's own summary already says which types are on a generated
  // card.
  return (
    <div className="screen-generated-card" title={`Generated from ${deslugifyType(asset.assetType)}'s properties in Visualization`}>
      <div className="op-property-tiles-singlebox">
        <AssetCard
          relatedTypeId={assetTypeIdOf(asset)}
          relatedTypeName={getAssetDisplayLabel(assetId) || asset.name || assetId}
          relatedTypeExampleAssetId={assetId}
          typeDisplayTemplates={configs.typeDisplayTemplates}
          typePropertyConfigs={configs.typePropertyConfigs}
          assetDisplayTemplates={configs.assetDisplayTemplates}
          assetPropertyConfigs={configs.assetPropertyConfigs}
          evidencePoints={evidencePoints}
        />
      </div>
    </div>
  );
}
