// dataModel.js
// Data layer model constants and defaults for Aetherium's Phase 2 binding system.
//
// Scope model:
//   Queries         →  defined at their source (Operations Hub, ThingWorx) and
//                      browsed live through a Connection; a page that uses one
//                      keeps a saved copy of its definition (system-scoped).
//   QueryInstance   →  page-scoped by default; can be promoted to app-scoped.
//
// Instances of queries AND widgets always live with a page — surfaced in the
// "Page Data" tab (queries) or the page's visual tree (widgets). A query is
// reusable; an instance is "this query, on this page, with these input values."
//
// Later: app-scoped promotion, widget-to-widget event wiring.
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
  TWX_SERVICE: 'twx_service',  // ThingWorx service on a Thing
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
  twx_service:  'ThingWorx Service',
};

// A saved query copy — the definition of a query a page uses, taken from its
// connection when it was added from the Data tab (see queriesStorage.js):
//
//   { id, connectionId, sourceKey, group,     // sourceKey: 'ophub:<flowUuid>' | 'twx:<Thing>/<Service>'
//     name, description, type, direction,
//     inputs:  [{ name, type, optional, defaultValue, uiHint, paramType }],
//     outputs: [{ name, type, outputGroup, outputType }],
//     config,                                 // only what the result shape needs
//     resultCardinality, fetchedAt,
//     _ophubFlowUuid }                        // OpHub only: which flow to run
//   ThingWorx keeps config: { thing, service, resultBaseType, dataShape }.

// ─────────────────────────────────────────────────────────────────────────────
// Query Instance
// A query added to a specific page, with per-instance configuration.
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
  pollInterval: null,     // ms; null = the global poll interval (usePageQueryResults)

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
  // so a query never needs its own cardinality-narrowing logic.
  REDUCE:     'reduce',
};

// ─────────────────────────────────────────────────────────────────────────────
// Result cardinality inference
// Cardinality is ALWAYS derived from type/direction/config — never hand-picked by
// the user. Connectors compute it when they map a source's query, and the
// saved copy stores the result.
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

    case QUERY_TYPES.TWX_SERVICE:
      // A table comes back as rows; a single value as one row {result}.
      if (query.config?.resultBaseType === 'INFOTABLE') return RESULT_CARDINALITIES.RESULTSET;
      if (query.config?.resultBaseType === 'NOTHING') return RESULT_CARDINALITIES.NONE;
      return RESULT_CARDINALITIES.SCALAR;

    default:
      return RESULT_CARDINALITIES.SCALAR;
  }
}
