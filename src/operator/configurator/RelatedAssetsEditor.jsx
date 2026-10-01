// operator/configurator/RelatedAssetsEditor.jsx
// The Related Assets tab's editor: the same Cards and Diagram engines the
// Operator sees, plus the toolbar that edits them (view, layout mode,
// flow, density, diagram algorithm and spacing) and the Save handler that
// persists the result as this type's or asset's template.

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { confirm } from 'devextreme/ui/dialog';
import { useUnsavedTracker } from '../../unsavedChangesStore';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import Button from 'devextreme-react/button';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import { IconButtonGroupItem } from '../icons';
import { AssetCardsView } from '../relatedAssets/AssetCardsView';
import { visibleRelatedAssetRows } from '../relatedAssets/relatedAssetRows';
import { AssetDiagramView } from '../relatedAssets/AssetDiagramView';
import { CanvasAlignControls } from '../canvas/CanvasAlignControls';
import { useDiagramSettings, DiagramLayoutControls, DiagramSpacingControls } from './diagramSettings';
import { RELATED_ASSET_DENSITY_VALUES, formatRelatedAssetDensityLabel, RELATED_ASSETS_LAYOUT_MODE_ITEMS, FLOW_DIRECTION_ITEMS, FLOW_WRAP_ITEMS, ALIGN_CONTENT_ITEMS } from '../settings/layoutOptions';
import { viewportScale } from '../../viewport/FitViewport';
import { asCoordPositions, measuredPositions } from '../canvas/manualLayout';
import { OperatorDisplayFrame, OperatorFitCheck, fitCheckDisplays } from './OperatorFitCheck';

