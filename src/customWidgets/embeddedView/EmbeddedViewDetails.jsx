// customWidgets/embeddedView/EmbeddedViewDetails.jsx
// The Embedded View's "Source" section, drawn at the top of its widget tab
// in the details panel: which mashup, wrapped in which Master (optional),
// and its parameters, kept in step with ThingWorx.
//
// The parameters themselves appear further down as ordinary widget
// properties (customWidgets.js → dynamicPropertyDefs), so they get the same
// static field and ⚡ binding as everything else. This section only keeps the
// list of them current:
//   - picking or pasting a mashup reads its parameters
//   - opening the widget's details re-reads them, since the mashup may have
//     been edited in Composer since (no cached shape is trusted)
//   - Refresh re-reads them and reloads the frame
// A bound parameter that's no longer on the mashup is listed with an Unbind,
// rather than its binding quietly doing nothing.

import { useEffect, useRef, useState } from 'react';
import {
  PARAM_PREFIX, fetchMashupParameters, isUrlPassable, paramPropName, parseRuntimeUrl,
  sameParameters, searchMashupsAndMasters,
} from './thingworxEmbed';

// Masters found by any search this session, offered in the Master field.
const knownMasters = new Set();

export function EmbeddedViewDetails({ container, editor }) {
  const id = container.id;
  const props = container.widgetProps || {};
  const bindings = container.bindings || {};
  const mashupName = props.mashupName || '';
  const master = props.master || '';
  const declared = Array.isArray(props.mashupParameters) ? props.mashupParameters : [];
  const set = (changes) => editor.updateWidgetProps(id, changes);

  const [searching, setSearching] = useState(!mashupName);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);       // null → not searched yet
  const [searchBusy, setSearchBusy] = useState(false);
  const [paramStatus, setParamStatus] = useState({ busy: false, error: null, checkedAt: null });
  const [pasteNote, setPasteNote] = useState(null);

  // Re-read parameters for `name`; write them only when they changed, so
  // opening a widget doesn't mark the page as edited for nothing.
  const latest = useRef({ declared, id });
  latest.current = { declared, id };
  const readParameters = async (name) => {
    if (!name) return;
    setParamStatus({ busy: true, error: null, checkedAt: null });
    try {
      const found = await fetchMashupParameters(name);
      if (latest.current.id !== id) return;   // the selection moved on
      if (!sameParameters(found, latest.current.declared)) set({ mashupParameters: found });
      setParamStatus({ busy: false, error: null, checkedAt: new Date() });
    } catch (err) {
      setParamStatus({
        busy: false,
        error: err.status === 404 ? `ThingWorx has no mashup called “${name}” (or the app key’s user can’t see it).` : err.message,
        checkedAt: null,
      });
    }
  };

  // Opening this widget's details: check ThingWorx for changes.
  useEffect(() => {
    if (mashupName) readParameters(mashupName);
    // Once per widget and mashup, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mashupName]);

  const runSearch = async () => {
    setSearchBusy(true);
    try {
      const found = await searchMashupsAndMasters(term);
      found.filter(r => r.kind === 'master').forEach(r => knownMasters.add(r.name));
      setResults(found);
    } catch {
      setResults([]);
    } finally {
      setSearchBusy(false);
    }
  };

  const pick = (result) => {
    if (result.kind === 'master') { set({ master: result.name }); return; }
    setSearching(false);
    setResults(null);
    setTerm('');
    if (result.name !== mashupName) set({ mashupName: result.name, mashupParameters: [] });
  };

  // A pasted runtime URL brings the mashup, its Master, and any parameter
  // values it carried (as static values — bound parameters are left alone).
  const paste = (text) => {
    if (!text.trim()) return;
    const parsed = parseRuntimeUrl(text);
    if (!parsed) { setPasteNote('That doesn’t look like a ThingWorx runtime URL with a mashup in it.'); return; }
    const values = {};
    Object.entries(parsed.params).forEach(([k, v]) => { if (!bindings[paramPropName(k)]) values[paramPropName(k)] = v; });
    const count = Object.keys(values).length;
    setPasteNote(`Took the mashup${parsed.master ? ', its Master' : ''}${count ? ` and ${count} parameter value${count === 1 ? '' : 's'}` : ''} from the URL.`);
    setSearching(false);
    setResults(null);
    if (parsed.master) knownMasters.add(parsed.master);
    // The effect above reads the new mashup's parameters; a re-paste of the
    // same mashup re-reads here.
    set({ mashupName: parsed.mashupName, master: parsed.master, ...values, ...(parsed.mashupName !== mashupName ? { mashupParameters: [] } : {}) });
    if (parsed.mashupName === mashupName) readParameters(parsed.mashupName);
  };

  const declaredNames = new Set(declared.map(p => p.name));
  const orphaned = Object.keys(bindings)
    .filter(k => k.startsWith(PARAM_PREFIX) && !declaredNames.has(k.slice(PARAM_PREFIX.length)));
  const unpassable = declared.filter(p => !isUrlPassable(p));
  const passable = declared.length - unpassable.length;

  return (
    <div className="details-section"><div className="details-grid">
      <span className="details-section-title">Source · ThingWorx</span>

      <span className="details-grid-label">Mashup</span>
      <div className="details-grid-control">
        <div className="ae-embed-src-current">
          <span className={`ae-embed-src-name${mashupName ? '' : ' ae-embed-src-name--empty'}`} title={mashupName}>
            {mashupName || 'none chosen'}
          </span>
          {mashupName && (
            <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} onClick={() => setSearching(s => !s)}>
              {searching ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>
      </div>

      {searching && (<>
        <span className="details-grid-label">Search</span>
        <div className="details-grid-control" style={{ gap: 3 }}>
          <input
            className="details-input"
            style={{ flex: 1, minWidth: 0 }}
            value={term}
            placeholder="Mashup or Master name…"
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            autoFocus
          />
          <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} disabled={searchBusy || term.trim().length < 2} onClick={runSearch}>
            {searchBusy ? '…' : 'Find'}
          </button>
        </div>
        {results && (results.length ? (
          <div className="ae-embed-results">
            {results.map(r => (
              <div
                key={`${r.kind}:${r.name}`}
                className={`ae-embed-result${r.kind === 'master' ? ' ae-embed-result--master' : ''}`}
                title={r.description || r.name}
                onClick={() => pick(r)}
              >
                <span className="ae-embed-result-name">{r.name}</span>
                <span className="ae-embed-result-kind">{r.kind === 'master' ? 'Master' : 'Mashup'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="ae-embed-note ae-embed-note--warn">Nothing in ThingWorx matches “{term}”.</div>
        ))}
        <span className="details-grid-label">or paste</span>
        <div className="details-grid-control">
          <input
            className="details-input"
            style={{ width: '100%' }}
            placeholder="A runtime URL from ThingWorx"
            onPaste={e => { const text = e.clipboardData.getData('text'); e.preventDefault(); paste(text); }}
            onKeyDown={e => { if (e.key === 'Enter') paste(e.currentTarget.value); }}
          />
        </div>
      </>)}
      {pasteNote && <div className="ae-embed-note">{pasteNote}</div>}

      <span className="details-grid-label">Master</span>
      <div className="details-grid-control" style={{ gap: 3 }}>
        <input
          className="details-input"
          style={{ flex: 1, minWidth: 0 }}
          list={`ae-embed-masters-${id}`}
          value={master}
          placeholder="none — the page is the frame"
          onChange={e => set({ master: e.target.value })}
        />
        <datalist id={`ae-embed-masters-${id}`}>
          {[...knownMasters].sort().map(m => <option key={m} value={m} />)}
        </datalist>
        {master && (
          <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} title="Don’t wrap in a Master" onClick={() => set({ master: '' })}>×</button>
        )}
      </div>

      {mashupName && (<>
        <span className="details-grid-label">Parameters</span>
        <div className="details-grid-control" style={{ gap: 3 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: paramStatus.error ? '#b10e1c' : '#555' }}>
            {paramStatus.busy ? 'Checking ThingWorx…'
              : paramStatus.error ? 'Couldn’t check'
              : `${passable} below${paramStatus.checkedAt ? ' · up to date' : ''}`}
          </span>
          <button
            type="button"
            className="focus-mode-btn"
            style={{ flexShrink: 0 }}
            disabled={paramStatus.busy}
            title="Re-read the mashup's parameters from ThingWorx and reload it"
            onClick={() => { set({ refreshedAt: Date.now() }); readParameters(mashupName); }}
          >⟳ Refresh</button>
        </div>
        {paramStatus.error && <div className="ae-embed-note ae-embed-note--error">{paramStatus.error}</div>}
        {unpassable.length > 0 && (
          <div className="ae-embed-note ae-embed-note--warn">
            {unpassable.map(p => p.name).join(', ')} {unpassable.length === 1 ? 'is a table' : 'are tables'} — {unpassable.length === 1 ? 'it' : 'they'} can’t be passed in a URL, so {unpassable.length === 1 ? 'it isn’t' : 'they aren’t'} listed.
          </div>
        )}
        {orphaned.map(k => (
          <div key={k} className="ae-embed-orphan">
            <span><b>{k.slice(PARAM_PREFIX.length)}</b> is bound, but the mashup no longer has this parameter.</span>
            <button type="button" className="focus-mode-btn" onClick={() => editor.clearWidgetBinding(id, k)}>Unbind</button>
          </div>
        ))}
        <div className="ae-embed-note">
          Edit the mashup itself in ThingWorx Composer, then Refresh. Parameter changes reload it.
        </div>
      </>)}
    </div></div>
  );
}
