// customWidgets/embeddedView/ThingworxSourceDetails.jsx
// The Source section's rows for a ThingWorx mashup: which mashup, wrapped in
// which Master (optional), and its parameters, kept in step with ThingWorx.
// Drawn inside EmbeddedViewDetails, which owns the section and the product
// switch.
//
// The parameters themselves appear further down as ordinary widget
// properties (customWidgets.js → dynamicPropertyDefs), so they get the same
// static field and ⚡ binding as everything else. These rows only keep the
// list of them current:
//   - picking or pasting a mashup reads its parameters
//   - opening the widget's details re-reads them, since the mashup may have
//     been edited in Composer since (no cached shape is trusted)
//   - Refresh re-reads them and reloads the frame
//   - Edit opens the mashup in Composer, on the ThingWorx server itself;
//     coming back to this tab checks it for changes (mashupRevisions.js),
//     and a changed mashup reloads and has its parameters re-read

import { useEffect, useRef, useState } from 'react';
import {
  composerUrl, fetchMashupParameters, fetchTwxBaseUrl, parseRuntimeUrl, searchMashupsAndMasters,
} from './thingworxEmbed';
import { declaredParametersOf, paramPropName, sameParameters } from './viewParameters';
import { ParameterSummary } from './ParameterSummary';
import { checkWatchedMashups, useMashupChangedAt, useMashupRevision } from './mashupRevisions';

const timeOf = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// The ThingWorx server's address, for links to Composer. Known before the
// button is pressed, because a new tab opened after an await is blocked as
// a popup.
function useTwxBaseUrl() {
  const [state, setState] = useState({ url: null, error: null });
  useEffect(() => {
    let live = true;
    fetchTwxBaseUrl()
      .then(url => live && setState({ url, error: null }))
      .catch(err => live && setState({ url: null, error: err.message }));
    return () => { live = false; };
  }, []);
  return state;
}

// Masters found by any search this session, offered in the Master field.
const knownMasters = new Set();

export function ThingworxSourceDetails({ container, editor }) {
  const id = container.id;
  const props = container.widgetProps || {};
  const bindings = container.bindings || {};
  const mashupName = props.mashupName || '';
  const master = props.master || '';
  const declared = declaredParametersOf(props);
  const set = (changes) => editor.updateWidgetProps(id, changes);

  const [searching, setSearching] = useState(!mashupName);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);       // null → not searched yet
  const [searchBusy, setSearchBusy] = useState(false);
  const [paramStatus, setParamStatus] = useState({ busy: false, error: null, checkedAt: null });
  const [pasteNote, setPasteNote] = useState(null);
  const twx = useTwxBaseUrl();
  const revision = useMashupRevision(mashupName);
  const changedAt = useMashupChangedAt(mashupName);
  const editUrl = composerUrl(twx.url, mashupName);

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

  // Opening this widget's details, and the mashup changing in ThingWorx:
  // re-read its parameters.
  useEffect(() => {
    if (mashupName) readParameters(mashupName);
    // Once per widget, mashup and change — not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mashupName, revision]);

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

  return (
    <>
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
          {mashupName && (
            <button
              type="button"
              className="focus-mode-btn"
              style={{ flexShrink: 0 }}
              disabled={!editUrl}
              title={editUrl
                ? `Open ${mashupName} in ThingWorx Composer, in a new tab. Save there, then come back — it reloads here.`
                : `Can't link to Composer: ${twx.error || 'asking the proxy which server it uses…'}`}
              onClick={() => {
                // One tab per mashup: pressing Edit again goes back to it.
                window.open(editUrl, `twx-composer-${mashupName}`);
              }}
            >Edit ↗</button>
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

      {mashupName && (
        <ParameterSummary
          declared={declared}
          bindings={bindings}
          viewNoun="mashup"
          onUnbind={(k) => editor.clearWidgetBinding(id, k)}
          status={paramStatus.busy ? 'checking ThingWorx…' : paramStatus.error ? 'couldn’t check' : paramStatus.checkedAt ? 'up to date' : null}
          statusError={!!paramStatus.error}
          extra={(<>
            {changedAt && !paramStatus.busy && (
              <div className="ae-embed-note" style={{ color: '#0e7a0d' }}>Changed in ThingWorx at {timeOf(changedAt)} · reloaded</div>
            )}
            {paramStatus.error && <div className="ae-embed-note ae-embed-note--error">{paramStatus.error}</div>}
          </>)}
          refresh={{
            busy: paramStatus.busy,
            title: 'Re-read the mashup’s parameters from ThingWorx and reload it',
            onClick: async () => {
              // A change found here reloads it through its revision (and
              // re-reads parameters); otherwise reload it anyway — that's
              // what Refresh is for.
              const changed = await checkWatchedMashups({ force: true });
              if (!changed) { set({ refreshedAt: Date.now() }); readParameters(mashupName); }
            },
          }}
          note="Edit ↗ opens the mashup in ThingWorx Composer. Save there and come back: Aetherium notices the change and reloads it. Parameter changes here reload it too."
        />
      )}
    </>
  );
}
