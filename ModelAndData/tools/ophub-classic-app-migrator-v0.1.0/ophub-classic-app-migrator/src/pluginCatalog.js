// Plugin manifests and pluginInfo.
// A new-designer widget carries `pluginInfo` = the plugin's manifest.json with a few UISchema
// decorations the designer adds (conditions, responsive style, widget sizing, ordering).

import { deepClone } from './util.js';

/** Plugins observed working in new-designer sample exports. Others are copied but flagged. */
export const NEW_DESIGNER_VERIFIED = new Set([
  'DataGrid', 'GEAlarmCard', 'GEBreadcrumb', 'GEBulletGraph', 'GEDateTimeRangePicker', 'GEDropdown',
  'GEFavoriteOrganizer', 'GEHtmlEditor', 'GEIFrame', 'GESolidGauge', 'GESparkline', 'GETrendCard',
  'GEValueDisplay', 'Genealogy', 'HMI-Graphic', 'NonConformance', 'RouteEditor', 'UnitOperations',
  'WorkOrderManager', 'button', 'chartLine', 'gaugeCircular', 'gaugeLinear', 'iFIX HMI Webspace',
  'image', 'list', 'site-selector', 'text', 'textarea', 'textbox',
]);

/** Plant Apps plugins are whole-page applications; give them most of a card's width. */
const FULL_PAGE_APP = { width: 1300, height: 760 };

/** Small helper plugins that usually sit beside a Plant Apps page. */
const SIZE_HINTS = {
  'site-selector': { width: 320, height: 60 },
  AlarmNotifications: { width: 80, height: 60 },
  'uaa-token': { width: 120, height: 40 },
};

export class PluginCatalog {
  /**
   * @param reference  reference.json content (manifests for mapped targets + UISchema augment)
   * @param packageManifests  Map typeName -> manifest read from the classic package's plugins/*.zip
   */
  constructor(reference, packageManifests = new Map()) {
    this.uiAugment = reference.pluginUiSchemaAugment;
    this.manifests = new Map(Object.entries(reference.manifests));
    for (const [typeName, m] of packageManifests) this.manifests.set(typeName, m); // package wins: matches what ships
  }

  manifest(typeName) { return this.manifests.get(typeName) || null; }

  /**
   * Starting size in px for a migrated plugin widget: explicit hint, then the plugin's own
   * default, then a full-width box for Plant Apps (they are whole-page apps), then the fallback.
   */
  defaultSize(typeName, fallback = { width: 300, height: 200 }) {
    if (SIZE_HINTS[typeName]) return { ...SIZE_HINTS[typeName] };
    const m = this.manifest(typeName);
    const d = m?.defaultConfiguration || {};
    if (Number(d.defaultWidth) && Number(d.defaultHeight)) return { width: Number(d.defaultWidth), height: Number(d.defaultHeight) };
    if (m?.category === 'Plant Apps') return { ...FULL_PAGE_APP };
    return { ...fallback };
  }

  /**
   * pluginInfo for a widget. Falls back to a classic widget's own _pluginData when the
   * manifest isn't available (plugin zip missing from the package).
   */
  pluginInfo(typeName, classicPluginData) {
    const base = deepClone(this.manifest(typeName) || classicPluginData || { typeName, origin: 'custom' });
    base.schema = base.schema || { JSONSchema: {}, UISchema: {} };
    base.schema.UISchema = base.schema.UISchema || {};
    const ui = base.schema.UISchema;
    for (const key of ['conditions', 'responsiveStyle', 'widget']) {
      if (ui[key] === undefined) ui[key] = deepClone(this.uiAugment[key]);
    }
    if (!ui['ui:order']) ui['ui:order'] = deepClone(this.uiAugment['ui:order']);
    base.scripts = base.scripts || [];
    return base;
  }
}
