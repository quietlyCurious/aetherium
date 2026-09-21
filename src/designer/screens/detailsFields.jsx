// designer/screens/detailsFields.jsx
// The small inputs the Screens details panel is built from. Each details
// view used to define its own copies inline; they live here once.
//
// textField and sharedTextField were the same helper copied twice, and the
// copies drifted:
//   textField        (one item selected)  number fields keep whole numbers
//                                          (parseInt); a missing value leaves
//                                          the input uncontrolled
//   sharedTextField  (several selected)   number fields keep decimals
//                                          (parseFloat); a missing value —
//                                          the items differ — shows blank
// Kept exactly as they were, so nothing changes here. The shared-field
// behaviour is probably right for both; unifying them is a separate,
// visible change (a 12.5 coordinate currently becomes 12 when typed into
// the single-item panel).

import { SelectBox } from 'devextreme-react';

const makeTextField = ({ parseNumber, blankWhenMissing }) => (val, placeholder, onChange, type = 'text') => (
  <input
    className="details-input"
    type={type}
    value={blankWhenMissing ? (val ?? '') : val}
    placeholder={placeholder}
    onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : (parseNumber(e.target.value) || 0)) : e.target.value)}
  />
);

export const textField = makeTextField({ parseNumber: parseInt, blankWhenMissing: false });
export const sharedTextField = makeTextField({ parseNumber: parseFloat, blankWhenMissing: true });

export const selectField = (dataSource, val, onChange) => (
  <SelectBox
    dataSource={dataSource}
    value={val}
    onValueChanged={(e) => onChange(e.value)}
    stylingMode="outlined"
    width="100%"
    height={24}
  />
);

const OVERFLOW_OPTIONS = [
  { v: 'auto',    l: 'Auto (if needed)' },
  { v: 'hidden',  l: 'Hidden / Clip' },
  { v: 'scroll',  l: 'Scroll (always)' },
  { v: 'visible', l: 'Visible ⚠' },
];

// Overflow X / Y. Unset reads as 'auto', the CSS default.
export const overflowField = (val, onChange) => (
  <SelectBox
    dataSource={OVERFLOW_OPTIONS}
    valueExpr="v"
    displayExpr="l"
    value={val || 'auto'}
    onValueChanged={(e) => onChange(e.value)}
    stylingMode="outlined"
    width="100%"
    height={24}
  />
);

export const OverflowWarning = ({ plural }) => (
  <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#8a5a00', background: '#fff8e6', border: '1px solid #f0c987', padding: '4px 8px', borderRadius: 4, margin: '2px 0' }}>
    ⚠ Visible overflow: content may render outside {plural ? "these containers'" : "this container's"} bounds.
  </div>
);
