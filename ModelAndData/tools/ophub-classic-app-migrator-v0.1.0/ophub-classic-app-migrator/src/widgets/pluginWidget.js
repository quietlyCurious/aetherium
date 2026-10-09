// Classic plugin widgets (embedded_html) -> the same plugin in the new designer.
// Plugin settings (schema.data) and actions carry over; the envelope is rebuilt.

import { expandShowHideTargets } from '../actions.js';
import { NEW_DESIGNER_VERIFIED } from '../pluginCatalog.js';
import { deepClone, newId } from '../util.js';
import { SEVERITY } from '../report.js';

const ENVELOPE_KEYS = ['widget', 'responsiveStyle', 'pluginId', 'changeProperty', 'isHidden', 'scopedCSS'];
const BINDING_TYPES = new Set(['manual', 'query', 'global', 'formula', 'tag']);

/** Classic editor placeholder commands (a blank submit) carry no behavior; drop them. */
function convertMultiActions(multiActions, ctx, notes) {
  if (!multiActions?.commands) return undefined;
  const out = deepClone(multiActions);
  out.commands = out.commands.filter((cmd) => cmd.commandId !== 'PROTOTYPE');
  for (const cmd of out.commands) {
    if (Array.isArray(cmd.commandActions)) cmd.commandActions = expandShowHideTargets(cmd.commandActions, ctx, notes);
  }
  return out.commands.length ? out : undefined;
}

/**
 * Bring classic plugin bindings up to the shape the new designer writes:
 * every binding gets an id, a subType, a tag block, and non-empty field/alias lists.
 */
function normalizeBindings(node) {
  if (Array.isArray(node)) { node.forEach(normalizeBindings); return; }
  if (!node || typeof node !== 'object') return;
  const isBinding = BINDING_TYPES.has(node.type) && ('query' in node || 'global' in node || 'manual' in node);
  if (isBinding) {
    node.id = node.id || newId();
    node.subType = node.subType ?? '';
    node.global = node.global || {};
    node.tag = node.tag || { outputFields: [null], outputFieldsAliases: [null] };
    node.query = node.query || {};
    if (!Array.isArray(node.query.outputFields) || !node.query.outputFields.length) node.query.outputFields = [null];
    if (!Array.isArray(node.query.outputFieldsAliases) || node.query.outputFieldsAliases.length !== node.query.outputFields.length) {
      node.query.outputFieldsAliases = node.query.outputFields.map(() => null);
    }
  }
  for (const v of Object.values(node)) normalizeBindings(v);
}

export function convertPluginWidget(classic, ctx) {
  const notes = [];
  const typeName = classic.typeName;
  const data = deepClone(classic.schema?.data || {});
  const scopedCss = classic.useScopedCss ?? data.scopedCSS ?? true;
  for (const k of ENVELOPE_KEYS) delete data[k];
  normalizeBindings(data);

  if (!ctx.catalog.manifest(typeName)) {
    notes.push({ severity: SEVERITY.WARN, text: 'Plugin zip not found in the package; plugin info rebuilt from the classic widget.' });
  }
  if (!NEW_DESIGNER_VERIFIED.has(typeName)) {
    notes.push({ severity: SEVERITY.INFO, text: 'Plugin not yet verified in the new designer (see the app-level note).' });
  }

  return {
    typeName,
    data,
    pluginInfo: ctx.catalog.pluginInfo(typeName, classic._pluginData),
    multiActions: convertMultiActions(classic.multiActions, ctx, notes),
    size: ctx.catalog.defaultSize(typeName, { width: 400, height: 300 }),
    scopedCss,
    label: classic._pluginData?.description?.title || typeName,
    notes,
  };
}
