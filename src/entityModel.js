// entityModel.js
// Data model helpers for the Entities workspace — internal, OpHub-style tables
// with a user-defined column schema (Field + Type) and rows of actual data.

export const ENTITY_TYPE_OPTIONS = [
  { value: 'boolean',  label: 'Boolean'  },
  { value: 'number',   label: 'Number'   },
  { value: 'real',     label: 'Real'     },
  { value: 'string',   label: 'String'   },
  { value: 'date',     label: 'Date'     },
  { value: 'time',     label: 'Time'     },
  { value: 'datetime', label: 'DateTime' },
];

export function makeBlankColumn(generateId) {
  return { id: generateId(), field: '', type: 'string' };
}

export function defaultValueForType(type) {
  switch (type) {
    case 'boolean': return false;
    case 'number':
    case 'real':     return 0;
    case 'date':
    case 'time':
    case 'datetime': return null;
    default:         return '';
  }
}

export function makeNewEntity(name, generateId) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: name || 'Untitled Entity',
    columns: [],   // [{ id, field, type }] — empty means "still in initial schema setup"
    rows: [],      // [{ __rowId, ...fieldsByColumnField }]
    createdAt: now,
    updatedAt: now,
  };
}

// Given the OLD committed columns and a NEW draft column set (both keyed by the
// stable column `id`, so a rename is distinguishable from a delete+add), produce
// the new rows array: renamed fields carry their value over under the new name,
// removed columns drop their field, newly added columns get a type-appropriate
// default value on every existing row.
export function reconcileRowsForColumns(rows, oldColumns, newColumns) {
  const oldById = new Map(oldColumns.map(c => [c.id, c]));
  return rows.map(row => {
    const newRow = { __rowId: row.__rowId };
    newColumns.forEach(col => {
      const oldCol = oldById.get(col.id);
      if (oldCol && Object.prototype.hasOwnProperty.call(row, oldCol.field)) {
        newRow[col.field] = row[oldCol.field];
      } else {
        newRow[col.field] = defaultValueForType(col.type);
      }
    });
    return newRow;
  });
}

export function makeBlankRow(columns, generateId) {
  const row = { __rowId: generateId() };
  columns.forEach(col => { row[col.field] = defaultValueForType(col.type); });
  return row;
}

// Maps our entity column type to a DevExtreme dx-data-grid column dataType, so
// the grid renders/edits each column with an appropriate control.
export function toDxDataType(type) {
  switch (type) {
    case 'boolean':  return 'boolean';
    case 'number':
    case 'real':     return 'number';
    case 'date':     return 'date';
    case 'datetime': return 'datetime';
    case 'time':     return 'string'; // DevExtreme has no dedicated time-only dataType
    default:         return 'string';
  }
}
