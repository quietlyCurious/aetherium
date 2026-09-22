// operator/configurator/NowTypeDetailsList.jsx
// The Configurator's right-hand Details panel: the Properties and Related
// Assets grids (Show, Visual, drag-to-reorder) and the All Assets
// visibility list. Row data, columns and callbacks are all kept stable
// across renders on purpose — a DevExtreme DataGrid repaints on any
// identity change, which closes whatever dropdown is open in a cell.

import { useRef, useEffect, useState, useMemo } from 'react';
import { TabPanel } from 'devextreme-react';
import { SelectBox } from 'devextreme-react/select-box';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import DataListGrid from '../../DataListGrid';
import { VisibilityStateIcon } from '../icons';
import { getPropertyVisibilityForType, getAssetPathLabel } from '../../model/assetQueries';
import { PROPERTY_LABELS } from '../../model/modelData';
import { useAssetCustomizations } from '../settings/customizations';
import { useDisplayOrders, resolveEntityOrder, applySavedOrder, categoryOrderedPropertyKeys } from '../settings/displayOrder';
import { KPI_VIEW_MODE_ITEMS, PROPERTY_VIEW_MODE_DEFAULT, VISIBILITY_LABEL, VISIBILITY_CYCLE, PROPERTY_VIEW_MODE_UPDATE_TYPE, PROPERTY_VIEW_MODE_OVERRIDE_ITEMS, RELATED_ASSET_VISIBILITY_CYCLE } from '../settings/propertyDisplay';
import { buildRelatedAssetRows } from '../relatedAssets/relatedAssetRows';
import { AllAssetsTypeList } from './AllAssetsEditor';
import { AssetRevertPopover } from './customizationControls';

