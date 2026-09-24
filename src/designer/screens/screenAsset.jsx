// designer/screens/screenAsset.jsx
// A screen that's about an asset: which type it's for (its context), the
// asset it's showing right now ("self"), and checks on its asset bindings.
// screenSelfOf also answers for a screen about a property
// (screenProperty.jsx), which is the same idea one level smaller.
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
import { pageSizeOf } from './screenSizes';
import {
  PROPERTY_CONTEXT, defaultPreviewAssetId, isPropertyContext, previewableAssetIds,
  previewablePropertyKeys, propertyBindingsOf, propertyFieldLabel,
} from './screenProperty';

// The About choice for "a screen about any property", alongside the types.
export const ABOUT_ANY_PROPERTY = '__property__';

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

// How the page's bindings fare if the screen becomes about `about` — a
// typeId, ABOUT_ANY_PROPERTY, or null for a plain page. Asset bindings
// need a type (and a path every asset of it has); property bindings need
// a property screen. → { total, broken: [...], partial: [...] }
export function checkPageBindingsForAbout(containers, about) {
  const assetBindings = assetBindingsOf(containers);
  const propertyBindings = propertyBindingsOf(containers);
  const broken = [];
  const partial = [];
  assetBindings.forEach(entry => {
    const isType = about && about !== ABOUT_ANY_PROPERTY;
    const { status } = isType ? checkAssetBinding(entry.binding, about) : { status: 'broken' };
    if (status === 'broken') broken.push(entry);
    else if (status === 'partial') partial.push(entry);
  });
  if (about !== ABOUT_ANY_PROPERTY) broken.push(...propertyBindings);
  return { total: assetBindings.length + propertyBindings.length, broken, partial };
}

function describeAnyBinding(binding) {
  return binding.type === 'property' ? `property · ${propertyFieldLabel(binding.field)}` : describeAssetBinding(binding);
}

// Everything the Screens editor needs to know about the open screen's
// self, worked out from the editor (the page's context, the chosen preview
// asset and property) and the loaded model (useLoadedModel's state).
// Computed in ScreensWorkspace, which re-renders when the model loads.
//
//   status     'none' (a plain page) · 'loading' · 'ok' (about a type) ·
//              'property' (about any property) · 'otherModel' (about a
//              type in another model) · 'missingType'
//   about      what the About box shows: a typeId, ABOUT_ANY_PROPERTY or null
//   typeId, typeLabel
//   assetIds   what "Preview as" offers: the type's assets, or for a
//              property screen every asset with values
//   assetId    the one being shown: the chosen one, else a sensible first
//   propertyKeys, propertyKey   property screens only: the preview asset's
//              properties, and the one being shown
//   chooseAsset(id), chooseProperty(key), changeAbout(about)
export function screenSelfOf(editor, model) {
  const root = (editor.containers || []).find(c => c.id === ROOT_CONTAINER_ID);
  const isProperty = isPropertyContext(root?.context);
  const context = isProperty ? root.context : pageContextOf(editor.containers);
  const about = isProperty ? ABOUT_ANY_PROPERTY : (context?.typeId ?? null);
  const base = {
    context, about, typeId: isProperty ? null : (context?.typeId ?? null), typeLabel: null,
    assetIds: [], assetId: null, propertyKeys: [], propertyKey: null,
  };

  // Asks first when the page's bindings wouldn't all resolve on the new
  // choice, then sets it. Bindings are never removed: broken ones stay
  // marked until they're fixed, cleared, or the choice is changed back.
  // A plain Page-sized screen that becomes about a property shrinks to a
  // Tile, since that's what a property's box is. Returns whether it went
  // ahead.
  const changeAbout = (next) => {
    if (next === about) return true;
    const check = checkPageBindingsForAbout(editor.containers, next);
    if (check.broken.length || check.partial.length) {
      const target = next === ABOUT_ANY_PROPERTY ? 'a property screen' : next ? `every ${typeNameOf(next)}` : 'a plain page';
      const lines = [
        ...check.broken.map(b => `  • ${b.title} → ${b.propName}: ${describeAnyBinding(b.binding)}`),
        ...check.partial.map(b => `  • ${b.title} → ${b.propName}: ${describeAnyBinding(b.binding)} (only some assets)`),
      ];
      const message = `${check.broken.length + check.partial.length} of ${check.total} binding${check.total === 1 ? '' : 's'} won't resolve for ${target}:\n\n${lines.join('\n')}\n\nThey'll stay on their widgets, marked as broken, until you fix or clear them. Go ahead?`;
      if (!window.confirm(message)) return false;
    }
    if (next === ABOUT_ANY_PROPERTY) {
      editor.setPageContextType(PROPERTY_CONTEXT);
      if (pageSizeOf(editor.containers) === 'page') editor.setPageSizeId('tile');
    } else {
      editor.setPageContextType(next ? { modelId: CURRENT_MODEL, typeId: next } : null);
    }
    return true;
  };

  const withActions = (state) => ({
    ...state, changeAbout, chooseAsset: editor.choosePreviewAsset, chooseProperty: editor.choosePreviewProperty,
  });

  if (!context) return withActions({ ...base, status: 'none' });
  if (!model.loaded) return withActions({ ...base, status: 'loading' });

  if (isProperty) {
    const assetIds = previewableAssetIds();
    const chosenAsset = editor.chosenPreviewAssetId;
    const assetId = assetIds.includes(chosenAsset) ? chosenAsset : defaultPreviewAssetId();
    const propertyKeys = assetId ? previewablePropertyKeys(assetId) : [];
    const chosenKey = editor.chosenPreviewPropertyKey;
    return withActions({
      ...base,
      status: 'property',
      typeLabel: 'Any property',
      assetIds,
      assetId,
      propertyKeys,
      propertyKey: propertyKeys.includes(chosenKey) ? chosenKey : (propertyKeys[0] ?? null),
    });
  }

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
