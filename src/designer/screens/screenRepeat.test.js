// designer/screens/screenRepeat.test.js
// A repeater's assets and the screen each one is drawn with, against the
// real wind pack.
//   npx react-scripts test --watchAll=false src/designer/screens

import { loadPackForTests } from '../../model/loadPackForTests';
import { DEFAULT_RULE } from '../../model/assetSets';
import { resolveRepeat, screenForAsset, screenForType, repeatItemSize, repeatScreenSummary, modelForScreen } from './screenRepeat';
import { setPageContext, setPageSize } from './screenEdits';
import { pageSizeOf, sizeBox } from './screenSizes';
import { makeRootContainer } from '../../containerModel';

beforeAll(() => loadPackForTests('wind'));

const GEARED = 'TYPE_turbine_wtg_geared';
const DIRECT = 'TYPE_turbine_wtg_direct_drive';

// A saved screen about a type, at a size.
const screenAbout = (id, name, typeId, size) => {
  let containers = setPageContext([makeRootContainer()], typeId ? { modelId: 'wind', typeId } : null);
  if (size) containers = setPageSize(containers, size);
  return { id, name, containers };
};
const PAGES = [
  screenAbout('p-turbine', 'Turbine overview', GEARED, 'card'),
  screenAbout('p-turbine-tile', 'Turbine tile', GEARED, 'tile'),
  screenAbout('p-plain', 'A plain screen', null),
];

const SETS = [
  { id: 'all-turbines', name: 'All turbines', modelId: 'wind', kind: 'rule',
    rule: { ...DEFAULT_RULE, typeIds: [GEARED, DIRECT] } },
  { id: 'turbines-of', name: 'Turbines of a feeder', modelId: 'wind', kind: 'rule',
    rule: { ...DEFAULT_RULE, start: { mode: 'parameter' }, depth: 'children', typeIds: [GEARED, DIRECT] } },
  { id: 'other-model', name: 'Grid lines', modelId: 'grid', kind: 'rule', rule: { ...DEFAULT_RULE } },
];
const repeat = (over) => ({ assetSetId: 'all-turbines', ...over });

describe('what a repeater draws', () => {
  test('a set, capped by max, reporting the total', () => {
    const r = resolveRepeat(repeat({ max: 5 }), { selfAssetId: null, assetSets: SETS });
    expect(r.assetIds).toHaveLength(5);
    expect(r.total).toBe(24);
    expect(r.error).toBeNull();
  });

  test('a set that takes a start gets the screen\'s own asset', () => {
    const config = repeat({ assetSetId: 'turbines-of', start: 'self' });
    expect(resolveRepeat(config, { selfAssetId: 'BOREAS_F1', assetSets: SETS }).assetIds).toHaveLength(6);
    expect(resolveRepeat(config, { selfAssetId: 'BOREAS_F4', assetSets: SETS }).assetIds).toHaveLength(5);
    // …or a fixed asset, whatever the screen is showing.
    const fixed = repeat({ assetSetId: 'turbines-of', start: { assetId: 'BOREAS_F2' } });
    expect(resolveRepeat(fixed, { selfAssetId: 'BOREAS_F1', assetSets: SETS }).assetIds).toHaveLength(7);
  });

  test('says why it can\'t draw anything', () => {
    expect(resolveRepeat(repeat({ assetSetId: null }), { assetSets: SETS }).error).toMatch(/Choose an asset set/);
    expect(resolveRepeat(repeat({ assetSetId: 'gone' }), { assetSets: SETS }).error).toMatch(/no longer exists/);
    expect(resolveRepeat(repeat({ assetSetId: 'other-model' }), { assetSets: SETS }).error).toMatch(/grid/);
    expect(resolveRepeat(repeat({ assetSetId: 'turbines-of' }), { selfAssetId: null, assetSets: SETS }).error).toMatch(/needs a start asset/);
  });
});

