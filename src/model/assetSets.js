// model/assetSets.js
// Asset sets: a saved, named way of producing a list of asset ids from the
// loaded model. The Asset Sets area (designer/assetSets/) defines them;
// later, a repeater on a screen will take one and draw a screen per asset.
//
// Every set, whatever its kind, resolves to the same thing — an ordered
// list of asset ids:
//
//   picked  a hand-chosen list of assets.
//   rule    filters re-checked every time the set is used: where to look,
//           which types, attention state, property conditions, and
//           optionally "keep only the lowest/highest N by a property"
//           (the best- or worst-performing).
//   query   a query whose rows name assets. Not built yet — the kind exists
//           so definitions and the editor already have a place for it.
//
// A rule can look under a fixed asset, or under a START asset it's given
// when it's used — the way a query takes inputs. "Turbines of a feeder" is
// one definition; a feeder screen would use it with start = self.
//
// A set belongs to one industry model (its ids and types only exist in that
// pack), recorded as modelId. Everything here reads whichever model is
// active (modelData.js), so resolve a set only while its own model is loaded.

import { ASSET_VALUES, ATTENTION_ITEMS, CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, PROPERTY_LABELS } from './modelData';
import { assetTypeIdOf, buildTypeList } from './assetQueries';

export const SET_KINDS = [
  { value: 'picked', label: 'Picked', hint: 'Choose the assets yourself' },
  { value: 'rule', label: 'Rule', hint: 'Filters re-checked every time the set is used' },
  { value: 'query', label: 'Query', hint: 'Assets named by a query’s rows (coming later)', disabled: true },
];

export const START_MODES = [
  { value: 'model', label: 'The whole model' },
  { value: 'asset', label: 'Under a specific asset' },
  { value: 'parameter', label: 'Under the asset it’s given (start)' },
];

export const DEPTHS = [
  { value: 'descendants', label: 'Everything below it' },
  { value: 'children', label: 'Direct children only' },
];

export const ATTENTION_FILTERS = [
  { value: 'any', label: 'Any' },
  { value: 'open', label: 'Has an open attention item (on it or below)' },
  { value: 'none', label: 'Has no open attention item' },
];

export const CONDITION_OPS = [
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
];

export const RANK_MODES = [
  { value: 'all', label: 'Keep all that match' },
  { value: 'lowest', label: 'Keep the lowest' },
  { value: 'highest', label: 'Keep the highest' },
];

export const DEFAULT_RULE = {
  start: { mode: 'model', assetId: null },
  depth: 'descendants',
  typeIds: [],
  attention: 'any',
  conditions: [],
  rank: { mode: 'all', key: null, count: 5 },
};

export function makeNewAssetSet({ id, modelId, name = 'Untitled Asset Set' }) {
  return {
    id,
    name,
    description: '',
    modelId,
    kind: 'rule',
    picked: { assetIds: [] },
    rule: DEFAULT_RULE,
  };
}

// Whether a set needs a start asset handed to it before it can resolve.
export function needsStart(set) {
  return set?.kind === 'rule' && set.rule?.start?.mode === 'parameter';
}

// ─────────────────────────────────────────────────────────────────────────────
// Walking the hierarchy
// ─────────────────────────────────────────────────────────────────────────────

function childrenIndex() {
  const index = new Map();
  CURRENT_ASSET_DATA.forEach(a => {
    if (a.parentId == null) return;
    if (!index.has(a.parentId)) index.set(a.parentId, []);
    index.get(a.parentId).push(a);
  });
  return index;
}

// Every asset below rootId, in the model's own (depth-first) order.
function descendantsOf(rootId, index) {
  const below = new Set();
  const stack = [...(index.get(rootId) || [])];
  while (stack.length) {
    const a = stack.pop();
    if (below.has(a.id)) continue;
    below.add(a.id);
    stack.push(...(index.get(a.id) || []));
  }
  return CURRENT_ASSET_DATA.filter(a => below.has(a.id));
}

