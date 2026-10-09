// Registry: classic component -> converter, plus the types deliberately left out.
// Every converter has the same signature:  (classicComponent, ctx) => {
//   typeName, data, size:{width,height}, label, notes[], multiActions?, pluginInfo? }

import { convertButton, convertImage } from './clickable.js';
import { convertCustomHtml, isClassicCustomHtml } from './customCode.js';
import { convertBarGraph, convertGraph, convertTable, convertVisualization } from './dataDisplay.js';
import { convertDropdown, convertInput } from './inputs.js';
import { convertPluginWidget } from './pluginWidget.js';
import { convertHeader, convertText } from './textLike.js';

const BY_TYPE = {
  embedded_html: convertPluginWidget,
  text: convertText,
  header: convertHeader,
  image: convertImage,
  button: convertButton,
  dropdown: convertDropdown,
  input: convertInput,
  table: convertTable,
  visualization: convertVisualization,
  graph: convertGraph,
  bar_graph: convertBarGraph,
};

/** Converter for a classic component, or null if it has no new-designer equivalent. */
export function converterFor(component) {
  if (isClassicCustomHtml(component)) return convertCustomHtml;
  return BY_TYPE[component?.type] || null;
}

/** True for classic components that are real plugins (copied rather than mapped). */
export function isClassicPlugin(component) {
  return component?.type === 'embedded_html' && !isClassicCustomHtml(component);
}

/** Classic types with no new-designer equivalent, and why. */
export const SKIPPED_TYPES = {
  new_line: 'Layout-only spacer; not needed with cards.',
  indoor_mapping: 'Interactive Map has no new-designer equivalent.',
};

/** Human name for a classic component, for the report. */
export function classicTypeName(component) {
  if (isClassicCustomHtml(component)) return 'HTML (custom code)';
  if (component?.type === 'embedded_html') return `Plugin: ${component.typeName}`;
  return {
    text: 'Text', header: 'Header', image: 'Image', button: 'Button', dropdown: 'Dropdown',
    input: 'Input', table: 'Table', visualization: 'Visualization', graph: 'Graph',
    bar_graph: 'Bar Graph', new_line: 'New Line', indoor_mapping: 'Interactive Map',
  }[component?.type] || component?.typeName || component?.type || 'Unknown';
}
