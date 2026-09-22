import { getWidgetOptionCatalog, inferOptionType, defFromOption, isValidOptionPath } from './widgetOptionCatalog';
import { getShippedWidgetPropertyDefs } from './widgetPropertyDefs';

describe('widget option catalog', () => {
  test('flattens the configuration into dot paths', () => {
    const names = getWidgetOptionCatalog('CircularGauge').map(o => o.name);
    expect(names).toEqual(expect.arrayContaining(['title.text', 'scale.startValue', 'geometry.endAngle', 'rangeContainer.ranges']));
    expect(names).not.toContain('scale'); // only leaves
  });

  test('a null default gets a type from its name, flagged as a guess', () => {
    const title = getWidgetOptionCatalog('CircularGauge').find(o => o.name === 'title.text');
    expect(title).toMatchObject({ type: 'string', guessed: true, group: 'Title' });
    expect(inferOptionType('foo.bar', null)).toEqual({ type: 'unknown' });
  });

  test('arrays and empty objects are exposed as JSON, keeping their value', () => {
    const ranges = getWidgetOptionCatalog('CircularGauge').find(o => o.name === 'rangeContainer.ranges');
    expect(ranges).toMatchObject({ type: 'json', value: [] });
    expect(defFromOption(ranges)).toEqual({ name: 'rangeContainer.ranges', label: 'Ranges', type: 'json', default: [] });
    expect(inferOptionType('scale.label', {}).type).toBe('json');
    // No value to read means no default at all, rather than a made-up one.
    expect('default' in defFromOption({ name: 'x.y', type: 'json' })).toBe(false);
  });

  test('collections are data, colours are colour', () => {
    expect(inferOptionType('dataSource', null).type).toBe('data');
    expect(inferOptionType('containerBackgroundColor', '#ffffff').type).toBe('color');
  });

  test('exposed properties missing from the configuration still get a row', () => {
    const catalog = getWidgetOptionCatalog('Scheduler', getShippedWidgetPropertyDefs('Scheduler'));
    expect(catalog.length).toBe(getShippedWidgetPropertyDefs('Scheduler').length);
    expect(catalog.every(o => o.source === 'exposed')).toBe(true);
  });

  test('General sorts first', () => {
    expect(getWidgetOptionCatalog('CircularGauge')[0].group).toBe('General');
  });

  test('a new definition takes the configured default, else one for its type', () => {
    expect(defFromOption({ name: 'geometry.startAngle', type: 'number', value: 135 })).toEqual({ name: 'geometry.startAngle', label: 'Start Angle', type: 'number', default: 135 });
    expect(defFromOption({ name: 'title.text', type: 'string', guessed: true })).toEqual({ name: 'title.text', label: 'Title', type: 'string', default: '' });
    expect(defFromOption({ name: 'x.y', type: 'unknown' }).type).toBe('string');
  });

  test('option paths', () => {
    expect(isValidOptionPath('title.text')).toBe(true);
    expect(isValidOptionPath('title..text')).toBe(false);
    expect(isValidOptionPath('1abc')).toBe(false);
  });
});
