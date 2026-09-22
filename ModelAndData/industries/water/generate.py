#!/usr/bin/env python3
"""Meridian drinking-water treatment plant — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/water/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs (it reads no JSON), so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/water/generate.py [OUTDIR]

This pack predates the spec. It was hand-built, converted once to the generic
format (spec §12), and this generator was written afterwards to REPRODUCE it:
the hierarchy, relationships, property keys and metadata, attention-item and
work-item text are the converted pack's, unchanged; the telemetry is new.

The plant: one conventional surface-water plant (Meridian), six identical
treatment trains T01–T06, each intake → coagulation → flocculation →
sedimentation → filtration → disinfection, with 2–3 pieces of equipment per
stage. Four levels: plant → train → stage → equipment. Units are the trains.

Physics, deliberately simple (75% realism / 25% demo clarity, spec §2):
- Every value is a per-(asset, key) setpoint plus slowly drifting AR(1)
  noise (spec §5.1). Setpoints come from BASE (centre, spread across trains)
  through their own fixed RNG, so changing SEED only changes the noise.
- One flow factor per train drives throughput, pump flows, weir rate and
  residence times.
- Raw turbidity → (lagged) settled turbidity → filter effluent turbidity.
  Coagulant under-dosing against the jar-test target raises settled
  turbidity and lowers floc formation; raw turbidity raises chlorine demand.
- Filter headloss grows linearly with run time and resets at a backwash;
  backwash frequency = 168 / projected run time; UFRV ∝ run time.
- CT (actual) = chlorine residual × contact time × a per-train constant.
- Train KPIs: line_oee = availability × (throughput / target) × quality;
  plant KPIs are sums / means / max of the trains at every point
  (properties.json derivations).

Everything the scenarios need (which train, when, how big) lives in the
scenario constants below; SCENARIOS.md describes the same numbers in prose.
Evidence values in attention-items.json are READ BACK from the generated
series. Numbers quoted in an item's text are pinned into the series at the
quoted times (a small tapered correction, see pin()), so the text stays true.
"""
import json
import math
import os
import random
import sys

SEED = 20260828
rng = random.Random(SEED)          # noise only
SETPOINT_RNG_SEED = 2826           # per-train setpoints: fixed, independent of SEED
sp_rng = random.Random(SETPOINT_RNG_SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'water')
SEP = ' · '
UNIT_LEVEL = 'train'

# ── Timeline (spec §4.2) — the default shared demo day. "Now" = 14:05. ──
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}
HOURS = [i * STEP / 60 for i in range(N)]


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


# ── Scenario constants (SCENARIOS.md tells each story) ───────────────────
# Anchor dicts are absolute values at times; the generator adds (anchor −
# setpoint) to the baseline, so the first and last anchors equal the setpoint.
# WSIT01 — T02 coagulant metering pump diaphragm wear → dose drifts low (05)
DOSE_TRAIN = 2
DOSE_SP = 18.1                                     # mg/L, jar-test target on T02
DOSE_ANCHORS = {'09:40': 18.1, '10:05': 17.95, '10:30': 17.4, '10:55': 16.5,
                '11:15': 15.4, '11:30': 15.4, '11:45': 17.8, '12:00': 18.0, '12:15': 18.1}
DOSE_PINS = {'09:40': 18.1, '11:15': 15.4, '11:20': 15.5,      # quoted: 18.1 → 15.4 by 11:30;
             '11:25': 15.45, '11:30': 15.4}                 # held near the bottom until inspection
PUMP_WEAR_START, PUMP_RECAL = '09:30', '11:40'     # wear signs lead the dose drift; recalibrated 11:38
PUMP_DP_LOSS_PSI = 1.8                             # discharge pressure lost to slip at worst
PUMP_STABILITY_LOSS = 2.4                          # stroke-to-stroke stability points lost
PUMP_VIB_RISE_MMS = 0.35

# WSIT02 — T04 sludge blanket accumulates, desludge interval stretched (04)
BLANKET_TRAIN = 4
BLANKET_SP = 33.2                                  # % of basin depth
BLANKET_ANCHORS = {'10:20': 33.2, '10:45': 38.6, '11:10': 44.1, '11:35': 49.8, '12:00': 55.2,
                   '12:10': 58.0, '12:25': 44.3, '12:40': 35.1, '13:00': 33.2}
BLANKET_PINS = {'10:20': 33.2, '12:10': 58.0}      # quoted: 33% → 58%
T04_RAW_STEP = ('09:20', '10:00', 3.0)             # raw turbidity rises +3 NTU and stays (the cause)
DESLUDGE_STRETCH = ('10:00', '12:05', 8.5)         # collector cycle time +8.5 min (timer not adjusted)
MANUAL_DESLUDGE = ('12:10', '12:25')               # extra cycle: collector speed/current up
DESLUDGE_TIGHTENED_MIN = -2.5                      # timer shortened after the 12:12 review

# WSIT03 — T01 filter media fouling: headloss climbing, run time shortening (03)
FOUL_TRAIN = 1
FOUL_HEADLOSS = {'08:00': 2.45, '08:30': 2.6, '09:40': 2.9, '10:30': 3.2, '11:20': 3.5,
                 '12:15': 3.8, '13:05': 4.0, '13:35': 4.2, '14:05': 4.4}
FOUL_PINS = {'08:30': 2.6, '14:05': 4.4}           # quoted: 2.6 → 4.4 ft since 08:30
FOUL_RUN_TIME = {'08:00': 48.0, '14:05': 30.5}     # quoted: typical 48 h toward roughly 30

# WSIT04 — T05 settled-water turbidimeter fouled: erratic reading, process steady (06)
SENSOR_TRAIN = 5
SETTLED_SP_T05 = 2.0
SENSOR_READINGS = {'09:40': 2.5, '09:45': 1.8, '09:50': 3.4, '09:55': 2.4, '10:00': 3.9,
                   '10:05': 4.6, '10:10': 2.3, '10:15': 3.6, '10:20': 2.1, '10:25': 3.0, '10:30': 2.6}
SENSOR_PINS = {'09:45': 1.8, '10:05': 4.6}         # quoted: swung between 1.8 and 4.6 NTU
SENSOR_JITTER_NTU = 0.06                           # extra noise on the faulty readings
# (sensor cleaned 10:32; readings are the true value again from 10:35)

# WSIT05 — T03 storm: raw turbidity shock, dose raised by hand (09)
STORM_TRAIN = 3
STORM_RAW_SP = 9.2
STORM_ANCHORS = {'10:30': 9.2, '10:55': 14.8, '11:20': 31.5, '11:45': 52.3, '12:00': 68.1,
                 '12:15': 54.2, '12:30': 28.6, '12:40': 11.4, '13:10': 9.2}
STORM_PINS = {'10:30': 9.2, '12:00': 68.1}         # quoted: 9 → 68 NTU
STORM_DOSE_FACTOR = {'11:45': 1.0, '11:50': 1.28, '12:40': 1.28, '12:45': 1.12, '13:10': 1.12, '13:15': 1.0}

# WSIT06 — T06 filter backwashing far more often than its cycle (12)
BACKWASH_TRAIN = 6
BACKWASHES_T06 = ['11:05', '11:50', '12:40', '13:20', '14:00']
BACKWASH_RESET_FT = 2.0                            # headloss right after a backwash
FAST_SLOPE_FT_H = 2.3                              # headloss growth between the extra backwashes
FREQ_STEP_PER_EXTRA = 0.65                         # /week added to the rolling estimate per backwash
FREQ_LAG = 0.35
ROUTINE_BACKWASHES = {5: ['12:30']}                # a normal end-of-run backwash elsewhere (look-alike)

# WSIT07 — T02 chlorine contact basin baffle maintenance: CT margin narrows (14)
CT_TRAIN = 2
CONTACT_SP_T02 = 35.0
CONTACT_ANCHORS = {'13:00': 35.0, '14:05': 29.0}   # quoted: 35 → 29 min
CT_NOW_T02 = 128.0                                 # quoted: CT 128 now …
CT_REQUIRED_T02 = 120.0                            # … against 120 required
MAINT_START = '13:00'

# ── Plant constants ──────────────────────────────────────────────────────
PLANT_ID, PLANT_NAME = 'MERIDIAN', 'Meridian'
TRAINS = [1, 2, 3, 4, 5, 6]
TARGET_RATE = 4.2                  # per train (MGD); plant target = 25.2
CLEAN_BED_FT = 1.7                 # headloss after a routine backwash
PSI_PER_FT = 0.433
PRODUCT = 'Potable Supply'

# Hierarchy: every train has the same stages and equipment (spec §3.1).
# Equipment ids are the stage id + the name without spaces, upper-cased.
STAGES = [
    ('INTAKE', 'Intake', 'intake', [('Intake Screen', 'intake_screen'), ('Raw Water Pump', 'raw_water_pump')]),
    ('COAGULATION', 'Coagulation', 'coagulation', [('Coagulant Storage Tank', 'coagulant_storage_tank'),
                                                   ('Coagulant Metering Pump', 'coagulant_metering_pump'),
                                                   ('Rapid Mix Basin', 'rapid_mix_basin')]),
    ('FLOCCULATION', 'Flocculation', 'flocculation', [('Flocculation Basin', 'flocculation_basin'),
                                                      ('Paddle Mixer', 'paddle_mixer')]),
    ('SEDIMENTATION', 'Sedimentation', 'sedimentation', [('Sedimentation Basin', 'sedimentation_basin'),
                                                         ('Sludge Collector', 'sludge_collector')]),
    ('FILTRATION', 'Filtration', 'filtration', [('Filter Bed', 'filter_bed'), ('Backwash Pump', 'backwash_pump')]),
    ('DISINFECTION', 'Disinfection', 'disinfection', [('Chlorine Contact Basin', 'chlorine_contact_basin'),
                                                      ('Chlorine Feed Pump', 'chlorine_feed_pump'),
                                                      ('Chlorine Storage Tank', 'chlorine_storage_tank')]),
]
# Edges within each train: (source 'STAGE/Equipment', target, layer, label)
PROCESS_CHAIN = ['INTAKE/Intake Screen', 'INTAKE/Raw Water Pump', 'COAGULATION/Rapid Mix Basin',
                 'FLOCCULATION/Flocculation Basin', 'SEDIMENTATION/Sedimentation Basin',
                 'FILTRATION/Filter Bed', 'DISINFECTION/Chlorine Contact Basin']
