// operator/model/assetQueries.js
// Read-only questions about the active model's data: an asset's current
// property values and series, its type id and display labels, its related
// assets, and how an attention item maps onto an asset. Handles all three
// model shapes (generic, four-level, refinery) behind one set of functions,
// so callers never branch on the model themselves.

import { MODEL_SHAPES } from '../../modelRegistry';
import { ASSET_RELATIONSHIPS, ASSET_TELEMETRY, ASSET_VALUES, CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, CURRENT_LEVEL_LABELS, CURRENT_MODEL_SHAPE, CURRENT_TIMESTAMPS, CURRENT_UNIT_LEVEL, EQUIPMENT_METRICS, EQUIPMENT_TELEMETRY, LINE_ROLLUPS, LINE_STATUS, LINE_TELEMETRY, PROPERTY_LABELS, REFINERY_ROLLUPS, REFINERY_TELEMETRY, STATION_FULL_PROPERTIES, STATION_TELEMETRY, TYPE_LABELS, timeToMinutes } from './modelData';

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

// "Refinery · Line · Station" (how attention items name their asset) ->
// the nextgen workbook's own station id format ("FER_L02_POWERCHARGE").
// Only resolves for station-level assets — line-wide items (2-part asset
// strings, e.g. "Ferrum · F4") have no single station to look up.
export function attentionAssetToStationId(asset) {
  const parts = asset.split(' · ');
  if (parts.length < 3) return null;
  const [refinery, line, station] = parts;
  const prefix = refinery === 'Aurelia' ? 'AUR' : 'FER';
  const num = line.slice(1).padStart(2, '0');
  const stationSuffix = station.replace(/\s+/g, '').toUpperCase();
  return `${prefix}_L${num}_${stationSuffix}`;
}

// Same "Refinery · Line · Station"-style asset naming as
// attentionAssetToStationId above, but resolved against CURRENT_ASSET_DATA
// directly (e.g. "CONFLUENCE_T03_AERATION", "FERRUM_F2_POWER_CHARGE")
// rather than the refinery-specific STATION_METRICS convention that
// attentionAssetToStationId targets: segments uppercased with
// spaces→underscores, joined by underscores, then looked up directly.
// This resolves for all three models — wastewater and water load theirs
// from a fetched JSON file, while refinery's is the hardcoded ASSET_DATA
// constant in assetData.js, but CURRENT_ASSET_DATA points to whichever
// applies either way. Returns null only if an attention item's asset
// string doesn't actually match any real asset id.
function attentionAssetToAssetEntry(asset) {
  const assetId = asset
    .split(' · ')
    .map(segment => segment.trim().toUpperCase().replace(/\s+/g, '_'))
    .join('_');
  return CURRENT_ASSET_DATA.find(a => a.id === assetId) || null;
}

function attentionAssetToTypeId(asset) {
  const match = attentionAssetToAssetEntry(asset);
  return match ? `TYPE_${match.assetLevel}_${match.assetType}` : null;
}

// Item-level entry points — generic packs name the asset directly
// (item.assetId, spec §6.7), at any level; legacy items only carry the
// display label, which gets parsed as before.
export function getAttentionItemAssetEntry(item) {
  if (item.assetId) return CURRENT_ASSET_MAP[item.assetId] || null;
  return attentionAssetToAssetEntry(item.asset);
}

export function getAttentionItemTypeId(item) {
  const match = getAttentionItemAssetEntry(item);
  return match ? `TYPE_${match.assetLevel}_${match.assetType}` : null;
}

