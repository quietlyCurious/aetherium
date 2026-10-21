// customWidgets/embeddedView/EmbeddedViewWidget.jsx
// Embedded View: a ThingWorx mashup shown inside an Aetherium page. The
// mashup keeps living in ThingWorx — customers keep editing it in Composer —
// and Aetherium hosts it, passing its parameters in from Aetherium's own
// bindings.
//
// The mashup is an iframe on Aetherium's own origin (thingworxEmbed.js
// explains why). Its parameters arrive as one `params` object — each one is
// a widget property ('params.Site'), bound or typed like any other — and go
// into the runtime URL. A change of value reloads the frame; updating a
// running mashup without a reload is the bridge's job (step 3).
//
// In the designer (designMode):
//   live         the real mashup, under a see-through overlay so clicks,
//                drags and resizes reach the canvas instead of the mashup
//   placeholder  a card naming the mashup — for heavy mashups, or a canvas
//                with many of them
// The runtime view is always live and fully interactive.

import { useEffect, useRef, useState } from 'react';
import { runtimeUrl } from './thingworxEmbed';
import './embeddedView.css';

// Typing a parameter value in the details panel changes it per keystroke;
// wait for a pause before reloading the mashup.
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

// What actually loaded, read from inside the frame (possible because it's
// same-origin). → null when it looks like the mashup, else a problem.
function loadProblem(frame) {
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

function Placeholder({ mashupName, master, paramCount, note }) {
  return (
    <div className="ae-embed-placeholder">
      <i className="dx-icon-globe ae-embed-placeholder-icon" />
      {mashupName ? (<>
        <div className="ae-embed-placeholder-kind">ThingWorx mashup</div>
        <div className="ae-embed-placeholder-name" title={mashupName}>{mashupName}</div>
        <div className="ae-embed-placeholder-meta">
          {master ? <span title={master}>in Master {master}</span> : null}
          {paramCount ? <span>{paramCount} parameter{paramCount === 1 ? '' : 's'}</span> : null}
        </div>
      </>) : (
        <div className="ae-embed-placeholder-name ae-embed-placeholder-name--empty">Choose a mashup in the details panel</div>
      )}
      {note ? <div className="ae-embed-placeholder-note">{note}</div> : null}
    </div>
  );
}

export function EmbeddedViewWidget({
  mashupName = '', master = '', params, mashupParameters, designPreview = 'live', refreshedAt, designMode = false,
}) {
  const declared = Array.isArray(mashupParameters) ? mashupParameters : [];
  const src = runtimeUrl({ mashupName, master, params, declared });
  const settledSrc = useSettledValue(src, designMode ? RELOAD_DELAY_MS : 0);
  const [state, setState] = useState({ src: null, status: 'loading', problem: null });

  const showPlaceholder = !src || (designMode && designPreview === 'placeholder');
  if (showPlaceholder) {
    return (
      <div className="ae-embed">
        <Placeholder
          mashupName={mashupName}
          master={master}
          paramCount={declared.length}
          note={src ? 'Placeholder in the designer · live in Runtime' : null}
        />
      </div>
    );
  }

  const status = state.src === settledSrc ? state.status : 'loading';
  return (
    <div className={`ae-embed${designMode ? ' ae-embed--design' : ''}`}>
      <iframe
        // A new key per URL and per Refresh, so the mashup really reloads — a
        // hash-only change on the same frame wouldn't.
        key={`${settledSrc}|${refreshedAt || ''}`}
        className="ae-embed-frame"
        src={settledSrc}
        title={mashupName}
        onLoad={(e) => {
          const problem = loadProblem(e.currentTarget);
          setState({ src: settledSrc, status: problem ? 'error' : 'ready', problem });
        }}
      />
      {status === 'loading' && <div className="ae-embed-status">Loading {mashupName}…</div>}
      {status === 'error' && state.problem && (
        <div className="ae-embed-error"><b>{mashupName}</b> didn’t load. {state.problem}</div>
      )}
      {designMode && (
        <div className="ae-embed-overlay" title="Live mashup — select, drag and resize it here; it’s interactive in Runtime">
          <span className="ae-embed-chip">Mashup · live</span>
        </div>
      )}
    </div>
  );
}
