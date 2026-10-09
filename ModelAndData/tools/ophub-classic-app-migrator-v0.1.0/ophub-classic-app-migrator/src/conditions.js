// Conditional visibility: classic {showOnlyOnCondition, conditionsList}
//                      -> new    {showOnlyOnConditions, conditionsList}
// The per-condition shape is nearly identical; the new designer adds dataFieldName and
// title-cases the value type.

import { deepClone } from './util.js';
import { SEVERITY } from './report.js';

function fieldDisplayName(value) {
  if (!value) return '';
  if (value.ioType === 'globals' || value.type === 'globals') return `Globals.${value.fieldName}`;
  return `${value.flowAlias || value.flowName || 'Query'}.${value.fieldName}`;
}

function convertOne(c, index) {
  const out = deepClone(c);
  const v = out.data?.value;
  if (v && typeof v === 'object') {
    if (v.ioType === 'globals' || v.type === 'globals') {
      Object.assign(v, { category: 'Globals', flowAlias: 'Globals', flowName: 'Globals', display: v.fieldName });
    }
    v.fieldDisplayName = fieldDisplayName(v);
  }
  out.dataFieldName = fieldDisplayName(v);
  out.valueType = String(out.valueType || 'manual').replace(/^./, (ch) => ch.toUpperCase());
  out.valueFieldName = out.valueFieldName ?? '';
  out.andOr = index === 0 ? 'AND' : (out.andOr || 'AND');
  return out;
}

/** List of classic conditions (possibly empty) for a classic component. */
export function classicConditionList(component) {
  return component?.conditions?.conditionsList || [];
}

/**
 * Build the new-designer conditions object for a widget/card from its own classic
 * conditions plus any inherited from containers that were flattened away.
 */
export function buildConditions(ownList, inheritedList, notes) {
  const own = ownList || [];
  const inherited = inheritedList || [];
  if (!own.length && !inherited.length) return { conditionsList: [], showOnlyOnConditions: true };

  if (own.length && inherited.length) {
    const hasOr = [...own, ...inherited].some((c) => String(c.andOr || '').toUpperCase() === 'OR');
    notes?.push({
      severity: hasOr ? SEVERITY.WARN : SEVERITY.INFO,
      text: hasOr
        ? 'Combined its own visibility conditions with an enclosing container\'s; the mix includes OR, so check the result.'
        : 'Inherited visibility conditions from an enclosing container (ANDed with its own).',
    });
  } else if (inherited.length) {
    notes?.push({ severity: SEVERITY.INFO, text: 'Inherited visibility conditions from an enclosing container.' });
  }

  const merged = [...inherited, ...own].map((c, i) => {
    const out = convertOne(c, i);
    if (i === inherited.length && i > 0) out.andOr = 'AND'; // join point between container and widget conditions
    return out;
  });
  return { conditionsList: merged, showOnlyOnConditions: true };
}
