// designer/screens/widgetBindings.test.js
// Resolving a widget's bindings, against the real wind pack.
//   npx react-scripts test --watchAll=false src/designer/screens

import { loadPackForTests } from '../../model/loadPackForTests';
import { resolveWidgetProps, hasBrokenAssetBinding } from './widgetBindings';

beforeAll(() => loadPackForTests('wind'));

const GEARBOX_OIL = { type: 'asset', path: ['drivetrain', 'gearbox'], property: 'gearbox_oil_temp_c' };

describe('asset bindings', () => {
  test('resolve against self, and follow the same path from another asset', () => {
    const a = resolveWidgetProps({ value: 0 }, { value: GEARBOX_OIL }, 'CircularGauge', { assetId: 'BOREAS_F1_WTG01' });
    const b = resolveWidgetProps({ value: 0 }, { value: GEARBOX_OIL }, 'CircularGauge', { assetId: 'BOREAS_F2_WTG09' });
    expect(typeof a.value).toBe('number');
    expect(a.value).not.toBe(0);
    expect(b.value).not.toBe(a.value);
  });

  test('no self, or a path this asset lacks, keeps the static value and counts as broken', () => {
    expect(resolveWidgetProps({ value: 7 }, { value: GEARBOX_OIL }, 'CircularGauge', {}).value).toBe(7);
    expect(resolveWidgetProps({ value: 7 }, { value: GEARBOX_OIL }, 'CircularGauge', { assetId: 'BOREAS_F4_WTG20' }).value).toBe(7);
    expect(hasBrokenAssetBinding({ value: GEARBOX_OIL }, 'CircularGauge', 'BOREAS_F4_WTG20')).toBe(true);
    expect(hasBrokenAssetBinding({ value: GEARBOX_OIL }, 'CircularGauge', 'BOREAS_F1_WTG01')).toBe(false);
  });

  test('a collection property gets history rows', () => {
    const props = resolveWidgetProps({}, { dataSource: { type: 'asset', path: [], property: 'active_power_kw' } }, 'Chart', { assetId: 'BOREAS_F1_WTG01' });
    expect(props.dataSource.length).toBeGreaterThan(10);
    expect(props.dataSource[0]).toEqual({ timestamp: expect.any(String), value: expect.any(Number) });
  });

  test('a Chart with real rows gets one series; an empty Series Group Field means no template', () => {
    const chart = { 'commonSeriesSettings.argumentField': 'timestamp', 'commonSeriesSettings.valueField': 'value', 'seriesTemplate.nameField': '' };
    const bound = { dataSource: { type: 'asset', path: [], property: 'active_power_kw' } };
    const props = resolveWidgetProps(chart, bound, 'Chart', { assetId: 'BOREAS_F1_WTG01' });
    expect(props.seriesTemplate).toBeUndefined();
    expect(props.series).toEqual([{ name: 'value' }]);
    // A real grouping field keeps its template (one series per group), and
    // no rows means the sample data's own series stay in charge.
    const grouped = resolveWidgetProps({ ...chart, 'seriesTemplate.nameField': 'tag' }, bound, 'Chart', { assetId: 'BOREAS_F1_WTG01' });
    expect(grouped.seriesTemplate).toEqual({ nameField: 'tag' });
    expect(grouped.series).toBeUndefined();
    expect(resolveWidgetProps(chart, {}, 'Chart', {}).series).toBeUndefined();
  });
});
