// operator/chrome/SidePanel.jsx
// The right-hand panel's container: Details (NowTypeDetailsList), Chat
// (ContactsPanel) or AI (AiChatPanel), chosen by the right rail.

import { resolveAssetProperties } from '../model/assetQueries';
import { CURRENT_ASSET_MAP } from '../model/modelData';
import { AiChatPanel } from './AiChatPanel';
import { ContactsPanel } from './ContactsPanel';
import { NowTypeDetailsList } from '../configurator/NowTypeDetailsList';

export function SidePanel({ mode, contacts, activeContactId, onSelectContact, onBack, onSendMessage, selectedNowThing, nowTypeList, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, typeDisplayTemplates, onSaveTypeDisplayTemplate, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, activeSaveHandlerRef, activeTabIndex, onActiveTabIndexChange, rightPanelViewMode, hiddenAssetIds, onToggleAssetVisibility, propertyVisuals }) {
  return (
    <div className="op-panel op-side-panel">
      <div className="op-side-tab-content">
        {mode === 'chat' && (
          <ContactsPanel
            contacts={contacts}
            activeContactId={activeContactId}
            onSelectContact={onSelectContact}
            onBack={onBack}
            onSendMessage={onSendMessage}
          />
        )}
        {mode === 'ai' && <AiChatPanel />}
        {mode === 'details' && (
          selectedNowThing?.kind === 'type' ? (
            (() => {
              const typeEntry = nowTypeList.find(t => t.id === selectedNowThing.id);
              if (!typeEntry) {
                return <div className="op-now-detail-placeholder-note">Select a type from the list to view it.</div>;
              }
              const { properties } = resolveAssetProperties(typeEntry.exampleAssetId);
              return (
                <NowTypeDetailsList
                  key={selectedNowThing.id}
                  entityId={selectedNowThing.id}
                  isAssetEntity={false}
                  relationshipTypeId={selectedNowThing.id}
                  typeList={nowTypeList}
                  properties={properties}
                  typePropertyConfigs={typePropertyConfigs}
                  setTypePropertyConfigs={setTypePropertyConfigs}
                  typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                  setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                  rightPanelViewMode={rightPanelViewMode}
                  hiddenAssetIds={hiddenAssetIds}
                  onToggleAssetVisibility={onToggleAssetVisibility}
                  activeTabIndex={activeTabIndex}
                  onActiveTabIndexChange={onActiveTabIndexChange}
                  propertyVisuals={propertyVisuals}
                  typeDisplayTemplates={typeDisplayTemplates}
                />
              );
            })()
          ) : selectedNowThing?.kind === 'asset' ? (
            (() => {
              const asset = CURRENT_ASSET_MAP[selectedNowThing.id];
              if (!asset) {
                return <div className="op-now-detail-placeholder-note">Select an asset from the tree to view it.</div>;
              }
              const relationshipTypeId = `TYPE_${asset.assetLevel}_${asset.assetType}`;
              const { properties } = resolveAssetProperties(selectedNowThing.id);
              return (
                <NowTypeDetailsList
                  key={selectedNowThing.id}
                  entityId={selectedNowThing.id}
                  isAssetEntity
                  relationshipTypeId={relationshipTypeId}
                  typeList={nowTypeList}
                  properties={properties}
                  typePropertyConfigs={typePropertyConfigs}
                  setTypePropertyConfigs={setTypePropertyConfigs}
                  typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                  setTypeRelatedAssetConfigs={setTypeRelatedAssetConfigs}
                  assetPropertyConfigs={assetPropertyConfigs}
                  setAssetPropertyConfigs={setAssetPropertyConfigs}
                  assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                  setAssetRelatedAssetConfigs={setAssetRelatedAssetConfigs}
                  rightPanelViewMode={rightPanelViewMode}
                  hiddenAssetIds={hiddenAssetIds}
                  onToggleAssetVisibility={onToggleAssetVisibility}
                  activeTabIndex={activeTabIndex}
                  onActiveTabIndexChange={onActiveTabIndexChange}
                  propertyVisuals={propertyVisuals}
                  typeDisplayTemplates={typeDisplayTemplates}
                />
              );
            })()
          ) : (
            <div className="op-now-detail-placeholder-note">Select a type or asset from the tree to view its details.</div>
          )
        )}
      </div>
    </div>
  );
}
