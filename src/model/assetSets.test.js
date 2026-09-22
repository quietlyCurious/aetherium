// model/assetSets.test.js
// The asset-set resolver, run against the real wind pack loaded the same
// way the app loads it (activateLoadedModel).
//   npx react-scripts test --watchAll=false src/model

import { ASSET_VALUES, CURRENT_ASSET_MAP } from './modelData';
import { resolveAssetSet, describeAssetSet, suggestStart, propertiesOf, ruleCandidates, DEFAULT_RULE } from './assetSets';
import { loadPackForTests } from './loadPackForTests';

beforeAll(() => loadPackForTests('wind'));

const rule = (over) => ({ kind: 'rule', rule: { ...DEFAULT_RULE, ...over } });
const GEARED = 'TYPE_turbine_wtg_geared';
const DIRECT = 'TYPE_turbine_wtg_direct_drive';

describe('picked sets', () => {
  test('keep model order and drop ids this model does not have', () => {
    const r = resolveAssetSet({ kind: 'picked', picked: { assetIds: ['BOREAS_F2_WTG07', 'NOT_HERE', 'BOREAS_F1_WTG01'] } });
    expect(r.assetIds).toEqual(['BOREAS_F1_WTG01', 'BOREAS_F2_WTG07']);
    expect(r.steps[0].count).toBe(1);
  });
});

describe('rule sets', () => {
  test('types across the whole model', () => {
    const r = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT] }));
    expect(r.assetIds).toHaveLength(24);
    expect(r.assetIds.every(id => CURRENT_ASSET_MAP[id].assetLevel === 'turbine')).toBe(true);
  });

  test('under a fixed asset, children vs everything below', () => {
    const children = resolveAssetSet(rule({ start: { mode: 'asset', assetId: 'BOREAS_F1_WTG01' }, depth: 'children' }));
    const below = resolveAssetSet(rule({ start: { mode: 'asset', assetId: 'BOREAS_F1_WTG01' }, depth: 'descendants' }));
    expect(children.assetIds).toHaveLength(6);
    expect(below.assetIds.length).toBeGreaterThan(children.assetIds.length);
    expect(below.assetIds).not.toContain('BOREAS_F1_WTG01');
  });

  test('a start parameter: one definition, different answers per start', () => {
    const turbinesOf = rule({ start: { mode: 'parameter' }, depth: 'children', typeIds: [GEARED, DIRECT] });
    expect(resolveAssetSet(turbinesOf).error).toMatch(/start/);
    expect(resolveAssetSet(turbinesOf, { start: 'BOREAS_F1' }).assetIds).toHaveLength(6);
    expect(resolveAssetSet(turbinesOf, { start: 'BOREAS_F4' }).assetIds).toHaveLength(5);
  });

  test('worst N by a property, lowest first', () => {
    const worst = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT], rank: { mode: 'lowest', key: 'power_curve_perf_pct', count: 3 } }));
    const vals = worst.assetIds.map(id => ASSET_VALUES[id].power_curve_perf_pct);
    expect(vals).toHaveLength(3);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
    const all = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT] })).assetIds.map(id => ASSET_VALUES[id].power_curve_perf_pct);
    expect(vals[0]).toBe(Math.min(...all));
  });

  test('best N, highest first', () => {
    const best = resolveAssetSet(rule({ typeIds: [GEARED], rank: { mode: 'highest', key: 'active_power_kw', count: 2 } }));
    const vals = best.assetIds.map(id => ASSET_VALUES[id].active_power_kw);
    expect(vals[0]).toBeGreaterThanOrEqual(vals[1]);
  });

  test('conditions are ANDed, and a half-filled one is ignored', () => {
    const r = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT], conditions: [
      { key: 'availability_pct', op: '>=', value: 99 },
      { key: 'wind_speed_ms', op: '>', value: 12 },
      { key: 'active_power_kw', op: '<', value: null },
    ] }));
    expect(r.assetIds.length).toBeGreaterThan(0);
    r.assetIds.forEach(id => {
      expect(ASSET_VALUES[id].availability_pct).toBeGreaterThanOrEqual(99);
      expect(ASSET_VALUES[id].wind_speed_ms).toBeGreaterThan(12);
    });
  });

  test('open attention counts the asset an item names and everything above it', () => {
    const r = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT], attention: 'open' }));
    // WTG-05's attention item is on its HS bearing, not the turbine itself.
    expect(r.assetIds).toContain('BOREAS_F1_WTG05');
    const none = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT], attention: 'none' }));
    expect(none.assetIds).not.toContain('BOREAS_F1_WTG05');
    expect(r.assetIds.length + none.assetIds.length).toBe(24);
  });

  test('steps explain the narrowing', () => {
    const r = resolveAssetSet(rule({ typeIds: [GEARED, DIRECT], rank: { mode: 'lowest', key: 'power_curve_perf_pct', count: 5 } }));
    expect(r.steps.map(s => s.count)).toEqual([328, 24, 5]);
  });
});

describe('editor helpers', () => {
  test('suggestStart finds a start that gives a non-empty set', () => {
    const turbinesOf = rule({ start: { mode: 'parameter' }, depth: 'children', typeIds: [GEARED] });
    const start = suggestStart(turbinesOf);
    expect(resolveAssetSet(turbinesOf, { start }).assetIds.length).toBeGreaterThan(0);
  });

  test('propertiesOf lists what the candidates have', () => {
    const keys = propertiesOf(ruleCandidates({ ...DEFAULT_RULE, typeIds: [GEARED] })).map(p => p.key);
    expect(keys).toContain('power_curve_perf_pct');
    expect(keys).not.toContain('gearbox_oil_temp_c');
  });

  test('describe', () => {
    expect(describeAssetSet(rule({ typeIds: [GEARED], rank: { mode: 'lowest', key: 'power_curve_perf_pct', count: 5 } })))
      .toBe('WTG 2.3 MW Geared · lowest 5 by Power Curve Performance');
    expect(describeAssetSet({ kind: 'picked', picked: { assetIds: ['a', 'b'] } })).toBe('2 picked');
  });
});
