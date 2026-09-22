// WidgetBindingPopover.jsx
// Floating popover for binding a widget PROPERTY. Supports Expression mode
// (existing behavior, with the same smart-quoting fix InputBindingPopover
// uses) and Query mode: pick a query instance already on the page, then one
// of its outputs.
//
// Cardinality adapter: a query's output is fundamentally TABLE-shaped (rows
// x columns) — even a single output field can come back as one row or many
// (e.g. several historian samples). A widget property, meanwhile, wants
// either a single scalar (most properties) or a whole collection (properties
// of type 'data'). Rather than treating "scalar property + series query" as
// an error, this reconciles it: binding a series/resultset query's output to
// a scalar property offers a First/Last row picker (stored as a transform
// step); binding a scalar query's output to a collection property needs no
// choice at all — it's silently wrapped as a one-item list downstream. Both
// directions mean "gracefully handle the shape mismatch" rather than forcing
// the two fix-paths (scalar vs collection) to stay fully separate.
//
// Asset mode (screens that are about a type): pick where from — self, an
// ancestor, or a component reached by type (model/assetPaths.js
// reachableFrom) — then one of its properties. Stored as { type: 'asset',
// path, property }, so it follows the path again from whichever asset the
// screen shows. `self` is screenSelfOf's answer for the open screen.

import React, { useState, useEffect, useMemo } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { evaluateExpression } from './expressionEval';
import { inferResultCardinality, RESULT_CARDINALITIES } from './dataModel';
import { reachableFrom, resolveAssetValue, resolveAssetSeries, PATH_ERRORS, pathKey } from './model/assetPaths';
import { CURRENT_ASSET_MAP, PROPERTY_UNITS } from './model/modelData';

