// QueriesWorkspace.jsx
// Left-panel grid list of query definitions + right-panel detail editor.
// Covers general fields, primary/secondary data source linkage, dynamic input &
// output parameter lists (via the shared ParamListEditor), and type-specific
// configuration for REST, SQL, OPC UA, and Entity queries.

import React, { useState } from 'react';
import { Splitter, Item as SplitterItem } from 'devextreme-react/splitter';
import { SelectBox } from 'devextreme-react/select-box';
import { Switch } from 'devextreme-react/switch';
import { Field, TxtInput, InfoNote, SectionTitle } from './FormFields';
import DataListGrid from './DataListGrid';
import ParamListEditor from './ParamListEditor';
import {
  QUERY_TYPE_LABELS, QUERY_TYPES,
  FIELD_TYPE_OPTIONS, UI_HINT_OPTIONS, PARAM_TYPE_OPTIONS, ENTITY_OPERATOR_OPTIONS,
  OPCUA_SAMPLING_MODE_OPTIONS, OPCUA_QUALITY_THRESHOLD_OPTIONS,
  makeBlankInput, makeBlankOutput, inferResultCardinality, generateDataId,
  OPCUA_CURRENT_VALUE_INPUT_TEMPLATE, OPCUA_HISTORICAL_INPUT_TEMPLATE,
  OPCUA_WRITE_INPUT_TEMPLATE, OPCUA_READ_OUTPUT_TEMPLATE,
} from './dataModel';
import { executeRestQuery, BODY_ENCODING } from './restResolver';
import { fetchOphubFlows, mapOphubFlowToQuery } from './ophubFlowDiscovery';
import notify from 'devextreme/ui/notify';

// Script is its own definition workspace (Phase 3) — never a Query type choice.
const QUERY_TYPE_OPTIONS = Object.entries(QUERY_TYPE_LABELS)
  .filter(([value]) => value !== QUERY_TYPES.SCRIPT)
  .map(([value, label]) => ({ value, label }));

const CARDINALITY_LABELS = {
  scalar:    'Scalar (single value)',
  series:    'Series (time-series array)',
  resultset: 'Resultset (rows × columns)',
  none:      'None (write-only)',
};

const SQL_OUTPUT_TYPE_OPTIONS = [
  { value: 'scalar',          label: 'Scalar'        },
  { value: 'Resultset',       label: 'Resultset'     },
  { value: 'OutputParameter', label: 'Output Param'  },
];

// ─────────────────────────────────────────────────────────────────────────────
// List grid column definitions
// ─────────────────────────────────────────────────────────────────────────────