describe('which screen each item gets', () => {
  test('by type and size, falling back to a generated card', () => {
    const geared = screenForAsset('BOREAS_F1_WTG01', repeat(), PAGES);
    expect(geared.source).toBe('screen');
    expect(geared.page.id).toBe('p-turbine');
    // A type with no screen at that size draws Visualization's own card
    // rather than nothing.
    const direct = screenForAsset('BOREAS_F4_WTG20', repeat(), PAGES);
    expect(direct.page).toBeNull();
    expect(direct.source).toBe('generated');
    expect(direct.missingType).toBe('WTG 3.3 MW Direct Drive');
  });

  test('the same type gives a different screen per size', () => {
    expect(screenForAsset('BOREAS_F1_WTG01', repeat({ itemSize: 'tile' }), PAGES).page.id).toBe('p-turbine-tile');
    expect(screenForAsset('BOREAS_F1_WTG01', repeat({ itemSize: 'card' }), PAGES).page.id).toBe('p-turbine');
    // Nothing is built at Page size, so that one generates.
    expect(screenForAsset('BOREAS_F1_WTG01', repeat({ itemSize: 'page' }), PAGES).source).toBe('generated');
    expect(screenForType(GEARED, 'tile', PAGES).id).toBe('p-turbine-tile');
    expect(screenForType(DIRECT, 'card', PAGES)).toBeNull();
  });

  test('or one fixed screen for every asset, whatever its size', () => {
    const config = repeat({ itemScreen: { mode: 'fixed', pageId: 'p-plain' } });
    expect(screenForAsset('BOREAS_F4_WTG20', config, PAGES).page.id).toBe('p-plain');
    // A named screen that's since been deleted still draws something.
    const gone = repeat({ itemScreen: { mode: 'fixed', pageId: 'p-gone' } });
    expect(screenForAsset('BOREAS_F4_WTG20', gone, PAGES).source).toBe('generated');
  });

  test('one fixed screen boxes every item at that screen\'s own size', () => {
    expect(repeatItemSize(repeat({ itemSize: 'card', itemScreen: { mode: 'fixed', pageId: 'p-turbine-tile' } }), PAGES)).toBe('tile');
    // By type, the repeater's own ask decides.
    expect(repeatItemSize(repeat({ itemSize: 'card' }), PAGES)).toBe('card');
    expect(repeatItemSize(repeat({}), PAGES)).toBe('card'); // the default
  });

  test('the summary counts each type and names its screen', () => {
    const { assetIds } = resolveRepeat(repeat({ max: 24 }), { assetSets: SETS });
    const summary = repeatScreenSummary(assetIds, repeat(), PAGES);
    expect(summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ typeLabel: 'WTG 2.3 MW Geared', screenName: 'Turbine overview', source: 'screen', count: 19 }),
      expect.objectContaining({ typeLabel: 'WTG 3.3 MW Direct Drive', screenName: null, source: 'generated', count: 5 }),
    ]));
  });
});

describe('sizes', () => {
  test('a screen saved before sizes existed is a Page', () => {
    expect(pageSizeOf([makeRootContainer()])).toBe('page');
    expect(pageSizeOf(PAGES[0].containers)).toBe('card');
    expect(pageSizeOf(null)).toBe('page');
  });

  test('setting a size leaves what the screen is about alone, and vice versa', () => {
    const sized = setPageSize(PAGES[0].containers, 'tile');
    expect(pageSizeOf(sized)).toBe('tile');
    expect(sized[0].context.typeId).toBe(GEARED);
    // Clearing About keeps the size.
    expect(pageSizeOf(setPageContext(sized, null))).toBe('tile');
  });

  test('a plain screen that only repeats still knows which model to load', () => {
    const plain = setPageContext([makeRootContainer()], null);
    expect(modelForScreen(plain, SETS)).toBeNull();
    const repeating = plain.map(c => ({ ...c, repeat: { assetSetId: 'all-turbines' } }));
    expect(modelForScreen(repeating, SETS)).toBe('wind');
    // What the screen is about still wins.
    expect(modelForScreen(PAGES[0].containers, SETS)).toBe('wind');
  });

  test('every size has a box a repeater can lay out with', () => {
    ['tile', 'card', 'page'].forEach(id => {
      const box = sizeBox(id);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    });
    expect(sizeBox('tile').width).toBeLessThan(sizeBox('card').width);
    // An unknown size falls back rather than throwing.
    expect(sizeBox('enormous')).toEqual(sizeBox('page'));
  });
});

