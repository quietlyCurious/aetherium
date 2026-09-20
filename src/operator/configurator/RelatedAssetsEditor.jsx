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
  // PropertyTilesView's propertyLayoutMode: 'manual' swaps in a
  // separate React Flow canvas (AssetCardCanvas, no edges — related-
  // asset boxes don't relate to each other the way types in Diagram do),
  // seeded by measuring the flex view's actual current box positions at
  // the moment of switching so nothing visually jumps.
  const [cardsLayoutMode, setCardsLayoutMode] = useState(savedTemplate?.cardsLayoutMode ?? 'auto');
  const [cardsManualPositions, setCardsManualPositions] = useState(savedTemplate?.cardsManualPositions ?? {});
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
    const measured = {};
    const containerRect = cardsFlexContainerRef.current?.getBoundingClientRect();
    if (containerRect) {
      Object.entries(cardsFlexTileRefs.current).forEach(([key, el]) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        measured[key] = { x: Math.round(rect.left - containerRect.left), y: Math.round(rect.top - containerRect.top) };
      });
    }
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
  // Stable identities — see PropertyTilesView's handleManualPositionsChange.
  const handleCardsPositionsChange = useCallback(positions => {
    unsavedTracker.notePositionsReported('cards', positions);
    setCardsManualPositions(positions);
  }, [unsavedTracker]);
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
  // than a prop threaded into each box: the Diagram and the Cards manual
  // canvas are React Flow graphs whose nodes are seeded from their props,
  // and feeding the selection through there would re-seed them (and, for
  // the Diagram, re-run its layout) on every click. React Flow already
  // stamps each node's id on its wrapper (data-id), and flex cards carry
  // data-related-key, so a selector finds the box without touching it.
  const selectedRow = selectedRelatedKey ? relatedAssetRows.find(r => r.key === selectedRelatedKey) : null;
  const attr = value => JSON.stringify(String(value));
  const selectedBoxSelectors = selectedRow ? (layoutMode === 'diagram'
    ? [`.op-related-assets-preview .react-flow__node[data-id=${attr(selectedRow.relatedTypeId)}] > .op-related-asset-box`]
    : [
      `.op-related-assets-preview .op-related-asset-box[data-related-key=${attr(selectedRow.key)}]`,
      `.op-related-assets-preview .react-flow__node[data-id=${attr(selectedRow.key)}] > .op-related-asset-box`,
    ]) : [];

  // Selecting a row scrolls its box into view (flex cards only — the
  // canvases pan freely, same reasoning as property tiles).
  const previewRootRef = useRef(null);
  useEffect(() => {
    if (!selectedRow || layoutMode === 'diagram' || cardsLayoutMode === 'manual') return;
    previewRootRef.current
      ?.querySelector(`.op-related-asset-box[data-related-key=${attr(selectedRow.key)}]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRelatedKey]);

  // Clicking a box selects its row (or clears the selection, for this
  // asset's own box). Not when the click was really the end of a drag —
  // the canvases move a node under the pointer, so the browser still fires
  // a click on it — and not on a box's title, which navigates to that type.
  const pointerDownAtRef = useRef(null);
  const handleBoxPointerDown = e => { pointerDownAtRef.current = { x: e.clientX, y: e.clientY }; };
  const handleBoxClick = e => {
    if (!onSelectRelated) return;
    const start = pointerDownAtRef.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    if (e.target.closest?.('.op-hmiprops-card-title--clickable, button, .op-hmiprops-toolbar')) return;
    const box = e.target.closest?.('.op-related-asset-box');
    if (!box) return;
    if (box.classList.contains('op-related-asset-box--center')) { onSelectRelated(null); return; }
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
      className={`op-related-assets-preview${onSelectRelated ? ' op-related-assets-preview--selectable' : ''}`}
      onPointerDownCapture={e => { unsavedTracker.noteUserInput(); handleBoxPointerDown(e); }}
      onKeyDownCapture={unsavedTracker.noteUserInput}
      onClick={handleBoxClick}
    >
      {selectedBoxSelectors.length > 0 && (
        <style>{`${selectedBoxSelectors.join(',\n')} { border-color: #0078d4; box-shadow: 0 0 0 2px #0078d4; }`}</style>
      )}
      {showToolbar && (
      <div className="op-hmiprops-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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
          </div>
          <div className="op-tierfilter-slider-wrap" style={{ width: 160, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
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
      {layoutMode === 'cards' ? (
        visibleRows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">No related assets to show at this density.</div>
        ) : (
          <AssetCardsView
            currentTypeId={currentTypeId}
            currentTypeName={currentTypeName}
            currentTypeExampleAssetId={currentTypeExampleAssetId}
            visibleRows={visibleRows}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            cardsLayoutMode={cardsLayoutMode}
            cardsManualPositions={cardsManualPositions}
            onCardsPositionsChange={handleCardsPositionsChange}
            cardsFlexContainerRef={cardsFlexContainerRef}
            cardsFlexTileRefs={cardsFlexTileRefs}
            cardsFlowDirection={cardsFlowDirection}
            cardsFlowWrap={cardsFlowWrap}
            cardsAlignContent={cardsAlignContent}
            cardsLayoutCanvasRef={cardsLayoutCanvasRef}
            onTitleClick={onTitleClick}
          />
        )
      ) : (
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
