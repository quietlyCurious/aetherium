// ─────────────────────────────────────────────────────────────────────────────
// App.js — root component: the title bar (area menu, model switcher, Launch,
// Save), which area is showing, and the data every designer area shares.
//
// Each area draws itself — OperatorWorkspace, ScreensWorkspace, the
// definition workspaces (Data Sources, Entities, Queries), ThemeWorkspace.
// What stays here is what spans areas: navigation and its unsaved-changes
// checks, the title-bar Save for whichever area is open, and the data
// definitions (data sources, entities, queries) more than one area reads.
//
// The Screens editor's state comes from useScreenEditor, called here rather
// than inside ScreensWorkspace so the open page and its unsaved edits
// survive switching to another area and back.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Splitter, TabPanel } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import 'devextreme/dist/css/dx.fluent.blue.light.compact.css';
import './App.css';
import './App.locked.css'; // Pass 2 — locked-selection styling
import './App.snap.css';  // Snap-to-grid dot grid styles
import './App.bindings.css'; // Phase 1 binding system
import './App.data.css'; // Phase 2a data workspace
import './App.detailsRadius.css'; // scoped border-radius override for details panel controls
import './App.suppressLicenseBanner.css'; // hides the DevExtreme trial/eval banner — internal POC only
import './App.thinScrollbars.css'; // thin, hover-only scrollbars — canvas and Runtime view only
// Operator Interface stylesheets — one per area of src/operator/, in
// cascade order (base first). Kept here, at the exact position the single
// App.operator.css import used to occupy, so their order relative to the
// other stylesheets is unchanged.
import './operator/styles/base.css';
import './operator/styles/properties.css';
import './operator/styles/canvas.css';
import './operator/styles/relatedAssets.css';
import './operator/styles/configurator.css';
import './operator/styles/operatorViews.css';
import './operator/styles/chrome.css';
import DataSourcesWorkspace from './DataSourcesWorkspace';
import QueriesWorkspace from './QueriesWorkspace';
import EntitiesWorkspace from './EntitiesWorkspace';
import RuntimeView from './RuntimeView';
import { makeNewEntity } from './entityModel';
import { loadEntities, saveEntities } from './entitiesStorage';
import { loadDataSources, saveDataSources } from './dataSourcesStorage';
import { loadQueries, saveQueries } from './queriesStorage';
import { loadOperatorNavigation, saveOperatorNavigation } from './operatorNavigationStorage';
import { loadModelRegistry } from './modelRegistry';
import ThemeWorkspace from './ThemeWorkspace';
import OperatorWorkspace from './operator/OperatorWorkspace';
import { ScreensWorkspace } from './designer/screens/ScreensWorkspace';
import { useScreenEditor } from './designer/screens/useScreenEditor';
import { WidgetTreeItemTemplate } from './designer/screens/ScreensLeftPanel';
import { generateDataId, DEFAULT_DATA_SOURCE, DEFAULT_QUERY } from './dataModel';
import { DX_WIDGET_DATA, WIDGET_PROPERTIES } from './widgetData';
import HierarchyTree from './HierarchyTree';
import WidgetConfigPanel from './WidgetConfigPanel';
import { useHasUnsavedChanges } from './unsavedChangesStore';

