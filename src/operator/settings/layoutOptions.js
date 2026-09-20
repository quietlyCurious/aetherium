// operator/settings/layoutOptions.js
// Toolbar option lists shared by the property and related-asset views:
// tier/visibility filters and sliders, flex flow/wrap/alignment, the
// Cards/Diagram switch, diagram connection points, align/distribute,
// arrowheads/labels, grouping, and the related-asset density slider.
// Plain data (plus two slider label formatters) with no component logic.

import { AlwaysFilterIcon, SometimesFilterIcon, AllFilterIcon, ColumnFlowIcon, RowFlowIcon, WrapIcon, NoWrapIcon, DistributeIcon, ClusterIcon, CardsLayoutIcon, DiagramLayoutIcon, ConnectionAnywhereIcon, ConnectionCenterIcon, AlignTopIcon, AlignMiddleIcon, AlignBottomIcon, AlignLeftIcon, AlignCenterHIcon, AlignRightIcon, DistributeHorizontalIcon, DistributeVerticalIcon, ArrowOnIcon, ArrowOffIcon, LabelOnIcon, LabelOffIcon } from '../icons';

// Selecting a tier shows that tier plus everything more important than it —
// picking P1 shows only P1; picking P3 shows P3, P2, and P1 (everything).
export const TIER_FILTER_ITEMS = [
  { text: 'P1', value: 'P1' },
  { text: 'P2', value: 'P2' },
  { text: 'P3', value: 'P3' },
];

export const TIER_RANK = { P1: 1, P2: 2, P3: 3 };

// Used only in type-properties mode, in place of the P1/P2/P3 tier filter —
// filters by the type's own always/sometimes/never visibility choices
// instead of the global property tiers.
const VISIBILITY_FILTER_ITEMS = [
  { text: 'Always', value: 'always', Icon: AlwaysFilterIcon },
  { text: 'Sometimes', value: 'sometimes', Icon: SometimesFilterIcon },
  { text: 'All', value: 'all', Icon: AllFilterIcon },
];

// Same three states as VISIBILITY_FILTER_ITEMS, presented as a 3-position
// slider instead of a button group — each step is inclusive of the ones to
// its left (Always < Always+Sometimes < everything).
export const TIER_FILTER_SLIDER_VALUES = ['always', 'sometimes', 'all'];

// Shared by both the permanent end labels (which only ever render at min
// and max) and the tooltip that follows the handle (which shows all three
// positions) — both use the same min/more/max wording.
const TIER_FILTER_SLIDER_LABELS = { 0: 'min', 1: 'more', 2: 'max' };

export const formatTierFilterSliderLabel = (v) => TIER_FILTER_SLIDER_LABELS[v] ?? '';

// Used only in type-properties mode — controls flex-direction/flex-wrap on
// the container holding all the properties as a whole. Each property's own
// internal layout (label/value/track/sparkline arrangement) is untouched by
// these; that's governed entirely by StatTile's own classes.
export const FLOW_DIRECTION_ITEMS = [
  { text: 'Column', value: 'column', Icon: ColumnFlowIcon },
  { text: 'Row', value: 'row', Icon: RowFlowIcon },
];

export const FLOW_WRAP_ITEMS = [
  { text: 'Wrap', value: 'wrap', Icon: WrapIcon },
  { text: 'No Wrap', value: 'nowrap', Icon: NoWrapIcon },
];

// Controls align-content — how multiple wrapped lines (rows or columns,
// depending on flowDirection) are distributed along the cross axis once
// there's more than one. 'stretch' spreads/stretches lines to fill the
// available space; 'flex-start' clusters them together, leaving any extra
// space at the end instead.
export const ALIGN_CONTENT_ITEMS = [
  { text: 'Distribute', value: 'stretch', Icon: DistributeIcon },
  { text: 'Cluster', value: 'flex-start', Icon: ClusterIcon },
];

