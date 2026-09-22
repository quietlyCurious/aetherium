// operator/configurator/customizationControls.jsx
// The UI for "this asset differs from its type": the dot on a tree row,
// the count on a type row, the title-bar chip with ↓ Match type / ↑ Update
// type, and the popover that lists exactly what would change. All of it
// reads assetCustomizationStore rather than taking the comparison as
// props, so deep DevExtreme templates can render it too.

import { useState, useEffect } from 'react';
import { Popover } from 'devextreme-react/popover';
import { CheckBox } from 'devextreme-react/check-box';
import Button from 'devextreme-react/button';
import { deslugifyType, assetTypeIdOf, getAssetPathLabel } from '../../model/assetQueries';
import { CURRENT_ASSET_MAP, CURRENT_ASSET_DATA } from '../../model/modelData';
import { useAssetCustomizations } from '../settings/customizations';

// Filled blue dot — the same "set on this asset" mark the Details panel's
// Visual column uses, so the one visual language means "this asset
// deviates from its type" everywhere it appears.
// Parents get a lighter version of the same dot when something beneath
// them is customized — the tree starts mostly collapsed, so without it a
// customized asset two levels down would be invisible. (An asset can
// carry both: it's customized itself and so is something under it; its
// own solid dot wins.)
export function AssetCustomizedDot({ assetId }) {
  const { byAsset, containsCustomized } = useAssetCustomizations();
  const info = byAsset[assetId];
  if (info?.differs) return <span className="op-customized-dot" title={`Customized: ${info.summary}`} />;
  const below = containsCustomized[assetId];
  if (below) return <span className="op-customized-dot op-customized-dot--contains" title={`${below} customized asset${below > 1 ? 's' : ''} inside`} />;
  return null;
}

// Types list: how many of this type's assets differ from it.
export function TypeCustomizedCount({ typeId }) {
  const { byType } = useAssetCustomizations();
  const count = byType[typeId]?.length ?? 0;
  if (!count) return null;
  return <span className="op-customized-count" title={`${count} asset${count > 1 ? 's' : ''} customized`}>{count}</span>;
}

