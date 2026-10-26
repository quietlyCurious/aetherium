// customWidgets/embeddedView/useOphubEmbedInfo.js
// Where the proxy serves OpHub pages for a connection, for the widget and its
// details panel. `enabled` false (a ThingWorx view) asks nothing — it's a hook
// so it's always called, whichever source the widget shows.
// → { connection, info, error, loading }

import { useEffect, useState } from 'react';
import { fetchOphubEmbedInfo, ophubConnectionFor } from './ophubEmbed';

export function useOphubEmbedInfo(connectionId, enabled = true) {
  const connection = enabled ? ophubConnectionFor(connectionId) : null;
  const proxyUrl = connection?.proxyUrl || '';
  const [state, setState] = useState({ proxyUrl: null, info: null, error: null });

  useEffect(() => {
    if (!enabled || !connection) return undefined;
    let live = true;
    fetchOphubEmbedInfo(connection)
      .then(info => live && setState({ proxyUrl, info, error: null }))
      .catch(err => live && setState({ proxyUrl, info: null, error: err.message }));
    return () => { live = false; };
    // The connection object is re-read each render; its proxy is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, proxyUrl]);

  if (!enabled) return { connection: null, info: null, error: null, loading: false };
  if (!connection) {
    return { connection: null, info: null, loading: false, error: 'No Operations Hub connection — add one in Connections.' };
  }
  const current = state.proxyUrl === proxyUrl;
  return { connection, info: current ? state.info : null, error: current ? state.error : null, loading: !current };
}
