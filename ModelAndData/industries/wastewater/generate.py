#!/usr/bin/env python3
"""Confluence — municipal wastewater treatment plant — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/wastewater/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/wastewater/generate.py [OUTDIR]

This pack predates the spec. It was hand-built, then converted once into the
generic format (spec §12). This generator was written afterwards to
REPRODUCE that pack: the hierarchy, relationship edges, property keys and
metadata, attention items and work items are kept exactly (saved layouts and
asset sets are keyed by them), while every time series is now generated here
from physics-flavoured drivers, the way the newer packs do it. Nothing is
read from the existing JSON files.

The plant: Confluence, a conventional activated-sludge plant with six
identical parallel treatment trains T01–T06. Each train is
preliminary treatment → primary clarifier → aeration → secondary clarifier
→ disinfection, with three pieces of equipment per stage. The unit of
operation is the **train** (spec §3.1).

How a train's data is made (spec §5):

  * a few shared **drivers** per train: influent flow factor Q (a plant-wide
    diurnal curve × per-train bias × slow AR(1) drift), organic load L,
    blower air-delivery factor A, and the stories' own driver changes;
  * every stage/equipment property = its per-asset setpoint (spread across
    the six trains) + slowly drifting AR(1) noise + the physical coupling
    to the drivers written next to it (pump flow ∝ Q, residence time ∝ 1/Q,
    DO and blower air ∝ A, CT = k · residual · contact time, …);
  * the five attention items (SCENARIOS block below) change drivers and,
    for their primary property, follow the story anchors with a little
    noise in between;
  * train KPIs are formulas over the train's own children, and the plant
    KPIs are the declared sum / mean / max rollups of the trains, at every
    point.

Evidence values in attention-items.json are READ BACK from the generated
series at the evidence times; the narrative text is kept verbatim.
"""
import json
import math
import os
import random
import sys

SEED = 20260828
rng = random.Random(SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'wastewater')
SEP = ' · '
UNIT_LEVEL = 'train'

# ── Timeline (spec §4.2) — the shared demo day. "Now" = 14:05. ──────────
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


NOW_MIN = END

# ═════════════════════════════════════════════════════════════════════════
# Scenario constants — one block per attention item (SCENARIOS.md tells the
# same stories in prose). 'anchors' are the story values of the primary
# property at key times; the primary follows them (straight lines between,
# plus 'noise' sd of AR(1) measurement noise, kept below the display
# resolution so the narrative's numbers hold) inside 'window' and blends
# back into its normal behaviour outside it.
# ═════════════════════════════════════════════════════════════════════════
SCENARIOS = {
    # 05 Component degradation — T03 blower intake filter fouls; air delivery
    # falls from 08:15, DO follows from 08:20. Filter cleared 10:52.
    'WSIT08': {
        'train': 'T03', 'asset': 'AERATION', 'key': 'dissolved_oxygen_mg_l',
        'setpoint': 2.25,
        'anchors': [('08:00', 2.28), ('08:20', 2.30), ('08:55', 1.90), ('09:30', 1.50), ('10:05', 1.10), ('10:25', 0.80),
                    ('10:45', 0.60), ('10:50', 0.64), ('11:05', 1.80), ('11:25', 2.20)],
        'window': ('08:00', '11:25'), 'noise': 0.012,
        # root cause on the Blower: air-delivery factor (1 = clean filter)
        'air_factor': [('08:00', 1.0), ('08:15', 1.0), ('10:45', 0.70), ('10:50', 0.70), ('10:55', 1.0)],
        'discharge_temp_rise_c': 9.0,       # at the worst restriction (higher pressure ratio)
        'vibration_rise_mms': 0.5,
    },
    # 13 Quality drift — T01 early filamentous bulking; SVI climbs all shift
    # while RAS rate and clarifier torque stay normal.
    'WSIT09': {
        'train': 'T01', 'asset': 'SECONDARY_CLARIFIER', 'key': 'sludge_settleability_svi',
        'setpoint': 95.0,
        'anchors': [('08:00', 95.0), ('09:00', 95.0), ('09:50', 103.0), ('10:35', 112.0), ('11:25', 121.0), ('12:10', 130.0),
                    ('13:00', 136.0), ('13:30', 140.0), ('14:05', 142.0)],
        'window': ('08:00', '14:05'), 'noise': 0.2,
    },
    # 11 Hard block — T05 primary sludge collector (rake) trips on overload
    # during the late-morning peak flow; restarted 10:33.
    'WSIT10': {
        'train': 'T05', 'asset': 'PRIMARY_CLARIFIER', 'key': 'primary_tss_removal_pct',
        'setpoint': 61.0,
        'anchors': [('10:15', 61.0), ('10:20', 58.0), ('10:25', 52.0), ('10:30', 45.0), ('10:35', 38.0),
                    ('10:40', 52.0), ('10:45', 59.0), ('10:55', 61.0)],
        'window': ('10:15', '10:55'), 'noise': 0.15,
        'stress': '10:15',                    # drive current +12 % just before the trip
        'stall': ('10:20', '10:35'),          # collector stopped (restart 10:33 → first running sample 10:35)
        'catch_up': ('10:35', '10:50', 1.15),  # runs at 115 % speed to clear the blanket
        'blanket_rise': [('10:20', 0.0), ('10:35', 11.0), ('10:50', 6.0), ('11:20', 0.0)],   # % points
        'solids_to_aeration': 0.25,           # extra organic load on T05 aeration per unit of lost TSS removal
    },
    # 03 Quiet drift — T02 RAS held at a manual 38.5 % while organic load rose;
    # F:M climbed to 0.35 until RAS was raised at 12:05.
    'WSIT11': {
        'train': 'T02', 'asset': 'AERATION', 'key': 'food_to_microorganism_ratio',
        'setpoint': 0.28,
        'anchors': [('10:30', 0.28), ('11:00', 0.30), ('11:30', 0.32), ('12:00', 0.34), ('12:05', 0.35),
                    ('12:20', 0.31), ('12:40', 0.28)],
        'window': ('10:30', '12:40'), 'noise': 0.0015,
        'ras_hold': 38.5, 'ras_hold_until': '12:05', 'ras_after': 46.0,
        # F:M the load would have produced outside the window, and the MLSS trend
        # the higher RAS rate builds after 12:05 (together they give the load L).
        'fm_profile': [('08:00', 0.28), ('10:30', 0.28), ('11:00', 0.30), ('11:30', 0.32), ('12:00', 0.34),
                       ('12:05', 0.35), ('12:20', 0.31), ('12:40', 0.28), ('14:05', 0.275)],
        'mlss_setpoint': 2850.0,
        'mlss_trend': [('08:00', 2850.0), ('12:05', 2850.0), ('12:40', 3150.0), ('13:30', 3050.0), ('14:05', 3000.0)],
    },
    # 14 Plan / compliance at risk — T04 fecal coliform risk borderline (12–15
    # against a limit of 20) with the DMR due; slightly higher influent flow.
    'WSIT12': {
        'train': 'T04', 'asset': 'DISINFECTION', 'key': 'effluent_fecal_coliform_risk',
        'setpoint': 10.0,
        'anchors': [('13:10', 12.1), ('13:25', 12.4), ('13:40', 13.3), ('13:55', 14.1), ('14:00', 14.8), ('14:05', 12.2)],
        'window': ('13:10', '14:05'), 'noise': 0.05,
        'flow_bump': [('08:00', 1.0), ('12:45', 1.0), ('13:10', 1.05), ('14:05', 1.05)],   # × influent flow
    },
}
BLEND_STEPS = 3      # samples over which a story primary blends back into normal behaviour

# ═════════════════════════════════════════════════════════════════════════
# Hierarchy (kept exactly as the converted pack): plant → 6 trains → 5 stages
# → 3 equipment each. Ids are the parent id + '_' + a code.
# ═════════════════════════════════════════════════════════════════════════
PLANT_ID, PLANT_NAME = 'CONFLUENCE', 'Confluence'
TRAINS = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06']
STAGES = [   # (code, name, assetType, [(equipment code, name, assetType)])
    ('PRELIMINARY', 'Preliminary', 'preliminary',
     [('BARSCREEN', 'Bar Screen', 'bar_screen'), ('GRITCHAMBER', 'Grit Chamber', 'grit_chamber'),
      ('INFLUENTPUMP', 'Influent Pump', 'influent_pump')]),
    ('PRIMARY_CLARIFIER', 'Primary Clarifier', 'primary_clarifier',
     [('PRIMARYCLARIFIERBASIN', 'Primary Clarifier Basin', 'primary_clarifier_basin'),
      ('SLUDGECOLLECTOR', 'Sludge Collector', 'sludge_collector'), ('SCUMSKIMMER', 'Scum Skimmer', 'scum_skimmer')]),
    ('AERATION', 'Aeration', 'aeration',
     [('AERATIONBASIN', 'Aeration Basin', 'aeration_basin'), ('BLOWER', 'Blower', 'blower'),
      ('DIFFUSERGRID', 'Diffuser Grid', 'diffuser_grid')]),
    ('SECONDARY_CLARIFIER', 'Secondary Clarifier', 'secondary_clarifier',
     [('SECONDARYCLARIFIERBASIN', 'Secondary Clarifier Basin', 'secondary_clarifier_basin'),
      ('RASPUMP', 'RAS Pump', 'ras_pump'), ('SLUDGECOLLECTOR', 'Sludge Collector', 'sludge_collector')]),
    ('DISINFECTION', 'Disinfection', 'disinfection',
     [('CHLORINECONTACTBASIN', 'Chlorine Contact Basin', 'chlorine_contact_basin'),
      ('CHLORINEFEEDPUMP', 'Chlorine Feed Pump', 'chlorine_feed_pump'),
      ('DECHLORINATIONSYSTEM', 'Dechlorination System', 'dechlorination_system')]),
]
# Relationship edges inside every train (suffixes after CONFLUENCE_Tnn_), in file order.
TRAIN_EDGES = [   # (source, target, label, layer)
    ('PRELIMINARY_BARSCREEN', 'PRELIMINARY_GRITCHAMBER', None, 'process_flow'),
    ('PRELIMINARY_GRITCHAMBER', 'PRELIMINARY_INFLUENTPUMP', None, 'process_flow'),
    ('PRELIMINARY_INFLUENTPUMP', 'PRIMARY_CLARIFIER_PRIMARYCLARIFIERBASIN', None, 'process_flow'),
    ('PRIMARY_CLARIFIER_PRIMARYCLARIFIERBASIN', 'AERATION_AERATIONBASIN', None, 'process_flow'),
    ('AERATION_AERATIONBASIN', 'SECONDARY_CLARIFIER_SECONDARYCLARIFIERBASIN', None, 'process_flow'),
    ('SECONDARY_CLARIFIER_SECONDARYCLARIFIERBASIN', 'DISINFECTION_CHLORINECONTACTBASIN', None, 'process_flow'),
    ('SECONDARY_CLARIFIER_SECONDARYCLARIFIERBASIN', 'SECONDARY_CLARIFIER_RASPUMP', None, 'process_flow'),
    ('SECONDARY_CLARIFIER_RASPUMP', 'AERATION_AERATIONBASIN', 'return activated sludge', 'process_flow'),
    ('AERATION_BLOWER', 'AERATION_DIFFUSERGRID', None, 'air_flow'),
    ('AERATION_DIFFUSERGRID', 'AERATION_AERATIONBASIN', None, 'air_flow'),
    ('DISINFECTION_CHLORINEFEEDPUMP', 'DISINFECTION_CHLORINECONTACTBASIN', None, 'chemical_dosing'),
    ('DISINFECTION_CHLORINECONTACTBASIN', 'DISINFECTION_DECHLORINATIONSYSTEM', None, 'process_flow'),
]