// Related Assets tab's own layout-mode toggle — 'cards' is the flex
// box-flow view (genuinely responsive, reflows on resize), 'diagram' is
// the ELK + React Flow relational view (fixed pixel positions, edges
// drawn). Two different renderers, not one axis with a toggle on top.
export const RELATED_ASSETS_LAYOUT_MODE_ITEMS = [
  { text: 'Cards', value: 'cards', Icon: CardsLayoutIcon },
  { text: 'Diagram', value: 'diagram', Icon: DiagramLayoutIcon },
];

// Every edge now always finds its own real closest side on a node
// (previously "Free Ports"; "Fixed Sides" mode has been removed
// entirely) — see RelatedAssetsFloatingEdge and the elk.portConstraints
// option in getElkLayoutedElements. This toggle controls a separate
// question: once that closest side is picked, does the line land at the
// exact geometric point facing the other node (anywhere along that
// side), or always snap to that side's midpoint? Purely a render-time
// choice (see getFloatingEdgeParams/getSideCenterPoint) — doesn't affect
// ELK's own layout either way.
export const RELATED_ASSETS_CONNECTION_POINT_ITEMS = [
  { text: 'Anywhere', value: 'anywhere', Icon: ConnectionAnywhereIcon },
  { text: 'Center', value: 'center', Icon: ConnectionCenterIcon },
];

// One-shot actions on the currently-selected nodes, not persistent
// settings — these never show a "pressed" state (selectedItemKeys is
// always empty), unlike every other ButtonGroup in this toolbar.
export const RELATED_ASSETS_ALIGN_VERTICAL_ITEMS = [
  { text: 'Align Top', value: 'top', Icon: AlignTopIcon },
  { text: 'Align Middle', value: 'middle', Icon: AlignMiddleIcon },
  { text: 'Align Bottom', value: 'bottom', Icon: AlignBottomIcon },
];

export const RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS = [
  { text: 'Align Left', value: 'left', Icon: AlignLeftIcon },
  { text: 'Align Center', value: 'center', Icon: AlignCenterHIcon },
  { text: 'Align Right', value: 'right', Icon: AlignRightIcon },
];

export const RELATED_ASSETS_DISTRIBUTE_ITEMS = [
  { text: 'Distribute Horizontally', value: 'horizontal', Icon: DistributeHorizontalIcon },
  { text: 'Distribute Vertically', value: 'vertical', Icon: DistributeVerticalIcon },
];

// Purely a render-time transform (see the useMemo in
// RelatedAssetsDiagramInner) — doesn't affect ELK's layout at all.
export const RELATED_ASSETS_SHOW_ARROWHEADS_ITEMS = [
  { text: 'Arrows On', value: 'shown', Icon: ArrowOnIcon },
  { text: 'Arrows Off', value: 'hidden', Icon: ArrowOffIcon },
];

// Purely a render-time transform (see the useMemo in
// RelatedAssetsDiagramInner) — doesn't affect ELK's layout at all, since
// this implementation doesn't feed label information into ELK itself.
export const RELATED_ASSETS_SHOW_LABELS_ITEMS = [
  { text: 'Labels On', value: 'shown', Icon: LabelOnIcon },
  { text: 'Labels Off', value: 'hidden', Icon: LabelOffIcon },
];

export const GROUPING_MODE_ITEMS = [
  { text: 'Box', value: 'box' },
  { text: 'Space', value: 'space' },
  { text: 'None', value: 'none' },
];

// 2-position slider for related-asset density: min shows only assets
// marked "always" in the left table, max shows every related asset
// regardless of its own marking. Same concept as the properties tab's
// 3-position tier slider, one fewer stop since there's no "sometimes"
// state here.
export const RELATED_ASSET_DENSITY_VALUES = ['always', 'all'];

const RELATED_ASSET_DENSITY_LABELS = { 0: 'min', 1: 'max' };

export const formatRelatedAssetDensityLabel = (v) => RELATED_ASSET_DENSITY_LABELS[v] ?? '';