// The real full-timeline series behind an item's evidence, when the item
// says which property it tracks (generic packs: item.primaryProperty).
// Null for legacy items, which fall back to the padded evidence below.
export function getAttentionItemPrimarySeries(item) {
  if (!item.primaryProperty) return null;
  const entry = getAttentionItemAssetEntry(item);
  if (!entry) return null;
  const { sparklineSource } = resolveAssetProperties(entry.id);
  const series = getPropertySeriesForSource(sparklineSource, item.primaryProperty);
  return series && series.length === CURRENT_TIMESTAMPS.length ? series : null;
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

// ASSET_DATA (the real, shared asset model — e.g. "AURELIA_A1_INTAKE")
// and STATION_METRICS/STATION_TELEMETRY (this operator view's own data,
// e.g. "AUR_L01_INTAKE") use genuinely different ID conventions for the
// exact same stations. This converts the former to the latter by walking
// up to the station's line and refinery ancestors, rather than routing
// through a display string the way attentionAssetToStationId does.
function assetDataIdToStationId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'station') return null;
  const line = CURRENT_ASSET_MAP[asset.parentId];
  const refinery = line ? CURRENT_ASSET_MAP[line.parentId] : null;
  if (!line || !refinery) return null;
  const prefix = refinery.id.slice(0, 3);
  const num = line.name.replace(/\D/g, '').padStart(2, '0');
  const stationSuffix = asset.name.replace(/\s+/g, '').toUpperCase();
  return `${prefix}_L${num}_${stationSuffix}`;
}

// Same conversion, one level up — ASSET_DATA's "AURELIA_A1" to
// LINE_ROLLUPS' own "AUR_L01".
function assetDataIdToLineId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'line') return null;
  const refinery = CURRENT_ASSET_MAP[asset.parentId];
  if (!refinery) return null;
  const prefix = refinery.id.slice(0, 3);
  const num = asset.name.replace(/\D/g, '').padStart(2, '0');
  return `${prefix}_L${num}`;
}

// The single entry point for "what properties does this asset have" —
// works for any node in the shared hierarchy, regardless of level. It
// tries each known dataset in turn; each conversion function above already
// returns null by itself when the id isn't actually that level, so trying
// all of them here is safe and requires no level check of its own. The
// caller passes an assetId and gets back whatever's available (or isn't)
// — it never needs to know or branch on whether that id is a station, a
// line, or anything else.
// ASSET_DATA's refinery id ("AURELIA") already matches REFINERY_ROLLUPS'
// own key directly — no prefix/number translation needed, unlike stations
// and lines.
function assetDataIdToRefineryId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'refinery') return null;
  return asset.id;
}

function resolveRefineryAssetProperties(assetId) {
  const stationId = assetDataIdToStationId(assetId);
  if (stationId && STATION_FULL_PROPERTIES[stationId]) {
    return { properties: STATION_FULL_PROPERTIES[stationId], sparklineSource: { type: 'station', id: stationId } };
  }
  const lineId = assetDataIdToLineId(assetId);
  if (lineId && LINE_ROLLUPS[lineId]) {
    return { properties: LINE_ROLLUPS[lineId], sparklineSource: { type: 'line', id: lineId } };
  }
  const refineryId = assetDataIdToRefineryId(assetId);
  if (refineryId && REFINERY_ROLLUPS[refineryId]) {
    return { properties: REFINERY_ROLLUPS[refineryId], sparklineSource: { type: 'refinery', id: refineryId } };
  }
  // No other dataset exists — genuinely nothing to return, not a
  // fabricated aggregation.
  return { properties: null, sparklineSource: null };
}

// Water's own conversions — a different id scheme (plant name is already
// abbreviated to 3 letters, train name is already "T01" with no letter
// prefix to strip) and a 4th level (equipment) refinery doesn't have.
function waterAssetDataIdToStageId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'stage') return null;
  const train = CURRENT_ASSET_MAP[asset.parentId];
  const plant = train ? CURRENT_ASSET_MAP[train.parentId] : null;
  if (!train || !plant) return null;
  const prefix = plant.id.slice(0, 3);
  const stageSuffix = asset.assetType.replace(/_/g, '').toUpperCase();
  return `${prefix}_${train.name}_${stageSuffix}`;
}

function waterAssetDataIdToTrainId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'train') return null;
  const plant = CURRENT_ASSET_MAP[asset.parentId];
  if (!plant) return null;
  const prefix = plant.id.slice(0, 3);
  // line-rollups.json uses this plant-name-plus-abbreviated-id format
  return `${plant.id}_${prefix}_${asset.name}`;
}

function waterAssetDataIdToPlantId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'plant') return null;
  return asset.id;
}

// Equipment-metrics.json is keyed by the exact same id ASSET_DATA already
// uses for equipment nodes — no translation needed, unlike every other level.
function waterAssetDataIdToEquipmentId(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset || asset.assetLevel !== 'equipment') return null;
  return asset.id;
}

