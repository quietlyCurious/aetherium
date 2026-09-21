// designer/screens/screenEdits.js
// The edits the Screens editor makes to a page's container tree, as plain
// functions: each takes the tree and returns the new one, never touching
// React state. useScreenEditor wraps them in setContainers and in the lock
// checks; keeping the two apart means these can be read (and tested) on
// their own, without the editor around them.
//
// Lock rules stay in useScreenEditor — with one exception, noted on
// insertBeforeSibling, where the locked thing isn't known until the edit
// has worked out where the item is going.
//
// All of this was the bodies of App.js's container handlers, moved as is;
// the two copies of the "insert before a sibling" logic (canvas drop and
// Page Visuals tree drop) are now one function.

import {
  DEFAULT_SLOT, DEFAULT_COORD, ROOT_CONTAINER_ID, BASE_TIER_ID,
  makeContainer, getNextContainerName, getWidgetDefaultSlot,
} from '../../containerModel';
import {
  extractFromTree, addChildToTree, findContainerById, isLockedOrAncestorLocked,
  updateLayoutInTree, updateSlotInTree, updateCoordInTree, updateContainerInTree,
} from '../../containerTree';
import { WIDGET_PROPERTIES } from '../../widgetData';
import { buildDefaultCells } from '../../GridEditor';

// ── Aspect ratio ────────────────────────────────────────────────────────────
// Applied inside slot / coord updates. Width always drives when both
// dimensions are present. Non-px slot values (auto, %, etc.) are left
// untouched.

export function adjustSlotForAR(container, slot) {
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

export function adjustCoordForAR(container, coord) {
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

// Sets the ratio and applies it to the current dimensions in the same
// edit, so there's no moment where the flag is set but the size isn't.
// Known gap: every container carries a default numeric coord.width, so
// this always takes the coordinate branch — a flex item's px height
// doesn't change until its width is next edited (adjustSlotForAR then
// applies the ratio). See the todo in screenEdits.test.js.
export function setAspectRatio(tree, id, ratio) {
  return updateContainerInTree(tree, id, c => {
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
  });
}

// ── Sizing and position, per breakpoint tier ────────────────────────────────

// On the base tier this edits the slot itself; on any other tier it
// writes that tier's override instead.
export function updateSlotForTier(tree, id, slot, tierId) {
  if (tierId !== BASE_TIER_ID) {
    return updateContainerInTree(tree, id, c => {
      const adjusted = adjustSlotForAR(c, slot);
      const existing = c.breakpointOverrides?.[tierId]?.slot || {};
      return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [tierId]: { ...c.breakpointOverrides?.[tierId], slot: { ...existing, ...adjusted } } } };
    });
  }
  const container = findContainerById(tree, id);
  return updateSlotInTree(tree, id, adjustSlotForAR(container, slot));
}

// The widget-property counterpart of updateSlotForTier. Not wired to
// anything yet: the widget tab calls a plain widget-props update, so in a
// breakpoint tier widget property edits land on the base values.
export function updateWidgetPropsForTier(tree, id, props, tierId) {
  return updateContainerInTree(tree, id, c => {
    const existing = c.breakpointOverrides?.[tierId]?.widgetProps || {};
    return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [tierId]: { ...c.breakpointOverrides?.[tierId], widgetProps: { ...existing, ...props } } } };
  });
}

export function updateCoordKeepingRatio(tree, id, coord) {
  const container = findContainerById(tree, id);
  return updateCoordInTree(tree, id, adjustCoordForAR(container, coord));
}

export function toggleHiddenForTier(tree, id, tierId) {
  return updateContainerInTree(tree, id, c => {
    const currentlyHidden = c.breakpointOverrides?.[tierId]?.hidden ?? false;
    return { ...c, breakpointOverrides: { ...c.breakpointOverrides, [tierId]: { ...c.breakpointOverrides?.[tierId], hidden: !currentlyHidden } } };
  });
}

export function clearTierOverrides(tree, id, tierId) {
  return updateContainerInTree(tree, id, c => {
    const newOverrides = { ...c.breakpointOverrides };
    delete newOverrides[tierId];
    return { ...c, breakpointOverrides: newOverrides };
  });
}

// ── Locks and bindings ──────────────────────────────────────────────────────

export function toggleLock(tree, id) {
  return updateContainerInTree(tree, id, c => ({ ...c, locked: !c.locked }));
}

export function setBinding(tree, id, propName, binding) {
  return updateContainerInTree(tree, id, c => ({ ...c, bindings: { ...(c.bindings || {}), [propName]: binding } }));
}

export function clearBinding(tree, id, propName) {
  return updateContainerInTree(tree, id, c => {
    const nb = { ...(c.bindings || {}) };
    delete nb[propName];
    return { ...c, bindings: nb };
  });
}

// ── Paintbrush ──────────────────────────────────────────────────────────────

