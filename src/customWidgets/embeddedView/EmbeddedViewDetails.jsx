// customWidgets/embeddedView/EmbeddedViewDetails.jsx
// The Embedded View's "Source" section, at the top of its widget tab in the
// details panel: which product the view comes from (viewSources.js), then
// that product's own rows —
//   ThingworxSourceDetails  mashup, Master, parameters read from ThingWorx
//   OphubSourceDetails      connection, page, URL Globals from OpHub
// Switching product keeps the other one's choices, so switching back
// restores them.

import { ThingworxSourceDetails } from './ThingworxSourceDetails';
import { OphubSourceDetails } from './OphubSourceDetails';
import { VIEW_SOURCE_LIST, sourceIdOf } from './viewSources';

const SOURCE_DETAILS = {
  thingworx: ThingworxSourceDetails,
  ophub: OphubSourceDetails,
};

export function EmbeddedViewDetails({ container, editor }) {
  const sourceId = sourceIdOf(container.widgetProps);
  const Details = SOURCE_DETAILS[sourceId];
  return (
    <div className="details-section"><div className="details-grid">
      <span className="details-section-title">Source</span>
      <div className="ae-embed-source-switch" role="group" aria-label="Where the view comes from">
        {VIEW_SOURCE_LIST.map(s => (
          <button
            key={s.id}
            type="button"
            className={s.id === sourceId ? 'is-on' : ''}
            aria-pressed={s.id === sourceId}
            onClick={() => s.id !== sourceId && editor.updateWidgetProps(container.id, { source: s.id })}
          >{s.label}</button>
        ))}
      </div>
      {/* Keyed by widget and product, so each starts with its own local state. */}
      <Details key={`${container.id}:${sourceId}`} container={container} editor={editor} />
    </div></div>
  );
}
