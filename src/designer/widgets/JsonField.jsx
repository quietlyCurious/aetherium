// designer/widgets/JsonField.jsx
// The editor for a 'json' property — an option whose value is a list or an
// object (a grid's `columns`, a gauge's `rangeContainer.ranges`, a chart's
// `series`). There's no form for those, so this is the raw JSON, checked
// as it's typed and committed only when it parses. Bad JSON stays in the
// box, marked, rather than being written to the widget.
//
// `rows` makes it a textarea (the ⋯ block); one row is a single line (an
// options row).

import { useState } from 'react';

export function stringifyJson(value, pretty) {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0) ?? '';
  } catch {
    return '';
  }
}

export function JsonField({ value, onChange, rows = 1, disabled }) {
  const committed = stringifyJson(value, rows > 1);
  const [text, setText] = useState(committed);
  const [seen, setSeen] = useState(committed);
  // Re-seed when the value changes from outside (another editor, a type
  // change), but never while the user is mid-edit on their own text.
  if (seen !== committed) { setSeen(committed); setText(committed); }

  const trimmed = text.trim();
  let error = null;
  if (trimmed) {
    try { JSON.parse(trimmed); } catch (e) { error = e.message; }
  }

  const commit = () => {
    if (error) return;
    if (!trimmed) { onChange(undefined); return; }
    const parsed = JSON.parse(trimmed);
    if (stringifyJson(parsed, rows > 1) !== committed) onChange(parsed);
  };

  const shared = {
    className: `details-input widgets-json${error ? ' widgets-json--error' : ''}`,
    value: text,
    disabled,
    spellCheck: false,
    title: error ? `Not valid JSON: ${error}` : 'JSON — e.g. [{ "dataField": "name" }]',
    placeholder: rows > 1 ? '[\n  { "dataField": "name" }\n]' : '[{ "dataField": "name" }]',
    onChange: (e) => setText(e.target.value),
    onBlur: commit,
  };

  return rows > 1
    ? <textarea {...shared} rows={rows} />
    : <input {...shared} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />;
}
