# Aetherium — Data Model & Operations Hub Import Specification

**Version:** Phase 2a Design  
**Date:** June 2026  
**Status:** Draft — pre-implementation  

---

## Overview

This document defines:

1. **Aetherium's internal data model** for data sources, queries, query instances, and widget bindings — the structures that will live in App.js state and persist with the project file.
2. **The OpHub import specification** — transformation rules for parsing an Operations Hub XML export into Aetherium's data model.
3. **Phase 2a build plan** — what to implement first and in what order.

The data model is designed to be import-compatible with both Operations Hub and ThingWorx from the start, even though the TWX importer is a later deliverable. Decisions that would make TWX import harder are called out explicitly.

---

## Part 1 — Aetherium Data Model

### 1.1 Top-Level App State

Three new collections join `containers` in App.js state:

```javascript
const [dataSources,    setDataSources]    = useState([]); // app-scoped
const [queries,        setQueries]        = useState([]); // app-scoped
const [queryInstances, setQueryInstances] = useState({}); // keyed by pageId → array
```

Data sources and queries are **app-scoped** — shared across all pages. Query instances are **page-scoped** — each page has its own array. This matches OpHub's architecture and means the same query (e.g. "Get Current OEE") can be instantiated on multiple pages with different input values per instance.

---

### 1.2 DataSource

Represents connectivity to an external system. Holds base URL, auth config, and connection-level settings. Never holds query logic.

```javascript
{
  id:            string,   // Aetherium-generated UUID
  name:          string,   // display name (dsServerName)
  type:          'rest' | 'opcua' | 'sql' | 'historian' | 'entity' | 'batch' | 'ifix',
  productType:   string,   // original product label (e.g. "Proficy Historian", "OPC UA")
  isSystemManaged: boolean, // true = auto-created by system, not user-defined (systemAPIDS)

  config: {
    // ── REST ────────────────────────────────────────────────────────────────
    baseUrl?:      string,   // e.g. "https://demovm"
    auth?: {
      type:        'oauth' | 'basic' | 'none',
      // OAuth
      tokenUrl?:   string,
      clientId?:   string,
      grantType?:  'client_credentials' | 'password',
      // Basic
      username?:   string,
      // Passwords/tokens are NEVER stored — prompted at runtime
    },
    ignoreTls?:    boolean,

    // ── OPC UA ──────────────────────────────────────────────────────────────
    endpoint?:     string,   // e.g. "opc.tcp://host:49310"
    securityMode?: number,   // 0=None, 1=Sign, 2=SignAndEncrypt
    securityPolicy?: string, // URI string
    applicationUri?: string,
    tokenType?:    string,   // 'userName', 'Anonymous', etc.
    username?:     string,

    // ── SQL / Relational DB ─────────────────────────────────────────────────
    connectionUrl?: string,  // full JDBC URL (preserved for reference)
    server?:        string,
    port?:          number,
    database?:      string,
    username?:      string,

    // ── Entity (OpHub-managed table) ────────────────────────────────────────
    columns?: Array<{
      columnId:    string,   // c1, c2, ...
      name:        string,
      type:        'String' | 'Number' | 'Boolean' | 'DateTime',
      mandatory:   boolean,
    }>,
  },

  // Preserved for round-trip fidelity and future re-import
  _ophubUuid?: string,   // original dataSourceUuid or datasourceUuid (normalized)
}
```

