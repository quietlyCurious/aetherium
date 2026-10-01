// connections/ophubWire.js
// How Aetherium talks to Operations Hub through the local proxy: the request
// encoding, the run_query payload, and the response shapes. Everything here
// was confirmed against a live OpHub instance (mes.gedemo.io) from captured
// browser requests, not from docs — the comments record what was learned.
//
// The proxy (localhost:4000, outside this repo) is a pass-through that adds
// OpHub's auth cookie and handles CORS. Its two routes:
//   POST /api/ophub/flows  → OpHub /site/ajax/FlowMgr  (list flows)
//   POST /api/ophub/query  → OpHub /app/ajax/Query     (run a flow)

// Every OpHub /ajax/ endpoint takes ONE form field named "data" whose value
// is the whole JSON payload — not separate top-level fields, which several
// earlier guesses tried and which all failed identically.
export function encodeOphubDataField(payload) {
  const params = new URLSearchParams();
  params.append('data', JSON.stringify(payload));
  return { body: params.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
}

// OpHub is strict about JSON types: "Bad type. [account_id]" came back when
// account_id arrived as the string "2" instead of the number 2.
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// POSTs a payload to one of the proxy's OpHub routes and returns the parsed
// JSON. Throws a readable Error on a network failure, a non-JSON body, a
// non-2xx status, or OpHub's own {status: {success: false}}.
export async function postToOphub(proxyUrl, route, payload) {
  if (!proxyUrl) throw new Error('This connection has no proxy URL (e.g. http://localhost:4000).');
  // The captured request carried an empty-key cache buster ("?=<timestamp>").
  const url = `${proxyUrl.replace(/\/$/, '')}${route}?=${Date.now()}`;
  const { body, contentType } = encodeOphubDataField(payload);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Accept': 'application/json' },
      body,
    });
  } catch (networkErr) {
    throw new Error(`Couldn't reach ${proxyUrl} — is the proxy running? (${networkErr.message})`);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Response wasn't valid JSON (status ${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok || json?.status?.success === false) {
    throw new Error(json?.status?.reason || `Request failed (HTTP ${response.status})`);
  }
  return json;
}

// The run_query payload. inputValues are already resolved (binding >
// override > default — see resolveEffectiveInputValues in queryExecution).
export function buildRunQueryPayload({ connection, query, instance, inputValues = {} }) {
  const inputs = {};
  (query.inputs || []).forEach(def => {
    inputs[def.name] = inputValues[def.name] ?? def.defaultValue ?? '';
  });
  return {
    command: 'run_query',
    inputs,
    limit: 500,
    multiple: false,
    primary: '',
    type: 'query',
    resultSet: '',
    query_id: query._ophubFlowUuid,
    // Saved copies migrated from the old Queries editor may carry their own
    // account id; otherwise the connection's applies.
    account_id: toNumberOrNull(query.config?.accountId ?? connection.accountId),
    flowInstanceId: toNumberOrNull(instance?._ophubFlowInstanceId ?? instance?.id),
    // Runtime-only fields, computed from the browser's clock. NOT negated: a
    // captured request from America/New_York in August sent +240, matching
    // Date.getTimezoneOffset()'s own sign.
    time_zone_offset_minutes: new Date().getTimezoneOffset(),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dataProcessing: 'original',
  };
}

// OpHub's historian shape: {timestamp, name, quality, value}[] — every value
// arrives as a STRING even for numbers, so cast where possible. The live
// /app/ajax/Query response is a BARE array, not {result: [...]} like
// FlowMgr's; both are handled.
export function parseHistorianRows(json) {
  const rows = Array.isArray(json) ? json : (json?.result || []);
  return rows.map(row => {
    const numeric = Number(row.value);
    return { ...row, value: Number.isNaN(numeric) ? row.value : numeric };
  });
}
