// customWidgets/embeddedView/embeddedView.test.js
//   npx react-scripts test --watchAll=false src/customWidgets/embeddedView

import { runtimeUrl, parseRuntimeUrl, parametersFromDefinition } from './thingworxEmbed';
import { parameterPropertyDefs, paramValueToText, sameParameters, declaredParametersOf } from './viewParameters';
import { parsePageUrl, pageUrl, pagePathFor } from './ophubEmbed';
import { getContainerPropertyDefs, getContainerPropertyDef, orphanedDynamicBindings } from '../../designer/widgets/widgetPropertyDefs';
import { resolveWidgetProps, hasBrokenBinding } from '../../designer/screens/widgetBindings';

const FSU_URL = 'https://pp-2605181716jy.portal.ptc.io/Thingworx/Runtime/index.html?mashup=PTC.FSU.COREUI.MenuConfiguration.MasterContainer_EP#master=PTC.FSU.COREUI.MenuConfiguration.MasterContainer_MS&mashup=PTC.FSU.COREUI.MenuConfiguration.MasterContainer_EP';
const DECLARED = [
  { name: 'Site', baseType: 'STRING' },
  { name: 'Limit', baseType: 'INTEGER' },
  { name: 'Live', baseType: 'BOOLEAN' },
  { name: 'Rows', baseType: 'INFOTABLE' },
];

describe('runtime URL', () => {
  test('master first, then mashup, then declared parameters', () => {
    const url = runtimeUrl({ mashupName: 'Pump Overview', master: 'Frame', params: { Site: 'Plant 1', Limit: 5, Stale: 'x' }, declared: DECLARED });
    expect(url).toBe('/Thingworx/Runtime/index.html#master=Frame&mashup=Pump%20Overview&Site=Plant%201&Limit=5');
  });

  test('blank values are left to the mashup’s defaults; no mashup, no URL', () => {
    expect(runtimeUrl({ mashupName: 'M', params: { Site: '', Limit: null }, declared: DECLARED })).toBe('/Thingworx/Runtime/index.html#mashup=M');
    expect(runtimeUrl({ mashupName: '' })).toBeNull();
  });

  test('values become text', () => {
    expect(paramValueToText(false)).toBe('false');
    expect(paramValueToText(0)).toBe('0');
    expect(paramValueToText({ a: 1 })).toBe('{"a":1}');
  });

  test('a pasted runtime URL — mashup in both query and hash', () => {
    expect(parseRuntimeUrl(FSU_URL)).toEqual({
      mashupName: 'PTC.FSU.COREUI.MenuConfiguration.MasterContainer_EP',
      master: 'PTC.FSU.COREUI.MenuConfiguration.MasterContainer_MS',
      params: {},
    });
    expect(parseRuntimeUrl('https://x/Thingworx/Runtime/index.html#mashup=A&Site=P1').params).toEqual({ Site: 'P1' });
    expect(parseRuntimeUrl('not a url')).toBeNull();
  });
});

describe('parameters', () => {
  test('read from either place a definition keeps them', () => {
    expect(parametersFromDefinition({ parameterDefinitions: { Site: { name: 'Site', baseType: 'STRING', aspects: { defaultValue: 'P1' } } } }))
      .toEqual([{ name: 'Site', baseType: 'STRING', description: '', defaultValue: 'P1' }]);
    expect(parametersFromDefinition({ mashupContent: JSON.stringify({ Parameters: [{ ParameterName: 'Asset', BaseType: 'THINGNAME' }] }) }))
      .toEqual([{ name: 'Asset', baseType: 'THINGNAME', description: '', defaultValue: null }]);
    expect(parametersFromDefinition({})).toEqual([]);
  });

  test('become properties, typed, minus tables', () => {
    expect(parameterPropertyDefs(DECLARED).map(d => [d.name, d.type])).toEqual([
      ['params.Site', 'string'], ['params.Limit', 'number'], ['params.Live', 'bool'],
    ]);
  });

  test('a change is a name or type change', () => {
    expect(sameParameters(DECLARED, [...DECLARED])).toBe(true);
    expect(sameParameters(DECLARED, DECLARED.slice(1))).toBe(false);
  });
});

