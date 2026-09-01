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

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { SelectBox } from 'devextreme-react/select-box';
import ButtonGroup from 'devextreme-react/button-group';
import {
  Chart, Series, Point, ArgumentAxis, ValueAxis,
  Grid as ChartGrid, Legend as ChartLegend, Tooltip as ChartTooltip,
  Export as ChartExport, CommonSeriesSettings, Aggregation,
} from 'devextreme-react/chart';
import RangeSelector, {
  Size as RsSize, Scale as RsScale, Chart as RsChart, ValueAxis as RsValueAxis,
  Series as RsSeries, Behavior as RsBehavior, Aggregation as RsAggregation,
} from 'devextreme-react/range-selector';
import Sparkline from 'devextreme-react/sparkline';

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — "Now" (line status strip)
// ─────────────────────────────────────────────────────────────────────────────

// LineThroughputRate at 2026-08-28 14:05 from the nextgen simulation
// workbook, against each line's target rate from OperatingContext.
// FER_L02 is flagged 'attention' (Component Degradation + Recurring
// Micro-stops both live there right now); FER_L04 is 'changeover' — its
// low output is expected mid-transition, not a problem, so it gets a
// duration indicator instead of a percent gauge, same as before.
// statusSinceMinutes = how long each line has held its CURRENT state, as of
// the shared 14:05 reference — real numbers, not estimates:
//   - Running lines: minutes since their last situation actually resolved
//     (A2 never had one at all, so it's running since shift start, 08:00).
//   - F2 (attention): minutes since the EARLIER of its two situations'
//     real AttentionRequired timestamp (SIT05, 10:25 — SIT12 didn't
//     require attention until 13:55, so SIT05 is the one that set this).
//   - F4 (changeover): minutes since the changeover actually began, 13:50.
let LINE_STATUS = [];

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

// ─────────────────────────────────────────────────────────────────────────────
// Attention items — migrated from the real Jan 1 historian window to the
// nextgen scenario dataset (aetherium_nextgen_simulation_v1.xlsx), so the
// whole interface now runs on one timeline instead of two. 13 of the 14
// scenarios are represented (SIT02–SIT14 — SIT01 "Normal Shift" is
// deliberately excluded: it has no real situation, and the whole point of
// that scenario is proving the system stays quiet, which an Attention
// item for it would undercut).
//
// All content — signal, evidence, hypotheses, events, outcomes — is pulled
// from the workbook's real records (Situations/SituationEvidence/
// SituationHypotheses/Events/GroundTruth sheets) at the shared 2026-08-28
// 14:05 reference point, not invented. Two adaptations worth knowing about:
//   - SituationHypotheses is really "competing explanations for this one
//     situation," not "similar past occurrences" — repurposed into the
//     Similar card as ruled-out alternatives, which is close in spirit but
//     not identical to what that card originally meant.
//   - For situations still active at 14:05 (SIT05, SIT12), the eventual
//     OperationalMemory record (confirmed cause, successful fix) is
//     deliberately withheld, since the AI shouldn't know the answer before
//     its own diagnosis has actually gotten there — this is the exact
//     "detection confidence vs. diagnosis maturity" distinction from the
//     Aug 27 design conversation.
// ─────────────────────────────────────────────────────────────────────────────

let ATTENTION_ITEMS = [];


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

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — "Work" items
//
// Real content mined from aetherium_nextgen_simulation_v1.xlsx (WorkItems +
// WorkDependencies sheets) — the Aug 28 scenario-driven simulation. This is
// now the SAME dataset the Attention items above are grounded in (both
// migrated together), replacing the old real Jan 1 historian window
// entirely — one timeline for the whole interface, not two.
//
// "Now" for the whole interface is pinned to 2026-08-28 14:05 — the middle
// of Ferrum F4's real changeover window, which is what actually produces a
// good planned/unplanned + time-margin story (11 of 14 items already done,
// 3 genuinely live: one overdue by 5 min, one due right now, one with 15
// min left).
// ─────────────────────────────────────────────────────────────────────────────

const WORK_NOW_REFERENCE = new Date('2026-08-28T14:05:00');

const WORK_PRIORITY_ORDER = { urgent: 0, important: 1, routine: 2 };
const WORK_PRIORITY_COLORS = { urgent: '#d64545', important: '#e0a336', routine: '#8c8c8c' };
const WORK_PRIORITY_LABELS = { urgent: 'Urgent', important: 'Important', routine: 'Routine' };
const WORK_SOURCE_TYPE_LABELS = { planned: 'Planned', situation: 'Unplanned' };