SIDE_EDGES = [
    ('COAGULATION/Coagulant Storage Tank', 'COAGULATION/Coagulant Metering Pump', 'chemical_dosing', None),
    ('COAGULATION/Coagulant Metering Pump', 'COAGULATION/Rapid Mix Basin', 'chemical_dosing', None),
    ('DISINFECTION/Chlorine Storage Tank', 'DISINFECTION/Chlorine Feed Pump', 'chemical_dosing', None),
    ('DISINFECTION/Chlorine Feed Pump', 'DISINFECTION/Chlorine Contact Basin', 'chemical_dosing', None),
    ('FILTRATION/Backwash Pump', 'FILTRATION/Filter Bed', 'backwash', 'periodic cleaning cycle, reverse flow'),
]

# ── Property metadata (spec §3.4): label, unit, category, tier, range, decimals
PROPS = {
    'algae_risk_index': ('Algae Risk', '', 'Derived Metric', 'P3', [0, 25], 1),
    'backwash_cycles_per_day': ('Backwash Cycles', '/day', 'Events / Losses', 'P3', [0, 3], 2),
    'backwash_frequency_per_week': ('Backwash Frequency', '/week', 'Events / Losses', 'P2', [1.5, 7], 2),
    'basin_short_circuiting_index': ('Short-Circuiting Risk', '', 'Derived Metric', 'P3', [0, 25], 1),
    'bearing_temp_c': ('Bearing Temp', '°C', 'Condition', 'P2', [30, 90], 1),
    'chlorine_demand_mg_l': ('Chlorine Demand', 'mg/L', 'Events / Losses', 'P2', [0.3, 1.5], 2),
    'chlorine_residual_mg_l': ('Chlorine Residual', 'mg/L', 'Quality', 'P1', [0.5, 1.8], 2),
    'cleaning_cycles_per_hr': ('Cleaning Cycles', '/hr', 'Events / Losses', 'P3', [0, 8], 2),
    'coagulant_dose_mg_l': ('Coagulant Dose', 'mg/L', 'Flow / WIP', 'P1', [10, 26], 1),
    'coagulant_pump_stability': ('Pump Stability', '', 'Stability', 'P3', [92, 100], 1),
    'consumption_rate': ('Consumption Rate', '', 'Flow / WIP', 'P2', [0, 4], 2),
    'contact_time_min': ('Contact Time', 'min', 'Flow / WIP', 'P2', [22, 40], 1),
    'ct_value_actual': ('CT Value (Actual)', '', 'Derived Metric', 'P1', [100, 170], 1),
    'ct_value_required': ('CT Value (Required)', '', 'Derived Metric', 'P1', [110, 130], 1),
    'cycle_time_min': ('Cycle Time', 'min', 'Flow / WIP', 'P3', [5, 30], 1),
    'dbp_formation_risk': ('DBP Formation Risk', '', 'Derived Metric', 'P2', [0, 30], 1),
    'differential_pressure_psi': ('Differential Pressure', 'psi', 'Condition', 'P1', [0, 5], 2),
    'discharge_pressure_psi': ('Discharge Pressure', 'psi', 'Condition', 'P2', [0, 50], 1),
    'dosing_flow_rate_gpm': ('Flow Rate', 'gpm', 'Flow / WIP', 'P2', [0, 8], 2),
    'filter_effluent_turbidity_ntu': ('Filter Effluent Turbidity', 'NTU', 'Quality', 'P1', [0, 0.3], 2),
    'filter_run_time_hrs': ('Filter Run Time', 'h', 'Flow / WIP', 'P2', [20, 60], 1),
    'floc_carryover_risk': ('Floc Carryover Risk', '', 'Derived Metric', 'P3', [0, 20], 1),
    'floc_formation_index': ('Floc Formation', '', 'Quality', 'P2', [70, 100], 1),
    'floc_size_index': ('Floc Size', '', 'Quality', 'P1', [60, 95], 1),
    'flow_efficiency': ('Flow Efficiency', '', 'Flow / WIP', 'P3', [95, 102], 1),
    'flow_rate_gpm': ('Flow Rate', 'gpm', 'Flow / WIP', 'P2', [100, 532.8], 1),
    'headloss_ft': ('Headloss', 'ft', 'Condition', 'P2', [0, 7], 2),
    'instability_index': ('Instability', '', 'Stability', 'P1', [0, 15], 2),
    'intake_flow_variability': ('Intake Flow Variability', '', 'Stability', 'P2', [0, 8], 2),
    'jar_test_deviation_pct': ('Jar Test Deviation', '%', 'Quality', 'P3', [0, 10], 2),
    'level_pct': ('Level', '%', 'Flow / WIP', 'P1', [40, 100], 1),
    'line_availability': ('Availability', '%', 'Derived Metric', 'P2', [96, 100], 1),
    'line_oee': ('OEE', '%', 'Derived Metric', 'P1', [93, 100], 1),
    'line_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'line_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [3, 7], 2),
    'line_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [3, 7], 2),
    'mixing_energy_gradient_per_s': ('Mixing Energy', '1/s', 'Condition', 'P2', [30, 60], 1),
    'motor_current_a': ('Motor Current', 'A', 'Condition', 'P1', [0, 20], 1),
    'paddle_speed_rpm': ('Paddle Speed', 'rpm', 'Condition', 'P2', [3, 5.5], 2),
    'plant_availability': ('Availability', '%', 'Derived Metric', 'P2', [95, 100], 1),
    'plant_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [88, 100], 1),
    'plant_instability_index': ('Instability', '', 'Stability', 'P1', [0, 20], 2),
    'plant_oee': ('OEE', '%', 'Derived Metric', 'P1', [90, 100], 1),
    'plant_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [95, 100], 1),
    'plant_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [15, 45], 1),
    'plant_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [15, 45], 1),
    'process_motor_current_a': ('Motor Current', 'A', 'Condition', 'P2', [10, 45], 1),
    'rake_motor_torque_pct': ('Rake Torque', '%', 'Condition', 'P2', [0, 100], 1),
    'rapid_mix_gradient_per_s': ('Rapid Mix Gradient', '1/s', 'Condition', 'P2', [600, 800], 1),
    'rapid_mix_speed_rpm': ('Mix Speed', 'rpm', 'Condition', 'P2', [40, 160], 1),
    'raw_water_ph': ('Raw Water pH', 'pH', 'Quality', 'P2', [6.8, 8.0], 2),
    'raw_water_turbidity_ntu': ('Raw Water Turbidity', 'NTU', 'Quality', 'P1', [0, 80], 1),
    'residence_time_min': ('Residence Time', 'min', 'Flow / WIP', 'P2', [4.2, 161.6], 1),
    'screen_differential_pressure_psi': ('Screen Diff. Pressure', 'psi', 'Condition', 'P2', [0, 6], 2),
    'settled_water_turbidity_ntu': ('Settled Water Turbidity', 'NTU', 'Quality', 'P2', [0, 6], 2),
    'sludge_blanket_level_pct': ('Sludge Blanket Level', '%', 'Flow / WIP', 'P1', [10, 65], 1),
    'system_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [92, 100], 1),
    'temperature_c': ('Temperature', '°C', 'Condition', 'P3', [5, 35], 1),
    'torque_pct': ('Torque', '%', 'Condition', 'P2', [0, 100], 1),
    'total_wip': ('Total WIP', '', 'Flow / WIP', 'P3', [15, 45], 1),
    'travel_speed_pct': ('Travel Speed', '%', 'Condition', 'P3', [0, 100], 1),
    # range lowered from 7000: UFRV is proportional to run length, and the
    # shortened runs on T01 and T06 take it below 7000 (see RESEARCH.md §4).
    'unit_filter_run_volume_gal_sf': ('Unit Filter Run Volume', '', 'Flow / WIP', 'P3', [4000, 11500], 1),
    'vibration_mms': ('Vibration', 'mm/s', 'Stability', 'P1', [0, 6], 2),
    'weir_overflow_rate_gpd_ft': ('Weir Overflow Rate', 'ft', 'Flow / WIP', 'P3', [12000, 24000], 1),
}

# Keys per asset type, in display order (spec §3.1: same keys on every instance).
TYPE_PROPS = {
    'plant': ['plant_throughput', 'plant_target_rate', 'plant_oee', 'plant_availability',
              'plant_quality_factor', 'plant_health_index', 'plant_instability_index'],
    'train': ['line_oee', 'line_availability', 'line_quality_factor', 'total_wip', 'instability_index',
              'system_health_index', 'flow_efficiency', 'line_target_rate', 'line_throughput'],
    'intake': ['raw_water_turbidity_ntu', 'raw_water_ph', 'screen_differential_pressure_psi',
               'intake_flow_variability', 'algae_risk_index'],
    'intake_screen': ['differential_pressure_psi', 'rake_motor_torque_pct', 'cleaning_cycles_per_hr'],
    'raw_water_pump': ['vibration_mms', 'bearing_temp_c', 'process_motor_current_a', 'discharge_pressure_psi',
                       'flow_rate_gpm'],
    'coagulation': ['coagulant_dose_mg_l', 'rapid_mix_gradient_per_s', 'jar_test_deviation_pct',
                    'coagulant_pump_stability', 'floc_formation_index'],
    'coagulant_storage_tank': ['level_pct', 'consumption_rate', 'temperature_c'],
    'coagulant_metering_pump': ['vibration_mms', 'bearing_temp_c', 'motor_current_a', 'discharge_pressure_psi',
                                'dosing_flow_rate_gpm'],
    'rapid_mix_basin': ['rapid_mix_speed_rpm', 'motor_current_a', 'torque_pct'],
    'flocculation': ['floc_size_index', 'paddle_speed_rpm', 'mixing_energy_gradient_per_s', 'floc_carryover_risk'],
    'flocculation_basin': ['level_pct', 'residence_time_min'],
    'paddle_mixer': ['paddle_speed_rpm', 'motor_current_a', 'torque_pct'],
    'sedimentation': ['settled_water_turbidity_ntu', 'sludge_blanket_level_pct', 'weir_overflow_rate_gpd_ft',
                      'basin_short_circuiting_index'],
    'sedimentation_basin': ['level_pct', 'residence_time_min'],
    'sludge_collector': ['motor_current_a', 'travel_speed_pct', 'cycle_time_min'],
    'filtration': ['filter_effluent_turbidity_ntu', 'headloss_ft', 'filter_run_time_hrs',
                   'unit_filter_run_volume_gal_sf', 'backwash_frequency_per_week'],
    'filter_bed': ['differential_pressure_psi', 'backwash_cycles_per_day'],
    'backwash_pump': ['vibration_mms', 'bearing_temp_c', 'process_motor_current_a', 'discharge_pressure_psi',
                      'flow_rate_gpm'],
    'disinfection': ['chlorine_residual_mg_l', 'ct_value_actual', 'ct_value_required', 'contact_time_min',
                     'chlorine_demand_mg_l', 'dbp_formation_risk'],
    'chlorine_contact_basin': ['level_pct', 'residence_time_min'],
    'chlorine_feed_pump': ['vibration_mms', 'bearing_temp_c', 'motor_current_a', 'discharge_pressure_psi',
                           'dosing_flow_rate_gpm'],
    'chlorine_storage_tank': ['level_pct', 'consumption_rate', 'temperature_c'],
}

