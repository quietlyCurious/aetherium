// designer/widgets/widgetPropertyEdits.js
// The edits the Widgets area makes to one widget's property list, as plain
// functions on the list — the same split the Screens editor has between
// screenEdits.js and the components that call it.
//
// Order: a newly exposed property goes on the end, and nothing else moves.
// The list's order is what the details panel shows, so the committed
// widgetProperties.js is where a different order comes from.

export function exposeOption(defs, def) {
  return defs.some(d => d.name === def.name) ? defs : [...defs, def];
}

export function hideOption(defs, name) {
  return defs.filter(d => d.name !== name);
}

export function updateDef(defs, name, fn) {
  return defs.map(d => (d.name === name ? fn(d) : d));
}

// Sets one field, or removes it when the value is empty — an absent
// `group`/`bindable` is what "no group" / "bindable" mean in a definition,
// so they shouldn't be written as empty strings.
export function setDefField(def, key, value) {
  const next = { ...def };
  if (value === undefined || value === '') delete next[key]; else next[key] = value;
  return next;
}

// A default that still makes sense after the type changes.
export function coerceDefault(value, type, options) {
  switch (type) {
    case 'bool': return value === true || value === 'true';
    case 'number': { const n = typeof value === 'number' ? value : parseFloat(value); return Number.isFinite(n) ? n : 0; }
    case 'string':
    case 'color': return value == null || typeof value === 'object' ? '' : String(value);
    case 'enum': return options?.includes(value) ? value : options?.[0];
    case 'data': return Array.isArray(value) ? value : [];
    case 'json': return value === null || value === undefined || typeof value === 'object' ? value : undefined;
    default: return value;
  }
}

export function changeDefType(def, type) {
  const next = { ...def, type };
  if (type === 'enum') {
    next.options = def.options?.length ? def.options : (typeof def.default === 'string' && def.default ? [def.default] : []);
  } else {
    delete next.options;
  }
  const value = coerceDefault(def.default, type, next.options);
  if (value === undefined) delete next.default; else next.default = value;
  return next;
}

export function setDefChoices(def, options) {
  return { ...def, options, default: coerceDefault(def.default, 'enum', options) };
}

export function parseChoices(text) {
  return text.split(',').map(s => s.trim()).filter(Boolean);
}
