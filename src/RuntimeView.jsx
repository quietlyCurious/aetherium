// RuntimeView.jsx
// A dedicated, chrome-free render of a single saved page — opened in its own
// browser tab via the title bar's Launch button, so page content can be
// tested/viewed full-viewport without any of the editor's own UI around it.
//
// Everything that isn't "full viewport, own tab" lives in designer/screens/:
// ScreenView renders the page (through the same ContainerCard the editor
// canvas uses, so it looks pixel-identical), and usePageQueryResults runs
// the page's query instances on a poll so its query bindings get real data.
// This file is just the page lookup and the frame around it.

import React from 'react';
import { loadPage } from './pagesStorage';
import { ScreenView } from './designer/screens/ScreenView';
import { usePageQueryResults } from './designer/screens/usePageQueryResults';

export default function RuntimeView({ pageId }) {
  const page = loadPage(pageId);
  const { queryResults, queries } = usePageQueryResults(pageId);

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

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="app-titlebar" style={{ flexShrink: 0 }}>
        <span className="app-titlebar-title" style={{ cursor: 'default', userSelect: 'none' }}>
          {page.name || 'Aetherium'}
        </span>
      </div>
      <div className="aetherium-canvas-scroll canvas-no-gap" style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        <ScreenView containers={page.containers || []} queryResults={queryResults} queries={queries} />
      </div>
    </div>
  );
}
