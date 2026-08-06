// restResolver.js
// Phase 2b: executes a REST Query against its configured DataSource and
// returns the parsed result. Built specifically against a REAL captured
// OpHub request/response (see chat history from today) rather than assumed
// docs — the payload shape below is what actually worked against a live
// mes.gedemo.io instance.
//
// Architecture note: this module knows nothing about proxies specifically —
// it just POSTs to `dataSource.config.baseUrl + query.config.path`. For an
// OpHub-via-proxy setup, that means pointing the DataSource's Base URL at
// your local proxy (e.g. http://localhost:4000) and the Query's Path at
// /api/ophub/query. The proxy itself is a dumb pass-through (see
// ophub-proxy/server.js) — all the OpHub-specific knowledge lives here.

// CONFIRMED correct, via a real "Copy as fetch" export from Chrome DevTools
// on a working request: the entire JSON payload is wrapped as the VALUE of a
// single form field literally named "data" — not spread across multiple
// top-level fields (command=..&inputs=..&query_id=..), which is what several
// earlier guesses assumed and which all failed identically. DATA_FIELD is now
// the default; JSON is kept only as a distant fallback, unlikely to be needed.
export const BODY_ENCODING = {
  DATA_FIELD: 'data-field',
  JSON: 'json',
};

// Builds the exact payload shape OpHub's /app/ajax/Query endpoint expects,
// based on the real request captured today. Field values come from: the
// Query's inputs list (name/defaultValue), the QueryInstance's stored input
// overrides, and any values passed in at call time (highest priority — e.g.
// from a "Test Query" form).
// OpHub is strict about JSON types for these fields — "Bad type. [account_id]"
// showed up when it arrived as the STRING "2" instead of the number 2 (these
// values come from plain text inputs in the UI, so they're strings by
// default unless explicitly cast here).
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function buildOpHubQueryPayload({ query, instance, inputValues = {} }) {
  const inputs = {};
  (query.inputs || []).forEach(inputDef => {
    const overrideEntry = (instance?.inputOverrides || []).find(o => o.fieldName === inputDef.name);
    const value = inputValues[inputDef.name]
      ?? overrideEntry?.value
      ?? inputDef.defaultValue
      ?? '';
    inputs[inputDef.name] = value;
  });

  return {
    command: 'run_query',
    inputs,
    limit: toNumberOrNull(query.config?.limit) ?? 500,
    multiple: false,
    primary: '',
    type: 'query',
    resultSet: '',
    query_id: query.config?.ophubFlowUuid || query._ophubFlowUuid || query.id,
    account_id: toNumberOrNull(query.config?.accountId),
    flowInstanceId: toNumberOrNull(instance?._ophubFlowInstanceId ?? instance?.id ?? query.config?.testFlowInstanceId),
    // Real request had these as runtime-only fields (not present in the flow
    // definition export) — computed fresh from the browser's own clock/locale
    // rather than hardcoded, since a demo running on a different machine/day
    // shouldn't send stale values. NOTE: NOT negated — a real captured request
    // for America/New_York in August (EDT, UTC-4) showed +240, matching
    // JS's own Date.getTimezoneOffset() sign convention directly.
    time_zone_offset_minutes: new Date().getTimezoneOffset(),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dataProcessing: 'original',
  };
}

// The confirmed-correct wire format for ALL of OpHub's /ajax/ endpoints (not
// just query execution) — one form field, named "data", whose value is the
// entire JSON payload. Exported so other OpHub-calling modules (e.g. flow
// discovery) use the exact same, already-proven encoding rather than
// reimplementing it and risking drift.
export function encodeOphubDataField(payload) {
  const params = new URLSearchParams();
  params.append('data', JSON.stringify(payload));
  return { body: params.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
}

function encodeBody(payload, bodyEncoding) {
  if (bodyEncoding === BODY_ENCODING.JSON) {
    return { body: JSON.stringify(payload), contentType: 'application/json' };
  }
  return encodeOphubDataField(payload);
}

// Executes a query. Throws on network failure, non-2xx status, or non-JSON
// response — callers should wrap in try/catch (see QueriesWorkspace's Test
// panel for the reference error-handling pattern).
export async function executeRestQuery({ dataSource, query, instance, inputValues, bodyEncoding = BODY_ENCODING.DATA_FIELD }) {
  if (!dataSource?.config?.baseUrl) {
    throw new Error(
      'This data source has no Base URL configured. For an OpHub-via-proxy setup, ' +
      'point it at your local proxy (e.g. http://localhost:4000).'
    );
  }
  const path = query.config?.path || '/api/ophub/query';
  // The real captured request had a cache-busting query param (an empty key,
  // just "?=<timestamp>") — almost certainly harmless to omit, but cheap
  // to replicate now that we're this close, to remove one more variable.
  const url = `${dataSource.config.baseUrl.replace(/\/$/, '')}${path}?=${Date.now()}`;

  const payload = buildOpHubQueryPayload({ query, instance, inputValues });
  const { body, contentType } = encodeBody(payload, bodyEncoding);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Accept': 'application/json' },
      body,
    });
  } catch (networkErr) {
    throw new Error(
      `Couldn't reach ${url} — is the proxy running? (${networkErr.message})`
    );
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Response wasn't valid JSON (status ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${JSON.stringify(json)}`);
  }

  return json;
}

// Extracts OpHub's flat historian result shape ({timestamp, name, quality,
// value}[]) and casts `value` to a number where possible — the real captured
// response returns every value as a STRING even for numeric measurements, so
// downstream consumers (charts, gauges) shouldn't assume JSON gave them the
// right type.
export function parseOpHubHistorianResponse(json) {
  // The real captured response from /app/ajax/Query was a BARE array at the
  // top level — not wrapped in {result: [...]} the way FlowMgr's response
  // is. Handling both defensively: this was silently returning an empty
  // array for every real response until caught, since json?.result was
  // always undefined for the actual shape OpHub sends back.
  const rows = Array.isArray(json) ? json : (json?.result || []);
  return rows.map(row => {
    const numeric = Number(row.value);
    return { ...row, value: Number.isNaN(numeric) ? row.value : numeric };
  });
}