// Assets that have an open attention item on themselves or anywhere below
// them — an item names the component it's about (a turbine's HS bearing),
// and the turbine above it counts as affected too.
function assetsWithOpenAttention() {
  const affected = new Set();
  ATTENTION_ITEMS
    .filter(item => item?.detail?.outcomeStatus !== 'resolved')
    .forEach(item => {
      let current = CURRENT_ASSET_MAP[item.assetId];
      while (current && !affected.has(current.id)) {
        affected.add(current.id);
        current = current.parentId != null ? CURRENT_ASSET_MAP[current.parentId] : null;
      }
    });
  return affected;
}

export function propertyValue(assetId, key) {
  const v = ASSET_VALUES[assetId]?.[key];
  return typeof v === 'number' ? v : null;
}

function passes(value, op, target) {
  switch (op) {
    case '<': return value < target;
    case '<=': return value <= target;
    case '>': return value > target;
    case '>=': return value >= target;
    case '=': return value === target;
    case '!=': return value !== target;
    default: return true;
  }
}

// A condition only counts once it's complete — a half-filled row in the
// editor doesn't empty the set.
export function isCompleteCondition(c) {
  return !!c?.key && !!c.op && typeof c.value === 'number' && !Number.isNaN(c.value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolving
// ─────────────────────────────────────────────────────────────────────────────

// → { assetIds, steps, error }
//   assetIds  the set, in order
//   steps     [{ label, count }] — how a rule narrowed things down, for the
//             editor's preview ("24 turbines → 22 with a value → lowest 5")
//   error     why it couldn't resolve (e.g. it needs a start asset), or null
export function resolveAssetSet(set, { start = null } = {}) {
  if (!set) return { assetIds: [], steps: [], error: 'No set' };
  if (set.kind === 'picked') {
    const picked = set.picked?.assetIds || [];
    const present = new Set(picked.filter(id => CURRENT_ASSET_MAP[id]));
    // Model order, so a picked set reads like the tree it was picked from.
    const assetIds = CURRENT_ASSET_DATA.filter(a => present.has(a.id)).map(a => a.id);
    const missing = picked.length - present.size;
    return {
      assetIds,
      steps: missing ? [{ label: `${missing} picked asset${missing === 1 ? '' : 's'} not in this model`, count: missing }] : [],
      error: null,
    };
  }
  if (set.kind === 'rule') return resolveRule({ ...DEFAULT_RULE, ...set.rule }, start);
  return { assetIds: [], steps: [], error: 'Query sets aren’t available yet' };
}

function resolveRule(rule, start) {
  const steps = [];
  const index = childrenIndex();

  // Where to look.
  let rootId = null;
  if (rule.start?.mode === 'asset') {
    rootId = rule.start.assetId;
    if (!rootId || !CURRENT_ASSET_MAP[rootId]) return { assetIds: [], steps, error: 'Pick the asset to look under' };
  } else if (rule.start?.mode === 'parameter') {
    rootId = start;
    if (!rootId || !CURRENT_ASSET_MAP[rootId]) return { assetIds: [], steps, error: 'This set needs a start asset' };
  }
  let assets = rootId == null
    ? CURRENT_ASSET_DATA
    : rule.depth === 'children' ? (index.get(rootId) || []) : descendantsOf(rootId, index);
  steps.push({ label: rootId == null ? 'in the model' : `${rule.depth === 'children' ? 'directly under' : 'under'} ${CURRENT_ASSET_MAP[rootId].name}`, count: assets.length });

  // Which types.
  if (rule.typeIds?.length) {
    const wanted = new Set(rule.typeIds);
    assets = assets.filter(a => wanted.has(assetTypeIdOf(a)));
    steps.push({ label: `of ${rule.typeIds.length === 1 ? 'that type' : 'those types'}`, count: assets.length });
  }

  // Attention.
  if (rule.attention === 'open' || rule.attention === 'none') {
    const affected = assetsWithOpenAttention();
    assets = assets.filter(a => affected.has(a.id) === (rule.attention === 'open'));
    steps.push({ label: rule.attention === 'open' ? 'with open attention' : 'with no open attention', count: assets.length });
  }

  // Property conditions, all of them (AND). An asset without the property
  // doesn't match.
  const conditions = (rule.conditions || []).filter(isCompleteCondition);
  if (conditions.length) {
    assets = assets.filter(a => conditions.every(c => {
      const v = propertyValue(a.id, c.key);
      return v != null && passes(v, c.op, c.value);
    }));
    steps.push({ label: `meeting ${conditions.length === 1 ? 'the condition' : `all ${conditions.length} conditions`}`, count: assets.length });
  }

  // Best / worst N.
  const rank = rule.rank || {};
  if ((rank.mode === 'lowest' || rank.mode === 'highest') && rank.key) {
    const withValue = assets.filter(a => propertyValue(a.id, rank.key) != null);
    if (withValue.length !== assets.length) steps.push({ label: `with a ${propertyLabel(rank.key)} value`, count: withValue.length });
    const dir = rank.mode === 'lowest' ? 1 : -1;
    const count = Math.max(1, Math.floor(rank.count || 1));
    assets = [...withValue]
      .sort((a, b) => dir * (propertyValue(a.id, rank.key) - propertyValue(b.id, rank.key)))
      .slice(0, count);
    steps.push({ label: `${rank.mode} ${count} by ${propertyLabel(rank.key)}`, count: assets.length });
  }

  return { assetIds: assets.map(a => a.id), steps, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// For the editor
// ─────────────────────────────────────────────────────────────────────────────

export function propertyLabel(key) {
  return PROPERTY_LABELS[key] || key;
}

// The properties any of these assets have values for — what a condition or
// ranking can use — as [{ key, label }], alphabetical by label.
export function propertiesOf(assets) {
  const keys = new Set();
  assets.forEach(a => Object.keys(ASSET_VALUES[a.id] || {}).forEach(k => keys.add(k)));
  return [...keys]
    .map(key => ({ key, label: propertyLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The assets a rule filters from, before any conditions or ranking: where
// it looks and which types. For a start-parameter rule, `start` stands in
// for the asset it will be given.
export function ruleCandidates(rule, start = null) {
  return resolveAssetSet({ kind: 'rule', rule: { ...rule, attention: 'any', conditions: [], rank: { mode: 'all' } } }, { start })
    .assetIds.map(id => CURRENT_ASSET_MAP[id]);
}

// A start asset that gives this set a non-empty preview, for defaulting the
// editor's "Preview with start" picker. Falls back to the first asset.
export function suggestStart(set) {
  const found = CURRENT_ASSET_DATA.find(a => resolveAssetSet(set, { start: a.id }).assetIds.length > 0);
  return (found || CURRENT_ASSET_DATA[0])?.id ?? null;
}

// One line describing a set, for the list: "Rule · lowest 5 by Power Curve
// Performance".
export function describeAssetSet(set) {
  if (set.kind === 'picked') {
    const n = set.picked?.assetIds?.length || 0;
    return `${n} picked`;
  }
  if (set.kind === 'query') return 'Query';
  const rule = { ...DEFAULT_RULE, ...set.rule };
  const typeNames = new Map(buildTypeList(CURRENT_ASSET_DATA).map(t => [t.id, t.name]));
  const parts = [];
  if (rule.typeIds.length) parts.push(rule.typeIds.map(id => typeNames.get(id) || id).join(', '));
  if (rule.start.mode === 'parameter') parts.push('under start');
  else if (rule.start.mode === 'asset') parts.push(`under ${CURRENT_ASSET_MAP[rule.start.assetId]?.name || '?'}`);
  if (rule.rank?.mode === 'lowest' || rule.rank?.mode === 'highest') {
    if (rule.rank.key) parts.push(`${rule.rank.mode} ${rule.rank.count} by ${propertyLabel(rule.rank.key)}`);
  }
  return parts.join(' · ') || 'Everything';
}
