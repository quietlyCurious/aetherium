// operator/configurator/NowAssetTreePanel.jsx
// The Configurator's left panel: Types (a list of equipment categories)
// and Assets (the real hierarchy) as two controlled tabs, each row marked
// with its customization state. Also the row templates the Operator's own
// asset tree reuses.

import { forwardRef, useRef, useImperativeHandle } from 'react';
import { TabPanel } from 'devextreme-react';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import DataListGrid from '../../DataListGrid';
import HierarchyTree from '../../HierarchyTree';
import { CURRENT_ASSET_DATA } from '../../model/modelData';
import { AssetCustomizedDot, TypeCustomizedCount } from './customizationControls';

const TYPE_LIST_COLUMNS = [
  {
    dataField: 'name',
    caption: 'Name',
    minWidth: 120,
    // Count of this type's customized assets, when there are any.
    cellRender: cellInfo => (
      <span className="op-type-name-cell">
        <span className="op-type-name-text">{cellInfo.data.name}</span>
        <TypeCustomizedCount typeId={cellInfo.data.id} />
      </span>
    ),
  },
  { dataField: 'level', caption: 'Level', width: 90 },
];

// Left panel for the new Now work area — the real asset hierarchy
// (CURRENT_ASSET_DATA), via the same
// HierarchyTree component the Data tab already uses elsewhere in the app.
export const NowAssetTreePanel = forwardRef(function NowAssetTreePanel({ selectedThing, onSelectThing, typeList, tabIndex, onTabIndexChange }, ref) {
  const typesGridRef = useRef(null);
  useImperativeHandle(ref, () => ({
    updateDimensions: () => typesGridRef.current?.instance()?.updateDimensions(),
  }));

  return (
    <div className="op-panel op-now-tree-panel">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tree-wrap">
        <TabPanel
          height="100%"
          animationEnabled={false}
          swipeEnabled={false}
          selectedIndex={tabIndex}
          onSelectionChanged={e => onTabIndexChange(e.component.option('selectedIndex'))}
        >
          <TabPanelItem title="Types">
            <div className="left-panel-tab-content op-now-tree-tab-content">
              <DataListGrid
                ref={typesGridRef}
                items={typeList}
                columns={TYPE_LIST_COLUMNS}
                selectedId={selectedThing?.kind === 'type' ? selectedThing.id : null}
                onSelect={id => onSelectThing(id ? { kind: 'type', id } : null)}
                noDataText="No types found."
                searchEnabled={false}
              />
            </div>
          </TabPanelItem>
          <TabPanelItem title="Assets">
            <div className="left-panel-tab-content op-now-tree-tab-content">
              <HierarchyTree
                dataSource={CURRENT_ASSET_DATA}
                displayExpr="name"
                itemRender={ConfiguratorAssetTreeItemTemplate}
                selectedId={selectedThing?.kind === 'asset' ? selectedThing.id : null}
                onSelect={id => onSelectThing({ kind: 'asset', id })}
              />
            </div>
          </TabPanelItem>
        </TabPanel>
      </div>
    </div>
  );
});

// Mirrors App.js's own AssetTreeItemTemplate (not exported from there, so
// copied rather than restructuring that file for one shared helper) —
// keeps the asset row's look identical to the existing Data tab hierarchy
// browser: name plus a small type badge.
// The Configurator's Now tree only — adds the customized-asset dot.
// Operator's Assets tree keeps the plain template below: operators don't
// configure anything, so the mark would only be noise there.
function ConfiguratorAssetTreeItemTemplate(item) {
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="op-tree-item-trailing">
        <AssetCustomizedDot assetId={item.id} />
        <span className="tree-item-badge">{item.assetType}</span>
      </span>
    </div>
  );
}

export function NowAssetTreeItemTemplate(item) {
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="tree-item-badge">{item.assetType}</span>
    </div>
  );
}