describe('repeating properties', () => {
  const { resolvePropertyRepeat, isRepeater } = require('./screenRepeat');
  const { assetTypeIdOf } = require('../../model/assetQueries');
  // Read live: the pack is loaded in beforeAll, after this file is imported.
  const turbine = () => require('../../model/modelData').CURRENT_ASSET_DATA.find(a => assetTypeIdOf(a) === GEARED);
  const noConfigs = { typeDisplayTemplates: {}, typePropertyConfigs: {}, assetDisplayTemplates: {}, assetPropertyConfigs: {} };
  const props = (over) => ({ over: 'properties', ...over });

  test('is a repeater as soon as it repeats properties; an asset repeater once it has a set', () => {
    expect(isRepeater({ repeat: props() })).toBe(true);
    expect(isRepeater({ repeat: { over: 'assets', assetSetId: null } })).toBe(false);
    expect(isRepeater({ repeat: { assetSetId: 'x' } })).toBe(true);
    expect(isRepeater({})).toBe(false);
  });

  test('needs an asset', () => {
    const result = resolvePropertyRepeat(props(), { selfAssetId: null, configs: noConfigs, displayOrders: {} });
    expect(result.error).toMatch(/needs an asset/);
    expect(result.entries).toEqual([]);
  });

  test("draws the asset's shown properties, each with its own visual, capped by max", () => {
    const asset = turbine();
    const all = resolvePropertyRepeat(props(), { selfAssetId: asset.id, configs: noConfigs, displayOrders: {} });
    expect(all.error).toBeNull();
    expect(all.total).toBeGreaterThan(2);
    expect(all.entries.every(e => e.viewMode === 'text')).toBe(true);
    const two = resolvePropertyRepeat(props({ max: 2 }), { selfAssetId: asset.id, configs: noConfigs, displayOrders: {} });
    expect(two.entries).toHaveLength(2);
    expect(two.total).toBe(all.total);
  });

  test('follows Visualization: Never-visible left out, per-property visuals kept, or one visual for all', () => {
    const asset = turbine();
    const typeId = assetTypeIdOf(asset);
    const all = resolvePropertyRepeat(props(), { selfAssetId: asset.id, configs: noConfigs, displayOrders: {} });
    const [first, second] = all.entries.map(e => e.key);
    const configs = {
      ...noConfigs,
      typePropertyConfigs: { [typeId]: { [first]: 'never' } },
      typeDisplayTemplates: { [typeId]: { viewMode: 'text', propertyViewModes: { [second]: 'spark' } } },
    };
    const shown = resolvePropertyRepeat(props(), { selfAssetId: asset.id, configs, displayOrders: {} });
    expect(shown.entries.map(e => e.key)).not.toContain(first);
    expect(shown.entries.find(e => e.key === second).viewMode).toBe('spark');
    const withNever = resolvePropertyRepeat(props({ properties: { include: 'all' } }), { selfAssetId: asset.id, configs, displayOrders: {} });
    expect(withNever.entries.map(e => e.key)).toContain(first);
    const indicators = resolvePropertyRepeat(props({ properties: { visual: 'indicator' } }), { selfAssetId: asset.id, configs, displayOrders: {} });
    expect(indicators.entries.every(e => e.viewMode === 'indicator')).toBe(true);
  });
});
