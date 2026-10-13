// Run: npx react-scripts test --watchAll=false src/connections/ophubEntities
import { flowToDefinition } from './ophubConnector';
import { entitiesFromCatalog, outputForColumn, rankListQueries, describeEntityQueries } from './ophubEntities';

// Shapes as in a real OpHub export (AmyDefinitionApp): query_contents is the
// flow's query_detail; entity outputs are "<Entity>.<Column>".
const MACHINES = '9ad66c84-dff6-4791-b8aa-9ecd62ebd9cf';
const field = (table, col) => ({ table_id: table === 'Amy_Machines' ? MACHINES : 'dt-1', column_name: col, table_name: table });
const flow = (name, { table = 'Amy_Machines', cols, conditions = [], set = [], queryType = 'get', inputs = [] }) => ({
  query_id: `uuid-${name}`, name, type: 'Entities',
  query_contents: {
    query_type: queryType,
    source: { source_id: table === 'Amy_Machines' ? MACHINES : 'dt-1', source_type: 'table' },
    fields: cols.map(c => field(table, c)),
    conditions: conditions.map(([col, param]) => ({ field: field(table, col), comparer: { type: 'param', value: param, optional: true }, operator: '=' })),
    set: set.map(c => ({ ...field(table, c), value: 'v' })),
  },
  io: { inputs, outputs: cols.map(c => ({ name: `${table}.${c}`, type: 'String' })) },
});
const flows = [
  flow('GetAllMachines', { cols: ['PlantName', 'MachineName', 'MachineID', 'MachineType'] }),
  flow('GetMachinesByPlant', { cols: ['MachineName', 'MachineID'], conditions: [['PlantName', 'plant']], inputs: [{ name: 'plant', isOptional: 'false' }] }),
  flow('GetMachineIDs', { cols: ['MachineID'] }),
  flow('SetMachineType', { cols: [], set: ['MachineType'], conditions: [['MachineID', 'id']], queryType: 'update' }),
  flow('GetDowntime', { table: 'Amy_Downtime', cols: ['MachineID', 'Minutes'], conditions: [['MachineID', 'machineId']] }),
];
const items = flows.map(f => ({ sourceKey: `ophub:${f.query_id}`, group: 'Entity', definition: flowToDefinition(f) }));
const entry = { groups: [{ key: 'Entity', label: 'Entity', items }] };

test('entity queries carry their entity; update queries are writes', () => {
  const all = items.find(i => i.definition.name === 'GetAllMachines').definition;
  expect(all.type).toBe('entity_read');
  expect(all.config.entity).toMatchObject({ id: MACHINES, name: 'Amy_Machines' });
  const set = items.find(i => i.definition.name === 'SetMachineType').definition;
  expect(set.type).toBe('entity_write');
  expect(set.direction).toBe('write');
});

test('entities are grouped from their queries, with every column those queries use', () => {
  const entities = entitiesFromCatalog(entry);
  expect(entities.map(e => e.name)).toEqual(['Amy_Downtime', 'Amy_Machines']);
  const machines = entities.find(e => e.name === 'Amy_Machines');
  expect(machines.columns).toEqual(['MachineID', 'MachineName', 'MachineType', 'PlantName']);
  expect(machines.reads.map(i => i.definition.name).sort()).toEqual(['GetAllMachines', 'GetMachineIDs', 'GetMachinesByPlant']);
  expect(machines.writes.map(i => i.definition.name)).toEqual(['SetMachineType']);
});

test('the best list query returns both columns and needs no inputs', () => {
  const machines = entitiesFromCatalog(entry).find(e => e.name === 'Amy_Machines');
  const ranked = rankListQueries(machines, 'MachineID', 'MachineName');
  expect(ranked.map(r => r.item.definition.name)).toEqual(['GetAllMachines', 'GetMachinesByPlant', 'GetMachineIDs']);
  expect(ranked[1].required.map(i => i.name)).toEqual(['plant']);
  expect(ranked[2].returnsDisplay).toBe(false);
});

test('outputForColumn finds the prefixed output', () => {
  const all = items.find(i => i.definition.name === 'GetAllMachines').definition;
  expect(outputForColumn(all, 'MachineID')).toBe('Amy_Machines.MachineID');
  expect(outputForColumn(all, 'Nope')).toBe('');
});

test('describeEntityQueries says which queries take the ID and why the others don\'t', () => {
  const machines = entitiesFromCatalog(entry).find(e => e.name === 'Amy_Machines');
  const d = describeEntityQueries(machines, 'MachineID', 'ophub:uuid-GetAllMachines');
  expect(d.map(x => [x.item.definition.name, x.takesKeyAs, x.filtersBy, x.changes])).toEqual([
    ['SetMachineType', 'id', [], true],
    ['GetMachineIDs', null, [], false],
    ['GetMachinesByPlant', null, ['PlantName'], false],
  ]);
});
