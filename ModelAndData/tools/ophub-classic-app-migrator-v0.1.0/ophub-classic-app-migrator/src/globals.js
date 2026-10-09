// App globals.
// Floating globals carry over unchanged. Classic also has two kinds the new designer doesn't use:
//   component  - an Input/Dropdown widget that *is* a global (its widget id is the global id)
//   flow       - a global fed directly by a query output
// Both become floating globals with the same id, so every setGlobal action, binding and
// visibility condition that references them keeps working.

import { deepClone } from './util.js';
import { SEVERITY } from './report.js';

function normalizeDataType(t) {
  const v = String(t || '').toLowerCase();
  return v === 'number' ? 'number' : 'string';
}

/**
 * @returns {{ globals: object[], componentGlobalIds: Set<string> }}
 */
export function convertGlobals(classicGlobals, report) {
  const componentGlobalIds = new Set();
  const out = (classicGlobals || []).map((g) => {
    const n = deepClone(g);
    if (n.type === 'component') {
      componentGlobalIds.add(n.id);
      delete n.component;
      delete n.flowName;
      n.type = 'floating';
      n.editable = true;
    } else if (n.type === 'flow') {
      report.note(
        `Global "${n.name}" was fed directly by query output ${n.flowName || ''} › ${n.fieldName || ''}. ` +
        'It is now a regular (floating) global; add a setGlobal action or rebind if it must stay in sync.',
        SEVERITY.WARN,
      );
      for (const k of ['flowInstanceId', 'flowName', 'fieldName', 'ioType']) delete n[k];
      n.type = 'floating';
      n.editable = true;
    }
    if (n.type === 'floating') n.dataType = normalizeDataType(n.dataType);
    n.isOpen = false;
    return n;
  });
  if (componentGlobalIds.size) {
    report.note(`${componentGlobalIds.size} input/dropdown widget(s) also acted as globals; they now write into floating globals with the same ids.`);
  }
  report.globalCount = out.length;
  return { globals: out, componentGlobalIds };
}
