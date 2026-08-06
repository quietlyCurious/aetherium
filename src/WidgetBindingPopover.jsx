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

import React, { useState, useEffect } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { evaluateExpression } from './expressionEval';
import { inferResultCardinality, RESULT_CARDINALITIES } from './dataModel';

export default function WidgetBindingPopover({
  propLabel, propType, binding, x, y, pageQueryInstances, queries, onSave, onClear, onClose,
}) {
  const [mode, setMode] = useState(binding?.type || 'expression'); // 'expression' | 'query'
  const [rawText, setRawText] = useState(binding?.type === 'expression' ? (binding.expression ?? '') : '');
  const [pendingInstanceId, setPendingInstanceId] = useState(binding?.type === 'query' ? binding.queryInstanceId : null);
  const existingPickRow = binding?.type === 'query' ? binding.transform?.find(t => t.type === 'pickRow') : null;
  const [rowMode, setRowMode] = useState(existingPickRow?.mode || 'last');

  useEffect(() => {
    setMode(binding?.type || 'expression');
    setRawText(binding?.type === 'expression' ? (binding.expression ?? '') : '');
    setPendingInstanceId(binding?.type === 'query' ? binding.queryInstanceId : null);
    setRowMode(existingPickRow?.mode || 'last');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propLabel]);

  const popLeft = Math.max(8, x - 252);
  const popTop = Math.min(y, window.innerHeight - 210);

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
  const willAutoWrap = wantsCollection && queryCardinality === RESULT_CARDINALITIES.SCALAR;

  const handlePickInstance = (instanceId) => {
    setPendingInstanceId(instanceId);
    // Picking a new instance doesn't save anything by itself — an output
    // still needs to be chosen before there's a complete binding to store.
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
          {[{ key: 'expression', label: 'Expression' }, { key: 'query', label: 'Query' }].map(opt => (
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

        {mode === 'expression' ? (
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
                {pendingInstance && (
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
                {willAutoWrap && (
                  <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic', marginTop: 8 }}>
                    This query returns a single value — it'll be treated as a one-item list.
                  </div>
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