# ── Baseline parameters per (type, key): centre, spread, noise CV, AR phi ──
# centre: typical setpoint; spread: CV of the setpoint across the six trains
# (equipment of different duty/size differs more than controlled process
# values); noise: CV of the AR(1) drift around the setpoint; phi: lag-1
# autocorrelation. Chosen from the converted pack's statistics, with the
# setpoint spread capped at 20% (spec §5.1: siblings differ, but a little).
BASE = {
    ('train', 'line_availability'): (99.09, 0.001, 0.0003, 0.87),
    ('train', 'line_quality_factor'): (99.21, 0.001, 0.0004, 0.88),
    ('train', 'total_wip'): (34.5, 0.10, 0.02, 0.92),
    ('train', 'instability_index'): (4.2, 0.25, 0.05, 0.88),
    ('train', 'system_health_index'): (96.65, 0.003, 0.0012, 0.88),
    ('train', 'flow_efficiency'): (99.11, 0.001, 0.0002, 0.86),
    ('train', 'performance'): (0.985, 0.004, 0.006, 0.90),     # throughput / target (drives the flow factor)
    ('intake', 'raw_water_turbidity_ntu'): (9.0, 0.12, 0.06, 0.88),
    ('intake', 'raw_water_ph'): (7.41, 0.01, 0.007, 0.85),
    ('intake', 'screen_differential_pressure_psi'): (2.56, 0.04, 0.06, 0.88),
    ('intake', 'intake_flow_variability'): (3.1, 0.05, 0.08, 0.90),
    ('intake', 'algae_risk_index'): (8.5, 0.20, 0.15, 0.90),
    ('intake_screen', 'differential_pressure_psi'): (1.32, 0.18, 0.06, 0.85),
    ('intake_screen', 'rake_motor_torque_pct'): (41.0, 0.18, 0.06, 0.88),
    ('intake_screen', 'cleaning_cycles_per_hr'): (2.8, 0.18, 0.08, 0.85),
    ('raw_water_pump', 'vibration_mms'): (1.8, 0.20, 0.07, 0.88),
    ('raw_water_pump', 'bearing_temp_c'): (59.4, 0.05, 0.018, 0.90),
    ('raw_water_pump', 'process_motor_current_a'): (24.1, 0.14, 0.03, 0.88),
    ('raw_water_pump', 'discharge_pressure_psi'): (35.2, 0.12, 0.03, 0.86),
    ('raw_water_pump', 'flow_rate_gpm'): (305.0, 0.16, 0.025, 0.85),
    ('coagulation', 'coagulant_dose_mg_l'): (17.3, 0.04, 0.015, 0.88),
    ('coagulation', 'rapid_mix_gradient_per_s'): (707.0, 0.02, 0.02, 0.88),
    ('coagulation', 'jar_test_deviation_pct'): (3.2, 0.10, 0.12, 0.88),
    ('coagulation', 'coagulant_pump_stability'): (97.5, 0.004, 0.004, 0.87),
    ('coagulation', 'floc_formation_index'): (86.0, 0.025, 0.015, 0.89),
    ('coagulant_storage_tank', 'level_pct'): (72.0, 0.12, 0.004, 0.85),
    ('coagulant_storage_tank', 'consumption_rate'): (1.44, 0.18, 0.05, 0.87),
    ('coagulant_storage_tank', 'temperature_c'): (20.0, 0.15, 0.03, 0.89),
    ('coagulant_metering_pump', 'vibration_mms'): (2.09, 0.06, 0.07, 0.88),
    ('coagulant_metering_pump', 'bearing_temp_c'): (55.2, 0.08, 0.02, 0.87),
    ('coagulant_metering_pump', 'motor_current_a'): (3.14, 0.18, 0.05, 0.88),
    ('coagulant_metering_pump', 'discharge_pressure_psi'): (14.7, 0.10, 0.018, 0.88),
    ('coagulant_metering_pump', 'dosing_flow_rate_gpm'): (2.4, 0.12, 0.02, 0.87),
    ('rapid_mix_basin', 'rapid_mix_speed_rpm'): (103.0, 0.12, 0.03, 0.90),
    ('rapid_mix_basin', 'motor_current_a'): (7.9, 0.20, 0.05, 0.90),
    ('rapid_mix_basin', 'torque_pct'): (35.7, 0.18, 0.05, 0.86),
    ('flocculation', 'floc_size_index'): (79.5, 0.015, 0.015, 0.88),
    ('flocculation', 'paddle_speed_rpm'): (3.99, 0.045, 0.025, 0.88),
    ('flocculation', 'mixing_energy_gradient_per_s'): (44.5, 0.06, 0.03, 0.86),
    ('flocculation', 'floc_carryover_risk'): (8.1, 0.15, 0.10, 0.89),
    ('flocculation_basin', 'level_pct'): (90.0, 0.04, 0.02, 0.90),
    ('flocculation_basin', 'residence_time_min'): (29.0, 0.20, 0.02, 0.80),
    ('paddle_mixer', 'paddle_speed_rpm'): (4.32, 0.045, 0.015, 0.88),
    ('paddle_mixer', 'motor_current_a'): (4.5, 0.20, 0.05, 0.88),
    ('paddle_mixer', 'torque_pct'): (32.9, 0.15, 0.05, 0.88),
    ('sedimentation', 'settled_water_turbidity_ntu'): (2.1, 0.06, 0.04, 0.90),
    ('sedimentation', 'sludge_blanket_level_pct'): (35.5, 0.03, 0.03, 0.92),
    ('sedimentation', 'weir_overflow_rate_gpd_ft'): (17640.0, 0.05, 0.015, 0.89),
    ('sedimentation', 'basin_short_circuiting_index'): (10.3, 0.18, 0.12, 0.88),
    ('sedimentation_basin', 'level_pct'): (87.5, 0.04, 0.02, 0.89),
    ('sedimentation_basin', 'residence_time_min'): (123.0, 0.10, 0.02, 0.87),
    ('sludge_collector', 'motor_current_a'): (5.05, 0.20, 0.05, 0.90),
    ('sludge_collector', 'travel_speed_pct'): (47.0, 0.20, 0.04, 0.89),
    ('sludge_collector', 'cycle_time_min'): (18.3, 0.06, 0.04, 0.92),
    ('filtration', 'filter_effluent_turbidity_ntu'): (0.079, 0.10, 0.08, 0.87),
    ('filtration', 'headloss_ft'): (3.3, 0.10, 0.012, 0.80),   # headloss at 08:00; noise sd = 0.012 × 3.3 ft
    ('filtration', 'headloss_slope_ft_h'): (0.09, 0.15, 0.0, 0.0),
    ('filtration', 'filter_run_time_hrs'): (47.0, 0.05, 0.015, 0.90),
    ('filtration', 'unit_filter_run_volume_gal_sf'): (9330.0, 0.025, 0.01, 0.89),
    ('filter_bed', 'differential_pressure_psi'): (2.64, 0.15, 0.03, 0.85),   # at 3.3 ft headloss
    ('filter_bed', 'backwash_cycles_per_day'): (1.0, 0.25, 0.03, 0.85),
    ('backwash_pump', 'vibration_mms'): (2.15, 0.18, 0.07, 0.87),
    ('backwash_pump', 'bearing_temp_c'): (58.9, 0.07, 0.018, 0.88),
    ('backwash_pump', 'process_motor_current_a'): (29.2, 0.12, 0.035, 0.89),
    ('backwash_pump', 'discharge_pressure_psi'): (33.8, 0.12, 0.03, 0.86),
    ('backwash_pump', 'flow_rate_gpm'): (300.0, 0.15, 0.03, 0.88),
    ('disinfection', 'chlorine_residual_mg_l'): (1.2, 0.035, 0.01, 0.88),
    ('disinfection', 'ct_value_actual'): (146.7, 0.013, 0.0, 0.0),           # sets the per-train CT constant
    ('disinfection', 'ct_value_required'): (120.6, 0.006, 0.005, 0.84),
    ('disinfection', 'contact_time_min'): (34.2, 0.025, 0.01, 0.85),
    ('disinfection', 'chlorine_demand_mg_l'): (0.88, 0.07, 0.05, 0.85),
    ('disinfection', 'dbp_formation_risk'): (13.4, 0.18, 0.10, 0.87),
    ('chlorine_contact_basin', 'level_pct'): (89.8, 0.025, 0.02, 0.91),
    ('chlorine_contact_basin', 'residence_time_min'): (42.4, 0.20, 0.015, 0.84),
    ('chlorine_feed_pump', 'vibration_mms'): (2.3, 0.18, 0.07, 0.89),
    ('chlorine_feed_pump', 'bearing_temp_c'): (56.7, 0.06, 0.017, 0.82),
    ('chlorine_feed_pump', 'motor_current_a'): (4.7, 0.20, 0.05, 0.88),
    ('chlorine_feed_pump', 'discharge_pressure_psi'): (16.9, 0.14, 0.03, 0.89),
    ('chlorine_feed_pump', 'dosing_flow_rate_gpm'): (2.88, 0.16, 0.02, 0.89),
    ('chlorine_storage_tank', 'level_pct'): (72.0, 0.15, 0.004, 0.85),
    ('chlorine_storage_tank', 'consumption_rate'): (1.6, 0.20, 0.05, 0.88),
    ('chlorine_storage_tank', 'temperature_c'): (18.2, 0.15, 0.035, 0.88),
}
# Scenario trains whose baseline the story fixes (the text quotes them).
SP_OVERRIDE = {
    (DOSE_TRAIN, 'coagulation', 'coagulant_dose_mg_l'): DOSE_SP,
    (BLANKET_TRAIN, 'sedimentation', 'sludge_blanket_level_pct'): BLANKET_SP,
    (FOUL_TRAIN, 'filtration', 'filter_run_time_hrs'): FOUL_RUN_TIME['08:00'],
    (SENSOR_TRAIN, 'sedimentation', 'settled_water_turbidity_ntu'): SETTLED_SP_T05,
    (STORM_TRAIN, 'intake', 'raw_water_turbidity_ntu'): STORM_RAW_SP,
    (5, 'filtration', 'headloss_ft'): 5.0,                   # near end of run → routine backwash at 12:30
    (BACKWASH_TRAIN, 'filter_bed', 'backwash_cycles_per_day'): 1.2,
    (CT_TRAIN, 'disinfection', 'contact_time_min'): CONTACT_SP_T02,
    (CT_TRAIN, 'disinfection', 'ct_value_required'): CT_REQUIRED_T02,
}
# How the six setpoints are spread: z-scores drawn once from the fixed setpoint RNG.
SP = {}
for (_atype, _key) in sorted(BASE):
    for _tn in TRAINS:
        _c, _spread = BASE[(_atype, _key)][:2]
        _z = max(-1.6, min(1.6, sp_rng.gauss(0, 1)))
        SP[(_tn, _atype, _key)] = _c * (1 + _spread * _z)
