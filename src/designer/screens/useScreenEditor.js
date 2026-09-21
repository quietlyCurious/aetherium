// designer/screens/useScreenEditor.js
// Everything the Screens editor knows and can do: the saved screens and
// folders, the page open on the canvas, what's selected, the canvas tools
// (clipboard, paintbrush, device preview, snap), and every action on them.
// ScreensWorkspace draws it; this owns it.
//
// Why a hook that App calls, rather than state inside ScreensWorkspace:
// the canvas outlives the area. Leave Screens for Queries and come back,
// and the open page, unsaved edits and selection are all still there, so
// leaving doesn't ask anything. App also needs a few answers from it for
// the title bar (which page is open, save it). State inside the workspace
// would reset every time the area closed.
//
// Container edits themselves are plain functions in screenEdits.js. What
// stays here is the part that needs the editor: the lock rules (marked
// LOCK GUARD — a locked container, or one under a locked ancestor, can't
// be edited, moved, deleted, painted, pasted into or given children;
// selecting and unlocking always work), and what gets selected afterwards.

import { useState } from 'react';
import notify from 'devextreme/ui/notify';
import {
  loadPagesAndFolders, savePagesAndFolders, makeNewPage, makeNewFolder,
  snapshotPage, cloneContainersFromPage, repairDuplicateContainerIds,
} from '../../pagesStorage';
import { generateDataId } from '../../dataModel';
import {
  ROOT_CONTAINER_ID, BASE_TIER_ID, makeContainer, makeRootContainer, getNextContainerName,
} from '../../containerModel';
import {
  isDescendant, addChildToTree, findContainerById, updatePageTypeInTree,
  updateWidgetPropsInTree, deepCloneWithNewIds, renameInTree, deleteFromTree,
  isLockedOrAncestorLocked,
} from '../../containerTree';
import { getDeviceById } from '../../breakpointConfig';
import {
  resetPropertiesForParent, moveContainerOnCanvas, moveContainerInTree,
  makeWidgetContainer, dropIntoGridCell, applyLayoutUpdate, mergeCellContainers,
  updateSlotForTier, updateWidgetPropsForTier, updateCoordKeepingRatio,
  setAspectRatio, toggleHiddenForTier, clearTierOverrides, toggleLock,
  setBinding, clearBinding, pickUpStyle, applyStyle,
} from './screenEdits';
import { usePageQueryInstances } from './usePageQueryInstances';

const NO_DRAG = { overId: null, beforeId: null, overParentId: null };

