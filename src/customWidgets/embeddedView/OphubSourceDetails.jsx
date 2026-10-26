// customWidgets/embeddedView/OphubSourceDetails.jsx
// The Source section's rows for an Operations Hub page: which connection,
// which page, and the page's parameters. Parallel to
// ThingworxSourceDetails.jsx; drawn inside EmbeddedViewDetails.
//
// Choosing a page: paste its runtime URL (the reliable way — the URL's own
// path is kept), or type the app and page names. There's no page browser yet:
// listing an OpHub server's apps and pages needs its API call, which hasn't
// been captured.
//
// Parameters are named here by hand, since OpHub doesn't tell Aetherium which
// values a page reads from its URL; a pasted URL's query values are added.
// Each named parameter becomes a property further down, bindable like any
// other, and its value goes in the page URL's query string.

import { useState } from 'react';
import { SelectBox } from 'devextreme-react';
import { ophubConnections, parsePageUrl } from './ophubEmbed';
import { useOphubEmbedInfo } from './useOphubEmbedInfo';
import { declaredParametersOf, paramPropName } from './viewParameters';
import { ParameterSummary } from './ParameterSummary';
import { connectionLabel } from '../../connections/connectionKinds';

const NAME_OK = /^[A-Za-z_][\w.-]*$/;

