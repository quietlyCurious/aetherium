// unsavedChangesStore.js
// Tracks whether the Configurator's currently-open editor (the Properties
// preview, the Related Assets view, or the All Assets diagram) has changes
// the title-bar Save hasn't persisted yet. Same "only one active editor at
// a time" assumption as OperatorWorkspace's activeSaveHandlerRef: whichever
// editor is mounted reports here, and clears itself on unmount.
//
// A module-level store rather than props because its two readers sit far
// apart — App.js's title-bar Save button (the unsaved marker) and
// OperatorWorkspace's navigation handlers (the Save/Discard prompt) — and
// its writers are three editors nested several components deep.

import { useEffect, useRef, useSyncExternalStore } from 'react';

let dirty = false;
const listeners = new Set();

export const unsavedChangesStore = {
  isDirty: () => dirty,
  setDirty(next) {
    if (next === dirty) return;
    dirty = next;
    listeners.forEach(listener => listener());
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useHasUnsavedChanges() {
  return useSyncExternalStore(unsavedChangesStore.subscribe, unsavedChangesStore.isDirty);
}

// JSON with object keys sorted, so two payloads holding the same settings
// always compare equal — plain JSON.stringify depends on insertion order,
// and e.g. clearing a property's visual and setting it again moves its key
// to the end of the map.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Dirty tracking for one editor. `fields` is everything the editor's Save
// would persist EXCEPT canvas positions. `positions` is an object of named
// position maps, one per manual-layout canvas the editor has (e.g.
// { cards: {...}, diagram: {...} }), each null while that canvas isn't in
// manual mode.
//
// Fields are compared against their values at mount (which are exactly the
// saved template's, since every editor seeds its state from it).
//
// Positions can't be compared that way. A canvas reports its node
// positions several times while it settles (seeding, measuring, fitting),
// rounded and including any newly-visible node at its default spot, so the
// reports routinely differ from what was saved without the user touching
// anything. So until the user first interacts with the editor, every
// report simply becomes the new baseline — pass the canvas's reports
// through notePositionsReported(channel, map), and wire noteUserInput()
// to the editor root's pointer/key-down (capture phase). After that, a
// node counts as moved if it's in both the baseline and the current map at
// a different spot. Nodes appearing or disappearing (a property's
// visibility toggled in the Details panel, which saves immediately on its
// own) don't count.
//
// Changing a setting and changing it back is clean again, not dirty.
// Returns stable handles: markSaved() (call right after saving, to make
// the current state the new baseline), notePositionsReported(),
// noteUserInput().
function positionsMoved(baseline, current) {
  if (!baseline || !current) return false;
  return Object.keys(current).some(key => {
    const a = baseline[key];
    const b = current[key];
    return a && b && (Math.round(a.x) !== Math.round(b.x) || Math.round(a.y) !== Math.round(b.y));
  });
}

export function useUnsavedTracker(fields, positions, enabled = true) {
  const fieldsJson = stableStringify(fields);

  const fieldsBaselineRef = useRef(fieldsJson);
  const positionsBaselineRef = useRef({});
  const userInputSeenRef = useRef(false);
  const latestRef = useRef({ fieldsJson, positions });
  latestRef.current = { fieldsJson, positions };

  const positionsDirty = Object.entries(positions || {}).some(([channel, map]) => (
    map != null && positionsMoved(positionsBaselineRef.current[channel], map)
  ));
  const isDirty = enabled && (fieldsJson !== fieldsBaselineRef.current || positionsDirty);

  useEffect(() => {
    if (enabled) unsavedChangesStore.setDirty(isDirty);
  }, [enabled, isDirty]);
  useEffect(() => () => { if (enabled) unsavedChangesStore.setDirty(false); }, [enabled]);

  const handlesRef = useRef(null);
  if (!handlesRef.current) {
    handlesRef.current = {
      markSaved: () => {
        fieldsBaselineRef.current = latestRef.current.fieldsJson;
        Object.entries(latestRef.current.positions || {}).forEach(([channel, map]) => {
          if (map) positionsBaselineRef.current[channel] = map;
        });
        unsavedChangesStore.setDirty(false);
      },
      notePositionsReported: (channel, map) => {
        if (!userInputSeenRef.current || !positionsBaselineRef.current[channel]) {
          positionsBaselineRef.current[channel] = map;
        }
      },
      noteUserInput: () => { userInputSeenRef.current = true; },
    };
  }
  return handlesRef.current;
}
