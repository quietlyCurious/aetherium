// Click actions.
// Classic native widgets keep   actions: [{ action, value, source }]
// New plugins keep the runtime  multiActions.commands[{ commandId:'onClicked', commandActions:[…] }]
// plus a property-panel mirror  schema.data.__commands.onClicked.commandActions (bindings for sources).
// The per-action runtime shape is the same in both designers.

import { deepClone } from './util.js';
import { toPluginBinding } from './bindings.js';
import { SEVERITY } from './report.js';

const SHOW_HIDE = new Set(['showComponent', 'hideComponent']);
const SEEN_IN_NEW_DESIGNER = new Set(['setGlobal', 'submit', 'url', 'page', 'gotopreviouspage']);
const ACTION_NAMES = {
  showComponent: 'Show component', hideComponent: 'Hide component', setGlobal: 'Set global',
  submit: 'Submit query', url: 'Open URL', page: 'Go to page', gotopreviouspage: 'Go to previous page',
};
const actionName = (a) => ACTION_NAMES[a] || a;

function runtimeSource(source) {
  if (!source || typeof source !== 'object') return source ?? null;
  return { type: source.type, value: source.value };
}

/**
 * Re-point show/hide actions whose target was a container that no longer exists.
 * A container that became a card keeps its id, so only nested containers need expanding.
 * Returns the (possibly longer) list of actions.
 */
export function expandShowHideTargets(actions, ctx, notes) {
  const out = [];
  for (const a of actions || []) {
    if (!SHOW_HIDE.has(a?.action)) { out.push(a); continue; }
    const target = typeof a.value === 'string' ? a.value : a.value?.id;
    const widgets = ctx.flattenedContainers.get(target);
    if (!widgets) { out.push(a); continue; }
    if (!widgets.length) {
      notes?.push({ severity: SEVERITY.WARN, text: `A "${actionName(a.action)}" action targeted a container with no migratable widgets; action dropped.` });
      continue;
    }
    for (const wid of widgets) out.push({ ...deepClone(a), value: wid });
    notes?.push({ severity: SEVERITY.INFO, text: `A "${actionName(a.action)}" action on a nested container now targets its ${widgets.length} widget(s) individually.` });
  }
  return out;
}

/** Classic native actions -> runtime commandActions, with notes for anything to verify. */
export function toCommandActions(classicActions, ctx, notes) {
  const expanded = expandShowHideTargets(classicActions, ctx, notes);
  const flagged = new Set();
  return expanded.map((a) => {
    if (!SEEN_IN_NEW_DESIGNER.has(a.action) && !flagged.has(a.action)) {
      flagged.add(a.action);
      notes?.push({ severity: SEVERITY.WARN, text: `"${actionName(a.action)}" actions were not seen in any new-designer sample; verify they still fire.` });
    }
    const out = { action: a.action };
    if (a.value !== undefined && a.value !== '') out.value = deepClone(a.value);
    if (a.source !== undefined && a.action !== 'submit') out.source = runtimeSource(a.source);
    if (a.action === 'setGlobal' || a.action === 'url') out.newTab = a.newTab ?? null;
    return out;
  });
}

/** Property-panel mirror of runtime actions (sources become plugin bindings). */
function toPanelActions(commandActions, ctx, notes) {
  return commandActions.map((a) => {
    const out = { action: a.action };
    if (a.action === 'setGlobal') {
      out.source = toPluginBinding(ctx, a.source, notes);
      out.global = JSON.stringify(a.value || {});
    } else if (a.action === 'url') {
      out.source = toPluginBinding(ctx, a.source, notes);
      out.newTab = a.newTab ?? false;
    } else if (a.value !== undefined) {
      out.value = deepClone(a.value);
    }
    return out;
  });
}

/**
 * Build both halves of a click command for a plugin.
 * @returns {{ multiActions, commandsPanel }}
 */
export function buildClickCommand(classicActions, ctx, notes) {
  const commandActions = toCommandActions(classicActions, ctx, notes);
  return {
    multiActions: {
      commands: [{ commandTitle: 'Click Event', commandId: 'onClicked', commandActions }],
    },
    commandsPanel: { onClicked: commandActions.length ? { commandActions: toPanelActions(commandActions, ctx, notes) } : {} },
  };
}
