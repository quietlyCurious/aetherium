// containerStyles.test.js
//   npx react-scripts test --watchAll=false src/containerStyles

import { getCoordStyle, getSlotStyle } from './containerStyles';
import { DEFAULT_COORD, getWidgetDefaultSlot } from './containerModel';

describe('coordinate children', () => {
  test("own their size: the slot's default min-size doesn't floor them", () => {
    // How ContainerCard merges the two for a coordinate child.
    const slot = getSlotStyle(getWidgetDefaultSlot('CircularGauge')).card; // 250×200, min 250×200
    const card = { ...slot, ...getCoordStyle({ ...DEFAULT_COORD, width: 80, height: 80 }) };
    expect(card).toMatchObject({ width: '80px', height: '80px' });
    expect(card.minWidth).toBeUndefined();
    expect(card.minHeight).toBeUndefined();
  });

  test('keep an explicit coordinate min/max', () => {
    const style = getCoordStyle({ ...DEFAULT_COORD, minWidth: 60, maxHeight: 120 });
    expect(style).toMatchObject({ minWidth: '60px', maxHeight: '120px' });
    expect(style.maxWidth).toBeUndefined();
  });
});
