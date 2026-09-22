#!/usr/bin/env python3
"""Aurelia & Ferrum — the (fictional) refinery pack — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/refinery/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/refinery/generate.py [OUTDIR]

The process is INVENTED on purpose (it was made for a hackathon so nobody
could lean on real industry knowledge): two "refineries", Aurelia and
Ferrum, each with six serial production lines. An Aurelia line runs
Intake → Stabilization → Refinement → Inspection → Buffer → Output; a
Ferrum line runs Bulk Intake → Power Charge → Shaping → Transfer → Output.
Nothing here is petroleum chemistry — only generic manufacturing-flow
physics: every station passes on what it receives, a stopped station
starves the stations after it and blocks the ones before it, the Aurelia
Buffer is the only real store and absorbs short upsets, and line
throughput is what leaves the Output station. RESEARCH.md describes the
fiction; SCENARIOS.md describes each attention item's footprint.

This pack was hand-built long before the generic format and converted
once (ModelAndData/tools/convert_legacy_to_generic.py). This generator
replaces that data: asset ids, property keys and metadata, attention-item
and work-item text are kept exactly (saved settings are keyed by them),
while every series is regenerated from the constants below. Evidence
values in attention-items.json are READ BACK from the generated series.

Standard library only. Two random streams:
  * SEED        — all noise (AR(1) drift). robustness.py-style reruns
                  substitute this line to get other noise realisations.
  * SPREAD_SEED — the fixed per-asset setpoint spread (±1–3 % between
                  sibling stations), so a reseed changes noise, not the fleet.
"""
import json
import math
import os
import random
import sys

SEED = 20260828
rng = random.Random(SEED)
SPREAD_SEED = 1828
sp_rng = random.Random(SPREAD_SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'refinery')
SEP = ' · '
UNIT_LEVEL = 'line'

# ── Timeline (spec §4.2) — the shared demo day. "Now" = 14:05. ─────────────
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


def i_of(t):
    return IDX[t]


NOW_MIN = END

# ── Hierarchy: refinery → line → station ───────────────────────────────────
# (code, name, assetType) in flow order; every line of a refinery shares it.
AURELIA_STATIONS = [('INTAKE', 'Intake', 'intake'), ('STABILIZATION', 'Stabilization', 'stabilization'),
                    ('REFINEMENT', 'Refinement', 'refinement'), ('INSPECTION', 'Inspection', 'inspection'),
                    ('BUFFER', 'Buffer', 'buffer'), ('OUTPUT', 'Output', 'output')]
FERRUM_STATIONS = [('BULK_INTAKE', 'Bulk Intake', 'bulk_intake'), ('POWER_CHARGE', 'Power Charge', 'power_charge'),
                   ('SHAPING', 'Shaping', 'shaping'), ('TRANSFER', 'Transfer', 'transfer'),
                   ('OUTPUT', 'Output', 'output')]
