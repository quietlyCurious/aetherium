// operator/model/assetQueries.js
// Read-only questions about the active model's data: an asset's current
// property values and series, its type id and display labels, its related
// assets, and how an attention item maps onto an asset. Every lookup is by
// real asset id (INDUSTRY_PACK_SPEC.md §3.2) — there are no id conversions.

import { ASSET_RELATIONSHIPS, ASSET_TELEMETRY, ASSET_VALUES, CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, CURRENT_LEVEL_LABELS, CURRENT_TIMESTAMPS, CURRENT_UNIT_LEVEL, EXPLANATIONS, PROPERTY_LABELS, TYPE_LABELS, timeStrToMinutes } from './modelData';

export function assetTypeIdOf(asset) {
  return `TYPE_${asset.assetLevel}_${asset.assetType}`;
}

// "Aurelia › A1 › Buffer" — the full path, since sibling assets of the
// same type (every line's Buffer) otherwise read identically in a list.
export function getAssetPathLabel(assetId) {
  const names = [];
  const seen = new Set();
  let current = CURRENT_ASSET_MAP[assetId];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId != null ? CURRENT_ASSET_MAP[current.parentId] : null;
  }
  return names.length ? names.join(' › ') : assetId;
}

// An attention item names its asset directly (item.assetId, spec §6.7), at any level.
export function getAttentionItemAssetEntry(item) {
  return (item?.assetId && CURRENT_ASSET_MAP[item.assetId]) || null;
}

export function getAttentionItemTypeId(item) {
  const match = getAttentionItemAssetEntry(item);
  return match ? assetTypeIdOf(match) : null;
}

// The full-timeline series of the property an item's evidence tracks
// (item.primaryProperty), or null if the item doesn't name one.
export function getAttentionItemPrimarySeries(item) {
  const entry = getAttentionItemAssetEntry(item);
  if (!entry || !item.primaryProperty) return null;
  const series = getAssetPropertySeries(entry.id, item.primaryProperty);
  return series && series.length === CURRENT_TIMESTAMPS.length ? series : null;
}

// The detector-built explanation for an attention item (spec §14), with
// the detector that produced it — or null, in which case the Investigate
// panel keeps the plain AI interpretation.
export function getAttentionItemExplanation(item) {
  const explanation = item && EXPLANATIONS?.items?.[item.id];
  if (!explanation) return null;
  return { explanation, detector: EXPLANATIONS.detectors?.[explanation.detectorId] || null };
}

// Whether an attention item's own narrative window — its evidencePoints'
// first to last reading, in "HH:MM" clock time, the same real window
// shown on its own Trend/Timeline tabs — contains a given scrubbed time.
// String comparison works directly since every timestamp here is
// zero-padded "HH:MM" (lexicographic order matches chronological order).
// Deliberately independent of the item's current/latest outcomeStatus —
// an item already "resolved" as of now can still correctly show as
// active when scrubbed back to a time within its own original window,
// since it genuinely was active then.
export function isAttentionItemActiveAtTime(attentionItem, timeStr) {
  const points = attentionItem?.detail?.evidencePoints;
  if (!points || points.length === 0 || !timeStr) return false;
  return timeStr >= points[0].time && timeStr <= points[points.length - 1].time;
}

