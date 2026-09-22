// designer/assetSets/AssetSetPreview.jsx
// What a set resolves to right now, against the loaded model: how many
// assets, how the rule narrowed them down, a count by type, and the list —
// with the values of the properties the rule filters or ranks by, so you
// can see why each asset is in it.
//
// For a set that takes a start asset, `start` is the one to preview with
// and onStartChange lets the user try another.

import { CURRENT_ASSET_MAP, PROPERTY_DECIMALS, PROPERTY_UNITS } from '../../model/modelData';
import { assetTypeIdOf, getAssetPathLabel } from '../../model/assetQueries';
import { isCompleteCondition, needsStart, propertyLabel, propertyValue, resolveAssetSet } from '../../model/assetSets';
import { AssetPicker } from '../AssetPicker';
import { typeNameOf } from '../modelOptions';

const MAX_ROWS = 200;

function formatValue(key, v) {
  if (v == null) return '—';
  const d = PROPERTY_DECIMALS[key] ?? 1;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}${PROPERTY_UNITS[key] ? ` ${PROPERTY_UNITS[key]}` : ''}`;
}

// The properties worth showing as columns: the ranking one first, then any
// used in conditions.
function valueColumns(set) {
  if (set.kind !== 'rule') return [];
  const keys = [];
  if ((set.rule.rank?.mode === 'lowest' || set.rule.rank?.mode === 'highest') && set.rule.rank.key) keys.push(set.rule.rank.key);
  (set.rule.conditions || []).filter(isCompleteCondition).forEach(c => { if (!keys.includes(c.key)) keys.push(c.key); });
  return keys;
}

export function AssetSetPreview({ set, start, onStartChange }) {
  const takesStart = needsStart(set);
  const { assetIds, steps, error } = resolveAssetSet(set, { start });
  const keys = valueColumns(set);

  const byType = new Map();
  assetIds.forEach(id => {
    const typeId = assetTypeIdOf(CURRENT_ASSET_MAP[id]);
    byType.set(typeId, (byType.get(typeId) || 0) + 1);
  });

  return (
    <div className="asset-set-preview">
      <div className="asset-set-preview-head">
        <span className="asset-set-preview-label">Preview</span>
        {!error && <span className="asset-set-count">{assetIds.length} <small>asset{assetIds.length === 1 ? '' : 's'}</small></span>}
      </div>

      {takesStart && (
        <div className="asset-set-start">
          <span>Preview with start</span>
          <div style={{ flex: 1, minWidth: 0 }}><AssetPicker value={start} onChange={onStartChange} /></div>
        </div>
      )}

      {error ? (
        <div className="asset-set-note">{error}.</div>
      ) : (
        <>
          {steps.length > 0 && (
            <div className="asset-set-steps">
              {steps.map((s, i) => (
                <span key={i} className="asset-set-stepchip">
                  {i > 0 && <span className="asset-set-arrow">→</span>}
                  <b>{s.count}</b> {s.label}
                </span>
              ))}
            </div>
          )}
          {byType.size > 0 && (
            <div className="asset-set-types">
              {[...byType.entries()].map(([typeId, n]) => (
                <span key={typeId} className="asset-set-typechip">{typeNameOf(typeId)} <b>{n}</b></span>
              ))}
            </div>
          )}
          {assetIds.length === 0 ? (
            <div className="asset-set-note">Nothing matches right now.</div>
          ) : (
            <div className="asset-set-table-wrap">
              <table className="asset-set-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Asset</th>
                    <th>Type</th>
                    {keys.map(k => <th key={k} className="num">{propertyLabel(k)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {assetIds.slice(0, MAX_ROWS).map((id, i) => {
                    const a = CURRENT_ASSET_MAP[id];
                    const path = getAssetPathLabel(id);
                    return (
                      <tr key={id}>
                        <td className="num muted">{i + 1}</td>
                        <td>
                          <div className="asset-set-asset">{a.name}</div>
                          <div className="asset-set-path">{path}</div>
                        </td>
                        <td className="muted">{typeNameOf(assetTypeIdOf(a))}</td>
                        {keys.map(k => <td key={k} className="num">{formatValue(k, propertyValue(id, k))}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {assetIds.length > MAX_ROWS && <div className="asset-set-note">Showing the first {MAX_ROWS} of {assetIds.length}.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