# ── Property metadata (spec §3.4): label, unit, category, tier, range, decimals ──
PROPS = {
    'air_distribution_uniformity_pct': ('Air Distribution', '%', 'Quality', 'P1', [70, 100], 1),
    'air_flow_scfm': ('Air Flow', 'scfm', 'Condition', 'P2', [500, 3000], 1),
    'backpressure_psi': ('Backpressure', 'psi', 'Condition', 'P3', [0, 4], 2),
    'bearing_temp_c': ('Bearing Temp', '°C', 'Condition', 'P2', [30, 90], 1),
    'blower_air_flow_scfm': ('Blower Air Flow', 'scfm', 'Condition', 'P2', [2500, 5000], 1),
    'blower_discharge_pressure_psi': ('Discharge Pressure', 'psi', 'Condition', 'P2', [4, 10], 2),
    'chlorine_residual_mg_l': ('Chlorine Residual', 'mg/L', 'Quality', 'P1', [0.3, 1.8], 2),
    'clarifier_torque_pct': ('Clarifier Torque', '%', 'Condition', 'P2', [30, 80], 1),
    'cleaning_cycles_per_hr': ('Cleaning Cycles', '/hr', 'Events / Losses', 'P3', [0, 8], 2),
    'ct_value_actual': ('CT Value (Actual)', '', 'Derived Metric', 'P1', [51.2, 170], 1),
    'cycle_time_min': ('Cycle Time', 'min', 'Flow / WIP', 'P3', [5, 30], 1),
    'dechlorination_residual_mg_l': ('Dechlorination Residual', 'mg/L', 'Quality', 'P1', [0, 0.15], 2),
    'differential_pressure_psi': ('Differential Pressure', 'psi', 'Condition', 'P1', [0, 5], 2),
    'discharge_pressure_psi': ('Discharge Pressure', 'psi', 'Condition', 'P2', [0, 50], 1),
    'discharge_temp_c': ('Discharge Temp', '°C', 'Condition', 'P2', [40, 100], 1),
    'dissolved_oxygen_mg_l': ('Dissolved Oxygen', 'mg/L', 'Condition', 'P1', [0, 4], 2),
    'dosing_flow_rate_gpm': ('Flow Rate', 'gpm', 'Flow / WIP', 'P2', [0, 8], 2),
    'effluent_fecal_coliform_risk': ('Fecal Coliform Risk', '', 'Derived Metric', 'P1', [0, 25], 1),
    'flow_efficiency': ('Flow Efficiency', '', 'Flow / WIP', 'P3', [95, 102], 1),
    'flow_rate_gpm': ('Flow Rate', 'gpm', 'Flow / WIP', 'P2', [100, 500], 1),
    'food_to_microorganism_ratio': ('F:M Ratio', '', 'Derived Metric', 'P2', [0.15, 0.45], 2),
    'grit_removal_efficiency_pct': ('Grit Removal Efficiency', '%', 'Quality', 'P1', [85, 98], 1),
    'influent_flow_variability': ('Influent Flow Variability', '', 'Stability', 'P2', [0, 25], 1),
    'instability_index': ('Instability', '', 'Stability', 'P1', [0, 15], 2),
    'level_pct': ('Level', '%', 'Flow / WIP', 'P1', [40, 100], 1),
    'line_availability': ('Availability', '%', 'Derived Metric', 'P2', [96, 100], 1),
    'line_oee': ('OEE', '%', 'Derived Metric', 'P1', [93, 100], 1),
    'line_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [97, 100], 1),
    'line_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [3, 7], 2),
    'line_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [3, 7], 2),
    'mlss_mg_l': ('MLSS', 'mg/L', 'Flow / WIP', 'P1', [2200, 3400], 1),
    'motor_current_a': ('Motor Current', 'A', 'Condition', 'P1', [0, 20], 2),
    'odor_index': ('Odor Index', '', 'Condition', 'P3', [0, 35], 1),
    'plant_availability': ('Availability', '%', 'Derived Metric', 'P2', [95, 100], 1),
    'plant_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [88, 100], 1),
    'plant_instability_index': ('Instability', '', 'Stability', 'P1', [0, 20], 2),
    'plant_oee': ('OEE', '%', 'Derived Metric', 'P1', [90, 100], 1),
    'plant_quality_factor': ('Quality Factor', '%', 'Derived Metric', 'P2', [95, 100], 1),
    'plant_target_rate': ('Target Rate', '', 'Flow / WIP', 'P2', [15, 45], 1),
    'plant_throughput': ('Throughput', '', 'Flow / WIP', 'P1', [15, 45], 1),
    'primary_bod_removal_pct': ('Primary BOD Removal', '%', 'Quality', 'P2', [20, 45], 1),
    'primary_tss_removal_pct': ('Primary TSS Removal', '%', 'Quality', 'P2', [36.2, 75], 1),
    'process_motor_current_a': ('Motor Current', 'A', 'Condition', 'P2', [10, 45], 1),
    'rake_motor_torque_pct': ('Rake Torque', '%', 'Condition', 'P2', [0, 100], 1),
    'ras_rate_pct': ('RAS Rate', '%', 'Flow / WIP', 'P2', [30, 60], 1),
    'residence_time_min': ('Residence Time', 'min', 'Flow / WIP', 'P2', [0, 461.6], 1),
    'residual_offset_mg_l': ('Residual Offset', 'mg/L', 'Quality', 'P3', [-0.5, 0.5], 2),
    'screenings_removal_rate_ft3_mg': ('Screenings Removal', '', 'Events / Losses', 'P3', [3, 8], 2),
    'scum_removal_rate': ('Scum Removal Rate', '', 'Events / Losses', 'P3', [85, 100], 1),
    'secondary_tss_removal_pct': ('Secondary TSS Removal', '%', 'Quality', 'P1', [78, 97.5], 1),
    'sludge_age_days': ('Sludge Age', 'days', 'Flow / WIP', 'P1', [6, 13], 1),
    'sludge_blanket_level_pct': ('Sludge Blanket Level', '%', 'Flow / WIP', 'P1', [10, 65], 1),
    'sludge_settleability_svi': ('Sludge Settleability (SVI)', 'mL/g', 'Derived Metric', 'P2', [57.5, 160], 1),
    'surge_control_index': ('Surge Control', '', 'Stability', 'P3', [0, 26.3], 1),
    'system_health_index': ('Health Index', '%', 'Derived Metric', 'P1', [92, 100], 1),
    'total_wip': ('Total WIP', '', 'Flow / WIP', 'P3', [15, 45], 1),
    'travel_speed_pct': ('Travel Speed', '%', 'Condition', 'P3', [0, 100], 1),
    'vibration_mms': ('Vibration', 'mm/s', 'Stability', 'P1', [0, 6], 2),
}

