// designer/screens/ObjectDropPopover.jsx
// What happens when an object (from the Data tab's Objects mode) is dropped
// on a widget: a popover lists the queries related to the object's type —
// inputs that take its key, and services on its Thing — ranked by
// rankDropOptions (fits the widget, reads rather than changes, no inputs
// left to fill, used before). Ones that don't fit the widget stay in the
// list, marked, since a query that can return rows may be used for one value
// on purpose (e.g. a "worst N" query with N = 1 on a gauge). Services that
// change something sit in a collapsed "actions" group at the end.
//
// The popover never grows past the window: header, search and the
// Add & bind footer stay put while the list between them scrolls.
//
// Picking one adds an instance of the query to the page with the object's
// key in that input, and binds the widget's main property to it.
//
// Widgets report a drop through ObjectDropContext (objectDropContext.js).

import { useEffect, useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import notify from 'devextreme/ui/notify';
import { findContainerById } from '../../containerTree';
import { connectionLabel } from '../../connections/connectionKinds';
import { dropTargetOf, dropOptions, returnsRows, defaultOutputField, bindingFor, queryLabel, rankDropOptions } from '../objectTypes/objectTypes';
import '../objectTypes/objectTypes.css';

const POPOVER_WIDTH = 360;
const MAX_HEIGHT = 560;
const SEARCH_FROM = 8;   // show a search box once there are this many options

// A Thing's own services are all on the dropped object (named in the
// header), so they show by service name alone.
const optionLabel = (option) => (option.kind === 'thing' ? option.query.name : queryLabel(option.query));

function OptionRow({ ranked, chosen, connections, onChoose }) {
  const { option, fits, needs, usedBefore } = ranked;
  const connection = connections.find(c => c.id === option.connectionId);
  return (
    <div className={`od-option${chosen ? ' on' : ''}`} onClick={() => onChoose(option)}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="q">⚡ {optionLabel(option)} <span className="src">{connection ? connectionLabel(connection) : ''}</span></div>
        <div className="how">
          {option.how}
          {needs.length > 0 && <span className="od-needs"> · needs {needs.map(i => i.name).join(', ')}</span>}
          {usedBefore && <span className="od-used"> · used before</span>}
        </div>
      </div>
      <span className={`od-fit od-fit--${fits ? 'good' : 'other'}`}>
        {fits ? 'fits' : returnsRows(option.query) ? 'returns rows' : 'one value'}
      </span>
    </div>
  );
}

export function ObjectDropPopover({ drop, editor, objectTypes, connections, queries, onSaveQuery, onClose }) {
  const container = findContainerById(editor.containers, drop.containerId);
  const type = objectTypes.find(t => t.id === drop.object.typeId);
  const target = container ? dropTargetOf(container.widgetName) : null;
  const [state, setState] = useState({ status: 'loading', options: [], errors: [] });
  const [chosenId, setChosenId] = useState(null);
  const [outputField, setOutputField] = useState('');
  const [search, setSearch] = useState('');
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!type) return undefined;
    dropOptions(type, drop.object, { connections, queries })
      .then(({ options, errors }) => { if (!cancelled) setState({ status: 'ok', options, errors }); })
      .catch(err => { if (!cancelled) setState({ status: 'ok', options: [], errors: [err.message] }); });
    return () => { cancelled = true; };
    // Fetched once per drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  const term = search.trim().toLowerCase();
  const matches = (r) => !term || optionLabel(r.option).toLowerCase().includes(term);
  const { main, actions } = rankDropOptions(state.options, { wantsRows: target?.wantsRows, queries });
  const shownMain = main.filter(matches);
  const shownActions = actions.filter(matches);
  const all = [...main, ...actions];
  const chosenRanked = all.find(r => r.option.id === chosenId) || null;
  const chosen = chosenRanked?.option || null;

  const choose = (opt) => {
    setChosenId(opt.id);
    setOutputField(defaultOutputField(opt.query));
  };

  const apply = () => {
    const opt = chosen;
    const queryId = opt.kind === 'thing' ? onSaveQuery(opt.connectionId, opt.item) : opt.query.id;
    const queryInstanceId = editor.addQueryInstance({
      queryId,
      alias: `${opt.query.name} · ${drop.object.label}`,
      inputOverrides: opt.field ? [{ fieldName: opt.field, value: drop.object.key }] : [],
    });
    editor.setWidgetBinding(drop.containerId, target.propName, bindingFor({
      query: opt.query, queryId, queryInstanceId, wantsRows: target.wantsRows, outputField,
    }));
    notify(`Added ${opt.query.name} for ${drop.object.label} and bound ${target.label}`, 'success', 2500);
    onClose();
  };

  const maxHeight = Math.min(MAX_HEIGHT, window.innerHeight - 24);
  const left = Math.max(12, Math.min(drop.x + 8, window.innerWidth - POPOVER_WIDTH - 12));
  const top = Math.max(12, Math.min(drop.y + 8, window.innerHeight - maxHeight - 12));

  let message = null;
  if (!type) message = <div className="ot-error">This object's type no longer exists.</div>;
  else if (!target) message = <div className="ot-muted">This widget has no property a query can fill.</div>;
  else if (!editor.activePageId) message = <div className="ot-muted">Save this screen first — query instances need a real page to belong to.</div>;
  else if (state.status === 'loading') message = <div className="ot-muted">Finding related queries…</div>;
  else if (all.length === 0) message = <div className="ot-muted">No queries use {type.name || 'this type'} yet. Add them under Object Types → "Queries that use it".</div>;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1400 }} onClick={onClose} />
      <div
        className="binding-popover od-popover"
        style={{ position: 'fixed', left, top, zIndex: 1401, width: POPOVER_WIDTH, maxHeight }}
        onClick={e => e.stopPropagation()}
      >
        <div className="binding-popover-header">
          <span>Show <strong>{drop.object.label}</strong>{target && <> in <strong>{target.label}</strong></>}</span>
          <button onClick={onClose}>×</button>
        </div>

        {message ? (
          <div className="binding-popover-body">{message}{state.errors.map(e => <div key={e} className="ot-error">{e}</div>)}</div>
        ) : (
          <>
            {all.length >= SEARCH_FROM && (
              <div className="od-search">
                <input
                  className="details-input"
                  autoFocus
                  value={search}
                  placeholder={`Search ${all.length} queries…`}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            )}
            <div className="od-list">
              {shownMain.map(r => (
                <OptionRow key={r.option.id} ranked={r} chosen={r.option.id === chosenId} connections={connections} onChoose={choose} />
              ))}
              {shownMain.length === 0 && term && <div className="ot-muted" style={{ padding: '4px 2px 8px' }}>No matches.</div>}
              {shownActions.length > 0 && (
                <>
                  <div className="od-group" onClick={() => setShowActions(v => !v)}>
                    {showActions || term ? '▾' : '▸'} Actions ({shownActions.length})
                    <span className="ot-muted"> — services that change something or return nothing</span>
                  </div>
                  {(showActions || term) && shownActions.map(r => (
                    <OptionRow key={r.option.id} ranked={r} chosen={r.option.id === chosenId} connections={connections} onChoose={choose} />
                  ))}
                </>
              )}
              {state.errors.map(e => <div key={e} className="ot-error">{e}</div>)}
            </div>
            {chosen && (
              <div className="od-foot">
                {!target.wantsRows && (chosen.query.outputs || []).length > 1 ? (
                  <>
                    <span>Show</span>
                    <SelectBox
                      dataSource={(chosen.query.outputs || []).map(o => o.name)}
                      value={outputField}
                      onValueChanged={e => setOutputField(e.value)}
                      stylingMode="outlined" height={24} width={150}
                    />
                  </>
                ) : (
                  <span className="od-foot-note">
                    {target.wantsRows ? 'All columns' : `Shows ${outputField || 'its value'}`}
                    {!target.wantsRows && returnsRows(chosen.query) ? ' (last row)' : ''}
                    {chosenRanked.needs.length > 0 && <><br /><span className="od-needs">Then set {chosenRanked.needs.map(i => i.name).join(', ')} on Page Data</span></>}
                  </span>
                )}
                <button className="focus-mode-btn od-apply" onClick={apply}>Add &amp; bind</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
