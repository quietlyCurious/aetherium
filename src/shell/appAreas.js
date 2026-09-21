// shell/appAreas.js
// The app's areas, in menu order: what each is called, which group it's
// listed in, and what the title-bar Save button says there. The area menu
// and the Save button both read this list, so adding an area is one entry
// here plus the component App renders for it.
//
// Every area gives App the same handle (see App.js's areaHandles):
//   save()          — what the title-bar Save does there
//   confirmLeave()  — asked before navigating away; true (or a promise of
//                     true) means go ahead. Areas without unsaved work to
//                     lose can leave it out.
//
// `view` is the value App keeps in currentView (and saves in
// operatorNavigationStorage). The Operator and Configurator interfaces
// are one view — the same workspace — told apart by `persona`.
//
// `save` is null for areas with nothing to save; otherwise title(ctx)
// gives the button's tooltip and enabled(ctx), when present, whether it
// can be pressed. ctx = { hasUnsavedChanges, activePageId, operatorSaveAvailable }.
// `showsLaunch`: the Launch button, which opens the open screen's runtime
// view, is shown in the page-builder areas.

const UNSAVED = 'You have unsaved changes — save them';

export const AREA_GROUPS = ['build', 'data', 'operate'];

export const APP_AREAS = [
  {
    id: 'screens', view: 'screens', label: 'Screens', group: 'build', showsLaunch: true,
    save: { title: ({ hasUnsavedChanges, activePageId }) => hasUnsavedChanges ? UNSAVED : (activePageId ? 'Save this screen' : 'Save as a new screen') },
  },
  { id: 'widgets', view: 'widgets', label: 'Widgets', group: 'build', showsLaunch: true, save: null },
  { id: 'theme',   view: 'theme',   label: 'Theme',   group: 'build', showsLaunch: true, save: null },

  {
    id: 'datasources', view: 'datasources', label: 'Data Sources', group: 'data', showsLaunch: true,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save this data source' },
  },
  {
    id: 'entities', view: 'entities', label: 'Entities', group: 'data', showsLaunch: true,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save entity data' },
  },
  {
    id: 'queries', view: 'queries', label: 'Queries', group: 'data', showsLaunch: true,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save this query' },
  },
  { id: 'scripts', view: 'scripts', label: 'Scripts', group: 'data', showsLaunch: true, save: null },

  // The Operator persona has nothing to save, and hides the button rather
  // than disabling it (hideSave).
  { id: 'operator', view: 'operator', persona: 'operator', label: 'Operator Interface', group: 'operate', save: null, hideSave: true },
  {
    id: 'configurator', view: 'operator', persona: 'configurator', label: 'Configurator Interface', group: 'operate',
    save: {
      enabled: ({ operatorSaveAvailable }) => operatorSaveAvailable,
      title: ({ operatorSaveAvailable, hasUnsavedChanges }) => !operatorSaveAvailable
        ? 'Select a type or asset in the Now area to save its display template'
        : hasUnsavedChanges
          ? UNSAVED
          : "Save this type or asset's display template (no unsaved changes)",
    },
  },
];

// The area showing for a view (+ persona, for the operator view).
export function findArea(view, persona) {
  return APP_AREAS.find(a => a.view === view && (!a.persona || a.persona === persona));
}
