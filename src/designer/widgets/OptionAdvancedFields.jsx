// designer/widgets/OptionAdvancedFields.jsx
// The settings behind an exposed option's ⋯ in the options list: what the
// details panel calls it, how it's edited, and whether it can be bound.
// Out of the row by default because the derived label and type are usually
// right — a guessed type (the `?` badge) is the case that isn't.

import { WIDGET_PROPERTY_TYPES } from './widgetPropertyDefs';
import { ChoicesField } from './ChoicesField';
import { JsonField } from './JsonField';

export function OptionAdvancedFields({ def, onUpdate, onSetType, onSetField, onSetChoices, onHide }) {
  return (
    <div className="widgets-advanced">
      <label className="widgets-advanced-field">
        <span>Label</span>
        <input className="details-input" value={def.label} onChange={e => onUpdate(d => ({ ...d, label: e.target.value }))} />
      </label>
      <label className="widgets-advanced-field">
        <span>Type</span>
        <select className="details-input" value={def.type} onChange={e => onSetType(e.target.value)}>
          {WIDGET_PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      {def.type === 'json' && (
        <label className="widgets-advanced-field widgets-advanced-field--json">
          <span>Default</span>
          <JsonField value={def.default} rows={5} onChange={v => onUpdate(d => (v === undefined ? (({ default: _drop, ...rest }) => rest)(d) : { ...d, default: v }))} />
        </label>
      )}
      {def.type === 'enum' && (
        <label className="widgets-advanced-field widgets-advanced-field--wide">
          <span>Choices</span>
          <ChoicesField options={def.options || []} onCommit={onSetChoices} />
        </label>
      )}
      <label className="widgets-advanced-field">
        <span>Group</span>
        <input className="details-input" placeholder="none" value={def.group || ''} onChange={e => onSetField('group', e.target.value)} />
      </label>
      <label className="widgets-advanced-field widgets-advanced-field--check">
        <input
          type="checkbox"
          checked={def.bindable !== false}
          disabled={def.type === 'data'}
          onChange={e => onSetField('bindable', e.target.checked ? undefined : false)}
        />
        <span>{def.type === 'data' ? 'Bindable — a collection can only be bound' : 'Can be bound (⚡)'}</span>
      </label>
      <button className="focus-mode-btn widgets-advanced-hide" onClick={onHide}>Stop exposing</button>
    </div>
  );
}