// Checklist popover shared by both batch reverts — "which of this type's
// assets should go back to the type" (whole assets) and "which assets
// should drop their own setting for this one property". Everything starts
// checked, since the common case is "all of them"; unchecking is there
// for the exceptions. Rows open the asset on click, so the list doubles as
// the answer to "which assets are customized?".
export function AssetRevertPopover({ target, visible, onHide, title, rows, revertLabel, onRevert, onOpenAsset }) {
  const [checked, setChecked] = useState(() => new Set(rows.map(r => r.id)));
  const rowIdsSignature = rows.map(r => r.id).join('|');
  useEffect(() => {
    // New list (reopened on a different property/type, or a revert
    // elsewhere changed who's customized) — start fully checked again.
    setChecked(new Set(rows.map(r => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdsSignature, visible]);

  const selectedIds = rows.map(r => r.id).filter(id => checked.has(id));
  const toggle = id => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // No confirm dialog — the revert shows an Undo toast instead.
  const handleRevert = () => {
    onRevert(selectedIds);
    onHide();
  };

  return (
    <Popover
      target={target}
      visible={visible && !!target}
      onHiding={onHide}
      hideOnOutsideClick
      position="bottom"
      width={320}
      showTitle
      title={title}
      showCloseButton
      wrapperAttr={{ class: 'op-revert-popover' }}
    >
      <div className="op-revert-list">
        {rows.length === 0 ? (
          <div className="op-dash-text op-dash-text--muted">Nothing to revert.</div>
        ) : rows.map(row => (
          <div key={row.id} className="op-revert-row">
            <CheckBox value={checked.has(row.id)} onValueChanged={e => { if (e.event) toggle(row.id); }} />
            <button type="button" className="op-revert-row-text" onClick={() => { onOpenAsset?.(row.id); onHide(); }} title="Open this asset">
              <span className="op-revert-row-label">{row.label}</span>
              {row.detail && <span className="op-revert-row-detail">{row.detail}</span>}
            </button>
          </div>
        ))}
      </div>
      <div className="op-revert-footer">
        <Button text={revertLabel(selectedIds.length)} type="default" stylingMode="contained" disabled={!selectedIds.length} onClick={handleRevert} />
      </div>
    </Popover>
  );
}

// Title-row controls in the center preview.
//  - Asset: a "Customized" chip (hover lists what differs) and a Revert to
//    type button. The button shows whenever the asset has ANY stored
//    entries, even ones that currently match — reverting those still
//    matters, since a stored match stops following later type changes.
//  - Type: "N customized" — opens the checklist of those assets, to jump
//    to one or revert several at once.
export function CustomizationTitleControls({ entityId, isAssetEntity }) {
  const { byAsset, byType, actions } = useAssetCustomizations();
  const [popoverTarget, setPopoverTarget] = useState(null);

  if (isAssetEntity) {
    const info = byAsset[entityId];
    if (!info?.hasOwn) return null;
    // No confirm dialogs — both show an Undo toast instead.
    const handleRevert = () => actions.revertAssetsToType?.([entityId]);
    const handleApply = () => actions.applyAssetToType?.(entityId);
    // How many OTHER assets would visibly change: those of this type that
    // currently follow it for everything (customized ones keep their own).
    const asset = CURRENT_ASSET_MAP[entityId];
    const typeName = asset ? deslugifyType(asset.assetType) : 'type';
    const followers = asset
      ? (CURRENT_ASSET_DATA || []).filter(a => a.id !== entityId && assetTypeIdOf(a) === info.typeId && !byAsset[a.id]?.differs).length
      : 0;
    const applyHint = `Update the ${typeName} type to use this asset's settings (${info.summary}). `
      + `${followers} other ${typeName} asset${followers === 1 ? '' : 's'} follow${followers === 1 ? 's' : ''} the type and will change too; `
      + 'assets with their own settings keep them. This asset then just follows the type.';
    const revertHint = info.differs
      ? `Make this asset match its type again: its own settings (${info.summary}) are discarded`
      : "This asset's stored settings match its type today, but stop it from following future type changes — match the type to follow it again";
    return (
      <span className="op-title-customization">
        {info.differs && (
          <span className="op-customized-chip" title={`Customized: ${info.summary}`}>
            <span className="op-customized-dot" />Customized
          </span>
        )}
        {/* Same pair, same words and order as an asset row's Visual
            dropdown: ↓ Match type (take the type's), ↑ Update type (give
            it this asset's). */}
        <button type="button" className="op-title-link-btn" onClick={handleRevert} title={revertHint}>↓ Match type</button>
        {info.differs && <span className="op-title-link-sep" aria-hidden="true">·</span>}
        {info.differs && (
          <button type="button" className="op-title-link-btn" onClick={handleApply} title={applyHint}>↑ Update type</button>
        )}
      </span>
    );
  }

  const ids = byType[entityId] || [];
  if (!ids.length) return null;
  const rows = ids.map(id => ({ id, label: getAssetPathLabel(id), detail: byAsset[id]?.summary }));
  return (
    <span className="op-title-customization">
      <button type="button" className="op-customized-chip op-customized-chip--button" onClick={e => setPopoverTarget(e.currentTarget)}>
        <span className="op-customized-dot" />{ids.length} customized asset{ids.length > 1 ? 's' : ''} ▾
      </button>
      <AssetRevertPopover
        target={popoverTarget}
        visible={!!popoverTarget}
        onHide={() => setPopoverTarget(null)}
        title="Customized assets"
        rows={rows}
        revertLabel={n => `↓ Match type on ${n}`}
        onRevert={selectedIds => actions.revertAssetsToType?.(selectedIds)}
        onOpenAsset={actions.openAsset}
      />
    </span>
  );
}
