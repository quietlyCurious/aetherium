// ─────────────────────────────────────────────────────────────────────────────
// App.js — root component, state, handlers, and layout shell
//
// PASS 1 — Centralized lock guards.
// A single check, isLockedOrAncestorLocked(...), now gates every handler that
// edits or moves a container. Locked (or locked-by-ancestor) containers cannot
// be edited, moved, deleted, painted, pasted-into, or given new children.
// Selection and lock-toggling remain ungated so you can always select a locked
// item to unlock it. Copy and paintbrush-pickup stay ungated (non-mutating).
// Guards are marked with: // LOCK GUARD
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Button, Popup, SelectBox, Splitter, TabPanel } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import { ToolbarItem } from 'devextreme-react/popup';
import { TreeView } from 'devextreme-react';
import 'devextreme/dist/css/dx.fluent.blue.light.compact.css';
import './App.css';
import './App.locked.css'; // Pass 2 — locked-selection styling
import './App.snap.css';  // Snap-to-grid dot grid styles
import './App.bindings.css'; // Phase 1 binding system
import './App.data.css'; // Phase 2a data workspace
import './App.detailsRadius.css'; // scoped border-radius override for details panel controls
import './App.suppressLicenseBanner.css'; // hides the DevExtreme trial/eval banner — internal POC only
import './App.thinScrollbars.css'; // thin, hover-only scrollbars — canvas and Runtime view only
import './App.operator.css'; // Operator Interface concept shell (Now/Attention/Investigate/Work)
import DataSourcesWorkspace from './DataSourcesWorkspace';
import QueriesWorkspace from './QueriesWorkspace';
import EntitiesWorkspace from './EntitiesWorkspace';
import RuntimeView from './RuntimeView';
import QueryInstanceDetailsPanel from './QueryInstanceDetailsPanel';
import InputBindingPopover from './InputBindingPopover';
import WidgetBindingPopover from './WidgetBindingPopover';
import { makeNewEntity } from './entityModel';
import { loadEntities, saveEntities } from './entitiesStorage';
import { loadDataSources, saveDataSources } from './dataSourcesStorage';
import { loadQueries, saveQueries } from './queriesStorage';
import { loadQueryInstances, saveQueryInstances } from './queryInstancesStorage';
import { loadOperatorNavigation, saveOperatorNavigation } from './operatorNavigationStorage';
import ThemeWorkspace from './ThemeWorkspace';
import OperatorWorkspace from './OperatorWorkspace';
import DataListGrid from './DataListGrid';
import { loadPagesAndFolders, savePagesAndFolders, makeNewPage, makeNewFolder, snapshotPage, cloneContainersFromPage, repairDuplicateContainerIds } from './pagesStorage';
import ScreensPanel from './ScreensPanel';
import { evaluateExpression } from './expressionEval';
import {
  generateDataId, nextInstanceId,
  DEFAULT_DATA_SOURCE, DEFAULT_QUERY, DEFAULT_SCRIPT, DEFAULT_QUERY_INSTANCE,
  EXECUTION_TRIGGERS, INSTANCE_SCOPES,
} from './dataModel';

// ── Data
import { ASSET_DATA, ASSET_MAP, buildSelectedAssetTree } from './assetData';
import { DX_WIDGET_DATA, WIDGET_PROPERTIES } from './widgetData';
import WIDGET_CONFIGS from './widgetConfigs';
import WIDGET_SAMPLE_DATA from './widgetSampleData';

// ── Model & utilities
import {
  DEFAULT_LAYOUT, DEFAULT_SLOT, DEFAULT_COORD,
  WIDGET_DEFAULT_SIZES, DEFAULT_WIDGET_SIZE,
  CONTAINER_BASE_NAME, ROOT_CONTAINER_ID, BASE_TIER_ID,
  getWidgetDefaultSlot, getNextContainerName,
  makeContainer, makeRootContainer, toHtmlId,
} from './containerModel';
import { getLayoutStyle, getCoordStyle, getSlotStyle, getPageTypeStyle } from './containerStyles';
import {
  flattenContainers, isDescendant, extractFromTree, addChildToTree,
  findContainerById, updatePageTypeInTree, updateWidgetPropsInTree,
  deepCloneWithNewIds, updateCoordInTree, updateSlotInTree,
  updateLayoutInTree, renameInTree, deleteFromTree, isLockedOrAncestorLocked,
} from './containerTree';
import { buildDefaultCells, migrateGridCells } from './GridEditor';
import {
  TIERS, DEVICE_CATEGORIES, SPECIAL_PRESETS, ALL_DEVICES,
  getTierById, getDeviceById, applyBreakpointOverrides,
} from './breakpointConfig';

// ── Components
import ContainerCard from './ContainerCard';
import HierarchyTree from './HierarchyTree';
import PageVisualsTabWrapper from './PageVisualsTree';
import WizardContent, { STEPS } from './Wizard';
import DevicePicker from './DevicePicker';
import WidgetConfigPanel from './WidgetConfigPanel';
import WidgetPreview from './WidgetPreview';
import notify from 'devextreme/ui/notify';

// ── Template helpers used in left panel
// Sorts a flat parentId-based hierarchy (categories + items, the shape both
// DX_WIDGET_DATA and ASSET_DATA use) alphabetically by name WITHIN each
// category — categories themselves keep their existing relative order, only
// items inside each one get reordered. Reordering the flat array is enough:
// HierarchyTree preserves array order for same-level siblings, so this
// doesn't require touching that shared component at all.
// When searchText is given, narrows to items whose name matches (plus their
// parent category, so the tree stays structurally coherent) and drops any
// category left with no matches — matches ScreensPanel's own search
// behavior for consistency across all three areas.
// Instance IDs are deliberately page-relative (numbering restarts at 1 per
// page, matching OpHub's own flowInstanceId convention) — meaning two
// different pages can genuinely both have an instance with id 3. Looking one
// up by id alone, across the FULL queryInstances array, can silently match
// the wrong page's instance whenever such a collision exists. This scopes
// the lookup to the currently active page (or to app-scoped instances, which
// aren't tied to any single page and stay findable regardless).
function findQueryInstance(queryInstances, id, activePageId) {
  return queryInstances.find(qi => qi.id === id && (qi.pageId === activePageId || qi.scope === INSTANCE_SCOPES.APP));
}

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