// The Asset mode's body: where from, which property, and what it gives for
// the asset being previewed.
function AssetBindingFields({ binding, self, wantsCollection, onSave }) {
  const nodes = useMemo(() => (self?.status === 'ok' ? reachableFrom(self.typeId) : []), [self?.status, self?.typeId]);
  // Built once per type: a new list on every render makes the dropdown
  // reload mid-click and drop the choice.
  const fromOptions = useMemo(() => nodes.map(n => ({
    value: n.key,
    // Ancestors say what they are; a component's name already is its type.
    label: `${'\u00a0\u00a0'.repeat(n.depth)}${n.label}${n.label === 'parent' ? ` · ${n.typeLabel}` : ''}`,
    partial: n.reach.ok < n.reach.of ? `${n.reach.ok} of ${n.reach.of}` : null,
  })), [nodes]);
  const current = binding?.type === 'asset' ? binding : null;
  const [fromKey, setFromKey] = useState(current ? pathKey(current.path || []) : 'self');

  if (!self || self.status === 'none') {
    return (
      <div className="binding-hint">
        This screen isn't about an asset yet. Select the Page and choose what it's <b>About</b> in its General details, then bind to that asset's properties here.
      </div>
    );
  }
  if (self.status !== 'ok') {
    return <div className="binding-hint">This screen is about a type that isn't in the loaded model.</div>;
  }

  const node = nodes.find(n => n.key === fromKey) || nodes[0];
  const property = current && pathKey(current.path || []) === node?.key ? current.property : null;

  let preview = null;
  if (property && self.assetId) {
    const assetName = CURRENT_ASSET_MAP[self.assetId]?.name;
    if (wantsCollection) {
      const r = resolveAssetSeries(self.assetId, node.path, property);
      preview = r.error ? { err: PATH_ERRORS[r.error] } : { text: `${r.rows.length} rows (timestamp, value) on ${assetName}` };
    } else {
      const r = resolveAssetValue(self.assetId, node.path, property);
      preview = r.error ? { err: PATH_ERRORS[r.error] } : { text: `${r.value}${PROPERTY_UNITS[property] ? ` ${PROPERTY_UNITS[property]}` : ''} on ${assetName}` };
    }
  }

  return (
    <>
      <div className="binding-type-label">From</div>
      <SelectBox
        dataSource={fromOptions}
        valueExpr="value"
        displayExpr="label"
        value={node?.key}
        itemRender={o => <span style={{ whiteSpace: 'pre' }}>{o.label}{o.partial && <span style={{ color: '#b7791f' }}>{`  (only ${o.partial})`}</span>}</span>}
        onValueChanged={e => setFromKey(e.value)}
        stylingMode="outlined"
        width="100%"
        height={26}
      />
      <div className="binding-type-label" style={{ marginTop: 6 }}>Property</div>
      <SelectBox
        dataSource={node?.properties || []}
        valueExpr="key"
        displayExpr="label"
        value={property}
        placeholder="Select a property…"
        searchEnabled
        onValueChanged={e => e.value && onSave({ type: 'asset', path: node.path, property: e.value })}
        stylingMode="outlined"
        width="100%"
        height={26}
      />
      {wantsCollection && <div className="binding-hint">A list property gets the property's history: one row per timestamp, with <b>timestamp</b> and <b>value</b>.</div>}
      {preview && (
        <div className={`binding-preview${preview.err ? ' binding-preview-error' : ''}`}>
          <span style={{ color: '#aaa', marginRight: 4 }}>→</span>
          <strong>{preview.err || preview.text}</strong>
        </div>
      )}
    </>
  );
}

export default function WidgetBindingPopover({
  propLabel, propType, binding, x, y, pageQueryInstances, queries, self, onSave, onClear, onClose,
}) {
  // A new binding on a screen about a type starts in Asset mode.
  const initialMode = () => binding?.type || (self?.status === 'ok' ? 'asset' : 'expression');
  const [mode, setMode] = useState(initialMode); // 'expression' | 'query' | 'asset'
  const [rawText, setRawText] = useState(binding?.type === 'expression' ? (binding.expression ?? '') : '');
  const [pendingInstanceId, setPendingInstanceId] = useState(binding?.type === 'query' ? binding.queryInstanceId : null);
  const existingPickRow = binding?.type === 'query' ? binding.transform?.find(t => t.type === 'pickRow') : null;
  const [rowMode, setRowMode] = useState(existingPickRow?.mode || 'last');
  const [selectedFields, setSelectedFields] = useState(
    binding?.type === 'query' && binding.outputFields ? binding.outputFields.map(f => f.fieldName) : []
  );

  useEffect(() => {
    setMode(initialMode());
    setRawText(binding?.type === 'expression' ? (binding.expression ?? '') : '');
    setPendingInstanceId(binding?.type === 'query' ? binding.queryInstanceId : null);
    setRowMode(existingPickRow?.mode || 'last');
    setSelectedFields(binding?.type === 'query' && binding.outputFields ? binding.outputFields.map(f => f.fieldName) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propLabel]);

  const popLeft = Math.max(8, x - 252);
  const popTop = Math.min(y, window.innerHeight - 300);

  // ── Expression mode ────────────────────────────────────────────────────
  const rawResult = evaluateExpression(rawText);
  const rawFails = rawResult === '#ERR';
  const quotedText = JSON.stringify(rawText);
  const quotedResult = rawFails ? evaluateExpression(quotedText) : undefined;
  const useQuotedFallback = rawFails && quotedResult !== '#ERR';
  const previewVal = useQuotedFallback ? quotedResult : rawResult;
  const isErr = previewVal === '#ERR';

  const handleExpressionChange = (val) => {
    setRawText(val);
    if (val === '') {
      onClear();
      return;
    }
    const failsAlone = evaluateExpression(val) === '#ERR';
    const quoted = JSON.stringify(val);
    const finalExpr = failsAlone && evaluateExpression(quoted) !== '#ERR' ? quoted : val;
    onSave({ type: 'expression', expression: finalExpr });
  };

  // ── Query mode ──────────────────────────────────────────────────────────
  const instanceOptions = pageQueryInstances.map(qi => ({
    value: qi.id,
    label: qi.alias || queries.find(q => q.id === qi.queryId)?.name || '(unnamed instance)',
  }));
  const pendingInstance = pageQueryInstances.find(qi => qi.id === pendingInstanceId);
  const pendingQuery = pendingInstance ? queries.find(q => q.id === pendingInstance.queryId) : null;
  const outputOptions = (pendingQuery?.outputs || []).map(o => ({ value: o.name, label: `${o.name} (${o.type})` }));
  const currentOutputField = binding?.type === 'query' && binding.queryInstanceId === pendingInstanceId ? binding.outputField : null;

  const queryCardinality = pendingQuery ? inferResultCardinality(pendingQuery) : null;
  const wantsCollection = propType === 'data';
  const queryIsMultiRow = queryCardinality === RESULT_CARDINALITIES.SERIES || queryCardinality === RESULT_CARDINALITIES.RESULTSET;
  const needsRowPick = !wantsCollection && queryIsMultiRow;

  const handlePickInstance = (instanceId) => {
    setPendingInstanceId(instanceId);
    if (wantsCollection) {
      // Collection-typed properties (chart/grid dataSource, etc.) bind to
      // the query's result set. No fields selected yet means "everything" —
      // she can narrow it down field-by-field below.
      setSelectedFields([]);
      const inst = pageQueryInstances.find(qi => qi.id === instanceId);
      const query = inst ? queries.find(q => q.id === inst.queryId) : null;
      if (query) {
        onSave({ type: 'query', queryInstanceId: instanceId, queryId: query.id, outputFields: [], transform: [] });
      }
      return;
    }
    // Scalar properties: an output still needs to be chosen before there's
    // a complete binding to store.
  };

  const saveCollectionBinding = (fieldNames) => {
    if (!pendingQuery) return;
    const outputFields = fieldNames.map(fn => {
      const outDef = pendingQuery.outputs?.find(o => o.name === fn);
      return { fieldName: fn, fieldType: outDef?.type || 'String' };
    });
    onSave({ type: 'query', queryInstanceId: pendingInstanceId, queryId: pendingQuery.id, outputFields, transform: [] });
  };

  const handleAddField = (fieldName) => {
    if (!fieldName || selectedFields.includes(fieldName)) return;
    const next = [...selectedFields, fieldName];
    setSelectedFields(next);
    saveCollectionBinding(next);
  };

  const handleRemoveField = (fieldName) => {
    const next = selectedFields.filter(f => f !== fieldName);
    setSelectedFields(next);
    saveCollectionBinding(next);
  };

  const saveQueryBinding = (outputField, mode) => {
    if (!pendingQuery || !outputField) return;
    const transform = needsRowPick ? [{ type: 'pickRow', mode }] : [];
    onSave({ type: 'query', queryInstanceId: pendingInstanceId, queryId: pendingQuery.id, outputField, transform });
  };

  const handlePickOutput = (outputField) => saveQueryBinding(outputField, rowMode);

  const handleRowModeChange = (newMode) => {
    setRowMode(newMode);
    if (currentOutputField) saveQueryBinding(currentOutputField, newMode);
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1400 }} onClick={onClose} />
      <div
        className="binding-popover"
        style={{ position: 'fixed', left: popLeft, top: popTop, zIndex: 1401 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="binding-popover-header">
          <span>Bind: <strong>{propLabel}</strong></span>
          <button onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '8px 10px 0' }}>
          {[{ key: 'expression', label: 'Expression' }, { key: 'query', label: 'Query' }, { key: 'asset', label: 'Asset' }].map(opt => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 5,
                border: '1px solid ' + (mode === opt.key ? '#0078d4' : '#ddd'),
                background: mode === opt.key ? '#e8f2ff' : '#fff',
                color: mode === opt.key ? '#0055aa' : '#555',
                fontWeight: mode === opt.key ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mode === 'asset' ? (
          <div className="binding-popover-body">
            <AssetBindingFields binding={binding} self={self} wantsCollection={propType === 'data'} onSave={onSave} />
          </div>
        ) : mode === 'expression' ? (
          <div className="binding-popover-body">
            <div className="binding-type-label">Value or Expression</div>
            <input
              className="details-input"
              autoFocus
              value={rawText}
              placeholder="e.g.  Running  ·  42.5  ·  100 * 0.8"
              onChange={(e) => handleExpressionChange(e.target.value)}
            />
            <div className={`binding-preview${isErr ? ' binding-preview-error' : ''}`}>
              {rawText
                ? <><span style={{ color: '#aaa', marginRight: 4 }}>→</span><strong>{String(previewVal ?? '')}</strong></>
                : <span style={{ color: '#bbb' }}>Type a value above to preview</span>
              }
            </div>
          </div>
        ) : (
          <div className="binding-popover-body">
            <div className="binding-type-label">Query on this page</div>
            {pageQueryInstances.length === 0 ? (
              <div style={{ fontSize: 11, color: '#aaa', fontStyle: 'italic', padding: '4px 0' }}>
                No queries added to this page yet — add one from the Data tab first.
              </div>
            ) : (
              <>
                <SelectBox
                  dataSource={instanceOptions}
                  valueExpr="value"
                  displayExpr="label"
                  value={pendingInstanceId}
                  placeholder="Select a query…"
                  onValueChanged={e => handlePickInstance(e.value)}
                  stylingMode="outlined"
                  width="100%"
                  height={26}
                />
                {pendingInstance && !wantsCollection && (
                  <>
                    <div className="binding-type-label" style={{ marginTop: 8 }}>Output</div>
                    {outputOptions.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#aaa', fontStyle: 'italic', padding: '4px 0' }}>
                        This query has no outputs.
                      </div>
                    ) : (
                      <SelectBox
                        dataSource={outputOptions}
                        valueExpr="value"
                        displayExpr="label"
                        value={currentOutputField}
                        placeholder="Select an output…"
                        onValueChanged={e => handlePickOutput(e.value)}
                        stylingMode="outlined"
                        width="100%"
                        height={26}
                      />
                    )}
                  </>
                )}
                {pendingInstance && wantsCollection && (() => {
                  const availableFieldOptions = outputOptions.filter(o => !selectedFields.includes(o.value));
                  return (
                    <>
                      <div className="binding-type-label" style={{ marginTop: 8 }}>
                        Fields{selectedFields.length === 0 ? ' — none selected, using all fields' : ''}
                      </div>
                      {selectedFields.map(fieldName => (
                        <div key={fieldName} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                          <span style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{fieldName}</span>
                          <button
                            onClick={() => handleRemoveField(fieldName)}
                            style={{ fontSize: 11, color: '#d00', border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
                            title="Remove this field"
                          >×</button>
                        </div>
                      ))}
                      {availableFieldOptions.length > 0 && (
                        <SelectBox
                          dataSource={availableFieldOptions}
                          valueExpr="value"
                          displayExpr="label"
                          value={null}
                          placeholder="+ Add a field…"
                          onValueChanged={e => e.value && handleAddField(e.value)}
                          stylingMode="outlined"
                          width="100%"
                          height={26}
                          style={{ marginTop: 4 }}
                        />
                      )}
                    </>
                  );
                })()}
                {needsRowPick && (
                  <>
                    <div className="binding-type-label" style={{ marginTop: 8 }}>
                      This query can return multiple rows — which one?
                    </div>
                    <SelectBox
                      dataSource={[{ value: 'first', label: 'First row' }, { value: 'last', label: 'Last row (most recent)' }]}
                      valueExpr="value"
                      displayExpr="label"
                      value={rowMode}
                      onValueChanged={e => handleRowModeChange(e.value)}
                      stylingMode="outlined"
                      width="100%"
                      height={26}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="binding-popover-footer">
          {!!binding && (
            <button
              className="focus-mode-btn"
              style={{ color: '#d00', borderColor: '#d00', fontSize: 11 }}
              onClick={() => { onClear(); onClose(); }}
            >× Clear</button>
          )}
          <button
            className="focus-mode-btn focus-mode-btn--active"
            style={{ fontSize: 11, marginLeft: 'auto' }}
            onClick={onClose}
          >Done</button>
        </div>
      </div>
    </>
  );
}
