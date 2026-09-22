// designer/screens/screenAsset.jsx
// A screen that's about an asset: which type it's for (its context), the
// asset it's showing right now ("self"), and checks on its asset bindings.
//
// The context lives on the page's root container, next to its other
// page-level settings (pageType), as { modelId, typeId } — so it's saved,
// and tracked as an unsaved change, exactly like any other edit. It can be
// set, changed or cleared at any time.
//
// "Self" travels as a React context rather than a prop: the canvas and
// ScreenView wrap the page in <ScreenAssetProvider assetId=…>, and any
// ContainerCard however deep reads it with useScreenAsset(). A repeater will
// do the same per item — wrap each one in a provider with its own asset —
// so everything inside it sees that item as self.

import { createContext, useContext } from 'react';
import { ROOT_CONTAINER_ID } from '../../containerModel';
import { assetsOfType, checkAssetBinding, describeAssetBinding, typeExists } from '../../model/assetPaths';
import { CURRENT_MODEL } from '../../model/modelData';
import { typeNameOf } from '../modelOptions';

const ScreenAssetContext = createContext(null);

export function ScreenAssetProvider({ assetId, children }) {
  return <ScreenAssetContext.Provider value={assetId || null}>{children}</ScreenAssetContext.Provider>;
}

// The asset the enclosing screen is showing, or null.
export function useScreenAsset() {
  return useContext(ScreenAssetContext);
}

// The page's context — { modelId, typeId } — or null.
export function pageContextOf(containers) {
  const root = (containers || []).find(c => c.id === ROOT_CONTAINER_ID);
  return root?.context?.typeId ? root.context : null;
}

// Every asset binding on the page: [{ containerId, title, propName, binding }].
export function assetBindingsOf(containers) {
  const found = [];
  const walk = (list) => (list || []).forEach(c => {
    Object.entries(c.bindings || {}).forEach(([propName, binding]) => {
      if (binding?.type === 'asset') found.push({ containerId: c.id, title: c.title, propName, binding });
    });
    walk(c.children);
  });
  walk(containers);
  return found;
}

// How the page's asset bindings fare against a type — what changing the
// context to it would do. → { total, broken: [...], partial: [...] }
export function checkPageBindingsForType(containers, typeId) {
  const all = assetBindingsOf(containers);
  const broken = [];
  const partial = [];
  all.forEach(entry => {
    const { status } = typeId ? checkAssetBinding(entry.binding, typeId) : { status: 'broken' };
    if (status === 'broken') broken.push(entry);
    else if (status === 'partial') partial.push(entry);
  });
  return { total: all.length, broken, partial };
}

// Everything the Screens editor needs to know about the open screen's
// self, worked out from the editor (the page's context, the chosen preview
// asset) and the loaded model (useLoadedModel's state). Computed in
// ScreensWorkspace, which re-renders when the model loads.
//
//   status     'none' (a plain page) · 'loading' · 'ok' · 'otherModel' (the
//              screen is about a type in another model) · 'missingType'
//   typeId, typeLabel
//   assetIds   the assets of that type — what "Preview as" offers
//   assetId    the one being shown: the chosen one, else the first
//   chooseAsset(id), changeType(typeId | null)
export function screenSelfOf(editor, model) {
  const context = pageContextOf(editor.containers);
  const base = { context, typeId: context?.typeId ?? null, typeLabel: null, assetIds: [], assetId: null };

  // Asks first when the page's asset bindings wouldn't all resolve on the
  // new type, then sets it. Bindings are never removed: broken ones stay
  // marked until they're fixed, cleared, or the type is changed back.
  // Returns whether it went ahead.
  const changeType = (typeId) => {
    if (typeId === (context?.typeId ?? null)) return true;
    const check = checkPageBindingsForType(editor.containers, typeId);
    if (check.broken.length || check.partial.length) {
      const target = typeId ? typeNameOf(typeId) : 'no type';
      const lines = [
        ...check.broken.map(b => `  • ${b.title} → ${b.propName}: ${describeAssetBinding(b.binding)}`),
        ...check.partial.map(b => `  • ${b.title} → ${b.propName}: ${describeAssetBinding(b.binding)} (only some assets)`),
      ];
      const message = typeId
        ? `${check.broken.length + check.partial.length} of ${check.total} asset bindings won't resolve for every ${target}:\n\n${lines.join('\n')}\n\nThey'll stay on their widgets, marked as broken, until you fix or clear them. Change the type?`
        : `This screen has ${check.total} asset binding${check.total === 1 ? '' : 's'}. Without a type they'll show their static values, marked as broken, until you set one again. Remove the type?`;
      if (!window.confirm(message)) return false;
    }
    editor.setPageContextType(typeId ? { modelId: CURRENT_MODEL, typeId } : null);
    return true;
  };

  const withActions = (state) => ({ ...state, changeType, chooseAsset: editor.choosePreviewAsset });

  if (!context) return withActions({ ...base, status: 'none' });
  if (!model.loaded) return withActions({ ...base, status: 'loading' });
  if (context.modelId !== CURRENT_MODEL) return withActions({ ...base, status: 'otherModel' });
  if (!typeExists(context.typeId)) return withActions({ ...base, status: 'missingType' });

  const assetIds = assetsOfType(context.typeId).map(a => a.id);
  const chosen = editor.chosenPreviewAssetId;
  return withActions({
    ...base,
    status: 'ok',
    typeLabel: typeNameOf(context.typeId),
    assetIds,
    assetId: assetIds.includes(chosen) ? chosen : (assetIds[0] ?? null),
  });
}
