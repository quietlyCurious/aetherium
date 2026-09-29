// customWidgets/customWidgets.js
// Widgets that are Aetherium's own rather than DevExtreme's. Each entry
// carries both halves of what a widget needs:
//
//   component  what renders it (WidgetPreview looks custom widgets up here)
//   options    every option it accepts, in the same shape as
//              public/data/widget-options.json's entries — { n, t, o?, d? }
//              — so the Widgets area lists them like any other widget's.
//
// widget-options.json is generated from DevExtreme's own type declarations
// (scripts/generateWidgetOptions.js), which know nothing about these, so
// the generator skips any catalog entry marked `custom: true` and this file
// is where their options come from instead. Adding a custom widget: write
// the component, add it here, add it to widgetData.js with `custom: true`,
// and give it an exposed list in widgetProperties.js (via the Widgets
// area's Export).

import { TextWidget } from './TextWidget';
import { DECIMALS_CHOICES } from './textFormat';

export const CUSTOM_WIDGETS = {
  Text: {
    component: TextWidget,
    options: [
      { n: 'text', t: 'string', d: 'Text' },
      { n: 'fontSize', t: 'number', d: 16 },
      { n: 'fontWeight', t: 'enum', o: ['normal', '300', '500', '600', 'bold'], d: 'normal' },
      { n: 'color', t: 'color', d: '' },
      { n: 'textAlign', t: 'enum', o: ['left', 'center', 'right'], d: 'left' },
      { n: 'verticalAlign', t: 'enum', o: ['top', 'center', 'bottom'], d: 'center' },
      { n: 'overflow', t: 'enum', o: ['ellipsis', 'wrap', 'shrink'], d: 'ellipsis' },
      { n: 'minFontSize', t: 'number', d: 9 },
      { n: 'decimals', t: 'enum', o: DECIMALS_CHOICES, d: 'auto' },
      { n: 'prefix', t: 'string', d: '' },
      { n: 'suffix', t: 'string', d: '' },
    ],
  },
};

export function isCustomWidget(widgetName) {
  return Object.prototype.hasOwnProperty.call(CUSTOM_WIDGETS, widgetName);
}

// { [widgetName]: options } — merged over the generated file's widgets.
export const CUSTOM_WIDGET_OPTIONS = Object.fromEntries(
  Object.entries(CUSTOM_WIDGETS).map(([name, w]) => [name, w.options]),
);
