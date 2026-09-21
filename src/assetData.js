// Asset hierarchy data and helpers — DESIGNER ONLY.
// The Screens "Model" tab and the Create wizard (Wizard.jsx) still read the
// refinery hierarchy from here. The Operator side doesn't: every model,
// refinery included, loads public/data/<model>/assets.json. The ids below
// match public/data/refinery/assets.json. Moving the designer onto the
// loaded model (and deleting this file) is a planned follow-up.

const ASSET_DATA = [
  { id: 'AURELIA', parentId: null, name: 'Aurelia', assetType: 'refinery', assetLevel: 'refinery' },
  { id: 'FERRUM',  parentId: null, name: 'Ferrum',  assetType: 'refinery', assetLevel: 'refinery' },

  { id: 'AURELIA_A1', parentId: 'AURELIA', name: 'A1', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A1_INTAKE',        parentId: 'AURELIA_A1', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A1_STABILIZATION', parentId: 'AURELIA_A1', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A1_REFINEMENT',    parentId: 'AURELIA_A1', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A1_INSPECTION',    parentId: 'AURELIA_A1', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A1_BUFFER',        parentId: 'AURELIA_A1', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A1_OUTPUT',        parentId: 'AURELIA_A1', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'AURELIA_A2', parentId: 'AURELIA', name: 'A2', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A2_INTAKE',        parentId: 'AURELIA_A2', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A2_STABILIZATION', parentId: 'AURELIA_A2', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A2_REFINEMENT',    parentId: 'AURELIA_A2', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A2_INSPECTION',    parentId: 'AURELIA_A2', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A2_BUFFER',        parentId: 'AURELIA_A2', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A2_OUTPUT',        parentId: 'AURELIA_A2', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'AURELIA_A3', parentId: 'AURELIA', name: 'A3', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A3_INTAKE',        parentId: 'AURELIA_A3', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A3_STABILIZATION', parentId: 'AURELIA_A3', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A3_REFINEMENT',    parentId: 'AURELIA_A3', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A3_INSPECTION',    parentId: 'AURELIA_A3', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A3_BUFFER',        parentId: 'AURELIA_A3', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A3_OUTPUT',        parentId: 'AURELIA_A3', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'AURELIA_A4', parentId: 'AURELIA', name: 'A4', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A4_INTAKE',        parentId: 'AURELIA_A4', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A4_STABILIZATION', parentId: 'AURELIA_A4', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A4_REFINEMENT',    parentId: 'AURELIA_A4', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A4_INSPECTION',    parentId: 'AURELIA_A4', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A4_BUFFER',        parentId: 'AURELIA_A4', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A4_OUTPUT',        parentId: 'AURELIA_A4', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'AURELIA_A5', parentId: 'AURELIA', name: 'A5', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A5_INTAKE',        parentId: 'AURELIA_A5', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A5_STABILIZATION', parentId: 'AURELIA_A5', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A5_REFINEMENT',    parentId: 'AURELIA_A5', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A5_INSPECTION',    parentId: 'AURELIA_A5', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A5_BUFFER',        parentId: 'AURELIA_A5', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A5_OUTPUT',        parentId: 'AURELIA_A5', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'AURELIA_A6', parentId: 'AURELIA', name: 'A6', assetType: 'line', assetLevel: 'line' },
  { id: 'AURELIA_A6_INTAKE',        parentId: 'AURELIA_A6', name: 'Intake',        assetType: 'intake',        assetLevel: 'station' },
  { id: 'AURELIA_A6_STABILIZATION', parentId: 'AURELIA_A6', name: 'Stabilization', assetType: 'stabilization', assetLevel: 'station' },
  { id: 'AURELIA_A6_REFINEMENT',    parentId: 'AURELIA_A6', name: 'Refinement',    assetType: 'refinement',    assetLevel: 'station' },
  { id: 'AURELIA_A6_INSPECTION',    parentId: 'AURELIA_A6', name: 'Inspection',    assetType: 'inspection',    assetLevel: 'station' },
  { id: 'AURELIA_A6_BUFFER',        parentId: 'AURELIA_A6', name: 'Buffer',        assetType: 'buffer',        assetLevel: 'station' },
  { id: 'AURELIA_A6_OUTPUT',        parentId: 'AURELIA_A6', name: 'Output',        assetType: 'output',        assetLevel: 'station' },

  { id: 'FERRUM_F1', parentId: 'FERRUM', name: 'F1', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F1_BULK_INTAKE',  parentId: 'FERRUM_F1', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F1_POWER_CHARGE', parentId: 'FERRUM_F1', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F1_SHAPING',      parentId: 'FERRUM_F1', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F1_TRANSFER',     parentId: 'FERRUM_F1', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F1_OUTPUT',       parentId: 'FERRUM_F1', name: 'Output',       assetType: 'output',       assetLevel: 'station' },

  { id: 'FERRUM_F2', parentId: 'FERRUM', name: 'F2', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F2_BULK_INTAKE',  parentId: 'FERRUM_F2', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F2_POWER_CHARGE', parentId: 'FERRUM_F2', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F2_SHAPING',      parentId: 'FERRUM_F2', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F2_TRANSFER',     parentId: 'FERRUM_F2', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F2_OUTPUT',       parentId: 'FERRUM_F2', name: 'Output',       assetType: 'output',       assetLevel: 'station' },

  { id: 'FERRUM_F3', parentId: 'FERRUM', name: 'F3', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F3_BULK_INTAKE',  parentId: 'FERRUM_F3', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F3_POWER_CHARGE', parentId: 'FERRUM_F3', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F3_SHAPING',      parentId: 'FERRUM_F3', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F3_TRANSFER',     parentId: 'FERRUM_F3', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F3_OUTPUT',       parentId: 'FERRUM_F3', name: 'Output',       assetType: 'output',       assetLevel: 'station' },

  { id: 'FERRUM_F4', parentId: 'FERRUM', name: 'F4', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F4_BULK_INTAKE',  parentId: 'FERRUM_F4', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F4_POWER_CHARGE', parentId: 'FERRUM_F4', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F4_SHAPING',      parentId: 'FERRUM_F4', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F4_TRANSFER',     parentId: 'FERRUM_F4', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F4_OUTPUT',       parentId: 'FERRUM_F4', name: 'Output',       assetType: 'output',       assetLevel: 'station' },

  { id: 'FERRUM_F5', parentId: 'FERRUM', name: 'F5', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F5_BULK_INTAKE',  parentId: 'FERRUM_F5', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F5_POWER_CHARGE', parentId: 'FERRUM_F5', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F5_SHAPING',      parentId: 'FERRUM_F5', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F5_TRANSFER',     parentId: 'FERRUM_F5', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F5_OUTPUT',       parentId: 'FERRUM_F5', name: 'Output',       assetType: 'output',       assetLevel: 'station' },

  { id: 'FERRUM_F6', parentId: 'FERRUM', name: 'F6', assetType: 'line', assetLevel: 'line' },
  { id: 'FERRUM_F6_BULK_INTAKE',  parentId: 'FERRUM_F6', name: 'Bulk Intake',  assetType: 'bulk_intake',  assetLevel: 'station' },
  { id: 'FERRUM_F6_POWER_CHARGE', parentId: 'FERRUM_F6', name: 'Power Charge', assetType: 'power_charge', assetLevel: 'station' },
  { id: 'FERRUM_F6_SHAPING',      parentId: 'FERRUM_F6', name: 'Shaping',      assetType: 'shaping',      assetLevel: 'station' },
  { id: 'FERRUM_F6_TRANSFER',     parentId: 'FERRUM_F6', name: 'Transfer',     assetType: 'transfer',     assetLevel: 'station' },
  { id: 'FERRUM_F6_OUTPUT',       parentId: 'FERRUM_F6', name: 'Output',       assetType: 'output',       assetLevel: 'station' },
];

const TAGS_BY_LEVEL = {
  refinery: [
    { tagName: 'assetId',                   tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetName',                  tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetType',                  tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetLevel',                 tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'refinery',                   tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'line',                       tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'station',                    tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetParentId',              tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'sortOrder',                  tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'path',                       tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'refinery_throughput',        tagDomain: 'production',           tagCategory: 'kpi' },
    { tagName: 'refinery_oee',               tagDomain: 'derived metrics',      tagCategory: 'kpi' },
    { tagName: 'best_line',                  tagDomain: 'operations / control', tagCategory: 'kpi' },
    { tagName: 'worst_line',                 tagDomain: 'operations / control', tagCategory: 'kpi' },
    { tagName: 'refinery_health_index',      tagDomain: 'derived metrics',      tagCategory: 'kpi' },
    { tagName: 'refinery_instability_index', tagDomain: 'stability',            tagCategory: 'kpi' },
  ],
  line: [
    { tagName: 'assetId',             tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetName',           tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetType',           tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetLevel',          tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'refinery',            tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'line',                tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'station',             tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetParentId',       tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'sortOrder',           tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'path',                tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'line_throughput',     tagDomain: 'production',           tagCategory: 'kpi' },
    { tagName: 'line_oee',            tagDomain: 'derived metrics',      tagCategory: 'kpi' },
    { tagName: 'total_wip',           tagDomain: 'flow / wip',           tagCategory: 'kpi' },
    { tagName: 'bottleneck_station',  tagDomain: 'operations / control', tagCategory: 'kpi' },
    { tagName: 'system_health_index', tagDomain: 'derived metrics',      tagCategory: 'kpi' },
    { tagName: 'flow_efficiency',     tagDomain: 'flow / wip',           tagCategory: 'kpi' },
    { tagName: 'instability_index',   tagDomain: 'stability',            tagCategory: 'kpi' },
  ],
  station: [
    { tagName: 'assetId',          tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetName',        tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetType',        tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetLevel',       tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'refinery',         tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'line',             tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'station',          tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'assetParentId',    tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'sortOrder',        tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'path',             tagDomain: 'common',               tagCategory: 'property' },
    { tagName: 'throughput',       tagDomain: 'production',           tagCategory: 'kpi' },
    { tagName: 'oee',              tagDomain: 'derived metrics',      tagCategory: 'kpi' },
    { tagName: 'utilization',      tagDomain: 'operations / control', tagCategory: 'kpi' },
    { tagName: 'wip',              tagDomain: 'flow / wip',           tagCategory: 'kpi' },
    { tagName: 'queue_length',     tagDomain: 'flow / wip',           tagCategory: 'kpi' },
    { tagName: 'scrap_rate',       tagDomain: 'quality',              tagCategory: 'kpi' },
    { tagName: 'quality_score',    tagDomain: 'quality',              tagCategory: 'kpi' },
    { tagName: 'microstop_count',  tagDomain: 'events / losses',      tagCategory: 'kpi' },
    { tagName: 'blocking_events',  tagDomain: 'events / losses',      tagCategory: 'kpi' },
    { tagName: 'downtime_events',  tagDomain: 'events / losses',      tagCategory: 'kpi' },
    { tagName: 'instability_index', tagDomain: 'stability',           tagCategory: 'kpi' },
    { tagName: 'risk_score',       tagDomain: 'risk / delivery',      tagCategory: 'kpi' },
  ],
};

const ASSET_MAP = Object.fromEntries(ASSET_DATA.map(a => [a.id, a]));

function getChildren(assetId) {
  return ASSET_DATA.filter(a => a.parentId === assetId);
}

function buildDescendantTree(assetId) {
  const result = [];
  const asset = ASSET_MAP[assetId];
  if (!asset) return result;

  result.push({ ...asset, parentId: null, nodeType: 'asset' });

  const queue = [asset];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = getChildren(current.id);
    for (const child of children) {
      result.push({ ...child, nodeType: 'asset' });
      queue.push(child);
    }
  }

  const assetNodes = [...result];
  for (const assetNode of assetNodes) {
    const tags = TAGS_BY_LEVEL[assetNode.assetLevel] || [];
    tags.forEach((tag) => {
      result.push({
        id: `${assetNode.id}__tag__${tag.tagName}`,
        parentId: assetNode.id,
        name: tag.tagName,
        tagDomain: tag.tagDomain,
        tagCategory: tag.tagCategory,
        nodeType: 'tag',
        assetType: null,
      });
    });
  }

  return result;
}

// Build a minimal tree from selected assets, adding bridge ancestors as placeholders
function buildSelectedAssetTree(selectedAssets) {
  const selectedIds = new Set(selectedAssets.map(a => a.id));
  const includedIds = new Set();

  // For each selected asset, walk up and include all ancestors
  selectedAssets.forEach(asset => {
    let current = ASSET_MAP[asset.id];
    while (current) {
      includedIds.add(current.id);
      current = current.parentId ? ASSET_MAP[current.parentId] : null;
    }
  });

  // Build flat list preserving original parentId relationships
  return Array.from(includedIds).map(id => {
    const asset = ASSET_MAP[id];
    return {
      ...asset,
      nodeType: 'asset',
      isPlaceholder: !selectedIds.has(id),
    };
  }).sort((a, b) => {
    // Sort by sortOrder to keep tree stable
    if (a.parentId === b.parentId) return (a.sortOrder || 0) - (b.sortOrder || 0);
    return 0;
  });
}


export { ASSET_DATA, TAGS_BY_LEVEL, ASSET_MAP, getChildren, buildDescendantTree, buildSelectedAssetTree };
