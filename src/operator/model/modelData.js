// operator/model/modelData.js
// The active industry model's data, as module-level variables (live ES
// bindings), plus everything that writes them: the loader helpers that
// OperatorWorkspace calls after fetching a model's JSON files
// (activateLoadedModel), and the shift timeline those files define.
//
// Everything else only READS these — an import of a `let` from here always
// sees its current value, but can't assign it. That's deliberate: all
// writes stay in this one file. Switching models remounts the workspace,
// so nothing needs to subscribe to changes here.

import { MODEL_SHAPES } from '../../modelRegistry';
import { ASSET_DATA, ASSET_MAP } from '../../assetData';

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
export let LINE_STATUS = [];

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

export let ATTENTION_ITEMS = [];

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

// Reassigned by applyTimeline() whenever a model finishes loading — the
// legacy packs all share the 2026-08-28 08:00–14:05 shift below; a generic
// pack declares its own timeline in asset-telemetry.json.
export let WORK_NOW_REFERENCE = new Date('2026-08-28T14:05:00');

export let INITIAL_WORK_ITEMS = [];

// One of two chart-type options for the Evidence card (toggled via a
// ButtonGroup) — a conventional line chart with a visible axis, gridlines,
// and point markers at each reading.
let SHIFT_START_MIN = 8 * 60;   // 08:00 — see applyTimeline()

let NOW_REFERENCE_MIN = 14 * 60 + 5; // 14:05, the active model's "now"

const PAD_STEP_MIN = 15;

// The active model's timeline. Legacy packs don't declare one, so they get
// the shared demo shift they were all generated on; generic packs declare
// theirs in asset-telemetry.json (INDUSTRY_PACK_SPEC.md §4.2).
const LEGACY_TIMELINE = { date: '2026-08-28', start: '08:00', end: '14:05', stepMinutes: 5 };

let CURRENT_TIMELINE = LEGACY_TIMELINE;

// The active model's "HH:MM" sample grid — every series in the model has
// exactly one value per entry. Everything that scrubs, slices or labels
// time reads this rather than a specific telemetry file.
export let CURRENT_TIMESTAMPS = [];

function applyTimeline(timeline, timestamps) {
  CURRENT_TIMELINE = timeline || LEGACY_TIMELINE;
  CURRENT_TIMESTAMPS = timestamps || [];
  SHIFT_START_MIN = timeStrToMinutes(CURRENT_TIMELINE.start);
  NOW_REFERENCE_MIN = timeStrToMinutes(CURRENT_TIMELINE.end);
  WORK_NOW_REFERENCE = new Date(`${CURRENT_TIMELINE.date}T${CURRENT_TIMELINE.end}:00`);
}

