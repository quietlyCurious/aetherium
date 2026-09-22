// designer/modelOptions.js
// Choice lists built from the loaded model, for the designer's pickers:
// every asset with its full path, and every type. Used by the Asset Sets
// editor and the Screens editor (a screen's context type, "Preview as").
// Cached per model, since a model's hierarchy never changes while it's
// loaded and the pickers ask on every render.

import { CURRENT_ASSET_DATA, CURRENT_MODEL } from '../model/modelData';
import { buildTypeList, getAssetPathLabel } from '../model/assetQueries';

let cache = { modelId: undefined, assets: [], types: [] };

function ensure() {
  if (cache.modelId === CURRENT_MODEL) return cache;
  cache = {
    modelId: CURRENT_MODEL,
    // { id, name, path } — the path tells apart siblings that share a name
    // (every turbine's "Drivetrain").
    assets: CURRENT_ASSET_DATA.map(a => ({ id: a.id, name: a.name, path: getAssetPathLabel(a.id) })),
    // { id, name, level } — "Gearbox", "Component"
    types: buildTypeList(CURRENT_ASSET_DATA),
  };
  return cache;
}

export const assetOptions = () => ensure().assets;
export const typeOptions = () => ensure().types;
export const typeNameOf = (typeId) => ensure().types.find(t => t.id === typeId)?.name || typeId;
