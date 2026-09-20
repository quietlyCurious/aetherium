// OperatorWorkspace.jsx — the Operator/Configurator shell
//
// What's left here after the refactor: loading a model's data, and
// OperatorWorkspaceInner, which owns every piece of state the interface
// shares and arranges the panels into slots. Everything it renders lives
// in ./operator/ — see docs/CODE_MAP.html for how the pieces fit.
//
// The concept, for context: a next-gen Operator interface built around
// four zones — Now (the current state of every line, always visible),
// Attention (what needs the operator right now), Investigate (signal →
// interpretation → recommendation → evidence for whatever's selected) and
// Work (tasks, created by hand or recorded by AI) — with AI-originated
// content marked by a small "AI" pill wherever it appears rather than
// confined to a chat window. That last part is the actual difference from
// a traditional HMI bolted to a chatbot.
//
// Still a prototype in one important way: all data is generated and
// loaded from public/data/<model>/, and nothing is wired to OpHub, real
// queries or the data-binding system. Settings persist to localStorage
// only.
import { forwardRef, useState, useRef, useImperativeHandle, useEffect, useCallback, useMemo } from 'react';
import { custom as customDialog } from 'devextreme/ui/dialog';
import { unsavedChangesStore } from './unsavedChangesStore';
import { Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { loadTypeDisplayTemplates, saveTypeDisplayTemplates } from './typeDisplayTemplatesStorage';
import { loadRelatedAssetsTemplates, saveRelatedAssetsTemplates } from './relatedAssetsTemplatesStorage';
import { loadAllAssetsTemplate, saveAllAssetsTemplate } from './allAssetsTemplateStorage';
import { loadNowSelection, saveNowSelection } from './nowSelectionStorage';
import { loadModelRegistry, getModelDataFiles, MODEL_SHAPES } from './modelRegistry';
import { loadTypePropertyConfigs, saveTypePropertyConfigs } from './typePropertyConfigsStorage';
import { loadTypeRelatedAssetConfigs, saveTypeRelatedAssetConfigs } from './typeRelatedAssetConfigsStorage';
import { loadAssetDisplayTemplates, saveAssetDisplayTemplates } from './assetDisplayTemplatesStorage';
import { loadAssetPropertyConfigs, saveAssetPropertyConfigs } from './assetPropertyConfigsStorage';
import { loadAssetRelatedAssetConfigs, saveAssetRelatedAssetConfigs } from './assetRelatedAssetConfigsStorage';
import { loadAssetRelatedAssetsTemplates, saveAssetRelatedAssetsTemplates } from './assetRelatedAssetsTemplatesStorage';
import { loadTypePropertyOrders, saveTypePropertyOrders } from './typePropertyOrderStorage';
import { loadAssetPropertyOrders, saveAssetPropertyOrders } from './assetPropertyOrderStorage';
import { loadTypeRelatedAssetOrders, saveTypeRelatedAssetOrders } from './typeRelatedAssetOrderStorage';
import { loadAssetRelatedAssetOrders, saveAssetRelatedAssetOrders } from './assetRelatedAssetOrderStorage';
import notify from 'devextreme/ui/notify';
import { assetTypeIdOf, buildTypeList, getAssetPathLabel, deslugifyType } from './operator/model/assetQueries';
import { activateLoadedModel, ATTENTION_ITEMS, INITIAL_WORK_ITEMS, CURRENT_MODEL, CURRENT_ASSET_MAP, CURRENT_ASSET_DATA, PROPERTY_LABELS, CURRENT_MODEL_SHAPE } from './operator/model/modelData';
import { normalizedLayout, UNDO_TOAST_MS, computeAssetCustomizations, assetCustomizationStore, EMPTY_CUSTOMIZATIONS } from './operator/settings/customizations';
import { displayOrderStore, EMPTY_DISPLAY_ORDERS } from './operator/settings/displayOrder';
import { PROPERTY_VIEW_MODE_DEFAULT, KPI_VIEW_MODE_ITEMS } from './operator/settings/propertyDisplay';
import '@xyflow/react/dist/style.css';
import { CONTACTS_SEED } from './operator/chrome/ContactsPanel';
import { NavRail } from './operator/chrome/NavRail';
import { RightRail } from './operator/chrome/RightRail';
import { SidePanel } from './operator/chrome/SidePanel';
import { NowAssetDetail } from './operator/configurator/NowAssetDetail';
import { NowAssetTreePanel } from './operator/configurator/NowAssetTreePanel';
import { AttentionPanel } from './operator/operatorViews/AttentionPanel';
import { InvestigatePanel } from './operator/operatorViews/InvestigatePanel';
import { IssueMapOverlay } from './operator/operatorViews/IssueMap';
import { NowStrip } from './operator/operatorViews/NowStrip';
import { OperatorAssetDetail, OperatorAssetTreePanel } from './operator/operatorViews/OperatorAssetsView';
import { TaskDetailPanel } from './operator/operatorViews/TaskDetailPanel';
import { WorkListPanel } from './operator/operatorViews/WorkListPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Nav rail — Gmail-style collapsible rail (icon+label+count expanded,
// icon+dot collapsed), sitting as its own element alongside the existing
// Attention panel and Work/Chat/AI tabs — not a replacement for either.
// "New" is derived from data already on hand rather than separate state:
//   - Attention: items that surfaced within the last 15 minutes
//   - Work: not-yet-done items the AI created (source: 'ai')
// ─────────────────────────────────────────────────────────────────────────────

// 30 min, not 15 — the nextgen dataset spans a full 8-hour shift rather
// than a 2-hour window, so "recent" needs a wider bar for this badge to
// mean anything (at 15 min, nothing in the new data would ever qualify).
const NEW_ATTENTION_THRESHOLD_MINUTES = 30;

const OperatorWorkspace = forwardRef(function OperatorWorkspace({ selectedModel = 'refinery', operatorPersona = 'operator', onSaveAvailabilityChange, initialDeepLink, onNavigate, onNavigateToConfig }, ref) {
  const [dataState, setDataState] = useState({ loaded: false, error: null, loadedModel: null });
  // Holds whatever "save the current thing" function the deepest-nested
  // relevant component last registered (currently: NowTypeMainPreview's type
  // display template save) — a ref rather than state since updating it
  // shouldn't itself trigger a re-render here.
  const activeSaveHandlerRef = useRef(null);
  // Filled in by OperatorWorkspaceInner: resolves any unsaved Configurator
  // changes (Save/Discard prompt) before App.js navigates away — switching
  // model, persona or app area all unmount the editor holding them.
  const unsavedGuardRef = useRef(null);

  useImperativeHandle(ref, () => ({
    save: () => activeSaveHandlerRef.current?.(),
    resolveUnsavedChanges: () => unsavedGuardRef.current?.() ?? Promise.resolve(),
  }), []);

  useEffect(() => {
    let cancelled = false;
    setDataState({ loaded: false, error: null, loadedModel: null });
    let files = [];
    let model = null;
    loadModelRegistry()
      .then(models => {
        model = models.find(m => m.id === selectedModel);
        if (!model) throw new Error(`model "${selectedModel}" is not listed in /data/models.json`);
        files = getModelDataFiles(model);
        return Promise.all(
          files.map(([, url]) =>
            fetch(url).then(r => {
              if (!r.ok) throw new Error(`${url} — ${r.status}`);
              return r.json();
            })
          )
        );
      })
      .then(results => {
        if (cancelled) return;
        activateLoadedModel(model, files, results);
        setDataState({ loaded: true, error: null, loadedModel: selectedModel });
      })
      .catch(err => {
        if (!cancelled) setDataState({ loaded: false, error: err.message, loadedModel: null });
      });
    return () => { cancelled = true; };
  }, [selectedModel]);

  if (dataState.error) {
    return (
      <div className="op-workspace-loading op-workspace-loading--error">
        Couldn't load operator data ({dataState.error}). Check that /data/models.json lists this model and that its /data/{selectedModel}/*.json files are present in the public folder.
      </div>
    );
  }
  if (!dataState.loaded || dataState.loadedModel !== selectedModel) {
    return <div className="op-workspace-loading">Loading operator data…</div>;
  }

  // key includes both selectedModel and operatorPersona — either one changing
  // forces a full remount. The inner component's own state (selected
  // attention item, selected Now asset, railMode's default, etc.) is
  // initialized based on which model/persona is active, and a stale
  // selection (an id from the other model, or a railMode hidden under the
  // new persona) would otherwise survive.
  return (
    <OperatorWorkspaceInner
      unsavedGuardRef={unsavedGuardRef}
      key={`${selectedModel}-${operatorPersona}`}
      operatorPersona={operatorPersona}
      activeSaveHandlerRef={activeSaveHandlerRef}
      onSaveAvailabilityChange={onSaveAvailabilityChange}
      initialDeepLink={initialDeepLink}
      onNavigate={onNavigate}
      onNavigateToConfig={onNavigateToConfig}
    />
  );
});

export default OperatorWorkspace;

// Shared between Visualization's activeTabIndex (0/1/2) and the Assets
// area's own tab (name-based) — both the deep-link URL scheme and
// NowTypeMainPreview's tab order agree on this same properties/related/
// all sequence, so one mapping serves both.
const DEEP_LINK_TAB_NAMES = ['properties', 'related', 'all'];

function OperatorWorkspaceInner({ operatorPersona, activeSaveHandlerRef, unsavedGuardRef, onSaveAvailabilityChange, initialDeepLink, onNavigate, onNavigateToConfig }) {
  // A deep link (checked against the current persona) seeds this fresh
  // mount's initial selection. It's read once here, on mount, but it is
  // NOT necessarily fixed for the app's whole lifetime the way a URL-only
  // deep link would be — the gear icon on an Operator asset box (see
  // handleNavigateToConfig below) sets a brand new deep link and switches
  // persona in the same action, and since a persona switch always
  // remounts this component fresh (see the key above), that new deep
  // link is exactly what this next mount reads. A deep link landing the
  // operator persona always opens directly on Assets rather than the
  // usual Attention default.
  const deepLinkAppliesHere = initialDeepLink?.persona === operatorPersona;
  const [railMode, setRailMode] = useState(
    operatorPersona === 'configurator' ? 'now' : (deepLinkAppliesHere ? 'assets' : 'attention')
  ); // 'now' | 'attention' | 'work' | 'assets' — drives both the list and detail slots; default depends on which rail items this persona can see
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const [issueMapExpanded, setIssueMapExpanded] = useState(false);
  const [selectedDetailLine, setSelectedDetailLine] = useState(null);
  const nowSectionRef = useRef(null);
  const [nowSectionBottom, setNowSectionBottom] = useState(160);
  useEffect(() => {
    function measure() {
      if (nowSectionRef.current) {
        setNowSectionBottom(nowSectionRef.current.getBoundingClientRect().bottom);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const [selectedAttentionId, setSelectedAttentionId] = useState(
    (ATTENTION_ITEMS.find(i => i.attentionState === 'investigate') || ATTENTION_ITEMS[0])?.id ?? null
  );
  const [evidenceView, setEvidenceView] = useState('line');
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(INITIAL_WORK_ITEMS[0]?.id ?? null);
  const [selectedNowThing, setSelectedNowThing] = useState(() =>
    (deepLinkAppliesHere && operatorPersona === 'configurator')
      ? { kind: 'type', id: initialDeepLink.id }
      : loadNowSelection(CURRENT_MODEL)
  );
  // Separate selection state for the new Operator-only Assets area — a
  // real asset instance, not a type, so it can't share selectedNowThing
  // (which is Visualization's own type-based selection).
  const [selectedAssetId, setSelectedAssetId] = useState(
    (deepLinkAppliesHere && operatorPersona === 'operator') ? initialDeepLink.id : null
  );
  // Lifted up from OperatorAssetDetail (previously its own local state) so
  // it can participate in the deep-link URL alongside selectedAssetId.
  const [selectedAssetTab, setSelectedAssetTab] = useState(
    (deepLinkAppliesHere && operatorPersona === 'operator' && DEEP_LINK_TAB_NAMES.includes(initialDeepLink.tab))
      ? initialDeepLink.tab
      : 'properties'
  );
  useEffect(() => {
    onSaveAvailabilityChange?.(selectedNowThing?.kind === 'type' || selectedNowThing?.kind === 'asset');
  }, [selectedNowThing]);
  useEffect(() => {
    saveNowSelection(CURRENT_MODEL, selectedNowThing);
  }, [selectedNowThing]);
  // Same DevExtreme requirement as the properties-tab Splitter below — the
  // Types tab's DataListGrid needs an explicit updateDimensions() call
  // whenever this outer left/center/right Splitter is dragged, or its
  // columns can be left oversized (or undersized) relative to the new
  // panel width.
  const nowTreePanelRef = useRef(null);
  const outerSplitterResizeFrame = useRef(null);
  const handleOuterSplitterResize = () => {
    cancelAnimationFrame(outerSplitterResizeFrame.current);
    outerSplitterResizeFrame.current = requestAnimationFrame(() => {
      nowTreePanelRef.current?.updateDimensions?.();
    });
  };
  // Per-type property visibility overrides (always/sometimes/never), keyed
  // by type id then property key. Only holds an entry once a user actually
  // changes a property's visibility for that type — otherwise the default
  // ("always") is computed fresh each render, not stored. Persisted
  // immediately on every change (no separate Save step, since the
  // icon-cycling buttons that set these apply instantly).
  const [typePropertyConfigs, setTypePropertyConfigs] = useState(() => loadTypePropertyConfigs());
  useEffect(() => {
    saveTypePropertyConfigs(typePropertyConfigs);
  }, [typePropertyConfigs]);
  // Per-type related-asset visibility overrides (always/never) for the
  // Related Assets tab — same auto-save-on-change pattern as
  // typePropertyConfigs above.
  const [typeRelatedAssetConfigs, setTypeRelatedAssetConfigs] = useState(() => loadTypeRelatedAssetConfigs());
  useEffect(() => {
    saveTypeRelatedAssetConfigs(typeRelatedAssetConfigs);
  }, [typeRelatedAssetConfigs]);
  // Per-type display template (view mode, flow direction, wrap, align
  // content) — persisted to localStorage explicitly via a Save action, not
  // auto-saved on every click. Hydrated once on mount so it survives a
  // page refresh.
  const [typeDisplayTemplates, setTypeDisplayTemplates] = useState(() => loadTypeDisplayTemplates());
  const handleSaveTypeDisplayTemplate = (typeId, template) => {
    setTypeDisplayTemplates(prev => {
      const next = { ...prev, [typeId]: template };
      saveTypeDisplayTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Per-type Related Assets template (Cards/Diagram, Auto/Manual, all the
  // diagram settings, and manual positions if any) — same persistence
  // shape and Save-button wiring as typeDisplayTemplates above, just a
  // separate saved thing per the "two saved views per type" split.
  const [relatedAssetsTemplates, setRelatedAssetsTemplates] = useState(() => loadRelatedAssetsTemplates());
  const handleSaveRelatedAssetsTemplate = (typeId, template) => {
    setRelatedAssetsTemplates(prev => {
      const next = { ...prev, [typeId]: template };
      saveRelatedAssetsTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Per-asset overrides — the Now area's Assets tab equivalents of the four
  // per-type blocks above, keyed by real asset id instead of type id. A
  // specific asset only ever has an entry here once a user has actually
  // saved/changed something for that asset; AssetCard (and the
  // Details-panel grids above) are what actually apply the asset-over-type
  // fallback at render time — these four are pure storage, identical
  // persistence shape to their type-level counterparts.
  const [assetPropertyConfigs, setAssetPropertyConfigs] = useState(() => loadAssetPropertyConfigs());
  useEffect(() => {
    saveAssetPropertyConfigs(assetPropertyConfigs);
  }, [assetPropertyConfigs]);
  const [assetRelatedAssetConfigs, setAssetRelatedAssetConfigs] = useState(() => loadAssetRelatedAssetConfigs());
  useEffect(() => {
    saveAssetRelatedAssetConfigs(assetRelatedAssetConfigs);
  }, [assetRelatedAssetConfigs]);
  const [assetDisplayTemplates, setAssetDisplayTemplates] = useState(() => loadAssetDisplayTemplates());
  const handleSaveAssetDisplayTemplate = (assetId, template) => {
    setAssetDisplayTemplates(prev => {
      // Saving an asset whose layout is identical to its type's and which
      // sets no per-property visuals of its own stores nothing (and clears
      // any older entry), rather than a copy of the type's layout. A copy
      // would look the same today but silently stop this asset from
      // following later changes to its type — the same reason Revert to
      // type removes the entry instead of overwriting it.
      const asset = CURRENT_ASSET_MAP[assetId];
      const typeTemplate = asset ? typeDisplayTemplates[assetTypeIdOf(asset)] : undefined;
      const matchesType = asset
        && Object.keys(template.propertyViewModes || {}).length === 0
        && normalizedLayout(template) === normalizedLayout(typeTemplate);
      const next = { ...prev };
      if (matchesType) delete next[assetId]; else next[assetId] = template;
      saveAssetDisplayTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // Display orders (properties and related assets, per type and per
  // asset) — applied immediately and auto-saved, like visibility. See
  // "Display order" near the top of this file.
  const [typePropertyOrders, setTypePropertyOrders] = useState(() => loadTypePropertyOrders());
  useEffect(() => { saveTypePropertyOrders(typePropertyOrders); }, [typePropertyOrders]);
  const [assetPropertyOrders, setAssetPropertyOrders] = useState(() => loadAssetPropertyOrders());
  useEffect(() => { saveAssetPropertyOrders(assetPropertyOrders); }, [assetPropertyOrders]);
  const [typeRelatedAssetOrders, setTypeRelatedAssetOrders] = useState(() => loadTypeRelatedAssetOrders());
  useEffect(() => { saveTypeRelatedAssetOrders(typeRelatedAssetOrders); }, [typeRelatedAssetOrders]);
  const [assetRelatedAssetOrders, setAssetRelatedAssetOrders] = useState(() => loadAssetRelatedAssetOrders());
  useEffect(() => { saveAssetRelatedAssetOrders(assetRelatedAssetOrders); }, [assetRelatedAssetOrders]);
  // One setter for all four: kind 'property' | 'related', level 'type' |
  // 'asset'; a null order removes the entry (back to the type's order, or
  // for a type, the default order).
  const setDisplayOrder = (kind, level, id, order) => {
    const setter = kind === 'property'
      ? (level === 'asset' ? setAssetPropertyOrders : setTypePropertyOrders)
      : (level === 'asset' ? setAssetRelatedAssetOrders : setTypeRelatedAssetOrders);
    setter(prev => {
      const next = { ...prev };
      if (order && order.length) next[id] = order; else delete next[id];
      return next;
    });
  };
  const setDisplayOrderRef = useRef(setDisplayOrder);
  setDisplayOrderRef.current = setDisplayOrder;
  const stableSetDisplayOrder = useCallback((...args) => setDisplayOrderRef.current(...args), []);
  useEffect(() => {
    displayOrderStore.set({
      typeProperty: typePropertyOrders,
      assetProperty: assetPropertyOrders,
      typeRelated: typeRelatedAssetOrders,
      assetRelated: assetRelatedAssetOrders,
      setOrder: stableSetDisplayOrder,
    });
  }, [typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, stableSetDisplayOrder]);
  useEffect(() => () => displayOrderStore.set(EMPTY_DISPLAY_ORDERS), []);
  const [assetRelatedAssetsTemplates, setAssetRelatedAssetsTemplates] = useState(() => loadAssetRelatedAssetsTemplates());
  const handleSaveAssetRelatedAssetsTemplate = (assetId, template) => {
    setAssetRelatedAssetsTemplates(prev => {
      const next = { ...prev, [assetId]: template };
      saveAssetRelatedAssetsTemplates(next);
      return next;
    });
    notify('Template saved', 'success', 2000);
  };
  // The single global All Assets template — not keyed by type, since this
  // is one shared view regardless of which type is selected. Hydrated from
  // storage on mount, same as the two per-type templates above, including
  // the hiddenAssetIds state that already existed — it just wasn't
  // persisted before now.
  const [allAssetsTemplate, setAllAssetsTemplate] = useState(() => loadAllAssetsTemplate());
  const handleSaveAllAssetsTemplate = (template) => {
    setAllAssetsTemplate(template);
    saveAllAssetsTemplate(template);
    notify('Template saved', 'success', 2000);
  };
  const nowTypeList = useMemo(() => buildTypeList(CURRENT_ASSET_DATA), []);

  const [rightPanelMode, setRightPanelMode] = useState('chat'); // 'chat' | 'ai' | 'details' — drives the right rail + right panel
  const [rightPanelHidden, setRightPanelHidden] = useState(true);
  const [contacts, setContacts] = useState(CONTACTS_SEED);
  const [activeContactId, setActiveContactId] = useState(null);
  // Which Details-panel tab (Properties/Related Assets/All Assets) is
  // active — lives up here (rather than inside NowTypeDetailsList itself,
  // which remounts fresh via key={typeId} on every type switch) so
  // switching types doesn't silently reset back to the first tab.
  const [activeTabIndex, setActiveTabIndex] = useState(
    (deepLinkAppliesHere && operatorPersona === 'configurator' && DEEP_LINK_TAB_NAMES.includes(initialDeepLink.tab))
      ? DEEP_LINK_TAB_NAMES.indexOf(initialDeepLink.tab)
      : 0
  );
  // Which Now-area left-panel tab (Types/Assets) is active — same lifted-
  // state reasoning as activeTabIndex above, just for the sibling tab
  // switcher one panel over.
  const [nowLeftTabIndex, setNowLeftTabIndex] = useState(() => (selectedNowThing?.kind === 'asset' ? 1 : 0));
  // Keeps the URL in sync with whatever's currently selected, so the
  // address bar always reflects a link back to the current view. Only
  // fires while the user is actually in a deep-linkable area — a type
  // selected in Visualization, or an asset selected in the new Assets
  // area — since Attention/Work have no deep-link scheme of their own
  // and simply leave the URL as it was.
  useEffect(() => {
    if (!onNavigate) return;
    if (operatorPersona === 'configurator' && selectedNowThing?.kind === 'type') {
      onNavigate({ id: selectedNowThing.id, tab: DEEP_LINK_TAB_NAMES[activeTabIndex] });
    } else if (operatorPersona === 'operator' && railMode === 'assets' && selectedAssetId) {
      onNavigate({ id: selectedAssetId, tab: selectedAssetTab });
    }
  }, [operatorPersona, selectedNowThing, activeTabIndex, railMode, selectedAssetId, selectedAssetTab, onNavigate]);
  // Click-to-navigate for a box's name, wherever AssetCard's
  // title renders (Properties/Related Assets/All Assets, both Cards and
  // Diagram) — always jumps to that thing's own Properties view. Every
  // box already carries relatedTypeId (the type) and
  // The left tree's own selection callback — clamps activeTabIndex back to
  // a valid tab whenever the newly-selected thing is an asset and the
  // Details panel was sitting on tab 2 (All Assets), which only ever
  // exists for a type (a shared, model-wide view with no per-asset
  // variant) — without this, selecting an asset while on that tab would
  // leave the tab switcher pointed at an index NowTypeDetailsList no
  // longer renders for assets at all.
  const handleSelectNowThing = async (thing) => {
    if (thing?.kind !== selectedNowThing?.kind || thing?.id !== selectedNowThing?.id) {
      await resolveUnsavedChanges();
    }
    setSelectedNowThing(thing);
    setNowLeftTabIndex(thing?.kind === 'asset' ? 1 : 0);
    if (thing?.kind === 'asset' && activeTabIndex === 2) {
      setActiveTabIndex(0);
    }
  };

  // relatedTypeExampleAssetId (the concrete asset whose real values the
  // box is showing), so Visualization navigates by type — its whole
  // mental model is type-level — while the Assets area navigates by that
  // concrete asset id, matching what's actually on screen in the box
  // rather than introducing a second, different notion of "the asset
  // this box represents."
  const handleNavigateToType = async ({ relatedTypeId }) => {
    if (selectedNowThing?.kind !== 'type' || selectedNowThing?.id !== relatedTypeId) {
      await resolveUnsavedChanges();
    }
    setSelectedNowThing({ kind: 'type', id: relatedTypeId });
    setNowLeftTabIndex(0);
    setActiveTabIndex(0);
  };
  const handleNavigateToAsset = ({ relatedTypeExampleAssetId }) => {
    setSelectedAssetId(relatedTypeExampleAssetId);
    setSelectedAssetTab('properties');
  };
  // The gear icon on an Operator asset box — unlike the two handlers
  // above, this one crosses personas entirely (Operator's Assets area to
  // Visualization's own Properties tab for that asset's type), which
  // needs App.js's own persona state, not anything owned here. Reuses the
  // exact same deep-link-on-fresh-mount mechanism the URL scheme already
  // relies on: onNavigateToConfig sets a new deep link and switches
  // persona together, and the fresh OperatorWorkspaceInner mount that
  // persona switch triggers reads that deep link as its own initial
  // state, landing exactly on the requested type's Properties tab.
  const handleNavigateToConfig = ({ relatedTypeId }) => {
    onNavigateToConfig?.({ id: relatedTypeId, tab: 'properties' });
  };
  // Mirrors PropertyTilesView's current view mode, purely for display in
  // the Properties list's "Visual" column in the Details panel — the
  // actual view-mode control lives in the center preview (a sibling, not
  // a parent/child of the list now that the two are split across panels),
  // reported up via onViewModeChange whenever it changes.
  const [rightPanelViewMode, setRightPanelViewMode] = useState('all');
  // Per-property visual overrides (unsaved draft) and the currently
  // selected property — both shared between the center preview (tiles)
  // and the Details panel (Visual column / row selection), which are
  // siblings, same reasoning as rightPanelViewMode above. The draft is
  // tagged with the entity it belongs to, so neither side ever reads a
  // map left over from a previous selection; the preview re-seeds it from
  // the saved template whenever a new type/asset is selected, and the
  // title-bar Save persists it as part of that display template.
  const [propertyVisualDraft, setPropertyVisualDraft] = useState({ entityId: null, modes: {} });
  const [selectedPropertyKey, setSelectedPropertyKey] = useState(null);
  // Same idea for the Related Assets tab: the Details panel's selected row
  // (a related-asset row key) and the box it highlights in the preview.
  const [selectedRelatedKey, setSelectedRelatedKey] = useState(null);
  const propertyVisuals = {
    entityId: propertyVisualDraft.entityId,
    modes: propertyVisualDraft.modes,
    setModes: (entityId, modes) => setPropertyVisualDraft({ entityId, modes }),
    selectedKey: selectedPropertyKey,
    setSelectedKey: setSelectedPropertyKey,
    selectedRelatedKey,
    setSelectedRelatedKey,
  };
  // A selected property/related row belongs to the selected type/asset —
  // drop it when that changes rather than highlighting a same-keyed row
  // elsewhere.
  useEffect(() => {
    setSelectedPropertyKey(null);
    setSelectedRelatedKey(null);
  }, [selectedNowThing?.kind, selectedNowThing?.id]);
  // All Assets' per-asset show/hide choice — shared between the visibility
  // tree (Details panel) and the diagram (center preview), same reasoning
  // as rightPanelViewMode above. Hydrated from the saved All Assets
  // template if one exists (stored as a plain array there, since Sets
  // aren't JSON-serializable); every asset visible by default otherwise.
  const [hiddenAssetIds, setHiddenAssetIds] = useState(() => new Set(allAssetsTemplate?.hiddenAssetIds ?? []));
  const handleToggleAssetVisibility = (assetId) => {
    setHiddenAssetIds(current => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });
  };

  // ─── Unsaved changes ─────────────────────────────────────────────────
  // Anything that unmounts the open editor (selecting another type or
  // asset, switching Details tabs, and — via unsavedGuardRef — App.js
  // switching model, persona or app area) first asks whether to keep its
  // unsaved changes. Save or Discard only, no Cancel: every one of those
  // triggers has already updated its own widget's selection by the time
  // this runs (the tree, the grid, the tab strip), and walking each of
  // them back would be fragile. Dismissing the dialog (Esc) keeps the
  // work — it saves — since losing edits is the worse surprise.
  const describeOpenEditor = () => {
    if (activeTabIndex === 2) return 'the All Assets view';
    const tab = activeTabIndex === 1 ? 'Related Assets' : 'display';
    if (selectedNowThing?.kind === 'asset') return `${getAssetPathLabel(selectedNowThing.id)} (${tab})`;
    const typeName = nowTypeList.find(t => t.id === selectedNowThing?.id)?.name ?? 'this type';
    return `the ${typeName} type (${tab})`;
  };
  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Drafts that live up here rather than inside the editor survive its
  // unmount, so Discard has to reset them explicitly — otherwise
  // reopening the same tab would show the discarded draft as if saved.
  const discardLiftedDrafts = () => {
    setPropertyVisualDraft({ entityId: null, modes: {} });
    setHiddenAssetIds(new Set(allAssetsTemplate?.hiddenAssetIds ?? []));
  };
  // One prompt at a time: a single click can fire more than one of the
  // guarded handlers (DataListGrid reports a row click through both its
  // selection-changed and row-click events), and each must wait on the
  // same answer rather than stacking a second dialog.
  const pendingUnsavedPromptRef = useRef(null);
  const resolveUnsavedChanges = () => {
    if (pendingUnsavedPromptRef.current) return pendingUnsavedPromptRef.current;
    if (operatorPersona !== 'configurator' || !unsavedChangesStore.isDirty()) return Promise.resolve();
    // Wrapped in a native Promise: DevExtreme's dialog returns its own
    // Deferred, which has then() but no finally().
    pendingUnsavedPromptRef.current = Promise.resolve(customDialog({
      title: 'Unsaved changes',
      messageHtml: `<div style="max-width:360px">You have unsaved changes to ${escapeHtml(describeOpenEditor())}.</div>`,
      buttons: [
        { text: 'Save', type: 'default', stylingMode: 'contained', onClick: () => 'save' },
        { text: 'Discard', stylingMode: 'outlined', onClick: () => 'discard' },
      ],
    }).show()).then(result => {
      if (result === 'discard') discardLiftedDrafts();
      else activeSaveHandlerRef.current?.();
      unsavedChangesStore.setDirty(false);
    }).finally(() => { pendingUnsavedPromptRef.current = null; });
    return pendingUnsavedPromptRef.current;
  };
  if (unsavedGuardRef) unsavedGuardRef.current = resolveUnsavedChanges;

  const handleActiveTabIndexChange = async (index) => {
    if (index === activeTabIndex) return;
    await resolveUnsavedChanges();
    setActiveTabIndex(index);
  };

  // Browser refresh/close — the only exit the in-app prompt can't catch.
  useEffect(() => {
    const handler = e => {
      if (operatorPersona === 'configurator' && unsavedChangesStore.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [operatorPersona]);

  // ─── Undo for reverts ────────────────────────────────────────────────
  // Reverts apply immediately (no confirm dialog); instead, a toast offers
  // Undo for a few seconds. Each revert snapshots exactly the entries it
  // touches, and undo puts those entries back as they were — whole
  // per-asset entries, so an edit made to one of the same assets inside
  // that short window would be rolled back with it.
  const [undoToast, setUndoToast] = useState(null); // { id, message, undo }
  useEffect(() => {
    if (!undoToast) return undefined;
    const timer = setTimeout(() => setUndoToast(t => (t?.id === undoToast.id ? null : t)), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [undoToast]);
  const pickEntries = (map, ids) => {
    const snapshot = {};
    ids.forEach(id => { if (map?.[id] !== undefined) snapshot[id] = map[id]; });
    return snapshot;
  };
  const restoreEntries = (prev, ids, snapshot) => {
    const next = { ...prev };
    ids.forEach(id => { if (id in snapshot) next[id] = snapshot[id]; else delete next[id]; });
    return next;
  };

  // Which assets differ from their type (tree dots, Types-list counts,
  // title-row chips, per-property counts) — recomputed whenever any of the
  // eight stores changes, and published to assetCustomizationStore along
  // with the actions below. See computeAssetCustomizations.
  const assetCustomizations = useMemo(() => computeAssetCustomizations({
    typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates,
    assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates,
    typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, typeList: nowTypeList,
  }), [typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, typePropertyOrders, assetPropertyOrders, typeRelatedAssetOrders, assetRelatedAssetOrders, nowTypeList]);

  // Bumped whenever the selected asset's saved settings are reverted out
  // from under its open preview. The preview's editors (view mode, flow,
  // manual positions, Related Assets settings) only read their saved
  // template once, on mount, so this is part of NowTypeMainPreview's key
  // to remount it onto the type's settings — otherwise it would keep
  // showing, and a later Save would re-save, what was just reverted.
  const [nowPreviewRevision, setNowPreviewRevision] = useState(0);

  const omitKeys = (obj, ids) => {
    const next = { ...obj };
    ids.forEach(id => { delete next[id]; });
    return next;
  };

  // Whole-asset revert: drops every asset-level entry (display template,
  // property visibilities, related-asset visibilities, related-assets
  // template), so each asset follows its type completely again — including
  // any future type changes. Immediate and persisted, like the visibility
  // toggles, not staged for the title-bar Save (a revert that waited for
  // Save would be easy to lose); the Undo toast is the safety net.
  const revertAssetsToType = (assetIds) => {
    if (!assetIds.length) return;
    const snapshot = {
      display: pickEntries(assetDisplayTemplates, assetIds),
      relatedTemplates: pickEntries(assetRelatedAssetsTemplates, assetIds),
      propertyConfigs: pickEntries(assetPropertyConfigs, assetIds),
      relatedConfigs: pickEntries(assetRelatedAssetConfigs, assetIds),
      propertyOrders: pickEntries(assetPropertyOrders, assetIds),
      relatedOrders: pickEntries(assetRelatedAssetOrders, assetIds),
    };
    const selectedAffected = selectedNowThing?.kind === 'asset' && assetIds.includes(selectedNowThing.id) ? selectedNowThing.id : null;
    setAssetPropertyOrders(prev => omitKeys(prev, assetIds));
    setAssetRelatedAssetOrders(prev => omitKeys(prev, assetIds));
    setAssetDisplayTemplates(prev => { const next = omitKeys(prev, assetIds); saveAssetDisplayTemplates(next); return next; });
    setAssetRelatedAssetsTemplates(prev => { const next = omitKeys(prev, assetIds); saveAssetRelatedAssetsTemplates(next); return next; });
    setAssetPropertyConfigs(prev => omitKeys(prev, assetIds));
    setAssetRelatedAssetConfigs(prev => omitKeys(prev, assetIds));
    if (selectedAffected) {
      setPropertyVisualDraft({ entityId: selectedAffected, modes: {} });
      setNowPreviewRevision(r => r + 1);
    }
    setUndoToast({
      id: Date.now(),
      message: `${assetIds.length} asset${assetIds.length > 1 ? 's' : ''} now match${assetIds.length > 1 ? '' : 'es'} the type`,
      undo: () => {
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetRelatedAssetsTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.relatedTemplates); saveAssetRelatedAssetsTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, assetIds, snapshot.propertyConfigs));
        setAssetRelatedAssetConfigs(prev => restoreEntries(prev, assetIds, snapshot.relatedConfigs));
        setAssetPropertyOrders(prev => restoreEntries(prev, assetIds, snapshot.propertyOrders));
        setAssetRelatedAssetOrders(prev => restoreEntries(prev, assetIds, snapshot.relatedOrders));
        if (selectedAffected) {
          setPropertyVisualDraft({ entityId: selectedAffected, modes: snapshot.display[selectedAffected]?.propertyViewModes ?? {} });
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
  };

  // One property, many assets: drops just that property's visibility and
  // visual from each asset, leaving everything else each asset customized
  // alone. The selected asset's unsaved draft loses the key too, so the
  // Visual column and preview reflect it immediately without a remount.
  const revertPropertyToType = (assetIds, propertyKey) => {
    if (!assetIds.length) return;
    const snapshot = {
      display: pickEntries(assetDisplayTemplates, assetIds),
      propertyConfigs: pickEntries(assetPropertyConfigs, assetIds),
    };
    const selectedAffected = selectedNowThing?.kind === 'asset' && assetIds.includes(selectedNowThing.id) ? selectedNowThing.id : null;
    setAssetPropertyConfigs(prev => {
      const next = { ...prev };
      assetIds.forEach(id => {
        if (!next[id] || !(propertyKey in next[id])) return;
        const { [propertyKey]: _removed, ...rest } = next[id];
        if (Object.keys(rest).length) next[id] = rest; else delete next[id];
      });
      return next;
    });
    setAssetDisplayTemplates(prev => {
      const next = { ...prev };
      assetIds.forEach(id => {
        const modes = next[id]?.propertyViewModes;
        if (!modes || !(propertyKey in modes)) return;
        const { [propertyKey]: _removed, ...rest } = modes;
        next[id] = { ...next[id], propertyViewModes: rest };
      });
      saveAssetDisplayTemplates(next);
      return next;
    });
    if (selectedAffected) {
      setPropertyVisualDraft(prev => {
        if (prev.entityId !== selectedAffected || !(propertyKey in prev.modes)) return prev;
        const { [propertyKey]: _removed, ...rest } = prev.modes;
        return { entityId: prev.entityId, modes: rest };
      });
    }
    setUndoToast({
      id: Date.now(),
      message: `${PROPERTY_LABELS[propertyKey] || propertyKey} now matches the type on ${assetIds.length} asset${assetIds.length > 1 ? 's' : ''}`,
      undo: () => {
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, assetIds, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, assetIds, snapshot.propertyConfigs));
        // Only the reverted property goes back into the open asset's
        // draft — any other unsaved visual edits there are left alone.
        const restoredMode = selectedAffected ? snapshot.display[selectedAffected]?.propertyViewModes?.[propertyKey] : undefined;
        if (restoredMode) {
          setPropertyVisualDraft(prev => (prev.entityId === selectedAffected
            ? { entityId: prev.entityId, modes: { ...prev.modes, [propertyKey]: restoredMode } }
            : prev));
        }
      },
    });
  };

  // "Apply to type" — the opposite of revert: this asset's own settings
  // become its type's, and the asset itself then just follows the type
  // (its entries are cleared, exactly as a revert would). Every asset of
  // the type that follows it picks the change up; assets with their own
  // settings for the same things keep them. Merges the same way the
  // runtime resolves them:
  //   - display template: if the asset has one, its layout (view mode,
  //     flow, manual positions) replaces the type's — layout is all-or-
  //     nothing everywhere else too — and its per-property visuals merge
  //     over the type's, property by property;
  //   - property / related-asset visibility: merged over the type's;
  //   - Related Assets template: the asset's replaces the type's.
  // Undoable like a revert (one snapshot of the type's and the asset's
  // entries). The open asset's unsaved changes are resolved first
  // (Save/Discard), so what gets applied is what's actually saved — the
  // apply itself runs on the next render via pendingApplyAssetId, once a
  // Save's state updates have landed, rather than from this closure's
  // now-stale copy of the stores.
  const [pendingApplyAssetId, setPendingApplyAssetId] = useState(null);
  const applyAssetToType = async (assetId) => {
    if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
      await resolveUnsavedChanges();
    }
    setPendingApplyAssetId(assetId);
  };
  useEffect(() => {
    if (!pendingApplyAssetId) return;
    const assetId = pendingApplyAssetId;
    setPendingApplyAssetId(null);
    const asset = CURRENT_ASSET_MAP[assetId];
    if (!asset) return;
    const typeId = assetTypeIdOf(asset);
    const ids = [assetId];

    const snapshot = {
      typeDisplay: typeDisplayTemplates[typeId],
      typeProps: typePropertyConfigs[typeId],
      typeRelated: typeRelatedAssetConfigs[typeId],
      typeRelatedTemplate: relatedAssetsTemplates[typeId],
      display: pickEntries(assetDisplayTemplates, ids),
      relatedTemplates: pickEntries(assetRelatedAssetsTemplates, ids),
      propertyConfigs: pickEntries(assetPropertyConfigs, ids),
      relatedConfigs: pickEntries(assetRelatedAssetConfigs, ids),
      typePropertyOrder: typePropertyOrders[typeId],
      typeRelatedOrder: typeRelatedAssetOrders[typeId],
      propertyOrders: pickEntries(assetPropertyOrders, ids),
      relatedOrders: pickEntries(assetRelatedAssetOrders, ids),
    };
    const assetTemplate = assetDisplayTemplates[assetId];
    const assetProps = assetPropertyConfigs[assetId];
    const assetRelated = assetRelatedAssetConfigs[assetId];
    const assetRelatedTemplate = assetRelatedAssetsTemplates[assetId];

    // Sets or removes one type-level entry, keeping "no entry" as no
    // entry rather than writing an empty object/undefined.
    const putEntry = (prev, key, value) => {
      const next = { ...prev };
      if (value === undefined) delete next[key]; else next[key] = value;
      return next;
    };

    if (assetTemplate) {
      const typeTemplate = typeDisplayTemplates[typeId] || {};
      const merged = {
        ...typeTemplate,
        viewMode: assetTemplate.viewMode,
        flowDirection: assetTemplate.flowDirection,
        flowWrap: assetTemplate.flowWrap,
        alignContent: assetTemplate.alignContent,
        layoutMode: assetTemplate.layoutMode,
        manualPositions: assetTemplate.manualPositions ?? {},
        propertyViewModes: { ...(typeTemplate.propertyViewModes || {}), ...(assetTemplate.propertyViewModes || {}) },
      };
      setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, merged); saveTypeDisplayTemplates(next); return next; });
    }
    if (assetProps && Object.keys(assetProps).length) {
      setTypePropertyConfigs(prev => putEntry(prev, typeId, { ...(prev[typeId] || {}), ...assetProps }));
    }
    if (assetRelated && Object.keys(assetRelated).length) {
      setTypeRelatedAssetConfigs(prev => putEntry(prev, typeId, { ...(prev[typeId] || {}), ...assetRelated }));
    }
    if (assetRelatedTemplate) {
      setRelatedAssetsTemplates(prev => { const next = putEntry(prev, typeId, assetRelatedTemplate); saveRelatedAssetsTemplates(next); return next; });
    }
    // Orders: the asset's own order (a whole list) becomes the type's.
    if (assetPropertyOrders[assetId]) setTypePropertyOrders(prev => putEntry(prev, typeId, assetPropertyOrders[assetId]));
    if (assetRelatedAssetOrders[assetId]) setTypeRelatedAssetOrders(prev => putEntry(prev, typeId, assetRelatedAssetOrders[assetId]));
    setAssetPropertyOrders(prev => omitKeys(prev, ids));
    setAssetRelatedAssetOrders(prev => omitKeys(prev, ids));
    // The asset now matches its type exactly — clear its own entries so it
    // keeps following the type from here on.
    setAssetDisplayTemplates(prev => { const next = omitKeys(prev, ids); saveAssetDisplayTemplates(next); return next; });
    setAssetRelatedAssetsTemplates(prev => { const next = omitKeys(prev, ids); saveAssetRelatedAssetsTemplates(next); return next; });
    setAssetPropertyConfigs(prev => omitKeys(prev, ids));
    setAssetRelatedAssetConfigs(prev => omitKeys(prev, ids));
    const isOpen = selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId;
    if (isOpen) {
      setPropertyVisualDraft({ entityId: assetId, modes: {} });
      setNowPreviewRevision(r => r + 1);
    }

    const typeName = nowTypeList.find(t => t.id === typeId)?.name ?? deslugifyType(asset.assetType);
    setUndoToast({
      id: Date.now(),
      message: `Updated the ${typeName} type from this asset`,
      undo: () => {
        setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeDisplay); saveTypeDisplayTemplates(next); return next; });
        setTypePropertyConfigs(prev => putEntry(prev, typeId, snapshot.typeProps));
        setTypeRelatedAssetConfigs(prev => putEntry(prev, typeId, snapshot.typeRelated));
        setRelatedAssetsTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeRelatedTemplate); saveRelatedAssetsTemplates(next); return next; });
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        setAssetRelatedAssetsTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.relatedTemplates); saveAssetRelatedAssetsTemplates(next); return next; });
        setAssetPropertyConfigs(prev => restoreEntries(prev, ids, snapshot.propertyConfigs));
        setAssetRelatedAssetConfigs(prev => restoreEntries(prev, ids, snapshot.relatedConfigs));
        setTypePropertyOrders(prev => putEntry(prev, typeId, snapshot.typePropertyOrder));
        setTypeRelatedAssetOrders(prev => putEntry(prev, typeId, snapshot.typeRelatedOrder));
        setAssetPropertyOrders(prev => restoreEntries(prev, ids, snapshot.propertyOrders));
        setAssetRelatedAssetOrders(prev => restoreEntries(prev, ids, snapshot.relatedOrders));
        if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
          setPropertyVisualDraft({ entityId: assetId, modes: snapshot.display[assetId]?.propertyViewModes ?? {} });
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApplyAssetId]);

  // Per-property "↑ Update type" from an asset's Visual dropdown — the
  // one-property version of applyAssetToType: the type's visual for that
  // property becomes this asset's, and the asset's own entry for it is
  // dropped (saved template and unsaved draft both), so the asset now
  // just follows the type for it. Immediate, with Undo.
  //
  // Same two-step as applyAssetToType: resolve unsaved changes first, then
  // act on the next render. Here that also matters for a second reason —
  // the open editor treats what it loaded as "saved", so this changes the
  // saved template underneath it; it's remounted (nowPreviewRevision)
  // afterwards to re-read it, which is only safe once nothing is unsaved.
  const [pendingPropertyApply, setPendingPropertyApply] = useState(null); // { assetId, key, mode }
  const applyPropertyToType = async (assetId, key, mode) => {
    if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
      await resolveUnsavedChanges();
    }
    setPendingPropertyApply({ assetId, key, mode });
  };
  useEffect(() => {
    if (!pendingPropertyApply) return;
    const { assetId, key, mode } = pendingPropertyApply;
    setPendingPropertyApply(null);
    const asset = CURRENT_ASSET_MAP[assetId];
    if (!asset || !mode || mode === PROPERTY_VIEW_MODE_DEFAULT) return;
    const typeId = assetTypeIdOf(asset);
    const ids = [assetId];
    const snapshot = {
      typeDisplay: typeDisplayTemplates[typeId],
      display: pickEntries(assetDisplayTemplates, ids),
    };
    const putEntry = (prev, k, value) => {
      const next = { ...prev };
      if (value === undefined) delete next[k]; else next[k] = value;
      return next;
    };
    // A type with no template yet gets one holding the renderers' own
    // defaults (normalizedLayout), so nothing else about it changes.
    setTypeDisplayTemplates(prev => {
      const base = prev[typeId] || { viewMode: 'text', flowDirection: 'row', flowWrap: 'wrap', alignContent: 'flex-start', layoutMode: 'auto', manualPositions: {} };
      const next = putEntry(prev, typeId, { ...base, propertyViewModes: { ...(base.propertyViewModes || {}), [key]: mode } });
      saveTypeDisplayTemplates(next);
      return next;
    });
    const dropKey = template => {
      if (!template?.propertyViewModes || !(key in template.propertyViewModes)) return template;
      const { [key]: _removed, ...rest } = template.propertyViewModes;
      return { ...template, propertyViewModes: rest };
    };
    setAssetDisplayTemplates(prev => {
      if (!prev[assetId]) return prev;
      const next = { ...prev, [assetId]: dropKey(prev[assetId]) };
      saveAssetDisplayTemplates(next);
      return next;
    });
    const isOpen = selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId;
    if (isOpen) {
      setPropertyVisualDraft(prev => (prev.entityId === assetId ? { entityId: assetId, modes: dropKey({ propertyViewModes: prev.modes }).propertyViewModes } : prev));
      setNowPreviewRevision(r => r + 1);
    }

    const typeName = nowTypeList.find(t => t.id === typeId)?.name ?? deslugifyType(asset.assetType);
    const propertyLabel = PROPERTY_LABELS[key] || key;
    const modeLabel = KPI_VIEW_MODE_ITEMS.find(i => i.value === mode)?.text ?? mode;
    setUndoToast({
      id: Date.now(),
      message: `Updated the ${typeName} type: ${propertyLabel} → ${modeLabel}`,
      undo: () => {
        setTypeDisplayTemplates(prev => { const next = putEntry(prev, typeId, snapshot.typeDisplay); saveTypeDisplayTemplates(next); return next; });
        setAssetDisplayTemplates(prev => { const next = restoreEntries(prev, ids, snapshot.display); saveAssetDisplayTemplates(next); return next; });
        if (selectedNowThing?.kind === 'asset' && selectedNowThing.id === assetId) {
          // The asset's own visual for this property comes back into the
          // draft too (it was its own choice before), leaving any other
          // draft entries alone.
          setPropertyVisualDraft(prev => (prev.entityId === assetId
            ? { entityId: assetId, modes: { ...prev.modes, [key]: mode } }
            : prev));
          setNowPreviewRevision(r => r + 1);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPropertyApply]);

  // Published only when the customizations themselves change, so the
  // (many) subscribed tree rows don't re-render on every unrelated render
  // of this component. The actions object is stable for the same reason;
  // each action forwards through a ref to this render's closure, so
  // callers always get the latest state.
  const customizationActionsRef = useRef({});
  customizationActionsRef.current = {
    revertAssetsToType,
    revertPropertyToType,
    applyAssetToType,
    applyPropertyToType,
    openAsset: (assetId) => handleSelectNowThing({ kind: 'asset', id: assetId }),
  };
  const customizationActions = useMemo(() => ({
    revertAssetsToType: (...args) => customizationActionsRef.current.revertAssetsToType(...args),
    revertPropertyToType: (...args) => customizationActionsRef.current.revertPropertyToType(...args),
    applyAssetToType: (...args) => customizationActionsRef.current.applyAssetToType(...args),
    applyPropertyToType: (...args) => customizationActionsRef.current.applyPropertyToType(...args),
    openAsset: (...args) => customizationActionsRef.current.openAsset(...args),
  }), []);
  useEffect(() => {
    assetCustomizationStore.set({ ...assetCustomizations, actions: customizationActions });
  }, [assetCustomizations, customizationActions]);
  useEffect(() => () => assetCustomizationStore.set(EMPTY_CUSTOMIZATIONS), []);

  const selectedItem = ATTENTION_ITEMS.find(i => i.id === selectedAttentionId) || null;
  const selectedWorkItem = workItems.find(w => w.id === selectedWorkItemId) || null;
  const hasUnreadContacts = contacts.some(c => c.unread);

  // Clicking the icon for the mode that's already showing hides that panel;
  // clicking it again (or clicking a different icon) brings it back.
  const handleLeftIconClick = (id) => {
    if (railMode === id && !leftPanelHidden) {
      setLeftPanelHidden(true);
    } else {
      setRailMode(id);
      setLeftPanelHidden(false);
    }
  };

  const handleRightIconClick = (id) => {
    if (rightPanelMode === id && !rightPanelHidden) {
      setRightPanelHidden(true);
    } else {
      setRightPanelMode(id);
      setRightPanelHidden(false);
    }
  };

  const selectContact = (id) => {
    setActiveContactId(id);
    setContacts(prev => prev.map(c => (c.id === id ? { ...c, unread: false } : c)));
  };

  const sendContactMessage = (contactId, text) => {
    setContacts(prev => prev.map(c => (
      c.id === contactId
        ? { ...c, thread: [...c.thread, { from: 'me', text, time: 'Now' }] }
        : c
    )));
  };

  const newAttentionItems = useMemo(
    () => ATTENTION_ITEMS
      .filter(i => i.sinceMinutes <= NEW_ATTENTION_THRESHOLD_MINUTES)
      .sort((a, b) => a.sinceMinutes - b.sinceMinutes),
    []
  );
  const newWorkItems = useMemo(
    () => workItems.filter(w => w.source === 'ai' && !w.done),
    [workItems]
  );

  const handleCreateWorkItem = (attentionItem) => {
    setWorkItems(prev => [
      {
        id: `wk-${Date.now()}`,
        text: attentionItem.detail.recommendation,
        description: `Created from Attention: ${attentionItem.signal} (${attentionItem.asset})`,
        assetId: attentionItem.assetId ?? null,
        assetLabel: attentionItem.asset,
        workType: 'INVESTIGATION',
        priority: attentionItem.severity === 'high' ? 'urgent' : attentionItem.severity === 'medium' ? 'important' : 'routine',
        sourceType: 'situation',
        sourceLabel: `From: ${attentionItem.signal}`,
        source: 'ai',
        assignedRole: 'Operator',
        plannedStart: null,
        dueAt: null,
        estimatedDurationMinutes: null,
        done: false,
        completedAt: null,
        createdAt: new Date(),
      },
      ...prev,
    ]);
  };

  const handleToggleWorkItem = (id) => {
    setWorkItems(prev => prev.map(w => (w.id === id ? { ...w, done: !w.done, completedAt: !w.done ? new Date() : null } : w)));
  };

  const handleAddWorkItem = (text) => {
    const id = `wk-${Date.now()}`;
    setWorkItems(prev => [{
      id, text, description: '', assetLabel: null, workType: 'GENERAL', priority: 'routine',
      sourceType: 'planned', sourceLabel: null, source: 'operator', assignedRole: 'Operator',
      plannedStart: null, dueAt: null, estimatedDurationMinutes: null,
      done: false, completedAt: null, createdAt: new Date(),
    }, ...prev]);
    setSelectedWorkItemId(id);
  };

  // Fixed for this mount's lifetime — a model switch remounts this component.
  // The Issue Map / Line Detail overlay only knows the refinery's layout
  // (spec §10), so every other model hides it and opens a clicked Now-strip
  // tile in the Assets area instead.
  const usesAssetTiles = CURRENT_MODEL_SHAPE !== MODEL_SHAPES.REFINERY;

  const handleSelectIssueFromMap = (attentionId) => {
    setRailMode('attention');
    setSelectedAttentionId(attentionId);
  };

  // Set to true to bring back the "Operator Interface" title banner —
  // hidden for now per request, left in place rather than deleted.
  const SHOW_WORKSPACE_BANNER = false;

  return (
    <div className="op-workspace">
      {SHOW_WORKSPACE_BANNER && (
        <div className="op-workspace-banner">
          <span className="op-workspace-title">Operator Interface</span>
          <span className="op-workspace-badge">Concept shell · mock data</span>
        </div>
      )}

      {operatorPersona !== 'configurator' && (
        <div className="op-now-section" ref={nowSectionRef}>
          <NowStrip
            selectedLine={usesAssetTiles ? (railMode === 'assets' ? selectedAssetId : null) : selectedDetailLine}
            onSelectLine={(lineId) => {
              if (usesAssetTiles) {
                // Open the unit in the Assets area — the one view that
                // works for any asset at any level.
                setRailMode('assets');
                setLeftPanelHidden(false);
                setSelectedAssetId(lineId);
                return;
              }
              if (selectedDetailLine === lineId) {
                setSelectedDetailLine(null);
              } else {
                setSelectedDetailLine(lineId);
                setIssueMapExpanded(true);
              }
            }}
          />
          {!usesAssetTiles && <IssueMapOverlay
            expanded={issueMapExpanded}
            onToggle={() => setIssueMapExpanded(e => !e)}
            onSelectIssue={handleSelectIssueFromMap}
            selectedDetailLine={selectedDetailLine}
            onCloseDetailLine={() => setSelectedDetailLine(null)}
            topOffset={nowSectionBottom}
          />}
        </div>
      )}

      <div className="op-main-row">
        <NavRail
          mode={railMode}
          hidden={leftPanelHidden}
          onIconClick={handleLeftIconClick}
          attentionCount={newAttentionItems.length}
          workCount={newWorkItems.length}
          operatorPersona={operatorPersona}
        />

        <Splitter orientation="horizontal" style={{ flex: 1, minHeight: 0 }} onResize={handleOuterSplitterResize}>
          {!leftPanelHidden && (
            <SplitterItem size="320px" minSize="240px" resizable={true}>
              {railMode === 'now' ? (
                <NowAssetTreePanel ref={nowTreePanelRef} selectedThing={selectedNowThing} onSelectThing={handleSelectNowThing} typeList={nowTypeList} tabIndex={nowLeftTabIndex} onTabIndexChange={setNowLeftTabIndex} />
              ) : railMode === 'attention' ? (
                <AttentionPanel selectedId={selectedAttentionId} onSelect={setSelectedAttentionId} />
              ) : railMode === 'assets' ? (
                <OperatorAssetTreePanel selectedAssetId={selectedAssetId} onSelectAsset={setSelectedAssetId} />
              ) : (
                <WorkListPanel
                  items={workItems}
                  selectedId={selectedWorkItemId}
                  onSelect={setSelectedWorkItemId}
                  onToggleDone={handleToggleWorkItem}
                  onAdd={handleAddWorkItem}
                />
              )}
            </SplitterItem>
          )}
          <SplitterItem resizable={true}>
            {railMode === 'now' ? (
              <NowAssetDetail
                selectedThing={selectedNowThing}
                typeList={nowTypeList}
                typePropertyConfigs={typePropertyConfigs}
                setTypePropertyConfigs={setTypePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                typeDisplayTemplates={typeDisplayTemplates}
                onSaveTypeDisplayTemplate={handleSaveTypeDisplayTemplate}
                assetPropertyConfigs={assetPropertyConfigs}
                setAssetPropertyConfigs={setAssetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                assetDisplayTemplates={assetDisplayTemplates}
                onSaveAssetDisplayTemplate={handleSaveAssetDisplayTemplate}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                onSaveAssetRelatedAssetsTemplate={handleSaveAssetRelatedAssetsTemplate}
                activeSaveHandlerRef={activeSaveHandlerRef}
                activeTabIndex={activeTabIndex}
                onViewModeChange={setRightPanelViewMode}
                hiddenAssetIds={hiddenAssetIds}
                relatedAssetsTemplates={relatedAssetsTemplates}
                onSaveRelatedAssetsTemplate={handleSaveRelatedAssetsTemplate}
                allAssetsTemplate={allAssetsTemplate}
                onSaveAllAssetsTemplate={handleSaveAllAssetsTemplate}
                onTitleClick={handleNavigateToType}
                propertyVisuals={propertyVisuals}
                previewRevision={nowPreviewRevision}
              />
            ) : railMode === 'attention' ? (
              <InvestigatePanel
                item={selectedItem}
                onCreateWorkItem={handleCreateWorkItem}
                evidenceView={evidenceView}
                setEvidenceView={setEvidenceView}
                typeList={nowTypeList}
                typeDisplayTemplates={typeDisplayTemplates}
                typePropertyConfigs={typePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                relatedAssetsTemplates={relatedAssetsTemplates}
                onSaveRelatedAssetsTemplate={handleSaveRelatedAssetsTemplate}
                assetDisplayTemplates={assetDisplayTemplates}
                assetPropertyConfigs={assetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                activeSaveHandlerRef={activeSaveHandlerRef}
                onTitleClick={handleNavigateToType}
                onGearClick={handleNavigateToConfig}
              />
            ) : railMode === 'assets' ? (
              <OperatorAssetDetail
                selectedAssetId={selectedAssetId}
                typeList={nowTypeList}
                typeDisplayTemplates={typeDisplayTemplates}
                typePropertyConfigs={typePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                relatedAssetsTemplates={relatedAssetsTemplates}
                assetDisplayTemplates={assetDisplayTemplates}
                assetPropertyConfigs={assetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                assetRelatedAssetsTemplates={assetRelatedAssetsTemplates}
                allAssetsTemplate={allAssetsTemplate}
                hiddenAssetIds={hiddenAssetIds}
                activeTab={selectedAssetTab}
                onActiveTabChange={setSelectedAssetTab}
                onTitleClick={handleNavigateToAsset}
                onGearClick={handleNavigateToConfig}
              />
            ) : (
              <TaskDetailPanel key={selectedWorkItemId} item={selectedWorkItem} onToggleDone={handleToggleWorkItem} />
            )}
          </SplitterItem>
          {!rightPanelHidden && (
            <SplitterItem size="280px" minSize="240px" resizable={true}>
              <SidePanel
                mode={rightPanelMode}
                contacts={contacts}
                activeContactId={activeContactId}
                onSelectContact={selectContact}
                onBack={() => setActiveContactId(null)}
                onSendMessage={sendContactMessage}
                selectedNowThing={selectedNowThing}
                nowTypeList={nowTypeList}
                typePropertyConfigs={typePropertyConfigs}
                setTypePropertyConfigs={setTypePropertyConfigs}
                typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                typeDisplayTemplates={typeDisplayTemplates}
                onSaveTypeDisplayTemplate={handleSaveTypeDisplayTemplate}
                assetPropertyConfigs={assetPropertyConfigs}
                setAssetPropertyConfigs={setAssetPropertyConfigs}
                assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                activeSaveHandlerRef={activeSaveHandlerRef}
                activeTabIndex={activeTabIndex}
                onActiveTabIndexChange={handleActiveTabIndexChange}
                rightPanelViewMode={rightPanelViewMode}
                hiddenAssetIds={hiddenAssetIds}
                onToggleAssetVisibility={handleToggleAssetVisibility}
                propertyVisuals={propertyVisuals}
              />
            </SplitterItem>
          )}
        </Splitter>

        <RightRail mode={rightPanelMode} hidden={rightPanelHidden} onIconClick={handleRightIconClick} hasUnread={hasUnreadContacts} operatorPersona={operatorPersona} />
      </div>
      {undoToast && (
        <div className="op-undo-toast" role="status">
          <span>{undoToast.message}</span>
          <button type="button" className="op-undo-toast-action" onClick={() => { undoToast.undo(); setUndoToast(null); }}>Undo</button>
          <button type="button" className="op-undo-toast-close" onClick={() => setUndoToast(null)} title="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}
