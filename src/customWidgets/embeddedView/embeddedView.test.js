// customWidgets/embeddedView/embeddedView.test.js
//   npx react-scripts test --watchAll=false src/customWidgets/embeddedView

import {
  runtimeUrl, parseRuntimeUrl, parametersFromDefinition, parameterPropertyDefs, paramValueToText, sameParameters,
} from './thingworxEmbed';
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