function resolveWaterAssetProperties(assetId) {
  const stageId = waterAssetDataIdToStageId(assetId);
  if (stageId && STATION_FULL_PROPERTIES[stageId]) {
    return { properties: STATION_FULL_PROPERTIES[stageId], sparklineSource: { type: 'station', id: stageId } };
  }
  const trainId = waterAssetDataIdToTrainId(assetId);
  if (trainId && LINE_ROLLUPS[trainId]) {
    return { properties: LINE_ROLLUPS[trainId], sparklineSource: { type: 'line', id: trainId } };
  }
  const equipmentId = waterAssetDataIdToEquipmentId(assetId);
  if (equipmentId && EQUIPMENT_METRICS[equipmentId]) {
    return { properties: EQUIPMENT_METRICS[equipmentId], sparklineSource: { type: 'equipment', id: equipmentId } };
  }
  const plantId = waterAssetDataIdToPlantId(assetId);
  if (plantId && REFINERY_ROLLUPS[plantId]) {
    return { properties: REFINERY_ROLLUPS[plantId], sparklineSource: { type: 'refinery', id: plantId } };
  }
  // No dataset exists at this or any level for this asset — genuinely
  // nothing to return, not a fabricated aggregation.
  return { properties: null, sparklineSource: null };
}

// The single entry point for "what properties does this asset have" —
// works for any node in the active hierarchy, regardless of level OR
// which model is currently selected. The caller passes an assetId and
// gets back whatever's available (or isn't) — it never needs to know or
// branch on the asset's level, or on which model is active.
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

// Legacy models' level labels. A generic model declares its own in
// models.json (CURRENT_LEVEL_LABELS), which win when present.
const LEGACY_LEVEL_LABELS = {
  refinery: 'Refinery', line: 'Line', station: 'Station',
  plant: 'Plant', train: 'Train', stage: 'Stage', equipment: 'Equipment',
};

function getLevelLabel(level) {
  return CURRENT_LEVEL_LABELS?.[level] || LEGACY_LEVEL_LABELS[level] || level;
}