function makeColumns(dataSourceById) {
  const nameCellRender = (cellInfo) => {
    const q = cellInfo.data;
    return <span style={{ color: q.name ? '#222' : '#aaa' }}>{q.name || '(unnamed)'}</span>;
  };

  const dataSourceCellRender = (cellInfo) => {
    const ds = dataSourceById[cellInfo.data.dataSourceId];
    return <span style={{ color: ds ? '#444' : '#bbb' }}>{ds?.name || '—'}</span>;
  };

  return [
    { dataField: 'name',         caption: 'Name',        cellRender: nameCellRender, minWidth: 120 },
    { dataField: 'type',         caption: 'Type',         width: 130, calculateCellValue: (q) => QUERY_TYPE_LABELS[q.type] || q.type },
    { dataField: 'dataSourceId', caption: 'Data Source',  width: 130, cellRender: dataSourceCellRender },
    { dataField: 'description',  caption: 'Description',  minWidth: 100 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Input / output column field-sets — vary by query type
// ─────────────────────────────────────────────────────────────────────────────

function getInputFields(queryType, entityColumnOptions) {
  const base = [
    { key: 'name',         label: 'Name',    type: 'text',     width: 2,   placeholder: 'paramName' },
    { key: 'type',         label: 'Type',    type: 'select',   width: 1.3, options: FIELD_TYPE_OPTIONS },
    { key: 'optional',     label: 'Opt.',    type: 'checkbox', width: 0.5 },
    { key: 'defaultValue', label: 'Default', type: 'text',     width: 1.3 },
    { key: 'uiHint',       label: 'UI Hint', type: 'select',   width: 1.3, options: UI_HINT_OPTIONS },
  ];

  if (queryType === QUERY_TYPES.SQL_SPROC) {
    return [...base, { key: 'paramType', label: 'Param Type', type: 'select', width: 1.6, options: PARAM_TYPE_OPTIONS }];
  }
  if (queryType === QUERY_TYPES.ENTITY_READ || queryType === QUERY_TYPES.ENTITY_WRITE) {
    return [
      ...base,
      { key: 'entityField', label: 'Entity Field', type: 'select', width: 1.3, options: entityColumnOptions, placeholder: 'column' },
      { key: 'operator',    label: 'Operator',     type: 'select', width: 1,   options: ENTITY_OPERATOR_OPTIONS },
    ];
  }
  return base;
}

function getOutputFields(queryType) {
  const base = [
    { key: 'name', label: 'Name', type: 'text',   width: 2.5, placeholder: 'fieldName or Data.Path' },
    { key: 'type', label: 'Type', type: 'select', width: 1.3, options: FIELD_TYPE_OPTIONS },
  ];
  if (queryType === QUERY_TYPES.SQL_SPROC) {
    return [
      ...base,
      { key: 'outputGroup', label: 'Output Group', type: 'text',   width: 1.3, placeholder: 'Resultset1' },
      { key: 'outputType',  label: 'Output Type',  type: 'select', width: 1.3, options: SQL_OUTPUT_TYPE_OPTIONS },
    ];
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-specific configuration panels
// ─────────────────────────────────────────────────────────────────────────────

function RestConfig({ query, setConfig }) {
  return (<>
    <Field label="Path">
      <TxtInput
        value={query.config?.path}
        placeholder="/api/v1/resource"
        onChange={v => setConfig({ path: v })}
        mono
      />
    </Field>
    <Field label="Query ID (OpHub Flow UUID)">
      <TxtInput
        value={query.config?.ophubFlowUuid ?? ''}
        placeholder="e.g. 6ad09ae8-cae4-11ea-87d0-0242ac130003"
        onChange={v => setConfig({ ophubFlowUuid: v })}
        mono
      />
    </Field>
    <Field label="Account ID">
      <TxtInput
        value={query.config?.accountId ?? ''}
        placeholder="e.g. 2"
        onChange={v => setConfig({ accountId: v })}
      />
    </Field>
    <Field label="Test Flow Instance ID">
      <TxtInput
        value={query.config?.testFlowInstanceId ?? ''}
        placeholder="e.g. 3 — used only by the Test button below, real pages use their own instance ID"
        onChange={v => setConfig({ testFlowInstanceId: v })}
      />
    </Field>
    <InfoNote>
      Without a real Query ID, this was silently falling back to Aetherium's own
      internal ID for the query — which OpHub doesn't recognize as any real flow.
      That's the most likely cause of the last error (a message-less code 302).
    </InfoNote>
  </>);
}

function SqlConfig({ query, setConfig }) {
  return (<>
    <Field label="Schema Name">
      <TxtInput value={query.config?.schemaName} placeholder="dbo" onChange={v => setConfig({ schemaName: v })} />
    </Field>
    <Field label="Procedure Name">
      <TxtInput value={query.config?.procName} placeholder="spGetSomething" onChange={v => setConfig({ procName: v })} mono />
    </Field>
    <Field label="Convert Datetime to Local">
      <Switch
        value={!!query.config?.convertDatetimeToLocal}
        onValueChanged={e => setConfig({ convertDatetimeToLocal: e.value })}
      />
    </Field>
  </>);
}

function OpcUaConfig({ query, setConfig, onInsertInputs, onInsertOutputs }) {
  const isWrite = query.type === QUERY_TYPES.OPCUA_WRITE;
  const isCurrentValue = (query.config?.samplingMode || 'currentvalue') === 'currentvalue';

  return (<>
    {!isWrite && (<>
      <Field label="Sampling Mode">
        <SelectBox
          dataSource={OPCUA_SAMPLING_MODE_OPTIONS}
          valueExpr="value"
          displayExpr="label"
          value={query.config?.samplingMode || 'currentvalue'}
          onValueChanged={e => setConfig({ samplingMode: e.value })}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>
      <Field label="Quality Threshold">
        <SelectBox
          dataSource={OPCUA_QUALITY_THRESHOLD_OPTIONS}
          value={query.config?.qualityThreshold || 'Uncertain'}
          onValueChanged={e => setConfig({ qualityThreshold: e.value })}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>
    </>)}

    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, paddingTop: 4, flexWrap: 'wrap' }}>
      {isWrite ? (
        <button className="focus-mode-btn" style={{ fontSize: 11 }} onClick={onInsertInputs}>
          + Insert Write Inputs (tag, value)
        </button>
      ) : isCurrentValue ? (
        <button className="focus-mode-btn" style={{ fontSize: 11 }} onClick={onInsertInputs}>
          + Insert Current Value Inputs
        </button>
      ) : (
        <button className="focus-mode-btn" style={{ fontSize: 11 }} onClick={onInsertInputs}>
          + Insert Historical Inputs
        </button>
      )}
      {!isWrite && (
        <button className="focus-mode-btn" style={{ fontSize: 11 }} onClick={onInsertOutputs}>
          + Insert Standard Outputs
        </button>
      )}
    </div>
    <InfoNote>
      Quick-insert appends the standard field shape Aetherium's OPC UA resolver expects —
      you can still edit or remove individual rows afterward.
    </InfoNote>
  </>);
}

function EntityConfig() {
  return (
    <InfoNote>
      Entity Field and Operator columns appear on each input below — they map that input's
      runtime value to a filter condition on the selected entity's column.
    </InfoNote>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test panel — runs the query for real against its configured data source
// (e.g. the local OpHub proxy) so you can see live data without leaving
// Aetherium, and without needing a page/canvas binding wired up yet.
// ─────────────────────────────────────────────────────────────────────────────

function TestQueryPanel({ query, dataSource }) {
  const [bodyEncoding, setBodyEncoding] = useState(BODY_ENCODING.DATA_FIELD);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleRun = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      // Uses each input's Default Value straight from the Inputs section above —
      // no separate copy to keep in sync. To test with a different value, edit
      // the Default Value there and it's reflected here too.
      const inputValues = Object.fromEntries((query.inputs || []).map(i => [i.name, i.defaultValue ?? '']));
      const json = await executeRestQuery({ dataSource, query, instance: null, inputValues, bodyEncoding });
      setResult(json);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="details-section">
      <div className="details-grid">
        <SectionTitle>Test</SectionTitle>

        <Field label="Body Encoding">
          <SelectBox
            dataSource={[
              { value: BODY_ENCODING.DATA_FIELD, label: 'Single "data" field (confirmed correct)' },
              { value: BODY_ENCODING.JSON, label: 'JSON (fallback)' },
            ]}
            valueExpr="value"
            displayExpr="label"
            value={bodyEncoding}
            onValueChanged={e => setBodyEncoding(e.value)}
            stylingMode="outlined"
            width="100%"
            height={24}
          />
        </Field>

        <InfoNote>
          Runs using each input's Default Value from the Inputs section above.
          Confirmed via a real "Copy as fetch" export: OpHub expects the whole
          payload wrapped as a single form field named "data" — not spread
          across separate top-level fields. That's now the default.
        </InfoNote>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4 }}>
          <button
            className="focus-mode-btn focus-mode-btn--active"
            onClick={handleRun}
            disabled={status === 'loading' || !dataSource}
          >
            {status === 'loading' ? 'Running…' : 'Run Test'}
          </button>
          {!dataSource && <span style={{ fontSize: 11, color: '#c0392b' }}>Select a Data Source first.</span>}
        </div>

        {status === 'error' && (
          <div style={{
            gridColumn: '1 / -1', fontSize: 11, color: '#c0392b', background: '#fdf0ee',
            border: '1px solid #e8b4ae', borderRadius: 4, padding: '6px 8px', marginTop: 6,
          }}>
            {errorMsg}
          </div>
        )}

        {status === 'success' && (
          <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
            <div style={{ fontSize: 10, color: '#2e7d32', marginBottom: 4 }}>✓ Success</div>
            <pre style={{
              fontSize: 10, fontFamily: 'Consolas, Monaco, monospace', background: '#f7f7f7',
              border: '1px solid #e5e5e5', borderRadius: 4, padding: 8, maxHeight: 260,
              overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Query detail editor
// ─────────────────────────────────────────────────────────────────────────────

function QueryEditor({ query, dataSources, onUpdate, onDelete }) {
  const set = (field, value) => onUpdate(query.id, { [field]: value });
  const setConfig = (updates) => onUpdate(query.id, { config: { ...query.config, ...updates } });

  const dsOptions = dataSources.map(ds => ({ value: ds.id, label: ds.name || '(unnamed)' }));

  const selectedDs = dataSources.find(ds => ds.id === query.dataSourceId);
  const entityColumnOptions = (selectedDs?.type === 'entity' && Array.isArray(selectedDs.config?.columns))
    ? selectedDs.config.columns.map(c => ({ value: c.name, label: c.name }))
    : [];

  const isSql    = query.type === QUERY_TYPES.SQL_SPROC;
  const isRest   = [QUERY_TYPES.REST_GET, QUERY_TYPES.REST_POST, QUERY_TYPES.REST_PUT, QUERY_TYPES.REST_DELETE].includes(query.type);
  const isOpcUa  = query.type === QUERY_TYPES.OPCUA_READ || query.type === QUERY_TYPES.OPCUA_WRITE;
  const isEntity = query.type === QUERY_TYPES.ENTITY_READ || query.type === QUERY_TYPES.ENTITY_WRITE;

  const inputFields  = getInputFields(query.type, entityColumnOptions);
  const outputFields = getOutputFields(query.type);

  const handleInsertOpcUaInputs = () => {
    let template;
    if (query.type === QUERY_TYPES.OPCUA_WRITE) template = OPCUA_WRITE_INPUT_TEMPLATE;
    else if ((query.config?.samplingMode || 'currentvalue') === 'currentvalue') template = OPCUA_CURRENT_VALUE_INPUT_TEMPLATE;
    else template = OPCUA_HISTORICAL_INPUT_TEMPLATE;
    set('inputs', [...query.inputs, ...template.map(t => makeBlankInput(t))]);
  };

  const handleInsertOpcUaOutputs = () => {
    set('outputs', [...query.outputs, ...OPCUA_READ_OUTPUT_TEMPLATE.map(t => makeBlankOutput(t))]);
  };

  const handleDelete = () => {
    const confirmed = window.confirm('Delete "' + (query.name || 'this query') + '"?');
    if (!confirmed) return;
    const success = onDelete(query.id);
    if (success === false) {
      window.alert('Cannot delete: one or more pages have an instance of this query. Remove those instances first.');
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Editor header */}
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fafafa',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⚡</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {query.name || '(unnamed query)'}
        </span>
        <button
          className="focus-mode-btn"
          style={{ color: '#d00', borderColor: '#d00', fontSize: 11, flexShrink: 0 }}
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>

      {/* Form body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>

        {/* ── General ─────────────────────────────────────────────────────── */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>General</SectionTitle>

            <Field label="Name">
              <TxtInput value={query.name} placeholder="My Query" onChange={v => set('name', v)} />
            </Field>

            <Field label="Description">
              <TxtInput value={query.description} placeholder="Optional description" onChange={v => set('description', v)} />
            </Field>

            <Field label="Type">
              <SelectBox
                dataSource={QUERY_TYPE_OPTIONS}
                valueExpr="value"
                displayExpr="label"
                value={query.type}
                onValueChanged={e => set('type', e.value)}
                stylingMode="outlined"
                width="100%"
                height={24}
              />
            </Field>

            <Field label="Result Shape">
              <div style={{
                fontSize: 11, color: '#555', padding: '2px 6px', background: '#f5f5f5',
                borderRadius: 4, border: '1px solid #e5e5e5', height: 24,
                display: 'flex', alignItems: 'center',
              }}>
                {CARDINALITY_LABELS[inferResultCardinality(query)]}
              </div>
            </Field>
          </div>
        </div>

        {/* ── Data Source ─────────────────────────────────────────────────── */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Data Source</SectionTitle>

            <Field label="Data Source">
              <SelectBox
                dataSource={dsOptions}
                valueExpr="value"
                displayExpr="label"
                value={query.dataSourceId}
                placeholder="Select a data source…"
                onValueChanged={e => set('dataSourceId', e.value)}
                stylingMode="outlined"
                width="100%"
                height={24}
              />
            </Field>

            <Field label="Secondary Data Source">
              <SelectBox
                dataSource={dsOptions.filter(o => o.value !== query.dataSourceId)}
                valueExpr="value"
                displayExpr="label"
                value={query.secondaryDataSourceId}
                placeholder="None (optional)"
                showClearButton={true}
                onValueChanged={e => set('secondaryDataSourceId', e.value ?? null)}
                stylingMode="outlined"
                width="100%"
                height={24}
              />
            </Field>

            <InfoNote>
              Aetherium-specific: if set, a failed read against the primary falls back to this
              data source using the same query. Useful for redundant Historian or OPC UA pairs.
            </InfoNote>
          </div>
        </div>

        {/* ── Inputs ──────────────────────────────────────────────────────── */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Inputs</SectionTitle>
            <ParamListEditor
              items={query.inputs}
              onChange={(newInputs) => set('inputs', newInputs)}
              fields={inputFields}
              addLabel="+ Add Input"
              emptyText="No inputs defined."
              newItemFactory={() => makeBlankInput()}
            />
          </div>
        </div>

        {/* ── Outputs ─────────────────────────────────────────────────────── */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Outputs</SectionTitle>
            <ParamListEditor
              items={query.outputs}
              onChange={(newOutputs) => set('outputs', newOutputs)}
              fields={outputFields}
              addLabel="+ Add Output"
              emptyText="No outputs defined."
              newItemFactory={() => makeBlankOutput()}
            />
          </div>
        </div>

        {/* ── Type-specific configuration ────────────────────────────────── */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>Configuration</SectionTitle>
            {isRest   && <RestConfig query={query} setConfig={setConfig} />}
            {isSql    && <SqlConfig query={query} setConfig={setConfig} />}
            {isOpcUa  && (
              <OpcUaConfig
                query={query}
                setConfig={setConfig}
                onInsertInputs={handleInsertOpcUaInputs}
                onInsertOutputs={handleInsertOpcUaOutputs}
              />
            )}
            {isEntity && <EntityConfig />}
          </div>
        </div>

        {/* ── Test — run the query for real (REST only, for now) ────────── */}
        {isRest && <TestQueryPanel query={query} dataSource={selectedDs} />}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace component
// ─────────────────────────────────────────────────────────────────────────────

export default function QueriesWorkspace({ queries, dataSources, onAdd, onUpdate, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
  const [syncDataSourceId, setSyncDataSourceId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const selected = queries.find(q => q.id === selectedId) || null;
  const dataSourceById = Object.fromEntries(dataSources.map(ds => [ds.id, ds]));
  const columns = makeColumns(dataSourceById);
  const restDataSources = dataSources.filter(ds => ds.type === 'rest' || ds.type === 'historian');

  const handleAdd = () => {
    const id = onAdd();
    setSelectedId(id);
  };

  const handleDelete = (id) => {
    const result = onDelete(id);
    if (result !== false) setSelectedId(null);
    return result;
  };

  const handleSyncFromOphub = async () => {
    const ds = dataSources.find(d => d.id === syncDataSourceId);
    if (!ds?.config?.baseUrl) {
      window.alert('Pick a Data Source (with a Base URL pointing at your OpHub proxy) first.');
      return;
    }
    setSyncing(true);
    try {
      const flows = await fetchOphubFlows({ proxyBaseUrl: ds.config.baseUrl });
      let created = 0, updated = 0, unlinked = 0;
      flows.forEach(flow => {
        const mapped = mapOphubFlowToQuery(flow, dataSources, generateDataId);
        if (!mapped.dataSourceId) unlinked++;
        const existing = queries.find(q => q._ophubFlowUuid === flow.query_id);
        if (existing) {
          const { id: _ignoredId, ...updateFields } = mapped;
          onUpdate(existing.id, updateFields);
          updated++;
        } else {
          onAdd(mapped);
          created++;
        }
      });
      notify(
        `Synced ${flows.length} ${flows.length === 1 ? 'query' : 'queries'} — ${created} created, ${updated} updated` +
        (unlinked ? `, ${unlinked} with no linked Data Source` : ''),
        'success',
        3500
      );
    } catch (err) {
      notify(err.message, 'error', 4500);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>

      {/* ── Left panel: query list ──────────────────────────────────────────── */}
      <SplitterItem size="280px" minSize="180px" resizable={true}>
        <div className="app-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            flexShrink: 0,
          }}>
            <p className="panel-label" style={{ margin: 0 }}>Queries</p>
            <button
              className="focus-mode-btn"
              style={{ fontSize: 16, padding: '0 6px', lineHeight: 1 }}
              title="Add query"
              onClick={handleAdd}
            >+</button>
          </div>

          <div style={{ display: 'flex', gap: 4, padding: '6px 12px', flexShrink: 0, alignItems: 'center' }}>
            <SelectBox
              dataSource={restDataSources.map(ds => ({ value: ds.id, label: ds.name || '(unnamed)' }))}
              valueExpr="value"
              displayExpr="label"
              value={syncDataSourceId}
              placeholder="Sync from…"
              onValueChanged={e => setSyncDataSourceId(e.value)}
              stylingMode="outlined"
              width="100%"
              height={24}
            />
            <button
              className="focus-mode-btn"
              style={{ fontSize: 10, flexShrink: 0, padding: '0 6px' }}
              onClick={handleSyncFromOphub}
              disabled={syncing || !syncDataSourceId}
              title="Sync queries from OpHub"
            >
              {syncing ? '…' : '↻ Sync'}
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
            <DataListGrid
              items={queries}
              columns={columns}
              selectedId={selectedId}
              onSelect={setSelectedId}
              noDataText="No queries yet. Click + to add one."
            />
          </div>
        </div>
      </SplitterItem>

      {/* ── Right panel: detail editor ────────────────────────────────────── */}
      <SplitterItem resizable={true}>
        <div className="app-panel" style={{ height: '100%', overflow: 'hidden' }}>
          {selected ? (
            <QueryEditor
              query={selected}
              dataSources={dataSources}
              onUpdate={onUpdate}
              onDelete={handleDelete}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="data-workspace-placeholder">
                <div className="data-workspace-placeholder-icon">⚡</div>
                <div className="data-workspace-placeholder-title" style={{ fontSize: 14 }}>
                  No query selected
                </div>
                <div className="data-workspace-placeholder-desc">
                  Select a query from the list, or click <strong>+</strong> to create a new one.
                </div>
              </div>
            </div>
          )}
        </div>
      </SplitterItem>

    </Splitter>
  );
}
