// Whole-package conversion: classic-designer app zip -> new-designer app zip + migration report.
// Environment-neutral: the caller supplies JSZip, DOMParser and XMLSerializer (browser globals,
// or jszip/@xmldom/xmldom under Node for testing).

import { GlobalIndex } from './bindings.js';
import { convertGlobals } from './globals.js';
import { PackageError, readPackage, readPluginManifests, writePackage } from './packageIO.js';
import { convertPage } from './pageConverter.js';
import { NEW_DESIGNER_VERIFIED, PluginCatalog } from './pluginCatalog.js';
import { MigrationReport, SEVERITY } from './report.js';
import { newId } from './util.js';

export const TOOL_VERSION = '0.1.0';
export const NEW_APP_SUFFIX = ' (New Designer)';

function child(el, tag) {
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.nodeName === tag) return n;
  return null;
}
function childText(el, tag) { return child(el, tag)?.textContent ?? ''; }
function setChildText(el, tag, text) {
  let c = child(el, tag);
  if (!c) { c = el.ownerDocument.createElement(tag); el.appendChild(c); }
  c.textContent = text;
}
function parseJson(text, what) {
  try { return text ? JSON.parse(text) : []; } catch { throw new PackageError(`Could not read ${what}; the package XML may be damaged.`); }
}

/** One app-level warning listing plugins that haven't been seen working in the new designer. */
function noteUnverifiedPlugins(report) {
  const counts = new Map();
  for (const p of report.pages) {
    for (const w of p.widgets) {
      if (w.outcome === 'skipped' || NEW_DESIGNER_VERIFIED.has(w.targetType)) continue;
      counts.set(w.targetType, (counts.get(w.targetType) || 0) + 1);
    }
  }
  if (!counts.size) return;
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ');
  report.note(`These plugins were carried over but haven't been seen in a new-designer app yet, so check each renders after import: ${list}.`, SEVERITY.WARN);
}

/** File-name form of an app name, matching how Operations Hub names its exports. */
export function packageFileBase(appName) {
  return `${appName}_IQPAppPackage`;
}

/**
 * @param deps    { JSZip, DOMParser, XMLSerializer, reference }
 * @param input   { bytes, fileName }
 * @param options { asNewApp = true, onProgress(stage, pct) }
 * @returns {Promise<{ bytes, outputFileName, report: MigrationReport }>}
 */
export async function convertPackage(deps, input, options = {}) {
  const { JSZip, DOMParser, XMLSerializer, reference } = deps;
  const { asNewApp = true, onProgress = () => {}, outputType = 'uint8array' } = options;

  await onProgress('Reading package', 0);
  const pkg = await readPackage(JSZip, input.bytes);
  const doc = new DOMParser().parseFromString(pkg.xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new PackageError('The package XML could not be parsed.');

  const app = doc.getElementsByTagName('App')[0];
  if (!app) throw new PackageError('The package contains no app.');
  if (childText(app, 'created_with_confighub') === 'true') {
    throw new PackageError('This app was already built with the new designer; there is nothing to migrate.');
  }

  const appName = childText(app, 'appName');
  const newAppName = asNewApp ? `${appName}${NEW_APP_SUFFIX}` : appName;
  const outputFileName = `${packageFileBase(newAppName).replace(/ /g, '+')}.zip`;
  const report = new MigrationReport({ sourceFileName: input.fileName, outputFileName, toolVersion: TOOL_VERSION });
  report.appName = appName;

  await onProgress('Reading plugins', 10);
  const packageManifests = await readPluginManifests(JSZip, pkg.zip);
  const catalog = new PluginCatalog(reference, packageManifests);
  report.plugins = [...packageManifests.keys()].sort().map((typeName) => ({
    typeName,
    status: NEW_DESIGNER_VERIFIED.has(typeName) ? 'verified' : 'unverified',
  }));

  // App items: [ {globals:[…]}, …page menu entries ]
  const items = parseJson(childText(app, 'items'), 'the app definition');
  const globalsEntry = items.find((x) => x && Array.isArray(x.globals));
  const { globals, componentGlobalIds } = convertGlobals(globalsEntry?.globals || [], report);
  if (globalsEntry) globalsEntry.globals = globals;
  const appCtx = { reference, catalog, globals: new GlobalIndex(globals), componentGlobalIds };

  // Pages, in menu order where possible so the report reads like the app.
  const pageEls = [...doc.getElementsByTagName('Page')];
  const menuOrder = new Map(items.filter((x) => x?.page_id).map((x, i) => [x.page_id, i]));
  pageEls.sort((a, b) => (menuOrder.get(childText(a, 'UUID')) ?? 1e9) - (menuOrder.get(childText(b, 'UUID')) ?? 1e9));

  for (const [i, pageEl] of pageEls.entries()) {
    const name = childText(pageEl, 'pageName');
    await onProgress(`Converting page ${i + 1} of ${pageEls.length}: ${name}`, 15 + Math.round((60 * i) / Math.max(1, pageEls.length)));
    const pageReport = report.page(name);
    try {
      const converted = convertPage(
        { components: parseJson(childText(pageEl, 'components'), `page "${name}"`), flows: parseJson(childText(pageEl, 'flows'), `queries on page "${name}"`) },
        appCtx,
        pageReport,
      );
      setChildText(pageEl, 'components', JSON.stringify(converted.components));
      setChildText(pageEl, 'flows', JSON.stringify(converted.flows));
    } catch (e) {
      if (e instanceof PackageError) throw e;
      pageReport.note(`This page could not be converted (${e.message}); it was left empty.`, SEVERITY.WARN);
      setChildText(pageEl, 'components', '[]');
    }
  }

  noteUnverifiedPlugins(report);

  setChildText(app, 'items', JSON.stringify(items));
  setChildText(app, 'created_with_confighub', 'true');
  setChildText(app, 'app_descriptor', '{}');
  setChildText(app, 'appName', newAppName);

  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml;

  if (asNewApp) {
    // Fresh identity so importing never overwrites the classic app on the same server.
    const ids = [childText(app, 'UUID'), ...pageEls.map((p) => childText(p, 'UUID'))].filter(Boolean);
    for (const oldId of ids) xml = xml.split(oldId).join(newId());
    report.note(`Imported as a separate app named "${newAppName}" with new ids, so the classic app is left untouched.`);
  }

  await onProgress('Writing new package', 80);
  const bytes = await writePackage(JSZip, pkg.zip, {
    xmlEntryName: pkg.xmlEntryName,
    newXmlName: `${packageFileBase(newAppName)}.xml`,
    newXmlText: xml,
  }, { outputType, onProgress: (pct) => onProgress('Writing new package', 80 + Math.round(pct * 0.2)) });

  await onProgress('Done', 100);
  return { bytes, outputFileName, report };
}
