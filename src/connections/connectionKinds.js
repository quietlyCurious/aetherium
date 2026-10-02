// connections/connectionKinds.js
// The kinds of connection Aetherium can browse queries from, and the one
// shape every connector shares:
//
//   kind, label, shortLabel, dot   identity, for lists and badges
//   itemNoun                       'queries' | 'services' — "38 queries"
//   defaults                       the kind's own connection fields
//   fields                         how the Connections editor shows them:
//                                  [{ key, label, placeholder, mono }]
//   sourceKey(definition)          stable id of a query at its source, so
//                                  fetching again updates a saved copy
//                                  instead of adding a second one
//   browse(connection)             → [{ sourceKey, group, definition }]
//     …or, for a source listed in two steps (ThingWorx: Things, then a
//     Thing's services), instead of browse:
//   groupNoun                      'Things' — "212 Things"
//   listGroups(connection)         → [{ key, label }]
//   listGroup(connection, key)     → [{ sourceKey, group, definition, minor }]
//                                  (minor: shown behind a "built-in" toggle)
//   run({ connection, query, instance, inputValues }) → rows[]

import { ophubConnector } from './ophubConnector';
import { twxConnector } from './twxConnector';
import { generateDataId } from '../dataModel';

export const CONNECTORS = {
  [ophubConnector.kind]: ophubConnector,
  [twxConnector.kind]: twxConnector,
};

export const CONNECTOR_LIST = Object.values(CONNECTORS);

export function connectorFor(connection) {
  return CONNECTORS[connection?.kind] || null;
}

export function makeConnection(extra = {}) {
  const kind = extra.kind || ophubConnector.kind;
  return {
    id: generateDataId(),
    name: '',
    kind,
    ...CONNECTORS[kind].defaults,
    ...extra,
  };
}

// "OpHub · mes.gedemo.io" style fallback when a connection has no name.
export function connectionLabel(connection) {
  if (connection?.name) return connection.name;
  return `${connectorFor(connection)?.shortLabel || 'Connection'} (unnamed)`;
}
