// operator/relatedAssets/AssetDiagramView.jsx
// The related-assets node-link diagram (React Flow + ELK): the current
// asset and its related assets (or, in All Assets mode, every asset in the
// model) as AssetCard nodes joined by floating edges. Auto
// layout via elkLayout, or manual positioning with align/distribute; its
// imperative ref exposes the positions and actions the toolbar needs.

import { forwardRef, useState, useRef, useEffect, useMemo, useImperativeHandle } from 'react';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import notify from 'devextreme/ui/notify';
import Button from 'devextreme-react/button';
import { useInternalNode, getStraightPath, getSmoothStepPath, getBezierPath, BaseEdge, Handle, ReactFlowProvider, useNodesState, useEdgesState, useNodesInitialized, useReactFlow, MarkerType, ReactFlow, Background, Panel } from '@xyflow/react';
import { IconButtonGroupItem } from '../icons';
import { getAllAssetRelationshipsForModel, CONTAINMENT_EDGE_STYLE } from '../../model/assetQueries';
import { alignSelectedNodes, distributeSelectedNodes, getFloatingEdgeParams } from '../canvas/canvasGeometry';
import { AssetCard } from './AssetCard';
import { RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS, getElkLayoutedElements } from './elkLayout';
import { RELATED_ASSETS_CONNECTION_POINT_ITEMS, RELATED_ASSETS_SHOW_ARROWHEADS_ITEMS, RELATED_ASSETS_SHOW_LABELS_ITEMS } from '../settings/layoutOptions';

// Always used now — "Fixed Sides" mode (one fixed Handle position per
// node regardless of where the other end of a given edge actually was)
// has been removed; every edge now finds its own real closest side.
// Computes its own path directly from real node geometry (via the
// functions above) instead of a fixed Handle position, then draws it
// using whichever path shape (curved/rounded angles/hard angles/
// straight) is currently selected — data.edgeType carries that choice
// through, since this bypasses React Flow's own defaultEdgeOptions-
// driven type switching. data.connectionPointMode carries the
// Anywhere/Center choice through the same way.
function AssetDiagramFloatingEdge({ id, source, target, markerEnd, style, label, data }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(sourceNode, targetNode, data?.connectionPointMode);
  const edgeType = data?.edgeType ?? 'default';
  let path, labelX, labelY;
  if (edgeType === 'straight') {
    [path, labelX, labelY] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
  } else if (edgeType === 'step') {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos, borderRadius: 0 });
  } else if (edgeType === 'smoothstep') {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos });
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos });
  }

  return <BaseEdge id={id} path={path} labelX={labelX} labelY={labelY} label={label} markerEnd={markerEnd} style={style} />;
}

// Defined once at module scope, same reasoning as RELATED_ASSETS_NODE_TYPES below.
const RELATED_ASSETS_EDGE_TYPES = { floatingEdge: AssetDiagramFloatingEdge };

// React Flow's built-in default node type comes with handles already —
// a custom type (needed here to reuse the Cards view's real property
// rendering, via AssetCard) must add its own explicitly, per
// React Flow's own custom-node docs. Both a target and source handle are
// always present regardless of whether this particular node happens to
// use both in the current graph, since the same node reused elsewhere
// might need the other one.
function AssetDiagramNode({ data }) {
  const effectiveTemplate = data.assetDisplayTemplates?.[data.relatedTypeExampleAssetId] ?? data.typeDisplayTemplates?.[data.relatedTypeId];
  const isManual = effectiveTemplate?.layoutMode === 'manual';
  return (
    <div className={`op-asset-card${data.isCenter ? ' op-asset-card--center' : ''}${isManual ? ' op-asset-card--manual' : ''}`}>
      <Handle type="target" position={data.targetHandlePosition} />
      <AssetCard
        relatedTypeId={data.relatedTypeId}
        relatedTypeName={data.relatedTypeName}
        relatedTypeExampleAssetId={data.relatedTypeExampleAssetId}
        typeDisplayTemplates={data.typeDisplayTemplates}
        typePropertyConfigs={data.typePropertyConfigs}
        assetDisplayTemplates={data.assetDisplayTemplates}
        assetPropertyConfigs={data.assetPropertyConfigs}
        evidencePoints={data.evidencePoints}
        onTitleClick={data.onTitleClick}
        onGearClick={data.onGearClick}
      />
      <Handle type="source" position={data.sourceHandlePosition} />
    </div>
  );
}

// Defined once at module scope — React Flow warns (and can misbehave) if
// nodeTypes is a fresh object on every render.
const RELATED_ASSETS_NODE_TYPES = { relatedAssetNode: AssetDiagramNode };

