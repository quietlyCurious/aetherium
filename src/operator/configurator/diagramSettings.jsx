// operator/configurator/diagramSettings.jsx
// Everything the two diagram editors (RelatedAssetsEditor and
// AllAssetsEditor) need to own a diagram's settings, in one place: the
// state itself, the Auto/Manual switch, and the toolbar controls that
// edit it. Both editors had their own identical copy of all of this,
// which is how a control could get added to one diagram and not the
// other.
//
// useDiagramSettings hands back the pieces already shaped for their three
// consumers: `trackedFields` for useUnsavedTracker, `templateFields` for
// the Save payload, and `viewProps` to spread onto AssetDiagramView. What
// stays with the caller is everything not about the diagram — the cards
// half of RelatedAssetsEditor, All Assets' hiddenAssetIds.

import { useState, useRef } from 'react';
import { confirm } from 'devextreme/ui/dialog';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import { IconButtonGroupItem } from '../icons';
import {
  RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS,
  RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS,
  RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS,
  RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS,
  RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS,
} from '../relatedAssets/elkLayout';

export function useDiagramSettings(savedTemplate) {
  const [algorithm, setAlgorithm] = useState(savedTemplate?.diagramAlgorithm ?? 'layered');
  const [direction, setDirection] = useState(savedTemplate?.diagramDirection ?? 'RIGHT');
  const [edgeRouting, setEdgeRouting] = useState(savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL');
  const [nodeSpacing, setNodeSpacing] = useState(savedTemplate?.diagramNodeSpacing ?? 40);
  const [layerSpacing, setLayerSpacing] = useState(savedTemplate?.diagramLayerSpacing ?? 80);
  const [aspectRatio, setAspectRatio] = useState(savedTemplate?.diagramAspectRatio ?? 8);
  const [showLabels, setShowLabels] = useState(savedTemplate?.diagramShowLabels ?? 'hidden');
  const [showArrowheads, setShowArrowheads] = useState(savedTemplate?.diagramShowArrowheads ?? 'shown');
  const [connectionPointMode, setConnectionPointMode] = useState(savedTemplate?.diagramConnectionPointMode ?? 'center');
  // 'auto': layout-affecting controls are live, ELK drives node positions.
  // 'manual': entered the instant the user drags a node or uses Align/
  // Distribute (onManualEdit) — layout-affecting controls become disabled
  // until the user explicitly confirms leaving manual mode via the Reset
  // button, which increments layoutResetSignal to force a fresh ELK
  // computation even if no other setting changed.
  const [layoutMode, setLayoutMode] = useState(savedTemplate?.diagramLayoutMode ?? 'auto');
  const [layoutResetSignal, setLayoutResetSignal] = useState(0);
  // Working copy of the diagram's current node positions, kept in sync
  // via AssetDiagramView's onPositionsChange — read at save time and fed
  // back in as savedManualPositions on the next load, so a manual
  // arrangement survives a type switch or a page refresh.
  const [manualPositions, setManualPositions] = useState(savedTemplate?.diagramManualPositions ?? {});
  const canvasRef = useRef(null);

  const onManualEdit = () => setLayoutMode('manual');

  const confirmResetToAuto = () => {
    confirm(
      `This will discard your manual positioning and re-run the ${RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS.find(a => a.value === algorithm)?.label ?? algorithm} layout. Continue?`,
      'Reset to Auto Layout'
    ).then(confirmed => {
      if (!confirmed) return;
      setLayoutMode('auto');
      setLayoutResetSignal(s => s + 1);
    });
  };

  // What the editor's unsaved tracker compares. Positions are tracked
  // separately (they need the canvas's own re-baselining rules), so they
  // are not in here.
  const trackedFields = {
    diagramAlgorithm: algorithm,
    diagramDirection: direction,
    diagramEdgeRouting: edgeRouting,
    diagramNodeSpacing: nodeSpacing,
    diagramLayerSpacing: layerSpacing,
    diagramAspectRatio: aspectRatio,
    diagramShowLabels: showLabels,
    diagramShowArrowheads: showArrowheads,
    diagramConnectionPointMode: connectionPointMode,
    diagramLayoutMode: layoutMode,
  };

  // What Save writes. Manual positions are persisted only while the
  // diagram is actually in manual mode — an auto-laid-out diagram saves
  // an empty map rather than the positions ELK happened to produce.
  const templateFields = {
    ...trackedFields,
    diagramManualPositions: layoutMode === 'manual' ? manualPositions : {},
  };

  // Everything AssetDiagramView needs except its ref, which callers pass
  // explicitly (a ref is not an ordinary prop, and hiding one inside a
  // spread is the kind of thing that goes unnoticed until it breaks).
  const viewProps = {
    diagramAlgorithm: algorithm,
    diagramDirection: direction,
    diagramEdgeRouting: edgeRouting,
    diagramNodeSpacing: nodeSpacing,
    diagramLayerSpacing: layerSpacing,
    diagramAspectRatio: aspectRatio,
    diagramShowLabels: showLabels,
    diagramShowArrowheads: showArrowheads,
    diagramConnectionPointMode: connectionPointMode,
    diagramLayoutResetSignal: layoutResetSignal,
    onManualEdit,
    setDiagramShowLabels: setShowLabels,
    setDiagramShowArrowheads: setShowArrowheads,
    setDiagramConnectionPointMode: setConnectionPointMode,
    savedManualPositions: savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined,
  };

  return {
    algorithm, setAlgorithm,
    layoutMode, setLayoutMode,
    manualPositions, setManualPositions,
    canvasRef,
    onManualEdit,
    confirmResetToAuto,
    setDirection, setEdgeRouting, setNodeSpacing, setLayerSpacing, setAspectRatio,
    direction, edgeRouting, nodeSpacing, layerSpacing, aspectRatio,
    trackedFields,
    templateFields,
    viewProps,
  };
}

// Auto-mode controls: which ELK algorithm, and the two options that only
// some algorithms honour (direction for layered/tree, edge routing for
// layered) — each hidden when the current algorithm ignores it, since a
// control that does nothing is worse than no control.
export function DiagramLayoutControls({ diagram }) {
  return (
    <>
      <ButtonGroup
        keyExpr="value"
        selectedItemKeys={[diagram.algorithm]}
        onItemClick={e => diagram.setAlgorithm(e.itemData.value)}
        stylingMode="outlined"
        className="op-dash-chart-toggle"
      >
        {RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS.map(item => (
          <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
        ))}
      </ButtonGroup>
      {RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS.has(diagram.algorithm) && (
        <ButtonGroup
          keyExpr="value"
          selectedItemKeys={[diagram.direction]}
          onItemClick={e => diagram.setDirection(e.itemData.value)}
          stylingMode="outlined"
          className="op-dash-chart-toggle"
        >
          {RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS.map(item => (
            <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
          ))}
        </ButtonGroup>
      )}
      {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagram.algorithm) && (
        <ButtonGroup
          keyExpr="value"
          selectedItemKeys={[diagram.edgeRouting]}
          onItemClick={e => diagram.setEdgeRouting(e.itemData.value)}
          stylingMode="outlined"
          className="op-dash-chart-toggle"
        >
          {RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS.map(item => (
            <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
          ))}
        </ButtonGroup>
      )}
    </>
  );
}