// selectedRelatedKey/onSelectRelated: the Details panel's selected Related
// Assets row, shared both ways — selecting a row highlights its box here,
// clicking a box here selects its row there. Same pattern as the
// Properties tab's tile/row selection.
export function RelatedAssetsEditor({ relatedAssetRows, evidencePoints, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, currentTypeId, currentTypeName, currentTypeExampleAssetId, typeList, savedTemplate, onSaveTemplate, activeSaveHandlerRef, onTitleClick, showToolbar, selectedRelatedKey, onSelectRelated }) {
  const [densityFilter, setDensityFilter] = useState('always');
  // Cards (flex-wrapped boxes, genuinely responsive — reflows on resize,
  // unlike the ELK/React Flow diagram canvas which uses fixed pixel
  // positions) vs Diagram (ELK-computed, with relationship edges drawn).
  // Two fundamentally different renderers, not one axis — restored as a
  // real top-level split. All the state below is seeded from savedTemplate
  // when one exists (hydrated once on mount, via key={typeId} at the call
  // site), falling back to the same defaults as before otherwise.
  const [layoutMode, setLayoutMode] = useState(savedTemplate?.layoutMode ?? 'cards');
  // Cards' own auto(flex)/manual(drag) toggle — same pattern as
  // PropertyTilesView's propertyLayoutMode: 'manual' places the boxes by
  // hand (ManualLayoutEditor, the coordinate layout — no edges; related-
  // asset boxes don't relate to each other the way types in Diagram do),
  // seeded by measuring the flex view's actual current box positions at
  // the moment of switching so nothing visually jumps.
  const [cardsLayoutMode, setCardsLayoutMode] = useState(savedTemplate?.cardsLayoutMode ?? 'auto');
  const [cardsManualPositions, setCardsManualPositions] = useState(() => asCoordPositions(savedTemplate?.cardsManualPositions));
  // Cards flex container's own row/column, wrap/no-wrap, and distribute/
  // cluster controls — same three settings and icons PropertyTilesView
  // already uses for arranging property tiles within one box, just one
  // level up (arranging the boxes themselves). Defaults match the
  // container's previous hardcoded behavior (row, wrap) so existing
  // layouts don't visually shift; 'stretch' for alignContent matches
  // the CSS default that was in effect before this had an explicit control.
  const [cardsFlowDirection, setCardsFlowDirection] = useState(savedTemplate?.cardsFlowDirection ?? 'row');
  const [cardsFlowWrap, setCardsFlowWrap] = useState(savedTemplate?.cardsFlowWrap ?? 'wrap');
  const [cardsAlignContent, setCardsAlignContent] = useState(savedTemplate?.cardsAlignContent ?? 'stretch');
  const cardsFlexTileRefs = useRef({});
  const cardsFlexContainerRef = useRef(null);
  const handleSwitchCardsToManual = () => {
    // The flex layout may be drawn zoomed out (FitViewport); on-screen
    // offsets are then scaled, and the saved positions need layout pixels.
    const container = cardsFlexContainerRef.current;
    const measured = measuredPositions(container, cardsFlexTileRefs.current, viewportScale(container), { withWidth: true });
    setCardsManualPositions(current => ({ ...measured, ...current }));
    setCardsLayoutMode('manual');
  };
  const handleResetCardsLayout = () => {
    confirm(
      'This will discard your manual card positions and return to the flex layout. Continue?',
      'Reset to Flex Layout'
    ).then(confirmed => {
      if (!confirmed) return;
      setCardsLayoutMode('auto');
    });
  };
  const diagram = useDiagramSettings(savedTemplate);
  const cardsLayoutCanvasRef = useRef(null);

  // Memoized so the diagram view (which re-runs ELK's layout whenever this
  // array changes) doesn't recompute on every unrelated re-render — only
  // when the underlying rows or the density filter actually change.
  const visibleRows = useMemo(
    () => visibleRelatedAssetRows(relatedAssetRows, densityFilter),
    [relatedAssetRows, densityFilter]
  );
  // What the Operator shows — its own default density, whatever this
  // preview's slider says. For the fit check.
  const operatorRows = useMemo(() => visibleRelatedAssetRows(relatedAssetRows), [relatedAssetRows]);
  // The display the Cards preview is showing as the Operator sees it
  // (OperatorDisplayFrame), or null to fill the pane — where it opens.
  const [previewDisplayId, setPreviewDisplayId] = useState(null);
  const previewDisplay = previewDisplayId ? fitCheckDisplays().find(d => d.id === previewDisplayId) : null;
  // Any layout can be shown on a display. Cards (flex and manual) are shown
  // live — the same editable view, in the frame; Diagram — a React Flow
  // canvas — as a look-only copy with the current draft (dragging inside a
  // shrunk React Flow canvas doesn't track the pointer; edit on Fill pane).
  const showingOperatorView = !!previewDisplay;
  const cardsMode = layoutMode === 'cards';
  // The fit check's invisible copy writes to these; nothing reads them.
  const probeFlexContainerRef = useRef(null);
  const probeFlexTileRefs = useRef({});

  // Unsaved-changes tracking — same as PropertyTilesView's, with two
  // position channels since both Cards and Diagram have a manual mode.
  const relatedUnsavedFields = {
    layoutMode, cardsLayoutMode, cardsFlowDirection, cardsFlowWrap, cardsAlignContent,
    ...diagram.trackedFields,
  };
  const unsavedTracker = useUnsavedTracker(
    relatedUnsavedFields,
    {
      cards: cardsLayoutMode === 'manual' ? cardsManualPositions : null,
      diagram: diagram.layoutMode === 'manual' ? diagram.manualPositions : null,
    },
    !!activeSaveHandlerRef,
  );
  // The diagram reports positions in auto mode too (every ELK run) — only
  // a report made while in manual mode may become the manual baseline.
  const diagramLayoutModeRef = useRef(diagram.layoutMode);
  diagramLayoutModeRef.current = diagram.layoutMode;
  // Every change of card positions is reported; until the user first
  // touches the editor each one just becomes the baseline (see
  // PropertyTilesView). The editor hands over updates as functions.
  useEffect(() => {
    if (cardsLayoutMode === 'manual') unsavedTracker.notePositionsReported('cards', cardsManualPositions);
  }, [unsavedTracker, cardsLayoutMode, cardsManualPositions]);
  const setDiagramManualPositions = diagram.setManualPositions;
  const handleDiagramPositionsChange = useCallback(positions => {
    if (diagramLayoutModeRef.current === 'manual') unsavedTracker.notePositionsReported('diagram', positions);
    setDiagramManualPositions(positions);
  }, [unsavedTracker, setDiagramManualPositions]);

  // The diagram half's settings stand in as one signature, rather than
  // the fifteen-entry dependency list this used to spell out.
  const diagramSignature = JSON.stringify(diagram.templateFields);
  // Registers this tab's save action, same pattern as PropertyTilesView's
  // own registration — whichever of the three Details tabs is currently
  // mounted (matching activeTabIndex) is the one the title-bar Save button
  // actually saves. Cleared on unmount so a stale handler can't linger.
  useEffect(() => {
    if (!activeSaveHandlerRef) return undefined;
    activeSaveHandlerRef.current = () => { onSaveTemplate?.(currentTypeId, {
      layoutMode,
      cardsLayoutMode,
      cardsManualPositions: cardsLayoutMode === 'manual' ? cardsManualPositions : {},
      cardsFlowDirection,
      cardsFlowWrap,
      cardsAlignContent,
      ...diagram.templateFields,
    }); unsavedTracker.markSaved(); };
    return () => { activeSaveHandlerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTypeId, layoutMode, cardsLayoutMode, cardsManualPositions, cardsFlowDirection, cardsFlowWrap, cardsAlignContent, diagramSignature, onSaveTemplate, activeSaveHandlerRef]);

  // ── Box selection ──
  // Which box a row is depends on the layout: Cards (flex and manual) has
  // one box per row, keyed by the row's key; Diagram has one node per
  // related TYPE (rows sharing a type — two different relationships to
  // it — share a node), keyed by relatedTypeId.
  //
  // The highlight is pure CSS, generated for the one selected box, rather
  // than a prop threaded into each box: the Diagram is a React Flow graph
  // whose nodes are seeded from their props, and feeding the selection
  // through there would re-seed them (and re-run its layout) on every
  // click. React Flow stamps each node's id on its wrapper (data-id), and
  // cards (flex and manual) carry data-related-key, so a selector finds the
  // box without touching it.
  const selectedRow = selectedRelatedKey ? relatedAssetRows.find(r => r.key === selectedRelatedKey) : null;
  const attr = value => JSON.stringify(String(value));
  const selectedBoxSelectors = selectedRow ? (layoutMode === 'diagram'
    ? [`.op-related-assets-editor .react-flow__node[data-id=${attr(selectedRow.relatedTypeId)}] > .op-asset-card`]
    : [`.op-related-assets-editor .op-asset-card[data-related-key=${attr(selectedRow.key)}]`]) : [];

  // Selecting a row scrolls its box into view (flex cards only — manual
  // cards and the diagram pan and zoom instead).
  const previewRootRef = useRef(null);
  useEffect(() => {
    if (!selectedRow || layoutMode === 'diagram' || cardsLayoutMode === 'manual') return;
    previewRootRef.current
      ?.querySelector(`.op-asset-card[data-related-key=${attr(selectedRow.key)}]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRelatedKey]);

  // Clicking a box selects its row (or clears the selection, for this
  // asset's own box). Not when the click was really the end of a drag —
  // the canvases move a box under the pointer, so the browser still fires
  // a click on it — and not on a box's title, which navigates to that type.
  const pointerDownAtRef = useRef(null);
  const handleBoxPointerDown = e => { pointerDownAtRef.current = { x: e.clientX, y: e.clientY }; };
  const handleBoxClick = e => {
    if (!onSelectRelated) return;
    const start = pointerDownAtRef.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    if (e.target.closest?.('.op-property-tiles-card-title--clickable, button, .op-property-tiles-toolbar')) return;
    const box = e.target.closest?.('.op-asset-card');
    if (!box) return;
    if (box.classList.contains('op-asset-card--center')) { onSelectRelated(null); return; }
    const flexKey = box.getAttribute('data-related-key');
    const nodeId = box.closest('.react-flow__node')?.getAttribute('data-id');
    const row = flexKey
      ? relatedAssetRows.find(r => r.key === flexKey)
      : relatedAssetRows.find(r => r.key === nodeId) || relatedAssetRows.find(r => r.relatedTypeId === nodeId);
    if (row) onSelectRelated(row.key === selectedRelatedKey ? null : row.key);
  };

  return (
    <div
      ref={previewRootRef}
      className={`op-related-assets-editor${onSelectRelated ? ' op-related-assets-editor--selectable' : ''}`}
      onPointerDownCapture={e => { unsavedTracker.noteUserInput(); handleBoxPointerDown(e); }}
      onKeyDownCapture={unsavedTracker.noteUserInput}
      onClick={handleBoxClick}
    >
      {selectedBoxSelectors.length > 0 && (
        <style>{`${selectedBoxSelectors.join(',\n')} { border-color: #0078d4; box-shadow: 0 0 0 2px #0078d4; }`}</style>
      )}
      {showToolbar && (
      <div className="op-property-tiles-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {/* Row 1: unified badge + reset/switch anchored left (switch button
            always present in flex/auto, reset button always present in
            manual — diagram's own switch button is new here: manual mode
            used to only be reachable by dragging a node or using Align/
            Distribute, this makes it reachable directly too, matching
            Cards' own explicit switch button), density slider anchored
            right. */}
        <div className="op-toolbar-row-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className="op-dash-text"
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: (layoutMode === 'cards' ? cardsLayoutMode : diagram.layoutMode) === 'manual' ? '#fff4e5' : '#e8f4fd',
                color: (layoutMode === 'cards' ? cardsLayoutMode : diagram.layoutMode) === 'manual' ? '#8a5a00' : '#0078d4',
              }}
            >
              {layoutMode === 'cards'
                ? (cardsLayoutMode === 'manual' ? 'Manual Layout' : 'Flex Layout')
                : (diagram.layoutMode === 'manual' ? 'Manual Layout' : 'Auto Layout')}
            </span>
            {layoutMode === 'cards' ? (
              cardsLayoutMode === 'manual' ? (
                <Button text="Reset to Flex Layout" onClick={handleResetCardsLayout} stylingMode="outlined" />
              ) : (
                <Button text="Switch to Manual Layout" onClick={handleSwitchCardsToManual} stylingMode="outlined" />
              )
            ) : (
              diagram.layoutMode === 'manual' ? (
                <Button text="Reset to Auto Layout" onClick={diagram.confirmResetToAuto} stylingMode="outlined" />
              ) : (
                <Button text="Switch to Manual Layout" onClick={diagram.onManualEdit} stylingMode="outlined" />
              )
            )}
            {/* Will this fit the Operator's view, and how does it look on a
                display? (OperatorFitCheck.) Every layout can be previewed;
                the ✓ / % verdict is for Cards (flex and manual), drawn in a
                FitViewport in the Operator; Diagram fits itself. Uses the rows the Operator shows, not this
                preview's density setting. */}
            {operatorRows.length > 0 && (
              <OperatorFitCheck
                view="relatedAssets"
                showingId={previewDisplayId}
                onShow={setPreviewDisplayId}
                renderProbe={cardsMode ? (onFitChange) => (
                  <AssetCardsView
                    currentTypeId={currentTypeId}
                    currentTypeName={currentTypeName}
                    currentTypeExampleAssetId={currentTypeExampleAssetId}
                    visibleRows={operatorRows}
                    typeDisplayTemplates={typeDisplayTemplates}
                    typePropertyConfigs={typePropertyConfigs}
                    assetDisplayTemplates={assetDisplayTemplates}
                    assetPropertyConfigs={assetPropertyConfigs}
                    evidencePoints={evidencePoints}
                    cardsLayoutMode={cardsLayoutMode}
                    cardsManualPositions={cardsManualPositions}
                    cardsFlexContainerRef={probeFlexContainerRef}
                    cardsFlexTileRefs={probeFlexTileRefs}
                    cardsFlowDirection={cardsFlowDirection}
                    cardsFlowWrap={cardsFlowWrap}
                    cardsAlignContent={cardsAlignContent}
                    readOnly
                    onFitChange={onFitChange}
                  />
                ) : undefined}
              />
            )}
          </div>
          <div
            className="op-tierfilter-slider-wrap"
            style={{ width: 160, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0, ...(showingOperatorView ? { opacity: 0.45 } : null) }}
            title={showingOperatorView ? 'The Operator view shows the related assets the Operator shows — this slider applies to Fill pane' : undefined}
          >
            <Slider
              min={0}
              max={1}
              step={1}
              value={RELATED_ASSET_DENSITY_VALUES.indexOf(densityFilter)}
              onValueChanged={e => setDensityFilter(RELATED_ASSET_DENSITY_VALUES[e.value] ?? 'all')}
              className="op-tierfilter-slider"
              style={{ width: '100%' }}
            >
              <SliderLabel visible format={formatRelatedAssetDensityLabel} position="bottom" />
            </Slider>
          </div>
        </div>
        {/* Row 2: Cards/Auto toggle (the top-level view switch, always
            shown) plus the one mode-specific control set — flex settings,
            cards-manual align/distribute/arrange, diagram-auto
            algorithm/direction/routing, or diagram-manual align/distribute
            — never more than one of those four at once. Connection-
            point/arrow/label toggles live back on the canvas itself now
            (top-right panel), not here. Diagram-auto's node/layer/ratio
            sliders are anchored right in this same row, alongside the
            left-anchored group above — same visibility rule as always
            (diagram + auto only), just relocated up from row 3. */}
        <div className="op-toolbar-row-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <ButtonGroup
            keyExpr="value"
            selectedItemKeys={[layoutMode]}
            onItemClick={e => setLayoutMode(e.itemData.value)}
            stylingMode="outlined"
            className="op-dash-chart-toggle"
          >
            {RELATED_ASSETS_LAYOUT_MODE_ITEMS.map(item => (
              <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
            ))}
          </ButtonGroup>
          {layoutMode === 'cards' && cardsLayoutMode === 'auto' && (
            <>
              <ButtonGroup
                keyExpr="value"
                selectedItemKeys={[cardsFlowDirection]}
                onItemClick={e => setCardsFlowDirection(e.itemData.value)}
                stylingMode="outlined"
                className="op-dash-chart-toggle"
              >
                {FLOW_DIRECTION_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup
                keyExpr="value"
                selectedItemKeys={[cardsFlowWrap]}
                onItemClick={e => setCardsFlowWrap(e.itemData.value)}
                stylingMode="outlined"
                className="op-dash-chart-toggle"
              >
                {FLOW_WRAP_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup
                keyExpr="value"
                selectedItemKeys={[cardsAlignContent]}
                onItemClick={e => setCardsAlignContent(e.itemData.value)}
                stylingMode="outlined"
                className="op-dash-chart-toggle"
              >
                {ALIGN_CONTENT_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
            </>
          )}
          {layoutMode === 'cards' && cardsLayoutMode === 'manual' && <CanvasAlignControls canvasRef={cardsLayoutCanvasRef} withArrangeGrid />}
          {layoutMode === 'diagram' && diagram.layoutMode === 'auto' && <DiagramLayoutControls diagram={diagram} />}
          {layoutMode === 'diagram' && diagram.layoutMode === 'manual' && <CanvasAlignControls canvasRef={diagram.canvasRef} />}
          </div>
          {layoutMode === 'diagram' && diagram.layoutMode === 'auto' && <DiagramSpacingControls diagram={diagram} />}
        </div>
      </div>
      )}
      {showingOperatorView && !cardsMode ? (
        // A Diagram on a display: a look-only copy of what the Operator
        // draws (its read-only view), with this draft's settings and
        // positions.
        operatorRows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">The Operator shows no related assets here.</div>
        ) : (
          <OperatorDisplayFrame key={previewDisplay.id} display={previewDisplay} view="relatedAssets" note="look only — edit on Fill pane">
            <AssetDiagramView
              {...diagram.viewProps}
              savedManualPositions={diagram.layoutMode === 'manual' ? diagram.manualPositions : undefined}
              onManualEdit={() => {}}
              currentTypeId={currentTypeId}
              currentTypeName={currentTypeName}
              currentTypeExampleAssetId={currentTypeExampleAssetId}
              visibleRows={operatorRows}
              typeList={typeList}
              allTypesMode={false}
              typeDisplayTemplates={typeDisplayTemplates}
              typePropertyConfigs={typePropertyConfigs}
              assetDisplayTemplates={assetDisplayTemplates}
              assetPropertyConfigs={assetPropertyConfigs}
              evidencePoints={evidencePoints}
              readOnly
            />
          </OperatorDisplayFrame>
        )
      ) : layoutMode === 'cards' ? (() => {
        const rows = showingOperatorView ? operatorRows : visibleRows;
        if (rows.length === 0) {
          return <div className="op-dash-text op-dash-text--muted">{showingOperatorView ? 'The Operator shows no related assets here.' : 'No related assets to show at this density.'}</div>;
        }
        const cards = (
          <AssetCardsView
            currentTypeId={currentTypeId}
            currentTypeName={currentTypeName}
            currentTypeExampleAssetId={currentTypeExampleAssetId}
            visibleRows={rows}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            cardsLayoutMode={cardsLayoutMode}
            cardsManualPositions={cardsManualPositions}
            onCardsPositionsChange={setCardsManualPositions}
            cardsFlexContainerRef={cardsFlexContainerRef}
            cardsFlexTileRefs={cardsFlexTileRefs}
            cardsFlowDirection={cardsFlowDirection}
            cardsFlowWrap={cardsFlowWrap}
            cardsAlignContent={cardsAlignContent}
            cardsLayoutCanvasRef={cardsLayoutCanvasRef}
            onTitleClick={onTitleClick}
          />
        );
        // Keyed by display: each one opens fitted, as the Operator would open
        // it, rather than carrying over a zoom from the last display.
        return showingOperatorView ? <OperatorDisplayFrame key={previewDisplay.id} display={previewDisplay} view="relatedAssets">{cards}</OperatorDisplayFrame> : cards;
      })() : (
        visibleRows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">No related assets to show at this density.</div>
        ) : (
          <AssetDiagramView
            ref={diagram.canvasRef}
            {...diagram.viewProps}
            currentTypeId={currentTypeId}
            currentTypeName={currentTypeName}
            currentTypeExampleAssetId={currentTypeExampleAssetId}
            visibleRows={visibleRows}
            typeList={typeList}
            allTypesMode={false}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            onPositionsChange={handleDiagramPositionsChange}
            onTitleClick={onTitleClick}
          />
        )
      )}
    </div>
  );
}