let INITIAL_WORK_ITEMS = [];

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

// One of two chart-type options for the Evidence card (toggled via a
// ButtonGroup) — a conventional line chart with a visible axis, gridlines,
// and point markers at each reading.
const SHIFT_START_MIN = 8 * 60;   // 08:00
const NOW_REFERENCE_MIN = 14 * 60 + 5; // 14:05, the app's shared "now"
const PAD_STEP_MIN = 15;

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToShiftDate(mins) {
  return new Date(2026, 7, 28, Math.floor(mins / 60), mins % 60);
}

// The chart used to be scoped to ONLY the event's own evidencePoints —
// honest, but too little data for the RangeSelector to zoom out into
// (nothing existed outside that narrow window to zoom out TO). This pads
// the real event data with flat baseline values spanning the rest of the
// shift, so there's an actual full-shift dataset to work with. It's a
// stand-in, not real telemetry outside the event window — flagged here so
// it's not mistaken for one later. Real per-property full-shift samples
// (like STATION_TELEMETRY already has for other views) would replace this
// properly once this attention-item data model records which property
// each item's evidence actually corresponds to.
function padEvidenceAcrossShift(evidencePoints, evidence) {
  const real = evidencePoints.map((p, i) => ({ minutes: timeStrToMinutes(p.time), value: evidence[i] }));
  const first = real[0];
  const last = real[real.length - 1];
  const padded = [];
  for (let m = SHIFT_START_MIN; m < first.minutes - PAD_STEP_MIN; m += PAD_STEP_MIN) {
    padded.push({ minutes: m, value: first.value });
  }
  padded.push(...real);
  for (let m = last.minutes + PAD_STEP_MIN; m <= NOW_REFERENCE_MIN; m += PAD_STEP_MIN) {
    padded.push({ minutes: m, value: last.value });
  }
  return padded
    .sort((a, b) => a.minutes - b.minutes)
    .map(p => ({ time: minutesToShiftDate(p.minutes), value: p.value }));
}

