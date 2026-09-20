// operator/configurator/NowTypeMainPreview.jsx
// Picks which editor fills the Configurator's preview area, following the
// Details panel's active tab: Properties (PropertyTilesView), Related
// Assets (RelatedAssetsEditor) or All Assets (AllAssetsEditor). Each one
// registers its own Save handler while mounted.

import { useEffect } from 'react';
import { CaretIcon } from '../icons';
import { useDisplayOrders, resolveEntityOrder } from '../settings/displayOrder';
import { buildRelatedAssetRows } from '../relatedAssets/relatedAssetRows';
import { PropertyTilesView } from '../properties/PropertyTilesView';
import { AllAssetsEditor } from './AllAssetsEditor';
import { RelatedAssetsEditor } from './RelatedAssetsEditor';
import { CustomizationTitleControls } from './customizationControls';

// The main preview area for a selected type — whichever of the three
// visual playgrounds matches the Details panel's currently-active tab.
// Persists across Details being hidden/shown: closing the Details panel
// doesn't blank this out or reset it, it just keeps showing whichever
// was last active.
export function NowTypeMainPreview({ activeTabIndex, title, entityId, isAssetEntity, relationshipTypeId, thisAssetExampleId, typeList, properties, sparklineSource, evidencePoints, typePropertyConfigs, typeRelatedAssetConfigs, typeDisplayTemplates, typeRelatedAssetsTemplates, onSaveTypeDisplayTemplate, onSaveTypeRelatedAssetsTemplate, assetPropertyConfigs, assetRelatedAssetConfigs, assetDisplayTemplates, assetRelatedAssetsTemplates, onSaveAssetDisplayTemplate, onSaveAssetRelatedAssetsTemplate, activeSaveHandlerRef, onViewModeChange, hiddenAssetIds, allAssetsTemplate, onSaveAllAssetsTemplate, onTitleClick, toolbarExpanded, onToolbarExpandedChange, propertyVisuals }) {
  // Seeds the shared per-property visual draft from this entity's saved
  // template whenever a different entity gets selected — this component
  // remounts per selection (key={selectedThing.id}), so mount is exactly
  // that moment. The draft only ever holds this entity's OWN choices: for
  // an asset, that's its own template's map and nothing from its type
  // (no whole-template fallback here, unlike layout below) — its type's
  // choices come in separately as the inherited layer, so they're shown
  // but never copied into the asset's saved template.
  const savedPropertyViewModes = (isAssetEntity
    ? assetDisplayTemplates?.[entityId]
    : typeDisplayTemplates?.[entityId])?.propertyViewModes ?? {};
  const inheritedPropertyViewModes = isAssetEntity
    ? (typeDisplayTemplates?.[relationshipTypeId]?.propertyViewModes ?? {})
    : undefined;
  useEffect(() => {
    if (propertyVisuals && propertyVisuals.entityId !== entityId) {
      propertyVisuals.setModes(entityId, savedPropertyViewModes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);
  const draftPropertyViewModes = propertyVisuals?.entityId === entityId ? propertyVisuals.modes : savedPropertyViewModes;
  const displayOrders = useDisplayOrders();
  const ownTypeId = isAssetEntity ? relationshipTypeId : entityId;
  const ownAssetId = isAssetEntity ? entityId : null;
  const effectivePropertyOrder = resolveEntityOrder(displayOrders.typeProperty, displayOrders.assetProperty, ownTypeId, ownAssetId);
  const effectiveRelatedOrder = resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, ownTypeId, ownAssetId);

  const titleRow = (
    <div className="op-now-asset-detail-title op-now-asset-detail-title--with-caret">
      <button
        type="button"
        className="op-now-asset-detail-caret"
        onClick={() => onToolbarExpandedChange(e => !e)}
        title={toolbarExpanded ? 'Hide controls' : 'Show controls'}
      >
        <CaretIcon expanded={toolbarExpanded} />
      </button>
      <span>{title}</span>
      <CustomizationTitleControls entityId={entityId} isAssetEntity={isAssetEntity} />
    </div>
  );

  if (!properties) {
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        <div className="op-now-asset-detail-title">{title}</div>
        <div className="op-dashboard-card op-now-asset-kpi-card">
          <div className="op-dash-text op-dash-text--muted">No properties available yet for this {isAssetEntity ? 'asset' : 'type'}.</div>
        </div>
      </div>
    );
  }

  if (activeTabIndex === 1) {
    const relatedAssetRows = buildRelatedAssetRows({
      typeId: relationshipTypeId,
      assetId: isAssetEntity ? entityId : null,
      typeList, typeRelatedAssetConfigs, assetRelatedAssetConfigs,
      order: effectiveRelatedOrder,
    });
    // This asset's own saved Related Assets view template wins over its
    // type's, when one exists — same all-or-nothing reasoning as the
    // display template below (a cohesive layout choice saved as one unit).
    const effectiveRelatedTemplate = isAssetEntity
      ? (assetRelatedAssetsTemplates?.[entityId] ?? typeRelatedAssetsTemplates?.[relationshipTypeId])
      : typeRelatedAssetsTemplates?.[entityId];
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        {titleRow}
        <div className="op-dashboard-card op-now-type-kpi-card">
          <RelatedAssetsEditor
            key={entityId}
            relatedAssetRows={relatedAssetRows}
            evidencePoints={evidencePoints}
            typeDisplayTemplates={typeDisplayTemplates}
            typePropertyConfigs={typePropertyConfigs}
            assetDisplayTemplates={assetDisplayTemplates}
            assetPropertyConfigs={assetPropertyConfigs}
            currentTypeId={entityId}
            currentTypeName={title}
            currentTypeExampleAssetId={thisAssetExampleId}
            typeList={typeList}
            savedTemplate={effectiveRelatedTemplate}
            onSaveTemplate={isAssetEntity ? onSaveAssetRelatedAssetsTemplate : onSaveTypeRelatedAssetsTemplate}
            activeSaveHandlerRef={activeSaveHandlerRef}
            onTitleClick={onTitleClick}
            showToolbar={toolbarExpanded}
            selectedRelatedKey={propertyVisuals?.selectedRelatedKey ?? null}
            onSelectRelated={propertyVisuals?.setSelectedRelatedKey}
          />
        </div>
      </div>
    );
  }

  // All Assets is a single shared, model-wide view (not per-type, let alone
  // per-asset) — activeTabIndex never reaches 2 for an asset entity, since
  // the Details panel's own tab switcher only offers Properties/Related
  // Assets when one is selected.
  if (activeTabIndex === 2) {
    return (
      <div className="op-panel op-investigate-panel op-now-asset-detail">
        {titleRow}
        <AllAssetsEditor
          typeList={typeList}
          currentTypeId={entityId}
          hiddenAssetIds={hiddenAssetIds}
          typeDisplayTemplates={typeDisplayTemplates}
          typePropertyConfigs={typePropertyConfigs}
          assetDisplayTemplates={assetDisplayTemplates}
          assetPropertyConfigs={assetPropertyConfigs}
          evidencePoints={evidencePoints}
          savedTemplate={allAssetsTemplate}
          onSaveTemplate={onSaveAllAssetsTemplate}
          activeSaveHandlerRef={activeSaveHandlerRef}
          onTitleClick={onTitleClick}
          showToolbar={toolbarExpanded}
        />
      </div>
    );
  }

  // PropertyTilesView itself only ever does a direct typeDisplayTemplates
  // ?.[typeId] / typePropertyConfigs?.[typeId] lookup — no fallback logic of
  // its own. So the asset-aware fallback (this asset's own override if it
  // has one, else its type's current settings as a starting point to tweak
  // from, not blank defaults) is built here instead, as a synthetic single-
  // key map under entityId, keeping PropertyTilesView itself unchanged
  // and exactly as before for every type-only caller (assetPropertyConfigs
  // undefined there, so effectivePropertyConfigs reduces to typePropertyConfigs
  // unchanged).
  const effectiveDisplayTemplate = isAssetEntity
    ? (assetDisplayTemplates?.[entityId] ?? typeDisplayTemplates?.[relationshipTypeId])
    : typeDisplayTemplates?.[entityId];
  const effectiveDisplayTemplates = { [entityId]: effectiveDisplayTemplate };
  const effectivePropertyOverrides = isAssetEntity
    ? { ...(typePropertyConfigs[relationshipTypeId] || {}), ...(assetPropertyConfigs?.[entityId] || {}) }
    : (typePropertyConfigs[entityId] || {});
  const effectivePropertyConfigs = { [entityId]: effectivePropertyOverrides };

  return (
    <div className="op-panel op-investigate-panel op-now-asset-detail">
      {titleRow}
      <div className="op-dashboard-card op-now-type-kpi-card">
        <PropertyTilesView
          properties={properties}
          sparklineSource={sparklineSource}
          evidencePoints={evidencePoints}
          typeVisibilityMode
          typeId={entityId}
          typePropertyConfigs={effectivePropertyConfigs}
          typeDisplayTemplates={effectiveDisplayTemplates}
          onSaveTypeDisplayTemplate={isAssetEntity ? onSaveAssetDisplayTemplate : onSaveTypeDisplayTemplate}
          activeSaveHandlerRef={activeSaveHandlerRef}
          onViewModeChange={onViewModeChange}
          showToolbar={toolbarExpanded}
          propertyViewModes={draftPropertyViewModes}
          inheritedPropertyViewModes={inheritedPropertyViewModes}
          propertyOrder={effectivePropertyOrder}
          selectedPropertyKey={propertyVisuals?.selectedKey ?? null}
          onSelectProperty={propertyVisuals?.setSelectedKey}
        />
      </div>
    </div>
  );
}
