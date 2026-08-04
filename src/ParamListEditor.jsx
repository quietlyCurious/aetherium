// ParamListEditor.jsx
// Shared editable list-of-rows control for Query/Script input & output parameter
// definitions. Generic by design — the caller supplies which columns to render,
// each column's control type, and a factory for blank rows. Reused as-is by the
// (Phase 3) Scripts workspace, which has the same input/output shape.

import React from 'react';
import { SelectBox } from 'devextreme-react/select-box';

function resolveOptions(options, row, items) {
  if (typeof options === 'function') return options(row, items);
  return options || [];
}

function FieldControl({ field, row, items, onChangeField }) {
  const value = row[field.key];

  if (field.type === 'select') {
    const opts = resolveOptions(field.options, row, items);
    return (
      <SelectBox
        dataSource={opts}
        valueExpr="value"
        displayExpr="label"
        value={value ?? null}
        placeholder={field.placeholder || ''}
        onValueChanged={e => onChangeField(field.key, e.value)}
        stylingMode="outlined"
        width="100%"
        height={24}
      />
    );
  }

  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={e => onChangeField(field.key, e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    );
  }

  if (field.type === 'readonly') {
    return <span style={{ fontSize: 11, color: '#888' }}>{value ?? ''}</span>;
  }

  // text (default)
  return (
    <input
      className="details-input"
      value={value ?? ''}
      placeholder={field.placeholder || ''}
      onChange={e => onChangeField(field.key, e.target.value)}
      style={{ fontSize: 11, height: 24 }}
    />
  );
}

export default function ParamListEditor({
  items = [],
  onChange,
  fields,               // [{ key, label, type:'text'|'select'|'checkbox'|'readonly', options, placeholder, width }]
  addLabel = '+ Add',
  emptyText = 'None defined.',
  newItemFactory,       // () => freshRowObject
}) {
  const handleAdd = () => onChange([...items, newItemFactory()]);
  const handleRemove = (index) => onChange(items.filter((_, i) => i !== index));
  const handleFieldChange = (index, key, value) =>
    onChange(items.map((it, i) => (i === index ? { ...it, [key]: value } : it)));

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 26px 4px 0' }}>
          {fields.map(f => (
            <div
              key={f.key}
              style={{
                flex: f.width || 1, minWidth: 0,
                fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              {f.label}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: '#aaa', fontStyle: 'italic', padding: '4px 0' }}>
          {emptyText}
        </div>
      ) : (
        items.map((row, index) => (
          <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0' }}>
            {fields.map(f => (
              <div key={f.key} style={{ flex: f.width || 1, minWidth: 0 }}>
                <FieldControl
                  field={f}
                  row={row}
                  items={items}
                  onChangeField={(key, value) => handleFieldChange(index, key, value)}
                />
              </div>
            ))}
            <button
              onClick={() => handleRemove(index)}
              title="Remove"
              style={{
                flexShrink: 0, width: 20, height: 20, border: '1px solid #e0b0b0',
                borderRadius: 4, background: '#fff5f5', color: '#c0392b', cursor: 'pointer',
                fontSize: 12, lineHeight: 1, padding: 0,
              }}
            >×</button>
          </div>
        ))
      )}

      <button className="focus-mode-btn" style={{ marginTop: 6, fontSize: 11 }} onClick={handleAdd}>
        {addLabel}
      </button>
    </div>
  );
}
