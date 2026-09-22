// designer/widgets/WidgetOptionsPanel.jsx
// "Available options": everything the open widget could expose, grouped by
// the first part of its path, each with a checkbox — ticked means exposed.
// Ticking adds a definition with a sensible label, type and default
// (defFromOption); unticking removes it. An option missing from the list
// can be added by typing its path. See widgetOptionCatalog for where the
// list comes from and its gaps.

import { useMemo, useState } from 'react';
import { getWidgetOptionCatalog, hasConfigCatalog, canExpose, defFromOption, isValidOptionPath, inferOptionType } from './widgetOptionCatalog';

const TYPE_BADGE_TITLES = {
  complex: 'A list or object — needs its own editor, can’t be exposed yet',
  unknown: 'The configuration has no value to read a type from — pick one after exposing it',
};

export function WidgetOptionsPanel({ widgetName, defs, onChange }) {
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');

  const catalog = useMemo(() => getWidgetOptionCatalog(widgetName, defs), [widgetName, defs]);
  const exposedByName = useMemo(() => new Map(defs.map(d => [d.name, d])), [defs]);
  const exposed = useMemo(() => new Set(exposedByName.keys()), [exposedByName]);
  const q = filter.trim().toLowerCase();
  const shown = q ? catalog.filter(o => o.name.toLowerCase().includes(q)) : catalog;

  const toggle = (option, on) => {
    if (on) onChange(list => [...list, defFromOption(option)]);
    else onChange(list => list.filter(d => d.name !== option.name));
  };

  const trimmedPath = newPath.trim();
  const pathProblem = !trimmedPath ? null
    : !isValidOptionPath(trimmedPath) ? 'Letters, digits and dots only — e.g. title.text'
    : exposed.has(trimmedPath) ? 'Already exposed'
    : null;
  const addPath = () => {
    if (!trimmedPath || pathProblem) return;
    const known = catalog.find(o => o.name === trimmedPath);
    const def = defFromOption(known || { name: trimmedPath, ...inferOptionType(trimmedPath, undefined) });
    onChange(list => [...list, def]);
    setNewPath('');
  };

  let lastGroup = null;
  return (
    <div className="widgets-options">
      <div className="widgets-panel-head">
        <span className="widgets-panel-title">Available options</span>
        <span className="widgets-panel-sub">{exposed.size} of {catalog.length} exposed</span>
      </div>
      <input className="details-input widgets-filter" placeholder="Filter options… (e.g. title)" value={filter} onChange={e => setFilter(e.target.value)} />
      {!hasConfigCatalog(widgetName) && (
        <div className="widgets-note">
          There’s no configuration on file for {widgetName} yet, so only what it already exposes is listed. Add others by path below.
        </div>
      )}
      <div className="widgets-options-list">
        {shown.map(option => {
          const header = option.group !== lastGroup ? <div className="widgets-options-group" key={`g-${option.group}`}>{option.group}</div> : null;
          lastGroup = option.group;
          const disabled = !canExpose(option);
          // An exposed option shows the type it's exposed as, which may
          // differ from what the configuration suggests (a string exposed as
          // an enum).
          const exposedDef = exposedByName.get(option.name);
          const type = exposedDef ? exposedDef.type : option.type;
          const guessed = !exposedDef && option.guessed;
          const badge = type === 'unknown' ? 'type?' : type;
          return [
            header,
            <label key={option.name} className={`widgets-option${disabled ? ' widgets-option--disabled' : ''}`} title={TYPE_BADGE_TITLES[type] || option.name}>
              <input type="checkbox" checked={exposed.has(option.name)} disabled={disabled && !exposed.has(option.name)} onChange={e => toggle(option, e.target.checked)} />
              <code>{option.name}</code>
              <span className={`widgets-type-badge widgets-type-badge--${type}${guessed ? ' widgets-type-badge--guessed' : ''}`}
                title={guessed ? 'Guessed from the name — the configuration has no value to read a type from' : undefined}>
                {badge}{guessed ? '?' : ''}
              </span>
            </label>,
          ];
        })}
        {shown.length === 0 && <div className="widgets-note">No options match “{filter}”.</div>}
      </div>
      <div className="widgets-add-path">
        <input
          className="details-input"
          placeholder="Add an option by path…"
          value={newPath}
          onChange={e => setNewPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addPath(); }}
        />
        <button className="focus-mode-btn" onClick={addPath} disabled={!trimmedPath || !!pathProblem}>Add</button>
      </div>
      {pathProblem && <div className="widgets-path-problem">{pathProblem}</div>}
    </div>
  );
}