// Human-readable label from a slugified assetType, e.g. "raw_water_pump" ->
// "Raw Water Pump". Deriving this from the type itself (rather than
// grabbing an instance's own `name` field) matters because that field is
// sometimes generic — a station's name literally IS its type, like "Intake"
// — but sometimes instance-specific, like a line's name being "A1", not
// "Line". De-slugifying the type works correctly either way.
export function deslugifyType(assetType) {
  // Generic packs can name a type explicitly (properties.json typeLabels)
  // where plain de-slugifying reads badly — "HS Bearing", not "Hs Bearing".
  if (TYPE_LABELS[assetType]) return TYPE_LABELS[assetType];
  return assetType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getLevelLabel(level) {
  return CURRENT_LEVEL_LABELS[level] || level;
}

// Builds a flat, alphabetically-sorted list of every distinct
// (assetLevel, assetType) combination found in the asset hierarchy. Each
// entry carries the id of one real, representative asset of that type —
// viewing "a type's properties" is just reading its representative
// instance's properties (every instance of a type has the same keys).
export function buildTypeList(assetData) {
  const seen = new Map();
  assetData.forEach(a => {
    const key = `${a.assetLevel}::${a.assetType}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: assetTypeIdOf(a),
        name: deslugifyType(a.assetType),
        level: getLevelLabel(a.assetLevel),
        exampleAssetId: a.id,
      });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// An asset's current property values ({ key: value }), or null if it has
// none. Works for any asset at any level.
export function getAssetProperties(assetId) {
  return ASSET_VALUES[assetId] || null;
}

export const HMI_CATEGORY_ORDER = ['Flow / WIP', 'Events / Losses', 'Stability', 'Quality', 'Derived Metric', 'Condition'];

// One property's full series for an asset (one value per timestamp), or
// null — static (nameplate) properties have no series, so their tiles just
// show no sparkline.
export function getAssetPropertySeries(assetId, propKey) {
  return ASSET_TELEMETRY?.series?.[assetId]?.[propKey] || null;
}

// Clips a full series down to [startTime, endTime] using the active model's
// own timestamp grid — the same window the Line/Candlestick tabs show for
// this item, via its evidencePoints. If that window reaches past what's
// actually available (a couple of items' evidence extends past the shared
// "now" reference as a projection), this naturally clips to real data
// rather than inventing future readings to match exactly.
export function sliceSeriesToRange(series, startTime, endTime) {
  if (!series || !CURRENT_TIMESTAMPS.length) return null;
  const grid = CURRENT_TIMESTAMPS.map(timeStrToMinutes);
  const startMin = timeStrToMinutes(startTime);
  const endMin = timeStrToMinutes(endTime);
  let startIdx = grid.findIndex(m => m >= startMin);
  if (startIdx === -1) startIdx = grid.length - 1;
  let endIdx = startIdx;
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i] <= endMin) { endIdx = i; break; }
  }
  if (endIdx < startIdx) endIdx = startIdx;
  return series.slice(startIdx, endIdx + 1);
}

// Returns the current visibility ('always'/'sometimes'/'never') for every
// property of a type — explicit overrides where a user has actually
// changed one, 'always' by default otherwise. Nothing is written to state
// until a user actually changes something.
export function getPropertyVisibilityForType(typeId, properties, typePropertyConfigs, assetId, assetPropertyConfigs) {
  const typeOverrides = typePropertyConfigs[typeId] || {};
  const assetOverrides = (assetId && assetPropertyConfigs?.[assetId]) || {};
  return Object.keys(properties || {}).map(key => ({
    key,
    label: PROPERTY_LABELS[key] || key,
    visibility: assetOverrides[key] || typeOverrides[key] || 'always',
  }));
}

const RELATIONSHIP_TYPE_LABELS = { feeds_into: 'Feeds into' };

const RELATIONSHIP_LAYER_LABELS = {
  process_flow: 'Process Flow',
  chemical_dosing: 'Chemical Dosing',
  backwash: 'Backwash',
  air_flow: 'Air Flow',
};

// label is null for most edges — falls back to relationshipType, plus the
// layer in parentheses when there's more than one kind of connection
// ("Feeds into (Backwash)" vs "Feeds into (Process Flow)"), since
// relationshipType alone is "feeds_into" for nearly every edge regardless
// of layer.
function formatRelationshipName(edge) {
  if (edge.label) return edge.label;
  const typeLabel = RELATIONSHIP_TYPE_LABELS[edge.relationshipType] || edge.relationshipType;
  const layerLabel = RELATIONSHIP_LAYER_LABELS[edge.layer];
  return layerLabel ? `${typeLabel} (${layerLabel})` : typeLabel;
}

// Finds every asset-relationship edge touching any real asset of the given
// type (as source or target), resolves the OTHER end of each edge to its
// own type, and collapses duplicates — e.g. six "Raw Water Pump" instances
// all feeding the same downstream type collapse to a single row, since the
// table is type-to-type, not instance-to-instance. The arrow in
// relationshipLabel shows direction: this type -> other, or other -> this
// type.
export function getRelatedAssetsForType(typeId, typeList) {
  const typeEntry = typeList.find(t => t.id === typeId);
  const exampleAsset = typeEntry && CURRENT_ASSET_MAP[typeEntry.exampleAssetId];
  if (!exampleAsset) return [];
  const sameTypeAssetIds = new Set(
    CURRENT_ASSET_DATA
      .filter(a => a.assetLevel === exampleAsset.assetLevel && a.assetType === exampleAsset.assetType)
      .map(a => a.id)
  );

  const rowsByKey = new Map();
  (ASSET_RELATIONSHIPS || []).forEach(edge => {
    const sourceIsSelf = sameTypeAssetIds.has(edge.sourceAssetId);
    const targetIsSelf = sameTypeAssetIds.has(edge.targetAssetId);
    if (!sourceIsSelf && !targetIsSelf) return;
    // A same-type-to-same-type edge (rare) counts as outgoing, matching
    // the source side.
    const direction = sourceIsSelf ? 'out' : 'in';
    const otherAssetId = sourceIsSelf ? edge.targetAssetId : edge.sourceAssetId;
    const otherAsset = CURRENT_ASSET_MAP[otherAssetId];
    if (!otherAsset) return;
    const relatedTypeId = assetTypeIdOf(otherAsset);
    const key = `${direction}::${relatedTypeId}::${edge.relationshipType}::${edge.layer}::${edge.label || ''}`;
    if (rowsByKey.has(key)) return;
    rowsByKey.set(key, {
      key,
      relatedTypeId,
      relatedTypeName: deslugifyType(otherAsset.assetType),
      relatedTypeExampleAssetId: otherAsset.id,
      direction,
      relationshipLabel: `${direction === 'out' ? '→' : '←'} ${formatRelationshipName(edge)}`,
      isContainment: false,
    });
  });

  // Containment (parentId-derived) — this type's own parent type, if its
  // instances have one, and any child types (types whose instances'
  // parentId points to an instance of this type). Deduped by type the
  // same way the flow rows above are, since e.g. every train's parent is
  // the same plant type. 'out' here means this type contains the other;
  // 'in' means this type is contained by the other — same arrow
  // convention as the flow rows, just for containment instead.
  CURRENT_ASSET_DATA.forEach(a => {
    if (!sameTypeAssetIds.has(a.id) || !a.parentId) return;
    const parent = CURRENT_ASSET_MAP[a.parentId];
    if (!parent) return;
    const relatedTypeId = assetTypeIdOf(parent);
    const key = `in::${relatedTypeId}::containment`;
    if (rowsByKey.has(key)) return;
    rowsByKey.set(key, {
      key,
      relatedTypeId,
      relatedTypeName: deslugifyType(parent.assetType),
      relatedTypeExampleAssetId: parent.id,
      direction: 'in',
      relationshipLabel: '← Contains',
      isContainment: true,
    });
  });
  CURRENT_ASSET_DATA.forEach(a => {
    if (!a.parentId || !sameTypeAssetIds.has(a.parentId)) return;
    const relatedTypeId = assetTypeIdOf(a);
    const key = `out::${relatedTypeId}::containment`;
    if (rowsByKey.has(key)) return;
    rowsByKey.set(key, {
      key,
      relatedTypeId,
      relatedTypeName: deslugifyType(a.assetType),
      relatedTypeExampleAssetId: a.id,
      direction: 'out',
      relationshipLabel: '→ Contains',
      isContainment: true,
    });
  });

  return [...rowsByKey.values()].sort((a, b) => a.relatedTypeName.localeCompare(b.relatedTypeName));
}

// Every same-type sibling shares an identical asset.name (all six "Bar
// Screen" instances are literally named "Bar Screen", distinguished only
// by which train they belong to) — so a plain node label would be
// ambiguous in a diagram showing every instance at once. This walks up
// parentId to the nearest ancestor whose own parent is the root (the
// train, for water/wastewater), and prepends its name — "T01 · Bar
// Screen" — unless the asset itself already IS that top-level ancestor
// (a train node) or the root itself (the plant), neither of which needs
// disambiguating.
// Generic packs (spec §3.2): the names on the asset's path, starting at
// its unit-level ancestor — "WTG-07 · Gearbox · HS Bearing". The unit
// level is what an operator thinks in, so it's the natural anchor however
// deep or shallow the model is. Assets above the unit level (a site, a
// feeder) have no unit ancestor and just show their own name.
function getGenericDisplayLabel(asset) {
  const names = [];
  let current = asset;
  while (current) {
    names.unshift(current.name);
    if (current.assetLevel === CURRENT_UNIT_LEVEL) return names.join(' · ');
    current = current.parentId ? CURRENT_ASSET_MAP[current.parentId] : null;
  }
  return asset.name;
}

export function getAssetDisplayLabel(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  return asset ? getGenericDisplayLabel(asset) : assetId;
}

// Asset-level counterpart to getAllTypeRelationshipsForModel above — one
// node per real asset instance (127 for the wastewater model) rather than
// one per type (21), so All Assets shows and lets the user toggle
// visibility on the actual physical assets, not a type-level abstraction.
// Flow edges come straight from ASSET_RELATIONSHIPS with no
// deduplication needed, since it's already asset-to-asset. Containment
// edges are derived here from parentId — every asset with a parent gets
// a parent->child edge — giving container-level assets (plant/train/
// stage) and the handful of equipment with no process-flow edge at all
// (mixers, sludge collectors, scum skimmers — their relationship to
// their vessel is containment, not flow) something to actually connect
// to, rather than floating disconnected. Each edge carries isContainment
// so the diagram can give the two kinds their own distinct visual
// treatment, per docs/circuit-board-vision-notes.md's note that
// containment shouldn't just be folded in indistinguishably from flow.
// Containment edges (parent->child) get a visibly different treatment
// from flow edges — lighter and dashed rather than the default solid
// stroke — so the two relationship kinds read as distinct at a glance
// rather than being folded into one undifferentiated line style.
export const CONTAINMENT_EDGE_STYLE = { stroke: '#bbb', strokeDasharray: '5 5' };

export function getAllAssetRelationshipsForModel() {
  const nodes = CURRENT_ASSET_DATA.map(a => ({
    assetId: a.id,
    assetName: getAssetDisplayLabel(a.id),
    typeId: assetTypeIdOf(a),
  }));
  const flowEdges = (ASSET_RELATIONSHIPS || [])
    .filter(e => CURRENT_ASSET_MAP[e.sourceAssetId] && CURRENT_ASSET_MAP[e.targetAssetId])
    .map(e => ({
      key: `${e.sourceAssetId}::${e.targetAssetId}::${e.relationshipType}::${e.layer}::${e.label || ''}`,
      sourceAssetId: e.sourceAssetId,
      targetAssetId: e.targetAssetId,
      relationshipLabel: formatRelationshipName(e),
      isContainment: false,
    }));
  const containmentEdges = CURRENT_ASSET_DATA
    .filter(a => a.parentId)
    .map(a => ({
      key: `containment::${a.parentId}::${a.id}`,
      sourceAssetId: a.parentId,
      targetAssetId: a.id,
      relationshipLabel: 'Contains',
      isContainment: true,
    }));
  return { nodes, edges: [...flowEdges, ...containmentEdges] };
}
