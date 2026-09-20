// OperatorWorkspace.jsx — Operator Interface (concept shell)
//
// First rapid-prototype pass at the "next-gen Operator interface" concept
// (see design brainstorm — Now / Attention / Work / Investigate, with AI
// woven through rather than living in its own panel/chat window).
//
// SCOPE OF THIS PASS: layout, interaction shape, and visual language only.
// All data below is mocked/static — nothing here is wired to real queries,
// OpHub, or the data-binding system yet. Reuses the Aurelia/Ferrum asset
// hierarchy from assetData.js for realistic naming so it reads as part of
// the same world as the rest of the app.
//
// Four zones:
//   Now         — operational picture: current state of every line, always visible
//   Attention   — ranked list of what needs the operator right now
//   Investigate — drill-down for whatever's selected in Attention (signal →
//                 interpretation → recommendation → evidence)
//   Work        — task list; can be created manually or "recorded" by AI
//
// AI-originated content (as opposed to raw sensor/state data) is marked
// with a small "AI" pill throughout, rather than being confined to a
// separate chat surface — this is the thing the brainstorm doc keeps
// calling out as the actual differentiator vs. a traditional HMI+chatbot.

import { useMemo, useState, useEffect, createContext, useRef, useCallback, forwardRef, useImperativeHandle, useContext } from 'react';
import { Popover } from 'devextreme-react/popover';
import { confirm, custom as customDialog } from 'devextreme/ui/dialog';
import { useUnsavedTracker, unsavedChangesStore } from './unsavedChangesStore';
import { CheckBox } from 'devextreme-react/check-box';
import { TabPanel, Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { SelectBox } from 'devextreme-react/select-box';
import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import DataListGrid from './DataListGrid';
import { loadTypeDisplayTemplates, saveTypeDisplayTemplates } from './typeDisplayTemplatesStorage';
import { loadRelatedAssetsTemplates, saveRelatedAssetsTemplates } from './relatedAssetsTemplatesStorage';
import { loadAllAssetsTemplate, saveAllAssetsTemplate } from './allAssetsTemplateStorage';
import { loadNowSelection, saveNowSelection } from './nowSelectionStorage';
import { loadModelRegistry, getModelDataFiles, MODEL_SHAPES } from './modelRegistry';
import { loadTypePropertyConfigs, saveTypePropertyConfigs } from './typePropertyConfigsStorage';
import { loadTypeRelatedAssetConfigs, saveTypeRelatedAssetConfigs } from './typeRelatedAssetConfigsStorage';
import { loadAssetDisplayTemplates, saveAssetDisplayTemplates } from './assetDisplayTemplatesStorage';
import { loadAssetPropertyConfigs, saveAssetPropertyConfigs } from './assetPropertyConfigsStorage';
import { loadAssetRelatedAssetConfigs, saveAssetRelatedAssetConfigs } from './assetRelatedAssetConfigsStorage';
import { loadAssetRelatedAssetsTemplates, saveAssetRelatedAssetsTemplates } from './assetRelatedAssetsTemplatesStorage';
import { loadTypePropertyOrders, saveTypePropertyOrders } from './typePropertyOrderStorage';
import { loadAssetPropertyOrders, saveAssetPropertyOrders } from './assetPropertyOrderStorage';
import { loadTypeRelatedAssetOrders, saveTypeRelatedAssetOrders } from './typeRelatedAssetOrderStorage';
import { loadAssetRelatedAssetOrders, saveAssetRelatedAssetOrders } from './assetRelatedAssetOrderStorage';
import notify from 'devextreme/ui/notify';
import Button from 'devextreme-react/button';
import { Chart, CommonSeriesSettings, Series, Point, Aggregation, ArgumentAxis, Grid as ChartGrid, ValueAxis, Legend as ChartLegend, Tooltip as ChartTooltip, Export as ChartExport } from 'devextreme-react/chart';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import ELK from 'elkjs/lib/elk.bundled.js';
import { useInternalNode, getStraightPath, getSmoothStepPath, getBezierPath, BaseEdge, Handle, ReactFlowProvider, useNodesState, useEdgesState, useNodesInitialized, useReactFlow, MarkerType, ReactFlow, Background, Panel } from '@xyflow/react';
import RangeSelector, { Size as RsSize, Chart as RsChart, ValueAxis as RsValueAxis, Series as RsSeries, Aggregation as RsAggregation, Scale as RsScale, Behavior as RsBehavior } from 'devextreme-react/range-selector';
import Sparkline from 'devextreme-react/sparkline';
import HierarchyTree from './HierarchyTree';
import '@xyflow/react/dist/style.css';
import { AiTabIcon, AlignBottomIcon, AlignCenterHIcon, AlignLeftIcon, AlignMiddleIcon, AlignRightIcon, AlignTopIcon, AllFilterIcon, AlwaysFilterIcon, ArrowOffIcon, ArrowOnIcon, AssetsRailIcon, AttentionRailIcon, CardsLayoutIcon, CaretIcon, ChatTabIcon, ClusterIcon, ColumnFlowIcon, ConfidenceIcon, ConnectionAnywhereIcon, ConnectionCenterIcon, DashIcon, DetailsTabIcon, DiagramLayoutIcon, DistributeHorizontalIcon, DistributeIcon, DistributeVerticalIcon, ForceAlgorithmIcon, GearIcon, IconButtonGroupItem, LabelOffIcon, LabelOnIcon, LayeredAlgorithmIcon, NoWrapIcon, NowStatusIcon, OrthogonalRoutingIcon, PlayPauseIcon, PolylineRoutingIcon, RadialAlgorithmIcon, RiskAlertIcon, RowFlowIcon, ShieldCheckIcon, SometimesFilterIcon, TreeAlgorithmIcon, TrendUpIcon, VisibilityStateIcon, VisualizationRailIcon, WorkTabIcon, WrapIcon } from './operator/icons';
import { CONTAINMENT_EDGE_STYLE, HMI_CATEGORY_ORDER, assetTypeIdOf, attentionAssetToStationId, buildTypeList, deslugifyType, getAllAssetRelationshipsForModel, getAssetDisplayLabel, getAssetPathLabel, getAttentionItemAssetEntry, getAttentionItemPrimarySeries, getAttentionItemTypeId, getPropertySeriesForSource, getPropertyVisibilityForType, getRelatedAssetsForType, isAttentionItemActiveAtTime, nowTileIdToAssetId, resolveAssetProperties, sliceSeriesToRange } from './operator/model/assetQueries';
import { ATTENTION_ITEMS, CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, CURRENT_MODEL, CURRENT_MODEL_SHAPE, CURRENT_TIMESTAMPS, INITIAL_WORK_ITEMS, LINE_ROLLUPS, LINE_SPARKLINES, LINE_STATUS, OPERATING_CONTEXT_BY_LINE, PROPERTY_CATEGORIES, PROPERTY_DECIMALS, PROPERTY_LABELS, PROPERTY_RANGES, PROPERTY_TIERS, PROPERTY_UNITS, STATION_FULL_PROPERTIES, STATION_METRICS, STATION_SPARKLINES, WORK_NOW_REFERENCE, activateLoadedModel, minutesToShiftDate, padEvidenceAcrossShift, timeStrToMinutes } from './operator/model/modelData';
import { EMPTY_CUSTOMIZATIONS, UNDO_TOAST_MS, assetCustomizationStore, computeAssetCustomizations, normalizedLayout, useAssetCustomizations } from './operator/settings/customizations';
import { EMPTY_DISPLAY_ORDERS, applySavedOrder, categoryOrderedPropertyKeys, displayOrderStore, resolveEntityOrder, sortRowsByOrder, useDisplayOrders } from './operator/settings/displayOrder';
import { KPI_VIEW_MODE_ITEMS, PROPERTY_VIEW_MODE_DEFAULT, PROPERTY_VIEW_MODE_OVERRIDE_ITEMS, PROPERTY_VIEW_MODE_UPDATE_TYPE, RELATED_ASSET_VISIBILITY_CYCLE, VISIBILITY_CYCLE, VISIBILITY_LABEL, mergePropertyViewModes, resolvePropertyViewMode } from './operator/settings/propertyDisplay';

const STATE_COLORS = {
  running:    '#4ade80',
  attention:  '#fbbf24',
  changeover: '#60a5fa',
  down:       '#f87171',
};

const STATE_LABELS = {
  running: 'Running',
  attention: 'Needs attention',
  changeover: 'Changeover',
  down: 'Down',
};

const SEVERITY_COLORS = {
  high: '#d64545',
  medium: '#e0a336',
  low: '#8c8c8c',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const SEVERITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

// A second, independent axis from severity — "how bad is this" vs "what's
// my relationship to it right now." Colors deliberately don't reuse
// severity's red/amber/grey, so a card showing both a severity dot and a
// state badge doesn't read as two competing opinions in the same palette.
const ATTENTION_STATE_COLORS = {
  watch: '#6b7a99',
  investigate: '#0078d4',
  act: '#0e8a7d',
  urgent: '#b91c3c',
};

const ATTENTION_STATE_LABELS = {
  watch: 'Watch',
  investigate: 'Investigate',
  act: 'Act',
  urgent: 'Urgent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Attention controls — group-by / sort-by options and the logic behind them
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'severity', label: 'Severity' },
  { value: 'asset', label: 'Asset' },
  { value: 'state', label: 'State' },
];

const SORT_BY_OPTIONS = [
  { value: 'time', label: 'Time' },
  { value: 'severity', label: 'Severity' },
  { value: 'state', label: 'State' },
];

// Most urgent first, mirroring the high-to-low convention severity already uses.
const ATTENTION_STATE_ORDER = { urgent: 0, act: 1, investigate: 2, watch: 3 };

function sortAttentionItems(items, sortBy) {
  const sorted = [...items];
  if (sortBy === 'severity') {
    sorted.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  } else if (sortBy === 'state') {
    sorted.sort((a, b) => ATTENTION_STATE_ORDER[a.attentionState] - ATTENTION_STATE_ORDER[b.attentionState]);
  } else {
    // 'time' — most recent first (smallest elapsed time on top)
    sorted.sort((a, b) => a.sinceMinutes - b.sinceMinutes);
  }
  return sorted;
}

function groupAttentionItems(items, groupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }];
  }
  const buckets = {};
  items.forEach(item => {
    const key = groupBy === 'severity' ? item.severity : groupBy === 'state' ? item.attentionState : item.line;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let keys = Object.keys(buckets);
  if (groupBy === 'severity') {
    keys.sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]);
  } else if (groupBy === 'state') {
    keys.sort((a, b) => ATTENTION_STATE_ORDER[a] - ATTENTION_STATE_ORDER[b]);
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  return keys.map(key => ({
    key,
    label: groupBy === 'severity' ? SEVERITY_LABELS[key] : groupBy === 'state' ? ATTENTION_STATE_LABELS[key] : key,
    items: buckets[key],
  }));
}

const WORK_PRIORITY_ORDER = { urgent: 0, important: 1, routine: 2 };

const WORK_PRIORITY_COLORS = { urgent: '#d64545', important: '#e0a336', routine: '#8c8c8c' };

const WORK_PRIORITY_LABELS = { urgent: 'Urgent', important: 'Important', routine: 'Routine' };

const WORK_SOURCE_TYPE_LABELS = { planned: 'Planned', situation: 'Unplanned' };

function formatCreatedAt(date) {
  if (!date) return null;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function computeMarginMinutes(item) {
  if (!item.dueAt) return null;
  return Math.round((item.dueAt.getTime() - WORK_NOW_REFERENCE.getTime()) / 60000);
}

function formatMargin(minutes) {
  if (minutes === null) return null;
  if (minutes < 0) return `Overdue ${Math.abs(minutes)}m`;
  if (minutes === 0) return 'Due now';
  if (minutes < 60) return `Due in ${minutes}m`;
  return `Due in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function marginColor(minutes) {
  if (minutes === null) return '#aaa';
  if (minutes < 0) return '#d64545';
  if (minutes <= 15) return '#e0a336';
  return '#8c8c8c';
}

const WORK_GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'sourceType', label: 'Type' },
  { value: 'priority', label: 'Priority' },
];

const WORK_SORT_BY_OPTIONS = [
  { value: 'margin', label: 'Time margin' },
  { value: 'priority', label: 'Priority' },
];

function sortWorkItems(items, sortBy) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    // Not-done items always float above done ones, regardless of sort
    // choice — a finished item's time margin isn't a prioritization signal
    // anymore.
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) {
      return (b.completedAt ? b.completedAt.getTime() : 0) - (a.completedAt ? a.completedAt.getTime() : 0);
    }
    if (sortBy === 'priority') {
      return WORK_PRIORITY_ORDER[a.priority] - WORK_PRIORITY_ORDER[b.priority];
    }
    const ma = computeMarginMinutes(a);
    const mb = computeMarginMinutes(b);
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return ma - mb;
  });
  return sorted;
}

function groupWorkItems(items, groupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }];
  }
  const buckets = {};
  items.forEach(item => {
    const key = groupBy === 'priority' ? item.priority : item.sourceType;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let keys = Object.keys(buckets);
  if (groupBy === 'priority') {
    keys.sort((a, b) => WORK_PRIORITY_ORDER[a] - WORK_PRIORITY_ORDER[b]);
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  return keys.map(key => ({
    key,
    label: groupBy === 'priority' ? WORK_PRIORITY_LABELS[key] : WORK_SOURCE_TYPE_LABELS[key],
    items: buckets[key],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared bits
// ─────────────────────────────────────────────────────────────────────────────

function AiPill() {
  return <span className="op-ai-pill">AI</span>;
}

// fullSeries (optional): the item's real primary-property series, one value
// per CURRENT_TIMESTAMPS entry. When present it replaces the padded
// stand-in entirely — the chart then shows the actual whole-timeline trend,
// still opening zoomed to the evidence window.
function ComparisonLineChart({ evidence, evidencePoints, color, fullSeries }) {
  const initialRange = useMemo(() => [
    minutesToShiftDate(timeStrToMinutes(evidencePoints[0].time)),
    minutesToShiftDate(timeStrToMinutes(evidencePoints[evidencePoints.length - 1].time)),
  ], [evidencePoints]);
  const [visualRange, setVisualRange] = useState(initialRange);
  const data = useMemo(() => (
    fullSeries
      ? fullSeries.map((value, i) => ({ time: minutesToShiftDate(timeStrToMinutes(CURRENT_TIMESTAMPS[i])), value }))
      : padEvidenceAcrossShift(evidencePoints, evidence)
  ), [evidencePoints, evidence, fullSeries]);
  return (
    <div className="op-evidence-chart-wrap op-evidence-chart-wrap--with-range">
      <div className="op-evidence-chart-main">
        <Chart dataSource={data} palette={[color]} height="100%">
          <CommonSeriesSettings argumentField="time" type="line" />
          <Series valueField="value">
            {/* Markers on every sample would crowd a full-timeline series;
                they stay on for the sparse legacy evidence points. */}
            <Point visible={!fullSeries} size={7} />
            <Aggregation enabled={true} />
          </Series>
          <ArgumentAxis argumentType="datetime" visualRange={visualRange} valueMarginsEnabled={false}>
            <ChartGrid visible={false} />
          </ArgumentAxis>
          <ValueAxis>
            <ChartGrid visible={true} />
          </ValueAxis>
          <ChartLegend visible={false} />
          <ChartTooltip enabled={true} />
          <ChartExport enabled={false} />
        </Chart>
      </div>
      <div className="op-evidence-rangeselector">
        <RangeSelector dataSource={data} defaultValue={initialRange} onValueChanged={e => setVisualRange(e.value)}>
          <RsSize height={70} />
          <RsChart>
            <RsValueAxis visible={false} />
            <RsSeries type="line" valueField="value" argumentField="time">
              <RsAggregation enabled={true} />
            </RsSeries>
          </RsChart>
          <RsScale valueType="datetime" placeholderHeight={14} />
          <RsBehavior snapToTicks={false} valueChangeMode="onHandleMove" />
        </RangeSelector>
      </div>
    </div>
  );
}

const EVIDENCE_VIEW_ITEMS = [
  { text: 'Trend', value: 'line' },
  { text: 'Assets', value: 'relatedAssets' },
  { text: 'AI', value: 'ai' },
];

const RELATED_ASSETS_SUBVIEW_ITEMS = [
  { text: 'This Asset', value: 'thisAsset' },
  { text: 'Related Assets', value: 'related' },
];

// Filled blue dot — the same "set on this asset" mark the Details panel's
// Visual column uses, so the one visual language means "this asset
// deviates from its type" everywhere it appears.
// Parents get a lighter version of the same dot when something beneath
// them is customized — the tree starts mostly collapsed, so without it a
// customized asset two levels down would be invisible. (An asset can
// carry both: it's customized itself and so is something under it; its
// own solid dot wins.)
function AssetCustomizedDot({ assetId }) {
  const { byAsset, containsCustomized } = useAssetCustomizations();
  const info = byAsset[assetId];
  if (info?.differs) return <span className="op-customized-dot" title={`Customized: ${info.summary}`} />;
  const below = containsCustomized[assetId];
  if (below) return <span className="op-customized-dot op-customized-dot--contains" title={`${below} customized asset${below > 1 ? 's' : ''} inside`} />;
  return null;
}

// Types list: how many of this type's assets differ from it.
function TypeCustomizedCount({ typeId }) {
  const { byType } = useAssetCustomizations();
  const count = byType[typeId]?.length ?? 0;
  if (!count) return null;
  return <span className="op-customized-count" title={`${count} asset${count > 1 ? 's' : ''} customized`}>{count}</span>;
}

// Checklist popover shared by both batch reverts — "which of this type's
// assets should go back to the type" (whole assets) and "which assets
// should drop their own setting for this one property". Everything starts
// checked, since the common case is "all of them"; unchecking is there
// for the exceptions. Rows open the asset on click, so the list doubles as
// the answer to "which assets are customized?".
function AssetRevertPopover({ target, visible, onHide, title, rows, revertLabel, onRevert, onOpenAsset }) {
  const [checked, setChecked] = useState(() => new Set(rows.map(r => r.id)));
  const rowIdsSignature = rows.map(r => r.id).join('|');
  useEffect(() => {
    // New list (reopened on a different property/type, or a revert
    // elsewhere changed who's customized) — start fully checked again.
    setChecked(new Set(rows.map(r => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdsSignature, visible]);

  const selectedIds = rows.map(r => r.id).filter(id => checked.has(id));
  const toggle = id => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // No confirm dialog — the revert shows an Undo toast instead.
  const handleRevert = () => {
    onRevert(selectedIds);
    onHide();
  };

  return (
    <Popover
      target={target}
      visible={visible && !!target}
      onHiding={onHide}
      hideOnOutsideClick
      position="bottom"
      width={320}
      showTitle
      title={title}
      showCloseButton
      wrapperAttr={{ class: 'op-revert-popover' }}
    >
      <div className="op-revert-list">
        {rows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">Nothing to revert.</div>
        ) : rows.map(row => (
          <div key={row.id} className="op-revert-row">
            <CheckBox value={checked.has(row.id)} onValueChanged={e => { if (e.event) toggle(row.id); }} />
            <button type="button" className="op-revert-row-text" onClick={() => { onOpenAsset?.(row.id); onHide(); }} title="Open this asset">
              <span className="op-revert-row-label">{row.label}</span>
              {row.detail && <span className="op-revert-row-detail">{row.detail}</span>}
            </button>
          </div>
        ))}
      </div>
      <div className="op-revert-footer">
        <Button text={revertLabel(selectedIds.length)} type="default" stylingMode="contained" disabled={!selectedIds.length} onClick={handleRevert} />
      </div>
    </Popover>
  );
}

// Title-row controls in the center preview.
//  - Asset: a "Customized" chip (hover lists what differs) and a Revert to
//    type button. The button shows whenever the asset has ANY stored
//    entries, even ones that currently match — reverting those still
//    matters, since a stored match stops following later type changes.
//  - Type: "N customized" — opens the checklist of those assets, to jump
//    to one or revert several at once.
function CustomizationTitleControls({ entityId, isAssetEntity }) {
  const { byAsset, byType, actions } = useAssetCustomizations();
  const [popoverTarget, setPopoverTarget] = useState(null);

  if (isAssetEntity) {
    const info = byAsset[entityId];
    if (!info?.hasOwn) return null;
    // No confirm dialogs — both show an Undo toast instead.
    const handleRevert = () => actions.revertAssetsToType?.([entityId]);
    const handleApply = () => actions.applyAssetToType?.(entityId);
    // How many OTHER assets would visibly change: those of this type that
    // currently follow it for everything (customized ones keep their own).
    const asset = CURRENT_ASSET_MAP[entityId];
    const typeName = asset ? deslugifyType(asset.assetType) : 'type';
    const followers = asset
      ? (CURRENT_ASSET_DATA || []).filter(a => a.id !== entityId && assetTypeIdOf(a) === info.typeId && !byAsset[a.id]?.differs).length
      : 0;
    const applyHint = `Update the ${typeName} type to use this asset's settings (${info.summary}). `
      + `${followers} other ${typeName} asset${followers === 1 ? '' : 's'} follow${followers === 1 ? 's' : ''} the type and will change too; `
      + 'assets with their own settings keep them. This asset then just follows the type.';
    const revertHint = info.differs
      ? `Make this asset match its type again: its own settings (${info.summary}) are discarded`
      : "This asset's stored settings match its type today, but stop it from following future type changes — match the type to follow it again";
    return (
      <span className="op-title-customization">
        {info.differs && (
          <span className="op-customized-chip" title={`Customized: ${info.summary}`}>
            <span className="op-customized-dot" />Customized
          </span>
        )}
        {/* Same pair, same words and order as an asset row's Visual
            dropdown: ↓ Match type (take the type's), ↑ Update type (give
            it this asset's). */}
        <button type="button" className="op-title-link-btn" onClick={handleRevert} title={revertHint}>↓ Match type</button>
        {info.differs && <span className="op-title-link-sep" aria-hidden="true">·</span>}
        {info.differs && (
          <button type="button" className="op-title-link-btn" onClick={handleApply} title={applyHint}>↑ Update type</button>
        )}
      </span>
    );
  }

  const ids = byType[entityId] || [];
  if (!ids.length) return null;
  const rows = ids.map(id => ({ id, label: getAssetPathLabel(id), detail: byAsset[id]?.summary }));
  return (
    <span className="op-title-customization">
      <button type="button" className="op-customized-chip op-customized-chip--button" onClick={e => setPopoverTarget(e.currentTarget)}>
        <span className="op-customized-dot" />{ids.length} customized asset{ids.length > 1 ? 's' : ''} ▾
      </button>
      <AssetRevertPopover
        target={popoverTarget}
        visible={!!popoverTarget}
        onHide={() => setPopoverTarget(null)}
        title="Customized assets"
        rows={rows}
        revertLabel={n => `↓ Match type on ${n}`}
        onRevert={selectedIds => actions.revertAssetsToType?.(selectedIds)}
        onOpenAsset={actions.openAsset}
      />
    </span>
  );
}

// Selecting a tier shows that tier plus everything more important than it —
// picking P1 shows only P1; picking P3 shows P3, P2, and P1 (everything).
const TIER_FILTER_ITEMS = [
  { text: 'P1', value: 'P1' },
  { text: 'P2', value: 'P2' },
  { text: 'P3', value: 'P3' },
];

const TIER_RANK = { P1: 1, P2: 2, P3: 3 };

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
const TIER_FILTER_SLIDER_VALUES = ['always', 'sometimes', 'all'];

// Shared by both the permanent end labels (which only ever render at min
// and max) and the tooltip that follows the handle (which shows all three
// positions) — both use the same min/more/max wording.
const TIER_FILTER_SLIDER_LABELS = { 0: 'min', 1: 'more', 2: 'max' };

const formatTierFilterSliderLabel = (v) => TIER_FILTER_SLIDER_LABELS[v] ?? '';

// Used only in type-properties mode — controls flex-direction/flex-wrap on
// the container holding all the properties as a whole. Each property's own
// internal layout (label/value/track/sparkline arrangement) is untouched by
// these; that's governed entirely by StatTile's own classes.
const FLOW_DIRECTION_ITEMS = [
  { text: 'Column', value: 'column', Icon: ColumnFlowIcon },
  { text: 'Row', value: 'row', Icon: RowFlowIcon },
];

const FLOW_WRAP_ITEMS = [
  { text: 'Wrap', value: 'wrap', Icon: WrapIcon },
  { text: 'No Wrap', value: 'nowrap', Icon: NoWrapIcon },
];

// Controls align-content — how multiple wrapped lines (rows or columns,
// depending on flowDirection) are distributed along the cross axis once
// there's more than one. 'stretch' spreads/stretches lines to fill the
// available space; 'flex-start' clusters them together, leaving any extra
// space at the end instead.
const ALIGN_CONTENT_ITEMS = [
  { text: 'Distribute', value: 'stretch', Icon: DistributeIcon },
  { text: 'Cluster', value: 'flex-start', Icon: ClusterIcon },
];

