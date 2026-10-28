// customWidgets/embeddedView/OphubSourceDetails.jsx
// The Source section's rows for an Operations Hub page: which connection,
// which page, and the page's parameters. Parallel to
// ThingworxSourceDetails.jsx; drawn inside EmbeddedViewDetails.
//
// Choosing a page: browse the connection's apps and their pages (OpHub's
// AppMgr service), or paste a page's run-mode URL, or type app and page
// names. However it was chosen, the page is then looked up in OpHub, so it
// has its ids (for Edit) and its URL Globals.
//
// Parameters are the page's URL Globals — read from OpHub each time the
// details open, like a ThingWorx mashup's — plus any named here by hand
// (a pasted URL's ?name=value pairs are added that way). Each becomes a
// property further down, bindable like any other, and its value goes in the
// page URL's query string.
//
// Edit ↗ opens the page in OpHub's classic designer. New-designer apps have
// no page URLs, so for those it can't land on the page.

import { useEffect, useRef, useState } from 'react';
import { SelectBox } from 'devextreme-react';
import {
  fetchOphubAppDetails, listOphubApps, ophubConnections, ophubEditUrl, parsePageUrl, readOphubPage,
  urlGlobalsForPage,
} from './ophubEmbed';
import { useOphubEmbedInfo } from './useOphubEmbedInfo';
import { declaredParametersOf, paramPropName } from './viewParameters';
import { ParameterSummary } from './ParameterSummary';
import { connectionLabel } from '../../connections/connectionKinds';

const NAME_OK = /^[A-Za-z_][\w.-]*$/;

