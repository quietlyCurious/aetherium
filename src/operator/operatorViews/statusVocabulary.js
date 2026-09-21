// operator/operatorViews/statusVocabulary.js
// The shared colour and label maps the Operator views read a status
// through: unit state, severity, attention state and operating mode. Data
// only — one definition per concept, so the Now strip, attention cards and
// Investigate can't drift apart on what "degraded" looks like.

export const STATE_COLORS = {
  running:    '#4ade80',
  attention:  '#fbbf24',
  changeover: '#60a5fa',
  down:       '#f87171',
};

export const STATE_LABELS = {
  running: 'Running',
  attention: 'Needs attention',
  changeover: 'Changeover',
  down: 'Down',
};

export const SEVERITY_COLORS = {
  high: '#d64545',
  medium: '#e0a336',
  low: '#8c8c8c',
};

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

export const SEVERITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

// A second, independent axis from severity — "how bad is this" vs "what's
// my relationship to it right now." Colors deliberately don't reuse
// severity's red/amber/grey, so a card showing both a severity dot and a
// state badge doesn't read as two competing opinions in the same palette.
export const ATTENTION_STATE_COLORS = {
  watch: '#6b7a99',
  investigate: '#0078d4',
  act: '#0e8a7d',
  urgent: '#b91c3c',
};

export const ATTENTION_STATE_LABELS = {
  watch: 'Watch',
  investigate: 'Investigate',
  act: 'Act',
  urgent: 'Urgent',
};

// Most urgent first, mirroring the high-to-low convention severity already uses.
export const ATTENTION_STATE_ORDER = { urgent: 0, act: 1, investigate: 2, watch: 3 };

// A unit's operating mode (unit-status.json). Industry-specific modes
// (CURTAILED, …) have no entry and show in a neutral colour.
export const OPERATING_MODE_COLORS = {
  STEADY: '#3fa66c',
  CHANGEOVER: '#0078d4',
  RAMP_UP: '#e0a336',
  RAMP_DOWN: '#e0a336',
  STOPPED: '#8c8c8c',
  MAINTENANCE: '#6a3fd6',
  CONTROLLED_HOLD: '#d64545',
};
