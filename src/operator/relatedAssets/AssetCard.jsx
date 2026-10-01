// operator/relatedAssets/AssetCard.jsx
// One asset's box: its title plus its visible properties as PropertyTiles.
// Used by every related-assets view (Cards, manual Cards, Diagram
// nodes, the All Assets diagram), in the Configurator and the Operator
// alike.
//
// The asset-over-type fallback for display — display template (whole
// template), property visuals (per-key merge), property visibility and
// order — is operator/properties/shownProperties.js, shared with the
// designer's property repeater. New per-asset display options should
// extend the resolution there rather than being special-cased per view.

import { createContext, useContext } from 'react';
import { GearIcon } from '../icons';
import { getAssetProperties, getAssetPropertySeries } from '../../model/assetQueries';
import { useDisplayOrders } from '../settings/displayOrder';
import { mergePropertyViewModes } from '../settings/propertyDisplay';
import { AssetPropertyTile } from '../properties/AssetPropertyTile';
import { shownPropertyEntries } from '../properties/shownProperties';
import { ManualLayoutView } from '../canvas/ManualLayoutView';

// See usage in AssetCard below and the time-track scrubber in
// InvestigatePanel's Related Assets tab, the only place this is provided.
export const TimeScrubContext = createContext(null);

// Renders a related type's title plus its "always"-visible properties as
// PropertyTiles, using that type's own saved display template — the single
// source of truth for a related asset's content, shared by the Cards
// view's boxes (wrapped in .op-asset-card) and the Diagram view's
// custom node (wrapped differently, with Handles added around it).
export function AssetCard({ relatedTypeId, relatedTypeName, relatedTypeExampleAssetId, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, onTitleClick, onGearClick }) {
  // Before any early return — hooks can't be conditional.
  const displayOrders = useDisplayOrders();
  // Only set when this box renders inside InvestigatePanel's Related
  // Assets tab with its time-track scrubber active — null (the default,
  // everywhere else this component is used) means no override, render the
  // normal current/latest snapshot exactly as before.
  const scrubTimeIndex = useContext(TimeScrubContext);

  // Shared across all three render branches below (none/manual/auto) so
  // the click wiring lives in one place. Present in every context this
  // component renders in — the Properties tab's own single box included,
  // where clicking just re-navigates to the same thing already open, a
  // harmless no-op — since there's no reason to special-case "is this the
  // thing I'm already viewing" when the result is identical either way.
  const titleElement = (
    <div
      className={`op-property-tiles-card-title${onTitleClick ? ' op-property-tiles-card-title--clickable' : ''}${onGearClick ? ' op-property-tiles-card-title--with-gear' : ''}`}
      onClick={onTitleClick ? () => onTitleClick({ relatedTypeId, relatedTypeExampleAssetId }) : undefined}
    >
      {relatedTypeName}
    </div>
  );
  // The gear icon — Operator's Assets area only (onGearClick is never
  // passed from Visualization's own call sites), jumping from an asset's
  // real-values box straight to the config screen that shaped it:
  // Visualization's Properties tab for that asset's type. Absolutely
  // positioned against the outer box (op-asset-card/
  // op-property-tiles-singlebox, both given position:relative for exactly this)
  // rather than placed next to the title text, so it sits in the box's
  // own corner regardless of how long that title is — stopPropagation so
  // clicking it doesn't also fire the title's own onClick underneath, or
  // bubble into a React Flow node click in the Diagram/Cards-manual
  // contexts this box also renders inside.
  const gearElement = onGearClick ? (
    <button
      type="button"
      className="op-asset-card-gear"
      title="Open properties template"
      onClick={e => { e.stopPropagation(); onGearClick({ relatedTypeId }); }}
    >
      <GearIcon />
    </button>
  ) : null;

  // What's shown, in what order, as what — Visualization's configuration
  // for this asset (operator/properties/shownProperties.js): this asset's
  // own saved template wins over its type's, all or nothing; per-property
  // visuals merge asset over type; visibility is the Properties tab's
  // Always / Sometimes / Never (asset over type), not the data-driven tier.
  const effectiveTemplate = assetDisplayTemplates?.[relatedTypeExampleAssetId] ?? typeDisplayTemplates?.[relatedTypeId];

  // "None" — just the name, nothing else. Checked first, ahead of even
  // resolving properties, since None's whole point is not needing them —
  // unless some properties have their own explicit visual, in which case
  // None is just the default for the rest and those few still show.
  const boxViewMode = effectiveTemplate?.viewMode ?? 'text';
  const boxPropertyViewModes = mergePropertyViewModes(typeDisplayTemplates?.[relatedTypeId], assetDisplayTemplates?.[relatedTypeExampleAssetId]);
  if (boxViewMode === 'none' && !Object.values(boxPropertyViewModes).some(m => m && m !== 'none')) {
    return <>{titleElement}{gearElement}</>;
  }

  const staticProperties = getAssetProperties(relatedTypeExampleAssetId);
  if (!staticProperties) return null;

  // When a time-track scrub is active, show each property's own reading at
  // that instant instead of the current/latest snapshot — pulled from the
  // exact same per-property series the sparklines already use, so this is
  // real historical data, not a simulated/interpolated stand-in. A
  // property with no series at that source keeps its static value rather
  // than disappearing.
  const properties = scrubTimeIndex == null ? staticProperties : Object.fromEntries(
    Object.entries(staticProperties).map(([key, staticValue]) => {
      const series = getAssetPropertySeries(relatedTypeExampleAssetId, key);
      const scrubbedValue = series?.[scrubTimeIndex];
      return [key, typeof scrubbedValue === 'number' ? scrubbedValue : staticValue];
    })
  );

  const { entries: entriesToShow, viewModeOf: tileViewMode, template } = shownPropertyEntries({
    typeId: relatedTypeId,
    assetId: relatedTypeExampleAssetId,
    properties,
    configs: { typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs },
    displayOrders,
  });
  const boxFlowDirection = template?.flowDirection ?? 'row';
  const boxFlowWrap = template?.flowWrap ?? 'wrap';
  const boxAlignContent = template?.alignContent ?? 'flex-start';
  const boxKpisClass = `op-asset-card-kpis${boxViewMode === 'text' ? ' op-asset-card-kpis--text' : ''}${boxViewMode === 'indicator' ? ' op-asset-card-kpis--indicator' : ''}`;

  const boxLayoutMode = template?.layoutMode ?? 'auto';
  const boxManualPositions = template?.manualPositions ?? {};

  const renderPropertyTile = ([key, value]) => (
    <AssetPropertyTile
      key={key}
      assetId={relatedTypeExampleAssetId}
      propertyKey={key}
      value={value}
      viewMode={tileViewMode(key)}
      evidencePoints={evidencePoints}
    />
  );

  // Manual layout: each tile at its saved position (set in the Properties
  // tab), drawn the way the editor draws it — ManualLayoutView, the
  // coordinate layout read-only, sized to the tiles as they really are.
  // A tile with no position yet (made visible since the layout was saved)
  // goes in the first free spot, as it does in the editor.
  if (boxLayoutMode === 'manual') {
    return (
      <>
        {titleElement}
        {gearElement}
        <ManualLayoutView
          items={entriesToShow.map(entry => ({ key: entry[0], content: renderPropertyTile(entry) }))}
          positions={boxManualPositions}
        />
      </>
    );
  }

  return (
    <>
      {titleElement}
      {gearElement}
      <div
        className={boxKpisClass}
        style={{ flexDirection: boxFlowDirection, flexWrap: boxFlowWrap, alignContent: boxAlignContent }}
      >
        {entriesToShow.map(renderPropertyTile)}
      </div>
    </>
  );
}
