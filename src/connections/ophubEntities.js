// connections/ophubEntities.js
// OpHub's entities, worked out from its queries: every entity query names
// the entity it reads or writes (query_contents.source.source_id) and the
// columns it uses, so grouping the flow list by entity gives each entity,
// the columns those queries touch, and which queries read it.
//
// Derived this way, an entity only appears once some query uses it, and
// only with the columns its queries use. OpHub's own entity list (from the
// designer's Entities page) would give every entity and column; until that
// endpoint is known, this needs nothing beyond the flow list we already
// fetch.

// → [{ id, name, columns: [name], reads: [item], writes: [item] }], by name
export function entitiesFromCatalog(entry) {
  const byId = new Map();
  (entry?.groups || []).forEach(group => (group.items || []).forEach(item => {
    const entity = item.definition.config?.entity;
    if (!entity?.id) return;
    const unnamed = `(unnamed entity ${String(entity.id).slice(0, 8)})`;
    if (!byId.has(entity.id)) byId.set(entity.id, { id: entity.id, name: entity.name || unnamed, columns: new Set(), reads: [], writes: [] });
    const e = byId.get(entity.id);
    if (e.name === unnamed && entity.name) e.name = entity.name;
    (entity.columns || []).forEach(c => e.columns.add(c));
    (item.definition.direction === 'write' ? e.writes : e.reads).push(item);
  }));
  return [...byId.values()]
    .map(e => ({ ...e, columns: [...e.columns].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The output of a query that carries an entity column. OpHub names entity
// query outputs "<Entity>.<Column>" (e.g. Amy_Machines.MachineID).
export function outputForColumn(query, column) {
  if (!column) return '';
  const outputs = query?.outputs || [];
  return (outputs.find(o => o.name === column) || outputs.find(o => o.name.endsWith(`.${column}`)))?.name || '';
}

// Required inputs a query leaves without a default.
const requiredInputs = (query) => (query.inputs || []).filter(i => !i.optional && (i.defaultValue === null || i.defaultValue === undefined || i.defaultValue === ''));

// An entity's read queries, best list query first: returns both chosen
// columns, then fewest required inputs, then name.
// → [{ item, returnsKey, returnsDisplay, required: [input] }]
export function rankListQueries(entity, keyColumn, displayColumn) {
  return (entity?.reads || [])
    .map(item => ({
      item,
      returnsKey: !keyColumn || !!outputForColumn(item.definition, keyColumn),
      returnsDisplay: !displayColumn || !!outputForColumn(item.definition, displayColumn),
      required: requiredInputs(item.definition),
    }))
    .sort((a, b) =>
      (Number(b.returnsKey && b.returnsDisplay) - Number(a.returnsKey && a.returnsDisplay))
      || (a.required.length - b.required.length)
      || a.item.definition.name.localeCompare(b.item.definition.name));
}

// How each of an entity's queries relates to its ID column — for explaining
// which can take an object of the type (they filter by that column) and why
// the others can't. The list query itself is left out.
// → [{ item, changes, takesKeyAs: param | null, filtersBy: [column] }]
export function describeEntityQueries(entity, keyColumn, listSourceKey) {
  const bare = (name) => String(name || '').split('.').pop().toLowerCase();
  const key = bare(keyColumn);
  return [...(entity?.reads || []), ...(entity?.writes || [])]
    .filter(item => item.sourceKey !== listSourceKey)
    .map(item => {
      const conditions = item.definition.config?.conditions || [];
      const keyCondition = conditions.find(c => key && bare(c.fieldName) === key);
      return {
        item,
        changes: item.definition.direction === 'write',
        takesKeyAs: keyCondition ? keyCondition.paramName : null,
        filtersBy: [...new Set(conditions.filter(c => c !== keyCondition).map(c => c.fieldName))],
      };
    })
    .sort((a, b) => Number(!!b.takesKeyAs) - Number(!!a.takesKeyAs) || a.item.definition.name.localeCompare(b.item.definition.name));
}
