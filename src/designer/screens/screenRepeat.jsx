// designer/screens/screenRepeat.jsx
// A repeater: a container that draws a screen per asset instead of its own
// children. Its source is a saved asset set (model/assetSets.js); each
// asset it finds gets a screen, drawn with that asset as its self.
//
//   container.repeat = {
//     assetSetId,                     // which set
//     start: 'self' | { assetId },    // what a set with a start parameter gets
//     itemScreen: { mode: 'byType' | 'fixed', pageId },
//     itemSize,                       // 'tile' | 'card' | 'page' — the box
//     max,                            // how many to draw
//   }
//
// Which screen an item gets ('byType') is a lookup by type AND size
// (screenSizes.js): a repeater asks for, say, the Card for a turbine, and
// falls back the way Visualization does for a related asset's box —
//
//   1. the screen about that asset's type at that size
//   2. a card generated from that type's Visualization property config
//   3. a placeholder naming the asset
//
// so a repeater over a mixed set works, and an asset whose type nobody has
// designed a screen for yet still shows its real values rather than a gap.
// Step 2 is why (3) is rare: it needs an asset the model doesn't have.
//
// Items are read-only here: a repeated screen is edited by opening that
// screen, not inside the repeater. The saved screens and asset sets reach
// this deep in the tree through ScreenDataProvider rather than props, the
// same way self does — and each item is wrapped in its own
// ScreenAssetProvider, which is what makes it self inside that item.

import { createContext, useContext } from 'react';
import { CURRENT_ASSET_MAP, CURRENT_MODEL } from '../../model/modelData';
import { assetTypeIdOf, deslugifyType } from '../../model/assetQueries';
import { needsStart, resolveAssetSet } from '../../model/assetSets';
import { ScreenAssetProvider, pageContextOf } from './screenAsset';
import { pageSizeOf, sizeBox } from './screenSizes';
import { GeneratedCard, useVisualizationConfigs } from './generatedCard';

// How deep repeaters may nest (a feeder screen repeating turbine screens
// that repeat component screens is 2). A screen that would repeat itself,
// directly or in a circle, stops at the first repeat.
export const MAX_REPEAT_DEPTH = 3;

export const DEFAULT_REPEAT = {
  assetSetId: null,
  start: 'self',
  itemScreen: { mode: 'byType', pageId: null },
  // Card: one asset's summary, which is what repeating a set of assets
  // almost always wants. The box each item gets comes from this rather
  // than from typed-in numbers.
  itemSize: 'card',
  max: 24,
};

const ScreenDataContext = createContext({ assetSets: [], pages: [], chain: [] });

// The saved screens and asset sets a repeater needs, plus which screens are
// already being drawn above it (the cycle guard).
export function ScreenDataProvider({ assetSets, pages, chain, children }) {
  const outer = useContext(ScreenDataContext);
  const value = {
    assetSets: assetSets ?? outer.assetSets,
    pages: pages ?? outer.pages,
    chain: chain ?? outer.chain,
  };
  return <ScreenDataContext.Provider value={value}>{children}</ScreenDataContext.Provider>;
}

export function useScreenData() {
  return useContext(ScreenDataContext);
}

// Every repeater in a container tree, outermost first.
export function repeatsIn(containers) {
  const found = [];
  const walk = (list) => (list || []).forEach(c => {
    if (c.repeat?.assetSetId) found.push(c.repeat);
    walk(c.children);
  });
  walk(containers);
  return found;
}

// Which model a screen needs loaded before it can draw: the one it's
// about, or — for a plain screen whose only tie to a model is a repeater —
// the model its first repeater's asset set belongs to. Without this a
// screen that is just "repeat the worst 5 turbines" opens in the runtime
// with no model loaded and tells you its set belongs to another one.
export function modelForScreen(containers, assetSets) {
  const context = pageContextOf(containers);
  if (context?.modelId) return context.modelId;
  for (const repeat of repeatsIn(containers)) {
    const set = (assetSets || []).find(s => s.id === repeat.assetSetId);
    if (set?.modelId) return set.modelId;
  }
  return null;
}

// The assets a repeater draws.
// → { assetIds, error, total } — total before `max` cut it down.
export function resolveRepeat(repeat, { selfAssetId, assetSets }) {
  const config = { ...DEFAULT_REPEAT, ...(repeat || {}) };
  const set = (assetSets || []).find(s => s.id === config.assetSetId);
  if (!set) return { assetIds: [], total: 0, error: config.assetSetId ? 'That asset set no longer exists' : 'Choose an asset set to repeat over' };
  if (set.modelId !== CURRENT_MODEL) return { assetIds: [], total: 0, error: `That set belongs to the “${set.modelId}” model` };

  const start = config.start === 'self' ? selfAssetId : config.start?.assetId ?? null;
  if (needsStart(set) && !start) {
    return { assetIds: [], total: 0, error: config.start === 'self' ? 'This set needs a start asset, and this screen isn’t showing one' : 'Choose the asset this set starts from' };
  }
  const { assetIds, error } = resolveAssetSet(set, { start });
  if (error) return { assetIds: [], total: 0, error };
  const max = Math.max(1, config.max ?? DEFAULT_REPEAT.max);
  return { assetIds: assetIds.slice(0, max), total: assetIds.length, error: null };
}

// The saved screen about `typeId` at `sizeId`, in the loaded model.
export function screenForType(typeId, sizeId, pages) {
  return (pages || []).find(p => {
    const context = pageContextOf(p.containers);
    return context && context.typeId === typeId && context.modelId === CURRENT_MODEL
      && pageSizeOf(p.containers) === sizeId;
  }) || null;
}

