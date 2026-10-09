// Structural validation of a converted (new-designer) package.
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export const problems = [];
const fail = (app, msg) => problems.push(`[${app}] ${msg}`);

function* walk(c) { yield c; for (const x of c.components || []) if (x && typeof x === 'object') yield* walk(x); }

function* findKey(o, key) {
  if (Array.isArray(o)) for (const v of o) yield* findKey(v, key);
  else if (o && typeof o === 'object') {
    if (key in o) yield o;
    for (const v of Object.values(o)) yield* findKey(v, key);
  }
}

export async function validate(appName, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xmlEntry = Object.values(zip.files).find((f) => /\.xml$/.test(f.name) && !f.name.includes('/'));
  if (!xmlEntry) return fail(appName, 'no root XML in output');
  const doc = new DOMParser().parseFromString(await xmlEntry.async('string'), 'text/xml');
  const app = doc.getElementsByTagName('App')[0];
  const text = (el, t) => el.getElementsByTagName(t)[0]?.textContent;
  if (text(app, 'created_with_confighub') !== 'true') fail(appName, 'created_with_confighub not true');
  const items = JSON.parse(text(app, 'items'));
  const globals = items.find((x) => x.globals).globals;
  const globalIds = new Set(globals.map((g) => g.id));
  for (const g of globals) if (!['floating', 'system', 'plugin'].includes(g.type)) fail(appName, `global ${g.name} has type ${g.type}`);
  const pageUuids = new Set([...doc.getElementsByTagName('Page')].map((p) => text(p, 'UUID')));
  for (const it of items) if (it.page_id && !pageUuids.has(it.page_id)) fail(appName, `menu item ${it.name} points at missing page`);
  for (const g of globals) if (g.pageId && !pageUuids.has(g.pageId)) fail(appName, `global ${g.name} pageId not a page`);

  for (const p of doc.getElementsByTagName('Page')) {
    const name = text(p, 'pageName');
    if (text(p, 'app_uuid') !== text(app, 'UUID')) fail(appName, `${name}: app_uuid mismatch`);
    const comps = JSON.parse(text(p, 'components'));
    const flows = JSON.parse(text(p, 'flows'));
    const flowIds = new Set(flows.map((f) => f.flow_metadata.flowInstanceId));
    if (comps.length !== 1 || !comps[0].isRootContainer) { fail(appName, `${name}: bad root`); continue; }
    const grid = comps[0].components[0];
    if (!grid?.gridsterOptions) { fail(appName, `${name}: no grid`); continue; }
    const ids = new Set();
    for (const card of grid.components) {
      if (card.function !== 'Card' || card.type !== 'flex_container') fail(appName, `${name}: non-card in grid`);
      ids.add(card.id);
      for (const w of card.components) {
        if (w.type !== 'embedded_html') fail(appName, `${name}: non-plugin ${w.type} in card`);
        if (ids.has(w.id)) fail(appName, `${name}: duplicate id ${w.id}`);
        ids.add(w.id);
        if (!w.pluginInfo?.typeName) fail(appName, `${name}: ${w.typeName} missing pluginInfo`);
        if (w.pluginInfo?.typeName !== w.typeName) fail(appName, `${name}: pluginInfo ${w.pluginInfo?.typeName} != ${w.typeName}`);
        if (w.schema?.data?.pluginId?.[0] !== w.id) fail(appName, `${name}: pluginId mismatch`);
        if ((w.components || []).length) fail(appName, `${name}: widget has children`);
      }
    }
    // Every show/hide action target must exist on the page.
    for (const a of findKey(comps, 'action')) {
      if (['showComponent', 'hideComponent'].includes(a.action) && typeof a.value === 'string' && !ids.has(a.value)) {
        fail(appName, `${name}: ${a.action} target ${a.value} missing`);
      }
      if (a.action === 'setGlobal' && a.value?.globalId && !globalIds.has(a.value.globalId)) {
        fail(appName, `${name}: setGlobal to unknown global ${a.value.globalId}`);
      }
    }
    // Query bindings must reference queries on the page.
    for (const q of findKey(comps, 'flowInstanceId')) {
      if (q.flowInstanceId != null && typeof q.flowInstanceId === 'number' && q.query_id && !flowIds.has(q.flowInstanceId)) {
        fail(appName, `${name}: binding to missing query #${q.flowInstanceId}`);
      }
    }
    // Global bindings must reference real globals.
    for (const b of findKey(comps, 'global')) {
      if (b.type === 'global' && b.global?.id && !globalIds.has(b.global.id)) fail(appName, `${name}: binding to unknown global ${b.global.name}`);
    }
  }
  // All non-XML entries carried over.
  return Object.values(zip.files).filter((f) => !f.dir).length;
}