// Deep-link routing for the two Operator Workspace personas — a plain
// read-the-path-on-load / replaceState-as-you-navigate scheme, matching
// the app's existing (much simpler) ?runtime= query-param convention
// rather than pulling in a full router for two path shapes:
//   /configuration/visualization/<typeId>/<tab>
//   /operation/assets/<assetId>/<tab>
// tab is one of 'properties' | 'related' | 'all' in both schemes. Returns
// null if the current path doesn't match either shape, so callers can
// fall back to whatever the normal (non-deep-linked) default is.
function parseDeepLinkFromPathname(pathname) {
  const configMatch = pathname.match(/^\/configuration\/visualization\/([^/]+)\/([^/]+)\/?$/);
  if (configMatch) {
    return { persona: 'configurator', id: decodeURIComponent(configMatch[1]), tab: configMatch[2] };
  }
  const opMatch = pathname.match(/^\/operation\/assets\/([^/]+)\/([^/]+)\/?$/);
  if (opMatch) {
    return { persona: 'operator', id: decodeURIComponent(opMatch[1]), tab: opMatch[2] };
  }
  return null;
}
function buildDeepLinkPathname({ persona, id, tab }) {
  const base = persona === 'configurator' ? '/configuration/visualization' : '/operation/assets';
  if (!id) return base;
  return `${base}/${encodeURIComponent(id)}/${tab || 'properties'}`;
}

