// Helpers shared by the per-widget converters.

import { toPluginColor } from '../util.js';
import { SEVERITY } from '../report.js';

/** Plugins store font colors as a JSON-stringified {hex, rgb} object. */
export function pluginColorString(css, fallbackHex = '#000000') {
  const c = toPluginColor(css) || toPluginColor(fallbackHex);
  return JSON.stringify(c);
}

/** Short human label for a classic source, used in the report. */
export function describeSource(source) {
  if (!source) return '';
  if (source.type === 'manual') return String(source.value ?? '').slice(0, 60);
  if (source.type === 'flow' && source.value && typeof source.value === 'object') {
    const v = source.value;
    return v.ioType === 'globals' || v.type === 'globals'
      ? `Global: ${v.fieldName}`
      : `${v.flowAlias || v.flowName || 'Query'} › ${v.fieldName}`;
  }
  if (source.type === 'upload') return source.name || 'uploaded image';
  return source.type;
}

/** Note when a classic widget used a non-default background the plugin has no slot for. */
export function noteDroppedBackground(classic, notes) {
  const bg = classic.style?.backgroundColor;
  if (!classic.customStyle || !bg) return;
  const c = toPluginColor(bg);
  const isWhiteOrClear = c && ((c.rgb.r === 255 && c.rgb.g === 255 && c.rgb.b === 255) || c.rgb.a === 0);
  if (!isWhiteOrClear) notes.push({ severity: SEVERITY.INFO, text: `Background color ${bg} not carried over; set it on the card if needed.` });
}

/** Classic widgets that had a non-flow "format" (date, currency…) lose it. */
export function noteFormat(classic, notes) {
  const fmt = classic.format;
  if (fmt && fmt !== 'string' && fmt !== 'number') {
    notes.push({ severity: SEVERITY.INFO, text: `Classic "${fmt}" output format not carried over; set Number/Date formatting on the new widget.` });
  }
}