// Related Assets tab's relational-diagram view — the current type plus its
// related assets as a node-link diagram, auto-laid-out via ELK. Self-
// contained ReactFlowProvider so this can be dropped in anywhere without
// the caller needing to remember to wrap it.
export const AssetDiagramView = forwardRef(function AssetDiagramView({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeList, allTypesMode, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutResetSignal, onManualEdit, setDiagramShowLabels, setDiagramShowArrowheads, setDiagramConnectionPointMode, onPositionsChange, savedManualPositions, readOnly, onTitleClick, onGearClick }, ref) {
  return (
    <ReactFlowProvider>
      <AssetDiagramViewInner
        ref={ref}
        currentTypeId={currentTypeId}
        currentTypeName={currentTypeName}
        currentTypeExampleAssetId={currentTypeExampleAssetId}
        visibleRows={visibleRows}
        typeList={typeList}
        allTypesMode={allTypesMode}
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
        onManualEdit={onManualEdit}
        setDiagramShowLabels={setDiagramShowLabels}
        setDiagramShowArrowheads={setDiagramShowArrowheads}
        setDiagramConnectionPointMode={setDiagramConnectionPointMode}
        onPositionsChange={onPositionsChange}
        savedManualPositions={savedManualPositions}
        readOnly={readOnly}
        onTitleClick={onTitleClick}
        onGearClick={onGearClick}
      />
    </ReactFlowProvider>
  );
});