describe('an Embedded View in the designer', () => {
  const widgetProps = { mashupName: 'M', mashupParameters: DECLARED.slice(0, 2), 'params.Site': 'P1' };

  test('its parameters are properties of that one widget', () => {
    const names = getContainerPropertyDefs('EmbeddedView', widgetProps).map(d => d.name);
    expect(names).toEqual(['designPreview', 'params.Site', 'params.Limit']);
    expect(getContainerPropertyDefs('EmbeddedView', {}).map(d => d.name)).toEqual(['designPreview']);
    expect(getContainerPropertyDef('EmbeddedView', widgetProps, 'params.Limit')).toMatchObject({ type: 'number', label: 'Limit' });
    // Other widgets are unaffected.
    expect(getContainerPropertyDefs('CircularGauge', widgetProps).some(d => d.name.startsWith('params.'))).toBe(false);
  });

  test('bound parameters resolve into one params object', () => {
    const bindings = { 'params.Limit': { type: 'expression', expression: '2 + 3' } };
    const resolved = resolveWidgetProps(widgetProps, bindings, 'EmbeddedView', {});
    expect(resolved.params).toEqual({ Site: 'P1', Limit: 5 });
  });

  test('a binding to a parameter the mashup dropped is broken', () => {
    const bindings = { 'params.Gone': { type: 'expression', expression: '1' }, 'params.Site': { type: 'expression', expression: '"P2"' } };
    expect(orphanedDynamicBindings('EmbeddedView', widgetProps, bindings)).toEqual(['params.Gone']);
    expect(hasBrokenBinding(bindings, 'EmbeddedView', { widgetProps })).toBe(true);
    expect(hasBrokenBinding({ 'params.Site': bindings['params.Site'] }, 'EmbeddedView', { widgetProps })).toBe(false);
  });
});