function WidgetTreeItemTemplate(item, onDblClick) {
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


function getAncestorBreadcrumb(assetId) {
  const crumbs = [];
  let current = ASSET_MAP[assetId];
  // Walk up but exclude the asset itself — we want the path to the parent
  current = current?.parentId ? ASSET_MAP[current.parentId] : null;
  while (current) {
    crumbs.unshift(current.name);
    current = current.parentId ? ASSET_MAP[current.parentId] : null;
  }
  return crumbs;
}

// ── Aspect ratio presets ─────────────────────────────────────────────────────
// Values are float w/h ratios. null = Free (no constraint).
const ASPECT_RATIO_PRESETS = [
  { label: 'Free',     value: null   },
  { label: '1 : 1',   value: 1      },
  { label: '4 : 3',   value: 4 / 3  },
  { label: '3 : 2',   value: 3 / 2  },
  { label: '16 : 9',  value: 16 / 9 },
  { label: '16 : 10', value: 16 / 10 },
  { label: '2 : 1',   value: 2      },
  { label: '9 : 16',  value: 9 / 16 },
  { label: '3 : 4',   value: 3 / 4  },
  { label: '2 : 3',   value: 2 / 3  },
];
// Shown in the dropdown when the current ratio doesn't match any preset
const CUSTOM_RATIO_SENTINEL = -1;

// ── Pure AR constraint helpers ────────────────────────────────────────────────
// Called inside handleUpdateSlot / handleUpdateCoord.
// Width always drives when both dimensions are present.
// Non-px slot values (auto, %, etc.) are left untouched.

function adjustSlotForAR(container, slot) {
  const ar = container?.aspectRatio;
  if (!ar || typeof ar !== 'number') return slot;
  const isPx = (v) => typeof v === 'string' && v.endsWith('px') && !isNaN(parseFloat(v));
  if ('width' in slot && isPx(slot.width)) {
    return { ...slot, height: `${Math.round(parseFloat(slot.width) / ar)}px` };
  }
  if ('height' in slot && !('width' in slot) && isPx(slot.height)) {
    return { ...slot, width: `${Math.round(parseFloat(slot.height) * ar)}px` };
  }
  return slot;
}

function adjustCoordForAR(container, coord) {
  const ar = container?.aspectRatio;
  if (!ar || typeof ar !== 'number') return coord;
  if ('width' in coord && typeof coord.width === 'number' && !isNaN(coord.width)) {
    return { ...coord, height: Math.round(coord.width / ar) };
  }
  if ('height' in coord && !('width' in coord) && typeof coord.height === 'number' && !isNaN(coord.height)) {
    return { ...coord, width: Math.round(coord.height * ar) };
  }
  return coord;
}

function AetheriumEditor() {
  const [popupVisible, setPopupVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [containers, setContainers] = useState([makeRootContainer()]);
  const [pages, setPages] = useState(() => {
    const { pages: loadedPages, folders: loadedFolders } = loadPagesAndFolders();
    const { pages: repairedPages, totalFixed } = repairDuplicateContainerIds(loadedPages, generateDataId);
    if (totalFixed > 0) {
      savePagesAndFolders(repairedPages, loadedFolders);
      console.log(`[containerIdRepair] Fixed ${totalFixed} duplicate container ID(s) across saved pages — this only needs to run once.`);
    }
    return repairedPages;
  });
  const [folders, setFolders] = useState(() => loadPagesAndFolders().folders);
  const [activePageId, setActivePageId] = useState(null); // null = current canvas isn't tied to a saved page yet
  const [dataTabMode, setDataTabMode] = useState('model'); // 'model' | 'queries' — Data tab browsing mode
  const [dataTabSearch, setDataTabSearch] = useState('');
  const [visualsSearch, setVisualsSearch] = useState('');
  // Tracks the JSON of whatever was last saved/loaded, so we can tell if the live
  // canvas has diverged from it — a simple, correct-enough "dirty" check for a
  // dev tool. (Only the ACTIVE page can ever be dirty — every other page's stored
  // snapshot is untouched until you switch to it, since only one page's worth of
  // containers is ever live in the canvas at a time.)
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => JSON.stringify(containers));
  const isDirty = JSON.stringify(containers) !== lastSavedSnapshot;
  const [selectedContainerId, setSelectedContainerId] = useState(null);
  const [selectedContainerIds, setSelectedContainerIds] = useState([]);
  const [selectedQueryInstanceId, setSelectedQueryInstanceId] = useState(null); // Page Data tab selection — mutually exclusive with container selection

  // ── Page (Screen) persistence handlers ─────────────────────────────────────
  // MVP: explicit Save only — see pagesStorage.js for why there's no auto-sync.
  const resetSelectionForPageSwitch = () => {
    setSelectedContainerId(null);
    setSelectedContainerIds([]);
  };

  // Returns true if it's OK to proceed (either nothing's dirty, or the user
  // confirmed they want to discard). Centralized so every action that would
  // blow away the live canvas (open, create) checks it the same way.
  const confirmDiscardIfDirty = () => {
    if (!isDirty) return true;
    return window.confirm('You have unsaved changes on this screen. Discard them and continue?');
  };

  // Guards navigation via the top-left "Aetherium ▾" menu the same way page
  // switching is guarded — if the canvas has unsaved edits, confirm before
  // leaving. Note: navigating between menu areas doesn't itself discard the
  // live `containers` state (unlike opening a different saved page, which
  // does) — this is a deliberate "don't forget to save" nudge, not a data-loss
  // prevention in the strict sense, though it's built the same way for a
  // consistent, predictable habit either way.
  const handleNavigate = (view) => {
    if (!confirmDiscardIfDirty()) return;
    setCurrentView(view);
    setMenuOpen(false);
  };

  // Operator Interface and Configurator Interface both land on the same
  // underlying workspace (currentView stays 'operator') — only the persona
  // changes, which controls which rail items that workspace shows.
  const handleNavigateOperatorPersona = (persona) => {
    if (!confirmDiscardIfDirty()) return;
    setCurrentView('operator');
    setOperatorPersona(persona);
    setMenuOpen(false);
  };

  const handleCreatePage = () => {
    if (!confirmDiscardIfDirty()) return;
    const name = window.prompt('Name this screen:', `Screen ${pages.length + 1}`);
    if (name === null) return; // cancelled
    const blankContainers = [makeRootContainer()];
    const page = makeNewPage(name, blankContainers, generateDataId);
    setPages(prev => {
      const next = [...prev, page];
      savePagesAndFolders(next, folders);
      return next;
    });
    setContainers(blankContainers);
    setLastSavedSnapshot(JSON.stringify(blankContainers));
    setActivePageId(page.id);
    resetSelectionForPageSwitch();
  };

  const handleOpenPage = (pageId) => {
    if (pageId === activePageId) return; // already open, nothing to switch
    if (!confirmDiscardIfDirty()) return;
    const page = pages.find(p => p.id === pageId);
    if (!page) return;
    const cloned = cloneContainersFromPage(page);
    setContainers(cloned);
    setLastSavedSnapshot(JSON.stringify(cloned));
    setActivePageId(page.id);
    resetSelectionForPageSwitch();
  };

  const handleSavePage = () => {
    if (!activePageId) {
      const name = window.prompt('Name this screen:', `Screen ${pages.length + 1}`);
      if (name === null) return; // cancelled
      const page = makeNewPage(name, containers, generateDataId);
      setPages(prev => {
        const next = [...prev, page];
        savePagesAndFolders(next, folders);
        return next;
      });
      setActivePageId(page.id);
      setLastSavedSnapshot(JSON.stringify(containers));
      notify(`Saved "${page.name}"`, 'success', 2000);
      return;
    }
    setPages(prev => {
      const next = prev.map(p => p.id === activePageId ? snapshotPage(p, containers) : p);
      savePagesAndFolders(next, folders);
      const savedName = next.find(p => p.id === activePageId)?.name;
      notify(`Saved "${savedName}"`, 'success', 2000);
      return next;
    });
    setLastSavedSnapshot(JSON.stringify(containers));
  };

  const handleDeletePage = (pageId) => {
    const page = pages.find(p => p.id === pageId);
    const confirmed = window.confirm(`Delete "${page?.name || 'this screen'}"? This can't be undone.`);
    if (!confirmed) return;
    setPages(prev => {
      const next = prev.filter(p => p.id !== pageId);
      savePagesAndFolders(next, folders);
      return next;
    });
    // Cascade: page-scoped instances have no meaning once their page is gone
    // — clean them up rather than leave orphans pointing at a dead pageId.
    // App-scoped instances (shared across pages) are untouched.
    setQueryInstances(prev => {
      const next = prev.filter(qi => qi.pageId !== pageId);
      saveQueryInstances(next);
      return next;
    });
    if (activePageId === pageId) setActivePageId(null);
  };

  // ── Folder CRUD ──────────────────────────────────────────────────────────
  const handleCreateFolder = () => {
    const name = window.prompt('Name this folder:', `Folder ${folders.length + 1}`);
    if (name === null) return;
    const folder = makeNewFolder(name, generateDataId);
    setFolders(prev => {
      const next = [...prev, folder];
      savePagesAndFolders(pages, next);
      return next;
    });
  };

  const handleRenameFolder = (folder) => {
    const name = window.prompt('Rename folder:', folder.name);
    if (name === null || name === folder.name) return;
    setFolders(prev => {
      const next = prev.map(f => f.id === folder.id ? { ...f, name } : f);
      savePagesAndFolders(pages, next);
      return next;
    });
  };

  const handleDeleteFolder = (folder) => {
    const hasContents = pages.some(p => p.folderId === folder.id);
    if (hasContents) {
      window.alert(`"${folder.name}" isn't empty. Move or delete the screens inside it first.`);
      return;
    }
    const confirmed = window.confirm(`Delete the folder "${folder.name}"?`);
    if (!confirmed) return;
    setFolders(prev => {
      const next = prev.filter(f => f.id !== folder.id);
      savePagesAndFolders(pages, next);
      return next;
    });
  };

  const handleMovePageToFolder = (pageId, folderId) => {
    setPages(prev => {
      const next = prev.map(p => p.id === pageId ? { ...p, folderId } : p);
      savePagesAndFolders(next, folders);
      return next;
    });
  };
  const [detailsTabIndex, setDetailsTabIndex] = useState(0);
  const [clipboard, setClipboard] = useState(null);
  const [selectedGridCell, setSelectedGridCell] = useState(null);
  const [paintbrush, setPaintbrush] = useState(null); // snapshot of props to apply // { containerId, cellIdx } // deep-cloned container subtree

  // Helper to handle selection with shift/ctrl multi-select
  const handleContainerSelect = (id, e) => {
    setSelectedQueryInstanceId(null); // switching to container selection — mutually exclusive with Page Data selection
    // If paintbrush is active, apply it instead of selecting
    if (paintbrush && id && id !== ROOT_CONTAINER_ID) {
      handleApplyPaintbrush(id);
      return;
    }
    // Block selection of locked items or children of locked containers
    if (id && id !== ROOT_CONTAINER_ID) {
      if (isLockedOrAncestorLocked(containers, id)) return;
    }
    setSelectedGridCell(null); // always clear grid cell selection when selecting a container
    if (id === null) {
      setSelectedContainerId(null);
      setSelectedContainerIds([]);
      return;
    }
    if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      setSelectedContainerIds(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
        setSelectedContainerId(next.length === 1 ? next[0] : next[next.length - 1]);
        return next;
      });
    } else {
      setSelectedContainerId(id);
      setSelectedContainerIds([id]);
    }
  };

  const [draggingId, setDraggingId] = useState(null);
  const [dragState, setDragState] = useState({ overId: null, beforeId: null, overParentId: null });
  const [focusMode, setFocusMode] = useState('follow');
  const [showGap, setShowGap] = useState(true);
  const [coordMode, setCoordMode] = useState('reposition');
  const [currentView, setCurrentView] = useState(() => (
    loadOperatorNavigation()?.currentView === 'operator' ? 'operator' : 'screens'
  )); // 'screens'|'widgets'|'theme'|'datasources'|'entities'|'queries'|'scripts'|'operator'
  const [operatorPersona, setOperatorPersona] = useState(() => loadOperatorNavigation()?.operatorPersona || 'operator'); // 'operator' | 'configurator' — both render the same workspace, just with different rail items visible
  const [menuOpen, setMenuOpen] = useState(false);
  const AVAILABLE_MODELS = [
    { id: 'refinery', label: 'Refinery' },
    { id: 'water', label: 'Water' },
    { id: 'wastewater', label: 'Wastewater' },
  ];
  const [selectedModel, setSelectedModel] = useState(() => loadOperatorNavigation()?.selectedModel || 'refinery');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedWidgetName, setSelectedWidgetName] = useState(null);
  // Breakpoint / device preview
  const [activeDeviceId, setActiveDeviceId] = useState('responsive');
  const [activeTierId, setActiveTierId] = useState(BASE_TIER_ID);
  const [customWidth, setCustomWidth] = useState(1280);
  const [customHeight, setCustomHeight] = useState(800);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);  // snap-to-grid + snap-to-elements
  const [snapSize,    setSnapSize]    = useState(8);     // grid interval AND element-snap threshold
  const [snapGuides,  setSnapGuides]  = useState(null);  // active alignment guides during coord drag
  const [bindingPopoverProp, setBindingPopoverProp] = useState(null); // { containerId, propName, x, y }
  const [inputBindingPopover, setInputBindingPopover] = useState(null); // { instanceId, fieldName, x, y } — same idea, for query instance inputs

  // ── Phase 2 Data Layer ────────────────────────────────────────────────────
  // System-scoped (shared across all pages of this project):
  const [dataSources,      setDataSources]      = useState(() => loadDataSources());  // DataSource definitions
  const [entities,         setEntities]          = useState(() => loadEntities());  // Entity definitions (schema + rows)
  const entitiesWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger entity-data save
  const dataSourcesWorkspaceRef = React.useRef(null);
  const queriesWorkspaceRef = React.useRef(null);
  const operatorWorkspaceRef = React.useRef(null); // lets the title-bar Save button trigger a type's display template save, configurator persona only
  const [operatorSaveAvailable, setOperatorSaveAvailable] = useState(false); // whether a type is currently selected (Now area's Types tab) — mirrors the same static, per-context enablement pattern the other workspaces already use, not new dirty-tracking

  React.useEffect(() => {
    saveOperatorNavigation({ currentView, operatorPersona, selectedModel });
  }, [currentView, operatorPersona, selectedModel]);
  const [queries,          setQueries]          = useState(() => loadQueries());  // Query definitions
  const [scripts,          setScripts]          = useState([]);  // Script definitions (Phase 3+)
  // Page-scoped and app-scoped instances (flat array, each tagged with pageId):
  const [queryInstances,   setQueryInstances]   = useState(() => loadQueryInstances());  // QueryInstance[]

  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { setPaintbrush(null); setSnapGuides(null); }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); handleCopy(); }
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); handlePaste(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedContainerId, clipboard, containers]);

  const handleDragStart = (id) => {
    setDraggingId(id);
    setDragState({ overId: null, beforeId: null, overParentId: null });
  };

  const handleDragOver = (overId, beforeId, overParentId) => {
    if (!draggingId) return;
    if (overId && (overId === draggingId || isDescendant(containers, draggingId, overId))) return;
    // If we have a beforeId, this is a between-zone — clear overId
    if (beforeId !== null && beforeId !== undefined) {
      setDragState({ overId: null, beforeId, overParentId: overParentId || overId });
    } else {
      setDragState({ overId: overId || null, beforeId: null, overParentId: null });
    }
  };

  const resetPropertiesForParent = (item, newParentId, tree, preserveSize = false) => {
    const parent = findContainerById(tree, newParentId);
    const isCoord = parent?.layout?.layoutType === 'coordinate';
    const sourceParent = findContainerById(tree, item.parentId);
    const sameLayoutType = sourceParent?.layout?.layoutType === parent?.layout?.layoutType;

    // If same layout type, just update parentId — nothing to reset
    if (sameLayoutType) {
      return { ...item, parentId: newParentId };
    }

    // Different layout type — reset positioning but always preserve size/box model
    const sizeProps = {
      width: item.slot?.width, height: item.slot?.height,
      minWidth: item.slot?.minWidth, maxWidth: item.slot?.maxWidth,
      minHeight: item.slot?.minHeight, maxHeight: item.slot?.maxHeight,
      paddingTop: item.slot?.paddingTop, paddingBottom: item.slot?.paddingBottom,
      paddingLeft: item.slot?.paddingLeft, paddingRight: item.slot?.paddingRight,
      marginTop: item.slot?.marginTop, marginBottom: item.slot?.marginBottom,
      marginLeft: item.slot?.marginLeft, marginRight: item.slot?.marginRight,
      borderWidth: item.slot?.borderWidth, borderStyle: item.slot?.borderStyle,
      borderColor: item.slot?.borderColor, borderRadius: item.slot?.borderRadius,
      backgroundColor: item.slot?.backgroundColor, color: item.slot?.color,
      fontSize: item.slot?.fontSize, fontWeight: item.slot?.fontWeight,
      fontFamily: item.slot?.fontFamily, lineHeight: item.slot?.lineHeight,
      textAlign: item.slot?.textAlign, letterSpacing: item.slot?.letterSpacing,
    };

    return isCoord
      ? { ...item, parentId: newParentId, coord: { ...DEFAULT_COORD }, slot: { ...DEFAULT_SLOT, ...sizeProps } }
      : { ...item, parentId: newParentId, slot: { ...DEFAULT_SLOT, ...sizeProps }, coord: { ...DEFAULT_COORD } };
  };

  const handleDrop = (overId, beforeId) => {
    const id = draggingId;
    setDraggingId(null);
    setDragState({ overId: null, beforeId: null, overParentId: null });
    if (!id) return;
    if (overId && (overId === id || isDescendant(containers, id, overId))) return;
    // LOCK GUARD — can't move a locked item, can't drop into a locked container
    if (isLockedOrAncestorLocked(containers, id)) return;
    if (overId && isLockedOrAncestorLocked(containers, overId)) return;
    // Block reparenting to current parent
    const dragging = findContainerById(containers, id);
    if (overId && dragging?.parentId === overId) return;

    setContainers(prev => {
      const { extracted, remaining } = extractFromTree(prev, id);
      if (!extracted) return prev;
      if (beforeId) {
        const findParentOf = (id, nodes) => {
          for (const c of nodes) {
            if (c.children.some(ch => ch.id === id)) return c;
            const found = findParentOf(id, c.children);
            if (found) return found;
          }
          return null;
        };
        const newParent = findParentOf(beforeId, remaining);
        const newParentId = newParent?.id ?? ROOT_CONTAINER_ID;
        // LOCK GUARD — can't insert before a sibling inside a locked parent
        if (newParentId !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(prev, newParentId)) return prev;
        const item = extracted.parentId === newParentId
          ? extracted
          : resetPropertiesForParent(extracted, newParentId, remaining);
        const insertBefore = (containers) => containers.reduce((acc, c) => {
          if (c.id === beforeId) acc.push(item);
          acc.push({ ...c, children: insertBefore(c.children) });
          return acc;
        }, []);
        return insertBefore(remaining);
      } else if (overId) {
        const reset = resetPropertiesForParent(extracted, overId, remaining);
        return addChildToTree(remaining, overId, reset);
      }
      return prev;
    });
  };

  const handleDeviceSelect = (device) => {
    setActiveDeviceId(device.id);
    if (device.tier) setActiveTierId(device.tier);
    else setActiveTierId(BASE_TIER_ID);
    setDevicePickerOpen(false);
  };

  const activeDevice = getDeviceById(activeDeviceId);
  const previewWidth = activeDeviceId === 'custom' ? customWidth
    : activeDeviceId === 'responsive' ? null
    : activeDevice?.width || null;
  const previewHeight = activeDeviceId === 'custom' ? customHeight
    : activeDeviceId === 'responsive' ? null
    : activeDevice?.height || null;

  const handleAddContainer = () => {
    const targetId = selectedContainerId || ROOT_CONTAINER_ID;
    // LOCK GUARD — can't add a child to a locked container
    if (targetId !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(containers, targetId)) return;
    const name = getNextContainerName(containers);
    const c = makeContainer(targetId, name);
    setContainers(prev => addChildToTree(prev, targetId, c));
    if (focusMode === 'follow') setSelectedContainerId(c.id);
  };

  const handleAddChildContainer = (parentId) => {
    // LOCK GUARD — can't add a child to a locked container
    if (isLockedOrAncestorLocked(containers, parentId)) return;
    const name = getNextContainerName(containers);
    const c = makeContainer(parentId, name);
    setContainers(prev => addChildToTree(prev, parentId, c));
    setSelectedContainerId(c.id);
  };

  const handleDeleteContainer = (id) => {
    if (id === ROOT_CONTAINER_ID) return; // root is undeletable
    // LOCK GUARD — can't delete a locked item (or one under a locked ancestor).
    // Deleting an *unlocked* ancestor still removes locked descendants, which is intended.
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => deleteFromTree(prev, id));
    setSelectedContainerId(prev => prev === id ? null : prev);
  };

  const handleRenameContainer = (id, title) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => renameInTree(prev, id, title));
  };

  const handleTreeReparent = (draggingId, overId, beforeId) => {
    // LOCK GUARD — can't move a locked item
    if (isLockedOrAncestorLocked(containers, draggingId)) return;
    setContainers(prev => {
      const { extracted, remaining } = extractFromTree(prev, draggingId);
      if (!extracted) return prev;
      if (overId) {
        const target = findContainerById(prev, overId);
        if (target?.isWidget) return prev;
        // LOCK GUARD — can't drop into a locked container
        if (isLockedOrAncestorLocked(prev, overId)) return prev;
        // Block reparenting to current parent
        if (extracted.parentId === overId) return prev;
        const reset = resetPropertiesForParent(extracted, overId, remaining);
        return addChildToTree(remaining, overId, reset);
      } else if (beforeId) {
        const findParentOf = (id, nodes) => {
          for (const c of nodes) {
            if (c.children.some(ch => ch.id === id)) return c;
            const found = findParentOf(id, c.children);
            if (found) return found;
          }
          return null;
        };
        const newParent = findParentOf(beforeId, remaining);
        const newParentId = newParent?.id ?? ROOT_CONTAINER_ID;
        // LOCK GUARD — can't insert before a sibling inside a locked parent
        if (newParentId !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(prev, newParentId)) return prev;
        const item = extracted.parentId === newParentId
          ? extracted
          : resetPropertiesForParent(extracted, newParentId, remaining);
        const insertBefore = (containers) => containers.reduce((acc, c) => {
          if (c.id === beforeId) acc.push(item);
          acc.push({ ...c, children: insertBefore(c.children) });
          return acc;
        }, []);
        return insertBefore(remaining);
      }
      return prev;
    });
  };

  const handleWidgetDrop = (containerId, widgetName) => {
    // LOCK GUARD — can't drop a widget into a locked container
    if (isLockedOrAncestorLocked(containers, containerId)) return;
    const defaultProps = {};
    (WIDGET_PROPERTIES[widgetName] || []).forEach(p => { defaultProps[p.name] = p.default; });
    const c = {
      ...makeContainer(containerId, widgetName),
      isWidget: true,
      widgetName,
      widgetProps: defaultProps,
      slot: getWidgetDefaultSlot(widgetName),
    };
    setContainers(prev => addChildToTree(prev, containerId, c));
    setSelectedContainerId(c.id);
  };

  const handleGridCellDrop = (containerId, cellIdx, widgetName, draggedId, existingCellChildIds, prebuiltClone) => {
    setContainers(prev => {
      // LOCK GUARD — can't drop into a locked grid, can't move a locked item
      if (isLockedOrAncestorLocked(prev, containerId)) return prev;
      if (draggedId && isLockedOrAncestorLocked(prev, draggedId)) return prev;

      const gridContainer = findContainerById(prev, containerId);
      if (!gridContainer) return prev;

      const cells = gridContainer.layout.gridCells || buildDefaultCells(
        gridContainer.layout.gridColumns || 2,
        gridContainer.layout.gridRows || 2
      );

      // Helper to normalize cell childIds
      const getCellChildIds = (cell) => cell.childIds || (cell.childId != null ? [cell.childId] : []);

      const addToCell = (newChild, newCells) => prev.map(function ins(c) {
        if (c.id === containerId) return {
          ...c,
          children: [...c.children, newChild],
          layout: { ...c.layout, gridCells: newCells },
        };
        return { ...c, children: c.children.map(ins) };
      });

      if (prebuiltClone) {
        // Paste — apply resetPropertiesForParent for cross-layout compatibility
        const reset = resetPropertiesForParent(prebuiltClone, containerId, prev, true);
        const newCells = cells.map((c, i) => i === cellIdx ? { ...c, childIds: [...getCellChildIds(c), reset.id] } : c);
        return addToCell(reset, newCells);

      } else if (widgetName) {
        const defaultProps = {};
        (WIDGET_PROPERTIES[widgetName] || []).forEach(p => { defaultProps[p.name] = p.default; });
        const newWidget = { ...makeContainer(containerId, widgetName), isWidget: true, widgetName, widgetProps: defaultProps, slot: getWidgetDefaultSlot(widgetName), parentId: containerId };
        const newCells = cells.map((c, i) => i === cellIdx ? { ...c, childIds: [...getCellChildIds(c), newWidget.id] } : c);
        return addToCell(newWidget, newCells);

      } else if (draggedId && draggedId !== containerId) {
        const isFromSameGrid = findContainerById(prev, draggedId)?.parentId === containerId;
        const { extracted, remaining } = extractFromTree(prev, draggedId);
        if (!extracted) return prev;

        const reset = resetPropertiesForParent(extracted, containerId, remaining);
        const resetWithParent = { ...reset, parentId: containerId };

        // Remove from old cell, add to new cell
        const sourceCellIdx = cells.findIndex(c => getCellChildIds(c).includes(draggedId));
        const newCells = cells.map((c, i) => {
          let ids = getCellChildIds(c).filter(id => id !== draggedId);
          if (i === cellIdx) ids = [...ids, resetWithParent.id];
          return { ...c, childIds: ids };
        });

        if (isFromSameGrid) {
          return prev.map(function upd(c) {
            if (c.id === containerId) return {
              ...c,
              children: c.children.map(ch => ch.id === draggedId ? resetWithParent : ch),
              layout: { ...c.layout, gridCells: newCells },
            };
            return { ...c, children: c.children.map(upd) };
          });
        } else {
          return remaining.map(function ins(c) {
            if (c.id === containerId) return { ...c, children: [...c.children, resetWithParent], layout: { ...c.layout, gridCells: newCells } };
            return { ...c, children: c.children.map(ins) };
          });
        }
      }
      return prev;
    });
    setDraggingId(null);
    setDragState({ overId: null, beforeId: null, overParentId: null });
  };

  const handleCopy = () => {
    if (!selectedContainerId) return;
    const found = findContainerById(containers, selectedContainerId);
    if (!found || found.id === ROOT_CONTAINER_ID) return;
    // Deep-copy at copy time so clipboard is a stable snapshot
    setClipboard(JSON.parse(JSON.stringify(found)));
  };

  const handlePaste = () => {
    if (!clipboard) return;

    // If a grid cell is selected, paste into that specific cell
    if (selectedGridCell) {
      // LOCK GUARD — can't paste into a cell of a locked grid
      if (isLockedOrAncestorLocked(containers, selectedGridCell.containerId)) return;
      const cloned = deepCloneWithNewIds(clipboard, selectedGridCell.containerId);
      handleGridCellDrop(selectedGridCell.containerId, selectedGridCell.cellIdx, null, null, null, cloned);
      setSelectedGridCell(null); // clear after paste
      return;
    }

    // Determine paste target
    const sel = selectedContainerId ? findContainerById(containers, selectedContainerId) : null;
    const targetParentId = sel
      ? (sel.isWidget ? (sel.parentId ?? ROOT_CONTAINER_ID) : sel.id)
      : ROOT_CONTAINER_ID;

    // LOCK GUARD — can't paste into a locked container
    if (targetParentId !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(containers, targetParentId)) return;

    const cloned = deepCloneWithNewIds(clipboard, targetParentId);
    const reset = resetPropertiesForParent(cloned, targetParentId, containers, true);
    setContainers(prev => addChildToTree(prev, targetParentId, reset));
    setSelectedContainerId(reset.id);
    setSelectedContainerIds([reset.id]);
    setSelectedGridCell(null);
  };

  const handleToggleLock = (id) => {
    // Intentionally NOT lock-guarded — you must always be able to unlock.
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) return { ...c, locked: !c.locked };
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handlePickUpPaintbrush = () => {
    // Non-mutating (reads into paintbrush state) — not lock-guarded.
    if (!selectedContainerId) return;
    const found = findContainerById(containers, selectedContainerId);
    if (!found || found.id === ROOT_CONTAINER_ID) return;
    setPaintbrush({
      slot: found.slot ? { ...found.slot } : undefined,
      widgetProps: found.widgetProps ? { ...found.widgetProps } : undefined,
      widgetName: found.widgetName,
      breakpointOverrides: found.breakpointOverrides
        ? JSON.parse(JSON.stringify(found.breakpointOverrides))
        : undefined,
    });
  };

  const handleApplyPaintbrush = (targetId) => {
    if (!paintbrush) return;
    // LOCK GUARD — can't paint onto a locked item
    if (isLockedOrAncestorLocked(containers, targetId)) return;
    const target = findContainerById(containers, targetId);
    if (!target) return;
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === targetId) {
        const updated = { ...c };
        // Apply slot (sizing/box model) always
        if (paintbrush.slot) updated.slot = { ...c.slot, ...paintbrush.slot };
        // Apply widgetProps only if same widget type
        if (paintbrush.widgetProps && c.isWidget && c.widgetName === paintbrush.widgetName) {
          updated.widgetProps = { ...c.widgetProps, ...paintbrush.widgetProps };
        }
        // Apply breakpoint overrides
        if (paintbrush.breakpointOverrides) {
          updated.breakpointOverrides = {
            ...c.breakpointOverrides,
            ...JSON.parse(JSON.stringify(paintbrush.breakpointOverrides)),
          };
        }
        return updated;
      }
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handleUpdateWidgetProps = (id, props) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => updateWidgetPropsInTree(prev, id, props));
  };

  // ── Binding handlers (Phase 1) ─────────────────────────────────────────────
  const handleSetBinding = (id, propName, binding) => {
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) return { ...c, bindings: { ...(c.bindings || {}), [propName]: binding } };
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handleClearBinding = (id, propName) => {
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) {
        const nb = { ...(c.bindings || {}) };
        delete nb[propName];
        return { ...c, bindings: nb };
      }
      return { ...c, children: c.children.map(upd) };
    }));
  };

  // Same idea as the two handlers above, for query instance INPUTS rather than
  // widget props — instances live in a flat array, so no recursive tree walk
  // needed, just a straightforward map.
  const handleSetInputBinding = (instanceId, fieldName, binding) => {
    // Same scoping as findQueryInstance/handleUpdateQueryInstance — matching
    // by id alone risks silently binding an unrelated instance on a
    // different page that happens to share the same page-relative number.
    setQueryInstances(prev => {
      const next = prev.map(qi =>
        (qi.id === instanceId && (qi.pageId === activePageId || qi.scope === INSTANCE_SCOPES.APP))
          ? { ...qi, bindings: { ...(qi.bindings || {}), [fieldName]: binding } }
          : qi
      );
      saveQueryInstances(next);
      return next;
    });
  };

  const handleClearInputBinding = (instanceId, fieldName) => {
    setQueryInstances(prev => {
      const next = prev.map(qi => {
        if (!(qi.id === instanceId && (qi.pageId === activePageId || qi.scope === INSTANCE_SCOPES.APP))) return qi;
        const nb = { ...(qi.bindings || {}) };
        delete nb[fieldName];
        return { ...qi, bindings: nb };
      });
      saveQueryInstances(next);
      return next;
    });
  };

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
    const inUse = queryInstances.some(qi => qi.queryId === id);
    if (inUse) return false;
    setQueries(prev => {
      const next = prev.filter(q => q.id !== id);
      saveQueries(next);
      return next;
    });
    return true;
  };

  // ── Query Instances (page-scoped by default; can be promoted to app-scoped) ─
  const handleAddQueryInstance = (instData = {}) => {
    // Page-relative numbering (matches OpHub's own convention — instance IDs
    // restart per page, not one global counter across every page) — only
    // meaningful for page-scoped instances; app-scoped ones aren't tied to
    // a single page's numbering at all.
    const sameScopeInstances = instData.scope === INSTANCE_SCOPES.APP
      ? queryInstances.filter(qi => qi.scope === INSTANCE_SCOPES.APP)
      : queryInstances.filter(qi => qi.pageId === activePageId);
    const inst = {
      ...DEFAULT_QUERY_INSTANCE,
      ...instData,
      id: nextInstanceId(sameScopeInstances),
      pageId: instData.scope === INSTANCE_SCOPES.APP ? null : (instData.pageId ?? activePageId),
    };
    if (!inst.alias && inst.queryId) {
      // Auto-generate alias from query name
      const q = queries.find(q => q.id === inst.queryId);
      if (q) inst.alias = q.name;
    }
    setQueryInstances(prev => {
      const next = [...prev, inst];
      saveQueryInstances(next);
      return next;
    });
    return inst.id;
  };

  const handleUpdateQueryInstance = (id, updates) => {
    // Scoped the same way as findQueryInstance and for the same reason —
    // matching by id alone risks silently updating an unrelated instance on
    // a DIFFERENT page that happens to share the same page-relative number.
    setQueryInstances(prev => {
      const next = prev.map(qi =>
        (qi.id === id && (qi.pageId === activePageId || qi.scope === INSTANCE_SCOPES.APP))
          ? { ...qi, ...updates }
          : qi
      );
      saveQueryInstances(next);
      return next;
    });
  };

  const handleDeleteQueryInstance = (id) => {
    // Same scoping, and arguably more important here: unscoped, this could
    // silently DELETE an instance on a completely unrelated page.
    setQueryInstances(prev => {
      const next = prev.filter(qi =>
        !(qi.id === id && (qi.pageId === activePageId || qi.scope === INSTANCE_SCOPES.APP))
      );
      saveQueryInstances(next);
      return next;
    });
  };

  const handlePromoteQueryInstance = (id) => {
    // Promote a page-scoped instance to app-scoped (shared across all pages)
    // — clears pageId, since app-scoped means "not tied to one page".
    // Deliberately does NOT also match already-app-scoped instances (unlike
    // update/delete above) — promoting only makes sense for a page-scoped
    // one on the CURRENT page; an already-app-scoped instance with a
    // colliding id on some other page should never be touched by this.
    setQueryInstances(prev => {
      const next = prev.map(qi =>
        (qi.id === id && qi.pageId === activePageId) ? { ...qi, scope: INSTANCE_SCOPES.APP, pageId: null } : qi
      );
      saveQueryInstances(next);
      return next;
    });
  };

  // Create a fresh cell container for a grid cell
  const makeCellContainer = (parentId) => ({
    ...makeContainer(parentId, getNextContainerName(containers)),
    slot: { ...DEFAULT_SLOT, flexGrow: 1, flexShrink: 1, width: '', height: '', flexBasis: '0' },
  });

  // Build gridCells with one container per cell, adding children to the tree
  const buildCellContainers = (parentId, cols, rows, prevContainers) => {
    const cells = buildDefaultCells(cols, rows);
    const newContainers = [];
    const filledCells = cells.map((cell) => {
      const cc = { ...makeContainer(parentId, getNextContainerName([...prevContainers, ...newContainers])), slot: { ...DEFAULT_SLOT, flexGrow: 1, flexShrink: 1, width: '', height: '', flexBasis: '0' } };
      newContainers.push(cc);
      return { ...cell, childIds: [cc.id] };
    });
    return { filledCells, newContainers };
  };

  const handleUpdateLayout = (id, layoutUpdate) => {
    setContainers(prev => {
      // LOCK GUARD
      if (isLockedOrAncestorLocked(prev, id)) return prev;
      const container = findContainerById(prev, id);
      if (!container) return updateLayoutInTree(prev, id, layoutUpdate);

      const oldLayout = container.layout || {};
      const newLayout = { ...oldLayout, ...layoutUpdate };

      // Switching TO grid — auto-create cell containers
      if (layoutUpdate.layoutType === 'grid' && oldLayout.layoutType !== 'grid') {
        const cols = newLayout.gridColumns || 2;
        const rows = newLayout.gridRows || 2;
        const { filledCells, newContainers } = buildCellContainers(id, cols, rows, prev);

        // Move any existing children into the first cell container
        const existingChildren = container.children;
        let updatedContainers = prev;
        if (existingChildren.length > 0 && newContainers.length > 0) {
          existingChildren.forEach(child => {
            newContainers[0].children = [...(newContainers[0].children || []), { ...child, parentId: newContainers[0].id }];
          });
        }

        return updatedContainers.map(function upd(c) {
          if (c.id === id) return {
            ...c,
            layout: { ...newLayout, gridCells: filledCells },
            children: newContainers,
          };
          return { ...c, children: c.children.map(upd) };
        });
      }

      // Changing grid columns or rows — migrate cell containers
      if (oldLayout.layoutType === 'grid' && (layoutUpdate.gridColumns !== undefined || layoutUpdate.gridRows !== undefined)) {
        const oldCols = oldLayout.gridColumns || 2;
        const oldRows = oldLayout.gridRows || 2;
        const newCols = newLayout.gridColumns || 2;
        const newRows = newLayout.gridRows || 2;
        const oldCells = oldLayout.gridCells || buildDefaultCells(oldCols, oldRows);

        // Build new cells
        const newBaseCells = buildDefaultCells(newCols, newRows);
        const newContainersToAdd = [];

        const newFilledCells = newBaseCells.map((newCell) => {
          // Find the old cell that best matches this position
          const oldCell = oldCells.find(oc =>
            oc.colStart === newCell.colStart && oc.rowStart === newCell.rowStart
          );

          if (oldCell) {
            // Reuse existing cell container(s)
            const existingIds = oldCell.childIds || (oldCell.childId != null ? [oldCell.childId] : []);
            return { ...newCell, childIds: existingIds };
          } else {
            // New cell — create a fresh container
            const cc = { ...makeContainer(id, getNextContainerName([...prev, ...newContainersToAdd])), slot: { ...DEFAULT_SLOT, flexGrow: 1, flexShrink: 1, width: '', height: '', flexBasis: '0' } };
            newContainersToAdd.push(cc);
            return { ...newCell, childIds: [cc.id] };
          }
        });

        // Collect childIds that are no longer referenced and merge their contents into last cell
        const referencedIds = new Set(newFilledCells.flatMap(c => c.childIds || []));
        const orphanedCellIds = oldCells
          .flatMap(c => c.childIds || (c.childId != null ? [c.childId] : []))
          .filter(id => !referencedIds.has(id));

        // Move orphaned container children into the last referenced cell container
        if (orphanedCellIds.length > 0 && newFilledCells.length > 0) {
          const lastCell = newFilledCells[newFilledCells.length - 1];
          lastCell.childIds = [...(lastCell.childIds || []), ...orphanedCellIds];
          // Reparent orphaned containers
          orphanedCellIds.forEach(oid => {
            const lastCellContainerId = lastCell.childIds[0];
            // Move orphaned container's children into the last cell container
          });
        }

        return prev.map(function upd(c) {
          if (c.id === id) return {
            ...c,
            layout: { ...newLayout, gridCells: newFilledCells },
            children: [...c.children, ...newContainersToAdd],
          };
          return { ...c, children: c.children.map(upd) };
        });
      }

      return updateLayoutInTree(prev, id, layoutUpdate);
    });
  };

  // When cells merge, move absorbed container's children into surviving container
  const handleMergeCellContainers = (survivingId, absorbedIds) => {
    setContainers(prev => {
      // LOCK GUARD — merging changes the grid's children; block if locked
      if (isLockedOrAncestorLocked(prev, survivingId)) return prev;
      let updated = prev;
      absorbedIds.forEach(absorbedId => {
        const absorbed = findContainerById(updated, absorbedId);
        if (!absorbed || absorbed.children.length === 0) return;
        // Move absorbed children into surviving container
        absorbed.children.forEach(child => {
          const reparented = { ...child, parentId: survivingId };
          updated = addChildToTree(updated, survivingId, reparented);
        });
        // Remove absorbed container (now empty)
        const { remaining } = extractFromTree(updated, absorbedId);
        updated = remaining;
      });
      return updated;
    });
  };

  const handleUpdateSlot = (id, slot) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    if (activeTierId !== BASE_TIER_ID) {
      // Save to breakpoint override instead of base
      setContainers(prev => prev.map(function upd(c) {
        if (c.id === id) {
          const adjusted = adjustSlotForAR(c, slot);
          const existing = c.breakpointOverrides?.[activeTierId]?.slot || {};
          return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [activeTierId]: { ...c.breakpointOverrides?.[activeTierId], slot: { ...existing, ...adjusted } } } };
        }
        return { ...c, children: c.children.map(upd) };
      }));
    } else {
      setContainers(prev => {
        const container = findContainerById(prev, id);
        return updateSlotInTree(prev, id, adjustSlotForAR(container, slot));
      });
    }
  };

  const handleUpdateWidgetPropsForBreakpoint = (id, props) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    if (activeTierId !== BASE_TIER_ID) {
      setContainers(prev => prev.map(function upd(c) {
        if (c.id === id) {
          const existing = c.breakpointOverrides?.[activeTierId]?.widgetProps || {};
          return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [activeTierId]: { ...c.breakpointOverrides?.[activeTierId], widgetProps: { ...existing, ...props } } } };
        }
        return { ...c, children: c.children.map(upd) };
      }));
    } else {
      handleUpdateWidgetProps(id, props);
    }
  };

  const handleToggleVisibility = (id, tierId) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) {
        const currentlyHidden = c.breakpointOverrides?.[tierId]?.hidden ?? false;
        return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [tierId]: { ...c.breakpointOverrides?.[tierId], hidden: !currentlyHidden } } };
      }
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handleClearBreakpointOverrides = (id, tierId) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) {
        const newOverrides = { ...c.breakpointOverrides };
        delete newOverrides[tierId];
        return { ...c, breakpointOverrides: newOverrides };
      }
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handleUpdateCoord = (id, coord) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    setContainers(prev => {
      const container = findContainerById(prev, id);
      return updateCoordInTree(prev, id, adjustCoordForAR(container, coord));
    });
  };

  const handleSetAspectRatio = (id, ratio) => {
    // LOCK GUARD
    if (isLockedOrAncestorLocked(containers, id)) return;
    // Sets the ratio flag AND immediately applies it to current dimensions
    // in one atomic state update so there's no stale-closure timing issue.
    setContainers(prev => prev.map(function upd(c) {
      if (c.id === id) {
        const withRatio = { ...c, aspectRatio: ratio ?? null };
        if (!ratio) return withRatio; // Free — just clear the lock
        // Apply immediately to whichever dimension system the container uses
        if (typeof c.coord?.width === 'number' && !isNaN(c.coord.width)) {
          return { ...withRatio, coord: { ...c.coord, height: Math.round(c.coord.width / ratio) } };
        }
        const wStr = c.slot?.width;
        if (typeof wStr === 'string' && wStr.endsWith('px')) {
          const w = parseFloat(wStr);
          if (!isNaN(w)) return { ...withRatio, slot: { ...c.slot, height: `${Math.round(w / ratio)}px` } };
        }
        return withRatio;
      }
      return { ...c, children: c.children.map(upd) };
    }));
  };

  const handleUpdatePageType = (id, pageType) => {
    // Root only; root is not lockable, so no guard needed.
    setContainers(prev => updatePageTypeInTree(prev, id, pageType));
  };

  const openWizard = () => {
    setCurrentStep(0);
    setSelectedAssetIds([]);
    setSelectedTags([]);
    setPopupVisible(true);
  };

  const closeWizard = () => setPopupVisible(false);

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      closeWizard();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  };

  const isLastStep = currentStep === STEPS.length - 1;

  // Pass 2 — is the current selection (single or multi) locked?
  // Drives the greyed-out / disabled treatment in the details panel and toolbar.
  const lockSelectionIds = selectedContainerIds.length > 0
    ? selectedContainerIds
    : (selectedContainerId ? [selectedContainerId] : []);
  const isSelectedLocked = lockSelectionIds.some(
    id => id !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(containers, id)
  );

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
            Aetherium ▾
          </span>
          {menuOpen && (
            <div className="app-titlebar-dropdown">
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
        <div className="app-titlebar-right-cluster">
        {currentView !== 'operator' && (
          <button
            onClick={() => {
              if (!activePageId) {
                window.alert('Save this screen first, then Launch will open its runtime view in a new tab.');
                return;
              }
              const url = `${window.location.origin}${window.location.pathname}?runtime=${activePageId}`;
              window.open(url, '_blank');
            }}
            title={activePageId ? 'Open a chrome-free runtime view of this screen in a new tab' : 'Save this screen first'}
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

          // Only 'screens' and 'entities' have a title-bar Save concept.
          // Everything else (widgets, theme, datasources, queries, scripts)
          // either auto-saves on every keystroke already or has nothing to
          // save at all — this used to silently fall through to the PAGE
          // save handler for all of those, which is how phantom pages named
          // after whatever was being tested on another screen got created.
          const saveInfo = currentView === 'operator'
            ? {
                enabled: operatorSaveAvailable,
                label: operatorSaveAvailable
                  ? "Save this type's display template"
                  : 'Select a type in the Now area to save its display template',
              }
            : {
                screens:      { enabled: true,  label: currentView === 'screens' && activePageId ? 'Save this screen' : 'Save as a new screen' },
                entities:     { enabled: true,  label: 'Save entity data' },
                datasources:  { enabled: true,  label: 'Save this data source' },
                queries:      { enabled: true,  label: 'Save this query' },
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
                  handleSavePage();
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
            </button>
          );
        })()}
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="10" cy="3.5" r="2.2" stroke="white" strokeWidth="1.4" />
              <path d="M10 5.7V9M10 9H4M10 9H16M4 9V11.5M16 9V11.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="4" cy="14" r="2.2" stroke="white" strokeWidth="1.4" />
              <circle cx="16" cy="14" r="2.2" stroke="white" strokeWidth="1.4" />
            </svg>
            <span className="app-titlebar-model-label">
              {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.label}
            </span>
          </div>
          {modelMenuOpen && (
            <div className="app-titlebar-dropdown app-titlebar-dropdown--right">
              {AVAILABLE_MODELS.map(m => (
                <div
                  key={m.id}
                  className={`app-titlebar-dropdown-item${selectedModel === m.id ? ' active' : ''}`}
                  onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false); }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          )}
        </div>
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
          <OperatorWorkspace ref={operatorWorkspaceRef} selectedModel={selectedModel} operatorPersona={operatorPersona} onSaveAvailabilityChange={setOperatorSaveAvailable} />

        ) : (
          <Splitter orientation="horizontal" style={{ height: '100%' }}>
            <SplitterItem size="220px" minSize="120px" resizable={true}>
            <div className="app-panel">
              <TabPanel
                height="100%"
                animationEnabled={false}
                swipeEnabled={false}
              >
                <TabPanelItem title="Screens">
                  <div className="left-panel-tab-content" style={{ height: '100%' }}>
                    <ScreensPanel
                      pages={pages}
                      folders={folders}
                      activePageId={activePageId}
                      isDirty={isDirty}
                      onOpenPage={handleOpenPage}
                      onCreatePage={handleCreatePage}
                      onDeletePage={handleDeletePage}
                      onCreateFolder={handleCreateFolder}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onMovePageToFolder={handleMovePageToFolder}
                    />
                  </div>
                </TabPanelItem>
                <TabPanelItem title="Visuals">
                  <div className="left-panel-tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
                      <input
                        className="details-input"
                        style={{ width: '100%' }}
                        value={visualsSearch}
                        onChange={(e) => setVisualsSearch(e.target.value)}
                        placeholder="Search widgets…"
                      />
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      <HierarchyTree
                        dataSource={sortAndFilterHierarchy(DX_WIDGET_DATA, visualsSearch)}
                        displayExpr="name"
                        itemRender={(item) => WidgetTreeItemTemplate(item, (item) => {
                          const selected = selectedContainerId
                            ? findContainerById(containers, selectedContainerId)
                            : null;
                          const targetId = selected?.isWidget
                            ? (selected.parentId || ROOT_CONTAINER_ID)
                            : (selectedContainerId || ROOT_CONTAINER_ID);
                          handleWidgetDrop(targetId, item.name);
                        })}
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
                        value={dataTabMode}
                        onValueChanged={e => setDataTabMode(e.value)}
                        stylingMode="outlined"
                        width="100%"
                        height={26}
                      />
                    </div>
                    <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
                      <input
                        className="details-input"
                        style={{ width: '100%' }}
                        value={dataTabSearch}
                        onChange={(e) => setDataTabSearch(e.target.value)}
                        placeholder={dataTabMode === 'model' ? 'Search model…' : 'Search queries…'}
                      />
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      {dataTabMode === 'model' ? (
                        <HierarchyTree
                          dataSource={sortAndFilterHierarchy(ASSET_DATA, dataTabSearch)}
                          displayExpr="name"
                          itemRender={AssetTreeItemTemplate}
                        />
                      ) : (
                        <div>
                          {!activePageId && (
                            <div style={{ padding: '10px 14px', fontSize: 11, color: '#7a6000', background: '#fffbe6', borderBottom: '1px solid #ffe08a' }}>
                              Save this screen first — query instances need a real page to belong to.
                            </div>
                          )}
                          {queries.length === 0 ? (
                            <p style={{ padding: '12px 14px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 }}>
                              No queries yet. Create one in the Queries workspace first.
                            </p>
                          ) : (() => {
                            const queryFilter = dataTabSearch.trim().toLowerCase();
                            const visibleQueries = [...queries]
                              .filter(q => !queryFilter || (q.name || '').toLowerCase().includes(queryFilter))
                              .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                            if (visibleQueries.length === 0) {
                              return (
                                <p style={{ padding: '12px 14px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 }}>
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
                                      handleAddQueryInstance({ queryId: q.id });
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
                      onSelect={(id) => {
                        setSelectedQueryInstanceId(null); // mirror of the guard added to the Page Data click handler
                        setSelectedContainerId(id);
                        setSelectedContainerIds(id ? [id] : []);
                      }}
                      onReparent={handleTreeReparent}
                      onToggleLock={handleToggleLock}
                    />
                  </div>
                </TabPanelItem>
                <TabPanelItem title="Page Data">
                  <div className="left-panel-tab-content">
                    {(() => {
                      const pageInstances = queryInstances.filter(qi => qi.pageId === activePageId);
                      if (pageInstances.length === 0) {
                        return (
                          <p style={{ padding: '12px 14px', fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.5 }}>
                            No queries added to this page yet. Add one from the Data tab.
                          </p>
                        );
                      }
                      return pageInstances.map(qi => {
                        const q = queries.find(qq => qq.id === qi.queryId);
                        const isSelected = qi.id === selectedQueryInstanceId;
                        return (
                          <div
                            key={qi.id}
                            onClick={() => {
                              // Mirror of the clear in handleContainerSelect — switching to a
                              // Page Data selection must clear the container selection too, or
                              // both sections render stacked instead of one replacing the other.
                              setSelectedContainerId(null);
                              setSelectedContainerIds([]);
                              setSelectedQueryInstanceId(qi.id);
                            }}
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
                                if (isSelected) setSelectedQueryInstanceId(null);
                                handleDeleteQueryInstance(qi.id);
                              }}
                            >×</button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </TabPanelItem>
              </TabPanel>
            </div>
          </SplitterItem>
          <SplitterItem resizable={true}>
            <div className="app-panel app-panel--center">
              <div className="center-toolbar">
                {/* Device picker — always visible */}
                <DevicePicker
                  activeDeviceId={activeDeviceId}
                  activeTierId={activeTierId}
                  customWidth={customWidth}
                  customHeight={customHeight}
                  onDeviceSelect={handleDeviceSelect}
                  onCustomChange={(w, h) => { setCustomWidth(w); setCustomHeight(h); }}
                  open={devicePickerOpen}
                  onToggle={() => setDevicePickerOpen(o => !o)}
                />
                <div style={{ width: 1, height: 20, background: '#e0e0e0', margin: '0 4px', flexShrink: 0 }} />
                {/* Snap toggle + threshold input — always visible, canvas-level settings */}
                <button
                  className={`focus-mode-btn${snapEnabled ? ' focus-mode-btn--active' : ''}`}
                  onClick={() => setSnapEnabled(s => !s)}
                  title={snapEnabled ? 'Snap on (grid + elements) — click to disable' : 'Snap off — click to enable'}
                >
                  {snapEnabled ? '⊞ Snap' : '⊟ Snap'}
                </button>
                {snapEnabled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={snapSize}
                      onChange={(e) => setSnapSize(Math.max(1, Math.min(64, parseInt(e.target.value) || 8)))}
                      style={{ width: 40, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d1d1', borderRadius: 4, textAlign: 'center' }}
                      title="Snap threshold — controls grid interval and element-snap proximity"
                    />
                    <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>px</span>
                  </div>
                )}
                {selectedContainerId && (
                  <>
                    <Button
                      text="+ Add Container"
                      type="default"
                      stylingMode="outlined"
                      disabled={isSelectedLocked}
                      onClick={handleAddContainer}
                    />
                    <button
                      className={`focus-mode-btn${focusMode === 'stay' ? ' focus-mode-btn--active' : ''}`}
                      onClick={() => setFocusMode(m => m === 'follow' ? 'stay' : 'follow')}
                      title={focusMode === 'follow' ? 'Follow mode: focus moves to new container' : 'Stay mode: focus stays on parent'}
                    >
                      {focusMode === 'follow' ? '⤵ Follow' : '📌 Stay'}
                    </button>
                    {(() => {
                      const sel = findContainerById(containers, selectedContainerId);
                      if (!sel || sel.isWidget) return null;
                      const dir = sel.layout?.flexDirection || 'row';
                      return (
                        <button
                          className={`focus-mode-btn${dir === 'column' ? ' focus-mode-btn--active' : ''}`}
                          title={`Direction: ${dir} — click to toggle`}
                          disabled={isSelectedLocked}
                          onClick={() => handleUpdateLayout(selectedContainerId, { flexDirection: dir === 'row' ? 'column' : 'row' })}
                        >
                          <i className={dir === 'row' ? 'dx-icon-deleterow' : 'dx-icon-deletecolumn'} style={{ marginRight: 4 }} />
                          {dir}
                        </button>
                      );
                    })()}
                    <button
                      className={`focus-mode-btn${!showGap ? ' focus-mode-btn--active' : ''}`}
                      onClick={() => setShowGap(g => !g)}
                      title={showGap ? 'Gap on — click to remove spacing' : 'Gap off — click to restore spacing'}
                    >
                      {showGap ? '⬜ Gap' : '▣ Gap'}
                    </button>
                    {(() => {
                      const sel = selectedContainerId ? findContainerById(containers, selectedContainerId) : null;
                      const selParent = sel?.parentId ? findContainerById(containers, sel.parentId) : null;
                      const isCoordChild = selParent?.layout?.layoutType === 'coordinate';
                      return (
                        <>
                          {/* Copy button */}
                          {sel && sel.id !== ROOT_CONTAINER_ID && (
                            <button className="focus-mode-btn" title="Copy (Ctrl/Cmd+C)" disabled={isSelectedLocked} onClick={handleCopy}>
                              ⎘ Copy
                            </button>
                          )}
                          {/* Paintbrush button */}
                          {sel && sel.id !== ROOT_CONTAINER_ID && (
                            <button
                              className={`focus-mode-btn${paintbrush ? ' focus-mode-btn--active' : ''}`}
                              title={paintbrush ? 'Paintbrush active — click any item to apply styles. Click again to cancel.' : 'Pick up style to paint onto other items'}
                              disabled={isSelectedLocked && !paintbrush}
                              onClick={() => paintbrush ? setPaintbrush(null) : handlePickUpPaintbrush()}
                            >
                              🖌 {paintbrush ? 'Painting...' : 'Paintbrush'}
                            </button>
                          )}
                          {/* Cancel paintbrush if active but nothing selected */}
                          {!sel && paintbrush && (
                            <button className="focus-mode-btn focus-mode-btn--active" onClick={() => setPaintbrush(null)}>
                              🖌 Cancel Paint
                            </button>
                          )}
                          {/* Paste button — when clipboard has content */}
                          {clipboard && (
                            <button
                              className="focus-mode-btn focus-mode-btn--active"
                              title="Paste (Ctrl/Cmd+V)"
                              disabled={isSelectedLocked}
                              onClick={handlePaste}
                            >
                              ⊕ Paste
                            </button>
                          )}
                          {/* Delete button — for any non-root selected item */}
                          {sel && sel.id !== ROOT_CONTAINER_ID && (
                            <button
                              className="focus-mode-btn"
                              style={{ color: '#d00', borderColor: '#d00' }}
                              title="Delete selected container"
                              disabled={isSelectedLocked}
                              onClick={() => handleDeleteContainer(selectedContainerId)}
                            >
                              × Delete
                            </button>
                          )}
                          {/* Move/Reparent toggle — only for coord children */}
                          {isCoordChild && (
                            <button
                              className={`focus-mode-btn${coordMode === 'reparent' ? ' focus-mode-btn--active' : ''}`}
                              disabled={isSelectedLocked}
                              onClick={() => setCoordMode(m => m === 'reposition' ? 'reparent' : 'reposition')}
                              title={coordMode === 'reposition' ? 'Drag moves item — click to switch to reparent' : 'Drag reparents item — click to switch to reposition'}
                            >
                              {coordMode === 'reposition' ? '⤢ Move' : '⇄ Reparent'}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
              <div
                className="center-content"
                onClick={() => { setSelectedContainerId(null); setSelectedContainerIds([]); setSelectedGridCell(null); setDevicePickerOpen(false); if (paintbrush) setPaintbrush(null); setBindingPopoverProp(null); }}
                style={{ cursor: paintbrush ? 'crosshair' : undefined }}
              >
                {/* Device preview wrapper */}
                <div className="aetherium-canvas-scroll" style={{
                  width: '100%', height: '100%',
                  overflow: 'auto',
                  display: 'flex',
                  alignItems: previewWidth ? 'flex-start' : 'stretch',
                  justifyContent: previewWidth ? 'center' : 'stretch',
                  padding: previewWidth ? 24 : 0,
                  boxSizing: 'border-box',
                  background: previewWidth ? '#e8e8e8' : 'transparent',
                }}>
                  <div style={{
                    width: previewWidth ? previewWidth : '100%',
                    height: previewHeight ? previewHeight : '100%',
                    flexShrink: 0,
                    background: '#fff',
                    boxShadow: previewWidth ? '0 2px 16px rgba(0,0,0,0.15)' : 'none',
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    <div className={`container-canvas${showGap ? '' : ' canvas-no-gap'}`} style={{ padding: 0, height: '100%', boxSizing: 'border-box' }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); setDraggingId(null); setDragState({ overId: null, beforeId: null, overParentId: null }); }}
                    >
                  {containers.map(c => (
                    <ContainerCard
                      key={c.id}
                      container={c}
                      containers={containers}
                      selectedIds={selectedContainerIds}
                      onSelect={handleContainerSelect}
                      onDelete={handleDeleteContainer}
                      onDragStart={handleDragStart}
                      onDragOver={(overId, beforeId, overParentId) => handleDragOver(overId, beforeId, overParentId)}
                      onDrop={handleDrop}
                      onWidgetDrop={handleWidgetDrop}
                      onUpdateLayout={handleUpdateLayout}
                      onUpdateSlot={handleUpdateSlot}
                      onUpdateCoord={handleUpdateCoord}
                      onGridCellDrop={handleGridCellDrop}
                      onSetSelectedGridCell={setSelectedGridCell}
                      onMergeCellContainers={handleMergeCellContainers}
                      selectedGridCell={selectedGridCell}
                      dragState={dragState}
                      draggingId={draggingId}
                      isDragging={!!draggingId}
                      coordMode={coordMode}
                      activeTierId={activeTierId}
                      snapEnabled={snapEnabled}
                      snapSize={snapSize}
                      snapGuides={snapGuides}
                      onSnapGuideChange={setSnapGuides}
                    />
                  ))}
                </div>
                  </div>
                </div>
              </div>
            </div>
          </SplitterItem>
          <SplitterItem size="220px" minSize="120px" resizable={true}>
            <div className="app-panel details-panel aetherium-canvas-scroll">
              {(() => {
                const isBase = activeTierId === BASE_TIER_ID;
                const tier = getTierById(activeTierId);
                return (
                  <div className="details-panel-header" style={{
                    background: isBase ? undefined : tier?.color,
                    color: isBase ? undefined : '#fff',
                    transition: 'background 0.2s',
                  }}>
                    <span className="panel-label" style={{ color: isBase ? undefined : '#fff', margin: 0 }}>
                      {isBase ? 'Details' : `${tier?.icon} ${tier?.label} Overrides`}
                    </span>
                    <Button
                      text="Create"
                      type={isBase ? 'default' : 'normal'}
                      stylingMode="outlined"
                      onClick={openWizard}
                      style={{ marginLeft: 'auto' }}
                    />
                  </div>
                );
              })()}

              {/* Locked banner (Pass 2) */}
              {isSelectedLocked && (
                <div className="details-locked-banner">🔒 Locked — unlock to edit</div>
              )}

              {/* Query instance details (Page Data tab selection) */}
              {selectedQueryInstanceId && (() => {
                const inst = findQueryInstance(queryInstances, selectedQueryInstanceId, activePageId);
                const q = inst ? queries.find(qq => qq.id === inst.queryId) : null;
                return inst ? (
                  <QueryInstanceDetailsPanel
                    instance={inst}
                    query={q}
                    evaluateExpression={evaluateExpression}
                    openBindingField={inputBindingPopover?.instanceId === inst.id ? inputBindingPopover.fieldName : null}
                    onOpenBindingPopover={(fieldName, rect) => {
                      if (inputBindingPopover?.instanceId === inst.id && inputBindingPopover?.fieldName === fieldName) {
                        setInputBindingPopover(null);
                        return;
                      }
                      setInputBindingPopover({ instanceId: inst.id, fieldName, x: rect.left, y: rect.top });
                    }}
                  />
                ) : null;
              })()}

              {/* Multi-select panel */}
              {selectedContainerIds.length > 1 && (() => {
                const selected = selectedContainerIds
                  .map(id => findContainerById(containers, id))
                  .filter(Boolean);

                const sb = (ds, val, fn) => (
                  <SelectBox
                    dataSource={ds}
                    value={val}
                    onValueChanged={(e) => fn(e.value)}
                    stylingMode="outlined"
                    width="100%"
                    height={24}
                  />
                );

                const ti = (val, placeholder, fn, type = 'text') => (
                  <input
                    className="details-input"
                    type={type}
                    value={val ?? ''}
                    placeholder={placeholder}
                    onChange={(e) => fn(type === 'number' ? (e.target.value === '' ? '' : (parseFloat(e.target.value) || 0)) : e.target.value)}
                  />
                );

                // Helper: get shared value or null if values differ
                const shared = (getter) => {
                  const vals = selected.map(getter);
                  return vals.every(v => v === vals[0]) ? vals[0] : undefined;
                };

                // Update all selected
                const updateAllSlot = (slot) => selected.forEach(c => handleUpdateSlot(c.id, slot));
                const updateAllLayout = (layout) => selected.forEach(c => handleUpdateLayout(c.id, layout));
                const updateAllWidgetProps = (props) => selected.forEach(c => c.isWidget && handleUpdateWidgetProps(c.id, props));

                // Shared slot values
                const allHaveParent = selected.every(c => c.parentId !== null);

                // Coordinate-mode detection — each item's OWN parent may differ, so this
                // is computed per-item rather than assumed from a single shared parent.
                const isCoordItem = (c) => findContainerById(containers, c.parentId)?.layout?.layoutType === 'coordinate';
                const allCoord = allHaveParent && selected.every(isCoordItem);
                const allFlexLike = allHaveParent && selected.every(c => !isCoordItem(c));
                const mixedLayoutTypes = allHaveParent && !allCoord && !allFlexLike;

                const updateAllCoord = (coord) => selected.forEach(c => handleUpdateCoord(c.id, coord));

                const sharedWidth = shared(c => c.slot?.width);
                const sharedHeight = shared(c => c.slot?.height);
                const sharedGrow = shared(c => c.slot?.flexGrow);
                const sharedShrink = shared(c => c.slot?.flexShrink);

                // Shared widget props — intersect by property NAME across all selected widgets
                const allWidgets = selected.every(c => c.isWidget);
                const sharedWidgetName = shared(c => c.widgetName);

                // Build intersection of property definitions by name
                const sharedPropDefs = (() => {
                  if (!allWidgets) return [];
                  const propMaps = selected.map(c => {
                    const defs = WIDGET_PROPERTIES[c.widgetName] || [];
                    return new Map(defs.map(p => [p.name, p]));
                  });
                  if (propMaps.length === 0) return [];
                  // Start with first widget's props, keep only those present in ALL others
                  return [...propMaps[0].values()].filter(p =>
                    propMaps.every(m => m.has(p.name))
                  );
                })();

                return (
                  <div key={selectedContainerIds.join(',')} className={isSelectedLocked ? 'details-locked' : undefined}>
                    <div className="details-section">
                      <div className="details-grid">
                        <span className="details-section-title">{selected.length} items selected</span>
                      </div>
                    </div>

                    {allCoord && (
                      <div className="details-section">
                        <div className="details-grid">
                          <span className="details-section-title">Coordinate</span>
                          <span className="details-grid-label">Left</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.left), '—', v => updateAllCoord({ left: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Right</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.right), '—', v => updateAllCoord({ right: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Top</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.top), '—', v => updateAllCoord({ top: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Bottom</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.bottom), '—', v => updateAllCoord({ bottom: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Width</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.width), '—', v => updateAllCoord({ width: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Min W</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.minWidth), '—', v => updateAllCoord({ minWidth: v }))}</div>
                          <span className="details-grid-label">Max W</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.maxWidth), '—', v => updateAllCoord({ maxWidth: v }))}</div>
                          <span className="details-grid-label">Height</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.height), '—', v => updateAllCoord({ height: v === '' ? '' : Number(v) }), 'number')}</div>
                          <span className="details-grid-label">Min H</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.minHeight), '—', v => updateAllCoord({ minHeight: v }))}</div>
                          <span className="details-grid-label">Max H</span>
                          <div className="details-grid-control">{ti(shared(c => c.coord?.maxHeight), '—', v => updateAllCoord({ maxHeight: v }))}</div>
                          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#aaa', fontStyle: 'italic', paddingTop: 2 }}>
                            Aspect ratio lock isn't available for multi-select yet.
                          </div>
                        </div>
                      </div>
                    )}

                    {mixedLayoutTypes && (
                      <div className="details-section">
                        <div className="details-grid">
                          <span className="details-section-title">Slot</span>
                          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#7a6000', background: '#fffbe6', border: '1px solid #ffe08a', borderRadius: 4, padding: '6px 8px', lineHeight: 1.5 }}>
                            This selection mixes coordinate-layout and flex-layout items — position/size editing isn't available together. Select only coordinate items or only flex items to edit dimensions in bulk.
                          </div>
                        </div>
                      </div>
                    )}

                    {allFlexLike && (
                      <div className="details-section">
                        <div className="details-grid">
                          <span className="details-section-title">Slot</span>
                          <span className="details-grid-label">Width</span>
                          <div className="details-grid-control">{ti(sharedWidth, '—', v => updateAllSlot({ width: v }))}</div>
                          <span className="details-grid-label">Min W</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.minWidth), '—', v => updateAllSlot({ minWidth: v }))}</div>
                          <span className="details-grid-label">Max W</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.maxWidth), '—', v => updateAllSlot({ maxWidth: v }))}</div>
                          <span className="details-grid-label">Height</span>
                          <div className="details-grid-control">{ti(sharedHeight, '—', v => updateAllSlot({ height: v }))}</div>
                          <span className="details-grid-label">Min H</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.minHeight), '—', v => updateAllSlot({ minHeight: v }))}</div>
                          <span className="details-grid-label">Max H</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.maxHeight), '—', v => updateAllSlot({ maxHeight: v }))}</div>
                          <span className="details-grid-label">Grow</span>
                          <div className="details-grid-control">{sb([0,1,2,3], sharedGrow, v => updateAllSlot({ flexGrow: v }))}</div>
                          <span className="details-grid-label">Shrink</span>
                          <div className="details-grid-control">{sb([0,1,2,3], sharedShrink, v => updateAllSlot({ flexShrink: v }))}</div>
                        </div>
                      </div>
                    )}

                    {allHaveParent && (
                      <div className="details-section">
                        <div className="details-grid">
                          <span className="details-section-title">Box</span>
                          <span className="details-grid-label">Pad Top</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.paddingTop), '—', v => updateAllSlot({ paddingTop: v }))}</div>
                          <span className="details-grid-label">Pad Bottom</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.paddingBottom), '—', v => updateAllSlot({ paddingBottom: v }))}</div>
                          <span className="details-grid-label">Pad Left</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.paddingLeft), '—', v => updateAllSlot({ paddingLeft: v }))}</div>
                          <span className="details-grid-label">Pad Right</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.paddingRight), '—', v => updateAllSlot({ paddingRight: v }))}</div>
                          <span className="details-grid-label">Margin Top</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.marginTop), '—', v => updateAllSlot({ marginTop: v }))}</div>
                          <span className="details-grid-label">Margin Bottom</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.marginBottom), '—', v => updateAllSlot({ marginBottom: v }))}</div>
                          <span className="details-grid-label">Margin Left</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.marginLeft), '—', v => updateAllSlot({ marginLeft: v }))}</div>
                          <span className="details-grid-label">Margin Right</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.marginRight), '—', v => updateAllSlot({ marginRight: v }))}</div>
                          <span className="details-grid-label">Border Width</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.borderWidth), '—', v => updateAllSlot({ borderWidth: v }))}</div>
                          <span className="details-grid-label">Border Style</span>
                          <div className="details-grid-control">{sb(['','solid','dashed','dotted','double','none'], shared(c => c.slot?.borderStyle), v => updateAllSlot({ borderStyle: v }))}</div>
                          <span className="details-grid-label">Border Color</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.borderColor), '—', v => updateAllSlot({ borderColor: v }))}</div>
                          <span className="details-grid-label">Border Radius</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.borderRadius), '—', v => updateAllSlot({ borderRadius: v }))}</div>
                          <span className="details-grid-label">Bg Color</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.backgroundColor), '—', v => updateAllSlot({ backgroundColor: v }))}</div>
                          <span className="details-grid-label">Text Color</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.color), '—', v => updateAllSlot({ color: v }))}</div>
                          <span className="details-grid-label">Font Size</span>
                          <div className="details-grid-control">{ti(shared(c => c.slot?.fontSize), '—', v => updateAllSlot({ fontSize: v }))}</div>
                          <span className="details-grid-label">Font Weight</span>
                          <div className="details-grid-control">{sb(['','normal','bold','300','400','500','600','700'], shared(c => c.slot?.fontWeight), v => updateAllSlot({ fontWeight: v }))}</div>
                          <span className="details-grid-label">Text Align</span>
                          <div className="details-grid-control">{sb(['','left','center','right','justify'], shared(c => c.slot?.textAlign), v => updateAllSlot({ textAlign: v }))}</div>
                          <span className="details-grid-label">Overflow X</span>
                          <div className="details-grid-control">
                            <SelectBox
                              dataSource={[
                                { v: 'auto',    l: 'Auto (if needed)' },
                                { v: 'hidden',  l: 'Hidden / Clip' },
                                { v: 'scroll',  l: 'Scroll (always)' },
                                { v: 'visible', l: 'Visible ⚠' },
                              ]}
                              valueExpr="v"
                              displayExpr="l"
                              value={shared(c => c.slot?.overflowX) || 'auto'}
                              onValueChanged={(e) => updateAllSlot({ overflowX: e.value })}
                              stylingMode="outlined"
                              width="100%"
                              height={24}
                            />
                          </div>
                          <span className="details-grid-label">Overflow Y</span>
                          <div className="details-grid-control">
                            <SelectBox
                              dataSource={[
                                { v: 'auto',    l: 'Auto (if needed)' },
                                { v: 'hidden',  l: 'Hidden / Clip' },
                                { v: 'scroll',  l: 'Scroll (always)' },
                                { v: 'visible', l: 'Visible ⚠' },
                              ]}
                              valueExpr="v"
                              displayExpr="l"
                              value={shared(c => c.slot?.overflowY) || 'auto'}
                              onValueChanged={(e) => updateAllSlot({ overflowY: e.value })}
                              stylingMode="outlined"
                              width="100%"
                              height={24}
                            />
                          </div>
                          {(shared(c => c.slot?.overflowX) === 'visible' || shared(c => c.slot?.overflowY) === 'visible') && (
                            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#8a5a00', background: '#fff8e6', border: '1px solid #f0c987', padding: '4px 8px', borderRadius: 4, margin: '2px 0' }}>
                              ⚠ Visible overflow: content may render outside these containers' bounds.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {sharedPropDefs.length > 0 && (
                      <div className="details-section">
                        <div className="details-grid">
                          <span className="details-section-title">{sharedWidgetName ? `${sharedWidgetName} Properties` : 'Shared Widget Properties'}</span>
                          {sharedPropDefs.map(p => {
                            const sharedVal = shared(c => c.widgetProps?.[p.name]);
                            return (
                              <React.Fragment key={p.name}>
                                <span className="details-grid-label">{p.label}</span>
                                <div className="details-grid-control">
                                  {p.type === 'bool' && sb(
                                    [{ v: true, l: 'true' }, { v: false, l: 'false' }],
                                    sharedVal,
                                    v => updateAllWidgetProps({ [p.name]: v }),
                                  )}
                                  {p.type === 'enum' && sb(p.options, sharedVal, v => updateAllWidgetProps({ [p.name]: v }))}
                                  {p.type === 'string' && ti(sharedVal, '—', v => updateAllWidgetProps({ [p.name]: v }))}
                                  {p.type === 'number' && ti(sharedVal, '—', v => updateAllWidgetProps({ [p.name]: v }), 'number')}
                                </div>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {selectedContainerIds.length <= 1 && selectedContainerId && (() => {
                const flat = flattenContainers(containers);
                const found = flat.find(c => c.id === selectedContainerId);
                const fullContainer = found ? findContainerById(containers, selectedContainerId) : null;
                if (!found || !fullContainer) return null;

                // Override-aware values
                const isBase = activeTierId === BASE_TIER_ID;
                const tier = getTierById(activeTierId);
                const overrides = fullContainer.breakpointOverrides?.[activeTierId] || {};
                const isHidden = overrides.hidden ?? false;
                const hasOverrides = Object.keys(fullContainer.breakpointOverrides || {}).some(t => {
                  const o = fullContainer.breakpointOverrides[t];
                  return Object.keys(o).length > 0;
                });

                const layout = fullContainer.layout || DEFAULT_LAYOUT;
                // Merge slot with breakpoint override for display
                const baseSlot = fullContainer.slot || DEFAULT_SLOT;
                const slot = isBase ? baseSlot : { ...baseSlot, ...(overrides.slot || {}) };

                const parentContainer = fullContainer.parentId !== null
                  ? findContainerById(containers, fullContainer.parentId)
                  : null;

                const sb = (ds, val, fn) => (
                  <SelectBox
                    dataSource={ds}
                    value={val}
                    onValueChanged={(e) => fn(e.value)}
                    stylingMode="outlined"
                    width="100%"
                    height={24}
                  />
                );

                const ti = (val, placeholder, fn, type = 'text') => (
                  <input
                    className="details-input"
                    type={type}
                    value={val}
                    placeholder={placeholder}
                    onChange={(e) => fn(type === 'number' ? (e.target.value === '' ? '' : (parseInt(e.target.value) || 0)) : e.target.value)}
                  />
                );

                const lockedClass = isSelectedLocked ? ' details-locked' : '';

                // ── Aspect ratio helpers (used in Slot tab) ────────────────
                const currentAr = fullContainer.aspectRatio ?? null;
                const arPresetMatch = currentAr !== null
                  ? ASPECT_RATIO_PRESETS.find(p => p.value !== null && Math.abs(p.value - currentAr) < 0.001)
                  : null;
                const arSelectValue = currentAr === null
                  ? null
                  : (arPresetMatch ? arPresetMatch.value : CUSTOM_RATIO_SENTINEL);
                const arDataSource = currentAr !== null && !arPresetMatch
                  ? [...ASPECT_RATIO_PRESETS, { label: '🔒 Custom', value: CUSTOM_RATIO_SENTINEL }]
                  : ASPECT_RATIO_PRESETS;

                const handleLockCurrentRatio = () => {
                  const isCoordChild = parentContainer?.layout?.layoutType === 'coordinate';
                  let w, h;
                  if (isCoordChild) {
                    w = fullContainer.coord?.width;
                    h = fullContainer.coord?.height;
                    if (typeof w !== 'number' || typeof h !== 'number' || h === 0) return;
                  } else {
                    if (!slot?.width?.endsWith?.('px') || !slot?.height?.endsWith?.('px')) return;
                    w = parseFloat(slot.width);
                    h = parseFloat(slot.height);
                    if (isNaN(w) || isNaN(h) || h === 0) return;
                  }
                  handleSetAspectRatio(selectedContainerId, w / h);
                };

                // ── Stretch mode detection (coord layout) ──────────────────
                // Stretch = both edges on an axis have values → size is derived.
                const coordVals = fullContainer.coord || DEFAULT_COORD;
                const coordIsSet = (v) => v !== '' && v !== undefined && v !== null;
                const isStretchX = coordIsSet(coordVals.left) && coordIsSet(coordVals.right);
                const isStretchY = coordIsSet(coordVals.top)  && coordIsSet(coordVals.bottom);

                return (
                  <div key={selectedContainerId} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <TabPanel
                      height="100%"
                      animationEnabled={false}
                      swipeEnabled={false}
                      selectedIndex={detailsTabIndex}
                      onSelectedIndexChange={setDetailsTabIndex}
                    >

                      {/* Tab: Widget — DevExtreme widget properties */}
                      {fullContainer.isWidget && fullContainer.widgetName && (() => {
                        const propDefs = WIDGET_PROPERTIES[fullContainer.widgetName];
                        if (!propDefs || propDefs.length === 0) return null;
                        const props = fullContainer.widgetProps || {};
                        const bindings = fullContainer.bindings || {};
                        return (
                          <TabPanelItem title={fullContainer.widgetName}>
                            <div className={`details-tab-content${lockedClass}`}>
                              <div className="details-section">
                                <div className="details-grid">
                                  <span className="details-section-title">{fullContainer.widgetName}</span>
                                  {propDefs.map(p => {
                                    const binding = bindings[p.name];
                                    const isBound = !!binding;
                                    const isOpen = bindingPopoverProp?.containerId === selectedContainerId && bindingPopoverProp?.propName === p.name;

                                    // Query and Expression bindings show different things here — a
                                    // query binding has no `expression` field to evaluate at all, so
                                    // this used to silently render blank. Now shows a descriptive
                                    // "Instance → OutputField" label instead (no live resolution yet
                                    // — that's a separate step — this is just making the binding
                                    // itself visible).
                                    let bindingDisplayText = '';
                                    let bindingTitle = '';
                                    let isErr = false;
                                    if (binding?.type === 'query') {
                                      const boundInst = findQueryInstance(queryInstances, binding.queryInstanceId, activePageId);
                                      const boundQuery = boundInst ? queries.find(qq => qq.id === boundInst.queryId) : null;
                                      const instLabel = boundInst?.alias || boundQuery?.name || null;
                                      // Scalar bindings set outputField (singular, one string). Collection
                                      // bindings set outputFields (plural, an array — possibly EMPTY, which
                                      // is valid and means "all fields", not "nothing selected"). This only
                                      // ever checked the scalar shape, so every valid collection binding —
                                      // anything bound to a grid/chart dataSource — fell through to "no
                                      // longer exists" regardless of whether it actually existed.
                                      const hasScalarField = !!binding.outputField;
                                      const hasCollectionFields = Array.isArray(binding.outputFields);
                                      if (instLabel && (hasScalarField || hasCollectionFields)) {
                                        const rowPick = binding.transform?.find(t => t.type === 'pickRow');
                                        const fieldsLabel = hasCollectionFields
                                          ? (binding.outputFields.length === 0 ? 'all fields' : binding.outputFields.map(f => f.fieldName).join(', '))
                                          : binding.outputField;
                                        bindingDisplayText = `${instLabel} → ${fieldsLabel}` + (rowPick ? ` (${rowPick.mode} row)` : '');
                                        bindingTitle = `Query: ${instLabel} → ${fieldsLabel}`;
                                      } else {
                                        bindingDisplayText = '(query or output no longer exists)';
                                        bindingTitle = 'The bound query instance or output field could not be found.';
                                        isErr = true;
                                      }
                                    } else if (binding?.expression) {
                                      const resolvedVal = evaluateExpression(binding.expression);
                                      bindingDisplayText = String(resolvedVal ?? '');
                                      bindingTitle = `Expression: ${binding.expression}`;
                                      isErr = resolvedVal === '#ERR';
                                    }
                                    return (
                                      <React.Fragment key={p.name}>
                                        <span className="details-grid-label">{p.label}</span>
                                        <div className="details-grid-control">
                                          <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%', minWidth: 0 }}>
                                            {isBound ? (
                                              <div
                                                className={`binding-value-display${isErr ? ' binding-value-display--error' : ''}`}
                                                title={bindingTitle}
                                                style={{ flex: 1, minWidth: 0 }}
                                              >
                                                ⚡ {bindingDisplayText}
                                              </div>
                                            ) : (
                                              <div style={{ flex: 1, minWidth: 0 }}>
                                                {p.type === 'bool' && <SelectBox dataSource={[{v:true,l:'true'},{v:false,l:'false'}]} displayExpr="l" valueExpr="v" value={props[p.name] ?? p.default} onValueChanged={(e) => handleUpdateWidgetProps(selectedContainerId, {[p.name]: e.value})} stylingMode="outlined" width="100%" height={24} />}
                                                {p.type === 'enum' && <SelectBox dataSource={p.options} value={props[p.name] ?? p.default} onValueChanged={(e) => handleUpdateWidgetProps(selectedContainerId, {[p.name]: e.value})} stylingMode="outlined" width="100%" height={24} />}
                                                {p.type === 'string' && <input className="details-input" style={{ width: '100%' }} value={props[p.name] ?? p.default} onChange={(e) => handleUpdateWidgetProps(selectedContainerId, {[p.name]: e.target.value})} />}
                                                {p.type === 'number' && <input className="details-input" style={{ width: '100%' }} type="number" value={props[p.name] ?? p.default} onChange={(e) => handleUpdateWidgetProps(selectedContainerId, {[p.name]: parseFloat(e.target.value) || 0})} />}
                                                {p.type === 'data' && (
                                                  <span style={{ fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>
                                                    Bind to set — no static value for a collection
                                                  </span>
                                                )}
                                              </div>
                                            )}
                                            {p.bindable !== false && (
                                              <button
                                                className={`binding-icon-btn${isBound ? ' binding-icon-btn--active' : ''}`}
                                                title={isBound ? `Edit binding: ${bindingTitle}` : 'Bind this property'}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (isOpen) { setBindingPopoverProp(null); return; }
                                                  const rect = e.currentTarget.getBoundingClientRect();
                                                  setBindingPopoverProp({ containerId: selectedContainerId, propName: p.name, x: rect.left, y: rect.top });
                                                }}
                                              >⚡</button>
                                            )}
                                          </div>
                                        </div>
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </TabPanelItem>
                        );
                      })()}

                      {/* Tab: Layout — container config, shown as "Widget" tab for containers */}
                      {!fullContainer.isWidget && fullContainer.id !== ROOT_CONTAINER_ID && (
                        <TabPanelItem title="Layout">
                          <div className={`details-tab-content${lockedClass}`}>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Layout</span>
                              <span className="details-grid-label">Type</span><div className="details-grid-control">{sb(['flex','coordinate','grid'],layout.layoutType,v=>handleUpdateLayout(selectedContainerId,{layoutType:v}))}</div>
                              {layout.layoutType === 'grid' ? (<>
                                <span className="details-grid-label">Columns</span><div className="details-grid-control">{ti(layout.gridColumns, '2', v => {
                                  const newCols = Math.max(1, parseInt(v)||2);
                                  const oldCells = layout.gridCells || buildDefaultCells(layout.gridColumns||2, layout.gridRows||2);
                                  handleUpdateLayout(selectedContainerId, { gridColumns: newCols, gridCells: migrateGridCells(oldCells, layout.gridColumns||2, layout.gridRows||2, newCols, layout.gridRows||2) });
                                }, 'number')}</div>
                                <span className="details-grid-label">Rows</span><div className="details-grid-control">{ti(layout.gridRows, '2', v => {
                                  const newRows = Math.max(1, parseInt(v)||2);
                                  const oldCells = layout.gridCells || buildDefaultCells(layout.gridColumns||2, layout.gridRows||2);
                                  handleUpdateLayout(selectedContainerId, { gridRows: newRows, gridCells: migrateGridCells(oldCells, layout.gridColumns||2, layout.gridRows||2, layout.gridColumns||2, newRows) });
                                }, 'number')}</div>
                                <span className="details-grid-label">Gap</span><div className="details-grid-control">{ti(layout.gridGap,'8px',v=>handleUpdateLayout(selectedContainerId,{gridGap:v}))}</div>
                                <span className="details-grid-label">Direction</span><div className="details-grid-control">{sb(['horizontal','vertical'], layout.gridMergeDirection || 'horizontal', v => handleUpdateLayout(selectedContainerId, { gridMergeDirection: v }))}</div>
                              </>) : layout.layoutType === 'flex' ? (<>
                                <span className="details-grid-label">Direction</span><div className="details-grid-control">{sb(['row','column','row-reverse','column-reverse'],layout.flexDirection,v=>handleUpdateLayout(selectedContainerId,{flexDirection:v}))}</div>
                                <span className="details-grid-label">Wrap</span><div className="details-grid-control">{sb(['no wrap','wrap','wrap-reverse'],layout.flexWrap,v=>handleUpdateLayout(selectedContainerId,{flexWrap:v}))}</div>
                                <span className="details-grid-label">Justify</span><div className="details-grid-control">{sb(['flex-start','flex-end','center','space-between','space-around'],layout.justifyContent,v=>handleUpdateLayout(selectedContainerId,{justifyContent:v}))}</div>
                                <span className="details-grid-label">Align</span><div className="details-grid-control">{sb(['flex-start','flex-end','center','baseline','stretch'],layout.alignItems,v=>handleUpdateLayout(selectedContainerId,{alignItems:v}))}</div>
                              </>) : null}
                            </div></div>
                          </div>
                        </TabPanelItem>
                      )}

                      {/* Tab: Slot */}
                      {parentContainer && (
                        <TabPanelItem title="Slot">
                          <div className={`details-tab-content${lockedClass}`}>
                            {!isBase && overrides.slot && Object.keys(overrides.slot).length > 0 && (
                              <div style={{ padding: '4px 8px', fontSize: 10, background: tier?.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>{tier?.icon} {tier?.label} size overrides active</span>
                                <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => handleClearBreakpointOverrides(selectedContainerId, activeTierId)}>clear</span>
                              </div>
                            )}
                            {parentContainer.layout?.layoutType === 'coordinate' ? (
                              <div className="details-section"><div className="details-grid">
                                <span className="details-section-title">Coordinate</span>
                                <span className="details-grid-label">Unit</span><div className="details-grid-control">{sb(['px','%'], (fullContainer.coord||DEFAULT_COORD).unit, v => handleUpdateCoord(selectedContainerId, {unit:v}))}</div>
                                <span className="details-grid-label">Left</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).left,'—',v=>handleUpdateCoord(selectedContainerId,{left:v===''?'':Number(v)}),'number')}</div>
                                <span className="details-grid-label">Right</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).right,'—',v=>handleUpdateCoord(selectedContainerId,{right:v===''?'':Number(v)}),'number')}</div>
                                <span className="details-grid-label">Top</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).top,'—',v=>handleUpdateCoord(selectedContainerId,{top:v===''?'':Number(v)}),'number')}</div>
                                <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).bottom,'—',v=>handleUpdateCoord(selectedContainerId,{bottom:v===''?'':Number(v)}),'number')}</div>
                                <span className="details-grid-label">Width</span>
                                <div className="details-grid-control">
                                  {isStretchX ? (
                                    <div style={{ fontSize: 11, color: '#888', padding: '2px 6px', background: '#f5f5f5', borderRadius: 4, border: '1px solid #e0e0e0', height: 24, display: 'flex', alignItems: 'center', fontStyle: 'italic' }}>derived</div>
                                  ) : (
                                    ti((fullContainer.coord||DEFAULT_COORD).width,'—',v=>handleUpdateCoord(selectedContainerId,{width:v===''?'':Number(v)}),'number')
                                  )}
                                </div>
                                <span className="details-grid-label">Height</span>
                                <div className="details-grid-control">
                                  {isStretchY ? (
                                    <div style={{ fontSize: 11, color: '#888', padding: '2px 6px', background: '#f5f5f5', borderRadius: 4, border: '1px solid #e0e0e0', height: 24, display: 'flex', alignItems: 'center', fontStyle: 'italic' }}>derived</div>
                                  ) : (
                                    ti((fullContainer.coord||DEFAULT_COORD).height,'—',v=>handleUpdateCoord(selectedContainerId,{height:v===''?'':Number(v)}),'number')
                                  )}
                                </div>
                                {(isStretchX || isStretchY) && (
                                  <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#0055aa', background: '#e8f2ff', border: '1px solid #b3d0ff', padding: '5px 8px', borderRadius: 4, margin: '2px 0', lineHeight: 1.5 }}>
                                    {isStretchX && isStretchY
                                      ? '↔↕ Width and height are derived from offset pairs.'
                                      : isStretchX
                                        ? '↔ Width is derived — set by Left + Right offsets.'
                                        : '↕ Height is derived — set by Top + Bottom offsets.'}
                                    {' '}Clear one offset to restore a fixed size.
                                  </div>
                                )}
                                <span className="details-grid-label">Min W</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).minWidth,'—',v=>handleUpdateCoord(selectedContainerId,{minWidth:v}))}</div>
                                <span className="details-grid-label">Max W</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).maxWidth,'—',v=>handleUpdateCoord(selectedContainerId,{maxWidth:v}))}</div>
                                <span className="details-grid-label">Min H</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).minHeight,'—',v=>handleUpdateCoord(selectedContainerId,{minHeight:v}))}</div>
                                <span className="details-grid-label">Max H</span><div className="details-grid-control">{ti((fullContainer.coord||DEFAULT_COORD).maxHeight,'—',v=>handleUpdateCoord(selectedContainerId,{maxHeight:v}))}</div>
                                <span className="details-grid-label">Ratio</span>
                                <div className="details-grid-control" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <SelectBox
                                    dataSource={arDataSource}
                                    valueExpr="value"
                                    displayExpr="label"
                                    value={arSelectValue}
                                    onValueChanged={(e) => {
                                      if (e.value === CUSTOM_RATIO_SENTINEL) return;
                                      handleSetAspectRatio(selectedContainerId, e.value);
                                    }}
                                    stylingMode="outlined"
                                    width="100%"
                                    height={24}
                                  />
                                  <button className="focus-mode-btn" title="Lock at current dimensions" style={{ flexShrink: 0, padding: '0 6px', fontSize: 14 }} onClick={handleLockCurrentRatio}>🔗</button>
                                </div>
                              </div></div>
                            ) : (
                             <div className="details-section"><div className="details-grid">
                                <span className="details-section-title">Slot</span>
                                <span className="details-grid-label">Grow</span><div className="details-grid-control">{sb([0,1,2,3],slot.flexGrow,v=>handleUpdateSlot(selectedContainerId,{flexGrow:v}))}</div>
                                <span className="details-grid-label">Shrink</span><div className="details-grid-control">{sb([0,1,2,3],slot.flexShrink,v=>handleUpdateSlot(selectedContainerId,{flexShrink:v}))}</div>
                                <span className="details-grid-label">Basis</span><div className="details-grid-control">{ti(slot.flexBasis,'auto',v=>handleUpdateSlot(selectedContainerId,{flexBasis:v}))}</div>
                                <span className="details-grid-label">Align Self</span><div className="details-grid-control">{sb(['auto','flex-start','flex-end','center','baseline','stretch'],slot.alignSelf,v=>handleUpdateSlot(selectedContainerId,{alignSelf:v}))}</div>
                                <span className="details-grid-label">Order</span><div className="details-grid-control">{ti(slot.order,'0',v=>handleUpdateSlot(selectedContainerId,{order:v}),'number')}</div>
                                <span className="details-grid-label">Width</span><div className="details-grid-control">{ti(slot.width,'auto',v=>handleUpdateSlot(selectedContainerId,{width:v}))}</div>
                                <span className="details-grid-label">Min W</span><div className="details-grid-control">{ti(slot.minWidth,'0',v=>handleUpdateSlot(selectedContainerId,{minWidth:v}))}</div>
                                <span className="details-grid-label">Max W</span><div className="details-grid-control">{ti(slot.maxWidth,'none',v=>handleUpdateSlot(selectedContainerId,{maxWidth:v}))}</div>
                                <span className="details-grid-label">Height</span><div className="details-grid-control">{ti(slot.height,'auto',v=>handleUpdateSlot(selectedContainerId,{height:v}))}</div>
                                <span className="details-grid-label">Min H</span><div className="details-grid-control">{ti(slot.minHeight,'0',v=>handleUpdateSlot(selectedContainerId,{minHeight:v}))}</div>
                                <span className="details-grid-label">Max H</span><div className="details-grid-control">{ti(slot.maxHeight,'none',v=>handleUpdateSlot(selectedContainerId,{maxHeight:v}))}</div>
                                <span className="details-grid-label">Ratio</span>
                                <div className="details-grid-control" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <SelectBox
                                    dataSource={arDataSource}
                                    valueExpr="value"
                                    displayExpr="label"
                                    value={arSelectValue}
                                    onValueChanged={(e) => {
                                      if (e.value === CUSTOM_RATIO_SENTINEL) return;
                                      handleSetAspectRatio(selectedContainerId, e.value);
                                    }}
                                    stylingMode="outlined"
                                    width="100%"
                                    height={24}
                                  />
                                  <button className="focus-mode-btn" title="Lock at current dimensions" style={{ flexShrink: 0, padding: '0 6px', fontSize: 14 }} onClick={handleLockCurrentRatio}>🔗</button>
                                </div>
                              </div></div>
                            )}
                          </div>
                        </TabPanelItem>
                      )}

                      {/* Tab: Box */}
                      {fullContainer.id !== ROOT_CONTAINER_ID && (
                        <TabPanelItem title="Box">
                          <div className={`details-tab-content${lockedClass}`}>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Padding</span>
                              <span className="details-grid-label">Top</span><div className="details-grid-control">{ti(slot.paddingTop,'0',v=>handleUpdateSlot(selectedContainerId,{paddingTop:v}))}</div>
                              <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti(slot.paddingBottom,'0',v=>handleUpdateSlot(selectedContainerId,{paddingBottom:v}))}</div>
                              <span className="details-grid-label">Left</span><div className="details-grid-control">{ti(slot.paddingLeft,'0',v=>handleUpdateSlot(selectedContainerId,{paddingLeft:v}))}</div>
                              <span className="details-grid-label">Right</span><div className="details-grid-control">{ti(slot.paddingRight,'0',v=>handleUpdateSlot(selectedContainerId,{paddingRight:v}))}</div>
                            </div></div>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Margin</span>
                              <span className="details-grid-label">Top</span><div className="details-grid-control">{ti(slot.marginTop,'0',v=>handleUpdateSlot(selectedContainerId,{marginTop:v}))}</div>
                              <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti(slot.marginBottom,'0',v=>handleUpdateSlot(selectedContainerId,{marginBottom:v}))}</div>
                              <span className="details-grid-label">Left</span><div className="details-grid-control">{ti(slot.marginLeft,'0',v=>handleUpdateSlot(selectedContainerId,{marginLeft:v}))}</div>
                              <span className="details-grid-label">Right</span><div className="details-grid-control">{ti(slot.marginRight,'0',v=>handleUpdateSlot(selectedContainerId,{marginRight:v}))}</div>
                            </div></div>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Border</span>
                              <span className="details-grid-label">Width</span><div className="details-grid-control">{ti(slot.borderWidth,'1px',v=>handleUpdateSlot(selectedContainerId,{borderWidth:v}))}</div>
                              <span className="details-grid-label">Style</span><div className="details-grid-control">{sb(['','solid','dashed','dotted','double','none'],slot.borderStyle,v=>handleUpdateSlot(selectedContainerId,{borderStyle:v}))}</div>
                              <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.borderColor,'#e0e0e0',v=>handleUpdateSlot(selectedContainerId,{borderColor:v}))}</div>
                              <span className="details-grid-label">Radius</span><div className="details-grid-control">{ti(slot.borderRadius,'0',v=>handleUpdateSlot(selectedContainerId,{borderRadius:v}))}</div>
                            </div></div>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Content</span>
                              <span className="details-grid-label">Overflow X</span>
                              <div className="details-grid-control">
                                <SelectBox
                                  dataSource={[
                                    { v: 'auto',    l: 'Auto (if needed)' },
                                    { v: 'hidden',  l: 'Hidden / Clip' },
                                    { v: 'scroll',  l: 'Scroll (always)' },
                                    { v: 'visible', l: 'Visible ⚠' },
                                  ]}
                                  valueExpr="v"
                                  displayExpr="l"
                                  value={slot?.overflowX || 'auto'}
                                  onValueChanged={(e) => handleUpdateSlot(selectedContainerId, { overflowX: e.value })}
                                  stylingMode="outlined"
                                  width="100%"
                                  height={24}
                                />
                              </div>
                              <span className="details-grid-label">Overflow Y</span>
                              <div className="details-grid-control">
                                <SelectBox
                                  dataSource={[
                                    { v: 'auto',    l: 'Auto (if needed)' },
                                    { v: 'hidden',  l: 'Hidden / Clip' },
                                    { v: 'scroll',  l: 'Scroll (always)' },
                                    { v: 'visible', l: 'Visible ⚠' },
                                  ]}
                                  valueExpr="v"
                                  displayExpr="l"
                                  value={slot?.overflowY || 'auto'}
                                  onValueChanged={(e) => handleUpdateSlot(selectedContainerId, { overflowY: e.value })}
                                  stylingMode="outlined"
                                  width="100%"
                                  height={24}
                                />
                              </div>
                              {(slot?.overflowX === 'visible' || slot?.overflowY === 'visible') && (
                                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#8a5a00', background: '#fff8e6', border: '1px solid #f0c987', padding: '4px 8px', borderRadius: 4, margin: '2px 0' }}>
                                  ⚠ Visible overflow: content may render outside this container's bounds.
                                </div>
                              )}
                            </div></div>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Background</span>
                              <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.backgroundColor,'',v=>handleUpdateSlot(selectedContainerId,{backgroundColor:v}))}</div>
                              <span className="details-grid-label">Image</span><div className="details-grid-control">{ti(slot.backgroundImage,'url(...)',v=>handleUpdateSlot(selectedContainerId,{backgroundImage:v}))}</div>
                              <span className="details-grid-label">Size</span><div className="details-grid-control">{sb(['','cover','contain','auto','100% 100%'],slot.backgroundSize,v=>handleUpdateSlot(selectedContainerId,{backgroundSize:v}))}</div>
                              <span className="details-grid-label">Position</span><div className="details-grid-control">{sb(['','center','top','bottom','left','right','top left','top right','bottom left','bottom right'],slot.backgroundPosition,v=>handleUpdateSlot(selectedContainerId,{backgroundPosition:v}))}</div>
                              <span className="details-grid-label">Repeat</span><div className="details-grid-control">{sb(['','no-repeat','repeat','repeat-x','repeat-y'],slot.backgroundRepeat,v=>handleUpdateSlot(selectedContainerId,{backgroundRepeat:v}))}</div>
                            </div></div>
                            <div className="details-section"><div className="details-grid">
                              <span className="details-section-title">Typography</span>
                              <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.color,'inherit',v=>handleUpdateSlot(selectedContainerId,{color:v}))}</div>
                              <span className="details-grid-label">Font Size</span><div className="details-grid-control">{ti(slot.fontSize,'',v=>handleUpdateSlot(selectedContainerId,{fontSize:v}))}</div>
                              <span className="details-grid-label">Font Weight</span><div className="details-grid-control">{sb(['','normal','bold','100','200','300','400','500','600','700','800','900'],slot.fontWeight,v=>handleUpdateSlot(selectedContainerId,{fontWeight:v}))}</div>
                              <span className="details-grid-label">Font Family</span><div className="details-grid-control">{ti(slot.fontFamily,'',v=>handleUpdateSlot(selectedContainerId,{fontFamily:v}))}</div>
                              <span className="details-grid-label">Line Height</span><div className="details-grid-control">{ti(slot.lineHeight,'',v=>handleUpdateSlot(selectedContainerId,{lineHeight:v}))}</div>
                              <span className="details-grid-label">Text Align</span><div className="details-grid-control">{sb(['','left','center','right','justify'],slot.textAlign,v=>handleUpdateSlot(selectedContainerId,{textAlign:v}))}</div>
                              <span className="details-grid-label">Letter Spacing</span><div className="details-grid-control">{ti(slot.letterSpacing,'',v=>handleUpdateSlot(selectedContainerId,{letterSpacing:v}))}</div>
                            </div></div>
                          </div>
                        </TabPanelItem>
                      )}

                      {/* Tab: General — always last */}
                      <TabPanelItem title="General">
                        <div className="details-tab-content">
                          {/* Visibility — shown in non-base tiers */}
                          {!isBase && (
                            <div className={`details-section${lockedClass}`}>
                              <div className="details-grid">
                                <span className="details-section-title" style={{ color: tier?.color }}>
                                  {tier?.icon} {tier?.label} Visibility
                                </span>
                                <span className="details-grid-label">Visible</span>
                                <div className="details-grid-control">
                                  <button
                                    className={`focus-mode-btn${isHidden ? '' : ' focus-mode-btn--active'}`}
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    onClick={() => handleToggleVisibility(selectedContainerId, activeTierId)}
                                  >
                                    {isHidden ? '👁 Hidden' : '👁 Visible'}
                                  </button>
                                </div>
                                {hasOverrides && (
                                  <>
                                    <span className="details-grid-label">Overrides</span>
                                    <div className="details-grid-control">
                                      <button className="focus-mode-btn" style={{ color: '#d00', borderColor: '#d00', width: '100%', fontSize: 10 }}
                                        onClick={() => handleClearBreakpointOverrides(selectedContainerId, activeTierId)}>
                                        Clear {tier?.label} overrides
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="details-section">
                            <div className="details-grid">
                              <span className="details-section-title">Identity</span>
                              <span className="details-grid-label">Name</span>
                              <div className={`details-grid-control${lockedClass}`}>
                                <input className="details-input" value={found.title} onChange={(e) => { const s = toHtmlId(e.target.value); if (s) handleRenameContainer(selectedContainerId, s); }} />
                              </div>
                              {fullContainer.id !== ROOT_CONTAINER_ID && (<>
                                <span className="details-grid-label">Lock</span>
                                <div className="details-grid-control">
                                  <button
                                    className={`focus-mode-btn${fullContainer.locked ? ' focus-mode-btn--active' : ''}`}
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    onClick={() => handleToggleLock(selectedContainerId)}
                                  >
                                    {fullContainer.locked ? '🔒 Locked' : '🔓 Unlocked'}
                                  </button>
                                </div>
                              </>)}
                              {parentContainer && (<>
                                <span className="details-grid-label">Parent</span>
                                <div className="details-grid-control"><span style={{ fontSize: 11, color: '#555' }}>{parentContainer.title}</span></div>
                                <span className="details-grid-label">Parent Layout</span>
                                <div className="details-grid-control"><span style={{ fontSize: 11, color: parentContainer.layout?.layoutType === 'coordinate' ? '#0078d4' : '#555', fontWeight: 600 }}>{parentContainer.layout?.layoutType || 'flex'}</span></div>
                              </>)}
                            </div>
                          </div>
                          {fullContainer.id === ROOT_CONTAINER_ID && (
                            <div className="details-section">
                              <div className="details-grid">
                                <span className="details-section-title">Page</span>
                                <span className="details-grid-label">Type</span>
                                <div className="details-grid-control">{sb(['fit','fixed','vertical fixed','horizontal fixed'], fullContainer.pageType || 'fit', v => setContainers(prev => updatePageTypeInTree(prev, selectedContainerId, v)))}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </TabPanelItem>

                    </TabPanel>
                  </div>
                );
              })()}
            </div>
          </SplitterItem>
        </Splitter>
        )}
      </div>

      <Popup
        visible={popupVisible}
        onHiding={closeWizard}
        title="Create"
        width="90vw"
        height="90vh"
        showCloseButton={false}
        hideOnOutsideClick={false}
        dragEnabled={false}
        contentRender={() => (
          <WizardContent
            currentStep={currentStep}
            selectedAssetIds={selectedAssetIds}
            onAssetsSelected={setSelectedAssetIds}
            selectedTags={selectedTags}
            onTagsChanged={setSelectedTags}
          />
        )}
      >
        <ToolbarItem
          widget="dxButton"
          toolbar="bottom"
          location="before"
          options={{ text: 'Cancel', stylingMode: 'outlined', onClick: closeWizard }}
        />
        {currentStep > 0 && (
          <ToolbarItem
            widget="dxButton"
            toolbar="bottom"
            location="after"
            options={{ text: 'Back', stylingMode: 'outlined', onClick: handleBack }}
          />
        )}
        <ToolbarItem
          widget="dxButton"
          toolbar="bottom"
          location="after"
          options={{
            text: isLastStep ? 'Save' : 'Next',
            type: isLastStep ? 'success' : 'default',
            stylingMode: 'contained',
            onClick: handleNext,
          }}
        />
      </Popup>

      {/* ── Phase 1 Binding Expression Editor Popover ─────────────────────── */}
      {bindingPopoverProp && (() => {
        const bCont = findContainerById(containers, bindingPopoverProp.containerId);
        if (!bCont) return null;
        const binding = bCont.bindings?.[bindingPopoverProp.propName];
        const propDef = WIDGET_PROPERTIES[bCont.widgetName]?.find(p => p.name === bindingPopoverProp.propName);
        const pageQueryInstances = queryInstances.filter(qi => qi.pageId === activePageId);
        return (
          <WidgetBindingPopover
            propLabel={propDef?.label || bindingPopoverProp.propName}
            propType={propDef?.type}
            binding={binding}
            x={bindingPopoverProp.x}
            y={bindingPopoverProp.y}
            pageQueryInstances={pageQueryInstances}
            queries={queries}
            onSave={(b) => handleSetBinding(bindingPopoverProp.containerId, bindingPopoverProp.propName, b)}
            onClear={() => handleClearBinding(bindingPopoverProp.containerId, bindingPopoverProp.propName)}
            onClose={() => setBindingPopoverProp(null)}
          />
        );
      })()}

      {inputBindingPopover && (() => {
        const inst = findQueryInstance(queryInstances, inputBindingPopover.instanceId, activePageId);
        if (!inst) return null;
        const binding = inst.bindings?.[inputBindingPopover.fieldName];
        return (
          <InputBindingPopover
            fieldName={inputBindingPopover.fieldName}
            binding={binding}
            x={inputBindingPopover.x}
            y={inputBindingPopover.y}
            onSave={(b) => handleSetInputBinding(inputBindingPopover.instanceId, inputBindingPopover.fieldName, b)}
            onClear={() => handleClearInputBinding(inputBindingPopover.instanceId, inputBindingPopover.fieldName)}
            onClose={() => setInputBindingPopover(null)}
          />
        );
      })()}
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
