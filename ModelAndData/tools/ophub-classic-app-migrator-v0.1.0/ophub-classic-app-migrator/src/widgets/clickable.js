// Classic Image and Button  ->  `image` and `button` plugins.
// Both carry click actions, which move to the plugin's onClicked command.

import { buildClickCommand } from '../actions.js';
import { toPluginBinding } from '../bindings.js';
import { newId } from '../util.js';
import { SEVERITY } from '../report.js';
import { describeSource } from './common.js';

const BUTTON_COLORS = {
  'btn-primary': '#0582C5', 'btn-success': '#3C9A3C', 'btn-danger': '#D9534F',
  'btn-warning': '#F0AD4E', 'btn-info': '#5BC0DE', 'btn-default': '#9B9B9B',
};

function hexColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { hex, rgb: { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 } };
}

export function convertButton(classic, ctx) {
  const notes = [];
  const { multiActions, commandsPanel } = buildClickCommand(classic.actions, ctx, notes);
  const bg = BUTTON_COLORS[classic.style?.buttonType] || BUTTON_COLORS['btn-primary'];
  return {
    typeName: 'button',
    data: {
      label: classic.text ?? 'Submit',
      advanced: {
        styling: {
          fontFamily: 'Arial',
          fontSize: 12,
          fontColor: hexColor('#FFFFFF'),
          backgroundColor: JSON.stringify(hexColor(bg)),
          backgroundHoverColor: hexColor('#013B63'),
        },
      },
      __commands: commandsPanel,
    },
    multiActions,
    size: { width: 140, height: 40 },
    label: classic.text || 'Button',
    notes,
  };
}

function imageSource(ctx, source, notes) {
  if (source?.type === 'upload') {
    const url = source.value || source.uploadLastValue || '';
    const currentName = url.split('/').pop();
    return {
      type: 'file',
      fileFit: 'contain',
      file: { fileName: source.name || currentName, id: newId(), url, imageData: { image_url: url, current_name: currentName } },
    };
  }
  if (source?.type === 'manual' && /^(https?:|\{\{\{IQP_HOST\}\}\}|data:)/.test(String(source.value || ''))) {
    return { type: 'url', url: source.value, urlFit: 'contain' };
  }
  return { type: 'Data', inputValue: toPluginBinding(ctx, source, notes) };
}

export function convertImage(classic, ctx) {
  const notes = [];
  const { multiActions, commandsPanel } = buildClickCommand(classic.actions, ctx, notes);
  const backgroundImage = imageSource(ctx, classic.data?.source, notes);
  if (backgroundImage.type === 'file') {
    notes.push({ severity: SEVERITY.INFO, text: 'Uploaded image re-linked by URL; if it shows broken after import, re-select it from the image library.' });
  }
  return {
    typeName: 'image',
    data: {
      backgroundImage,
      advanced: {
        renderMethod: String(classic.style?.renderMethod || 'normal').toLowerCase(),
        horizontalAlignment: String(classic.style?.horizontalAlignment || 'center').toLowerCase(),
        verticalAlignment: 'middle',
        height: '250',
      },
      __commands: commandsPanel,
    },
    multiActions,
    size: { width: 260, height: 180 },
    label: describeSource(classic.data?.source),
    notes,
  };
}