export function OphubSourceDetails({ container, editor }) {
  const id = container.id;
  const props = container.widgetProps || {};
  const bindings = container.bindings || {};
  const declared = declaredParametersOf(props);
  const set = (changes) => editor.updateWidgetProps(id, changes);
  const chosen = !!(props.pageName || props.pagePath);

  const connections = ophubConnections();
  const { connection, info, error: proxyError, loading } = useOphubEmbedInfo(props.connectionId);
  const [changing, setChanging] = useState(!chosen);
  const [appDraft, setAppDraft] = useState(props.appName || '');
  const [pageDraft, setPageDraft] = useState(props.pageName || '');
  const [pasteNote, setPasteNote] = useState(null);
  const [newParam, setNewParam] = useState('');

  const addParameters = (names, extra = {}) => {
    const have = new Set(declared.map(p => p.name));
    const added = names.filter(n => n && !have.has(n)).map(name => ({ name, baseType: 'STRING' }));
    set({ ...extra, ...(added.length ? { pageParameters: [...declared, ...added] } : {}) });
    return added.length;
  };

  const paste = (text) => {
    if (!text.trim()) return;
    const parsed = parsePageUrl(text);
    if (!parsed) { setPasteNote('That doesn’t look like an OpHub page URL (…/run/v2/app-name/<app>/page-name/<page>).'); return; }
    const values = {};
    Object.entries(parsed.params).forEach(([k, v]) => { if (!bindings[paramPropName(k)]) values[paramPropName(k)] = v; });
    const added = addParameters(Object.keys(parsed.params), {
      appName: parsed.appName, pageName: parsed.pageName, pagePath: parsed.pagePath, ...values,
    });
    setAppDraft(parsed.appName);
    setPageDraft(parsed.pageName);
    setPasteNote(`Took the page${added ? ` and ${added} parameter${added === 1 ? '' : 's'}` : ''} from the URL.`);
    setChanging(false);
  };

  const applyTyped = () => {
    if (!appDraft.trim() || !pageDraft.trim()) return;
    // Typed names build the usual path; a pasted URL's own path is dropped.
    set({ appName: appDraft.trim(), pageName: pageDraft.trim(), pagePath: undefined });
    setPasteNote(null);
    setChanging(false);
  };

  const addTypedParameter = () => {
    const name = newParam.trim();
    if (!NAME_OK.test(name)) return;
    addParameters([name]);
    setNewParam('');
  };

  const removeParameter = (name) => set({ pageParameters: declared.filter(p => p.name !== name) });

  return (
    <>
      <span className="details-grid-label">Connection</span>
      <div className="details-grid-control">
        {connections.length > 1 ? (
          <SelectBox
            dataSource={connections.map(c => ({ id: c.id, name: connectionLabel(c) }))}
            valueExpr="id" displayExpr="name"
            value={connection?.id || null}
            onValueChanged={e => e.value && e.value !== props.connectionId && set({ connectionId: e.value })}
            stylingMode="outlined" width="100%" height={24}
          />
        ) : (
          <span className={`ae-embed-src-name${connection ? '' : ' ae-embed-src-name--empty'}`}>
            {connection ? connectionLabel(connection) : 'none'}
          </span>
        )}
      </div>
      {proxyError && <div className="ae-embed-note ae-embed-note--error">{proxyError}</div>}
      {info && !info.cookieConfigured && (
        <div className="ae-embed-note ae-embed-note--warn">The proxy has no OPHUB_COOKIE, so OpHub will probably ask for a login.</div>
      )}

      <span className="details-grid-label">Page</span>
      <div className="details-grid-control">
        <div className="ae-embed-src-current">
          <span className={`ae-embed-src-name${chosen ? '' : ' ae-embed-src-name--empty'}`} title={props.pagePath || props.pageName}>
            {chosen ? props.pageName : 'none chosen'}
          </span>
          {chosen && (
            <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} onClick={() => setChanging(c => !c)}>
              {changing ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>
      </div>
      {chosen && props.appName && (<>
        <span className="details-grid-label">App</span>
        <div className="details-grid-control"><span className="ae-embed-src-name" style={{ fontWeight: 400 }} title={props.appName}>{props.appName}</span></div>
      </>)}

      {changing && (<>
        <span className="details-grid-label">Paste</span>
        <div className="details-grid-control">
          <input
            className="details-input"
            style={{ width: '100%' }}
            placeholder="The page’s URL from OpHub (run mode)"
            onPaste={e => { const text = e.clipboardData.getData('text'); e.preventDefault(); paste(text); }}
            onKeyDown={e => { if (e.key === 'Enter') paste(e.currentTarget.value); }}
            autoFocus
          />
        </div>
        <span className="details-grid-label">or type</span>
        <div className="details-grid-control" style={{ gap: 3 }}>
          <input className="details-input" style={{ flex: 1, minWidth: 0 }} placeholder="App" value={appDraft} onChange={e => setAppDraft(e.target.value)} />
          <input
            className="details-input" style={{ flex: 1, minWidth: 0 }} placeholder="Page" value={pageDraft}
            onChange={e => setPageDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyTyped(); }}
          />
          <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} disabled={!appDraft.trim() || !pageDraft.trim()} onClick={applyTyped}>Use</button>
        </div>
      </>)}
      {pasteNote && <div className="ae-embed-note">{pasteNote}</div>}

      {chosen && (
        <ParameterSummary
          declared={declared}
          bindings={bindings}
          viewNoun="page"
          onUnbind={(k) => editor.clearWidgetBinding(id, k)}
          status={loading ? 'asking the proxy…' : null}
          extra={(<>
            <span className="details-grid-label" />
            <div className="details-grid-control" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              {declared.length > 0 && (
                <div className="ae-embed-param-chips">
                  {declared.map(p => (
                    <span key={p.name} className="ae-embed-param-chip" title={p.name}>
                      <span>{p.name}</span>
                      <button type="button" title={`Stop passing ${p.name}`} onClick={() => removeParameter(p.name)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 3 }}>
                <input
                  className="details-input" style={{ flex: 1, minWidth: 0 }} placeholder="Add a parameter by name"
                  value={newParam}
                  onChange={e => setNewParam(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTypedParameter(); }}
                />
                <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} disabled={!NAME_OK.test(newParam.trim())} onClick={addTypedParameter}>Add</button>
              </div>
            </div>
          </>)}
          refresh={{
            busy: false,
            title: 'Reload the page',
            onClick: () => set({ refreshedAt: Date.now() }),
          }}
          note="OpHub doesn’t tell Aetherium which values a page reads from its URL, so name them here. Each goes in the page URL as ?Name=value. Edit the page itself in OpHub, then Refresh."
        />
      )}
    </>
  );
}