SP.update(SP_OVERRIDE)


# ── Helpers ─────────────────────────────────────────────────────────────
def sp(tn, atype, key):
    return SP[(tn, atype, key)]


def ar1(sd, phi=0.88):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi), zero mean."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def base(tn, atype, key, level=None):
    """Setpoint (or a given level series) + AR(1) drift with the key's noise CV."""
    s = sp(tn, atype, key)
    _, _, cv, phi = BASE[(atype, key)]
    noise = ar1(cv * abs(s), phi)
    lv = level if level is not None else [s] * N
    return [a + e for a, e in zip(lv, noise)]


def interp(points):
    """Piecewise-linear profile over the timeline from {'HH:MM': value}, held at both ends."""
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


def delta(points, setpoint):
    """Scenario footprint: the anchor profile minus the setpoint (0 outside the anchors)."""
    return [v - setpoint for v in interp(points)]


def ramp(t0, t1, amount):
    """0 up to t0, rising linearly to `amount` at t1, held after."""
    a, b = minutes(t0), minutes(t1)
    return [0.0 if minutes(t) <= a else amount * min(1.0, (minutes(t) - a) / (b - a)) for t in TS]


def step(t0, amount):
    """0 before t0, `amount` from t0 on."""
    return [amount if minutes(t) >= minutes(t0) else 0.0 for t in TS]


def window(t0, t1):
    """1 inside [t0, t1), else 0."""
    return [1.0 if minutes(t0) <= minutes(t) < minutes(t1) else 0.0 for t in TS]


def lag(xs, k):
    """First-order lag per 5-minute step (0 < k ≤ 1)."""
    y, out = xs[0], []
    for x in xs:
        y += (x - y) * k
        out.append(y)
    return out


def add(*arrays):
    return [sum(v) for v in zip(*arrays)]


def pin(s, points, taper=6):
    """Make the series pass exactly through the quoted values, with a small
    correction interpolated between the pinned points and tapered to zero
    `taper` steps outside them (the noise texture is kept)."""
    knots = sorted((IDX[t], v - s[IDX[t]]) for t, v in points.items())
    first, last = knots[0][0], knots[-1][0]
    if first > 0:
        knots.insert(0, (max(0, first - taper), 0.0))
    if last < N - 1:
        knots.append((min(N - 1, last + taper), 0.0))
    out = list(s)
    for (i0, d0), (i1, d1) in zip(knots, knots[1:]):
        for i in range(i0, i1 + 1):
            f = (i - i0) / (i1 - i0) if i1 > i0 else 0.0
            out[i] = s[i] + d0 + (d1 - d0) * f
    for t, v in points.items():
        out[IDX[t]] = v
    return out


def pulses(times, shape):
    """Sum of `shape` (values at step offsets 0, 1, 2 …) placed at each time."""
    out = [0.0] * N
    for t in times:
        for k, v in enumerate(shape):
            if IDX[t] + k < N:
                out[IDX[t] + k] += v
    return out


def clamp(xs, lo=None, hi=None):
    return [min(hi if hi is not None else x, max(lo if lo is not None else x, x)) for x in xs]


# ── Hierarchy and relationships ─────────────────────────────────────────
def tid(tn):
    return f'{PLANT_ID}_T{tn:02d}'


def eq_id(tn, stage_code, eq_name):
    return f'{tid(tn)}_{stage_code}_{eq_name.replace(" ", "").upper()}'


assets = [{'id': PLANT_ID, 'parentId': None, 'name': PLANT_NAME, 'assetType': 'plant', 'assetLevel': 'plant'}]
for tn in TRAINS:
    assets.append({'id': tid(tn), 'parentId': PLANT_ID, 'name': f'T{tn:02d}', 'assetType': 'train',
                   'assetLevel': 'train'})
    for code, name, stype, equipment in STAGES:
        stage_id = f'{tid(tn)}_{code}'
        assets.append({'id': stage_id, 'parentId': tid(tn), 'name': name, 'assetType': stype, 'assetLevel': 'stage'})
        for ename, etype in equipment:
            assets.append({'id': eq_id(tn, code, ename), 'parentId': stage_id, 'name': ename, 'assetType': etype,
                           'assetLevel': 'equipment'})
A = {a['id']: a for a in assets}


def ref(tn, path):
    code, name = path.split('/')
    return eq_id(tn, code, name)


def edge(src, dst, layer, label=None):
    return {'sourceAssetId': src, 'targetAssetId': dst, 'relationshipType': 'feeds_into', 'label': label,
            'layer': layer}


rels = []
for tn in TRAINS:
    for a, b in zip(PROCESS_CHAIN, PROCESS_CHAIN[1:]):
        rels.append(edge(ref(tn, a), ref(tn, b), 'process_flow'))
    for a, b, layer, label in SIDE_EDGES:
        rels.append(edge(ref(tn, a), ref(tn, b), layer, label))

# ── Telemetry ───────────────────────────────────────────────────────────
series = {}


def put(aid, key, values):
    d = PROPS[key][5]
    lo, hi = PROPS[key][4]
    if PROPS[key][1] == '%':
        values = clamp(values, 0.0, 100.0)
    if lo >= 0:                                     # quantities that can't be negative
        values = clamp(values, 0.0)
    series.setdefault(aid, {})[key] = [round(x + 0.0, max(3, d)) for x in values]


def backwash_times(tn):
    return BACKWASHES_T06 if tn == BACKWASH_TRAIN else ROUTINE_BACKWASHES.get(tn, [])


TRAIN_KPI = {}          # tn → dict of unrounded train-level inputs for the rollups

