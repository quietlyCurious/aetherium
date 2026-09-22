// shell/appAreas.js
// The app's two workspaces and their areas. The title-bar menu lists the
// workspaces; the left rail lists the open workspace's areas; the Save
// button asks the open area what to say. Adding an area is one entry here
// plus the component App renders for it.
//
//   Operator Experience       one area — OperatorWorkspace, whose own rail
//                             switches between Attention, Work and Assets
//   Configuration Experience  Visualization, then the page-builder areas
//                             (Design) and the data definitions (Data), on
//                             a rail App draws
//
// Every area gives App the same handle (see App.js's areaHandles):
//   save()          — what the title-bar Save does there
//   confirmLeave()  — asked before navigating away; true (or a promise of
//                     true) means go ahead. Areas without unsaved work to
//                     lose can leave it out.
//
// `view` is the value App keeps in currentView. The Operator area and
// Visualization are one view — the same workspace, OperatorWorkspace —
// told apart by `persona`.
//
// `save` is null for areas with nothing to save; otherwise title(ctx)
// gives the button's tooltip and enabled(ctx), when present, whether it
// can be pressed. ctx = { hasUnsavedChanges, activePageId, operatorSaveAvailable }.
// `hideSave` hides the button instead of disabling it.
// `showsLaunch`: the Launch button, which opens the open screen's runtime
// view. `usesModel`: the industry model switcher applies here (elsewhere
// it's shown dimmed and can't be opened). `collapsesList`: clicking the
// area's rail item again hides or shows its list panel.

import { VisualizationRailIcon } from '../operator/icons';
import {
  ScreensRailIcon, WidgetsRailIcon, ThemeRailIcon,
  DataSourcesRailIcon, EntitiesRailIcon, QueriesRailIcon, ScriptsRailIcon,
} from './areaIcons';

const UNSAVED = 'You have unsaved changes — save them';

export const WORKSPACES = [
  { id: 'operator', label: 'Operator Experience' },
  { id: 'configurator', label: 'Configuration Experience' },
];

// Rail groups, in order, for workspaces that have more than one area.
export const RAIL_GROUPS = [
  { id: 'design', label: 'Design' },
  { id: 'data', label: 'Data' },
];

export const APP_AREAS = [
  {
    id: 'operator', workspace: 'operator', view: 'operator', persona: 'operator', label: 'Operator Experience',
    usesModel: true, save: null, hideSave: true,
  },

  {
    id: 'visualization', workspace: 'configurator', railGroup: 'design', view: 'operator', persona: 'configurator',
    label: 'Visualization', Icon: VisualizationRailIcon, usesModel: true, collapsesList: true,
    save: {
      enabled: ({ operatorSaveAvailable }) => operatorSaveAvailable,
      title: ({ operatorSaveAvailable, hasUnsavedChanges }) => !operatorSaveAvailable
        ? 'Select a type or asset in the Now area to save its display template'
        : hasUnsavedChanges
          ? UNSAVED
          : "Save this type or asset's display template (no unsaved changes)",
    },
  },
  {
    id: 'screens', workspace: 'configurator', railGroup: 'design', view: 'screens', label: 'Screens', Icon: ScreensRailIcon,
    usesModel: true, showsLaunch: true,
    save: { title: ({ hasUnsavedChanges, activePageId }) => hasUnsavedChanges ? UNSAVED : (activePageId ? 'Save this screen' : 'Save as a new screen') },
  },
  { id: 'widgets', workspace: 'configurator', railGroup: 'design', view: 'widgets', label: 'Widgets', Icon: WidgetsRailIcon, save: null },
  { id: 'theme',   workspace: 'configurator', railGroup: 'design', view: 'theme',   label: 'Theme',   Icon: ThemeRailIcon,   save: null },

  {
    id: 'datasources', workspace: 'configurator', railGroup: 'data', view: 'datasources', label: 'Data Sources', Icon: DataSourcesRailIcon,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save this data source' },
  },
  {
    id: 'entities', workspace: 'configurator', railGroup: 'data', view: 'entities', label: 'Entities', Icon: EntitiesRailIcon,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save entity data' },
  },
  {
    id: 'queries', workspace: 'configurator', railGroup: 'data', view: 'queries', label: 'Queries', Icon: QueriesRailIcon,
    save: { title: ({ hasUnsavedChanges }) => hasUnsavedChanges ? UNSAVED : 'Save this query' },
  },
  { id: 'scripts', workspace: 'configurator', railGroup: 'data', view: 'scripts', label: 'Scripts', Icon: ScriptsRailIcon, save: null },
];

// The area showing for a view (+ persona, for the OperatorWorkspace view).
export function findArea(view, persona) {
  return APP_AREAS.find(a => a.view === view && (!a.persona || a.persona === persona));
}

// A workspace's rail: its areas, grouped by RAIL_GROUPS.
export function railGroupsFor(workspaceId) {
  return RAIL_GROUPS
    .map(group => ({ ...group, items: APP_AREAS.filter(a => a.workspace === workspaceId && a.railGroup === group.id) }))
    .filter(group => group.items.length > 0);
}
