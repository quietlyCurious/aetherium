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
// What's exposed is pinned to the top, in the order the details panel will
// show it. Everything else sits under its group, closed — a widget can have
// several hundred options (a Chart has around 870), and neither a flat list
// of those nor a group opened to 117 rows is much use. A group opens while
// a filter is running, or when clicked.
//
// Order and grouping: exposing adds to the end of the list and nothing
// else moves, so the list's order is what the details panel shows and a
// different order comes from the committed widgetProperties.js rather than
// from here. The details panel's headings are these same groups (the first
// part of each option's path — see optionNaming), and a group with nothing
// exposed doesn't appear there.

import { Fragment, useMemo, useState } from 'react';
import { useWidgetOptions } from './widgetOptionsFile';
import { getWidgetOptionCatalog, hasConfigCatalog, defFromOption, isValidOptionPath, inferOptionType } from './widgetOptionCatalog';
import { exposeOption, hideOption, updateDef, setDefField, changeDefType, setDefChoices } from './widgetPropertyEdits';
import { WidgetPropertyField } from './WidgetPropertyField';
import { OptionAdvancedFields } from './OptionAdvancedFields';

// The pinned first section — not a real group, so it can't collide with a
// DevExtreme option path.
const EXPOSED_GROUP = 'Exposed';

const TYPE_BADGE_TITLES = {
  json: 'A list or object — edited as raw JSON, since there’s no form for one',
  data: 'The widget’s rows — set by binding a query or an asset property, not here',
  unknown: 'The configuration has no value to read a type from — pick one under ⋯',
};

