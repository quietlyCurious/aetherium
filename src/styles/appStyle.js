// styles/appStyle.js
// The app-wide visual style (Aetherium, ThingWorx Light, Axio Light, Axio
// Dark). A style is two layers, switched together:
//
//   1. Aetherium's own chrome — every chrome color in the app's CSS and
//      inline styles is a var(--aeth-*, <original>) token. A style is one
//      block of token values in appStyleTokens.css, keyed on
//      <html data-aeth-style="...">. The Aetherium style defines no tokens,
//      so every var() falls back to its original value and the app looks
//      exactly as it always has.
//   2. The DevExtreme theme — loaded at runtime from public/devextreme-themes/
//      (copied there by scripts/copyDevExtremeThemes.js) instead of being
//      imported at build time.
//
// The catalog of styles is appStyles.json, which the copy script reads too.
//
// This module must not import devextreme: bootAppStyle() has to put the
// theme <link>s in the page before DevExtreme's theme module loads and reads
// them, so index.js imports appStyleBoot.js (which calls it) first.

import catalog from './appStyles.json';

export const APP_STYLES = catalog.styles;
export const DEFAULT_APP_STYLE = catalog.defaultStyle;

const STORAGE_KEY = 'aeth-app-style';
const THEME_FOLDER = `${process.env.PUBLIC_URL || ''}/devextreme-themes`;

export function findAppStyle(id) {
  return APP_STYLES.find(s => s.id === id) || APP_STYLES.find(s => s.id === DEFAULT_APP_STYLE);
}

export function loadStoredAppStyle() {
  try {
    return findAppStyle(localStorage.getItem(STORAGE_KEY)).id;
  } catch (e) {
    return DEFAULT_APP_STYLE;
  }
}

export function storeAppStyle(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (e) {
    // Private window or blocked storage — the style just won't persist.
  }
}

// Layer 1: the chrome tokens.
export function applyAppStyleTokens(id) {
  document.documentElement.setAttribute('data-aeth-style', findAppStyle(id).id);
}

// Runs once, before DevExtreme loads: one <link rel="dx-theme"> per style,
// with the stored style's theme marked active, which is how DevExtreme
// expects runtime-switchable themes to be declared. DevExtreme replaces them
// with a single stylesheet link and switches its href from then on
// (see useAppStyle).
export function bootAppStyle() {
  const id = loadStoredAppStyle();
  applyAppStyleTokens(id);
  const anchor = document.head.querySelector('title');
  for (const style of APP_STYLES) {
    const link = document.createElement('link');
    link.rel = 'dx-theme';
    link.setAttribute('data-theme', style.dxTheme);
    link.href = `${THEME_FOLDER}/${style.dxFile}`;
    if (style.id === id) link.setAttribute('data-active', 'true');
    // Before the app's own stylesheets, so they keep winning the cascade
    // just as when the theme was imported at the top of App.js.
    document.head.insertBefore(link, anchor ? anchor.nextSibling : document.head.firstChild);
  }
}
