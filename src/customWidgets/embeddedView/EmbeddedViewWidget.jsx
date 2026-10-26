// customWidgets/embeddedView/EmbeddedViewWidget.jsx
// Embedded View: a view from another product shown inside an Aetherium page
// — a ThingWorx mashup or an Operations Hub page (viewSources.js). The view
// keeps living in its product, where customers keep editing it, and Aetherium
// hosts it, passing its parameters in from Aetherium's own bindings.
//
// The view is an iframe served through the local proxy (thingworxEmbed.js and
// ophubEmbed.js explain why, and where). Its parameters arrive as one
// `params` object — each one is a widget property ('params.Site'), bound or
// typed like any other — and go into its URL. A change of value reloads the
// frame; updating a running view without a reload is the bridge's job
// (step 3).
//
// In the designer (designMode):
//   live         the real view, under a see-through overlay so clicks,
//                drags and resizes reach the canvas instead of the view
//   placeholder  a card naming the view — for heavy views, or a canvas with
//                many of them
// The runtime view is always live and fully interactive.
//
// A ThingWorx mashup also reloads by itself when it's changed in Composer —
// see mashupRevisions.js — on the canvas and in Runtime alike.

import { useEffect, useRef, useState } from 'react';
import { runtimeUrl } from './thingworxEmbed';
import { pageUrl } from './ophubEmbed';
import { useMashupRevision, watchMashup } from './mashupRevisions';
import { useOphubEmbedInfo } from './useOphubEmbedInfo';
import { declaredParametersOf } from './viewParameters';
import { describeView, sourceOf } from './viewSources';
import './embeddedView.css';

// Typing a parameter value in the details panel changes it per keystroke;
// wait for a pause before reloading the view.
const RELOAD_DELAY_MS = 500;

function useSettledValue(value, delay) {
  const [settled, setSettled] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; setSettled(value); return undefined; }
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

// What actually loaded, read from inside a same-origin ThingWorx frame.
// → null when it looks like the mashup, else a problem.
function thingworxLoadProblem(frame) {
  let doc, path;
  try {
    doc = frame.contentDocument;
    path = frame.contentWindow.location.pathname;
  } catch {
    return 'This frame isn’t on Aetherium’s origin, so /Thingworx isn’t being forwarded — add src/setupProxy.js and restart npm start.';
  }
  if (/FormLogin|login/i.test(path)) return 'ThingWorx asked for a login — check TWX_APP_KEY in the proxy’s .env.';
  if (doc && doc.contentType && !/html/i.test(doc.contentType)) return 'The proxy answered instead of ThingWorx — is it running, with twxEmbed.js hooked up?';
  return null;
}

// The frame's address for whichever source the widget shows.
// → { src, problem } — src null with a problem when it can't be shown yet.
function useFrameSource(props, declared) {
  const isOphub = sourceOf(props).id === 'ophub';
  const ophub = useOphubEmbedInfo(props.connectionId, isOphub);
  if (!isOphub) {
    return { src: runtimeUrl({ mashupName: props.mashupName, master: props.master, params: props.params, declared }), problem: null };
  }
  if (!props.pageName && !props.pagePath) return { src: null, problem: null };
  if (ophub.error) return { src: null, problem: ophub.error };
  if (!ophub.info) return { src: null, problem: null, waiting: true };
  return {
    src: pageUrl({ embedUrl: ophub.info.embedUrl, pagePath: props.pagePath, appName: props.appName, pageName: props.pageName, params: props.params, declared }),
    problem: null,
  };
}

function Placeholder({ kindLabel, viewNoun, name, detail, paramCount, note, problem }) {
  return (
    <div className="ae-embed-placeholder">
      <i className="dx-icon-globe ae-embed-placeholder-icon" />
      {name ? (<>
        <div className="ae-embed-placeholder-kind">{kindLabel}</div>
        <div className="ae-embed-placeholder-name" title={name}>{name}</div>
        <div className="ae-embed-placeholder-meta">
          {detail ? <span title={detail}>{detail}</span> : null}
          {paramCount ? <span>{paramCount} parameter{paramCount === 1 ? '' : 's'}</span> : null}
        </div>
      </>) : (
        <div className="ae-embed-placeholder-name ae-embed-placeholder-name--empty">Choose a {viewNoun} in the details panel</div>
      )}
      {note ? <div className="ae-embed-placeholder-note">{note}</div> : null}
      {problem ? <div className="ae-embed-placeholder-problem">{problem}</div> : null}
    </div>
  );
}

export function EmbeddedViewWidget(props) {
  const { designPreview = 'live', refreshedAt, designMode = false } = props;
  const source = sourceOf(props);
  const { name, detail } = describeView(props);
  const declared = declaredParametersOf(props);
  const { src, problem: sourceProblem, waiting } = useFrameSource(props, declared);
  const settledSrc = useSettledValue(src, designMode ? RELOAD_DELAY_MS : 0);
  const [state, setState] = useState({ loadKey: null, status: 'loading', problem: null });
  // Only ThingWorx mashups are watched for changes made in their product.
  const watchedMashup = source.id === 'thingworx' ? props.mashupName || '' : '';
  const revision = useMashupRevision(watchedMashup);
  useEffect(() => watchMashup(watchedMashup), [watchedMashup]);

  const showPlaceholder = !src || !settledSrc || (designMode && designPreview === 'placeholder');
  if (showPlaceholder) {
    return (
      <div className="ae-embed">
        <Placeholder
          kindLabel={source.kindLabel}
          viewNoun={source.viewNoun}
          name={name}
          detail={detail}
          paramCount={declared.length}
          note={src && designMode && designPreview === 'placeholder' ? 'Placeholder in the designer · live in Runtime' : waiting ? 'Asking the proxy where OpHub pages are…' : null}
          problem={sourceProblem}
        />
      </div>
    );
  }

  // A new key per URL, per Refresh and per change in ThingWorx, so the view
  // really reloads — a hash-only change on the same frame wouldn't.
  const loadKey = `${settledSrc}|${refreshedAt || ''}|${revision}`;
  const status = state.loadKey === loadKey ? state.status : 'loading';
  return (
    <div className={`ae-embed${designMode ? ' ae-embed--design' : ''}`}>
      <iframe
        key={loadKey}
        className="ae-embed-frame"
        src={settledSrc}
        title={name}
        onLoad={(e) => {
          const problem = source.inspectsFrame ? thingworxLoadProblem(e.currentTarget) : null;
          setState({ loadKey, status: problem ? 'error' : 'ready', problem });
        }}
      />
      {status === 'loading' && <div className="ae-embed-status">Loading {name}…</div>}
      {status === 'error' && state.problem && (
        <div className="ae-embed-error"><b>{name}</b> didn’t load. {state.problem}</div>
      )}
      {designMode && (
        <div className="ae-embed-overlay" title={`Live ${source.viewNoun} — select, drag and resize it here; it’s interactive in Runtime`}>
          <span className="ae-embed-chip">{source.id === 'ophub' ? 'OpHub page' : 'Mashup'} · live</span>
        </div>
      )}
    </div>
  );
}
