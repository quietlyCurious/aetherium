// designer/widgets/widgetOptionsFile.js
// Loads public/data/widget-options.json — every option each DevExtreme
// widget accepts, generated from DevExtreme's own declarations by
// scripts/generateWidgetOptions.js.
//
// Fetched rather than imported: it's ~700 KB and only the Widgets area
// needs it (the Screens designer reads exposed lists, not options), so it
// stays out of everyone else's page load. Fetched once per page load and
// shared, the same way model/modelRegistry.js handles models.json.
//
// A failed fetch isn't fatal: callers fall back to flattening
// widgetConfigs.js, which is what the area used before the file existed.

import { useSyncExternalStore } from 'react';

const WIDGET_OPTIONS_URL = '/data/widget-options.json';

let state = { status: 'idle', widgets: null, meta: null, error: null };
const listeners = new Set();

function publish(next) {
  state = next;
  listeners.forEach(listener => listener());
}

let inFlight = null;

export function loadWidgetOptions() {
  if (!inFlight) {
    publish({ ...state, status: 'loading' });
    inFlight = fetch(WIDGET_OPTIONS_URL)
      .then(response => {
        if (!response.ok) throw new Error(`${WIDGET_OPTIONS_URL} — ${response.status}`);
        return response.json();
      })
      .then(file => {
        if (!file || typeof file.widgets !== 'object') throw new Error(`${WIDGET_OPTIONS_URL}: no "widgets"`);
        publish({
          status: 'ready',
          widgets: file.widgets,
          meta: { devextremeVersion: file.devextremeVersion, generatedAt: file.generatedAt },
          error: null,
        });
        return file;
      })
      .catch(error => {
        // Left as 'failed' rather than retried: the area works from
        // widgetConfigs.js meanwhile, and says so.
        publish({ status: 'failed', widgets: null, meta: null, error });
        return null;
      });
  }
  return inFlight;
}

export const widgetOptionsStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => state,
};

// Starts the fetch on first use and re-renders when it lands.
export function useWidgetOptions() {
  const current = useSyncExternalStore(widgetOptionsStore.subscribe, widgetOptionsStore.getSnapshot);
  if (current.status === 'idle') loadWidgetOptions();
  return current;
}

// For tests and for callers outside React.
export function setWidgetOptionsForTest(widgets, meta = null) {
  inFlight = Promise.resolve(widgets ? { widgets, ...meta } : null);
  publish({ status: widgets ? 'ready' : 'failed', widgets, meta, error: null });
}
