// RuntimeView.jsx
// A dedicated, chrome-free render of a single saved page — opened in its own
// browser tab via the title bar's Launch button, so page content can be
// tested/viewed full-viewport without any of the editor's own UI around it.
//
// Reuses ContainerCard directly (rather than writing a second, simpler
// renderer) so this is guaranteed to look pixel-identical to the real canvas
// — every editing-related prop below is just a safe no-op, since nothing in
// a read-only view ever triggers selection, drag, or resize.
//
// This is also where query instances actually RUN: on mount, every instance
// belonging to this page (plus any app-scoped ones) is executed via the same
// resolver/proxy pipeline validated earlier, then re-run on a poll interval.
// Results are threaded down through ContainerCard's queryResults/queries
// props, which resolveWidgetProps() reads to fill in Query-type bindings
// with real data.

import React, { useState, useEffect } from 'react';
import ContainerCard from './ContainerCard';
import { loadPagesAndFolders } from './pagesStorage';
import { loadQueryInstances } from './queryInstancesStorage';
import { loadQueries } from './queriesStorage';
import { loadDataSources } from './dataSourcesStorage';
import { runAllQueryInstances } from './queryExecution';
import { BASE_TIER_ID } from './containerModel';

const NOOP = () => {};

// Not yet configurable per-instance via any UI — DEFAULT_QUERY_INSTANCE has
// a reserved pollInterval field for this, but nothing sets it yet. One
// global interval for every instance on the page is the pragmatic starting
// point until that control exists.
const POLL_INTERVAL_MS = 5000;

export default function RuntimeView({ pageId }) {
  const { pages } = loadPagesAndFolders();
  const page = pages.find(p => p.id === pageId);

  const [queryResults, setQueryResults] = useState({});

  // Query instances belonging to this page, plus any app-scoped ones (shared
  // across all pages) — same scoping the editor's Data/Page Data tabs use.
  const allInstances = loadQueryInstances();
  const pageInstances = allInstances.filter(qi => qi.pageId === pageId || qi.scope === 'app');
  const queries = loadQueries();
  const dataSources = loadDataSources();

  // Runs once on mount, then on a repeating interval. Note this is a
  // snapshot, same as the page's own containers below — if a query or data
  // source is edited elsewhere while this tab stays open, this loop keeps
  // using what was loaded at mount time until the tab is reopened, the same
  // way the page layout itself doesn't live-update either.
  useEffect(() => {
    console.log('[RuntimeView] pageId:', pageId);
    console.log('[RuntimeView] all query instances in storage:', allInstances.length, allInstances);
    console.log('[RuntimeView] instances matched to this page:', pageInstances.length, pageInstances);
    console.log('[RuntimeView] queries in storage:', queries.length);
    console.log('[RuntimeView] data sources in storage:', dataSources.length);

    if (pageInstances.length === 0) {
      console.log('[RuntimeView] No instances matched this page — stopping here. Nothing will execute.');
      return;
    }
    let cancelled = false;

    const runAll = async () => {
      console.log('[RuntimeView] Running', pageInstances.length, 'instance(s)…');
      const results = await runAllQueryInstances(pageInstances, queries, dataSources);
      console.log('[RuntimeView] Results:', results);
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

  if (!page) {
    return (
      <div style={{
        width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'sans-serif', color: '#888', fontSize: 14,
      }}>
        Screen not found. It may have been deleted, or this link is out of date.
      </div>
    );
  }

  const containers = page.containers || [];

  return (
    <div className="aetherium-canvas-scroll" style={{ width: '100vw', height: '100vh', overflow: 'auto', position: 'relative' }}>
      {containers.map(c => (
        <ContainerCard
          key={c.id}
          container={c}
          containers={containers}
          selectedIds={[]}
          onSelect={NOOP}
          onDelete={NOOP}
          onDragStart={NOOP}
          onDragOver={NOOP}
          onDrop={NOOP}
          onWidgetDrop={NOOP}
          onUpdateLayout={NOOP}
          onUpdateSlot={NOOP}
          onUpdateCoord={NOOP}
          onGridCellDrop={NOOP}
          onSetSelectedGridCell={NOOP}
          onMergeCellContainers={NOOP}
          selectedGridCell={null}
          dragState={{}}
          draggingId={null}
          isDragging={false}
          coordMode="reposition"
          activeTierId={BASE_TIER_ID}
          snapEnabled={false}
          queryResults={queryResults}
          queries={queries}
        />
      ))}
    </div>
  );
}