function ComparisonLineChart({ evidence, evidencePoints, color }) {
  const initialRange = useMemo(() => [
    minutesToShiftDate(timeStrToMinutes(evidencePoints[0].time)),
    minutesToShiftDate(timeStrToMinutes(evidencePoints[evidencePoints.length - 1].time)),
  ], [evidencePoints]);
  const [visualRange, setVisualRange] = useState(initialRange);
  const data = useMemo(() => padEvidenceAcrossShift(evidencePoints, evidence), [evidencePoints, evidence]);
  return (
    <div className="op-evidence-chart-wrap op-evidence-chart-wrap--with-range">
      <div className="op-evidence-chart-main">
        <Chart dataSource={data} palette={[color]} height="100%">
          <CommonSeriesSettings argumentField="time" type="line" />
          <Series valueField="value">
            <Point visible={true} size={7} />
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

// The other chart-type option. Candlestick charts need open/high/low/close
// per point, which this data doesn't actually have (it's one reading per
// minute, not an aggregated period) — so this is a deliberate approximation
// for evaluating the chart type, not a real OHLC series: open is the prior
// reading, close is the current one, and high/low add a small synthetic
// pad around whichever of the two is larger/smaller so the wicks render.
function buildCandlestickData(evidence, evidencePoints) {
  const data = [];
  for (let i = 1; i < evidence.length; i++) {
    const open = evidence[i - 1];
    const close = evidence[i];
    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.01 || 1;
    data.push({
      time: evidencePoints[i] ? evidencePoints[i].time : String(i),
      open,
      close,
      high: hi + pad,
      low: lo - pad,
    });
  }
  return data;
}

const EVIDENCE_VIEW_ITEMS = [
  { text: 'Line', value: 'line' },
  { text: 'Candlestick', value: 'candlestick' },
  { text: 'Timeline', value: 'timeline' },
  { text: 'Table', value: 'table' },
  { text: 'KPIs', value: 'hmi' },
];

function CandlestickChart({ evidence, evidencePoints, color }) {
  const data = buildCandlestickData(evidence, evidencePoints);
  return (
    <div className="op-evidence-chart-wrap">
      <Chart dataSource={data} palette={[color]} height="100%">
        <Series
          type="candlestick"
          argumentField="time"
          openValueField="open"
          highValueField="high"
          lowValueField="low"
          closeValueField="close"
        />
        <ArgumentAxis>
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
  );
}

// "Refinery · Line · Station" (how attention items name their asset) ->
// the nextgen workbook's own station id format ("FER_L02_POWERCHARGE").
// Only resolves for station-level assets — line-wide items (2-part asset
// strings, e.g. "Ferrum · F4") have no single station to look up.
function attentionAssetToStationId(asset) {
  const parts = asset.split(' · ');
  if (parts.length < 3) return null;
  const [refinery, line, station] = parts;
  const prefix = refinery === 'Aurelia' ? 'AUR' : 'FER';
  const num = line.slice(1).padStart(2, '0');
  const stationSuffix = station.replace(/\s+/g, '').toUpperCase();
  return `${prefix}_L${num}_${stationSuffix}`;
}

const HMI_CATEGORY_ORDER = ['Flow / WIP', 'Events / Losses', 'Stability', 'Quality', 'Derived Metric', 'Condition'];

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Full property series lives in STATION_TELEMETRY under either typed or
// measured — checked in that order since a property never appears in both.
function getPropertySeries(stationId, propKey) {
  const station = STATION_TELEMETRY && STATION_TELEMETRY.stations && STATION_TELEMETRY.stations[stationId];
  if (!station) return null;
  return (station.typed && station.typed[propKey]) || (station.measured && station.measured[propKey]) || null;
}

// Clips a full series down to [startTime, endTime] using STATION_TELEMETRY's
// own timestamp grid — the same window the Line/Candlestick tabs show for
// this item, via its evidencePoints. If that window reaches past what's
// actually available (a couple of items' evidence extends past the shared
// "now" reference as a projection), this naturally clips to real data
// rather than inventing future readings to match exactly.
function sliceSeriesToRange(series, startTime, endTime) {
  if (!series || !STATION_TELEMETRY || !STATION_TELEMETRY.timestamps) return null;
  const grid = STATION_TELEMETRY.timestamps.map(timeToMinutes);
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  let startIdx = grid.findIndex(m => m >= startMin);
  if (startIdx === -1) startIdx = grid.length - 1;
  let endIdx = startIdx;
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i] <= endMin) { endIdx = i; break; }
  }
  if (endIdx < startIdx) endIdx = startIdx;
  return series.slice(startIdx, endIdx + 1);
}

// Every property EXCEPT the universal/common ones already shown elsewhere
// (throughput, OEE, WIP, etc. — the same set the Line Detail 2x2 grid
// already covers) — grouped by property type rather than dumped as one
// long list, same visual language as Line Detail's stat tiles.
function HmiPropertiesListing({ asset, evidencePoints }) {
  const stationId = attentionAssetToStationId(asset);
  const props = stationId ? STATION_FULL_PROPERTIES[stationId] : null;

  if (!props) {
    return <div className="op-dash-text op-dash-text--muted">No station-level properties for this item.</div>;
  }

  const rangeStart = evidencePoints && evidencePoints.length ? evidencePoints[0].time : null;
  const rangeEnd = evidencePoints && evidencePoints.length ? evidencePoints[evidencePoints.length - 1].time : null;

  const grouped = {};
  Object.entries(props).forEach(([key, value]) => {
    const category = PROPERTY_CATEGORIES[key] || 'Other';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({ key, label: PROPERTY_LABELS[key] || key, value });
  });
  const categories = HMI_CATEGORY_ORDER.filter(c => grouped[c]);

  return (
    <div className="op-hmiprops">
      {categories.map(cat => (
        <div key={cat} className="op-hmiprops-card">
          <div className="op-hmiprops-card-title">{cat}</div>
          <div className="op-hmiprops-kpis">
            {grouped[cat].map(p => {
              const range = PROPERTY_RANGES[p.key];
              const fullSeries = stationId ? getPropertySeries(stationId, p.key) : null;
              const sparkline = (fullSeries && rangeStart && rangeEnd)
                ? sliceSeriesToRange(fullSeries, rangeStart, rangeEnd)
                : null;
              return (
                <StatTile
                  key={p.key}
                  label={p.label}
                  value={p.value}
                  min={range ? range[0] : undefined}
                  max={range ? range[1] : undefined}
                  sparkline={sparkline && sparkline.length > 2 ? sparkline : null}
                  horizontal
                  labelFirst
                />
              );
            })}
          </div>
        </div>
      ))}
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

function ConfidenceIcon({ filled }) {
  const bar = n => (filled >= n ? 'currentColor' : '#e2e5ea');
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
      <rect x="0" y="11" width="5" height="7" rx="1.2" fill={bar(1)} />
      <rect x="8.5" y="6" width="5" height="12" rx="1.2" fill={bar(2)} />
      <rect x="17" y="0" width="5" height="18" rx="1.2" fill={bar(3)} />
    </svg>
  );
}

function RiskAlertIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 1.5 18.8 16.3H1.2L10 1.5z" />
      <line x1="10" y1="7" x2="10" y2="10.8" />
      <circle cx="10" cy="13.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="18" height="19" viewBox="0 0 18 19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.3 16 3.8v5.1c0 4.4-2.9 7.2-7 8.3-4.1-1.1-7-3.9-7-8.3V3.8L9 1.3z" />
      <path d="M5.8 9.3 8 11.5l4.2-4.6" />
    </svg>
  );
}

