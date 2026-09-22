// designer/widgets/WidgetOptionsEditor.jsx
// The Widgets area's main panel: every option the open widget could
// expose, grouped by the first part of its path. Tick one to expose it,
// and set the value a new widget starts with right on the row. Everything
// else a definition holds — label, type, choices, group, bindable — sits
// behind the row's ⋯, because the label and type derived from the option
// are usually right (a guessed type, badged `?`, is the case that isn't).
//
// Every row is the same shape, exposed or not — path, the label the
// details panel will show, type, and the control it's edited with, in
// columns that line up down the list. An option that isn't exposed shows
// the same label and control, greyed, holding the value the widget
// currently defaults to; the label is read-only either way, and changed
// under ⋯.
//
// An option the catalog doesn't know can be added by typing its path; see
// widgetOptionCatalog for where the list comes from and its gaps.
//
// Order and grouping: exposing adds to the end of the list and nothing
// else moves, so the list's order is what the details panel shows and a
// different order comes from the committed widgetProperties.js rather than
// from here. The details panel's headings are these same groups (the first
// part of each option's path — see optionNaming), and a group with nothing
// exposed doesn't appear there.

import { useMemo, useState } from 'react';
import { getWidgetOptionCatalog, hasConfigCatalog, defFromOption, isValidOptionPath, inferOptionType } from './widgetOptionCatalog';
import { exposeOption, hideOption, updateDef, setDefField, changeDefType, setDefChoices } from './widgetPropertyEdits';
import { WidgetPropertyField } from './WidgetPropertyField';
import { OptionAdvancedFields } from './OptionAdvancedFields';

const TYPE_BADGE_TITLES = {
  json: 'A list or object — edited as raw JSON, since there’s no form for one',
  data: 'The widget’s rows — set by binding a query or an asset property, not here',
  unknown: 'The configuration has no value to read a type from — pick one under ⋯',
};

export function WidgetOptionsEditor({ widgetName, defs, onChange, isCustomized, isDirty, onReset }) {
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');
  const [openAdvanced, setOpenAdvanced] = useState(null);

  const catalog = useMemo(() => getWidgetOptionCatalog(widgetName, defs), [widgetName, defs]);
  const exposedByName = useMemo(() => new Map(defs.map(d => [d.name, d])), [defs]);
  const q = filter.trim().toLowerCase();
  const shown = q ? catalog.filter(o => o.name.toLowerCase().includes(q)) : catalog;

  // Functional updates throughout: DevExtreme editors can report a change
  // from a handler captured a render ago, and applying that to a stale list
  // would undo the edit that just happened.
  const update = (name, fn) => onChange(list => updateDef(list, name, fn));
  const toggle = (option, on) => {
    if (on) onChange(list => exposeOption(list, defFromOption(option)));
    else {
      onChange(list => hideOption(list, option.name));
      setOpenAdvanced(current => (current === option.name ? null : current));
    }
  };

  const trimmedPath = newPath.trim();
  const pathProblem = !trimmedPath ? null
    : !isValidOptionPath(trimmedPath) ? 'Letters, digits and dots only — e.g. title.text'
    : exposedByName.has(trimmedPath) ? 'Already exposed'
    : null;
  const addPath = () => {
    if (!trimmedPath || pathProblem) return;
    const known = catalog.find(o => o.name === trimmedPath);
    const def = defFromOption(known || { name: trimmedPath, ...inferOptionType(trimmedPath, undefined) });
    onChange(list => exposeOption(list, def));
    setNewPath('');
    setFilter('');
    setOpenAdvanced(def.name);
  };

  let lastGroup = null;
  return (
    <div className="widgets-options">
      <div className="widgets-panel-head">
        <span className="widgets-panel-title">{widgetName}</span>
        <span className="widgets-panel-sub">
          {exposedByName.size} of {catalog.length} exposed{isDirty ? ' · unsaved' : ''}
        </span>
        <button className="focus-mode-btn" onClick={onReset} disabled={!isCustomized} title="Drop your changes to this widget and go back to the shipped list">
          Reset to shipped
        </button>
      </div>
      <input className="details-input widgets-filter" placeholder="Filter options… (e.g. title)" value={filter} onChange={e => setFilter(e.target.value)} />
      {!hasConfigCatalog(widgetName) && (
        <div className="widgets-note">
          There’s no configuration on file for {widgetName} yet, so only what it already exposes is listed. Add others by path below.
        </div>
      )}

      <div className="widgets-options-list">
        {shown.map(option => {
          const def = exposedByName.get(option.name);
          const rows = [];
          if (option.group !== lastGroup) {
            rows.push(<div className="widgets-options-group" key={`g-${option.group}`}>{option.group}</div>);
            lastGroup = option.group;
          }
          // An exposed option shows the type it's exposed as, which can
          // differ from what the configuration suggests (a string exposed
          // as an enum).
          const type = def ? def.type : option.type;
          const guessed = !def && option.guessed;
          const isOpen = openAdvanced === option.name;

          // Unexposed rows still draw a control, so the column lines up:
          // the definition this option WOULD get, disabled.
          const shownDef = def || defFromOption(option);

          rows.push(
            <div className={`widgets-option-row${def ? ' widgets-option-row--exposed' : ''}${isOpen ? ' widgets-option-row--open' : ''}`} key={option.name}>
              <label className="widgets-option" title={TYPE_BADGE_TITLES[type] || option.name}>
                <input type="checkbox" checked={!!def} onChange={e => toggle(option, e.target.checked)} />
                <code>{option.name}</code>
              </label>
              <span className="widgets-option-label" title={`Shown in the details panel as “${shownDef.label}” — change it under ⋯`}>
                {shownDef.label}
              </span>
              <span
                className={`widgets-type-badge widgets-type-badge--${type}${guessed ? ' widgets-type-badge--guessed' : ''}`}
                title={guessed ? 'Guessed from the name — the configuration has no value to read a type from' : `Edited as ${type}`}
              >
                {type === 'unknown' ? 'type?' : type}{guessed ? '?' : ''}
              </span>
              <div className="widgets-option-default" title={def ? 'The value a newly placed widget starts with' : 'Tick to expose this option and set its value'}>
                <WidgetPropertyField
                  def={shownDef}
                  value={shownDef.default}
                  disabled={!def}
                  onChange={v => update(option.name, d => ({ ...d, default: v }))}
                />
              </div>
              {def ? (
                <button
                  className={`widgets-more${isOpen ? ' widgets-more--open' : ''}`}
                  title={isOpen ? 'Hide label, type and binding' : 'Label, type, group, binding'}
                  onClick={() => setOpenAdvanced(isOpen ? null : option.name)}
                >⋯</button>
              ) : <span className="widgets-more-spacer" />}
            </div>
          );

          if (def && isOpen) {
            rows.push(
              <OptionAdvancedFields
                key={`${option.name}-advanced`}
                def={def}
                onUpdate={fn => update(def.name, fn)}
                onSetType={type2 => { if (type2 !== def.type) update(def.name, d => changeDefType(d, type2)); }}
                onSetField={(key, value) => update(def.name, d => setDefField(d, key, value))}
                onSetChoices={options => update(def.name, d => setDefChoices(d, options))}
                onHide={() => toggle(option, false)}
              />
            );
          }
          return rows;
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
      <div className="widgets-footnote">
        The details panel shows ticked options under these same group headings, in the order they were added; a group with nothing ticked doesn’t appear at all. Unticking one stops the designer showing it; values already set on existing screens stay on those widgets.
      </div>
    </div>
  );
}
