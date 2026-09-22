import React, { useState } from 'react';

import { TreeView } from 'devextreme-react';

// `expandAll`: open every node whenever the data changes — for a filtered
// tree, whose matches can sit several levels down under collapsed parents.
function HierarchyTree({ dataSource, keyExpr = 'id', parentIdExpr = 'parentId', displayExpr = 'name', itemRender, selectedId, onSelect, onItemDblClick, expandAll = false }) {
  const [internalSelectedId, setInternalSelectedId] = useState(selectedId ?? null);
  const treeRef = React.useRef(null);

  React.useEffect(() => {
    if (expandAll) treeRef.current?.instance?.()?.expandAll();
  }, [expandAll, dataSource]);

  React.useEffect(() => {
    if (selectedId !== undefined) {
      setInternalSelectedId(selectedId);
      const instance = treeRef.current?.instance?.();
      if (instance) {
        instance.unselectAll();
        if (selectedId) {
          // A selection made from outside the tree (a Now-strip tile, a deep
          // link) can point at an asset nested several levels down. Expand
          // its ancestors so it's actually visible, then scroll it into view.
          if (Array.isArray(dataSource)) {
            const byKey = new Map(dataSource.map(d => [d[keyExpr], d]));
            let parentKey = byKey.get(selectedId)?.[parentIdExpr];
            const ancestors = [];
            while (parentKey != null && byKey.has(parentKey) && !ancestors.includes(parentKey)) {
              ancestors.unshift(parentKey);
              parentKey = byKey.get(parentKey)[parentIdExpr];
            }
            ancestors.forEach(key => instance.expandItem(key));
          }
          instance.selectItem(selectedId);
          instance.scrollToItem?.(selectedId);
        }
      }
    }
  }, [selectedId]);

  const effectiveOnSelect = (id) => {
    setInternalSelectedId(id);
    if (onSelect) onSelect(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TreeView
        ref={treeRef}
        dataSource={dataSource}
        dataStructure="plain"
        keyExpr={keyExpr}
        parentIdExpr={parentIdExpr}
        displayExpr={displayExpr}
        itemRender={itemRender}
        selectionMode="single"
        selectByClick={true}
        selectNodesRecursive={false}
        expandAllEnabled={true}
        defaultExpandAll={true}
        selectedItemKeys={internalSelectedId ? [internalSelectedId] : []}
        onItemSelectionChanged={(e) => {
          const selected = e.component.getSelectedNodes();
          effectiveOnSelect(selected.length > 0 ? selected[0].key : null);
        }}
        onItemDblClick={onItemDblClick ? (e) => onItemDblClick(e.itemData) : undefined}
      />
    </div>
  );
}

// Map widget names to their components and sample data

export default HierarchyTree;
