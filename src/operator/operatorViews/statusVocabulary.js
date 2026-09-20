// operator/operatorViews/statusVocabulary.js
// The shared colour and label maps the Operator views read a status
// through: line state, severity, attention state, operating mode, and the
// display labels for station types, highlight fields and sparkline
// properties. Data only — one definition per concept, so the strip, the
// issue map, attention cards, Line Detail and Investigate can't drift
// apart on what "degraded" looks like.

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

// Mined from OperatingContext in the nextgen workbook, at the same 14:05
// reference used for Work — this is what makes Ferrum F4 show CHANGEOVER
// while everything else is STEADY (its changeover window is 13:50–14:18).
export const OPERATING_MODE_COLORS = {
  STEADY: '#3fa66c',
  CHANGEOVER: '#0078d4',
  RAMP_UP: '#e0a336',
  RAMP_DOWN: '#e0a336',
  STOPPED: '#8c8c8c',
  MAINTENANCE: '#6a3fd6',
  CONTROLLED_HOLD: '#d64545',
};

export const STATION_TYPE_LABELS = {
  INTAKE: 'Intake', STABILIZATION: 'Stabilization', REFINEMENT: 'Refinement',
  INSPECTION: 'Inspection', BUFFER: 'Buffer', OUTPUT: 'Output',
  BULK_INTAKE: 'Bulk Intake', POWER_CHARGE: 'Power Charge', SHAPING: 'Shaping', TRANSFER: 'Transfer',
};

export const HIGHLIGHT_FIELD_LABELS = {
  input_quality_score: 'Input quality', batch_variability: 'Batch variability',
  stability_score: 'Stability', oscillation_index: 'Oscillation',
  yield_rate: 'Yield', consistency_index: 'Consistency',
  inspection_pass_rate: 'Pass rate', first_pass_yield: 'First-pass yield',
  buffer_level: 'Buffer level', saturation_risk_index: 'Saturation risk',
  output_quality_score: 'Output quality', on_time_output_rate: 'On-time rate',
  material_availability: 'Material availability', supply_variability: 'Supply variability',
  charge_rate: 'Charge rate', system_stress: 'System stress',
  defect_rate: 'Defect rate', blocking_time: 'Blocking time', starvation_time: 'Starvation time',
};

// Raw nextgen-workbook property names -> readable labels, for captioning
// each real station's sparkline with what it's actually plotting.
export const SPARKLINE_PROPERTY_LABELS = {
  ThroughputRate: 'Throughput', RejectRatePct: 'Reject Rate', PurityPct: 'Purity',
  BufferLevelPct: 'Buffer Level', ChargePV: 'Charge Rate', TransferRate: 'Transfer Rate',
  PressurePV: 'Pressure',
};
