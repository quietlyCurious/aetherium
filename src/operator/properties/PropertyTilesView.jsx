// operator/properties/PropertyTilesView.jsx
// A type's or asset's property listing: grouped PropertyTiles in flex (auto)
// or manual layout, with the tier/visibility filter and layout toolbar.
// Rendered by the Configurator's Properties preview (NowTypeMainPreview),
// where it is also the editor: it registers its own Save handler and
// unsaved tracking for the display template. (The Operator side shows
// properties through AssetCard instead.)

import { useState, useRef, useEffect, useCallback } from 'react';
import { confirm } from 'devextreme/ui/dialog';
import { useUnsavedTracker } from '../../unsavedChangesStore';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import Button from 'devextreme-react/button';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import { IconButtonGroupItem } from '../icons';
import { HMI_CATEGORY_ORDER, getAssetPropertySeries, sliceSeriesToRange } from '../model/assetQueries';
import { PROPERTY_TIERS, PROPERTY_CATEGORIES, PROPERTY_LABELS, PROPERTY_RANGES, PROPERTY_UNITS, PROPERTY_DECIMALS } from '../model/modelData';
import { applySavedOrder } from '../settings/displayOrder';
import { resolvePropertyViewMode, KPI_VIEW_MODE_ITEMS } from '../settings/propertyDisplay';
import { PropertyTileCanvas } from './PropertyTileCanvas';
import { PropertyTile } from './PropertyTile';
import { ALIGN_CONTENT_ITEMS, FLOW_DIRECTION_ITEMS, FLOW_WRAP_ITEMS, GROUPING_MODE_ITEMS, RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS, RELATED_ASSETS_ALIGN_VERTICAL_ITEMS, RELATED_ASSETS_DISTRIBUTE_ITEMS, TIER_FILTER_ITEMS, TIER_FILTER_SLIDER_VALUES, TIER_RANK, formatTierFilterSliderLabel } from '../settings/layoutOptions';