// What an asset is drawn with:
//   { source: 'screen',    page }             a saved screen
//   { source: 'generated', missingType }      Visualization's card for its type
//   { source: 'none' }                        nothing to draw
// `missingType` is set whenever no screen was found, named or by type, so
// the details panel can say which types are still running on the default.
export function screenForAsset(assetId, repeat, pages) {
  const config = { ...DEFAULT_REPEAT, ...(repeat || {}) };
  const asset = CURRENT_ASSET_MAP[assetId];
  const typeLabel = asset ? deslugifyType(asset.assetType) : null;

  if (config.itemScreen?.mode === 'fixed') {
    const page = (pages || []).find(p => p.id === config.itemScreen.pageId) || null;
    if (page) return { source: 'screen', page, missingType: null };
    // A named screen that's been deleted: fall through to the default
    // rather than drawing nothing.
    return { source: asset ? 'generated' : 'none', page: null, missingType: typeLabel };
  }

  const page = asset ? screenForType(assetTypeIdOf(asset), config.itemSize, pages) : null;
  if (page) return { source: 'screen', page, missingType: null };
  return { source: asset ? 'generated' : 'none', page: null, missingType: typeLabel };
}

// The size every item is boxed at. With one fixed screen for everything,
// that screen's own size decides — there's nothing to choose. By type, the
// repeater says what it's asking each type for.
export function repeatItemSize(repeat, pages) {
  const config = { ...DEFAULT_REPEAT, ...(repeat || {}) };
  if (config.itemScreen?.mode === 'fixed') {
    const page = (pages || []).find(p => p.id === config.itemScreen.pageId);
    if (page) return pageSizeOf(page.containers);
  }
  return config.itemSize || DEFAULT_REPEAT.itemSize;
}

// Which screens a repeater would use, by type — shown in the details panel
// so the mix is visible without opening every item.
export function repeatScreenSummary(assetIds, repeat, pages) {
  const byType = new Map();
  assetIds.forEach(id => {
    const asset = CURRENT_ASSET_MAP[id];
    const typeId = asset ? assetTypeIdOf(asset) : 'unknown';
    if (!byType.has(typeId)) {
      const { page, source, missingType } = screenForAsset(id, repeat, pages);
      byType.set(typeId, {
        typeLabel: asset ? deslugifyType(asset.assetType) : 'unknown',
        screenName: page?.name || null,
        source,
        missingType,
        count: 0,
      });
    }
    byType.get(typeId).count += 1;
  });
  return [...byType.values()];
}

// Nothing to draw at all — an id the loaded model doesn't have. The
// generated card covers every asset that does exist, so this is the
// genuinely empty case rather than "no screen yet".
function PlaceholderItem({ assetId, missingType }) {
  const asset = CURRENT_ASSET_MAP[assetId];
  return (
    <div className="screen-repeat-placeholder">
      <div className="screen-repeat-placeholder-name">{asset?.name || assetId}</div>
      <div className="screen-repeat-placeholder-note">Nothing to draw for {missingType || 'this asset'}</div>
    </div>
  );
}

// ScreenView registers itself here, rather than this file importing it,
// because the render stack already runs ScreenView → ContainerCard → here:
// importing it back would be a circle.
let ScreenRenderer = null;
export function registerScreenRenderer(component) {
  ScreenRenderer = component;
}

// The repeated items themselves.
export function RepeatedItems({ repeat, selfAssetId, queryResults, queries }) {
  const { assetSets, pages, chain } = useScreenData();
  // One read shared by every generated card below.
  const configs = useVisualizationConfigs();
  const config = { ...DEFAULT_REPEAT, ...(repeat || {}) };
  const { assetIds, total, error } = resolveRepeat(config, { selfAssetId, assetSets });

  if (!ScreenRenderer) return null;
  if (chain.length >= MAX_REPEAT_DEPTH) {
    return <div className="screen-repeat-note">Repeaters are nested {MAX_REPEAT_DEPTH} deep here — this one isn't drawn.</div>;
  }
  if (error) return <div className="screen-repeat-note">{error}.</div>;
  if (assetIds.length === 0) return <div className="screen-repeat-note">This set finds no assets right now.</div>;

  // Every item gets the same box — the one the asked-for size defines. A
  // screen that is itself smaller than that box (a Tile found where a Card
  // was asked for, say) is centred in it rather than stretched, so its
  // proportions survive.
  const box = sizeBox(repeatItemSize(config, pages));

  return (
    <>
      {assetIds.map(assetId => {
        const { page, source, missingType } = screenForAsset(assetId, config, pages);
        const repeats = page && chain.includes(page.id);
        const inner = page ? sizeBox(pageSizeOf(page.containers)) : box;
        return (
          <div
            key={assetId}
            className="screen-repeat-item"
            style={{ width: box.width, height: box.height }}
            title={CURRENT_ASSET_MAP[assetId]?.name}
          >
            {repeats ? (
              <div className="screen-repeat-note">“{page.name}” is already being drawn above this — stopping here.</div>
            ) : page ? (
              <div
                className="screen-repeat-item-inner"
                style={{ width: Math.min(inner.width, box.width), height: Math.min(inner.height, box.height) }}
              >
                <ScreenDataProvider chain={[...chain, page.id]}>
                  <ScreenAssetProvider assetId={assetId}>
                    <ScreenRenderer containers={page.containers || []} assetId={assetId} queryResults={queryResults} queries={queries} />
                  </ScreenAssetProvider>
                </ScreenDataProvider>
              </div>
            ) : source === 'generated' ? (
              <GeneratedCard assetId={assetId} configs={configs} />
            ) : (
              <PlaceholderItem assetId={assetId} missingType={missingType} />
            )}
          </div>
        );
      })}
      {total > assetIds.length && (
        <div className="screen-repeat-note">Showing {assetIds.length} of {total}.</div>
      )}
    </>
  );
}
