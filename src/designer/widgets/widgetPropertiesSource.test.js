import { widgetPropertiesToSource, toJsLiteral, defToSource } from './widgetPropertiesSource';
import { WIDGET_PROPERTIES } from '../../widgetProperties';

// Evaluates generated source back into an object.
function evaluate(source) {
  const body = source.replace('export { WIDGET_PROPERTIES };', 'return WIDGET_PROPERTIES;');
  return new Function(body)(); // eslint-disable-line no-new-func
}

describe('widgetProperties.js export', () => {
  test('round-trips the shipped list exactly', () => {
    const out = evaluate(widgetPropertiesToSource(WIDGET_PROPERTIES));
    expect(out).toEqual(WIDGET_PROPERTIES);
  });

  test('the committed file is byte-for-byte what the exporter writes', () => {
    const fs = require('fs');
    const path = require('path');
    const committed = fs.readFileSync(path.join(__dirname, '../../widgetProperties.js'), 'utf8');
    expect(widgetPropertiesToSource(WIDGET_PROPERTIES)).toBe(committed);
  });

  test('quotes and key order', () => {
    expect(toJsLiteral("it's")).toBe("'it\\'s'");
    expect(defToSource({ group: 'Scale', default: 0, type: 'number', label: 'L', name: 'n' }))
      .toBe("{ name: 'n', label: 'L', type: 'number', default: 0, group: 'Scale' }");
  });

  test('added properties and unknown widgets survive', () => {
    const edited = { ...WIDGET_PROPERTIES, CircularGauge: [{ name: 'title.text', label: 'Title', type: 'string', default: '' }], Mystery: [] };
    const out = evaluate(widgetPropertiesToSource(edited));
    expect(out.CircularGauge).toEqual(edited.CircularGauge);
    expect(out.Mystery).toEqual([]);
  });
});
