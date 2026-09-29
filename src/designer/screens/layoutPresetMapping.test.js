// designer/screens/layoutPresetMapping.test.js
//   npx react-scripts test --watchAll=false src/designer/screens

import { layoutPresetState, layoutUpdateForPreset } from './layoutPresetMapping';
import { DEFAULT_LAYOUT } from '../../containerModel';
import { getLayoutStyle } from '../../containerStyles';

test('a default container reads as Flex · Row · No Wrap · Distribute', () => {
  expect(layoutPresetState(DEFAULT_LAYOUT)).toEqual({ arrange: 'flex', direction: 'row', wrap: 'nowrap', alignContent: 'stretch' });
});

test('each preset sets only its own existing field', () => {
  expect(layoutUpdateForPreset('arrange', 'manual')).toEqual({ layoutType: 'coordinate' });
  expect(layoutUpdateForPreset('direction', 'column')).toEqual({ flexDirection: 'column' });
  expect(layoutUpdateForPreset('wrap', 'nowrap')).toEqual({ flexWrap: 'no wrap' });
  expect(layoutUpdateForPreset('alignContent', 'flex-start')).toEqual({ alignContent: 'flex-start' });
  expect(layoutUpdateForPreset('direction', 'sideways')).toBeNull();
});

test('a field set by hand outside the presets shows that preset unselected', () => {
  const state = layoutPresetState({ ...DEFAULT_LAYOUT, layoutType: 'grid', flexDirection: 'row-reverse', flexWrap: 'wrap-reverse', alignContent: 'center' });
  expect(state).toEqual({ arrange: null, direction: null, wrap: null, alignContent: null });
});

test('align-content reaches the style only when set', () => {
  expect(getLayoutStyle(DEFAULT_LAYOUT).alignContent).toBeUndefined();
  expect(getLayoutStyle({ ...DEFAULT_LAYOUT, alignContent: 'flex-start' }).alignContent).toBe('flex-start');
});
