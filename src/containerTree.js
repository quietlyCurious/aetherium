// Container tree helpers — search, mutate, clone
import { getNextId } from './containerModel';

function flattenContainers(containers, parentId = null) {
  const result = [];
  containers.forEach(c => {
    result.push({ id: c.id, title: c.title, parentId });
    if (c.children.length > 0) {
      result.push(...flattenContainers(c.children, c.id));
    }
  });
  return result;
}


function isDescendant(containers, ancestorId, potentialDescendantId) {
  const ancestor = findContainerById(containers, ancestorId);
  if (!ancestor) return false;
  if (ancestor.id === potentialDescendantId) return true;
  return ancestor.children.some(child =>
    child.id === potentialDescendantId ||
    isDescendant(ancestor.children, child.id, potentialDescendantId)
  );
}

// Remove a container from the tree and return it + the modified tree
function extractFromTree(containers, id) {
  let extracted = null;
  const remaining = containers
    .filter(c => {
      if (c.id === id) { extracted = c; return false; }
      return true;
    })
    .map(c => {
      if (!extracted) {
        const result = extractFromTree(c.children, id);
        extracted = result.extracted;
        return { ...c, children: result.remaining };
      }
      return c;
    });
  return { extracted, remaining };
}

function addChildToTree(containers, parentId, newContainer) {
  return containers.map(c => {
    if (c.id === parentId) return { ...c, children: [...c.children, { ...newContainer, parentId }] };
    return { ...c, children: addChildToTree(c.children, parentId, newContainer) };
  });
}

function findContainerById(containers, id) {
  for (const c of containers) {
    if (c.id === id) return c;
    const found = findContainerById(c.children, id);
    if (found) return found;
  }
  return null;
}

function updatePageTypeInTree(containers, id, pageType) {
  return containers.map(c => {
    if (c.id === id) return { ...c, pageType };
    return { ...c, children: updatePageTypeInTree(c.children, id, pageType) };
  });
}

function updateWidgetPropsInTree(containers, id, widgetProps) {
  return containers.map(c => {
    if (c.id === id) return { ...c, widgetProps: { ...c.widgetProps, ...widgetProps } };
    return { ...c, children: updateWidgetPropsInTree(c.children, id, widgetProps) };
  });
}

function deepCloneWithNewIds(container, newParentId) {
  const newId = getNextId();
  const clonedChildren = container.children.map(child => deepCloneWithNewIds(child, newId));

  // Remap gridCells childIds to the new cloned children IDs
  let newLayout = container.layout ? JSON.parse(JSON.stringify(container.layout)) : {};
  if (container.layout?.gridCells) {
    const oldToNew = {};
    container.children.forEach((child, i) => { oldToNew[child.id] = clonedChildren[i].id; });
    newLayout.gridCells = newLayout.gridCells.map(cell => ({
      ...cell,
      childIds: (cell.childIds || (cell.childId != null ? [cell.childId] : [])).map(id => oldToNew[id]).filter(Boolean),
    }));
  }

  return {
    ...container,
    id: newId,
    parentId: newParentId,
    layout: newLayout,
    slot: container.slot ? { ...container.slot } : undefined,
    coord: container.coord ? { ...container.coord } : undefined,
    widgetProps: container.widgetProps ? { ...container.widgetProps } : undefined,
    breakpointOverrides: container.breakpointOverrides
      ? JSON.parse(JSON.stringify(container.breakpointOverrides))
      : undefined,
    children: clonedChildren,
  };
}

function updateCoordInTree(containers, id, coord) {
  return containers.map(c => {
    if (c.id === id) return { ...c, coord: { ...c.coord, ...coord } };
    return { ...c, children: updateCoordInTree(c.children, id, coord) };
  });
}

function updateSlotInTree(containers, id, slot) {
  return containers.map(c => {
    if (c.id === id) return { ...c, slot: { ...c.slot, ...slot } };
    return { ...c, children: updateSlotInTree(c.children, id, slot) };
  });
}

function updateLayoutInTree(containers, id, layout) {
  return containers.map(c => {
    if (c.id === id) return { ...c, layout: { ...c.layout, ...layout } };
    return { ...c, children: updateLayoutInTree(c.children, id, layout) };
  });
}

function renameInTree(containers, id, title) {
  return containers.map(c => {
    if (c.id === id) return { ...c, title };
    return { ...c, children: renameInTree(c.children, id, title) };
  });
}

function deleteFromTree(containers, id) {
  return containers
    .filter(c => c.id !== id)
    .map(c => ({ ...c, children: deleteFromTree(c.children, id) }));
}


function isLockedOrAncestorLocked(containers, id) {
  const flat = {};
  const flatten = (items) => items.forEach(c => { flat[c.id] = c; flatten(c.children); });
  flatten(containers);
  let current = flat[id];
  while (current) {
    if (current.locked) return true;
    current = current.parentId ? flat[current.parentId] : null;
  }
  return false;
}

export {
  flattenContainers,
  isDescendant, extractFromTree, addChildToTree, findContainerById,
  updatePageTypeInTree, updateWidgetPropsInTree, deepCloneWithNewIds,
  updateCoordInTree, updateSlotInTree, updateLayoutInTree,
  renameInTree, deleteFromTree, isLockedOrAncestorLocked,
};