// Builds a flat, alphabetically-sorted list of every distinct
// (assetLevel, assetType) combination found in the asset hierarchy. Each
// entry carries the id of one real, representative asset of that type —
// resolveAssetProperties already works given any real asset id, so
// viewing "a type's properties" is just resolving its representative
// instance, no separate type-specific resolver needed.
export function buildTypeList(assetData) {
  const seen = new Map();
  assetData.forEach(a => {
    const key = `${a.assetLevel}::${a.assetType}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: `TYPE_${a.assetLevel}_${a.assetType}`,
        name: deslugifyType(a.assetType),
        level: getLevelLabel(a.assetLevel),
        exampleAssetId: a.id,
      });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Dispatches on the active model's shape (from models.json), not its id —
// any four-level pack (water, wastewater, and every future industry) goes
// through the same plant/train/stage/equipment resolver.
export function resolveAssetProperties(assetId) {
  if (CURRENT_MODEL_SHAPE === MODEL_SHAPES.GENERIC) return resolveGenericAssetProperties(assetId);
  return CURRENT_MODEL_SHAPE === MODEL_SHAPES.FOUR_LEVEL ? resolveWaterAssetProperties(assetId) : resolveRefineryAssetProperties(assetId);
}

// Generic packs key values and series by the real asset id, at any level —
// no conversion, no per-level dataset to try in turn. An asset with no
// entry in asset-values.json simply has no properties.
function resolveGenericAssetProperties(assetId) {
  const properties = ASSET_VALUES[assetId];
  if (!properties) return { properties: null, sparklineSource: null };
  return { properties, sparklineSource: { type: 'asset', id: assetId } };
}

export const HMI_CATEGORY_ORDER = ['Flow / WIP', 'Events / Losses', 'Stability', 'Quality', 'Derived Metric', 'Condition'];

// Full property series lives in STATION_TELEMETRY under either typed or
// measured — checked in that order since a property never appears in both.
// Generalized across all three levels — dispatches on source.type rather
// than assuming station-only, the way the original single-level lookup did.
export function getPropertySeriesForSource(source, propKey) {
  if (!source) return null;
  if (source.type === 'station') {
    const station = STATION_TELEMETRY && STATION_TELEMETRY.stations && STATION_TELEMETRY.stations[source.id];
    if (!station) return null;
    return (station.typed && station.typed[propKey]) || (station.measured && station.measured[propKey]) || null;
  }
  if (source.type === 'line') {
    const line = LINE_TELEMETRY && LINE_TELEMETRY.lines && LINE_TELEMETRY.lines[source.id];
    return (line && line[propKey]) || null;
  }
  if (source.type === 'refinery') {
    const refinery = REFINERY_TELEMETRY && REFINERY_TELEMETRY.refineries && REFINERY_TELEMETRY.refineries[source.id];
    return (refinery && refinery[propKey]) || null;
  }
  if (source.type === 'equipment') {
    const equipment = EQUIPMENT_TELEMETRY && EQUIPMENT_TELEMETRY.equipment && EQUIPMENT_TELEMETRY.equipment[source.id];
    return (equipment && equipment[propKey]) || null;
  }
  if (source.type === 'asset') {
    // Generic packs — static (nameplate) properties have no series, so
    // this is null for them and their tiles just show no sparkline.
    return ASSET_TELEMETRY?.series?.[source.id]?.[propKey] || null;
  }
  return null;
}

// Clips a full series down to [startTime, endTime] using the active model's
// own timestamp grid — the same window the Line/Candlestick tabs show for
// this item, via its evidencePoints. If that window reaches past what's
// actually available (a couple of items' evidence extends past the shared
// "now" reference as a projection), this naturally clips to real data
// rather than inventing future readings to match exactly.
export function sliceSeriesToRange(series, startTime, endTime) {
  if (!series || !CURRENT_TIMESTAMPS.length) return null;
  const grid = CURRENT_TIMESTAMPS.map(timeToMinutes);
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

// LINE_STATUS uses ids like "AURELIA_A1"; LINE_ROLLUPS/STATION_METRICS use
// the nextgen workbook's own asset ids like "AUR_L01" — this converts
// between the two rather than renaming one of two already-established
// conventions.
// Generic packs build LINE_STATUS straight from unit-status.json, keyed by
// the unit's real asset id — no conversion needed. Legacy four-level tiles
// (water/wastewater) carry a "Plant · Train" label that resolves to the
// train's asset id; only refinery keeps its own line-id convention, which
// its Issue Map / Line Detail overlay expects.
export function nowTileIdToAssetId(tileId) {
  if (CURRENT_MODEL_SHAPE === MODEL_SHAPES.GENERIC) return tileId;
  if (CURRENT_MODEL_SHAPE === MODEL_SHAPES.FOUR_LEVEL) {
    const tile = LINE_STATUS.find(l => l.id === tileId);
    return (tile && attentionAssetToAssetEntry(tile.label)?.id) || tileId;
  }
  return lineIdToAssetId(tileId);
}

function lineIdToAssetId(lineStatusId) {
  const [refinery, code] = lineStatusId.split('_');
  const prefix = refinery === 'AURELIA' ? 'AUR' : 'FER';
  const num = code.slice(1).padStart(2, '0'); // "A1" -> "1" -> "01"
  return `${prefix}_L${num}`;
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
    const relatedTypeId = `TYPE_${otherAsset.assetLevel}_${otherAsset.assetType}`;
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
    const relatedTypeId = `TYPE_${parent.assetLevel}_${parent.assetType}`;
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
    const relatedTypeId = `TYPE_${a.assetLevel}_${a.assetType}`;
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

function getTopLevelAncestor(assetId) {
  let current = CURRENT_ASSET_MAP[assetId];
  if (!current) return null;
  while (current.parentId) {
    const parent = CURRENT_ASSET_MAP[current.parentId];
    if (!parent || !parent.parentId) return current;
    current = parent;
  }
  return current;
}

export function getAssetDisplayLabel(assetId) {
  const asset = CURRENT_ASSET_MAP[assetId];
  if (!asset) return assetId;
  if (CURRENT_UNIT_LEVEL) return getGenericDisplayLabel(asset);
  const topLevel = getTopLevelAncestor(assetId);
  if (!topLevel || topLevel.id === asset.id) return asset.name;
  return `${topLevel.name} · ${asset.name}`;
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
    typeId: `TYPE_${a.assetLevel}_${a.assetType}`,
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
