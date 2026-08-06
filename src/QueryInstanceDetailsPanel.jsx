// QueryInstanceDetailsPanel.jsx
// Shown in the right-side details panel when a query instance is selected in
// the Page Data tab (mutually exclusive with container/widget selection).
// Each input gets the same binding icon (⚡) widget properties get — clicking
// it opens the same expression-based binding popover, letting a manual value
// be provided so the query can eventually run. Outputs stay read-only.
//
// Effective value priority per input: binding (live expression) > instance
// override (static value) > query default.

import React from 'react';

export default function QueryInstanceDetailsPanel({
  instance, query, evaluateExpression, openBindingField, onOpenBindingPopover,
}) {
  if (!instance) return null;

  if (!query) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {instance.alias || '(unnamed instance)'}
        </div>
        <div style={{ fontSize: 11, color: '#c0392b', background: '#fdf0ee', border: '1px solid #e8b4ae', borderRadius: 4, padding: '8px 10px' }}>
          The query this instance points to no longer exists.
        </div>
      </div>
    );
  }

  // Resolves what this input's value ACTUALLY is right now, and how it got
  // there — a live binding wins over a static per-instance override, which
  // wins over the query's own default.
  const getEffectiveValue = (inputName) => {
    const binding = instance.bindings?.[inputName];
    if (binding?.expression) {
      const resolved = evaluateExpression ? evaluateExpression(binding.expression) : undefined;
      return { value: resolved, source: 'binding', isError: resolved === '#ERR' };
    }
    const override = (instance.inputOverrides || []).find(o => o.fieldName === inputName);
    if (override) return { value: override.value, source: 'override', isError: false };
    const inputDef = (query.inputs || []).find(i => i.name === inputName);
    return { value: inputDef?.defaultValue ?? '', source: 'default', isError: false };
  };

  return (
    <div style={{ padding: '12px 14px', overflow: 'auto', height: '100%' }}>

      <div className="details-section">
        <div className="details-grid">
          <span className="details-section-title">Instance</span>
          <span className="details-grid-label">Name</span>
          <div className="details-grid-control">
            <span style={{ fontSize: 12 }}>{instance.alias || '(unnamed instance)'}</span>
          </div>
          <span className="details-grid-label">Query</span>
          <div className="details-grid-control">
            <span style={{ fontSize: 12, color: '#555' }}>{query.name || '(unnamed)'}</span>
          </div>
        </div>
      </div>

      <div className="details-section">
        <div className="details-grid">
          <span className="details-section-title">Inputs</span>
          {(query.inputs || []).length === 0 ? (
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#aaa', fontStyle: 'italic', padding: '4px 0' }}>
              This query has no inputs.
            </div>
          ) : query.inputs.map(inputDef => {
            const { value, source, isError } = getEffectiveValue(inputDef.name);
            const isBound = source === 'binding';
            return (
              <React.Fragment key={inputDef.name}>
                <span className="details-grid-label">{inputDef.name}</span>
                <div className="details-grid-control" style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 }}>
                    <span style={{ fontSize: 9, color: '#999', flexShrink: 0 }}>{inputDef.type}</span>
                    {isBound ? (
                      <div
                        className={`binding-value-display${isError ? ' binding-value-display--error' : ''}`}
                        style={{ flex: 1 }}
                        title={`Expression: ${instance.bindings[inputDef.name].expression}`}
                      >
                        ⚡ {String(value ?? '')}
                      </div>
                    ) : (
                      <span style={{
                        fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: source === 'override' ? '#0055aa' : '#555',
                      }}>
                        {String(value ?? '') || '—'}
                        {source === 'override' && (
                          <span title="Overridden on this instance" style={{ fontSize: 9, color: '#0055aa', marginLeft: 4 }}>●</span>
                        )}
                      </span>
                    )}
                    <button
                      className={`binding-icon-btn${isBound ? ' binding-icon-btn--active' : ''}`}
                      title={isBound ? `Edit binding: ${instance.bindings[inputDef.name].expression}` : 'Bind this input'}
                      style={{ flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        onOpenBindingPopover?.(inputDef.name, rect);
                      }}
                    >⚡</button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="details-section">
        <div className="details-grid">
          <span className="details-section-title">Outputs</span>
          {(query.outputs || []).length === 0 ? (
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#aaa', fontStyle: 'italic', padding: '4px 0' }}>
              This query has no outputs.
            </div>
          ) : query.outputs.map((outputDef, i) => (
            <React.Fragment key={`${outputDef.name}-${i}`}>
              <span className="details-grid-label">{outputDef.name}</span>
              <div className="details-grid-control">
                <span style={{ fontSize: 11, color: '#999' }}>
                  {outputDef.type}
                  {outputDef.outputGroup && outputDef.outputGroup !== 'default' ? ` · ${outputDef.outputGroup}` : ''}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

    </div>
  );
}
