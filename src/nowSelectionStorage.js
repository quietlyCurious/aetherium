// nowSelectionStorage.js
// Browser localStorage-backed persistence for which asset/type was last
// selected in the Now area, scoped per model (refinery/water/wastewater
// have entirely different asset/type ids, so a selection from one model
// should never be applied to another). Same pattern as queriesStorage.js.
//
// This exists specifically so that after a reload, a user who saved a
// type's display template lands back on that same type and immediately
// sees it restored — without this, the template data itself survives fine,
// but the screen shows nothing selected, which looks and feels like the
// save didn't work at all.

const NOW_SELECTION_STORAGE_KEY = 'aetherium_now_selection';

export function loadNowSelection(model) {
  try {
    const raw = window.localStorage.getItem(NOW_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const forModel = parsed[model];
    if (!forModel || typeof forModel !== 'object') return null;
    if (forModel.kind !== 'asset' && forModel.kind !== 'type') return null;
    if (typeof forModel.id !== 'string') return null;
    return forModel;
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return null;
  }
}

export function saveNowSelection(model, selection) {
  try {
    const raw = window.localStorage.getItem(NOW_SELECTION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = (parsed && typeof parsed === 'object') ? { ...parsed } : {};
    if (selection) {
      next[model] = selection;
    } else {
      delete next[model];
    }
    window.localStorage.setItem(NOW_SELECTION_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
