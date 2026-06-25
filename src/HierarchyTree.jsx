import React, { useState } from 'react';

import { TreeView } from 'devextreme-react';

function HierarchyTree({ dataSource, keyExpr = 'id', parentIdExpr = 'parentId', displayExpr = 'name', itemRender, selectedId, onSelect, onItemDblClick }) {
  const [internalSelectedId, setInternalSelectedId] = useState(selectedId ?? null);
  const treeRef = React.useRef(null);

  React.useEffect(() => {
    if (selectedId !== undefined) {
      setInternalSelectedId(selectedId);
      const instance = treeRef.current?.instance?.();
      if (instance) {
        instance.unselectAll();
        if (selectedId) instance.selectItem(selectedId);
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
