// customWidgets/customWidgets.test.js
//   npx react-scripts test --watchAll=false src/customWidgets

import { formatTextValue } from './textFormat';
import { CUSTOM_WIDGETS, isCustomWidget } from './customWidgets';
import { getWidgetOptionCatalog } from '../designer/widgets/widgetOptionCatalog';
import { WIDGET_PROPERTIES } from '../widgetProperties';
import { DX_WIDGET_DATA } from '../widgetData';
import { WIDGET_COMPONENT_MAP } from '../WidgetPreview';

describe('Text formatting', () => {
  test('numbers round only when asked', () => {
    expect(formatTextValue(68.4321)).toBe('68.4321');
    expect(formatTextValue(68.4321, { decimals: '1' })).toBe('68.4');
    expect(formatTextValue('68.46', { decimals: '1' })).toBe('68.5');
    expect(formatTextValue(12, { decimals: '0', suffix: ' kW' })).toBe('12 kW');
  });

  test('text passes through, blanks stay blank', () => {
    expect(formatTextValue('Oil temperature', { decimals: '2' })).toBe('Oil temperature');
    expect(formatTextValue(null, { prefix: '$' })).toBe('');
    expect(formatTextValue(0)).toBe('0');
  });
});

describe('custom widgets are wired everywhere a widget needs to be', () => {
  Object.keys(CUSTOM_WIDGETS).forEach(name => {
    test(name, () => {
      expect(isCustomWidget(name)).toBe(true);
      expect(DX_WIDGET_DATA.find(w => w.name === name)).toMatchObject({ assetLevel: 'widget', custom: true });
      expect(WIDGET_COMPONENT_MAP[name]).toBeDefined();
      // The Widgets area lists its own options even with no generated file.
      const catalog = getWidgetOptionCatalog(name, [], null);
      expect(catalog.map(o => o.name)).toEqual(expect.arrayContaining(CUSTOM_WIDGETS[name].options.map(o => o.n)));
      // Everything it exposes is an option it really has.
      const optionNames = new Set(CUSTOM_WIDGETS[name].options.map(o => o.n));
      (WIDGET_PROPERTIES[name] || []).forEach(def => expect(optionNames.has(def.name)).toBe(true));
    });
  });
});
