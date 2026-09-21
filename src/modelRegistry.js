// modelRegistry.js
// Reads public/data/models.json — the one list of every simulated industry
// model the app knows about (refinery, water, wind, …). Both the title-bar
// model switcher (App.js) and OperatorWorkspace's data loader read from
// here, so adding an industry pack is a data-only change: drop its folder
// into public/data/<id>/ and add one entry to models.json.
// See INDUSTRY_PACK_SPEC.md §6 and §9.
//
// models.json shape:
//   [{ id, label, levels, unitLevel, files? }]
//     id        — folder name under public/data/, also the model-switcher id
//                 and the key per-model saved state uses
//     label     — what the model switcher shows
//     levels    — [{ id, label }] root first, one per assetLevel in assets.json
//     unitLevel — the level whose assets are units of operation (Now-strip tiles)
//     files     — optional per-role filenames, merged over DEFAULT_FILES; a
//                 pack uses it to add an optional role such as explanations

// Role -> default filename (relative to /data/<id>/). Roles map 1:1 onto
// modelData.js's variables (see ROLE_TO_VARIABLE there).
export const DEFAULT_FILES = {
  assets: 'assets.json',
  assetRelationships: 'asset-relationships.json',
  properties: 'properties.json',
  assetValues: 'asset-values.json',
  assetTelemetry: 'asset-telemetry.json',
  unitStatus: 'unit-status.json',
  attentionItems: 'attention-items.json',
  workItems: 'work-items.json',
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
  if (!entry.id) throw new Error(`${MODELS_URL}: every entry needs an id`);
  if (!Array.isArray(entry.levels) || entry.levels.length === 0) {
    throw new Error(`models.json: "${entry.id}" needs a non-empty "levels" list`);
  }
  const levels = entry.levels.map(l => (typeof l === 'string' ? { id: l, label: l } : { id: l.id, label: l.label || l.id }));
  if (!levels.some(l => l.id === entry.unitLevel)) {
    throw new Error(`models.json: "${entry.id}" unitLevel "${entry.unitLevel}" is not one of its levels`);
  }
  const unknown = Object.keys(entry.files || {}).filter(role => !(role in DEFAULT_FILES) && !OPTIONAL_ROLES.has(role));
  if (unknown.length) throw new Error(`models.json: "${entry.id}" has unknown file roles ${unknown.join(', ')}`);
  return {
    id: entry.id,
    label: entry.label || entry.id,
    files: { ...DEFAULT_FILES, ...(entry.files || {}) },
    levels,
    unitLevel: entry.unitLevel,
  };
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