TYPE_PROPS = {   # key order per type = the converted pack's order
    'plant': ['plant_throughput', 'plant_target_rate', 'plant_oee', 'plant_availability', 'plant_quality_factor',
              'plant_health_index', 'plant_instability_index'],
    'train': ['line_oee', 'line_availability', 'line_quality_factor', 'total_wip', 'instability_index',
              'system_health_index', 'flow_efficiency', 'line_target_rate', 'line_throughput'],
    'preliminary': ['screenings_removal_rate_ft3_mg', 'grit_removal_efficiency_pct', 'influent_flow_variability', 'odor_index'],
    'bar_screen': ['differential_pressure_psi', 'rake_motor_torque_pct', 'cleaning_cycles_per_hr'],
    'grit_chamber': ['differential_pressure_psi', 'rake_motor_torque_pct', 'cleaning_cycles_per_hr'],
    'influent_pump': ['vibration_mms', 'bearing_temp_c', 'process_motor_current_a', 'discharge_pressure_psi', 'flow_rate_gpm'],
    'primary_clarifier': ['primary_tss_removal_pct', 'primary_bod_removal_pct', 'sludge_blanket_level_pct',
                          'scum_removal_rate', 'surge_control_index'],
    'primary_clarifier_basin': ['level_pct', 'residence_time_min'],
    'sludge_collector': ['motor_current_a', 'travel_speed_pct', 'cycle_time_min'],
    'scum_skimmer': ['motor_current_a', 'travel_speed_pct', 'cycle_time_min'],
    'aeration': ['dissolved_oxygen_mg_l', 'mlss_mg_l', 'blower_air_flow_scfm', 'food_to_microorganism_ratio', 'sludge_age_days'],
    'aeration_basin': ['level_pct', 'residence_time_min'],
    'blower': ['air_flow_scfm', 'blower_discharge_pressure_psi', 'discharge_temp_c', 'vibration_mms'],
    'diffuser_grid': ['backpressure_psi', 'air_distribution_uniformity_pct'],
    'secondary_clarifier': ['secondary_tss_removal_pct', 'sludge_settleability_svi', 'ras_rate_pct', 'clarifier_torque_pct'],
    'secondary_clarifier_basin': ['level_pct', 'residence_time_min'],
    'ras_pump': ['vibration_mms', 'bearing_temp_c', 'process_motor_current_a', 'discharge_pressure_psi', 'flow_rate_gpm'],
    'disinfection': ['chlorine_residual_mg_l', 'ct_value_actual', 'effluent_fecal_coliform_risk', 'dechlorination_residual_mg_l'],
    'chlorine_contact_basin': ['level_pct', 'residence_time_min'],
    'chlorine_feed_pump': ['vibration_mms', 'bearing_temp_c', 'motor_current_a', 'discharge_pressure_psi', 'dosing_flow_rate_gpm'],
    'dechlorination_system': ['dosing_flow_rate_gpm', 'motor_current_a', 'residual_offset_mg_l'],
}
TYPE_LABELS = {'ras_pump': 'RAS Pump'}

# ── Baseline parameters: (setpoint mean, spread of setpoints across the six
# trains (sd), AR(1) noise sd, AR coefficient). Chosen from the converted
# pack's statistics (level, sibling spread, within-series sd, lag-1
# autocorrelation), trimmed where the old spread would not fit the gauge.
# A noise sd written as 'r0.03' is relative (coefficient of variation).
BASE = {
    # preliminary treatment
    ('preliminary', 'screenings_removal_rate_ft3_mg'): (5.4, 0.3, 'r0.10', 0.89),
    ('preliminary', 'grit_removal_efficiency_pct'): (91.5, 0.9, 0.9, 0.88),
    ('preliminary', 'influent_flow_variability'): (11.5, 1.4, 1.7, 0.90),
    ('preliminary', 'odor_index'): (19.4, 2.0, 3.8, 0.92),
    ('bar_screen', 'differential_pressure_psi'): (1.2, 0.35, 'r0.06', 0.85),
    ('bar_screen', 'rake_motor_torque_pct'): (31.0, 5.5, 1.4, 0.78),
    ('bar_screen', 'cleaning_cycles_per_hr'): (3.2, 0.5, 'r0.08', 0.90),
    ('grit_chamber', 'differential_pressure_psi'): (0.9, 0.2, 'r0.07', 0.87),
    ('grit_chamber', 'rake_motor_torque_pct'): (36.7, 7.0, 2.0, 0.85),
    ('grit_chamber', 'cleaning_cycles_per_hr'): (2.9, 0.6, 'r0.12', 0.83),
    ('influent_pump', 'vibration_mms'): (2.4, 0.5, 0.14, 0.84),
    ('influent_pump', 'bearing_temp_c'): (59.0, 3.5, 1.3, 0.84),
    ('influent_pump', 'process_motor_current_a'): (21.6, 3.5, 'r0.05', 0.88),
    ('influent_pump', 'discharge_pressure_psi'): (39.5, 2.2, 'r0.035', 0.84),
    ('influent_pump', 'flow_rate_gpm'): (294.0, 40.0, 'r0.045', 0.90),
    # primary clarification
    ('primary_clarifier', 'primary_tss_removal_pct'): (58.0, 2.0, 2.2, 0.88),
    ('primary_clarifier', 'primary_bod_removal_pct'): (32.0, 1.2, 2.2, 0.87),
    ('primary_clarifier', 'sludge_blanket_level_pct'): (30.0, 2.2, 4.8, 0.92),
    ('primary_clarifier', 'scum_removal_rate'): (93.5, 1.1, 1.6, 0.87),
    ('primary_clarifier', 'surge_control_index'): (12.3, 2.0, 2.7, 0.91),
    ('primary_clarifier_basin', 'level_pct'): (87.0, 2.5, 2.6, 0.90),
    ('primary_clarifier_basin', 'residence_time_min'): (131.5, 3.5, 'r0.045', 0.91),
    ('sludge_collector', 'motor_current_a'): (4.3, 0.9, 'r0.05', 0.88),
    ('sludge_collector', 'travel_speed_pct'): (46.0, 8.0, 'r0.055', 0.88),
    ('sludge_collector', 'cycle_time_min'): (18.0, 2.4, 'r0.05', 0.86),
    ('scum_skimmer', 'motor_current_a'): (5.1, 0.9, 'r0.065', 0.82),
    ('scum_skimmer', 'travel_speed_pct'): (50.0, 8.0, 'r0.065', 0.91),
    ('scum_skimmer', 'cycle_time_min'): (17.3, 3.0, 'r0.05', 0.89),
    # aeration
    ('aeration', 'dissolved_oxygen_mg_l'): (2.1, 0.15, 0.18, 0.93),
    ('aeration', 'mlss_mg_l'): (2800.0, 70.0, 'r0.042', 0.93),
    ('aeration', 'blower_air_flow_scfm'): (4200.0, 40.0, 'r0.008', 0.87),
    ('aeration', 'food_to_microorganism_ratio'): (0.286, 0.006, 'r0.03', 0.88),
    ('aeration', 'sludge_age_days'): (9.6, 0.25, 0.45, 0.86),
    ('aeration_basin', 'level_pct'): (92.0, 1.5, 2.0, 0.85),
    ('aeration_basin', 'residence_time_min'): (359.0, 18.0, 'r0.04', 0.91),
    ('blower', 'air_flow_scfm'): (2040.0, 280.0, 'r0.01', 0.89),
    ('blower', 'blower_discharge_pressure_psi'): (6.7, 0.7, 'r0.018', 0.87),
    ('blower', 'discharge_temp_c'): (76.0, 5.5, 2.3, 0.89),
    ('blower', 'vibration_mms'): (1.9, 0.3, 0.13, 0.87),
    ('diffuser_grid', 'backpressure_psi'): (1.39, 0.22, 'r0.05', 0.89),
    ('diffuser_grid', 'air_distribution_uniformity_pct'): (92.0, 1.5, 1.2, 0.89),
    # secondary clarification
    ('secondary_clarifier', 'secondary_tss_removal_pct'): (88.5, 1.0, 1.9, 0.92),
    ('secondary_clarifier', 'sludge_settleability_svi'): (112.0, 9.0, 6.0, 0.92),
    ('secondary_clarifier', 'ras_rate_pct'): (45.5, 0.8, 3.0, 0.90),
    ('secondary_clarifier', 'clarifier_torque_pct'): (54.4, 3.0, 3.4, 0.88),
    ('secondary_clarifier_basin', 'level_pct'): (85.0, 3.5, 2.3, 0.88),
    ('secondary_clarifier_basin', 'residence_time_min'): (126.0, 7.0, 'r0.04', 0.82),
    ('ras_pump', 'vibration_mms'): (2.35, 0.35, 0.28, 0.91),
    ('ras_pump', 'bearing_temp_c'): (50.5, 3.2, 1.2, 0.88),
    ('ras_pump', 'process_motor_current_a'): (25.3, 4.5, 'r0.04', 0.90),
    ('ras_pump', 'discharge_pressure_psi'): (36.5, 3.5, 'r0.035', 0.87),
    ('ras_pump', 'flow_rate_gpm'): (314.0, 38.0, 'r0.025', 0.89),
    # disinfection
    ('disinfection', 'chlorine_residual_mg_l'): (0.62, 0.025, 0.028, 0.85),
    ('disinfection', 'ct_value_actual'): (None, None, 'r0.006', 0.85),   # = CT_K × residual × contact time
    ('disinfection', 'effluent_fecal_coliform_risk'): (9.9, 0.6, 'r0.07', 0.89),
    ('disinfection', 'dechlorination_residual_mg_l'): (0.047, 0.006, 0.011, 0.86),
    ('chlorine_contact_basin', 'level_pct'): (91.0, 1.5, 2.0, 0.85),
    ('chlorine_contact_basin', 'residence_time_min'): (37.8, 1.2, 'r0.025', 0.89),
    ('chlorine_feed_pump', 'vibration_mms'): (2.0, 0.35, 0.12, 0.82),
    ('chlorine_feed_pump', 'bearing_temp_c'): (51.3, 2.7, 1.0, 0.87),
    ('chlorine_feed_pump', 'motor_current_a'): (3.9, 0.45, 'r0.07', 0.88),
    ('chlorine_feed_pump', 'discharge_pressure_psi'): (15.4, 2.6, 'r0.05', 0.89),
    ('chlorine_feed_pump', 'dosing_flow_rate_gpm'): (2.38, 0.45, 'r0.06', 0.87),
    ('dechlorination_system', 'dosing_flow_rate_gpm'): (2.9, 0.5, 'r0.03', 0.88),
    ('dechlorination_system', 'motor_current_a'): (4.27, 0.6, 'r0.05', 0.85),
    ('dechlorination_system', 'residual_offset_mg_l'): (0.0, 0.02, 0.004, 0.85),   # bias of the analyser vs stage residual
}