export function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToShiftDate(mins) {
  const [y, mo, d] = CURRENT_TIMELINE.date.split('-').map(Number);
  return new Date(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
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
export function padEvidenceAcrossShift(evidencePoints, evidence) {
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

export function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Display labels only — "Grade A/F/B" are the workbook's real ProductID
// values (GRADE_A, GRADE_F, GRADE_B), left untouched underneath. Renamed
// here because "Grade F" reads like a failing grade at a glance, which is
// exactly the wrong impression for a healthy line. F4's changeover target
// gets "Product C" rather than reusing "Product B", since B is now taken
// by Ferrum's standard product and reusing it would make the changeover
// arrow read as "back to Ferrum's own product," which it isn't.
export let OPERATING_CONTEXT_BY_LINE = {};

export let LINE_ROLLUPS = {};

export let REFINERY_ROLLUPS = {};

export let STATION_METRICS = {};

// Full 74-point (08:00-14:05, 5-min resolution) time series for every
// property on all 66 stations — { timestamps: [...], stations: { id: {
// universal: {prop: [...]}, typed: {...}, measured: {...} } } }. Not
// consumed by any UI yet — available for whenever that work happens.
export let STATION_TELEMETRY = null;

export let LINE_TELEMETRY = null;

export let REFINERY_TELEMETRY = null;

export let PROPERTY_CATEGORIES = {};

export let PROPERTY_LABELS = {};

export let PROPERTY_RANGES = {};

export let PROPERTY_TIERS = {};

export let STATION_FULL_PROPERTIES = {};

export let CURRENT_MODEL = 'refinery';

// 'refinery' | 'four-level' — see modelRegistry.js. Set alongside
// CURRENT_MODEL every time a model finishes loading.
export let CURRENT_MODEL_SHAPE = MODEL_SHAPES.REFINERY;

// Refinery's hierarchy is a static import; every four-level model's is
// fetched at runtime (the assetData role).
// These two always point at whichever one is active, so the rest of the
// code (the Now tree, the resolver) never needs to know which model is
// selected — it just reads "the current hierarchy."
export let CURRENT_ASSET_DATA = ASSET_DATA;

export let CURRENT_ASSET_MAP = ASSET_MAP;

let LOADED_ASSET_DATA = [];

// Asset-to-asset edges: { sourceAssetId, targetAssetId, relationshipType,
// label, layer }. Same variable name loaded from a different file per
// model, same pattern as STATION_METRICS etc. — no "CURRENT_" prefix
// needed since assignModelData already refreshes it on every model switch.
export let ASSET_RELATIONSHIPS = [];

export let EQUIPMENT_METRICS = {};

export let EQUIPMENT_TELEMETRY = null;

// Generic-shape model data (INDUSTRY_PACK_SPEC.md §6) — everything keyed
// by real asset id, so none of the legacy id conversions above apply.
// ASSET_VALUES: { assetId: { key: currentValue } }. ASSET_TELEMETRY:
// { timeline, timestamps, series: { assetId: { key: [values] } } }.
// UNIT_STATUS: { unitAssetId: { state, statusSinceMinutes, mode, product } },
// turned into LINE_STATUS/OPERATING_CONTEXT_BY_LINE on load so the Now
// strip reads one shape regardless of model.
export let ASSET_VALUES = {};

export let ASSET_TELEMETRY = null;

let UNIT_STATUS = {};

// Display unit and precision per property key — generic packs only
// (legacy packs carry units in the key name and have no decimals).
export let PROPERTY_UNITS = {};

export let PROPERTY_DECIMALS = {};

// Declared rollup rules (spec §3.5). Not used for rendering today —
// loaded so they're available alongside the values they describe.
let PROPERTY_DERIVATIONS = [];

// Optional display names per assetType (properties.json typeLabels) —
// generic packs only; deslugifyType falls back to the slug otherwise.
export let TYPE_LABELS = {};

// The active generic model's declared levels and unit level. Null for
// legacy models, which fall back to LEGACY_LEVEL_LABELS and their own
// hardcoded structure.
export let CURRENT_LEVEL_LABELS = null;

export let CURRENT_UNIT_LEVEL = null;

export let LINE_SPARKLINES = {};

export let STATION_SPARKLINES = {};

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

// Which model-data variable each models.json file role fills. The role
// names (and each shape's default filenames) live in modelRegistry.js; the
// per-model file list itself lives in public/data/models.json, so adding an
// industry never touches this file. Unknown roles are ignored.
const ROLE_TO_VARIABLE = {
  attentionItems: 'ATTENTION_ITEMS',
  workItems: 'INITIAL_WORK_ITEMS',
  lineStatus: 'LINE_STATUS',
  operatingContext: 'OPERATING_CONTEXT_BY_LINE',
  lineRollups: 'LINE_ROLLUPS',
  plantRollups: 'REFINERY_ROLLUPS',
  stationMetrics: 'STATION_METRICS',
  stationTelemetry: 'STATION_TELEMETRY',
  lineTelemetry: 'LINE_TELEMETRY',
  plantTelemetry: 'REFINERY_TELEMETRY',
  lineSparklines: 'LINE_SPARKLINES',
  stationSparklines: 'STATION_SPARKLINES',
  propertyCategories: 'PROPERTY_CATEGORIES',
  propertyLabels: 'PROPERTY_LABELS',
  propertyRanges: 'PROPERTY_RANGES',
  propertyTiers: 'PROPERTY_TIERS',
  stationFullProperties: 'STATION_FULL_PROPERTIES',
  assetData: 'LOADED_ASSET_DATA',
  equipmentMetrics: 'EQUIPMENT_METRICS',
  equipmentTelemetry: 'EQUIPMENT_TELEMETRY',
  assetRelationships: 'ASSET_RELATIONSHIPS',
  // Generic-shape roles (spec §6)
  assets: 'LOADED_ASSET_DATA',
  properties: 'GENERIC_PROPERTIES',
  assetValues: 'ASSET_VALUES',
  assetTelemetry: 'ASSET_TELEMETRY',
  unitStatus: 'UNIT_STATUS',
};

// Every model-data variable, reset to empty before each load so switching
// models never leaves the PREVIOUS model's data lingering in a role the
// new one doesn't populate. With three shapes (refinery, four-level,
// generic) sharing almost no files, resetting everything is simpler and
// safer than tracking which roles differ between which pair.
function resetModelVaryingData() {
  ATTENTION_ITEMS = [];
  INITIAL_WORK_ITEMS = [];
  LINE_STATUS = [];
  OPERATING_CONTEXT_BY_LINE = {};
  LINE_ROLLUPS = {};
  REFINERY_ROLLUPS = {};
  STATION_METRICS = {};
  STATION_TELEMETRY = null;
  LINE_TELEMETRY = null;
  REFINERY_TELEMETRY = null;
  LINE_SPARKLINES = {};
  STATION_SPARKLINES = {};
  PROPERTY_CATEGORIES = {};
  PROPERTY_LABELS = {};
  PROPERTY_RANGES = {};
  PROPERTY_TIERS = {};
  PROPERTY_UNITS = {};
  PROPERTY_DECIMALS = {};
  PROPERTY_DERIVATIONS = [];
  TYPE_LABELS = {};
  STATION_FULL_PROPERTIES = {};
  LOADED_ASSET_DATA = [];
  EQUIPMENT_METRICS = {};
  EQUIPMENT_TELEMETRY = null;
  ASSET_RELATIONSHIPS = [];
  ASSET_VALUES = {};
  ASSET_TELEMETRY = null;
  UNIT_STATUS = {};
}

// properties.json (generic packs) holds what the legacy packs spread over
// four files — split back into the same per-attribute lookups the rest of
// the file already reads, plus units/decimals/derivations, which only
// generic packs have.
function assignGenericProperties(value) {
  const props = value?.properties || {};
  Object.entries(props).forEach(([key, meta]) => {
    if (meta.label != null) PROPERTY_LABELS[key] = meta.label;
    if (meta.category != null) PROPERTY_CATEGORIES[key] = meta.category;
    if (meta.tier != null) PROPERTY_TIERS[key] = meta.tier;
    if (Array.isArray(meta.range)) PROPERTY_RANGES[key] = meta.range;
    if (meta.unit) PROPERTY_UNITS[key] = meta.unit;
    if (meta.decimals != null) PROPERTY_DECIMALS[key] = meta.decimals;
  });
  PROPERTY_DERIVATIONS = value?.derivations || [];
  TYPE_LABELS = value?.typeLabels || {};
}

// Generic packs describe each unit's status in one file keyed by asset id;
// the Now strip reads the legacy LINE_STATUS list + OPERATING_CONTEXT_BY_LINE
// map, so they're built from it here. Tiles follow assets.json order, and
// each tile's id IS the unit's asset id (see nowTileIdToAssetId).
function buildGenericUnitStatus() {
  LINE_STATUS = [];
  OPERATING_CONTEXT_BY_LINE = {};
  CURRENT_ASSET_DATA
    .filter(a => a.assetLevel === CURRENT_UNIT_LEVEL)
    .forEach(unit => {
      const status = UNIT_STATUS[unit.id] || {};
      LINE_STATUS.push({
        id: unit.id,
        label: unit.name,
        state: status.state || 'running',
        statusSinceMinutes: status.statusSinceMinutes ?? null,
      });
      if (status.mode || status.product) {
        OPERATING_CONTEXT_BY_LINE[unit.id] = { mode: status.mode || 'STEADY', product: status.product || '' };
      }
    });
}

function buildAssetMapFromArray(arr) {
  const map = {};
  arr.forEach(a => { map[a.id] = a; });
  return map;
}

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

function assignModelData(name, value) {
  switch (name) {
    case 'ATTENTION_ITEMS': ATTENTION_ITEMS = value; break;
    case 'INITIAL_WORK_ITEMS': INITIAL_WORK_ITEMS = parseWorkItemDates(value); break;
    case 'LINE_STATUS': LINE_STATUS = value; break;
    case 'OPERATING_CONTEXT_BY_LINE': OPERATING_CONTEXT_BY_LINE = value; break;
    case 'LINE_ROLLUPS': LINE_ROLLUPS = value; break;
    case 'REFINERY_ROLLUPS': REFINERY_ROLLUPS = value; break;
    case 'STATION_METRICS': STATION_METRICS = value; break;
    case 'STATION_TELEMETRY': STATION_TELEMETRY = value; break;
    case 'LINE_TELEMETRY': LINE_TELEMETRY = value; break;
    case 'REFINERY_TELEMETRY': REFINERY_TELEMETRY = value; break;
    case 'LINE_SPARKLINES': LINE_SPARKLINES = value; break;
    case 'STATION_SPARKLINES': STATION_SPARKLINES = value; break;
    case 'PROPERTY_CATEGORIES': PROPERTY_CATEGORIES = value; break;
    case 'PROPERTY_LABELS': PROPERTY_LABELS = value; break;
    case 'PROPERTY_RANGES': PROPERTY_RANGES = value; break;
    case 'PROPERTY_TIERS': PROPERTY_TIERS = value; break;
    case 'STATION_FULL_PROPERTIES': STATION_FULL_PROPERTIES = value; break;
    case 'LOADED_ASSET_DATA': LOADED_ASSET_DATA = value; break;
    case 'EQUIPMENT_METRICS': EQUIPMENT_METRICS = value; break;
    case 'EQUIPMENT_TELEMETRY': EQUIPMENT_TELEMETRY = value; break;
    case 'ASSET_RELATIONSHIPS': ASSET_RELATIONSHIPS = value; break;
    case 'GENERIC_PROPERTIES': assignGenericProperties(value); break;
    case 'ASSET_VALUES': ASSET_VALUES = value; break;
    case 'ASSET_TELEMETRY': ASSET_TELEMETRY = value; break;
    case 'UNIT_STATUS': UNIT_STATUS = value; break;
    default: break;
  }
}

// Makes a freshly fetched model the active one: clears the previous
// model's data, assigns each fetched file to its variable, then sets the
// "current model" globals every helper reads. Everything that writes the
// model-data globals lives next to them (see operator/model/modelData.js),
// so the rest of the code only ever reads them.
export function activateLoadedModel(model, files, results) {
  // Clear roles the OTHER shape owns before assigning this model's
  // data — otherwise switching to water would leave refinery's stale
  // line sparklines sitting in that variable untouched.
  resetModelVaryingData();
  files.forEach(([role], i) => assignModelData(ROLE_TO_VARIABLE[role], results[i]));
  if (model.shape === MODEL_SHAPES.REFINERY) {
    CURRENT_ASSET_DATA = ASSET_DATA;
    CURRENT_ASSET_MAP = ASSET_MAP;
  } else {
    CURRENT_ASSET_DATA = LOADED_ASSET_DATA;
    CURRENT_ASSET_MAP = buildAssetMapFromArray(LOADED_ASSET_DATA);
  }
  CURRENT_MODEL = model.id;
  CURRENT_MODEL_SHAPE = model.shape;
  if (model.shape === MODEL_SHAPES.GENERIC) {
    CURRENT_LEVEL_LABELS = Object.fromEntries(model.levels.map(l => [l.id, l.label]));
    CURRENT_UNIT_LEVEL = model.unitLevel;
    buildGenericUnitStatus();
    applyTimeline(ASSET_TELEMETRY?.timeline, ASSET_TELEMETRY?.timestamps);
  } else {
    CURRENT_LEVEL_LABELS = null;
    CURRENT_UNIT_LEVEL = null;
    applyTimeline(LEGACY_TIMELINE, STATION_TELEMETRY?.timestamps);
  }
}
