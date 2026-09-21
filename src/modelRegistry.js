// modelRegistry.js
// Reads public/data/models.json — the one list of every simulated industry
// model the app knows about (refinery, water, wastewater, …). Both the
// title-bar model switcher (App.js) and OperatorWorkspace's data loader
// read from here, so adding a new industry pack is a data-only change:
// drop its folder into public/data/<id>/ and add one entry to models.json.
// See INDUSTRY_PACK_SPEC.md §9.
//
// models.json shape:
//   [{ id, label, shape, files? }]
//     id     — folder name under public/data/, also the model-switcher id
//              and the key nowSelectionStorage saves under
//     label  — what the model switcher shows
//     shape  — 'generic' (any depth, data keyed by asset id — every new
//              pack, see INDUSTRY_PACK_SPEC.md), or one of the two legacy
//              shapes: 'four-level' (plant/train/stage/equipment, water
//              and wastewater) and 'refinery' (3 levels, hierarchy is the
//              static ASSET_DATA import)
//     levels — generic only: [{ id, label }] root first, one per
//              assetLevel used in assets.json
//     unitLevel — generic only: the level whose assets get Now-strip tiles
//     files  — optional per-role filename overrides, merged over the
//              shape's defaults below. Legacy packs use it for their own
//              names; generic packs use it to add an optional role such as
//              explanations (see OPTIONAL_ROLES).

export const MODEL_SHAPES = {
  GENERIC: 'generic',
  FOUR_LEVEL: 'four-level',
  REFINERY: 'refinery',
};

// Role -> default filename (relative to /data/<id>/). Roles map 1:1 onto
// OperatorWorkspace's model-data variables (see ROLE_TO_VARIABLE there).
// A role whose default is absent from a shape simply isn't loaded for that
// shape — e.g. refinery has no equipment level, four-level packs have no
// line-level sparklines.
const COMMON_FILES = {
  attentionItems: 'attention-items.json',
  workItems: 'work-items.json',
  lineStatus: 'line-status.json',
  operatingContext: 'operating-context.json',
  lineRollups: 'line-rollups.json',
  stationMetrics: 'station-metrics.json',
  stationTelemetry: 'station-telemetry.json',
  lineTelemetry: 'line-telemetry.json',
  stationSparklines: 'station-sparklines.json',
  propertyCategories: 'property-categories.json',
  propertyLabels: 'property-labels.json',
  propertyRanges: 'property-ranges.json',
  propertyTiers: 'property-tiers.json',
  stationFullProperties: 'station-full-properties.json',
  assetRelationships: 'asset-relationships.json',
};

export const DEFAULT_FILES_BY_SHAPE = {
  // The generic 8-file layout (spec §6) shares nothing with the legacy
  // 20-file layout, so it doesn't build on COMMON_FILES.
  [MODEL_SHAPES.GENERIC]: {
    assets: 'assets.json',
    assetRelationships: 'asset-relationships.json',
    properties: 'properties.json',
    assetValues: 'asset-values.json',
    assetTelemetry: 'asset-telemetry.json',
    unitStatus: 'unit-status.json',
    attentionItems: 'attention-items.json',
    workItems: 'work-items.json',
  },
  [MODEL_SHAPES.FOUR_LEVEL]: {
    ...COMMON_FILES,
    plantRollups: 'plant-rollups.json',
    plantTelemetry: 'plant-telemetry.json',
    assetData: 'asset-data.json',
    equipmentMetrics: 'equipment-metrics.json',
    equipmentTelemetry: 'equipment-telemetry.json',
  },
  [MODEL_SHAPES.REFINERY]: {
    ...COMMON_FILES,
    plantRollups: 'refinery-rollups.json',
    plantTelemetry: 'refinery-telemetry.json',
    lineSparklines: 'line-sparklines.json',
  },
};

// Roles a pack adds only when it has them, by listing them in its
// models.json "files" block — explanations.json is written by a pack's
// detectors (INDUSTRY_PACK_SPEC.md §14), so only packs with detectors list
// it. A listed optional file that fails to load comes through as null
// instead of failing the whole model.
export const OPTIONAL_ROLES = new Set(['explanations']);

const MODELS_URL = '/data/models.json';

let registryPromise = null;

function normalizeEntry(entry) {
  const shape = entry.shape || MODEL_SHAPES.FOUR_LEVEL;
  const defaults = DEFAULT_FILES_BY_SHAPE[shape];
  if (!defaults) throw new Error(`models.json: "${entry.id}" has unknown shape "${shape}"`);
  const model = {
    id: entry.id,
    label: entry.label || entry.id,
    shape,
    files: { ...defaults, ...(entry.files || {}) },
    levels: null,
    unitLevel: null,
  };
  if (shape === MODEL_SHAPES.GENERIC) {
    if (!Array.isArray(entry.levels) || entry.levels.length === 0) {
      throw new Error(`models.json: "${entry.id}" (generic) needs a non-empty "levels" list`);
    }
    model.levels = entry.levels.map(l => (typeof l === 'string' ? { id: l, label: l } : { id: l.id, label: l.label || l.id }));
    model.unitLevel = entry.unitLevel;
    if (!model.levels.some(l => l.id === model.unitLevel)) {
      throw new Error(`models.json: "${entry.id}" unitLevel "${entry.unitLevel}" is not one of its levels`);
    }
  }
  return model;
}

// Fetched once per page load and shared by every caller — App.js and
// OperatorWorkspace both ask for it on mount, and a model switch never
// needs a re-fetch since the list itself doesn't change at runtime.
// A failed fetch clears the cache so a later call can retry.
export function loadModelRegistry() {
  if (!registryPromise) {
    registryPromise = fetch(MODELS_URL)
      .then(r => {
        if (!r.ok) throw new Error(`${MODELS_URL} — ${r.status}`);
        return r.json();
      })
      .then(list => {
        if (!Array.isArray(list) || list.length === 0) throw new Error(`${MODELS_URL} must be a non-empty array`);
        const models = list.map(normalizeEntry);
        const ids = new Set();
        models.forEach(m => {
          if (!m.id) throw new Error(`${MODELS_URL}: every entry needs an id`);
          if (ids.has(m.id)) throw new Error(`${MODELS_URL}: duplicate id "${m.id}"`);
          ids.add(m.id);
        });
        return models;
      })
      .catch(err => {
        registryPromise = null;
        throw err;
      });
  }
  return registryPromise;
}

// [role, url, optional] triples for one model, ready to fetch.
export function getModelDataFiles(model) {
  return Object.entries(model.files).map(([role, file]) => [role, `/data/${model.id}/${file}`, OPTIONAL_ROLES.has(role)]);
}
