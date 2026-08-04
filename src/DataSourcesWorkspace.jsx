// DataSourcesWorkspace.jsx
// Left-panel list of data sources + right-panel detail editor.
// Connectivity fields adapt to the selected product type.

import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Splitter, Item as SplitterItem } from 'devextreme-react/splitter';
import { SelectBox } from 'devextreme-react/select-box';
import { Switch } from 'devextreme-react/switch';
import notify from 'devextreme/ui/notify';
import { Field, TxtInput, InfoNote, SectionTitle, SubSectionLabel } from './FormFields';
import DataListGrid from './DataListGrid';

// ─────────────────────────────────────────────────────────────────────────────
// Product catalog
// Each entry maps a user-facing product label to an internal connectivity type.
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTS = [
  // GE Vernova / Proficy
  { key: 'proficy_historian',  label: 'Proficy Historian',          connectivity: 'historian',          icon: '📈', dot: '#00897B' },
  { key: 'proficy_ifix',       label: 'Proficy iFIX',               connectivity: 'opcua',              icon: '🖥',  dot: '#E65100' },
  { key: 'proficy_cimplicity', label: 'Proficy CIMPLICITY',         connectivity: 'opcua',              icon: '🎛️', dot: '#BF360C' },
  { key: 'proficy_pa',         label: 'Proficy Plant Applications',  connectivity: 'plant_applications', icon: '🏭', dot: '#1565C0' },
  { key: 'proficy_batch',      label: 'Proficy Batch',               connectivity: 'rest',               icon: '⚗️', dot: '#6A1B9A', disabled: true },
  { key: 'proficy_workflow',   label: 'Proficy Workflow',            connectivity: 'rest',               icon: '🔄', dot: '#37474F', disabled: true },
  // Generic
  { key: 'opcua',              label: 'OPC UA',                      connectivity: 'opcua',              icon: '🔌', dot: '#E65100' },
  { key: 'rest',               label: 'REST API',                    connectivity: 'rest',               icon: '🌐', dot: '#1565C0' },
  { key: 'sql',                label: 'Relational Database',         connectivity: 'sql',                icon: '🗄️', dot: '#2E7D32' },
  { key: 'graphql',            label: 'GraphQL',                     connectivity: 'graphql',            icon: '◈',  dot: '#AD1457', disabled: true },
];

const PRODUCT_BY_KEY = Object.fromEntries(PRODUCTS.map(p => [p.key, p]));

// ─────────────────────────────────────────────────────────────────────────────
// Auth fields — shared by REST, Historian, and GraphQL
// ─────────────────────────────────────────────────────────────────────────────