export function WidgetOptionsEditor({ widgetName, defs, onChange, isCustomized, isDirty, onReset }) {
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');
  const [openAdvanced, setOpenAdvanced] = useState(null);
  const [groupChoices, setGroupChoices] = useState({});

  const optionsFile = useWidgetOptions();
  const catalog = useMemo(
    () => getWidgetOptionCatalog(widgetName, defs, optionsFile.widgets),
    [widgetName, defs, optionsFile.widgets],
  );
  const exposedByName = useMemo(() => new Map(defs.map(d => [d.name, d])), [defs]);
  const q = filter.trim().toLowerCase();
  const shown = q ? catalog.filter(o => o.name.toLowerCase().includes(q)) : catalog;

  // One entry per group, in catalog order, with what the header needs. The
  // first is always what's exposed, in definition order — the order the
  // details panel shows them in — so it reads as the widget's own list
  // rather than something to hunt for.
  const groups = useMemo(() => {
    const byName = new Map();
    const catalogByName = new Map(catalog.map(o => [o.name, o]));
    const matches = option => !q || option.name.toLowerCase().includes(q);

    const exposedOptions = defs
      .map(def => catalogByName.get(def.name) || { name: def.name, type: def.type, group: 'Exposed', source: 'exposed' })
      .filter(matches);
    if (exposedOptions.length) {
      byName.set(EXPOSED_GROUP, { name: EXPOSED_GROUP, options: exposedOptions, exposed: exposedOptions.length, pinned: true });
    }

    shown.forEach(option => {
      if (!byName.has(option.group)) byName.set(option.group, { name: option.group, options: [], exposed: 0 });
      const group = byName.get(option.group);
      group.options.push(option);
      if (exposedByName.has(option.name)) group.exposed += 1;
    });
    return [...byName.values()];
  }, [catalog, shown, defs, exposedByName, q]);

  const isOpenGroup = (group) => groupChoices[group.name] ?? (group.pinned || !!q);
  const toggleGroup = (group) => setGroupChoices(choices => ({ ...choices, [group.name]: !isOpenGroup(group) }));

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

  // One option: the tick and its path, the label the details panel will
  // use, its type, the control it's edited with (disabled until it's
  // exposed, showing what the widget defaults to), and the ⋯.
  const renderOption = (option, groupName) => {
    const def = exposedByName.get(option.name);
    // An exposed option shows the type it's exposed as, which can differ
    // from what the catalog suggests (a string exposed as an enum).
    const type = def ? def.type : option.type;
    const guessed = !def && option.guessed;
    const isOpen = openAdvanced === option.name;
    // Unexposed rows still draw a control, so the column lines up: the
    // definition this option WOULD get, disabled.
    const shownDef = def || defFromOption(option);

    return (
      <Fragment key={`${groupName}:${option.name}`}>
        <div className={`widgets-option-row${def ? ' widgets-option-row--exposed' : ''}${isOpen ? ' widgets-option-row--open' : ''}`}>
          <label className="widgets-option" title={TYPE_BADGE_TITLES[type] || option.name}>
            <input type="checkbox" checked={!!def} onChange={e => toggle(option, e.target.checked)} />
            <code>{option.name}</code>
          </label>
          <span className="widgets-option-label" title={`Shown in the details panel as “${shownDef.label}” — change it under ⋯`}>
            {shownDef.label}
          </span>
          <span
            className={`widgets-type-badge widgets-type-badge--${type}${guessed ? ' widgets-type-badge--guessed' : ''}`}
            title={guessed ? 'Guessed from the name — the fallback list has no value to read a type from' : `Edited as ${type}`}
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
        {def && isOpen && (
          <OptionAdvancedFields
            def={def}
            onUpdate={fn => update(def.name, fn)}
            onSetType={next => { if (next !== def.type) update(def.name, d => changeDefType(d, next)); }}
            onSetField={(key, value) => update(def.name, d => setDefField(d, key, value))}
            onSetChoices={options => update(def.name, d => setDefChoices(d, options))}
            onHide={() => toggle(option, false)}
          />
        )}
      </Fragment>
    );
  };

  return (
    <div className="widgets-options">
      <div className="widgets-panel-head">
        <span className="widgets-panel-title">{widgetName}</span>
        <span className="widgets-panel-sub" title={optionsFile.meta ? `Options generated from DevExtreme ${optionsFile.meta.devextremeVersion} on ${optionsFile.meta.generatedAt}` : undefined}>
          {exposedByName.size} of {catalog.length} exposed{isDirty ? ' · unsaved' : ''}
        </span>
        <button className="focus-mode-btn" onClick={onReset} disabled={!isCustomized} title="Drop your changes to this widget and go back to the shipped list">
          Reset to shipped
        </button>
      </div>
      <input className="details-input widgets-filter" placeholder="Filter options… (e.g. title)" value={filter} onChange={e => setFilter(e.target.value)} />
      {optionsFile.status === 'loading' && <div className="widgets-note">Loading the option list…</div>}
      {optionsFile.status === 'failed' && (
        <div className="widgets-note widgets-note--warn">
          Couldn’t load <code>data/widget-options.json</code>, so this is the older, thinner list read from the app’s own widget configuration
          {hasConfigCatalog(widgetName) ? '' : `, which has nothing for ${widgetName}`}. Everything still works — types may be guessed, and
          anything missing can be added by path below.
        </div>
      )}

      <div className="widgets-options-list">
        {groups.map(group => {
          const open = isOpenGroup(group);
          return (
            <div className={`widgets-group${group.pinned ? ' widgets-group--pinned' : ''}`} key={group.name}>
              <button
                className={`widgets-options-group${open ? ' widgets-options-group--open' : ''}`}
                onClick={() => toggleGroup(group)}
                title={group.pinned
                  ? 'What this widget exposes, in the order the details panel shows it'
                  : (open ? `Hide ${group.name}` : `Show ${group.options.length} ${group.name} options`)}
              >
                <span className="widgets-group-caret">{open ? '▾' : '▸'}</span>
                <span className="widgets-group-name">{group.name}</span>
                <span className="widgets-group-count">
                  {!group.pinned && group.exposed > 0 && <span className="widgets-group-exposed">{group.exposed} exposed</span>}
                  {group.options.length}
                </span>
              </button>
              {open && group.options.map(option => renderOption(option, group.name))}
            </div>
          );
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
