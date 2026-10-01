// dataMigration.js
// One-time move of browser-saved data from the old Data Sources + Queries
// model to Connections (October 2026). Runs before the first load of
// connections, queries or query instances, and once only: a flag records
// that it ran.
//
//   data sources  → connections: every data source with a Base URL (which
//                   pointed at the OpHub proxy) becomes an OpHub connection,
//                   KEEPING ITS ID, so a query's old dataSourceId is its new
//                   connectionId. Sources with no Base URL never ran anything
//                   and are dropped.
//   queries       → saved copies: only OpHub-synced queries are kept (local
//                   ones were dropped by decision). Each gets connectionId and
//                   sourceKey. Unlinked synced queries go to the only
//                   connection when there's exactly one.
//   instances     → any instance of a dropped query is removed. Widget
//                   bindings to it are left alone and show as broken (⚡!),
//                   the same as any other binding whose target is gone.
//
// The pre-migration queries and instances are copied to *_pre_connections
// keys, and the old data-sources key is left untouched, so checking out the
// pre-data-cleanup tag still finds its data.

const FLAG_KEY = 'aetherium_migrated_to_connections';
const KEYS = {
  dataSources: 'aetherium_data_sources',
  queries: 'aetherium_queries',
  instances: 'aetherium_query_instances',
  connections: 'aetherium_connections',
};

function read(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function migrateToConnections() {
  try {
    if (window.localStorage.getItem(FLAG_KEY)) return;

    const dataSources = read(KEYS.dataSources);
    const oldQueries = read(KEYS.queries);
    const oldInstances = read(KEYS.instances);

    const connections = read(KEYS.connections).length > 0
      ? read(KEYS.connections)
      : dataSources
        .filter(ds => ds.config?.baseUrl)
        .map(ds => ({ id: ds.id, name: ds.name || '', kind: 'ophub', proxyUrl: ds.config.baseUrl, accountId: '', groupId: '' }));
    const onlyConnectionId = connections.length === 1 ? connections[0].id : null;

    const queries = oldQueries
      .filter(q => q._ophubFlowUuid)
      .map(q => {
        const { dataSourceId, secondaryDataSourceId, pollInterval, pushEnabled, _ophubFlowId, _ophubFlowType, ...rest } = q;
        const connectionId = connections.some(c => c.id === dataSourceId) ? dataSourceId : onlyConnectionId;
        return { ...rest, connectionId, sourceKey: `ophub:${q._ophubFlowUuid}` };
      });

    // The account id used to be typed per query; it belongs to the connection.
    connections.forEach(c => {
      if (c.accountId) return;
      const withAccount = queries.find(q => q.connectionId === c.id && q.config?.accountId);
      if (withAccount) c.accountId = String(withAccount.config.accountId);
    });

    const keptIds = new Set(queries.map(q => q.id));
    const instances = oldInstances.filter(qi => keptIds.has(qi.queryId));

    if (oldQueries.length) write(`${KEYS.queries}_pre_connections`, oldQueries);
    if (oldInstances.length) write(`${KEYS.instances}_pre_connections`, oldInstances);
    write(KEYS.connections, connections);
    write(KEYS.queries, queries);
    write(KEYS.instances, instances);
    window.localStorage.setItem(FLAG_KEY, new Date().toISOString());
  } catch {
    // Storage unavailable — leave everything as it was and try next load.
  }
}