// Related Assets tab's own layout-mode toggle — 'cards' is the flex
// box-flow view (genuinely responsive, reflows on resize), 'diagram' is
// the ELK + React Flow relational view (fixed pixel positions, edges
// drawn). Two different renderers, not one axis with a toggle on top.
const RELATED_ASSETS_LAYOUT_MODE_ITEMS = [
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
const RELATED_ASSETS_CONNECTION_POINT_ITEMS = [
  { text: 'Anywhere', value: 'anywhere', Icon: ConnectionAnywhereIcon },
  { text: 'Center', value: 'center', Icon: ConnectionCenterIcon },
];

// One-shot actions on the currently-selected nodes, not persistent
// settings — these never show a "pressed" state (selectedItemKeys is
// always empty), unlike every other ButtonGroup in this toolbar.
const RELATED_ASSETS_ALIGN_VERTICAL_ITEMS = [
  { text: 'Align Top', value: 'top', Icon: AlignTopIcon },
  { text: 'Align Middle', value: 'middle', Icon: AlignMiddleIcon },
  { text: 'Align Bottom', value: 'bottom', Icon: AlignBottomIcon },
];

const RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS = [
  { text: 'Align Left', value: 'left', Icon: AlignLeftIcon },
  { text: 'Align Center', value: 'center', Icon: AlignCenterHIcon },
  { text: 'Align Right', value: 'right', Icon: AlignRightIcon },
];

const RELATED_ASSETS_DISTRIBUTE_ITEMS = [
  { text: 'Distribute Horizontally', value: 'horizontal', Icon: DistributeHorizontalIcon },
  { text: 'Distribute Vertically', value: 'vertical', Icon: DistributeVerticalIcon },
];

// Purely a render-time transform (see the useMemo in
// RelatedAssetsDiagramInner) — doesn't affect ELK's layout at all.
const RELATED_ASSETS_SHOW_ARROWHEADS_ITEMS = [
  { text: 'Arrows On', value: 'shown', Icon: ArrowOnIcon },
  { text: 'Arrows Off', value: 'hidden', Icon: ArrowOffIcon },
];

// Purely a render-time transform (see the useMemo in
// RelatedAssetsDiagramInner) — doesn't affect ELK's layout at all, since
// this implementation doesn't feed label information into ELK itself.
const RELATED_ASSETS_SHOW_LABELS_ITEMS = [
  { text: 'Labels On', value: 'shown', Icon: LabelOnIcon },
  { text: 'Labels Off', value: 'hidden', Icon: LabelOffIcon },
];

const GROUPING_MODE_ITEMS = [
  { text: 'Box', value: 'box' },
  { text: 'Space', value: 'space' },
  { text: 'None', value: 'none' },
];

const TYPE_LIST_COLUMNS = [
  {
    dataField: 'name',
    caption: 'Name',
    minWidth: 120,
    // Count of this type's customized assets, when there are any.
    cellRender: cellInfo => (
      <span className="op-type-name-cell">
        <span className="op-type-name-text">{cellInfo.data.name}</span>
        <TypeCustomizedCount typeId={cellInfo.data.id} />
      </span>
    ),
  },
  { dataField: 'level', caption: 'Level', width: 90 },
];

// See usage in RelatedAssetBoxContent below and the time-track scrubber in
// InvestigatePanel's Related Assets tab, the only place this is provided.
const TimeScrubContext = createContext(null);

// Every property EXCEPT the universal/common ones already shown elsewhere
// (throughput, OEE, WIP, etc. — the same set the Line Detail 2x2 grid
// already covers) — grouped by property type rather than dumped as one
// long list, same visual language as Line Detail's stat tiles.
// propertyViewModes/selectedPropertyKey/onSelectProperty are type-mode
// only (the Configurator's editing preview) and owned by the caller, not
// here: the Details panel's Visual column edits the same per-property
// visual map and shares the same selected property, and it's a sibling of
// this component, not a child. Undefined everywhere else this renders
// (Investigate, Line Detail), which then behaves exactly as before.
function HmiPropertiesListing({ asset, stationId: stationIdProp, properties: propertiesProp, sparklineSource, evidencePoints, typeVisibilityMode, typeId, typePropertyConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, onViewModeChange, activeSaveHandlerRef, showToolbar, propertyViewModes, inheritedPropertyViewModes, selectedPropertyKey, onSelectProperty, propertyOrder }) {
  const stationId = stationIdProp || (propertiesProp ? null : attentionAssetToStationId(asset));
  const props = propertiesProp || (stationId ? STATION_FULL_PROPERTIES[stationId] : null);
  const effectiveSparklineSource = stationId ? { type: 'station', id: stationId } : sparklineSource;
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
  // PropertyLayoutCanvas below takes over instead — same properties,
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

  const kpisClass = `op-hmiprops-kpis${kpiViewMode === 'text' ? ' op-hmiprops-kpis--text' : ''}${kpiViewMode === 'indicator' ? ' op-hmiprops-kpis--indicator' : ''}`;

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

  // Extracted so PropertyLayoutCanvas's tiles array (built below, for
  // manual mode) computes the exact same range/sparkline props as the
  // flex-rendering path — one source of truth for what a tile shows,
  // regardless of which layout mode is currently active.
  const buildTileProps = p => {
    const range = PROPERTY_RANGES[p.key];
    const fullSeries = effectiveSparklineSource ? getPropertySeriesForSource(effectiveSparklineSource, p.key) : null;
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

  const renderTile = p => <StatTile key={p.key} {...buildTileProps(p)} />;

  // Applied unconditionally whenever type-properties mode is active,
  // regardless of which flowDirection/flowWrap combination is selected —
  // general flexbox rules (flex-direction, flex-wrap) then determine the
  // actual layout based on real available space, rather than any
  // combination-specific styling.
  const typeFlowActive = typeVisibilityMode;

  return (
    <div
      className={`op-hmiprops-wrap${typeFlowActive ? ' op-hmiprops-wrap--typeflow' : ''}`}
      onPointerDownCapture={unsavedTracker.noteUserInput}
      onKeyDownCapture={unsavedTracker.noteUserInput}
    >
      {typeVisibilityMode ? (
        showToolbar && (
          <div className="op-hmiprops-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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
        <div className="op-hmiprops-toolbar">
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
        <div className={`op-hmiprops${kpiViewMode === 'text' ? ' op-hmiprops--text' : ''}${kpiViewMode === 'indicator' ? ' op-hmiprops--indicator' : ''}`}>
          {categories.map(cat => (
            <div key={cat} className="op-hmiprops-card">
              <div className="op-hmiprops-card-title">{cat}</div>
              <div className={kpisClass}>
                {grouped[cat].map(renderTile)}
              </div>
            </div>
          ))}
        </div>
      ) : groupingMode === 'none' ? (
        flatTiles.length === 0 ? (
          <div className="op-hmiprops-singlebox">
            <div className="op-dash-text op-dash-text--muted">No properties shown (view mode: None).</div>
          </div>
        ) : typeVisibilityMode && propertyLayoutMode === 'manual' ? (
          <div className="op-hmiprops-singlebox op-hmiprops-singlebox--typeflow">
            <PropertyLayoutCanvas
              ref={propertyLayoutCanvasRef}
              tiles={flatTiles.map(p => ({ key: p.key, tileProps: buildTileProps(p), selected: p.key === selectedPropertyKey }))}
              manualPositions={manualPositions}
              onPositionsChange={handleManualPositionsChange}
              onSelectTile={onSelectProperty}
            />
          </div>
        ) : (
          <div className={`op-hmiprops-singlebox${kpiViewMode === 'text' ? ' op-hmiprops--text' : ''}${kpiViewMode === 'indicator' ? ' op-hmiprops--indicator' : ''}${typeFlowActive ? ' op-hmiprops-singlebox--typeflow' : ''}`}>
            <div
              ref={flexPreviewContainerRef}
              className={`${kpisClass}${typeVisibilityMode && flowDirection === 'row' ? ' op-hmiprops-kpis--flowrow' : ''}${typeFlowActive ? ' op-hmiprops-kpis--typeflow' : ''}`}
              style={typeVisibilityMode ? { flexDirection: flowDirection, flexWrap: flowWrap, alignContent } : undefined}
            >
              {flatTiles.map(p => (
                <div
                  key={p.key}
                  ref={el => { flexTileRefs.current[p.key] = el; }}
                  className={onSelectProperty ? `op-prop-tile-select${p.key === selectedPropertyKey ? ' op-prop-tile-select--selected' : ''}` : undefined}
                  onClick={onSelectProperty ? () => onSelectProperty(p.key === selectedPropertyKey ? null : p.key) : undefined}
                >
                  <StatTile {...buildTileProps(p)} />
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="op-hmiprops-singlebox">
          <div className={`op-hmiprops${kpiViewMode === 'text' ? ' op-hmiprops--text' : ''}${kpiViewMode === 'indicator' ? ' op-hmiprops--indicator' : ''}`}>
            {categories.map(cat => (
              <div key={cat} className="op-hmiprops-card op-hmiprops-card--noborder">
                <div className="op-hmiprops-card-title">{cat}</div>
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

// Fourth view option — the same evidence readings as a plain table instead
// of a chart or timeline. No fancy grid widget, just rows — this is meant
// to be the plainest possible way to look at the same numbers.
function EvidenceTable({ evidencePoints }) {
  return (
    <table className="op-evidence-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Value</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {evidencePoints.map((p, i) => (
          <tr key={i} className={p.label ? 'op-evidence-table-row--notable' : undefined}>
            <td>{p.time}</td>
            <td>{p.value}</td>
            <td>{p.label || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal tab visuals — Confidence / Risk / Expected outcome as icon+badge
// stat cards instead of a plain text grid, plus a shared vertical timeline
// used for both Evidence readings and What-changed. Built per feedback that
// the Investigate area reads as too much text — this is a first pass, not
// a final design.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = { high: '#0078d4', medium: '#5b9bd5', low: '#9db3c9', 'n/a': '#c2c6cc' };

const CONFIDENCE_LABELS = { high: 'High', medium: 'Medium', low: 'Low', 'n/a': 'N/A' };

const CONFIDENCE_BARS = { high: 3, medium: 2, low: 1, 'n/a': 0 };

const RISK_COLORS = { high: '#d64545', medium: '#e0a336', low: '#3fa64c', none: '#9096a3' };

const RISK_LABELS = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

const OUTCOME_COLORS = { recovering: '#3fa64c', resolved: '#3fa64c', none: '#9096a3' };

const OUTCOME_LABELS = { recovering: 'Improving', resolved: 'Resolved', none: 'N/A' };

function VerticalTimeline({ items, maxItems }) {
  let shown = items;
  if (maxItems && items.length > maxItems) {
    // Prioritize highlighted (notable) entries so truncation drops routine
    // readings first — but keep the surviving entries in their original
    // chronological order, since this is a timeline, not a ranked list.
    const indexed = items.map((it, i) => ({ it, i }));
    const highlighted = indexed.filter(x => x.it.highlighted);
    const rest = indexed.filter(x => !x.it.highlighted);
    const keep = [...highlighted, ...rest].slice(0, maxItems);
    keep.sort((a, b) => a.i - b.i);
    shown = keep.map(x => x.it);
  }
  return (
    <div className="op-timeline">
      {shown.map((it, i) => (
        <div key={i} className="op-timeline-row">
          <span
            className={`op-timeline-dot${it.highlighted ? ' op-timeline-dot--highlighted' : ''}`}
            style={it.highlighted ? { background: it.color, boxShadow: `0 0 0 1px ${it.color}` } : undefined}
          />
          <div className="op-timeline-time">{it.time}</div>
          <div className="op-timeline-primary">{it.primary}</div>
          {it.secondary && <div className="op-timeline-secondary">{it.secondary}</div>}
        </div>
      ))}
    </div>
  );
}

function formatStatusDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Attention first (needs a person to look), changeover second (expected,
// but worth a glance since it's a transition), running last (calm).
// 'down' only occurs in generic packs so far (unit-status.json); without an
// entry here it sorted as NaN, leaving down units in an arbitrary position.
const LINE_STATE_PRIORITY = { attention: 0, down: 1, changeover: 2, running: 3 };

function NowStrip({ selectedLine, onSelectLine }) {
  const orderedLines = useMemo(
    () => [...LINE_STATUS].sort((a, b) => LINE_STATE_PRIORITY[a.state] - LINE_STATE_PRIORITY[b.state]),
    []
  );
  return (
    <div className="op-now-strip">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tiles">
        {orderedLines.map(line => {
          const ctx = OPERATING_CONTEXT_BY_LINE[line.id];
          return (
            <button
              key={line.id}
              className={`op-now-tile${selectedLine === nowTileIdToAssetId(line.id) ? ' op-now-tile--selected' : ''}`}
              onClick={() => onSelectLine(nowTileIdToAssetId(line.id))}
            >
              <div className="op-now-tile-top">
                <span className="op-now-dot" style={{ background: STATE_COLORS[line.state] }} />
                <span className="op-now-tile-label">{line.label}</span>
              </div>
              <div className="op-now-tile-status-row">
                <span className="op-now-tile-status-icon" style={{ color: STATE_COLORS[line.state] }}>
                  <NowStatusIcon state={line.state} />
                </span>
                <span className="op-now-tile-status-text" style={{ color: STATE_COLORS[line.state] }}>
                  {STATE_LABELS[line.state]}
                </span>
              </div>
              {line.statusSinceMinutes != null && (
                <div className="op-now-tile-duration">for {formatStatusDuration(line.statusSinceMinutes)}</div>
              )}
              {ctx && (
                <div className="op-now-tile-context">
                  <span className="op-now-tile-mode" style={{ color: OPERATING_MODE_COLORS[ctx.mode] }}>
                    {ctx.mode.replace('_', ' ')}
                  </span>
                  <span className="op-now-tile-product">{ctx.product}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue map — a plant-wide heatmap of which line/station combinations have a
// real logged issue (from ATTENTION_ITEMS, which is itself sourced from the
// real event log) vs which are clean. First pass at visualizing where issues
// are actually concentrated, per request — this is what makes "Aurelia has
// zero events, Ferrum has several" visible at a glance instead of something
// you have to notice by reading the Attention list closely.
// ─────────────────────────────────────────────────────────────────────────────

const AURELIA_LINES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

const AURELIA_STATIONS = ['Intake', 'Stabilization', 'Refinement', 'Inspection', 'Buffer', 'Output'];

const FERRUM_LINES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

const FERRUM_STATIONS = ['Bulk Intake', 'Power Charge', 'Shaping', 'Transfer', 'Output'];

const STATION_ABBR = {
  'Intake': 'Intake', 'Stabilization': 'Stabil.', 'Refinement': 'Refine.',
  'Inspection': 'Inspect.', 'Buffer': 'Buffer', 'Output': 'Output',
  'Bulk Intake': 'Bulk In', 'Power Charge': 'Pwr Chg', 'Shaping': 'Shaping', 'Transfer': 'Transfer',
};

const ISSUEMAP_CLEAN_COLOR = '#3fa66c';

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function buildIssueLookup() {
  const map = {};
  ATTENTION_ITEMS.forEach(item => {
    // asset is "Refinery · Line · Station" for station-level items, or just
    // "Refinery · Line" for line-wide informational items (e.g. att-9) —
    // only the former maps onto a specific heatmap cell.
    const parts = item.asset.split(' · ');
    if (parts.length < 3) return;
    const line = parts[1];
    const station = parts[2];
    const key = `${line}|${station}`;
    const existing = map[key];
    // "Resolved" here means the situation has actually concluded
    // (detail.outcomeStatus), not how urgent it was — attentionState answers
    // a different question (how urgent is this) than whether it's still
    // open at all, and a low-urgency-but-still-open item should still read
    // as active, not muted.
    const isResolved = item.detail.outcomeStatus === 'resolved';
    if (!existing || SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
      map[key] = { severity: item.severity, id: item.id, signal: item.signal, resolved: isResolved };
    } else if (!isResolved && existing.resolved) {
      // A still-open item shares this cell with a higher-severity resolved
      // one — keep the cell reading as active rather than letting the
      // resolved item's color choice silently mute it.
      existing.resolved = false;
    }
  });
  return map;
}

function IssueMapGrid({ title, lines, stations, lookup, onSelectIssue }) {
  return (
    <div className="op-issuemap-group">
      <div className="op-issuemap-group-title">{title}</div>
      <table className="op-issuemap-table">
        <thead>
          <tr>
            <th></th>
            {stations.map(st => (
              <th key={st} title={st}>{STATION_ABBR[st] || st}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line}>
              <th>{line}</th>
              {stations.map(st => {
                const hit = lookup[`${line}|${st}`];
                const color = hit ? SEVERITY_COLORS[hit.severity] : ISSUEMAP_CLEAN_COLOR;
                const isResolved = hit && hit.resolved;
                return (
                  <td key={st}>
                    <div
                      className={`op-issuemap-cell${hit ? ' op-issuemap-cell--issue' : ''}${isResolved ? ' op-issuemap-cell--resolved' : ''}`}
                      style={isResolved ? { borderColor: color } : { background: color }}
                      title={hit ? `${line} · ${st}: ${hit.signal}${isResolved ? ' (resolved)' : ''}` : `${line} · ${st}: no issues logged`}
                      onClick={hit ? () => onSelectIssue(hit.id) : undefined}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The tab is the bottom 20px of this SAME element, not a separately
// positioned control — collapsed, the element sits translated up almost
// its full height so only that bottom strip (the tab) pokes out below the
// Now strip; clicking slides the whole rigid box down to translateY(0),
// so the tab visibly travels down together with the content, ending up at
// the true bottom of the fully revealed panel. Same idea reversed to close.
function IssueMapOverlay({ expanded, onToggle, onSelectIssue, selectedDetailLine, onCloseDetailLine, topOffset }) {
  return (
    <div
      className={`op-now-issuemap-overlay${expanded ? ' op-now-issuemap-overlay--open' : ''}`}
      style={{ top: topOffset, bottom: 100 }}
    >
      <div className="op-issuemap-content">
        <IssueMap onSelectIssue={onSelectIssue} selectedDetailLine={selectedDetailLine} onCloseDetailLine={onCloseDetailLine} />
      </div>
      <button
        className="op-now-pulltab"
        onClick={onToggle}
        title={expanded ? 'Hide issue map' : 'Show issue map'}
      >
        <span className={`op-now-pulltab-chevron${expanded ? ' op-now-pulltab-chevron--open' : ''}`}>▾</span>
      </button>
    </div>
  );
}

// Mined from OperatingContext in the nextgen workbook, at the same 14:05
// reference used for Work — this is what makes Ferrum F4 show CHANGEOVER
// while everything else is STEADY (its changeover window is 13:50–14:18).
const OPERATING_MODE_COLORS = {
  STEADY: '#3fa66c',
  CHANGEOVER: '#0078d4',
  RAMP_UP: '#e0a336',
  RAMP_DOWN: '#e0a336',
  STOPPED: '#8c8c8c',
  MAINTENANCE: '#6a3fd6',
  CONTROLLED_HOLD: '#d64545',
};

const STATION_TYPE_LABELS = {
  INTAKE: 'Intake', STABILIZATION: 'Stabilization', REFINEMENT: 'Refinement',
  INSPECTION: 'Inspection', BUFFER: 'Buffer', OUTPUT: 'Output',
  BULK_INTAKE: 'Bulk Intake', POWER_CHARGE: 'Power Charge', SHAPING: 'Shaping', TRANSFER: 'Transfer',
};

const HIGHLIGHT_FIELD_LABELS = {
  input_quality_score: 'Input quality', batch_variability: 'Batch variability',
  stability_score: 'Stability', oscillation_index: 'Oscillation',
  yield_rate: 'Yield', consistency_index: 'Consistency',
  inspection_pass_rate: 'Pass rate', first_pass_yield: 'First-pass yield',
  buffer_level: 'Buffer level', saturation_risk_index: 'Saturation risk',
  output_quality_score: 'Output quality', on_time_output_rate: 'On-time rate',
  material_availability: 'Material availability', supply_variability: 'Supply variability',
  charge_rate: 'Charge rate', system_stress: 'System stress',
  defect_rate: 'Defect rate', blocking_time: 'Blocking time', starvation_time: 'Starvation time',
};

// Raw nextgen-workbook property names -> readable labels, for captioning
// each real station's sparkline with what it's actually plotting.
const SPARKLINE_PROPERTY_LABELS = {
  ThroughputRate: 'Throughput', RejectRatePct: 'Reject Rate', PurityPct: 'Purity',
  BufferLevelPct: 'Buffer Level', ChargePV: 'Charge Rate', TransferRate: 'Transfer Rate',
  PressurePV: 'Pressure',
};

// Line-click detail panel — line rollups (throughput, OEE, WIP, bottleneck,
// health index, flow efficiency, instability) plus a per-station breakdown
// using each station's own type-specific highlights. Stations with no real
// telemetry (52 of 66 in this dataset) show a "baseline" tag rather than
// silently passing off a generated healthy guess as measured fact.
//
// Sparkline: only ever fed a REAL sampled time series — never used on the
// 52 baseline stations, since there's no real trend to show for those.
//
// Where no sparkline exists, LineDetail shows a "Normal Operation" badge in
// its place. That label is a deliberate demo simplification — what it
// actually means is "no real telemetry exists for this station, so a
// plausible healthy value was generated," not "we measured this and
// confirmed it's fine." Worth surfacing that distinction if anyone asks a
// follow-up question, even though the badge itself stays calm/simple.
function MiniSparkline({ values, type = 'line', color, width = 100, height = 26 }) {
  const data = values.map((v, i) => ({ x: i, y: v }));
  const lineColor = color || '#9096a3';
  const firstLastColor = color || '#9096a3';
  return (
    <Sparkline
      dataSource={data}
      argumentField="x"
      valueField="y"
      type={type}
      lineColor={lineColor}
      {...(color ? { pointColor: color } : {})}
      firstLastColor={firstLastColor}
      winColor="#3fa66c"
      lossColor="#d64545"
      showMinMax={true}
      maxColor="#e0a336"
      minColor="#e0a336"
      width={width}
      height={height}
    />
  );
}

// Genuinely responsive width: measures its own container via
// ResizeObserver and passes the real pixel width down to MiniSparkline
// explicitly, every time it changes. Height stays fixed (that's not what
// was asked to move) — only width is ever measured and re-passed.
function ResponsiveSparkline({ values, height = 26, color }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(100);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="op-statkpi-spark-inner">
      <MiniSparkline values={values} width={Math.max(1, Math.round(width))} height={height} color={color} />
    </div>
  );
}

// Value-first, label-second — the opposite emphasis of a bullet graph.
// Built for exactly the case a bullet handles badly: station-level KPIs
// that cluster tightly (95-100%) and read as identical-looking full bars
// rather than showing any real variation. The number itself carries the
// information here; the label just says what it is.
// unit/decimals come from generic packs' properties.json (spec §3.4);
// legacy packs have neither, so their values render exactly as before.
function StatTile({ label, value, min, max, sparkline, labelFirst, horizontal, viewMode = 'all', unit, decimals }) {
  const hasRange = min != null && max != null && typeof value === 'number' && max > min;
  const pct = hasRange ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : null;

  // Observed range: the real min/max the sparkline has actually shown —
  // not a fabricated threshold, just "here's where this has actually
  // moved" shaded onto the same scale as the current-value marker.
  let observed = null;
  if (hasRange && sparkline && sparkline.length > 1) {
    const obsMin = Math.min(...sparkline);
    const obsMax = Math.max(...sparkline);
    const left = Math.max(0, Math.min(100, ((obsMin - min) / (max - min)) * 100));
    const right = Math.max(0, Math.min(100, ((obsMax - min) / (max - min)) * 100));
    if (right > left) observed = { left, width: right - left };
  }

  const labelEl = <div className="op-statkpi-label">{label}</div>;
  const displayValue = (typeof value === 'number' && decimals != null) ? value.toFixed(decimals) : value;
  const valueEl = (
    <div className="op-statkpi-value">
      {displayValue}
      {unit && <span className="op-statkpi-unit">{unit}</span>}
    </div>
  );

  const vtrackEl = hasRange && (
    <div className="op-statkpi-vtrack">
      {observed && (
        <div className="op-statkpi-vtrack-observed" style={{ bottom: `${observed.left}%`, height: `${observed.width}%` }} />
      )}
      <div className="op-statkpi-vtrack-marker" style={{ bottom: `${pct}%` }} />
    </div>
  );

  if (horizontal) {
    // Text — value over label only, no indicator, no sparkline. The
    // plainest possible reading of the number.
    if (viewMode === 'text') {
      return (
        <div className="op-statkpi op-statkpi--text">
          {valueEl}
          {labelEl}
        </div>
      );
    }

    // Indicator — label on top, the same vertical track used elsewhere,
    // value underneath. A vertical card rather than a row.
    if (viewMode === 'indicator') {
      return (
        <div className="op-statkpi op-statkpi--indicator">
          {vtrackEl}
          {valueEl}
          {labelEl}
        </div>
      );
    }

    // Spark — identical to the default row, just without the track.
    // "All" (the default) and "Spark" share this same row layout, differing
    // only in whether the indicator renders.
    const showTrack = viewMode !== 'spark';
    return (
      <div className="op-statkpi op-statkpi--row">
        {showTrack && vtrackEl}
        <div className="op-statkpi-info">
          {labelFirst ? labelEl : valueEl}
          {labelFirst && valueEl}
          {!labelFirst && labelEl}
        </div>
        {sparkline && (
          <div className="op-statkpi-spark">
            <ResponsiveSparkline values={sparkline} height={60} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="op-statkpi">
      {labelFirst ? labelEl : valueEl}
      {labelFirst && valueEl}
      {hasRange && (
        <>
          <div className="op-statkpi-track">
            {observed && (
              <div className="op-statkpi-track-observed" style={{ left: `${observed.left}%`, width: `${observed.width}%` }} />
            )}
            <div className="op-statkpi-track-marker" style={{ left: `${pct}%` }} />
          </div>
          <div className="op-statkpi-track-labels">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </>
      )}
      {sparkline && (
        <div className="op-statkpi-spark">
          <MiniSparkline values={sparkline} width={160} />
        </div>
      )}
      {!labelFirst && labelEl}
    </div>
  );
}

function LineDetail({ line, label, onClose }) {
  const rollup = LINE_ROLLUPS[line];
  if (!rollup) return null;
  const stationEntries = Object.keys(STATION_METRICS)
    .filter(sid => sid.startsWith(`${line}_`))
    .map(sid => [sid, STATION_METRICS[sid]]);

  return (
    <div className="op-linedetail">
      <div className="op-linedetail-header">
        <span className="op-linedetail-title">Line Detail — {label}</span>
        <button className="op-linedetail-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="op-linedetail-rollup-row">
        <StatTile label="Throughput" value={`${rollup.line_throughput}${rollup.line_target_rate ? ` / ${rollup.line_target_rate}` : ''}/min`} />
        {LINE_SPARKLINES[line] && LINE_SPARKLINES[line].length > 2 && (
          <div className="op-linedetail-stat">
            <span className="op-linedetail-stat-label">Throughput trend</span>
            <MiniSparkline values={LINE_SPARKLINES[line]} />
          </div>
        )}
        <StatTile label="OEE" value={`${rollup.line_oee}%`} />
        <StatTile label="Flow Efficiency" value={`${rollup.flow_efficiency}%`} />
        <StatTile label="Health Index" value={rollup.system_health_index} />
        <StatTile label="Instability" value={rollup.instability_index} />
        <StatTile label="Total WIP" value={rollup.total_wip} />
        <StatTile label="Bottleneck" value={STATION_TYPE_LABELS[rollup.bottleneck_station] || rollup.bottleneck_station} />
      </div>
      <div className="op-linedetail-stations">
        {stationEntries.map(([sid, s]) => {
          const spark = STATION_SPARKLINES[sid];
          const hasSpark = spark && spark.values.length > 2;
          return (
            <div key={sid} className="op-linedetail-station">
              <div className="op-linedetail-station-top">
                <span className="op-linedetail-station-type">{STATION_TYPE_LABELS[s.stationType]}</span>
              </div>
              <div className="op-linedetail-station-kpis">
                <StatTile label="Throughput" value={`${s.throughput}/min`} />
                <StatTile label="OEE" value={`${s.oee}%`} />
                {s.highlights.map(h => (
                  <StatTile key={h.label} label={HIGHLIGHT_FIELD_LABELS[h.label] || h.label} value={h.value} />
                ))}
              </div>
              {hasSpark ? (
                <div className="op-linedetail-station-spark">
                  <div className="op-linedetail-station-spark-label">
                    {SPARKLINE_PROPERTY_LABELS[spark.property] || spark.property} trend
                  </div>
                  <MiniSparkline values={spark.values} color="#fbbf24" />
                </div>
              ) : (
                <div className="op-linedetail-station-normal">
                  <span className="op-linedetail-station-normal-dot" />
                  Normal Operation
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IssueMap({ onSelectIssue, selectedDetailLine, onCloseDetailLine }) {
  const lookup = useMemo(buildIssueLookup, []);
  const lineLabel = selectedDetailLine
    ? (selectedDetailLine.startsWith('AUR') ? 'Aurelia · A' : 'Ferrum · F') + selectedDetailLine.slice(-1)
    : null;

  return (
    <div className="op-issuemap-content">
      {selectedDetailLine ? (
        <LineDetail line={selectedDetailLine} label={lineLabel} onClose={onCloseDetailLine} />
      ) : (
        <>
          <div className="op-issuemap-section-label">Issue Map</div>
          <div className="op-issuemap-legend">
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: ISSUEMAP_CLEAN_COLOR }} />Clean</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.low }} />Low</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.medium }} />Medium</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.high }} />High</span>
          </div>
          <div className="op-issuemap-body">
            <IssueMapGrid title="Aurelia" lines={AURELIA_LINES} stations={AURELIA_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
            <IssueMapGrid title="Ferrum" lines={FERRUM_LINES} stations={FERRUM_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attention — ranked list
// ─────────────────────────────────────────────────────────────────────────────

function AttentionCard({ item, selected, pinned, onSelect, onTogglePin }) {
  return (
    <div
      className={`op-attention-card${selected ? ' op-attention-card--selected' : ''}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="op-attention-card-top">
        <span className="op-severity-dot" style={{ background: SEVERITY_COLORS[item.severity] }} />
        <span className="op-attention-asset">{item.asset}</span>
        <span
          className="op-attention-state-badge"
          style={{ color: ATTENTION_STATE_COLORS[item.attentionState] }}
          title={ATTENTION_STATE_LABELS[item.attentionState]}
        >
          {ATTENTION_STATE_LABELS[item.attentionState]}
        </span>
        <span className="op-attention-since">{item.since}</span>
        <button
          className={`op-pin-btn${pinned ? ' op-pin-btn--active' : ''}`}
          onClick={e => { e.stopPropagation(); onTogglePin(item.id); }}
          title={pinned ? 'Unpin' : 'Pin to top'}
        >
          📌
        </button>
      </div>
      <div className="op-attention-signal">{item.signal}</div>
      <div className="op-attention-interpretation">
        <AiPill />
        <span className="op-attention-interpretation-text">{item.aiInterpretation}</span>
      </div>
      <div className="op-attention-recommendation">
        <AiPill />
        <span className="op-attention-recommendation-text">{item.detail.recommendation}</span>
      </div>
    </div>
  );
}

// Left panel for the new Now work area — the real asset hierarchy
// (ASSET_DATA), not a separate operator-only copy of it, via the same
// HierarchyTree component the Data tab already uses elsewhere in the app.
const NowAssetTreePanel = forwardRef(function NowAssetTreePanel({ selectedThing, onSelectThing, typeList, tabIndex, onTabIndexChange }, ref) {
  const typesGridRef = useRef(null);
  useImperativeHandle(ref, () => ({
    updateDimensions: () => typesGridRef.current?.instance()?.updateDimensions(),
  }));

  return (
    <div className="op-panel op-now-tree-panel">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tree-wrap">
        <TabPanel
          height="100%"
          animationEnabled={false}
          swipeEnabled={false}
          selectedIndex={tabIndex}
          onSelectionChanged={e => onTabIndexChange(e.component.option('selectedIndex'))}
        >
          <TabPanelItem title="Types">
            <div className="left-panel-tab-content op-now-tree-tab-content">
              <DataListGrid
                ref={typesGridRef}
                items={typeList}
                columns={TYPE_LIST_COLUMNS}
                selectedId={selectedThing?.kind === 'type' ? selectedThing.id : null}
                onSelect={id => onSelectThing(id ? { kind: 'type', id } : null)}
                noDataText="No types found."
                searchEnabled={false}
              />
            </div>
          </TabPanelItem>
          <TabPanelItem title="Assets">
            <div className="left-panel-tab-content op-now-tree-tab-content">
              <HierarchyTree
                dataSource={CURRENT_ASSET_DATA}
                displayExpr="name"
                itemRender={ConfiguratorAssetTreeItemTemplate}
                selectedId={selectedThing?.kind === 'asset' ? selectedThing.id : null}
                onSelect={id => onSelectThing({ kind: 'asset', id })}
              />
            </div>
          </TabPanelItem>
        </TabPanel>
      </div>
    </div>
  );
});

// Left panel for the new Operator-only Assets area — the real asset
// hierarchy, same HierarchyTree/CURRENT_ASSET_DATA/item-template pattern
// already prototyped (commented out) in NowAssetTreePanel above, just
// used directly for navigation/selection here rather than nested inside
// a Types/Assets tab switcher, since this area is assets-only.
function OperatorAssetTreePanel({ selectedAssetId, onSelectAsset }) {
  return (
    <div className="op-panel op-now-tree-panel op-operator-asset-tree-panel">
      <div className="op-zone-label">Assets</div>
      <div className="op-now-tree-wrap">
        <div className="left-panel-tab-content op-now-tree-tab-content">
          <HierarchyTree
            dataSource={CURRENT_ASSET_DATA}
            displayExpr="name"
            itemRender={NowAssetTreeItemTemplate}
            selectedId={selectedAssetId}
            onSelect={onSelectAsset}
          />
        </div>
      </div>
    </div>
  );
}

// Center panel for the new Operator-only Assets area — loads whichever
// asset is selected in OperatorAssetTreePanel and shows it through the
// same three visual playgrounds Visualization configures (Properties/
// Related Assets/All Assets), entirely read-only: no toolbar, no
// editing, no save. Properties reuses RelatedAssetBoxContent directly
// (it already renders a given asset's own real values under its type's
// saved template, flex or manual, with no canvas involved at all for
// manual mode — just absolutely-positioned tiles); Related Assets and
// All Assets reuse the same Cards/Diagram renderers Visualization uses,
// just with readOnly set so their canvases can't be dragged.
const ASSET_DETAIL_TAB_ITEMS = [
  { text: 'Properties', value: 'properties' },
  { text: 'Related Assets', value: 'related' },
  { text: 'All Assets', value: 'all' },
];

function OperatorAssetDetail({ selectedAssetId, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, allAssetsTemplate, hiddenAssetIds, activeTab, onActiveTabChange, onTitleClick, onGearClick }) {
  if (!selectedAssetId) {
    return (
      <div className="op-panel op-investigate-panel op-operator-asset-detail op-now-detail-empty">
        <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
      </div>
    );
  }
  const asset = CURRENT_ASSET_MAP[selectedAssetId];
  if (!asset) return null;
  const typeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
  const typeEntry = typeList.find(t => t.id === typeId);
  const typeName = typeEntry?.name ?? deslugifyType(asset.assetType);
  // Same reasoning as NowAssetDetail's own fullRangeEvidencePoints below —
  // no single narrative/event window here, show the full available trend.
  const evidencePoints = CURRENT_TIMESTAMPS.length
    ? [{ time: CURRENT_TIMESTAMPS[0] }, { time: CURRENT_TIMESTAMPS[CURRENT_TIMESTAMPS.length - 1] }]
    : [];

  return (
    <div className="op-panel op-investigate-panel op-operator-asset-detail">
      <div className="op-zone-label">{getAssetDisplayLabel(selectedAssetId)}</div>
      <div style={{ padding: '10px 12px 0' }}>
        <ButtonGroup
          items={ASSET_DETAIL_TAB_ITEMS}
          keyExpr="value"
          selectedItemKeys={[activeTab]}
          onItemClick={e => onActiveTabChange(e.itemData.value)}
          stylingMode="outlined"
        />
      </div>
      <div className="op-now-type-detail-main">
        {activeTab === 'properties' && (
          <div className={`op-hmiprops-singlebox${(assetDisplayTemplates?.[selectedAssetId]?.layoutMode ?? typeDisplayTemplates?.[typeId]?.layoutMode) === 'manual' ? ' op-hmiprops-singlebox--manual' : ''}`}>
            <RelatedAssetBoxContent
              relatedTypeId={typeId}
              relatedTypeName={typeName}
              relatedTypeExampleAssetId={selectedAssetId}
              typeDisplayTemplates={typeDisplayTemplates}
              typePropertyConfigs={typePropertyConfigs}
              assetDisplayTemplates={assetDisplayTemplates}
              assetPropertyConfigs={assetPropertyConfigs}
              evidencePoints={evidencePoints}
              onTitleClick={onTitleClick}
              onGearClick={onGearClick}
            />
          </div>
        )}
        {activeTab === 'related' && (
          <ReadOnlyRelatedAssetsView
            typeId={typeId}
            assetId={selectedAssetId}
            typeList={typeList}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            typeRelatedAssetConfigs={typeRelatedAssetConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            assetRelatedAssetConfigs={assetRelatedAssetConfigs}
            evidencePoints={evidencePoints}
            savedTemplate={assetRelatedAssetsTemplates?.[selectedAssetId] ?? relatedAssetsTemplates[typeId]}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        )}
        {activeTab === 'all' && (
          <ReadOnlyAllAssetsView
            typeList={typeList}
            hiddenAssetIds={hiddenAssetIds}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            savedTemplate={allAssetsTemplate}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        )}
      </div>
    </div>
  );
}

// Center preview for the Now area's own Assets tab, mirroring the type
// side's NowTypeMainPreview exactly (same component, generalized) — full
// per-asset visual-preference editing, not a placeholder.
function NowAssetDetail({ selectedThing, typeList, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, assetDisplayTemplates, onSaveAssetDisplayTemplate, assetRelatedAssetsTemplates, onSaveAssetRelatedAssetsTemplate, activeSaveHandlerRef, activeTabIndex, onViewModeChange, hiddenAssetIds, relatedAssetsTemplates, onSaveRelatedAssetsTemplate, allAssetsTemplate, onSaveAllAssetsTemplate, onTitleClick, propertyVisuals, previewRevision = 0 }) {
  // Lifted up here (rather than local state inside NowTypeMainPreview,
  // which remounts on every type switch via its own key={selectedThing.id})
  // so the toolbar's open/closed state survives flipping between types —
  // once the user opens it, it stays open. Still collapsed by default on
  // first load, since this component's own state starts false either way.
  const [toolbarExpanded, setToolbarExpanded] = useState(false);

  if (!selectedThing) {
    return (
      <div className="op-panel op-investigate-panel op-now-detail-empty">
        <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
      </div>
    );
  }

  const isAssetEntity = selectedThing.kind === 'asset';
  let title, assetIdForProperties, relationshipTypeId, thisAssetExampleId;

  if (!isAssetEntity) {
    const typeEntry = typeList.find(t => t.id === selectedThing.id);
    if (!typeEntry) {
      return (
        <div className="op-panel op-investigate-panel op-now-detail-empty">
          <div className="op-now-detail-placeholder-note">Select a type from the list to view it.</div>
        </div>
      );
    }
    title = typeEntry.name;
    assetIdForProperties = typeEntry.exampleAssetId;
    relationshipTypeId = selectedThing.id;
    thisAssetExampleId = typeEntry.exampleAssetId;
  } else {
    const asset = CURRENT_ASSET_MAP[selectedThing.id];
    if (!asset) {
      return (
        <div className="op-panel op-investigate-panel op-now-detail-empty">
          <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
        </div>
      );
    }
    title = asset.name;
    assetIdForProperties = selectedThing.id;
    // This asset's own real type — used for relationship lookups and as
    // the type-level fallback key, same TYPE_<level>_<type> shape
    // attentionAssetToTypeId uses elsewhere for the same purpose.
    relationshipTypeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
    thisAssetExampleId = selectedThing.id;
  }

  // No single narrative/event window here (unlike Investigate) — show the
  // full available trend instead of slicing to nothing.
  const fullRangeEvidencePoints = CURRENT_TIMESTAMPS.length
    ? [{ time: CURRENT_TIMESTAMPS[0] }, { time: CURRENT_TIMESTAMPS[CURRENT_TIMESTAMPS.length - 1] }]
    : [];

  const { properties, sparklineSource } = resolveAssetProperties(assetIdForProperties);

  // Main preview area — the visual playground matching whichever Details-
  // panel tab is active (Properties/Related Assets/All Assets). Editing
  // the underlying config lists happens in the Details panel (right
  // rail) instead of here — this is the "play with layout" half. One
  // shared component for both types and real assets now: entityId is the
  // storage key (type id or asset id) for this thing's own saved
  // preferences, while typeDisplayTemplates/typePropertyConfigs/
  // typeRelatedAssetConfigs stay the real type-level maps regardless
  // (every OTHER related box shown alongside this one is always a type-
  // level thing), and the asset-level maps ride along so
  // RelatedAssetBoxContent's own fallback can apply to every box,
  // including this one's.
  return (
    <NowTypeMainPreview
      // previewRevision: bumped when this asset's saved settings are
      // reverted, remounting the editors onto the type's settings (they
      // only read their saved template on mount).
      key={`${selectedThing.id}:${previewRevision}`}
      activeTabIndex={activeTabIndex}
      title={title}
      entityId={selectedThing.id}
      isAssetEntity={isAssetEntity}
      relationshipTypeId={relationshipTypeId}
      thisAssetExampleId={thisAssetExampleId}
      typeList={typeList}
      properties={properties}
      sparklineSource={sparklineSource}
      evidencePoints={fullRangeEvidencePoints}
      typePropertyConfigs={typePropertyConfigs}
      typeRelatedAssetConfigs={typeRelatedAssetConfigs}
      typeDisplayTemplates={typeDisplayTemplates}
      typeRelatedAssetsTemplates={relatedAssetsTemplates}
      onSaveTypeDisplayTemplate={onSaveTypeDisplayTemplate}
      onSaveTypeRelatedAssetsTemplate={onSaveRelatedAssetsTemplate}
      assetPropertyConfigs={assetPropertyConfigs}
      assetRelatedAssetConfigs={assetRelatedAssetConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
      onSaveAssetDisplayTemplate={onSaveAssetDisplayTemplate}
      onSaveAssetRelatedAssetsTemplate={onSaveAssetRelatedAssetsTemplate}
      activeSaveHandlerRef={activeSaveHandlerRef}
      onViewModeChange={onViewModeChange}
      hiddenAssetIds={hiddenAssetIds}
      allAssetsTemplate={allAssetsTemplate}
      onSaveAllAssetsTemplate={onSaveAllAssetsTemplate}
      onTitleClick={onTitleClick}
      toolbarExpanded={toolbarExpanded}
      onToolbarExpandedChange={setToolbarExpanded}
      propertyVisuals={propertyVisuals}
    />
  );
}

// Shown only for type selections — Properties (a list of this type's
// properties, each with an always/sometimes/never visibility choice,
// sharing the space with the same KPI visualization used everywhere else)
// and Children (not yet built — see note in the tab itself).
const elk = new ELK();

// Algorithm choices offered in the diagram view's toolbar. 'disco' isn't
// included since elkjs dropped it from this bundled build after 0.8.2
// (confirmed directly — it throws "Layout algorithm 'disco' not found" on
// this exact installed version); 'box'/'rectpacking' are rectangle-packing
// algorithms rather than relationship-aware layouts, so left out as not a
// good fit for a node-link diagram.
const RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS = [
  { value: 'layered', label: 'Layered', text: 'Layered', Icon: LayeredAlgorithmIcon },
  { value: 'mrtree', label: 'Tree', text: 'Tree', Icon: TreeAlgorithmIcon },
  { value: 'radial', label: 'Radial', text: 'Radial', Icon: RadialAlgorithmIcon },
  { value: 'force', label: 'Force', text: 'Force', Icon: ForceAlgorithmIcon },
];

// Only 'layered' and 'mrtree' actually respect elk.direction — verified
// directly by comparing DOWN vs RIGHT output for each algorithm; radial,
// force, and stress produced byte-identical positions regardless, since
// they're organic/physics-style layouts with no inherent "flow" direction.
const RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS = new Set(['layered', 'mrtree']);

const RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS = [
  { text: 'Vertical', value: 'DOWN', Icon: ColumnFlowIcon },
  { text: 'Horizontal', value: 'RIGHT', Icon: RowFlowIcon },
];

// Gates the edge routing and both spacing controls below — all three use
// layered-specific ELK options. Verified directly: the other four
// algorithms produced byte-identical output regardless of any of these
// three settings, since each has its own internal routing/spacing logic
// that doesn't use them at all.
const RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS = new Set(['layered']);

// Simplified to just the two ELK actually computes distinct bend-point
// routing for (verified earlier: ORTHOGONAL gives hard right angles,
// POLYLINE gives angled-but-straight segments — 'Default'/UNDEFINED and
// SPLINES were dropped as unnecessary choices here).
const RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS = [
  { text: 'Orthogonal', value: 'ORTHOGONAL', Icon: OrthogonalRoutingIcon },
  { text: 'Polyline', value: 'POLYLINE', Icon: PolylineRoutingIcon },
];

// Direct control over the two spacing settings that actually, always
// govern compactness — replaced an earlier edge-node/edge-edge spacing
// pair that turned out to be "floor" constraints only binding once they
// exceeded these two values anyway (verified directly: bounds stayed
// completely flat until the edge-spacing value exceeded 80, the
// nodeNodeBetweenLayers value below), making them invisible at any
// preset that made sense on their own. These two are direct, unconditional
// constraints instead — every value tested here produced a real,
// verified change in the laid-out bounds. Rendered as sliders (0-200,
// verified safe including both at 0 simultaneously — no error, nodes
// just pack as tight as their own sizes allow) rather than discrete
// presets, for finer control across the range.
// elk.spacing.nodeNode: general gap between nodes. Verified to
// meaningfully affect layered, mrtree, and force; a smaller but still
// real effect on radial; negligible on stress — shown for every
// algorithm since it's a core (non-layered-specific) option.
// elk.layered.spacing.nodeNodeBetweenLayers: gap specifically between
// layers (columns/rows). Verified to affect only 'layered' — even
// mrtree, also direction-aware, showed zero change — so this control is
// scoped to 'layered' only, same as the other RELATED_ASSETS_DIAGRAM_
// LAYERED_ONLY_CONTROLS.
// Fallback only, for the rare case a node's real measured dimensions
// aren't available for some reason — the normal path now uses each
// node's actual rendered size (node.measured.width/height, via React
// Flow's own measurement), not a fixed stub. See the hide → measure →
// layout → reveal sequence in RelatedAssetsDiagramInner below.
const RELATED_ASSETS_DIAGRAM_NODE_WIDTH = 160;

const RELATED_ASSETS_DIAGRAM_NODE_HEIGHT = 50;

// Runs nodes/edges through ELK's layered algorithm and returns them in
// React Flow's shape (position: {x, y} instead of bare x/y fields).
// Mirrors React Flow's own documented elkjs integration pattern exactly
// (https://reactflow.dev/examples/layout/elkjs) — verified directly
// against a real render, not just read. Each node's own width/height
// (real measured dimensions, by the time this is called) are used as-is;
// only falls back to the stub size above if a node genuinely has none.
function getElkLayoutedElements(nodes, edges, layoutOptions) {
  const { algorithm, direction, edgeRouting, nodeSpacing, layerSpacing, aspectRatio } = layoutOptions;
  const isVertical = direction === 'DOWN';
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': algorithm,
      'elk.direction': direction,
      // Direct, unconditional spacing controls — unlike the earlier
      // edge-node/edge-edge spacing pair (removed), these two always
      // affect the laid-out bounds, verified directly across a wide
      // range of values on real graph data.
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.nodeNode': String(nodeSpacing),
      // elk.aspectRatio only reshapes the drawing (into multiple rows)
      // when paired with wrapping.strategy — verified directly: without
      // it, aspectRatio only ever has a binary "wrap once, all the way"
      // effect; with MULTI_EDGE wrapping enabled, values from ~0.3
      // (near-square) up through the graph's natural ratio produce a
      // real, smooth range of shapes. Both are only respected by
      // 'layered' — the other four algorithms produced byte-identical
      // output regardless. Safe to always enable wrapping alongside a
      // high aspectRatio value (like the default here) — verified this
      // produces the exact same bounds as not setting either at all,
      // since ELK only wraps when the natural shape doesn't already
      // satisfy the requested ratio.
      'elk.aspectRatio': String(aspectRatio),
      'elk.layered.wrapping.strategy': 'MULTI_EDGE',
      // Only 'layered' actually respects this — verified directly by
      // comparing output across all five algorithms; the other four
      // produced byte-identical results regardless, since each has its
      // own internal routing logic that doesn't use this option at all.
      // Passing it regardless is harmless (silently ignored elsewhere),
      // but the toolbar only shows this control for 'layered' so the
      // choice isn't misleading.
      'elk.edgeRouting': edgeRouting,
      // Every edge now finds its own real closest side on each node —
      // "Fixed Sides" mode (one fixed slot per node regardless of where
      // a given edge's other end actually was) has been removed
      // entirely. Verified to run cleanly (no error) on all five
      // algorithms. Pairs with the RelatedAssetsFloatingEdge component,
      // which does the React Flow side of actually drawing to a real
      // point on each node's border instead of one fixed Handle.
      'elk.portConstraints': 'FREE',
    },
    children: nodes.map(n => ({
      ...n,
      // These two are no longer used for actual edge rendering —
      // RelatedAssetsFloatingEdge always computes its own connection
      // point now — but ELK's node input still expects some values here.
      targetPosition: isVertical ? 'top' : 'left',
      sourcePosition: isVertical ? 'bottom' : 'right',
      width: n.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH,
      height: n.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT,
    })),
    edges,
  };
  return elk.layout(graph).then(layoutedGraph => ({
    nodes: layoutedGraph.children.map(n => ({ ...n, position: { x: n.x, y: n.y } })),
    edges: layoutedGraph.edges,
  }));
}

// "Free ports" support (letting an edge exit from whichever side of a
// node is actually closest, rather than one fixed side for every edge)
// needs two separate pieces: telling ELK it's allowed to think this way
// (elk.portConstraints: FREE, set in getElkLayoutedElements) and actually
// rendering an edge that connects to a real geometric point on each
// node's border rather than one fixed Handle position. This second part
// is what the functions below do — adapted from xyflow's own official
// floating-edges example (reactflow.dev/examples/edges/floating-edges),
// updated for React Flow v12's InternalNode shape (internals.
// positionAbsolute, measured.width/height) rather than the older v9/v11
// shape those docs were written against. Verified directly against three
// geometric test cases (node to the right, node below, node diagonal)
// before use — all three produced exactly the expected intersection
// points and sides.

// Returns the point where a straight line from intersectionNode's center
// to targetNode's center crosses intersectionNode's own rectangular
// border.
function getNodeIntersection(intersectionNode, targetNode) {
  const iw = intersectionNode.measured?.width ?? intersectionNode.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const ih = intersectionNode.measured?.height ?? intersectionNode.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const iPos = intersectionNode.internals.positionAbsolute;
  const tw = targetNode.measured?.width ?? targetNode.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const th = targetNode.measured?.height ?? targetNode.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const tPos = targetNode.internals.positionAbsolute;

  const w = iw / 2;
  const h = ih / 2;
  const x2 = iPos.x + w;
  const y2 = iPos.y + h;
  const x1 = tPos.x + tw / 2;
  const y1 = tPos.y + th / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1));
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

// Which side (for Handle-position purposes) a given intersection point
// actually falls on, for a given node.
function getFloatingEdgePosition(node, intersectionPoint) {
  const nw = node.measured?.width ?? node.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const nh = node.measured?.height ?? node.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const nPos = node.internals.positionAbsolute;
  const nx = Math.round(nPos.x);
  const ny = Math.round(nPos.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);
  if (px <= nx + 1) return 'left';
  if (px >= nx + nw - 1) return 'right';
  if (py <= ny + 1) return 'top';
  if (py >= ny + nh - 1) return 'bottom';
  return 'top';
}

// The point at the exact middle of one side of a node's border — used
// for "Center" connection point mode. Side is determined the same way
// as "Anywhere" mode (via the real intersection point below), so both
// modes agree on *which* side is closest; they only differ in *where*
// along that side the line actually lands.
function getSideCenterPoint(node, side) {
  const w = node.measured?.width ?? node.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const h = node.measured?.height ?? node.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  const pos = node.internals.positionAbsolute;
  if (side === 'left') return { x: pos.x, y: pos.y + h / 2 };
  if (side === 'right') return { x: pos.x + w, y: pos.y + h / 2 };
  if (side === 'top') return { x: pos.x + w / 2, y: pos.y };
  return { x: pos.x + w / 2, y: pos.y + h }; // 'bottom'
}

// connectionPointMode: 'anywhere' uses the real geometric intersection
// point (can land anywhere along the closest side); 'center' uses the
// same closest-side determination but snaps the actual connection point
// to that side's midpoint instead.
function getFloatingEdgeParams(source, target, connectionPointMode) {
  const sourceIntersectionPoint = getNodeIntersection(source, target);
  const targetIntersectionPoint = getNodeIntersection(target, source);
  const sourcePos = getFloatingEdgePosition(source, sourceIntersectionPoint);
  const targetPos = getFloatingEdgePosition(target, targetIntersectionPoint);
  const sourcePoint = connectionPointMode === 'center' ? getSideCenterPoint(source, sourcePos) : sourceIntersectionPoint;
  const targetPoint = connectionPointMode === 'center' ? getSideCenterPoint(target, targetPos) : targetIntersectionPoint;
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos,
    targetPos,
  };
}

// Both helpers below operate on the full nodes array but only ever move
// nodes where node.selected is true (React Flow's own selection state,
// already tracked for free via onNodesChange/applyNodeChanges — no
// extra wiring needed for multi-select, which is built in via shift+drag
// or ctrl/cmd+click). Unselected nodes are returned unchanged. Verified
// directly against a synthetic case with differently-sized nodes before
// use: align correctly matches edges/centers of the selection's own
// combined bounding box, and distribute produces genuinely equal gaps
// while leaving the two extreme (first/last) nodes' outer edges in
// place — only the nodes in between move.
function getNodeBounds(n) {
  const w = n.measured?.width ?? n.width ?? RELATED_ASSETS_DIAGRAM_NODE_WIDTH;
  const h = n.measured?.height ?? n.height ?? RELATED_ASSETS_DIAGRAM_NODE_HEIGHT;
  return { left: n.position.x, right: n.position.x + w, top: n.position.y, bottom: n.position.y + h, width: w, height: h };
}

function alignSelectedNodes(nodes, mode) {
  const selected = nodes.filter(n => n.selected);
  if (selected.length < 2) return null;
  const bounds = new Map(selected.map(n => [n.id, getNodeBounds(n)]));
  const tops = selected.map(n => bounds.get(n.id).top);
  const bottoms = selected.map(n => bounds.get(n.id).bottom);
  const lefts = selected.map(n => bounds.get(n.id).left);
  const rights = selected.map(n => bounds.get(n.id).right);
  let target;
  if (mode === 'top') target = Math.min(...tops);
  else if (mode === 'bottom') target = Math.max(...bottoms);
  else if (mode === 'middle') target = (Math.min(...tops) + Math.max(...bottoms)) / 2;
  else if (mode === 'left') target = Math.min(...lefts);
  else if (mode === 'right') target = Math.max(...rights);
  else if (mode === 'center') target = (Math.min(...lefts) + Math.max(...rights)) / 2;

  return nodes.map(n => {
    if (!n.selected) return n;
    const b = bounds.get(n.id);
    if (mode === 'top') return { ...n, position: { ...n.position, y: target } };
    if (mode === 'bottom') return { ...n, position: { ...n.position, y: target - b.height } };
    if (mode === 'middle') return { ...n, position: { ...n.position, y: target - b.height / 2 } };
    if (mode === 'left') return { ...n, position: { ...n.position, x: target } };
    if (mode === 'right') return { ...n, position: { ...n.position, x: target - b.width } };
    return { ...n, position: { ...n.position, x: target - b.width / 2 } }; // 'center'
  });
}

function distributeSelectedNodes(nodes, axis) {
  const selected = nodes.filter(n => n.selected);
  if (selected.length < 3) return null;
  const bounds = new Map(selected.map(n => [n.id, getNodeBounds(n)]));
  const posKey = axis === 'horizontal' ? 'left' : 'top';
  const sizeKey = axis === 'horizontal' ? 'width' : 'height';
  const sorted = [...selected].sort((a, b) => bounds.get(a.id)[posKey] - bounds.get(b.id)[posKey]);
  const first = bounds.get(sorted[0].id);
  const last = bounds.get(sorted[sorted.length - 1].id);
  const totalSpan = (last[posKey] + last[sizeKey]) - first[posKey];
  const totalSize = sorted.reduce((sum, n) => sum + bounds.get(n.id)[sizeKey], 0);
  const gap = (totalSpan - totalSize) / (sorted.length - 1);

  let cursor = first[posKey];
  const newPos = new Map();
  sorted.forEach(n => {
    const b = bounds.get(n.id);
    newPos.set(n.id, cursor);
    cursor += b[sizeKey] + gap;
  });

  return nodes.map(n => {
    if (!newPos.has(n.id)) return n;
    return axis === 'horizontal'
      ? { ...n, position: { ...n.position, x: newPos.get(n.id) } }
      : { ...n, position: { ...n.position, y: newPos.get(n.id) } };
  });
}

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
function RelatedAssetsFloatingEdge({ id, source, target, markerEnd, style, label, data }) {
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
const RELATED_ASSETS_EDGE_TYPES = { floatingEdge: RelatedAssetsFloatingEdge };

// React Flow's built-in default node type comes with handles already —
// a custom type (needed here to reuse the Cards view's real property
// rendering, via RelatedAssetBoxContent) must add its own explicitly, per
// React Flow's own custom-node docs. Both a target and source handle are
// always present regardless of whether this particular node happens to
// use both in the current graph, since the same node reused elsewhere
// might need the other one.
function RelatedAssetDiagramNode({ data }) {
  const effectiveTemplate = data.assetDisplayTemplates?.[data.relatedTypeExampleAssetId] ?? data.typeDisplayTemplates?.[data.relatedTypeId];
  const isManual = effectiveTemplate?.layoutMode === 'manual';
  return (
    <div className={`op-related-asset-box${data.isCenter ? ' op-related-asset-box--center' : ''}${isManual ? ' op-related-asset-box--manual' : ''}`}>
      <Handle type="target" position={data.targetHandlePosition} />
      <RelatedAssetBoxContent
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
const RELATED_ASSETS_NODE_TYPES = { relatedAssetNode: RelatedAssetDiagramNode };

// Property-layout manual mode's own node type — one property tile per
// node, positioned freely on the canvas. No Handle elements at all: unlike
// RelatedAssetDiagramNode, this graph never has edges (properties don't
// relate to each other the way types do), so there's nothing to connect.
function PropertyLayoutNode({ data }) {
  return (
    <div className={`op-property-layout-node${data.selected ? ' op-prop-tile-select--selected' : ''}`}>
      <StatTile {...data.tileProps} />
    </div>
  );
}

const PROPERTY_LAYOUT_NODE_TYPES = { propertyLayoutNode: PropertyLayoutNode };

// Cards manual mode's own node type — one related-asset type box per
// node, same no-edges reasoning as PropertyLayoutNode above (asset
// cards don't relate to each other spatially the way Diagram's types
// do — that's what Diagram itself is for).
function CardsLayoutNode({ data }) {
  const effectiveTemplate = data.boxProps?.assetDisplayTemplates?.[data.boxProps?.relatedTypeExampleAssetId] ?? data.boxProps?.typeDisplayTemplates?.[data.boxProps?.relatedTypeId];
  const isManual = effectiveTemplate?.layoutMode === 'manual';
  return (
    <div className={`op-related-asset-box op-property-layout-node${data.isCenter ? ' op-related-asset-box--center' : ''}${isManual ? ' op-related-asset-box--manual' : ''}`}>
      <RelatedAssetBoxContent {...data.boxProps} />
    </div>
  );
}

const CARDS_LAYOUT_NODE_TYPES = { cardsLayoutNode: CardsLayoutNode };

// Related Assets tab's relational-diagram view — the current type plus its
// related assets as a node-link diagram, auto-laid-out via ELK. Self-
// contained ReactFlowProvider so this can be dropped in anywhere without
// the caller needing to remember to wrap it.
const RelatedAssetsDiagram = forwardRef(function RelatedAssetsDiagram({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeList, allTypesMode, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutResetSignal, onManualEdit, setDiagramShowLabels, setDiagramShowArrowheads, setDiagramConnectionPointMode, onPositionsChange, savedManualPositions, readOnly, onTitleClick, onGearClick }, ref) {
  return (
    <ReactFlowProvider>
      <RelatedAssetsDiagramInner
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

const RelatedAssetsDiagramInner = forwardRef(function RelatedAssetsDiagramInner({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeList, allTypesMode, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutResetSignal, onManualEdit, setDiagramShowLabels, setDiagramShowArrowheads, setDiagramConnectionPointMode, onPositionsChange, savedManualPositions, readOnly, onTitleClick, onGearClick }, ref) {
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
  // StatTiles) so React Flow can measure the real thing, not a guess.
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
      // Every edge now renders via RelatedAssetsFloatingEdge (computing
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
  // side RelatedAssetsFloatingEdge lands (see getFloatingEdgeParams) —
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

  // Align/Distribute moved to the parent toolbar (RelatedAssetsPreview's
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

// 2-position slider for related-asset density: min shows only assets
// marked "always" in the left table, max shows every related asset
// regardless of its own marking. Same concept as the properties tab's
// 3-position tier slider, one fewer stop since there's no "sometimes"
// state here.
const RELATED_ASSET_DENSITY_VALUES = ['always', 'all'];

const RELATED_ASSET_DENSITY_LABELS = { 0: 'min', 1: 'max' };

const formatRelatedAssetDensityLabel = (v) => RELATED_ASSET_DENSITY_LABELS[v] ?? '';

// Renders every related-asset row as its own box of property tiles,
// filtered by the density slider and arranged via the same
// row/column + wrap + cluster/distribute controls already used for
// individual property tiles in HmiPropertiesListing — here they govern
// how the boxes themselves flow, not what's inside them. Each box shows
// only P1 ("headline") properties, so this stays a genuine preview rather
// than every related asset's full property list.
// Renders a related type's title plus its "always"-visible properties as
// StatTiles, using that type's own saved display template — the single
// source of truth for a related asset's content, shared by the Cards
// view's boxes (wrapped in .op-related-asset-box) and the Diagram view's
// custom node (wrapped differently, with Handles added around it).
// Real measured StatTile dimensions vary substantially by view mode —
// text tiles are a compact 120x60, indicator tiles stack a 60px vertical
// gauge track above the value and label (real height ~114px), and
// spark/all tiles run a sparkline alongside the value instead (real width
// ~233-244px, height unchanged at ~60px since the sparkline sits beside
// the text rather than below it). Each entry here is that real measurement
// plus a generous safety margin, used only by RelatedAssetBoxContent's
// manual-mode static bounding-box estimate below (never a live
// measurement, since there's nothing to measure against in a static
// render), so a saved manual layout's container is sized correctly for
// whichever view mode the type is actually configured with.
const STAT_TILE_SIZE_ESTIMATES = {
  text: { width: 140, height: 80 },
  indicator: { width: 140, height: 140 },
  spark: { width: 260, height: 80 },
  all: { width: 280, height: 80 },
};

function RelatedAssetBoxContent({ relatedTypeId, relatedTypeName, relatedTypeExampleAssetId, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, onTitleClick, onGearClick }) {
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
      className={`op-hmiprops-card-title${onTitleClick ? ' op-hmiprops-card-title--clickable' : ''}${onGearClick ? ' op-hmiprops-card-title--with-gear' : ''}`}
      onClick={onTitleClick ? () => onTitleClick({ relatedTypeId, relatedTypeExampleAssetId }) : undefined}
    >
      {relatedTypeName}
    </div>
  );
  // The gear icon — Operator's Assets area only (onGearClick is never
  // passed from Visualization's own call sites), jumping from an asset's
  // real-values box straight to the config screen that shaped it:
  // Visualization's Properties tab for that asset's type. Absolutely
  // positioned against the outer box (op-related-asset-box/
  // op-hmiprops-singlebox, both given position:relative for exactly this)
  // rather than placed next to the title text, so it sits in the box's
  // own corner regardless of how long that title is — stopPropagation so
  // clicking it doesn't also fire the title's own onClick underneath, or
  // bubble into a React Flow node click in the Diagram/Cards-manual
  // contexts this box also renders inside.
  const gearElement = onGearClick ? (
    <button
      type="button"
      className="op-asset-box-gear"
      title="Open properties template"
      onClick={e => { e.stopPropagation(); onGearClick({ relatedTypeId }); }}
    >
      <GearIcon />
    </button>
  ) : null;

  // This asset's own saved template wins over its type's, when one
  // exists — an all-or-nothing choice per template (not merged field by
  // field), since flowDirection/viewMode/etc. are saved together as one
  // cohesive layout choice via the Save Template button, and mixing an
  // asset's flowDirection with its type's viewMode would be more
  // confusing than useful. Undefined/empty assetDisplayTemplates (every
  // call site outside the Now area's own Assets tab) falls through to
  // the type-level template exactly as before.
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

  const resolved = resolveAssetProperties(relatedTypeExampleAssetId);
  const staticProperties = resolved?.properties;
  const sparklineSource = resolved?.sparklineSource;
  if (!staticProperties) return null;

  // When a time-track scrub is active, show each property's own reading at
  // that instant instead of the current/latest snapshot — pulled from the
  // exact same per-property series the sparklines already use, so this is
  // real historical data, not a simulated/interpolated stand-in. A
  // property with no series at that source (shouldn't normally happen —
  // the snapshot and series datasets share the same key set — but not
  // guaranteed for every model/source combination) keeps its static value
  // rather than disappearing.
  const properties = scrubTimeIndex == null ? staticProperties : Object.fromEntries(
    Object.entries(staticProperties).map(([key, staticValue]) => {
      const series = sparklineSource ? getPropertySeriesForSource(sparklineSource, key) : null;
      const scrubbedValue = series?.[scrubTimeIndex];
      return [key, typeof scrubbedValue === 'number' ? scrubbedValue : staticValue];
    })
  );

  // Each box uses that related type's own saved display template (the
  // same one set via the Properties tab's Save Template button) rather
  // than one shared setting for every box — a pump the user configured as
  // Indicator, a valve as Text, and a tank as All each render according
  // to their own choice. Falls back to the same defaults
  // HmiPropertiesListing itself uses for a type that's never been
  // explicitly saved.
  const template = effectiveTemplate;
  const boxFlowDirection = template?.flowDirection ?? 'row';
  const boxFlowWrap = template?.flowWrap ?? 'wrap';
  const boxAlignContent = template?.alignContent ?? 'flex-start';

  // Shows the properties this type has actually been configured as
  // "always" visible via the Properties tab's own visibility toggle
  // (typePropertyConfigs), merged with this specific asset's own overrides
  // when it has any (asset-level wins per property) — not the data-driven
  // P1/P2/P3 tier, which is a fixed classification independent of what the
  // user has customized. A property with no explicit override at either
  // level defaults to "always" too, matching getPropertyVisibilityForType's
  // own default elsewhere.
  const visibilityRows = getPropertyVisibilityForType(relatedTypeId, properties, typePropertyConfigs, relatedTypeExampleAssetId, assetPropertyConfigs);
  const alwaysEntries = visibilityRows
    .filter(p => p.visibility === 'always')
    .map(p => [p.key, properties[p.key]]);
  const tileViewMode = key => resolvePropertyViewMode(boxPropertyViewModes, key, boxViewMode);
  // Same order the Configurator preview shows: category-grouped by
  // default, rearranged by this asset's (else its type's) saved order.
  const unorderedEntries = alwaysEntries.length ? alwaysEntries : Object.entries(properties);
  const entryValueByKey = new Map(unorderedEntries);
  const boxOrder = resolveEntityOrder(displayOrders.typeProperty, displayOrders.assetProperty, relatedTypeId, relatedTypeExampleAssetId);
  const entriesToShow = applySavedOrder(categoryOrderedPropertyKeys(unorderedEntries.map(([key]) => key)), boxOrder)
    .map(key => [key, entryValueByKey.get(key)])
    .filter(([key]) => tileViewMode(key) !== 'none');
  const boxKpisClass = `op-related-asset-box-kpis${boxViewMode === 'text' ? ' op-related-asset-box-kpis--text' : ''}${boxViewMode === 'indicator' ? ' op-related-asset-box-kpis--indicator' : ''}`;

  const rangeStart = evidencePoints && evidencePoints.length ? evidencePoints[0].time : null;
  const rangeEnd = evidencePoints && evidencePoints.length ? evidencePoints[evidencePoints.length - 1].time : null;

  const boxLayoutMode = template?.layoutMode ?? 'auto';
  const boxManualPositions = template?.manualPositions ?? {};

  // Shared between both render paths below so the range/sparkline lookup
  // logic isn't duplicated — this was previously inline only in the flex
  // path, which is exactly how the manual-mode bug happened in the first
  // place (a second render path added later with no shared home for this).
  const renderStatTile = ([key, value]) => {
    const range = PROPERTY_RANGES[key];
    const fullSeries = sparklineSource ? getPropertySeriesForSource(sparklineSource, key) : null;
    const sparkline = (fullSeries && rangeStart && rangeEnd) ? sliceSeriesToRange(fullSeries, rangeStart, rangeEnd) : null;
    return (
      <StatTile
        key={key}
        label={PROPERTY_LABELS[key] || key}
        value={value}
        min={range ? range[0] : undefined}
        max={range ? range[1] : undefined}
        sparkline={sparkline && sparkline.length > 2 ? sparkline : null}
        unit={PROPERTY_UNITS[key]}
        decimals={PROPERTY_DECIMALS[key]}
        horizontal
        labelFirst
        viewMode={tileViewMode(key)}
      />
    );
  };

  // Manual layout — the bug this fixes: this component previously always
  // rendered the flex path below regardless of what was actually saved,
  // so a type's own manually-arranged properties (set and saved via the
  // Properties tab) never showed up anywhere this component is used
  // (Related Assets Cards/Diagram, All Assets diagram) — only inside the
  // Properties tab's own editor. Read-only here (no dragging) — just
  // placing each tile at its saved position. Unpositioned entries (newly
  // visible since the layout was last saved) stack in the corner, same
  // convention as PropertyLayoutCanvas's own default. Container grows to
  // fit the furthest-positioned tile, with a fixed per-tile size estimate
  // since there's no live measurement in a static render like this —
  // generous enough that overflow (safety net, not the expected case)
  // stays visible rather than clipping. The estimate itself must vary by
  // view mode — text tiles are a compact 120x60, but indicator tiles stack
  // a 60px vertical gauge track above the value and label (real height
  // ~114px), and spark/all tiles run a sparkline alongside the value
  // instead (real width ~233-244px) — a single fixed estimate sized for
  // text tiles alone measurably undersized indicator tiles specifically,
  // which is exactly the reported bug: the label, being the bottom-most
  // element of each tile's own stack, was the first thing to spill past
  // the container's too-short declared bottom edge.
  if (boxLayoutMode === 'manual') {
    // Per tile now, since per-property visuals mean one box can mix a
    // compact text tile with a wide spark row.
    const tileSizeEstimate = key => STAT_TILE_SIZE_ESTIMATES[tileViewMode(key)] || STAT_TILE_SIZE_ESTIMATES.text;
    const positions = entriesToShow.map(([key]) => boxManualPositions[key] ?? { x: 0, y: 0 });
    // A tile's saved position can be negative — the Properties tab's own
    // editing canvas is an infinite, freely-pannable React Flow canvas, so
    // a tile dragged left of or above the origin saves a negative x/y just
    // fine there. This static render has no panning of its own, so
    // without shifting every tile by however far negative the most-
    // negative one is, that tile would render to the left of/above the
    // container's own (0,0) origin — visually outside the box entirely,
    // which is exactly what was seen: manual boxes with tiles escaping
    // their own border.
    const offsetX = Math.min(0, ...positions.map(p => p.x));
    const offsetY = Math.min(0, ...positions.map(p => p.y));
    const containerWidth = Math.max(0, ...entriesToShow.map(([key], i) => positions[i].x - offsetX + tileSizeEstimate(key).width));
    const containerHeight = Math.max(0, ...entriesToShow.map(([key], i) => positions[i].y - offsetY + tileSizeEstimate(key).height));
    return (
      <>
        {titleElement}
        {gearElement}
        <div style={{ position: 'relative', width: containerWidth, height: containerHeight, overflow: 'visible' }}>
          {entriesToShow.map(([key, value]) => {
            const pos = boxManualPositions[key] ?? { x: 0, y: 0 };
            return (
              <div key={key} style={{ position: 'absolute', left: pos.x - offsetX, top: pos.y - offsetY }}>
                {renderStatTile([key, value])}
              </div>
            );
          })}
        </div>
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
        {entriesToShow.map(renderStatTile)}
      </div>
    </>
  );
}

// Property manual layout — no saved position yet (a property newly
// revealed by a tier-filter change, or added after positions were last
// saved) lands here: "stack in the corner," never an auto-placement
// search, matching the no-reflow decision for this whole feature.
const PROPERTY_LAYOUT_DEFAULT_POSITION = { x: 0, y: 0 };

const PROPERTY_LAYOUT_GRID_SIZE = 20;

// "Arrange in Grid" spacing — generous enough for the tallest tile type
// (indicator, ~110-130px content) without overlap at default sizes.
const PROPERTY_LAYOUT_ARRANGE_CELL_WIDTH = 150;

const PROPERTY_LAYOUT_ARRANGE_CELL_HEIGHT = 140;

const PROPERTY_LAYOUT_ARRANGE_COLUMNS = 4;

// Manual property-layout canvas — one node per visible property, no
// edges ever (properties don't relate to each other the way types do).
// Self-contained ReactFlowProvider, same reasoning as RelatedAssetsDiagram.
const PropertyLayoutCanvas = forwardRef(function PropertyLayoutCanvas({ tiles, manualPositions, onPositionsChange, onSelectTile }, ref) {
  return (
    <ReactFlowProvider>
      <PropertyLayoutCanvasInner ref={ref} tiles={tiles} manualPositions={manualPositions} onPositionsChange={onPositionsChange} onSelectTile={onSelectTile} />
    </ReactFlowProvider>
  );
});

const PropertyLayoutCanvasInner = forwardRef(function PropertyLayoutCanvasInner({ tiles, manualPositions, onPositionsChange, onSelectTile }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    tiles.map(t => ({
      id: t.key,
      type: 'propertyLayoutNode',
      position: manualPositions[t.key] ?? PROPERTY_LAYOUT_DEFAULT_POSITION,
      data: { tileProps: t.tileProps, selected: !!t.selected },
    }))
  );

  // Keeps the node set in sync when which properties are visible changes
  // (tier filter, or a property's underlying value changing) without
  // disturbing the working position of any property that stays visible.
  // Deliberately keyed on tileKeysSignature (a plain string) rather than
  // the tiles array itself — tiles is rebuilt fresh on every render of
  // the parent (HmiPropertiesListing) regardless of whether the visible
  // property set actually changed, so depending on the array reference
  // directly caused this effect to re-fire every render, which in turn
  // re-triggered the position-reporting effect below, which triggered
  // the parent to re-render again — an infinite loop, caught directly
  // via a real component test before this ever reached production.
  // tiles itself is still read fresh inside the effect body (via closure)
  // for its actual tileProps content, just not used as the trigger.
  // viewMode is appended here too — it's shared across every tile (all
  // pull it from the same kpiViewMode state), so reading it off the first
  // tile is enough to catch changes without needing a signature per tile;
  // without this, toggling view mode while in manual mode silently did
  // nothing, since the keys themselves never changed so this effect
  // never re-ran and the already-built nodes kept their stale tileProps.
  // Per-property visuals mean viewMode is no longer guaranteed shared
  // across tiles, so it's now part of each tile's own signature entry
  // (along with whether it's the Details panel's selected property) —
  // still a plain string, so the no-infinite-loop reasoning above holds.
  const tileKeysSignature = tiles.map(t => `${t.key}:${t.tileProps?.viewMode ?? ''}:${t.selected ? 1 : 0}`).join('|');
  useEffect(() => {
    setNodes(current => {
      const tileMap = new Map(tiles.map(t => [t.key, t]));
      const kept = current
        .filter(n => tileMap.has(n.id))
        .map(n => ({ ...n, data: { tileProps: tileMap.get(n.id).tileProps, selected: !!tileMap.get(n.id).selected } }));
      const keptIds = new Set(kept.map(n => n.id));
      const added = tiles
        .filter(t => !keptIds.has(t.key))
        .map(t => ({
          id: t.key,
          type: 'propertyLayoutNode',
          position: manualPositions[t.key] ?? PROPERTY_LAYOUT_DEFAULT_POSITION,
          data: { tileProps: t.tileProps, selected: !!t.selected },
        }));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKeysSignature]);

  // Reports the working position set up to the parent on every change —
  // Save Template picks this up as part of its own payload when the user
  // actually saves. This component only owns the live editing canvas,
  // same separation as the diagram's own nodes state vs. Copy Layout.
  useEffect(() => {
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify('Select at least 2 properties to align (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify('Select at least 3 properties to distribute (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  // One-shot convenience, not a persistent layout algorithm — just packs
  // every currently-visible property into sequential grid cells in their
  // current order. Free to build on top of Align/Distribute's existing
  // node-shaped-array plumbing.
  const handleArrangeGrid = () => {
    setNodes(current => current.map((n, i) => ({
      ...n,
      position: {
        x: (i % PROPERTY_LAYOUT_ARRANGE_COLUMNS) * PROPERTY_LAYOUT_ARRANGE_CELL_WIDTH,
        y: Math.floor(i / PROPERTY_LAYOUT_ARRANGE_COLUMNS) * PROPERTY_LAYOUT_ARRANGE_CELL_HEIGHT,
      },
    })));
  };

  // Align/Distribute/Arrange in Grid now live in the parent toolbar
  // (HmiPropertiesListing's own manual-mode row) rather than a Panel on
  // this canvas, so the parent needs a way to actually trigger them here.
  useImperativeHandle(ref, () => ({
    align: handleAlign,
    distribute: handleDistribute,
    arrangeGrid: handleArrangeGrid,
  }));

  return (
    <div className="op-property-layout-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={PROPERTY_LAYOUT_NODE_TYPES}
        onNodesChange={onNodesChange}
        // A plain click (not a drag — React Flow only fires this when the
        // node didn't move) selects the property in the Details panel.
        onNodeClick={onSelectTile ? (_, node) => onSelectTile(node.id) : undefined}
        snapToGrid
        snapGrid={[PROPERTY_LAYOUT_GRID_SIZE, PROPERTY_LAYOUT_GRID_SIZE]}
        minZoom={0.1}
        fitView
      >
        <Background color="#b0b0b0" />
      </ReactFlow>
    </div>
  );
});

// Cards manual layout — same "stack in corner" default and grid-arrange
// spacing reasoning as the property-layout constants above, just for
// asset type boxes (which run somewhat larger than a single StatTile).
const CARDS_LAYOUT_DEFAULT_POSITION = { x: 0, y: 0 };

const CARDS_LAYOUT_GRID_SIZE = 20;

const CARDS_LAYOUT_ARRANGE_CELL_WIDTH = 300;

const CARDS_LAYOUT_ARRANGE_CELL_HEIGHT = 220;

const CARDS_LAYOUT_ARRANGE_COLUMNS = 3;

// Manual Cards-layout canvas — one node per related-asset type box, no
// edges ever (Diagram is what exists for showing relationships between
// types; Cards is purely a spatial arrangement of the same boxes).
// Structurally identical to PropertyLayoutCanvas — same proven pattern,
// third time this shape gets reused (diagram nodes, property tiles,
// now asset cards).
const CardsLayoutCanvas = forwardRef(function CardsLayoutCanvas({ tiles, manualPositions, onPositionsChange, readOnly }, ref) {
  return (
    <ReactFlowProvider>
      <CardsLayoutCanvasInner ref={ref} tiles={tiles} manualPositions={manualPositions} onPositionsChange={onPositionsChange} readOnly={readOnly} />
    </ReactFlowProvider>
  );
});

const CardsLayoutCanvasInner = forwardRef(function CardsLayoutCanvasInner({ tiles, manualPositions, onPositionsChange, readOnly }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    tiles.map(t => ({
      id: t.key,
      type: 'cardsLayoutNode',
      position: manualPositions[t.key] ?? CARDS_LAYOUT_DEFAULT_POSITION,
      data: { boxProps: t.boxProps, isCenter: t.isCenter },
    }))
  );

  // Same tileKeysSignature fix as PropertyLayoutCanvasInner — depending
  // on the tiles array reference directly caused an infinite loop there
  // (tiles is rebuilt fresh every parent render regardless of whether
  // the visible set actually changed); applying the same fix here from
  // the start rather than waiting to hit it again.
  const tileKeysSignature = tiles.map(t => t.key).join('|');
  useEffect(() => {
    setNodes(current => {
      const tileMap = new Map(tiles.map(t => [t.key, t]));
      const kept = current
        .filter(n => tileMap.has(n.id))
        .map(n => ({ ...n, data: { boxProps: tileMap.get(n.id).boxProps, isCenter: tileMap.get(n.id).isCenter } }));
      const keptIds = new Set(kept.map(n => n.id));
      const added = tiles
        .filter(t => !keptIds.has(t.key))
        .map(t => ({
          id: t.key,
          type: 'cardsLayoutNode',
          position: manualPositions[t.key] ?? CARDS_LAYOUT_DEFAULT_POSITION,
          data: { boxProps: t.boxProps, isCenter: t.isCenter },
        }));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKeysSignature]);

  useEffect(() => {
    const positions = {};
    nodes.forEach(n => { positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; });
    onPositionsChange(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleAlign = (mode) => {
    const result = alignSelectedNodes(nodes, mode);
    if (result === null) {
      notify('Select at least 2 cards to align (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleDistribute = (axis) => {
    const result = distributeSelectedNodes(nodes, axis);
    if (result === null) {
      notify('Select at least 3 cards to distribute (shift+drag to select multiple)', 'warning', 2500);
      return;
    }
    setNodes(result);
  };

  const handleArrangeGrid = () => {
    setNodes(current => current.map((n, i) => ({
      ...n,
      position: {
        x: (i % CARDS_LAYOUT_ARRANGE_COLUMNS) * CARDS_LAYOUT_ARRANGE_CELL_WIDTH,
        y: Math.floor(i / CARDS_LAYOUT_ARRANGE_COLUMNS) * CARDS_LAYOUT_ARRANGE_CELL_HEIGHT,
      },
    })));
  };

  // Align/Distribute/Arrange in Grid now live in the parent toolbar
  // (RelatedAssetsPreview's own manual-mode Row 3), same reasoning and
  // pattern as PropertyLayoutCanvasInner's own ref exposure.
  useImperativeHandle(ref, () => ({
    align: handleAlign,
    distribute: handleDistribute,
    arrangeGrid: handleArrangeGrid,
  }));

  return (
    <div className="op-property-layout-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={CARDS_LAYOUT_NODE_TYPES}
        onNodesChange={onNodesChange}
        snapToGrid
        snapGrid={[CARDS_LAYOUT_GRID_SIZE, CARDS_LAYOUT_GRID_SIZE]}
        minZoom={0.1}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        elementsSelectable={!readOnly}
      >
        <Background color="#b0b0b0" />
      </ReactFlow>
    </div>
  );
});

// Cards — the actual view: a plain flex-wrapped grid of related-asset
// type boxes when cardsLayoutMode is 'auto' (genuinely responsive —
// reflows on window resize, since it's real CSS flexbox), or the canvas
// above when 'manual'. cardsFlexContainerRef/cardsFlexTileRefs are
// populated here so RelatedAssetsPreview's handleSwitchCardsToManual can
// measure real current positions at the moment of switching.
function RelatedAssetsCards({ currentTypeId, currentTypeName, currentTypeExampleAssetId, visibleRows, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, cardsLayoutMode, cardsManualPositions, onCardsPositionsChange, cardsFlexContainerRef, cardsFlexTileRefs, cardsFlowDirection, cardsFlowWrap, cardsAlignContent, cardsLayoutCanvasRef, readOnly, onTitleClick, onGearClick }) {
  // This asset's own box, always shown first regardless of layout mode —
  // same reasoning as the Diagram view's own isCenter node: the point of
  // "related assets" is seeing them in context of the asset they're
  // related TO, which was previously only true in Diagram mode. Cards
  // (both its manual and flex/auto sub-modes) never included it at all.
  const thisAssetBoxProps = {
    relatedTypeId: currentTypeId,
    relatedTypeName: currentTypeName,
    relatedTypeExampleAssetId: currentTypeExampleAssetId,
    typeDisplayTemplates,
    typePropertyConfigs,
    assetDisplayTemplates,
    assetPropertyConfigs,
    evidencePoints,
    onTitleClick,
    onGearClick,
  };

  if (cardsLayoutMode === 'manual') {
    return (
      <div className="op-related-assets-diagram">
        <CardsLayoutCanvas
          ref={cardsLayoutCanvasRef}
          readOnly={readOnly}
          tiles={[
            { key: currentTypeId, boxProps: thisAssetBoxProps, isCenter: true },
            ...visibleRows.map(row => ({
              key: row.key,
              boxProps: {
                relatedTypeId: row.relatedTypeId,
                relatedTypeName: row.relatedTypeName,
                relatedTypeExampleAssetId: row.relatedTypeExampleAssetId,
                typeDisplayTemplates,
                typePropertyConfigs,
                assetDisplayTemplates,
                assetPropertyConfigs,
                evidencePoints,
                onTitleClick,
                onGearClick,
              },
            })),
          ]}
          manualPositions={cardsManualPositions}
          onPositionsChange={onCardsPositionsChange}
        />
      </div>
    );
  }
  return (
    <div
      className="op-related-assets-box-flow"
      style={{ flexDirection: cardsFlowDirection, flexWrap: cardsFlowWrap, alignContent: cardsAlignContent }}
      ref={cardsFlexContainerRef}
    >
      <div
        key={currentTypeId}
        className="op-related-asset-box op-related-asset-box--center"
        ref={el => { cardsFlexTileRefs.current[currentTypeId] = el; }}
      >
        <RelatedAssetBoxContent {...thisAssetBoxProps} />
      </div>
      {visibleRows.map(row => (
        <div
          key={row.key}
          className="op-related-asset-box"
          data-related-key={row.key}
          ref={el => { cardsFlexTileRefs.current[row.key] = el; }}
        >
          <RelatedAssetBoxContent
            relatedTypeId={row.relatedTypeId}
            relatedTypeName={row.relatedTypeName}
            relatedTypeExampleAssetId={row.relatedTypeExampleAssetId}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        </div>
      ))}
    </div>
  );
}

// Read-only Related Assets view for the new Operator-only Assets area —
// shows the same saved template a type's Related Assets tab in
// Visualization produces (Cards or Diagram, with whatever settings were
// saved there), but with no toolbar and no editing capability at all.
// Mirrors RelatedAssetsPreview's own relatedAssetRows/visibleRows
// computation exactly, just without any of the state that exists there
// only to support editing.
function ReadOnlyRelatedAssetsView({ typeId, assetId, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, evidencePoints, savedTemplate, onTitleClick, onGearClick }) {
  // RelatedAssetsCards' flex-mode rendering writes to these unconditionally
  // (its tile ref callback needs somewhere to write to regardless of
  // whether the manual-switch feature — irrelevant here — is ever used),
  // so real ref objects are required even though nothing here ever reads
  // from them.
  const cardsFlexContainerRef = useRef(null);
  const cardsFlexTileRefs = useRef({});
  // Per-related-type visibility, merged the same way property visibility
  // is elsewhere: this specific asset's own override wins when it has one,
  // otherwise fall back to its type's. assetId is optional (undefined for
  // any caller still passing only a type, e.g. the Now area's own type-
  // level preview reusing this same component) — a missing assetId simply
  // means no asset-level entry can ever match, so behavior is identical to
  // before for those callers.
  const typeRelatedAssetOverrides = typeRelatedAssetConfigs[typeId] || {};
  const assetRelatedAssetOverrides = (assetId && assetRelatedAssetConfigs?.[assetId]) || {};
  const displayOrders = useDisplayOrders();
  const relatedAssetRows = sortRowsByOrder(getRelatedAssetsForType(typeId, typeList).map(row => ({
    ...row,
    visibility: assetRelatedAssetOverrides[row.key] || typeRelatedAssetOverrides[row.key] || 'always',
  })), resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, typeId, assetId));
  const visibleRows = relatedAssetRows.filter(r => r.visibility === 'always');
  // savedTemplate here is already whichever one applies (asset-level
  // override or type-level default) — resolved by the caller, which has
  // both maps and the same all-or-nothing reasoning RelatedAssetBoxContent's
  // own display template fallback uses (a cohesive layout choice saved as
  // one unit, not merged field by field).
  const layoutMode = savedTemplate?.layoutMode ?? 'cards';

  if (visibleRows.length === 0) {
    return <div className="op-dash-text op-dash-text--muted">No related assets to show.</div>;
  }

  return layoutMode === 'cards' ? (
    <RelatedAssetsCards
      currentTypeId={typeId}
      currentTypeName={typeList.find(t => t.id === typeId)?.name}
      currentTypeExampleAssetId={assetId || typeList.find(t => t.id === typeId)?.exampleAssetId}
      visibleRows={visibleRows}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      cardsLayoutMode={savedTemplate?.cardsLayoutMode ?? 'auto'}
      cardsManualPositions={savedTemplate?.cardsManualPositions ?? {}}
      onCardsPositionsChange={() => {}}
      cardsFlexContainerRef={cardsFlexContainerRef}
      cardsFlexTileRefs={cardsFlexTileRefs}
      cardsFlowDirection={savedTemplate?.cardsFlowDirection ?? 'row'}
      cardsFlowWrap={savedTemplate?.cardsFlowWrap ?? 'wrap'}
      cardsAlignContent={savedTemplate?.cardsAlignContent ?? 'stretch'}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  ) : (
    <RelatedAssetsDiagram
      currentTypeId={typeId}
      currentTypeName={typeList.find(t => t.id === typeId)?.name}
      currentTypeExampleAssetId={assetId || typeList.find(t => t.id === typeId)?.exampleAssetId}
      visibleRows={visibleRows}
      typeList={typeList}
      allTypesMode={false}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      diagramAlgorithm={savedTemplate?.diagramAlgorithm ?? 'layered'}
      diagramDirection={savedTemplate?.diagramDirection ?? 'RIGHT'}
      diagramEdgeRouting={savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL'}
      diagramNodeSpacing={savedTemplate?.diagramNodeSpacing ?? 40}
      diagramLayerSpacing={savedTemplate?.diagramLayerSpacing ?? 80}
      diagramAspectRatio={savedTemplate?.diagramAspectRatio ?? 8}
      diagramShowLabels={savedTemplate?.diagramShowLabels ?? 'hidden'}
      diagramShowArrowheads={savedTemplate?.diagramShowArrowheads ?? 'shown'}
      diagramConnectionPointMode={savedTemplate?.diagramConnectionPointMode ?? 'center'}
      diagramLayoutResetSignal={0}
      onManualEdit={() => {}}
      setDiagramShowLabels={() => {}}
      setDiagramShowArrowheads={() => {}}
      setDiagramConnectionPointMode={() => {}}
      onPositionsChange={undefined}
      savedManualPositions={savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  );
}

// Read-only All Assets view for the new Operator-only Assets area —
// same global saved template and hiddenAssetIds the configurator's own
// All Assets diagram uses, no toolbar, no editing capability.
function ReadOnlyAllAssetsView({ typeList, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, savedTemplate, onTitleClick, onGearClick }) {
  return (
    <RelatedAssetsDiagram
      typeList={typeList}
      allTypesMode
      hiddenAssetIds={hiddenAssetIds}
      typeDisplayTemplates={typeDisplayTemplates}
      typePropertyConfigs={typePropertyConfigs}
      assetDisplayTemplates={assetDisplayTemplates}
      assetPropertyConfigs={assetPropertyConfigs}
      evidencePoints={evidencePoints}
      diagramAlgorithm={savedTemplate?.diagramAlgorithm ?? 'layered'}
      diagramDirection={savedTemplate?.diagramDirection ?? 'RIGHT'}
      diagramEdgeRouting={savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL'}
      diagramNodeSpacing={savedTemplate?.diagramNodeSpacing ?? 40}
      diagramLayerSpacing={savedTemplate?.diagramLayerSpacing ?? 80}
      diagramAspectRatio={savedTemplate?.diagramAspectRatio ?? 8}
      diagramShowLabels={savedTemplate?.diagramShowLabels ?? 'hidden'}
      diagramShowArrowheads={savedTemplate?.diagramShowArrowheads ?? 'shown'}
      diagramConnectionPointMode={savedTemplate?.diagramConnectionPointMode ?? 'center'}
      diagramLayoutResetSignal={0}
      onManualEdit={() => {}}
      setDiagramShowLabels={() => {}}
      setDiagramShowArrowheads={() => {}}
      setDiagramConnectionPointMode={() => {}}
      onPositionsChange={undefined}
      savedManualPositions={savedTemplate?.diagramLayoutMode === 'manual' ? savedTemplate.diagramManualPositions : undefined}
      readOnly
      onTitleClick={onTitleClick}
      onGearClick={onGearClick}
    />
  );
}

// selectedRelatedKey/onSelectRelated: the Details panel's selected Related
// Assets row, shared both ways — selecting a row highlights its box here,
// clicking a box here selects its row there. Same pattern as the
// Properties tab's tile/row selection.
function RelatedAssetsPreview({ relatedAssetRows, evidencePoints, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, currentTypeId, currentTypeName, currentTypeExampleAssetId, typeList, savedTemplate, onSaveTemplate, activeSaveHandlerRef, onTitleClick, showToolbar, selectedRelatedKey, onSelectRelated }) {
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
  // HmiPropertiesListing's propertyLayoutMode: 'manual' swaps in a
  // separate React Flow canvas (CardsLayoutCanvas, no edges — related-
  // asset boxes don't relate to each other the way types in Diagram do),
  // seeded by measuring the flex view's actual current box positions at
  // the moment of switching so nothing visually jumps.
  const [cardsLayoutMode, setCardsLayoutMode] = useState(savedTemplate?.cardsLayoutMode ?? 'auto');
  const [cardsManualPositions, setCardsManualPositions] = useState(savedTemplate?.cardsManualPositions ?? {});
  // Cards flex container's own row/column, wrap/no-wrap, and distribute/
  // cluster controls — same three settings and icons HmiPropertiesListing
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
  const [diagramAlgorithm, setDiagramAlgorithm] = useState(savedTemplate?.diagramAlgorithm ?? 'layered');
  const [diagramDirection, setDiagramDirection] = useState(savedTemplate?.diagramDirection ?? 'RIGHT');
  const [diagramEdgeRouting, setDiagramEdgeRouting] = useState(savedTemplate?.diagramEdgeRouting ?? 'ORTHOGONAL');
  const [diagramNodeSpacing, setDiagramNodeSpacing] = useState(savedTemplate?.diagramNodeSpacing ?? 40);
  const [diagramLayerSpacing, setDiagramLayerSpacing] = useState(savedTemplate?.diagramLayerSpacing ?? 80);
  const [diagramAspectRatio, setDiagramAspectRatio] = useState(savedTemplate?.diagramAspectRatio ?? 8);
  const [diagramShowLabels, setDiagramShowLabels] = useState(savedTemplate?.diagramShowLabels ?? 'hidden');
  const [diagramShowArrowheads, setDiagramShowArrowheads] = useState(savedTemplate?.diagramShowArrowheads ?? 'shown');
  const [diagramConnectionPointMode, setDiagramConnectionPointMode] = useState(savedTemplate?.diagramConnectionPointMode ?? 'center');
  // 'auto': layout-affecting controls are live, ELK drives node positions.
  // 'manual': entered the instant the user drags a node or uses Align/
  // Distribute (see onManualEdit below) — layout-affecting controls
  // become disabled until the user explicitly confirms leaving manual
  // mode via the Reset button, which increments layoutResetSignal to
  // force a fresh ELK computation even if no other setting changed.
  const [diagramLayoutMode, setDiagramLayoutMode] = useState(savedTemplate?.diagramLayoutMode ?? 'auto');
  const [diagramLayoutResetSignal, setDiagramLayoutResetSignal] = useState(0);
  // Working copy of the diagram's current node positions, kept in sync via
  // RelatedAssetsDiagram's onPositionsChange — read at save time (below)
  // and fed back in as savedManualPositions on the next load so a manual
  // arrangement survives a type switch or page refresh.
  const [diagramManualPositions, setDiagramManualPositions] = useState(savedTemplate?.diagramManualPositions ?? {});
  const diagramCanvasRef = useRef(null);
  const cardsLayoutCanvasRef = useRef(null);
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

  // Memoized so the diagram view (which re-runs ELK's layout whenever this
  // array changes) doesn't recompute on every unrelated re-render — only
  // when the underlying rows or the density filter actually change.
  const visibleRows = useMemo(
    () => relatedAssetRows.filter(r => densityFilter === 'all' || r.visibility === 'always'),
    [relatedAssetRows, densityFilter]
  );

  // Unsaved-changes tracking — same as HmiPropertiesListing's, with two
  // position channels since both Cards and Diagram have a manual mode.
  const relatedUnsavedFields = {
    layoutMode, cardsLayoutMode, cardsFlowDirection, cardsFlowWrap, cardsAlignContent,
    diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing,
    diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutMode,
  };
  const unsavedTracker = useUnsavedTracker(
    relatedUnsavedFields,
    {
      cards: cardsLayoutMode === 'manual' ? cardsManualPositions : null,
      diagram: diagramLayoutMode === 'manual' ? diagramManualPositions : null,
    },
    !!activeSaveHandlerRef,
  );
  // The diagram reports positions in auto mode too (every ELK run) — only
  // a report made while in manual mode may become the manual baseline.
  const diagramLayoutModeRef = useRef(diagramLayoutMode);
  diagramLayoutModeRef.current = diagramLayoutMode;
  // Stable identities — see HmiPropertiesListing's handleManualPositionsChange.
  const handleCardsPositionsChange = useCallback(positions => {
    unsavedTracker.notePositionsReported('cards', positions);
    setCardsManualPositions(positions);
  }, [unsavedTracker]);
  const handleDiagramPositionsChange = useCallback(positions => {
    if (diagramLayoutModeRef.current === 'manual') unsavedTracker.notePositionsReported('diagram', positions);
    setDiagramManualPositions(positions);
  }, [unsavedTracker]);

  // Registers this tab's save action, same pattern as HmiPropertiesListing's
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
  }, [currentTypeId, layoutMode, cardsLayoutMode, cardsManualPositions, cardsFlowDirection, cardsFlowWrap, cardsAlignContent, diagramAlgorithm, diagramDirection, diagramEdgeRouting, diagramNodeSpacing, diagramLayerSpacing, diagramAspectRatio, diagramShowLabels, diagramShowArrowheads, diagramConnectionPointMode, diagramLayoutMode, diagramManualPositions, onSaveTemplate, activeSaveHandlerRef]);

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
                background: (layoutMode === 'cards' ? cardsLayoutMode : diagramLayoutMode) === 'manual' ? '#fff4e5' : '#e8f4fd',
                color: (layoutMode === 'cards' ? cardsLayoutMode : diagramLayoutMode) === 'manual' ? '#8a5a00' : '#0078d4',
              }}
            >
              {layoutMode === 'cards'
                ? (cardsLayoutMode === 'manual' ? 'Manual Layout' : 'Flex Layout')
                : (diagramLayoutMode === 'manual' ? 'Manual Layout' : 'Auto Layout')}
            </span>
            {layoutMode === 'cards' ? (
              cardsLayoutMode === 'manual' ? (
                <Button text="Reset to Flex Layout" onClick={handleResetCardsLayout} stylingMode="outlined" />
              ) : (
                <Button text="Switch to Manual Layout" onClick={handleSwitchCardsToManual} stylingMode="outlined" />
              )
            ) : (
              diagramLayoutMode === 'manual' ? (
                <Button text="Reset to Auto Layout" onClick={handleConfirmResetToAuto} stylingMode="outlined" />
              ) : (
                <Button text="Switch to Manual Layout" onClick={handleManualEdit} stylingMode="outlined" />
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
          {layoutMode === 'cards' && cardsLayoutMode === 'manual' && (
            <>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => cardsLayoutCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_ALIGN_VERTICAL_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => cardsLayoutCanvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => cardsLayoutCanvasRef.current?.distribute(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
                {RELATED_ASSETS_DISTRIBUTE_ITEMS.map(item => (
                  <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
                ))}
              </ButtonGroup>
              <Button text="Arrange in Grid" onClick={() => cardsLayoutCanvasRef.current?.arrangeGrid()} stylingMode="outlined" />
            </>
          )}
          {layoutMode === 'diagram' && diagramLayoutMode === 'auto' && (
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
          {layoutMode === 'diagram' && diagramLayoutMode === 'manual' && (
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
          {layoutMode === 'diagram' && diagramLayoutMode === 'auto' && (
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
      {layoutMode === 'cards' ? (
        visibleRows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">No related assets to show at this density.</div>
        ) : (
          <RelatedAssetsCards
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
          <RelatedAssetsDiagram
            ref={diagramCanvasRef}
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
        )
      )}
    </div>
  );
}

// The global "All Assets" view — diagram-only (no Cards option), showing
// every type in the current model at once rather than one type's
// immediate relationships. Deliberately not per-type: this is one shared
// view regardless of which type happens to be selected in the tree,
// unlike RelatedAssetsPreview/HmiPropertiesListing's own templates.
// Mirrors RelatedAssetsPreview's Diagram-mode settings and Auto/Manual
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
// (OperatorWorkspaceInner), shared with AllAssetsDiagram below rather
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

function AllAssetsTypeList({ hiddenAssetIds, onToggleAssetVisibility }) {
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
function AllAssetsDiagram({ typeList, currentTypeId, hiddenAssetIds, typeDisplayTemplates, typePropertyConfigs, assetDisplayTemplates, assetPropertyConfigs, evidencePoints, savedTemplate, onSaveTemplate, activeSaveHandlerRef, onTitleClick, showToolbar }) {
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
  // as RelatedAssetsPreview's diagramManualPositions above.
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

  // Unsaved-changes tracking — same as RelatedAssetsPreview's diagram half,
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

  // Registers this tab's save action, same pattern as RelatedAssetsPreview
  // and HmiPropertiesListing — this is the global, non-per-type template,
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
      <RelatedAssetsDiagram
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

// The Details panel's content for a selected type — three tabs, each
// showing only the config list (no preview at all; that lives in
// NowTypeMainPreview, in the center, as its own separate component now).
// rightPanelViewMode/hiddenAssetIds are lifted state (OperatorWorkspaceInner),
// read here for display/editing but actually driven by the center preview.
function NowTypeDetailsList({ entityId, isAssetEntity, relationshipTypeId, typeList, properties, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, rightPanelViewMode, hiddenAssetIds, onToggleAssetVisibility, activeTabIndex, onActiveTabIndexChange, propertyVisuals, typeDisplayTemplates }) {
  // DevExtreme's DataGrid does not automatically recalculate column widths
  // when its container is resized (documented requirement, not a bug) —
  // without this, a narrower Details panel can leave columns at their
  // previous (wider) size, overflowing past the visible area. rAF-
  // throttled per DevExtreme's own guidance, since onResize can fire many
  // times per drag. No longer tied to a Splitter drag here (the list is
  // full width now), but the panel itself is still resizable.
  const propsGridRef = useRef(null);
  const relatedGridRef = useRef(null);

  // Clicking a tile in the center preview selects its row here — scroll
  // it into view too, since the grid alone only highlights (DataGrid's
  // selectedRowKeys never scrolls on its own).
  const selectedPropertyKey = propertyVisuals?.selectedKey ?? null;
  useEffect(() => {
    if (selectedPropertyKey == null) return;
    propsGridRef.current?.instance()?.navigateToRow(selectedPropertyKey);
  }, [selectedPropertyKey]);
  // Same for the Related Assets table, selected by clicking a box in the
  // preview's Related Assets view.
  const selectedRelatedKey = propertyVisuals?.selectedRelatedKey ?? null;
  useEffect(() => {
    if (selectedRelatedKey == null) return;
    relatedGridRef.current?.instance()?.navigateToRow(selectedRelatedKey);
  }, [selectedRelatedKey]);

  const visualModeLabel = KPI_VIEW_MODE_ITEMS.find(i => i.value === rightPanelViewMode)?.text ?? rightPanelViewMode;
  // The draft is keyed by entity so a stale map left over from whatever
  // was selected before can't leak into this one's first render (the
  // center preview re-seeds it from this entity's saved template on mount).
  const propertyViewModes = propertyVisuals?.entityId === entityId ? propertyVisuals.modes : {};
  // An asset's type's per-property choices — what a row on Default
  // actually resolves to when the type has set that property (see
  // mergePropertyViewModes). Empty for a type, which has nothing above it.
  const inheritedPropertyViewModes = isAssetEntity ? (typeDisplayTemplates?.[relationshipTypeId]?.propertyViewModes ?? {}) : {};
  // Type view only: which of this type's assets set each property
  // differently — the count badge beside a property's name, and the
  // checklist it opens for reverting that one property on several assets.
  const { byAsset: customizationsByAsset, byTypeProperty, actions: customizationActions } = useAssetCustomizations();
  const customizedByProperty = (!isAssetEntity && byTypeProperty[entityId]) || {};
  const [propertyPopover, setPropertyPopover] = useState(null); // { key, target }

  // Merged the same way RelatedAssetBoxContent's own fallback works: this
  // asset's own override wins per property when it has one, otherwise its
  // type's, otherwise "always" — so the grid shown here always reflects
  // what would actually display, not just this asset's own overrides in
  // isolation.
  // Display order (see "Display order"): this entity's own saved order if
  // it has one, else (for an asset) its type's, else the category-grouped
  // default — the same order the preview renders tiles/rows in.
  const displayOrders = useDisplayOrders();
  const orderTypeId = isAssetEntity ? relationshipTypeId : entityId;
  const orderAssetId = isAssetEntity ? entityId : null;
  const effectivePropertyOrder = resolveEntityOrder(displayOrders.typeProperty, displayOrders.assetProperty, orderTypeId, orderAssetId);
  const effectiveRelatedOrder = resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, orderTypeId, orderAssetId);
  const hasOwnPropertyOrder = !!(isAssetEntity ? displayOrders.assetProperty[entityId] : displayOrders.typeProperty[entityId]);
  const hasOwnRelatedOrder = !!(isAssetEntity ? displayOrders.assetRelated[entityId] : displayOrders.typeRelated[entityId]);
  const orderLevel = isAssetEntity ? 'asset' : 'type';
  // Stable onReorder callbacks for the two grids. A fresh function each
  // render changes DataGrid's RowDragging option, which repaints every row
  // — closing an open Visual dropdown the moment the click that opened it
  // re-renders this component (same failure the stable rows/columns below
  // guard against). They forward to this render's handlers via a ref.
  const reorderLatestRef = useRef({});
  const stableReorderRef = useRef(null);
  if (!stableReorderRef.current) {
    stableReorderRef.current = {
      property: items => reorderLatestRef.current.property?.(items),
      related: items => reorderLatestRef.current.related?.(items),
    };
  }
  const orderedPropertyVisibilityRows = properties
    ? (() => {
      const rows = getPropertyVisibilityForType(relationshipTypeId, properties, typePropertyConfigs, isAssetEntity ? entityId : null, assetPropertyConfigs);
      const byKey = new Map(rows.map(r => [r.key, r]));
      return applySavedOrder(categoryOrderedPropertyKeys(rows.map(r => r.key)), effectivePropertyOrder).map(k => byKey.get(k));
    })()
    : [];

  const rawPropertyRows = properties
    ? orderedPropertyVisibilityRows
      .map(row => ({
        ...row,
        visualMode: propertyViewModes[row.key] ?? PROPERTY_VIEW_MODE_DEFAULT,
        inheritedVisual: inheritedPropertyViewModes[row.key] ?? null,
        // What the type itself shows for this property (its own choice, else
        // its default) — an asset's own visual only offers "Update type"
        // when it differs from this, since otherwise there's nothing to push.
        typeVisual: isAssetEntity
          ? (inheritedPropertyViewModes[row.key] ?? typeDisplayTemplates?.[relationshipTypeId]?.viewMode ?? 'text')
          : null,
        customizedCount: customizedByProperty[row.key]?.length ?? 0,
      }))
    : [];

  // Only explicit overrides are kept in the map — choosing Default removes
  // the entry rather than storing 'default', so the property goes back to
  // following the toolbar's view mode.
  const handleVisualChange = (key, mode) => {
    const next = { ...propertyViewModes };
    if (mode === PROPERTY_VIEW_MODE_DEFAULT || mode == null) delete next[key];
    else next[key] = mode;
    propertyVisuals?.setModes(entityId, next);
  };

  const handleVisibilityChange = (key, visibility) => {
    const setConfigs = isAssetEntity ? setAssetPropertyConfigs : setTypePropertyConfigs;
    setConfigs(prev => ({
      ...prev,
      [entityId]: { ...(prev[entityId] || {}), [key]: visibility },
    }));
  };

  // Stable rows/columns for the Properties grid. Previously both were
  // rebuilt fresh every render, which was harmless while every cell was
  // plain text — but DevExtreme's DataGrid repaints every cell whenever
  // its dataSource or columns change by reference, and now that the
  // Visual column holds a live SelectBox, that repaint remounts it and
  // closes its dropdown. The row click that opens the dropdown also
  // selects the row (and highlights its tile in the preview), which
  // re-renders this component — so without this, the very first click
  // on a Visual cell opened and instantly closed the list. Rows are
  // stabilized by content (a cheap signature, since the inputs are
  // rebuilt upstream every render), columns by the one value their
  // rendering depends on; handlers are read through a ref so the columns
  // never close over stale state.
  const handlersRef = useRef({});
  handlersRef.current = {
    handleVisualChange,
    handleVisibilityChange,
    openPropertyPopover: (key, target) => setPropertyPopover({ key, target }),
    handleUpdateTypeVisual: (key, mode) => customizationActions.applyPropertyToType?.(entityId, key, mode),
  };
  const rowsSignature = JSON.stringify(rawPropertyRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const propertyRows = useMemo(() => rawPropertyRows, [rowsSignature]);

  const propertyColumns = useMemo(() => {
    const modeText = mode => KPI_VIEW_MODE_ITEMS.find(i => i.value === mode)?.text ?? mode;
    return [
      {
        dataField: 'label',
        caption: 'Property',
        minWidth: 80,
        cellRender: (cellInfo) => (
          <span className="op-prop-name-cell">
            <span className="op-prop-name-text" title={cellInfo.data.label}>{cellInfo.data.label}</span>
            {cellInfo.data.customizedCount > 0 && (
              <button
                type="button"
                className="op-customized-count op-customized-count--button"
                title={`${cellInfo.data.customizedCount} asset${cellInfo.data.customizedCount > 1 ? 's' : ''} set this differently — click to review, or make them match the type`}
                onClick={e => { e.stopPropagation(); handlersRef.current.openPropertyPopover(cellInfo.data.key, e.currentTarget); }}
              >
                {cellInfo.data.customizedCount}
              </button>
            )}
          </span>
        ),
      },
      {
        dataField: 'visibility',
        // "Show" rather than "Visibility" — the new Visual dropdown needs
        // the room, and at the panel's default 280px width the longer
        // caption truncated to "VISIBILI…" while squeezing property names.
        caption: 'Show',
        width: 64,
        minWidth: 64, // DataListGrid's default minWidth (80) would otherwise win over width
        alignment: 'center',
        cellRender: (cellInfo) => (
          <button
            className="op-visibility-cycle-btn"
            title={VISIBILITY_LABEL[cellInfo.data.visibility]}
            onClick={() => handlersRef.current.handleVisibilityChange(cellInfo.data.key, VISIBILITY_CYCLE[cellInfo.data.visibility])}
          >
            <VisibilityStateIcon visibility={cellInfo.data.visibility} />
          </button>
        ),
      },
      {
        dataField: 'visualMode',
        caption: 'Visual',
        // 76 rather than 84 since the rows gained a drag handle — the
        // longest closed value ("Indicator") still fits.
        width: 76,
        minWidth: 76,
        cellRender: (cellInfo) => {
          const overridden = cellInfo.data.visualMode !== PROPERTY_VIEW_MODE_DEFAULT;
          // Three states per row: this entity's own choice (bold, filled
          // dot); not set here but set by the asset's type (hollow dot —
          // only possible on an asset); or set nowhere, following the
          // toolbar's view mode (muted, no dot).
          //
          // The two type actions sit together at the top of the list, in
          // the same mirrored words the title row uses for the whole asset:
          //   ↓ Match type (Spark)       — drop this asset's own visual and
          //                                use the type's (a normal edit,
          //                                kept until Save)
          //   ↑ Update type to Indicator — make this asset's visual the
          //                                type's (immediate, with Undo)
          // "Match type" only reads that way when the type actually sets
          // this property; otherwise the same item is "Default (Text)",
          // since there's nothing type-specific to match.
          const inherited = cellInfo.data.inheritedVisual;
          const inheritLabel = inherited ? modeText(inherited) : visualModeLabel;
          const canUpdateType = overridden && cellInfo.data.typeVisual != null && cellInfo.data.visualMode !== cellInfo.data.typeVisual;
          const visualSelectItems = [
            { text: inherited ? `↓ Match type (${inheritLabel})` : `Default (${inheritLabel})`, value: PROPERTY_VIEW_MODE_DEFAULT, typeAction: !!inherited },
            ...(canUpdateType ? [{ text: `↑ Update type to ${modeText(cellInfo.data.visualMode)}`, value: PROPERTY_VIEW_MODE_UPDATE_TYPE, typeAction: true, dividerAfter: true }] : []),
            ...PROPERTY_VIEW_MODE_OVERRIDE_ITEMS,
          ];
          if (!canUpdateType) visualSelectItems[0].dividerAfter = true;
          const stateClass = overridden ? ' op-prop-visual-select--override' : inherited ? ' op-prop-visual-select--inherited' : '';
          const hint = overridden
            ? 'Set on this asset only'
            : inherited
              ? 'Comes from this asset\'s type — changes there apply here too'
              : 'Follows the view mode chosen in the preview toolbar';
          return (
            <SelectBox
              className={`op-prop-visual-select${stateClass}`}
              items={visualSelectItems}
              // The closed field shows just the mode name to fit the
              // narrow column (styled by state, above); the open list
              // spells the type actions out.
              displayExpr={item => (item ? (item.value === PROPERTY_VIEW_MODE_DEFAULT ? inheritLabel : item.text) : '')}
              itemRender={item => (
                <span className={`op-visual-item${item.typeAction ? ' op-visual-item--type-action' : ''}${item.dividerAfter ? ' op-visual-item--divider' : ''}`}>{item.text}</span>
              )}
              valueExpr="value"
              value={cellInfo.data.visualMode}
              onValueChanged={e => {
                if (!e.event) return;
                if (e.value === PROPERTY_VIEW_MODE_UPDATE_TYPE) {
                  // An action, not a value: put the field back, then act.
                  e.component.option('value', e.previousValue);
                  handlersRef.current.handleUpdateTypeVisual(cellInfo.data.key, e.previousValue);
                  return;
                }
                handlersRef.current.handleVisualChange(cellInfo.data.key, e.value);
              }}
              stylingMode="underlined"
              showDropDownButton={false}
              dropDownOptions={{ width: 190 }}
              hint={hint}
            />
          );
        },
      },
    ];
  }, [visualModeLabel]);

  if (!properties) {
    return <div className="op-dash-text op-dash-text--muted">No properties available yet for this {isAssetEntity ? 'asset' : 'type'}.</div>;
  }

  // Related Assets tab — every asset-relationship edge touching this
  // entity's own type, collapsed to one row per (related type,
  // relationship) pair, with a simpler always/never visibility toggle than
  // the properties table above. Same asset-over-type merge as propertyRows.
  const typeRelatedAssetOverrides = typeRelatedAssetConfigs[relationshipTypeId] || {};
  const assetRelatedAssetOverrides = (isAssetEntity && assetRelatedAssetConfigs?.[entityId]) || {};
  const relatedAssetRows = sortRowsByOrder(getRelatedAssetsForType(relationshipTypeId, typeList).map(row => ({
    ...row,
    visibility: assetRelatedAssetOverrides[row.key] || typeRelatedAssetOverrides[row.key] || 'always',
  })), effectiveRelatedOrder);

  // Dragging a row saves the whole new order at this entity's level
  // (immediately, like the Show column). The footer under each table only
  // appears once this entity has an order of its own, and removes it —
  // for an asset that's "↓ Match type order", same words as the other
  // match-the-type actions; a type goes back to the default order.
  reorderLatestRef.current = {
    property: items => displayOrders.setOrder('property', orderLevel, entityId, items.map(r => r.key)),
    related: items => displayOrders.setOrder('related', orderLevel, entityId, items.map(r => r.key)),
  };
  const orderFooter = (hasOwn, kind) => hasOwn && (
    <div className="op-order-footer">
      <span>Custom order</span>
      <button type="button" className="op-title-link-btn" onClick={() => displayOrders.setOrder(kind, orderLevel, entityId, null)}>
        {isAssetEntity ? '↓ Match type order' : 'Reset to default order'}
      </button>
    </div>
  );

  const handleRelatedAssetVisibilityChange = (key, visibility) => {
    const setConfigs = isAssetEntity ? setAssetRelatedAssetConfigs : setTypeRelatedAssetConfigs;
    setConfigs(prev => ({
      ...prev,
      [entityId]: { ...(prev[entityId] || {}), [key]: visibility },
    }));
  };

  const relatedAssetColumns = [
    { dataField: 'relatedTypeName', caption: 'Asset', minWidth: 100 },
    { dataField: 'relationshipLabel', caption: 'Relationship', minWidth: 100 },
    {
      dataField: 'visibility',
      caption: 'Visibility',
      width: 90,
      alignment: 'center',
      cellRender: (cellInfo) => (
        <button
          className="op-visibility-cycle-btn"
          title={VISIBILITY_LABEL[cellInfo.data.visibility]}
          onClick={() => handleRelatedAssetVisibilityChange(cellInfo.data.key, RELATED_ASSET_VISIBILITY_CYCLE[cellInfo.data.visibility])}
        >
          <VisibilityStateIcon visibility={cellInfo.data.visibility} />
        </button>
      ),
    },
  ];

  return (
    <div className="op-now-type-tabs">
      <TabPanel
        height="100%"
        animationEnabled={false}
        swipeEnabled={false}
        selectedIndex={activeTabIndex}
        onSelectionChanged={e => onActiveTabIndexChange(e.component.option('selectedIndex'))}
      >
        <TabPanelItem title="Properties">
          <div className="op-now-type-props-list op-now-type-props-list--orderable">
            <div className="op-now-type-props-grid">
              <DataListGrid
                ref={propsGridRef}
                items={propertyRows}
                columns={propertyColumns}
                keyExpr="key"
                selectedId={selectedPropertyKey}
                onSelect={key => propertyVisuals?.setSelectedKey(key)}
                columnAutoWidth={false}
                searchEnabled={false}
                reorderable
                onReorder={stableReorderRef.current.property}
                dragColumnWidth={24}
                noDataText={`No properties for this ${isAssetEntity ? 'asset' : 'type'}.`}
              />
            </div>
            {orderFooter(hasOwnPropertyOrder, 'property')}
          </div>
        </TabPanelItem>
        <TabPanelItem title="Related Assets">
          <div className="op-now-type-props-list op-now-type-props-list--orderable">
            <div className="op-now-type-props-grid">
              <DataListGrid
                ref={relatedGridRef}
                items={relatedAssetRows}
                columns={relatedAssetColumns}
                keyExpr="key"
                selectedId={selectedRelatedKey}
                onSelect={key => propertyVisuals?.setSelectedRelatedKey(key)}
                searchEnabled={false}
                reorderable
                onReorder={stableReorderRef.current.related}
                dragColumnWidth={24}
                noDataText={`No related assets for this ${isAssetEntity ? 'asset' : 'type'}.`}
              />
            </div>
            {orderFooter(hasOwnRelatedOrder, 'related')}
          </div>
        </TabPanelItem>
        {!isAssetEntity && (
          <TabPanelItem title="All Assets">
            <AllAssetsTypeList hiddenAssetIds={hiddenAssetIds} onToggleAssetVisibility={onToggleAssetVisibility} />
          </TabPanelItem>
        )}
      </TabPanel>
      {!isAssetEntity && propertyPopover && (() => {
        const key = propertyPopover.key;
        const label = PROPERTY_LABELS[key] || key;
        const rows = (customizedByProperty[key] || []).map(id => ({
          id,
          label: getAssetPathLabel(id),
          detail: customizationsByAsset[id]?.propertyDetails?.[key],
        }));
        return (
          <AssetRevertPopover
            target={propertyPopover.target}
            visible
            onHide={() => setPropertyPopover(null)}
            title={label}
            rows={rows}
            revertLabel={n => `↓ Match type on ${n}`}
            onRevert={ids => customizationActions.revertPropertyToType?.(ids, key)}
            onOpenAsset={customizationActions.openAsset}
          />
        );
      })()}
    </div>
  );
}

// The main preview area for a selected type — whichever of the three
// visual playgrounds matches the Details panel's currently-active tab.
// Persists across Details being hidden/shown: closing the Details panel
// doesn't blank this out or reset it, it just keeps showing whichever
// was last active.
function NowTypeMainPreview({ activeTabIndex, title, entityId, isAssetEntity, relationshipTypeId, thisAssetExampleId, typeList, properties, sparklineSource, evidencePoints, typePropertyConfigs, typeRelatedAssetConfigs, typeDisplayTemplates, typeRelatedAssetsTemplates, onSaveTypeDisplayTemplate, onSaveTypeRelatedAssetsTemplate, assetPropertyConfigs, assetRelatedAssetConfigs, assetDisplayTemplates, assetRelatedAssetsTemplates, onSaveAssetDisplayTemplate, onSaveAssetRelatedAssetsTemplate, activeSaveHandlerRef, onViewModeChange, hiddenAssetIds, allAssetsTemplate, onSaveAllAssetsTemplate, onTitleClick, toolbarExpanded, onToolbarExpandedChange, propertyVisuals }) {
  // Seeds the shared per-property visual draft from this entity's saved
  // template whenever a different entity gets selected — this component
  // remounts per selection (key={selectedThing.id}), so mount is exactly
  // that moment. The draft only ever holds this entity's OWN choices: for
  // an asset, that's its own template's map and nothing from its type
  // (no whole-template fallback here, unlike layout below) — its type's
  // choices come in separately as the inherited layer, so they're shown
  // but never copied into the asset's saved template.
  const savedPropertyViewModes = (isAssetEntity
    ? assetDisplayTemplates?.[entityId]
    : typeDisplayTemplates?.[entityId])?.propertyViewModes ?? {};
  const inheritedPropertyViewModes = isAssetEntity
    ? (typeDisplayTemplates?.[relationshipTypeId]?.propertyViewModes ?? {})
    : undefined;
  useEffect(() => {
    if (propertyVisuals && propertyVisuals.entityId !== entityId) {
      propertyVisuals.setModes(entityId, savedPropertyViewModes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);
  const draftPropertyViewModes = propertyVisuals?.entityId === entityId ? propertyVisuals.modes : savedPropertyViewModes;
  const displayOrders = useDisplayOrders();
  const ownTypeId = isAssetEntity ? relationshipTypeId : entityId;
  const ownAssetId = isAssetEntity ? entityId : null;
  const effectivePropertyOrder = resolveEntityOrder(displayOrders.typeProperty, displayOrders.assetProperty, ownTypeId, ownAssetId);
  const effectiveRelatedOrder = resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, ownTypeId, ownAssetId);

  const titleRow = (
    <div className="op-now-asset-detail-title op-now-asset-detail-title--with-caret">
      <button
        type="button"
        className="op-now-asset-detail-caret"
        onClick={() => onToolbarExpandedChange(e => !e)}
        title={toolbarExpanded ? 'Hide controls' : 'Show controls'}
      >
        <CaretIcon expanded={toolbarExpanded} />
      </button>
      <span>{title}</span>
      <CustomizationTitleControls entityId={entityId} isAssetEntity={isAssetEntity} />
    </div>
  );

  if (!properties) {
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        <div className="op-now-asset-detail-title">{title}</div>
        <div className="op-dashboard-card op-now-asset-kpi-card">
          <div className="op-dash-text op-dash-text--muted">No properties available yet for this {isAssetEntity ? 'asset' : 'type'}.</div>
        </div>
      </div>
    );
  }

  if (activeTabIndex === 1) {
    // Per-related-type visibility, merged the same way RelatedAssetBoxContent's
    // own property visibility is: this specific asset's own override wins
    // when it has one, otherwise its type's, otherwise "always".
    const typeOverrides = typeRelatedAssetConfigs[relationshipTypeId] || {};
    const assetOverrides = (isAssetEntity && assetRelatedAssetConfigs?.[entityId]) || {};
    const relatedAssetRows = sortRowsByOrder(getRelatedAssetsForType(relationshipTypeId, typeList).map(row => ({
      ...row,
      visibility: assetOverrides[row.key] || typeOverrides[row.key] || 'always',
    })), effectiveRelatedOrder);
    // This asset's own saved Related Assets view template wins over its
    // type's, when one exists — same all-or-nothing reasoning as the
    // display template below (a cohesive layout choice saved as one unit).
    const effectiveRelatedTemplate = isAssetEntity
      ? (assetRelatedAssetsTemplates?.[entityId] ?? typeRelatedAssetsTemplates?.[relationshipTypeId])
      : typeRelatedAssetsTemplates?.[entityId];
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        {titleRow}
        <div className="op-dashboard-card op-now-type-kpi-card">
          <RelatedAssetsPreview
            key={entityId}
            relatedAssetRows={relatedAssetRows}
            evidencePoints={evidencePoints}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            currentTypeId={entityId}
            currentTypeName={title}
            currentTypeExampleAssetId={thisAssetExampleId}
            typeList={typeList}
            savedTemplate={effectiveRelatedTemplate}
            onSaveTemplate={isAssetEntity ? onSaveAssetRelatedAssetsTemplate : onSaveTypeRelatedAssetsTemplate}
            activeSaveHandlerRef={activeSaveHandlerRef}
            onTitleClick={onTitleClick}
            showToolbar={toolbarExpanded}
            selectedRelatedKey={propertyVisuals?.selectedRelatedKey ?? null}
            onSelectRelated={propertyVisuals?.setSelectedRelatedKey}
          />
        </div>
      </div>
    );
  }

  // All Assets is a single shared, model-wide view (not per-type, let alone
  // per-asset) — activeTabIndex never reaches 2 for an asset entity, since
  // the Details panel's own tab switcher only offers Properties/Related
  // Assets when one is selected.
  if (activeTabIndex === 2) {
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        {titleRow}
        <AllAssetsDiagram
          typeList={typeList}
          currentTypeId={entityId}
          hiddenAssetIds={hiddenAssetIds}
          typeDisplayTemplates={typeDisplayTemplates}
          typePropertyConfigs={typePropertyConfigs}
          assetDisplayTemplates={assetDisplayTemplates}
          assetPropertyConfigs={assetPropertyConfigs}
          evidencePoints={evidencePoints}
          savedTemplate={allAssetsTemplate}
          onSaveTemplate={onSaveAllAssetsTemplate}
          activeSaveHandlerRef={activeSaveHandlerRef}
          onTitleClick={onTitleClick}
          showToolbar={toolbarExpanded}
        />
      </div>
    );
  }

  // HmiPropertiesListing itself only ever does a direct typeDisplayTemplates
  // ?.[typeId] / typePropertyConfigs?.[typeId] lookup — no fallback logic of
  // its own. So the asset-aware fallback (this asset's own override if it
  // has one, else its type's current settings as a starting point to tweak
  // from, not blank defaults) is built here instead, as a synthetic single-
  // key map under entityId, keeping HmiPropertiesListing itself unchanged
  // and exactly as before for every type-only caller (assetPropertyConfigs
  // undefined there, so effectivePropertyConfigs reduces to typePropertyConfigs
  // unchanged).
  const effectiveDisplayTemplate = isAssetEntity
    ? (assetDisplayTemplates?.[entityId] ?? typeDisplayTemplates?.[relationshipTypeId])
    : typeDisplayTemplates?.[entityId];
  const effectiveDisplayTemplates = { [entityId]: effectiveDisplayTemplate };
  const effectivePropertyOverrides = isAssetEntity
    ? { ...(typePropertyConfigs[relationshipTypeId] || {}), ...(assetPropertyConfigs?.[entityId] || {}) }
    : (typePropertyConfigs[entityId] || {});
  const effectivePropertyConfigs = { [entityId]: effectivePropertyOverrides };

  return (
    <div className="op-panel op-investigate-panel op-now-asset-detail">
      {titleRow}
      <div className="op-dashboard-card op-now-type-kpi-card">
        <HmiPropertiesListing
          properties={properties}
          sparklineSource={sparklineSource}
          evidencePoints={evidencePoints}
          typeVisibilityMode
          typeId={entityId}
          typePropertyConfigs={effectivePropertyConfigs}
          typeDisplayTemplates={effectiveDisplayTemplates}
          onSaveTypeDisplayTemplate={isAssetEntity ? onSaveAssetDisplayTemplate : onSaveTypeDisplayTemplate}
          activeSaveHandlerRef={activeSaveHandlerRef}
          onViewModeChange={onViewModeChange}
          showToolbar={toolbarExpanded}
          propertyViewModes={draftPropertyViewModes}
          inheritedPropertyViewModes={inheritedPropertyViewModes}
          propertyOrder={effectivePropertyOrder}
          selectedPropertyKey={propertyVisuals?.selectedKey ?? null}
          onSelectProperty={propertyVisuals?.setSelectedKey}
        />
      </div>
    </div>
  );
}

function AttentionPanel({ selectedId, onSelect }) {
  const [groupBy, setGroupBy] = useState('severity');
  const [sortBy, setSortBy] = useState('time');
  const [pinnedIds, setPinnedIds] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(['medium', 'low']);

  const togglePin = (id) => {
    setPinnedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleGroupCollapsed = (key) => {
    setCollapsedGroups(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const pinnedItems = useMemo(
    () => sortAttentionItems(ATTENTION_ITEMS.filter(i => pinnedIds.includes(i.id)), sortBy),
    [pinnedIds, sortBy]
  );

  const groupingActive = groupBy !== 'none';
  const pinnedCollapsed = groupingActive && collapsedGroups.includes('pinned');

  const groups = useMemo(() => {
    const unpinned = ATTENTION_ITEMS.filter(i => !pinnedIds.includes(i.id));
    const sorted = sortAttentionItems(unpinned, sortBy);
    return groupAttentionItems(sorted, groupBy);
  }, [groupBy, sortBy, pinnedIds]);

  return (
    <div className="op-panel op-attention-panel">
      <div className="op-zone-label">Attention</div>

      <div className="op-attention-controls">
        <div className="op-control">
          <span className="op-control-label">Group by</span>
          <SelectBox
            dataSource={GROUP_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={groupBy}
            onValueChanged={e => setGroupBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
        <div className="op-control">
          <span className="op-control-label">Sort by</span>
          <SelectBox
            dataSource={SORT_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={sortBy}
            onValueChanged={e => setSortBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
      </div>

      <div className="op-attention-list">
        {pinnedItems.length > 0 && (
          <div>
            <div
              className={`op-attention-group-header op-attention-group-header--pinned${groupingActive ? ' op-attention-group-header--clickable' : ''}`}
              onClick={groupingActive ? () => toggleGroupCollapsed('pinned') : undefined}
            >
              {groupingActive && (
                <span className={`op-group-chevron${pinnedCollapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
              )}
              <span className="op-pin-icon">📌</span>
              Pinned
              <span className="op-group-count-badge">{pinnedItems.length}</span>
            </div>
            {!pinnedCollapsed && pinnedItems.map(item => (
              <AttentionCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                pinned={true}
                onSelect={onSelect}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}

        {groups.map(group => {
          const collapsed = group.label && collapsedGroups.includes(group.key);
          return (
            <div key={group.key}>
              {group.label && (
                <div
                  className="op-attention-group-header op-attention-group-header--clickable"
                  onClick={() => toggleGroupCollapsed(group.key)}
                >
                  <span className={`op-group-chevron${collapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
                  {group.label}
                  <span className="op-group-count-badge">{group.items.length}</span>
                </div>
              )}
              {!collapsed && group.items.map(item => (
                <AttentionCard
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  pinned={false}
                  onSelect={onSelect}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work list — same panel slot as Attention, shown when the nav rail is in
// Work mode. Deliberately mirrors AttentionPanel's card-list shape (no
// group/sort controls yet — tasks don't have severity/asset to group by).
// ─────────────────────────────────────────────────────────────────────────────

function WorkCard({ item, selected, onSelect, onToggleDone }) {
  const margin = computeMarginMinutes(item);
  const marginText = item.done ? null : formatMargin(margin);
  return (
    <div
      className={`op-work-item${item.done ? ' op-work-item--done' : ''}${selected ? ' op-work-item--selected' : ''}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="op-work-item-top">
        <input
          type="checkbox"
          checked={item.done}
          onClick={e => e.stopPropagation()}
          onChange={() => onToggleDone(item.id)}
        />
        <span className="op-work-text">{item.text}</span>
        <span className="op-work-priority-dot" style={{ background: WORK_PRIORITY_COLORS[item.priority] }} title={WORK_PRIORITY_LABELS[item.priority]} />
      </div>
      <div className="op-work-item-bottom">
        <span className={`op-work-source-badge op-work-source-badge--${item.sourceType}`}>
          {WORK_SOURCE_TYPE_LABELS[item.sourceType]}
        </span>
        {item.assignedRole && <span className="op-work-role">{item.assignedRole}</span>}
        {marginText && (
          <span className="op-work-margin" style={{ color: marginColor(margin) }}>{marginText}</span>
        )}
      </div>
    </div>
  );
}

function WorkListPanel({ items, selectedId, onSelect, onToggleDone, onAdd }) {
  const [draft, setDraft] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [sortBy, setSortBy] = useState('margin');

  const groups = useMemo(() => {
    const sorted = sortWorkItems(items, sortBy);
    return groupWorkItems(sorted, groupBy);
  }, [items, groupBy, sortBy]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <div className="op-panel op-attention-panel">
      <div className="op-zone-label">Work</div>

      <div className="op-attention-controls">
        <div className="op-control">
          <span className="op-control-label">Group by</span>
          <SelectBox
            dataSource={WORK_GROUP_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={groupBy}
            onValueChanged={e => setGroupBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
        <div className="op-control">
          <span className="op-control-label">Sort by</span>
          <SelectBox
            dataSource={WORK_SORT_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={sortBy}
            onValueChanged={e => setSortBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
      </div>

      <div className="op-work-list">
        {groups.map(group => (
          <div key={group.key}>
            {group.label && (
              <div className="op-attention-group-header">
                {group.label}
                <span className="op-group-count-badge">{group.items.length}</span>
              </div>
            )}
            {group.items.map(w => (
              <WorkCard key={w.id} item={w} selected={selectedId === w.id} onSelect={onSelect} onToggleDone={onToggleDone} />
            ))}
          </div>
        ))}
      </div>
      <div className="op-work-add">
        <input
          type="text"
          placeholder="Add a task…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <button className="op-btn op-btn--secondary" onClick={submit}>Add</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Investigate — detail for the selected Attention item
// ─────────────────────────────────────────────────────────────────────────────

function InvestigatePanel({ item, onCreateWorkItem, evidenceView, setEvidenceView, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, onSaveRelatedAssetsTemplate, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, activeSaveHandlerRef, onTitleClick, onGearClick }) {
  // This Asset vs. Related Assets sub-toggle, within the Related Assets
  // tab. Declared before the early return below (not alongside the other
  // computed values further down, which only run once item is known) so
  // this hook is always called, on every render, per the Rules of Hooks.
  const [relatedAssetsSubview, setRelatedAssetsSubview] = useState('thisAsset');

  // Time-track scrubber for the Related Assets tab. Defaults to the last
  // index of the shared shift timeline — the exact same instant "current"
  // values already reflect (verified: the static snapshot each box shows
  // by default is identical to the last point of that same property's own
  // series), so nothing visibly changes until the user actually scrubs or
  // presses play. Also declared before the early return per Rules of Hooks.
  const scrubMaxIndex = Math.max(CURRENT_TIMESTAMPS.length, 1) - 1;
  const [scrubTimeIndex, setScrubTimeIndex] = useState(scrubMaxIndex);
  const [scrubPlaying, setScrubPlaying] = useState(false);
  // DevExtreme's Slider fires onValueChanged for a programmatic value prop
  // change exactly the same as a real user drag — it has no way to tell
  // them apart itself. Without this flag, the moment playback's own effect
  // advances the index, the slider would report that as a "value changed"
  // event, and the handler below would immediately call
  // setScrubPlaying(false), self-cancelling playback after a single step.
  // Set to true right before any programmatic setScrubTimeIndex call, and
  // consumed (cleared, without pausing) by the very next onValueChanged.
  const scrubProgrammaticRef = useRef(false);

  useEffect(() => {
    if (!scrubPlaying) return;
    if (scrubTimeIndex >= scrubMaxIndex) {
      setScrubPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      scrubProgrammaticRef.current = true;
      setScrubTimeIndex(i => Math.min(i + 1, scrubMaxIndex));
    }, 400);
    return () => clearTimeout(timer);
  }, [scrubPlaying, scrubTimeIndex, scrubMaxIndex]);

  const handleScrubPlayPause = () => {
    if (!scrubPlaying && scrubTimeIndex >= scrubMaxIndex) {
      scrubProgrammaticRef.current = true;
      setScrubTimeIndex(0);
    }
    setScrubPlaying(p => !p);
  };

  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select an item in Attention to see the full picture.</div>
      </div>
    );
  }

  const d = item.detail;
  const severityColor = SEVERITY_COLORS[item.severity];

  // Related Assets: resolves via attentionAssetToAssetEntry/CURRENT_ASSET_DATA
  // for all three models, including refinery (its own hardcoded ASSET_DATA
  // constant, not a fetched file, but resolved the same way). Stays null
  // only if an attention item's asset string genuinely doesn't match any
  // real asset id, in which case the tab shows a plain "not available"
  // message rather than an empty/broken diagram.
  const relatedAssetsAssetEntry = getAttentionItemAssetEntry(item);
  const relatedAssetsTypeId = relatedAssetsAssetEntry ? `TYPE_${relatedAssetsAssetEntry.assetLevel}_${relatedAssetsAssetEntry.assetType}` : null;
  const relatedAssetsTypeEntry = relatedAssetsTypeId ? typeList.find(t => t.id === relatedAssetsTypeId) : null;

  // Related Alarms: other attention items on the same asset type as this
  // one (e.g. both on an "Aeration" stage, just a different train) —
  // surfaces whether this looks like a one-off or a pattern across the
  // same kind of equipment elsewhere in the plant. There's no dedicated
  // "related alarms" field in the data, so this is derived directly from
  // the attention items list, reusing the same typeId resolution as
  // Related Assets above. A null typeId (an asset string that doesn't
  // resolve) never matches another null, so this stays empty rather than
  // spuriously grouping unrelated unresolved items together.
  const relatedAlarms = relatedAssetsTypeId
    ? ATTENTION_ITEMS.filter(other => other.id !== item.id && getAttentionItemTypeId(other) === relatedAssetsTypeId)
    : [];

  // Shared between the Timeline tab's own content and the small Timeline
  // card shown alongside the Trend chart — same underlying data either way.
  const timelineItems = d.evidencePoints.map(p => ({
    time: p.time,
    primary: p.value,
    secondary: p.label || null,
    highlighted: !!p.label,
    color: severityColor,
  }));

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <span className="op-severity-dot" style={{ background: severityColor }} />
        <div>
          <div className="op-investigate-asset">{item.asset}</div>
          <div className="op-investigate-signal">{item.signal}</div>
        </div>
      </div>

      <div className="op-investigate-toggle-row">
        <ButtonGroup
          items={EVIDENCE_VIEW_ITEMS}
          keyExpr="value"
          selectedItemKeys={[evidenceView]}
          onItemClick={e => setEvidenceView(e.itemData.value)}
          stylingMode="outlined"
          className="op-dash-chart-toggle"
        />
      </div>

      {evidenceView === 'ai' ? (
        <>
          <div className="op-dashboard-card op-dashboard-card--ministats">
            <div className="op-dash-ministat-row">
              <div className="op-dash-ministat" style={{ color: CONFIDENCE_COLORS[d.confidenceLevel] }}>
                <div className="op-dash-ministat-top">
                  <span className="op-dash-ministat-icon"><ConfidenceIcon filled={CONFIDENCE_BARS[d.confidenceLevel]} /></span>
                  <div className="op-dash-ministat-textblock">
                    <span className="op-dash-ministat-category">Confidence</span>
                    <span className="op-dash-ministat-value">{CONFIDENCE_LABELS[d.confidenceLevel]}</span>
                  </div>
                </div>
                <div className="op-dash-ministat-detail">{d.confidence}</div>
              </div>
              <div className="op-dash-ministat" style={{ color: RISK_COLORS[d.riskLevel] }}>
                <div className="op-dash-ministat-top">
                  <span className="op-dash-ministat-icon">{d.riskLevel === 'none' ? <ShieldCheckIcon /> : <RiskAlertIcon />}</span>
                  <div className="op-dash-ministat-textblock">
                    <span className="op-dash-ministat-category">Risk</span>
                    <span className="op-dash-ministat-value">{RISK_LABELS[d.riskLevel]}</span>
                  </div>
                </div>
                <div className="op-dash-ministat-detail">{d.risk}</div>
              </div>
              <div className="op-dash-ministat" style={{ color: OUTCOME_COLORS[d.outcomeStatus] }}>
                <div className="op-dash-ministat-top">
                  <span className="op-dash-ministat-icon">{d.outcomeStatus === 'recovering' ? <TrendUpIcon /> : d.outcomeStatus === 'resolved' ? <ShieldCheckIcon /> : <DashIcon />}</span>
                  <div className="op-dash-ministat-textblock">
                    <span className="op-dash-ministat-category">Outcome</span>
                    <span className="op-dash-ministat-value">{OUTCOME_LABELS[d.outcomeStatus]}</span>
                  </div>
                </div>
                <div className="op-dash-ministat-detail">{d.expectedOutcome !== '—' ? d.expectedOutcome : 'No outcome defined'}</div>
              </div>
            </div>
          </div>
          <div className="op-investigate-dashboard op-investigate-dashboard--ai">
            <div className="op-dashboard-card op-dashboard-card--interpretation">
              <div className="op-dashboard-card-title">Interpretation</div>
              <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
                <div className="op-dash-text op-dash-text--clamp3">{d.signal}</div>
                <div className="op-dash-separator" />
                <div className="op-evidence-layer">
                  <span className="op-evidence-layer-label op-evidence-layer-label--observed">Observed</span>
                  <div className="op-dash-text op-dash-text--clamp2">{d.observed}</div>
                </div>
                <div className="op-evidence-layer">
                  <span className="op-evidence-layer-label op-evidence-layer-label--derived">Derived</span>
                  <div className="op-dash-text op-dash-text--clamp2">{d.derived}</div>
                </div>
                <div className="op-evidence-layer">
                  <span className="op-evidence-layer-label op-evidence-layer-label--inferred"><AiPill />Inferred</span>
                  <div className="op-dash-text op-dash-text--clamp2">{d.inferred}</div>
                </div>
                <div className="op-dash-separator" />
                <div className="op-evidence-layer">
                  <span className="op-evidence-layer-label op-evidence-layer-label--inferred"><AiPill />Next steps</span>
                  <div className="op-dash-text op-dash-text--clamp3">{d.recommendation}</div>
                </div>
                <button className="op-btn op-btn--primary op-investigate-createworkitem-btn" onClick={() => onCreateWorkItem(item)}>
                  Create work item
                </button>
              </div>
            </div>
          </div>
        </>
      ) : evidenceView === 'relatedAssets' ? (
        <>
          <div className="op-investigate-relatedassets-toprow">
            <ButtonGroup
              items={RELATED_ASSETS_SUBVIEW_ITEMS}
              keyExpr="value"
              selectedItemKeys={[relatedAssetsSubview]}
              onItemClick={e => setRelatedAssetsSubview(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle op-investigate-relatedassets-toggle"
            />
            {CURRENT_TIMESTAMPS[scrubTimeIndex] && (
              <div className="op-investigate-scrubtime">{CURRENT_TIMESTAMPS[scrubTimeIndex]}</div>
            )}
          </div>
          <div className="op-investigate-relatedassets-split">
            <TimeScrubContext.Provider value={scrubTimeIndex}>
              <div className="op-investigate-relatedassets-body">
                {relatedAssetsTypeId ? (
                  relatedAssetsSubview === 'thisAsset' ? (
                    <div className={`op-hmiprops-singlebox op-investigate-related-template${(assetDisplayTemplates?.[relatedAssetsAssetEntry?.id]?.layoutMode ?? typeDisplayTemplates?.[relatedAssetsTypeId]?.layoutMode) === 'manual' ? ' op-hmiprops-singlebox--manual' : ''}`}>
                      <RelatedAssetBoxContent
                        relatedTypeId={relatedAssetsTypeId}
                        relatedTypeName={relatedAssetsTypeEntry?.name}
                        relatedTypeExampleAssetId={relatedAssetsAssetEntry?.id}
                        typeDisplayTemplates={typeDisplayTemplates}
                        typePropertyConfigs={typePropertyConfigs}
                        assetDisplayTemplates={assetDisplayTemplates}
                        assetPropertyConfigs={assetPropertyConfigs}
                        evidencePoints={d.evidencePoints}
                        onTitleClick={onTitleClick}
                        onGearClick={onGearClick}
                      />
                    </div>
                  ) : (
                    // Same component the Operator Assets area's own Related
                    // Assets tab uses (OperatorAssetDetail, activeTab==='related')
                    // — guarantees this is literally the same view, not just a
                    // similar one, and correctly threads onGearClick through to
                    // both its Cards and Diagram layout modes (RelatedAssetsPreview,
                    // used here previously, never accepted that prop at all,
                    // which is why the gear icon was missing).
                    <ReadOnlyRelatedAssetsView
                      typeId={relatedAssetsTypeId}
                      assetId={relatedAssetsAssetEntry?.id}
                      typeList={typeList}
                      typeDisplayTemplates={typeDisplayTemplates}
                      typePropertyConfigs={typePropertyConfigs}
                      typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                      assetDisplayTemplates={assetDisplayTemplates}
                      assetPropertyConfigs={assetPropertyConfigs}
                      assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                      evidencePoints={d.evidencePoints}
                      savedTemplate={assetRelatedAssetsTemplates?.[relatedAssetsAssetEntry?.id] ?? relatedAssetsTemplates?.[relatedAssetsTypeId]}
                      onTitleClick={onTitleClick}
                      onGearClick={onGearClick}
                    />
                  )
                ) : (
                  <div className="op-dash-text op-dash-text--muted">Related assets aren't available for this asset.</div>
                )}
              </div>
            </TimeScrubContext.Provider>
            {/* Always visible regardless of which sub-view (This Asset /
                Related Assets) is active on the left — same active-at-
                scrubbed-time highlighting as before, just now a permanent
                fixture rather than a third thing to switch to. */}
            <div className="op-investigate-alarmssidebar">
              <div className="op-dashboard-card-title">Alarms</div>
              {relatedAlarms.length > 0 ? (
                <div className="op-timeline op-timeline--sidebar">
                  {relatedAlarms.map(other => {
                    const active = isAttentionItemActiveAtTime(other, CURRENT_TIMESTAMPS[scrubTimeIndex]);
                    return (
                      <div key={other.id} className={`op-timeline-row${active ? ' op-timeline-row--active' : ''}`}>
                        <span
                          className="op-timeline-dot op-timeline-dot--highlighted"
                          style={{ background: SEVERITY_COLORS[other.severity], boxShadow: `0 0 0 1px ${SEVERITY_COLORS[other.severity]}` }}
                        />
                        <div className="op-timeline-time">{other.since}</div>
                        <div className="op-timeline-primary">
                          {other.asset}
                          {active && <span className="op-investigate-alarm-active-tag">Active now</span>}
                        </div>
                        <div className="op-timeline-secondary">{other.signal}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="op-dash-text op-dash-text--muted">No related alarms on this line right now.</div>
              )}
            </div>
          </div>
          {CURRENT_TIMESTAMPS.length > 0 && (
            <div className="op-investigate-timetrack">
              <button
                type="button"
                className="op-investigate-timetrack-playbtn"
                onClick={handleScrubPlayPause}
                title={scrubPlaying ? 'Pause' : 'Play'}
              >
                <PlayPauseIcon playing={scrubPlaying} />
              </button>
              <Slider
                min={0}
                max={scrubMaxIndex}
                step={1}
                value={scrubTimeIndex}
                onValueChanged={e => {
                  if (scrubProgrammaticRef.current) {
                    scrubProgrammaticRef.current = false;
                    return;
                  }
                  setScrubPlaying(false);
                  setScrubTimeIndex(e.value);
                }}
                className="op-investigate-timetrack-slider"
              >
                <SliderLabel visible format={v => CURRENT_TIMESTAMPS[v] ?? ''} position="bottom" />
              </Slider>
            </div>
          )}
        </>
      ) : (
        <div className="op-investigate-dashboard">
          <div className="op-dashboard-card op-dashboard-card--signal">
            <div className="op-dashboard-card-title">Signal</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <ComparisonLineChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} fullSeries={getAttentionItemPrimarySeries(item)} />
            </div>
          </div>

          <div className="op-dashboard-card op-dashboard-card--timelinemini">
            <div className="op-dashboard-card-title">Timeline</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <VerticalTimeline maxItems={4} items={timelineItems} />
            </div>
          </div>
          <div className="op-dashboard-card op-dashboard-card--tablemini">
            <div className="op-dashboard-card-title">Table</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <EvidenceTable evidencePoints={d.evidencePoints} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task detail — same panel slot as Investigate, shown when the nav rail is
// in Work mode. Deliberately minimal for now: name, description, created
// datetime, done status — can grow into something richer later.
// ─────────────────────────────────────────────────────────────────────────────

function TaskDetailPanel({ item, onToggleDone }) {
  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select a task to see its details.</div>
      </div>
    );
  }

  const margin = computeMarginMinutes(item);
  const marginText = !item.done ? formatMargin(margin) : null;
  const createdText = formatCreatedAt(item.createdAt);

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <span className="op-work-priority-dot" style={{ background: WORK_PRIORITY_COLORS[item.priority] }} />
        <div>
          <div className="op-investigate-asset">{item.assetLabel || (item.source === 'ai' ? 'AI-created task' : 'Task')}</div>
          <div className="op-investigate-signal">{item.text}</div>
        </div>
        <button className="op-btn op-btn--primary op-investigate-header-action" onClick={() => onToggleDone(item.id)}>
          {item.done ? 'Mark as not done' : 'Mark as done'}
        </button>
      </div>

      <div className="op-investigate-chain">
        <div className="op-chain-row">
          <div className="op-chain-label">Description</div>
          <div className="op-chain-value">{item.description || 'No additional description.'}</div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Type</div>
          <div className="op-chain-value">
            {item.workType || 'General'} · {WORK_PRIORITY_LABELS[item.priority]}
          </div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Source</div>
          <div className="op-chain-value">
            {WORK_SOURCE_TYPE_LABELS[item.sourceType] || 'Planned'}
            {item.sourceLabel ? ` — ${item.sourceLabel}` : ''}
          </div>
        </div>
        {item.assignedRole && (
          <div className="op-chain-row">
            <div className="op-chain-label">Assigned to</div>
            <div className="op-chain-value">{item.assignedRole}</div>
          </div>
        )}
        {item.dueAt && (
          <div className="op-chain-row">
            <div className="op-chain-label">Due</div>
            <div className="op-chain-value">
              {formatCreatedAt(item.dueAt)}
              {marginText && <span style={{ color: marginColor(margin), fontWeight: 700 }}> · {marginText}</span>}
            </div>
          </div>
        )}
        {createdText && (
          <div className="op-chain-row">
            <div className="op-chain-label">Created</div>
            <div className="op-chain-value">{createdText}</div>
          </div>
        )}
        <div className="op-chain-row">
          <div className="op-chain-label">Status</div>
          <div className="op-chain-value">{item.done ? 'Done' : 'Not done'}</div>
        </div>
      </div>

      {item.dependencies && (
        <div className="op-investigate-chain op-work-dependencies">
          <div className="op-chain-label" style={{ marginBottom: 4 }}>Dependencies</div>
          {item.dependencies.map((dep, i) => (
            <div key={i} className={`op-dependency-row${dep.done ? ' op-dependency-row--done' : ''}`}>
              <span className="op-dependency-check">{dep.done ? '✓' : '○'}</span>
              <span>{dep.label}</span>
            </div>
          ))}
          {item.progressNote && <div className="op-dash-text op-dash-text--muted" style={{ marginTop: 6 }}>{item.progressNote}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — Chat (contacts)
// ─────────────────────────────────────────────────────────────────────────────

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

const CONTACTS_SEED = [
  {
    id: 'c1',
    name: 'Jordan Blake',
    role: 'Shift Lead',
    unread: true,
    thread: [
      { from: 'them', text: 'Can you check on F2 before you head to break?', time: '2:14 PM' },
    ],
  },
  {
    id: 'c2',
    name: 'Priya Nair',
    role: 'Maintenance',
    unread: true,
    thread: [
      { from: 'them', text: 'Heading over to inspect CB-204 now.', time: '2:01 PM' },
      { from: 'them', text: 'Should have an update in about 15.', time: '2:02 PM' },
    ],
  },
  {
    id: 'c3',
    name: 'Sam Ortiz',
    role: 'Quality',
    unread: false,
    thread: [
      { from: 'me', text: 'Logged the reject-rate note for A1.', time: '1:10 PM' },
      { from: 'them', text: 'Thanks, got it — flagged the lot too.', time: '1:12 PM' },
    ],
  },
  {
    id: 'c4',
    name: 'Night Shift Lead',
    role: 'Shift Lead',
    unread: false,
    thread: [
      { from: 'them', text: 'Handoff notes are in the log — nothing major overnight.', time: '6:02 AM' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — AI chat
// ─────────────────────────────────────────────────────────────────────────────

const AI_CHAT_INITIAL = [
  { from: 'ai', text: 'Hi — I can help you look into anything on the floor right now. What do you need?' },
];

const AI_CHAT_CANNED_REPLIES = [
  "Let me pull that up — one moment.",
  "I don't have a confident read on that yet, but I'll keep watching it.",
  "Noted — I'll flag it if the pattern continues.",
  "Nothing else correlates with that in the current readings.",
];

// Suggested-prompt chips — teaches what's possible and removes the
// prompt-writing burden, rather than a blank chat box. Generic for now
// (not yet tied to whichever Attention item is selected); a natural
// follow-up is making this context-aware.
const AI_CHAT_SUGGESTED_PROMPTS = [
  'Why was this flagged?',
  'What changed first?',
  'Similar events',
  'What should I check?',
  'What happens if I wait?',
];

// ─────────────────────────────────────────────────────────────────────────────
// Side panel content — Chat / AI, now driven by the RightRail below rather
// than an internal tab bar
// ─────────────────────────────────────────────────────────────────────────────

function ContactsPanel({ contacts, activeContactId, onSelectContact, onBack, onSendMessage }) {
  const [draft, setDraft] = useState('');
  const activeContact = contacts.find(c => c.id === activeContactId) || null;

  const send = () => {
    const text = draft.trim();
    if (!text || !activeContact) return;
    onSendMessage(activeContact.id, text);
    setDraft('');
  };

  if (!activeContact) {
    return (
      <div className="op-chat-list">
        {contacts.map(c => {
          const lastMessage = c.thread[c.thread.length - 1];
          return (
            <div key={c.id} className="op-contact-row" onClick={() => onSelectContact(c.id)}>
              <div className="op-contact-avatar">{initials(c.name)}</div>
              <div className="op-contact-info">
                <div className="op-contact-name-row">
                  <span className="op-contact-name">{c.name}</span>
                  {c.unread && <span className="op-unread-dot" />}
                </div>
                <div className="op-contact-role">{c.role}</div>
                {lastMessage && <div className="op-contact-preview">{lastMessage.text}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="op-chat-thread">
      <div className="op-chat-thread-header" onClick={onBack}>
        <span className="op-chat-back">←</span>
        <span className="op-contact-name">{activeContact.name}</span>
      </div>
      <div className="op-chat-messages">
        {activeContact.thread.map((m, i) => (
          <div key={i} className={`op-chat-bubble op-chat-bubble--${m.from}`}>
            <div className="op-chat-bubble-text">{m.text}</div>
            <div className="op-chat-bubble-time">{m.time}</div>
          </div>
        ))}
      </div>
      <div className="op-chat-input-row">
        <input
          type="text"
          placeholder={`Message ${activeContact.name.split(' ')[0]}…`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
        />
        <button className="op-btn op-btn--secondary" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function AiChatPanel() {
  const [messages, setMessages] = useState(AI_CHAT_INITIAL);
  const [draft, setDraft] = useState('');
  const timeoutRef = useRef(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const send = (overrideText) => {
    const text = (overrideText !== undefined ? overrideText : draft).trim();
    if (!text) return;
    setMessages(prev => [...prev, { from: 'user', text }]);
    setDraft('');
    timeoutRef.current = setTimeout(() => {
      const reply = AI_CHAT_CANNED_REPLIES[Math.floor(Math.random() * AI_CHAT_CANNED_REPLIES.length)];
      setMessages(prev => [...prev, { from: 'ai', text: reply }]);
    }, 700);
  };

  return (
    <>
      <div className="op-ai-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`op-ai-chat-bubble op-ai-chat-bubble--${m.from}`}>
            {m.from === 'ai' && <AiPill />}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="op-ai-chat-prompts">
        {AI_CHAT_SUGGESTED_PROMPTS.map(prompt => (
          <button key={prompt} className="op-ai-chat-prompt-chip" onClick={() => send(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="op-ai-chat-input-row">
        <input
          type="text"
          placeholder="Ask the AI…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
        />
        <button className="op-btn op-btn--primary" onClick={() => send()}>Send</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav rail — Gmail-style collapsible rail (icon+label+count expanded,
// icon+dot collapsed), sitting as its own element alongside the existing
// Attention panel and Work/Chat/AI tabs — not a replacement for either.
// "New" is derived from data already on hand rather than separate state:
//   - Attention: items that surfaced within the last 15 minutes
//   - Work: not-yet-done items the AI created (source: 'ai')
// ─────────────────────────────────────────────────────────────────────────────

// 30 min, not 15 — the nextgen dataset spans a full 8-hour shift rather
// than a 2-hour window, so "recent" needs a wider bar for this badge to
// mean anything (at 15 min, nothing in the new data would ever qualify).
const NEW_ATTENTION_THRESHOLD_MINUTES = 30;

// Mirrors App.js's own AssetTreeItemTemplate (not exported from there, so
// copied rather than restructuring that file for one shared helper) —
// keeps the asset row's look identical to the existing Data tab hierarchy
// browser: name plus a small type badge.
// The Configurator's Now tree only — adds the customized-asset dot.
// Operator's Assets tree keeps the plain template below: operators don't
// configure anything, so the mark would only be noise there.
function ConfiguratorAssetTreeItemTemplate(item) {
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="op-tree-item-trailing">
        <AssetCustomizedDot assetId={item.id} />
        <span className="tree-item-badge">{item.assetType}</span>
      </span>
    </div>
  );
}

function NowAssetTreeItemTemplate(item) {
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="tree-item-badge">{item.assetType}</span>
    </div>
  );
}

function NavRail({ mode, hidden, onIconClick, attentionCount, workCount, operatorPersona }) {
  const [expanded, setExpanded] = useState(false);

  const allItems = [
    { id: 'now', label: 'Visualization', Icon: VisualizationRailIcon, count: 0 },
    { id: 'attention', label: 'Attention', Icon: AttentionRailIcon, count: attentionCount },
    { id: 'work', label: 'Work', Icon: WorkTabIcon, count: workCount },
    { id: 'assets', label: 'Assets', Icon: AssetsRailIcon, count: 0 },
  ];
  const items = operatorPersona === 'configurator'
    ? allItems.filter(item => item.id === 'now')
    : allItems.filter(item => item.id !== 'now');

  return (
    <div className={`op-nav-rail${expanded ? ' op-nav-rail--expanded' : ''}`}>
      <button
        className="op-nav-rail-toggle"
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '‹' : '›'}
      </button>

      {items.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`op-nav-rail-item${isActive ? ' op-nav-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="op-nav-rail-icon">
              <item.Icon />
              {!expanded && item.count > 0 && <span className="op-nav-rail-dot" />}
            </span>
            {expanded && <span className="op-nav-rail-label">{item.label}</span>}
            {expanded && item.count > 0 && <span className="op-nav-rail-count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function SidePanel({ mode, contacts, activeContactId, onSelectContact, onBack, onSendMessage, selectedNowThing, nowTypeList, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, activeSaveHandlerRef, activeTabIndex, onActiveTabIndexChange, rightPanelViewMode, hiddenAssetIds, onToggleAssetVisibility, propertyVisuals }) {
  return (
    <div className="op-panel op-side-panel">
      <div className="op-side-tab-content">
        {mode === 'chat' && (
          <ContactsPanel
            contacts={contacts}
            activeContactId={activeContactId}
            onSelectContact={onSelectContact}
            onBack={onBack}
            onSendMessage={onSendMessage}
          />
        )}
        {mode === 'ai' && <AiChatPanel />}
        {mode === 'details' && (
          selectedNowThing?.kind === 'type' ? (
            (() => {
              const typeEntry = nowTypeList.find(t => t.id === selectedNowThing.id);
              if (!typeEntry) {
                return <div className="op-now-detail-placeholder-note">Select a type from the list to view it.</div>;
              }
              const { properties } = resolveAssetProperties(typeEntry.exampleAssetId);
              return (
                <NowTypeDetailsList
                  key={selectedNowThing.id}
                  entityId={selectedNowThing.id}
                  isAssetEntity={false}
                  relationshipTypeId={selectedNowThing.id}
                  typeList={nowTypeList}
                  properties={properties}
                  typePropertyConfigs={typePropertyConfigs}
                  setTypePropertyConfigs={setTypePropertyConfigs}
                  typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                  setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                  rightPanelViewMode={rightPanelViewMode}
                  hiddenAssetIds={hiddenAssetIds}
                  onToggleAssetVisibility={onToggleAssetVisibility}
                  activeTabIndex={activeTabIndex}
                  onActiveTabIndexChange={onActiveTabIndexChange}
                  propertyVisuals={propertyVisuals}
                  typeDisplayTemplates={typeDisplayTemplates}
                />
              );
            })()
          ) : selectedNowThing?.kind === 'asset' ? (
            (() => {
              const asset = CURRENT_ASSET_MAP[selectedNowThing.id];
              if (!asset) {
                return <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>;
              }
              const relationshipTypeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
              const { properties } = resolveAssetProperties(selectedNowThing.id);
              return (
                <NowTypeDetailsList
                  key={selectedNowThing.id}
                  entityId={selectedNowThing.id}
                  isAssetEntity
                  relationshipTypeId={relationshipTypeId}
                  typeList={nowTypeList}
                  properties={properties}
                  typePropertyConfigs={typePropertyConfigs}
                  setTypePropertyConfigs={setTypePropertyConfigs}
                  typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                  setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                  assetPropertyConfigs={assetPropertyConfigs}
                  setAssetPropertyConfigs={setAssetPropertyConfigs}
                  assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                  setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                  rightPanelViewMode={rightPanelViewMode}
                  hiddenAssetIds={hiddenAssetIds}
                  onToggleAssetVisibility={onToggleAssetVisibility}
                  activeTabIndex={activeTabIndex}
                  onActiveTabIndexChange={onActiveTabIndexChange}
                  propertyVisuals={propertyVisuals}
                  typeDisplayTemplates={typeDisplayTemplates}
                />
              );
            })()
          ) : (
            <div className="op-now-detail-placeholder-note">Select a type or asset from the tree to view its details.</div>
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right rail — mirrors NavRail's look, but always icon-only (no expand/
// collapse — per request, this one never needs a label view) and switches
// the right panel between Chat and AI. Room to add more icons later for
// other right-panel content, same pattern as the left rail's items array.
// ─────────────────────────────────────────────────────────────────────────────

const RIGHT_RAIL_ITEMS = [
  { id: 'chat', label: 'Chat', Icon: ChatTabIcon },
  { id: 'ai', label: 'AI chat', Icon: AiTabIcon },
];

// Details (the selected type's Properties/Related Assets/All Assets tabs)
// is a Configurator-only concern — Operator has no reason to edit a
// type's templates, so this stays out of their right rail entirely
// rather than appearing as a mode they'd never use.
const RIGHT_RAIL_ITEMS_CONFIGURATOR = [
  ...RIGHT_RAIL_ITEMS,
  { id: 'details', label: 'Details', Icon: DetailsTabIcon },
];

function RightRail({ mode, hidden, onIconClick, hasUnread, operatorPersona }) {
  const items = operatorPersona === 'configurator' ? RIGHT_RAIL_ITEMS_CONFIGURATOR : RIGHT_RAIL_ITEMS;
  return (
    <div className="op-nav-rail op-nav-rail--right">
      {items.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`op-nav-rail-item${isActive ? ' op-nav-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="op-nav-rail-icon">
              <item.Icon />
              {item.id === 'chat' && hasUnread && <span className="op-nav-rail-dot" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const OperatorWorkspace = forwardRef(function OperatorWorkspace({ selectedModel = 'refinery', operatorPersona = 'operator', onSaveAvailabilityChange, initialDeepLink, onNavigate, onNavigateToConfig }, ref) {
  const [dataState, setDataState] = useState({ loaded: false, error: null, loadedModel: null });
  // Holds whatever "save the current thing" function the deepest-nested
  // relevant component last registered (currently: NowTypeMainPreview's type
  // display template save) — a ref rather than state since updating it
  // shouldn't itself trigger a re-render here.
  const activeSaveHandlerRef = useRef(null);
  // Filled in by OperatorWorkspaceInner: resolves any unsaved Configurator
  // changes (Save/Discard prompt) before App.js navigates away — switching
  // model, persona or app area all unmount the editor holding them.
  const unsavedGuardRef = useRef(null);

  useImperativeHandle(ref, () => ({
    save: () => activeSaveHandlerRef.current?.(),
    resolveUnsavedChanges: () => unsavedGuardRef.current?.() ?? Promise.resolve(),
  }), []);

  useEffect(() => {
    let cancelled = false;
    setDataState({ loaded: false, error: null, loadedModel: null });
    let files = [];
    let model = null;
    loadModelRegistry()
      .then(models => {
        model = models.find(m => m.id === selectedModel);
        if (!model) throw new Error(`model "${selectedModel}" is not listed in /data/models.json`);
        files = getModelDataFiles(model);
        return Promise.all(
          files.map(([, url]) =>
            fetch(url).then(r => {
              if (!r.ok) throw new Error(`${url} — ${r.status}`);
              return r.json();
            })
          )
        );
      })
      .then(results => {
        if (cancelled) return;
        activateLoadedModel(model, files, results);
        setDataState({ loaded: true, error: null, loadedModel: selectedModel });
      })
      .catch(err => {
        if (!cancelled) setDataState({ loaded: false, error: err.message, loadedModel: null });
      });
    return () => { cancelled = true; };
  }, [selectedModel]);

  if (dataState.error) {
    return (
      <div className="op-workspace-loading op-workspace-loading--error">
        Couldn't load operator data ({dataState.error}). Check that /data/models.json lists this model and that its /data/{selectedModel}/*.json files are present in the public folder.
      </div>
    );
  }
  if (!dataState.loaded || dataState.loadedModel !== selectedModel) {
    return <div className="op-workspace-loading">Loading operator data…</div>;
  }

  // key includes both selectedModel and operatorPersona — either one changing
  // forces a full remount. The inner component's own state (selected
  // attention item, selected Now asset, railMode's default, etc.) is
  // initialized based on which model/persona is active, and a stale
  // selection (an id from the other model, or a railMode hidden under the
  // new persona) would otherwise survive.
  return (
    <OperatorWorkspaceInner
      unsavedGuardRef={unsavedGuardRef}
      key={`${selectedModel}-${operatorPersona}`}
      operatorPersona={operatorPersona}
      activeSaveHandlerRef={activeSaveHandlerRef}
      onSaveAvailabilityChange={onSaveAvailabilityChange}
      initialDeepLink={initialDeepLink}
      onNavigate={onNavigate}
      onNavigateToConfig={onNavigateToConfig}
    />
  );
});

export default OperatorWorkspace;

// Shared between Visualization's activeTabIndex (0/1/2) and the Assets
// area's own tab (name-based) — both the deep-link URL scheme and
// NowTypeMainPreview's tab order agree on this same properties/related/
// all sequence, so one mapping serves both.
const DEEP_LINK_TAB_NAMES = ['properties', 'related', 'all'];

function OperatorWorkspaceInner({ operatorPersona, activeSaveHandlerRef, unsavedGuardRef, onSaveAvailabilityChange, initialDeepLink, onNavigate, onNavigateToConfig }) {
  // A deep link (checked against the current persona) seeds this fresh
  // mount's initial selection. It's read once here, on mount, but it is
  // NOT necessarily fixed for the app's whole lifetime the way a URL-only
  // deep link would be — the gear icon on an Operator asset box (see
  // handleNavigateToConfig below) sets a brand new deep link and switches
  // persona in the same action, and since a persona switch always
  // remounts this component fresh (see the key above), that new deep
  // link is exactly what this next mount reads. A deep link landing the
  // operator persona always opens directly on Assets rather than the
  // usual Attention default.
  const deepLinkAppliesHere = initialDeepLink?.persona === operatorPersona;
  const [railMode, setRailMode] = useState(
    operatorPersona === 'configurator' ? 'now' : (deepLinkAppliesHere ? 'assets' : 'attention')
  ); // 'now' | 'attention' | 'work' | 'assets' — drives both the list and detail slots; default depends on which rail items this persona can see
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const [issueMapExpanded, setIssueMapExpanded] = useState(false);
  const [selectedDetailLine, setSelectedDetailLine] = useState(null);
  const nowSectionRef = useRef(null);
  const [nowSectionBottom, setNowSectionBottom] = useState(160);
  useEffect(() => {
    function measure() {
      if (nowSectionRef.current) {
        setNowSectionBottom(nowSectionRef.current.getBoundingClientRect().bottom);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const [selectedAttentionId, setSelectedAttentionId] = useState(
    (ATTENTION_ITEMS.find(i => i.attentionState === 'investigate') || ATTENTION_ITEMS[0])?.id ?? null
  );
  const [evidenceView, setEvidenceView] = useState('line');
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(INITIAL_WORK_ITEMS[0]?.id ?? null);
  const [selectedNowThing, setSelectedNowThing] = useState(() =>
    (deepLinkAppliesHere && operatorPersona === 'configurator')
      ? { kind: 'type', id: initialDeepLink.id }
      : loadNowSelection(CURRENT_MODEL)
  );
  // Separate selection state for the new Operator-only Assets area — a
  // real asset instance, not a type, so it can't share selectedNowThing
  // (which is Visualization's own type-based selection).
  const [selectedAssetId, setSelectedAssetId] = useState(
    (deepLinkAppliesHere && operatorPersona === 'operator') ? initialDeepLink.id : null
  );
  // Lifted up from OperatorAssetDetail (previously its own local state) so
  // it can participate in the deep-link URL alongside selectedAssetId.
  const [selectedAssetTab, setSelectedAssetTab] = useState(
    (deepLinkAppliesHere && operatorPersona === 'operator' && DEEP_LINK_TAB_NAMES.includes(initialDeepLink.tab))
      ? initialDeepLink.tab
      : 'properties'
  );
  useEffect(() => {
    onSaveAvailabilityChange?.(selectedNowThing?.kind === 'type' || selectedNowThing?.kind === 'asset');
  }, [selectedNowThing]);
  useEffect(() => {
    saveNowSelection(CURRENT_MODEL, selectedNowThing);
  }, [selectedNowThing]);
  // Same DevExtreme requirement as the properties-tab Splitter below — the
  // Types tab's DataListGrid needs an explicit updateDimensions() call
  // whenever this outer left/center/right Splitter is dragged, or its
  // columns can be left oversized (or undersized) relative to the new
  // panel width.
  const nowTreePanelRef = useRef(null);
  const outerSplitterResizeFrame = useRef(null);
  const handleOuterSplitterResize = () => {
    cancelAnimationFrame(outerSplitterResizeFrame.current);
    outerSplitterResizeFrame.current = requestAnimationFrame(() => {
      nowTreePanelRef.current?.updateDimensions?.();
    });
  };
  // Per-type property visibility overrides (always/sometimes/never), keyed
  // by type id then property key. Only holds an entry once a user actually
  // changes a property's visibility for that type — otherwise the default
  // ("always") is computed fresh each render, not stored. Persisted
  // immediately on every change (no separate Save step, since the
  // icon-cycling buttons that set these apply instantly).
  const [typePropertyConfigs, setTypePropertyConfigs] = useState(() => loadTypePropertyConfigs());
  useEffect(() => {
    saveTypePropertyConfigs(typePropertyConfigs);
  }, [typePropertyConfigs]);
  // Per-type related-asset visibility overrides (always/never) for the
  // Related Assets tab — same auto-save-on-change pattern as
  // typePropertyConfigs above.
  const [typeRelatedAssetConfigs, setTypeRelatedAssetConfigs] = useState(() => loadTypeRelatedAssetConfigs());
  useEffect(() => {
    saveTypeRelatedAssetConfigs(typeRelatedAssetConfigs);
  }, [typeRelatedAssetConfigs]);
  // Per-type display template (view mode, flow direction, wrap, align
  // content) — persisted to localStorage explicitly via a Save action, not
  // auto-saved on every click. Hydrated once on mount so it survives a
  // page refresh.
  const [typeDisplayTemplates, setTypeDisplayTemplates] = useState(() => loadTypeDisplayTemplates());
  const handleSaveTypeDisplayTemplate = (typeId, template) => {
    setTypeDisplayTemplates(prev => {
      const next = { ...prev, [typeId]: template };
      saveTypeDisplayTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Per-type Related Assets template (Cards/Diagram, Auto/Manual, all the
  // diagram settings, and manual positions if any) — same persistence
  // shape and Save-button wiring as typeDisplayTemplates above, just a
  // separate saved thing per the "two saved views per type" split.
  const [relatedAssetsTemplates, setRelatedAssetsTemplates] = useState(() => loadRelatedAssetsTemplates());
  const handleSaveRelatedAssetsTemplate = (typeId, template) => {
    setRelatedAssetsTemplates(prev => {
      const next = { ...prev, [typeId]: template };
      saveRelatedAssetsTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Per-asset overrides — the Now area's Assets tab equivalents of the four
  // per-type blocks above, keyed by real asset id instead of type id. A
  // specific asset only ever has an entry here once a user has actually
  // saved/changed something for that asset; RelatedAssetBoxContent (and the
  // Details-panel grids above) are what actually apply the asset-over-type
  // fallback at render time — these four are pure storage, identical
  // persistence shape to their type-level counterparts.
  const [assetPropertyConfigs, setAssetPropertyConfigs] = useState(() => loadAssetPropertyConfigs());
  useEffect(() => {
    saveAssetPropertyConfigs(assetPropertyConfigs);
  }, [assetPropertyConfigs]);
  const [assetRelatedAssetConfigs, setAssetRelatedAssetConfigs] = useState(() => loadAssetRelatedAssetConfigs());
  useEffect(() => {
    saveAssetRelatedAssetConfigs(assetRelatedAssetConfigs);
  }, [assetRelatedAssetConfigs]);
  const [assetDisplayTemplates, setAssetDisplayTemplates] = useState(() => loadAssetDisplayTemplates());
  const handleSaveAssetDisplayTemplate = (assetId, template) => {
    setAssetDisplayTemplates(prev => {
      // Saving an asset whose layout is identical to its type's and which
      // sets no per-property visuals of its own stores nothing (and clears
      // any older entry), rather than a copy of the type's layout. A copy
      // would look the same today but silently stop this asset from
      // following later changes to its type — the same reason Revert to
      // type removes the entry instead of overwriting it.
      const asset = CURRENT_ASSET_MAP[assetId];
      const typeTemplate = asset ? typeDisplayTemplates[assetTypeIdOf(asset)] : undefined;
      const matchesType = asset
        && Object.keys(template.propertyViewModes || {}).length === 0
        && normalizedLayout(template) === normalizedLayout(typeTemplate);
      const next = { ...prev };
      if (matchesType) delete next[assetId]; else next[assetId] = template;
      saveAssetDisplayTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Display orders (properties and related assets, per type and per
  // asset) — applied immediately and auto-saved, like visibility. See
  // "Display order" near the top of this file.
  const [typePropertyOrders, setTypePropertyOrders] = useState(() => loadTypePropertyOrders());
  useEffect(() => { saveTypePropertyOrders(typePropertyOrders); }, [typePropertyOrders]);
  const [assetPropertyOrders, setAssetPropertyOrders] = useState(() => loadAssetPropertyOrders());
  useEffect(() => { saveAssetPropertyOrders(assetPropertyOrders); }, [assetPropertyOrders]);
  const [typeRelatedAssetOrders, setTypeRelatedAssetOrders] = useState(() => loadTypeRelatedAssetOrders());
  useEffect(() => { saveTypeRelatedAssetOrders(typeRelatedAssetOrders); }, [typeRelatedAssetOrders]);
  const [assetRelatedAssetOrders, setAssetRelatedAssetOrders] = useState(() => loadAssetRelatedAssetOrders());
  useEffect(() => { saveAssetRelatedAssetOrders(assetRelatedAssetOrders); }, [assetRelatedAssetOrders]);
  // One setter for all four: kind 'property' | 'related', level 'type' |
  // 'asset'; a null order removes the entry (back to the type's order, or
  // for a type, the default order).
  const setDisplayOrder = (kind, level, id, order) => {
    const setter = kind === 'property'
      ? (level === 'asset' ? setAssetPropertyOrders : setTypePropertyOrders)
      : (level === 'asset' ? setAssetRelatedAssetOrders : setTypeRelatedAssetOrders);
    setter(prev => {
      const next = { ...prev };
      if (order && order.length) next[id] = order; else delete next[id];
      return next;
    });
  };
  const setDisplayOrderRef = useRef(setDisplayOrder);
  setDisplayOrderRef.current = setDisplayOrder;
  const stableSetDisplayOrder = useCallback((...args) => setDisplayOrderRef.current(...args), []);
  useEffect(() => {
    displayOrderStore.set({
      typeProperty: typePropertyOrders,
      assetProperty: assetPropertyOrders,
      typeRelated: typeRelatedAssetOrders,
      assetRelated: assetRelatedAssetOrders,
      setOrder: stableSetDisplayOrder,
    });
  }, [typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, stableSetDisplayOrder]);
  useEffect(() => () => displayOrderStore.set(EMPTY_DISPLAY_ORDERS), []);
  const [assetRelatedAssetsTemplates, setAssetRelatedAssetsTemplates] = useState(() => loadAssetRelatedAssetsTemplates());
  const handleSaveAssetRelatedAssetsTemplate = (assetId, template) => {
    setAssetRelatedAssetsTemplates(prev => {
      const next = { ...prev, [assetId]: template };
      saveAssetRelatedAssetsTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // The single global All Assets template — not keyed by type, since this
  // is one shared view regardless of which type is selected. Hydrated from
  // storage on mount, same as the two per-type templates above, including
  // the hiddenAssetIds state that already existed — it just wasn't
  // persisted before now.
  const [allAssetsTemplate, setAllAssetsTemplate] = useState(() => loadAllAssetsTemplate());
  const handleSaveAllAssetsTemplate = (template) => {
    setAllAssetsTemplate(template);
    saveAllAssetsTemplate(template);
    notify('Template saved', 'success', 2000);
  };
  const nowTypeList = useMemo(() => buildTypeList(CURRENT_ASSET_DATA), []);

  const [rightPanelMode, setRightPanelMode] = useState('chat'); // 'chat' | 'ai' | 'details' — drives the right rail + right panel
  const [rightPanelHidden, setRightPanelHidden] = useState(true);
  const [contacts, setContacts] = useState(CONTACTS_SEED);
  const [activeContactId, setActiveContactId] = useState(null);
  // Which Details-panel tab (Properties/Related Assets/All Assets) is
  // active — lives up here (rather than inside NowTypeDetailsList itself,
  // which remounts fresh via key={typeId} on every type switch) so
  // switching types doesn't silently reset back to the first tab.
  const [activeTabIndex, setActiveTabIndex] = useState(
    (deepLinkAppliesHere && operatorPersona === 'configurator' && DEEP_LINK_TAB_NAMES.includes(initialDeepLink.tab))
      ? DEEP_LINK_TAB_NAMES.indexOf(initialDeepLink.tab)
      : 0
  );
  // Which Now-area left-panel tab (Types/Assets) is active — same lifted-
  // state reasoning as activeTabIndex above, just for the sibling tab
  // switcher one panel over.
  const [nowLeftTabIndex, setNowLeftTabIndex] = useState(() => (selectedNowThing?.kind === 'asset' ? 1 : 0));
  // Keeps the URL in sync with whatever's currently selected, so the
  // address bar always reflects a link back to the current view. Only
  // fires while the user is actually in a deep-linkable area — a type
  // selected in Visualization, or an asset selected in the new Assets
  // area — since Attention/Work have no deep-link scheme of their own
  // and simply leave the URL as it was.
  useEffect(() => {
    if (!onNavigate) return;
    if (operatorPersona === 'configurator' && selectedNowThing?.kind === 'type') {
      onNavigate({ id: selectedNowThing.id, tab: DEEP_LINK_TAB_NAMES[activeTabIndex] });
    } else if (operatorPersona === 'operator' && railMode === 'assets' && selectedAssetId) {
      onNavigate({ id: selectedAssetId, tab: selectedAssetTab });
    }
  }, [operatorPersona, selectedNowThing, activeTabIndex, railMode, selectedAssetId, selectedAssetTab, onNavigate]);
  // Click-to-navigate for a box's name, wherever RelatedAssetBoxContent's
  // title renders (Properties/Related Assets/All Assets, both Cards and
  // Diagram) — always jumps to that thing's own Properties view. Every
  // box already carries relatedTypeId (the type) and
  // The left tree's own selection callback — clamps activeTabIndex back to
  // a valid tab whenever the newly-selected thing is an asset and the
  // Details panel was sitting on tab 2 (All Assets), which only ever
  // exists for a type (a shared, model-wide view with no per-asset
  // variant) — without this, selecting an asset while on that tab would
  // leave the tab switcher pointed at an index NowTypeDetailsList no
  // longer renders for assets at all.
  const handleSelectNowThing = async (thing) => {
    if (thing?.kind !== selectedNowThing?.kind || thing?.id !== selectedNowThing?.id) {
      await resolveUnsavedChanges();
    }
    setSelectedNowThing(thing);
    setNowLeftTabIndex(thing?.kind === 'asset' ? 1 : 0);
    if (thing?.kind === 'asset' && activeTabIndex === 2) {
      setActiveTabIndex(0);
    }
  };

  // relatedTypeExampleAssetId (the concrete asset whose real values the
  // box is showing), so Visualization navigates by type — its whole
  // mental model is type-level — while the Assets area navigates by that
  // concrete asset id, matching what's actually on screen in the box
  // rather than introducing a second, different notion of "the asset
  // this box represents."
  const handleNavigateToType = async ({ relatedTypeId }) => {
    if (selectedNowThing?.kind !== 'type' || selectedNowThing?.id !== relatedTypeId) {
      await resolveUnsavedChanges();
    }
    setSelectedNowThing({ kind: 'type', id: relatedTypeId });
    setNowLeftTabIndex(0);
    setActiveTabIndex(0);
  };
  const handleNavigateToAsset = ({ relatedTypeExampleAssetId }) => {
    setSelectedAssetId(relatedTypeExampleAssetId);
    setSelectedAssetTab('properties');
  };
  // The gear icon on an Operator asset box — unlike the two handlers
  // above, this one crosses personas entirely (Operator's Assets area to
  // Visualization's own Properties tab for that asset's type), which
  // needs App.js's own persona state, not anything owned here. Reuses the
  // exact same deep-link-on-fresh-mount mechanism the URL scheme already
  // relies on: onNavigateToConfig sets a new deep link and switches
  // persona together, and the fresh OperatorWorkspaceInner mount that
  // persona switch triggers reads that deep link as its own initial
  // state, landing exactly on the requested type's Properties tab.
  const handleNavigateToConfig = ({ relatedTypeId }) => {
    onNavigateToConfig?.({ id: relatedTypeId, tab: 'properties' });
  };
  // Mirrors HmiPropertiesListing's current view mode, purely for display in
  // the Properties list's "Visual" column in the Details panel — the
  // actual view-mode control lives in the center preview (a sibling, not
  // a parent/child of the list now that the two are split across panels),
  // reported up via onViewModeChange whenever it changes.
  const [rightPanelViewMode, setRightPanelViewMode] = useState('all');
  // Per-property visual overrides (unsaved draft) and the currently
  // selected property — both shared between the center preview (tiles)
  // and the Details panel (Visual column / row selection), which are
  // siblings, same reasoning as rightPanelViewMode above. The draft is
  // tagged with the entity it belongs to, so neither side ever reads a
  // map left over from a previous selection; the preview re-seeds it from
  // the saved template whenever a new type/asset is selected, and the
  // title-bar Save persists it as part of that display template.
  const [propertyVisualDraft, setPropertyVisualDraft] = useState({ entityId: null, modes: {} });
  const [selectedPropertyKey, setSelectedPropertyKey] = useState(null);
  // Same idea for the Related Assets tab: the Details panel's selected row
  // (a related-asset row key) and the box it highlights in the preview.
  const [selectedRelatedKey, setSelectedRelatedKey] = useState(null);
  const propertyVisuals = {
    entityId: propertyVisualDraft.entityId,
    modes: propertyVisualDraft.modes,
    setModes: (entityId, modes) => setPropertyVisualDraft({ entityId, modes }),
    selectedKey: selectedPropertyKey,
    setSelectedKey: setSelectedPropertyKey,
    selectedRelatedKey,
    setSelectedRelatedKey,
  };
  // A selected property/related row belongs to the selected type/asset —
  // drop it when that changes rather than highlighting a same-keyed row
  // elsewhere.
  useEffect(() => {
    setSelectedPropertyKey(null);
    setSelectedRelatedKey(null);
  }, [selectedNowThing?.kind, selectedNowThing?.id]);
  // All Assets' per-asset show/hide choice — shared between the visibility
  // tree (Details panel) and the diagram (center preview), same reasoning
  // as rightPanelViewMode above. Hydrated from the saved All Assets
  // template if one exists (stored as a plain array there, since Sets
  // aren't JSON-serializable); every asset visible by default otherwise.
  const [hiddenAssetIds, setHiddenAssetIds] = useState(() => new Set(allAssetsTemplate?.hiddenAssetIds ?? []));
  const handleToggleAssetVisibility = (assetId) => {
    setHiddenAssetIds(current => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });
  };

  // ─── Unsaved changes ─────────────────────────────────────────────────
  // Anything that unmounts the open editor (selecting another type or
  // asset, switching Details tabs, and — via unsavedGuardRef — App.js
  // switching model, persona or app area) first asks whether to keep its
  // unsaved changes. Save or Discard only, no Cancel: every one of those
  // triggers has already updated its own widget's selection by the time
  // this runs (the tree, the grid, the tab strip), and walking each of
  // them back would be fragile. Dismissing the dialog (Esc) keeps the
  // work — it saves — since losing edits is the worse surprise.
  const describeOpenEditor = () => {
    if (activeTabIndex === 2) return 'the All Assets view';
    const tab = activeTabIndex === 1 ? 'Related Assets' : 'display';
    if (selectedNowThing?.kind === 'asset') return `${getAssetPathLabel(selectedNowThing.id)} (${tab})`;
    const typeName = nowTypeList.find(t => t.id === selectedNowThing?.id)?.name ?? 'this type';
    return `the ${typeName} type (${tab})`;
  };
  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Drafts that live up here rather than inside the editor survive its
  // unmount, so Discard has to reset them explicitly — otherwise
  // reopening the same tab would show the discarded draft as if saved.
  const discardLiftedDrafts = () => {
    setPropertyVisualDraft({ entityId: null, modes: {} });
    setHiddenAssetIds(new Set(allAssetsTemplate?.hiddenAssetIds ?? []));
  };
  // One prompt at a time: a single click can fire more than one of the
  // guarded handlers (DataListGrid reports a row click through both its
  // selection-changed and row-click events), and each must wait on the
  // same answer rather than stacking a second dialog.
  const pendingUnsavedPromptRef = useRef(null);
  const resolveUnsavedChanges = () => {
    if (pendingUnsavedPromptRef.current) return pendingUnsavedPromptRef.current;
    if (operatorPersona !== 'configurator' || !unsavedChangesStore.isDirty()) return Promise.resolve();
    // Wrapped in a native Promise: DevExtreme's dialog returns its own
    // Deferred, which has then() but no finally().
    pendingUnsavedPromptRef.current = Promise.resolve(customDialog({
      title: 'Unsaved changes',
      messageHtml: `<div style="max-width:360px">You have unsaved changes to ${escapeHtml(describeOpenEditor())}.</div>`,
      buttons: [
        { text: 'Save', type: 'default', stylingMode: 'contained', onClick: () => 'save' },
        { text: 'Discard', stylingMode: 'outlined', onClick: () => 'discard' },
      ],
    }).show()).then(result => {
      if (result === 'discard') discardLiftedDrafts();
      else activeSaveHandlerRef.current?.();
      unsavedChangesStore.setDirty(false);
    }).finally(() => { pendingUnsavedPromptRef.current = null; });
    return pendingUnsavedPromptRef.current;
  };
  if (unsavedGuardRef) unsavedGuardRef.current = resolveUnsavedChanges;

  const handleActiveTabIndexChange = async (index) => {
    if (index === activeTabIndex) return;
    await resolveUnsavedChanges();
    setActiveTabIndex(index);
  };

  // Browser refresh/close — the only exit the in-app prompt can't catch.
  useEffect(() => {
    const handler = e => {
      if (operatorPersona === 'configurator' && unsavedChangesStore.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [operatorPersona]);

  // ─── Undo for reverts ────────────────────────────────────────────────
  // Reverts apply immediately (no confirm dialog); instead, a toast offers
  // Undo for a few seconds. Each revert snapshots exactly the entries it
  // touches, and undo puts those entries back as they were — whole
  // per-asset entries, so an edit made to one of the same assets inside
  // that short window would be rolled back with it.
  const [undoToast, setUndoToast] = useState(null); // { id, message, undo }
  useEffect(() => {
    if (!undoToast) return undefined;
    const timer = setTimeout(() => setUndoToast(t => (t?.id === undoToast.id ? null : t)), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [undoToast]);
  const pickEntries = (map, ids) => {
    const snapshot = {};
    ids.forEach(id => { if (map?.[id] !== undefined) snapshot[id] = map[id]; });
    return snapshot;
  };
  const restoreEntries = (prev, ids, snapshot) => {
    const next = { ...prev };
    ids.forEach(id => { if (id in snapshot) next[id] = snapshot[id]; else delete next[id]; });
    return next;
  };

  // Which assets differ from their type (tree dots, Types-list counts,
  // title-row chips, per-property counts) — recomputed whenever any of the
  // eight stores changes, and published to assetCustomizationStore along
  // with the actions below. See computeAssetCustomizations.
  const assetCustomizations = useMemo(() => computeAssetCustomizations({
    typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates,
    assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates,
    typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, typeList: nowTypeList,
  }), [typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, nowTypeList]);

  // Bumped whenever the selected asset's saved settings are reverted out
  // from under its open preview. The preview's editors (view mode, flow,
  // manual positions, Related Assets settings) only read their saved
  // template once, on mount, so this is part of NowTypeMainPreview's key
  // to remount it onto the type's settings — otherwise it would keep
  // showing, and a later Save would re-save, what was just reverted.
  const [nowPreviewRevision, setNowPreviewRevision] = useState(0);

  const omitKeys = (obj, ids) => {
    const next = { ...obj };
    ids.forEach(id => { delete next[id]; });
    return next;
  };

  // Whole-asset revert: drops every asset-level entry (display template,
  // property visibilities, related-asset visibilities, related-assets
  // template), so each asset follows its type completely again — including
  // any future type changes. Immediate and persisted, like the visibility
  // toggles, not staged for the title-bar Save (a revert that waited for
  // Save would be easy to lose); the Undo toast is the safety net.
  const revertAssetsToType = (assetIds) => {
    if (!assetIds.length) return;
    const snapshot = {
      display: pickEntries(assetDisplayTemplates, assetIds),
      relatedTemplates: pickEntries(assetRelatedAssetsTemplates, assetIds),
      propertyConfigs: pickEntries(assetPropertyConfigs, assetIds),
      relatedConfigs: pickEntries(assetRelatedAssetConfigs, assetIds),
      propertyOrders: pickEntries(assetPropertyOrders, assetIds),
      relatedOrders: pickEntries(assetRelatedAssetOrders, assetIds),
    };
    const selectedAffected = selectedNowThing?.kind === 'asset' && assetIds.includes(selectedNowThing.id) ? selectedNowThing.id : null;
    setAssetPropertyOrders(prev => omitKeys(prev, assetIds));
    setAssetRelatedAssetOrders(prev => omitKeys(prev, assetIds));
    setAssetDisplayTemplates(prev => { const next = omitKeys(prev, assetIds); saveAssetDisplayTemplates(next); return next; });
    setAssetRelatedAssetsTemplates(prev => { const next = omitKeys(prev, assetIds); saveAssetRelatedAssetsTemplates(next); return next; });
    setAssetPropertyConfigs(prev => omitKeys(prev, assetIds));
    setAssetRelatedAssetConfigs(prev => omitKeys(prev, assetIds));
    if (selectedAffected) {
      setPropertyVisualDraft({ entityId: selectedAffected, modes: {} });
      setNowPreviewRevision(r => r + 1);
    }
    setUndoToast({
      id: Date.now(),
      message: `${assetIds.length} asset${assetIds.length > 1 ? 's' : ''} now match${assetIds.length > 1 ? '' : 'es'} the type`,
      undo: () => {
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetRelatedAssetsTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.relatedTemplates); saveAssetRelatedAssetsTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, assetIds, snapshot.propertyConfigs));
        setAssetRelatedAssetConfigs(prev => restoreEntries(prev, assetIds, snapshot.relatedConfigs));
        setAssetPropertyOrders(prev => restoreEntries(prev, assetIds, snapshot.propertyOrders));
        setAssetRelatedAssetOrders(prev => restoreEntries(prev, assetIds, snapshot.relatedOrders));
        if (selectedAffected) {
          setPropertyVisualDraft({ entityId: selectedAffected, modes: snapshot.display[selectedAffected]?.propertyViewModes ?? {} });
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
  };

  // One property, many assets: drops just that property's visibility and
  // visual from each asset, leaving everything else each asset customized
  // alone. The selected asset's unsaved draft loses the key too, so the
  // Visual column and preview reflect it immediately without a remount.
  const revertPropertyToType = (assetIds, propertyKey) => {
    if (!assetIds.length) return;
    const snapshot = {
      display: pickEntries(assetDisplayTemplates, assetIds),
      propertyConfigs: pickEntries(assetPropertyConfigs, assetIds),
    };
    const selectedAffected = selectedNowThing?.kind === 'asset' && assetIds.includes(selectedNowThing.id) ? selectedNowThing.id : null;
    setAssetPropertyConfigs(prev => {
      const next = { ...prev };
      assetIds.forEach(id => {
        if (!next[id] || !(propertyKey in next[id])) return;
        const { [propertyKey]: _removed, ...rest } = next[id];
        if (Object.keys(rest).length) next[id] = rest; else delete next[id];
      });
      return next;
    });
    setAssetDisplayTemplates(prev => {
      const next = { ...prev };
      assetIds.forEach(id => {
        const modes = next[id]?.propertyViewModes;
        if (!modes || !(propertyKey in modes)) return;
        const { [propertyKey]: _removed, ...rest } = modes;
        next[id] = { ...next[id], propertyViewModes: rest };
      });
      saveAssetDisplayTemplates(next);
      return next;
    });
    if (selectedAffected) {
      setPropertyVisualDraft(prev => {
        if (prev.entityId !== selectedAffected || !(propertyKey in prev.modes)) return prev;
        const { [propertyKey]: _removed, ...rest } = prev.modes;
        return { entityId: prev.entityId, modes: rest };
      });
    }
    setUndoToast({
      id: Date.now(),
      message: `${PROPERTY_LABELS[propertyKey] || propertyKey} now matches the type on ${assetIds.length} asset${assetIds.length > 1 ? 's' : ''}`,
      undo: () => {
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, assetIds, snapshot.propertyConfigs));
        // Only the reverted property goes back into the open asset's
        // draft — any other unsaved visual edits there are left alone.
        const restoredMode = selectedAffected ? snapshot.display[selectedAffected]?.propertyViewModes?.[propertyKey] : undefined;
        if (restoredMode) {
          setPropertyVisualDraft(prev => (prev.entityId === selectedAffected
            ? { entityId: prev.entityId, modes: { ...prev.modes, [propertyKey]: restoredMode } }
            : prev));
        }
      },
    });
  };

  // "Apply to type" — the opposite of revert: this asset's own settings
  // become its type's, and the asset itself then just follows the type
  // (its entries are cleared, exactly as a revert would). Every asset of
  // the type that follows it picks the change up; assets with their own
  // settings for the same things keep them. Merges the same way the
  // runtime resolves them:
  //   - display template: if the asset has one, its layout (view mode,
  //     flow, manual positions) replaces the type's — layout is all-or-
  //     nothing everywhere else too — and its per-property visuals merge
  //     over the type's, property by property;
  //   - property / related-asset visibility: merged over the type's;
  //   - Related Assets template: the asset's replaces the type's.
  // Undoable like a revert (one snapshot of the type's and the asset's
  // entries). The open asset's unsaved changes are resolved first
  // (Save/Discard), so what gets applied is what's actually saved — the
  // apply itself runs on the next render via pendingApplyAssetId, once a
  // Save's state updates have landed, rather than from this closure's
  // now-stale copy of the stores.
  const [pendingApplyAssetId, setPendingApplyAssetId] = useState(null);
  const applyAssetToType = async (assetId) => {
    if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
      await resolveUnsavedChanges();
    }
    setPendingApplyAssetId(assetId);
  };
  useEffect(() => {
    if (!pendingApplyAssetId) return;
    const assetId = pendingApplyAssetId;
    setPendingApplyAssetId(null);
    const asset = CURRENT_ASSET_MAP[assetId];
    if (!asset) return;
    const typeId = assetTypeIdOf(asset);
    const ids = [assetId];

    const snapshot = {
      typeDisplay: typeDisplayTemplates[typeId],
      typeProps: typePropertyConfigs[typeId],
      typeRelated: typeRelatedAssetConfigs[typeId],
      typeRelatedTemplate: relatedAssetsTemplates[typeId],
      display: pickEntries(assetDisplayTemplates, ids),
      relatedTemplates: pickEntries(assetRelatedAssetsTemplates, ids),
      propertyConfigs: pickEntries(assetPropertyConfigs, ids),
      relatedConfigs: pickEntries(assetRelatedAssetConfigs, ids),
      typePropertyOrder: typePropertyOrders[typeId],
      typeRelatedOrder: typeRelatedAssetOrders[typeId],
      propertyOrders: pickEntries(assetPropertyOrders, ids),
      relatedOrders: pickEntries(assetRelatedAssetOrders, ids),
    };
    const assetTemplate = assetDisplayTemplates[assetId];
    const assetProps = assetPropertyConfigs[assetId];
    const assetRelated = assetRelatedAssetConfigs[assetId];
    const assetRelatedTemplate = assetRelatedAssetsTemplates[assetId];

    // Sets or removes one type-level entry, keeping "no entry" as no
    // entry rather than writing an empty object/undefined.
    const putEntry = (prev, key, value) => {
      const next = { ...prev };
      if (value === undefined) delete next[key]; else next[key] = value;
      return next;
    };

    if (assetTemplate) {
      const typeTemplate = typeDisplayTemplates[typeId] || {};
      const merged = {
        ...typeTemplate,
        viewMode: assetTemplate.viewMode,
        flowDirection: assetTemplate.flowDirection,
        flowWrap: assetTemplate.flowWrap,
        alignContent: assetTemplate.alignContent,
        layoutMode: assetTemplate.layoutMode,
        manualPositions: assetTemplate.manualPositions ?? {},
        propertyViewModes: { ...(typeTemplate.propertyViewModes || {}), ...(assetTemplate.propertyViewModes || {}) },
      };
      setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, merged); saveTypeDisplayTemplates(next); return next; });
    }
    if (assetProps && Object.keys(assetProps).length) {
      setTypePropertyConfigs(prev => putEntry(prev, typeId, { ...(prev[typeId] || {}), ...assetProps }));
    }
    if (assetRelated && Object.keys(assetRelated).length) {
      setTypeRelatedAssetConfigs(prev => putEntry(prev, typeId, { ...(prev[typeId] || {}), ...assetRelated }));
    }
    if (assetRelatedTemplate) {
      setRelatedAssetsTemplates(prev => { const next = putEntry(prev, typeId, assetRelatedTemplate); saveRelatedAssetsTemplates(next); return next; });
    }
    // Orders: the asset's own order (a whole list) becomes the type's.
    if (assetPropertyOrders[assetId]) setTypePropertyOrders(prev => putEntry(prev, typeId, assetPropertyOrders[assetId]));
    if (assetRelatedAssetOrders[assetId]) setTypeRelatedAssetOrders(prev => putEntry(prev, typeId, assetRelatedAssetOrders[assetId]));
    setAssetPropertyOrders(prev => omitKeys(prev, ids));
    setAssetRelatedAssetOrders(prev => omitKeys(prev, ids));
    // The asset now matches its type exactly — clear its own entries so it
    // keeps following the type from here on.
    setAssetDisplayTemplates(prev => { const next = omitKeys(prev, ids); saveAssetDisplayTemplates(next); return next; });
    setAssetRelatedAssetsTemplates(prev => { const next = omitKeys(prev, ids); saveAssetRelatedAssetsTemplates(next); return next; });
    setAssetPropertyConfigs(prev => omitKeys(prev, ids));
    setAssetRelatedAssetConfigs(prev => omitKeys(prev, ids));
    const isOpen = selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId;
    if (isOpen) {
      setPropertyVisualDraft({ entityId: assetId, modes: {} });
      setNowPreviewRevision(r => r + 1);
    }

    const typeName = nowTypeList.find(t => t.id === typeId)?.name ?? deslugifyType(asset.assetType);
    setUndoToast({
      id: Date.now(),
      message: `Updated the ${typeName} type from this asset`,
      undo: () => {
        setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeDisplay); saveTypeDisplayTemplates(next); return next; });
        setTypePropertyConfigs(prev => putEntry(prev, typeId, snapshot.typeProps));
        setTypeRelatedAssetConfigs(prev => putEntry(prev, typeId, snapshot.typeRelated));
        setRelatedAssetsTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeRelatedTemplate); saveRelatedAssetsTemplates(next); return next; });
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetRelatedAssetsTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.relatedTemplates); saveAssetRelatedAssetsTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, ids, snapshot.propertyConfigs));
        setAssetRelatedAssetConfigs(prev => restoreEntries(prev, ids, snapshot.relatedConfigs));
        setTypePropertyOrders(prev => putEntry(prev, typeId, snapshot.typePropertyOrder));
        setTypeRelatedAssetOrders(prev => putEntry(prev, typeId, snapshot.typeRelatedOrder));
        setAssetPropertyOrders(prev => restoreEntries(prev, ids, snapshot.propertyOrders));
        setAssetRelatedAssetOrders(prev => restoreEntries(prev, ids, snapshot.relatedOrders));
        if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
          setPropertyVisualDraft({ entityId: assetId, modes: snapshot.display[assetId]?.propertyViewModes ?? {} });
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApplyAssetId]);

  // Per-property "↑ Update type" from an asset's Visual dropdown — the
  // one-property version of applyAssetToType: the type's visual for that
  // property becomes this asset's, and the asset's own entry for it is
  // dropped (saved template and unsaved draft both), so the asset now
  // just follows the type for it. Immediate, with Undo.
  //
  // Same two-step as applyAssetToType: resolve unsaved changes first, then
  // act on the next render. Here that also matters for a second reason —
  // the open editor treats what it loaded as "saved", so this changes the
  // saved template underneath it; it's remounted (nowPreviewRevision)
  // afterwards to re-read it, which is only safe once nothing is unsaved.
  const [pendingPropertyApply, setPendingPropertyApply] = useState(null); // { assetId, key, mode }
  const applyPropertyToType = async (assetId, key, mode) => {
    if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
      await resolveUnsavedChanges();
    }
    setPendingPropertyApply({ assetId, key, mode });
  };
  useEffect(() => {
    if (!pendingPropertyApply) return;
    const { assetId, key, mode } = pendingPropertyApply;
    setPendingPropertyApply(null);
    const asset = CURRENT_ASSET_MAP[assetId];
    if (!asset || !mode || mode === PROPERTY_VIEW_MODE_DEFAULT) return;
    const typeId = assetTypeIdOf(asset);
    const ids = [assetId];
    const snapshot = {
      typeDisplay: typeDisplayTemplates[typeId],
      display: pickEntries(assetDisplayTemplates, ids),
    };
    const putEntry = (prev, k, value) => {
      const next = { ...prev };
      if (value === undefined) delete next[k]; else next[k] = value;
      return next;
    };
    // A type with no template yet gets one holding the renderers' own
    // defaults (normalizedLayout), so nothing else about it changes.
    setTypeDisplayTemplates(prev => {
      const base = prev[typeId] || { viewMode: 'text', flowDirection: 'row', flowWrap: 'wrap', alignContent: 'flex-start', layoutMode: 'auto', manualPositions: {} };
      const next = putEntry(prev, typeId, { ...base, propertyViewModes: { ...(base.propertyViewModes || {}), [key]: mode } });
      saveTypeDisplayTemplates(next);
      return next;
    });
    const dropKey = template => {
      if (!template?.propertyViewModes || !(key in template.propertyViewModes)) return template;
      const { [key]: _removed, ...rest } = template.propertyViewModes;
      return { ...template, propertyViewModes: rest };
    };
    setAssetDisplayTemplates(prev => {
      if (!prev[assetId]) return prev;
      const next = { ...prev, [assetId]: dropKey(prev[assetId]) };
      saveAssetDisplayTemplates(next);
      return next;
    });
    const isOpen = selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId;
    if (isOpen) {
      setPropertyVisualDraft(prev => (prev.entityId === assetId ? { entityId: assetId, modes: dropKey({ propertyViewModes: prev.modes }).propertyViewModes } : prev));
      setNowPreviewRevision(r => r + 1);
    }

    const typeName = nowTypeList.find(t => t.id === typeId)?.name ?? deslugifyType(asset.assetType);
    const propertyLabel = PROPERTY_LABELS[key] || key;
    const modeLabel = KPI_VIEW_MODE_ITEMS.find(i => i.value === mode)?.text ?? mode;
    setUndoToast({
      id: Date.now(),
      message: `Updated the ${typeName} type: ${propertyLabel} → ${modeLabel}`,
      undo: () => {
        setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeDisplay); saveTypeDisplayTemplates(next); return next; });
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
          // The asset's own visual for this property comes back into the
          // draft too (it was its own choice before), leaving any other
          // draft entries alone.
          setPropertyVisualDraft(prev => (prev.entityId === assetId
            ? { entityId: assetId, modes: { ...prev.modes, [key]: mode } }
            : prev));
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPropertyApply]);

  // Published only when the customizations themselves change, so the
  // (many) subscribed tree rows don't re-render on every unrelated render
  // of this component. The actions object is stable for the same reason;
  // each action forwards through a ref to this render's closure, so
  // callers always get the latest state.
  const customizationActionsRef = useRef({});
  customizationActionsRef.current = {
    revertAssetsToType,
    revertPropertyToType,
    applyAssetToType,
    applyPropertyToType,
    openAsset: (assetId) => handleSelectNowThing({ kind: 'asset', id: assetId }),
  };
  const customizationActions = useMemo(() => ({
    revertAssetsToType: (...args) => customizationActionsRef.current.revertAssetsToType(...args),
    revertPropertyToType: (...args) => customizationActionsRef.current.revertPropertyToType(...args),
    applyAssetToType: (...args) => customizationActionsRef.current.applyAssetToType(...args),
    applyPropertyToType: (...args) => customizationActionsRef.current.applyPropertyToType(...args),
    openAsset: (...args) => customizationActionsRef.current.openAsset(...args),
  }), []);
  useEffect(() => {
    assetCustomizationStore.set({ ...assetCustomizations, actions: customizationActions });
  }, [assetCustomizations, customizationActions]);
  useEffect(() => () => assetCustomizationStore.set(EMPTY_CUSTOMIZATIONS), []);

  const selectedItem = ATTENTION_ITEMS.find(i => i.id === selectedAttentionId) || null;
  const selectedWorkItem = workItems.find(w => w.id === selectedWorkItemId) || null;
  const hasUnreadContacts = contacts.some(c => c.unread);

  // Clicking the icon for the mode that's already showing hides that panel;
  // clicking it again (or clicking a different icon) brings it back.
  const handleLeftIconClick = (id) => {
    if (railMode === id && !leftPanelHidden) {
      setLeftPanelHidden(true);
    } else {
      setRailMode(id);
      setLeftPanelHidden(false);
    }
  };

  const handleRightIconClick = (id) => {
    if (rightPanelMode === id && !rightPanelHidden) {
      setRightPanelHidden(true);
    } else {
      setRightPanelMode(id);
      setRightPanelHidden(false);
    }
  };

  const selectContact = (id) => {
    setActiveContactId(id);
    setContacts(prev => prev.map(c => (c.id === id ? { ...c, unread: false } : c)));
  };

  const sendContactMessage = (contactId, text) => {
    setContacts(prev => prev.map(c => (
      c.id === contactId
        ? { ...c, thread: [...c.thread, { from: 'me', text, time: 'Now' }] }
        : c
    )));
  };

  const newAttentionItems = useMemo(
    () => ATTENTION_ITEMS
      .filter(i => i.sinceMinutes <= NEW_ATTENTION_THRESHOLD_MINUTES)
      .sort((a, b) => a.sinceMinutes - b.sinceMinutes),
    []
  );
  const newWorkItems = useMemo(
    () => workItems.filter(w => w.source === 'ai' && !w.done),
    [workItems]
  );

  const handleCreateWorkItem = (attentionItem) => {
    setWorkItems(prev => [
      {
        id: `wk-${Date.now()}`,
        text: attentionItem.detail.recommendation,
        description: `Created from Attention: ${attentionItem.signal} (${attentionItem.asset})`,
        assetId: attentionItem.assetId ?? null,
        assetLabel: attentionItem.asset,
        workType: 'INVESTIGATION',
        priority: attentionItem.severity === 'high' ? 'urgent' : attentionItem.severity === 'medium' ? 'important' : 'routine',
        sourceType: 'situation',
        sourceLabel: `From: ${attentionItem.signal}`,
        source: 'ai',
        assignedRole: 'Operator',
        plannedStart: null,
        dueAt: null,
        estimatedDurationMinutes: null,
        done: false,
        completedAt: null,
        createdAt: new Date(),
      },
      ...prev,
    ]);
  };

  const handleToggleWorkItem = (id) => {
    setWorkItems(prev => prev.map(w => (w.id === id ? { ...w, done: !w.done, completedAt: !w.done ? new Date() : null } : w)));
  };

  const handleAddWorkItem = (text) => {
    const id = `wk-${Date.now()}`;
    setWorkItems(prev => [{
      id, text, description: '', assetLabel: null, workType: 'GENERAL', priority: 'routine',
      sourceType: 'planned', sourceLabel: null, source: 'operator', assignedRole: 'Operator',
      plannedStart: null, dueAt: null, estimatedDurationMinutes: null,
      done: false, completedAt: null, createdAt: new Date(),
    }, ...prev]);
    setSelectedWorkItemId(id);
  };

  // Fixed for this mount's lifetime — a model switch remounts this component.
  // The Issue Map / Line Detail overlay only knows the refinery's layout
  // (spec §10), so every other model hides it and opens a clicked Now-strip
  // tile in the Assets area instead.
  const usesAssetTiles = CURRENT_MODEL_SHAPE !== MODEL_SHAPES.REFINERY;

  const handleSelectIssueFromMap = (attentionId) => {
    setRailMode('attention');
    setSelectedAttentionId(attentionId);
  };

  // Set to true to bring back the "Operator Interface" title banner —
  // hidden for now per request, left in place rather than deleted.
  const SHOW_WORKSPACE_BANNER = false;

  return (
    <div className="op-workspace">
      {SHOW_WORKSPACE_BANNER && (
        <div className="op-workspace-banner">
          <span className="op-workspace-title">Operator Interface</span>
          <span className="op-workspace-badge">Concept shell · mock data</span>
        </div>
      )}

      {operatorPersona !== 'configurator' && (
        <div className="op-now-section" ref={nowSectionRef}>
          <NowStrip
            selectedLine={usesAssetTiles ? (railMode === 'assets' ? selectedAssetId : null) : selectedDetailLine}
            onSelectLine={(lineId) => {
              if (usesAssetTiles) {
                // Open the unit in the Assets area — the one view that
                // works for any asset at any level.
                setRailMode('assets');
                setLeftPanelHidden(false);
                setSelectedAssetId(lineId);
                return;
              }
              if (selectedDetailLine === lineId) {
                setSelectedDetailLine(null);
              } else {
                setSelectedDetailLine(lineId);
                setIssueMapExpanded(true);
              }
            }}
          />
          {!usesAssetTiles && <IssueMapOverlay
            expanded={issueMapExpanded}
            onToggle={() => setIssueMapExpanded(e => !e)}
            onSelectIssue={handleSelectIssueFromMap}
            selectedDetailLine={selectedDetailLine}
            onCloseDetailLine={() => setSelectedDetailLine(null)}
            topOffset={nowSectionBottom}
          />}
        </div>
      )}

      <div className="op-main-row">
        <NavRail
          mode={railMode}
          hidden={leftPanelHidden}
          onIconClick={handleLeftIconClick}
          attentionCount={newAttentionItems.length}
          workCount={newWorkItems.length}
          operatorPersona={operatorPersona}
        />

        <Splitter orientation="horizontal" style={{ flex: 1, minHeight: 0 }} onResize={handleOuterSplitterResize}>
          {!leftPanelHidden && (
            <SplitterItem size="320px" minSize="240px" resizable={true}>
              {railMode === 'now' ? (
                <NowAssetTreePanel ref={nowTreePanelRef} selectedThing={selectedNowThing} onSelectThing={handleSelectNowThing} typeList={nowTypeList} tabIndex={nowLeftTabIndex} onTabIndexChange={setNowLeftTabIndex} />
              ) : railMode === 'attention' ? (
                <AttentionPanel selectedId={selectedAttentionId} onSelect={setSelectedAttentionId} />
              ) : railMode === 'assets' ? (
                <OperatorAssetTreePanel selectedAssetId={selectedAssetId} onSelectAsset={setSelectedAssetId} />
              ) : (
                <WorkListPanel
                  items={workItems}
                  selectedId={selectedWorkItemId}
                  onSelect={setSelectedWorkItemId}
                  onToggleDone={handleToggleWorkItem}
                  onAdd={handleAddWorkItem}
                />
              )}
            </SplitterItem>
          )}
          <SplitterItem resizable={true}>
            {railMode === 'now' ? (
              <NowAssetDetail
                selectedThing={selectedNowThing}
                typeList={nowTypeList}
                typePropertyConfigs={typePropertyConfigs}
                setTypePropertyConfigs={setTypePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                typeDisplayTemplates={typeDisplayTemplates}
                onSaveTypeDisplayTemplate={handleSaveTypeDisplayTemplate}
                assetPropertyConfigs={assetPropertyConfigs}
                setAssetPropertyConfigs={setAssetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                assetDisplayTemplates={assetDisplayTemplates}
                onSaveAssetDisplayTemplate={handleSaveAssetDisplayTemplate}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                onSaveAssetRelatedAssetsTemplate={handleSaveAssetRelatedAssetsTemplate}
                activeSaveHandlerRef={activeSaveHandlerRef}
                activeTabIndex={activeTabIndex}
                onViewModeChange={setRightPanelViewMode}
                hiddenAssetIds={hiddenAssetIds}
                relatedAssetsTemplates={relatedAssetsTemplates}
                onSaveRelatedAssetsTemplate={handleSaveRelatedAssetsTemplate}
                allAssetsTemplate={allAssetsTemplate}
                onSaveAllAssetsTemplate={handleSaveAllAssetsTemplate}
                onTitleClick={handleNavigateToType}
                propertyVisuals={propertyVisuals}
                previewRevision={nowPreviewRevision}
              />
            ) : railMode === 'attention' ? (
              <InvestigatePanel
                item={selectedItem}
                onCreateWorkItem={handleCreateWorkItem}
                evidenceView={evidenceView}
                setEvidenceView={setEvidenceView}
                typeList={nowTypeList}
                typeDisplayTemplates={typeDisplayTemplates}
                typePropertyConfigs={typePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                relatedAssetsTemplates={relatedAssetsTemplates}
                onSaveRelatedAssetsTemplate={handleSaveRelatedAssetsTemplate}
                assetDisplayTemplates={assetDisplayTemplates}
                assetPropertyConfigs={assetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                activeSaveHandlerRef={activeSaveHandlerRef}
                onTitleClick={handleNavigateToType}
                onGearClick={handleNavigateToConfig}
              />
            ) : railMode === 'assets' ? (
              <OperatorAssetDetail
                selectedAssetId={selectedAssetId}
                typeList={nowTypeList}
                typeDisplayTemplates={typeDisplayTemplates}
                typePropertyConfigs={typePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                relatedAssetsTemplates={relatedAssetsTemplates}
                assetDisplayTemplates={assetDisplayTemplates}
                assetPropertyConfigs={assetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                allAssetsTemplate={allAssetsTemplate}
                hiddenAssetIds={hiddenAssetIds}
                activeTab={selectedAssetTab}
                onActiveTabChange={setSelectedAssetTab}
                onTitleClick={handleNavigateToAsset}
                onGearClick={handleNavigateToConfig}
              />
            ) : (
              <TaskDetailPanel key={selectedWorkItemId} item={selectedWorkItem} onToggleDone={handleToggleWorkItem} />
            )}
          </SplitterItem>
          {!rightPanelHidden && (
            <SplitterItem size="280px" minSize="240px" resizable={true}>
              <SidePanel
                mode={rightPanelMode}
                contacts={contacts}
                activeContactId={activeContactId}
                onSelectContact={selectContact}
                onBack={() => setActiveContactId(null)}
                onSendMessage={sendContactMessage}
                selectedNowThing={selectedNowThing}
                nowTypeList={nowTypeList}
                typePropertyConfigs={typePropertyConfigs}
                setTypePropertyConfigs={setTypePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                typeDisplayTemplates={typeDisplayTemplates}
                onSaveTypeDisplayTemplate={handleSaveTypeDisplayTemplate}
                assetPropertyConfigs={assetPropertyConfigs}
                setAssetPropertyConfigs={setAssetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                activeSaveHandlerRef={activeSaveHandlerRef}
                activeTabIndex={activeTabIndex}
                onActiveTabIndexChange={handleActiveTabIndexChange}
                rightPanelViewMode={rightPanelViewMode}
                hiddenAssetIds={hiddenAssetIds}
                onToggleAssetVisibility={handleToggleAssetVisibility}
                propertyVisuals={propertyVisuals}
              />
            </SplitterItem>
          )}
        </Splitter>

        <RightRail mode={rightPanelMode} hidden={rightPanelHidden} onIconClick={handleRightIconClick} hasUnread={hasUnreadContacts} operatorPersona={operatorPersona} />
      </div>
      {undoToast && (
        <div className="op-undo-toast" role="status">
          <span>{undoToast.message}</span>
          <button type="button" className="op-undo-toast-action" onClick={() => { undoToast.undo(); setUndoToast(null); }}>Undo</button>
          <button type="button" className="op-undo-toast-close" onClick={() => setUndoToast(null)} title="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}