function AuthFields({ config, onChange }) {
  const authType  = config.auth?.type      || 'none';
  const grantType = config.auth?.grantType || 'client_credentials';
  const upd = (key, val) => onChange({ auth: { ...(config.auth || {}), [key]: val } });

  return (<>
    <Field label="Auth">
      <SelectBox
        dataSource={[
          { label: 'None',         value: 'none'   },
          { label: 'Bearer Token', value: 'bearer' },
          { label: 'Basic Auth',   value: 'basic'  },
          { label: 'OAuth',        value: 'oauth'  },
        ]}
        valueExpr="value"
        displayExpr="label"
        value={authType}
        onValueChanged={e => upd('type', e.value)}
        stylingMode="outlined"
        width="100%"
        height={24}
      />
    </Field>

    {/* CASE 1 — Bearer Token */}
    {authType === 'bearer' && (
      <Field label="Auth Token">
        <input
          className="details-input"
          type="password"
          value={config.auth?.bearerToken || ''}
          onChange={e => upd('bearerToken', e.target.value)}
        />
      </Field>
    )}

    {/* CASE 2 — Basic Auth */}
    {authType === 'basic' && (<>
      <Field label="Username">
        <TxtInput value={config.auth?.username || ''} onChange={v => upd('username', v)} />
      </Field>
      <Field label="Password">
        <input
          className="details-input"
          type="password"
          value={config.auth?.password || ''}
          onChange={e => upd('password', e.target.value)}
        />
      </Field>
    </>)}

    {/* CASE 3 — OAuth */}
    {authType === 'oauth' && (<>
      <Field label="Auth Grant Type">
        <SelectBox
          dataSource={[
            { label: 'client_credentials', value: 'client_credentials' },
            { label: 'password',           value: 'password'           },
          ]}
          valueExpr="value"
          displayExpr="label"
          value={grantType}
          onValueChanged={e => upd('grantType', e.value)}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>

      {/* 3A + 3B shared fields */}
      <Field label="Auth URL">
        <TxtInput
          value={config.auth?.tokenUrl || ''}
          placeholder="https://host/oauth/token"
          onChange={v => upd('tokenUrl', v)}
          mono
        />
      </Field>
      <Field label="Auth Client ID">
        <TxtInput value={config.auth?.clientId || ''} onChange={v => upd('clientId', v)} />
      </Field>
      <Field label="Auth Client Secret">
        <input
          className="details-input"
          type="password"
          value={config.auth?.clientSecret || ''}
          onChange={e => upd('clientSecret', e.target.value)}
        />
      </Field>

      {/* 3B extra fields — password grant only */}
      {grantType === 'password' && (<>
        <Field label="Username">
          <TxtInput value={config.auth?.username || ''} onChange={v => upd('username', v)} />
        </Field>
        <Field label="Password">
          <input
            className="details-input"
            type="password"
            value={config.auth?.password || ''}
            onChange={e => upd('password', e.target.value)}
          />
        </Field>
      </>)}
    </>)}

    {/* Test Connection — OAuth only */}
    {authType === 'oauth' && (
      <Field label="Test">
        <button
          className="focus-mode-btn"
          disabled
          title="Not yet implemented"
          style={{ fontSize: 11, opacity: 0.5 }}
        >
          Test Connection
        </button>
      </Field>
    )}
  </>);
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-specific connectivity field sets
// ─────────────────────────────────────────────────────────────────────────────

// Shared TLS + certificate fields — used after the URL field in all REST-family
// connectors (Historian, REST API, GraphQL).
function TlsCertFields({ config, onChange }) {
  const certRequired = !!config.certificateRequired;
  return (<>
    <Field label="Ignore TLS/SSL">
      <Switch value={!!config.ignoreTls} onValueChanged={e => onChange({ ignoreTls: e.value })} />
    </Field>
    <Field label="Certificate Required">
      <Switch value={certRequired} onValueChanged={e => onChange({ certificateRequired: e.value })} />
    </Field>
    {certRequired && (
      <Field label="Certificate">
        <button
          className="focus-mode-btn"
          disabled
          title="Not yet implemented"
          style={{ fontSize: 11, opacity: 0.5 }}
        >
          Choose Certificate
        </button>
      </Field>
    )}
  </>);
}

// Historian — REST API mode with enable/disable toggle
function HistorianFields({ config, onChange }) {
  const restEnabled = config.restEnabled !== false; // default on

  return (<>
    <Field label="REST Connection">
      <Switch value={restEnabled} onValueChanged={e => onChange({ restEnabled: e.value })} />
    </Field>
    {restEnabled && (<>
      <SubSectionLabel>Connectivity</SubSectionLabel>
      <Field label="Base URL">
        <TxtInput
          value={config.baseUrl}
          placeholder="https://hostname:8443"
          onChange={v => onChange({ baseUrl: v })}
          mono
        />
      </Field>
      <TlsCertFields config={config} onChange={onChange} />
      <InfoNote>
        Connects via the Proficy Historian REST API. The base URL should include the port
        (e.g. https://historian-server:8443). Native Historian connections are managed by the system.
      </InfoNote>
      <SubSectionLabel>Authentication</SubSectionLabel>
      <AuthFields config={config} onChange={onChange} />
    </>)}
  </>);
}

// OPC UA — used by generic OPC UA base connector and Proficy iFIX.
// showToggle: true for Proficy products (wraps in an enable/disable toggle).
// showToggle: false for the generic OPC UA base connector (always visible).
function OpcUaFields({ config, onChange, showToggle = false, toggleLabel = 'OPC UA Connection' }) {
  const enabled = !showToggle || config.opcuaEnabled !== false;
  const readAuthType  = config.readAuthType  || 'anonymous';
  const writeAuthType = config.writeAuthType || 'readCredentials'; // default: use read credentials

  return (<>

    {/* ── Connection type toggle (Proficy products only) ────────────────── */}
    {showToggle && (
      <Field label={toggleLabel}>
        <Switch value={enabled} onValueChanged={e => onChange({ opcuaEnabled: e.value })} />
      </Field>
    )}

    {enabled && (<>

      {/* ── Connectivity ─────────────────────────────────────────────────── */}
      <SubSectionLabel>Connectivity</SubSectionLabel>

      <Field label="Endpoint URL">
        <TxtInput
          value={config.endpoint}
          placeholder="opc.tcp://hostname:49310"
          onChange={v => onChange({ endpoint: v })}
          mono
        />
      </Field>

      <Field label="Application URI">
        <TxtInput
          value={config.applicationUri}
          placeholder="urn:hostname:MyServer (optional)"
          onChange={v => onChange({ applicationUri: v })}
          mono
        />
      </Field>

      <Field label="Security Mode">
        <SelectBox
          dataSource={[
            { label: 'None',           value: 0 },
            { label: 'Sign',           value: 1 },
            { label: 'Sign & Encrypt', value: 2 },
          ]}
          valueExpr="value"
          displayExpr="label"
          value={config.securityMode ?? 0}
          onValueChanged={e => onChange({ securityMode: e.value })}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>

      <Field label="Security Policy">
        <div style={{ display: 'flex', gap: 4 }}>
          <TxtInput
            value={config.securityPolicy}
            placeholder="http://opcfoundation.org/UA/SecurityPolicy#None"
            onChange={v => onChange({ securityPolicy: v })}
            mono
          />
          <button className="focus-mode-btn" disabled title="Not yet implemented" style={{ flexShrink: 0, fontSize: 10, opacity: 0.5 }}>
            Discover
          </button>
        </div>
      </Field>

      <div style={{ gridColumn: '1 / -1', paddingBottom: 2 }}>
        <button className="focus-mode-btn" disabled title="Not yet implemented" style={{ fontSize: 10, opacity: 0.5 }}>
          View Certificate
        </button>
      </div>

      {/* ── Authentication ───────────────────────────────────────────────── */}
      <SubSectionLabel>Authentication</SubSectionLabel>

      <Field label="Read">
        <SelectBox
          dataSource={[
            { label: 'Anonymous',          value: 'anonymous' },
            { label: 'Username / Password', value: 'usernamePassword' },
          ]}
          valueExpr="value"
          displayExpr="label"
          value={readAuthType}
          onValueChanged={e => onChange({ readAuthType: e.value })}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>

      {readAuthType === 'usernamePassword' && (<>
        <Field label="Username">
          <TxtInput
            value={config.readUsername || ''}
            onChange={v => onChange({ readUsername: v })}
          />
        </Field>
        <Field label="Password">
          <input
            className="details-input"
            type="password"
            value={config.readPassword || ''}
            onChange={e => onChange({ readPassword: e.target.value })}
          />
        </Field>
        <Field label="Test">
          <button
            className="focus-mode-btn"
            disabled
            title="Not yet implemented"
            style={{ fontSize: 11, opacity: 0.5 }}
          >
            Test Connection
          </button>
        </Field>
      </>)}

      <Field label="Write">
        <SelectBox
          dataSource={[
            { label: 'Use Read Credentials for Write', value: 'readCredentials' },
            { label: 'Logged On User Token',           value: 'loggedOnUser'    },
            { label: 'Username / Password',            value: 'usernamePassword' },
          ]}
          valueExpr="value"
          displayExpr="label"
          value={writeAuthType}
          onValueChanged={e => onChange({ writeAuthType: e.value })}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
      </Field>

    </>)}
  </>);
}

// REST — used by REST API, Proficy Plant Applications, Proficy Batch, Proficy Workflow
function RestFields({ config, onChange }) {
  return (<>
    <SubSectionLabel>Connectivity</SubSectionLabel>
    <Field label="Base URL">
      <TxtInput
        value={config.baseUrl}
        placeholder="https://hostname"
        onChange={v => onChange({ baseUrl: v })}
        mono
      />
    </Field>
    <TlsCertFields config={config} onChange={onChange} />
    <SubSectionLabel>Authentication</SubSectionLabel>
    <AuthFields config={config} onChange={onChange} />
  </>);
}

// SQL / Relational Database — flat fields only; toggle is added by parent for multi-connection products
function SqlFields({ config, onChange }) {
  const certRequired = !!config.certificateRequired;

  return (<>
    <SubSectionLabel>Connectivity</SubSectionLabel>

    <Field label="Database Type">
      <SelectBox
        dataSource={[
          { label: 'Microsoft SQL Server', value: 'sqlserver', disabled: false },
          { label: 'Postgres',             value: 'postgres',  disabled: true  },
          { label: 'JDBC',                 value: 'jdbc',      disabled: true  },
        ]}
        valueExpr="value"
        displayExpr="label"
        disabledExpr="disabled"
        value={config.dbType || 'sqlserver'}
        onValueChanged={e => onChange({ dbType: e.value })}
        stylingMode="outlined"
        width="100%"
        height={24}
      />
    </Field>

    <Field label="Host">
      <TxtInput value={config.server} placeholder="hostname or IP" onChange={v => onChange({ server: v })} mono />
    </Field>

    <Field label="Port">
      <TxtInput value={config.port ?? '1433'} placeholder="1433" onChange={v => onChange({ port: v })} />
    </Field>

    <Field label="Database">
      <TxtInput value={config.database} placeholder="database name" onChange={v => onChange({ database: v })} />
    </Field>

    <Field label="Certificate Required">
      <Switch value={certRequired} onValueChanged={e => onChange({ certificateRequired: e.value })} />
    </Field>

    {certRequired && (
      <Field label="Certificate">
        <button className="focus-mode-btn" disabled title="Not yet implemented" style={{ fontSize: 11, opacity: 0.5 }}>
          Choose Certificate
        </button>
      </Field>
    )}

    <SubSectionLabel>Authentication</SubSectionLabel>

    <Field label="Username">
      <TxtInput value={config.username} onChange={v => onChange({ username: v })} />
    </Field>

    <Field label="Password">
      <input
        className="details-input"
        type="password"
        value={config.password || ''}
        onChange={e => onChange({ password: e.target.value })}
      />
    </Field>
  </>);
}

// GraphQL
function GraphQlFields({ config, onChange }) {
  return (<>
    <SubSectionLabel>Connectivity</SubSectionLabel>
    <Field label="Endpoint">
      <TxtInput
        value={config.baseUrl}
        placeholder="https://hostname/graphql"
        onChange={v => onChange({ baseUrl: v })}
        mono
      />
    </Field>
    <TlsCertFields config={config} onChange={onChange} />
    <SubSectionLabel>Authentication</SubSectionLabel>
    <AuthFields config={config} onChange={onChange} />
  </>);
}

// Plant Applications — REST + Relational Database + GraphQL, each with its own toggle
// Each connection type uses its own namespaced config slice (config.rest, config.sql, config.graphql)
function PlantApplicationsFields({ config, onChange }) {
  const restEnabled = config.restEnabled !== false;
  const sqlEnabled  = config.sqlEnabled  !== false;
  const gqlEnabled  = config.graphqlEnabled !== false;

  // Each type writes to its own namespace so their fields don't collide
  const onRest = (u) => onChange({ rest:    { ...(config.rest    || {}), ...u } });
  const onSql  = (u) => onChange({ sql:     { ...(config.sql     || {}), ...u } });
  const onGql  = (u) => onChange({ graphql: { ...(config.graphql || {}), ...u } });

  return (<>
    {/* ── REST ────────────────────────────────────────────────────────────── */}
    <Field label="REST Connection">
      <Switch value={restEnabled} onValueChanged={e => onChange({ restEnabled: e.value })} />
    </Field>
    {restEnabled && <RestFields config={config.rest || {}} onChange={onRest} />}

    {/* ── Relational Database ─────────────────────────────────────────────── */}
    <Field label="Relational Database Connection">
      <Switch value={sqlEnabled} onValueChanged={e => onChange({ sqlEnabled: e.value })} />
    </Field>
    {sqlEnabled && <SqlFields config={config.sql || {}} onChange={onSql} />}

    {/* ── GraphQL ─────────────────────────────────────────────────────────── */}
    <Field label="GraphQL Connection">
      <Switch value={gqlEnabled} onValueChanged={e => onChange({ graphqlEnabled: e.value })} />
    </Field>
    {gqlEnabled && <GraphQlFields config={config.graphql || {}} onChange={onGql} />}
  </>);
}

// ─────────────────────────────────────────────────────────────────────────────
// Data source detail editor
// ─────────────────────────────────────────────────────────────────────────────

const DataSourceEditor = forwardRef(function DataSourceEditor({ ds: committedDs, onUpdate, onDelete, onDirtyChange }, ref) {
  const [draft, setDraft] = useState(committedDs);
  const [syncedId, setSyncedId] = useState(committedDs.id);

  // Resets draft the moment the SELECTED data source changes — done
  // synchronously DURING render (React's recommended pattern for this), not
  // via useEffect. An effect-based reset runs AFTER the render that already
  // compared stale draft data against the new committedDs, producing one
  // real render where isDirty was wrongly true — the same false "unsaved
  // changes" bug confirmed and fixed in QueriesWorkspace.
  if (committedDs.id !== syncedId) {
    setSyncedId(committedDs.id);
    setDraft(committedDs);
  }

  // Everything below this line reads/writes `ds` exactly as before this
  // refactor — aliasing it to the draft means the whole existing render body
  // (General section, all five connectivity field sets) needed ZERO changes
  // to become draft-aware.
  const ds = draft;

  const isDirty = JSON.stringify(draft) !== JSON.stringify(committedDs);

  // Propagate live dirty status up to the list (for its dirty-dot indicator)
  // — a ref alone wouldn't trigger the parent to re-render as you type.
  useEffect(() => {
    onDirtyChange?.(isDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useImperativeHandle(ref, () => ({
    isDirty: () => isDirty,
    save: () => {
      onUpdate(committedDs.id, draft);
      notify(`Saved "${draft.name || 'data source'}"`, 'success', 2000);
    },
  }), [isDirty, draft, committedDs.id, onUpdate]);

  const product = PRODUCT_BY_KEY[ds.productKey] || null;
  const connectivity = ds.productKey ? product?.connectivity : null;

  const set = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));
  const setConfig = (configUpdates) =>
    setDraft(prev => ({ ...prev, config: { ...prev.config, ...configUpdates } }));

  const handleProductChange = (productKey) => {
    const p = PRODUCT_BY_KEY[productKey];
    if (!p) return;
    setDraft(prev => ({ ...prev, productKey, productType: p.label, type: p.connectivity }));
  };

  const handleDelete = () => {
    const confirmed = window.confirm(`Delete "${ds.name || 'this data source'}"?`);
    if (!confirmed) return;
    const success = onDelete(committedDs.id);
    if (success === false) {
      window.alert('Cannot delete: one or more queries are using this data source. Remove those queries first.');
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
        {product && (
          <span style={{ fontSize: 16, lineHeight: 1 }}>{product.icon}</span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ds.name || '(unnamed data source)'}
        </span>
        {!ds.isSystemManaged && (
          <button
            className="focus-mode-btn"
            style={{ color: '#d00', borderColor: '#d00', fontSize: 11, flexShrink: 0 }}
            onClick={handleDelete}
          >
            Delete
          </button>
        )}
        {ds.isSystemManaged && (
          <span style={{ fontSize: 10, color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: 4 }}>
            System managed
          </span>
        )}
      </div>

      {/* Form body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>

        {/* General section */}
        <div className="details-section">
          <div className="details-grid">
            <SectionTitle>General</SectionTitle>

            <Field label="Name">
              <TxtInput
                value={ds.name}
                placeholder="My Data Source"
                onChange={v => set('name', v)}
              />
            </Field>

            <Field label="Description">
              <TxtInput
                value={ds.description}
                placeholder="Optional description"
                onChange={v => set('description', v)}
              />
            </Field>

            <Field label="Product">
              <SelectBox
                dataSource={PRODUCTS}
                valueExpr="key"
                displayExpr="label"
                disabledExpr="disabled"
                value={ds.productKey || null}
                placeholder="Select a product…"
                onValueChanged={e => handleProductChange(e.value)}
                stylingMode="outlined"
                width="100%"
                height={24}
                readOnly={ds.isSystemManaged}
              />
            </Field>
          </div>
        </div>

        {/* Connectivity section — shown once a product is selected */}
        {connectivity && !ds.isSystemManaged && (
          <div className="details-section">
            <div className="details-grid">
              {/* Each connectivity type manages its own sub-section labels internally */}
              {connectivity === 'historian' && (
                <HistorianFields config={ds.config} onChange={setConfig} />
              )}
              {connectivity === 'opcua' && (
                <OpcUaFields
                  config={ds.config}
                  onChange={setConfig}
                  showToggle={!['opcua'].includes(ds.productKey)}
                  toggleLabel="OPC UA Connection"
                />
              )}
              {connectivity === 'plant_applications' && (
                <PlantApplicationsFields config={ds.config} onChange={setConfig} />
              )}
              {(connectivity === 'rest' || connectivity === 'batch') && (
                <RestFields config={ds.config} onChange={setConfig} />
              )}
              {connectivity === 'sql' && (
                <SqlFields config={ds.config} onChange={setConfig} />
              )}
              {connectivity === 'graphql' && (
                <GraphQlFields config={ds.config} onChange={setConfig} />
              )}
            </div>
          </div>
        )}

        {/* System-managed note */}
        {ds.isSystemManaged && (
          <div style={{
            margin: '8px 0',
            padding: '8px 12px',
            background: '#f5f5f5',
            borderRadius: 6,
            fontSize: 11,
            color: '#777',
            lineHeight: 1.5,
          }}>
            This data source is managed by the system and was imported from an Operations Hub
            application. Its connectivity settings are read-only in Aetherium.
          </div>
        )}

        {/* Prompt to select a product */}
        {!connectivity && !ds.isSystemManaged && (
          <div style={{
            margin: '8px 0',
            padding: '8px 12px',
            background: '#fffbe6',
            border: '1px solid #ffe08a',
            borderRadius: 6,
            fontSize: 11,
            color: '#7a6000',
          }}>
            Select a product above to configure the connection settings.
          </div>
        )}

      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// List grid column definitions
// ─────────────────────────────────────────────────────────────────────────────

function makeColumns(selectedId, selectedIsDirty) {
  const nameCellRender = (cellInfo) => {
    const ds = cellInfo.data;
    const product = PRODUCT_BY_KEY[ds.productKey] || null;
    const isActiveDirty = ds.id === selectedId && selectedIsDirty;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: product?.dot || '#bbb', flexShrink: 0 }} />
        {isActiveDirty && (
          <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: '#e08a00', flexShrink: 0 }} />
        )}
        <span style={{ color: ds.name ? '#222' : '#aaa' }}>{ds.name || '(unnamed)'}</span>
        {ds.isSystemManaged && <span style={{ fontSize: 9, color: '#aaa' }}>sys</span>}
      </div>
    );
  };
  return [
    { dataField: 'name',        caption: 'Name',        cellRender: nameCellRender, minWidth: 130 },
    { dataField: 'productType', caption: 'Product',      width: 130 },
    { dataField: 'description', caption: 'Description',  minWidth: 100 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace component
// ─────────────────────────────────────────────────────────────────────────────

const DataSourcesWorkspace = forwardRef(function DataSourcesWorkspace({ dataSources, onAdd, onUpdate, onDelete }, ref) {
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIsDirty, setSelectedIsDirty] = useState(false);
  const editorRef = useRef(null);

  // If the selected item gets deleted, clear the selection
  const selected = dataSources.find(ds => ds.id === selectedId) || null;
  const columns = makeColumns(selectedId, selectedIsDirty);

  useImperativeHandle(ref, () => ({
    save: () => editorRef.current?.save(),
  }), []);

  const confirmDiscardIfDirty = () => {
    if (!editorRef.current?.isDirty()) return true;
    return window.confirm('You have unsaved changes on this data source. Discard them and continue?');
  };

  const handleAdd = () => {
    if (!confirmDiscardIfDirty()) return;
    const id = onAdd();
    setSelectedId(id);
  };

  const handleSelect = (id) => {
    if (id === selectedId) return;
    if (!confirmDiscardIfDirty()) return;
    setSelectedId(id);
  };

  const handleDelete = (id) => {
    const result = onDelete(id);
    if (result !== false) setSelectedId(null);
    return result;
  };

  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>

      {/* ── Left panel: data source list ──────────────────────────────────── */}
      <SplitterItem size="280px" minSize="180px" resizable={true}>
        <div className="app-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            flexShrink: 0,
          }}>
            <p className="panel-label" style={{ margin: 0 }}>Data Sources</p>
            <button
              className="focus-mode-btn"
              style={{ fontSize: 16, padding: '0 6px', lineHeight: 1 }}
              title="Add data source"
              onClick={handleAdd}
            >+</button>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
            <DataListGrid
              items={dataSources}
              columns={columns}
              selectedId={selectedId}
              onSelect={handleSelect}
              noDataText="No data sources yet. Click + to add one."
            />
          </div>
        </div>
      </SplitterItem>


      {/* ── Right panel: detail editor ────────────────────────────────────── */}
      <SplitterItem resizable={true}>
        <div className="app-panel" style={{ height: '100%', overflow: 'hidden' }}>
          {selected ? (
            <DataSourceEditor
              ref={editorRef}
              ds={selected}
              onUpdate={onUpdate}
              onDelete={handleDelete}
              onDirtyChange={setSelectedIsDirty}
            />
          ) : (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div className="data-workspace-placeholder">
                <div className="data-workspace-placeholder-icon">🔌</div>
                <div className="data-workspace-placeholder-title" style={{ fontSize: 14 }}>
                  No data source selected
                </div>
                <div className="data-workspace-placeholder-desc">
                  Select a data source from the list, or click <strong>+</strong> to create a new one.
                </div>
              </div>
            </div>
          )}
        </div>
      </SplitterItem>

    </Splitter>
  );
});

export default DataSourcesWorkspace;
