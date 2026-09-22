// designer/widgets/ExposedPropertiesEditor.jsx
// "Exposed in the designer": the open widget's property list, one row per
// property, in the order the details panel shows them. Everything a
// definition holds is edited here — label, type, choices (enum), default,
// group, whether it can be bound — and rows are reordered by dragging the
// grip. The Default column uses WidgetPropertyField, the same input the
// details panel will show for it.

import { Fragment, useState } from 'react';
import { SelectBox } from 'devextreme-react';
import { WIDGET_PROPERTY_TYPES } from './widgetPropertyDefs';
import { WidgetPropertyField } from './WidgetPropertyField';

// A default that still makes sense after the type changes.
export function coerceDefault(value, type, options) {
  switch (type) {
    case 'bool': return value === true || value === 'true';
    case 'number': { const n = typeof value === 'number' ? value : parseFloat(value); return Number.isFinite(n) ? n : 0; }
    case 'string':
    case 'color': return value == null || typeof value === 'object' ? '' : String(value);
    case 'enum': return options?.includes(value) ? value : options?.[0];
    case 'data': return Array.isArray(value) ? value : [];
    default: return value;
  }
}

export function changeDefType(def, type) {
  const next = { ...def, type };
  if (type === 'enum') {
    next.options = def.options?.length ? def.options : (typeof def.default === 'string' && def.default ? [def.default] : []);
  } else {
    delete next.options;
  }
  const value = coerceDefault(def.default, type, next.options);
  if (value === undefined) delete next.default; else next.default = value;
  return next;
}

function parseChoices(text) {
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

export function ExposedPropertiesEditor({ widgetName, defs, onChange, isCustomized, isDirty, onReset }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const groups = [...new Set(defs.map(d => d.group).filter(Boolean))];

  // Functional updates throughout: DevExtreme editors can report a change
  // from a handler captured a render ago, and applying that to a stale
  // list would undo the edit that just happened.
  const update = (name, fn) => onChange(list => list.map(d => (d.name === name ? fn(d) : d)));
  const setField = (name, key, value) => update(name, d => {
    const next = { ...d };
    if (value === undefined || value === '') delete next[key]; else next[key] = value;
    return next;
  });
  const remove = (name) => onChange(list => list.filter(d => d.name !== name));
  const move = (from, to) => {
    if (from == null || to == null || from === to) return;
    onChange(list => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <div className="widgets-exposed">
      <div className="widgets-panel-head">
        <span className="widgets-panel-title">Exposed in the designer</span>
        <span className="widgets-panel-sub">{defs.length} {defs.length === 1 ? 'property' : 'properties'}{isDirty ? ' · unsaved' : ''}</span>
        <button className="focus-mode-btn" onClick={onReset} disabled={!isCustomized} title="Drop your changes to this widget and go back to the shipped list">
          Reset to shipped
        </button>
      </div>
      <div className="widgets-exposed-scroll">
        <table className="widgets-exposed-table">
          <thead>
            <tr>
              <th aria-label="Reorder" />
              <th>Label</th>
              <th>Option</th>
              <th>Type</th>
              <th>Default</th>
              <th>Group</th>
              <th title="Can be bound (⚡)">⚡</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {defs.map((def, i) => (
              <Fragment key={def.name}>
                <tr
                  className={dropIndex === i && dragIndex !== i ? 'widgets-exposed-drop' : undefined}
                  onDragOver={e => { if (dragIndex != null) { e.preventDefault(); setDropIndex(i); } }}
                  onDrop={e => { e.preventDefault(); move(dragIndex, i); setDragIndex(null); setDropIndex(null); }}
                >
                  <td className="widgets-grip-cell">
                    <span
                      className="widgets-grip"
                      draggable
                      title="Drag to reorder"
                      onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', def.name); }}
                      onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                    >⋮⋮</span>
                  </td>
                  <td><input className="details-input" value={def.label} onChange={e => update(def.name, d => ({ ...d, label: e.target.value }))} /></td>
                  <td className="widgets-option-name"><code title={def.name}>{def.name}</code></td>
                  <td className="widgets-type-cell">
                    <SelectBox
                      items={WIDGET_PROPERTY_TYPES}
                      value={def.type}
                      onValueChanged={e => { if (e.value !== def.type) update(def.name, d => changeDefType(d, e.value)); }}
                      stylingMode="outlined" height={24} width="100%"
                    />
                  </td>
                  <td className="widgets-default-cell">
                    <WidgetPropertyField def={def} value={def.default} onChange={v => update(def.name, d => ({ ...d, default: v }))} />
                  </td>
                  <td>
                    <input className="details-input" list={`widgets-groups-${widgetName}`} placeholder="—" value={def.group || ''} onChange={e => setField(def.name, 'group', e.target.value)} />
                  </td>
                  <td className="widgets-center">
                    <input type="checkbox" checked={def.bindable !== false} disabled={def.type === 'data'}
                      title={def.type === 'data' ? 'A collection can only be set by binding' : 'Can be bound (⚡)'}
                      onChange={e => setField(def.name, 'bindable', e.target.checked ? undefined : false)} />
                  </td>
                  <td className="widgets-center">
                    <button className="widgets-remove" title="Stop exposing this property" onClick={() => remove(def.name)}>×</button>
                  </td>
                </tr>
                {def.type === 'enum' && (
                  <tr className="widgets-choices-row">
                    <td />
                    <td colSpan={7}>
                      <label className="widgets-choices">
                        <span>Choices</span>
                        <ChoicesInput
                          options={def.options || []}
                          onCommit={options => update(def.name, d => ({ ...d, options, default: coerceDefault(d.default, 'enum', options) }))}
                        />
                      </label>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {defs.length === 0 && <div className="widgets-note">Nothing exposed — tick options on the left, or add one by path.</div>}
        <datalist id={`widgets-groups-${widgetName}`}>
          {groups.map(g => <option key={g} value={g} />)}
        </datalist>
      </div>
      <div className="widgets-footnote">
        Properties with no group come first, under no heading. Removing a property here stops the designer showing it; values already set on existing screens stay on those widgets.
      </div>
    </div>
  );
}

// Comma-separated choices, committed on blur/Enter so typing "a, " doesn't
// drop the trailing entry mid-edit.
function ChoicesInput({ options, onCommit }) {
  const joined = options.join(', ');
  const [text, setText] = useState(joined);
  const [seen, setSeen] = useState(joined);
  if (seen !== joined) { setSeen(joined); setText(joined); }
  const commit = () => {
    const next = parseChoices(text);
    if (next.join(', ') !== joined) onCommit(next);
    else setText(joined);
  };
  return (
    <input
      className="details-input"
      placeholder="e.g. inside, outside, center"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
    />
  );
}
