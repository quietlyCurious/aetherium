// widgetCoverage.test.js
// Keeps the three lists that decide what a page builder can actually use in
// step with each other:
//   widgetData.js        the widgets the Visuals tree offers
//   WidgetPreview.jsx    the ones that can draw themselves
//   widgetSupport.js     the ones we deliberately don't place yet, and why
// A widget added to the tree with neither a component nor a reason would
// land on a canvas as a placeholder icon, which is the failure this catches.
//
// WidgetPreview's map is read as source rather than imported: importing it
// pulls in every DevExtreme component, which is a lot of work for a list of
// names.

import fs from 'fs';
import path from 'path';
import { DX_WIDGET_DATA } from './widgetData';
import { UNSUPPORTED_WIDGETS, WIDGET_SUPPORT_KINDS, widgetSupport, isWidgetPlaceable } from './widgetSupport';
import { WIDGET_PROPERTIES } from './widgetProperties';

function mappedWidgetNames() {
  const source = fs.readFileSync(path.join(__dirname, 'WidgetPreview.jsx'), 'utf8');
  const start = source.indexOf('WIDGET_COMPONENT_MAP = {');
  const end = source.indexOf('\n};', start);
  return new Set([...source.slice(start, end).matchAll(/^ {2}([A-Za-z]+): \(props\)/gm)].map(m => m[1]));
}

const WIDGETS = DX_WIDGET_DATA.filter(w => w.assetLevel === 'widget' && !w.custom);

describe('widget coverage', () => {
  test('every widget offered is either drawable or explained', () => {
    const mapped = mappedWidgetNames();
    const stranded = WIDGETS.filter(w => !mapped.has(w.name) && !UNSUPPORTED_WIDGETS[w.name]).map(w => w.name);
    expect(stranded).toEqual([]);
  });

  test("a widget we don't place has no component, and vice versa", () => {
    const mapped = mappedWidgetNames();
    const contradictory = Object.keys(UNSUPPORTED_WIDGETS).filter(name => mapped.has(name));
    expect(contradictory).toEqual([]);
  });

  test('every placeable widget exposes properties to configure', () => {
    const missing = WIDGETS.filter(w => isWidgetPlaceable(w.name) && !(WIDGET_PROPERTIES[w.name] || []).length).map(w => w.name);
    expect(missing).toEqual([]);
  });

  test('every reason names a real widget and a known kind', () => {
    const names = new Set(WIDGETS.map(w => w.name));
    Object.entries(UNSUPPORTED_WIDGETS).forEach(([name, kind]) => {
      expect(names.has(name)).toBe(true);
      expect(WIDGET_SUPPORT_KINDS[kind]).toEqual(expect.any(String));
    });
  });

  test('widgetSupport answers for both cases', () => {
    expect(widgetSupport('Tabs')).toBeNull();
    expect(widgetSupport('Popover')).toEqual({ kind: 'overlay', reason: WIDGET_SUPPORT_KINDS.overlay });
    expect(isWidgetPlaceable('Tabs')).toBe(true);
    expect(isWidgetPlaceable('Popover')).toBe(false);
  });
});
