// designer/screens/screenProperty.test.js
// Screens about a property: what each field reads, and binding to them,
// against the real wind pack.
//   npx react-scripts test --watchAll=false src/designer/screens

import { loadPackForTests } from '../../model/loadPackForTests';
import { ASSET_VALUES, PROPERTY_RANGES } from '../../model/modelData';
import { PROPERTY_FIELDS, defaultPreviewAssetId, previewablePropertyKeys, resolvePropertyField } from './screenProperty';
import { resolveWidgetProps, hasBrokenBinding } from './widgetBindings';
import { checkPageBindingsForAbout, ABOUT_ANY_PROPERTY } from './screenAsset';

beforeAll(() => loadPackForTests('wind'));

const SELF = { assetId: 'BOREAS_F1_WTG01', propertyKey: 'active_power_kw' };

describe('property fields', () => {
  test('every field resolves for a numeric property with a range and a history', () => {
    PROPERTY_FIELDS.forEach(f => {
      const r = resolvePropertyField(SELF, f.id);
      expect(r.error).toBeUndefined();
    });
    expect(resolvePropertyField(SELF, 'value').value).toBe(ASSET_VALUES.BOREAS_F1_WTG01.active_power_kw);
    expect(resolvePropertyField(SELF, 'history').rows.length).toBeGreaterThan(10);
    const pct = resolvePropertyField(SELF, 'percent').value;
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    expect(resolvePropertyField(SELF, 'display').value).toMatch(/kW$/);
  });

  test('a given value wins over the model (a time-scrubbed box)', () => {
    const [min, max] = PROPERTY_RANGES.active_power_kw;
    const r = resolvePropertyField({ ...SELF, value: (min + max) / 2 }, 'percent');
    expect(r.value).toBe(50);
  });

  test('no property self is an error, not a value', () => {
    expect(resolvePropertyField(null, 'value').error).toBe('noProperty');
  });

  test('preview defaults to a fully-featured property first', () => {
    const assetId = defaultPreviewAssetId();
    const key = previewablePropertyKeys(assetId)[0];
    expect(typeof ASSET_VALUES[assetId][key]).toBe('number');
    expect(PROPERTY_RANGES[key]).toBeTruthy();
  });
});

describe('property bindings', () => {
  test('scalar and list widget properties each take their own fields', () => {
    const gauge = resolveWidgetProps({ value: 0 }, { value: { type: 'property', field: 'value' } }, 'CircularGauge', { property: SELF });
    expect(gauge.value).toBe(ASSET_VALUES.BOREAS_F1_WTG01.active_power_kw);
    const chart = resolveWidgetProps({}, { dataSource: { type: 'property', field: 'history' } }, 'Chart', { property: SELF });
    expect(chart.dataSource.length).toBeGreaterThan(10);
    // A Sparkline is pointed at the history rows' columns.
    const spark = resolveWidgetProps({ argumentField: 'arg' }, { dataSource: { type: 'property', field: 'history' } }, 'Sparkline', { property: SELF });
    expect(spark).toMatchObject({ argumentField: 'timestamp', valueField: 'value' });
  });

  test('without a property self they keep the static value and count as broken', () => {
    const bindings = { value: { type: 'property', field: 'value' } };
    expect(resolveWidgetProps({ value: 7 }, bindings, 'CircularGauge', {}).value).toBe(7);
    expect(hasBrokenBinding(bindings, 'CircularGauge', {})).toBe(true);
    expect(hasBrokenBinding(bindings, 'CircularGauge', { property: SELF })).toBe(false);
  });

  test('changing About checks property bindings too', () => {
    const tree = [{ id: 'root', children: [{ id: 'w', title: 'Gauge', bindings: { value: { type: 'property', field: 'value' } }, children: [] }] }];
    expect(checkPageBindingsForAbout(tree, ABOUT_ANY_PROPERTY).broken).toHaveLength(0);
    expect(checkPageBindingsForAbout(tree, null).broken).toHaveLength(1);
  });
});
