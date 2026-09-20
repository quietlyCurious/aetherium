// operator/configurator/AllAssetsEditor.jsx
// The All Assets tab: every asset in the model as one diagram, with a
// per-type visibility list beside it. Saves to the single global All
// Assets template rather than to a type or asset.

import { useRef, useCallback, useEffect } from 'react';
import { useUnsavedTracker } from '../../unsavedChangesStore';
import Button from 'devextreme-react/button';
import HierarchyTree from '../../HierarchyTree';
import { VisibilityStateIcon } from '../icons';
import { CURRENT_ASSET_DATA } from '../model/modelData';
import { AssetDiagramView } from '../relatedAssets/AssetDiagramView';
import { CanvasAlignControls } from '../canvas/CanvasAlignControls';
import { useDiagramSettings, DiagramLayoutControls, DiagramSpacingControls } from './diagramSettings';

// The global "All Assets" view — diagram-only (no Cards option), showing
// every type in the current model at once rather than one type's
// immediate relationships. Deliberately not per-type: this is one shared
// view regardless of which type happens to be selected in the tree,
// unlike RelatedAssetsEditor/PropertyTilesView's own templates.
// Its diagram settings and Auto/Manual machinery come from the shared
// useDiagramSettings hook, the same one RelatedAssetsEditor uses — the
// two remain independent, separately saved layouts; only the machinery
// for running them is shared.
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
  const diagram = useDiagramSettings(savedTemplate);

  // Unsaved-changes tracking — same as RelatedAssetsEditor's diagram half,
  // plus hiddenAssetIds (sorted: a Set's order is just toggle order).
  const unsavedTracker = useUnsavedTracker(
    {
      hiddenAssetIds: [...(hiddenAssetIds ?? [])].sort(),
      ...diagram.trackedFields,
    },
    { diagram: diagram.layoutMode === 'manual' ? diagram.manualPositions : null },
    !!activeSaveHandlerRef,
  );
  const diagramLayoutModeRef = useRef(diagram.layoutMode);
  diagramLayoutModeRef.current = diagram.layoutMode;
  const setDiagramManualPositions = diagram.setManualPositions;
  const handleDiagramPositionsChange = useCallback(positions => {
    if (diagramLayoutModeRef.current === 'manual') unsavedTracker.notePositionsReported('diagram', positions);
    setDiagramManualPositions(positions);
  }, [unsavedTracker, setDiagramManualPositions]);

  // Registers this tab's save action, same pattern as RelatedAssetsEditor
  // and PropertyTilesView — this is the global, non-per-type template,
  // so hiddenAssetIds (itself lifted state, not owned here) rides along in
  // the same saved payload rather than needing a separate save action.
  // Re-registers whenever anything the payload contains changes, same
  // as before — the signature stands in for the long dependency list the
  // individual settings used to spell out.
  const diagramSignature = JSON.stringify(diagram.templateFields);
  useEffect(() => {
    if (!activeSaveHandlerRef) return undefined;
    activeSaveHandlerRef.current = () => { onSaveTemplate?.({
      hiddenAssetIds: [...(hiddenAssetIds ?? [])],
      ...diagram.templateFields,
    }); unsavedTracker.markSaved(); };
    return () => { activeSaveHandlerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenAssetIds, diagramSignature, onSaveTemplate, activeSaveHandlerRef]);

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
              background: diagram.layoutMode === 'manual' ? '#fff4e5' : '#e8f4fd',
              color: diagram.layoutMode === 'manual' ? '#8a5a00' : '#0078d4',
            }}
          >
            {diagram.layoutMode === 'manual' ? 'Manual Layout' : 'Auto Layout'}
          </span>
          {diagram.layoutMode === 'manual' ? (
            <Button text="Reset to Auto Layout" onClick={diagram.confirmResetToAuto} stylingMode="outlined" />
          ) : (
            <Button text="Switch to Manual Layout" onClick={diagram.onManualEdit} stylingMode="outlined" />
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
          {diagram.layoutMode === 'auto' && <DiagramLayoutControls diagram={diagram} />}
          {diagram.layoutMode === 'manual' && <CanvasAlignControls canvasRef={diagram.canvasRef} />}
          </div>
          {diagram.layoutMode === 'auto' && <DiagramSpacingControls diagram={diagram} />}
        </div>
      </div>
      )}
      <AssetDiagramView
        ref={diagram.canvasRef}
        {...diagram.viewProps}
        currentTypeId={currentTypeId}
        typeList={typeList}
        allTypesMode
        hiddenAssetIds={hiddenAssetIds}
        typeDisplayTemplates={typeDisplayTemplates}
        typePropertyConfigs={typePropertyConfigs}
        assetDisplayTemplates={assetDisplayTemplates}
        assetPropertyConfigs={assetPropertyConfigs}
        evidencePoints={evidencePoints}
        onPositionsChange={handleDiagramPositionsChange}
        onTitleClick={onTitleClick}
      />
    </div>
  );
}
