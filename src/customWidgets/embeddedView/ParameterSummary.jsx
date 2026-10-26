// customWidgets/embeddedView/ParameterSummary.jsx
// The "Parameters" rows of an Embedded View's Source section, the same for
// every source: how many there are and how current, a Refresh, the ones that
// can't travel in a URL, and bindings to parameters the view no longer has
// (each with an Unbind, rather than a binding quietly doing nothing).
// The parameters themselves are ordinary properties further down the tab.
//
//   status       what to say beside the count (e.g. "up to date"), or null
//   statusError  true when status is a problem
//   extra        anything the source adds below the status (OpHub: the
//                hand-named list)
//   refresh      { onClick, busy, title }
//   note         the closing hint

import { PARAM_PREFIX, isUrlPassable } from './viewParameters';

export function ParameterSummary({ declared, bindings, viewNoun, onUnbind, status, statusError, extra, refresh, note }) {
  const names = new Set(declared.map(p => p.name));
  const orphaned = Object.keys(bindings || {})
    .filter(k => k.startsWith(PARAM_PREFIX) && !names.has(k.slice(PARAM_PREFIX.length)));
  const unpassable = declared.filter(p => !isUrlPassable(p));
  const passable = declared.length - unpassable.length;
  const one = unpassable.length === 1;

  return (<>
    <span className="details-grid-label">Parameters</span>
    <div className="details-grid-control" style={{ gap: 3 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: statusError ? '#b10e1c' : '#555' }}>
        {passable ? `${passable} below` : 'none'}{status ? ` · ${status}` : ''}
      </span>
      {refresh && (
        <button
          type="button"
          className="focus-mode-btn"
          style={{ flexShrink: 0 }}
          disabled={refresh.busy}
          title={refresh.title}
          onClick={refresh.onClick}
        >⟳ Refresh</button>
      )}
    </div>
    {extra}
    {unpassable.length > 0 && (
      <div className="ae-embed-note ae-embed-note--warn">
        {unpassable.map(p => p.name).join(', ')} {one ? 'is a table' : 'are tables'} — {one ? 'it' : 'they'} can’t be passed in a URL, so {one ? 'it isn’t' : 'they aren’t'} listed.
      </div>
    )}
    {orphaned.map(k => (
      <div key={k} className="ae-embed-orphan">
        <span><b>{k.slice(PARAM_PREFIX.length)}</b> is bound, but the {viewNoun} doesn’t have this parameter.</span>
        <button type="button" className="focus-mode-btn" onClick={() => onUnbind(k)}>Unbind</button>
      </div>
    ))}
    {note && <div className="ae-embed-note">{note}</div>}
  </>);
}
