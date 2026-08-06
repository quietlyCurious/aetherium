// dataModel.js
// Data layer model constants and defaults for Aetherium's Phase 2 binding system.
//
// Scope model:
//   DataSource, Query, Script definitions  →  system-scoped (available to all apps)
//   QueryInstance, ScriptInstance          →  page-scoped by default; can be promoted to app-scoped
//
// UI architecture:
//   Data Sources / Queries / Scripts workspaces  →  pure definition CRUD, no page context.
//   Instances of queries, scripts, AND widgets    →  always live with a page — surfaced in a
//   "Page Data" panel (queries/scripts) or the page's visual tree (widgets), never inside the
//   system-scoped definition workspaces. A query definition is reusable; an instance is "this
//   query, on this page, with these input values."
//
// Phase 2a covers: DataSource + Query definitions, QueryInstance (page-scoped).
// Phase 2b adds:  REST live resolver, poll interval execution.
// Phase 3  adds:  Scripts, app-scoped promotion, widget-to-widget event wiring.
//
// Future note: exporting a full app (a collection of pages) may want to de-duplicate identical
// plugin/widget instances that repeat across many pages for performance — deferred until the
// export pipeline is designed.

// ─────────────────────────────────────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────────────────────────────────────

export function generateDataId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Generate the next page-scoped integer instance ID (1-based, sequential per page)
export function nextInstanceId(existingInstances = []) {
  if (existingInstances.length === 0) return 1;
  return Math.max(...existingInstances.map(i => i.id ?? 0)) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Source
// ─────────────────────────────────────────────────────────────────────────────

// 'type' is the CONNECTIVITY CATEGORY only — it drives which field set renders.
// Product identity (iFIX vs CIMPLICITY vs generic OPC UA) lives in DataSource.productKey,
// not here. Multiple products can share the same connectivity type.
export const DATA_SOURCE_TYPES = {
  REST:               'rest',                // HTTP REST endpoint
  OPCUA:              'opcua',                // OPC UA (generic, iFIX, CIMPLICITY)
  SQL:                'sql',                  // Relational database (JDBC/SQL Server/etc.)
  HISTORIAN:          'historian',            // Proficy Historian (REST-based)
  ENTITY:             'entity',               // OpHub-managed internal table
  GRAPHQL:            'graphql',              // GraphQL endpoint
  PLANT_APPLICATIONS: 'plant_applications',   // Multi-connection: REST + SQL + GraphQL, each toggleable
};

// Extension products — support auto-sync (WebSocket push from back end).
// This is a PRODUCT-level distinction, not a connectivity-type one: e.g. Proficy iFIX and
// the generic REST API connector can both have type:'rest'/'opcua', but only some products
// actually support push. Keyed by DataSource.productKey.
export const EXTENSION_PRODUCT_KEYS = new Set([
  'proficy_historian',
  'proficy_ifix',
  'proficy_cimplicity',
  'opcua',
]);

export const DATA_SOURCE_TYPE_LABELS = {
  rest:               'REST',
  opcua:              'OPC UA',
  sql:                'SQL / Relational Database',
  historian:          'Proficy Historian',
  entity:             'Entity (Internal Table)',
  graphql:            'GraphQL',
  plant_applications: 'Plant Applications (Multi-Connection)',
};

export const AUTH_TYPES = {
  NONE:   'none',
  BEARER: 'bearer',
  BASIC:  'basic',
  OAUTH:  'oauth',
};

export const DEFAULT_DATA_SOURCE = {
  id:              null,
  name:            '',
  type:            DATA_SOURCE_TYPES.REST,
  productType:     '',         // Original product label (e.g. "Proficy Historian")
  productKey:      null,       // Product catalog key (e.g. 'proficy_historian', 'opcua')
  isSystemManaged: false,      // true = auto-created by system; read-only in UI
  description:     '',

  config: {
    // ── REST / Historian / GraphQL / Plant Applications sub-connections ───────
    baseUrl:  '',
    auth: {
      type:         AUTH_TYPES.NONE,
      // Bearer
      bearerToken:  '',
      // Basic
      username:     '',
      password:     '',
      // OAuth (both grant types)
      tokenUrl:     '',
      clientId:     '',
      clientSecret: '',
      grantType:    'client_credentials', // 'client_credentials' | 'password'
      // Passwords/tokens/secrets are never PERSISTED to disk on export —
      // stored in-memory during the authoring session only. See note in App save/load.
    },
    ignoreTls:           false,
    certificateRequired: false,

    // ── OPC UA (generic, iFIX, CIMPLICITY) ─────────────────────────────────────
    opcuaEnabled:    true,   // toggle shown for multi-connection products
    endpoint:        '',     // e.g. 'opc.tcp://host:49310'
    securityMode:    0,      // 0=None, 1=Sign, 2=SignAndEncrypt
    securityPolicy:  '',     // URI string
    applicationUri:  '',
    readAuthType:    'anonymous',        // 'anonymous' | 'usernamePassword'
    readUsername:    '',
    readPassword:    '',
    writeAuthType:   'readCredentials',  // 'readCredentials' | 'loggedOnUser' | 'usernamePassword'

    // ── SQL ─────────────────────────────────────────────────────────────────
    dbType:         'sqlserver',  // 'sqlserver' | 'postgres' | 'jdbc' (latter two disabled in UI)
    connectionUrl:  '',           // Full JDBC URL (preserved for reference / import)
    server:         '',
    port:           1433,
    database:       '',

    // ── Entity (OpHub internal table) ────────────────────────────────────────
    columns: [],          // [{ columnId, name, type, mandatory }]

    // ── Plant Applications (multi-connection) ──────────────────────────────────
    // Each sub-connection gets its own namespaced config object so fields don't collide.
    restEnabled:    true,
    sqlEnabled:     true,
    graphqlEnabled: true,
    rest:    {},   // shape matches the REST fields above
    sql:     {},   // shape matches the SQL fields above
    graphql: {},   // shape matches the REST fields above (GraphQL reuses REST shape)
  },

  // Import traceability — null for user-created sources
  _ophubUuid: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

export const QUERY_TYPES = {
  OPCUA_READ:  'opcua_read',   // OPC UA read (current value or historical)
  OPCUA_WRITE: 'opcua_write',  // OPC UA write
  SQL_SPROC:   'sql_sproc',    // SQL stored procedure
  REST_GET:    'rest_get',     // REST GET
  REST_POST:   'rest_post',    // REST POST
  REST_PUT:    'rest_put',     // REST PUT
  REST_DELETE: 'rest_delete',  // REST DELETE
  ENTITY_READ: 'entity_read',  // OpHub entity table read (get/filter)
  ENTITY_WRITE:'entity_write', // OpHub entity table insert/update/delete
  SCRIPT:      'script',       // Python script (Phase 3+)
};

export const QUERY_DIRECTIONS = {
  READ:      'read',
  WRITE:     'write',
  READWRITE: 'readwrite',  // e.g. SQL procs with OUTPUT params
};

export const RESULT_CARDINALITIES = {
  SCALAR:    'scalar',     // Single value  → gauge, label, indicator
  SERIES:    'series',     // Time-series   → trend chart, sparkline
  RESULTSET: 'resultset',  // Tabular rows  → grid, list
  NONE:      'none',       // Write-only, no return value
};

export const QUERY_TYPE_LABELS = {
  opcua_read:   'OPC UA Read',
  opcua_write:  'OPC UA Write',
  sql_sproc:    'SQL Stored Procedure',
  rest_get:     'REST GET',
  rest_post:    'REST POST',
  rest_put:     'REST PUT',
  rest_delete:  'REST DELETE',
  entity_read:  'Entity Read',
  entity_write: 'Entity Write',
  script:       'Script (Python)',
};

export const UI_HINTS = {
  TEXT:       'text',
  NUMBER:     'number',
  DATETIME:   'datetime',
  COMBOBOX:   'combobox',
  TAGBROWSER: 'tagbrowser',
  INPUTFIELD: 'inputField',
};

export const PARAM_TYPES = {
  INPUT:            'INPUT_PARAMETER',
  INPUT_OUTPUT:     'INPUT_OUTPUT_PARAMETER', // SQL OUTPUT params (also returned as output)
  QUERY:            'query',                  // REST URL query parameter
};

// Default shapes for inputs and outputs
export const DEFAULT_QUERY_INPUT = {
  name:         '',
  type:         'String',   // 'String'|'Number'|'DateTime'|'Boolean'|'Real'
  optional:     true,
  defaultValue: null,
  uiHint:       UI_HINTS.TEXT,
  paramType:    null,
  operator:     null,       // for entity conditions: '=', '>', '<', etc.
  entityField:  null,       // for entity conditions: the actual entity column this input filters
};

export const DEFAULT_QUERY_OUTPUT = {
  name:        '',          // field name / dot-path (e.g. 'Data.Samples.Value')
  type:        'String',
  outputGroup: 'default',   // 'default' for flat; 'Resultset1' etc. for SQL
  outputType:  'scalar',    // 'scalar'|'Resultset'|'OutputParameter'
};

export const DEFAULT_QUERY = {
  id:                null,
  name:              '',
  dataSourceId:      null,
  // Aetherium-specific — NOT an OpHub concept. If set, a failed read against the primary
  // data source falls back to this one (same query config replayed against the backup
  // connection). Most useful for redundant Historian/OPC UA pairs. Left null = no failover.
  secondaryDataSourceId: null,
  type:              QUERY_TYPES.REST_GET,
  direction:         QUERY_DIRECTIONS.READ,
  // Informational only — the Query editor always displays the LIVE value from
  // inferResultCardinality(query), never lets the user pick this directly. This
  // stored field exists for import (OpHub sets it explicitly) and for any future
  // code that wants a cheap cached read without recomputing.
  resultCardinality: RESULT_CARDINALITIES.SCALAR,
  inputs:            [],    // [DEFAULT_QUERY_INPUT, ...]
  outputs:           [],    // [DEFAULT_QUERY_OUTPUT, ...]
  description:       '',

  config: {
    // ── OPC UA ──────────────────────────────────────────────────────────────
    samplingMode:      'currentvalue',  // 'currentvalue'|'interpolated'|'cyclic'|'raw'
    qualityThreshold:  'Uncertain',

    // ── REST ────────────────────────────────────────────────────────────────
    path:     '',    // Relative URL path; base URL comes from DataSource
    verb:     'get',
    request:  '',    // Named API request label

    // ── SQL ─────────────────────────────────────────────────────────────────
    schemaName:            'dbo',
    procName:              '',
    convertDatetimeToLocal: false,
    dateTimeParams:        [],  // input field names to format as datetime for SQL

    // ── Entity ──────────────────────────────────────────────────────────────
    conditions: [],  // [{ fieldName, paramName, operator }]
  },

  // Execution defaults (can be overridden per instance)
  pollInterval: null,   // ms; null = on-demand or push only
  pushEnabled:  false,  // whether this query supports WebSocket push

  // Import traceability
  _ophubFlowId:   null,
  _ophubFlowUuid: null,
  _ophubFlowType: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Script (Phase 3+)
// Python script with typed inputs/outputs, defined at system level.
// Included here as a placeholder so the state shape is correct from the start.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SCRIPT = {
  id:          null,
  name:        '',
  description: '',
  inputs:      [],   // same shape as query inputs
  outputs:     [],   // same shape as query outputs
  language:    'python',
  body:        '',   // script source (Phase 3)
};

// ─────────────────────────────────────────────────────────────────────────────
// Query Instance
// A query (or script) added to a specific page, with per-instance configuration.
// ─────────────────────────────────────────────────────────────────────────────

export const EXECUTION_TRIGGERS = {
  ON_PAGE_LOAD:         'onPageLoad',         // Runs automatically when the page loads
  ALL_INPUTS_SATISFIED: 'allInputsSatisfied', // Runs when every required input has a value
  ANY_INPUT_CHANGE:     'anyInputChange',      // Re-runs whenever any input value changes
  USER_ACTION:          'userAction',          // Only runs on explicit user action (button click etc.)
};

export const EXECUTION_TRIGGER_LABELS = {
  onPageLoad:         'On page load',
  allInputsSatisfied: 'When all inputs are satisfied',
  anyInputChange:     'When any input changes',
  userAction:         'On user action',
};

// Instance scope — page-scoped by default; promoted instances share results across pages
export const INSTANCE_SCOPES = {
  PAGE: 'page',
  APP:  'app',
};

export const DEFAULT_QUERY_INSTANCE = {
  id:                  null,    // Page-scoped integer (1-based) OR UUID if app-scoped
  queryId:             null,    // Reference to Query.id
  scriptId:            null,    // Reference to Script.id (Phase 3; mutually exclusive with queryId)
  alias:               '',      // User-facing label, e.g. 'Current Value for F1'
  scope:               INSTANCE_SCOPES.PAGE,
  pageId:              null,    // Which page owns this instance when scope is PAGE; null when scope is APP (shared across all pages) — matches OpHub's own page.flows[] vs. globals[] split

  // Per-instance input value overrides
  // Any input not listed here uses the Query's defaultValue
  inputOverrides: [],           // [{ fieldName: string, value: any }]

  // SQL multi-resultset: which resultset this instance exposes
  // Per-input bindings — same shape/expression-evaluation as container.bindings,
  // just keyed by input field name instead of widget prop name. Takes priority
  // over inputOverrides (a binding is a live expression; an override is a
  // static value) when both exist for the same field.
  bindings: {},                 // { [fieldName]: { type: 'expression', expression: string } }

  resultSet:            null,   // e.g. 'Resultset1', 'OutputParameter', null for non-SQL
  isSecondaryResultset: false,

  // Execution configuration
  trigger:     EXECUTION_TRIGGERS.ON_PAGE_LOAD,
  autoSync:    false,     // WebSocket push; only valid for extension query types
  pollInterval: null,     // ms; overrides Query.pollInterval; null = use query default

  // OpHub import traceability
  _ophubFlowInstanceId: null,   // Original integer flowInstanceId from page.flows[]
};

// ─────────────────────────────────────────────────────────────────────────────
// Binding
// Extends Phase 1's expression binding type with the Phase 2 query binding type.
// Stored in container.bindings[propName].
// ─────────────────────────────────────────────────────────────────────────────

export const BINDING_TYPES = {
  EXPRESSION: 'expression',  // Phase 1: client-side JS expression
  QUERY:      'query',       // Phase 2: live/resolved query output field
};

// Scalar query binding (single output field → single widget property)
export const DEFAULT_SCALAR_BINDING = {
  type:            BINDING_TYPES.QUERY,
  queryInstanceId: null,    // page-scoped integer
  queryId:         null,    // redundant reference for validation
  outputField:     '',      // single output field name (dot-path ok)
  transform:       [],      // optional transform pipeline (Phase 2a+)
};

// Collection query binding (multiple output fields → collection widget property)
export const DEFAULT_COLLECTION_BINDING = {
  type:            BINDING_TYPES.QUERY,
  queryInstanceId: null,
  queryId:         null,
  outputFields:    [],      // [{ fieldName, fieldType }] — all fields the widget consumes
  transform:       [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Transform pipeline
// Optional post-processing applied to a binding value before it reaches the widget.
// ─────────────────────────────────────────────────────────────────────────────

export const TRANSFORM_TYPES = {
  EXPRESSION: 'expression',  // JS expression with 'value' in scope: value * 100
  MAP:        'map',         // Key→value substitution: { 0: 'Stopped', 1: 'Running' }
  FORMAT:     'format',      // Number/date formatting: '{value:.2f}'
  SCALE:      'scale',       // Linear rescale: from [0,1] to [0,100]
  CLAMP:      'clamp',       // Constrain to range: [min, max]
  // Collapses a series/resultset down to a single value for widgets that expect
  // a scalar (gauges, labels, indicators) — options: 'first'|'last'|'min'|'max'|'average'|'count'.
  // This is the "adapter" extension point: a query is never forced to be scalar-shaped
  // just because some widget wants a single value. The reduce happens at bind-time, not
  // query-definition-time. Not yet implemented in the binding editor UI — reserved here
  // so the Query workspace doesn't need its own cardinality-narrowing logic.
  REDUCE:     'reduce',
};

// ─────────────────────────────────────────────────────────────────────────────
// Query/Script input & output editor catalogs
// Shared dropdown option lists used by ParamListEditor instances across the
// Queries (and later Scripts) workspaces.
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_TYPE_OPTIONS = [
  { value: 'String',   label: 'String'   },
  { value: 'Number',   label: 'Number'   },
  { value: 'Real',     label: 'Real'     },
  { value: 'Boolean',  label: 'Boolean'  },
  { value: 'DateTime', label: 'DateTime' },
];

export const UI_HINT_OPTIONS = [
  { value: UI_HINTS.TEXT,       label: 'Text'        },
  { value: UI_HINTS.NUMBER,     label: 'Number'      },
  { value: UI_HINTS.DATETIME,   label: 'Date/Time'   },
  { value: UI_HINTS.COMBOBOX,   label: 'Combo Box'   },
  { value: UI_HINTS.TAGBROWSER, label: 'Tag Browser' },
  { value: UI_HINTS.INPUTFIELD, label: 'Input Field' },
];

export const PARAM_TYPE_OPTIONS = [
  { value: null,                     label: '—'                       },
  { value: PARAM_TYPES.INPUT,        label: 'Input'                   },
  { value: PARAM_TYPES.INPUT_OUTPUT, label: 'Input + Output (SQL OUT)' },
];

export const ENTITY_OPERATOR_OPTIONS = [
  { value: '=',    label: '='                },
  { value: '!=',   label: '≠'                },
  { value: '>',    label: '>'                },
  { value: '<',    label: '<'                },
  { value: '>=',   label: '≥'                },
  { value: '<=',   label: '≤'                },
  { value: 'like', label: 'contains (like)'  },
];

export const REST_VERB_OPTIONS = [
  { value: 'get',    label: 'GET'    },
  { value: 'post',   label: 'POST'   },
  { value: 'put',    label: 'PUT'    },
  { value: 'delete', label: 'DELETE' },
];

export const OPCUA_SAMPLING_MODE_OPTIONS = [
  { value: 'currentvalue', label: 'Current Value'           },
  { value: 'interpolated', label: 'Interpolated (historical)' },
  { value: 'raw',          label: 'Raw (historical)'         },
  { value: 'cyclic',       label: 'Cyclic (historical)'      },
];

export const OPCUA_QUALITY_THRESHOLD_OPTIONS = ['Good', 'Uncertain', 'Bad'];

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers — always return a fresh object, never a shared reference.
// ─────────────────────────────────────────────────────────────────────────────

export function makeBlankInput(overrides = {}) {
  return { ...DEFAULT_QUERY_INPUT, ...overrides };
}

export function makeBlankOutput(overrides = {}) {
  return { ...DEFAULT_QUERY_OUTPUT, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard OPC UA input/output templates
// One-click "insert standard shape" helpers. These exact field names/types/
// uiHints are the contract Aetherium's OPC UA resolver (and OpHub import) expect
// — quick-inserting them avoids the user hand-typing something that must match
// exactly to work at runtime.
// ─────────────────────────────────────────────────────────────────────────────

export const OPCUA_CURRENT_VALUE_INPUT_TEMPLATE = [
  { name: 'tag',              type: 'String', optional: false, defaultValue: '',           uiHint: UI_HINTS.TAGBROWSER, paramType: null },
  { name: 'tagDisplayFormat', type: 'String', optional: false, defaultValue: 'short',       uiHint: UI_HINTS.COMBOBOX,   paramType: null },
];

export const OPCUA_HISTORICAL_INPUT_TEMPLATE = [
  ...OPCUA_CURRENT_VALUE_INPUT_TEMPLATE,
  { name: 'samplingMode', type: 'String',   optional: false, defaultValue: 'interpolated', uiHint: UI_HINTS.COMBOBOX, paramType: null },
  { name: 'startTime',    type: 'DateTime', optional: false, defaultValue: '',              uiHint: UI_HINTS.DATETIME, paramType: null },
  { name: 'endTime',      type: 'DateTime', optional: false, defaultValue: '',              uiHint: UI_HINTS.DATETIME, paramType: null },
  { name: 'durationSecs', type: 'Number',   optional: false, defaultValue: '3600',          uiHint: UI_HINTS.NUMBER,   paramType: null },
  { name: 'sampleSize',   type: 'Number',   optional: false, defaultValue: '1000',          uiHint: UI_HINTS.NUMBER,   paramType: null },
];

export const OPCUA_WRITE_INPUT_TEMPLATE = [
  { name: 'tag',   type: 'String', optional: false, defaultValue: '', uiHint: UI_HINTS.TAGBROWSER, paramType: null },
  { name: 'value', type: 'String', optional: false, defaultValue: '', uiHint: UI_HINTS.TEXT,       paramType: null },
];

export const OPCUA_READ_OUTPUT_TEMPLATE = [
  { name: 'timestamp', type: 'String', outputGroup: 'default', outputType: 'scalar' },
  { name: 'name',      type: 'String', outputGroup: 'default', outputType: 'scalar' },
  { name: 'value',     type: 'String', outputGroup: 'default', outputType: 'scalar' },
  { name: 'quality',   type: 'String', outputGroup: 'default', outputType: 'scalar' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Result cardinality inference
// Cardinality is ALWAYS derived from type/direction/config — never hand-picked by
// the user. The Query editor computes this live for display; it is informational,
// not authoritative storage (see DEFAULT_QUERY.resultCardinality comment above).
// ─────────────────────────────────────────────────────────────────────────────

export function inferResultCardinality(query) {
  if (query.direction === QUERY_DIRECTIONS.WRITE) return RESULT_CARDINALITIES.NONE;

  switch (query.type) {
    case QUERY_TYPES.SQL_SPROC:
    case QUERY_TYPES.ENTITY_READ:
      return RESULT_CARDINALITIES.RESULTSET;

    case QUERY_TYPES.ENTITY_WRITE:
    case QUERY_TYPES.OPCUA_WRITE:
    case QUERY_TYPES.REST_DELETE:
      return RESULT_CARDINALITIES.NONE;

    case QUERY_TYPES.OPCUA_READ:
      return (query.config?.samplingMode === 'currentvalue')
        ? RESULT_CARDINALITIES.SCALAR
        : RESULT_CARDINALITIES.SERIES;

    case QUERY_TYPES.REST_GET:
    case QUERY_TYPES.REST_POST:
    case QUERY_TYPES.REST_PUT: {
      // Heuristic from the OpHub import spec: an output field with a nested array
      // path (more than one dot, e.g. 'Data.Samples.Value') implies a series result.
      const looksLikeSeries = (query.outputs || []).some(
        o => (o.name.match(/\./g) || []).length > 1
      );
      return looksLikeSeries ? RESULT_CARDINALITIES.SERIES : RESULT_CARDINALITIES.SCALAR;
    }

    default:
      return RESULT_CARDINALITIES.SCALAR;
  }
}