for tn in TRAINS:
    T = tid(tn)
    E = lambda path: ref(tn, path)                  # noqa: E731
    stage = lambda code: f'{T}_{code}'              # noqa: E731
    bw = backwash_times(tn)
    bw_extra = bw if tn == BACKWASH_TRAIN else []

    # Train flow factor: throughput / (target × performance setpoint).
    perf_sp = sp(tn, 'train', 'performance')
    F = [1 + e for e in ar1(BASE[('train', 'performance')][2], BASE[('train', 'performance')][3])]
    offline = pulses(bw, [0.015, 0.006])              # a filter out of service while it backwashes

    # ── Intake: raw water ──
    R_sp = sp(tn, 'intake', 'raw_water_turbidity_ntu')
    R = base(tn, 'intake', 'raw_water_turbidity_ntu')
    if tn == STORM_TRAIN:
        R = pin(add(R, delta(STORM_ANCHORS, R_sp)), STORM_PINS)
    if tn == BLANKET_TRAIN:
        R = add(R, ramp(*T04_RAW_STEP))
    R = clamp(R, 0.5)
    excess = [max(0.0, r / R_sp - 1) for r in R]    # relative raw-turbidity excess (storm load)
    excess_lag = lag(excess, 0.4)
    put(stage('INTAKE'), 'raw_water_turbidity_ntu', R)
    put(stage('INTAKE'), 'raw_water_ph', add(base(tn, 'intake', 'raw_water_ph'), [-0.04 * x for x in excess_lag]))
    put(stage('INTAKE'), 'screen_differential_pressure_psi',
        add(base(tn, 'intake', 'screen_differential_pressure_psi'), [0.12 * x for x in excess]))
    ifv = add(base(tn, 'intake', 'intake_flow_variability'), [0.25 * x for x in excess])
    put(stage('INTAKE'), 'intake_flow_variability', ifv)
    put(stage('INTAKE'), 'algae_risk_index', base(tn, 'intake', 'algae_risk_index'))
    scr = E('INTAKE/Intake Screen')
    put(scr, 'differential_pressure_psi', add(base(tn, 'intake_screen', 'differential_pressure_psi'),
                                              [0.09 * x for x in excess]))
    put(scr, 'rake_motor_torque_pct', add(base(tn, 'intake_screen', 'rake_motor_torque_pct'), [2.8 * x for x in excess]))
    put(scr, 'cleaning_cycles_per_hr', add(base(tn, 'intake_screen', 'cleaning_cycles_per_hr'),
                                           [0.4 * x for x in excess]))
    rwp = E('INTAKE/Raw Water Pump')
    flow = [f * v for f, v in zip(F, base(tn, 'raw_water_pump', 'flow_rate_gpm'))]
    fsp = sp(tn, 'raw_water_pump', 'flow_rate_gpm')
    put(rwp, 'flow_rate_gpm', flow)
    put(rwp, 'process_motor_current_a', [c * (q / fsp) ** 1.5 for c, q in
                                         zip(base(tn, 'raw_water_pump', 'process_motor_current_a'), flow)])
    put(rwp, 'discharge_pressure_psi', base(tn, 'raw_water_pump', 'discharge_pressure_psi'))
    put(rwp, 'vibration_mms', base(tn, 'raw_water_pump', 'vibration_mms'))
    put(rwp, 'bearing_temp_c', base(tn, 'raw_water_pump', 'bearing_temp_c'))

    # ── Coagulation: dose follows the metering pump's real output ──
    D_sp = sp(tn, 'coagulation', 'coagulant_dose_mg_l')
    pump_out = [1.0] * N                            # delivered / commanded (worn diaphragm < 1)
    manual = [1.0] * N                              # operator dose multiplier
    if tn == DOSE_TRAIN:
        pump_out = [v / D_sp for v in interp(DOSE_ANCHORS)]
    if tn == STORM_TRAIN:
        manual = interp(STORM_DOSE_FACTOR)
    dose = [D_sp * p * m + e for p, m, e in
            zip(pump_out, manual, ar1(BASE[('coagulation', 'coagulant_dose_mg_l')][2] * D_sp, 0.88))]
    if tn == DOSE_TRAIN:
        dose = pin(dose, DOSE_PINS)
    put(stage('COAGULATION'), 'coagulant_dose_mg_l', dose)
    R_lag = lag(R, 0.5)
    target = [D_sp * (r / R_sp) ** 0.08 for r in R_lag]           # jar-test optimum moves with raw turbidity
    dose_lag = lag(dose, 0.6)
    under = [max(0.0, 1 - d / t) for d, t in zip(dose_lag, target)]
    put(stage('COAGULATION'), 'jar_test_deviation_pct',
        add(base(tn, 'coagulation', 'jar_test_deviation_pct'), [25 * abs(1 - d / t) for d, t in zip(dose_lag, target)]))
    put(stage('COAGULATION'), 'rapid_mix_gradient_per_s', base(tn, 'coagulation', 'rapid_mix_gradient_per_s'))
    wear = ramp(PUMP_WEAR_START, '11:30', 1.0) if tn == DOSE_TRAIN else [0.0] * N
    if tn == DOSE_TRAIN:
        wear = [w * (1 - r) for w, r in zip(wear, ramp(PUMP_RECAL, '11:45', 1.0))]
    stability = add(base(tn, 'coagulation', 'coagulant_pump_stability'), [-PUMP_STABILITY_LOSS * w for w in wear])
    put(stage('COAGULATION'), 'coagulant_pump_stability', stability)
    ff_sp = sp(tn, 'coagulation', 'floc_formation_index')
    ff = base(tn, 'coagulation', 'floc_formation_index', [ff_sp * (1 - 0.8 * u) for u in under])
    put(stage('COAGULATION'), 'floc_formation_index', ff)
    mp = E('COAGULATION/Coagulant Metering Pump')
    q_sp = sp(tn, 'coagulant_metering_pump', 'dosing_flow_rate_gpm')
    put(mp, 'dosing_flow_rate_gpm', base(tn, 'coagulant_metering_pump', 'dosing_flow_rate_gpm',
                                         [q_sp * f * p * m for f, p, m in zip(F, pump_out, manual)]))
    put(mp, 'discharge_pressure_psi', add(base(tn, 'coagulant_metering_pump', 'discharge_pressure_psi'),
                                          [-PUMP_DP_LOSS_PSI * w for w in wear]))
    put(mp, 'vibration_mms', add(base(tn, 'coagulant_metering_pump', 'vibration_mms'), [PUMP_VIB_RISE_MMS * w for w in wear]))
    put(mp, 'motor_current_a', base(tn, 'coagulant_metering_pump', 'motor_current_a'))
    put(mp, 'bearing_temp_c', base(tn, 'coagulant_metering_pump', 'bearing_temp_c'))
    ct_ = E('COAGULATION/Coagulant Storage Tank')
    use = base(tn, 'coagulant_storage_tank', 'consumption_rate',
               [sp(tn, 'coagulant_storage_tank', 'consumption_rate') * f * p * m for f, p, m in zip(F, pump_out, manual)])
    put(ct_, 'consumption_rate', use)
    lvl0, used = sp(tn, 'coagulant_storage_tank', 'level_pct'), 0.0
    level = []
    for u in use:                                   # consumption in %/h drains the tank
        used += u * STEP / 60
        level.append(lvl0 - used)
    put(ct_, 'level_pct', add(level, ar1(0.004 * lvl0, 0.85)))
    put(ct_, 'temperature_c', base(tn, 'coagulant_storage_tank', 'temperature_c'))
    rmb = E('COAGULATION/Rapid Mix Basin')
    for key in TYPE_PROPS['rapid_mix_basin']:
        put(rmb, key, base(tn, 'rapid_mix_basin', key))

    # ── Flocculation ──
    fs_sp = sp(tn, 'flocculation', 'floc_size_index')
    fs = base(tn, 'flocculation', 'floc_size_index', [fs_sp * (x / ff_sp) ** 1.2 for x in lag(ff, 0.5)])
    put(stage('FLOCCULATION'), 'floc_size_index', fs)
    put(stage('FLOCCULATION'), 'paddle_speed_rpm', base(tn, 'flocculation', 'paddle_speed_rpm'))
    put(stage('FLOCCULATION'), 'mixing_energy_gradient_per_s', base(tn, 'flocculation', 'mixing_energy_gradient_per_s'))
    fc_sp = sp(tn, 'flocculation', 'floc_carryover_risk')
    put(stage('FLOCCULATION'), 'floc_carryover_risk',
        base(tn, 'flocculation', 'floc_carryover_risk', [fc_sp * (fs_sp / x) ** 4 for x in fs]))
    fb = E('FLOCCULATION/Flocculation Basin')
    put(fb, 'level_pct', clamp(base(tn, 'flocculation_basin', 'level_pct'), hi=99.0))
    put(fb, 'residence_time_min', [v / f for v, f in zip(base(tn, 'flocculation_basin', 'residence_time_min'), F)])
    pm = E('FLOCCULATION/Paddle Mixer')
    for key in TYPE_PROPS['paddle_mixer']:
        put(pm, key, base(tn, 'paddle_mixer', key))

    # ── Sedimentation ──
    b_sp = sp(tn, 'sedimentation', 'sludge_blanket_level_pct')
    blanket = add(base(tn, 'sedimentation', 'sludge_blanket_level_pct'), [1.5 * x for x in lag(excess, 0.15)])
    if tn == BLANKET_TRAIN:
        blanket = pin(add(blanket, delta(BLANKET_ANCHORS, b_sp)), BLANKET_PINS)
    put(stage('SEDIMENTATION'), 'sludge_blanket_level_pct', blanket)
    S_sp = sp(tn, 'sedimentation', 'settled_water_turbidity_ntu')
    ratio = [min(1.5, max(0.9, t / d)) for d, t in zip(dose_lag, target)]
    settled_model = [S_sp * (r / R_sp) ** 0.2 * q ** 2 + 0.04 * max(0.0, b - 45)
                     for r, q, b in zip(lag(R, 0.35), ratio, blanket)]
    settled = base(tn, 'sedimentation', 'settled_water_turbidity_ntu', lag(settled_model, 0.35))
    reading = list(settled)                         # what the turbidimeter reports
    if tn == SENSOR_TRAIN:
        jitter = ar1(SENSOR_JITTER_NTU, 0.3)
        for t, v in SENSOR_READINGS.items():
            reading[IDX[t]] = v + jitter[IDX[t]]
        for t, v in SENSOR_PINS.items():
            reading[IDX[t]] = v
    put(stage('SEDIMENTATION'), 'settled_water_turbidity_ntu', reading)
    put(stage('SEDIMENTATION'), 'weir_overflow_rate_gpd_ft',
        [f * v for f, v in zip(F, base(tn, 'sedimentation', 'weir_overflow_rate_gpd_ft'))])
    put(stage('SEDIMENTATION'), 'basin_short_circuiting_index', base(tn, 'sedimentation', 'basin_short_circuiting_index'))
    sb = E('SEDIMENTATION/Sedimentation Basin')
    put(sb, 'level_pct', clamp(base(tn, 'sedimentation_basin', 'level_pct'), hi=99.0))
    put(sb, 'residence_time_min', [v / f for v, f in zip(base(tn, 'sedimentation_basin', 'residence_time_min'), F)])
    sc = E('SEDIMENTATION/Sludge Collector')
    cyc = base(tn, 'sludge_collector', 'cycle_time_min')
    cur = base(tn, 'sludge_collector', 'motor_current_a')
    spd = base(tn, 'sludge_collector', 'travel_speed_pct')
    if tn == BLANKET_TRAIN:
        stretch = ramp(DESLUDGE_STRETCH[0], DESLUDGE_STRETCH[1], DESLUDGE_STRETCH[2])
        after = [1.0 if minutes(t) >= minutes('12:15') else 0.0 for t in TS]
        cyc = add(cyc, [s * (1 - a) + DESLUDGE_TIGHTENED_MIN * a for s, a in zip(stretch, after)])
        manual_run = window(*MANUAL_DESLUDGE)
        c_sp, v_sp = sp(tn, 'sludge_collector', 'motor_current_a'), sp(tn, 'sludge_collector', 'travel_speed_pct')
        cur = add(cur, [c_sp * (0.004 * max(0.0, b - b_sp) + 0.3 * m) for b, m in zip(blanket, manual_run)])
        spd = add(spd, [0.5 * v_sp * m for m in manual_run])
    put(sc, 'motor_current_a', cur)
    put(sc, 'travel_speed_pct', spd)
    put(sc, 'cycle_time_min', cyc)

    # ── Filtration: headloss grows with run time and resets at a backwash ──
    h0 = sp(tn, 'filtration', 'headloss_ft')
    slope = sp(tn, 'filtration', 'headloss_slope_ft_h')
    hl, last_bw, h_start = [], 0.0, h0
    for i, t in enumerate(TS):
        if t in bw:
            last_bw, h_start = HOURS[i], (BACKWASH_RESET_FT if t in bw_extra else CLEAN_BED_FT)
        k = FAST_SLOPE_FT_H if (bw_extra and minutes(t) >= minutes(bw_extra[0])) else slope
        hl.append(h_start + k * (HOURS[i] - last_bw))
    if tn == FOUL_TRAIN:
        hl = interp(FOUL_HEADLOSS)
    hl = add(hl, ar1(BASE[('filtration', 'headloss_ft')][2] * 3.3, 0.8))
    if tn == FOUL_TRAIN:
        hl = pin(hl, FOUL_PINS)
    put(stage('FILTRATION'), 'headloss_ft', hl)
    run_sp = sp(tn, 'filtration', 'filter_run_time_hrs')
    freq_sp = 168 / run_sp
    if tn == BACKWASH_TRAIN:                        # rolling estimate climbs with each extra backwash
        freq = [freq_sp + x for x in lag(add(*[step(t, FREQ_STEP_PER_EXTRA) for t in bw_extra]), FREQ_LAG)]
        freq = add(freq, ar1(0.02 * freq_sp, 0.9))
        run = [168 / f for f in freq]
    else:
        run = base(tn, 'filtration', 'filter_run_time_hrs',
                   interp(FOUL_RUN_TIME) if tn == FOUL_TRAIN else None)
        freq = [168 / r for r in run]
    put(stage('FILTRATION'), 'filter_run_time_hrs', run)
    put(stage('FILTRATION'), 'backwash_frequency_per_week', freq)
    put(stage('FILTRATION'), 'unit_filter_run_volume_gal_sf',
        base(tn, 'filtration', 'unit_filter_run_volume_gal_sf',
             [sp(tn, 'filtration', 'unit_filter_run_volume_gal_sf') * r / run_sp for r in run]))
    fe_sp = sp(tn, 'filtration', 'filter_effluent_turbidity_ntu')
    ripening = pulses(bw, [0.0, 0.035, 0.015])      # first-filtrate spike after a backwash
    fe_model = [fe_sp * (s / S_sp) ** 0.3 for s in lag(settled, 0.5)]
    fe = add(base(tn, 'filtration', 'filter_effluent_turbidity_ntu', fe_model), ripening)
    put(stage('FILTRATION'), 'filter_effluent_turbidity_ntu', fe)
    bed = E('FILTRATION/Filter Bed')
    dp_off = sp(tn, 'filter_bed', 'differential_pressure_psi') - PSI_PER_FT * 3.3
    put(bed, 'differential_pressure_psi',
        add([dp_off + PSI_PER_FT * h for h in hl], ar1(0.03 * sp(tn, 'filter_bed', 'differential_pressure_psi'), 0.85)))
    put(bed, 'backwash_cycles_per_day',
        base(tn, 'filter_bed', 'backwash_cycles_per_day', [sp(tn, 'filter_bed', 'backwash_cycles_per_day') * f / freq_sp
                                                           for f in lag(freq, 0.5)]))
    bwp = E('FILTRATION/Backwash Pump')
    running = pulses(bw, [1.0])                     # the pump's backwash duty in that 5-minute sample
    for key, bump in [('flow_rate_gpm', 0.12), ('process_motor_current_a', 0.08), ('discharge_pressure_psi', 0.06),
                      ('vibration_mms', 0.08), ('bearing_temp_c', 0.0)]:
        put(bwp, key, [v * (1 + bump * r) for v, r in zip(base(tn, 'backwash_pump', key), running)])

    # ── Disinfection: CT = residual × contact time × k ──
    dem_sp = sp(tn, 'disinfection', 'chlorine_demand_mg_l')
    demand = base(tn, 'disinfection', 'chlorine_demand_mg_l', [dem_sp + 0.05 * x for x in lag(excess, 0.3)])
    put(stage('DISINFECTION'), 'chlorine_demand_mg_l', demand)
    res_sp = sp(tn, 'disinfection', 'chlorine_residual_mg_l')
    residual = base(tn, 'disinfection', 'chlorine_residual_mg_l', [res_sp - 0.3 * (d - dem_sp) for d in demand])
    c_sp = sp(tn, 'disinfection', 'contact_time_min')
    contact = [v / f for v, f in zip(base(tn, 'disinfection', 'contact_time_min'), F)]
    maint = [0.0] * N
    if tn == CT_TRAIN:
        maint = [v - CONTACT_SP_T02 for v in interp(CONTACT_ANCHORS)]
        contact = pin(add(contact, maint), CONTACT_ANCHORS)
        residual = pin(residual, {TS[-1]: round(res_sp, 2)})
        k_ct = CT_NOW_T02 / (CONTACT_ANCHORS[TS[-1]] * round(res_sp, 2))
    else:
        k_ct = sp(tn, 'disinfection', 'ct_value_actual') / (res_sp * c_sp)
    put(stage('DISINFECTION'), 'chlorine_residual_mg_l', residual)
    put(stage('DISINFECTION'), 'contact_time_min', contact)
    r3, c3 = series[stage('DISINFECTION')]['chlorine_residual_mg_l'], series[stage('DISINFECTION')]['contact_time_min']
    put(stage('DISINFECTION'), 'ct_value_actual', [k_ct * r * c for r, c in zip(r3, c3)])
    req = base(tn, 'disinfection', 'ct_value_required')
    if tn == CT_TRAIN:
        req = pin(req, {TS[-1]: CT_REQUIRED_T02})
    put(stage('DISINFECTION'), 'ct_value_required', req)
    put(stage('DISINFECTION'), 'dbp_formation_risk',
        base(tn, 'disinfection', 'dbp_formation_risk',
             [sp(tn, 'disinfection', 'dbp_formation_risk') * (r / res_sp) * (1 + 0.05 * x)
              for r, x in zip(residual, lag(excess, 0.2))]))
    ccb = E('DISINFECTION/Chlorine Contact Basin')
    bf = c_sp / sp(tn, 'chlorine_contact_basin', 'residence_time_min')     # baffling factor T10 / HRT
    put(ccb, 'residence_time_min', [c / bf * (1 + e) for c, e in
                                    zip(contact, ar1(BASE[('chlorine_contact_basin', 'residence_time_min')][2], 0.84))])
    l_sp = sp(tn, 'chlorine_contact_basin', 'level_pct')
    put(ccb, 'level_pct', clamp(add(base(tn, 'chlorine_contact_basin', 'level_pct'),
                                    [l_sp * m / CONTACT_SP_T02 for m in maint]), hi=99.0))
    cfp = E('DISINFECTION/Chlorine Feed Pump')
    need = [f * (r + d) / (res_sp + dem_sp) for f, r, d in zip(F, residual, demand)]
    put(cfp, 'dosing_flow_rate_gpm',
        base(tn, 'chlorine_feed_pump', 'dosing_flow_rate_gpm', [sp(tn, 'chlorine_feed_pump', 'dosing_flow_rate_gpm') * n
                                                                for n in need]))
    for key in ['vibration_mms', 'bearing_temp_c', 'motor_current_a', 'discharge_pressure_psi']:
        put(cfp, key, base(tn, 'chlorine_feed_pump', key))
    cst = E('DISINFECTION/Chlorine Storage Tank')
    use = base(tn, 'chlorine_storage_tank', 'consumption_rate',
               [sp(tn, 'chlorine_storage_tank', 'consumption_rate') * n for n in need])
    put(cst, 'consumption_rate', use)
    lvl0, used, level = sp(tn, 'chlorine_storage_tank', 'level_pct'), 0.0, []
    for u in use:
        used += u * STEP / 60
        level.append(lvl0 - used)
    put(cst, 'level_pct', add(level, ar1(0.004 * lvl0, 0.85)))
    put(cst, 'temperature_c', base(tn, 'chlorine_storage_tank', 'temperature_c'))

    # ── Train KPIs ──
    throughput = [TARGET_RATE * perf_sp * f * (1 - o) for f, o in zip(F, offline)]
    avail = base(tn, 'train', 'line_availability')
    q_sp = sp(tn, 'train', 'line_quality_factor')
    quality = base(tn, 'train', 'line_quality_factor',
                   [q_sp - 0.2 * max(0.0, s - S_sp) - 4.0 * max(0.0, e - fe_sp - 0.02) for s, e in zip(settled, fe)])
    bw_pulse = lag(pulses(bw_extra, [1.0]), 0.5)
    instab = add(base(tn, 'train', 'instability_index'),
                 [1.3 * (v - sp(tn, 'intake', 'intake_flow_variability')) for v in ifv],
                 [0.08 * (x - sp(tn, 'coagulation', 'jar_test_deviation_pct'))
                  for x in series[stage('COAGULATION')]['jar_test_deviation_pct']],
                 [0.8 * p for p in bw_pulse])
    health = add(base(tn, 'train', 'system_health_index'),
                 [-0.15 * (sp(tn, 'coagulation', 'coagulant_pump_stability') - s) for s in stability],
                 [-0.2 * max(0.0, h - 3.5) for h in hl],
                 [-0.12 * max(0.0, f - freq_sp) for f in freq],
                 [-0.03 * max(0.0, b - 45) for b in blanket])
    put(T, 'line_availability', avail)
    put(T, 'line_quality_factor', quality)
    put(T, 'total_wip', base(tn, 'train', 'total_wip'))
    put(T, 'instability_index', instab)
    put(T, 'system_health_index', health)
    put(T, 'flow_efficiency', add(base(tn, 'train', 'flow_efficiency'), [-25 * o for o in offline]))
    put(T, 'line_target_rate', [TARGET_RATE] * N)
    put(T, 'line_throughput', throughput)
    s_ = series[T]
    put(T, 'line_oee', [a * (q / TARGET_RATE) * f / 100 for a, q, f in
                        zip(s_['line_availability'], s_['line_throughput'], s_['line_quality_factor'])])

