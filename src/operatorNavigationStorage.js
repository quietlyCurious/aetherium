// operatorNavigationStorage.js
// Browser localStorage-backed persistence for the operator/configurator
// navigation context (currentView, operatorPersona, selectedModel). Same
// pattern as queriesStorage.js.
//
// Without this, currentView/operatorPersona/selectedModel all reset to
// their defaults ('screens'/'operator'/'refinery') on every fresh page
// load — meaning a reload would silently take the user all the way back to
// the main Screens designer, bypassing the Configurator context entirely.
// Everything saved there (type display templates, the current Now
// selection) would still be sitting safely in localStorage, but the user
// would never see it restored, since they'd never land back in the place
// it's shown.
//
// Deliberately narrow in scope: only currentView === 'operator' is ever
// restored on load. Any other persisted view falls back to the existing
// 'screens' default — the cold-start behavior of the other views (queries,
// entities, datasources, etc.) hasn't been verified to handle being
// restored without their own additional context (e.g. activePageId for
// screens), so this doesn't change their behavior at all.

const OPERATOR_NAV_STORAGE_KEY = 'aetherium_operator_navigation';

export function loadOperatorNavigation() {
  try {
    const raw = window.localStorage.getItem(OPERATOR_NAV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Corrupt or inaccessible storage — fail soft rather than crash on load.
    return null;
  }
}

export function saveOperatorNavigation(nav) {
  try {
    window.localStorage.setItem(OPERATOR_NAV_STORAGE_KEY, JSON.stringify(nav));
    return true;
  } catch {
    return false;
  }
}
