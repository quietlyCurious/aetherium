// operatorFitDisplayStorage.js
// Browser localStorage-backed persistence for which display the Configure
// side checks the Operator's view against ("fits on Full HD?" —
// operator/configurator/OperatorFitCheck.jsx). One device id from
// breakpointConfig.js. A per-browser preference, like the other *Storage
// files.

const STORAGE_KEY = 'aetherium_operator_fit_display';

export function loadOperatorFitDisplay() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveOperatorFitDisplay(deviceId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, deviceId);
    return true;
  } catch {
    return false;
  }
}
