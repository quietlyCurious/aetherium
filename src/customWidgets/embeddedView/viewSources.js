// customWidgets/embeddedView/viewSources.js
// The products an Embedded View can show a view from, and what the widget
// and its details panel need to know about each — so neither has to branch
// on the product beyond picking an entry here.
//
//   thingworx       a ThingWorx mashup (thingworxEmbed.js)
//   ophub           an Operations Hub page (ophubEmbed.js)
//
// A widget's props say which: `source` ('thingworx' when unset, so widgets
// placed before OpHub existed keep working), then that source's own fields:
//   thingworx   mashupName, master, mashupParameters
//   ophub       connectionId, appName, pageName, pagePath, pageParameters
// Switching source keeps the other one's fields, so switching back restores
// it. Both use the params.* properties (viewParameters.js).

export const VIEW_SOURCES = {
  thingworx: {
    id: 'thingworx',
    label: 'ThingWorx',
    viewNoun: 'mashup',
    kindLabel: 'ThingWorx mashup',
    // Same-origin, so the widget can see what actually loaded.
    inspectsFrame: true,
  },
  ophub: {
    id: 'ophub',
    label: 'Operations Hub',
    viewNoun: 'page',
    kindLabel: 'Operations Hub page',
    // Served from the proxy's own port — cross-origin, so no peeking inside.
    inspectsFrame: false,
  },
};

export const VIEW_SOURCE_LIST = Object.values(VIEW_SOURCES);

export function sourceIdOf(widgetProps) {
  return VIEW_SOURCES[widgetProps?.source] ? widgetProps.source : 'thingworx';
}

export const sourceOf = (widgetProps) => VIEW_SOURCES[sourceIdOf(widgetProps)];

// What's chosen, for the placeholder card and the details panel.
// → { name, detail } — name '' when nothing is chosen yet.
export function describeView(widgetProps) {
  const p = widgetProps || {};
  if (sourceIdOf(p) === 'ophub') {
    return { name: p.pageName || '', detail: p.appName ? `in app ${p.appName}` : '' };
  }
  return { name: p.mashupName || '', detail: p.master ? `in Master ${p.master}` : '' };
}
