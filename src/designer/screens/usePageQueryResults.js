// designer/screens/usePageQueryResults.js
// Runs a saved screen's query instances and keeps their results fresh —
// what a screen needs so its query bindings show real data. Lived inside
// RuntimeView; pulled out so anything that shows a saved screen can run
// its queries the same way.
//
// Runs every instance belonging to the page, plus any app-scoped ones
// (the same scoping the editor's Data / Page Data tabs use), once on mount
// and then on a repeating interval. Returns the results keyed by instance
// id, plus the query definitions, ready to hand to ScreenView.
//
// What it reads is a snapshot taken when the page id changes: if a query
// or connection is edited elsewhere while this stays mounted, it keeps
// polling what it loaded, the same way the page layout itself doesn't
// live-update either.

import { useState, useEffect } from 'react';
import { loadQueryInstances } from '../../queryInstancesStorage';
import { loadQueries } from '../../queriesStorage';
import { loadConnections } from '../../connectionsStorage';
import { runAllQueryInstances } from '../../queryExecution';

// Not yet configurable per-instance via any UI — DEFAULT_QUERY_INSTANCE has
// a reserved pollInterval field for this, but nothing sets it yet. One
// global interval for every instance on the page is the pragmatic starting
// point until that control exists.
export const POLL_INTERVAL_MS = 5000;

export function usePageQueryResults(pageId) {
  const [queryResults, setQueryResults] = useState({});

  const pageInstances = loadQueryInstances().filter(qi => qi.pageId === pageId || qi.scope === 'app');
  const queries = loadQueries();
  const connections = loadConnections();

  useEffect(() => {
    if (pageInstances.length === 0) return;
    let cancelled = false;

    const runAll = async () => {
      const results = await runAllQueryInstances(pageInstances, queries, connections);
      if (!cancelled) setQueryResults(prev => ({ ...prev, ...results }));
    };

    runAll();
    const intervalId = setInterval(runAll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  return { queryResults, queries };
}