# ── Plant rollups (properties.json derivations), from the rounded train series ──
PLANT_RULES = [('plant_throughput', 'sum', 'line_throughput'), ('plant_target_rate', 'sum', 'line_target_rate'),
               ('plant_oee', 'mean', 'line_oee'), ('plant_availability', 'mean', 'line_availability'),
               ('plant_quality_factor', 'mean', 'line_quality_factor'),
               ('plant_health_index', 'mean', 'system_health_index'),
               ('plant_instability_index', 'max', 'instability_index')]
FNS = {'sum': sum, 'mean': lambda v: sum(v) / len(v), 'max': max}
for key, fn, of in PLANT_RULES:
    put(PLANT_ID, key, [FNS[fn]([series[tid(tn)][of][i] for tn in TRAINS]) for i in range(N)])

# Order every asset's series by its type's key list; current value = last point.
series = {a['id']: {k: series[a['id']][k] for k in TYPE_PROPS[a['assetType']]} for a in assets}
values = {aid: {k: s[-1] for k, s in props.items()} for aid, props in series.items()}

properties = {
    'properties': {k: {'label': v[0], 'unit': v[1], 'category': v[2], 'tier': v[3], 'range': v[4], 'decimals': v[5]}
                   for k, v in sorted(PROPS.items())},
    'derivations': [{'assetType': 'plant', 'property': key, 'fn': fn, 'of': of, 'fromType': 'train',
                     'scope': 'children'} for key, fn, of in PLANT_RULES] + [
        {'assetType': 'train', 'property': 'line_oee', 'fn': 'formula',
         'note': 'line_availability × (line_throughput ÷ line_target_rate) × line_quality_factor ÷ 100'},
        {'assetType': 'filtration', 'property': 'backwash_frequency_per_week', 'fn': 'formula',
         'note': '168 ÷ filter_run_time_hrs (projected run length → backwashes per week)'},
        {'assetType': 'disinfection', 'property': 'ct_value_actual', 'fn': 'formula',
         'note': 'chlorine_residual_mg_l × contact_time_min × k, k a per-train constant (inactivation credit scaling)'},
    ],
    'typeLabels': {},
}

# ── Attention items — evidence read back from the series ────────────────
NOW_MIN = END


def label_of(aid):
    names, a = [], A[aid]
    while a:
        names.insert(0, a['name'])
        if a['assetLevel'] == UNIT_LEVEL:
            return SEP.join(names)
        a = A.get(a['parentId'])
    return A[aid]['name']


def unit_of(aid):
    a = A[aid]
    while a and a['assetLevel'] != UNIT_LEVEL:
        a = A.get(a['parentId'])
    return a['id'] if a else None


