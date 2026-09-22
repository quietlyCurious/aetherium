import { loadWidgetOptions, widgetOptionsStore, setWidgetOptionsForTest } from './widgetOptionsFile';

function freshModule() {
  let mod;
  jest.isolateModules(() => { mod = require('./widgetOptionsFile'); });
  return mod;
}

afterEach(() => { delete global.fetch; });

test('a loaded file becomes the ready state, and is fetched once', async () => {
  const file = { devextremeVersion: '25.2.10', generatedAt: '2026-09-22', widgets: { Switch: [{ n: 'value', t: 'bool' }] } };
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(file) }));
  const mod = freshModule();
  await mod.loadWidgetOptions();
  await mod.loadWidgetOptions();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const state = mod.widgetOptionsStore.getSnapshot();
  expect(state.status).toBe('ready');
  expect(state.widgets.Switch).toHaveLength(1);
  expect(state.meta).toEqual({ devextremeVersion: '25.2.10', generatedAt: '2026-09-22' });
});

test('a missing or malformed file fails softly', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
  const mod = freshModule();
  await expect(mod.loadWidgetOptions()).resolves.toBeNull();
  expect(mod.widgetOptionsStore.getSnapshot()).toMatchObject({ status: 'failed', widgets: null });

  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ nope: 1 }) }));
  const other = freshModule();
  await other.loadWidgetOptions();
  expect(other.widgetOptionsStore.getSnapshot().status).toBe('failed');
});

test('the store notifies subscribers', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ widgets: {} }) }));
  const mod = freshModule();
  const listener = jest.fn();
  const unsubscribe = mod.widgetOptionsStore.subscribe(listener);
  await mod.loadWidgetOptions();
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});

test('the exports used by the area are all present', () => {
  expect(typeof loadWidgetOptions).toBe('function');
  expect(typeof widgetOptionsStore.subscribe).toBe('function');
  expect(typeof setWidgetOptionsForTest).toBe('function');
});