// What the paintbrush carries: sizing and box model, widget props (applied
// only to the same kind of widget), and breakpoint overrides.
export function pickUpStyle(container) {
  return {
    slot: container.slot ? { ...container.slot } : undefined,
    widgetProps: container.widgetProps ? { ...container.widgetProps } : undefined,
    widgetName: container.widgetName,
    breakpointOverrides: container.breakpointOverrides
      ? JSON.parse(JSON.stringify(container.breakpointOverrides))
      : undefined,
  };
}

export function applyStyle(tree, targetId, paintbrush) {
  return updateContainerInTree(tree, targetId, c => {
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
  });
}

// ── Adding and moving ───────────────────────────────────────────────────────

// A new widget container with every property at its default.
export function makeWidgetContainer(parentId, widgetName) {
  const defaultProps = {};
  (WIDGET_PROPERTIES[widgetName] || []).forEach(p => { defaultProps[p.name] = p.default; });
  return {
    ...makeContainer(parentId, widgetName),
    isWidget: true,
    widgetName,
    widgetProps: defaultProps,
    slot: getWidgetDefaultSlot(widgetName),
  };
}

// Moving an item under a parent with a different layout type (flex ↔
// coordinate) resets its positioning, keeping its size and box model.
// Same layout type: only parentId changes.
export function resetPropertiesForParent(item, newParentId, tree) {
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
}