# Plant-wide influent diurnal curve (× average flow): late-morning peak.
DIURNAL = [('08:00', 0.982), ('09:00', 0.993), ('10:00', 1.011), ('10:45', 1.018), ('11:30', 1.011),
           ('12:30', 0.999), ('13:30', 0.99), ('14:05', 0.988)]
FLOW_DRIFT_CV = 0.008            # per-train AR(1) drift of the influent flow factor
FLOW_BIAS_SD = 0.01              # per-train share of the plant flow
LOAD_DRIFT_CV = 0.02             # organic load wanders a little independently of flow
AIR_DRIFT_CV = 0.015
AIR_LOAD_EXP = 0.4               # blower air demand ∝ load^0.4 at constant DO
CT_K = 2.84                      # CT (mg·min/L, scaled) = CT_K × chlorine residual × contact time
DECHLOR_TARGET = 0.012           # dechlorinated effluent residual target, mg/L
BASIN_VOLUME = {'PRIMARY_CLARIFIER_PRIMARYCLARIFIERBASIN': 7.0, 'AERATION_AERATIONBASIN': 18.0,
                'SECONDARY_CLARIFIER_SECONDARYCLARIFIERBASIN': 7.5, 'DISINFECTION_CHLORINECONTACTBASIN': 1.2}
THROUGHPUT_NOMINAL = 5.66        # MGD per train at Q = 1; design (target) 5.8
TARGET_RATE = 5.8
AVAIL_BASE, QUALITY_BASE, PERF_BASE, HEALTH_BASE, SLUDGE_DRAW_PCT = 98.78, 98.73, 97.7, 95.4, 1.22

# Train KPI penalties (spec §3.5 formula derivations): for each watched signal,
# dev = (bad-direction distance from its setpoint) / tolerance, pen = max(0, dev − 1);
# each KPI subtracts weight × pen. Tolerances sit above normal noise so healthy
# trains lose nothing. (suffix, key, direction, tolerance (abs, or 'rX' relative),
#  health, quality, availability, performance weights)
CONDITION_TERMS = [
    ('AERATION', 'dissolved_oxygen_mg_l', -1, 0.6, 0.50, 0.30, 0.0, 0.20),
    ('AERATION_BLOWER', 'air_flow_scfm', -1, 'r0.10', 0.35, 0.0, 0.15, 0.10),
    ('AERATION', 'food_to_microorganism_ratio', +1, 0.04, 0.20, 0.60, 0.0, 0.20),
    ('PRIMARY_CLARIFIER_SLUDGECOLLECTOR', 'motor_current_a', -1, 'r0.5', 0.60, 0.0, 0.80, 0.0),
    ('PRIMARY_CLARIFIER', 'primary_tss_removal_pct', -1, 7.0, 0.20, 0.25, 0.0, 0.10),
    ('SECONDARY_CLARIFIER', 'sludge_settleability_svi', +1, 20.0, 0.25, 0.20, 0.0, 0.0),
    ('DISINFECTION', 'effluent_fecal_coliform_risk', +1, 3.5, 0.10, 0.30, 0.0, 0.0),
]
INSTABILITY = (0.12, 0.05, 4.4)  # instability = a·influent_flow_variability + b·surge_control_index + c

DERIVATIONS = [
    {'assetType': 'plant', 'property': 'plant_throughput', 'fn': 'sum', 'of': 'line_throughput', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_target_rate', 'fn': 'sum', 'of': 'line_target_rate', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_oee', 'fn': 'mean', 'of': 'line_oee', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_availability', 'fn': 'mean', 'of': 'line_availability', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_quality_factor', 'fn': 'mean', 'of': 'line_quality_factor', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_health_index', 'fn': 'mean', 'of': 'system_health_index', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'plant', 'property': 'plant_instability_index', 'fn': 'max', 'of': 'instability_index', 'fromType': 'train', 'scope': 'children'},
    {'assetType': 'train', 'property': 'line_oee', 'fn': 'formula',
     'note': 'line_availability × line_performance × line_quality_factor (legacy line model); line_performance '
             '(not stored) = 97.7 % treatment performance less process penalties, see generate.py'},
    {'assetType': 'train', 'property': 'line_availability', 'fn': 'formula',
     'note': '98.8 % less penalties for blower air shortfall and a stopped primary sludge collector (generate.py CONDITION_TERMS)'},
    {'assetType': 'train', 'property': 'line_quality_factor', 'fn': 'formula',
     'note': '98.7 % less penalties for low DO, high F:M, lost primary TSS removal, high SVI and high fecal coliform risk in the train'},
    {'assetType': 'train', 'property': 'system_health_index', 'fn': 'formula',
     'note': '95.4 % less condition penalties from the train\'s stages and equipment (generate.py CONDITION_TERMS)'},
    {'assetType': 'train', 'property': 'total_wip', 'fn': 'formula',
     'note': 'volume in process: Σ basin level_pct / 100 × nominal basin volume (primary 7.0, aeration 18.0, secondary 7.5, contact 1.2)'},
    {'assetType': 'train', 'property': 'instability_index', 'fn': 'formula',
     'note': '0.12 × preliminary influent_flow_variability + 0.05 × primary surge_control_index + 4.4'},
    {'assetType': 'train', 'property': 'flow_efficiency', 'fn': 'formula',
     'note': 'effluent / influent flow × 100 (the rest leaves as wasted primary and secondary sludge)'},
    {'assetType': 'train', 'property': 'line_throughput', 'fn': 'formula',
     'note': 'treated flow in MGD: 5.66 × the train\'s influent flow factor (the influent pump follows the same factor)'},
    {'assetType': 'disinfection', 'property': 'ct_value_actual', 'fn': 'formula',
     'note': '2.84 × chlorine_residual_mg_l × chlorine contact basin residence_time_min'},
    {'assetType': 'aeration', 'property': 'food_to_microorganism_ratio', 'fn': 'formula',
     'note': 'organic load ÷ (MLSS × aeration volume), scaled to 0.286 at design load and 2,800 mg/L MLSS'},
]


# ── Helpers ─────────────────────────────────────────────────────────────
def interp(points):
    """Piecewise-linear profile over the timeline from [('HH:MM', value), …]."""
    pts = sorted((minutes(t), v) for t, v in points)
    out = []
    for t in TS:
        m = minutes(t)
        if m <= pts[0][0]:
            out.append(pts[0][1]); continue
        if m >= pts[-1][0]:
            out.append(pts[-1][1]); continue
        for (m0, v0), (m1, v1) in zip(pts, pts[1:]):
            if m0 <= m <= m1:
                out.append(v0 + (v1 - v0) * (m - m0) / (m1 - m0) if m1 > m0 else v1)
                break
    return out


def ar1(sd, phi=0.88):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi), zero mean, stationary sd."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def lagged(xs, k=0.4):
    """First-order lag (a tank or a controller catching up)."""
    y, out = xs[0], []
    for x in xs:
        y += (x - y) * k
        out.append(y)
    return out


def in_window(t0, t1):
    return [minutes(t0) <= minutes(t) <= minutes(t1) for t in TS]


def clamp(xs, lo, hi):
    return [min(hi, max(lo, x)) for x in xs]


def rnd(x, d=3):
    return round(x + 0.0, d)


CLAMPED = []


def finalize(aid):
    """Keep every value inside its gauge range (spec §5.1) and round to 3 decimals."""
    for key, xs in series[aid].items():
        lo, hi = PROPS[key][4]
        if min(xs) < lo or max(xs) > hi:
            CLAMPED.append((aid, key))
        series[aid][key] = [rnd(x) for x in clamp(xs, lo, hi)]


# ── Build the asset tree and edges ──────────────────────────────────────
assets = []


