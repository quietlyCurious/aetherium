// assetSetsStorage.js
// Browser localStorage-backed persistence for asset sets (see
// model/assetSets.js). One list for every model; each set records its own
// modelId, and the Asset Sets area shows the loaded model's.

const ASSET_SETS_STORAGE_KEY = 'aetherium_asset_sets';

export function loadAssetSets() {
  try {
    const raw = window.localStorage.getItem(ASSET_SETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return [];
  }
}

export function saveAssetSets(assetSets) {
  try {
    window.localStorage.setItem(ASSET_SETS_STORAGE_KEY, JSON.stringify(assetSets));
    return true;
  } catch {
    return false;
  }
}