// An asset's (or a type's example asset's) properties as tiles, grouped by
// category. seriesAssetId is the asset whose series feed the sparklines.
// propertyViewModes/selectedPropertyKey/onSelectProperty are type-mode
// only (the Configurator's editing preview) and owned by the caller, not
// here: the Details panel's Visual column edits the same per-property
// visual map and shares the same selected property, and it's a sibling of
// this component, not a child. Undefined everywhere else this renders
// (Investigate), which then behaves exactly as before.
export function PropertyTilesView({ properties: props, seriesAssetId, evidencePoints, typeVisibilityMode, typeId, typePropertyConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, onViewModeChange, activeSaveHandlerRef, showToolbar, propertyViewModes, inheritedPropertyViewModes, selectedPropertyKey, onSelectProperty, propertyOrder }) {
  const savedTemplate = typeVisibilityMode ? typeDisplayTemplates?.[typeId] : null;
  const [kpiViewMode, setKpiViewMode] = useState(savedTemplate?.viewMode ?? 'text');
  // What actually renders: this entity's own per-property choices over
  // whatever it inherits (its type's, when this is an asset — see
  // mergePropertyViewModes). Only the entity's own map is ever saved.
  const effectivePropertyViewModes = inheritedPropertyViewModes
    ? { ...inheritedPropertyViewModes, ...(propertyViewModes || {}) }
    : propertyViewModes;
  const [tierFilter, setTierFilter] = useState(typeVisibilityMode ? 'all' : 'P3');
  const [groupingMode, setGroupingMode] = useState(typeVisibilityMode ? 'none' : 'box');
  const [flowDirection, setFlowDirection] = useState(savedTemplate?.flowDirection ?? 'row');
  const [flowWrap, setFlowWrap] = useState(savedTemplate?.flowWrap ?? 'wrap');
  const [alignContent, setAlignContent] = useState(savedTemplate?.alignContent ?? 'flex-start');
  // 'auto': the flex preview above drives appearance, matching Cards/
  // Diagram rendering everywhere this template is used. 'manual': the
  // PropertyTileCanvas below takes over instead — same properties,
  // freely positioned, no edges. Manual positions are part of the saved
  // template itself (manualPositions below), so they apply everywhere
  // the template is used, not just in this editor.
  const [propertyLayoutMode, setPropertyLayoutMode] = useState(savedTemplate?.layoutMode ?? 'auto');
  const [manualPositions, setManualPositions] = useState(savedTemplate?.manualPositions ?? {});
  const propertyLayoutCanvasRef = useRef(null);
  // Measures the flex preview's actual current tile positions at the
  // moment of switching to manual, so nothing visually jumps — refs are
  // populated by the flex preview's own render below, read once on
  // switch rather than tracked continuously.
  const flexTileRefs = useRef({});
  const flexPreviewContainerRef = useRef(null);

  // The "Visual" column in the sibling properties table needs to know the
  // current view mode, but that state lives here, not there — report it up
  // whenever it changes rather than lifting ownership of the state itself
  // (which would also affect the non-type-mode uses of this component).
  useEffect(() => {
    onViewModeChange?.(kpiViewMode);
  }, [kpiViewMode]);

  // Unsaved-changes tracking (title-bar Save marker + the Save/Discard
  // prompt on navigation) — see useUnsavedTracker. Configurator editing
  // only; everywhere else this component renders there's nothing to save.
  const unsavedTracker = useUnsavedTracker(
    {
      viewMode: kpiViewMode,
      flowDirection,
      flowWrap,
      alignContent,
      layoutMode: propertyLayoutMode,
      propertyViewModes: propertyViewModes ?? {},
    },
    { tiles: propertyLayoutMode === 'manual' ? manualPositions : null },
    !!(typeVisibilityMode && activeSaveHandlerRef),
  );
  // Stable identity matters: the canvases re-report positions from an
  // effect keyed on their callback, so a fresh function every render
  // loops (report → setState → render → new callback → report …).
  const handleManualPositionsChange = useCallback(positions => {
    unsavedTracker.notePositionsReported('tiles', positions);
    setManualPositions(positions);
  }, [unsavedTracker]);

  // Registers "save the current draft" into the shared ref the global
  // title-bar Save button ultimately calls — kept in sync with the same
  // logic the in-panel Save Template button already uses. Cleared on
  // unmount (switching types remounts this component via NowTypeMainPreview's
  // key) so a stale handler for the previous type can't linger. A save
  // also makes the current state the new unsaved-changes baseline.
  useEffect(() => {
    if (!typeVisibilityMode || !activeSaveHandlerRef) return undefined;
    activeSaveHandlerRef.current = () => {
      onSaveTypeDisplayTemplate?.(typeId, buildSavePayload());
      unsavedTracker.markSaved();
    };
    return () => { activeSaveHandlerRef.current = null; };
  }, [typeVisibilityMode, typeId, kpiViewMode, flowDirection, flowWrap, alignContent, propertyLayoutMode, manualPositions, propertyViewModes]);
  function buildSavePayload() {
    return {
      viewMode: kpiViewMode,
      flowDirection,
      flowWrap,
      alignContent,
      layoutMode: propertyLayoutMode,
      manualPositions: propertyLayoutMode === 'manual' ? manualPositions : {},
      // Only this entity's own explicit choices are stored — never the
      // inherited ones (an asset's type's), and never a property left on
      // Default/From type — so later changes to the default or to the
      // type still reach every property this entity never set itself.
      propertyViewModes: propertyViewModes ?? {},
    };
  }

  // Selecting a row in the Details panel scrolls its tile into view here
  // (flex layout only — the manual canvas is freely pannable, so there's
  // no single "into view" to scroll to; the highlight is enough there).
  useEffect(() => {
    if (!selectedPropertyKey) return;
    flexTileRefs.current[selectedPropertyKey]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedPropertyKey]);

  if (!props) {
    return <div className="op-dash-text op-dash-text--muted">No properties available for this item.</div>;
  }

  // Measures the flex preview's real current tile positions at the exact
  // moment of switching, so entering manual mode never causes a visible
  // jump — the alternative (everything starting stacked at the origin)
  // is exactly what this avoids. Existing (possibly unsaved, from
  // earlier in this same editing session) manual positions win over a
  // fresh measurement for any property that already has one.
  const handleSwitchToManualLayout = () => {
    const measured = {};
    const containerRect = flexPreviewContainerRef.current?.getBoundingClientRect();
    if (containerRect) {
      Object.entries(flexTileRefs.current).forEach(([key, el]) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        measured[key] = { x: Math.round(rect.left - containerRect.left), y: Math.round(rect.top - containerRect.top) };
      });
    }
    setManualPositions(current => ({ ...measured, ...current }));
    setPropertyLayoutMode('manual');
  };

  const handleResetPropertyLayout = () => {
    confirm(
      'This will discard your manual property positions and return to the flex layout. Continue?',
      'Reset to Flex Layout'
    ).then(confirmed => {
      if (!confirmed) return;
      setPropertyLayoutMode('auto');
    });
  };

  const rangeStart = evidencePoints && evidencePoints.length ? evidencePoints[0].time : null;
  const rangeEnd = evidencePoints && evidencePoints.length ? evidencePoints[evidencePoints.length - 1].time : null;

  const grouped = {};
  Object.entries(props).forEach(([key, value]) => {
    if (typeVisibilityMode) {
      const overrides = typePropertyConfigs?.[typeId] || {};
      const visibility = overrides[key] || 'always';
      const visible = tierFilter === 'all'
        || (tierFilter === 'sometimes' && (visibility === 'always' || visibility === 'sometimes'))
        || (tierFilter === 'always' && visibility === 'always');
      if (!visible) return;
    } else {
      const tier = PROPERTY_TIERS[key] || 'P3';
      if (TIER_RANK[tier] > TIER_RANK[tierFilter]) return; // below the selected threshold — hidden
    }
    const category = PROPERTY_CATEGORIES[key] || 'Other';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({ key, label: PROPERTY_LABELS[key] || key, value });
  });
  const orderedKnown = HMI_CATEGORY_ORDER.filter(c => grouped[c]);
  const unknownExtra = Object.keys(grouped).filter(c => !HMI_CATEGORY_ORDER.includes(c));
  const categories = [...orderedKnown, ...unknownExtra];

  const kpisClass = `op-property-tiles-kpis${kpiViewMode === 'text' ? ' op-property-tiles-kpis--text' : ''}${kpiViewMode === 'indicator' ? ' op-property-tiles-kpis--indicator' : ''}`;

  // The single-box ("none" grouping) path's tiles, in category order —
  // minus any whose effective visual is None. With no per-property
  // overrides that's all-or-nothing, same as before (toolbar None hides
  // everything); with overrides, toolbar None + a few explicit visuals
  // shows just those few.
  // In type mode, the entity's saved display order (if any) rearranges
  // the category-grouped default — see "Display order".
  const categoryOrderedTiles = categories.flatMap(cat => grouped[cat]);
  const orderedTiles = typeVisibilityMode && propertyOrder
    ? (() => {
      const byKey = new Map(categoryOrderedTiles.map(p => [p.key, p]));
      return applySavedOrder(categoryOrderedTiles.map(p => p.key), propertyOrder).map(k => byKey.get(k));
    })()
    : categoryOrderedTiles;
  const flatTiles = orderedTiles.filter(p => (
    kpiViewMode !== 'none' || (typeVisibilityMode && resolvePropertyViewMode(effectivePropertyViewModes, p.key, kpiViewMode) !== 'none')
  ));

  // Extracted so PropertyTileCanvas's tiles array (built below, for
  // manual mode) computes the exact same range/sparkline props as the
  // flex-rendering path — one source of truth for what a tile shows,
  // regardless of which layout mode is currently active.
  const buildTileProps = p => {
    const range = PROPERTY_RANGES[p.key];
    const fullSeries = seriesAssetId ? getAssetPropertySeries(seriesAssetId, p.key) : null;
    const sparkline = (fullSeries && rangeStart && rangeEnd)
      ? sliceSeriesToRange(fullSeries, rangeStart, rangeEnd)
      : null;
    return {
      label: p.label,
      value: p.value,
      min: range ? range[0] : undefined,
      max: range ? range[1] : undefined,
      sparkline: sparkline && sparkline.length > 2 ? sparkline : null,
      unit: PROPERTY_UNITS[p.key],
      decimals: PROPERTY_DECIMALS[p.key],
      horizontal: true,
      labelFirst: true,
      // Per-property override wins over the toolbar's shared default —
      // type mode only; everywhere else propertyViewModes is undefined, so
      // this reduces to kpiViewMode exactly as before.
      viewMode: typeVisibilityMode ? resolvePropertyViewMode(effectivePropertyViewModes, p.key, kpiViewMode) : kpiViewMode,
    };
  };

  const renderTile = p => <PropertyTile key={p.key} {...buildTileProps(p)} />;

  // Applied unconditionally whenever type-properties mode is active,
  // regardless of which flowDirection/flowWrap combination is selected —
  // general flexbox rules (flex-direction, flex-wrap) then determine the
  // actual layout based on real available space, rather than any
  // combination-specific styling.
  const typeFlowActive = typeVisibilityMode;

  return (
    <div
      className={`op-property-tiles-wrap${typeFlowActive ? ' op-property-tiles-wrap--typeflow' : ''}`}
      onPointerDownCapture={unsavedTracker.noteUserInput}
      onKeyDownCapture={unsavedTracker.noteUserInput}
    >
      {typeVisibilityMode ? (
        showToolbar && (
          <div className="op-property-tiles-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {/* Row 1: badge + reset/switch button anchored left, tier filter anchored right. */}
            <div className="op-toolbar-row-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {groupingMode === 'none' && (
                  <>
                    <span
                      className="op-dash-text"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        background: propertyLayoutMode === 'manual' ? '#fff4e5' : '#e8f4fd',
                        color: propertyLayoutMode === 'manual' ? '#8a5a00' : '#0078d4',
                      }}
                    >
                      {propertyLayoutMode === 'manual' ? 'Manual Layout' : 'Flex Layout'}
                    </span>
                    {propertyLayoutMode === 'manual' ? (
                      <Button text="Reset to Flex Layout" onClick={handleResetPropertyLayout} stylingMode="outlined" />
                    ) : (
                      <Button text="Switch to Manual Layout" onClick={handleSwitchToManualLayout} stylingMode="outlined" />
                    )}
                  </>
                )}
              </div>
              <div className="op-tierfilter-slider-wrap" style={{ width: 220, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
                <Slider
                  min={0}
                  max={2}
                  step={1}
                  value={TIER_FILTER_SLIDER_VALUES.indexOf(tierFilter)}
                  onValueChanged={e => setTierFilter(TIER_FILTER_SLIDER_VALUES[e.value] ?? 'all')}
                  className="op-tierfilter-slider"
                  style={{ width: '100%' }}
                >
                  <SliderLabel visible format={formatTierFilterSliderLabel} position="bottom" />
                </Slider>
              </div>
            </div>
            {/* Row 2: viz-type (orthogonal to flex vs. manual, always
                shown) plus the one mode-specific control set — flex's own
                flow controls, or manual's own align/distribute/arrange —
                never both, since they act on fundamentally different
                things (flex CSS properties vs. actual node positions on
                the canvas). */}
            <div className="op-toolbar-row-2" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              {groupingMode === 'none' && (
                <ButtonGroup
                  items={KPI_VIEW_MODE_ITEMS}
                  keyExpr="value"
                  selectedItemKeys={[kpiViewMode]}
                  onItemClick={e => setKpiViewMode(e.itemData.value)}
                  stylingMode="outlined"
                  className="op-dash-chart-toggle"
                />
              )}
              {groupingMode === 'none' && propertyLayoutMode === 'manual' ? (
                <>
                  <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => propertyLayoutCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                    {RELATED_ASSETS_ALIGN_VERTICAL_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                  <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => propertyLayoutCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                    {RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                  <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => propertyLayoutCanvasRef.current?.distribute(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                    {RELATED_ASSETS_DISTRIBUTE_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                  <Button text="Arrange in Grid" onClick={() => propertyLayoutCanvasRef.current?.arrangeGrid()} stylingMode="outlined" />
                </>
              ) : groupingMode === 'none' && (
                <>
                  <ButtonGroup
                    keyExpr="value"
                    selectedItemKeys={[flowDirection]}
                    onItemClick={e => setFlowDirection(e.itemData.value)}
                    stylingMode="outlined"
                    className="op-dash-chart-toggle"
                  >
                    {FLOW_DIRECTION_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                  <ButtonGroup
                    keyExpr="value"
                    selectedItemKeys={[flowWrap]}
                    onItemClick={e => setFlowWrap(e.itemData.value)}
                    stylingMode="outlined"
                    className="op-dash-chart-toggle"
                  >
                    {FLOW_WRAP_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                  <ButtonGroup
                    keyExpr="value"
                    selectedItemKeys={[alignContent]}
                    onItemClick={e => setAlignContent(e.itemData.value)}
                    stylingMode="outlined"
                    className="op-dash-chart-toggle"
                  >
                    {ALIGN_CONTENT_ITEMS.map(item => (
                      <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                    ))}
                  </ButtonGroup>
                </>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="op-property-tiles-toolbar">
          <>
            <ButtonGroup
              items={KPI_VIEW_MODE_ITEMS}
              keyExpr="value"
              selectedItemKeys={[kpiViewMode]}
              onItemClick={e => setKpiViewMode(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle"
            />
            <ButtonGroup
              items={TIER_FILTER_ITEMS}
              keyExpr="value"
              selectedItemKeys={[tierFilter]}
              onItemClick={e => setTierFilter(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle"
            />
            <ButtonGroup
              items={GROUPING_MODE_ITEMS}
              keyExpr="value"
              selectedItemKeys={[groupingMode]}
              onItemClick={e => setGroupingMode(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle"
            />
          </>
        </div>
      )}
      {categories.length === 0 ? (
        <div className="op-dash-text op-dash-text--muted">
          {typeVisibilityMode ? `No properties marked "${tierFilter}"` : `No ${tierFilter} properties for this asset.`}
        </div>
      ) : groupingMode === 'box' ? (
        <div className={`op-property-tiles${kpiViewMode === 'text' ? ' op-property-tiles--text' : ''}${kpiViewMode === 'indicator' ? ' op-property-tiles--indicator' : ''}`}>
          {categories.map(cat => (
            <div key={cat} className="op-property-tiles-card">
              <div className="op-property-tiles-card-title">{cat}</div>
              <div className={kpisClass}>
                {grouped[cat].map(renderTile)}
              </div>
            </div>
          ))}
        </div>
      ) : groupingMode === 'none' ? (
        flatTiles.length === 0 ? (
          <div className="op-property-tiles-singlebox">
            <div className="op-dash-text op-dash-text--muted">No properties shown (view mode: None).</div>
          </div>
        ) : typeVisibilityMode && propertyLayoutMode === 'manual' ? (
          <div className="op-property-tiles-singlebox op-property-tiles-singlebox--typeflow">
            <PropertyTileCanvas
              ref={propertyLayoutCanvasRef}
              tiles={flatTiles.map(p => ({ key: p.key, tileProps: buildTileProps(p), selected: p.key === selectedPropertyKey }))}
              manualPositions={manualPositions}
              onPositionsChange={handleManualPositionsChange}
              onSelectTile={onSelectProperty}
            />
          </div>
        ) : (
          <div className={`op-property-tiles-singlebox${kpiViewMode === 'text' ? ' op-property-tiles--text' : ''}${kpiViewMode === 'indicator' ? ' op-property-tiles--indicator' : ''}${typeFlowActive ? ' op-property-tiles-singlebox--typeflow' : ''}`}>
            <div
              ref={flexPreviewContainerRef}
              className={`${kpisClass}${typeVisibilityMode && flowDirection === 'row' ? ' op-property-tiles-kpis--flowrow' : ''}${typeFlowActive ? ' op-property-tiles-kpis--typeflow' : ''}`}
              style={typeVisibilityMode ? { flexDirection: flowDirection, flexWrap: flowWrap, alignContent } : undefined}
            >
              {flatTiles.map(p => (
                <div
                  key={p.key}
                  ref={el => { flexTileRefs.current[p.key] = el; }}
                  className={onSelectProperty ? `op-property-tile-select${p.key === selectedPropertyKey ? ' op-property-tile-select--selected' : ''}` : undefined}
                  onClick={onSelectProperty ? () => onSelectProperty(p.key === selectedPropertyKey ? null : p.key) : undefined}
                >
                  <PropertyTile {...buildTileProps(p)} />
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="op-property-tiles-singlebox">
          <div className={`op-property-tiles${kpiViewMode === 'text' ? ' op-property-tiles--text' : ''}${kpiViewMode === 'indicator' ? ' op-property-tiles--indicator' : ''}`}>
            {categories.map(cat => (
              <div key={cat} className="op-property-tiles-card op-property-tiles-card--noborder">
                <div className="op-property-tiles-card-title">{cat}</div>
                <div className={kpisClass}>
                  {grouped[cat].map(renderTile)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