REFINERIES = [('AURELIA', 'Aurelia', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], AURELIA_STATIONS),
              ('FERRUM', 'Ferrum', ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'], FERRUM_STATIONS)]

# ── Per-line operating point ───────────────────────────────────────────────
# pace = the line's normal flow (units/min); target = planned rate. Rolling-24 h
# KPIs start from these (performance = pace / target, capped just under 100).
#            pace   target avail  scrap  wip   instab health flow_eff
LINE_SP = {
    'A1': (119.25, 120, 99.54, 0.85, 46.2, 1.03, 99.36, 99.10),
    'A2': (120.30, 120, 99.11, 0.74, 40.2, 1.41, 99.37, 99.42),
    'A3': (120.20, 120, 99.37, 0.50, 43.9, 1.19, 99.38, 98.86),
    'A4': (120.20, 120, 99.55, 0.87, 54.1, 0.98, 99.73, 99.38),
    'A5': (118.85, 120, 99.42, 0.75, 45.3, 1.07, 99.16, 98.92),
    'A6': (119.20, 120, 99.42, 0.78, 46.1, 0.96, 99.28, 99.19),
    'F1': (124.60, 125, 99.09, 0.67, 41.2, 1.48, 98.99, 99.57),
    'F2': (124.70, 125, 99.23, 0.76, 34.3, 1.23, 99.13, 99.73),
    'F3': (125.10, 125, 98.91, 0.72, 39.7, 1.08, 99.68, 99.64),
    'F4': (119.40, 120, 99.20, 0.74, 38.3, 1.00, 99.40, 99.43),   # still on Product A (120/min) until the changeover
    'F5': (123.50, 125, 98.96, 0.68, 40.1, 1.04, 99.09, 99.52),
    'F6': (124.30, 125, 99.00, 0.85, 42.3, 1.09, 99.07, 100.40),
}
LINE_FLOW_NOISE = (0.8, 0.9)        # shared line pace drift: sd units/min, AR(1) phi
STATION_FLOW_NOISE = (0.65, 0.8)    # each station's own count noise around the line pace
STATION_FLOW_BIAS = 0.35            # sd of a station's fixed counter bias (units/min)
KPI_WINDOW_MIN = 24 * 60            # line KPIs are rolling 24-hour figures (§ RESEARCH.md)

# Aurelia Buffer: the only real store on a line.
BUF_UNITS_PER_PCT = 10.4            # 100 % level = 1,040 units
BUF_GAIN = 0.30                     # outflow trim (units/min per % away from setpoint)
BUF_NOISE = (0.7, 0.5)              # outflow noise around the line pace
TURNOVER_K = 11.4                   # buffer_turnover_rate = K / time_in_buffer
UTIL_WINDOW = 24                    # capacity utilisation = mean level over the last 2 h (24 samples)

# ── Scenario constants (SCENARIOS.md describes each one) ───────────────────
# Throughput profiles are absolute units/min unless written relative to the
# line pace (P + …). Times are on the 5-minute grid.
A3_P, F2_P, F3_P, F5_P, F6_P, F4_P = (LINE_SP[k][0] for k in ('A3', 'F2', 'F3', 'F5', 'F6', 'F4'))

# SIT03 — A3 Refinement regulator sluggish: throughput drifts down while control effort rises (03)
SIT03_THROUGHPUT = {'08:15': A3_P, '08:20': 120.6, '08:35': 119.3, '08:45': 118.3, '09:00': 115.4, '09:10': 112.7,
                    '09:20': 111.3, '09:25': 110.9, '09:30': 114.8, '09:35': 118.2, '09:50': 120.3, '09:55': A3_P}
SIT03_EFFORT = {'08:40': 50.2, '08:50': 52.5, '09:00': 55.0, '09:10': 58.5, '09:20': 61.6, '09:25': 61.8,
                '09:30': 57.0, '09:35': 51.5, '09:45': 50.2}
SIT03_UPSTREAM_PACING = 0.5         # Intake + Stabilization slow by half the Refinement deficit
SIT03_WIP = {'08:40': 0, '09:25': 5.0, '09:45': 5.0, '10:15': 0}

# SIT04 — A4 Output restriction: Buffer accumulates, then drains (04)
SIT04_LEVEL_SP = 43.0
SIT04_LEVEL = {'08:55': 42.6, '09:00': 42.6, '09:10': 43.3, '09:15': 44.5, '09:30': 53.0, '09:40': 62.3, '09:55': 70.1, '10:05': 71.0,
               '10:10': 70.7, '10:25': 54.7, '10:40': 43.0, '10:45': 43.0}
SIT04_UPSTREAM_PACING = {'10:05': 0, '10:10': -5.0, '10:35': -5.0, '10:45': 0}   # "briefly pace upstream"

# SIT05 — F2 Power Charge bearing wear: vibration climbs at unchanged load (05, open)
SIT05_VIBRATION = {'08:50': 2.47, '09:40': 2.70, '10:30': 3.06, '11:20': 3.32, '12:15': 3.86, '13:05': 4.11,
                   '13:55': 4.38, '14:05': 4.43}
SIT05_BEARING_RISE = {'08:50': 0, '14:05': 5.8}     # °C, same slow onset
SIT05_HEALTH_PER_MMS = 0.55                          # line health penalty per mm/s above the start value

# SIT06 — A5 Stabilization pressure transmitter loose connection (06): additive error on the
# transmitter only; true pressure, local gauge and flow are untouched.
SIT06_TRUE_PRESSURE = 80.5
SIT06_ERROR = {'09:40': 1.8, '09:45': 5.2, '09:50': -1.2, '10:00': 1.2}
SIT06_PEAK = ('09:55', 95.1)        # absolute transmitter reading at the worst swing

# SIT07 — A1 Refinement purity drift (root cause) → Inspection rejects (07)
SIT07_PURITY = {'09:45': 99.27, '09:55': 99.17, '10:05': 98.98, '10:15': 98.85, '10:30': 98.78, '10:40': 98.80,
                '10:45': 98.95, '10:55': 99.15, '11:10': 99.27}
SIT07_REJECTS = {'09:45': 1.86, '09:50': 1.87, '10:05': 1.82, '10:10': 2.40, '10:15': 3.46, '10:30': 5.33,
                 '10:40': 6.62, '10:45': 6.35, '10:55': 5.22, '11:05': 2.00, '11:20': 1.75, '11:25': 1.85}
SIT07_SCRAP_SHARE = 0.10            # share of extra rejects that end up as line scrap

# SIT08 — F5 throughput illusion: Power Charge pushed above what Shaping sustains (08)
SIT08_POWER_CHARGE = {'09:55': F5_P, '10:00': 122.7, '10:15': 124.9, '10:30': 124.4, '10:45': 123.9, '11:00': 125.1,
                      '11:15': 121.3, '11:30': 122.3, '11:35': 121.8, '11:45': 120.6, '12:00': 121.0,
                      '12:15': 122.0, '12:30': F5_P}
SIT08_SHAPING_CAP = {'10:00': F5_P, '10:15': 122.6, '11:35': 122.6, '11:45': F5_P}   # sustainable downstream rate
SIT08_WIP = {'10:00': 0, '10:30': 2.0, '11:00': 4.2, '11:30': 6.5, '11:45': 5.5, '12:15': 1.0, '12:30': 0}
SIT08_BLOCKING = {'10:00': 0.8, '10:30': 1.2, '11:00': 1.7, '11:30': 2.2, '11:45': 1.5, '12:15': 0.8}

# SIT09 — F3 Power Charge power-delivery fault cascades down the line (09)
SIT09_POWER_CHARGE = {'11:35': F3_P, '11:40': F3_P, '11:45': 17.8, '11:50': 123.5, '11:55': 118.0,
                      '12:00': 118.1, '12:05': 117.9, '12:10': 118.0, '12:15': 121.5, '12:20': F3_P}
SIT09_SHAPING = {'11:45': 24.0, '11:50': 127.0}       # starved, then drains its catch-up
SIT09_TRANSFER = {'11:45': 58.0, '11:50': 121.0}      # still emptying, then accumulating
SIT09_OUTPUT = {'11:45': 62.0, '11:50': 117.0}
SIT09_DOWN = ('11:45', '11:45')                       # samples booked as unplanned downtime
SIT09_STARVATION = {'11:40': 0.55, '11:45': 2.6, '11:50': 0.9, '11:55': 0.55}
SIT09_BLOCKING = {'11:45': 0.7, '11:50': 1.9, '11:55': 1.3, '12:05': 0.7}
SIT09_WIP = {'11:40': 0, '11:45': -3.0, '11:50': 4.0, '11:55': 2.5, '12:10': 0}
SIT09_INSTABILITY = {'11:40': 0, '11:45': 9.0, '11:50': 12.0, '11:55': 6.0, '12:05': 2.5, '12:20': 0}

# SIT10 — F1 Power Charge manual over-correction oscillation (10)
SIT10_CHARGE = {'12:25': 50.1, '12:30': 50.2, '12:35': 51.9, '12:40': 43.8, '12:45': 56.6, '12:50': 45.0,
                '12:55': 47.2, '13:00': 50.5, '13:05': 50.0, '13:10': 50.1}
SIT10_CONTROLLER_GAIN = -1.6        # controller output moves against the charge swing
SIT10_OSCILLATION = {'12:30': 2.0, '12:35': 2.8, '12:40': 4.6, '12:45': 5.6, '12:50': 5.3, '12:55': 4.0,
                     '13:00': 3.0, '13:10': 2.0}
SIT10_THROUGHPUT_PER_PCT = 0.35     # units/min of Power Charge output per % of charge swing
SIT10_INSTABILITY = {'12:30': 0, '12:40': 6.0, '12:45': 11.0, '12:50': 10.0, '12:55': 6.0, '13:05': 2.0, '13:15': 0}

# SIT11 — F6 Transfer physically blocked; line in controlled hold (11)
SIT11_TRANSFER = {'13:20': 0.0, '13:25': 0.0, '13:30': 0.0, '13:35': 0.0, '13:40': 38.0, '13:45': 104.0}
SIT11_UPSTREAM = {'13:20': 45.0, '13:25': 0.0, '13:30': 0.0, '13:35': 0.0, '13:40': 60.0, '13:45': 112.0}
SIT11_OUTPUT = {'13:20': 20.0, '13:25': 0.0, '13:30': 0.0, '13:35': 0.0, '13:40': 30.0, '13:45': 100.0}
SIT11_MOTOR = {'13:20': 144.5, '13:25': 19.2, '13:30': 19.0, '13:35': 19.4, '13:40': 112.0, '13:45': 101.0}
SIT11_DOWN = ('13:20', '13:45')
SIT11_INSTABILITY = {'13:15': 0, '13:20': 7.0, '13:25': 3.0, '13:35': 3.0, '13:40': 5.0, '13:45': 4.0, '13:55': 0}
SIT11_STARVATION = {'13:35': 0.6, '13:40': 1.4, '13:45': 0.9, '13:50': 0.6}

# SIT12 — F2 Power Charge micro-stops: fraction of each 5-min sample lost (12, open).
# Mean over 13:10–14:05 = 4.2 % ("estimated 4.2 % production loss").
SIT12_LOSS = {'13:10': 0.004, '13:15': 0.031, '13:20': 0.018, '13:25': 0.006, '13:30': 0.052, '13:35': 0.027,
              '13:40': 0.061, '13:45': 0.205, '13:50': 0.038, '13:55': 0.044, '14:00': 0.008, '14:05': 0.012}
SIT12_STARVATION_PER_LOSS = 10.0    # Transfer starvation minutes per 5 min per unit of loss fraction

# SIT13 — A6 input characteristic shift → Refinement purity drifts toward limit (13)
SIT13_INPUT = {'11:30': 50.7, '11:45': 52.5, '12:00': 55.0, '12:15': 57.0, '12:30': 58.3, '12:50': 58.8,
               '13:05': 58.9, '14:05': 58.4}
SIT13_PURITY = {'11:55': 99.29, '12:00': 99.28, '12:15': 99.18, '12:30': 99.00, '12:50': 98.84, '13:05': 98.65,
                '13:10': 98.66, '13:20': 98.89, '13:35': 99.26, '13:50': 99.28, '13:55': 99.28}
SIT13_ADJUST = '13:10'              # first sample after the 13:08 validated Refinement adjustment
SIT13_EFFORT_STEP = 3.0

# F4 planned changeover Product A → Product C (unit-status: CHANGEOVER since 13:50; SIT02/SIT14 context)
F4_CHANGEOVER = '13:50'
F4_RUNDOWN = {  # station → throughput at 13:50, 13:55, 14:00, 14:05
    'BULK_INTAKE': (95.0, 30.0, 8.0, 6.0), 'POWER_CHARGE': (105.0, 45.0, 12.0, 9.0),
    'SHAPING': (112.0, 70.0, 15.0, 10.0), 'TRANSFER': (116.0, 90.0, 17.0, 12.0),
    'OUTPUT': (118.0, 101.0, 19.0, 13.0)}
F4_INSTABILITY = {'13:45': 0, '13:50': 14.0, '13:55': 23.0, '14:00': 33.0, '14:05': 43.0}
F4_CHARGE = {'13:45': 50.0, '13:55': 44.0, '14:05': 38.0}
F4_ENERGY = {'13:45': 4.2, '14:00': 5.3, '14:05': 5.4}

# Baseline setpoints the stories depend on (everything else comes from the spread below)
SP_FIX = {
    ('AURELIA_A4_BUFFER', 'buffer_level'): SIT04_LEVEL_SP,
    ('FERRUM_F2_POWER_CHARGE', 'vibration_mms'): 2.47,
    ('FERRUM_F2_POWER_CHARGE', 'bearing_temp_c'): 61.8,
    ('AURELIA_A5_STABILIZATION', 'process_pressure_psi'): SIT06_TRUE_PRESSURE,
    ('AURELIA_A1_INSPECTION', 'reject_rate_pct'): 1.85,
    ('AURELIA_A1_REFINEMENT', 'purity_pct'): 99.27,
    ('AURELIA_A6_REFINEMENT', 'purity_pct'): 99.28,
    ('AURELIA_A6_REFINEMENT', 'input_characteristic_index'): 50.7,
    ('AURELIA_A3_REFINEMENT', 'control_effort_pct'): 50.2,
    ('FERRUM_F1_POWER_CHARGE', 'charge_rate'): 50.1,
}

# ── Property metadata (kept from the hand-built pack): label, unit, category, tier, range, decimals ──
PROPS = {
    'batch_variability': ('Batch Variability', '', 'Stability', 'P2', [0, 8], 2),
    'bearing_temp_c': ('Bearing Temp', '°C', 'Condition', 'P2', [55, 75], 1),
    'blocking_time': ('Blocking Time', '', 'Events / Losses', 'P2', [0, 3], 2),
    'buffer_capacity_utilization': ('Capacity Utilization', '', 'Flow / WIP', 'P3', [20, 60], 1),
    'buffer_inflow_rate': ('Inflow Rate', '', 'Flow / WIP', 'P3', [100, 140], 1),
    'buffer_level': ('Buffer Level', '', 'Flow / WIP', 'P1', [15, 78.0], 1),
    'buffer_outflow_rate': ('Outflow Rate', '', 'Flow / WIP', 'P3', [100, 140], 1),
    'buffer_turnover_rate': ('Turnover Rate', '', 'Flow / WIP', 'P3', [1, 5], 2),
    'calibration_score': ('Calibration', '', 'Quality', 'P3', [97, 100], 1),
    'charge_rate': ('Charge Rate', '', 'Flow / WIP', 'P1', [35, 65], 1),
    'consistency_index': ('Consistency', '', 'Quality', 'P2', [85, 100], 1),
    'control_effort': ('Control Effort', '', 'Stability', 'P3', [40, 60], 1),
    'control_effort_pct': ('Control Effort', '%', 'Stability', 'P3', [40, 63.0], 1),
    'controller_output_pct': ('Controller Output', '%', 'Stability', 'P3', [35, 65], 1),
    'defect_rate': ('Defect Rate', '', 'Events / Losses', 'P1', [0, 3], 2),
    'deviation': ('Deviation', '', 'Stability', 'P3', [0, 1], 2),
    'energy_per_unit': ('Energy / Unit', '', 'Condition', 'P2', [3, 6], 2),
    'false_accept_rate': ('False Accept Rate', '', 'Quality', 'P3', [0, 1], 2),
    'false_reject_rate': ('False Reject Rate', '', 'Quality', 'P3', [0, 1.5], 2),
    'final_defect_rate': ('Final Defect Rate', '', 'Events / Losses', 'P2', [0, 1.5], 2),
    'first_pass_yield': ('First-Pass Yield', '', 'Quality', 'P1', [90, 100], 1),
    'flow_efficiency': ('Flow Efficiency', '', 'Flow / WIP', 'P2', [97, 102], 1),
    'flow_rate_per_min': ('Flow Rate', '/min', 'Flow / WIP', 'P2', [110, 130], 1),
    'input_characteristic_index': ('Input Characteristic', '', 'Quality', 'P3', [40, 65], 1),
    'input_defect_rate': ('Input Defect Rate', '', 'Events / Losses', 'P2', [0, 1.5], 2),
    'input_quality_score': ('Input Quality', '', 'Quality', 'P1', [95, 100], 1),
    'input_signal_noise': ('Input Signal Noise', '', 'Stability', 'P3', [0, 3], 2),
    'input_variability': ('Input Variability', '', 'Stability', 'P2', [0, 5], 2),
    'inspection_pass_rate': ('Pass Rate', '', 'Quality', 'P2', [92, 100], 1),
    'instability_index': ('Instability', '', 'Stability', 'P1', [0, 50], 1),
    'line_availability': ('Availability', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'line_oee': ('OEE', '%', 'Derived Metric', 'P1', [95, 100], 1),
    'line_performance': ('Performance', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'line_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [98, 100], 1),
    'line_scrap_rate': ('Scrap Rate', '', 'Events / Losses', 'P1', [0, 1.5], 2),
    'line_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [0, 130], 1),
    'line_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [0, 130], 1),
    'local_gauge_pressure_psi': ('Local Gauge Pressure', 'psi', 'Condition', 'P2', [75, 85], 1),
    'material_availability': ('Material Availability', '%', 'Quality', 'P3', [95, 100], 1),
    'measurement_noise': ('Measurement Noise', '', 'Stability', 'P3', [0, 3], 2),
    'motor_current_a': ('Motor Current', 'A', 'Condition', 'P2', [17.5, 146.5], 1),
    'on_time_output_rate': ('On-Time Rate', '', 'Quality', 'P1', [92, 100], 1),
    'order_fulfillment_rate': ('Fulfillment Rate', '', 'Quality', 'P1', [94, 100], 1),
    'oscillation_index': ('Oscillation', '', 'Stability', 'P2', [0, 6], 2),
    'output_consistency_index': ('Output Consistency', '', 'Quality', 'P2', [88, 100], 1),
    'output_quality_score': ('Output Quality', '', 'Quality', 'P2', [94, 100], 1),
    'process_pressure_psi': ('Pressure', 'psi', 'Condition', 'P2', [70, 100], 1),
    'process_variability': ('Process Variability', '', 'Stability', 'P2', [0, 5], 2),
    'purity_pct': ('Purity', '%', 'Quality', 'P1', [97, 100], 1),
    'refinery_availability': ('Availability', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'refinery_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [85, 100], 1),
    'refinery_instability_index': ('Instability', '', 'Stability', 'P1', [0, 50], 1),
    'refinery_oee': ('OEE', '%', 'Derived Metric', 'P1', [95, 100], 1),
    'refinery_performance': ('Performance', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'refinery_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [98, 100], 1),
    'refinery_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [500, 750], 1),
    'refinery_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [500, 771.9], 1),
    'reject_rate_pct': ('Reject Rate', '%', 'Events / Losses', 'P2', [0, 8], 2),
    'rework_rate': ('Rework Rate', '', 'Events / Losses', 'P2', [0, 2], 2),
    'saturation_risk_index': ('Saturation Risk', '', 'Derived Metric', 'P2', [0, 20], 1),
    'settling_time': ('Settling Time', '', 'Stability', 'P3', [5, 30], 1),
    'stability_score': ('Stability', '', 'Stability', 'P1', [88, 100], 1),
    'starvation_risk_index': ('Starvation Risk', '', 'Derived Metric', 'P2', [0, 18], 1),
    'starvation_time': ('Starvation Time', '', 'Events / Losses', 'P2', [0, 3], 2),
    'supply_variability': ('Supply Variability', '', 'Stability', 'P2', [0, 5], 2),
    'system_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [85, 100], 1),
    'system_stress': ('System Stress', '', 'Stability', 'P2', [0, 30], 1),
    'temperature_c': ('Temperature', '°C', 'Condition', 'P2', [65, 75], 1),
    'throughput_per_min': ('Throughput', '/min', 'Flow / WIP', 'P2', [0, 141.5], 1),   # was [0.9, …]: a blocked line reads 0
    'time_in_buffer': ('Time in Buffer', '', 'Flow / WIP', 'P3', [0, 8], 2),
    'total_wip': ('Total WIP', '', 'Flow / WIP', 'P1', [25, 60], 1),
    'transfer_rate_per_min': ('Transfer Rate', '/min', 'Flow / WIP', 'P1', [0, 130], 1),
    'vibration_mms': ('Vibration', 'mm/s', 'Stability', 'P2', [0, 6], 2),
    'yield_rate': ('Yield', '', 'Quality', 'P2', [92, 100], 1),
}

# Keys per asset type, in display order (every instance of a type has exactly these).
TYPE_PROPS = {
    'refinery': ['refinery_throughput', 'refinery_target_rate', 'refinery_oee', 'refinery_availability',
                 'refinery_performance', 'refinery_quality_factor', 'refinery_health_index',
                 'refinery_instability_index'],
    'line': ['line_throughput', 'line_oee', 'line_availability', 'line_performance', 'line_quality_factor',
             'line_scrap_rate', 'total_wip', 'instability_index', 'system_health_index', 'flow_efficiency',
             'line_target_rate'],
    'intake': ['batch_variability', 'input_defect_rate', 'input_quality_score', 'input_signal_noise',
               'input_variability', 'system_stress', 'throughput_per_min'],
    'stabilization': ['control_effort', 'deviation', 'oscillation_index', 'stability_score', 'settling_time',
                      'system_stress', 'process_pressure_psi', 'local_gauge_pressure_psi', 'flow_rate_per_min',
                      'temperature_c', 'throughput_per_min'],
    'refinement': ['consistency_index', 'defect_rate', 'process_variability', 'rework_rate', 'yield_rate',
                   'system_stress', 'control_effort_pct', 'purity_pct', 'input_characteristic_index',
                   'throughput_per_min'],
    'inspection': ['false_accept_rate', 'false_reject_rate', 'first_pass_yield', 'inspection_pass_rate',
                   'measurement_noise', 'system_stress', 'reject_rate_pct', 'calibration_score', 'throughput_per_min'],
    'buffer': ['buffer_level', 'buffer_capacity_utilization', 'buffer_inflow_rate', 'buffer_outflow_rate',
               'buffer_turnover_rate', 'saturation_risk_index', 'starvation_risk_index', 'time_in_buffer',
               'system_stress', 'throughput_per_min'],
    'output': ['final_defect_rate', 'on_time_output_rate', 'order_fulfillment_rate', 'output_consistency_index',
               'output_quality_score', 'system_stress', 'throughput_per_min'],
    'bulk_intake': ['batch_variability', 'input_defect_rate', 'input_quality_score', 'material_availability',
                    'supply_variability', 'system_stress', 'throughput_per_min'],
    'power_charge': ['charge_rate', 'energy_per_unit', 'oscillation_index', 'system_stress', 'vibration_mms',
                     'bearing_temp_c', 'motor_current_a', 'controller_output_pct', 'throughput_per_min'],
    'shaping': ['consistency_index', 'defect_rate', 'process_variability', 'rework_rate', 'system_stress',
                'throughput_per_min'],
    'transfer': ['blocking_time', 'starvation_time', 'system_stress', 'transfer_rate_per_min', 'motor_current_a',
                 'throughput_per_min'],
}
# The refinery rollups (sum / mean / max over its lines) are declared from ROLLUP below;
# the line KPI formulas are documented here and in RESEARCH.md.
DERIVATION_FORMULAS = [
    {'assetType': 'line', 'property': 'line_oee', 'fn': 'formula',
     'note': 'line_availability × line_performance × line_quality_factor (legacy line model)'},
]

# ── Unit status at 14:05 (state, minutes in state, mode, product) ──────────
UNIT_STATUS = {
    'A1': ('running', 177, 'STEADY', 'Product A'),
    'A2': ('running', 365, 'STEADY', 'Product A'),
    'A3': ('running', 265, 'STEADY', 'Product A'),
    'A4': ('running', 217, 'STEADY', 'Product A'),
    'A5': ('running', 227, 'STEADY', 'Product A'),
    'A6': ('running', 23, 'STEADY', 'Product A'),
    'F1': ('running', 55, 'STEADY', 'Product B'),
    'F2': ('attention', 305, 'STEADY', 'Product B'),
    'F3': ('running', 105, 'STEADY', 'Product B'),
    'F4': ('changeover', 15, 'CHANGEOVER', 'Product A → Product C'),
    'F5': ('running', 150, 'STEADY', 'Product B'),
    'F6': ('running', 17, 'STEADY', 'Product B'),
}

# ── Attention-item evidence: (asset, primary property, since-time, value format, points) ──
# since-time = resolution time for resolved items, start time for open / recovering ones.
# Values are read back from the generated series at these times.
EVIDENCE = {
    'SIT02': ('FERRUM_F4', 'line_throughput', '12:25', None,       # status codes: 1 = planned work on track
              [('08:00', 'Shift start', '', 1), ('12:25', 'All planned work clear', 'Resolved', 1)]),
    'SIT03': ('AURELIA_A3_REFINEMENT', 'throughput_per_min', '09:40', '{:.1f}/min',
              [('08:20', ''), ('08:35', ''), ('08:45', 'Drift begins'), ('09:00', ''), ('09:10', ''),
               ('09:25', 'Lowest point'), ('09:35', 'Adjusted, recovering'), ('09:50', 'Back to baseline')]),
    'SIT04': ('AURELIA_A4_BUFFER', 'buffer_level', '10:28', '{:.1f}%',
              [('09:00', 'Baseline'), ('09:15', ''), ('09:30', ''), ('09:40', ''), ('09:55', 'Near peak'),
               ('10:10', 'Restriction cleared'), ('10:25', 'Draining'), ('10:40', 'Back to normal')]),
    'SIT05': ('FERRUM_F2_POWER_CHARGE', 'vibration_mms', '09:00', '{:.1f} mm/s',
              [('08:50', 'Baseline'), ('09:40', ''), ('10:30', ''), ('11:20', ''), ('12:15', ''), ('13:05', ''),
               ('13:55', 'Highest reading')]),
    'SIT06': ('AURELIA_A5_STABILIZATION', 'process_pressure_psi', '10:18', '{:.1f} psi',
              [('09:10', 'Baseline'), ('09:20', ''), ('09:30', ''), ('09:45', 'Signal noise begins'),
               ('09:55', 'Peak noise'), ('10:05', 'Reseated'), ('10:15', ''), ('10:30', 'Steady')]),
    'SIT07': ('AURELIA_A1_INSPECTION', 'reject_rate_pct', '11:08', '{:.1f}%',
              [('09:50', 'Baseline'), ('10:05', ''), ('10:15', 'Rejects rising'), ('10:30', ''), ('10:40', 'Peak'),
               ('10:55', 'Recovering'), ('11:05', ''), ('11:20', 'Back to baseline')]),
    'SIT08': ('FERRUM_F5_POWER_CHARGE', 'throughput_per_min', '11:35', '{:.1f}/min',
              [('10:00', 'Gross rate — looks fine'), ('10:15', ''), ('10:30', ''), ('10:45', ''),
               ('11:00', 'Still looks fine'), ('11:15', 'Effective output diverging'), ('11:30', ''),
               ('11:45', 'Demand reduced')]),
    # SIT09: labels aligned with the narrative (first interruption at 11:42 → first sample 11:45).
    'SIT09': ('FERRUM_F3_POWER_CHARGE', 'throughput_per_min', '12:20', '{:.1f}/min',
              [('11:35', 'Baseline'), ('11:40', ''), ('11:45', 'Power fault — first interruption'),
               ('11:50', 'Brief recovery'), ('11:55', 'Reduced demand'), ('12:00', ''), ('12:05', ''),
               ('12:10', 'Stabilized')]),
    'SIT10': ('FERRUM_F1_POWER_CHARGE', 'charge_rate', '13:10', '{:.1f}%',
              [('12:30', 'Baseline'), ('12:35', ''), ('12:40', 'Manual correction'), ('12:45', 'Overshoot'),
               ('12:55', 'Manual correction'), ('13:00', 'Damping'), ('13:05', ''), ('13:10', 'Stabilized')]),
    # SIT11: labels aligned with the narrative (cleared 13:38 → restarting at 13:40, back by 13:50).
    'SIT11': ('FERRUM_F6_TRANSFER', 'transfer_rate_per_min', '13:48', '{:.1f}/min',
              [('13:15', 'Baseline'), ('13:20', 'Blocked — alarm'), ('13:25', 'Controlled hold'), ('13:30', ''),
               ('13:35', 'Shard confirmed'), ('13:40', 'Clearing'), ('13:45', 'Recovering'),
               ('13:50', 'Back to baseline')]),
    'SIT12': ('FERRUM_F2_POWER_CHARGE', 'throughput_per_min', '13:10', '{:.1f}/min',
              [('13:10', 'Baseline'), ('13:25', ''), ('13:45', 'Interruption'), ('14:00', 'Recovered'),
               ('14:05', 'Current')]),
    'SIT13': ('AURELIA_A6_REFINEMENT', 'purity_pct', '13:42', '{:.2f}%',
              [('12:00', 'Baseline'), ('12:15', ''), ('12:30', ''), ('12:50', 'Margin narrowing'),
               ('13:05', 'Lowest point'), ('13:20', 'Adjusted'), ('13:35', 'Recovering'), ('13:50', 'Back to baseline')]),
    'SIT14': ('FERRUM_F4', 'line_throughput', '12:00', None,       # 0 = prerequisite pending, 1 = moving / done
              [('12:00', 'Not started', 'Material + quality both pending', 0),
               ('12:30', 'Requested', 'Both requests parallelized', 0),
               ('13:10', 'In progress', 'Material staging underway', 1),
               ('13:30', 'Quality cleared', 'Release complete', 1),
               ('13:50', 'Material cleared', 'Staging complete', 1),
               ('14:00', 'Changeover started', '', 1),
               ('14:05', 'In progress', 'Changeover running slightly long', 1)]),
}
EXPECT_SINCE = {'SIT02': 100, 'SIT03': 265, 'SIT04': 217, 'SIT05': 305, 'SIT06': 227, 'SIT07': 177, 'SIT08': 150,
                'SIT09': 105, 'SIT10': 55, 'SIT11': 17, 'SIT12': 55, 'SIT13': 23, 'SIT14': 125}

# Station types whose keys are simple AR(1) drift around a per-asset setpoint:
#   key: (fleet mean, sibling spread sd, noise sd, AR(1) phi)
# Tuned so the regenerated baseline matches the converted legacy data's levels
# (the levels a returning user remembers); keys not listed here are coupled
# to the line flow or to each other further down.
BASE = {
    'intake': {
        'batch_variability': (3.46, 0.20, 0.38, 0.89), 'input_defect_rate': (0.477, 0.086, 0.082, 0.86),
        'input_quality_score': (98.51, 0.15, 0.24, 0.89), 'input_signal_noise': (1.235, 0.128, 0.20, 0.91),
        'input_variability': (2.15, 0.16, 0.21, 0.87), 'system_stress': (11.3, 1.7, 2.0, 0.88)},
    'stabilization': {
        'control_effort': (50.09, 0.44, 0.74, 0.91), 'deviation': (0.316, 0.084, 0.079, 0.85),
        'oscillation_index': (1.855, 0.222, 0.44, 0.91), 'stability_score': (96.75, 0.58, 0.75, 0.90),
        'settling_time': (16.68, 0.92, 1.58, 0.83), 'system_stress': (13.4, 1.3, 1.5, 0.82),
        'temperature_c': (71.12, 0.69, 0.49, 0.83), 'process_pressure_psi': (80.48, 0.57, 0.55, 0.87)},
    'refinement': {
        'consistency_index': (95.41, 0.77, 0.98, 0.92), 'defect_rate': (0.936, 0.177, 0.157, 0.87),
        'process_variability': (2.71, 0.29, 0.40, 0.93), 'rework_rate': (0.562, 0.154, 0.115, 0.89),
        'yield_rate': (98.33, 0.23, 0.36, 0.91), 'system_stress': (14.4, 1.5, 1.8, 0.84),
        'control_effort_pct': (50.17, 0.62, 0.65, 0.86), 'purity_pct': (99.26, 0.04, 0.06, 0.86),
        'input_characteristic_index': (51.08, 0.97, 1.17, 0.90)},
    'inspection': {
        'false_accept_rate': (0.305, 0.067, 0.058, 0.85), 'false_reject_rate': (0.542, 0.10, 0.10, 0.91),
        'measurement_noise': (1.024, 0.171, 0.183, 0.89), 'system_stress': (13.3, 1.4, 2.0, 0.87),
        'reject_rate_pct': (2.01, 0.20, 0.25, 0.88), 'calibration_score': (99.676, 0.038, 0.068, 0.90)},
    'buffer': {'system_stress': (11.9, 1.9, 2.0, 0.87)},
    'output': {
        'final_defect_rate': (0.411, 0.052, 0.092, 0.88), 'on_time_output_rate': (97.8, 0.39, 0.35, 0.84),
        'order_fulfillment_rate': (98.58, 0.25, 0.31, 0.87), 'output_consistency_index': (95.66, 0.60, 0.62, 0.89),
        'output_quality_score': (98.18, 0.15, 0.32, 0.90), 'system_stress': (9.26, 1.9, 2.0, 0.89)},
    'bulk_intake': {
        'batch_variability': (4.16, 0.35, 0.52, 0.91), 'input_defect_rate': (0.589, 0.086, 0.109, 0.90),
        'input_quality_score': (97.91, 0.30, 0.32, 0.88), 'material_availability': (99.10, 0.16, 0.20, 0.82),
        'supply_variability': (2.78, 0.085, 0.26, 0.86), 'system_stress': (12.07, 1.1, 1.6, 0.85)},
    'power_charge': {
        'charge_rate': (50.10, 0.39, 0.60, 0.89), 'energy_per_unit': (4.20, 0.10, 0.10, 0.87),
        'oscillation_index': (2.11, 0.16, 0.30, 0.83), 'system_stress': (15.7, 1.6, 2.1, 0.85),
        'vibration_mms': (2.72, 0.25, 0.12, 0.88), 'bearing_temp_c': (63.76, 1.36, 0.90, 0.89),
        'controller_output_pct': (49.83, 0.59, 0.65, 0.88)},
    'shaping': {
        'consistency_index': (94.89, 0.50, 0.60, 0.86), 'defect_rate': (1.047, 0.165, 0.167, 0.89),
        'process_variability': (2.44, 0.12, 0.38, 0.92), 'rework_rate': (0.674, 0.109, 0.111, 0.85),
        'system_stress': (14.8, 0.55, 1.9, 0.89)},
    'transfer': {
        'blocking_time': (0.68, 0.21, 0.26, 0.89), 'starvation_time': (0.54, 0.16, 0.15, 0.86),
        'system_stress': (12.19, 1.5, 1.8, 0.87)},
}
# Coupled instrument tags (setpoint mean, spread, noise sd, phi)
GAUGE_OFFSET = (-0.6, 0.25)                    # local gauge reads a little below the transmitter tap
GAUGE_NOISE = (0.15, 0.6)
FLOWMETER_NOISE = (0.45, 0.6)                  # Stabilization flow_rate_per_min around its throughput
FPY_GAP = (0.75, 0.10, 0.20, 0.85)             # first-pass yield = pass rate − rework share
MOTOR_CURRENT = {'power_charge': (98.5, 2.0, 1.2, 0.85), 'transfer': (96.45, 2.3, 1.2, 0.80)}
MOTOR_IDLE_FRACTION = 0.2                      # magnetising current of a stopped drive
TRANSFER_RATE_OFFSET = (-2.3, 0.8)             # gate rate reads below the station count
TRANSFER_RATE_NOISE = (0.5, 0.6)
BUF_SAT = (8.0, 0.026, 0.13, 0.82)             # saturation risk = a·exp(b·(level − 45))·(1 + noise CV)
BUF_STARV = (6.2, -0.050, 0.20, 0.86)          # starvation risk = a·exp(b·(level − 45))·(1 + noise CV)
LINE_NOISE = {  # line KPI noise (sd, phi)
    'avail': (0.033, 0.86), 'perf': (0.06, 0.85), 'qf': (0.02, 0.85), 'scrap': (0.018, 0.87),
    'wip': (0.70, 0.86), 'instab': (0.027, 0.84), 'health': (0.035, 0.87), 'fe': (0.065, 0.87)}
HEALTH_PER_INSTABILITY = 0.25                  # health index points per instability point above normal
FLOW_EFF_PER_WIP = 0.25                        # flow-efficiency points lost per WIP lot added in the last hour

# ── Helpers ────────────────────────────────────────────────────────────────
def interp(points):
    """Piecewise-linear profile over the timeline from {'HH:MM': value}; held flat beyond the ends."""
    pts = sorted((minutes(t), v) for t, v in points.items())
    out = []
    for t in TS:
        m = minutes(t)
        if m <= pts[0][0]:
            out.append(pts[0][1]); continue
        if m >= pts[-1][0]:
            out.append(pts[-1][1]); continue
        for (m0, v0), (m1, v1) in zip(pts, pts[1:]):
            if m0 <= m <= m1:
                out.append(v0 + (v1 - v0) * (m - m0) / (m1 - m0))
                break
    return out


def bump(points):
    """Like interp, but zero outside the first..last point (for additive offsets)."""
    prof, lo, hi = interp(points), minutes(min(points)), minutes(max(points))
    return [p if lo <= minutes(t) <= hi else 0.0 for p, t in zip(prof, TS)]


def ar1(sd, phi=0.85):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi, stationary sd ≈ sd), zero mean."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def override(s, points, sd=0.0, phi=0.6, fade=2, pins=()):
    """Replace s over the window spanned by `points` with that profile (+ small noise),
    cross-fading over `fade` samples on each side so the join looks like the process.
    `pins` are the times whose value an attention item's text quotes: no noise there."""
    prof = interp(points)
    noise = ar1(sd, phi) if sd else [0.0] * N
    for t in pins:
        noise[i_of(t)] = 0.0
    t0, t1 = i_of(min(points)), i_of(max(points))
    for i in range(N):
        if t0 <= i <= t1:
            w = 1.0
        elif t0 - fade <= i < t0:
            w = 1 - (t0 - i) / (fade + 1)
        elif t1 < i <= t1 + fade:
            w = 1 - (i - t1) / (fade + 1)
        else:
            continue
        s[i] = (1 - w) * s[i] + w * (prof[i] + noise[i])


def add(s, offsets, scale=1.0):
    for i in range(N):
        s[i] += scale * offsets[i]


def window(t0, t1):
    return [minutes(t0) <= minutes(t) <= minutes(t1) for t in TS]


def rolling_mean(xs, n, before):
    out = []
    for i in range(N):
        vals = xs[max(0, i - n + 1):i + 1]
        vals = [before] * (n - len(vals)) + vals
        out.append(sum(vals) / n)
    return out


def rnd(x, d=3):
    return round(x + 0.0, d)


# ── Build the asset tree and edges ─────────────────────────────────────────
assets, kids, A = [], {}, {}


def add_asset(aid, parent, name, atype, level):
    a = {'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level}
    assets.append(a)
    A[aid] = a
    kids.setdefault(parent, []).append(aid)
    return aid


rels = []
LINES = {}            # 'A1' → {'id', 'refinery', 'stations': {code: aid}, 'seq': [codes]}
for rid, rname, line_codes, stations in REFINERIES:
    add_asset(rid, None, rname, 'refinery', 'refinery')
    for lc in line_codes:
        lid = add_asset(f'{rid}_{lc}', rid, lc, 'line', 'line')
        st = {code: add_asset(f'{lid}_{code}', lid, name, atype, 'station') for code, name, atype in stations}
        seq = [code for code, _, _ in stations]
        LINES[lc] = {'id': lid, 'refinery': rid, 'stations': st, 'seq': seq}
        for a, b in zip(seq, seq[1:]):
            rels.append({'sourceAssetId': st[a], 'targetAssetId': st[b], 'relationshipType': 'feeds_into',
                         'label': None, 'layer': 'process_flow'})


def unit_of(aid):
    a = A[aid]
    while a and a['assetLevel'] != UNIT_LEVEL:
        a = A.get(a['parentId'])
    return a['id'] if a else None


def label_of(aid):
    names, a = [], A[aid]
    while a:
        names.append(a['name'])
        if a['assetLevel'] == UNIT_LEVEL:
            break
        a = A.get(a['parentId'])
    return SEP.join(reversed(names))


def sid(lc, code):
    return LINES[lc]['stations'][code]


# ── Baseline station signals ───────────────────────────────────────────────
series = {a['id']: {} for a in assets}
SP = {}               # (aid, key) → setpoint


def setpoint(aid, key, mean, spread):
    v = mean + sp_rng.gauss(0, spread)
    SP[(aid, key)] = SP_FIX.get((aid, key), v)
    return SP[(aid, key)]


for a in assets:
    if a['assetLevel'] != 'station':
        continue
    for key, (mean, spread, sd, phi) in BASE.get(a['assetType'], {}).items():
        sp = setpoint(a['id'], key, mean, spread)
        if PROPS[key][4][0] == 0:        # can't go negative: keep the CV, not the absolute noise
            sp = SP[(a['id'], key)] = max(sp, 0.5 * mean)
            sd *= sp / mean
        series[a['id']][key] = [sp + e for e in ar1(sd, phi)]

# ── Line flow: shared pace drift + each station's own count noise ─────────
thr = {}              # station aid → throughput_per_min (edited by the scenarios)
pace_series = {}
for lc, L in LINES.items():
    pace = LINE_SP[lc][0]
    pace_series[lc] = [pace + e for e in ar1(*LINE_FLOW_NOISE)]
    for code in L['seq']:
        if code in ('BUFFER',) or (code == 'OUTPUT' and 'BUFFER' in L['seq']):
            continue      # Aurelia Buffer and Output come out of the buffer balance below
        bias = sp_rng.gauss(0, STATION_FLOW_BIAS)
        thr[sid(lc, code)] = [p + bias + e for p, e in zip(pace_series[lc], ar1(*STATION_FLOW_NOISE))]
buffer_noise = {lc: ar1(*BUF_NOISE) for lc in LINES if 'BUFFER' in LINES[lc]['seq']}
output_count_noise = {lc: ar1(0.25, 0.5) for lc in buffer_noise}
level_override_noise = ar1(0.25, 0.6)
for _t in ('09:00', '10:05'):                 # SIT04 quoted "~42%" and "~71%"
    level_override_noise[i_of(_t)] = 0.0
thr_base = {k: list(v) for k, v in thr.items()}     # the no-incident flows (for the KPI loss accounting)


def Z():
    return [0.0] * N


# Line-level scenario offsets (all zero until a scenario adds to them)
WIP_OFF = {lc: Z() for lc in LINES}
INST_OFF = {lc: Z() for lc in LINES}
SCRAP_OFF = {lc: Z() for lc in LINES}
HEALTH_PEN = {lc: Z() for lc in LINES}
DOWN = {lc: [False] * N for lc in LINES}
LEVEL_OVERRIDE = {}   # Aurelia line → buffer level profile (SIT04)


def stress(aid, points):
    add(series[aid]['system_stress'], bump(points))


def pace_upstream(lc, upto_code, offsets):
    """Add offsets to every station before (and including) upto_code."""
    seq = LINES[lc]['seq']
    for code in seq[:seq.index(upto_code) + 1]:
        add(thr[sid(lc, code)], offsets)


def starve_downstream(lc, from_code, offsets, stop_at_buffer=True):
    """Add offsets to every station after from_code (up to the Buffer on an Aurelia line)."""
    seq = LINES[lc]['seq']
    for code in seq[seq.index(from_code) + 1:]:
        if stop_at_buffer and code == 'BUFFER':
            break
        if sid(lc, code) in thr:
            add(thr[sid(lc, code)], offsets)


# ═════════════════════ Scenario footprints: flows ══════════════════════════
# SIT03 — A3 Refinement slows; Intake/Stabilization pace down by half the gap,
# Inspection is starved by all of it, and the Buffer drains to cover Output.
ref = sid('A3', 'REFINEMENT')
before = list(thr[ref])
override(thr[ref], SIT03_THROUGHPUT, sd=0.25, pins=('09:25',))
deficit = [b - a for a, b in zip(thr[ref], before)]
starve_downstream('A3', 'REFINEMENT', [-d for d in deficit])
pace_upstream('A3', 'STABILIZATION', [-SIT03_UPSTREAM_PACING * d for d in deficit])
add(WIP_OFF['A3'], bump(SIT03_WIP))
add(INST_OFF['A3'], bump({'08:45': 0, '09:20': 0.6, '09:40': 0}))
add(HEALTH_PEN['A3'], bump({'08:45': 0, '09:20': 0.3, '09:45': 0}))

# SIT04 — A4 Output restricted: the buffer level follows the profile and the
# outflow is whatever mass balance leaves; upstream is paced after the fix.
LEVEL_OVERRIDE['A4'] = SIT04_LEVEL
pace_upstream('A4', 'INSPECTION', bump(SIT04_UPSTREAM_PACING))
add(INST_OFF['A4'], bump({'09:15': 0, '09:55': 0.8, '10:10': 0.8, '10:40': 0}))
add(HEALTH_PEN['A4'], bump({'09:15': 0, '10:00': 0.4, '10:40': 0}))

# SIT08 — F5 Power Charge pushed; Shaping (and everything after it) holds its sustainable rate.
pc = sid('F5', 'POWER_CHARGE')
override(thr[pc], SIT08_POWER_CHARGE, sd=0.2, pins=('11:00', '11:45'))
override(thr[sid('F5', 'BULK_INTAKE')], SIT08_POWER_CHARGE, sd=0.4)   # intake feeds what Power Charge draws
cap = interp(SIT08_SHAPING_CAP)
win = window('10:05', '11:40')
for code in ('SHAPING', 'TRANSFER', 'OUTPUT'):
    s = thr[sid('F5', code)]
    for i in range(N):
        if win[i]:
            s[i] = min(s[i], cap[i] + 0.4 * (s[i] - thr_base[sid('F5', code)][i]) + rng.gauss(0, 0.3))
add(WIP_OFF['F5'], bump(SIT08_WIP))
add(INST_OFF['F5'], bump({'10:00': 0, '11:00': 1.0, '11:35': 1.2, '12:00': 0}))
add(SCRAP_OFF['F5'], bump({'10:00': 0, '11:00': 0.15, '11:35': 0.22, '12:05': 0}))
add(HEALTH_PEN['F5'], bump({'10:00': 0, '11:30': 0.3, '12:00': 0}))

# SIT09 — F3 Power Charge interruption at 11:42: Bulk Intake blocked, Shaping starved,
# Transfer empties then accumulates, Output follows; demand reduced 11:55, repaired 12:12.
override(thr[sid('F3', 'POWER_CHARGE')], SIT09_POWER_CHARGE, sd=0.2, fade=1)
# the reduced-demand period (11:55–12:15) runs the whole line slower
red = [x - F3_P if '11:55' <= t <= '12:15' else 0.0 for x, t in zip(interp(SIT09_POWER_CHARGE), TS)]
add(thr[sid('F3', 'BULK_INTAKE')], red)
add(thr[sid('F3', 'BULK_INTAKE')], bump({'11:40': 0, '11:45': -70.0, '11:50': 0}))
for code, pts in (('SHAPING', SIT09_SHAPING), ('TRANSFER', SIT09_TRANSFER), ('OUTPUT', SIT09_OUTPUT)):
    s = thr[sid('F3', code)]
    add(s, red)
    for t, v in pts.items():
        s[i_of(t)] = v + rng.gauss(0, 0.4)
for i, flag in enumerate(window(*SIT09_DOWN)):
    DOWN['F3'][i] = DOWN['F3'][i] or flag
add(WIP_OFF['F3'], bump(SIT09_WIP))
add(INST_OFF['F3'], bump(SIT09_INSTABILITY))

# SIT10 — F1 charge oscillation swings Power Charge output (and the stations it feeds).
swing = [c - 50.1 for c in interp(SIT10_CHARGE)]
win = window('12:30', '13:10')
sw = [SIT10_THROUGHPUT_PER_PCT * x if win[i] else 0.0 for i, x in enumerate(swing)]
add(thr[sid('F1', 'POWER_CHARGE')], sw)
starve_downstream('F1', 'POWER_CHARGE', [0.7 * x for x in sw])
add(INST_OFF['F1'], bump(SIT10_INSTABILITY))

# SIT11 — F6 Transfer blocked 13:20–13:38: controlled hold stops the whole line.
for code in ('BULK_INTAKE', 'POWER_CHARGE', 'SHAPING'):
    override(thr[sid('F6', code)], SIT11_UPSTREAM, fade=0)
override(thr[sid('F6', 'TRANSFER')], SIT11_TRANSFER, fade=0)
override(thr[sid('F6', 'OUTPUT')], SIT11_OUTPUT, fade=0)
for code in LINES['F6']['seq']:                 # a little count noise on the partial samples, none at zero
    s = thr[sid('F6', code)]
    for t in ('13:20', '13:40', '13:45'):
        if 0 < s[i_of(t)] < F6_P - 5:
            s[i_of(t)] += rng.gauss(0, 0.8)
for i, flag in enumerate(window(*SIT11_DOWN)):
    DOWN['F6'][i] = DOWN['F6'][i] or flag
add(INST_OFF['F6'], bump(SIT11_INSTABILITY))
add(WIP_OFF['F6'], bump({'13:15': 0, '13:20': 1.5, '13:35': 1.5, '13:45': 0.5, '13:55': 0}))

# SIT12 — F2 micro-stops from 13:10: each sample loses a fraction of its rate; with no
# store on a Ferrum line, Bulk Intake is blocked and the downstream stations starved alike.
loss = [SIT12_LOSS.get(t, 0.0) for t in TS]
for code in LINES['F2']['seq']:
    s = thr[sid('F2', code)]
    for i in range(N):
        s[i] *= 1 - loss[i]
add(INST_OFF['F2'], [0.6 + 6.0 * x if TS[i] >= '13:10' else 0.0 for i, x in enumerate(loss)])

# F4 planned changeover from 13:50: target → 0, the line runs down station by station.
for code, vals in F4_RUNDOWN.items():
    s = thr[sid('F4', code)]
    for t, v in zip(('13:50', '13:55', '14:00', '14:05'), vals):
        s[i_of(t)] = v + rng.gauss(0, 0.6 if v > 50 else 0.3)
add(INST_OFF['F4'], bump(F4_INSTABILITY))

# ── Aurelia buffer balance (per line) ─────────────────────────────────────
def buffer_balance(lc, inflow, overridden):
    """Level L and outflow o with o_i = pace_i + G·(L_i − sp) + e_i and
    L_{i+1} = L_i + (in_i − o_i)·STEP / units-per-%. Inside a level override (SIT04) the
    level is steered onto the profile and the simulation carries on from there; the
    outflow is then back-computed from the same mass balance, so it always closes."""
    bid = sid(lc, 'BUFFER')
    sp = SP[(bid, 'buffer_level')]
    e, pace = buffer_noise[lc], pace_series[lc]
    steer = [None] * N
    if overridden and lc in LEVEL_OVERRIDE:
        steer = [0.0] * N
        override(steer, {t: 1.0 for t in LEVEL_OVERRIDE[lc]}, fade=2)     # weights 0…1
        prof = [p + n for p, n in zip(interp(LEVEL_OVERRIDE[lc]), level_override_noise)]
    lvl, L = sp, []
    for i in range(N):
        if steer[i]:
            lvl = (1 - steer[i]) * lvl + steer[i] * prof[i]
        L.append(lvl)
        o = pace[i] + BUF_GAIN * (lvl - sp) + e[i]
        lvl += (inflow[i] - o) * STEP / BUF_UNITS_PER_PCT
    out = [inflow[i] - (L[i + 1] - L[i]) * BUF_UNITS_PER_PCT / STEP for i in range(N - 1)]
    out.append(pace[-1] + BUF_GAIN * (L[-1] - sp) + e[-1])
    return L, out


buf_level = {}
out_base = {}
for lc, L in LINES.items():
    out_id = sid(lc, 'OUTPUT')
    if 'BUFFER' in L['seq']:
        bid = sid(lc, 'BUFFER')
        setpoint(bid, 'buffer_level', 44.9, 1.75)
        _, o_b = buffer_balance(lc, thr_base[sid(lc, 'INSPECTION')], False)
        lvl, o = buffer_balance(lc, thr[sid(lc, 'INSPECTION')], True)
        buf_level[lc] = lvl
        thr[bid] = o
        thr[out_id] = [x + n for x, n in zip(o, output_count_noise[lc])]
        out_base[lc] = [x + n for x, n in zip(o_b, output_count_noise[lc])]
    else:
        out_base[lc] = thr_base[out_id]

for aid, s in thr.items():
    series[aid]['throughput_per_min'] = [max(0.0, x) for x in s]

# ── Coupled station signals ────────────────────────────────────────────────
for lc, L in LINES.items():
    pace = LINE_SP[lc][0]
    for code in L['seq']:
        aid = sid(lc, code)
        atype, s = A[aid]['assetType'], series[aid]
        q = s['throughput_per_min']
        if atype == 'stabilization':
            true_p = s.pop('process_pressure_psi')
            s['process_pressure_psi'] = [p + e for p, e in zip(true_p, ar1(0.10, 0.5))]
            off = sp_rng.gauss(*GAUGE_OFFSET)
            s['local_gauge_pressure_psi'] = [p + off + e for p, e in zip(true_p, ar1(*GAUGE_NOISE))]
            s['flow_rate_per_min'] = [x + e for x, e in zip(q, ar1(*FLOWMETER_NOISE))]
        elif atype == 'inspection':
            s['inspection_pass_rate'] = [100.0 - r for r in s['reject_rate_pct']]
            mean, spread, sd, phi = FPY_GAP
            gap = setpoint(aid, 'fpy_gap', mean, spread)
            s['first_pass_yield'] = None      # filled after the scenario signals (depends on rejects)
            s['_fpy_gap'] = [gap + e for e in ar1(sd, phi)]
        elif atype in MOTOR_CURRENT:
            mean, spread, sd, phi = MOTOR_CURRENT[atype]
            i0 = setpoint(aid, 'motor_current_a', mean, spread)
            s['motor_current_a'] = [i0 * max(MOTOR_IDLE_FRACTION, x / pace) + e * max(0.3, min(1.0, x / pace))
                                    for x, e in zip(q, ar1(sd, phi))]
            if atype == 'transfer':
                off = setpoint(aid, 'transfer_rate_offset', *TRANSFER_RATE_OFFSET)
                s['transfer_rate_per_min'] = [max(0.0, x + off * min(1.0, x / pace) + e * min(1.0, x / pace))
                                              for x, e in zip(q, ar1(*TRANSFER_RATE_NOISE))]
        elif atype == 'buffer':
            lvl, bid = buf_level[lc], aid
            s['buffer_level'] = lvl
            s['buffer_inflow_rate'] = list(series[sid(lc, 'INSPECTION')]['throughput_per_min'])
            s['buffer_outflow_rate'] = list(q)
            s['time_in_buffer'] = [l * BUF_UNITS_PER_PCT / o for l, o in zip(lvl, q)]
            s['buffer_turnover_rate'] = [TURNOVER_K / t for t in s['time_in_buffer']]
            a0, b0, sd, phi = BUF_SAT
            s['saturation_risk_index'] = [a0 * math.exp(b0 * (l - 45)) * (1 + e) for l, e in zip(lvl, ar1(sd, phi))]
            a0, b0, sd, phi = BUF_STARV
            s['starvation_risk_index'] = [a0 * math.exp(b0 * (l - 45)) * (1 + e) for l, e in zip(lvl, ar1(sd, phi))]
            util = rolling_mean(lvl, UTIL_WINDOW, SP[(bid, 'buffer_level')])
            s['buffer_capacity_utilization'] = [u + e for u, e in zip(util, ar1(0.3, 0.8))]

# ═════════════════════ Scenario footprints: signals ════════════════════════
def S(aid, key):
    return series[aid][key]


# SIT03 — regulator sluggish: control effort climbs while output falls; fixed 09:14–09:24.
ref = sid('A3', 'REFINEMENT')
override(S(ref, 'control_effort_pct'), SIT03_EFFORT, sd=0.15)
add(S(ref, 'process_variability'), bump({'08:45': 0, '09:20': 0.5, '09:40': 0}))
stress(ref, {'08:45': 0, '09:20': 4.0, '09:40': 0})

# SIT04 — the restricted Output station itself.
out4 = sid('A4', 'OUTPUT')
add(S(out4, 'on_time_output_rate'), bump({'09:15': 0, '09:40': -1.5, '10:05': -2.2, '10:30': -1.0, '10:50': 0}))
stress(out4, {'09:10': 0, '09:40': 5.0, '10:05': 5.0, '10:20': 0})
stress(sid('A4', 'BUFFER'), {'09:20': 0, '10:00': 3.0, '10:30': 0})

# SIT05 — F2 Power Charge bearing wear (still open): vibration and bearing temperature
# climb; charge rate, motor current and throughput stay where they were.
pc2 = sid('F2', 'POWER_CHARGE')
override(S(pc2, 'vibration_mms'), SIT05_VIBRATION, sd=0.035, fade=3, pins=('08:50', '13:55'))
add(S(pc2, 'bearing_temp_c'), interp(SIT05_BEARING_RISE))
add(S(pc2, 'energy_per_unit'), interp({'08:50': 0, '14:05': 0.12}))
vib_excess = [max(0.0, v - SIT05_VIBRATION['08:50']) for v in interp(SIT05_VIBRATION)]
vib_excess = [x if TS[i] >= '08:50' else 0.0 for i, x in enumerate(vib_excess)]
add(HEALTH_PEN['F2'], vib_excess, SIT05_HEALTH_PER_MMS)
stress(pc2, {'08:50': 0, '14:05': 3.0})

# SIT06 — A5 pressure transmitter: an additive error on the transmitter only.
st5 = sid('A5', 'STABILIZATION')
for t, e in SIT06_ERROR.items():
    S(st5, 'process_pressure_psi')[i_of(t)] += e
S(st5, 'process_pressure_psi')[i_of(SIT06_PEAK[0])] = SIT06_PEAK[1]     # the quoted "95 psi" reading

# SIT07 — A1 Refinement purity drifts first; Inspection rejects follow ~15 min later.
ref1, ins1 = sid('A1', 'REFINEMENT'), sid('A1', 'INSPECTION')
override(S(ref1, 'purity_pct'), SIT07_PURITY, sd=0.015)
drift = [SIT07_PURITY['09:45'] - p if w else 0.0
         for p, w in zip(interp(SIT07_PURITY), window('09:45', '11:10'))]            # 0 … 0.49 %
add(S(ref1, 'defect_rate'), drift, 1.0)
add(S(ref1, 'yield_rate'), drift, -1.6)
add(S(ref1, 'consistency_index'), drift, -4.0)
override(S(ins1, 'reject_rate_pct'), SIT07_REJECTS, sd=0.03, pins=('09:50', '10:40'))
S(ins1, 'inspection_pass_rate')[:] = [100.0 - r for r in S(ins1, 'reject_rate_pct')]
excess = [max(0.0, r - SP[(ins1, 'reject_rate_pct')]) if w else 0.0
          for r, w in zip(S(ins1, 'reject_rate_pct'), window('10:05', '11:25'))]
add(SCRAP_OFF['A1'], excess, SIT07_SCRAP_SHARE)
add(S(sid('A1', 'OUTPUT'), 'final_defect_rate'), excess, 0.03)
stress(ins1, {'10:05': 0, '10:40': 4.0, '11:10': 0})
add(HEALTH_PEN['A1'], bump({'10:05': 0, '10:40': 0.3, '11:15': 0}))

# SIT08 — F5: Shaping works harder on the extra feed: defects and rework rise, Transfer
# spends more time blocked; demand cut 4 % at 11:35 brings them back.
sh5, tr5 = sid('F5', 'SHAPING'), sid('F5', 'TRANSFER')
add(S(sh5, 'defect_rate'), bump({'10:00': 0, '11:00': 0.25, '11:35': 0.35, '12:05': 0}))
add(S(sh5, 'rework_rate'), bump({'10:00': 0, '11:00': 0.2, '11:35': 0.3, '12:05': 0}))
stress(sh5, {'10:00': 0, '11:30': 5.0, '12:05': 0})
stress(sid('F5', 'POWER_CHARGE'), {'10:00': 0, '11:00': 3.0, '11:35': 3.0, '11:50': 0})
override(S(tr5, 'blocking_time'), SIT08_BLOCKING, sd=0.06)

# SIT09 — F3: the power-delivery fault shows at Power Charge first; downstream starvation
# and accumulation follow within the same sample.
pc3, tr3 = sid('F3', 'POWER_CHARGE'), sid('F3', 'TRANSFER')
override(S(tr3, 'starvation_time'), SIT09_STARVATION, sd=0.03, fade=1)
override(S(tr3, 'blocking_time'), SIT09_BLOCKING, sd=0.03, fade=1)
add(S(pc3, 'controller_output_pct'), bump({'11:40': 0, '11:45': 12.0, '11:50': 7.0, '11:55': 0}))
add(S(pc3, 'charge_rate'), bump({'11:40': 0, '11:45': -9.0, '11:50': 2.5, '11:55': -2.5, '12:15': -2.5, '12:20': 0}))
add(S(pc3, 'oscillation_index'), bump({'11:40': 0, '11:45': 1.8, '11:55': 1.2, '12:10': 0}))
stress(pc3, {'11:40': 0, '11:45': 8.0, '12:00': 4.0, '12:20': 0})
stress(tr3, {'11:40': 0, '11:50': 5.0, '12:05': 0})
stress(sid('F3', 'SHAPING'), {'11:40': 0, '11:45': 4.0, '12:00': 0})

# SIT10 — F1: charge rate and controller output swing against each other.
pc1 = sid('F1', 'POWER_CHARGE')
override(S(pc1, 'charge_rate'), SIT10_CHARGE, sd=0.08, fade=1, pins=('12:40', '12:45'))
co = S(pc1, 'controller_output_pct')
cr = S(pc1, 'charge_rate')
for i, w in enumerate(window('12:30', '13:10')):
    if w:
        co[i] = SP[(pc1, 'controller_output_pct')] + SIT10_CONTROLLER_GAIN * (cr[i] - 50.1) + rng.gauss(0, 0.2)
override(S(pc1, 'oscillation_index'), SIT10_OSCILLATION, sd=0.08)
add(S(pc1, 'energy_per_unit'), bump({'12:30': 0, '12:45': 0.25, '13:10': 0}))
stress(pc1, {'12:30': 0, '12:45': 7.0, '13:10': 0})

# SIT11 — F6 Transfer: current spike at the jam, idle current during the hold, restart surge.
tr6 = sid('F6', 'TRANSFER')
for t, v in SIT11_MOTOR.items():
    S(tr6, 'motor_current_a')[i_of(t)] = v + rng.gauss(0, 0.3)
override(S(tr6, 'starvation_time'), SIT11_STARVATION, sd=0.03, fade=1)
stress(tr6, {'13:15': 0, '13:20': 12.0, '13:35': 6.0, '13:45': 4.0, '13:55': 0})

# SIT12 — F2 micro-stops: Transfer starvation tracks each lost fraction; charge demand
# is highest when the stops cluster.
tr2 = sid('F2', 'TRANSFER')
add(S(tr2, 'starvation_time'), loss, SIT12_STARVATION_PER_LOSS)
add(S(pc2, 'charge_rate'), loss, 12.0)
add(S(pc2, 'oscillation_index'), [0.4 + 3.0 * x if TS[i] >= '13:10' else 0.0 for i, x in enumerate(loss)])
stress(pc2, {'13:05': 0, '13:20': 2.5, '14:05': 3.0})

# SIT13 — A6: input characteristic shifts first; purity follows; a validated control
# step at 13:08 restores purity while the input stays shifted.
ref6 = sid('A6', 'REFINEMENT')
override(S(ref6, 'input_characteristic_index'), SIT13_INPUT, sd=0.35, fade=3)
override(S(ref6, 'purity_pct'), SIT13_PURITY, sd=0.015, pins=('12:00', '13:05'))
add(S(ref6, 'control_effort_pct'), [SIT13_EFFORT_STEP if t >= SIT13_ADJUST else 0.0 for t in TS])
pdrop = [max(0.0, 99.28 - p) if w else 0.0 for p, w in zip(interp(SIT13_PURITY), window('12:00', '13:50'))]
add(S(ref6, 'defect_rate'), pdrop, 0.5)
add(S(sid('A6', 'INSPECTION'), 'reject_rate_pct'), [0.0, 0.0] + pdrop[:-2], 1.0)   # ~10 min later
S(sid('A6', 'INSPECTION'), 'inspection_pass_rate')[:] = [100.0 - r for r in S(sid('A6', 'INSPECTION'), 'reject_rate_pct')]
add(S(sid('A6', 'OUTPUT'), 'output_quality_score'), [0.0, 0.0, 0.0] + pdrop[:-3], -0.6)
add(HEALTH_PEN['A6'], pdrop, 0.3)

# F4 changeover: charge rate eased down, energy per unit rises as fixed losses spread over few units.
pc4 = sid('F4', 'POWER_CHARGE')
override(S(pc4, 'charge_rate'), F4_CHARGE, sd=0.2, fade=1)
override(S(pc4, 'energy_per_unit'), F4_ENERGY, sd=0.02, fade=1)
stress(pc4, {'13:45': 0, '14:00': 4.0, '14:05': 4.0})

# First-pass yield follows the (final) pass rate.
for lc, L in LINES.items():
    if 'INSPECTION' in L['seq']:
        s = series[sid(lc, 'INSPECTION')]
        s['first_pass_yield'] = [p - g for p, g in zip(s['inspection_pass_rate'], s.pop('_fpy_gap'))]

# ── Line KPIs (rolling 24 h) and line flow keys ─────────────────────────────
F4_PLANNED = [t >= F4_CHANGEOVER for t in TS]
for lc, L in LINES.items():
    lid = L['id']
    pace, target, avail0, scrap0, wip0, inst0, health0, fe0 = LINE_SP[lc]
    s = series[lid]
    out = series[sid(lc, 'OUTPUT')]['throughput_per_min']
    s['line_throughput'] = out
    planned = F4_PLANNED if lc == 'F4' else [False] * N
    s['line_target_rate'] = [0.0 if p else float(target) for p in planned]
    # lost units since 08:00, split into unplanned downtime (availability) and slow running
    # (performance); a planned changeover is excluded from both. Catch-up above normal counts back.
    down_cum = perf_cum = qual_cum = 0.0
    avail, perf, qf = [], [], []
    n_a, n_p, n_q = ar1(*LINE_NOISE['avail']), ar1(*LINE_NOISE['perf']), ar1(*LINE_NOISE['qf'])
    perf0 = min(99.8, 100.0 * pace / target)
    for i in range(N):
        if not planned[i]:
            lost = (out_base[lc][i] - out[i]) * STEP
            if DOWN[lc][i]:
                down_cum += lost
            else:
                perf_cum += lost
            qual_cum += SCRAP_OFF[lc][i] / 100.0 * out[i] * STEP
        denom = KPI_WINDOW_MIN * target
        avail.append(avail0 + n_a[i] - 100.0 * down_cum / denom)
        perf.append(min(100.0, perf0 + n_p[i] - 100.0 * perf_cum / denom))
        qf.append(100.0 - scrap0 + n_q[i] - 100.0 * qual_cum / denom)
    s['line_availability'], s['line_performance'], s['line_quality_factor'] = avail, perf, qf
    s['line_oee'] = [a * p * q / 1e4 for a, p, q in zip(avail, perf, qf)]
    s['line_scrap_rate'] = [scrap0 + e + o for e, o in zip(ar1(*LINE_NOISE['scrap']), SCRAP_OFF[lc])]
    s['total_wip'] = [wip0 + e + o for e, o in zip(ar1(*LINE_NOISE['wip']), WIP_OFF[lc])]
    s['instability_index'] = [inst0 + e + o for e, o in zip(ar1(*LINE_NOISE['instab']), INST_OFF[lc])]
    s['system_health_index'] = [health0 + e - HEALTH_PER_INSTABILITY * o - h
                                for e, o, h in zip(ar1(*LINE_NOISE['health']), INST_OFF[lc], HEALTH_PEN[lc])]
    wip_rise = [WIP_OFF[lc][i] - WIP_OFF[lc][max(0, i - 12)] for i in range(N)]
    s['flow_efficiency'] = [fe0 + e - FLOW_EFF_PER_WIP * w for e, w in zip(ar1(*LINE_NOISE['fe']), wip_rise)]

# ── Refinery rollups (declared derivations, every point) ───────────────────
ROLLUP = [('refinery_throughput', 'sum', 'line_throughput'), ('refinery_target_rate', 'sum', 'line_target_rate'),
          ('refinery_oee', 'mean', 'line_oee'), ('refinery_availability', 'mean', 'line_availability'),
          ('refinery_performance', 'mean', 'line_performance'),
          ('refinery_quality_factor', 'mean', 'line_quality_factor'),
          ('refinery_health_index', 'mean', 'system_health_index'),
          ('refinery_instability_index', 'max', 'instability_index')]
FNS = {'sum': sum, 'mean': lambda xs: sum(xs) / len(xs), 'max': max}

# ── Attention-item text (verbatim from the hand-built pack; the checks at the end keep
#    every number it quotes true of the generated data) ──────────────────────
TEXT = {
    'SIT02': dict(
        severity='low', state='watch', outcome='resolved',
        signal='Busy shift, no equipment issues',
        ai='Heavy planned workload (sample, inspection, huddle, changeover prep) — all handled on schedule.',
        d_signal='Ferrum F4 carried a full slate of planned work today — quality sample, Power Charge inspection, production huddle, and changeover preparation — alongside routine production.',
        d_observed='All four planned activities on F4 completed on or ahead of schedule; no equipment faults logged.',
        d_derived='Workload density was high for this shift, but every task had a clear owner and none competed for the same window.',
        d_inferred='This is what "busy but healthy" looks like — task volume alone is not a signal of trouble.',
        d_recommendation='No action needed — included here to show the AI stayed quiet through a genuinely busy (not broken) shift.',
        related=[],
        changed_summary='Nothing changed — this is a record of normal operation under a heavier-than-usual workload.',
        changed=[],
        confidence='Confirmed — routine workload, not a fault',
        confidenceLevel='high',
        risk='None at this time',
        riskLevel='none',
        expectedOutcome='Shift concluded with all planned work complete',
    ),
    'SIT03': dict(
        severity='medium', state='watch', outcome='resolved',
        signal='Refinement regulator response slowed, since corrected',
        ai='Throughput dipped as control effort rose — a sluggish regulating element, confirmed and adjusted.',
        d_signal='Refinement throughput drifted from ~121 down to ~111 units/min between 08:46 and 09:24, while control effort rose to compensate.',
        d_observed='Throughput persistently below expected profile; control effort increased while output declined.',
        d_derived='The rising-effort/falling-output combination is a classic early signature of a mechanical response problem, not a demand change.',
        d_inferred='A sluggish regulating element — confirmed by inspection, which found the regulator responding slower than spec.',
        d_recommendation='Inspect and adjust the regulating element before the drift compounds further.',
        related=[{'date': 'Ruled out', 'summary': 'Measurement bias considered and rejected — the drift showed up consistently across multiple independent signals, not one sensor.'}],
        changed_summary='Operator inspection at 09:14 found and adjusted a sluggish regulating element — that is what actually changed.',
        changed=[
            ('09:14', 'Operator Action', 'Began Refinement regulator inspection.'),
            ('09:24', 'Result', 'Adjustment completed; throughput back to baseline within minutes.'),
        ],
        confidence='Confirmed by inspection',
        confidenceLevel='high',
        risk='Low — caught and corrected before quality impact',
        riskLevel='low',
        expectedOutcome='Refinement returned to expected operating profile',
    ),
    'SIT04': dict(
        severity='medium', state='watch', outcome='resolved',
        signal='Buffer accumulation reversed after downstream fix',
        ai='Output ran below incoming flow for ~22 minutes; downstream restriction cleared and buffer normalized.',
        d_signal='Buffer level on A4 climbed from ~42% to a peak of ~71% between 09:14 and 10:10 while Output ran below incoming flow.',
        d_observed='Output rate below incoming flow while upstream remained stable; net accumulation positive for 22 minutes.',
        d_derived='A persistent (not momentary) rate gap — this is a capacity problem downstream, not a supply spike upstream.',
        d_inferred='Downstream Output capacity restriction — confirmed by inspection and cleared.',
        d_recommendation='Inspect Output capacity; once cleared, briefly pace upstream to help the buffer normalize faster.',
        related=[],
        changed_summary='Output capacity inspection at 09:54 found and cleared the restriction — buffer recovery began within minutes.',
        changed=[
            ('09:54', 'Work Event', 'Output capacity inspection started.'),
            ('10:05', 'Operator Action', 'Output restriction cleared.'),
        ],
        confidence='Confirmed by inspection',
        confidenceLevel='high',
        risk='Low — resolved before hitting capacity',
        riskLevel='low',
        expectedOutcome='Buffer returned to normal working range',
    ),
    'SIT05': dict(
        severity='medium', state='investigate', outcome='none',
        signal='Power Charge vibration climbing at steady load',
        ai='Vibration has risen steadily since morning at comparable load — consistent with prior bearing wear, still being confirmed.',
        d_signal='Power Charge drive vibration has climbed from ~2.5 to ~4.4 mm/s since 08:50, at comparable operating load each time.',
        d_observed='Vibration elevated at comparable load; prior inspection noted minor bearing wear; faint roughness audible near the drive housing.',
        d_derived="Because load hasn't changed, the rising vibration points at the equipment itself rather than a process condition.",
        d_inferred='Progressive bearing wear — same leading theory as the last inspection, not yet confirmed by a new one.',
        d_recommendation='Planned drive inspection already underway — do not defer past this cycle.',
        related=[{'date': 'Ruled out', 'summary': 'Temporary load variation considered and rejected — vibration keeps climbing even at matched load.'}],
        changed_summary='A planned drive inspection began at 14:00 — evaluating whether it confirms bearing wear.',
        changed=[
            ('14:00', 'Maintenance', 'Planned drive inspection started.'),
        ],
        confidence='Likely, pending inspection result',
        confidenceLevel='medium',
        risk='Medium — degrading component, not yet failed',
        riskLevel='medium',
        expectedOutcome='Inspection in progress as of this reading',
    ),
    'SIT06': dict(
        severity='low', state='watch', outcome='resolved',
        signal='Pressure transmitter noise traced to loose connection',
        ai='Transmitter read erratically while the local gauge stayed steady — a measurement fault, not a process problem.',
        d_signal='Stabilization pressure transmitter swung between roughly 80 and 95 psi from 09:40, while the local mechanical gauge and downstream flow stayed steady throughout.',
        d_observed='Pressure signal varies rapidly in both directions; local mechanical gauge remains steady.',
        d_derived='Related flow remained stable the whole time — a real process swing this large would have shown up there too.',
        d_inferred='Measurement/transmitter instability, not a real pressure event — confirmed by reseating the connection.',
        d_recommendation='Validate the instrument against the local gauge before trusting the transmitter reading again.',
        related=[{'date': 'Ruled out', 'summary': 'True process pressure oscillation considered and rejected — related flow signal never moved.'}],
        changed_summary='Field validation compared the transmitter against the local gauge and found the mismatch.',
        changed=[
            ('09:50', 'Field Check', 'Instrument validated against local gauge.'),
            ('10:04', 'Result', 'Transmitter reseated; signal restored.'),
        ],
        confidence='Confirmed by corroborating signals',
        confidenceLevel='high',
        risk='Low — measurement-only, no real process risk',
        riskLevel='low',
        expectedOutcome='Sensor agreement restored',
    ),
    'SIT07': dict(
        severity='medium', state='watch', outcome='resolved',
        signal='Inspection rejects traced to upstream Refinement, not Inspection itself',
        ai='Rejects rose at Inspection first, but the real cause was upstream — confirmed and corrected.',
        d_signal='Inspection reject rate rose from ~1.9% to a peak of 6.6% between 10:15 and 10:40, then declined after Refinement was adjusted.',
        d_observed='Reject rate elevated at Inspection; independent quality check confirmed the rejects were real, not a false read.',
        d_derived='Refinement purity drift began before the reject rise — the timing points upstream, not at Inspection itself.',
        d_inferred='Upstream Refinement quality degradation was the true cause — Inspection was just where it became visible first.',
        d_recommendation='Correct the upstream Refinement condition rather than adjusting Inspection settings.',
        related=[{'date': 'Ruled out', 'summary': 'Inspection calibration fault considered and rejected — calibration checked healthy throughout.'}, {'date': 'Ruled out', 'summary': 'Material variation considered and rejected — multiple lots showed the same pattern.'}],
        changed_summary='An independent quality check at 10:40 confirmed the rejects were real, then Refinement was adjusted at 10:43.',
        changed=[
            ('10:40', 'Quality Event', 'Independent check confirmed Inspection rejects were valid.'),
            ('10:43', 'Operator Action', 'Refinement condition adjusted.'),
        ],
        confidence='Confirmed — upstream link established',
        confidenceLevel='high',
        risk='Medium — real quality impact while the source was unclear',
        riskLevel='medium',
        expectedOutcome='Upstream recovered, rejects returned to expected range',
    ),
    'SIT08': dict(
        severity='medium', state='watch', outcome='resolved',
        signal='Headline throughput looked fine while effective output quietly slipped',
        ai='Gross rate stayed near target while WIP and micro-stops crept up — an unsustainable pace, since corrected.',
        d_signal="F5's gross throughput held near 120-126 units/min throughout, but effective good-output rate and micro-stop frequency showed the line was working harder than the headline number suggested.",
        d_observed='Headline throughput remains near target.',
        d_derived='WIP and micro-stop frequency rose despite the headline number holding — a gap between the top-line KPI and what is actually sustainable.',
        d_inferred='Power Charge demand exceeded sustainable downstream capacity — the "good" number was hiding a real cost.',
        d_recommendation='Reduce the aggressive upstream pacing rather than chasing the headline rate.',
        related=[{'date': 'Ruled out', 'summary': 'Downstream hardware degradation considered and rejected — no equipment fault signal present.'}],
        changed_summary='Operating demand was reduced by roughly 4% once the effective-vs-gross gap was recognized.',
        changed=[
            ('11:35', 'Setpoint Change', 'Power Charge demand reduced ~4%.'),
        ],
        confidence='Confirmed — pattern held across gross/effective/WIP together',
        confidenceLevel='high',
        risk='Medium — hidden losses, not visible on the headline KPI alone',
        riskLevel='medium',
        expectedOutcome='Flow stabilized and effective output improved',
    ),
    'SIT09': dict(
        severity='high', state='watch', outcome='resolved',
        signal='Power Charge fault cascaded downstream, now recovered',
        ai='Repeated Power Charge interruptions triggered starvation and WIP surges downstream — source repaired, line recovered.',
        d_signal='Power Charge suffered repeated output interruptions starting 11:42, with Shaping starving and Transfer accumulating within a minute each time.',
        d_observed='Power Charge interruptions precede each downstream disturbance, in a consistent order.',
        d_derived='Event ordering and topology point at Power Charge as the origin, not a coincidence across three stations.',
        d_inferred='A power-delivery fault at Power Charge was the cascade origin — confirmed and repaired.',
        d_recommendation='Reduce demand immediately to stop propagation, then repair the source fault directly.',
        related=[],
        changed_summary='Demand was reduced immediately to stop the cascade, then the power-delivery fault at the source was repaired.',
        changed=[
            ('11:42', 'Event', 'Power Charge output interruption (first of several).'),
            ('11:43', 'Event', 'Transfer accumulation rising during recovery.'),
            ('11:55', 'Operator Action', 'Demand reduced to stop propagation.'),
        ],
        confidence='Confirmed by event ordering and topology',
        confidenceLevel='high',
        risk='High — fleet-wide propagation while active',
        riskLevel='high',
        expectedOutcome='Line recovered from cascade',
    ),
    'SIT10': dict(
        severity='high', state='watch', outcome='resolved',
        signal='Manual corrections amplified an oscillation, since damped',
        ai='Charge variable swung further with each manual correction — aggressive response, not a sensor fault.',
        d_signal='Power Charge variable oscillated between roughly 44% and 57% from 12:35, with manual corrections issued every few minutes.',
        d_observed='Oscillation amplitude increases across successive cycles; manual corrections occur within the process response lag.',
        d_derived='Each correction was issued before the prior one settled — that timing pattern grows the oscillation, not the process itself.',
        d_inferred='Control response too aggressive for current process dynamics — confirmed, not a sensor issue.',
        d_recommendation='Stop repeated manual correction and return to the validated stabilization setting.',
        related=[{'date': 'Ruled out', 'summary': 'Sensor instability considered and rejected — the swings tracked real control actions, not a bad reading.'}],
        changed_summary='Repeated manual corrections were the change — returning to the validated stabilization setting is what actually damped it.',
        changed=[
            ('12:36', 'Setpoint Change', 'Manual correction, target 47%.'),
            ('12:39', 'Setpoint Change', 'Manual correction, target 53%.'),
            ('12:42', 'Setpoint Change', 'Manual correction, target 46%.'),
        ],
        confidence='Confirmed by action timing vs. response lag',
        confidenceLevel='high',
        risk='High — dynamic instability while active',
        riskLevel='high',
        expectedOutcome='Oscillation damped and process stabilized',
    ),
    'SIT11': dict(
        severity='high', state='watch', outcome='resolved',
        signal='Transfer physically blocked, cleared via validated procedure',
        ai='Flow dropped to zero with a motor current spike — a physical obstruction, confirmed and cleared.',
        d_signal='Transfer rate dropped to zero at 13:20 while motor current spiked — flow stayed at zero for roughly 18 minutes before clearing.',
        d_observed='Transfer rate dropped to zero while motor current spiked; an Aetherium shard was visible in the Transfer gate.',
        d_derived='A current spike alongside a hard stop (not a gradual decline) is the signature of a physical obstruction, not a control issue.',
        d_inferred='Physical Transfer obstruction — confirmed visually, cleared by validated procedure.',
        d_recommendation='Controlled hold, confirm the obstruction, then use the validated block-clearing procedure — do not attempt to force flow.',
        related=[],
        changed_summary='A confirmed physical obstruction was cleared using the validated block-clearing procedure.',
        changed=[
            ('13:20', 'Alarm', 'Transfer movement blocked.'),
            ('13:21', 'Operator Action', 'Line entered controlled hold.'),
            ('13:31', 'Maintenance', 'Aetherium shard confirmed at Transfer gate.'),
            ('13:38', 'Maintenance', 'Validated block-clearing procedure completed.'),
        ],
        confidence='Confirmed visually',
        confidenceLevel='high',
        risk='High — full stoppage while active',
        riskLevel='high',
        expectedOutcome='Transfer flow and WIP returned to normal',
    ),
    'SIT12': dict(
        severity='medium', state='investigate', outcome='none',
        signal='Recurring Power Charge micro-stops accumulating real loss',
        ai='Individually trivial interruptions are now ~3x baseline frequency — not urgent alone, meaningful together.',
        d_signal='21 short Power Charge interruptions logged since 13:10, running at roughly 3x the normal frequency for this operating state.',
        d_observed='Micro-stop frequency ~3x contextual baseline; interruptions strongest at the highest charge-demand periods.',
        d_derived='Individually each stop is seconds long and recovers on its own — the significance is in the accumulation, not any single event.',
        d_inferred='Unstable high-demand operating region is the leading theory; progressive component degradation is possible but less supported so far.',
        d_recommendation="Inspect during the next planned pause; current pattern doesn't justify an immediate stop, but recurrence is increasing.",
        related=[{'date': 'Ferrum · F2 · Power Charge — Component Degradation', 'summary': 'Same station is also showing rising vibration — worth investigating whether these two are connected.'}],
        changed_summary='No single triggering change — frequency has been building since 13:10 without one specific cause yet identified.',
        changed=[],
        confidence='Likely, not yet confirmed',
        confidenceLevel='medium',
        risk='Medium — estimated 4.2% production loss and still accumulating',
        riskLevel='medium',
        expectedOutcome='Still active as of the latest reading',
    ),
    'SIT13': dict(
        severity='medium', state='watch', outcome='resolved',
        signal='Purity trended toward spec limit, corrected before breach',
        ai='An input characteristic shift pushed purity down gradually — caught and corrected before going out of spec.',
        d_signal='Purity on A6 drifted from ~99.3% down to ~98.7% between 12:00 and 12:48, staying within spec but trending the wrong way.',
        d_observed='Input characteristic shifted before the purity decline began; purity remained in specification but the trend was persistent.',
        d_derived='A persistent trend rather than noise — the direction mattered more than any single reading.',
        d_inferred='An input characteristic shift not fully compensated by the current Refinement setting — confirmed and corrected.',
        d_recommendation='Apply a small validated Refinement adjustment before the margin narrows further; coordinate with Quality.',
        related=[{'date': 'Ruled out', 'summary': 'Quality measurement drift considered and rejected — the input characteristic shift was independently confirmed.'}],
        changed_summary='A small validated Refinement adjustment at 13:08 is what reversed the trend.',
        changed=[
            ('12:48', 'Quality Event', 'Purity margin narrowing flagged.'),
            ('13:08', 'Setpoint Change', 'Small validated Refinement adjustment applied.'),
        ],
        confidence='Confirmed',
        confidenceLevel='high',
        risk='Medium while trending — real risk of a quality escape if left uncorrected',
        riskLevel='medium',
        expectedOutcome='Quality margin restored',
    ),
    'SIT14': dict(
        severity='low', state='watch', outcome='recovering',
        signal='Changeover prerequisites were behind, now clear',
        ai='Material staging and quality release were at risk of missing the 14:00 changeover — both cleared, changeover proceeding.',
        d_signal='At 12:00, material staging (40 min typical) and quality release (20 min typical) for the Grade B changeover had not yet started, threatening the 14:00 target.',
        d_observed='Material staging not started (typical duration 40 minutes); quality release pending (typical duration 20 minutes).',
        d_derived='Both prerequisites were sequential enough that finishing on time required starting soon — a schedule-risk read, not an equipment problem.',
        d_inferred='Incomplete cross-team prerequisites were the risk — resolved by parallelizing the two requests instead of running them back-to-back.',
        d_recommendation='Parallelize Materials and Quality requests rather than sequencing them — already done here.',
        related=[],
        changed_summary='Parallelizing the two prerequisite requests (instead of running them in sequence) is what cleared the risk.',
        changed=[
            ('12:30', 'Work Coordination', 'Materials and Quality requests parallelized.'),
            ('13:31', 'Quality', 'Grade B quality release complete.'),
            ('13:52', 'Materials', 'Grade B material staging complete.'),
        ],
        confidence='Confirmed',
        confidenceLevel='high',
        risk='Low — prerequisites clear, changeover itself just running a few minutes long',
        riskLevel='low',
        expectedOutcome='All prerequisites met; changeover in progress toward Grade B',
    ),
}

# ── Round, clamp to the gauge range, assemble ─────────────────────────────
def finish(key, xs):
    lo, hi = PROPS[key][4]
    return [rnd(min(hi, max(lo, x))) for x in xs]


clamped = {}
for a in assets:
    if a['assetLevel'] == 'refinery':
        continue
    s = series[a['id']]
    for key in TYPE_PROPS[a['assetType']]:
        lo, hi = PROPS[key][4]
        clamped[(a['id'], key)] = sum(1 for x in s[key] if x < lo or x > hi)
    series[a['id']] = {key: finish(key, s[key]) for key in TYPE_PROPS[a['assetType']]}
for lc, L in LINES.items():   # line throughput IS the Output station's count
    series[L['id']]['line_throughput'] = series[sid(lc, 'OUTPUT')]['throughput_per_min']
for rid, _, line_codes, _ in REFINERIES:
    lines = [series[LINES[lc]['id']] for lc in line_codes]
    series[rid] = {prop: [rnd(FNS[fn]([ln[of][i] for ln in lines])) for i in range(N)] for prop, fn, of in ROLLUP}
    series[rid] = {k: series[rid][k] for k in TYPE_PROPS['refinery']}

values = {a['id']: {k: s_[-1] for k, s_ in series[a['id']].items()} for a in assets}


# ── Attention items (text kept verbatim from the hand-built pack) ──────────
def fmt_value(pattern, x):
    return pattern.format(x)


def since_text(mins, resolved):
    h, m = divmod(mins, 60)
    body = f'{h}h {m}m ago' if h else f'{m}m ago'
    return f'Resolved {body}' if resolved else body


def v(aid, key, t):
    return series[aid][key][i_of(t)]


attention = []
for iid, (aid, key, since_t, fmt, points) in EVIDENCE.items():
    t = TEXT[iid]
    unit_id = unit_of(aid)
    mins = NOW_MIN - minutes(since_t)
    if fmt is None:           # status-code evidence (planned work / prerequisites), not a series
        ev = [c for _, _, _, c in points]
        evp = [{'time': tm, 'value': val, 'label': note} for tm, val, note, _ in points]
    else:
        ev = [v(aid, key, tm) for tm, _ in points]
        evp = [{'time': tm, 'value': fmt_value(fmt, v(aid, key, tm)), 'label': note} for tm, note in points]
    attention.append({
        'id': iid, 'severity': t['severity'], 'asset': label_of(aid), 'line': A[unit_id]['name'],
        'signal': t['signal'], 'aiInterpretation': t['ai'],
        'since': since_text(mins, t['outcome'] == 'resolved'), 'sinceMinutes': mins, 'attentionState': t['state'],
        'detail': {
            'signal': t['d_signal'], 'observed': t['d_observed'], 'derived': t['d_derived'],
            'inferred': t['d_inferred'], 'recommendation': t['d_recommendation'],
            'evidence': ev, 'evidencePoints': evp, 'relatedOccurrences': t['related'],
            'whatChangedSummary': t['changed_summary'],
            'whatChanged': [{'time': tm, 'source': src, 'description': d, 'related': True} for tm, src, d in t['changed']],
            'confidence': t['confidence'], 'confidenceLevel': t['confidenceLevel'],
            'risk': t['risk'], 'riskLevel': t['riskLevel'], 'expectedOutcome': t['expectedOutcome'],
            'outcomeStatus': t['outcome']},
        'assetId': aid, 'unitId': unit_id, 'primaryProperty': key,
    })


# ── Work items ─────────────────────────────────────────────────────────────
def iso(hhmm):
    return f'{DATE}T{hhmm}:00' if hhmm else None


def work(wid, text, desc, aid, wtype, prio, src_type, src_label, source, role, start, due, dur, done, completed,
         created, extra=None):
    w = {'id': wid, 'text': text, 'description': desc, 'assetLabel': label_of(aid), 'workType': wtype,
         'priority': prio, 'sourceType': src_type, 'sourceLabel': src_label, 'source': source,
         'assignedRole': role, 'plannedStart': iso(start), 'dueAt': iso(due), 'estimatedDurationMinutes': dur,
         'done': done, 'completedAt': iso(completed)}
    w.update(extra or {})
    w.update({'createdAt': iso(created), 'assetId': aid})
    return w


work_items = [
    work('wk-001', 'Routine quality sample', 'Verify current Grade A quality', 'FERRUM_F4_OUTPUT', 'SAMPLE', 'routine',
         'planned', None, 'operator', 'Operator', '08:45', '08:45',
         10, True, '08:49', '08:45'),
    work('wk-002', 'Power Charge inspection', 'Routine condition inspection', 'FERRUM_F4_POWER_CHARGE', 'INSPECTION', 'routine',
         'planned', None, 'operator', 'Operator', '09:30', '09:40',
         15, True, '09:36', '09:30'),
    work('wk-003', 'Production huddle', 'Morning line-status huddle', 'FERRUM_F4', 'HUDDLE', 'routine',
         'planned', None, 'operator', 'Operator', '10:00', '10:05',
         10, True, '10:06', '10:00'),
    work('wk-004', 'Change to Grade B', 'Planned grade change', 'FERRUM_F4', 'CHANGEOVER', 'important',
         'planned', None, 'operator', 'Operator', '14:00', '14:00',
         28, False, None, '14:00',
         extra={'dependencies': [{'label': 'Stage Grade B material (Materials)', 'done': True}, {'label': 'Release Grade B quality (Quality)', 'done': True}, {'label': 'Operator go-ahead', 'done': True}], 'progressNote': 'Prerequisites are clear — changeover itself is in progress and running a few minutes past its planned completion.'}),
    work('wk-005', 'Stage Grade B material', 'Stage material before changeover', 'FERRUM_F4', 'MATERIAL_STAGE', 'important',
         'planned', None, 'operator', 'Materials', '13:10', '13:40',
         40, True, '13:52', '13:10'),
    work('wk-006', 'Release Grade B', 'Quality approval for changeover', 'FERRUM_F4', 'QUALITY_RELEASE', 'important',
         'planned', None, 'operator', 'Quality', '13:10', '13:40',
         20, True, '13:31', '13:10'),
    work('wk-007', 'Inspect Power Charge drive', 'Condition-driven bearing inspection', 'FERRUM_F2_POWER_CHARGE', 'INSPECTION', 'important',
         'situation', 'From: Component Degradation investigation', 'ai', 'Maintenance', '14:00', '14:05',
         15, False, None, '14:00'),
    work('wk-008', 'Inspect recurring micro-stops', 'Review high-demand interruption pattern', 'FERRUM_F2_POWER_CHARGE', 'INSPECTION', 'important',
         'situation', 'From: Recurring Micro-stops pattern', 'ai', 'Maintenance', '14:00', '14:20',
         15, False, None, '14:00'),
    work('wk-009', 'Inspect Refinement regulator', 'Check sluggish regulating response', 'AURELIA_A3_REFINEMENT', 'INSPECTION', 'important',
         'situation', 'From: Quiet Drift investigation', 'ai', 'Operator', '09:15', '09:30',
         15, True, '09:24', '09:15'),
    work('wk-010', 'Inspect Output capacity', 'Check downstream restriction causing buffer accumulation', 'AURELIA_A4_OUTPUT', 'INSPECTION', 'important',
         'situation', 'From: Buffer Saturation investigation', 'ai', 'Operator', '09:55', '10:10',
         15, True, '10:05', '09:55'),
    work('wk-011', 'Validate pressure indication', 'Compare transmitter with local gauge', 'AURELIA_A5_STABILIZATION', 'INSTRUMENT_CHECK', 'important',
         'situation', 'From: Signal Noise investigation', 'ai', 'Field Operator', '09:50', '10:10',
         15, True, '10:04', '09:50'),
    work('wk-012', 'Validate Inspection rejects', 'Independent reference quality check', 'AURELIA_A1_INSPECTION', 'QUALITY_CHECK', 'important',
         'situation', 'From: Ghost Signal investigation', 'ai', 'Quality', '10:30', '10:45',
         15, True, '10:40', '10:30'),
    work('wk-013', 'Stabilize Power Charge fault', 'Investigate recurring power-delivery interruptions', 'FERRUM_F3_POWER_CHARGE', 'MAINTENANCE', 'urgent',
         'situation', 'From: Cascade Failure', 'ai', 'Maintenance', '11:55', '12:20',
         25, True, '12:12', '11:55'),
    work('wk-014', 'Resolve Transfer block', 'Validated block-clearing response', 'FERRUM_F6_TRANSFER', 'PROCEDURE', 'urgent',
         'situation', 'From: Hard Block', 'ai', 'Operator', '13:21', '13:35',
         20, True, '13:38', '13:21'),
]

unit_status = {LINES[lc]['id']: {'state': st, 'statusSinceMinutes': m, 'mode': mode, 'product': prod}
               for lc, (st, m, mode, prod) in UNIT_STATUS.items()}

# ── Checks: the numbers the (verbatim) text quotes must be true of the data ──
FAILED = []


def between(x, lo, hi, what):
    if not lo <= x <= hi:
        FAILED.append(f'{what}: {x} not in [{lo}, {hi}]')


def check(ok, what):
    if not ok:
        FAILED.append(what)


def span(aid, key, t0, t1):
    return series[aid][key][i_of(t0):i_of(t1) + 1]


ref3 = sid('A3', 'REFINEMENT')
between(max(span(ref3, 'throughput_per_min', '08:20', '08:45')), 118.0, 121.5, 'SIT03 "~121"')
between(min(span(ref3, 'throughput_per_min', '08:45', '09:35')), 110.5, 111.5, 'SIT03 "~111"')
between(max(span(ref3, 'control_effort_pct', '09:10', '09:30')) - v(ref3, 'control_effort_pct', '08:40'), 8, 14,
        'SIT03 control effort rise')
buf4 = sid('A4', 'BUFFER')
between(v(buf4, 'buffer_level', '09:00'), 41.5, 43.49, 'SIT04 "~42%"')
between(max(span(buf4, 'buffer_level', '09:15', '10:20')), 70.0, 72.0, 'SIT04 "~71%"')
between(v(pc2, 'vibration_mms', '08:50'), 2.45, 2.55, 'SIT05 "~2.5 mm/s"')
between(v(pc2, 'vibration_mms', '13:55'), 4.35, 4.45, 'SIT05 "~4.4 mm/s"')
between(max(span(pc2, 'throughput_per_min', '08:50', '13:05')) - min(span(pc2, 'throughput_per_min', '08:50', '13:05')),
        0, 8, 'SIT05 comparable load')
sw6 = span(st5, 'process_pressure_psi', '09:40', '10:00')
between(min(sw6), 77.0, 81.5, 'SIT06 "roughly 80"')
between(max(sw6), 94.5, 95.5, 'SIT06 "95 psi"')
between(max(span(st5, 'local_gauge_pressure_psi', '09:40', '10:00')) - min(span(st5, 'local_gauge_pressure_psi', '09:40', '10:00')),
        0, 3.0, 'SIT06 gauge steady')
between(v(ins1, 'reject_rate_pct', '09:50'), 1.8, 1.99, 'SIT07 "~1.9%"')
between(max(span(ins1, 'reject_rate_pct', '10:15', '10:45')), 6.55, 6.649, 'SIT07 "6.6%"')
check(min(span(ref1, 'purity_pct', '09:55', '10:15')) < SP[(ref1, 'purity_pct')] - 0.25, 'SIT07 purity moves first')
pc5 = sid('F5', 'POWER_CHARGE')
g5 = span(pc5, 'throughput_per_min', '10:00', '11:35')
between(min(g5), 120.0, 126.0, 'SIT08 "120-126"'); between(max(g5), 120.0, 126.0, 'SIT08 "120-126"')
between(1 - v(pc5, 'throughput_per_min', '11:45') / v(pc5, 'throughput_per_min', '11:00'), 0.03, 0.05, 'SIT08 "~4%"')
check(v(pc3, 'throughput_per_min', '11:40') > 120 and v(pc3, 'throughput_per_min', '11:45') < 30, 'SIT09 11:42 onset')
c1 = span(pc1, 'charge_rate', '12:35', '13:10')
between(min(c1), 43.5, 44.49, 'SIT10 "44%"'); between(max(c1), 56.5, 57.49, 'SIT10 "57%"')
check(all(x == 0 for x in span(tr6, 'transfer_rate_per_min', '13:20', '13:35')), 'SIT11 zero 13:20–13:35')
check(v(tr6, 'transfer_rate_per_min', '13:15') > 115 and v(tr6, 'transfer_rate_per_min', '13:40') > 0, 'SIT11')
check(v(tr6, 'motor_current_a', '13:20') > 140, 'SIT11 current spike')
before12 = span(pc2, 'throughput_per_min', '12:10', '13:05')
lost = [1 - x / (sum(before12) / len(before12)) for x in span(pc2, 'throughput_per_min', '13:10', '14:05')]
between(100 * sum(lost) / len(lost), 3.2, 5.2, 'SIT12 "4.2% production loss"')
between(v(ref6, 'purity_pct', '12:00'), 99.25, 99.349, 'SIT13 "~99.3%"')
between(min(span(ref6, 'purity_pct', '12:00', '13:10')), 98.6, 98.749, 'SIT13 "~98.7%"')
check(v(ref6, 'input_characteristic_index', '11:55') > SP[(ref6, 'input_characteristic_index')] + 2, 'SIT13 input first')
for iid, (aid, key, since_t, fmt, points) in EVIDENCE.items():   # unchanged since/sinceMinutes
    check(NOW_MIN - minutes(since_t) == EXPECT_SINCE[iid], iid + ' since')

assert not FAILED, 'scenario checks failed:\n  ' + '\n  '.join(FAILED)

# ── Write ──────────────────────────────────────────────────────────────────
properties = {
    'properties': {k: {'label': p[0], 'unit': p[1], 'category': p[2], 'tier': p[3], 'range': p[4], 'decimals': p[5]}
                   for k, p in PROPS.items()},
    'derivations': [{'assetType': 'refinery', 'property': prop, 'fn': fn, 'of': of, 'fromType': 'line',
                     'scope': 'children'} for prop, fn, of in ROLLUP] + DERIVATION_FORMULAS,
    'typeLabels': {},
}
telemetry = {'timeline': {'date': DATE, 'start': TS[0], 'end': TS[-1], 'stepMinutes': STEP},
             'timestamps': TS, 'series': {a['id']: series[a['id']] for a in assets}}
os.makedirs(OUT, exist_ok=True)
files = {
    'assets.json': assets,
    'asset-relationships.json': rels,
    'properties.json': properties,
    'asset-values.json': values,
    'asset-telemetry.json': telemetry,
    'unit-status.json': unit_status,
    'attention-items.json': attention,
    'work-items.json': work_items,
}
for name, data in files.items():
    compact = name in ('asset-telemetry.json', 'asset-values.json')
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=None if compact else 1, separators=(',', ':') if compact else None)
        f.write('\n')

# Sanity: same keys per type, and the baseline rarely needs the gauge clamp.
for a in assets:
    assert list(values[a['id']]) == TYPE_PROPS[a['assetType']], a['id']
n_clamped = sum(clamped.values())
print(f'Wrote {len(files)} files to {OUT}: {len(assets)} assets, {len(LINES)} lines, {len(rels)} edges, '
      f'{len(attention)} attention items, {len(work_items)} work items; {n_clamped} samples clamped to a gauge range')
