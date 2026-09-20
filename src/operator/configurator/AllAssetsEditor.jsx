// operator/configurator/AllAssetsEditor.jsx
// The All Assets tab: every asset in the model as one diagram, with a
// per-type visibility list beside it. Saves to the single global All
// Assets template rather than to a type or asset.

import { useState, useRef, useCallback, useEffect } from 'react';
import { confirm } from 'devextreme/ui/dialog';
import { useUnsavedTracker } from '../../unsavedChangesStore';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import Button from 'devextreme-react/button';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import HierarchyTree from '../../HierarchyTree';
import { VisibilityStateIcon, IconButtonGroupItem } from '../icons';
import { CURRENT_ASSET_DATA } from '../model/modelData';
import { AssetDiagramView } from '../relatedAssets/AssetDiagramView';
import { RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS, RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS, RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS, RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS, RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS } from '../relatedAssets/elkLayout';
import { RELATED_ASSETS_ALIGN_VERTICAL_ITEMS, RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS, RELATED_ASSETS_DISTRIBUTE_ITEMS } from '../settings/layoutOptions';

// The global "All Assets" view — diagram-only (no Cards option), showing
// every type in the current model at once rather than one type's
// immediate relationships. Deliberately not per-type: this is one shared
// view regardless of which type happens to be selected in the tree,
// unlike RelatedAssetsEditor/PropertyTilesView's own templates.
// Mirrors RelatedAssetsEditor's Diagram-mode settings and Auto/Manual
// machinery directly (same shape of state, same handlers) rather than
// sharing a component with it, since the two are independent, separately
// intended-to-be-saved layouts.
// All Assets' visibility tree — lives in the Details panel now. Every
// real asset instance in the current model, in its actual containment
// hierarchy (plant/train/stage/equipment) via HierarchyTree — the same
// component the Now area's own (not-yet-built) Assets tab already uses
// elsewhere in this file, so a tree is the established pattern for
// browsing this hierarchy, not a new one invented just for this list.
// hiddenAssetIds/onToggleAssetVisibility are lifted state
// (OperatorWorkspaceInner), shared with AllAssetsEditor below rather
// than owned here, since the two halves are now separate components in
// separate panels.
function AllAssetsVisibilityItem({ hiddenAssetIds, onToggleAssetVisibility }) {
  return (item) => {
    const hidden = hiddenAssetIds.has(item.id);
    return (
      <div className="op-all-assets-tree-row">
        <span className="op-all-assets-tree-row-name">{item.name}</span>
        <button
          className="op-visibility-cycle-btn"
          title={hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
          onClick={(e) => { e.stopPropagation(); onToggleAssetVisibility(item.id); }}
        >
          <VisibilityStateIcon visibility={hidden ? 'never' : 'always'} />
        </button>
      </div>
    );
  };
}

export function AllAssetsTypeList({ hiddenAssetIds, onToggleAssetVisibility }) {
  return (
    <div className="op-now-type-props-list">
      <HierarchyTree
        dataSource={CURRENT_ASSET_DATA}
        displayExpr="name"
        itemRender={AllAssetsVisibilityItem({ hiddenAssetIds, onToggleAssetVisibility })}
        selectedId={null}
        onSelect={() => {}}
      />
    </div>
  );
}

// All Assets' diagram — the visual playground half, living in the center
// preview now. Owns its own diagram settings locally (algorithm, spacing,
// etc. — purely "how to render," not persisted configuration), but
// hiddenAssetIds itself is a prop, shared with AllAssetsTypeList above.
export function AllAssetsEditor({ typeList, currentTypeId, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, savedTemplate, onSaveTemplate, activeSaveHandlerRef, onTitleClick, showToolbar }) {
  const [diagramAlgorithm, setDiagramAlgorithm] = useState(savedTemplate?.diagramAlgorithm ?? 'layered');
  const [diagramDirection, setDiagramDirection] = useState(savedTemplate?.diagramDirection ?? 'RIGHT');
  const [diagramEdgeRouting, setDiagramEdgeRouting] = useState(savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL');
  const [diagramNodeSpacing, setDiagramNodeSpacing] = useState(savedTemplate?.diagramNodeSpacing ?? 40);
  const [diagramLayerSpacing, setDiagramLayerSpacing] = useState(savedTemplate?.diagramLayerSpacing ?? 80);
  const [diagramAspectRatio, setDiagramAspectRatio] = useState(savedTemplate?.diagramAspectRatio ?? 8);
  const [diagramShowLabels, setDiagramShowLabels] = useState(savedTemplate?.diagramShowLabels ?? 'hidden');
  const [diagramShowArrowheads, setDiagramShowArrowheads] = useState(savedTemplate?.diagramShowArrowheads ?? 'shown');
  const [diagramConnectionPointMode, setDiagramConnectionPointMode] = useState(savedTemplate?.diagramConnectionPointMode ?? 'center');
  const [diagramLayoutMode, setDiagramLayoutMode] = useState(savedTemplate?.diagramLayoutMode ?? 'auto');
  const [diagramLayoutResetSignal, setDiagramLayoutResetSignal] = useState(0);
  // Working copy of the diagram's current node positions — same reasoning
  // as RelatedAssetsEditor's diagramManualPositions above.
  const [diagramManualPositions, setDiagramManualPositions] = useState(savedTemplate?.diagramManualPositions ?? {});
  const diagramCanvasRef = useRef(null);
  const handleManualEdit = () => setDiagramLayoutMode('manual');
  const handleConfirmResetToAuto = () => {
    confirm(
      `This will discard your manual positioning and re-run the ${RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS.find(a => a.value === diagramAlgorithm)?.label ?? diagramAlgorithm} layout. Continue?`,
      'Reset to Auto Layout'
    ).then(confirmed => {
      if (!confirmed) return;
      setDiagramLayoutMode('auto');
      setDiagramLayoutResetSignal(s => s + 1);
    });
  };

  // Unsaved-changes tracking — same as RelatedAssetsEditor's diagram half,
  // plus hiddenAssetIds (sorted: a Set's order is just toggle order).
  const unsavedTracker = useUnsavedTracker(
    {
      hiddenAssetIds: [...(hiddenAssetIds ?? [])].sort(),
      diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing,
      diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutMode,
    },
    { diagram: diagramLayoutMode === 'manual' ? diagramManualPositions : null },
    !!activeSaveHandlerRef,
  );
  const diagramLayoutModeRef = useRef(diagramLayoutMode);
  diagramLayoutModeRef.current = diagramLayoutMode;
  const handleDiagramPositionsChange = useCallback(positions => {
    if (diagramLayoutModeRef.current === 'manual') unsavedTracker.notePositionsReported('diagram', positions);
    setDiagramManualPositions(positions);
  }, [unsavedTracker]);

  // Registers this tab's save action, same pattern as RelatedAssetsEditor
  // and PropertyTilesView — this is the global, non-per-type template,
  // so hiddenAssetIds (itself lifted state, not owned here) rides along in
  // the same saved payload rather than needing a separate save action.
  useEffect(() => {
    if (!activeSaveHandlerRef) return undefined;
    activeSaveHandlerRef.current = () => { onSaveTemplate?.({
      hiddenAssetIds: [...(hiddenAssetIds ?? [])],
      diagramAlgorithm,
      diagramDirection,
      diagramEdgeRouting,
      diagramNodeSpacing,
      diagramLayerSpacing,
      diagramAspectRatio,
      diagramShowLabels,
      diagramShowArrowheads,
      diagramConnectionPointMode,
      diagramLayoutMode,
      diagramManualPositions: diagramLayoutMode === 'manual' ? diagramManualPositions : {},
    }); unsavedTracker.markSaved(); };
    return () => { activeSaveHandlerRef.current = null; };
  }, [hiddenAssetIds, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutMode, diagramManualPositions, onSaveTemplate, activeSaveHandlerRef]);

  return (
    <div className="op-dashboard-card op-now-type-kpi-card op-related-assets-preview" onPointerDownCapture={unsavedTracker.noteUserInput} onKeyDownCapture={unsavedTracker.noteUserInput}>
      {showToolbar && (
      <div className="op-hmiprops-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {/* Row 1: badge + reset button, anchored left — no slider here (All
            Assets has no density concept, visibility is per-type via the
            Details panel instead), so this row has no right-anchored partner. */}
        <div className="op-toolbar-row-1" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="op-dash-text"
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: diagramLayoutMode === 'manual' ? '#fff4e5' : '#e8f4fd',
              color: diagramLayoutMode === 'manual' ? '#8a5a00' : '#0078d4',
            }}
          >
            {diagramLayoutMode === 'manual' ? 'Manual Layout' : 'Auto Layout'}
          </span>
          {diagramLayoutMode === 'manual' ? (
            <Button text="Reset to Auto Layout" onClick={handleConfirmResetToAuto} stylingMode="outlined" />
          ) : (
            <Button text="Switch to Manual Layout" onClick={handleManualEdit} stylingMode="outlined" />
          )}
        </div>
        {/* Row 2: the one mode-specific control set — diagram-auto
            algorithm/direction/routing, or diagram-manual align/distribute
            — never both. Connection-point/arrow/label toggles live back
            on the canvas itself now (top-right panel), not here.
            Diagram-auto's node/layer/ratio sliders are anchored right in
            this same row — same visibility rule as always, just relocated
            up from row 3. */}
        <div className="op-toolbar-row-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          {diagramLayoutMode === 'auto' && (
            <>
              <ButtonGroup
                keyExpr="value"
                selectedItemKeys={[diagramAlgorithm]}
                onItemClick={e => setDiagramAlgorithm(e.itemData.value)}
                stylingMode="outlined"
                className="op-dash-chart-toggle"
              >
                {RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              {RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS.has(diagramAlgorithm) && (
                <ButtonGroup
                  keyExpr="value"
                  selectedItemKeys={[diagramDirection]}
                  onItemClick={e => setDiagramDirection(e.itemData.value)}
                  stylingMode="outlined"
                  className="op-dash-chart-toggle"
                >
                  {RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS.map(item => (
                    <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                  ))}
                </ButtonGroup>
              )}
              {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagramAlgorithm) && (
                <ButtonGroup
                  keyExpr="value"
                  selectedItemKeys={[diagramEdgeRouting]}
                  onItemClick={e => setDiagramEdgeRouting(e.itemData.value)}
                  stylingMode="outlined"
                  className="op-dash-chart-toggle"
                >
                  {RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS.map(item => (
                    <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                  ))}
                </ButtonGroup>
              )}
            </>
          )}
          {diagramLayoutMode === 'manual' && (
            <>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => diagramCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_ALIGN_VERTICAL_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => diagramCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => diagramCanvasRef.current?.distribute(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_DISTRIBUTE_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
            </>
          )}
          </div>
          {diagramLayoutMode === 'auto' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
                <Slider
                  min={0}
                  max={200}
                  step={1}
                  value={diagramNodeSpacing}
                  onValueChanged={e => setDiagramNodeSpacing(e.value)}
                  valueChangeMode="onHandleRelease"
                  className="op-tierfilter-slider"
                  style={{ width: '100%' }}
                >
                  <SliderLabel visible format={v => `Nodes: ${v}`} position="bottom" />
                </Slider>
              </div>
              {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagramAlgorithm) && (
                <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
                  <Slider
                    min={0}
                    max={200}
                    step={1}
                    value={diagramLayerSpacing}
                    onValueChanged={e => setDiagramLayerSpacing(e.value)}
                    valueChangeMode="onHandleRelease"
                    className="op-tierfilter-slider"
                    style={{ width: '100%' }}
                  >
                    <SliderLabel visible format={v => `Layers: ${v}`} position="bottom" />
                  </Slider>
                </div>
              )}
              {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagramAlgorithm) && (
                <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
                  <Slider
                    min={0.2}
                    max={8}
                    step={0.1}
                    value={diagramAspectRatio}
                    onValueChanged={e => setDiagramAspectRatio(e.value)}
                    valueChangeMode="onHandleRelease"
                    className="op-tierfilter-slider"
                    style={{ width: '100%' }}
                  >
                    <SliderLabel visible format={v => `Ratio: ${v.toFixed(1)}`} position="bottom" />
                  </Slider>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}
      <AssetDiagramView
        ref={diagramCanvasRef}
        currentTypeId={currentTypeId}
        typeList={typeList}
        allTypesMode
        hiddenAssetIds={hiddenAssetIds}
        typeDisplayTemplates={typeDisplayTemplates}
        typePropertyConfigs={typePropertyConfigs}
        assetDisplayTemplates={assetDisplayTemplates}
        assetPropertyConfigs={assetPropertyConfigs}
        evidencePoints={evidencePoints}
        diagramAlgorithm={diagramAlgorithm}
        diagramDirection={diagramDirection}
        diagramEdgeRouting={diagramEdgeRouting}
        diagramNodeSpacing={diagramNodeSpacing}
        diagramLayerSpacing={diagramLayerSpacing}
        diagramAspectRatio={diagramAspectRatio}
        diagramShowLabels={diagramShowLabels}
        diagramShowArrowheads={diagramShowArrowheads}
        diagramConnectionPointMode={diagramConnectionPointMode}
        diagramLayoutResetSignal={diagramLayoutResetSignal}
        onManualEdit={handleManualEdit}
        setDiagramShowLabels={setDiagramShowLabels}
        setDiagramShowArrowheads={setDiagramShowArrowheads}
        setDiagramConnectionPointMode={setDiagramConnectionPointMode}
        onPositionsChange={handleDiagramPositionsChange}
        savedManualPositions={savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined}
        onTitleClick={onTitleClick}
      />
    </div>
  );
}