def since_text(mins, resolved):
    h, m = divmod(mins, 60)
    body = f'{h}h {m}m ago' if h else f'{m}m ago'
    return f'Resolved {body}' if resolved else body


# Per item: asset, primary key, "since" time, outcome, how evidence values are
# shown (decimals, unit text), and the evidence times with their notes.
# WSIT06's evidence is event codes (1 = a backwash in that sample), as in the
# original pack: the value text names the backwash, the series shows the reset.
ITEM_SPECS = [
    ('WSIT01', f'{tid(DOSE_TRAIN)}_COAGULATION', 'coagulant_dose_mg_l', '11:30', 'resolved', (1, ' mg/L'),
     [('09:40', 'Baseline'), ('10:05', ''), ('10:30', 'Drift begins'), ('10:55', ''), ('11:15', 'Lowest point'),
      ('11:30', 'Pump inspected'), ('11:45', 'Recalibrated'), ('12:00', 'Back to target')]),
    ('WSIT02', f'{tid(BLANKET_TRAIN)}_SEDIMENTATION', 'sludge_blanket_level_pct', '12:20', 'resolved', (1, '%'),
     [('10:20', 'Baseline'), ('10:45', ''), ('11:10', ''), ('11:35', ''), ('12:00', 'Approaching threshold'),
      ('12:10', 'Manual desludge triggered'), ('12:25', 'Draining'), ('12:40', 'Back to normal')]),
    ('WSIT03', f'{tid(FOUL_TRAIN)}_FILTRATION', 'headloss_ft', '08:30', 'none', (1, ' ft'),
     [('08:30', 'Baseline'), ('09:40', ''), ('10:30', ''), ('11:20', ''), ('12:15', ''), ('13:05', ''),
      ('13:35', ''), ('14:05', 'Current')]),
    ('WSIT04', f'{tid(SENSOR_TRAIN)}_SEDIMENTATION', 'settled_water_turbidity_ntu', '11:10', 'resolved', (1, ' NTU'),
     [('09:20', 'Baseline'), ('09:35', ''), ('09:50', 'Signal noise begins'), ('10:05', 'Peak noise'),
      ('10:20', 'Grab sample: 2.0 NTU confirmed'), ('10:35', 'Sensor cleaned'), ('10:50', ''), ('11:05', 'Steady')]),
    ('WSIT05', f'{tid(STORM_TRAIN)}_INTAKE', 'raw_water_turbidity_ntu', '12:40', 'resolved', (1, ' NTU'),
     [('10:30', 'Baseline'), ('10:55', 'Storm arriving'), ('11:20', ''), ('11:45', 'Dose increased'), ('12:00', 'Peak'),
      ('12:15', 'Receding'), ('12:30', ''), ('12:40', 'Back to baseline')]),
    ('WSIT06', f'{tid(BACKWASH_TRAIN)}_FILTRATION', 'headloss_ft', '11:00', 'none', None,
     list(zip(BACKWASHES_T06, ['', '', 'Frequency rising', '', 'Current']))),
    ('WSIT07', f'{tid(CT_TRAIN)}_DISINFECTION', 'ct_value_actual', MAINT_START, 'recovering', (0, ''),
     [('13:00', 'Maintenance begins'), ('13:15', ''), ('13:30', ''), ('13:45', ''), ('14:00', ''),
      ('14:05', 'Current — still above 120 minimum')]),
]

# Item text, unchanged from the converted pack.
ITEM_TEXT = {
    'WSIT01': dict(
        severity='medium',
        signal='Coagulant dose drifted off jar-test target, since corrected',
        aiInterpretation='Pump output drifted ~15% low over two hours; settled water turbidity was trending up before correction.',
        attentionState='watch',
        d_signal='Coagulant dose on T02 drifted from 18.1 to 15.4 mg/L between 09:40 and 11:30, without a corresponding jar-test change.',
        d_observed='Coagulant pump output declined gradually; no operator setpoint change logged in the same window.',
        d_derived='Settled water turbidity downstream began rising within 40 minutes of the dose drop — consistent with underdosing, not a raw water change.',
        d_inferred='Pump wear or a partially fouled injection point is the leading theory — confirmed by inspection and corrected.',
        d_recommendation='Recalibrate the coagulant feed pump and confirm dose against a fresh jar test before returning to automatic control.',
        d_whatChangedSummary='Coagulant feed pump was recalibrated at 11:38 after inspection found early signs of diaphragm wear.',
        d_confidence='Confirmed by inspection',
        d_confidenceLevel='high',
        d_risk='Low — caught before filtered water turbidity was affected',
        d_riskLevel='low',
        d_expectedOutcome='Coagulant dose restored to jar-test target',
        relatedOccurrences=[],
        whatChanged=[{'time': '11:32', 'source': 'Operator Action', 'description': 'Coagulant pump inspection started.', 'related': True},
                     {'time': '11:38', 'source': 'Maintenance', 'description': 'Pump recalibrated; dose restored.', 'related': True}],
    ),
    'WSIT02': dict(
        severity='medium',
        signal='Sludge blanket rose toward the weir, desludging caught it up',
        aiInterpretation='Blanket climbed for over an hour as desludging fell behind normal frequency; corrected before any carryover risk.',
        attentionState='watch',
        d_signal='Sludge blanket level on T04 rose from 33% to 58% of basin depth between 10:20 and 12:10, while the desludge cycle ran less frequently than its normal interval.',
        d_observed='Blanket level trending up steadily; desludge cycle frequency below the typical rate for current raw water loading.',
        d_derived='The rise rate tracks almost linearly with the missed desludge cycles — a scheduling gap, not a sudden solids loading event.',
        d_inferred='Desludge cycle timer was not adjusted after a raw water turbidity increase earlier in the shift — corrected manually.',
        d_recommendation='Run an extra desludge cycle and re-check the auto-cycle timer logic against current raw water turbidity.',
        d_whatChangedSummary='An extra manual desludge cycle at 12:10 reversed the rise within 30 minutes.',
        d_confidence='Confirmed — blanket responded immediately to the extra cycle',
        d_confidenceLevel='high',
        d_risk='Low — resolved well before weir overflow risk',
        d_riskLevel='low',
        d_expectedOutcome='Blanket level returned to normal operating range',
        relatedOccurrences=[],
        whatChanged=[{'time': '12:10', 'source': 'Operator Action', 'description': 'Manual desludge cycle triggered.', 'related': True},
                     {'time': '12:12', 'source': 'Maintenance', 'description': 'Auto-cycle timer flagged for review.', 'related': True}],
    ),
    'WSIT03': dict(
        severity='medium',
        signal='Filter headloss climbing, run time shortening',
        aiInterpretation='Headloss has risen steadily since shift start with no matching turbidity spike — media fouling, not an upstream upset.',
        attentionState='investigate',
        d_signal="Headloss on T01's filter has climbed from 2.6 to 4.4 ft since 08:30, with run time between backwashes shortening from a typical 48 hours toward roughly 30.",
        d_observed='Headloss rising at a steady rate; filter effluent turbidity remains within spec throughout.',
        d_derived="Because effluent quality hasn't degraded, this reads as physical media fouling accumulating, not a process upset that would show up in turbidity first.",
        d_inferred='Progressive media fouling — most likely mudball formation or media loss reducing effective bed depth, pending the next scheduled bed inspection.',
        d_recommendation='Schedule a filter bed inspection before the next backwash; consider an early backwash if headloss approaches the 6 ft alarm point.',
        d_whatChangedSummary='No triggering event identified yet — the rise has been gradual since the start of the shift.',
        d_confidence='Likely, pending bed inspection',
        d_confidenceLevel='medium',
        d_risk='Medium — approaching a shortened backwash cycle if the trend continues',
        d_riskLevel='medium',
        d_expectedOutcome='Bed inspection scheduled for next available window',
        relatedOccurrences=[{'date': 'Ruled out', 'summary': 'Raw water turbidity increase considered and rejected — intake readings have been stable all shift.'}],
        whatChanged=[],
    ),
    'WSIT04': dict(
        severity='low',
        signal='Settled water turbidity sensor drift, confirmed against grab sample',
        aiInterpretation='Sensor read erratically for nearly an hour while a manual grab sample stayed flat — a measurement fault, not a real turbidity event.',
        attentionState='watch',
        d_signal='The settled-water turbidimeter on T05 swung between 1.8 and 4.6 NTU from 09:35, while a manual grab sample taken at 10:20 read a steady 2.0 NTU.',
        d_observed='Turbidity signal varies rapidly in both directions; manual grab sample and downstream filter performance both remain steady.',
        d_derived='Filter effluent never responded to the swings — a real 4.6 NTU settled-water event would show up there within the hydraulic residence time.',
        d_inferred='Instrument fouling or a loose sample line connection, not a real process swing — confirmed by cleaning and recalibrating the sensor.',
        d_recommendation='Validate the instrument against a grab sample on this schedule going forward; flag for cleaning during next PM cycle.',
        d_whatChangedSummary='A grab sample at 10:20 confirmed the mismatch, and the sensor was cleaned shortly after.',
        d_confidence='Confirmed by grab sample',
        d_confidenceLevel='high',
        d_risk='Low — measurement-only, no real process risk',
        d_riskLevel='low',
        d_expectedOutcome='Sensor agreement with grab sample restored',
        relatedOccurrences=[{'date': 'Ruled out', 'summary': 'True settled-water turbidity event considered and rejected — filter effluent never moved.'}],
        whatChanged=[{'time': '10:20', 'source': 'Field Check', 'description': 'Grab sample taken, compared to sensor.', 'related': True},
                     {'time': '10:32', 'source': 'Maintenance', 'description': 'Sensor cleaned and recalibrated.', 'related': True}],
    ),
    'WSIT05': dict(
        severity='high',
        signal='Storm event raw water turbidity shock, absorbed without a filtered-water impact',
        aiInterpretation='Raw water turbidity spiked sharply during a storm cell; coagulant dose was increased in response and no downstream exceedance occurred.',
        attentionState='watch',
        d_signal='Raw water turbidity on the T03 intake spiked from a baseline of 9 NTU to 68 NTU between 10:30 and 12:40, coinciding with a recorded storm cell over the watershed.',
        d_observed='Raw turbidity rose sharply; coagulant dose was manually increased partway through the event.',
        d_derived='The turbidity rise and dose increase are tightly correlated in time, and settled/filtered water never exceeded spec — the response kept pace with the shock.',
        d_inferred='A storm-driven raw water quality shock, successfully absorbed by an early coagulant dose increase — consistent with known seasonal storm response patterns.',
        d_recommendation='Log this event for the seasonal storm-response playbook; no further action needed this shift.',
        d_whatChangedSummary='Coagulant dose was manually increased at 11:48 in response to the rising raw water turbidity.',
        d_confidence='Confirmed — dose response tracked the raw water signal closely',
        d_confidenceLevel='high',
        d_risk='High while active — real risk of a filtered-water exceedance if the response had lagged',
        d_riskLevel='high',
        d_expectedOutcome='Raw water and coagulant dose both returned to baseline',
        relatedOccurrences=[],
        whatChanged=[{'time': '10:52', 'source': 'Event', 'description': 'Storm cell recorded over watershed.', 'related': True},
                     {'time': '11:48', 'source': 'Operator Action', 'description': 'Coagulant dose increased in response.', 'related': True}],
    ),
    'WSIT06': dict(
        severity='medium',
        signal='Filter backwashing more often than its normal cycle',
        aiInterpretation='Backwash frequency has roughly doubled since late morning — each cycle looks routine alone, the pattern is what matters.',
        attentionState='investigate',
        d_signal='T06 has backwashed 5 times since 11:00, roughly twice its typical rate for this time of day, though headloss and effluent turbidity both recover fully after each cycle.',
        d_observed='Backwash frequency elevated; each individual cycle completes normally with full recovery.',
        d_derived='No single backwash looks abnormal — the significance is in the accumulated frequency, not any one event.',
        d_inferred='Possible early media degradation or a slightly undersized run-time setpoint for current raw water conditions — not yet confirmed.',
        d_recommendation='Monitor through end of shift; if frequency continues, schedule a media condition check on this filter specifically.',
        d_whatChangedSummary='No single triggering change — frequency has been elevated since about 11:00 without one clear cause yet.',
        d_confidence='Likely, not yet confirmed',
        d_confidenceLevel='medium',
        d_risk='Medium — increased backwash water usage and reduced net production if it continues',
        d_riskLevel='medium',
        d_expectedOutcome='Still active as of the latest cycle',
        relatedOccurrences=[{'date': 'Meridian · T01 · Filtration — Filter Media Fouling', 'summary': 'Same plant, different train — worth checking whether both filters share a raw water or media-age factor.'}],
        whatChanged=[],
    ),
    'WSIT07': dict(
        severity='low',
        signal='Contact basin maintenance underway, CT margin narrowing',
        aiInterpretation='Planned baffle maintenance has reduced usable contact time; CT is still above the regulatory minimum but with a smaller margin than usual.',
        attentionState='act',
        d_signal='Planned contact basin baffle maintenance on T02 since 13:00 has reduced effective contact time from 35 to 29 minutes, bringing the actual CT value to 128 against a required minimum of 120.',
        d_observed='Contact time reduced during planned maintenance; chlorine residual unchanged.',
        d_derived='CT is calculated directly from residual and contact time — the margin narrowed because contact time dropped, not because dosing changed.',
        d_inferred='Expected consequence of planned maintenance, not a fault — but the margin is real and worth tracking until the basin returns to full configuration.',
        d_recommendation='Monitor CT each 15-minute cycle until baffle maintenance completes; increase residual slightly if the margin narrows further.',
        d_whatChangedSummary='Planned baffle maintenance is the direct, known cause of the narrowing margin.',
        d_confidence='Confirmed — CT drop matches the maintenance window exactly',
        d_confidenceLevel='high',
        d_risk='Low today, but margin is genuinely thinner than normal',
        d_riskLevel='low',
        d_expectedOutcome='CT expected to recover once baffle maintenance completes',
        relatedOccurrences=[],
        whatChanged=[{'time': '13:00', 'source': 'Maintenance', 'description': 'Contact basin baffle maintenance started.', 'related': True}],
    ),
}