describe('the widget draws', () => {
  // Imported here so the tests above don't need a DOM.
  const { render } = require('@testing-library/react');
  const { EmbeddedViewWidget } = require('./EmbeddedViewWidget');
  const props = { mashupName: 'PumpOverview', mashupParameters: [{ name: 'Site', baseType: 'STRING' }], params: { Site: 'P1' } };
  // The widget watches its mashup for changes; no ThingWorx here.
  beforeEach(() => { global.fetch = jest.fn(() => new Promise(() => {})); });
  afterEach(() => { delete global.fetch; });

  test('a prompt until a mashup is chosen', () => {
    const { container, getByText } = render(<EmbeddedViewWidget designMode />);
    expect(getByText(/Choose a mashup/)).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('live in the designer: the mashup, under an overlay', () => {
    const { container } = render(<EmbeddedViewWidget {...props} designMode />);
    expect(container.querySelector('iframe').getAttribute('src')).toBe('/Thingworx/Runtime/index.html#mashup=PumpOverview&Site=P1');
    expect(container.querySelector('.ae-embed-overlay')).not.toBeNull();
  });

  test('placeholder in the designer, live in Runtime', () => {
    const design = render(<EmbeddedViewWidget {...props} designPreview="placeholder" designMode />);
    expect(design.container.querySelector('iframe')).toBeNull();
    expect(design.getByText('PumpOverview')).toBeTruthy();
    const runtime = render(<EmbeddedViewWidget {...props} designPreview="placeholder" />);
    expect(runtime.container.querySelector('iframe')).not.toBeNull();
    expect(runtime.container.querySelector('.ae-embed-overlay')).toBeNull();
  });
});

describe('editing in ThingWorx', () => {
  const { composerUrl } = require('./thingworxEmbed');

  test('Composer links match the real ones', () => {
    expect(composerUrl('https://pp-2605181716jy.portal.ptc.io', 'PTC.FSU.CWC.Execution.LogSheet_MU'))
      .toBe('https://pp-2605181716jy.portal.ptc.io/Thingworx/Composer/index.html#/modeler/details/Mashup~PTC.FSU.CWC.Execution.LogSheet_MU/design');
    expect(composerUrl('https://twx.example/', 'Pump Overview'))
      .toBe('https://twx.example/Thingworx/Composer/index.html#/modeler/details/Mashup~Pump%20Overview/design');
    expect(composerUrl(null, 'M')).toBeNull();
  });

  describe('a mashup changed in Composer', () => {
    let definitions;
    let revisions;
    beforeEach(() => {
      jest.resetModules();
      definitions = { A: { lastModifiedDate: 1 }, B: { lastModifiedDate: 1 } };
      global.fetch = jest.fn(async (url) => {
        const name = decodeURIComponent(url.split('/').pop());
        return { ok: true, status: 200, text: async () => JSON.stringify(definitions[name]) };
      });
      revisions = require('./mashupRevisions');
    });
    afterEach(() => { delete global.fetch; });
    const settle = () => new Promise(r => setTimeout(r, 0));

    test('only the changed one gets a new revision', async () => {
      const stopA = revisions.watchMashup('A');
      revisions.watchMashup('B');
      await settle();                         // baselines captured
      expect(await revisions.checkWatchedMashups({ force: true })).toBe(false);
      definitions.A = { lastModifiedDate: 2 };  // saved in Composer
      expect(await revisions.checkWatchedMashups({ force: true })).toBe(true);
      expect(await revisions.checkWatchedMashups({ force: true })).toBe(false);  // and only once
      stopA();
    });

    test('coming back to the tab is what checks', async () => {
      revisions.watchMashup('A');
      await settle();
      definitions.A = { lastModifiedDate: 3 };
      const before = global.fetch.mock.calls.length;
      window.dispatchEvent(new Event('focus'));
      await settle(); await settle();
      expect(global.fetch.mock.calls.length).toBeGreaterThan(before);
    });
  });
});

describe('Operations Hub pages', () => {
  const REAL = 'https://mes.gedemo.io/run/v2/app-name/_HMI%20Screens/page-name/NuclearPartial';

  test('a pasted page URL keeps its own path', () => {
    expect(parsePageUrl(REAL)).toEqual({
      appName: '_HMI Screens', pageName: 'NuclearPartial',
      pagePath: '/run/v2/app-name/_HMI%20Screens/page-name/NuclearPartial', params: {},
    });
    expect(parsePageUrl(`${REAL}?Unit=U2&Mode=live`).params).toEqual({ Unit: 'U2', Mode: 'live' });
    expect(parsePageUrl('https://mes.gedemo.io/run/v2/Plant/Overview')).toMatchObject({ appName: 'Plant', pageName: 'Overview' });
    expect(parsePageUrl('https://mes.gedemo.io/iqp/')).toBeNull();
  });

  test('a classic run-mode URL, as OpHub opens it', () => {
    const CLASSIC = 'https://mes.gedemo.io/run/?app_name=_Injection%20Molding&page_name=OEE%20Dashboard';
    expect(parsePageUrl(CLASSIC)).toEqual({ appName: '_Injection Molding', pageName: 'OEE Dashboard', pagePath: null, params: {} });
    expect(parsePageUrl(`${CLASSIC}&Line=L2`).params).toEqual({ Line: 'L2' });
    // Names build that same URL again.
    expect(`https://mes.gedemo.io${pagePathFor('_Injection Molding', 'OEE Dashboard')}`).toBe(CLASSIC);
  });

  test('served from the proxy’s embed port, parameters in the query string', () => {
    const declared = [{ name: 'Unit', baseType: 'STRING' }];
    expect(pageUrl({ embedUrl: 'http://localhost:4100', appName: 'A', pageName: 'P', params: { Unit: 'U 2', Other: 'x' }, declared }))
      .toBe('http://localhost:4100/run/?app_name=A&page_name=P&Unit=U%202');
    expect(pageUrl({ embedUrl: 'http://localhost:4100', pagePath: '/run/v2/app-name/A/page-name/P', params: { Unit: 'U2' }, declared }))
      .toBe('http://localhost:4100/run/v2/app-name/A/page-name/P?Unit=U2');
    expect(pageUrl({ embedUrl: 'http://localhost:4100/', pagePath: '/run/v2/odd/path' })).toBe('http://localhost:4100/run/v2/odd/path');
    expect(pageUrl({ embedUrl: null, appName: 'A', pageName: 'P' })).toBeNull();
  });

  test('each source keeps its own parameters', () => {
    const props = { mashupParameters: [{ name: 'Site' }], pageParameters: [{ name: 'Unit' }] };
    expect(declaredParametersOf(props).map(p => p.name)).toEqual(['Site']);
    expect(declaredParametersOf({ ...props, source: 'ophub' }).map(p => p.name)).toEqual(['Unit']);
    expect(getContainerPropertyDefs('EmbeddedView', { ...props, source: 'ophub' }).map(d => d.name)).toEqual(['designPreview', 'params.Unit']);
  });

  describe('the widget', () => {
    const { render, findByText } = require('@testing-library/react');
    const { EmbeddedViewWidget } = require('./EmbeddedViewWidget');
    const CONNECTION = { id: 'c1', kind: 'ophub', name: 'Demo', proxyUrl: 'http://localhost:4000' };
    beforeEach(() => {
      window.localStorage.setItem('aetherium_connections', JSON.stringify([CONNECTION]));
    });
    afterEach(() => {
      window.localStorage.removeItem('aetherium_connections');
      delete global.fetch;
    });

    test('shows the page from the proxy’s embed port', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ embedUrl: 'http://localhost:4100', cookieConfigured: true }) }));
      const { container } = render(<EmbeddedViewWidget source="ophub" appName="Plant" pageName="Overview" pageParameters={[{ name: 'Unit' }]} params={{ Unit: 'U2' }} />);
      await findByText(container, /Loading Overview/);
      expect(container.querySelector('iframe').getAttribute('src')).toBe('http://localhost:4100/run/?app_name=Plant&page_name=Overview&Unit=U2');
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/ophub-embed/info', expect.anything());
    });

    test('says when the proxy can’t serve OpHub pages', async () => {
      // Another proxy: the info is cached per proxy for the session.
      window.localStorage.setItem('aetherium_connections', JSON.stringify([{ ...CONNECTION, proxyUrl: 'http://localhost:4001' }]));
      global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
      const { container } = render(<EmbeddedViewWidget source="ophub" connectionId="c1" appName="Plant2" pageName="Overview" designMode />);
      await findByText(container, /hook up ophubEmbed.js/);
      expect(container.querySelector('iframe')).toBeNull();
    });
  });
});

