// model/assetPaths.js
// Paths from one asset to another, for screens that are about an asset
// ("self"). A type screen binds to "self's gearbox's oil temperature", not
// to one particular gearbox, so the same screen works for every turbine of
// that type. The path is followed again from whichever asset the screen is
// showing.
//
// A path is an array of steps, each one of:
//   '..'         up to the parent
//   '<assetType>' down to the one child of that type ('drivetrain', 'gearbox')
// [] is self. ['drivetrain', 'gearbox'] is self › Drivetrain › Gearbox.
//
// Steps go by type rather than by id, which is what lets one path work for
// every asset of a type. A step down has to find exactly one child: none
// means the path doesn't exist on this asset, several means it's a set
// (that's what a repeater and asset sets are for), and either way a
// single-value binding can't use it.
//
// Reads the active model (modelData.js), like everything in model/.

import { ASSET_TELEMETRY, ASSET_VALUES, CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, CURRENT_TIMESTAMPS, PROPERTY_LABELS } from './modelData';
import { assetTypeIdOf, deslugifyType } from './assetQueries';

export const PARENT = '..';

// How far the "reachable from self" tree goes: up to two ancestors, and
// three levels down (a turbine's component's sub-component).
const MAX_UP = 2;
const MAX_DOWN = 3;

function childrenOf(assetId) {
  return CURRENT_ASSET_DATA.filter(a => a.parentId === assetId);
}

export function assetsOfType(typeId) {
  return CURRENT_ASSET_DATA.filter(a => assetTypeIdOf(a) === typeId);
}

export function typeExists(typeId) {
  return CURRENT_ASSET_DATA.some(a => assetTypeIdOf(a) === typeId);
}

// → { assetId } or { error: 'none' | 'many' | 'noParent' | 'noAsset', step }
export function followPath(startId, path = []) {
  let current = CURRENT_ASSET_MAP[startId];
  if (!current) return { error: 'noAsset', step: -1 };
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (step === PARENT) {
      current = current.parentId != null ? CURRENT_ASSET_MAP[current.parentId] : null;
      if (!current) return { error: 'noParent', step: i };
      continue;
    }
    const matches = childrenOf(current.id).filter(c => c.assetType === step);
    if (matches.length === 0) return { error: 'none', step: i };
    if (matches.length > 1) return { error: 'many', step: i };
    current = matches[0];
  }
  return { assetId: current.id };
}

// The current value an asset binding points at, from `startId`.
// → { value } or { error } (a path error, or 'noValue' when the asset it
// reaches doesn't have that property).
export function resolveAssetValue(startId, path, property) {
  const found = followPath(startId, path);
  if (found.error) return { error: found.error };
  const value = ASSET_VALUES[found.assetId]?.[property];
  return value === undefined ? { error: 'noValue' } : { value, assetId: found.assetId };
}

// The property's whole series as rows, for a collection property (a chart
// or grid): [{ timestamp, value }], one per timestamp — the column names
// historian query rows use, which a Chart expects by default. An error
// ('noSeries') for a static property: nameplate values have no history.
export function resolveAssetSeries(startId, path, property) {
  const found = followPath(startId, path);
  if (found.error) return { error: found.error };
  const series = ASSET_TELEMETRY?.series?.[found.assetId]?.[property];
  if (!Array.isArray(series)) return { error: 'noSeries' };
  return { rows: series.map((value, i) => ({ timestamp: CURRENT_TIMESTAMPS[i], value })) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Describing paths
// ─────────────────────────────────────────────────────────────────────────────

export function pathKey(path) {
  return path.length ? path.join('/') : 'self';
}

// "self › Drivetrain › Gearbox", "self › parent"
export function describePath(path) {
  return ['self', ...path.map(step => (step === PARENT ? 'parent' : deslugifyType(step)))].join(' › ');
}

export function describeAssetBinding(binding) {
  if (!binding) return '';
  const property = PROPERTY_LABELS[binding.property] || binding.property;
  return `${describePath(binding.path || [])} · ${property}`;
}

export const PATH_ERRORS = {
  none: 'doesn’t exist on this asset',
  many: 'finds more than one asset',
  noParent: 'goes above the top of the hierarchy',
  noAsset: 'has no asset to start from',
  noValue: 'the asset it reaches has no such property',
  noSeries: 'that property has no history',
};

// ─────────────────────────────────────────────────────────────────────────────
// What's reachable from a type
// ─────────────────────────────────────────────────────────────────────────────

// Every path worth offering from assets of `typeId`, checked against every
// instance of the type — because "every geared turbine has one gearbox" is
// what makes a path safe to bind a type screen to.
//
// → [{ key, path, label, typeLabel, depth, properties, reach }] in tree order:
//   self, then its ancestors, then its children depth-first.
//   properties  [{ key, label }] — what the assets it reaches have
//   reach       { ok, of }: how many instances the path finds exactly one
//               asset for. ok < of means some instances would show nothing.
export function reachableFrom(typeId) {
  const instances = assetsOfType(typeId);
  if (instances.length === 0) return [];
  const nodes = [];

  const addNode = (path, depth) => {
    const reached = instances.map(a => followPath(a.id, path)).filter(r => r.assetId).map(r => CURRENT_ASSET_MAP[r.assetId]);
    if (reached.length === 0) return null;
    const keys = new Set();
    reached.forEach(a => Object.keys(ASSET_VALUES[a.id] || {}).forEach(k => keys.add(k)));
    const node = {
      key: pathKey(path),
      path,
      label: path.length === 0 ? 'self' : (path[path.length - 1] === PARENT ? 'parent' : deslugifyType(path[path.length - 1])),
      typeLabel: deslugifyType(reached[0].assetType),
      depth,
      properties: [...keys].map(key => ({ key, label: PROPERTY_LABELS[key] || key })).sort((a, b) => a.label.localeCompare(b.label)),
      reach: { ok: reached.length, of: instances.length },
    };
    nodes.push(node);
    return reached;
  };

  addNode([], 0);

  // Up: parent, grandparent.
  let up = [];
  for (let i = 0; i < MAX_UP; i++) {
    up = [...up, PARENT];
    if (!addNode(up, 0)) break;
  }

  // Down: child types that appear exactly once under an instance, grouped
  // by type across all instances.
  const walkDown = (path, depth) => {
    if (depth > MAX_DOWN) return;
    const parents = instances.map(a => followPath(a.id, path)).filter(r => r.assetId).map(r => r.assetId);
    const childTypes = [];
    parents.forEach(pid => {
      const counts = new Map();
      childrenOf(pid).forEach(c => counts.set(c.assetType, (counts.get(c.assetType) || 0) + 1));
      counts.forEach((n, t) => { if (n === 1 && !childTypes.includes(t)) childTypes.push(t); });
    });
    childTypes.forEach(t => {
      const childPath = [...path, t];
      if (addNode(childPath, depth)) walkDown(childPath, depth + 1);
    });
  };
  walkDown([], 1);

  return nodes;
}

// How a binding fares against every instance of a type:
// 'ok' (works for all), 'partial' (some) or 'broken' (none).
export function checkAssetBinding(binding, typeId) {
  const instances = assetsOfType(typeId);
  if (instances.length === 0) return { status: 'broken', ok: 0, of: 0 };
  const ok = instances.filter(a => !resolveAssetValue(a.id, binding.path || [], binding.property).error).length;
  return { status: ok === instances.length ? 'ok' : ok === 0 ? 'broken' : 'partial', ok, of: instances.length };
}