const AssetDiagramViewInner = forwardRef(function AssetDiagramViewInner({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeList, allTypesMode, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutResetSignal, onManualEdit, setDiagramShowLabels, setDiagramShowArrowheads, setDiagramConnectionPointMode, onPositionsChange, savedManualPositions, readOnly, onTitleClick, onGearClick }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  // NodePositionChange (dragging:false marks the drag settling) is a
  // completely distinct change type from NodeDimensionChange (React
  // Flow's own ResizeObserver-driven measurement) — verified against
  // React Flow's own type reference before relying on this, so a node
  // simply being measured can never be mistaken for the user moving it.
  const handleNodesChange = (changes) => {
    if (changes.some(c => c.type === 'position' && c.dragging === false)) {
      onManualEdit();
    }
    onNodesChange(changes);
  };
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const nodesInitialized = useNodesInitialized();
  const { getNodes } = useReactFlow();
  // Some ELK algorithms can't handle every graph shape — Radial's
  // recursive tree-based traversal, for one, blows the call stack on a
  // graph with a genuine cycle (verified directly: reproduced the exact
  // crash calling elkjs's own radial algorithm on wastewater's real
  // Model-scope graph, which has the RAS return-line cycle; layered,
  // mrtree, force, and stress all handled the same graph fine). Rather
  // than let that propagate into an uncaught rejection, this holds a
  // message to show instead of a blank/broken canvas.
  const [layoutError, setLayoutError] = useState(null);
  // Bumped every time the underlying type/related-assets data changes,
  // seeding a fresh, hidden, unpositioned generation of nodes. The layout
  // effect below tracks a "signature" combining this generation with the
  // current algorithm/direction choice, and only re-runs ELK when that
  // combination actually changes — so switching layouts to compare them
  // re-flows the existing (already-measured, already-visible) nodes
  // straight to their new positions, rather than re-hiding everything and
  // re-measuring from scratch each time.
  const generationRef = useRef(0);
  const laidOutSignatureRef = useRef(null);
  // Tracks whether savedManualPositions has already been applied this
  // mount, so restoring a saved manual layout only happens once (on
  // initial load) rather than fighting the user's own dragging afterward.
  const appliedSavedPositionsRef = useRef(false);

  const isVertical = diagramDirection === 'DOWN';
  const targetHandlePosition = isVertical ? 'top' : 'left';
  const sourceHandlePosition = isVertical ? 'bottom' : 'right';

  // Pass 1: seed a fresh, hidden, unpositioned generation of nodes/edges
  // whenever the underlying data changes. No width/height forced here —
  // each node renders at its own natural, content-based size (title +
  // PropertyTiles) so React Flow can measure the real thing, not a guess.
  // Related Assets always uses the 'focused' shape below (current type
  // plus its immediate related assets) — All Assets uses allTypesMode,
  // every real asset instance across the whole current model (not a
  // type-level abstraction), filtered by hiddenAssetIds, with every
  // instance of the currently-selected type (if any appear and aren't
  // themselves hidden) still marked isCenter for orientation in a bigger
  // graph.
  useEffect(() => {
    generationRef.current += 1;
    let rawNodes;
    let rawEdges;

    if (allTypesMode) {
      const { nodes: modelNodes, edges: modelEdges } = getAllAssetRelationshipsForModel();
      const visibleModelNodes = modelNodes.filter(n => !hiddenAssetIds?.has(n.assetId));
      const visibleAssetIds = new Set(visibleModelNodes.map(n => n.assetId));
      rawNodes = visibleModelNodes.map(n => ({
        id: n.assetId,
        type: 'relatedAssetNode',
        data: {
          isCenter: n.typeId === currentTypeId,
          relatedTypeId: n.typeId,
          relatedTypeName: n.assetName,
          relatedTypeExampleAssetId: n.assetId,
          typeDisplayTemplates,
          typePropertyConfigs,
          assetDisplayTemplates,
          assetPropertyConfigs,
          evidencePoints,
          targetHandlePosition,
          sourceHandlePosition,
          onTitleClick,
          onGearClick,
        },
        position: { x: 0, y: 0 },
        style: { visibility: 'hidden' },
      }));
      rawEdges = modelEdges
        .filter(e => visibleAssetIds.has(e.sourceAssetId) && visibleAssetIds.has(e.targetAssetId))
        .map(e => ({
          id: e.key,
          source: e.sourceAssetId,
          target: e.targetAssetId,
          label: e.relationshipLabel,
          style: e.isContainment ? CONTAINMENT_EDGE_STYLE : undefined,
        }));
    } else {
      rawNodes = [
        {
          id: currentTypeId,
          type: 'relatedAssetNode',
          data: {
            isCenter: true,
            relatedTypeId: currentTypeId,
            relatedTypeName: currentTypeName,
            relatedTypeExampleAssetId: currentTypeExampleAssetId,
            typeDisplayTemplates,
            typePropertyConfigs,
            assetDisplayTemplates,
            assetPropertyConfigs,
            evidencePoints,
            targetHandlePosition,
            sourceHandlePosition,
            onTitleClick,
            onGearClick,
          },
          position: { x: 0, y: 0 },
          style: { visibility: 'hidden' },
        },
        ...visibleRows.map(row => ({
          id: row.relatedTypeId,
          type: 'relatedAssetNode',
          data: {
            isCenter: false,
            relatedTypeId: row.relatedTypeId,
            relatedTypeName: row.relatedTypeName,
            relatedTypeExampleAssetId: row.relatedTypeExampleAssetId,
            typeDisplayTemplates,
            typePropertyConfigs,
            assetDisplayTemplates,
            assetPropertyConfigs,
            evidencePoints,
            targetHandlePosition,
            sourceHandlePosition,
            onTitleClick,
            onGearClick,
          },
          position: { x: 0, y: 0 },
          style: { visibility: 'hidden' },
        })),
      ];
      // relationshipLabel already carries a →/← prefix for the cards
      // view's own display — stripped here since the edge's source/target
      // order conveys direction natively in a diagram, so keeping both
      // would be redundant.
      rawEdges = visibleRows.map(row => ({
        id: row.key,
        source: row.direction === 'out' ? currentTypeId : row.relatedTypeId,
        target: row.direction === 'out' ? row.relatedTypeId : currentTypeId,
        label: row.relationshipLabel.replace(/^[→←]\s*/, ''),
        style: row.isContainment ? CONTAINMENT_EDGE_STYLE : undefined,
      }));
    }

    setNodes(rawNodes);
    setEdges(rawEdges);
    // Deliberately NOT depending on diagramAlgorithm/diagramDirection/
    // targetHandlePosition/sourceHandlePosition — changing just the
    // layout choice is handled by the effect below, reusing these same
    // nodes rather than re-seeding (and re-hiding) them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTypesMode, hiddenAssetIds, currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeList, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, setNodes, setEdges]);

  // Layout effect: runs ELK and reveals the result whenever either (a) a
  // fresh generation just got seeded above and needs its first layout, or
  // (b) the algorithm/direction choice changed for the current
  // generation. Case (a) needs nodesInitialized (nothing to measure yet);
  // case (b) reuses each node's already-known measured size directly, so
  // there's no hide/reveal flicker — nodes flow straight to their new
  // positions. Avoids the "flash of nodes stacked in the corner, then
  // jump to final position" issue documented in xyflow's own community
  // discussions (xyflow/xyflow#2973) for any measurement-dependent
  // layout on first paint.
  useEffect(() => {
    const signature = `${generationRef.current}::${diagramAlgorithm}::${diagramDirection}::${diagramEdgeRouting}::${diagramNodeSpacing}::${diagramLayerSpacing}::${diagramAspectRatio}::${diagramLayoutResetSignal}`;
    if (laidOutSignatureRef.current === signature) return;
    const currentNodes = getNodes();
    const isFirstLayoutForThisGeneration = laidOutSignatureRef.current === null
      || !laidOutSignatureRef.current.startsWith(`${generationRef.current}::`);
    if (isFirstLayoutForThisGeneration && !nodesInitialized) return;
    if (currentNodes.length === 0) return;
    const sizedNodes = currentNodes.map(n => ({
      ...n,
      width: n.measured?.width ?? n.width,
      height: n.measured?.height ?? n.height,
      data: { ...n.data, targetHandlePosition, sourceHandlePosition },
    }));
    getElkLayoutedElements(sizedNodes, edges, {
      algorithm: diagramAlgorithm,
      direction: diagramDirection,
      edgeRouting: diagramEdgeRouting,
      nodeSpacing: diagramNodeSpacing,
      layerSpacing: diagramLayerSpacing,
      aspectRatio: diagramAspectRatio,
    }).then(({ nodes: laidOutNodes, edges: laidOutEdges }) => {
      // A newer generation (or a further layout-option change) may have
      // started while this ELK call was in flight. Discard this stale
      // result rather than overwriting newer data.
      const currentSignature = `${generationRef.current}::${diagramAlgorithm}::${diagramDirection}::${diagramEdgeRouting}::${diagramNodeSpacing}::${diagramLayerSpacing}::${diagramAspectRatio}::${diagramLayoutResetSignal}`;
      if (signature !== currentSignature) return;
      laidOutSignatureRef.current = signature;
      setLayoutError(null);
      // width/height are stripped here — React Flow 12 uses those fields
      // as literal inline styles pinning the node's rendered size, which
      // is exactly what caused this component's content to spill outside
      // its box: a related type's own properties template can switch to
      // manual positioning (needing more room) at any time, completely
      // independent of this diagram's own layout runs, so a node's size
      // pinned to whatever ELK measured at the last layout pass goes
      // stale the moment that happens. Without an explicit size, React
      // Flow re-measures each node against its actual current content on
      // every render instead.
      setNodes(laidOutNodes.map(({ width, height, measured, ...n }) => ({ ...n, style: { visibility: 'visible' } })));
      // Every edge now renders via AssetDiagramFloatingEdge (computing
      // its own path from real node geometry) rather than React Flow's
      // defaultEdgeOptions-driven type — that component reads which
      // path shape to use from data.edgeType. Edge type is fixed to
      // 'step' (hard angles) throughout, no longer a choice.
      // Label/arrowhead visibility and connection-point mode are applied
      // separately below (displayedEdges) since none of them affect
      // ELK's own layout — no need to re-run it for any of those.
      setEdges(laidOutEdges.map(e => ({ ...e, type: 'floatingEdge', data: { ...e.data, edgeType: 'step' } })));
    }).catch(err => {
      // Radial's recursive traversal can't handle a graph with a genuine
      // cycle (verified directly against elkjs itself) — rather than an
      // uncaught rejection leaving a blank or stale canvas, surface this
      // clearly and leave whatever was already visible in place.
      laidOutSignatureRef.current = signature;
      setLayoutError(`The ${RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS.find(a => a.value === diagramAlgorithm)?.label ?? diagramAlgorithm} layout couldn't handle this graph (${err.message}). Try a different algorithm.`);
    });
  }, [nodesInitialized, edges, getNodes, setNodes, setEdges, diagramAlgorithm, diagramDirection, targetHandlePosition, sourceHandlePosition, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramLayoutResetSignal]);

  // None of these three affect ELK's own layout at all — label and
  // arrowhead visibility are pure rendering choices, and connection-
  // point mode only changes where along the already-determined closest
  // side AssetDiagramFloatingEdge lands (see getFloatingEdgeParams) —
  // so all three are applied here, at render time, rather than
  // triggering a re-layout the way algorithm/spacing/etc. do above.
  const displayedEdges = useMemo(
    () => edges.map(e => ({
      ...e,
      label: diagramShowLabels === 'shown' ? e.label : undefined,
      markerEnd: diagramShowArrowheads === 'shown' ? { type: MarkerType.ArrowClosed, color: '#5a5a5a' } : undefined,
      data: { ...e.data, connectionPointMode: diagramConnectionPointMode },
    })),
    [edges, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode]
  );

  // Reports the current working position of every node up to the parent
  // on every change, mirroring PropertyLayoutCanvasInner/CardsLayoutCanvasInner's
  // own onPositionsChange — lets a Save action capture whatever manual
  // arrangement currently exists, without this component needing to know
  // anything about saving itself.
  useEffect(() => {
    if (!onPositionsChange) return;
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
  }, [nodes, onPositionsChange]);

  // Restores a previously-saved manual layout once, right after the
  // initial ELK auto-layout reveals the nodes — deliberately simple
  // (accept one visible snap from auto to saved positions on load) rather
  // than threading saved positions into the seeding effect itself, which
  // would risk destabilizing the generation/signature tracking that
  // effect already carefully manages. onManualEdit() then flips the
  // parent's mode to match what's actually being shown.
  useEffect(() => {
    if (appliedSavedPositionsRef.current) return;
    if (!savedManualPositions || Object.keys(savedManualPositions).length === 0) return;
    if (nodes.length === 0 || nodes.some(n => n.style?.visibility === 'hidden')) return;
    appliedSavedPositionsRef.current = true;
    setNodes(current => current.map(n => (
      savedManualPositions[n.id] ? { ...n, position: savedManualPositions[n.id] } : n
    )));
    onManualEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, savedManualPositions]);

  // Captures the current, actual on-screen arrangement (including any
  // manual dragging) as plain JSON — node id/position/size and each
  // edge's source/target — so it can be copied out and shared/analyzed
  // outside the app, or eventually reloaded as a saved layout.
  const handleCopyLayout = () => {
    const layoutData = {
      nodes: nodes.map(n => ({
        id: n.id,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        width: Math.round(n.measured?.width ?? n.width ?? 0),
        height: Math.round(n.measured?.height ?? n.height ?? 0),
      })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
    };
    navigator.clipboard.writeText(JSON.stringify(layoutData, null, 2)).then(() => {
      notify('Layout copied to clipboard', 'success', 2000);
    }).catch(() => {
      notify('Could not copy — clipboard access blocked', 'error', 3000);
    });
  };

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify('Select at least 2 nodes to align (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    onManualEdit();
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify('Select at least 3 nodes to distribute (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    onManualEdit();
    setNodes(result);
  };

  // Align/Distribute moved to the parent toolbar (RelatedAssetsEditor's
  // own manual-mode row, alongside the connection-point/arrow/label
  // toggles, which already lived one level up as lifted state) — the
  // parent needs a way to actually trigger these here.
  useImperativeHandle(ref, () => ({
    align: handleAlign,
    distribute: handleDistribute,
  }));

  return (
    <div className="op-related-assets-diagram">
      {layoutError && (
        <div className="op-dash-text op-dash-text--muted" style={{ padding: 16 }}>{layoutError}</div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={displayedEdges}
        nodeTypes={RELATED_ASSETS_NODE_TYPES}
        edgeTypes={RELATED_ASSETS_EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        defaultEdgeOptions={{ type: 'step', style: { strokeWidth: 3 } }}
        minZoom={0.05}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        elementsSelectable={!readOnly}
      >
        <Background color="#b0b0b0" />
        {!readOnly && (
          <>
            <Panel position="top-left">
              <Button text="Copy Layout" onClick={handleCopyLayout} stylingMode="outlined" />
            </Panel>
            <Panel position="top-right">
              <div style={{ display: 'flex', gap: 6, background: '#fff', padding: 6, borderRadius: 4, border: '1px solid #e5e5e5' }}>
                <ButtonGroup keyExpr="value" selectedItemKeys={[diagramConnectionPointMode]} onItemClick={e => setDiagramConnectionPointMode(e.itemData.value)} stylingMode="outlined">
                  {RELATED_ASSETS_CONNECTION_POINT_ITEMS.map(item => (
                    <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                  ))}
                </ButtonGroup>
                <ButtonGroup keyExpr="value" selectedItemKeys={[diagramShowArrowheads]} onItemClick={e => setDiagramShowArrowheads(e.itemData.value)} stylingMode="outlined">
                  {RELATED_ASSETS_SHOW_ARROWHEADS_ITEMS.map(item => (
                    <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                  ))}
                </ButtonGroup>
                <ButtonGroup keyExpr="value" selectedItemKeys={[diagramShowLabels]} onItemClick={e => setDiagramShowLabels(e.itemData.value)} stylingMode="outlined">
                  {RELATED_ASSETS_SHOW_LABELS_ITEMS.map(item => (
                    <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                  ))}
                </ButtonGroup>
              </div>
            </Panel>
          </>
        )}
      </ReactFlow>
    </div>
  );
});
