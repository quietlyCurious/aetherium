// operator/model/modelData.js
// The active industry model's data, as module-level variables (live ES
// bindings), plus everything that writes them: the loader helper that
// OperatorWorkspace calls after fetching a model's JSON files
// (activateLoadedModel), and the timeline those files define.
//
// Every model is a generic pack (INDUSTRY_PACK_SPEC.md §6): data keyed by
// real asset id, any hierarchy depth, its own timeline. Everything else
// only READS these — an import of a `let` from here always sees its current
// value, but can't assign it. That's deliberate: all writes stay in this
// one file. Switching models remounts the workspace, so nothing needs to
// subscribe to changes here.

// ─────────────────────────────────────────────────────────────────────────────
// The hierarchy
// ─────────────────────────────────────────────────────────────────────────────

// assets.json: [{ id, parentId, name, assetType, assetLevel }], depth-first.
export let CURRENT_ASSET_DATA = [];

// The same assets keyed by id.
export let CURRENT_ASSET_MAP = {};

// Asset-to-asset edges: { sourceAssetId, targetAssetId, relationshipType,
// label, layer }. Containment isn't an edge — it comes from parentId.
export let ASSET_RELATIONSHIPS = [];

// The model's declared levels ({ levelId: label }) and the level whose
// assets are units of operation (one Now-strip tile each).
export let CURRENT_LEVEL_LABELS = {};

export let CURRENT_UNIT_LEVEL = null;

// The active model's id (models.json) — the key per-model saved state uses.
export let CURRENT_MODEL = null;

// ─────────────────────────────────────────────────────────────────────────────
// Properties: values, series and their metadata
// ─────────────────────────────────────────────────────────────────────────────

// { assetId: { key: currentValue } } — the current value is always the
// last point of that key's series (spec §5.3).
export let ASSET_VALUES = {};

// { timeline, timestamps, series: { assetId: { key: [values] } } }
export let ASSET_TELEMETRY = null;

// properties.json, split into one lookup per attribute.
export let PROPERTY_LABELS = {};

export let PROPERTY_CATEGORIES = {};

export let PROPERTY_TIERS = {};

export let PROPERTY_RANGES = {};

export let PROPERTY_UNITS = {};

export let PROPERTY_DECIMALS = {};

// Declared rollup rules (spec §3.5). Not used for rendering today —
// loaded so they're available alongside the values they describe.
export let PROPERTY_DERIVATIONS = [];

// Optional display names per assetType; deslugifyType falls back to the slug.
export let TYPE_LABELS = {};

// ─────────────────────────────────────────────────────────────────────────────
// Units of operation (the Now strip)
// ─────────────────────────────────────────────────────────────────────────────

// One tile per unit-level asset, in assets.json order:
// [{ id: unitAssetId, label, state, statusSinceMinutes }].
export let UNIT_STATUS_TILES = [];

// { unitAssetId: { mode, product } } — what each unit is doing.
export let UNIT_OPERATING_CONTEXT = {};

// ─────────────────────────────────────────────────────────────────────────────
// Situations and work
// ─────────────────────────────────────────────────────────────────────────────

export let ATTENTION_ITEMS = [];

export let INITIAL_WORK_ITEMS = [];

// explanations.json (packs with detectors, spec §14): { detectors: { [id]: … },
// items: { [attentionItemId]: … } }, or null when the pack has none. Read
// through getAttentionItemExplanation.
export let EXPLANATIONS = null;

// ─────────────────────────────────────────────────────────────────────────────
// The timeline
// ─────────────────────────────────────────────────────────────────────────────

// The model's timeline (asset-telemetry.json, spec §4.2). `end` is "now".
let CURRENT_TIMELINE = { date: '2026-08-28', start: '08:00', end: '14:05', stepMinutes: 5 };

// The active model's "HH:MM" sample grid — every series in the model has
// exactly one value per entry. Everything that scrubs, slices or labels
// time reads this rather than a specific telemetry file.
export let CURRENT_TIMESTAMPS = [];

// "Now" as a Date, for work-item lateness.
export let WORK_NOW_REFERENCE = new Date(`${CURRENT_TIMELINE.date}T${CURRENT_TIMELINE.end}:00`);