describe('browsing OpHub apps and pages', () => {
  const { parseApps, parseAppDetails, urlGlobalsForPage, ophubEditUrl } = require('./ophubEmbed');
  const { render, waitFor } = require('@testing-library/react');
  const { OphubSourceDetails } = require('./OphubSourceDetails');
  const PAGE_ID = '5b561545-585d-4059-aef9-d94e1feff4e6';
  const APP_ID = '71882868-f7d0-4b4a-befb-3374fe87cf09';
  // Shaped like the app package export: items as a JSON string, pages and
  // globals mixed in it.
  const DETAILS = {
    app: {
      UUID: APP_ID, appName: 'Plant',
      items: JSON.stringify([
        { globals: [
          { name: 'Unit', type: 'url', dataType: 'String', pageId: PAGE_ID, appGlobal: false },
          { name: 'Limit', type: 'url', dataType: 'Number', pageId: 'other-page', appGlobal: false },
          { name: 'Shift', type: 'url', dataType: 'String', appGlobal: true },
          { name: 'picked', type: 'floating', dataType: 'String', pageId: PAGE_ID,
            dependencies: [{ pageId: PAGE_ID, name: 'not a page' }] },
        ] },
        { page_id: PAGE_ID, name: 'Overview', displayName: 'Plant Overview' },
        { page_id: 'other-page', name: 'Detail', displayName: 'Detail' },
      ]),
    },
  };

  test('apps, from a real get_apps answer', () => {
    const real = {
      status: { success: true, code: 0, reason: 'Ok' },
      app_headers: [
        { app_id: APP_ID, version: 119, name: 'RMC MES_Copy_Classic', items: [{ globals: [{ type: 'component', pageId: 'p', name: 'x' }] }] },
        { app_id: 'b', name: 'Alpha', items: [] },
      ],
    };
    expect(parseApps(real)).toEqual([{ id: 'b', name: 'Alpha' }, { id: APP_ID, name: 'RMC MES_Copy_Classic' }]);
    // The package export's names too.
    expect(parseApps({ apps: [{ appId: 1108, UUID: 'c', appName: 'Plant' }] })).toEqual([{ id: 'c', name: 'Plant' }]);
  });

  test('pages and globals, from inside a JSON-string items list', () => {
    const { pages, globals } = parseAppDetails(DETAILS);
    expect(pages.map(p => p.displayName)).toEqual(['Detail', 'Plant Overview']);
    expect(globals.map(g => g.name).sort()).toEqual(['Limit', 'Shift', 'Unit', 'picked']);
  });

  test('a page’s URL Globals: its own and the app-wide ones, not custom globals', () => {
    const { globals } = parseAppDetails(DETAILS);
    expect(urlGlobalsForPage(globals, PAGE_ID)).toEqual([
      { name: 'Shift', baseType: 'STRING', fromOphub: true },
      { name: 'Unit', baseType: 'STRING', fromOphub: true },
    ]);
    expect(urlGlobalsForPage(globals, 'other-page').map(p => [p.name, p.baseType])).toEqual([['Limit', 'NUMBER'], ['Shift', 'STRING']]);
  });

  test('Edit opens the classic designer on the page', () => {
    expect(ophubEditUrl('https://mes.gedemo.io', APP_ID, PAGE_ID))
      .toBe(`https://mes.gedemo.io/iqp/#/app/${APP_ID}/pages/${PAGE_ID}`);
    expect(ophubEditUrl('https://mes.gedemo.io', APP_ID, null)).toBeNull();
  });

  test('a pasted page is looked up, getting its ids and URL Globals', async () => {
    // A proxy no other test uses, so nothing is cached for it yet.
    window.localStorage.setItem('aetherium_connections', JSON.stringify([{ id: 'c1', kind: 'ophub', proxyUrl: 'http://localhost:4002' }]));
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).endsWith('/ophub-embed/info')) return { ok: true, status: 200, json: async () => ({ embedUrl: 'http://localhost:4100', ophubBaseUrl: 'https://mes.gedemo.io', cookieConfigured: true }) };
      const command = JSON.parse(decodeURIComponent(String(init.body).replace(/^data=/, '').replace(/\+/g, ' '))).command;
      // get_apps as OpHub really answers; get_app_details with nothing usable,
      // so the pages and globals have to come from the app's header.
      const body = command === 'get_apps'
        ? { status: { success: true }, app_headers: [{ app_id: APP_ID, name: 'Plant', items: DETAILS.app.items }] }
        : { status: { success: true } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    const updates = [];
    const editor = { updateWidgetProps: (_id, changes) => updates.push(changes), clearWidgetBinding: () => {} };
    const container = { id: 'w1', widgetProps: { source: 'ophub', appName: 'Plant', pageName: 'Overview', pageParameters: [{ name: 'Mine', baseType: 'STRING', byHand: true }] } };
    render(<OphubSourceDetails container={container} editor={editor} />);
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates[0]).toMatchObject({ appId: APP_ID, pageId: PAGE_ID });
    expect(updates[0].pageParameters.map(p => p.name)).toEqual(['Shift', 'Unit', 'Mine']);
    window.localStorage.removeItem('aetherium_connections');
    delete global.fetch;
  });
});

