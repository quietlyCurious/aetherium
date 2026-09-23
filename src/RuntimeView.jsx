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
//
// A screen about a type (screenAsset.jsx) shows one asset of it:
// ?runtime=<pageId>&asset=<assetId>, or the type's first asset when the
// link doesn't say. The screen's own model is loaded for that.

import React from 'react';
import { loadPage } from './pagesStorage';
import { ScreenView } from './designer/screens/ScreenView';
import { usePageQueryResults } from './designer/screens/usePageQueryResults';
import { pageContextOf } from './designer/screens/screenAsset';
import { ScreenDataProvider, modelForScreen } from './designer/screens/screenRepeat';
import { fillsFrame, pageSizeOf, sizeBox } from './designer/screens/screenSizes';
import { loadPagesAndFolders } from './pagesStorage';
import { loadAssetSets } from './assetSetsStorage';
import { useLoadedModel } from './model/useLoadedModel';
import { assetsOfType } from './model/assetPaths';
import { CURRENT_ASSET_MAP } from './model/modelData';

// The asset to show: the link's, if it's one of the type, else the first.
function runtimeAssetId(context) {
  const ids = assetsOfType(context.typeId).map(a => a.id);
  const asked = new URLSearchParams(window.location.search).get('asset');
  return ids.includes(asked) ? asked : (ids[0] ?? null);
}

// A Page screen keeps its containers as direct children of the scroll
// area, the way it has always rendered; only a framed size (Tile, Card)
// puts a box around them.
function Frame({ box, children }) {
  if (!box) return children;
  return (
    <div style={{ ...box, flexShrink: 0, background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.15)', overflow: 'auto', position: 'relative' }}>
      {children}
    </div>
  );
}

export default function RuntimeView({ pageId }) {
  const page = loadPage(pageId);
  const { queryResults, queries } = usePageQueryResults(pageId);
  const assetSets = React.useMemo(() => loadAssetSets(), []);
  const context = page ? pageContextOf(page.containers) : null;
  // A screen about a type needs its model; so does a plain screen whose
  // repeater draws one model's assets (modelForScreen).
  const modelId = page ? modelForScreen(page.containers, assetSets) : null;
  const model = useLoadedModel(modelId);
  const assetId = context && model.loaded ? runtimeAssetId(context) : null;
  // A Tile or a Card is drawn at the size it was designed at, centred in
  // the tab rather than stretched across it. A Page fills, as before.
  const sizeId = page ? pageSizeOf(page.containers) : 'page';
  const box = page && !fillsFrame(sizeId) ? sizeBox(sizeId) : null;

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
          {assetId && <span style={{ opacity: 0.6, fontWeight: 400 }}> · {CURRENT_ASSET_MAP[assetId]?.name}</span>}
        </span>
      </div>
      <div
        className="aetherium-canvas-scroll canvas-no-gap"
        style={{
          flex: 1, minHeight: 0, overflow: 'auto', position: 'relative',
          ...(box ? { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, background: '#e8e8e8' } : null),
        }}
      >
        {modelId && !model.loaded ? (
          <div style={{ padding: 24, color: '#888', fontSize: 13 }}>
            {model.error ? `Couldn't load the model this screen needs (${model.error}).` : 'Loading…'}
          </div>
        ) : (
          <Frame box={box}>
            <ScreenDataProvider assetSets={assetSets} pages={loadPagesAndFolders().pages} chain={[pageId]}>
              <ScreenView containers={page.containers || []} queryResults={queryResults} queries={queries} assetId={assetId} />
            </ScreenDataProvider>
          </Frame>
        )}
      </div>
    </div>
  );
}
