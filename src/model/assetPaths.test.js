// model/assetPaths.test.js
// Paths from "self", against the real wind pack.
//   npx react-scripts test --watchAll=false src/model

import { ASSET_VALUES } from './modelData';
import {
  followPath, resolveAssetValue, resolveAssetSeries, reachableFrom, checkAssetBinding,
  describeAssetBinding, PARENT,
} from './assetPaths';
import { loadPackForTests } from './loadPackForTests';

beforeAll(() => loadPackForTests('wind'));

const GEARED = 'TYPE_turbine_wtg_geared';
const DIRECT = 'TYPE_turbine_wtg_direct_drive';
const GEARBOX_OIL = { type: 'asset', path: ['drivetrain', 'gearbox'], property: 'gearbox_oil_temp_c' };

describe('following a path', () => {
  test('down by type', () => {
    expect(followPath('BOREAS_F1_WTG01', ['drivetrain', 'gearbox'])).toEqual({ assetId: 'BOREAS_F1_WTG01_DRIVETRAIN_GEARBOX' });
  });
  test('the same path from another turbine finds its own gearbox', () => {
    expect(followPath('BOREAS_F2_WTG09', ['drivetrain', 'gearbox']).assetId).toBe('BOREAS_F2_WTG09_DRIVETRAIN_GEARBOX');
  });
  test('up, and self', () => {
    expect(followPath('BOREAS_F1_WTG01', [PARENT]).assetId).toBe('BOREAS_F1');
    expect(followPath('BOREAS_F1_WTG01', []).assetId).toBe('BOREAS_F1_WTG01');
  });
  test('a step with no match, several matches, or past the top', () => {
    expect(followPath('BOREAS_F4_WTG20', ['drivetrain']).error).toBe('none');       // direct drive: no drivetrain
    expect(followPath('BOREAS_F1', ['wtg_geared']).error).toBe('many');             // a feeder has six
    expect(followPath('BOREAS', [PARENT]).error).toBe('noParent');
  });
});

describe('resolving values', () => {
  test('a value, and why one is missing', () => {
    expect(resolveAssetValue('BOREAS_F1_WTG01', GEARBOX_OIL.path, GEARBOX_OIL.property).value)
      .toBe(ASSET_VALUES.BOREAS_F1_WTG01_DRIVETRAIN_GEARBOX.gearbox_oil_temp_c);
    expect(resolveAssetValue('BOREAS_F1_WTG01', [], 'no_such_property').error).toBe('noValue');
  });
  test('a series as rows', () => {
    const { rows } = resolveAssetSeries('BOREAS_F1_WTG01', [], 'active_power_kw');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]).toEqual({ timestamp: expect.any(String), value: expect.any(Number) });
    expect(resolveAssetSeries('BOREAS_F1_WTG01', [], 'rated_power_kw').error).toBe('noSeries');
  });
});

describe('reachable from a type', () => {
  test('self, ancestors and components, each with their properties', () => {
    const nodes = reachableFrom(GEARED);
    const keys = nodes.map(n => n.key);
    expect(keys[0]).toBe('self');
    expect(keys).toEqual(expect.arrayContaining(['..', '../..', 'drivetrain', 'drivetrain/gearbox', 'rotor/pitch_system']));
    const gearbox = nodes.find(n => n.key === 'drivetrain/gearbox');
    expect(gearbox.properties.map(p => p.key)).toContain('gearbox_oil_temp_c');
    expect(gearbox.reach).toEqual({ ok: 19, of: 19 });
    expect(nodes.find(n => n.key === '..').typeLabel).toBe('Collector Feeder');
  });
  test('direct drive has no gearbox path', () => {
    expect(reachableFrom(DIRECT).map(n => n.key)).not.toContain('drivetrain/gearbox');
  });
});

describe('checking a binding against a type', () => {
  test('ok on its own type, broken on one without that path, partial on shared paths that some lack', () => {
    expect(checkAssetBinding(GEARBOX_OIL, GEARED).status).toBe('ok');
    expect(checkAssetBinding(GEARBOX_OIL, DIRECT).status).toBe('broken');
    expect(checkAssetBinding({ path: [], property: 'active_power_kw' }, DIRECT).status).toBe('ok');
  });
  test('describe', () => {
    expect(describeAssetBinding(GEARBOX_OIL)).toBe('self › Drivetrain › Gearbox · Gearbox Oil Temperature');
  });
});