describe('browsing: app first, then its pages', () => {
  const { render, waitFor } = require('@testing-library/react');
  const { OphubSourceDetails } = require('./OphubSourceDetails');
  const APP = 'app-1';
  const ITEMS = JSON.stringify([
    { globals: [{ name: 'Unit', type: 'url', dataType: 'String', appGlobal: true }] },
    { page_id: 'p1', name: 'Overview', displayName: 'Plant Overview' },
    { page_id: 'p2', name: 'Detail', displayName: 'Detail' },
  ]);

  test('the page list arrives, even though the panel redraws while it loads', async () => {
    window.localStorage.setItem('aetherium_connections', JSON.stringify([{ id: 'c9', kind: 'ophub', proxyUrl: 'http://localhost:4009' }]));
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).endsWith('/ophub-embed/info')) return { ok: true, status: 200, json: async () => ({ embedUrl: 'http://localhost:4100', ophubBaseUrl: 'https://x', cookieConfigured: true }) };
      const command = JSON.parse(decodeURIComponent(String(init.body).replace(/^data=/, '').replace(/\+/g, ' '))).command;
      const body = command === 'get_apps'
        ? { status: { success: true }, app_headers: [{ app_id: APP, name: 'Plant', items: ITEMS }] }
        : { status: { success: true } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    const editor = { updateWidgetProps: () => {}, clearWidgetBinding: () => {} };
    // An app but no page yet: the browser is open on that app.
    const container = { id: 'w9', widgetProps: { source: 'ophub', appId: APP } };
    const { container: dom } = render(<OphubSourceDetails container={container} editor={editor} />);
    await waitFor(() => expect(dom.querySelector('[data-dx_placeholder="2 pages — choose one…"]')).not.toBeNull());
    // App comes before Page.
    const labels = [...dom.querySelectorAll('.details-grid-label')].map(l => l.textContent);
    expect(labels.indexOf('App')).toBeLessThan(labels.indexOf('Page'));
    window.localStorage.removeItem('aetherium_connections');
    delete global.fetch;
  });
});