export function useScreenEditor({ queries }) {
  // ── Screens and folders ──────────────────────────────────────────────────
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

  // ── The canvas ───────────────────────────────────────────────────────────
  const [containers, setContainers] = useState([makeRootContainer()]);
  // The JSON of whatever was last saved or opened; the canvas is dirty when
  // it no longer matches. Only the open page can be dirty — the others'
  // stored copies aren't touched until they're opened.
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => JSON.stringify(containers));
  const isDirty = JSON.stringify(containers) !== lastSavedSnapshot;

  // ── Selection ────────────────────────────────────────────────────────────
  // A container selection (one or several) and a query instance selection
  // (Page Data tab) replace each other; the details panel shows one or the
  // other.
  const [selectedContainerId, setSelectedContainerId] = useState(null);
  const [selectedContainerIds, setSelectedContainerIds] = useState([]);
  const [selectedQueryInstanceId, setSelectedQueryInstanceId] = useState(null);
  const [selectedGridCell, setSelectedGridCell] = useState(null); // { containerId, cellIdx }

  // ── Canvas tools ─────────────────────────────────────────────────────────
  const [clipboard, setClipboard] = useState(null); // deep-cloned container subtree
  const [paintbrush, setPaintbrush] = useState(null); // style picked up — see pickUpStyle
  const [draggingId, setDraggingId] = useState(null);
  const [dragState, setDragState] = useState(NO_DRAG);
  const [focusMode, setFocusMode] = useState('follow'); // 'follow': a new container becomes the selection
  const [showGap, setShowGap] = useState(true);
  const [coordMode, setCoordMode] = useState('reposition'); // dragging a coordinate-layout child moves it, or reparents it
  const [snapEnabled, setSnapEnabled] = useState(true);  // snap-to-grid + snap-to-elements
  const [snapSize, setSnapSize] = useState(8);          // grid interval AND element-snap threshold
  const [snapGuides, setSnapGuides] = useState(null);   // active alignment guides during coord drag

  // ── Device preview and breakpoint tier ───────────────────────────────────
  const [activeDeviceId, setActiveDeviceId] = useState('responsive');
  const [activeTierId, setActiveTierId] = useState(BASE_TIER_ID);
  const [customWidth, setCustomWidth] = useState(1280);
  const [customHeight, setCustomHeight] = useState(800);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);

  // ── Panels ───────────────────────────────────────────────────────────────
  const [dataTabMode, setDataTabMode] = useState('model'); // 'model' | 'queries' — Data tab browsing mode
  const [dataTabSearch, setDataTabSearch] = useState('');
  const [visualsSearch, setVisualsSearch] = useState('');
  const [detailsTabIndex, setDetailsTabIndex] = useState(0);
  const [bindingPopoverProp, setBindingPopoverProp] = useState(null); // { containerId, propName, x, y }
  const [inputBindingPopover, setInputBindingPopover] = useState(null); // { instanceId, fieldName, x, y }

  const instances = usePageQueryInstances(activePageId, queries);

  const isLocked = (id) => isLockedOrAncestorLocked(containers, id);

  // ── Screens: open, create, save, delete ──────────────────────────────────
  // Explicit Save only — see pagesStorage.js for why there's no auto-sync.
  const resetSelectionForPageSwitch = () => {
    setSelectedContainerId(null);
    setSelectedContainerIds([]);
  };

  // True when it's fine to go ahead: nothing unsaved, or the user said to
  // discard it. Every action that replaces the canvas (opening or creating
  // a screen) asks this first. Leaving the area doesn't — nothing is lost.
  const confirmDiscardIfDirty = () => {
    if (!isDirty) return true;
    return window.confirm('You have unsaved changes on this screen. Discard them and continue?');
  };

  const createPage = () => {
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

  const openPage = (pageId) => {
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

  // Saves the open page, or — when the canvas isn't a saved page yet —
  // asks for a name and saves it as a new one.
  const savePage = () => {
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

  const deletePage = (pageId) => {
    const page = pages.find(p => p.id === pageId);
    const confirmed = window.confirm(`Delete "${page?.name || 'this screen'}"? This can't be undone.`);
    if (!confirmed) return;
    setPages(prev => {
      const next = prev.filter(p => p.id !== pageId);
      savePagesAndFolders(next, folders);
      return next;
    });
    instances.deleteInstancesOfPage(pageId);
    if (activePageId === pageId) setActivePageId(null);
  };

  // ── Folders ──────────────────────────────────────────────────────────────
  const createFolder = () => {
    const name = window.prompt('Name this folder:', `Folder ${folders.length + 1}`);
    if (name === null) return;
    const folder = makeNewFolder(name, generateDataId);
    setFolders(prev => {
      const next = [...prev, folder];
      savePagesAndFolders(pages, next);
      return next;
    });
  };

  const renameFolder = (folder) => {
    const name = window.prompt('Rename folder:', folder.name);
    if (name === null || name === folder.name) return;
    setFolders(prev => {
      const next = prev.map(f => f.id === folder.id ? { ...f, name } : f);
      savePagesAndFolders(pages, next);
      return next;
    });
  };

  const deleteFolder = (folder) => {
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

  const movePageToFolder = (pageId, folderId) => {
    setPages(prev => {
      const next = prev.map(p => p.id === pageId ? { ...p, folderId } : p);
      savePagesAndFolders(next, folders);
      return next;
    });
  };

  // ── Selection ────────────────────────────────────────────────────────────
  // A canvas click. Shift/Ctrl/Cmd adds to or removes from a multi-select;
  // with the paintbrush out, a click paints instead of selecting.
  const selectContainer = (id, e) => {
    setSelectedQueryInstanceId(null);
    if (paintbrush && id && id !== ROOT_CONTAINER_ID) {
      paintContainer(id);
      return;
    }
    // Block selection of locked items or children of locked containers
    if (id && id !== ROOT_CONTAINER_ID) {
      if (isLocked(id)) return;
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

  // A Page Visuals tree click: a plain single select — no paintbrush, no
  // multi-select, and locked items can be selected (to unlock them).
  const selectContainerFromTree = (id) => {
    setSelectedQueryInstanceId(null);
    setSelectedContainerId(id);
    setSelectedContainerIds(id ? [id] : []);
  };

  const selectQueryInstance = (id) => {
    setSelectedContainerId(null);
    setSelectedContainerIds([]);
    setSelectedQueryInstanceId(id);
  };

  // A click on the empty canvas: drops the selection and any open picker,
  // popover or paintbrush.
  const clearCanvasSelection = () => {
    setSelectedContainerId(null);
    setSelectedContainerIds([]);
    setSelectedGridCell(null);
    setDevicePickerOpen(false);
    if (paintbrush) setPaintbrush(null);
    setBindingPopoverProp(null);
  };

  // ── Adding, renaming, deleting ───────────────────────────────────────────
  const addContainer = () => {
    const targetId = selectedContainerId || ROOT_CONTAINER_ID;
    // LOCK GUARD — can't add a child to a locked container
    if (targetId !== ROOT_CONTAINER_ID && isLocked(targetId)) return;
    const name = getNextContainerName(containers);
    const c = makeContainer(targetId, name);
    setContainers(prev => addChildToTree(prev, targetId, c));
    if (focusMode === 'follow') setSelectedContainerId(c.id);
  };

  const dropWidget = (containerId, widgetName) => {
    // LOCK GUARD — can't drop a widget into a locked container
    if (isLocked(containerId)) return;
    const c = makeWidgetContainer(containerId, widgetName);
    setContainers(prev => addChildToTree(prev, containerId, c));
    setSelectedContainerId(c.id);
  };

  // Double-clicking a widget in the Visuals tab adds it next to the
  // selected widget, or into the selected container (the page when
  // nothing is selected).
  const addWidgetToSelection = (widgetName) => {
    const selected = selectedContainerId ? findContainerById(containers, selectedContainerId) : null;
    const targetId = selected?.isWidget
      ? (selected.parentId || ROOT_CONTAINER_ID)
      : (selectedContainerId || ROOT_CONTAINER_ID);
    dropWidget(targetId, widgetName);
  };

  const deleteContainer = (id) => {
    if (id === ROOT_CONTAINER_ID) return; // root is undeletable
    // LOCK GUARD — can't delete a locked item (or one under a locked ancestor).
    // Deleting an *unlocked* ancestor still removes locked descendants, which is intended.
    if (isLocked(id)) return;
    setContainers(prev => deleteFromTree(prev, id));
    setSelectedContainerId(prev => prev === id ? null : prev);
  };

  const renameContainer = (id, title) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => renameInTree(prev, id, title));
  };

  // Deliberately NOT lock-guarded — you must always be able to unlock.
  const toggleContainerLock = (id) => {
    setContainers(prev => toggleLock(prev, id));
  };

  // ── Dragging ─────────────────────────────────────────────────────────────
  const startDrag = (id) => {
    setDraggingId(id);
    setDragState(NO_DRAG);
  };

  const dragOver = (overId, beforeId, overParentId) => {
    if (!draggingId) return;
    if (overId && (overId === draggingId || isDescendant(containers, draggingId, overId))) return;
    // If we have a beforeId, this is a between-zone — clear overId
    if (beforeId !== null && beforeId !== undefined) {
      setDragState({ overId: null, beforeId, overParentId: overParentId || overId });
    } else {
      setDragState({ overId: overId || null, beforeId: null, overParentId: null });
    }
  };

  const endDrag = () => {
    setDraggingId(null);
    setDragState(NO_DRAG);
  };

  const dropOnCanvas = (overId, beforeId) => {
    const id = draggingId;
    endDrag();
    if (!id) return;
    if (overId && (overId === id || isDescendant(containers, id, overId))) return;
    // LOCK GUARD — can't move a locked item, can't drop into a locked container
    if (isLocked(id)) return;
    if (overId && isLocked(overId)) return;
    // Block reparenting to current parent
    const dragging = findContainerById(containers, id);
    if (overId && dragging?.parentId === overId) return;
    setContainers(prev => moveContainerOnCanvas(prev, id, overId, beforeId));
  };

  const dropInPageVisualsTree = (draggedId, overId, beforeId) => {
    // LOCK GUARD — can't move a locked item
    if (isLocked(draggedId)) return;
    setContainers(prev => moveContainerInTree(prev, draggedId, overId, beforeId));
  };

  // A drop into one cell of a grid: a new widget (widgetName), an existing
  // item (draggedId), or a pasted clone. `existingCellChildIds` is part of
  // ContainerCard's call and isn't needed here.
  const dropInGridCell = (containerId, cellIdx, widgetName, draggedId, existingCellChildIds, prebuiltClone) => {
    setContainers(prev => {
      // LOCK GUARD — can't drop into a locked grid, can't move a locked item
      if (isLockedOrAncestorLocked(prev, containerId)) return prev;
      if (draggedId && isLockedOrAncestorLocked(prev, draggedId)) return prev;
      return dropIntoGridCell(prev, containerId, cellIdx, { widgetName, draggedId, clone: prebuiltClone });
    });
    endDrag();
  };

  // ── Clipboard ────────────────────────────────────────────────────────────
  const copySelection = () => {
    if (!selectedContainerId) return;
    const found = findContainerById(containers, selectedContainerId);
    if (!found || found.id === ROOT_CONTAINER_ID) return;
    // Deep-copy at copy time so clipboard is a stable snapshot
    setClipboard(JSON.parse(JSON.stringify(found)));
  };

  // Pastes into the selected grid cell if there is one; otherwise into the
  // selected container, next to the selected widget, or onto the page.
  const paste = () => {
    if (!clipboard) return;

    if (selectedGridCell) {
      // LOCK GUARD — can't paste into a cell of a locked grid
      if (isLocked(selectedGridCell.containerId)) return;
      const cloned = deepCloneWithNewIds(clipboard, selectedGridCell.containerId);
      dropInGridCell(selectedGridCell.containerId, selectedGridCell.cellIdx, null, null, null, cloned);
      setSelectedGridCell(null); // clear after paste
      return;
    }

    const sel = selectedContainerId ? findContainerById(containers, selectedContainerId) : null;
    const targetParentId = sel
      ? (sel.isWidget ? (sel.parentId ?? ROOT_CONTAINER_ID) : sel.id)
      : ROOT_CONTAINER_ID;

    // LOCK GUARD — can't paste into a locked container
    if (targetParentId !== ROOT_CONTAINER_ID && isLocked(targetParentId)) return;

    const cloned = deepCloneWithNewIds(clipboard, targetParentId);
    const reset = resetPropertiesForParent(cloned, targetParentId, containers);
    setContainers(prev => addChildToTree(prev, targetParentId, reset));
    setSelectedContainerId(reset.id);
    setSelectedContainerIds([reset.id]);
    setSelectedGridCell(null);
  };

  // ── Paintbrush ───────────────────────────────────────────────────────────
  // Picking up doesn't change anything, so it isn't lock-guarded.
  const pickUpPaintbrush = () => {
    if (!selectedContainerId) return;
    const found = findContainerById(containers, selectedContainerId);
    if (!found || found.id === ROOT_CONTAINER_ID) return;
    setPaintbrush(pickUpStyle(found));
  };

  const paintContainer = (targetId) => {
    if (!paintbrush) return;
    // LOCK GUARD — can't paint onto a locked item
    if (isLocked(targetId)) return;
    if (!findContainerById(containers, targetId)) return;
    setContainers(prev => applyStyle(prev, targetId, paintbrush));
  };

  // ── Properties ───────────────────────────────────────────────────────────
  const updateWidgetProps = (id, props) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => updateWidgetPropsInTree(prev, id, props));
  };

  // Not wired — see updateWidgetPropsForTier in screenEdits.js.
  // eslint-disable-next-line no-unused-vars
  const updateWidgetPropsForActiveTier = (id, props) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    if (activeTierId !== BASE_TIER_ID) {
      setContainers(prev => updateWidgetPropsForTier(prev, id, props, activeTierId));
    } else {
      updateWidgetProps(id, props);
    }
  };

  const setWidgetBinding = (id, propName, binding) => {
    if (isLocked(id)) return;
    setContainers(prev => setBinding(prev, id, propName, binding));
  };

  const clearWidgetBinding = (id, propName) => {
    if (isLocked(id)) return;
    setContainers(prev => clearBinding(prev, id, propName));
  };

  const updateLayout = (id, layoutUpdate) => {
    setContainers(prev => {
      // LOCK GUARD
      if (isLockedOrAncestorLocked(prev, id)) return prev;
      return applyLayoutUpdate(prev, id, layoutUpdate);
    });
  };

  const mergeGridCells = (survivingId, absorbedIds) => {
    setContainers(prev => {
      // LOCK GUARD — merging changes the grid's children; block if locked
      if (isLockedOrAncestorLocked(prev, survivingId)) return prev;
      return mergeCellContainers(prev, survivingId, absorbedIds);
    });
  };

  // Base tier: the slot itself. Any other tier: that tier's override.
  const updateSlot = (id, slot) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => updateSlotForTier(prev, id, slot, activeTierId));
  };

  const updateCoord = (id, coord) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => updateCoordKeepingRatio(prev, id, coord));
  };

  const setContainerAspectRatio = (id, ratio) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => setAspectRatio(prev, id, ratio));
  };

  const toggleVisibility = (id, tierId) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => toggleHiddenForTier(prev, id, tierId));
  };

  const clearBreakpointOverrides = (id, tierId) => {
    // LOCK GUARD
    if (isLocked(id)) return;
    setContainers(prev => clearTierOverrides(prev, id, tierId));
  };

  // Root only; root is not lockable, so no guard needed.
  const updatePageType = (id, pageType) => {
    setContainers(prev => updatePageTypeInTree(prev, id, pageType));
  };

  // ── Device preview ───────────────────────────────────────────────────────
  const selectDevice = (device) => {
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

  // Whether the selection (one item or several) is locked — greys out the
  // details panel and disables the toolbar's editing buttons.
  const lockSelectionIds = selectedContainerIds.length > 0
    ? selectedContainerIds
    : (selectedContainerId ? [selectedContainerId] : []);
  const isSelectedLocked = lockSelectionIds.some(
    id => id !== ROOT_CONTAINER_ID && isLocked(id)
  );

  return {
    // screens and folders
    pages, folders, activePageId, isDirty, confirmDiscardIfDirty,
    createPage, openPage, savePage, deletePage,
    createFolder, renameFolder, deleteFolder, movePageToFolder,
    // the canvas
    containers,
    selectedContainerId, selectedContainerIds, selectedQueryInstanceId, selectedGridCell,
    setSelectedGridCell, isSelectedLocked,
    selectContainer, selectContainerFromTree, selectQueryInstance, setSelectedQueryInstanceId,
    clearCanvasSelection,
    addContainer, addWidgetToSelection, dropWidget, deleteContainer, renameContainer, toggleContainerLock,
    draggingId, dragState, startDrag, dragOver, endDrag, dropOnCanvas, dropInPageVisualsTree, dropInGridCell,
    clipboard, copySelection, paste,
    paintbrush, setPaintbrush, pickUpPaintbrush,
    updateWidgetProps, setWidgetBinding, clearWidgetBinding,
    updateLayout, mergeGridCells, updateSlot, updateCoord, setContainerAspectRatio,
    toggleVisibility, clearBreakpointOverrides, updatePageType,
    // canvas tools
    focusMode, setFocusMode, showGap, setShowGap, coordMode, setCoordMode,
    snapEnabled, setSnapEnabled, snapSize, setSnapSize, snapGuides, setSnapGuides,
    // device preview
    activeDeviceId, activeTierId, customWidth, customHeight, setCustomWidth, setCustomHeight,
    devicePickerOpen, setDevicePickerOpen, selectDevice, previewWidth, previewHeight,
    // panels
    dataTabMode, setDataTabMode, dataTabSearch, setDataTabSearch, visualsSearch, setVisualsSearch,
    detailsTabIndex, setDetailsTabIndex,
    bindingPopoverProp, setBindingPopoverProp, inputBindingPopover, setInputBindingPopover,
    // the page's query instances: queryInstances (every page's),
    // pageQueryInstances, findQueryInstance and their edits
    ...instances,
  };
}
