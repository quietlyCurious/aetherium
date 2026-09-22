// designer/screens/ScreensLeftPanel.jsx
// The Screens editor's left panel, one tab per thing you pick from:
//   Screens       the saved screens and their folders (ScreensPanel)
//   Visuals       widgets to add — drag onto the canvas, or double-click
//   Data          the loaded model's assets, or the queries you can add
//                 to this page
//   Page Visuals  the open page's container tree (PageVisualsTree)
//   Page Data     the query instances on this page
// Moved out of App.js unchanged. `model` is useLoadedModel's state for the
// model picked in the title bar.

import { useMemo } from 'react';
import { SelectBox, TabPanel } from 'devextreme-react';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import notify from 'devextreme/ui/notify';
import ScreensPanel from '../../ScreensPanel';
import HierarchyTree from '../../HierarchyTree';
import PageVisualsTabWrapper from '../../PageVisualsTree';
import { CURRENT_ASSET_DATA } from '../../operator/model/modelData';
import { DX_WIDGET_DATA } from '../../widgetData';
import { findContainerById } from '../../containerTree';

// Sorts a flat, two-level parentId-based hierarchy (categories + items, the
// shape DX_WIDGET_DATA uses) alphabetically by name WITHIN each
// category — categories keep their order. HierarchyTree keeps array order
// for siblings, so reordering the flat array is enough.
// With searchText, keeps only matching items plus their categories, and
// drops categories left empty — the same search behaviour as ScreensPanel.
function sortAndFilterHierarchy(flatData, searchText) {
  const categories = flatData.filter(item => item.parentId === null);
  const sorted = [];
  categories.forEach(cat => {
    const children = flatData
      .filter(item => item.parentId === cat.id)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sorted.push(cat, ...children);
  });

  const query = (searchText || '').trim().toLowerCase();
  if (!query) return sorted;

  const matchingItems = sorted.filter(item => item.parentId !== null && (item.name || '').toLowerCase().includes(query));
  const neededCategoryIds = new Set(matchingItems.map(item => item.parentId));
  const matchingCategories = sorted.filter(item => item.parentId === null && neededCategoryIds.has(item.id));
  return [...matchingCategories, ...matchingItems];
}

// The loaded model's asset hierarchy, any depth, for the Data tab's Model
// view. Keeps the model's own order (the order the Operator side and
// Visualization show) rather than sorting, since siblings are often in
// process order (Intake before Output). With searchText, keeps the matching
// assets plus the ancestors that lead to them.
function filterAssetTree(assets, searchText) {
  const query = (searchText || '').trim().toLowerCase();
  if (!query) return assets;
  const byId = new Map(assets.map(a => [a.id, a]));
  const keep = new Set();
  assets.forEach(a => {
    if (!(a.name || '').toLowerCase().includes(query)) return;
    let current = a;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parentId != null ? byId.get(current.parentId) : null;
    }
  });
  return assets.filter(a => keep.has(a.id));
}

// The Model view: the active model's hierarchy once it's loaded (see
// useLoadedModel in ScreensWorkspace), a note until then.
function ModelTree({ model, searchText }) {
  const dataSource = useMemo(
    () => (model.loaded ? filterAssetTree(CURRENT_ASSET_DATA, searchText) : []),
    // CURRENT_ASSET_DATA is a module variable that changes with the model,
    // so the model id stands in for it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.loaded, model.modelId, searchText],
  );
  if (model.error) return <p style={emptyNote}>Couldn't load the model ({model.error}).</p>;
  if (!model.loaded) return <p style={emptyNote}>Loading model…</p>;
  if (dataSource.length === 0) return <p style={emptyNote}>No assets match "{searchText}".</p>;
  return (
    // Keyed by model so switching models starts the tree fresh (expanded,
    // nothing selected) rather than carrying the old one's state.
    <HierarchyTree
      key={model.modelId}
      dataSource={dataSource}
      displayExpr="name"
      itemRender={AssetTreeItemTemplate}
      expandAll={!!(searchText || '').trim()}
    />
  );
}