def add(aid, parent, name, atype, level):
    assets.append({'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level})
    return aid


add(PLANT_ID, None, PLANT_NAME, 'plant', 'plant')
for t in TRAINS:
    tid = add(f'{PLANT_ID}_{t}', PLANT_ID, t, 'train', 'train')
    for code, name, stype, equipment in STAGES:
        sid = add(f'{tid}_{code}', tid, name, stype, 'stage')
        for ecode, ename, etype in equipment:
            add(f'{sid}_{ecode}', sid, ename, etype, 'equipment')
A = {a['id']: a for a in assets}
rels = [{'sourceAssetId': f'{PLANT_ID}_{t}_{s}', 'targetAssetId': f'{PLANT_ID}_{t}_{d}',
         'relationshipType': 'feeds_into', 'label': label, 'layer': layer}
        for t in TRAINS for s, d, label, layer in TRAIN_EDGES]

# ═════════════════════════════════════════════════════════════════════════
# Telemetry
# ═════════════════════════════════════════════════════════════════════════
series = {a['id']: {} for a in assets}
SETPOINT = {}        # (asset id, key) → baseline setpoint, used by the KPI penalty formulas


def setpoint(aid, key, pinned=None):
    """Per-asset setpoint: type mean + sibling spread (or a story's pinned value)."""
    mean, spread, _, _ = BASE[(A[aid]['assetType'], key)]
    sp = pinned if pinned is not None else mean + spread * max(-2.0, min(2.0, rng.gauss(0, 1)))
    SETPOINT[(aid, key)] = sp
    return sp


def noise(aid, key, sp):
    """AR(1) noise for (asset, key) with the type's sd and coefficient."""
    _, _, sd, phi = BASE[(A[aid]['assetType'], key)]
    if isinstance(sd, str):
        sd = float(sd[1:]) * abs(sp)
    return ar1(sd, phi)


def rel_noise(cv, phi=0.88):
    return [1 + e for e in ar1(cv, phi)]


def put(aid, key, xs):
    series[aid][key] = xs


def story_primary(sc, base):
    """The story's primary: anchors + small noise in its window, blending into `base` outside."""
    prof = interp(sc['anchors'])
    e = ar1(sc['noise'], 0.8)
    w0, w1 = IDX[sc['window'][0]], IDX[sc['window'][1]]
    out = []
    for i in range(N):
        d = (w0 - i) if i < w0 else (i - w1) if i > w1 else 0
        w = max(0.0, 1.0 - d / (BLEND_STEPS + 1.0))
        out.append(w * (prof[i] + e[i]) + (1 - w) * base[i])
    return out


STORY_BY_TRAIN = {sc['train']: (sid, sc) for sid, sc in SCENARIOS.items()}
diurnal = interp(DIURNAL)

for t in TRAINS:
    T = f'{PLANT_ID}_{t}'
    P = lambda suffix: f'{T}_{suffix}'
    story_id, sc = STORY_BY_TRAIN.get(t, (None, None))
    pin = lambda sid, suffix, key: (sc['setpoint'] if story_id == sid and sc['asset'] == suffix and sc['key'] == key
                                    else None)

    # ── Drivers ───────────────────────────────────────────────────────────
    bias = 1 + FLOW_BIAS_SD * rng.gauss(0, 1)
    Q = [d * bias * e for d, e in zip(diurnal, rel_noise(FLOW_DRIFT_CV, 0.9))]
    if story_id == 'WSIT12':                                   # slightly higher influent to T04
        Q = [q * f for q, f in zip(Q, interp(sc['flow_bump']))]
    L = [q * e for q, e in zip(Q, rel_noise(LOAD_DRIFT_CV, 0.9))]
    if story_id == 'WSIT11':                                   # organic load rise on T02 (from its F:M story)
        fm0, mlss0 = sc['setpoint'], sc['mlss_setpoint']
        L = [l * fm * m / (fm0 * mlss0) for l, fm, m in zip(L, interp(sc['fm_profile']), interp(sc['mlss_trend']))]
    restriction = interp(SCENARIOS['WSIT08']['air_factor']) if story_id == 'WSIT08' else [1.0] * N

    # ── Preliminary ───────────────────────────────────────────────────────
    s = P('PRELIMINARY')
    sp = setpoint(s, 'screenings_removal_rate_ft3_mg')
    screen = [sp * q * (1 + e / sp) for q, e in zip(Q, noise(s, 'screenings_removal_rate_ft3_mg', sp))]
    put(s, 'screenings_removal_rate_ft3_mg', screen)
    sp = setpoint(s, 'grit_removal_efficiency_pct')
    put(s, 'grit_removal_efficiency_pct', [sp - 20 * (q - 1) + e for q, e in zip(Q, noise(s, 'grit_removal_efficiency_pct', sp))])
    sp = setpoint(s, 'influent_flow_variability')
    ifv = [sp + e for e in noise(s, 'influent_flow_variability', sp)]
    put(s, 'influent_flow_variability', ifv)
    sp = setpoint(s, 'odor_index')
    put(s, 'odor_index', [sp + e for e in noise(s, 'odor_index', sp)])
    screen_ratio = [x / SETPOINT[(s, 'screenings_removal_rate_ft3_mg')] for x in screen]
    for eq, ratio in (('PRELIMINARY_BARSCREEN', screen_ratio), ('PRELIMINARY_GRITCHAMBER', Q)):
        a = P(eq)
        sp = setpoint(a, 'cleaning_cycles_per_hr')          # more material → more cleaning cycles
        cyc = [sp * r * (1 + e / sp) for r, e in zip(ratio, noise(a, 'cleaning_cycles_per_hr', sp))]
        sp_dp = setpoint(a, 'differential_pressure_psi')    # head loss rises with flow, eased by cleaning
        put(a, 'differential_pressure_psi', [sp_dp * (1 + 0.6 * (q - 1)) * (1 - 0.05 * (c / sp - 1)) + e
                                             for q, c, e in zip(Q, cyc, noise(a, 'differential_pressure_psi', sp_dp))])
        sp_tq = setpoint(a, 'rake_motor_torque_pct')
        put(a, 'rake_motor_torque_pct', [sp_tq * (1 + 0.3 * (r - 1)) + e
                                         for r, e in zip(ratio, noise(a, 'rake_motor_torque_pct', sp_tq))])
        put(a, 'cleaning_cycles_per_hr', cyc)
    a = P('PRELIMINARY_INFLUENTPUMP')
    for k in ('vibration_mms', 'bearing_temp_c'):
        sp = setpoint(a, k)
        put(a, k, [sp + e for e in noise(a, k, sp)])
    sp_f = setpoint(a, 'flow_rate_gpm')
    flow = [sp_f * q * (1 + e / sp_f) for q, e in zip(Q, noise(a, 'flow_rate_gpm', sp_f))]
    sp = setpoint(a, 'process_motor_current_a')
    put(a, 'process_motor_current_a', [sp * (f / sp_f) ** 0.8 + e for f, e in zip(flow, noise(a, 'process_motor_current_a', sp))])
    sp = setpoint(a, 'discharge_pressure_psi')
    put(a, 'discharge_pressure_psi', [sp * (0.8 + 0.2 * (f / sp_f) ** 2) + e for f, e in zip(flow, noise(a, 'discharge_pressure_psi', sp))])
    put(a, 'flow_rate_gpm', flow)

    # ── Primary clarifier ─────────────────────────────────────────────────
    s = P('PRIMARY_CLARIFIER')
    w10 = SCENARIOS['WSIT10']
    sp_tss = setpoint(s, 'primary_tss_removal_pct', pin('WSIT10', 'PRIMARY_CLARIFIER', 'primary_tss_removal_pct'))
    tss = [sp_tss - 25 * (q - 1) + e for q, e in zip(Q, noise(s, 'primary_tss_removal_pct', sp_tss))]
    if story_id == 'WSIT10':
        tss = story_primary(sc, tss)
    put(s, 'primary_tss_removal_pct', tss)
    sp = setpoint(s, 'primary_bod_removal_pct')            # BOD removal follows the solids capture
    put(s, 'primary_bod_removal_pct', [sp * (1 + 0.5 * (x / sp_tss - 1)) + e
                                       for x, e in zip(tss, noise(s, 'primary_bod_removal_pct', sp))])
    sp = setpoint(s, 'sludge_blanket_level_pct')
    blanket_add = interp(w10['blanket_rise']) if story_id == 'WSIT10' else [0.0] * N
    put(s, 'sludge_blanket_level_pct', [sp + b + e for b, e in zip(blanket_add, noise(s, 'sludge_blanket_level_pct', sp))])
    sp = setpoint(s, 'scum_removal_rate')
    put(s, 'scum_removal_rate', [sp + e for e in noise(s, 'scum_removal_rate', sp)])
    sp = setpoint(s, 'surge_control_index')
    sci = [sp + 30 * (q - 1) + e for q, e in zip(Q, noise(s, 'surge_control_index', sp))]
    put(s, 'surge_control_index', sci)
    lost_tss = [max(0.0, 1 - x / sp_tss) for x in tss]    # solids that now pass to aeration

    levels = {}

    def basin(suffix):
        b = P(suffix)
        sp = setpoint(b, 'level_pct')                       # weir head rises a little with flow
        lv = [sp + 8 * (q - 1) + e for q, e in zip(Q, noise(b, 'level_pct', sp))]
        put(b, 'level_pct', lv)
        sp = setpoint(b, 'residence_time_min')              # hydraulic residence time = volume / flow
        put(b, 'residence_time_min', [sp / q * (1 + e / sp) for q, e in zip(Q, noise(b, 'residence_time_min', sp))])
        levels[suffix] = lv

    def mechanism(suffix, run=None, speed_mult=None, current_mult=None):
        """Sludge collector / scum skimmer: drive current, travel speed, cycle time."""
        m = P(suffix)
        run = run or [1.0] * N
        speed_mult = speed_mult or [1.0] * N
        current_mult = current_mult or [1.0] * N
        sp_c = setpoint(m, 'motor_current_a')
        sp_v = setpoint(m, 'travel_speed_pct')
        sp_t = setpoint(m, 'cycle_time_min')
        ec, ev, et = noise(m, 'motor_current_a', sp_c), noise(m, 'travel_speed_pct', sp_v), noise(m, 'cycle_time_min', sp_t)
        cur = [r * (sp_c * cm + e) for r, cm, e in zip(run, current_mult, ec)]
        spd = [r * (sp_v * vm + e) for r, vm, e in zip(run, speed_mult, ev)]
        cyc, last = [], sp_t
        for r, v, e in zip(run, spd, et):                    # cycle time ∝ 1/speed; held while stopped
            if r > 0:
                last = sp_t * sp_v / v + e
            cyc.append(last)
        put(m, 'motor_current_a', cur)
        put(m, 'travel_speed_pct', spd)
        put(m, 'cycle_time_min', cyc)

    basin('PRIMARY_CLARIFIER_PRIMARYCLARIFIERBASIN')
    if story_id == 'WSIT10':
        stall = in_window(w10['stall'][0], TS[IDX[w10['stall'][1]] - 1])
        run = [0.0 if x else 1.0 for x in stall]
        c0, c1, cm = w10['catch_up']
        catch = in_window(c0, c1)
        speed_mult = [cm if x else 1.0 for x in catch]
        i_restart = IDX[c0]                                   # heavy blanket at restart: +25 %, easing off
        current_mult = [1.12 if tt == w10['stress'] else
                        1 + 0.25 * math.exp(-(i - i_restart) / 2.0) if x else 1.0
                        for i, (tt, x) in enumerate(zip(TS, catch))]
        mechanism('PRIMARY_CLARIFIER_SLUDGECOLLECTOR', run, speed_mult, current_mult)
    else:
        mechanism('PRIMARY_CLARIFIER_SLUDGECOLLECTOR')
    mechanism('PRIMARY_CLARIFIER_SCUMSKIMMER')

    # ── Aeration ──────────────────────────────────────────────────────────
    s = P('AERATION')
    if story_id == 'WSIT10':                                 # solids that escaped the primary load aeration
        L = [l * (1 + w10['solids_to_aeration'] * x) for l, x in zip(L, lagged(lost_tss, 0.35))]
    Aair = [(l ** AIR_LOAD_EXP) * e * r for l, e, r in zip(L, rel_noise(AIR_DRIFT_CV, 0.89), restriction)]
    sp_do = setpoint(s, 'dissolved_oxygen_mg_l', pin('WSIT08', 'AERATION', 'dissolved_oxygen_mg_l'))
    do = [sp_do - 0.6 * (l - 1) + e for l, e in zip(L, noise(s, 'dissolved_oxygen_mg_l', sp_do))]
    if story_id == 'WSIT08':
        do = story_primary(sc, do)
    put(s, 'dissolved_oxygen_mg_l', do)
    sp_m = setpoint(s, 'mlss_mg_l', SCENARIOS['WSIT11']['mlss_setpoint'] if story_id == 'WSIT11' else None)
    trend = [x / sp_m for x in interp(sc['mlss_trend'])] if story_id == 'WSIT11' else [1.0] * N
    mlss = [sp_m * tr + e for tr, e in zip(trend, noise(s, 'mlss_mg_l', sp_m))]
    put(s, 'mlss_mg_l', mlss)
    sp = setpoint(s, 'blower_air_flow_scfm')                 # header meter: same air factor as the blower
    put(s, 'blower_air_flow_scfm', [sp * x + e for x, e in zip(Aair, noise(s, 'blower_air_flow_scfm', sp))])
    sp_fm = setpoint(s, 'food_to_microorganism_ratio', pin('WSIT11', 'AERATION', 'food_to_microorganism_ratio'))
    fm = [sp_fm * l / (m / sp_m) + e for l, m, e in zip(L, mlss, noise(s, 'food_to_microorganism_ratio', sp_fm))]
    if story_id == 'WSIT11':
        fm = story_primary(sc, fm)
    put(s, 'food_to_microorganism_ratio', fm)
    sp = setpoint(s, 'sludge_age_days')
    put(s, 'sludge_age_days', [sp + e for e in noise(s, 'sludge_age_days', sp)])

    basin('AERATION_AERATIONBASIN')
    b = P('AERATION_BLOWER')
    foul = [1 - r for r in restriction]                       # 0 … 0.30 on T03 during WSIT08
    w08 = SCENARIOS['WSIT08']
    sp = setpoint(b, 'air_flow_scfm')
    put(b, 'air_flow_scfm', [sp * x + e for x, e in zip(Aair, noise(b, 'air_flow_scfm', sp))])
    sp = setpoint(b, 'blower_discharge_pressure_psi')        # system curve: static head + friction ∝ flow²
    put(b, 'blower_discharge_pressure_psi', [sp * (0.7 + 0.3 * x * x) + e
                                             for x, e in zip(Aair, noise(b, 'blower_discharge_pressure_psi', sp))])
    sp = setpoint(b, 'discharge_temp_c')                     # inlet restriction → higher pressure ratio → hotter
    put(b, 'discharge_temp_c', [sp + 12 * (x / r - 1) + w08['discharge_temp_rise_c'] * f / 0.3 + e
                                for x, r, f, e in zip(Aair, restriction, foul, noise(b, 'discharge_temp_c', sp))])
    sp = setpoint(b, 'vibration_mms')
    put(b, 'vibration_mms', [sp + w08['vibration_rise_mms'] * f / 0.3 + e for f, e in zip(foul, noise(b, 'vibration_mms', sp))])
    d = P('AERATION_DIFFUSERGRID')
    sp = setpoint(d, 'backpressure_psi')
    put(d, 'backpressure_psi', [sp * (0.45 + 0.55 * x * x) + e for x, e in zip(Aair, noise(d, 'backpressure_psi', sp))])
    sp = setpoint(d, 'air_distribution_uniformity_pct')      # too little air → uneven coverage
    put(d, 'air_distribution_uniformity_pct', [sp - 25 * max(0.0, 0.95 - x) + e
                                               for x, e in zip(Aair, noise(d, 'air_distribution_uniformity_pct', sp))])

    # ── Secondary clarifier ───────────────────────────────────────────────
    s = P('SECONDARY_CLARIFIER')
    sp_svi = setpoint(s, 'sludge_settleability_svi', pin('WSIT09', 'SECONDARY_CLARIFIER', 'sludge_settleability_svi'))
    svi = [sp_svi + e for e in noise(s, 'sludge_settleability_svi', sp_svi)]
    if story_id == 'WSIT09':
        svi = story_primary(sc, svi)
    sp = setpoint(s, 'secondary_tss_removal_pct')           # poorer settling / pin floc at low DO → carryover
    put(s, 'secondary_tss_removal_pct', [sp - 0.08 * (v - sp_svi) - 1.5 * max(0.0, 1.5 - o) + e
                                         for v, o, e in zip(svi, lagged(do, 0.3), noise(s, 'secondary_tss_removal_pct', sp))])
    put(s, 'sludge_settleability_svi', svi)
    sp_ras = setpoint(s, 'ras_rate_pct')
    ras = [sp_ras + e for e in noise(s, 'ras_rate_pct', sp_ras)]
    if story_id == 'WSIT11':                                 # manual RAS setpoint held, then raised at 12:05
        hold = in_window(TS[0], TS[IDX[sc['ras_hold_until']] - 1])
        held = ar1(0.25, 0.8)                                # a fixed manual setpoint: tight
        step = lagged([sc['ras_hold'] if h else sc['ras_after'] for h in hold], 0.6)
        ras = [sc['ras_hold'] + e_h if h else st + 0.5 * e     # new setpoint, loop back in auto
               for h, st, e, e_h in zip(hold, step, noise(s, 'ras_rate_pct', sp_ras), held)]
    put(s, 'ras_rate_pct', ras)
    sp = setpoint(s, 'clarifier_torque_pct')                 # rake torque follows the solids inventory
    put(s, 'clarifier_torque_pct', [sp * (1 + 0.5 * (m / sp_m - 1)) + e for m, e in zip(mlss, noise(s, 'clarifier_torque_pct', sp))])

    basin('SECONDARY_CLARIFIER_SECONDARYCLARIFIERBASIN')
    a = P('SECONDARY_CLARIFIER_RASPUMP')
    for k in ('vibration_mms', 'bearing_temp_c'):
        sp = setpoint(a, k)
        put(a, k, [sp + e for e in noise(a, k, sp)])
    sp_f = setpoint(a, 'flow_rate_gpm')                      # RAS flow = RAS rate × influent flow
    rflow = [sp_f * q * (r / sp_ras) * (1 + e / sp_f) for q, r, e in zip(Q, ras, noise(a, 'flow_rate_gpm', sp_f))]
    sp = setpoint(a, 'process_motor_current_a')
    put(a, 'process_motor_current_a', [sp * (f / sp_f) ** 0.8 + e for f, e in zip(rflow, noise(a, 'process_motor_current_a', sp))])
    sp = setpoint(a, 'discharge_pressure_psi')
    put(a, 'discharge_pressure_psi', [sp * (0.8 + 0.2 * (f / sp_f) ** 2) + e for f, e in zip(rflow, noise(a, 'discharge_pressure_psi', sp))])
    put(a, 'flow_rate_gpm', rflow)
    mechanism('SECONDARY_CLARIFIER_SLUDGECOLLECTOR')

    # ── Disinfection ──────────────────────────────────────────────────────
    s = P('DISINFECTION')
    basin('DISINFECTION_CHLORINECONTACTBASIN')
    contact = series[P('DISINFECTION_CHLORINECONTACTBASIN')]['residence_time_min']
    sp_cl = setpoint(s, 'chlorine_residual_mg_l')            # residual is under feedback control
    cl2 = [sp_cl + e for e in noise(s, 'chlorine_residual_mg_l', sp_cl)]
    put(s, 'chlorine_residual_mg_l', cl2)
    ct_sp = CT_K * sp_cl * SETPOINT[(P('DISINFECTION_CHLORINECONTACTBASIN'), 'residence_time_min')]
    SETPOINT[(s, 'ct_value_actual')] = ct_sp
    ct = [CT_K * c * r * e for c, r, e in zip(cl2, contact, rel_noise(0.006, 0.85))]
    put(s, 'ct_value_actual', ct)
    sp_fc = setpoint(s, 'effluent_fecal_coliform_risk', pin('WSIT12', 'DISINFECTION', 'effluent_fecal_coliform_risk'))
    fc = [sp_fc * (ct_sp / c) ** 2 * (1 + 0.0015 * (v - sp_svi)) + e     # less CT or more solids → more risk
          for c, v, e in zip(ct, svi, noise(s, 'effluent_fecal_coliform_risk', sp_fc))]
    if story_id == 'WSIT12':
        fc = story_primary(sc, fc)
    put(s, 'effluent_fecal_coliform_risk', fc)
    sp_dr = setpoint(s, 'dechlorination_residual_mg_l')
    dres = [max(0.005, sp_dr + 0.06 * (c - sp_cl) + e) for c, e in zip(cl2, noise(s, 'dechlorination_residual_mg_l', sp_dr))]
    put(s, 'dechlorination_residual_mg_l', dres)

    a = P('DISINFECTION_CHLORINEFEEDPUMP')
    for k in ('vibration_mms', 'bearing_temp_c'):
        sp = setpoint(a, k)
        put(a, k, [sp + e for e in noise(a, k, sp)])
    sp_d = setpoint(a, 'dosing_flow_rate_gpm')               # flow-paced dosing, trimmed by the residual loop
    dose = [sp_d * q * (sp_cl / c) ** 0.3 * (1 + e / sp_d) for q, c, e in zip(Q, cl2, noise(a, 'dosing_flow_rate_gpm', sp_d))]
    sp = setpoint(a, 'motor_current_a')
    put(a, 'motor_current_a', [sp * (x / sp_d) ** 0.6 + e for x, e in zip(dose, noise(a, 'motor_current_a', sp))])
    sp = setpoint(a, 'discharge_pressure_psi')
    put(a, 'discharge_pressure_psi', [sp * (0.85 + 0.15 * (x / sp_d) ** 2) + e for x, e in zip(dose, noise(a, 'discharge_pressure_psi', sp))])
    put(a, 'dosing_flow_rate_gpm', dose)
    a = P('DISINFECTION_DECHLORINATIONSYSTEM')
    sp_d = setpoint(a, 'dosing_flow_rate_gpm')               # bisulfite dose ∝ chlorine mass to remove
    dd = [sp_d * q * (c / sp_cl) * (1 + e / sp_d) for q, c, e in zip(Q, cl2, noise(a, 'dosing_flow_rate_gpm', sp_d))]
    put(a, 'dosing_flow_rate_gpm', dd)
    sp = setpoint(a, 'motor_current_a')
    put(a, 'motor_current_a', [sp * (x / sp_d) ** 0.6 + e for x, e in zip(dd, noise(a, 'motor_current_a', sp))])
    bias_off = setpoint(a, 'residual_offset_mg_l')           # analyser reading − target
    put(a, 'residual_offset_mg_l', [r - DECHLOR_TARGET + bias_off + e
                                     for r, e in zip(dres, noise(a, 'residual_offset_mg_l', 0.0))])

    for aid in [x['id'] for x in assets if x['id'].startswith(T + '_')]:
        finalize(aid)

    # ── Train KPIs (formulas over the train's children) ───────────────────
    tb = rng.gauss(0, 1)
    pen = {'health': [0.0] * N, 'quality': [0.0] * N, 'avail': [0.0] * N, 'perf': [0.0] * N}
    for suffix, key, sign, tol, wh, wq, wa, wp in CONDITION_TERMS:
        aid = P(suffix)
        sp = SETPOINT[(aid, key)]
        tol_abs = float(tol[1:]) * sp if isinstance(tol, str) else tol
        for i, x in enumerate(series[aid][key]):
            p = max(0.0, sign * (x - sp) / tol_abs - 1)
            pen['health'][i] += wh * p
            pen['quality'][i] += wq * p
            pen['avail'][i] += wa * p
            pen['perf'][i] += wp * p
    b_q, b_p, b_h = (rng.gauss(0, 1) for _ in range(3))    # per-train offsets (the "best and worst" train)
    avail = [AVAIL_BASE + 0.08 * tb + e - p for e, p in zip(ar1(0.03, 0.88), pen['avail'])]
    qual = [QUALITY_BASE + 0.07 * b_q + e - p for e, p in zip(ar1(0.04, 0.86), pen['quality'])]
    perf = [PERF_BASE + 0.2 * b_p + e - p for e, p in zip(ar1(0.1, 0.88), pen['perf'])]
    health = [HEALTH_BASE + 0.25 * b_h + e - p for e, p in zip(ar1(0.09, 0.86), pen['health'])]
    put(T, 'line_availability', avail)
    put(T, 'line_quality_factor', qual)
    put(T, 'line_oee', [a_ * p * q / 1e4 for a_, p, q in zip(avail, perf, qual)])
    put(T, 'system_health_index', health)
    put(T, 'total_wip', [sum(levels[k][i] / 100 * v for k, v in BASIN_VOLUME.items()) for i in range(N)])
    a_, b_, c_ = INSTABILITY
    put(T, 'instability_index', [a_ * x + b_ * y + c_ for x, y in zip(ifv, sci)])
    draw = SLUDGE_DRAW_PCT + 0.08 * rng.gauss(0, 1)
    put(T, 'flow_efficiency', [100 - draw - e for e in ar1(0.035, 0.89)])
    put(T, 'line_target_rate', [TARGET_RATE] * N)
    tp_bias = 1 + 0.004 * rng.gauss(0, 1)
    put(T, 'line_throughput', [THROUGHPUT_NOMINAL * q * tp_bias for q in Q])
    finalize(T)

# ── Plant rollups (the declared derivations, at every point) ─────────────
FNS = {'sum': sum, 'mean': lambda xs: sum(xs) / len(xs), 'max': max}
train_ids = [f'{PLANT_ID}_{t}' for t in TRAINS]
for dv in DERIVATIONS:
    if dv['assetType'] == 'plant':
        put(PLANT_ID, dv['property'], [FNS[dv['fn']]([series[x][dv['of']][i] for x in train_ids]) for i in range(N)])
finalize(PLANT_ID)

# Series and current values in the pack's key order; current value = last point (spec §5.3).
series = {a['id']: {k: series[a['id']][k] for k in TYPE_PROPS[a['assetType']]} for a in assets}
values = {aid: {k: xs[-1] for k, xs in props.items()} for aid, props in series.items()}


def S(aid, key):
    return series[aid][key]


# ═════════════════════════════════════════════════════════════════════════
# Attention items — narrative kept verbatim; evidence read back from the series
# ═════════════════════════════════════════════════════════════════════════
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


def fmt(x, key, d):
    """Evidence display at the story's own precision ('2.3 mg/L', '61%', '0.28')."""
    unit, s_ = PROPS[key][1], f'{x:.{d}f}'
    if unit == '%':
        return f'{s_}%'
    return f'{s_} {unit}' if unit else s_


def item(iid, severity, signal, interp_text, state, since_t, display_decimals, notes, detail, outcome):
    sc = SCENARIOS[iid]
    aid = f'{PLANT_ID}_{sc["train"]}_{sc["asset"]}'
    key = sc['key']
    ev, evp = [], []
    for t, note in notes:
        x = S(aid, key)[IDX[t]]
        ev.append(x)
        evp.append({'time': t, 'value': fmt(x, key, display_decimals), 'label': note})
    unit_id = unit_of(aid)
    mins = NOW_MIN - minutes(since_t)
    d = {k: detail[k] for k in ('signal', 'observed', 'derived', 'inferred', 'recommendation')}
    d.update({'evidence': ev, 'evidencePoints': evp})
    d.update({k: v for k, v in detail.items() if k not in d})
    d['outcomeStatus'] = outcome
    return {
        'id': iid, 'severity': severity, 'asset': label_of(aid), 'line': A[unit_id]['name'],
        'signal': signal, 'aiInterpretation': interp_text,
        'since': since_text(mins, outcome == 'resolved'), 'sinceMinutes': mins, 'attentionState': state,
        'detail': d, 'assetId': aid, 'unitId': unit_id, 'primaryProperty': key,
    }


attention = [
    item('WSIT08', 'high', 'Blower underperformance dropped dissolved oxygen, since corrected',
         'DO fell well below the nitrification-support range for over two hours before a blower fault was found and corrected.',
         'watch', '10:45', 1,
         [('08:20', 'Baseline'), ('08:55', ''), ('09:30', ''), ('10:05', ''), ('10:25', ''),
          ('10:45', 'Lowest — blower inspected'), ('11:05', 'Filter cleared'), ('11:25', 'Back to normal')],
         {'signal': "Dissolved oxygen in T03's aeration basin fell from 2.3 to 0.6 mg/L between 08:20 and 10:45, well below the level needed to reliably support nitrification.",
          'observed': 'DO declining steadily; blower air flow reading below its normal setpoint for the same period.',
          'derived': 'The DO decline tracks the air flow shortfall closely — this points at the blower itself, not an oxygen demand spike from the incoming flow.',
          'inferred': 'A partially fouled blower filter was restricting air flow — confirmed on inspection and cleared.',
          'recommendation': 'Clear the blower intake filter and confirm air flow recovers; monitor DO closely for the next two hours.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Blower intake filter was found fouled and cleared at 10:52, and DO recovered within 30 minutes.',
          'whatChanged': [{'time': '10:48', 'source': 'Maintenance', 'description': 'Blower inspection started.', 'related': True},
                          {'time': '10:52', 'source': 'Maintenance', 'description': 'Intake filter cleared; air flow restored.', 'related': True}],
          'confidence': 'Confirmed by inspection', 'confidenceLevel': 'high',
          'risk': 'High while active — sustained low DO risks incomplete nitrification', 'riskLevel': 'high',
          'expectedOutcome': 'Dissolved oxygen returned to the normal operating range'},
         'resolved'),
    item('WSIT09', 'medium', 'Sludge settleability worsening — SVI trending up',
         'Sludge volume index has been climbing since early shift, a classic early sign of bulking that raises TSS carryover risk if left unaddressed.',
         'investigate', '09:00', 0,
         [('09:00', 'Baseline'), ('09:50', ''), ('10:35', ''), ('11:25', ''), ('12:10', ''), ('13:00', ''),
          ('13:30', ''), ('14:05', 'Current')],
         {'signal': "Sludge volume index (SVI) on T01's secondary clarifier has risen from 95 to 142 mL/g since 09:00, while clarifier torque and RAS rate have both stayed within normal range.",
          'observed': 'SVI climbing steadily; no corresponding change in RAS rate or clarifier mechanical load.',
          'derived': 'A rising SVI without a RAS or loading change points at the biology itself — a shift in the microbial population, not an equipment or flow issue.',
          'inferred': 'Early-stage filamentous bulking is the leading theory, consistent with the gradual, biology-driven pattern — not yet confirmed by a microscopic exam.',
          'recommendation': 'Pull a mixed liquor sample for microscopic exam; consider a small RAS rate increase if SVI continues climbing past 150.',
          'relatedOccurrences': [{'date': 'Confluence · T02 · Aeration — RAS Rate Drift',
                                  'summary': 'Same plant, adjacent process — worth checking whether the two are related.'}],
          'whatChangedSummary': 'No triggering event identified — the SVI rise has been gradual and biology-driven all shift.',
          'whatChanged': [],
          'confidence': 'Likely, pending microscopic exam', 'confidenceLevel': 'medium',
          'risk': 'Medium — real risk of TSS carryover if bulking progresses further', 'riskLevel': 'medium',
          'expectedOutcome': 'Still active as of the latest reading'},
         'none'),
    item('WSIT10', 'high', 'Clarifier mechanism fault during a peak flow period, cleared',
         'The rake mechanism stalled during a peak flow window, briefly risking a TSS exceedance before being restarted.',
         'watch', '12:05', 0,
         [('10:15', 'Baseline'), ('10:20', 'Mechanism stalled'), ('10:25', ''), ('10:30', ''),
          ('10:35', 'Lowest — restarted'), ('10:40', 'Recovering'), ('10:45', ''), ('10:55', 'Back to baseline')],
         {'signal': "T05's primary clarifier rake mechanism stalled at 10:20, during the morning peak flow period, with TSS removal falling from 61% to 38% before the mechanism was restarted at 10:33.",
          'observed': 'Rake mechanism torque dropped to zero; TSS removal efficiency declined within minutes.',
          'derived': 'The timing lines up exactly with known peak-flow mechanism stress — a common trigger for this specific failure mode in primary clarifiers.',
          'inferred': 'Mechanical overload during peak flow — confirmed by inspection, restarted without further damage.',
          'recommendation': 'Log for the peak-flow maintenance review; inspect drive chain tension before the next peak flow period.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'The rake mechanism was manually restarted at 10:33 after a brief inspection found no damage.',
          'whatChanged': [{'time': '10:20', 'source': 'Alarm', 'description': 'Rake mechanism torque loss detected.', 'related': True},
                          {'time': '10:33', 'source': 'Operator Action', 'description': 'Mechanism restarted after inspection.', 'related': True}],
          'confidence': 'Confirmed by inspection', 'confidenceLevel': 'high',
          'risk': 'High while active — real TSS permit exceedance risk during peak flow', 'riskLevel': 'high',
          'expectedOutcome': 'TSS removal returned to baseline'},
         'resolved'),
    item('WSIT11', 'medium', 'RAS rate drifted out of balance with F:M ratio, corrected',
         'Return activated sludge rate ran below the level the current food-to-microorganism ratio called for, since corrected.',
         'watch', '12:10', 2,
         [('10:30', 'Baseline'), ('11:00', ''), ('11:30', ''), ('12:00', 'Near threshold'), ('12:05', 'RAS adjusted'),
          ('12:20', 'Recovering'), ('12:40', 'Back to target')],
         {'signal': 'RAS rate on T02 held near 38% from 10:30 while incoming BOD loading rose, pushing the F:M ratio above its normal 0.28 target toward 0.35 before RAS was adjusted at 12:05.',
          'observed': 'RAS rate flat while incoming load increased; F:M ratio climbed as a direct mathematical consequence.',
          'derived': 'RAS rate and incoming load are the only two inputs to F:M — the imbalance traces cleanly to RAS not being adjusted as load rose.',
          'inferred': 'RAS setpoint was not updated when incoming load shifted earlier in the shift — corrected manually.',
          'recommendation': 'Adjust RAS rate to track incoming load more responsively; review the auto-adjustment logic if available.',
          'relatedOccurrences': [{'date': 'Confluence · T01 · Secondary Clarifier — Sludge Bulking',
                                  'summary': 'Same plant, adjacent process — worth checking whether the two are related.'}],
          'whatChangedSummary': 'RAS rate was manually increased at 12:05 once the F:M drift was noticed.',
          'whatChanged': [{'time': '12:05', 'source': 'Operator Action', 'description': 'RAS rate increased to match current loading.', 'related': True}],
          'confidence': 'Confirmed — F:M responded immediately to the RAS change', 'confidenceLevel': 'high',
          'risk': 'Medium while active — sustained high F:M risks poor settling and effluent quality', 'riskLevel': 'medium',
          'expectedOutcome': 'F:M ratio returned to target range'},
         'resolved'),
    item('WSIT12', 'low', 'DMR deadline approaching with effluent quality borderline',
         "Today's discharge monitoring report is due soon, and fecal coliform risk has been running close to the reporting threshold for the past hour.",
         'act', '13:10', 0,
         [('13:10', 'Baseline'), ('13:25', ''), ('13:40', ''), ('13:55', ''), ('14:00', 'Highest, still under 20 threshold'),
          ('14:05', 'Current')],
         {'signal': "Effluent fecal coliform risk index on T04 has held between 12 and 15 (against a threshold of 20) since 13:10, and today's Discharge Monitoring Report is due to the state within 24 hours of shift end.",
          'observed': 'Fecal coliform risk elevated but within threshold; chlorine residual and CT both nominal.',
          'derived': 'The risk index has been stable, not worsening — this reads as a genuinely borderline period, not a developing failure.',
          'inferred': 'Likely tied to a slightly higher influent load this shift — nothing has been confirmed as a fault.',
          'recommendation': 'Confirm final effluent sample before end of shift and ensure the DMR is filed within the 24-hour window regardless of outcome.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'No fault identified — this is a monitoring and deadline-tracking item, not a corrective-action item.',
          'whatChanged': [],
          'confidence': 'Confirmed — within compliance, being tracked proactively', 'confidenceLevel': 'high',
          'risk': 'Low on water quality, but a missed DMR filing carries real regulatory consequences', 'riskLevel': 'low',
          'expectedOutcome': 'Final sample and DMR filing expected before deadline'},
         'none'),
]

# ── Unit status (spec §6.6): attention since the oldest open item; otherwise
# running since the unit's last resolved item (or the start of the shift).
unit_status = {}
for t in TRAINS:
    uid = f'{PLANT_ID}_{t}'
    mine = [a for a in attention if a['unitId'] == uid]
    open_ = [a['sinceMinutes'] for a in mine if a['detail']['outcomeStatus'] != 'resolved']
    done = [a['sinceMinutes'] for a in mine if a['detail']['outcomeStatus'] == 'resolved']
    unit_status[uid] = {'state': 'attention' if open_ else 'running',
                        'statusSinceMinutes': max(open_) if open_ else min(done) if done else NOW_MIN - START,
                        'mode': 'STEADY', 'product': 'Reclaimed Effluent'}


# ═════════════════════════════════════════════════════════════════════════
# Work items (spec §6.8) — kept verbatim
# ═════════════════════════════════════════════════════════════════════════
def work(wid, text, desc, aid, wtype, prio, slabel, role, start, due, dur, completed, created):
    iso = lambda t: f'{DATE}T{t}:00' if t else None
    return {'id': wid, 'text': text, 'description': desc, 'assetLabel': label_of(aid), 'workType': wtype,
            'priority': prio, 'sourceType': 'situation', 'sourceLabel': slabel, 'source': 'ai', 'assignedRole': role,
            'plannedStart': iso(start), 'dueAt': iso(due), 'estimatedDurationMinutes': dur,
            'done': completed is not None, 'completedAt': iso(completed), 'assetId': aid, 'createdAt': iso(created)}


work_items = [
    work('wk-w09', 'Blower intake filter inspection', 'Clear fouled filter restricting air flow', f'{PLANT_ID}_T03_AERATION',
         'MAINTENANCE', 'urgent', 'From: Blower Underperformance', 'Maintenance', '10:48', '11:00', 15, '10:52', '10:48'),
    work('wk-w10', 'Pull mixed liquor sample for SVI exam', 'Microscopic exam to check for filamentous bulking',
         f'{PLANT_ID}_T01_SECONDARY_CLARIFIER', 'QUALITY_CHECK', 'important', 'From: Sludge Bulking investigation', 'Quality',
         '14:00', '14:45', 25, None, '14:00'),
    work('wk-w11', 'Clarifier drive chain inspection', 'Check tension after peak-flow mechanism stall',
         f'{PLANT_ID}_T05_PRIMARY_CLARIFIER', 'MAINTENANCE', 'important', 'From: Clarifier Mechanism Fault', 'Maintenance',
         '10:33', '11:00', 20, '10:40', '10:33'),
    work('wk-w12', 'RAS rate review', 'Confirm RAS tracks current incoming load', f'{PLANT_ID}_T02_AERATION',
         'INSPECTION', 'routine', 'From: RAS Rate Drift investigation', 'Operator', '12:05', '12:25', 15, '12:08', '12:05'),
    work('wk-w13', 'Prepare DMR filing', 'Compile discharge monitoring report data for the day', f'{PLANT_ID}_T04_DISINFECTION',
         'DOCUMENTATION', 'urgent', 'From: DMR Deadline Approaching', 'Quality', '14:00', '15:30', 40, None, '14:00'),
]

# ── Write ───────────────────────────────────────────────────────────────
properties = {
    'properties': {k: {'label': p[0], 'unit': p[1], 'category': p[2], 'tier': p[3], 'range': p[4], 'decimals': p[5]}
                   for k, p in PROPS.items()},
    'derivations': DERIVATIONS,
    'typeLabels': TYPE_LABELS,
}
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

# Sanity checks: same keys per type, every value inside its gauge range.
for a in assets:
    assert set(values[a['id']]) == set(TYPE_PROPS[a['assetType']]), a['id']
for aid, props in series.items():
    for k, xs in props.items():
        lo, hi = PROPS[k][4]
        assert lo <= min(xs) and max(xs) <= hi, (aid, k)
print(f'Wrote {len(files)} files to {OUT}: {len(assets)} assets, {len(TRAINS)} trains, {len(rels)} edges, '
      f'{len(attention)} attention items, {len(work_items)} work items'
      + (f'; clamped to range: {CLAMPED}' if CLAMPED else ''))
