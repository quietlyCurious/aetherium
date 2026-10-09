// Classic HTML (custom code) widget  ->  `GEHtmlEditor` plugin.
// The HTML/CSS/JS moves across. The two JavaScript APIs differ (classic EMBED.getData /
// onChangeData vs. the new EMBED.subscribe… methods), so real script is flagged for review.

import { queryBinding } from '../bindings.js';
import { SEVERITY } from '../report.js';

/** Strip comments and whitespace to see whether any real code is left. */
function hasRealCode(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim().length > 0;
}

export function isClassicCustomHtml(component) {
  return component?.type === 'embedded_html' && component.typeName === 'HTML' && !component.schema && !!component.data?.code;
}

export function convertCustomHtml(classic, ctx) {
  const notes = [];
  const code = classic.data.code;
  const flowId = code.flow?.flowInstanceId;
  const kinds = ['html', 'css', 'js'].filter((k) => hasRealCode(code[k]));

  if (hasRealCode(code.js)) {
    notes.push({ severity: SEVERITY.WARN, text: 'Custom JavaScript moved as-is; the new Html Editor\'s EMBED API differs (e.g. getData/onChangeData → subscribeFieldToQueryChange), so update the script.' });
  }
  if (hasRealCode(code.css) && /\.component-[a-z_-]+/.test(code.css)) {
    notes.push({ severity: SEVERITY.WARN, text: 'CSS targets classic widget classes (.component-…), which don\'t exist in the new designer; it will have no effect until retargeted.' });
  }
  if (!kinds.length) notes.push({ severity: SEVERITY.INFO, text: 'The custom code widget was empty.' });

  return {
    typeName: 'GEHtmlEditor',
    data: {
      codeEditor: JSON.stringify({ html: code.html || '', css: code.css || '', js: code.js || '' }),
      value: flowId != null
        ? queryBinding(ctx, flowId, (code.fields || []).map((f) => f.fieldName || f).filter((f) => typeof f === 'string'), notes)
        : { global: {}, query: { outputFields: [null], outputFieldsAliases: [null] } },
      targets: null,
    },
    size: { width: 400, height: 300 },
    label: kinds.length ? `Custom ${kinds.join(' + ').toUpperCase()}` : 'Empty custom code',
    notes,
  };
}