// URL Globals from OpHub, then the hand-named ones it doesn't have.
function mergeParameters(fromOphub, current) {
  const names = new Set(fromOphub.map(p => p.name));
  const byHand = current.filter(p => !p.fromOphub && !names.has(p.name)).map(p => ({ ...p, byHand: true }));
  return [...fromOphub, ...byHand];
}
const parameterKey = (list) => JSON.stringify(list.map(p => [p.name, p.baseType, !!p.fromOphub]));

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
  const [apps, setApps] = useState({ list: null, error: null });
  const [browseAppId, setBrowseAppId] = useState(props.appId || null);
  const [pages, setPages] = useState({ appId: null, list: null, globals: [], error: null });
  const [appDraft, setAppDraft] = useState(props.appName || '');
  const [pageDraft, setPageDraft] = useState(props.pageName || '');
  const [pasteNote, setPasteNote] = useState(null);
  const [newParam, setNewParam] = useState('');
  const [lookup, setLookup] = useState({ busy: false, error: null, notFound: false, globalTypes: null, checkedAt: null });

  const latest = useRef({ declared, id });
  latest.current = { declared, id };

  // ── Looking the chosen page up in OpHub ────────────────────────────────────
  const checkPage = async ({ refresh = false } = {}) => {
    if (!connection || (!props.pageId && !props.pageName)) return;
    setLookup(l => ({ ...l, busy: true, error: null }));
    try {
      if (refresh) await listOphubApps(connection, { refresh: true });
      const found = await readOphubPage(connection, {
        appId: props.appId, appName: props.appName, pageId: props.pageId, pageName: props.pageName,
      });
      if (latest.current.id !== id) return;
      if (!found.page) {
        setLookup({ busy: false, error: null, notFound: true, globalTypes: null, checkedAt: new Date() });
        return;
      }
      const merged = mergeParameters(found.parameters, latest.current.declared);
      const changes = {};
      if (props.appId !== found.app.id) changes.appId = found.app.id;
      if (props.pageId !== found.page.id) changes.pageId = found.page.id;
      if (parameterKey(merged) !== parameterKey(latest.current.declared)) changes.pageParameters = merged;
      if (Object.keys(changes).length) set(changes);
      setLookup({ busy: false, error: null, notFound: false, globalTypes: found.globalTypes, checkedAt: new Date() });
    } catch (err) {
      setLookup({ busy: false, error: err.message, notFound: false, globalTypes: null, checkedAt: null });
    }
  };

  useEffect(() => {
    checkPage();
    // Once per widget and page — not on every edit. The ids are left out:
    // the lookup fills them in, and that shouldn't set off a second lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, connection?.id, props.appName, props.pageName]);

  // ── Browsing ───────────────────────────────────────────────────────────────
  // The connection is read from storage on every render, so it's a new
  // object each time; the effects key on what identifies it instead, or each
  // render would cancel the request in flight.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const connectionKey = connection ? `${connection.id}|${connection.proxyUrl}` : '';

  useEffect(() => {
    if (!changing || !connectionKey || apps.list) return undefined;
    let live = true;
    listOphubApps(connectionRef.current)
      .then(list => live && setApps({ list, error: null }))
      .catch(err => live && setApps({ list: null, error: err.message }));
    return () => { live = false; };
  }, [changing, connectionKey, apps.list]);

  useEffect(() => {
    if (!browseAppId || !connectionKey) return undefined;
    let live = true;
    setPages({ appId: browseAppId, list: null, globals: [], error: null });
    fetchOphubAppDetails(connectionRef.current, browseAppId)
      .then(d => live && setPages({ appId: browseAppId, list: d.pages, globals: d.globals, error: null }))
      .catch(err => live && setPages({ appId: browseAppId, list: [], globals: [], error: err.message }));
    return () => { live = false; };
  }, [browseAppId, connectionKey]);

  const choosePage = (page) => {
    const app = (apps.list || []).find(a => a.id === browseAppId);
    if (!app) return;
    set({
      appId: app.id, appName: app.name, pageId: page.id, pageName: page.name, pagePath: undefined,
      pageParameters: mergeParameters(urlGlobalsForPage(pages.globals, page.id), declared),
    });
    setAppDraft(app.name);
    setPageDraft(page.name);
    setPasteNote(null);
    setChanging(false);
  };

  // ── Pasting and typing ─────────────────────────────────────────────────────
  // Both give names only; the lookup above then finds the ids and URL Globals.
  const addParameters = (names, extra = {}) => {
    const have = new Set(declared.map(p => p.name));
    const added = names.filter(n => n && !have.has(n)).map(name => ({ name, baseType: 'STRING', byHand: true }));
    set({ ...extra, ...(added.length ? { pageParameters: [...declared, ...added] } : {}) });
    return added.length;
  };

  const paste = (text) => {
    if (!text.trim()) return;
    const parsed = parsePageUrl(text);
    if (!parsed) { setPasteNote('That doesn’t look like an OpHub page URL (…/run/?app_name=<app>&page_name=<page>).'); return; }
    const values = {};
    Object.entries(parsed.params).forEach(([k, v]) => { if (!bindings[paramPropName(k)]) values[paramPropName(k)] = v; });
    const added = addParameters(Object.keys(parsed.params), {
      appName: parsed.appName, pageName: parsed.pageName, pagePath: parsed.pagePath, appId: undefined, pageId: undefined, ...values,
    });
    setAppDraft(parsed.appName);
    setPageDraft(parsed.pageName);
    setPasteNote(`Took the page${added ? ` and ${added} parameter${added === 1 ? '' : 's'}` : ''} from the URL.`);
    setChanging(false);
  };

  const applyTyped = () => {
    if (!appDraft.trim() || !pageDraft.trim()) return;
    // Typed names build the usual path; a pasted URL's own path is dropped.
    set({ appName: appDraft.trim(), pageName: pageDraft.trim(), pagePath: undefined, appId: undefined, pageId: undefined });
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

  const editUrl = ophubEditUrl(info?.ophubBaseUrl, props.appId, props.pageId);
  // The browsed app's pages: null while loading (or before an app is chosen).
  const pagesForApp = browseAppId && pages.appId === browseAppId ? pages.list : null;
  const pagesPlaceholder = !browseAppId ? 'Choose an app first'
    : pagesForApp === null ? 'Loading pages…'
    : pagesForApp.length ? `${pagesForApp.length} pages — choose one…` : 'No pages';
  const fromOphub = declared.filter(p => p.fromOphub);
  const status = lookup.busy ? 'checking OpHub…'
    : lookup.error ? 'couldn’t check'
    : lookup.notFound ? 'page not found in OpHub'
    : lookup.checkedAt ? 'up to date' : loading ? 'asking the proxy…' : null;

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

      {!changing && (<>
        <span className="details-grid-label">App</span>
        <div className="details-grid-control">
          <span className="ae-embed-src-name" style={{ fontWeight: 400 }} title={props.appName}>{props.appName || '—'}</span>
        </div>
        <span className="details-grid-label">Page</span>
        <div className="details-grid-control">
          <div className="ae-embed-src-current">
            <span className="ae-embed-src-name" title={props.pagePath || props.pageName}>{props.pageName}</span>
            <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} onClick={() => setChanging(true)}>Change</button>
            <button
              type="button"
              className="focus-mode-btn"
              style={{ flexShrink: 0 }}
              disabled={!editUrl}
              title={editUrl
                ? `Open ${props.pageName} in OpHub's classic designer, in a new tab. (New-designer apps can't be opened on a page by URL.) Save there, come back, and Refresh.`
                : lookup.busy || loading ? 'Looking the page up in OpHub…' : 'Can’t link to the designer: the page wasn’t found in OpHub.'}
              onClick={() => window.open(editUrl, `ophub-designer-${props.pageId}`)}
            >Edit ↗</button>
          </div>
        </div>
        {lookup.notFound && (
          <div className="ae-embed-note ae-embed-note--warn">
            OpHub has no page “{props.pageName}” in an app called “{props.appName}” — it still loads if the URL is right, but there’s no Edit or URL Globals.
          </div>
        )}
        {lookup.error && <div className="ae-embed-note ae-embed-note--error">Couldn’t look the page up: {lookup.error}</div>}
      </>)}

      {changing && (<>
        {/* App first, then its pages — both searchable. */}
        <span className="details-grid-label">App</span>
        <div className="details-grid-control">
          <SelectBox
            dataSource={apps.list || []}
            valueExpr="id" displayExpr="name"
            value={browseAppId}
            searchEnabled
            placeholder={apps.error ? 'Couldn’t list apps' : apps.list ? `${apps.list.length} apps — choose one…` : 'Loading apps…'}
            onValueChanged={e => e.value && e.value !== browseAppId && setBrowseAppId(e.value)}
            stylingMode="outlined" width="100%" height={24}
          />
        </div>
        {apps.error && <div className="ae-embed-note ae-embed-note--error">{apps.error}</div>}
        <span className="details-grid-label">Page</span>
        <div className="details-grid-control" style={{ gap: 3 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SelectBox
              key={browseAppId || 'none'}
              dataSource={pagesForApp || []}
              valueExpr="id" displayExpr="displayName"
              value={browseAppId === props.appId ? props.pageId || null : null}
              searchEnabled
              disabled={!pagesForApp || pagesForApp.length === 0}
              placeholder={pagesPlaceholder}
              itemRender={p => <span title={p.name}>{p.displayName}{p.displayName !== p.name && <span style={{ color: '#999' }}> · {p.name}</span>}</span>}
              onValueChanged={e => {
                const page = (pagesForApp || []).find(p => p.id === e.value);
                if (page && e.value !== props.pageId) choosePage(page);
              }}
              stylingMode="outlined" width="100%" height={24}
            />
          </div>
          {chosen && (
            <button type="button" className="focus-mode-btn" style={{ flexShrink: 0 }} onClick={() => setChanging(false)}>Cancel</button>
          )}
        </div>
        {pagesForApp && pagesForApp.length === 0 && (
          <div className="ae-embed-note ae-embed-note--warn">{pages.error || 'No pages found in this app.'}</div>
        )}
        <span className="details-grid-label">or paste</span>
        <div className="details-grid-control">
          <input
            className="details-input"
            style={{ width: '100%' }}
            placeholder="The page’s URL from OpHub (run mode)"
            onPaste={e => { const text = e.clipboardData.getData('text'); e.preventDefault(); paste(text); }}
            onKeyDown={e => { if (e.key === 'Enter') paste(e.currentTarget.value); }}
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
          status={status}
          statusError={!!lookup.error}
          extra={(<>
            <span className="details-grid-label" />
            <div className="details-grid-control" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              {declared.length > 0 && (
                <div className="ae-embed-param-chips">
                  {declared.map(p => (
                    <span
                      key={p.name}
                      className={`ae-embed-param-chip${p.fromOphub ? ' ae-embed-param-chip--ophub' : ''}`}
                      title={p.fromOphub ? `${p.name} · a URL Global on this page in OpHub` : `${p.name} · named here`}
                    >
                      <span>{p.name}</span>
                      {!p.fromOphub && (
                        <button type="button" title={`Stop passing ${p.name}`} onClick={() => removeParameter(p.name)}>×</button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {lookup.checkedAt && !lookup.notFound && fromOphub.length === 0 && (
                <span className="ae-embed-note" style={{ gridColumn: 'auto' }}>
                  No URL Globals found on this page{lookup.globalTypes?.length ? ` (globals seen: ${lookup.globalTypes.join(', ')})` : ''}.
                </span>
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
            busy: lookup.busy,
            title: 'Re-read the page’s URL Globals from OpHub and reload it',
            onClick: () => { set({ refreshedAt: Date.now() }); checkPage({ refresh: true }); },
          }}
          note="Parameters are the page’s URL Globals, read from OpHub (blue), plus any you name here. Each goes in the page URL as ?Name=value. Edit ↗ opens classic-designer pages; save there, then Refresh."
        />
      )}
    </>
  );
}