// Puts `extracted` (already taken out of `tree`, leaving `remaining`)
// just before the sibling `beforeId`, under that sibling's parent. The one
// lock check that lives here rather than in the editor: which parent is
// being dropped into isn't known until this has found it. A locked parent
// leaves the tree as it was.
function insertBeforeSibling(tree, remaining, extracted, beforeId) {
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
  if (newParentId !== ROOT_CONTAINER_ID && isLockedOrAncestorLocked(tree, newParentId)) return tree;
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

// A drag on the canvas: dropped between items (beforeId) or onto a
// container (overId). Between-items wins when both are given.
export function moveContainerOnCanvas(tree, id, overId, beforeId) {
  const { extracted, remaining } = extractFromTree(tree, id);
  if (!extracted) return tree;
  if (beforeId) return insertBeforeSibling(tree, remaining, extracted, beforeId);
  if (overId) {
    const reset = resetPropertiesForParent(extracted, overId, remaining);
    return addChildToTree(remaining, overId, reset);
  }
  return tree;
}

// A drag in the Page Visuals tree: onto a container (overId) or between
// items (beforeId). Onto-a-container wins, and refuses widgets (they can't
// have children), locked targets and the item's current parent.
export function moveContainerInTree(tree, id, overId, beforeId) {
  const { extracted, remaining } = extractFromTree(tree, id);
  if (!extracted) return tree;
  if (overId) {
    const target = findContainerById(tree, overId);
    if (target?.isWidget) return tree;
    // LOCK GUARD — can't drop into a locked container
    if (isLockedOrAncestorLocked(tree, overId)) return tree;
    // Block reparenting to current parent
    if (extracted.parentId === overId) return tree;
    const reset = resetPropertiesForParent(extracted, overId, remaining);
    return addChildToTree(remaining, overId, reset);
  }
  if (beforeId) return insertBeforeSibling(tree, remaining, extracted, beforeId);
  return tree;
}

// ── Grids ───────────────────────────────────────────────────────────────────

const cellHelpers = {
  // Cells saved before multi-child cells existed hold a single childId.
  childIds: (cell) => cell.childIds || (cell.childId != null ? [cell.childId] : []),
  newCellContainer: (parentId, tree, alsoNew) => ({
    ...makeContainer(parentId, getNextContainerName([...tree, ...alsoNew])),
    slot: { ...DEFAULT_SLOT, flexGrow: 1, flexShrink: 1, width: '', height: '', flexBasis: '0' },
  }),
};

// One of three things lands in a grid cell: a pasted clone, a new widget
// from the Visuals tab (widgetName), or an existing item dragged from
// elsewhere — including another cell of the same grid (draggedId).
export function dropIntoGridCell(tree, gridId, cellIdx, { widgetName, draggedId, clone }) {
  const gridContainer = findContainerById(tree, gridId);
  if (!gridContainer) return tree;

  const cells = gridContainer.layout.gridCells || buildDefaultCells(
    gridContainer.layout.gridColumns || 2,
    gridContainer.layout.gridRows || 2
  );
  const getCellChildIds = cellHelpers.childIds;

  const addToCell = (newChild, newCells) => tree.map(function ins(c) {
    if (c.id === gridId) return {
      ...c,
      children: [...c.children, newChild],
      layout: { ...c.layout, gridCells: newCells },
    };
    return { ...c, children: c.children.map(ins) };
  });

  if (clone) {
    // Paste — apply resetPropertiesForParent for cross-layout compatibility
    const reset = resetPropertiesForParent(clone, gridId, tree);
    const newCells = cells.map((c, i) => i === cellIdx ? { ...c, childIds: [...getCellChildIds(c), reset.id] } : c);
    return addToCell(reset, newCells);
  }

  if (widgetName) {
    const newWidget = makeWidgetContainer(gridId, widgetName);
    const newCells = cells.map((c, i) => i === cellIdx ? { ...c, childIds: [...getCellChildIds(c), newWidget.id] } : c);
    return addToCell(newWidget, newCells);
  }

  if (draggedId && draggedId !== gridId) {
    const isFromSameGrid = findContainerById(tree, draggedId)?.parentId === gridId;
    const { extracted, remaining } = extractFromTree(tree, draggedId);
    if (!extracted) return tree;

    const reset = resetPropertiesForParent(extracted, gridId, remaining);
    const resetWithParent = { ...reset, parentId: gridId };

    // Remove from old cell, add to new cell
    const newCells = cells.map((c, i) => {
      let ids = getCellChildIds(c).filter(id => id !== draggedId);
      if (i === cellIdx) ids = [...ids, resetWithParent.id];
      return { ...c, childIds: ids };
    });

    if (isFromSameGrid) {
      return tree.map(function upd(c) {
        if (c.id === gridId) return {
          ...c,
          children: c.children.map(ch => ch.id === draggedId ? resetWithParent : ch),
          layout: { ...c.layout, gridCells: newCells },
        };
        return { ...c, children: c.children.map(upd) };
      });
    }
    return remaining.map(function ins(c) {
      if (c.id === gridId) return { ...c, children: [...c.children, resetWithParent], layout: { ...c.layout, gridCells: newCells } };
      return { ...c, children: c.children.map(ins) };
    });
  }
  return tree;
}

// A layout change. Two cases need more than a merge into `layout`:
//  - switching to grid creates one cell container per cell, and moves any
//    existing children into the first one;
//  - changing a grid's columns or rows keeps each cell that still exists,
//    creates containers for new cells, and hands the cells that no longer
//    exist to the last cell.
export function applyLayoutUpdate(tree, id, layoutUpdate) {
  const container = findContainerById(tree, id);
  if (!container) return updateLayoutInTree(tree, id, layoutUpdate);

  const oldLayout = container.layout || {};
  const newLayout = { ...oldLayout, ...layoutUpdate };

  // Switching TO grid — auto-create cell containers
  if (layoutUpdate.layoutType === 'grid' && oldLayout.layoutType !== 'grid') {
    const cols = newLayout.gridColumns || 2;
    const rows = newLayout.gridRows || 2;
    const newContainers = [];
    const filledCells = buildDefaultCells(cols, rows).map((cell) => {
      const cc = cellHelpers.newCellContainer(id, tree, newContainers);
      newContainers.push(cc);
      return { ...cell, childIds: [cc.id] };
    });

    // Move any existing children into the first cell container
    const existingChildren = container.children;
    if (existingChildren.length > 0 && newContainers.length > 0) {
      existingChildren.forEach(child => {
        newContainers[0].children = [...(newContainers[0].children || []), { ...child, parentId: newContainers[0].id }];
      });
    }

    return tree.map(function upd(c) {
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

    const newContainersToAdd = [];
    const newFilledCells = buildDefaultCells(newCols, newRows).map((newCell) => {
      // Find the old cell that best matches this position
      const oldCell = oldCells.find(oc =>
        oc.colStart === newCell.colStart && oc.rowStart === newCell.rowStart
      );
      if (oldCell) {
        // Reuse existing cell container(s)
        return { ...newCell, childIds: cellHelpers.childIds(oldCell) };
      }
      // New cell — create a fresh container
      const cc = cellHelpers.newCellContainer(id, tree, newContainersToAdd);
      newContainersToAdd.push(cc);
      return { ...newCell, childIds: [cc.id] };
    });

    // Cells that no longer exist hand their containers to the last cell
    const referencedIds = new Set(newFilledCells.flatMap(c => c.childIds || []));
    const orphanedCellIds = oldCells
      .flatMap(c => c.childIds || (c.childId != null ? [c.childId] : []))
      .filter(cid => !referencedIds.has(cid));
    if (orphanedCellIds.length > 0 && newFilledCells.length > 0) {
      const lastCell = newFilledCells[newFilledCells.length - 1];
      lastCell.childIds = [...(lastCell.childIds || []), ...orphanedCellIds];
    }

    return tree.map(function upd(c) {
      if (c.id === id) return {
        ...c,
        layout: { ...newLayout, gridCells: newFilledCells },
        children: [...c.children, ...newContainersToAdd],
      };
      return { ...c, children: c.children.map(upd) };
    });
  }

  return updateLayoutInTree(tree, id, layoutUpdate);
}

// When grid cells merge, the absorbed cells' contents move into the
// surviving cell's container, and the emptied containers go.
export function mergeCellContainers(tree, survivingId, absorbedIds) {
  let updated = tree;
  absorbedIds.forEach(absorbedId => {
    const absorbed = findContainerById(updated, absorbedId);
    if (!absorbed || absorbed.children.length === 0) return;
    absorbed.children.forEach(child => {
      const reparented = { ...child, parentId: survivingId };
      updated = addChildToTree(updated, survivingId, reparented);
    });
    const { remaining } = extractFromTree(updated, absorbedId);
    updated = remaining;
  });
  return updated;
}