// Two opposing arrows — reads as "switching from one thing to another,"
// which is what a changeover actually is (grade A to grade B), rather than
// borrowing an icon meant for a different concept (a clock/duration, or a
// generic gear/settings icon that doesn't say "in transition" specifically).
function ChangeoverIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5.5h14.5l-3.5-3.5" />
      <path d="M18.5 12.5H4l3.5 3.5" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,14 7,7.5 11,10.5 19,1.5" />
      <polyline points="13,1.5 19,1.5 19,7.5" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="4" y1="9" x2="14" y2="9" />
    </svg>
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Now — line status strip
// ─────────────────────────────────────────────────────────────────────────────

// One consistent visual language for all three states, rather than the old
// gauge-for-running/attention + separate duration-for-changeover split. A
// percent gauge implied a denominator worth reading closely — but with
// every running line clustered at 99-101%, that precision wasn't actually
// informative, just noisy. Icon + label reads faster at a glance anyway.
function NowStatusIcon({ state }) {
  if (state === 'attention') return <RiskAlertIcon />;
  if (state === 'changeover') return <ChangeoverIcon />;
  return <ShieldCheckIcon />;
}

function formatStatusDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Attention first (needs a person to look), changeover second (expected,
// but worth a glance since it's a transition), running last (calm).
const LINE_STATE_PRIORITY = { attention: 0, changeover: 1, running: 2 };

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
              className={`op-now-tile${selectedLine === lineIdToAssetId(line.id) ? ' op-now-tile--selected' : ''}`}
              onClick={() => onSelectLine(lineIdToAssetId(line.id))}
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

// LINE_STATUS uses ids like "AURELIA_A1"; LINE_ROLLUPS/STATION_METRICS use
// the nextgen workbook's own asset ids like "AUR_L01" — this converts
// between the two rather than renaming one of two already-established
// conventions.
function lineIdToAssetId(lineStatusId) {
  const [refinery, code] = lineStatusId.split('_');
  const prefix = refinery === 'AURELIA' ? 'AUR' : 'FER';
  const num = code.slice(1).padStart(2, '0'); // "A1" -> "1" -> "01"
  return `${prefix}_L${num}`;
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

// Display labels only — "Grade A/F/B" are the workbook's real ProductID
// values (GRADE_A, GRADE_F, GRADE_B), left untouched underneath. Renamed
// here because "Grade F" reads like a failing grade at a glance, which is
// exactly the wrong impression for a healthy line. F4's changeover target
// gets "Product C" rather than reusing "Product B", since B is now taken
// by Ferrum's standard product and reusing it would make the changeover
// arrow read as "back to Ferrum's own product," which it isn't.
let OPERATING_CONTEXT_BY_LINE = {};

let LINE_ROLLUPS = {};

let STATION_METRICS = {};
// Full 74-point (08:00-14:05, 5-min resolution) time series for every
// property on all 66 stations — { timestamps: [...], stations: { id: {
// universal: {prop: [...]}, typed: {...}, measured: {...} } } }. Not
// consumed by any UI yet — available for whenever that work happens.
let STATION_TELEMETRY = null;

let PROPERTY_CATEGORIES = {};
let PROPERTY_LABELS = {};
let PROPERTY_RANGES = {};
let STATION_FULL_PROPERTIES = {};

let LINE_SPARKLINES = {};

let STATION_SPARKLINES = {};


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
function StatTile({ label, value, min, max, sparkline, labelFirst, horizontal }) {
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
  const valueEl = <div className="op-statkpi-value">{value}</div>;

  if (horizontal) {
    // Compact row: vertical indicator | name+value stack | sparkline.
    // Height is driven entirely by the name+value column — deliberately
    // short, trading the scale-endpoint labels for density.
    return (
      <div className="op-statkpi op-statkpi--row">
        {hasRange && (
          <div className="op-statkpi-vtrack">
            {observed && (
              <div className="op-statkpi-vtrack-observed" style={{ bottom: `${observed.left}%`, height: `${observed.width}%` }} />
            )}
            <div className="op-statkpi-vtrack-marker" style={{ bottom: `${pct}%` }} />
          </div>
        )}
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

function InvestigatePanel({ item, onCreateWorkItem, evidenceView, setEvidenceView }) {
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

      <div className="op-investigate-toprow">
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
        <button className="op-btn op-btn--primary" onClick={() => onCreateWorkItem(item)}>
          Create work item
        </button>
      </div>

      <div className="op-investigate-dashboard">
        <div className="op-dashboard-card op-dashboard-card--signal">
          <div className="op-dashboard-card-title">Signal</div>
          <div className="op-dash-text op-dash-text--clamp3">{d.signal}</div>
          <div className="op-dash-separator" />
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
            <ButtonGroup
              items={EVIDENCE_VIEW_ITEMS}
              keyExpr="value"
              selectedItemKeys={[evidenceView]}
              onItemClick={e => setEvidenceView(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle"
            />
            {evidenceView === 'line' && (
              <ComparisonLineChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} />
            )}
            {evidenceView === 'candlestick' && (
              <CandlestickChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} />
            )}
            {evidenceView === 'timeline' && (
              <VerticalTimeline
                maxItems={4}
                items={d.evidencePoints.map(p => ({
                  time: p.time,
                  primary: p.value,
                  secondary: p.label || null,
                  highlighted: !!p.label,
                  color: severityColor,
                }))}
              />
            )}
            {evidenceView === 'table' && (
              <EvidenceTable evidencePoints={d.evidencePoints} />
            )}
            {evidenceView === 'hmi' && (
              <HmiPropertiesListing asset={item.asset} evidencePoints={d.evidencePoints} />
            )}
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--interpretation">
          <div className="op-dashboard-card-title">Interpretation</div>
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
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
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--similarrecent">
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
            <div className="op-dash-subsection">
              <div className="op-dash-subsection-label"><AiPill />Similar</div>
              {d.relatedOccurrences.length > 0 ? (
                <div className="op-dash-text op-dash-text--clamp2">{d.relatedOccurrences[0].summary}</div>
              ) : (
                <div className="op-dash-text op-dash-text--muted">No matching pattern found.</div>
              )}
            </div>
            <div className="op-dash-subsection">
              <div className="op-dash-subsection-label"><AiPill />Other recent</div>
              <div className="op-dash-text op-dash-text--clamp2">{d.whatChangedSummary}</div>
            </div>
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--nextsteps">
          <div className="op-dashboard-card-title"><AiPill />Next steps</div>
          <div className="op-dashboard-card-body">
            <div className="op-dash-text op-dash-text--clamp3">{d.recommendation}</div>
          </div>
        </div>
      </div>
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

      <div className="op-investigate-actions">
        <button className="op-btn op-btn--primary" onClick={() => onToggleDone(item.id)}>
          {item.done ? 'Mark as not done' : 'Mark as done'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-panel tab icons — Work / Chat / AI, icon-only (title attr for a11y)
// ─────────────────────────────────────────────────────────────────────────────

function WorkTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <rect x="6" y="1" width="4" height="2" rx="0.6" />
      <line x1="5.5" y1="7" x2="10.5" y2="7" />
      <line x1="5.5" y1="9.5" x2="10.5" y2="9.5" />
      <line x1="5.5" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChatTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.7l-2.9 2.35a.4.4 0 0 1-.65-.31V11.5h-.65a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function AiTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M8 1.4c.35 3 1.15 4.8 4.1 5.1-2.95.3-3.75 2.1-4.1 5.1-.35-3-1.15-4.8-4.1-5.1 2.95-.3 3.75-2.1 4.1-5.1z" />
      <path d="M13 9.6c.15 1.1.5 1.5 1.5 1.7-1 .2-1.35.6-1.5 1.7-.15-1.1-.5-1.5-1.5-1.7 1-.2 1.35-.6 1.5-1.7z" />
    </svg>
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

function AttentionRailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.8c-2 0-3.4 1.6-3.4 3.6v2.1c0 .5-.2 1-.6 1.4L3 9.9c-.5.5-.1 1.3.6 1.3h9c.7 0 1.1-.8.6-1.3l-1-1c-.4-.4-.6-.9-.6-1.4V5.4c0-2-1.4-3.6-3.4-3.6z" />
      <path d="M6.3 12.3a1.7 1.7 0 0 0 3.4 0" />
    </svg>
  );
}

function NavRail({ mode, hidden, onIconClick, attentionCount, workCount }) {
  const [expanded, setExpanded] = useState(false);

  const items = [
    { id: 'attention', label: 'Attention', Icon: AttentionRailIcon, count: attentionCount },
    { id: 'work', label: 'Work', Icon: WorkTabIcon, count: workCount },
  ];

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


function SidePanel({ mode, contacts, activeContactId, onSelectContact, onBack, onSendMessage }) {
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

function RightRail({ mode, hidden, onIconClick, hasUnread }) {
  return (
    <div className="op-nav-rail op-nav-rail--right">
      {RIGHT_RAIL_ITEMS.map(item => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Data loading — all the per-asset/per-scenario data that used to be
// hardcoded directly in this file now lives in /public/data/refinery/*.json,
// fetched once on mount. The module-level `let`s above (ATTENTION_ITEMS,
// STATION_METRICS, etc.) start empty and get populated here before
// OperatorWorkspaceInner — which does all the normal rendering work and
// references these by name exactly as before — ever mounts. Structured as
// an outer/inner pair rather than an early-return inside one component,
// since Inner has many hooks of its own and conditionally skipping them
// would violate the Rules of Hooks.
// ─────────────────────────────────────────────────────────────────────────────

const REFINERY_DATA_FILES = [
  ['ATTENTION_ITEMS', '/data/refinery/attention-items.json'],
  ['INITIAL_WORK_ITEMS', '/data/refinery/work-items.json'],
  ['LINE_STATUS', '/data/refinery/line-status.json'],
  ['OPERATING_CONTEXT_BY_LINE', '/data/refinery/operating-context.json'],
  ['LINE_ROLLUPS', '/data/refinery/line-rollups.json'],
  ['STATION_METRICS', '/data/refinery/station-metrics.json'],
  ['STATION_TELEMETRY', '/data/refinery/station-telemetry.json'],
  ['LINE_SPARKLINES', '/data/refinery/line-sparklines.json'],
  ['STATION_SPARKLINES', '/data/refinery/station-sparklines.json'],
  ['PROPERTY_CATEGORIES', '/data/refinery/property-categories.json'],
  ['PROPERTY_LABELS', '/data/refinery/property-labels.json'],
  ['PROPERTY_RANGES', '/data/refinery/property-ranges.json'],
  ['STATION_FULL_PROPERTIES', '/data/refinery/station-full-properties.json'],
];

// Work items carry real Date objects elsewhere in the app (margin math,
// formatting) — JSON can only carry the ISO strings they were exported as,
// so they get parsed back into Dates here, once, right after fetch.
function parseWorkItemDates(items) {
  return items.map(item => ({
    ...item,
    plannedStart: item.plannedStart ? new Date(item.plannedStart) : null,
    dueAt: item.dueAt ? new Date(item.dueAt) : null,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    createdAt: item.createdAt ? new Date(item.createdAt) : null,
  }));
}

function assignRefineryData(name, value) {
  switch (name) {
    case 'ATTENTION_ITEMS': ATTENTION_ITEMS = value; break;
    case 'INITIAL_WORK_ITEMS': INITIAL_WORK_ITEMS = parseWorkItemDates(value); break;
    case 'LINE_STATUS': LINE_STATUS = value; break;
    case 'OPERATING_CONTEXT_BY_LINE': OPERATING_CONTEXT_BY_LINE = value; break;
    case 'LINE_ROLLUPS': LINE_ROLLUPS = value; break;
    case 'STATION_METRICS': STATION_METRICS = value; break;
    case 'STATION_TELEMETRY': STATION_TELEMETRY = value; break;
    case 'LINE_SPARKLINES': LINE_SPARKLINES = value; break;
    case 'STATION_SPARKLINES': STATION_SPARKLINES = value; break;
    case 'PROPERTY_CATEGORIES': PROPERTY_CATEGORIES = value; break;
    case 'PROPERTY_LABELS': PROPERTY_LABELS = value; break;
    case 'PROPERTY_RANGES': PROPERTY_RANGES = value; break;
    case 'STATION_FULL_PROPERTIES': STATION_FULL_PROPERTIES = value; break;
    default: break;
  }
}

export default function OperatorWorkspace() {
  const [dataState, setDataState] = useState({ loaded: false, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      REFINERY_DATA_FILES.map(([, url]) =>
        fetch(url).then(r => {
          if (!r.ok) throw new Error(`${url} — ${r.status}`);
          return r.json();
        })
      )
    )
      .then(results => {
        if (cancelled) return;
        REFINERY_DATA_FILES.forEach(([name], i) => assignRefineryData(name, results[i]));
        setDataState({ loaded: true, error: null });
      })
      .catch(err => {
        if (!cancelled) setDataState({ loaded: false, error: err.message });
      });
    return () => { cancelled = true; };
  }, []);

  if (dataState.error) {
    return (
      <div className="op-workspace-loading op-workspace-loading--error">
        Couldn't load operator data ({dataState.error}). Check that the /data/refinery/*.json files are present in the public folder.
      </div>
    );
  }
  if (!dataState.loaded) {
    return <div className="op-workspace-loading">Loading operator data…</div>;
  }

  return <OperatorWorkspaceInner />;
}

function OperatorWorkspaceInner() {
  const [railMode, setRailMode] = useState('attention'); // 'attention' | 'work' — drives both the list and detail slots
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
    (ATTENTION_ITEMS.find(i => i.attentionState === 'investigate') || ATTENTION_ITEMS[0]).id
  );
  const [evidenceView, setEvidenceView] = useState('line');
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(INITIAL_WORK_ITEMS[0].id);

  const [rightPanelMode, setRightPanelMode] = useState('chat'); // 'chat' | 'ai' — drives the right rail + right panel
  const [rightPanelHidden, setRightPanelHidden] = useState(true);
  const [contacts, setContacts] = useState(CONTACTS_SEED);
  const [activeContactId, setActiveContactId] = useState(null);

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

      <div className="op-now-section" ref={nowSectionRef}>
        <NowStrip
          selectedLine={selectedDetailLine}
          onSelectLine={(lineId) => {
            if (selectedDetailLine === lineId) {
              setSelectedDetailLine(null);
            } else {
              setSelectedDetailLine(lineId);
              setIssueMapExpanded(true);
            }
          }}
        />
        <IssueMapOverlay
          expanded={issueMapExpanded}
          onToggle={() => setIssueMapExpanded(e => !e)}
          onSelectIssue={handleSelectIssueFromMap}
          selectedDetailLine={selectedDetailLine}
          onCloseDetailLine={() => setSelectedDetailLine(null)}
          topOffset={nowSectionBottom}
        />
      </div>

      <div className="op-main-row">
        <NavRail
          mode={railMode}
          hidden={leftPanelHidden}
          onIconClick={handleLeftIconClick}
          attentionCount={newAttentionItems.length}
          workCount={newWorkItems.length}
        />

        <Splitter orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
          {!leftPanelHidden && (
            <SplitterItem size="320px" minSize="240px" resizable={true}>
              {railMode === 'attention' ? (
                <AttentionPanel selectedId={selectedAttentionId} onSelect={setSelectedAttentionId} />
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
            {railMode === 'attention' ? (
              <InvestigatePanel item={selectedItem} onCreateWorkItem={handleCreateWorkItem} evidenceView={evidenceView} setEvidenceView={setEvidenceView} />
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
              />
            </SplitterItem>
          )}
        </Splitter>

        <RightRail mode={rightPanelMode} hidden={rightPanelHidden} onIconClick={handleRightIconClick} hasUnread={hasUnreadContacts} />
      </div>
    </div>
  );
}
