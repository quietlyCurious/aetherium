// operator/operatorViews/OperatorAssetsView.jsx
// Operator › Assets: browse the real asset hierarchy and see one asset
// live — its properties, its related assets and the All Assets diagram,
// each rendered read-only from whatever the Configurator saved.

import ButtonGroup from 'devextreme-react/button-group';
import HierarchyTree from '../../HierarchyTree';
import { deslugifyType, getAssetDisplayLabel } from '../model/assetQueries';
import { CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, CURRENT_TIMESTAMPS } from '../model/modelData';
import { ReadOnlyRelatedAssetsView, ReadOnlyAllAssetsView } from '../relatedAssets/ReadOnlyViews';
import { AssetCard } from '../relatedAssets/AssetCard';
import { NowAssetTreeItemTemplate } from '../configurator/NowAssetTreePanel';

// Left panel for the new Operator-only Assets area — the real asset
// hierarchy, same HierarchyTree/CURRENT_ASSET_DATA/item-template pattern
// already prototyped (commented out) in NowAssetTreePanel above, just
// used directly for navigation/selection here rather than nested inside
// a Types/Assets tab switcher, since this area is assets-only.
export function OperatorAssetTreePanel({ selectedAssetId, onSelectAsset }) {
  return (
    <div className="op-panel op-now-tree-panel op-operator-asset-tree-panel">
      <div className="op-zone-label">Assets</div>
      <div className="op-now-tree-wrap">
        <div className="left-panel-tab-content op-now-tree-tab-content">
          <HierarchyTree
            dataSource={CURRENT_ASSET_DATA}
            displayExpr="name"
            itemRender={NowAssetTreeItemTemplate}
            selectedId={selectedAssetId}
            onSelect={onSelectAsset}
          />
        </div>
      </div>
    </div>
  );
}

// Center panel for the new Operator-only Assets area — loads whichever
// asset is selected in OperatorAssetTreePanel and shows it through the
// same three visual playgrounds Visualization configures (Properties/
// Related Assets/All Assets), entirely read-only: no toolbar, no
// editing, no save. Properties reuses AssetCard directly
// (it already renders a given asset's own real values under its type's
// saved template, flex or manual, with no canvas involved at all for
// manual mode — just absolutely-positioned tiles); Related Assets and
// All Assets reuse the same Cards/Diagram renderers Visualization uses,
// just with readOnly set so their canvases can't be dragged.
const ASSET_DETAIL_TAB_ITEMS = [
  { text: 'Properties', value: 'properties' },
  { text: 'Related Assets', value: 'related' },
  { text: 'All Assets', value: 'all' },
];

export function OperatorAssetDetail({ selectedAssetId, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, allAssetsTemplate, hiddenAssetIds, activeTab, onActiveTabChange, onTitleClick, onGearClick }) {
  if (!selectedAssetId) {
    return (
      <div className="op-panel op-investigate-panel op-operator-asset-detail op-now-detail-empty">
        <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>
      </div>
    );
  }
  const asset = CURRENT_ASSET_MAP[selectedAssetId];
  if (!asset) return null;
  const typeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
  const typeEntry = typeList.find(t => t.id === typeId);
  const typeName = typeEntry?.name ?? deslugifyType(asset.assetType);
  // Same reasoning as NowAssetDetail's own fullRangeEvidencePoints below —
  // no single narrative/event window here, show the full available trend.
  const evidencePoints = CURRENT_TIMESTAMPS.length
    ? [{ time: CURRENT_TIMESTAMPS[0] }, { time: CURRENT_TIMESTAMPS[CURRENT_TIMESTAMPS.length - 1] }]
    : [];

  return (
    <div className="op-panel op-investigate-panel op-operator-asset-detail">
      <div className="op-zone-label">{getAssetDisplayLabel(selectedAssetId)}</div>
      <div style={{ padding: '10px 12px 0' }}>
        <ButtonGroup
          items={ASSET_DETAIL_TAB_ITEMS}
          keyExpr="value"
          selectedItemKeys={[activeTab]}
          onItemClick={e => onActiveTabChange(e.itemData.value)}
          stylingMode="outlined"
        />
      </div>
      <div className="op-now-type-detail-main">
        {activeTab === 'properties' && (
          <div className={`op-property-tiles-singlebox${(assetDisplayTemplates?.[selectedAssetId]?.layoutMode ?? typeDisplayTemplates?.[typeId]?.layoutMode) === 'manual' ? ' op-property-tiles-singlebox--manual' : ''}`}>
            <AssetCard
              relatedTypeId={typeId}
              relatedTypeName={typeName}
              relatedTypeExampleAssetId={selectedAssetId}
              typeDisplayTemplates={typeDisplayTemplates}
              typePropertyConfigs={typePropertyConfigs}
              assetDisplayTemplates={assetDisplayTemplates}
              assetPropertyConfigs={assetPropertyConfigs}
              evidencePoints={evidencePoints}
              onTitleClick={onTitleClick}
              onGearClick={onGearClick}
            />
          </div>
        )}
        {activeTab === 'related' && (
          <ReadOnlyRelatedAssetsView
            typeId={typeId}
            assetId={selectedAssetId}
            typeList={typeList}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            typeRelatedAssetConfigs={typeRelatedAssetConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            assetRelatedAssetConfigs={assetRelatedAssetConfigs}
            evidencePoints={evidencePoints}
            savedTemplate={assetRelatedAssetsTemplates?.[selectedAssetId] ?? relatedAssetsTemplates[typeId]}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        )}
        {activeTab === 'all' && (
          <ReadOnlyAllAssetsView
            typeList={typeList}
            hiddenAssetIds={hiddenAssetIds}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            evidencePoints={evidencePoints}
            savedTemplate={allAssetsTemplate}
            onTitleClick={onTitleClick}
            onGearClick={onGearClick}
          />
        )}
      </div>
    </div>
  );
}