export function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToShiftDate(mins) {
  const [y, mo, d] = CURRENT_TIMELINE.date.split('-').map(Number);
  return new Date(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
}

function applyTimeline(timeline, timestamps) {
  if (timeline) CURRENT_TIMELINE = timeline;
  CURRENT_TIMESTAMPS = timestamps || [];
  WORK_NOW_REFERENCE = new Date(`${CURRENT_TIMELINE.date}T${CURRENT_TIMELINE.end}:00`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

// Which variable each models.json file role fills (roles and default file
// names live in modelRegistry.js). Unknown roles are ignored.
const ROLE_TO_VARIABLE = {
  assets: 'ASSETS',
  assetRelationships: 'ASSET_RELATIONSHIPS',
  properties: 'PROPERTIES',
  assetValues: 'ASSET_VALUES',
  assetTelemetry: 'ASSET_TELEMETRY',
  unitStatus: 'UNIT_STATUS',
  attentionItems: 'ATTENTION_ITEMS',
  workItems: 'INITIAL_WORK_ITEMS',
  explanations: 'EXPLANATIONS',
};

// Every model-data variable, reset before each load so switching models
// never leaves the previous model's data behind in a role the new one
// doesn't fill (an optional file like explanations.json, for example).
function resetModelData() {
  CURRENT_ASSET_DATA = [];
  CURRENT_ASSET_MAP = {};
  ASSET_RELATIONSHIPS = [];
  ASSET_VALUES = {};
  ASSET_TELEMETRY = null;
  PROPERTY_LABELS = {};
  PROPERTY_CATEGORIES = {};
  PROPERTY_TIERS = {};
  PROPERTY_RANGES = {};
  PROPERTY_UNITS = {};
  PROPERTY_DECIMALS = {};
  PROPERTY_DERIVATIONS = [];
  TYPE_LABELS = {};
  UNIT_STATUS_TILES = [];
  UNIT_OPERATING_CONTEXT = {};
  ATTENTION_ITEMS = [];
  INITIAL_WORK_ITEMS = [];
  EXPLANATIONS = null;
}

// properties.json → one lookup per attribute.
function assignProperties(value) {
  Object.entries(value?.properties || {}).forEach(([key, meta]) => {
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

// unit-status.json → the Now strip's tiles, one per unit-level asset.
function assignUnitStatus(unitStatus) {
  CURRENT_ASSET_DATA
    .filter(a => a.assetLevel === CURRENT_UNIT_LEVEL)
    .forEach(unit => {
      const status = unitStatus?.[unit.id] || {};
      UNIT_STATUS_TILES.push({
        id: unit.id,
        label: unit.name,
        state: status.state || 'running',
        statusSinceMinutes: status.statusSinceMinutes ?? null,
      });
      if (status.mode || status.product) {
        UNIT_OPERATING_CONTEXT[unit.id] = { mode: status.mode || 'STEADY', product: status.product || '' };
      }
    });
}

// Work items carry real Date objects elsewhere in the app (margin maths,
// formatting); JSON carries local ISO strings, parsed once here.
function parseWorkItemDates(items) {
  return items.map(item => ({
    ...item,
    plannedStart: item.plannedStart ? new Date(item.plannedStart) : null,
    dueAt: item.dueAt ? new Date(item.dueAt) : null,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    createdAt: item.createdAt ? new Date(item.createdAt) : null,
  }));
}

// Makes a freshly fetched model the active one. `files` is the
// [role, url, optional] list from getModelDataFiles; `results` holds each
// file's parsed JSON (null for an optional file that wasn't there).
export function activateLoadedModel(model, files, results) {
  resetModelData();
  const byRole = {};
  files.forEach(([role], i) => { byRole[ROLE_TO_VARIABLE[role]] = results[i]; });

  CURRENT_MODEL = model.id;
  CURRENT_LEVEL_LABELS = Object.fromEntries(model.levels.map(l => [l.id, l.label]));
  CURRENT_UNIT_LEVEL = model.unitLevel;
  CURRENT_ASSET_DATA = byRole.ASSETS || [];
  CURRENT_ASSET_DATA.forEach(a => { CURRENT_ASSET_MAP[a.id] = a; });
  ASSET_RELATIONSHIPS = byRole.ASSET_RELATIONSHIPS || [];
  assignProperties(byRole.PROPERTIES);
  ASSET_VALUES = byRole.ASSET_VALUES || {};
  ASSET_TELEMETRY = byRole.ASSET_TELEMETRY || null;
  assignUnitStatus(byRole.UNIT_STATUS);
  ATTENTION_ITEMS = byRole.ATTENTION_ITEMS || [];
  INITIAL_WORK_ITEMS = parseWorkItemDates(byRole.INITIAL_WORK_ITEMS || []);
  EXPLANATIONS = byRole.EXPLANATIONS?.items ? byRole.EXPLANATIONS : null;
  applyTimeline(ASSET_TELEMETRY?.timeline, ASSET_TELEMETRY?.timestamps);
}
