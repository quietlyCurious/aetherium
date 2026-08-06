// InputBindingPopover.jsx
// Floating popover for binding a query instance's input to an expression.
// A real component (not an inline IIFE like the widget-property binding
// popover) specifically so it can hold its own local draft state for what's
// being TYPED, separate from what ultimately gets evaluated/saved.
//
// Why that separation matters: typing a bare word like `trend` isn't valid
// JS on its own (it's read as a reference to an undefined variable) — only a
// QUOTED string like `"trend"` evaluates. Since this field is meant to be
// "type a manual value," not "write JavaScript," bare text is automatically
// treated as a plain string behind the scenes. But if that correction were
// applied directly to the visible input while someone's still typing, the
// text would jump (and grow by two characters) under their cursor. Instead,
// the input always shows exactly what you typed; the quoting correction is
// applied only to what gets saved/evaluated, computed fresh each keystroke.

import React, { useState, useEffect } from 'react';
import { evaluateExpression } from './expressionEval';

export default function InputBindingPopover({ fieldName, binding, x, y, onSave, onClear, onClose }) {
  const [rawText, setRawText] = useState(binding?.expression ?? '');

  // Reset the draft when switching which input this popover is editing.
  useEffect(() => {
    setRawText(binding?.expression ?? '');
  }, [fieldName]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the raw text fails to evaluate on its own but WOULD succeed as a
  // plain quoted string, use that instead — bare values just work, real
  // expressions (numbers, math, already-quoted strings) still work as typed.
  const rawResult = evaluateExpression(rawText);
  const rawFails = rawResult === '#ERR';
  const quotedText = JSON.stringify(rawText);
  const quotedResult = rawFails ? evaluateExpression(quotedText) : undefined;
  const useQuotedFallback = rawFails && quotedResult !== '#ERR';

  const previewVal = useQuotedFallback ? quotedResult : rawResult;
  const isErr = previewVal === '#ERR';

  const popLeft = Math.max(8, x - 252);
  const popTop = Math.min(y, window.innerHeight - 210);

  const handleChange = (val) => {
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

  return (
    <>
      {/* zIndex kept below DevExtreme's own overlay baseline (~1500) — same
          fix applied to WidgetBindingPopover, for consistency. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1400 }} onClick={onClose} />
      <div
        className="binding-popover"
        style={{ position: 'fixed', left: popLeft, top: popTop, zIndex: 1401 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="binding-popover-header">
          <span>Bind: <strong>{fieldName}</strong></span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="binding-popover-body">
          <div className="binding-type-label">Value or Expression</div>
          <input
            className="details-input"
            autoFocus
            value={rawText}
            placeholder="e.g.  trend  ·  42.5  ·  100 * 0.8"
            onChange={(e) => handleChange(e.target.value)}
          />
          <div className={`binding-preview${isErr ? ' binding-preview-error' : ''}`}>
            {rawText
              ? <><span style={{ color: '#aaa', marginRight: 4 }}>→</span><strong>{String(previewVal ?? '')}</strong></>
              : <span style={{ color: '#bbb' }}>Type a value above to preview</span>
            }
          </div>
        </div>
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