// The Details panel's content for a selected type — three tabs, each
// showing only the config list (no preview at all; that lives in
// NowTypeMainPreview, in the center, as its own separate component now).
// rightPanelViewMode/hiddenAssetIds are lifted state (OperatorWorkspaceInner),
// read here for display/editing but actually driven by the center preview.
export function NowTypeDetailsList({ entityId, isAssetEntity, relationshipTypeId, typeList, properties, typePropertyConfigs, setTypePropertyConfigs, typeRelatedAssetConfigs, setTypeRelatedAssetConfigs, assetPropertyConfigs, setAssetPropertyConfigs, assetRelatedAssetConfigs, setAssetRelatedAssetConfigs, rightPanelViewMode, hiddenAssetIds, onToggleAssetVisibility, activeTabIndex, onActiveTabIndexChange, propertyVisuals, typeDisplayTemplates }) {
  // DevExtreme's DataGrid does not automatically recalculate column widths
  // when its container is resized (documented requirement, not a bug) —
  // without this, a narrower Details panel can leave columns at their
  // previous (wider) size, overflowing past the visible area. rAF-
  // throttled per DevExtreme's own guidance, since onResize can fire many
  // times per drag. No longer tied to a Splitter drag here (the list is
  // full width now), but the panel itself is still resizable.
  const propsGridRef = useRef(null);
  const relatedGridRef = useRef(null);

  // Clicking a tile in the center preview selects its row here — scroll
  // it into view too, since the grid alone only highlights (DataGrid's
  // selectedRowKeys never scrolls on its own).
  const selectedPropertyKey = propertyVisuals?.selectedKey ?? null;
  useEffect(() => {
    if (selectedPropertyKey == null) return;
    propsGridRef.current?.instance()?.navigateToRow(selectedPropertyKey);
  }, [selectedPropertyKey]);
  // Same for the Related Assets table, selected by clicking a box in the
  // preview's Related Assets view.
  const selectedRelatedKey = propertyVisuals?.selectedRelatedKey ?? null;
  useEffect(() => {
    if (selectedRelatedKey == null) return;
    relatedGridRef.current?.instance()?.navigateToRow(selectedRelatedKey);
  }, [selectedRelatedKey]);

  const visualModeLabel = KPI_VIEW_MODE_ITEMS.find(i => i.value === rightPanelViewMode)?.text ?? rightPanelViewMode;
  // The draft is keyed by entity so a stale map left over from whatever
  // was selected before can't leak into this one's first render (the
  // center preview re-seeds it from this entity's saved template on mount).
  const propertyViewModes = propertyVisuals?.entityId === entityId ? propertyVisuals.modes : {};
  // An asset's type's per-property choices — what a row on Default
  // actually resolves to when the type has set that property (see
  // mergePropertyViewModes). Empty for a type, which has nothing above it.
  const inheritedPropertyViewModes = isAssetEntity ? (typeDisplayTemplates?.[relationshipTypeId]?.propertyViewModes ?? {}) : {};
  // Type view only: which of this type's assets set each property
  // differently — the count badge beside a property's name, and the
  // checklist it opens for reverting that one property on several assets.
  const { byAsset: customizationsByAsset, byTypeProperty, actions: customizationActions } = useAssetCustomizations();
  const customizedByProperty = (!isAssetEntity && byTypeProperty[entityId]) || {};
  const [propertyPopover, setPropertyPopover] = useState(null); // { key, target }

  // Merged the same way AssetCard's own fallback works: this
  // asset's own override wins per property when it has one, otherwise its
  // type's, otherwise "always" — so the grid shown here always reflects
  // what would actually display, not just this asset's own overrides in
  // isolation.
  // Display order (see "Display order"): this entity's own saved order if
  // it has one, else (for an asset) its type's, else the category-grouped
  // default — the same order the preview renders tiles/rows in.
  const displayOrders = useDisplayOrders();
  const orderTypeId = isAssetEntity ? relationshipTypeId : entityId;
  const orderAssetId = isAssetEntity ? entityId : null;
  const effectivePropertyOrder = resolveEntityOrder(displayOrders.typeProperty, displayOrders.assetProperty, orderTypeId, orderAssetId);
  const effectiveRelatedOrder = resolveEntityOrder(displayOrders.typeRelated, displayOrders.assetRelated, orderTypeId, orderAssetId);
  const hasOwnPropertyOrder = !!(isAssetEntity ? displayOrders.assetProperty[entityId] : displayOrders.typeProperty[entityId]);
  const hasOwnRelatedOrder = !!(isAssetEntity ? displayOrders.assetRelated[entityId] : displayOrders.typeRelated[entityId]);
  const orderLevel = isAssetEntity ? 'asset' : 'type';
  // Stable onReorder callbacks for the two grids. A fresh function each
  // render changes DataGrid's RowDragging option, which repaints every row
  // — closing an open Visual dropdown the moment the click that opened it
  // re-renders this component (same failure the stable rows/columns below
  // guard against). They forward to this render's handlers via a ref.
  const reorderLatestRef = useRef({});
  const stableReorderRef = useRef(null);
  if (!stableReorderRef.current) {
    stableReorderRef.current = {
      property: items => reorderLatestRef.current.property?.(items),
      related: items => reorderLatestRef.current.related?.(items),
    };
  }
  const orderedPropertyVisibilityRows = properties
    ? (() => {
      const rows = getPropertyVisibilityForType(relationshipTypeId, properties, typePropertyConfigs, isAssetEntity ? entityId : null, assetPropertyConfigs);
      const byKey = new Map(rows.map(r => [r.key, r]));
      return applySavedOrder(categoryOrderedPropertyKeys(rows.map(r => r.key)), effectivePropertyOrder).map(k => byKey.get(k));
    })()
    : [];

  const rawPropertyRows = properties
    ? orderedPropertyVisibilityRows
      .map(row => ({
        ...row,
        visualMode: propertyViewModes[row.key] ?? PROPERTY_VIEW_MODE_DEFAULT,
        inheritedVisual: inheritedPropertyViewModes[row.key] ?? null,
        // What the type itself shows for this property (its own choice, else
        // its default) — an asset's own visual only offers "Update type"
        // when it differs from this, since otherwise there's nothing to push.
        typeVisual: isAssetEntity
          ? (inheritedPropertyViewModes[row.key] ?? typeDisplayTemplates?.[relationshipTypeId]?.viewMode ?? 'text')
          : null,
        customizedCount: customizedByProperty[row.key]?.length ?? 0,
      }))
    : [];

  // Only explicit overrides are kept in the map — choosing Default removes
  // the entry rather than storing 'default', so the property goes back to
  // following the toolbar's view mode.
  const handleVisualChange = (key, mode) => {
    const next = { ...propertyViewModes };
    if (mode === PROPERTY_VIEW_MODE_DEFAULT || mode == null) delete next[key];
    else next[key] = mode;
    propertyVisuals?.setModes(entityId, next);
  };

  const handleVisibilityChange = (key, visibility) => {
    const setConfigs = isAssetEntity ? setAssetPropertyConfigs : setTypePropertyConfigs;
    setConfigs(prev => ({
      ...prev,
      [entityId]: { ...(prev[entityId] || {}), [key]: visibility },
    }));
  };

  // Stable rows/columns for the Properties grid. Previously both were
  // rebuilt fresh every render, which was harmless while every cell was
  // plain text — but DevExtreme's DataGrid repaints every cell whenever
  // its dataSource or columns change by reference, and now that the
  // Visual column holds a live SelectBox, that repaint remounts it and
  // closes its dropdown. The row click that opens the dropdown also
  // selects the row (and highlights its tile in the preview), which
  // re-renders this component — so without this, the very first click
  // on a Visual cell opened and instantly closed the list. Rows are
  // stabilized by content (a cheap signature, since the inputs are
  // rebuilt upstream every render), columns by the one value their
  // rendering depends on; handlers are read through a ref so the columns
  // never close over stale state.
  const handlersRef = useRef({});
  handlersRef.current = {
    handleVisualChange,
    handleVisibilityChange,
    openPropertyPopover: (key, target) => setPropertyPopover({ key, target }),
    handleUpdateTypeVisual: (key, mode) => customizationActions.applyPropertyToType?.(entityId, key, mode),
  };
  const rowsSignature = JSON.stringify(rawPropertyRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const propertyRows = useMemo(() => rawPropertyRows, [rowsSignature]);

  const propertyColumns = useMemo(() => {
    const modeText = mode => KPI_VIEW_MODE_ITEMS.find(i => i.value === mode)?.text ?? mode;
    return [
      {
        dataField: 'label',
        caption: 'Property',
        minWidth: 80,
        cellRender: (cellInfo) => (
          <span className="op-property-name-cell">
            <span className="op-property-name-text" title={cellInfo.data.label}>{cellInfo.data.label}</span>
            {cellInfo.data.customizedCount > 0 && (
              <button
                type="button"
                className="op-customized-count op-customized-count--button"
                title={`${cellInfo.data.customizedCount} asset${cellInfo.data.customizedCount > 1 ? 's' : ''} set this differently — click to review, or make them match the type`}
                onClick={e => { e.stopPropagation(); handlersRef.current.openPropertyPopover(cellInfo.data.key, e.currentTarget); }}
              >
                {cellInfo.data.customizedCount}
              </button>
            )}
          </span>
        ),
      },
      {
        dataField: 'visibility',
        // "Show" rather than "Visibility" — the new Visual dropdown needs
        // the room, and at the panel's default 280px width the longer
        // caption truncated to "VISIBILI…" while squeezing property names.
        caption: 'Show',
        width: 64,
        minWidth: 64, // DataListGrid's default minWidth (80) would otherwise win over width
        alignment: 'center',
        cellRender: (cellInfo) => (
          <button
            className="op-visibility-cycle-btn"
            title={VISIBILITY_LABEL[cellInfo.data.visibility]}
            onClick={() => handlersRef.current.handleVisibilityChange(cellInfo.data.key, VISIBILITY_CYCLE[cellInfo.data.visibility])}
          >
            <VisibilityStateIcon visibility={cellInfo.data.visibility} />
          </button>
        ),
      },
      {
        dataField: 'visualMode',
        caption: 'Visual',
        // 76 rather than 84 since the rows gained a drag handle — the
        // longest closed value ("Indicator") still fits.
        width: 76,
        minWidth: 76,
        cellRender: (cellInfo) => {
          const overridden = cellInfo.data.visualMode !== PROPERTY_VIEW_MODE_DEFAULT;
          // Three states per row: this entity's own choice (bold, filled
          // dot); not set here but set by the asset's type (hollow dot —
          // only possible on an asset); or set nowhere, following the
          // toolbar's view mode (muted, no dot).
          //
          // The two type actions sit together at the top of the list, in
          // the same mirrored words the title row uses for the whole asset:
          //   ↓ Match type (Spark)       — drop this asset's own visual and
          //                                use the type's (a normal edit,
          //                                kept until Save)
          //   ↑ Update type to Indicator — make this asset's visual the
          //                                type's (immediate, with Undo)
          // "Match type" only reads that way when the type actually sets
          // this property; otherwise the same item is "Default (Text)",
          // since there's nothing type-specific to match.
          const inherited = cellInfo.data.inheritedVisual;
          const inheritLabel = inherited ? modeText(inherited) : visualModeLabel;
          const canUpdateType = overridden && cellInfo.data.typeVisual != null && cellInfo.data.visualMode !== cellInfo.data.typeVisual;
          const visualSelectItems = [
            { text: inherited ? `↓ Match type (${inheritLabel})` : `Default (${inheritLabel})`, value: PROPERTY_VIEW_MODE_DEFAULT, typeAction: !!inherited },
            ...(canUpdateType ? [{ text: `↑ Update type to ${modeText(cellInfo.data.visualMode)}`, value: PROPERTY_VIEW_MODE_UPDATE_TYPE, typeAction: true, dividerAfter: true }] : []),
            ...PROPERTY_VIEW_MODE_OVERRIDE_ITEMS,
          ];
          if (!canUpdateType) visualSelectItems[0].dividerAfter = true;
          const stateClass = overridden ? ' op-property-visual-select--override' : inherited ? ' op-property-visual-select--inherited' : '';
          const hint = overridden
            ? 'Set on this asset only'
            : inherited
              ? 'Comes from this asset\'s type — changes there apply here too'
              : 'Follows the view mode chosen in the preview toolbar';
          return (
            <SelectBox
              className={`op-property-visual-select${stateClass}`}
              items={visualSelectItems}
              // The closed field shows just the mode name to fit the
              // narrow column (styled by state, above); the open list
              // spells the type actions out.
              displayExpr={item => (item ? (item.value === PROPERTY_VIEW_MODE_DEFAULT ? inheritLabel : item.text) : '')}
              itemRender={item => (
                <span className={`op-visual-item${item.typeAction ? ' op-visual-item--type-action' : ''}${item.dividerAfter ? ' op-visual-item--divider' : ''}`}>{item.text}</span>
              )}
              valueExpr="value"
              value={cellInfo.data.visualMode}
              onValueChanged={e => {
                if (!e.event) return;
                if (e.value === PROPERTY_VIEW_MODE_UPDATE_TYPE) {
                  // An action, not a value: put the field back, then act.
                  e.component.option('value', e.previousValue);
                  handlersRef.current.handleUpdateTypeVisual(cellInfo.data.key, e.previousValue);
                  return;
                }
                handlersRef.current.handleVisualChange(cellInfo.data.key, e.value);
              }}
              stylingMode="underlined"
              showDropDownButton={false}
              dropDownOptions={{ width: 190 }}
              hint={hint}
            />
          );
        },
      },
    ];
  }, [visualModeLabel]);

  if (!properties) {
    return <div className="op-dash-text op-dash-text--muted">No properties available yet for this {isAssetEntity ? 'asset' : 'type'}.</div>;
  }

  // Related Assets tab — every asset-relationship edge touching this
  // entity's own type, collapsed to one row per (related type,
  // relationship) pair, with a simpler always/never visibility toggle than
  // the properties table above. Same asset-over-type merge as propertyRows.
  const relatedAssetRows = buildRelatedAssetRows({
    typeId: relationshipTypeId,
    assetId: isAssetEntity ? entityId : null,
    typeList, typeRelatedAssetConfigs, assetRelatedAssetConfigs,
    order: effectiveRelatedOrder,
  });

  // Dragging a row saves the whole new order at this entity's level
  // (immediately, like the Show column). The footer under each table only
  // appears once this entity has an order of its own, and removes it —
  // for an asset that's "↓ Match type order", same words as the other
  // match-the-type actions; a type goes back to the default order.
  reorderLatestRef.current = {
    property: items => displayOrders.setOrder('property', orderLevel, entityId, items.map(r => r.key)),
    related: items => displayOrders.setOrder('related', orderLevel, entityId, items.map(r => r.key)),
  };
  const orderFooter = (hasOwn, kind) => hasOwn && (
    <div className="op-order-footer">
      <span>Custom order</span>
      <button type="button" className="op-title-link-btn" onClick={() => displayOrders.setOrder(kind, orderLevel, entityId, null)}>
        {isAssetEntity ? '↓ Match type order' : 'Reset to default order'}
      </button>
    </div>
  );

  const handleRelatedAssetVisibilityChange = (key, visibility) => {
    const setConfigs = isAssetEntity ? setAssetRelatedAssetConfigs : setTypeRelatedAssetConfigs;
    setConfigs(prev => ({
      ...prev,
      [entityId]: { ...(prev[entityId] || {}), [key]: visibility },
    }));
  };

  const relatedAssetColumns = [
    { dataField: 'relatedTypeName', caption: 'Asset', minWidth: 100 },
    { dataField: 'relationshipLabel', caption: 'Relationship', minWidth: 100 },
    {
      dataField: 'visibility',
      caption: 'Visibility',
      width: 90,
      alignment: 'center',
      cellRender: (cellInfo) => (
        <button
          className="op-visibility-cycle-btn"
          title={VISIBILITY_LABEL[cellInfo.data.visibility]}
          onClick={() => handleRelatedAssetVisibilityChange(cellInfo.data.key, RELATED_ASSET_VISIBILITY_CYCLE[cellInfo.data.visibility])}
        >
          <VisibilityStateIcon visibility={cellInfo.data.visibility} />
        </button>
      ),
    },
  ];

  return (
    <div className="op-now-type-tabs">
      <TabPanel
        height="100%"
        animationEnabled={false}
        swipeEnabled={false}
        selectedIndex={activeTabIndex}
        onSelectionChanged={e => onActiveTabIndexChange(e.component.option('selectedIndex'))}
      >
        <TabPanelItem title="Properties">
          <div className="op-now-type-props-list op-now-type-props-list--orderable">
            <div className="op-now-type-props-grid">
              <DataListGrid
                ref={propsGridRef}
                items={propertyRows}
                columns={propertyColumns}
                keyExpr="key"
                selectedId={selectedPropertyKey}
                onSelect={key => propertyVisuals?.setSelectedKey(key)}
                columnAutoWidth={false}
                searchEnabled={false}
                reorderable
                onReorder={stableReorderRef.current.property}
                dragColumnWidth={24}
                noDataText={`No properties for this ${isAssetEntity ? 'asset' : 'type'}.`}
              />
            </div>
            {orderFooter(hasOwnPropertyOrder, 'property')}
          </div>
        </TabPanelItem>
        <TabPanelItem title="Related Assets">
          <div className="op-now-type-props-list op-now-type-props-list--orderable">
            <div className="op-now-type-props-grid">
              <DataListGrid
                ref={relatedGridRef}
                items={relatedAssetRows}
                columns={relatedAssetColumns}
                keyExpr="key"
                selectedId={selectedRelatedKey}
                onSelect={key => propertyVisuals?.setSelectedRelatedKey(key)}
                searchEnabled={false}
                reorderable
                onReorder={stableReorderRef.current.related}
                dragColumnWidth={24}
                noDataText={`No related assets for this ${isAssetEntity ? 'asset' : 'type'}.`}
              />
            </div>
            {orderFooter(hasOwnRelatedOrder, 'related')}
          </div>
        </TabPanelItem>
        {!isAssetEntity && (
          <TabPanelItem title="All Assets">
            <AllAssetsTypeList hiddenAssetIds={hiddenAssetIds} onToggleAssetVisibility={onToggleAssetVisibility} />
          </TabPanelItem>
        )}
      </TabPanel>
      {!isAssetEntity && propertyPopover && (() => {
        const key = propertyPopover.key;
        const label = PROPERTY_LABELS[key] || key;
        const rows = (customizedByProperty[key] || []).map(id => ({
          id,
          label: getAssetPathLabel(id),
          detail: customizationsByAsset[id]?.propertyDetails?.[key],
        }));
        return (
          <AssetRevertPopover
            target={propertyPopover.target}
            visible
            onHide={() => setPropertyPopover(null)}
            title={label}
            rows={rows}
            revertLabel={n => `↓ Match type on ${n}`}
            onRevert={ids => customizationActions.revertPropertyToType?.(ids, key)}
            onOpenAsset={customizationActions.openAsset}
          />
        );
      })()}
    </div>
  );
}