// The right-anchored spacing sliders, auto mode only: node spacing for
// every algorithm, layer spacing and aspect ratio for layered alone (the
// only algorithm ELK applies them to).
export function DiagramSpacingControls({ diagram }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
      <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
        <Slider
          min={0}
          max={200}
          step={1}
          value={diagram.nodeSpacing}
          onValueChanged={e => diagram.setNodeSpacing(e.value)}
          valueChangeMode="onHandleRelease"
          className="op-tierfilter-slider"
          style={{ width: '100%' }}
        >
          <SliderLabel visible format={v => `Nodes: ${v}`} position="bottom" />
        </Slider>
      </div>
      {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagram.algorithm) && (
        <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
          <Slider
            min={0}
            max={200}
            step={1}
            value={diagram.layerSpacing}
            onValueChanged={e => diagram.setLayerSpacing(e.value)}
            valueChangeMode="onHandleRelease"
            className="op-tierfilter-slider"
            style={{ width: '100%' }}
          >
            <SliderLabel visible format={v => `Layers: ${v}`} position="bottom" />
          </Slider>
        </div>
      )}
      {RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS.has(diagram.algorithm) && (
        <div className="op-tierfilter-slider-wrap" style={{ width: 130, padding: '4px 8px 20px', boxSizing: 'border-box', flexShrink: 0 }}>
          <Slider
            min={0.2}
            max={8}
            step={0.1}
            value={diagram.aspectRatio}
            onValueChanged={e => diagram.setAspectRatio(e.value)}
            valueChangeMode="onHandleRelease"
            className="op-tierfilter-slider"
            style={{ width: '100%' }}
          >
            <SliderLabel visible format={v => `Ratio: ${v.toFixed(1)}`} position="bottom" />
          </Slider>
        </div>
      )}
    </div>
  );
}
