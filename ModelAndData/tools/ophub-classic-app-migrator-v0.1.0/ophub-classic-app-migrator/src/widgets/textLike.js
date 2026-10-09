// Classic Text and Header  ->  `text` plugin.
// Both show one bound or manual value; Header differs only in size and has no label.

import { manualBinding, toPluginBinding } from '../bindings.js';
import { toTitleAlignment } from '../util.js';
import { describeSource, noteDroppedBackground, noteFormat, pluginColorString } from './common.js';

const HEADER_FONT_PT = { h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11 };

function textData(ctx, classic, { label, fontSize }, notes) {
  return {
    label: manualBinding(label || ''),
    inputValue: toPluginBinding(ctx, classic.data?.source, notes),
    textAlignment: toTitleAlignment(classic.style?.horizontalAlignment),
    numberFormat: { useRawFormat: true },
    advanced: {
      styling: {
        fontFamily: 'Arial',
        fontSize,
        fontUnits: 'pt',
        fontColor: pluginColorString(classic.customStyle ? classic.style?.color : null),
      },
    },
  };
}

export function convertText(classic, ctx) {
  const notes = [];
  const data = textData(ctx, classic, { label: classic.label, fontSize: 12 }, notes);
  noteFormat(classic, notes);
  noteDroppedBackground(classic, notes);
  return {
    typeName: 'text',
    data,
    size: { width: 260, height: 60 },
    label: [classic.label, describeSource(classic.data?.source)].filter(Boolean).join(': '),
    notes,
  };
}

export function convertHeader(classic, ctx) {
  const notes = [];
  const level = classic.headerType || 'h3';
  const data = textData(ctx, classic, { label: '', fontSize: HEADER_FONT_PT[level] || 16 }, notes);
  noteFormat(classic, notes);
  noteDroppedBackground(classic, notes);
  return {
    typeName: 'text',
    data,
    size: { width: 420, height: 60 },
    label: `${level.toUpperCase()}: ${describeSource(classic.data?.source)}`,
    notes,
  };
}
