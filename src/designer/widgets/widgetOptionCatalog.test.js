import { getWidgetOptionCatalog, inferOptionType, defFromOption, isValidOptionPath } from './widgetOptionCatalog';
import { getShippedWidgetPropertyDefs } from './widgetPropertyDefs';

// What the generated file (public/data/widget-options.json) looks like.
const GENERATED = {
  CircularGauge: [
    { n: 'value', t: 'number' },
    { n: 'title.text', t: 'string' },
    { n: 'rangeContainer.orientation', t: 'enum', o: ['inside', 'outside', 'center'], d: 'outside' },
    { n: 'rangeContainer.ranges', t: 'json', d: [] },
    { n: 'export.enabled', t: 'bool', d: false },
    { n: 'palette', t: 'enum' },
  ],
};

describe('the generated catalog', () => {
  test('is used when it loaded, in place of the configuration', () => {
    const catalog = getWidgetOptionCatalog('CircularGauge', [], GENERATED);
    expect(catalog.map(o => o.name)).toEqual([
      'export.enabled', 'palette', 'value', 'rangeContainer.orientation', 'rangeContainer.ranges', 'title.text',
    ].sort((a, b) => {
      const ga = a.includes('.') ? a.split('.')[0] : 'General';
      const gb = b.includes('.') ? b.split('.')[0] : 'General';
      return (ga === 'General' ? -1 : 0) - (gb === 'General' ? -1 : 0) || ga.localeCompare(gb) || a.localeCompare(b);
    }));
    expect(catalog.every(o => o.source === 'catalog')).toBe(true);
    expect(catalog.every(o => !o.guessed)).toBe(true);  // real types, nothing inferred
  });

  test("an enum carries the declarations' choices into the definition", () => {
    const catalog = getWidgetOptionCatalog('CircularGauge', [], GENERATED);
    const orientation = catalog.find(o => o.name === 'rangeContainer.orientation');
    expect(orientation).toMatchObject({ type: 'enum', choices: ['inside', 'outside', 'center'], value: 'outside' });
    expect(defFromOption(orientation)).toEqual({
      name: 'rangeContainer.orientation', label: 'Orientation', type: 'enum',
      options: ['inside', 'outside', 'center'], default: 'outside',
    });
  });

  test('an enum with no choices is text rather than an empty dropdown', () => {
    const palette = getWidgetOptionCatalog('CircularGauge', [], GENERATED).find(o => o.name === 'palette');
    expect(palette.type).toBe('string');
  });

  test('a widget the file has nothing for still lists what it exposes', () => {
    const defs = [{ name: 'whatever', label: 'Whatever', type: 'string' }];
    const catalog = getWidgetOptionCatalog('Mystery', defs, GENERATED);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ name: 'whatever', source: 'exposed' });
  });
});

describe('widget option catalog', () => {
  // Without the generated file, the area falls back to widgetConfigs.js.
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