// Widgets are draggable onto the canvas (ContainerCard reads
// dx-widget-name on drop), and double-clickable when onDblClick is given.
// The Widgets area's tree uses it too, without double-click.
export function WidgetTreeItemTemplate(item, onDblClick) {
  const isWidget = item.assetLevel === 'widget';
  return (
    <div
      className={`tree-item${isWidget ? ' tree-item--widget' : ''}`}
      draggable={isWidget}
      onDoubleClick={isWidget && onDblClick ? (e) => { e.stopPropagation(); onDblClick(item); } : undefined}
      onDragStart={isWidget ? (e) => {
        e.dataTransfer.setData('dx-widget-name', item.name);
        e.dataTransfer.setData('dx-widget-id', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      } : undefined}
    >
      <span className="tree-item-name">{item.name}</span>
    </div>
  );
}

function AssetTreeItemTemplate(item) {
  if (item.nodeType === 'tag') {
    return (
      <div className="tree-item">
        <span className="tree-item-name">{item.name}</span>
        <span className="tree-item-badge tree-item-badge--tag">{item.tagDomain.toLowerCase()}</span>
      </div>
    );
  }
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="tree-item-badge">{item.assetType}</span>
    </div>
  );
}

const emptyNote = { padding: '12px 14px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 };

function QueriesToAdd({ editor, queries }) {
  const { activePageId, dataTabSearch, queryInstances } = editor;
  return (
    <div>
      {!activePageId && (
        <div style={{ padding: '10px 14px', fontSize: 11, color: '#7a6000', background: '#fffbe6', borderBottom: '1px solid #ffe08a' }}>
          Save this screen first — query instances need a real page to belong to.
        </div>
      )}
      {queries.length === 0 ? (
        <p style={emptyNote}>
          No queries yet. Create one in the Queries workspace first.
        </p>
      ) : (() => {
        const queryFilter = dataTabSearch.trim().toLowerCase();
        const visibleQueries = [...queries]
          .filter(q => !queryFilter || (q.name || '').toLowerCase().includes(queryFilter))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (visibleQueries.length === 0) {
          return (
            <p style={emptyNote}>
              No queries match "{dataTabSearch}".
            </p>
          );
        }
        return visibleQueries.map(q => {
          const countOnPage = queryInstances.filter(qi => qi.pageId === activePageId && qi.queryId === q.id).length;
          return (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #f1f1f1' }}>
              <span style={{ fontSize: 13, flexShrink: 0 }}>⚡</span>
              <span style={{ flex: 1, fontSize: 12, color: q.name ? '#222' : '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {q.name || '(unnamed)'}
              </span>
              {countOnPage > 0 && (
                <span style={{ fontSize: 9, color: '#888', flexShrink: 0 }} title="Instances of this query already on this page">
                  {countOnPage} on page
                </span>
              )}
              <button
                className="focus-mode-btn"
                style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                disabled={!activePageId}
                title={activePageId ? 'Add an instance of this query to the current page' : 'Save this screen first'}
                onClick={() => {
                  editor.addQueryInstance({ queryId: q.id });
                  notify(`Added "${q.name || 'query'}" to this page`, 'success', 2000);
                }}
              >
                + Add
              </button>
            </div>
          );
        });
      })()}
    </div>
  );
}

function PageQueryInstanceList({ editor, queries }) {
  const { pageQueryInstances, selectedQueryInstanceId } = editor;
  if (pageQueryInstances.length === 0) {
    return (
      <p style={emptyNote}>
        No queries added to this page yet. Add one from the Data tab.
      </p>
    );
  }
  return pageQueryInstances.map(qi => {
    const q = queries.find(qq => qq.id === qi.queryId);
    const isSelected = qi.id === selectedQueryInstanceId;
    return (
      <div
        key={qi.id}
        onClick={() => editor.selectQueryInstance(qi.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          borderBottom: '1px solid #f1f1f1', cursor: 'pointer',
          background: isSelected ? '#e3eaf6' : 'transparent',
          borderLeft: isSelected ? '3px solid #0078d4' : '3px solid transparent',
        }}
      >
        <span style={{ fontSize: 13, flexShrink: 0 }}>⚡</span>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {qi.alias || q?.name || '(unnamed instance)'}
          </div>
          {q?.name && qi.alias !== q.name && (
            <div style={{ fontSize: 9, color: '#aaa' }}>{q.name}</div>
          )}
        </div>
        <button
          className="focus-mode-btn"
          style={{ fontSize: 11, color: '#d00', borderColor: '#d00', padding: '2px 6px', flexShrink: 0 }}
          title="Remove from page"
          onClick={(e) => {
            e.stopPropagation();
            if (isSelected) editor.setSelectedQueryInstanceId(null);
            editor.deleteQueryInstance(qi.id);
          }}
        >×</button>
      </div>
    );
  });
}

export function ScreensLeftPanel({ editor, queries, model }) {
  const { containers, selectedContainerId } = editor;
  return (
    <div className="app-panel">
      <TabPanel
        height="100%"
        animationEnabled={false}
        swipeEnabled={false}
      >
        <TabPanelItem title="Screens">
          <div className="left-panel-tab-content" style={{ height: '100%' }}>
            <ScreensPanel
              pages={editor.pages}
              folders={editor.folders}
              activePageId={editor.activePageId}
              isDirty={editor.isDirty}
              onOpenPage={editor.openPage}
              onCreatePage={editor.createPage}
              onDeletePage={editor.deletePage}
              onCreateFolder={editor.createFolder}
              onRenameFolder={editor.renameFolder}
              onDeleteFolder={editor.deleteFolder}
              onMovePageToFolder={editor.movePageToFolder}
            />
          </div>
        </TabPanelItem>
        <TabPanelItem title="Visuals">
          <div className="left-panel-tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
              <input
                className="details-input"
                style={{ width: '100%' }}
                value={editor.visualsSearch}
                onChange={(e) => editor.setVisualsSearch(e.target.value)}
                placeholder="Search widgets…"
              />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <HierarchyTree
                dataSource={sortAndFilterHierarchy(DX_WIDGET_DATA, editor.visualsSearch)}
                displayExpr="name"
                itemRender={(item) => WidgetTreeItemTemplate(item, (item) => editor.addWidgetToSelection(item.name))}
              />
            </div>
          </div>
        </TabPanelItem>
        <TabPanelItem title="Data">
          <div className="left-panel-tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
              <SelectBox
                dataSource={[
                  { value: 'queries', label: 'Queries' },
                  { value: 'model',   label: 'Model' },
                ]}
                valueExpr="value"
                displayExpr="label"
                value={editor.dataTabMode}
                onValueChanged={e => editor.setDataTabMode(e.value)}
                stylingMode="outlined"
                width="100%"
                height={26}
              />
            </div>
            <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
              <input
                className="details-input"
                style={{ width: '100%' }}
                value={editor.dataTabSearch}
                onChange={(e) => editor.setDataTabSearch(e.target.value)}
                placeholder={editor.dataTabMode === 'model' ? 'Search model…' : 'Search queries…'}
              />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {editor.dataTabMode === 'model' ? (
                <ModelTree model={model} searchText={editor.dataTabSearch} />
              ) : (
                <QueriesToAdd editor={editor} queries={queries} />
              )}
            </div>
          </div>
        </TabPanelItem>
        <TabPanelItem title="Page Visuals">
          <div className="left-panel-tab-content">
            <p className="panel-label" style={{ padding: '4px 0', marginBottom: 4 }}>
              Selected: {selectedContainerId
                ? (findContainerById(containers, selectedContainerId)?.title || 'none')
                : 'none'}
            </p>
            <PageVisualsTabWrapper
              containers={containers}
              selectedContainerId={selectedContainerId}
              onSelect={editor.selectContainerFromTree}
              onReparent={editor.dropInPageVisualsTree}
              onToggleLock={editor.toggleContainerLock}
            />
          </div>
        </TabPanelItem>
        <TabPanelItem title="Page Data">
          <div className="left-panel-tab-content">
            <PageQueryInstanceList editor={editor} queries={queries} />
          </div>
        </TabPanelItem>
      </TabPanel>
    </div>
  );
}
