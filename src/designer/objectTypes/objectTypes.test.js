// Run: npx react-scripts test --watchAll=false src/designer/objectTypes
import { suggestReferences, referenceKey, dropTargetOf, bindingFor, defaultOutputField, returnsRows, makeObjectType, rankDropOptions, leadingVerb } from './objectTypes';

const conn = { id: 'c1', kind: 'ophub' };
const item = (sourceKey, definition) => ({ sourceKey, group: 'g', definition });
const catalog = [{
  connection: conn,
  groups: [{ key: 'g', items: [
    item('ophub:all', { name: 'GetAllEquipment', inputs: [], outputs: [{ name: 'equipmentID' }, { name: 'equipmentName' }] }),
    item('ophub:down', { name: 'GetDowntime', inputs: [{ name: 'equipmentID' }], outputs: [{ name: 'minutes' }] }),
    item('ophub:wo', { name: 'GetWorkOrders', inputs: [{ name: 'eqId' }], outputs: [{ name: 'status' }],
      config: { conditions: [{ fieldName: 'EquipmentID', paramName: 'eqId' }] } }),
    item('ophub:worst', { name: 'GetNWorst', inputs: [{ name: 'count' }], outputs: [{ name: 'EQUIPMENTID' }] }),
  ] }],
}];
const type = makeObjectType({ listedBy: { connectionId: 'c1', source: 'query', sourceKey: 'ophub:all', keyField: 'equipmentID' } });

describe('suggestReferences', () => {
  test('finds same-name inputs/outputs and entity filters, never the list query itself', () => {
    const found = suggestReferences(type, catalog).map(s => `${s.sourceKey}:${s.side}:${s.field}`);
    expect(found).toEqual(expect.arrayContaining(['ophub:down:input:equipmentID', 'ophub:wo:input:eqId', 'ophub:worst:output:EQUIPMENTID']));
    expect(found.some(f => f.startsWith('ophub:all'))).toBe(false);
  });

  test('leaves out existing and dismissed references', () => {
    const existing = { connectionId: 'c1', side: 'input', sourceKey: 'ophub:down', field: 'equipmentID' };
    const dismissed = referenceKey({ connectionId: 'c1', side: 'input', sourceKey: 'ophub:wo', field: 'eqId' });
    const found = suggestReferences({ ...type, references: [existing], dismissed: [dismissed] }, catalog).map(s => s.sourceKey);
    expect(found).toEqual(['ophub:worst']);
  });

  test('suggests nothing until a key field is chosen', () => {
    expect(suggestReferences(makeObjectType(), catalog)).toEqual([]);
  });
});

describe('dropTargetOf', () => {
  test('a grid takes rows in its data property', () => {
    expect(dropTargetOf('DataGrid')).toMatchObject({ propName: 'dataSource', wantsRows: true });
  });
  test('Text takes one value in text', () => {
    expect(dropTargetOf('Text')).toMatchObject({ propName: 'text', wantsRows: false });
  });
});

describe('bindingFor', () => {
  const rowsQuery = { type: 'sql_sproc', direction: 'read', outputs: [{ name: 'reason' }, { name: 'minutes', type: 'Number' }] };
  const valueQuery = { type: 'twx_service', direction: 'read', config: { resultBaseType: 'INTEGER' }, outputs: [{ name: 'result' }] };

  test('rows into a rows widget: every column', () => {
    expect(bindingFor({ query: rowsQuery, queryId: 'q', queryInstanceId: 3, wantsRows: true }))
      .toEqual({ type: 'query', queryInstanceId: 3, queryId: 'q', outputFields: [], transform: [] });
  });

  test('rows into a one-value widget: one column of the last row', () => {
    expect(returnsRows(rowsQuery)).toBe(true);
    expect(bindingFor({ query: rowsQuery, queryId: 'q', queryInstanceId: 3, wantsRows: false }))
      .toEqual({ type: 'query', queryInstanceId: 3, queryId: 'q', outputField: 'minutes', transform: [{ type: 'pickRow', mode: 'last' }] });
  });

  test('a single value: its result, no row picking', () => {
    expect(defaultOutputField(valueQuery)).toBe('result');
    expect(bindingFor({ query: valueQuery, queryId: 'q', queryInstanceId: 1, wantsRows: false }).transform).toEqual([]);
  });
});

describe('rankDropOptions', () => {
  const svc = (name, extra = {}) => ({
    id: name, kind: 'thing', connectionId: 'c1', item: { sourceKey: `twx:T/${name}` },
    query: { name, type: 'twx_service', direction: 'read', config: { resultBaseType: 'NUMBER' }, inputs: [], outputs: [{ name: 'result' }], ...extra },
  });
  const options = [
    svc('SetSpeed', { inputs: [{ name: 'value', optional: false }] }),
    svc('GetSpeed'),
    svc('GetDowntimeTable', { config: { resultBaseType: 'INFOTABLE' } }),
    svc('GetAlarmCount', { inputs: [{ name: 'since', optional: false }] }),
    svc('RestartAgent', { config: { resultBaseType: 'NOTHING' } }),
    svc('Speedometer'),
  ];

  test('reads that fit come first; actions are kept apart', () => {
    const { main, actions } = rankDropOptions(options, { wantsRows: false, queries: [] });
    expect(main.map(r => r.option.query.name)).toEqual(['GetSpeed', 'GetAlarmCount', 'Speedometer', 'GetDowntimeTable']);
    expect(actions.map(r => r.option.query.name).sort()).toEqual(['RestartAgent', 'SetSpeed']);
  });

  test('a rows widget flips which reads fit', () => {
    const { main } = rankDropOptions(options, { wantsRows: true, queries: [] });
    expect(main[0].option.query.name).toBe('GetDowntimeTable');
  });

  test('flags unfilled required inputs and prior use', () => {
    const { main } = rankDropOptions(options, { wantsRows: false, queries: [{ connectionId: 'c1', sourceKey: 'twx:T/Speedometer' }] });
    const byName = Object.fromEntries(main.map(r => [r.option.query.name, r]));
    expect(byName.GetAlarmCount.needs.map(i => i.name)).toEqual(['since']);
    expect(byName.Speedometer.usedBefore).toBe(true);
  });

  test('leadingVerb reads through namespaces and snake case', () => {
    expect(leadingVerb('PTC.FSU.CORE.GetEquipmentsBySelectedTypeJSON_AFT')).toBe('get');
    expect(leadingVerb('add_alert')).toBe('add');
    expect(leadingVerb('QueryPropertyHistory')).toBe('query');
  });
});