def evidence(aid, key, fmt, points):
    if fmt is None:                                 # event codes
        return [1] * len(points), [{'time': t, 'value': f'Backwash #{n}', 'label': note}
                                   for n, (t, note) in enumerate(points, 1)]
    dec, unit = fmt
    ev, evp = [], []
    for t, note in points:
        v = round(series[aid][key][IDX[t]], dec)
        v = int(v) if dec == 0 else v
        ev.append(v)
        evp.append({'time': t, 'value': f'{v:.{dec}f}{unit}', 'label': note})
    return ev, evp


attention = []
for iid, aid, key, since_t, outcome, fmt, points in ITEM_SPECS:
    tx = ITEM_TEXT[iid]
    ev, evp = evidence(aid, key, fmt, points)
    mins = NOW_MIN - minutes(since_t)
    detail = {k: tx['d_' + k] for k in ('signal', 'observed', 'derived', 'inferred', 'recommendation')}
    detail.update({'evidence': ev, 'evidencePoints': evp, 'relatedOccurrences': tx['relatedOccurrences'],
                   'whatChangedSummary': tx['d_whatChangedSummary'], 'whatChanged': tx['whatChanged']})
    detail.update({k: tx['d_' + k] for k in ('confidence', 'confidenceLevel', 'risk', 'riskLevel', 'expectedOutcome')})
    detail['outcomeStatus'] = outcome
    unit = unit_of(aid)
    attention.append({
        'id': iid, 'severity': tx['severity'], 'asset': label_of(aid), 'line': A[unit]['name'],
        'signal': tx['signal'], 'aiInterpretation': tx['aiInterpretation'],
        'since': since_text(mins, outcome == 'resolved'), 'sinceMinutes': mins,
        'attentionState': tx['attentionState'], 'detail': detail,
        'assetId': aid, 'unitId': unit, 'primaryProperty': key,
    })

# ── Unit status: a train with an unresolved item needs attention since its
# oldest one started; otherwise it has been running since its last item resolved.
unit_status = {}
for tn in TRAINS:
    mine = [a for a in attention if a['unitId'] == tid(tn)]
    active = [a['sinceMinutes'] for a in mine if a['detail']['outcomeStatus'] != 'resolved']
    done = [a['sinceMinutes'] for a in mine if a['detail']['outcomeStatus'] == 'resolved']
    state, since_m = ('attention', max(active)) if active else ('running', min(done) if done else NOW_MIN - START)
    unit_status[tid(tn)] = {'state': state, 'statusSinceMinutes': since_m, 'mode': 'STEADY', 'product': PRODUCT}

# ── Work items (unchanged from the converted pack) ──────────────────────
WORK = [
    ('wk-w01', 'Morning water quality sample', 'Routine raw and finished water sampling', tid(1), 'SAMPLE', 'routine',
     'planned', None, 'operator', 'Operator', '08:15', '08:15', 15, True, '08:22', '08:15'),
    ('wk-w02', 'Filter bed walkthrough', 'Visual inspection of all filter beds', PLANT_ID, 'INSPECTION', 'routine',
     'planned', None, 'operator', 'Operator', '09:00', '09:20', 20, True, '09:15', '09:00'),
    ('wk-w03', 'Shift safety briefing', 'Morning safety and priorities briefing', PLANT_ID, 'HUDDLE', 'routine',
     'planned', None, 'operator', 'Operator', '08:00', '08:10', 10, True, '08:08', '08:00'),
    ('wk-w04', 'Inspect coagulant feed pump', 'Diaphragm wear check after dose drift flagged',
     f'{tid(DOSE_TRAIN)}_COAGULATION', 'MAINTENANCE', 'important', 'situation', 'From: Coagulant Dosing Drift', 'ai',
     'Maintenance', '11:32', '11:50', 18, True, '11:38', '11:32'),
    ('wk-w05', 'Review desludge cycle timer', 'Confirm auto-cycle logic against raw water turbidity',
     f'{tid(BLANKET_TRAIN)}_SEDIMENTATION', 'INSPECTION', 'important', 'situation', 'From: Sludge Blanket Rising', 'ai',
     'Operator', '12:10', '12:30', 20, True, '12:12', '12:10'),
    ('wk-w06', 'Filter bed inspection — T01', 'Investigate rising headloss trend', f'{tid(FOUL_TRAIN)}_FILTRATION',
     'INSPECTION', 'important', 'situation', 'From: Filter Media Fouling investigation', 'ai', 'Maintenance',
     '14:00', '15:00', 30, False, None, '14:00'),
    ('wk-w07', 'Validate turbidity sensor — T05', 'Compare against grab sample, clean if needed',
     f'{tid(SENSOR_TRAIN)}_SEDIMENTATION', 'INSTRUMENT_CHECK', 'important', 'situation',
     'From: Turbidity Sensor Drift investigation', 'ai', 'Field Operator', '10:20', '10:40', 20, True, '10:32', '10:20'),
    ('wk-w08', 'Storm response log entry', 'Document coagulant response for seasonal playbook',
     f'{tid(STORM_TRAIN)}_INTAKE', 'DOCUMENTATION', 'routine', 'situation', 'From: Storm Event Raw-Water Shock', 'ai',
     'Operator', '12:45', '13:15', 15, True, '12:58', '12:45'),
    ('wk-w14', 'End-of-shift handoff log', 'Summarize open items for next shift', PLANT_ID, 'HUDDLE', 'routine',
     'planned', None, 'operator', 'Operator', '15:45', '16:00', 15, False, None, '15:45'),
]


def iso(t):
    return f'{DATE}T{t}:00' if t else None


work_items = [{'id': w, 'text': text, 'description': desc, 'assetLabel': label_of(aid), 'workType': wtype,
               'priority': prio, 'sourceType': stype, 'sourceLabel': slabel, 'source': src, 'assignedRole': role,
               'plannedStart': iso(start), 'dueAt': iso(due), 'estimatedDurationMinutes': dur, 'done': done,
               'completedAt': iso(completed), 'assetId': aid, 'createdAt': iso(created)}
              for (w, text, desc, aid, wtype, prio, stype, slabel, src, role, start, due, dur, done, completed, created)
              in WORK]

# ── Write ───────────────────────────────────────────────────────────────
telemetry = {'timeline': {'date': DATE, 'start': TS[0], 'end': TS[-1], 'stepMinutes': STEP},
             'timestamps': TS, 'series': series}
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

# Sanity checks the generator relies on: every value inside its gauge range.
bad = [(aid, k, min(s), max(s), PROPS[k][4]) for aid, props in series.items() for k, s in props.items()
       if not PROPS[k][4][0] <= min(s) <= max(s) <= PROPS[k][4][1]]
assert not bad, bad
print(f'Wrote {len(files)} files to {OUT}: {len(assets)} assets, {len(TRAINS)} units, '
      f'{len(rels)} edges, {N} points, {len(attention)} attention items, {len(work_items)} work items')
