// ─────────────────────────────────────────────────────────────────────────────
// App.js — root component: the title bar (area menu, model switcher, Launch,
// Save), which area is showing, and the data every designer area shares.
//
// Each area draws itself — OperatorWorkspace, ScreensWorkspace, the
// definition workspaces (Data Sources, Entities, Queries, Asset Sets), ThemeWorkspace,
// WidgetsWorkspace, ScriptsWorkspace. The workspaces and their areas —
// names, rail groups, what Save says — are shell/appAreas.js. What stays
// here is what spans areas: the title bar (workspace menu, model switcher,
// Launch, Save), the Configuration Experience's rail, navigation and its
// unsaved-changes check, and the data definitions (data sources, entities,
// queries) more than one area reads.
//
// The Screens editor's state comes from useScreenEditor, called here rather
// than inside ScreensWorkspace so the open page and its unsaved edits
// survive switching to another area and back.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
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
import { loadAssetSets, saveAssetSets } from './assetSetsStorage';
import AssetSetsWorkspace from './designer/assetSets/AssetSetsWorkspace';
import { useStoredDefinitions } from './designer/useStoredDefinitions';
import { makeNewAssetSet } from './model/assetSets';
import { loadOperatorNavigation, saveOperatorNavigation } from './operatorNavigationStorage';
import { loadModelRegistry } from './model/modelRegistry';
import ThemeWorkspace from './ThemeWorkspace';
import OperatorWorkspace from './operator/OperatorWorkspace';
import { ScreensWorkspace } from './designer/screens/ScreensWorkspace';
import { useScreenEditor } from './designer/screens/useScreenEditor';
import { WidgetsWorkspace } from './designer/WidgetsWorkspace';
import { ScriptsWorkspace } from './designer/ScriptsWorkspace';
import { APP_AREAS, WORKSPACES, findArea, railGroupsFor } from './shell/appAreas';
import { AreaRail } from './shell/AreaRail';
import './shell/appRail.css';
import { generateDataId, DEFAULT_DATA_SOURCE, DEFAULT_QUERY } from './dataModel';
import { useHasUnsavedChanges } from './unsavedChangesStore';

