// customWidgets/embeddedView/mashupRevisions.js
// Notices when a mashup shown on this page has been changed in ThingWorx
// Composer, so it can be reloaded without anyone pressing Refresh.
//
// Every Embedded View on screen watches its mashup here. When the Aetherium
// tab comes back to the front — after "Edit in ThingWorx", or after editing
// in Composer on your own — each watched mashup's definition is fetched again
// and compared with the last one seen. A changed one gets a new revision
// number; the widgets showing it use that number to reload, and the details
// panel to re-read its parameters. Unchanged mashups aren't touched, so
// switching tabs costs a few requests and no reloads.
//
// A module-level store (like widgetPropertyDefs) because every instance of a
// mashup, on the canvas or in Runtime, should reload together.

import { useSyncExternalStore } from 'react';
import { fetchMashupSignature } from './thingworxEmbed';

// name → { count, signature, revision, changedAt }
const watched = new Map();
const listeners = new Set();
const CHECK_AT_MOST_EVERY_MS = 2000;
let lastCheck = 0;
let checking = false;

const publish = () => listeners.forEach(listener => listener());

async function captureBaseline(name) {
  const entry = watched.get(name);
  if (!entry || entry.signature) return;
  try {
    const signature = await fetchMashupSignature(name);
    if (watched.get(name) === entry && !entry.signature) entry.signature = signature;
  } catch { /* unreachable now; the next check sets it */ }
}

// → a function that stops watching. Counted, so two widgets showing the same
// mashup share one entry.
export function watchMashup(name) {
  if (!name) return () => {};
  const entry = watched.get(name) || { count: 0, signature: null, revision: 0, changedAt: null };
  entry.count += 1;
  watched.set(name, entry);
  captureBaseline(name);
  ensureListening();
  return () => {
    entry.count -= 1;
    if (entry.count <= 0 && watched.get(name) === entry) watched.delete(name);
  };
}

// → whether anything changed.
export async function checkWatchedMashups({ force = false } = {}) {
  const now = Date.now();
  if (checking || (!force && now - lastCheck < CHECK_AT_MOST_EVERY_MS)) return false;
  checking = true;
  lastCheck = now;
  let changed = false;
  try {
    await Promise.all([...watched.entries()].map(async ([name, entry]) => {
      let signature;
      try { signature = await fetchMashupSignature(name); } catch { return; }
      if (!entry.signature) { entry.signature = signature; return; }
      if (signature === entry.signature) return;
      entry.signature = signature;
      entry.revision += 1;
      entry.changedAt = new Date();
      changed = true;
    }));
  } finally {
    checking = false;
  }
  if (changed) publish();
  return changed;
}

let listening = false;
function ensureListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('focus', () => checkWatchedMashups());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkWatchedMashups();
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The mashup's revision — 0 until it's seen to change.
export function useMashupRevision(name) {
  return useSyncExternalStore(subscribe, () => watched.get(name)?.revision ?? 0);
}

// When it last changed in ThingWorx while this page was open, or null.
export function useMashupChangedAt(name) {
  return useSyncExternalStore(subscribe, () => watched.get(name)?.changedAt ?? null);
}
