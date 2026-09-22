const KEY = 'aetherium_widget_property_overrides';

// The store loads storage once, at import — so each test gets a fresh copy.
function freshStore() {
  let mod;
  jest.isolateModules(() => { mod = require('./widgetPropertyDefs'); });
  return mod;
}

beforeEach(() => window.localStorage.clear());

describe('widget property defs store', () => {
  test('falls back to the shipped list', () => {
    const s = freshStore();
    expect(s.getWidgetPropertyDefs('CircularGauge')).toBe(s.getShippedWidgetPropertyDefs('CircularGauge'));
    expect(s.getWidgetPropertyDefs('NoSuchWidget')).toEqual([]);
    expect(s.isWidgetCustomized('CircularGauge')).toBe(false);
  });

  test('a saved list replaces the shipped one and persists', () => {
    const s = freshStore();
    const next = [...s.getShippedWidgetPropertyDefs('CircularGauge'), { name: 'title.text', label: 'Title', type: 'string', default: '' }];
    const listener = jest.fn();
    s.widgetPropertyDefsStore.subscribe(listener);
    s.saveWidgetPropertyDefs('CircularGauge', next);
    expect(listener).toHaveBeenCalled();
    expect(s.getWidgetPropertyDef('CircularGauge', 'title.text').label).toBe('Title');
    expect(s.isWidgetCustomized('CircularGauge')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY)).CircularGauge.properties).toHaveLength(next.length);
    const reloaded = freshStore();
    expect(reloaded.getWidgetPropertyDef('CircularGauge', 'title.text')).toBeTruthy();
  });

  test('saving the shipped list, or resetting, clears the override', () => {
    const s = freshStore();
    s.saveWidgetPropertyDefs('CircularGauge', [{ name: 'value', label: 'V', type: 'number' }]);
    s.saveWidgetPropertyDefs('CircularGauge', s.getShippedWidgetPropertyDefs('CircularGauge'));
    expect(s.isWidgetCustomized('CircularGauge')).toBe(false);
    s.saveWidgetPropertyDefs('Switch', []);
    expect(s.getWidgetPropertyDefs('Switch')).toEqual([]);
    s.resetWidgetPropertyDefs('Switch');
    expect(s.getWidgetPropertyDefs('Switch').length).toBeGreaterThan(0);
  });

  test('on load, stored lists matching what ships are dropped and bad entries cleaned', () => {
    const first = freshStore();
    window.localStorage.setItem(KEY, JSON.stringify({
      CircularGauge: { properties: first.getShippedWidgetPropertyDefs('CircularGauge') },
      Switch: { properties: [{ name: 'value', type: 'weird' }, { nope: 1 }, { name: 'value' }] },
    }));
    const s = freshStore();
    expect(s.isWidgetCustomized('CircularGauge')).toBe(false);
    expect(s.getWidgetPropertyDefs('Switch')).toEqual([{ name: 'value', label: 'value', type: 'string' }]);
  });

  test('groups: a definition\'s own, else the first part of its path', () => {
    const s = freshStore();
    const groups = s.groupWidgetPropertyDefs([
      { name: 'scale.startValue' }, { name: 'value' }, { name: 'rangeContainer.width', group: 'Ring' }, { name: 'scale.endValue' },
    ]);
    expect(groups.map(g => [g.group, g.defs.map(d => d.name)])).toEqual([
      ['Scale', ['scale.startValue', 'scale.endValue']],
      ['General', ['value']],
      ['Ring', ['rangeContainer.width']],
    ]);
    // A group with nothing exposed never appears.
    expect(s.groupWidgetPropertyDefs([{ name: 'value' }]).map(g => g.group)).toEqual(['General']);
  });

  test('a new widget starts with every default, leaving undefined ones unset', () => {
    const s = freshStore();
    s.saveWidgetPropertyDefs('Switch', [{ name: 'value', label: 'Value', type: 'bool', default: true }, { name: 'hint', label: 'Hint', type: 'string' }]);
    expect(s.defaultPropsFor('Switch')).toEqual({ value: true });
  });
});
