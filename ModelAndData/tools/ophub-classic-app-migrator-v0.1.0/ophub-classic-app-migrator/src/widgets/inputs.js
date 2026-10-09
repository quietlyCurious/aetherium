// Classic Dropdown and Input  ->  `GEDropdown` and `textbox` plugins.
// Where the classic widget was itself a global (globalData / component global), the new
// widget writes into the floating global that replaced it (same id).

import { globalBinding, queryBinding, toPluginBinding } from '../bindings.js';
import { newId } from '../util.js';
import { SEVERITY } from '../report.js';
import { describeSource } from './common.js';

const LABEL_STYLING = () => ({ fontSize: 12, fontFamily: 'Arial', fontColor: { hex: '#000000', rgb: { r: 0, g: 0, b: 0, a: 1 } } });
const INPUT_STYLING = () => ({ fontSize: 12, fontColor: { hex: '#000000', rgb: { r: 0, g: 0, b: 0, a: 1 } } });

/** Where the widget's value goes: its own global, or a query input. */
function valueTarget(classic, ctx, notes) {
  if (ctx.componentGlobalIds.has(classic.id)) {
    return globalBinding(classic.id, ctx.globals.name(classic.id, classic.displayId));
  }
  const t = classic.data?.target?.value;
  if (t && typeof t === 'object' && t.flowInstanceId != null) {
    const b = queryBinding(ctx, t.flowInstanceId, [], notes);
    const flow = ctx.flows.get(t.flowInstanceId);
    const input = (flow?.flow_metadata?.inputs || []).find((i) => i.fieldName === t.fieldName) || { fieldName: t.fieldName };
    b.query = { ...b.query, outputFields: [null], outputFieldsAliases: [null], input };
    return b;
  }
  if (t && typeof t === 'object' && (t.ioType === 'globals' || t.type === 'globals')) {
    return globalBinding(t.id, ctx.globals.name(t.id, t.fieldName));
  }
  notes.push({ severity: SEVERITY.WARN, text: 'No output target found; set where this input writes its value.' });
  return { type: 'global', global: {}, query: { input: {} }, id: newId() };
}

function dropdownValues(classic, ctx, notes) {
  const opts = classic.data?.options;
  if (opts?.type === 'dynamic' && opts.value?.fieldName?.flowInstanceId != null) {
    const v = opts.value.fieldName;
    const d = opts.value.fieldNameDisplay;
    const fields = [v.fieldName, d?.fieldName].filter((f, i, a) => f && a.indexOf(f) === i);
    if (d?.fieldName && d.fieldName !== v.fieldName) {
      notes.push({ severity: SEVERITY.INFO, text: `Options use "${v.fieldName}" as value and "${d.fieldName}" as display text; confirm the dropdown shows the right column.` });
    }
    return { values: queryBinding(ctx, v.flowInstanceId, fields, notes), manualInputs: [] };
  }
  const list = Array.isArray(opts?.value) ? opts.value : [];
  return {
    values: { type: 'query', global: {}, query: { outputFields: [null], outputFieldsAliases: [null] }, id: newId() },
    manualInputs: list.map((o) => ({ value: String(o.value ?? o), displayName: String(o.display ?? o.label ?? o.value ?? o) })),
  };
}

export function convertDropdown(classic, ctx) {
  const notes = [];
  const { values, manualInputs } = dropdownValues(classic, ctx, notes);
  return {
    typeName: 'GEDropdown',
    data: {
      label: classic.label || '',
      values,
      manualInputs,
      dependentField: { type: 'query', query: { outputFields: null, query_id: null, name: null, flowInstanceId: null }, global: { name: null, id: null } },
      dropTarget: valueTarget(classic, ctx, notes),
      format: 'Separated string',
      preselect: { mode: classic.firstOption?.value ? 'data' : 'first' },
      placeholder: 'Select',
      multipleSelect: false,
      maxSelections: 10,
      searchEnabled: true,
      outputSeparator: ',',
      height: 400,
      selectBoxWidth: 0,
      advanced: { labelStyling: LABEL_STYLING(), inputStyling: INPUT_STYLING() },
    },
    size: { width: 260, height: 70 },
    label: classic.label || classic.displayId || 'Dropdown',
    notes,
  };
}

const DISPLAY_MODE = { text: 'text', number: 'real', email: 'email', password: 'password', url: 'url', integer: 'integer' };

export function convertInput(classic, ctx) {
  const notes = [];
  const kind = classic.inputType || 'text';
  if (!DISPLAY_MODE[kind]) {
    notes.push({ severity: SEVERITY.WARN, text: `Classic "${kind}" input became a plain text box; consider a Date/Time Range Picker instead.` });
  }
  if (classic.disabled) notes.push({ severity: SEVERITY.INFO, text: 'Was read-only (disabled) in classic; the text box is editable.' });
  if (classic.placeholder) notes.push({ severity: SEVERITY.INFO, text: `Placeholder "${classic.placeholder}" moved to the tooltip.` });
  return {
    typeName: 'textbox',
    data: {
      label: classic.label || '',
      inputValue: toPluginBinding(ctx, classic.data?.source, notes),
      outputValue: valueTarget(classic, ctx, notes),
      displayMode: { type: DISPLAY_MODE[kind] || 'text' },
      numberFormat: { useRawFormat: true },
      tooltip: classic.placeholder || '',
      advanced: { clear: true, labelStyling: LABEL_STYLING(), inputStyling: INPUT_STYLING() },
    },
    size: { width: 260, height: 70 },
    label: classic.label || classic.displayId || describeSource(classic.data?.source) || 'Input',
    notes,
  };
}
