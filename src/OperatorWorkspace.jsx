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

import { useMemo, useState, useEffect, forwardRef, useRef, useImperativeHandle, useCallback } from 'react';
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
import RangeSelector, { Size as RsSize, Chart as RsChart, ValueAxis as RsValueAxis, Series as RsSeries, Aggregation as RsAggregation, Scale as RsScale, Behavior as RsBehavior } from 'devextreme-react/range-selector';
import HierarchyTree from './HierarchyTree';
import { NowStatusIcon, IconButtonGroupItem, VisibilityStateIcon, CaretIcon, ConfidenceIcon, ShieldCheckIcon, RiskAlertIcon, TrendUpIcon, DashIcon, PlayPauseIcon, VisualizationRailIcon, AttentionRailIcon, WorkTabIcon, AssetsRailIcon, ChatTabIcon, AiTabIcon, DetailsTabIcon } from './operator/icons';
import { deslugifyType, assetTypeIdOf, getAssetPathLabel, nowTileIdToAssetId, getAssetDisplayLabel, resolveAssetProperties, getPropertyVisibilityForType, getRelatedAssetsForType, getAttentionItemAssetEntry, getAttentionItemTypeId, isAttentionItemActiveAtTime, getAttentionItemPrimarySeries, buildTypeList } from './operator/model/assetQueries';
import { WORK_NOW_REFERENCE, minutesToShiftDate, timeStrToMinutes, CURRENT_TIMESTAMPS, padEvidenceAcrossShift, CURRENT_ASSET_MAP, CURRENT_ASSET_DATA, LINE_STATUS, OPERATING_CONTEXT_BY_LINE, ATTENTION_ITEMS, LINE_ROLLUPS, STATION_METRICS, LINE_SPARKLINES, STATION_SPARKLINES, PROPERTY_LABELS, activateLoadedModel, INITIAL_WORK_ITEMS, CURRENT_MODEL, CURRENT_MODEL_SHAPE } from './operator/model/modelData';
import { useAssetCustomizations, normalizedLayout, UNDO_TOAST_MS, computeAssetCustomizations, assetCustomizationStore, EMPTY_CUSTOMIZATIONS } from './operator/settings/customizations';
import { useDisplayOrders, resolveEntityOrder, applySavedOrder, categoryOrderedPropertyKeys, sortRowsByOrder, displayOrderStore, EMPTY_DISPLAY_ORDERS } from './operator/settings/displayOrder';
import { KPI_VIEW_MODE_ITEMS, PROPERTY_VIEW_MODE_DEFAULT, VISIBILITY_LABEL, VISIBILITY_CYCLE, PROPERTY_VIEW_MODE_UPDATE_TYPE, PROPERTY_VIEW_MODE_OVERRIDE_ITEMS, RELATED_ASSET_VISIBILITY_CYCLE } from './operator/settings/propertyDisplay';
import '@xyflow/react/dist/style.css';
import { HmiPropertiesListing } from './operator/properties/HmiPropertiesListing';
import { StatTile } from './operator/properties/StatTile';
import { MiniSparkline } from './operator/properties/sparklines';
import { ReadOnlyAllAssetsView, ReadOnlyRelatedAssetsView } from './operator/relatedAssets/ReadOnlyViews';
import { RelatedAssetBoxContent, TimeScrubContext } from './operator/relatedAssets/RelatedAssetBoxContent';
import { RelatedAssetsCards } from './operator/relatedAssets/RelatedAssetsCards';
import { RelatedAssetsDiagram } from './operator/relatedAssets/RelatedAssetsDiagram';
import { RELATED_ASSETS_DIAGRAM_ALGORITHM_OPTIONS, RELATED_ASSETS_DIAGRAM_DIRECTION_ALGORITHMS, RELATED_ASSETS_DIAGRAM_DIRECTION_ITEMS, RELATED_ASSETS_DIAGRAM_EDGE_ROUTING_ITEMS, RELATED_ASSETS_DIAGRAM_LAYERED_ONLY_CONTROLS } from './operator/relatedAssets/elkLayout';
import { ALIGN_CONTENT_ITEMS, FLOW_DIRECTION_ITEMS, FLOW_WRAP_ITEMS, RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS, RELATED_ASSETS_ALIGN_VERTICAL_ITEMS, RELATED_ASSETS_DISTRIBUTE_ITEMS, RELATED_ASSETS_LAYOUT_MODE_ITEMS, RELATED_ASSET_DENSITY_VALUES, formatRelatedAssetDensityLabel } from './operator/settings/layoutOptions';

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
