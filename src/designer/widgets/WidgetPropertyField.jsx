// designer/widgets/WidgetPropertyField.jsx
// How a widget's exposed properties are drawn in a details panel. Shared by
// the Screens details panel (ContainerDetails) and the Widgets area's
// preview, so the preview is the real thing rather than a picture of it.
//
//   WidgetPropertyField  the static input for one property, by type
//   WidgetPropertyGrid   the whole list: a titled details-grid, a heading
//                        per group, a label and a control per property —
//                        the caller draws each control (renderControl), so
//                        the Screens side can add its binding display and ⚡

import React from 'react';
import { SelectBox } from 'devextreme-react';
import { groupWidgetPropertyDefs } from './widgetPropertyDefs';
import './widgetPropertyField.css';

const BOOL_ITEMS = [{ v: true, l: 'true' }, { v: false, l: 'false' }];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function WidgetPropertyField({ def, value, onChange }) {
  const current = value ?? def.default;
  // DevExtreme raises onValueChanged when the value PROP changes too, not
  // just when the user picks something; passing that back would write a
  // value nobody chose (and, from a stale handler, can undo other edits).
  const picked = (e) => { if (e.value !== current) onChange(e.value); };
  switch (def.type) {
    case 'bool':
      return <SelectBox dataSource={BOOL_ITEMS} displayExpr="l" valueExpr="v" value={current} onValueChanged={picked} stylingMode="outlined" width="100%" height={24} />;
    case 'enum':
      return <SelectBox dataSource={def.options || []} value={current} onValueChanged={picked} stylingMode="outlined" width="100%" height={24} />;
    case 'number':
      return <input className="details-input" style={{ width: '100%' }} type="number" value={current ?? ''} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />;
    case 'color':
      return (
        <div style={{ display: 'flex', gap: 3, width: '100%', minWidth: 0 }}>
          <input
            type="color"
            className="widget-prop-color-swatch"
            value={HEX_COLOR.test(current || '') ? current : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            title="Pick a colour"
          />
          <input className="details-input" style={{ flex: 1, minWidth: 0 }} value={current ?? ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'data':
      return (
        <span style={{ fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>
          Bind to set — no static value for a collection
        </span>
      );
    default:
      return <input className="details-input" style={{ width: '100%' }} value={current ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function WidgetPropertyGrid({ title, defs, renderControl }) {
  return (
    <div className="details-grid">
      <span className="details-section-title">{title}</span>
      {groupWidgetPropertyDefs(defs).map(({ group, defs: groupDefs }) => (
        <React.Fragment key={group || '(none)'}>
          {group && <span className="details-section-title widget-prop-group-title">{group}</span>}
          {groupDefs.map(def => (
            <React.Fragment key={def.name}>
              <span className="details-grid-label" title={def.label}>{def.label}</span>
              <div className="details-grid-control">{renderControl(def)}</div>
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