function AetheriumEditor() {
  // Guards navigation via the top-left "Aetherium ▾" menu the same way page
  // switching is guarded — if the canvas has unsaved edits, confirm before
  // leaving. Note: navigating between menu areas doesn't itself discard the
  // live `containers` state (unlike opening a different saved page, which
  // does) — this is a deliberate "don't forget to save" nudge, not a data-loss
  // prevention in the strict sense, though it's built the same way for a
  // consistent, predictable habit either way.
  // Leaving the Operator workspace (another app area, the other persona,
  // or another model) unmounts whatever Configurator editor is open, so
  // any unsaved changes there get the same Save/Discard prompt that
  // switching types or assets inside the workspace gives. Resolves
  // immediately when there's nothing unsaved.
  const resolveOperatorUnsaved = () => (currentView === 'operator'
    ? (operatorWorkspaceRef.current?.resolveUnsavedChanges?.() ?? Promise.resolve())
    : Promise.resolve());

  const handleNavigate = async (view) => {
    if (!screens.confirmDiscardIfDirty()) return;
    if (view !== currentView && !confirmLeaveDefinitionArea()) return;
    if (view !== currentView) await resolveOperatorUnsaved();
    setCurrentView(view);
    setMenuOpen(false);
  };

  // Operator Interface and Configurator Interface both land on the same
  // underlying workspace (currentView stays 'operator') — only the persona
  // changes, which controls which rail items that workspace shows.
  const handleNavigateOperatorPersona = async (persona) => {
    if (!screens.confirmDiscardIfDirty()) return;
    if (currentView !== 'operator' && !confirmLeaveDefinitionArea()) return;
    if (currentView !== 'operator' || persona !== operatorPersona) await resolveOperatorUnsaved();
    setCurrentView('operator');
    setOperatorPersona(persona);
    setMenuOpen(false);
  };

  const [currentView, setCurrentView] = useState('operator'); // 'screens'|'widgets'|'theme'|'datasources'|'entities'|'queries'|'scripts'|'operator' — defaults to 'operator' while Screens/Widgets/etc. are hidden from the nav (see TODO.md)
  // Read once on mount from the URL — a deep link there (if present)
  // takes priority over the persisted last-used persona below. Also
  // reused (via setInitialDeepLink) for in-app navigation that switches
  // persona — the gear icon on an Operator asset box, which jumps to
  // Visualization's Properties tab for that asset's type — since
  // OperatorWorkspaceInner already reads this exact piece of state, once,
  // on every fresh mount (including the fresh mount a persona switch
  // itself causes), to seed its own initial selection.
  const [initialDeepLink, setInitialDeepLink] = useState(() => parseDeepLinkFromPathname(window.location.pathname));
  const [operatorPersona, setOperatorPersona] = useState(() => initialDeepLink?.persona || loadOperatorNavigation()?.operatorPersona || 'operator'); // 'operator' | 'configurator' — both render the same workspace, just with different rail items visible
  const [menuOpen, setMenuOpen] = useState(false);
  // The model switcher's list comes from public/data/models.json (via
  // modelRegistry.js) rather than being hardcoded here, so adding an
  // industry pack needs no code change. Empty until the fetch resolves —
  // the switcher just shows the saved model's id until then.
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => loadOperatorNavigation()?.selectedModel || 'refinery');
  React.useEffect(() => {
    let cancelled = false;
    loadModelRegistry()
      .then(models => {
        if (cancelled) return;
        setAvailableModels(models);
        // A saved model that's since been removed from models.json would
        // otherwise leave the workspace stuck on a load error.
        setSelectedModel(current => (models.some(m => m.id === current) ? current : models[0].id));
      })
      .catch(() => {
        // OperatorWorkspace surfaces the same failure with a proper message.
      });
    return () => { cancelled = true; };
  }, []);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedWidgetName, setSelectedWidgetName] = useState(null);

  // ── Phase 2 Data Layer ────────────────────────────────────────────────────
  // System-scoped (shared across all pages of this project):
  const [dataSources,      setDataSources]      = useState(() => loadDataSources());  // DataSource definitions
  const [entities,         setEntities]          = useState(() => loadEntities());  // Entity definitions (schema + rows)
  const entitiesWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger entity-data save
  const dataSourcesWorkspaceRef = React.useRef(null);
  const queriesWorkspaceRef = React.useRef(null);
  const operatorWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger a type's display template save, configurator persona only
  // The three definition areas share one shell (designer/DefinitionWorkspace),
  // which knows whether its open editor has unsaved changes. Leaving one of
  // them asks first, the way switching items inside it does — otherwise
  // navigating away unmounted the editor and dropped the edits silently.
  const DEFINITION_WORKSPACE_REFS = { datasources: dataSourcesWorkspaceRef, entities: entitiesWorkspaceRef, queries: queriesWorkspaceRef };
  const confirmLeaveDefinitionArea = () => DEFINITION_WORKSPACE_REFS[currentView]?.current?.confirmLeave?.() ?? true;
  // Whether the open editor has unsaved changes — the Configurator's
  // editors and the definition workspaces both publish here. Drives the
  // Save button's amber marker.
  const hasUnsavedChanges = useHasUnsavedChanges();
  const [operatorSaveAvailable, setOperatorSaveAvailable] = useState(false); // whether a type is currently selected (Now area's Types tab) — mirrors the same static, per-context enablement pattern the other workspaces already use, not new dirty-tracking

  React.useEffect(() => {
    saveOperatorNavigation({ currentView, operatorPersona, selectedModel });
  }, [currentView, operatorPersona, selectedModel]);
  const [queries,          setQueries]          = useState(() => loadQueries());  // Query definitions

  // The Screens editor: the saved screens, the page on the canvas and
  // everything done to it (see designer/screens/useScreenEditor).
  const screens = useScreenEditor({ queries });

  // ── Phase 2 Data Layer Handlers ───────────────────────────────────────────

  // ── Data Sources ──────────────────────────────────────────────────────────
  const handleAddDataSource = (dsData = {}) => {
    const ds = { ...DEFAULT_DATA_SOURCE, ...dsData, id: generateDataId() };
    setDataSources(prev => {
      const next = [...prev, ds];
      saveDataSources(next);
      return next;
    });
    return ds.id;
  };

  const handleUpdateDataSource = (id, updates) => {
    setDataSources(prev => {
      const next = prev.map(ds =>
        ds.id === id ? { ...ds, ...updates, config: { ...ds.config, ...(updates.config || {}) } } : ds
      );
      saveDataSources(next);
      return next;
    });
  };

  const handleDeleteDataSource = (id) => {
    // Guard: don't delete if queries reference this data source
    const inUse = queries.some(q => q.dataSourceId === id);
    if (inUse) {
      // Caller should warn the user — handler returns false to signal blocked
      return false;
    }
    setDataSources(prev => {
      const next = prev.filter(ds => ds.id !== id);
      saveDataSources(next);
      return next;
    });
    return true;
  };

  // ── Entities ─────────────────────────────────────────────────────────────
  const handleAddEntity = () => {
    const entity = makeNewEntity('Untitled Entity', generateDataId);
    setEntities(prev => {
      const next = [...prev, entity];
      saveEntities(next);
      return next;
    });
    return entity.id;
  };

  const handleUpdateEntity = (id, updates) => {
    setEntities(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e);
      saveEntities(next);
      return next;
    });
  };

  const handleDeleteEntity = (id) => {
    setEntities(prev => {
      const next = prev.filter(e => e.id !== id);
      saveEntities(next);
      return next;
    });
    return true;
  };

  // ── Queries ───────────────────────────────────────────────────────────────
  const handleAddQuery = (qData = {}) => {
    const q = { ...DEFAULT_QUERY, ...qData, id: generateDataId() };
    setQueries(prev => {
      const next = [...prev, q];
      saveQueries(next); // persisted inside the updater so a rapid loop of calls
      return next;        // (e.g. the OpHub sync feature) always saves the correct final array
    });
    return q.id;
  };

  const handleUpdateQuery = (id, updates) => {
    setQueries(prev => {
      const next = prev.map(q =>
        q.id === id ? { ...q, ...updates, config: { ...q.config, ...(updates.config || {}) } } : q
      );
      saveQueries(next);
      return next;
    });
  };

  const handleDeleteQuery = (id) => {
    // Guard: don't delete if query instances reference this query
    const inUse = screens.queryInstances.some(qi => qi.queryId === id);
    if (inUse) return false;
    setQueries(prev => {
      const next = prev.filter(q => q.id !== id);
      saveQueries(next);
      return next;
    });
    return true;
  };

  return (
    <div className="app-shell">

      {/* Title bar */}
      <div className="app-titlebar">
        <div className="app-titlebar-menu" ref={menuRef => {
          if (menuRef) {
            menuRef.onmouseleave = () => setMenuOpen(false);
          }
        }}>
          <span
            className="app-titlebar-title"
            onClick={() => setMenuOpen(o => !o)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {currentView === 'operator'
              ? `Next Gen | ${operatorPersona === 'configurator' ? 'Configuration' : 'Operator'} Experience ▾`
              : 'Aetherium ▾'}
          </span>
          {menuOpen && (
            <div className="app-titlebar-dropdown">
              {/* Page-builder areas (Screens … Scripts) — restored to the
                  menu alongside the Operator/Configurator interfaces. */}
              <div
                className={`app-titlebar-dropdown-item${currentView === 'screens' ? ' active' : ''}`}
                onClick={() => handleNavigate('screens')}
              >
                Screens
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'widgets' ? ' active' : ''}`}
                onClick={() => handleNavigate('widgets')}
              >
                Widgets
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'theme' ? ' active' : ''}`}
                onClick={() => handleNavigate('theme')}
              >
                Theme
              </div>
              <div className="app-titlebar-dropdown-divider" />
              <div
                className={`app-titlebar-dropdown-item${currentView === 'datasources' ? ' active' : ''}`}
                onClick={() => handleNavigate('datasources')}
              >
                Data Sources
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'entities' ? ' active' : ''}`}
                onClick={() => handleNavigate('entities')}
              >
                Entities
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'queries' ? ' active' : ''}`}
                onClick={() => handleNavigate('queries')}
              >
                Queries
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'scripts' ? ' active' : ''}`}
                onClick={() => handleNavigate('scripts')}
              >
                Scripts
              </div>
              <div className="app-titlebar-dropdown-divider" />
              <div
                className={`app-titlebar-dropdown-item${currentView === 'operator' && operatorPersona === 'operator' ? ' active' : ''}`}
                onClick={() => handleNavigateOperatorPersona('operator')}
              >
                Operator Interface
              </div>
              <div
                className={`app-titlebar-dropdown-item${currentView === 'operator' && operatorPersona === 'configurator' ? ' active' : ''}`}
                onClick={() => handleNavigateOperatorPersona('configurator')}
              >
                Configurator Interface
              </div>
            </div>
          )}
        </div>
        {/* The industry model only drives the Operator/Configurator
            interfaces, so the switcher is hidden in the page-builder areas. */}
        {currentView === 'operator' && (
          <div
            className="app-titlebar-model-switcher"
            ref={modelMenuRef => {
              if (modelMenuRef) {
                modelMenuRef.onmouseleave = () => setModelMenuOpen(false);
              }
            }}
          >
            <div
              className="app-titlebar-model-trigger"
              onClick={() => setModelMenuOpen(o => !o)}
              title="Switch model"
            >
              <span className="app-titlebar-title app-titlebar-model-pipe">|</span>
              <span className="app-titlebar-title app-titlebar-model-label">
                {availableModels.find(m => m.id === selectedModel)?.label ?? selectedModel} ▾
              </span>
            </div>
            {modelMenuOpen && (
              <div className="app-titlebar-dropdown">
                {availableModels.map(m => (
                  <div
                    key={m.id}
                    className={`app-titlebar-dropdown-item${selectedModel === m.id ? ' active' : ''}`}
                    onClick={async () => {
                      setModelMenuOpen(false);
                      if (m.id !== selectedModel) await resolveOperatorUnsaved();
                      setSelectedModel(m.id);
                    }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="app-titlebar-right-cluster">
        {currentView !== 'operator' && (
          <button
            onClick={() => {
              if (!screens.activePageId) {
                window.alert('Save this screen first, then Launch will open its runtime view in a new tab.');
                return;
              }
              const url = `${window.location.origin}${window.location.pathname}?runtime=${screens.activePageId}`;
              window.open(url, '_blank');
            }}
            title={screens.activePageId ? 'Open a chrome-free runtime view of this screen in a new tab' : 'Save this screen first'}
            style={{
              marginLeft: 'auto',
              marginRight: 8,
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 14px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            ▶ Launch
          </button>
        )}
        {(() => {
          // Launch stays hidden entirely for 'operator' regardless of
          // persona — this is a concept shell with no page/runtime-view
          // concept of its own. Save now also renders for the configurator
          // persona specifically, since that's where a type's display
          // template gets saved; it stays hidden for the operator persona,
          // matching the original "hidden, not just disabled" intent for
          // personas that have nothing to save here.
          if (currentView === 'operator' && operatorPersona !== 'configurator') return null;

          // Screens and the three definition areas (data sources, entities,
          // queries) have a title-bar Save. Widgets, theme and scripts have
          // nothing to save — these used to silently fall through to the
          // PAGE save handler, which is how phantom pages named after
          // whatever was being tested on another screen got created.
          const saveInfo = currentView === 'operator'
            ? {
                enabled: operatorSaveAvailable,
                label: !operatorSaveAvailable
                  ? 'Select a type or asset in the Now area to save its display template'
                  : hasUnsavedChanges
                    ? 'You have unsaved changes — save them'
                    : "Save this type or asset's display template (no unsaved changes)",
              }
            : {
                screens:      { enabled: true,  label: currentView === 'screens' && screens.activePageId ? 'Save this screen' : 'Save as a new screen' },
                entities:     { enabled: true,  label: hasUnsavedChanges ? 'You have unsaved changes — save them' : 'Save entity data' },
                datasources:  { enabled: true,  label: hasUnsavedChanges ? 'You have unsaved changes — save them' : 'Save this data source' },
                queries:      { enabled: true,  label: hasUnsavedChanges ? 'You have unsaved changes — save them' : 'Save this query' },
                theme:        { enabled: false, label: 'Nothing to save on this screen' },
                widgets:      { enabled: false, label: 'Nothing to save on this screen' },
                scripts:      { enabled: false, label: 'Nothing to save on this screen' },
              }[currentView] || { enabled: false, label: 'Nothing to save on this screen' };

          return (
            <button
              onClick={() => {
                if (!saveInfo.enabled) return;
                if (currentView === 'operator') {
                  operatorWorkspaceRef.current?.save();
                } else if (currentView === 'entities') {
                  entitiesWorkspaceRef.current?.save();
                } else if (currentView === 'datasources') {
                  dataSourcesWorkspaceRef.current?.save();
                } else if (currentView === 'queries') {
                  queriesWorkspaceRef.current?.save();
                } else {
                  screens.savePage();
                }
              }}
              disabled={!saveInfo.enabled}
              title={saveInfo.label}
              style={{
                marginRight: 14,
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                cursor: saveInfo.enabled ? 'pointer' : 'not-allowed',
                opacity: saveInfo.enabled ? 1 : 0.4,
              }}
            >
              💾 Save
              {/* Unsaved marker — same amber dot convention as a modified
                  editor tab. The Configurator and the definition areas;
                  Screens still has its own dirty handling. */}
              {(currentView === 'operator' || DEFINITION_WORKSPACE_REFS[currentView]) && hasUnsavedChanges && (
                <span className="app-titlebar-unsaved-dot" aria-label="Unsaved changes" />
              )}
            </button>
          );
        })()}
        <div className="app-titlebar-profile" title="Profile">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="10" r="5" stroke="white" strokeWidth="1.5" fill="none"/>
            <path d="M4 24c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>
        </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="app-body">
        {currentView === 'widgets' ? (
          <Splitter orientation="horizontal" style={{ height: '100%' }}>
            <SplitterItem size="220px" minSize="120px" resizable={true}>
              <div className="app-panel">
                <TabPanel
                  height="100%"
                  animationEnabled={false}
                  swipeEnabled={false}
                >
                  <TabPanelItem title="Widgets">
                    <div className="left-panel-tab-content">
                      <HierarchyTree
                        dataSource={DX_WIDGET_DATA}
                        displayExpr="name"
                        itemRender={(item) => WidgetTreeItemTemplate(item, null)}
                        selectedId={selectedWidgetName}
                        onSelect={(id) => {
                          const item = DX_WIDGET_DATA.find(w => w.id === id);
                          setSelectedWidgetName(item?.assetLevel === 'widget' ? item.name : null);
                        }}
                      />
                    </div>
                  </TabPanelItem>
                </TabPanel>
              </div>
            </SplitterItem>
            <SplitterItem resizable={true}>
              <div className="app-panel app-panel--center" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {selectedWidgetName ? (
                  <WidgetConfigPanel widgetName={selectedWidgetName} />
                ) : (
                  <p className="step-instructions" style={{ padding: 16 }}>Select a widget to view its full configuration.</p>
                )}
              </div>
            </SplitterItem>
            <SplitterItem size="220px" minSize="120px" resizable={true}>
              <div className="app-panel details-panel aetherium-canvas-scroll">
                <p className="panel-label">Details</p>
                {selectedWidgetName ? (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 4px' }}>{selectedWidgetName}</p>
                    {WIDGET_PROPERTIES[selectedWidgetName] ? (
                      <pre style={{ fontSize: 11, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
                        {JSON.stringify(WIDGET_PROPERTIES[selectedWidgetName], null, 2)}
                      </pre>
                    ) : (
                      <p style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No Entry</p>
                    )}
                  </>
                ) : (
                  <p className="step-instructions">Select a widget to view its properties.</p>
                )}
              </div>
            </SplitterItem>
          </Splitter>

        ) : currentView === 'theme' ? (
          <ThemeWorkspace />

        ) : currentView === 'datasources' ? (
          <DataSourcesWorkspace
            ref={dataSourcesWorkspaceRef}
            dataSources={dataSources}
            onAdd={handleAddDataSource}
            onUpdate={handleUpdateDataSource}
            onDelete={handleDeleteDataSource}
          />

        ) : currentView === 'entities' ? (
          <EntitiesWorkspace
            ref={entitiesWorkspaceRef}
            entities={entities}
            onAdd={handleAddEntity}
            onUpdate={handleUpdateEntity}
            onDelete={handleDeleteEntity}
          />

        ) : currentView === 'queries' ? (
          <QueriesWorkspace
            ref={queriesWorkspaceRef}
            queries={queries}
            dataSources={dataSources}
            onAdd={handleAddQuery}
            onUpdate={handleUpdateQuery}
            onDelete={handleDeleteQuery}
          />

        ) : currentView === 'scripts' ? (
          <div className="data-workspace">
            <div className="data-workspace-placeholder">
              <div className="data-workspace-placeholder-icon">🐍</div>
              <div className="data-workspace-placeholder-title">Scripts</div>
              <div className="data-workspace-placeholder-desc">
                Author Python scripts with typed inputs and outputs that can be added to pages and bound to widgets,
                just like queries. Scripts run server-side and support complex data transformation logic.
              </div>
              <div className="data-workspace-placeholder-badge">Phase 3 · planned</div>
            </div>
          </div>

        ) : currentView === 'operator' ? (
          <OperatorWorkspace
            ref={operatorWorkspaceRef}
            selectedModel={selectedModel}
            operatorPersona={operatorPersona}
            onSaveAvailabilityChange={setOperatorSaveAvailable}
            initialDeepLink={initialDeepLink}
            onNavigate={({ id, tab }) => {
              const pathname = buildDeepLinkPathname({ persona: operatorPersona, id, tab });
              window.history.replaceState(null, '', pathname);
            }}
            onNavigateToConfig={({ id, tab }) => {
              setInitialDeepLink({ persona: 'configurator', id, tab });
              setOperatorPersona('configurator');
            }}
          />


        ) : (
          <ScreensWorkspace editor={screens} queries={queries} />
        )}
      </div>
    </div>
  );
}

// Outer wrapper — deliberately calls NO hooks of its own. This is what makes
// the runtime-mode branch safe: AetheriumEditor and RuntimeView are two
// separate components, each unconditionally committing to their own hooks,
// so nothing here is ever conditionally skipped within a single component's
// render (the violation ESLint was correctly flagging when this check lived
// inside AetheriumEditor itself, before its own hooks).
export default function App() {
  // Suppresses DevExtreme's trial/evaluation license banner. Pure CSS can't
  // do this — the real <dx-license> element sets its own inline styles with
  // !important on every property (display, visibility, height, etc.), which
  // sits above ANY external stylesheet rule in CSS's specificity order, even
  // one that also uses !important. Its `data-permanent` attribute confirms
  // this is deliberate anti-tamper behavior on DevExtreme's part, not an
  // oversight — so this actively re-asserts hidden styles via JS instead of
  // trying to win a fight CSS structurally cannot win. One effect here
  // covers both AetheriumEditor and RuntimeView, since it watches the whole
  // document regardless of which one is currently rendered.
  React.useEffect(() => {
    const hideLicenseBanners = () => {
      document.querySelectorAll('dx-license, [class*="dx-license"], [class*="dx-watermark"]').forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('height', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      });
    };

    hideLicenseBanners();

    // Reacts instantly to DevExtreme inserting the element or re-touching
    // its style/class attributes.
    const observer = new MutationObserver(hideLicenseBanners);
    observer.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class'],
    });

    // Belt-and-suspenders: `data-permanent` suggests this may also reassert
    // itself on DevExtreme's own internal timer, outside any DOM mutation we
    // could otherwise catch — a short poll as a backstop.
    const intervalId = setInterval(hideLicenseBanners, 250);

    return () => {
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, []);

  const runtimePageId = new URLSearchParams(window.location.search).get('runtime');
  if (runtimePageId) {
    return <RuntimeView pageId={runtimePageId} />;
  }
  return <AetheriumEditor />;
}