// A new asset set, for useStoredDefinitions. Module-level so it stays the
// same function between renders.
const makeAssetSet = (extra) => makeNewAssetSet({ id: generateDataId(), ...extra });

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
  // ── Moving between areas ─────────────────────────────────────────────────
  // Only the area being left is asked (its handle's confirmLeave — see
  // areaHandles below):
  //  - Data Sources, Entities, Queries, Asset Sets: confirm; leaving drops the unsaved
  //    edits, since their editor unmounts.
  //  - Visualization: the Configurator's Save/Discard dialog. Always goes
  //    ahead.
  //  - Screens: nothing to ask. The canvas lives here in App, so unsaved
  //    edits are still there when you come back (with the Save button's
  //    amber dot). Opening or creating another screen still asks, since
  //    that does replace the canvas.
  // Operator ↔ Visualization is the same workspace component with a
  // different persona; the open Configurator editor still unmounts, so it
  // gets the same Save/Discard prompt.
  // Every Configuration Experience area runs with the 'configurator'
  // persona, so the title and rail follow wherever you are in it.
  const navigateTo = async (area) => {
    const persona = area.persona ?? 'configurator';
    const alreadyThere = area.view === currentView && persona === operatorPersona;
    if (!alreadyThere) {
      if (area.view !== currentView) {
        if (!(await confirmLeaveCurrentArea())) return;
      } else {
        await operatorWorkspaceRef.current?.resolveUnsavedChanges?.();
      }
      setCurrentView(area.view);
      setOperatorPersona(persona);
    }
    if (area.workspace === 'configurator') setLastConfigurationAreaId(area.id);
    setMenuOpen(false);
  };

  // The title-bar menu picks a workspace; the Configuration Experience
  // reopens on the area you last used in it.
  const openWorkspace = (workspaceId) => {
    const area = workspaceId === 'operator'
      ? APP_AREAS.find(a => a.id === 'operator')
      : APP_AREAS.find(a => a.id === lastConfigurationAreaId);
    navigateTo(area);
  };

  // A rail click. Clicking the area that's showing again hides or shows
  // its list panel, where the area has one to hide (Visualization).
  const selectRailArea = (areaId) => {
    const area = APP_AREAS.find(a => a.id === areaId);
    if (area === currentArea) {
      if (area.collapsesList) operatorWorkspaceRef.current?.toggleListPanel?.();
      return;
    }
    navigateTo(area);
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
  const [lastConfigurationAreaId, setLastConfigurationAreaId] = useState('visualization');
  // Whether Visualization's list panel is hidden (reported by
  // OperatorWorkspace), so its rail item can show that.
  const [visualizationListHidden, setVisualizationListHidden] = useState(false);
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

  // ── Phase 2 Data Layer ────────────────────────────────────────────────────
  // System-scoped (shared across all pages of this project):
  const [dataSources,      setDataSources]      = useState(() => loadDataSources());  // DataSource definitions
  const [entities,         setEntities]          = useState(() => loadEntities());  // Entity definitions (schema + rows)
  const entitiesWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger entity-data save
  const dataSourcesWorkspaceRef = React.useRef(null);
  const queriesWorkspaceRef = React.useRef(null);
  const assetSetsWorkspaceRef = React.useRef(null);
  const operatorWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger a type's display template save, configurator persona only
  // Whether the open area has unsaved changes — every area with something
  // to save publishes here. Drives the Save button's amber marker.
  const hasUnsavedChanges = useHasUnsavedChanges();
  const [operatorSaveAvailable, setOperatorSaveAvailable] = useState(false); // whether a type is currently selected (Now area's Types tab) — mirrors the same static, per-context enablement pattern the other workspaces already use, not new dirty-tracking

  React.useEffect(() => {
    saveOperatorNavigation({ currentView, operatorPersona, selectedModel });
  }, [currentView, operatorPersona, selectedModel]);
  const [queries,          setQueries]          = useState(() => loadQueries());  // Query definitions
  // Asset sets: named lists of assets from a model (model/assetSets.js).
  // Held here with the other definitions so Screens can read them too.
  const assetSets = useStoredDefinitions({ load: loadAssetSets, save: saveAssetSets, makeNew: makeAssetSet });

  // The Screens editor: the saved screens, the page on the canvas and
  // everything done to it (see designer/screens/useScreenEditor).
  const screens = useScreenEditor({ queries });

  // Every area's handle, by view: save() for the title-bar Save, and
  // confirmLeave() before navigating away (true, or a promise of true, to
  // go ahead). The workspaces expose theirs through refs; the Screens
  // editor's state lives here, so its handle is built here.
  const screensHandle = { save: screens.savePage, confirmLeave: () => true };
  const areaHandles = {
    screens: { current: screensHandle },
    datasources: dataSourcesWorkspaceRef,
    entities: entitiesWorkspaceRef,
    queries: queriesWorkspaceRef,
    assetsets: assetSetsWorkspaceRef,
    operator: operatorWorkspaceRef,
  };
  const confirmLeaveCurrentArea = async () => (await areaHandles[currentView]?.current?.confirmLeave?.()) ?? true;
  const currentArea = findArea(currentView, operatorPersona);
  const currentWorkspace = WORKSPACES.find(w => w.id === currentArea?.workspace) ?? WORKSPACES[0];

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
            {`Next Gen | ${currentWorkspace.label} ▾`}
          </span>
          {menuOpen && (
            <div className="app-titlebar-dropdown">
              {WORKSPACES.map(workspace => (
                <div
                  key={workspace.id}
                  className={`app-titlebar-dropdown-item${workspace === currentWorkspace ? ' active' : ''}`}
                  onClick={() => openWorkspace(workspace.id)}
                >
                  {workspace.label}
                </div>
              ))}
              <div className="app-titlebar-dropdown-note">Areas are on the left rail.</div>
            </div>
          )}
        </div>
        {/* The industry model drives the Operator, Visualization, Screens
            (its Data tab and Create wizard) and Asset Sets. The other areas
            don't use it, so there it's shown dimmed and can't be opened. */}
        {(() => {
          const modelApplies = !!currentArea?.usesModel;
          return (
          <div
            className={`app-titlebar-model-switcher${modelApplies ? '' : ' app-titlebar-model-switcher--inactive'}`}
            ref={modelMenuRef => {
              if (modelMenuRef) {
                modelMenuRef.onmouseleave = () => setModelMenuOpen(false);
              }
            }}
          >
            <div
              className="app-titlebar-model-trigger"
              onClick={() => { if (modelApplies) setModelMenuOpen(o => !o); }}
              title={modelApplies ? 'Switch model' : 'The model isn\'t used in this area yet'}
            >
              <span className="app-titlebar-title app-titlebar-model-pipe">|</span>
              <span className="app-titlebar-title app-titlebar-model-label">
                {availableModels.find(m => m.id === selectedModel)?.label ?? selectedModel} ▾
              </span>
            </div>
            {modelMenuOpen && modelApplies && (
              <div className="app-titlebar-dropdown">
                {availableModels.map(m => (
                  <div
                    key={m.id}
                    className={`app-titlebar-dropdown-item${selectedModel === m.id ? ' active' : ''}`}
                    onClick={async () => {
                      setModelMenuOpen(false);
                      // Switching model replaces what the open area shows,
                      // so it gets the same leave check as navigating away.
                      if (m.id !== selectedModel && !(await confirmLeaveCurrentArea())) return;
                      setSelectedModel(m.id);
                    }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          );
        })()}
        <div className="app-titlebar-right-cluster">
        {currentArea?.showsLaunch && (
          <button
            onClick={() => {
              if (!screens.activePageId) {
                window.alert('Save this screen first, then Launch will open its runtime view in a new tab.');
                return;
              }
              // A screen about a type opens on the asset "Preview as" shows.
              const asset = screens.chosenPreviewAssetId ? `&asset=${encodeURIComponent(screens.chosenPreviewAssetId)}` : '';
              const url = `${window.location.origin}${window.location.pathname}?runtime=${screens.activePageId}${asset}`;
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
        {!currentArea?.hideSave && (() => {
          // What Save does and says comes from the area (shell/appAreas.js);
          // areas with nothing to save show it disabled. (Save used to fall
          // through to the screen save in those areas, which is how phantom
          // screens got created.)
          const ctx = { hasUnsavedChanges, activePageId: screens.activePageId, operatorSaveAvailable };
          const save = currentArea?.save;
          const enabled = !!save && (save.enabled ? save.enabled(ctx) : true);
          const title = save ? save.title(ctx) : 'Nothing to save on this screen';
          return (
            <button
              onClick={() => {
                if (!enabled) return;
                areaHandles[currentView]?.current?.save();
              }}
              disabled={!enabled}
              title={title}
              style={{
                marginRight: 14,
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.4,
              }}
            >
              💾 Save
              {/* Unsaved marker — same amber dot convention as a modified
                  editor tab. */}
              {save && hasUnsavedChanges && (
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
        {/* The Configuration Experience's rail lives here, outside its
            areas, so it stays put while you move between them. The
            Operator Experience's rail is drawn inside OperatorWorkspace.
            The row is always here, so switching workspace doesn't remount
            the area beside it. */}
        <div className="app-area-row">
        {currentWorkspace.id === 'configurator' && (
          <AreaRail
            groups={railGroupsFor('configurator')}
            activeId={currentArea?.id}
            hidden={!!currentArea?.collapsesList && visualizationListHidden}
            onSelect={selectRailArea}
          />
        )}
        <div className="app-area-content">
        {currentView === 'widgets' ? (
          <WidgetsWorkspace />

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

        ) : currentView === 'assetsets' ? (
          <AssetSetsWorkspace
            ref={assetSetsWorkspaceRef}
            assetSets={assetSets.items}
            selectedModel={selectedModel}
            onAdd={assetSets.add}
            onUpdate={assetSets.update}
            onDelete={assetSets.remove}
          />

        ) : currentView === 'scripts' ? (
          <ScriptsWorkspace />

        ) : currentView === 'operator' ? (
          <OperatorWorkspace
            ref={operatorWorkspaceRef}
            selectedModel={selectedModel}
            operatorPersona={operatorPersona}
            onSaveAvailabilityChange={setOperatorSaveAvailable}
            onListPanelHiddenChange={setVisualizationListHidden}
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
          <ScreensWorkspace editor={screens} queries={queries} selectedModel={selectedModel} />
        )}
        </div>
        </div>
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