**Notes:**
- Passwords, certificates, and access tokens are never stored. The UI will prompt for credentials at runtime.
- The `entity` type is OpHub-specific. In Aetherium, entities function as an internal data source with a known schema. For ThingWorx import, there is no direct equivalent — TWX Things serve a similar role but with different semantics.
- `isSystemManaged: true` sources (OpHub's `systemAPIDS: true`) should be visually distinguished in the Data workspace and treated as read-only during import (they exist in the environment, not defined by the user).

---

### 1.3 Query

Represents a named data contract — a specific request with defined inputs and outputs. Always belongs to exactly one data source.

```javascript
{
  id:         string,   // Aetherium-generated UUID
  name:       string,   // display name (flowName)
  dataSourceId: string, // reference to DataSource.id

  type: 'opcua_read'   // OPC UA subscription/read
      | 'opcua_write'  // OPC UA write
      | 'sql_sproc'    // SQL stored procedure
      | 'rest_get'     // REST GET
      | 'rest_post'    // REST POST (future)
      | 'entity_read', // OpHub entity table read

  direction: 'read' | 'write' | 'readwrite',
  // 'readwrite' = queries that have both inputs AND return result data
  // (e.g. INPUT_OUTPUT_PARAMETER stored procs)

  resultCardinality: 'scalar'    // single row, single value — bind to gauge/label
                   | 'series'    // multiple rows, same shape — bind to chart
                   | 'resultset' // multiple rows, named columns — bind to grid
                   | 'none',     // write-only, no return value

  inputs: [{
    name:         string,
    type:         'String' | 'Number' | 'DateTime' | 'Boolean' | 'Real',
    optional:     boolean,
    defaultValue: any,            // from detailedInputs[].value
    uiHint:       'tagbrowser'    // show tag browser UI
                | 'combobox'      // show dropdown
                | 'text'          // plain text input
                | 'datetime'      // date/time picker
                | 'number'        // numeric input
                | 'inputField',   // generic field (SQL params)
    paramType:    'INPUT_PARAMETER'
                | 'INPUT_OUTPUT_PARAMETER'  // value also returned as output
                | 'query'                   // REST URL query param
                | null,                     // not applicable
  }],

  outputs: [{
    name:        string,   // field name as used in binding references
    type:        'String' | 'Number' | 'DateTime' | 'Boolean' | 'Real' | 'Date',
    outputGroup: string,   // 'default' for flat/scalar; 'Resultset1', 'OutputParameter' etc. for SQL
    outputType:  'scalar' | 'Resultset' | 'OutputParameter',
  }],

  config: {
    // ── OPC UA ──────────────────────────────────────────────────────────────
    samplingMode?:  string,   // 'currentvalue' | 'interpolated' | 'cyclic' | 'raw'
    qualityThreshold?: string,

    // ── REST ────────────────────────────────────────────────────────────────
    path?:     string,   // relative URL path, e.g. "/historian-rest-api/v1/tagslist"
    verb?:     'get' | 'post' | 'put' | 'delete',
    request?:  string,   // named API request within the data source

    // ── SQL ─────────────────────────────────────────────────────────────────
    schemaName?:           string,   // e.g. "dbo"
    procName?:             string,   // stored procedure name
    convertDatetimeToLocal?: boolean,
    dateTimeParams?:       string[], // input fields that are datetime (for SQL formatting)

    // ── Entity ──────────────────────────────────────────────────────────────
    conditions?: [{
      fieldName:  string,
      paramName:  string,
      operator:   string,  // '=', '>', '<', etc.
    }],
  },

  // Execution defaults (can be overridden per instance)
  pollInterval: number | null,  // milliseconds; null = push/on-demand
  pushEnabled:  boolean,

  // Preserved for import traceability
  _ophubFlowId?:   number,  // integer flowId
  _ophubFlowUuid?: string,  // UUID
  _ophubFlowType?: string,  // original flowType string
}
```

**Notes on `resultCardinality`:**
- OPC UA "Current Value" → `scalar` (one value at a time)
- OPC UA "Historical By Count" → `series` (time-series array)
- SQL stored proc → `resultset` (multi-row named columns)
- Entity query → `resultset`
- OPC UA Write → `none`

The cardinality determines which widget properties can accept this query's binding. A `CircularGauge.value` only accepts `scalar`. A `DataGrid.input` only accepts `resultset`. A `Chart.dataSource` accepts `series` or `resultset`. The binding editor will filter queries by cardinality.

**Notes on `INPUT_OUTPUT_PARAMETER`:**
SQL stored procs that declare OUTPUT parameters use `INPUT_OUTPUT_PARAMETER`. These appear in `inputs` (the proc needs them as placeholders) AND as `outputs` (the proc fills them with values). During import, these are added to both the `inputs` and `outputs` arrays, distinguished by `outputType: 'OutputParameter'`.

---

### 1.4 QueryInstance

A page-level instantiation of a global query. Provides per-page input value overrides and execution settings. Multiple pages can instance the same query with different values.

```javascript
{
  id:         number,   // page-scoped integer (flowInstanceId), 1-based
  queryId:    string,   // reference to Query.id
  alias:      string,   // display name on this page

  // Per-instance input value overrides
  // Any input not listed here uses the Query's defaultValue
  inputOverrides: [{
    fieldName: string,
    value:     any,
  }],

  // For SQL queries with multiple resultsets: which resultset this instance exposes
  resultSet:           string | null,   // 'Resultset1', 'OutputParameter', etc.
  isSecondaryResultset: boolean,        // true = sibling instance for a secondary resultset

  // Execution config (can differ from query defaults)
  submitOnLoad: boolean,
  pollInterval: number | null,   // ms; overrides query default; null = on-demand
  pushEnabled:  boolean,
}
```

**Notes:**
- SQL queries with multiple resultsets (e.g. a proc returning both a `Resultset1` and `OutputParameter`) get **one QueryInstance per resultset**. Both instances share the same `queryId` and same `inputOverrides`, but have different `resultSet` values.
- `allowMultipleInstances: true` in OpHub means the same query can be instantiated more than once on the same page (e.g. running the same KPI proc with different unit list inputs). Aetherium supports this naturally since instances are distinct objects.

---

### 1.5 Widget Binding Format — Phase 2 Extension

Phase 1 introduced `container.bindings` keyed by property name, each holding `{ type: 'expression', expression: '...' }`. Phase 2 adds a new binding type: `query`.

```javascript
// Phase 1 (unchanged)
container.bindings['value'] = {
  type:       'expression',
  expression: '42.5 * 1.1',
}

// Phase 2 — scalar query binding (gauge value, label text, single field)
container.bindings['value'] = {
  type:            'query',
  queryInstanceId: 3,       // page-scoped integer
  queryId:         'abc...',// Aetherium Query.id — redundant but useful for validation
  outputField:     'value', // single output field name
}

// Phase 2 — collection query binding (grid data, list items, chart data)
container.bindings['dataSource'] = {
  type:            'query',
  queryInstanceId: 1,
  queryId:         'def...',
  outputFields: [           // multiple fields — entire result set
    { fieldName: 'Amy_Machines.PlantName',  fieldType: 'String' },
    { fieldName: 'Amy_Machines.MachineName', fieldType: 'String' },
    { fieldName: 'Amy_Machines.MachineID',  fieldType: 'String' },
    { fieldName: 'Amy_Machines.MachineType', fieldType: 'String' },
  ],
}
```

**Discriminating scalar vs collection:** use `outputField` (string) for scalar, `outputFields` (array) for collection. The resolver checks which is present.

**Transform pipeline** (Phase 2a, even before live data): an optional `transform` array can follow the binding config:

```javascript
container.bindings['value'] = {
  type:            'query',
  queryInstanceId: 3,
  outputField:     'value',
  transform: [
    { type: 'scale',  from: [0, 1],  to: [0, 100] },       // 0.847 → 84.7
    { type: 'format', pattern: '{value:.1f}%' },            // 84.7 → "84.7%"
  ],
}
```

Transform types for Phase 2a:
- `expression` — apply the Phase 1 expression evaluator with `value` in scope: `value * 100`
- `map` — key-value substitution: `{ 0: 'Stopped', 1: 'Running', 2: 'Fault' }`
- `format` — number or date formatting
- `scale` — linear rescaling between ranges
- `clamp` — constrain to a min/max range

---

### 1.6 Binding Reference Format

When bindings need to be expressed as a human-readable string (for display, debugging, or future ThingWorx-style wiring UI), use dot-notation:

```
{queryInstanceId}.{outputGroup}.{fieldName}

Examples:
  3.default.value              → instance 3 (Current Value), flat field 'value'
  6.Resultset1.Mean            → instance 6 (Basic Statistics), Resultset1, Mean column
  7.OutputParameter.OutputStatus → instance 7, OutputParameter group, OutputStatus field
  1.default.Amy_Machines.PlantName → instance 1 (entity query), flat field
```

For `outputGroup: 'default'` (flat queries), the group can be omitted:
```
  3.value                      → shorthand for 3.default.value
```

---

## Part 2 — Operations Hub Import Specification

### 2.1 XML Structure Map

The OpHub XML export has this top-level structure:

```
<Package>
  <Apps>                    → App metadata, page list
  <DataSources>             → REST, OPC UA, Historian, Batch, iFIX connections
  <ExternalDBDataSources>   → SQL/JDBC connections (different element, different UUID casing)
  <Entities>                → OpHub-managed internal tables
  <Flows>                   → Query definitions (all types)
  <Pages>                   → Page definitions with components + page-level flow instances
  <AppUsers>                → User list (import as metadata only, no auth)
  <Features>                → Feature flags (import but don't act on)
  <!-- Empty in most exports: -->
  <Alerts/> <AppGroups/> <MainWidgets/> <Roles/>
  <ScriptCategories/> <Scripts/> <ServerVariables/> <Themes/>
</Package>
```

---

### 2.2 Data Source Import Rules

#### Rule DS-1: REST / Historian data sources (`<DataSource>`)

Applies when `dsServerType` is `'REST'`.

| OpHub field | Aetherium field | Notes |
|---|---|---|
| `dsServerName` | `name` | |
| `dsServerType` | `type: 'rest'` | |
| `dsProductType` | `productType` | Preserve as-is |
| `dsUrl` | `config.baseUrl` | |
| `authAuthenticationType` | `config.auth.type` | Map: `OAuth` → `oauth`, `Basic` → `basic` |
| `authUrl` | `config.auth.tokenUrl` | |
| `authClientId` | `config.auth.clientId` | |
| `authGrantType` | `config.auth.grantType` | |
| `ignoreTls` | `config.ignoreTls` | |
| `dataSourceUuid` | `_ophubUuid` | |
| `systemAPIDS` | `isSystemManaged` | |
| Passwords, tokens | **OMIT** | Never import credentials |

#### Rule DS-2: OPC UA data sources (`<DataSource>`)

Applies when `dsServerType` is `'opcua'`.

| OpHub field | Aetherium field | Notes |
|---|---|---|
| `dsServerName` | `name` | |
| `dsServerType` | `type: 'opcua'` | |
| `dsProductType` | `productType` | e.g. "OPC UA", "Proficy iFIX" |
| `dsUrl` | `config.endpoint` | `opc.tcp://...` |
| `dsSecurityMode` | `config.securityMode` | 0=None, 1=Sign |
| `dsSecurityProfileURI` | `config.securityPolicy` | |
| `dsApplicationURI` | `config.applicationUri` | |
| `dsTokenType` | `config.tokenType` | |
| `dsUserName` | `config.username` | |
| `ignoreTls` | `config.ignoreTls` | |
| Password | **OMIT** | |
| Note | No `dataSourceUuid` present | OPC UA sources link via `data_channel` UUID in flows, not `dataSourceUuid`. Track separately — see Rule F-1. |

#### Rule DS-3: Native Historian data sources (`<DataSource>`)

Applies when `dsServerType` is `'historian'` or `'Historian'`.

Same mapping as DS-1 but `type: 'historian'`. These are typically `systemAPIDS: true`. Import as read-only reference.

#### Rule DS-4: Batch data sources (`<DataSource>`)

Applies when `dsProductType` is `'Proficy Batch'`. Map to `type: 'batch'`. Import connectivity config; query support is Phase 3+.

#### Rule DS-5: SQL data sources (`<ExternalDBDataSource>`)

**Important:** Different XML element from `<DataSource>`. UUID field is `datasourceUuid` (lowercase `d` in `datasource`) vs. `dataSourceUuid` in `<DataSource>`. Normalize to the same `_ophubUuid` field.

| OpHub field | Aetherium field | Notes |
|---|---|---|
| `name` | `name` | |
| `serverType` | `type: 'sql'` | |
| `productType` | `productType` | "Relational Database" |
| `connectionUrl` | `config.connectionUrl` | Full JDBC URL — preserve |
| `server` | `config.server` | |
| `port` | `config.port` | |
| `database` | `config.database` | |
| `userName` | `config.username` | |
| `datasourceUuid` (lowercase d) | `_ophubUuid` | Normalize casing |
| Password | **OMIT** | |

#### Rule DS-6: Entity data sources (`<Entity>`)

Each `<Entity>` becomes a DataSource of `type: 'entity'`. The entity's UUID is the critical link — flows reference it via `source.source_id`.

| OpHub field | Aetherium field | Notes |
|---|---|---|
| `tableName` | `name` | |
| (derived) | `type: 'entity'` | |
| `UUID` | `_ophubUuid` | **Critical** — used to link entity queries |
| `columnData` (parsed JSON) | `config.columns` | Array of `{columnId, name, type, mandatory}` |
| `tableId` | (discard) | Internal OpHub ID, not needed |
| `isM2M`, `is_pivot_table` | (discard) | OpHub internal flags |

---

### 2.3 Flow Import Rules

#### Pre-step: Resolve flow type

Before applying any rule, determine the Aetherium query type:

```javascript
function resolveQueryType(flow) {
  const qd = JSON.parse(flow.details).query_detail;
  if (flow.flowType === 'Relational Database') return 'sql_sproc';
  if (flow.flowType === 'REST')               return 'rest_get';
  if (flow.flowType === 'query') {
    if (qd.ext_query)                         return qd.ext_query.requestType === 'write'
                                                       ? 'opcua_write' : 'opcua_read';
    if (qd.dataSource?.dataSourceUuid)        return 'rest_get';
    if (qd.source?.source_id)                 return 'entity_read';
  }
  return 'unknown'; // log and skip
}
```

#### Rule F-0: System/default flows (`flowSetting: 'default_flow'`)

Flows with `flowSetting: 'default_flow'` are system-provided (e.g. "Current Value", "OPC UA Write", "Historical By Count"). These are re-created automatically in OpHub environments. Import them as regular queries but set a `isSystemProvided: true` flag. They can be hidden in the Queries UI unless explicitly shown.

#### Rule F-1: OPC UA Read (`type: 'opcua_read'`)

```
detailedInputs.data  → inputs[]
detailedOutputs.data → outputs[] (all outputGroup: 'default', outputType: 'scalar')
data_channel UUID    → match to OPC UA DataSource via data_provider field
  (if ambiguous — multiple OPC UA sources — prompt user to select)
ext_query.samplingMode === 'currentvalue' → resultCardinality: 'scalar'
ext_query.samplingMode !== 'currentvalue' → resultCardinality: 'series'
```

**Input mapping:**
```javascript
detailedInput → {
  name:         input.name,
  type:         input.type,
  optional:     input.optional,
  defaultValue: input.value,
  uiHint:       input.defaultValueType.type,
  paramType:    null,
}
```

**Config extraction:**
```javascript
config: {
  samplingMode:      qd.ext_query.samplingMode,
  qualityThreshold:  qd.ext_query.qualityThreshold,
}
```

#### Rule F-2: OPC UA Write (`type: 'opcua_write'`)

Same as F-1 but:
- `direction: 'write'`
- `resultCardinality: 'none'`
- `outputs: []`

#### Rule F-3: SQL Stored Procedure (`type: 'sql_sproc'`)

```
dataSource link:
  qd.dataSource.dataSourceUuid → look up DataSource where _ophubUuid matches
  (note: ExternalDBDataSource uses lowercase 'd' — normalized at import time)
```

**Input mapping:** Strip metadata keys (`.dateTimeParams`, `.timeParams`) from the flat `inputs` JSON object before processing. Parse the flat `inputs` string into parameter names, then match against `detailedInputs.data` for full type info.

```javascript
// Strip metadata from flat inputs object
const flatInputs = JSON.parse(flow.inputs);
const dateTimeParams = flatInputs['.dateTimeParams'] || [];
const timeParams = flatInputs['.timeParams'] || [];
// Remove metadata keys
delete flatInputs['.dateTimeParams'];
delete flatInputs['.timeParams'];
```

Map `detailedInputs.data` entries:
```javascript
input → {
  name:         input.name,
  type:         input.type,            // may be 'DateTime' for SQL params
  optional:     input.isOptional === 'true' || input.optional,
  defaultValue: input.value,
  uiHint:       'text',                // SQL params always use plain text input
  paramType:    input.paramType,       // 'INPUT_PARAMETER' or 'INPUT_OUTPUT_PARAMETER'
}
```

**Output mapping:** `detailedOutputs.data` entries have `queryResultType`. For each entry:
- `queryResultType: 'Resultset'`: expand columns → `{ name: col.name, type: col.type, outputGroup: entry.name, outputType: 'Resultset' }`
- `queryResultType: 'OutputParameter'`: expand columns → `{ name: col.name, type: col.type, outputGroup: entry.name, outputType: 'OutputParameter' }`
- `INPUT_OUTPUT_PARAMETER` inputs: also add to outputs as OutputParameter entries

**Config:**
```javascript
config: {
  schemaName:            qd.schemaName,
  procName:              qd.query,
  convertDatetimeToLocal: qd.convertSQLDatetimeToLocal ?? false,
  dateTimeParams:        dateTimeParams,
}
```

**Important — multiple resultset handling:** A stored proc with `resultSetCount > 1` in `queryResultMetadata` produces multiple output groups. The Aetherium query stores ALL groups in its `outputs[]`. Page-level instances (Rule QI-2) split them into separate QueryInstances per group.

#### Rule F-4: REST (`type: 'rest_get'`)

Two sources feed this: `flowType: 'REST'` flows AND `flowType: 'query'` flows with `qd.dataSource.dataSourceUuid` present. Both map identically.

```
dataSource link: qd.dataSource.dataSourceUuid → DataSource._ophubUuid
```

**Input mapping:** entries with `paramType: 'query'` are URL query parameters.

**Output mapping:** `detailedOutputs.data` → flat array preserving dot-path names:
```javascript
{ name: 'historian_data.Data.Samples.Value', type: 'String', outputGroup: 'default', outputType: 'scalar' }
```

**Cardinality heuristic:** if any output field name contains more than one dot (suggesting nested array traversal, e.g. `Data.Samples.Value`), treat as `series`; otherwise `scalar`.

**Config:**
```javascript
config: {
  path:    qd.api.url,     // relative path
  verb:    qd.api.verb,
  request: flow.request,   // named API request label
}
```

#### Rule F-5: Entity Read (`type: 'entity_read'`)

```
dataSource link: qd.source.source_id → DataSource._ophubUuid (entity UUID)
```

**Input mapping:** entries have `operator` field — preserve it:
```javascript
{ name: 'machinePlant', type: 'String', optional: true, defaultValue: null,
  uiHint: 'text', paramType: null, operator: '=' }
```

**Output mapping:** `detailedOutputs.data` → preserve dot-path names (`Amy_Machines.PlantName` etc.)

**Config:**
```javascript
config: {
  conditions: qd.conditions.map(c => ({
    fieldName: c.field.column_name,
    paramName: c.comparer.value,
    operator:  c.operator,
  })),
}
```

**Cardinality:** always `resultset`.

---

### 2.4 Query Instance Import Rules

Each entry in `page.flows[]` → one or more QueryInstances.

#### Rule QI-1: Standard query instances

```javascript
const flowMeta = entry.flow_metadata;
const instance = {
  id:      flowMeta.flowInstanceId,
  queryId: lookupQueryByOphubUuid(entry.flow_id),
  alias:   entry.alias,

  inputOverrides: flowMeta.inputs
    .filter(i => i.manualValue !== null && i.manualValue !== undefined && i.manualValue !== '')
    .map(i => ({ fieldName: i.fieldName, value: i.manualValue })),

  resultSet:            flowMeta.resultSet ?? null,
  isSecondaryResultset: flowMeta.isSecondaryResultset ?? false,

  submitOnLoad: flowMeta.submitOnLoad,
  pollInterval: flowMeta.autoUpdate?.enabled
    ? flowMeta.autoUpdate.interval * unitToMs(flowMeta.autoUpdate.unit)
    : null,
  pushEnabled:  flowMeta.dataPushEnabled ?? false,
};
```

`unitToMs`: `{ 's': 1000, 'm': 60000, 'h': 3600000 }`.

#### Rule QI-2: SQL multi-resultset instances

When a stored proc has `resultSetCount > 1`, OpHub creates one flow instance per resultset. These instances share the same `flow_id` but have different `resultSet` values. Import each as a separate QueryInstance. They are siblings that can be distinguished by `isSecondaryResultset`.

The Aetherium Query's `outputs[]` contains all resultsets. The QueryInstance's `resultSet` field declares which subset of outputs this instance exposes to bindings. The binding editor should filter available output fields based on the instance's `resultSet`.

---

### 2.5 Component / Widget Binding Import Rules

Components live in `page.components[N].layout.sections[M].components[]`. Each component has a `typeName` and a `schema.data` object containing its bindable properties.

#### Rule CB-1: Widget type mapping

| OpHub `typeName` | Aetherium `widgetName` | Notes |
|---|---|---|
| `list` | `List` | OpHub custom plugin |
| `DataGrid` | `DataGrid` | OpHub custom plugin |
| `container` | (container, not widget) | |
| Others | Preserve as `typeName` | Log unmapped types; import without bindings |

**Note:** This mapping table is incomplete and will grow as more OpHub exports are analyzed. Unknown types should import as containers with no bindings, preserving layout and style.

#### Rule CB-2: Binding property name mapping

Each OpHub widget has its own named input property in `schema.data`. These must be mapped to Aetherium widget property names:

| Widget | OpHub property | Aetherium property | Binding shape |
|---|---|---|---|
| `list` | `schema.data.inputValue.query` | `dataSource` | collection |
| `DataGrid` | `schema.data.input.query` | `dataSource` | collection |
| Others | TBD | TBD | TBD |

**For unknown property mappings:** import the binding using the OpHub property name as-is and flag it in the import result for manual review.

#### Rule CB-3: Binding reference construction

For each `schema.data.[propName]` where `type === 'query'`:

```javascript
const ophubQuery = propValue.query;
if (!ophubQuery.query_id || !ophubQuery.flowInstanceId) return; // unbound

const aequerym = lookupQueryByOphubUuid(ophubQuery.query_id);
const targetProp = mapOphubPropertyToAetherium(component.typeName, propName); // Rule CB-2

const hasMultipleFields = ophubQuery.outputFields.length > 1;

container.bindings[targetProp] = {
  type:            'query',
  queryInstanceId: ophubQuery.flowInstanceId,
  queryId:         aeQueryId,
  // Scalar: single field
  ...(hasMultipleFields ? {} : { outputField: ophubQuery.outputFields[0].fieldName }),
  // Collection: all fields
  ...(hasMultipleFields ? { outputFields: ophubQuery.outputFields.map(f => ({
    fieldName: f.fieldName, fieldType: f.fieldType
  }))} : {}),
};
```

#### Rule CB-4: `outputValue` / event wiring (Phase 3+)

OpHub components also have an `outputValue` property in `schema.data` — this is the value the widget emits when the user interacts with it (e.g. selecting a list item). In this file it is `null`/unwired. When wired, it feeds another widget's input.

**This is widget-to-widget data flow and is out of scope for Phase 2a.** During import, preserve the `outputValue` config in `container._ophubOutputValue` for Phase 3. Do not attempt to resolve it.

#### Rule CB-5: `multiActions.commands` / event triggers (Phase 3+)

Each component has a `multiActions.commands[]` array describing what happens when widget events fire (e.g. `selectedChanged` on a DataGrid triggers a write query). This is out of scope for Phase 2a. Preserve as `container._ophubCommands`.

---

### 2.6 Layout and Style Import Rules

#### Rule LS-1: Container structure

OpHub pages have a root Container with `layout.sections[]`. Each section has `components[]`. The nesting is flat (one level of sections, each containing widgets). Map to Aetherium's flex layout:

```
OpHub root container      → Aetherium ROOT_CONTAINER_ID equivalent (page root)
OpHub section             → Aetherium flex container (row or column depending on grid config)
  section.grid.columns    → layoutType: 'flex', flexDirection: 'row' if columns > 1
  section.grid.rows       → (rows > 1 = vertical stacking)
OpHub component (widget)  → Aetherium widget container
```

#### Rule LS-2: Responsive styles

Each component has `responsiveStyle.desktop.css`, `responsiveStyle.tablet.css`, `responsiveStyle.mobile.css`. Map to Aetherium breakpoints:

| OpHub breakpoint | Aetherium tierId |
|---|---|
| `desktop` | `'desktop'` (BASE_TIER_ID) |
| `tablet` | `'tablet'` |
| `mobile` | `'mobile'` |

Map OpHub CSS properties to Aetherium slot properties:

```javascript
const cssToSlot = {
  marginTop:     'marginTop',
  marginBottom:  'marginBottom',
  marginLeft:    'marginLeft',
  marginRight:   'marginRight',
  paddingTop:    'paddingTop',
  paddingBottom: 'paddingBottom',
  paddingLeft:   'paddingLeft',
  paddingRight:  'paddingRight',
  display:       (v) => v === 'none' ? null : undefined,  // visible flag
};
```

`isVisible: false` on a breakpoint → set `breakpointOverrides[tierId].slot.display = 'none'`.

---

### 2.7 Import Normalization Notes

**UUID casing inconsistency:** `<DataSource>` uses `dataSourceUuid` (camelCase S); `<ExternalDBDataSource>` uses `datasourceUuid` (lowercase d). Both should be stored in `_ophubUuid` after normalization. An import lookup function should normalize before comparing.

**`flowSetting: 'default_flow'`:** These are system-provided flows created in every OpHub environment. The importer should recognize common default flow UUIDs (like `6ad09778-cae4-11ea-87d0-0242ac130003` for "Current Value") and either skip them (relying on Aetherium's own system queries) or import them with `isSystemProvided: true`.

**`subType` unreliable for OPC UA write direction:** `subType: 'read'` appears on OPC UA write flows (a known OpHub export bug). Always determine direction from `ext_query.requestType`, not `subType`.

**`.dateTimeParams` and `.timeParams` metadata keys:** These dot-prefixed keys in SQL flow `inputs` JSON are metadata, not actual parameters. Strip them before processing parameter lists.

**Auth credentials:** Never import `authAccessToken`, `password`, `dsCert`, `dsCertName`, or `certificate` fields. Log their presence so the user knows they'll need to re-enter credentials after import.

---

## Part 3 — Phase 2a Build Plan

### What gets built in Phase 2a

Phase 2a delivers the complete data layer infrastructure — no live data yet, but the full authoring and import experience.

**Step 1 — App state additions:**
Add `dataSources`, `queries`, `queryInstances` to App.js state. Add save/load serialization. No UI yet.

**Step 2 — Data workspace UI:**
New top-level mode in the Aetherium toolbar (alongside Screens/Widgets). Two panels:

*Data Sources panel* — list of configured data sources. Create/edit/delete. Form fields per type (REST, OPC UA, SQL, Entity). System-managed sources shown as read-only.

*Queries panel* — list of queries grouped by data source. Create/edit/delete. Input/output definitions. Mock value overrides for design-time preview.

**Step 3 — Binding editor — Phase 2 extension:**
Extend the existing binding popover (from Phase 1) to add a second binding type alongside "Expression": "Query." When "Query" is selected, the user picks a query instance (from the page's configured instances), then selects which output field(s) to bind to.

**Step 4 — Query instance management on pages:**
A "Queries" section in the Page properties (or as a separate panel). Lists which queries are active on this page, with their input override values and execution settings.

**Step 5 — OpHub import:**
File upload for `.xml` or extracted XML. Runs the import rules defined in Part 2. Produces a preview of what will be imported (data sources, queries, pages). User confirms, then the imported data merges into Aetherium's state.

**Step 6 — Design-time binding preview:**
For query-type bindings, show the query name and output field (rather than the resolved value, since there's no live data yet). Optional: allow mock values per output field in the Query definition, so the canvas preview shows something meaningful.

### What is explicitly out of Phase 2a

- Live data resolution (actual HTTP calls, OPC UA connections) → Phase 2b
- Widget-to-widget wiring / event bindings → Phase 3
- ThingWorx import → Phase 3
- Component/template system → Phase 3

---

## Appendix A — OpHub XML Examples Seen

File analyzed: `AmyDefinitionApp_IQPAppPackage.xml`  
Fetched from: `https://raw.githubusercontent.com/quietlyCurious/aetherium/...`

**Data sources present:** Site 1 (Proficy Historian REST), Local_IGS (OPC UA), Batch_Datasource (Proficy Batch), Hist (Historian native, system-managed), iFIX (Proficy iFIX via OPC UA), Site 1 (Historian, system-managed).

**External DB:** PA_SQL (SQL Server, SOADB).

**Entities:** Amy_Machines (4 columns), Amy_Types (1 column).

**Flows:** Current Value (OPC UA read/current), OPC UA Write (OPC UA write), Historical By Count (OPC UA read/historical), Basic Statistics (SQL sproc, 1 resultset), spLocal_OEE_Rpt_GetKPILineAvailability (SQL sproc, 2 resultsets), HIST_GetTags (REST), HIST_HistoricalByCount (REST), Amy_GetMachinesByPlantAndType (Entity read, filtered), Amy_GetAllTypes (Entity read, unfiltered).

**Page components with bindings:** List (bound to Amy_GetAllTypes via `schema.data.inputValue`), DataGrid (bound to Amy_GetMachinesByPlantAndType via `schema.data.input`).

**Not yet seen:** Widget-to-widget wiring (outputValue wired to another component's inputValue), dynamic input overrides (query input driven by widget output), scalar widget bindings (gauge value, label text), conditional visibility with actual conditions.

---

## Appendix B — ThingWorx Compatibility Notes

The data model is designed to accommodate ThingWorx import in Phase 3. Key structural analogies:

| Aetherium | Operations Hub | ThingWorx |
|---|---|---|
| DataSource | DataSource + ExternalDBDataSource | Thing (connectivity aspect) |
| Query | Flow | Service |
| QueryInstance | page.flows[] entry | Mashup data service reference |
| `binding.queryInstanceId` | `flowInstanceId` | Service node in wiring diagram |
| `binding.outputField` | `outputFields[].fieldName` | Service output property binding |

ThingWorx mashups export as `.twx` ZIP files containing JSON entity definitions. The importer will parse the JSON, extract Things and Services, and apply equivalent import rules. The main structural difference: ThingWorx Things combine connectivity config (like a DataSource) and service definitions (like Queries) into a single entity, so the import step must split them into Aetherium's two-layer model.

---

*End of specification.*
