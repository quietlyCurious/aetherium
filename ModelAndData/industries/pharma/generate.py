#!/usr/bin/env python3
"""Solace Park — monoclonal antibody drug-substance plant — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/pharma/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/pharma/generate.py [OUTDIR]

The plant: a biologics drug-substance (DS) site making one fictional
monoclonal antibody, SLP-201, in 12,000 L stainless-steel fed-batch
bioreactors. The hierarchy is the ISA-88 physical model the industry
itself uses: site → area → process cell → unit → equipment module →
control module (6 levels). The unit of operation is the ISA-88 **unit**
(a bioreactor, a chromatography skid, the WFI system…): that is what a
batch recipe's unit procedures run on, so every unit gets a Now-strip tile.

What makes this pack different from wind / ccgt / pipeline: it is a
**batch** plant. At "now" the units sit in different phases of different
batches at once — PBR-1 is on day 13 of batch 26-114, PBR-2 on day 7 of
26-116, PBR-3 is in CIP/SIP turnaround for 26-117 whose N-1 seed is growing
in SBR-1, CAP-1 is running Protein A cycles on 26-113 while POL-1 polishes
26-112. Several scenarios are about GMP clocks rather than equipment:
validated hold times, a CPP leaving its normal operating range, and a seed
transfer window that the turnaround can no longer meet.

Everything the scenarios need lives in the SCENARIO constants below;
SCENARIOS.md describes the same numbers in prose. Evidence points in
attention-items.json are READ BACK from the generated series, so the story
and the data can't disagree.
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'pharma')
SEP = ' · '
UNIT_LEVEL = 'unit'

# ── Timeline (spec §4.2) — the default shared demo day. "Now" = 14:05. ──
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}
DT_H = STEP / 60.0


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


def i_of(t):
    return IDX[t]


NOW_MIN = END
HRS = [(minutes(t) - START) / 60.0 for t in TS]      # hours since 08:00

# ── Scenario constants (SCENARIOS.md describes each one) ─────────────────
AGIT_START = '09:20'             # PSIT01 — PBR-1 agitator gearbox bearing wear (05)
AGIT_VIB0, AGIT_VIB_NOW = 1.9, 4.5   # mm/s; alert 4.5, alarm 7.1
DOB_WINDOW = ('09:35', '10:40')  # PSIT02 — SBR-1 DO probe B intermittent (06)
DOB_SPIKES = {'09:35': -14, '09:45': 17, '09:50': -22, '10:00': -9, '10:10': 24, '10:15': -17,
              '10:25': -26, '10:35': 11}
DOB_FIXED = '10:45'              #   cable connector reseated at 10:40; first clean sample 10:45
CSG_LEVEL_HUNT = '10:10'         # PSIT03 — CSG-1 feed pump cavitation → level hunting (root cause)
CSG_DIP, CSG_FIXED = '10:20', '11:15'   #   header pressure sags 3.0 → ~1.6 barg; strainer cleaned 11:10
SIP1_START, SIP1_ABORT = '10:00', '10:45'   #   PBR-3 SIP #1: cold point never reaches 121.1 °C → aborted
SIP2_START, SIP2_HOLD, SIP2_END, SIP_DONE = '11:40', '12:10', '13:10', '13:25'
CAP_TRIP, CAP_RESTART = '09:55', '10:40'    # PSIT04 — CAP-1 guard filter DP high-high stops the skid (11)
CAP_CYCLES = ['08:00', '09:10', '11:05', '12:15', '13:25']   # cycle start times (C2 halted 45 min)
BREAKTHROUGH = [1.10, 1.95, 3.20, 4.60, 6.10]   # PSIT05 — flow-through breakthrough at end of each load (08)
STEP_YIELD = [95.3, 94.4, 93.0, 91.4]            #   step yield per completed cycle
YIELD_PREV = 95.8                                #   last cycle of batch 26-112 (before 08:00)
RESIN_CYCLES_0 = 186                             #   validated resin lifetime: 200 cycles
AHU_TRIP, FANB_START, AHU_OK, POL_RESUME = '12:10', '12:22', '12:25', '12:50'   # PSIT06 — cascade (09)
OVERLAY_CUT = '10:05'            # PSIT07 — PBR-2 overlay left at 30 slpm after exhaust filter swap (ground truth)
PCO2_START = '10:15'             #   pCO2 starts accumulating (04); NOR ≤ 120, PAR ≤ 160 mmHg
PCO2_0, PCO2_NOW = 92.0, 148.0
NOR_PCO2, PAR_PCO2 = 120.0, 160.0
STILL_VENT_FIX, STILL_OK = '12:40', '13:20'   # PSIT08 — WFI still vent valve half-closed since PM (03)
STILL_OUT0, STILL_OUT_LOW = 3050.0, 2700.0
FEED_STOPS = ['08:40', '09:05', '09:25', '09:50', '10:20', '10:45', '11:10', '11:30']   # PSIT09 (12)
FEED_REPAIR = ('11:45', '11:55')             #   pump tubing replaced
VIAB_FLAG = '10:00'              # PSIT10 — PBR-1 viability falling faster than forecast (13)
VIAB0, VIAB_NOW = 84.0, 78.3     #   harvest criterion: viability ≥ 70 %
SEED_VCD0 = 4.13                 # PSIT11 — SBR-1 seed growing toward its 6.0 ×10⁶ transfer limit (14)
SEED_DOUBLING_H = 20.0
TRANSFER_MAX = 6.0
TRANSFER_PLAN = '18:00'
PLAN_FLAGGED = '13:40'
# PBR-3 readiness after SIP (minutes): pressure hold 60, cool + media fill 180, QA equipment release 30,
# media equilibration (temperature, pH, DO) 120.
READY_STEPS = [('Post-SIP pressure hold test', 60), ('Cool down and fill 9,500 L medium', 180),
               ('QA equipment and media release', 30), ('Medium equilibration (37 °C, pH 7.0, DO 40 %)', 120)]

# ── Property metadata (spec §3.4): label, unit, category, tier, range, decimals
PROPS = {
    # site / area / process cell
    'active_culture_volume_l': ('Production Culture Volume', 'L', 'Cell Culture', 'P2', [0, 40000], 0),
    'batches_in_process_count': ('Batches in Process', '', 'Flow / WIP', 'P2', [0, 10], 0),
    'open_deviations_count': ('Open Deviations', '', 'Events / Losses', 'P1', [0, 12], 0),
    'area_product_mass_kg': ('Product in Bioreactors', 'kg', 'Flow / WIP', 'P1', [0, 200], 1),
    'area_o2_demand_slpm': ('Total O₂ Demand', 'slpm', 'Cell Culture', 'P3', [0, 800], 1),
    'units_in_service_count': ('Units in Service', '', 'Flow / WIP', 'P2', [0, 10], 0),
    'units_total_count': ('Units in Cell', '', 'Derived Metric', 'P3', [0, 10], 0),
    'dsp_load_flow_l_min': ('Purification Load Flow', 'L/min', 'Flow / WIP', 'P1', [0, 120], 1),
    'wfi_draw_l_h': ('WFI Draw', 'L/h', 'Flow / WIP', 'P1', [0, 10000], 0),
    'suite_min_dp_pa': ('Lowest Room Differential Pressure', 'Pa', 'Environmental', 'P1', [-10, 40], 1),
    # seed bioreactor
    'seed_volume_l': ('Working Volume', 'L', 'Flow / WIP', 'P3', [0, 2000], 0),
    'seed_vcd_e6_ml': ('Viable Cell Density', '×10⁶ cells/mL', 'Cell Culture', 'P1', [0, 10], 2),
    'seed_culture_day': ('Culture Day', 'd', 'Flow / WIP', 'P2', [0, 7], 2),
    'transfer_vcd_max_e6_ml': ('Transfer VCD Limit', '×10⁶ cells/mL', 'Derived Metric', 'P3', [0, 10], 1),
    # production bioreactor
    'working_volume_l': ('Working Volume', 'L', 'Flow / WIP', 'P2', [0, 14000], 0),
    'vcd_e6_ml': ('Viable Cell Density', '×10⁶ cells/mL', 'Cell Culture', 'P1', [0, 30], 2),
    'viability_pct': ('Viability', '%', 'Cell Culture', 'P1', [0, 100], 1),
    'titer_g_l': ('Titer', 'g/L', 'Cell Culture', 'P1', [0, 8], 2),
    'product_mass_kg': ('Product in Vessel', 'kg', 'Flow / WIP', 'P2', [0, 80], 1),
    'culture_day': ('Culture Day', 'd', 'Flow / WIP', 'P3', [0, 16], 2),
    'osmolality_mosm_kg': ('Osmolality', 'mOsm/kg', 'Quality', 'P2', [0, 500], 0),
    # bioreactor equipment modules
    'agitator_speed_rpm': ('Agitator Speed', 'rpm', 'Stability', 'P2', [0, 150], 1),
    'agitator_power_kw': ('Agitator Power', 'kW', 'Condition', 'P3', [0, 30], 2),
    'gearbox_vibration_mms': ('Gearbox Vibration', 'mm/s', 'Condition', 'P1', [0, 8], 2),
    'seal_temp_c': ('Mechanical Seal Temperature', '°C', 'Condition', 'P2', [20, 90], 1),
    'o2_flow_slpm': ('O₂ Sparge Flow', 'slpm', 'Cell Culture', 'P2', [0, 400], 1),
    'air_sparge_slpm': ('Air Sparge Flow', 'slpm', 'Stability', 'P3', [0, 400], 1),
    'co2_flow_slpm': ('CO₂ Sparge Flow (pH)', 'slpm', 'Stability', 'P3', [0, 50], 1),
    'overlay_air_slpm': ('Headspace Overlay Air', 'slpm', 'Stability', 'P2', [0, 200], 0),
    'do_pct': ('Dissolved Oxygen', '%', 'Stability', 'P1', [0, 100], 1),
    'probe_quality_index': ('Probe Signal Quality', '', 'Condition', 'P3', [0, 100], 0),
    'pco2_mmhg': ('Dissolved CO₂ (pCO₂)', 'mmHg', 'Quality', 'P1', [0, 200], 1),
    'culture_ph': ('Culture pH', '', 'Stability', 'P1', [6.0, 8.0], 3),
    'base_added_l': ('Base Added (batch)', 'L', 'Flow / WIP', 'P3', [0, 400], 1),
    'base_pump_rate_ml_min': ('Base Pump Rate', 'mL/min', 'Stability', 'P2', [0, 200], 1),
    'base_tank_level_pct': ('Base Tank Level', '%', 'Flow / WIP', 'P3', [0, 100], 1),
    'culture_temp_c': ('Vessel Temperature', '°C', 'Stability', 'P1', [0, 140], 2),
    'jacket_inlet_temp_c': ('Jacket Inlet Temperature', '°C', 'Condition', 'P3', [0, 140], 1),
    'drain_temp_c': ('Drain (Cold Point) Temperature', '°C', 'Quality', 'P2', [0, 140], 1),
    'feed_added_l': ('Feed Added (batch)', 'L', 'Flow / WIP', 'P2', [0, 3000], 0),
    'glucose_g_l': ('Glucose', 'g/L', 'Cell Culture', 'P1', [0, 10], 2),
    'feed_pump_rate_l_h': ('Feed Pump Rate', 'L/h', 'Flow / WIP', 'P1', [0, 60], 1),
    'feed_interruptions_1h': ('Feed Interruptions (last hour)', '', 'Events / Losses', 'P2', [0, 10], 0),
    'exhaust_filter_dp_mbar': ('Exhaust Filter DP', 'mbar', 'Condition', 'P2', [0, 60], 1),
    'vessel_pressure_barg': ('Vessel Pressure', 'bar(g)', 'Stability', 'P2', [0, 1.5], 3),
    'exhaust_co2_pct': ('Off-gas CO₂', '%', 'Cell Culture', 'P3', [0, 15], 2),
    # harvest
    'harvest_flow_l_h': ('Harvest Flow', 'L/h', 'Flow / WIP', 'P1', [0, 6000], 0),
    'clarified_volume_l': ('Clarified Volume', 'L', 'Flow / WIP', 'P2', [0, 14000], 0),
    'bowl_speed_rpm': ('Bowl Speed', 'rpm', 'Stability', 'P2', [0, 8000], 0),
    'centrate_turbidity_ntu': ('Centrate Turbidity', 'NTU', 'Quality', 'P1', [0, 200], 1),
    'filter_dp_bar': ('Filter Differential Pressure', 'bar', 'Condition', 'P1', [0, 3], 2),
    'hold_tank_level_pct': ('Hold Tank Level', '%', 'Flow / WIP', 'P2', [0, 100], 1),
    'hold_tank_temp_c': ('Hold Tank Temperature', '°C', 'Quality', 'P2', [0, 40], 1),
    # chromatography / purification
    'skid_flow_l_min': ('Skid Flow', 'L/min', 'Flow / WIP', 'P1', [0, 60], 1),
    'cycle_number': ('Cycle', '', 'Flow / WIP', 'P2', [0, 8], 0),
    'step_yield_pct': ('Step Yield (last cycle)', '%', 'Quality', 'P1', [70, 100], 1),
    'load_processed_l': ('Load Processed This Batch', 'L', 'Flow / WIP', 'P3', [0, 14000], 0),
    'column_dp_bar': ('Column Pressure Drop', 'bar', 'Condition', 'P1', [0, 4], 2),
    'breakthrough_pct': ('Flow-through Breakthrough', '%', 'Events / Losses', 'P1', [0, 10], 2),
    'resin_cycles': ('Resin Cycles Used', '', 'Condition', 'P3', [0, 250], 0),
    'uv280_au': ('UV 280 nm', 'AU', 'Quality', 'P2', [0, 3], 3),
    'conductivity_ms_cm': ('Conductivity', 'mS/cm', 'Quality', 'P2', [0, 120], 2),
    'effluent_ph': ('Effluent pH', '', 'Quality', 'P3', [0, 14], 2),
    'vi_pool_volume_l': ('Eluate Pool Volume', 'L', 'Flow / WIP', 'P1', [0, 3000], 0),
    'vi_pool_ph': ('Pool pH', '', 'Quality', 'P1', [2, 9], 2),
    'vi_tank_level_pct': ('Tank Level', '%', 'Flow / WIP', 'P2', [0, 100], 1),
    'vi_tank_temp_c': ('Pool Temperature', '°C', 'Quality', 'P3', [0, 40], 1),
    'acid_added_l': ('Acid Added (batch)', 'L', 'Flow / WIP', 'P3', [0, 30], 2),
    'adsorber_loading_g_ml': ('Adsorber Loading', 'g/mL', 'Flow / WIP', 'P2', [0, 10], 2),
    'vf_flux_lmh': ('Flux', 'LMH', 'Flow / WIP', 'P1', [0, 150], 1),
    'vf_throughput_l_m2': ('Throughput', 'L/m²', 'Flow / WIP', 'P2', [0, 600], 0),
    'vf_pressure_bar': ('Feed Pressure', 'bar', 'Stability', 'P1', [0, 4], 2),
    'tmp_bar': ('Transmembrane Pressure', 'bar', 'Stability', 'P2', [0, 3], 2),
    'permeate_flux_lmh': ('Permeate Flux', 'LMH', 'Flow / WIP', 'P1', [0, 100], 1),
    'retentate_conc_g_l': ('Retentate Concentration', 'g/L', 'Quality', 'P2', [0, 150], 1),
    'membrane_nwp_lmh_bar': ('Normalized Water Permeability', 'LMH/bar', 'Condition', 'P2', [0, 80], 1),
    'ret_tank_level_pct': ('Retentate Tank Level', '%', 'Flow / WIP', 'P2', [0, 100], 1),
    'bds_inventory_kg': ('Frozen DS Inventory', 'kg', 'Flow / WIP', 'P2', [0, 200], 1),
    'bds_lots_stored': ('Lots in Storage', '', 'Flow / WIP', 'P3', [0, 10], 0),
    'freezer_temp_c': ('Freezer Temperature', '°C', 'Quality', 'P1', [-80, 0], 1),
    'freezer_compressor_duty_pct': ('Compressor Duty', '%', 'Condition', 'P3', [0, 100], 0),
    # clean utilities
    'wfi_available_l': ('WFI Available', 'L', 'Flow / WIP', 'P2', [0, 30000], 0),
    'still_output_l_h': ('Distillate Output', 'L/h', 'Flow / WIP', 'P1', [0, 4000], 0),
    'still_steam_kg_h': ('Plant Steam Consumption', 'kg/h', 'Condition', 'P2', [0, 1500], 0),
    'wfi_tank_level_pct': ('Tank Level', '%', 'Flow / WIP', 'P2', [0, 100], 1),
    'wfi_tank_temp_c': ('Tank Temperature', '°C', 'Quality', 'P3', [60, 100], 1),
    'loop_return_temp_c': ('Loop Return Temperature', '°C', 'Quality', 'P1', [60, 95], 1),
    'loop_conductivity_us_cm': ('Conductivity', 'µS/cm', 'Quality', 'P1', [0, 2], 3),
    'loop_toc_ppb': ('TOC', 'ppb', 'Quality', 'P2', [0, 600], 0),
    'loop_velocity_m_s': ('Return Velocity', 'm/s', 'Stability', 'P3', [0, 3], 2),
    'cs_header_pressure_barg': ('Clean Steam Header Pressure', 'bar(g)', 'Stability', 'P1', [0, 5], 2),
    'cs_flow_kg_h': ('Clean Steam Flow', 'kg/h', 'Flow / WIP', 'P2', [0, 1500], 0),
    'cs_generator_level_pct': ('Generator Level', '%', 'Stability', 'P3', [0, 100], 1),
    'cip_step_code': ('CIP Step', '', 'Flow / WIP', 'P2', [0, 6], 0),
    'cip_supply_temp_c': ('Supply Temperature', '°C', 'Quality', 'P2', [0, 95], 1),
    'cip_supply_flow_l_min': ('Supply Flow', 'L/min', 'Flow / WIP', 'P2', [0, 600], 0),
    'cip_return_conductivity_ms_cm': ('Return Conductivity', 'mS/cm', 'Quality', 'P1', [0, 80], 3),
    'supply_airflow_m3_h': ('Supply Airflow', 'm³/h', 'Environmental', 'P1', [0, 25000], 0),
    'supply_air_temp_c': ('Supply Air Temperature', '°C', 'Environmental', 'P3', [10, 25], 1),
    'fan_speed_pct': ('Fan Speed', '%', 'Stability', 'P1', [0, 100], 1),
    'fan_motor_current_a': ('Motor Current', 'A', 'Condition', 'P2', [0, 60], 1),
    'hepa_dp_pa': ('HEPA Bank DP', 'Pa', 'Condition', 'P2', [0, 500], 0),
    'room_temp_c': ('Room Temperature', '°C', 'Environmental', 'P3', [15, 30], 1),
    'room_dp_pa': ('Room Differential Pressure', 'Pa', 'Environmental', 'P1', [-10, 40], 1),
    'media_tank_level_pct': ('Tank Level', '%', 'Flow / WIP', 'P1', [0, 100], 1),
    'media_temp_c': ('Media Temperature', '°C', 'Quality', 'P3', [0, 40], 1),
    'buffer_tank_level_pct': ('Tank Level', '%', 'Flow / WIP', 'P1', [0, 100], 1),
    'buffer_ph': ('Buffer pH', '', 'Quality', 'P2', [0, 14], 2),
}
STATIC = {'units_total_count', 'transfer_vcd_max_e6_ml'}

TYPE_PROPS = {
    'biologics_site': ['active_culture_volume_l', 'batches_in_process_count', 'open_deviations_count'],
    'upstream_area': ['area_product_mass_kg', 'area_o2_demand_slpm', 'units_in_service_count'],
    'downstream_area': ['dsp_load_flow_l_min', 'units_in_service_count'],
    'utilities_area': ['wfi_draw_l_h', 'suite_min_dp_pa', 'units_in_service_count'],
    'process_cell': ['units_in_service_count', 'units_total_count'],
    # units
    'seed_bioreactor': ['seed_vcd_e6_ml', 'viability_pct', 'seed_culture_day', 'seed_volume_l', 'transfer_vcd_max_e6_ml'],
    'production_bioreactor': ['vcd_e6_ml', 'viability_pct', 'titer_g_l', 'product_mass_kg', 'working_volume_l',
                              'culture_day', 'osmolality_mosm_kg'],
    'harvest_train': ['harvest_flow_l_h', 'clarified_volume_l'],
    'capture_skid': ['skid_flow_l_min', 'cycle_number', 'step_yield_pct', 'load_processed_l'],
    'viral_inactivation_unit': ['vi_pool_volume_l', 'vi_pool_ph'],
    'polish_skid': ['skid_flow_l_min', 'step_yield_pct', 'load_processed_l'],
    'virus_filtration_unit': ['vf_flux_lmh', 'vf_throughput_l_m2'],
    'ufdf_skid': ['tmp_bar', 'permeate_flux_lmh', 'retentate_conc_g_l'],
    'bds_unit': ['bds_inventory_kg', 'bds_lots_stored'],
    'wfi_system': ['wfi_draw_l_h', 'wfi_available_l'],
    'clean_steam_generator': ['cs_header_pressure_barg', 'cs_flow_kg_h', 'cs_generator_level_pct'],
    'cip_skid': ['cip_step_code', 'cip_supply_temp_c', 'cip_supply_flow_l_min', 'cip_return_conductivity_ms_cm'],
    'air_handling_unit': ['supply_airflow_m3_h', 'supply_air_temp_c'],
    'media_prep_unit': ['media_tank_level_pct', 'osmolality_mosm_kg', 'media_temp_c'],
    'buffer_prep_unit': ['buffer_tank_level_pct', 'conductivity_ms_cm', 'buffer_ph'],
    # equipment modules
    'agitation_module': ['agitator_speed_rpm', 'agitator_power_kw', 'gearbox_vibration_mms', 'seal_temp_c'],
    'gas_control_module': ['o2_flow_slpm', 'air_sparge_slpm', 'co2_flow_slpm', 'overlay_air_slpm'],
    'ph_control_module': ['culture_ph', 'base_added_l'],
    'temperature_control_module': ['culture_temp_c', 'jacket_inlet_temp_c', 'drain_temp_c'],
    'feed_module': ['glucose_g_l', 'feed_added_l'],
    'exhaust_module': ['exhaust_filter_dp_mbar', 'vessel_pressure_barg', 'exhaust_co2_pct'],
    'centrifuge_module': ['bowl_speed_rpm', 'centrate_turbidity_ntu'],
    'depth_filter_module': ['filter_dp_bar'],
    'harvest_hold_tank': ['hold_tank_level_pct', 'hold_tank_temp_c'],
    'guard_filter': ['filter_dp_bar'],
    'chrom_column': ['column_dp_bar', 'breakthrough_pct', 'resin_cycles'],
    'detector_block': ['uv280_au', 'conductivity_ms_cm', 'effluent_ph'],
    'vi_tank': ['vi_tank_level_pct', 'vi_tank_temp_c'],
    'titrant_dosing': ['acid_added_l'],
    'membrane_adsorber': ['filter_dp_bar', 'adsorber_loading_g_ml'],
    'prefilter': ['filter_dp_bar'],
    'virus_filter': ['vf_pressure_bar'],
    'tff_module': ['membrane_nwp_lmh_bar'],
    'retentate_tank': ['ret_tank_level_pct'],
    'final_filter': ['filter_dp_bar'],
    'bds_freezer': ['freezer_temp_c', 'freezer_compressor_duty_pct'],
    'multi_effect_still': ['still_output_l_h', 'still_steam_kg_h'],
    'wfi_tank': ['wfi_tank_level_pct', 'wfi_tank_temp_c'],
    'wfi_loop': ['loop_return_temp_c', 'loop_conductivity_us_cm', 'loop_toc_ppb', 'loop_velocity_m_s'],
    'ahu_fan': ['fan_speed_pct', 'fan_motor_current_a'],
    'hepa_bank': ['hepa_dp_pa'],
    'room_monitoring': ['suite_min_dp_pa', 'room_temp_c'],
    # control modules
    'do_probe': ['do_pct', 'probe_quality_index'],
    'pco2_probe': ['pco2_mmhg'],
    'base_pump': ['base_pump_rate_ml_min', 'base_tank_level_pct'],
    'feed_pump': ['feed_pump_rate_l_h', 'feed_interruptions_1h'],
    'room_dp_sensor': ['room_dp_pa'],
}
TYPE_LABELS = {
    'biologics_site': 'Biologics DS Site',
    'upstream_area': 'Upstream (Cell Culture) Area',
    'downstream_area': 'Downstream (Purification) Area',
    'utilities_area': 'Utilities & Support Area',
    'process_cell': 'Process Cell',
    'seed_bioreactor': 'Seed Bioreactor (N-1)',
    'production_bioreactor': 'Production Bioreactor (12,000 L)',
    'capture_skid': 'Protein A Capture Skid',
    'polish_skid': 'Polishing Chromatography Skid',
    'viral_inactivation_unit': 'Low-pH Viral Inactivation',
    'virus_filtration_unit': 'Virus Filtration (Nanofiltration)',
    'ufdf_skid': 'UF/DF Skid',
    'bds_unit': 'Bulk Drug Substance Fill & Freeze',
    'wfi_system': 'WFI System',
    'cip_skid': 'CIP Skid',
    'air_handling_unit': 'Air Handling Unit (HVAC)',
    'ph_control_module': 'pH Control',
    'do_probe': 'DO Probe',
    'pco2_probe': 'pCO₂ Probe',
    'chrom_column': 'Chromatography Column',
    'vi_tank': 'Inactivation Tank',
    'tff_module': 'TFF Membrane Cassettes',
    'bds_freezer': 'DS Freezer (−45 °C)',
    'multi_effect_still': 'Multi-Effect Still',
    'wfi_tank': 'WFI Storage Tank',
    'wfi_loop': 'WFI Hot Loop',
    'ahu_fan': 'AHU Supply Fan',
    'hepa_bank': 'HEPA Filter Bank',
    'room_dp_sensor': 'Room DP Sensor',
}
DERIVATIONS = [
    {'assetType': 'biologics_site', 'property': 'active_culture_volume_l', 'fn': 'sum', 'of': 'working_volume_l',
     'fromType': 'production_bioreactor', 'scope': 'descendants'},
    {'assetType': 'upstream_area', 'property': 'area_product_mass_kg', 'fn': 'sum', 'of': 'product_mass_kg',
     'fromType': 'production_bioreactor', 'scope': 'descendants'},
    {'assetType': 'upstream_area', 'property': 'area_o2_demand_slpm', 'fn': 'sum', 'of': 'o2_flow_slpm',
     'fromType': 'gas_control_module', 'scope': 'descendants'},
    {'assetType': 'upstream_area', 'property': 'units_in_service_count', 'fn': 'sum', 'of': 'units_in_service_count',
     'fromType': 'process_cell', 'scope': 'children'},
    {'assetType': 'downstream_area', 'property': 'units_in_service_count', 'fn': 'sum', 'of': 'units_in_service_count',
     'fromType': 'process_cell', 'scope': 'children'},
    {'assetType': 'utilities_area', 'property': 'units_in_service_count', 'fn': 'sum', 'of': 'units_in_service_count',
     'fromType': 'process_cell', 'scope': 'children'},
    {'assetType': 'downstream_area', 'property': 'dsp_load_flow_l_min', 'fn': 'sum', 'of': 'skid_flow_l_min',
     'fromType': 'capture_skid|polish_skid', 'scope': 'descendants'},
    {'assetType': 'utilities_area', 'property': 'wfi_draw_l_h', 'fn': 'sum', 'of': 'wfi_draw_l_h',
     'fromType': 'wfi_system', 'scope': 'descendants'},
    {'assetType': 'utilities_area', 'property': 'suite_min_dp_pa', 'fn': 'min', 'of': 'room_dp_pa',
     'fromType': 'room_dp_sensor', 'scope': 'descendants'},
    {'assetType': 'room_monitoring', 'property': 'suite_min_dp_pa', 'fn': 'min', 'of': 'room_dp_pa',
     'fromType': 'room_dp_sensor', 'scope': 'children'},
    # formulas (not simple aggregates)
    {'assetType': 'production_bioreactor', 'property': 'product_mass_kg', 'fn': 'formula',
     'note': 'titer_g_l × working_volume_l / 1000 (product still in the vessel, before harvest losses)'},
    {'assetType': 'process_cell', 'property': 'units_in_service_count', 'fn': 'formula',
     'note': 'count of child units processing product or supplying a utility at that time step (standby, CIP/SIP turnaround and trips excluded); precomputed in generate.py'},
    {'assetType': 'biologics_site', 'property': 'batches_in_process_count', 'fn': 'formula',
     'note': 'distinct SLP-201 batches between inoculation of the N-1 seed and DS freeze (26-112, -113, -114, -116, -117)'},
    {'assetType': 'biologics_site', 'property': 'open_deviations_count', 'fn': 'formula',
     'note': 'deviation records open in the QMS for batches on site; steps up when a deviation is raised'},
    {'assetType': 'capture_skid', 'property': 'load_processed_l', 'fn': 'formula',
     'note': 'Σ skid_flow_l_min × 5 min over load phases of this batch'},
    {'assetType': 'polish_skid', 'property': 'load_processed_l', 'fn': 'formula',
     'note': 'Σ skid_flow_l_min × 5 min since the load started (08:30)'},
    {'assetType': 'ph_control_module', 'property': 'base_added_l', 'fn': 'formula',
     'note': 'batch total so far + Σ base_pump_rate_ml_min × 5 min / 1000'},
    {'assetType': 'feed_module', 'property': 'feed_added_l', 'fn': 'formula',
     'note': 'batch total so far + Σ feed_pump_rate_l_h × 5/60'},
    {'assetType': 'wfi_system', 'property': 'wfi_available_l', 'fn': 'formula',
     'note': 'wfi_tank_level_pct × 30,000 L tank / 100'},
    {'assetType': 'feed_pump', 'property': 'feed_interruptions_1h', 'fn': 'formula',
     'note': 'count of 5-minute samples with the pump stopped by a flow alarm in the trailing 60 minutes'},
]


# ── Helpers ─────────────────────────────────────────────────────────────
def interp(points):
    """Piecewise-linear profile over the timeline from {'HH:MM': value}."""
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
                out.append(v0 + (v1 - v0) * (m - m0) / (m1 - m0) if m1 > m0 else v1)
                break
    return out


def steps(points, default=0.0):
    """Step profile: value from each 'HH:MM' key until the next key."""
    pts = sorted((minutes(t), v) for t, v in points.items())
    out = []
    for t in TS:
        m, v = minutes(t), default
        for m0, v0 in pts:
            if m >= m0:
                v = v0
        out.append(v)
    return out


def ar1(sd, phi=0.85):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi), zero mean."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def plus_noise(base, sd, phi=0.85):
    return [b + e for b, e in zip(base, ar1(sd, phi))]


def noisy_pct(base, rel, phi=0.85):
    """Multiplicative AR(1) noise (coefficient of variation ≈ rel)."""
    return [b * (1 + e) for b, e in zip(base, ar1(rel, phi))]


def ramp(t0, t1, amount=1.0, power=1.0):
    """0 up to t0, rising to `amount` at t1 (optionally accelerating), held after."""
    a, b = minutes(t0), minutes(t1)
    return [0.0 if minutes(t) <= a else amount * min(1.0, (minutes(t) - a) / (b - a)) ** power for t in TS]


def window(t0, t1):
    return [minutes(t0) <= minutes(t) < minutes(t1) for t in TS]


def lagged(targets, k=0.35, start=None):
    x, out = (targets[0] if start is None else start), []
    for tgt in targets:
        x += (tgt - x) * k
        out.append(x)
    return out


def cumsum(rates, per_step, start=0.0):
    acc, out = start, []
    for i, r in enumerate(rates):
        if i > 0:
            acc += r * per_step
        out.append(acc)
    return out


def clamp(xs, lo, hi):
    return [min(hi, max(lo, x)) for x in xs]


def rnd(x, d):
    return round(x + 0.0, d)


# ── Build the asset tree (ISA-88 physical model) ─────────────────────────
assets, kids = [], {}


def add(aid, parent, name, atype, level):
    assets.append({'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level})
    kids.setdefault(parent, []).append(aid)
    return aid


SITE = add('SOLACE', None, 'Solace Park', 'biologics_site', 'site')
USP = add('SOLACE_USP', SITE, 'Upstream', 'upstream_area', 'area')
DSP = add('SOLACE_DSP', SITE, 'Downstream', 'downstream_area', 'area')
UTIL = add('SOLACE_UTIL', SITE, 'Utilities & Support', 'utilities_area', 'area')

CELL_SEED = add('SOLACE_USP_SEED', USP, 'Seed Train', 'process_cell', 'process_cell')
CELL_PROD = add('SOLACE_USP_PROD', USP, 'Production Bioreactors', 'process_cell', 'process_cell')


def bioreactor(cell, code, name, kind):
    """Seed and production bioreactors share their module types; production adds feed and exhaust."""
    u = add(f'{cell}_{code}', cell, name, f'{kind}_bioreactor', 'unit')
    add(f'{u}_AGIT', u, 'Agitation', 'agitation_module', 'equipment_module')
    gas = add(f'{u}_GAS', u, 'Gas Control', 'gas_control_module', 'equipment_module')
    add(f'{gas}_DOA', gas, 'DO Probe A (control)', 'do_probe', 'control_module')
    add(f'{gas}_DOB', gas, 'DO Probe B (monitor)', 'do_probe', 'control_module')
    add(f'{gas}_PCO2', gas, 'pCO₂ Probe', 'pco2_probe', 'control_module')
    ph = add(f'{u}_PH', u, 'pH Control', 'ph_control_module', 'equipment_module')
    add(f'{ph}_BASE', ph, 'Base Pump', 'base_pump', 'control_module')
    add(f'{u}_TEMP', u, 'Temperature Control', 'temperature_control_module', 'equipment_module')
    if kind == 'production':
        feed = add(f'{u}_FEED', u, 'Feed Addition', 'feed_module', 'equipment_module')
        add(f'{feed}_PUMP', feed, 'Feed Pump', 'feed_pump', 'control_module')
        add(f'{u}_EXH', u, 'Exhaust', 'exhaust_module', 'equipment_module')
    return u


SBR1 = bioreactor(CELL_SEED, 'SBR1', 'SBR-1', 'seed')
PBR = {k: bioreactor(CELL_PROD, f'PBR{k}', f'PBR-{k}', 'production') for k in (1, 2, 3)}

CELL_REC = add('SOLACE_DSP_REC', DSP, 'Recovery', 'process_cell', 'process_cell')
HRV1 = add(f'{CELL_REC}_HRV1', CELL_REC, 'HRV-1', 'harvest_train', 'unit')
HRV_CENT = add(f'{HRV1}_CENT', HRV1, 'Disk-Stack Centrifuge', 'centrifuge_module', 'equipment_module')
HRV_DF = add(f'{HRV1}_DF', HRV1, 'Depth Filtration', 'depth_filter_module', 'equipment_module')
HRV_TANK = add(f'{HRV1}_HOLD', HRV1, 'Harvest Hold Tank', 'harvest_hold_tank', 'equipment_module')

CELL_PUR = add('SOLACE_DSP_PUR', DSP, 'Purification', 'process_cell', 'process_cell')
CAP1 = add(f'{CELL_PUR}_CAP1', CELL_PUR, 'CAP-1', 'capture_skid', 'unit')
CAP_GF = add(f'{CAP1}_GF', CAP1, 'Guard Filter', 'guard_filter', 'equipment_module')
CAP_COL = add(f'{CAP1}_COL', CAP1, 'Protein A Column', 'chrom_column', 'equipment_module')
CAP_DET = add(f'{CAP1}_DET', CAP1, 'Detector Block', 'detector_block', 'equipment_module')
VIN1 = add(f'{CELL_PUR}_VIN1', CELL_PUR, 'VIN-1', 'viral_inactivation_unit', 'unit')
VIN_TANK = add(f'{VIN1}_TANK', VIN1, 'Inactivation Tank', 'vi_tank', 'equipment_module')
VIN_DOSE = add(f'{VIN1}_DOSE', VIN1, 'Acid / Base Titrant', 'titrant_dosing', 'equipment_module')
POL1 = add(f'{CELL_PUR}_POL1', CELL_PUR, 'POL-1', 'polish_skid', 'unit')
POL_AEX = add(f'{POL1}_AEX', POL1, 'AEX Membrane Adsorber', 'membrane_adsorber', 'equipment_module')
POL_COL = add(f'{POL1}_CEX', POL1, 'CEX Column', 'chrom_column', 'equipment_module')
POL_DET = add(f'{POL1}_DET', POL1, 'Detector Block', 'detector_block', 'equipment_module')
VF1 = add(f'{CELL_PUR}_VF1', CELL_PUR, 'VF-1', 'virus_filtration_unit', 'unit')
VF_PRE = add(f'{VF1}_PRE', VF1, 'Prefilter', 'prefilter', 'equipment_module')
VF_FLT = add(f'{VF1}_VF', VF1, 'Virus Filter', 'virus_filter', 'equipment_module')
UF1 = add(f'{CELL_PUR}_UFDF1', CELL_PUR, 'UFDF-1', 'ufdf_skid', 'unit')
UF_TFF = add(f'{UF1}_TFF', UF1, 'TFF Cassettes', 'tff_module', 'equipment_module')
UF_TANK = add(f'{UF1}_RET', UF1, 'Retentate Tank', 'retentate_tank', 'equipment_module')

CELL_BDS = add('SOLACE_DSP_BDS', DSP, 'Bulk Drug Substance', 'process_cell', 'process_cell')
BDS1 = add(f'{CELL_BDS}_BDS1', CELL_BDS, 'BDS-1', 'bds_unit', 'unit')
BDS_FF = add(f'{BDS1}_FF', BDS1, 'Final 0.2 µm Filter', 'final_filter', 'equipment_module')
BDS_FRZ = add(f'{BDS1}_FRZ', BDS1, 'DS Freezer', 'bds_freezer', 'equipment_module')

CELL_CU = add('SOLACE_UTIL_CU', UTIL, 'Clean Utilities', 'process_cell', 'process_cell')
WFI1 = add(f'{CELL_CU}_WFI1', CELL_CU, 'WFI-1', 'wfi_system', 'unit')
WFI_STILL = add(f'{WFI1}_STILL', WFI1, 'Multi-Effect Still', 'multi_effect_still', 'equipment_module')
WFI_TANK = add(f'{WFI1}_TANK', WFI1, 'Storage Tank', 'wfi_tank', 'equipment_module')
WFI_LOOP = add(f'{WFI1}_LOOP', WFI1, 'Hot Loop', 'wfi_loop', 'equipment_module')
CSG1 = add(f'{CELL_CU}_CSG1', CELL_CU, 'CSG-1', 'clean_steam_generator', 'unit')
CIP1 = add(f'{CELL_CU}_CIP1', CELL_CU, 'CIP-1', 'cip_skid', 'unit')
AHU3 = add(f'{CELL_CU}_AHU3', CELL_CU, 'AHU-3', 'air_handling_unit', 'unit')
FAN_A = add(f'{AHU3}_FANA', AHU3, 'Supply Fan A', 'ahu_fan', 'equipment_module')
FAN_B = add(f'{AHU3}_FANB', AHU3, 'Supply Fan B', 'ahu_fan', 'equipment_module')
HEPA = add(f'{AHU3}_HEPA', AHU3, 'HEPA Bank', 'hepa_bank', 'equipment_module')
ROOMS = add(f'{AHU3}_ROOMS', AHU3, 'Post-Viral Suite Rooms', 'room_monitoring', 'equipment_module')
DP_CHROM = add(f'{ROOMS}_R214', ROOMS, 'Chromatography Rm 2.14 DP', 'room_dp_sensor', 'control_module')
DP_UF = add(f'{ROOMS}_R216', ROOMS, 'UF/DF Rm 2.16 DP', 'room_dp_sensor', 'control_module')
DP_AL = add(f'{ROOMS}_AL7', ROOMS, 'Airlock AL-7 DP', 'room_dp_sensor', 'control_module')

CELL_PREP = add('SOLACE_UTIL_PREP', UTIL, 'Solution Prep', 'process_cell', 'process_cell')
MP1 = add(f'{CELL_PREP}_MP1', CELL_PREP, 'MP-1', 'media_prep_unit', 'unit')
BP1 = add(f'{CELL_PREP}_BP1', CELL_PREP, 'BP-1', 'buffer_prep_unit', 'unit')

A = {a['id']: a for a in assets}
UNITS = [a['id'] for a in assets if a['assetLevel'] == UNIT_LEVEL]
series = {}


def put(aid, key, values, decimals=None):
    assert key in TYPE_PROPS[A[aid]['assetType']], (aid, key)
    d = PROPS[key][5] if decimals is None else decimals
    series.setdefault(aid, {})[key] = [rnd(v, d) for v in values]


def S(aid, key):
    return series[aid][key]


# ═════════════════════════════════════════════════════════════════════════
# Upstream — bioreactors
# ═════════════════════════════════════════════════════════════════════════
ZERO = [0.0] * N


def gas_and_probes(u, o2, air, co2, overlay, do_a, do_b, q_b, pco2):
    put(f'{u}_GAS', 'o2_flow_slpm', o2)
    put(f'{u}_GAS', 'air_sparge_slpm', air)
    put(f'{u}_GAS', 'co2_flow_slpm', co2)
    put(f'{u}_GAS', 'overlay_air_slpm', overlay)
    put(f'{u}_GAS_DOA', 'do_pct', do_a)
    put(f'{u}_GAS_DOA', 'probe_quality_index', clamp(plus_noise([96.0] * N, 0.6), 0, 100))
    put(f'{u}_GAS_DOB', 'do_pct', do_b)
    put(f'{u}_GAS_DOB', 'probe_quality_index', q_b)
    put(f'{u}_GAS_PCO2', 'pco2_mmhg', pco2)


def agitation(u, rpm, kw, vib, seal):
    put(f'{u}_AGIT', 'agitator_speed_rpm', rpm)
    put(f'{u}_AGIT', 'agitator_power_kw', kw)
    put(f'{u}_AGIT', 'gearbox_vibration_mms', vib)
    put(f'{u}_AGIT', 'seal_temp_c', seal)


def ph_control(u, ph, pump_ml_min, base0, tank0):
    put(f'{u}_PH_BASE', 'base_pump_rate_ml_min', pump_ml_min)
    added = cumsum(S(f'{u}_PH_BASE', 'base_pump_rate_ml_min'), STEP / 1000.0, base0)
    put(f'{u}_PH', 'base_added_l', added)
    put(f'{u}_PH', 'culture_ph', ph)
    # 200 L base tank: level falls as base is pumped
    put(f'{u}_PH_BASE', 'base_tank_level_pct', [tank0 - (a - base0) / 2.0 for a in added])
    return S(f'{u}_PH', 'base_added_l')


def temperature(u, vessel, jacket, drain):
    put(f'{u}_TEMP', 'culture_temp_c', vessel)
    put(f'{u}_TEMP', 'jacket_inlet_temp_c', jacket)
    put(f'{u}_TEMP', 'drain_temp_c', drain)


# ── SBR-1: N-1 seed for batch 26-117 (1,600 L in a 2,000 L vessel), day 3.6 → 3.85 ──
k_seed = math.log(2) / SEED_DOUBLING_H
seed_vcd = noisy_pct([SEED_VCD0 * math.exp(k_seed * h) for h in HRS], 0.006, 0.6)
put(SBR1, 'seed_vcd_e6_ml', seed_vcd)
put(SBR1, 'viability_pct', plus_noise([97.6] * N, 0.15))
put(SBR1, 'seed_culture_day', [3.60 + h / 24 for h in HRS])
put(SBR1, 'transfer_vcd_max_e6_ml', [TRANSFER_MAX] * N)
agitation(SBR1, plus_noise([85.0] * N, 0.1), plus_noise([2.4] * N, 0.03), plus_noise([1.2] * N, 0.05),
          plus_noise([38.0] * N, 0.3))
dob_offset = [float(DOB_SPIKES.get(t, 0.0)) for t in TS]
# between the spikes probe B is still unsteady (small jumps) until the connector is reseated
dob_jitter = [rng.gauss(0, 3.0) if window(*DOB_WINDOW)[i] and t not in DOB_SPIKES else 0.0 for i, t in enumerate(TS)]
seed_do_a = plus_noise([40.0] * N, 0.5, 0.6)
seed_do_b = [a + 0.4 + o + j + e for a, o, j, e in zip(seed_do_a, dob_offset, dob_jitter, ar1(0.3, 0.6))]
q_b = [96.0 - 38.0 * (1 if w else 0) * (0.6 + 0.4 * abs(o) / 26) for w, o in zip(window(*DOB_WINDOW), dob_offset)]
gas_and_probes(SBR1, [3.0 * v for v in seed_vcd], plus_noise([20.0] * N, 0.3), plus_noise([1.5] * N, 0.15),
               [15.0] * N, seed_do_a, seed_do_b, clamp(plus_noise(q_b, 1.0, 0.5), 0, 100),
               plus_noise([55.0] * N, 1.2))
ph_control(SBR1, plus_noise([7.05] * N, 0.008, 0.7), clamp(plus_noise([13.0] * N, 2.0, 0.5), 0, 200), 12.0, 71.0)
temperature(SBR1, plus_noise([36.8] * N, 0.03), plus_noise([36.1] * N, 0.08), plus_noise([36.6] * N, 0.04))
put(SBR1, 'seed_volume_l', [1600.0 + (b - 12.0) for b in S(f'{SBR1}_PH', 'base_added_l')])


def production_batch(u, day0, vcd, viab, titer0, titer_rate, vol0, feed_rate, feed0, base_rate, base0, tank0,
                     ph, temp_c, rpm, kw, vib, seal, o2_per_vcd, air, co2, overlay, pco2, glucose, osm0,
                     filt_dp, feed_stops=None):
    put(u, 'culture_day', [day0 + h / 24 for h in HRS])
    put(u, 'vcd_e6_ml', vcd)
    put(u, 'viability_pct', viab)
    agitation(u, rpm, kw, vib, seal)
    gas_and_probes(u, [o2_per_vcd * v for v in vcd], air, co2, overlay,
                   plus_noise([40.0] * N, 0.5, 0.6), plus_noise([40.3] * N, 0.5, 0.6),
                   clamp(plus_noise([95.0] * N, 0.6), 0, 100), pco2)
    base_added = ph_control(u, ph, base_rate, base0, tank0)
    temperature(u, plus_noise([temp_c] * N, 0.03), plus_noise([temp_c - 0.9] * N, 0.1),
                plus_noise([temp_c - 0.1] * N, 0.04))
    put(f'{u}_FEED_PUMP', 'feed_pump_rate_l_h', feed_rate)
    stopped = [1 if r < 0.5 else 0 for r in S(f'{u}_FEED_PUMP', 'feed_pump_rate_l_h')]
    alarms = [1 if (feed_stops and t in feed_stops) else 0 for t in TS]
    put(f'{u}_FEED_PUMP', 'feed_interruptions_1h', [sum(alarms[max(0, i - 11):i + 1]) for i in range(N)])
    fed = cumsum(S(f'{u}_FEED_PUMP', 'feed_pump_rate_l_h'), DT_H, feed0)
    put(f'{u}_FEED', 'feed_added_l', fed)
    put(f'{u}_FEED', 'glucose_g_l', glucose)
    vol = [vol0 + (f - feed0) + (b - base0) for f, b in zip(fed, base_added)]
    put(u, 'working_volume_l', vol)
    tit = plus_noise([titer0 + titer_rate * h for h in HRS], 0.004, 0.9)
    put(u, 'titer_g_l', tit)
    put(u, 'product_mass_kg', [a * b / 1000 for a, b in zip(S(u, 'titer_g_l'), S(u, 'working_volume_l'))])
    put(u, 'osmolality_mosm_kg', [osm0 + 0.19 * (b - base0) + 0.4 * h + e
                                  for b, h, e in zip(base_added, HRS, ar1(0.6))])
    put(f'{u}_EXH', 'exhaust_filter_dp_mbar', filt_dp)
    put(f'{u}_EXH', 'vessel_pressure_barg', plus_noise([0.150] * N, 0.002))
    put(f'{u}_EXH', 'exhaust_co2_pct', [0.058 * p + e for p, e in zip(S(f'{u}_GAS_PCO2', 'pco2_mmhg'), ar1(0.05))])
    return stopped


# ── PBR-1: batch 26-114, day 12.85 → 13.1, temperature-shifted to 33 °C; harvest planned tomorrow 08:00 ──
agit_deg = ramp(AGIT_START, '14:05', 1.0, 1.7)
viab_pbr1 = [VIAB0 - 0.35 * h - (VIAB0 - 0.35 * 6.083 - VIAB_NOW) * max(0.0, (h - 1.0) / 5.083) ** 1.25 for h in HRS]
production_batch(
    PBR[1], 12.85,
    vcd=noisy_pct([17.5 - 0.19 * h for h in HRS], 0.006, 0.7),
    viab=plus_noise(viab_pbr1, 0.12, 0.6),
    titer0=5.62, titer_rate=0.026, vol0=11250.0,
    feed_rate=plus_noise([22.0] * N, 0.3, 0.6), feed0=1480.0,
    base_rate=clamp(plus_noise([9.0] * N, 1.5, 0.5), 0, 200), base0=118.0, tank0=48.0,
    ph=plus_noise([6.98] * N, 0.006, 0.7), temp_c=33.0,
    rpm=plus_noise([48.0] * N, 0.08), kw=[14.2 * (1 + 0.03 * d) + e for d, e in zip(agit_deg, ar1(0.05))],
    vib=[AGIT_VIB0 + (AGIT_VIB_NOW - AGIT_VIB0) * d + e for d, e in zip(agit_deg, ar1(0.07, 0.6))],
    seal=[44.0 + 8.0 * d ** 0.8 + e for d, e in zip(agit_deg, ar1(0.3))],
    o2_per_vcd=8.6, air=plus_noise([200.0] * N, 1.5), co2=plus_noise([4.0] * N, 0.4, 0.6),
    overlay=[120.0] * N, pco2=plus_noise([84.0] * N, 1.5),
    glucose=plus_noise([3.10] * N, 0.05), osm0=404.0,
    filt_dp=plus_noise([14.0] * N, 0.2))

# ── PBR-2: batch 26-116, day 6.9 → 7.15, near peak cell density ──
# Ground truth (not in the open item's text): at 10:05 the planned exhaust-filter swap left the
# headspace overlay at 30 slpm instead of 120. With peak CO₂ production that is enough for pCO₂ to
# climb. As pCO₂ rises the pH drifts to the low dead-band edge: CO₂ sparge (the acid actuator)
# backs off and the base pump works harder, which in turn raises osmolality.
pco2_rise = ramp(PCO2_START, '14:05', 1.0, 1.1)
pco2_pbr2 = [PCO2_0 + (PCO2_NOW - PCO2_0) * r + e for r, e in zip(pco2_rise, ar1(1.2, 0.7))]
feed_base = [32.0 if not window(*FEED_REPAIR)[i] else 0.0 for i in range(N)]
feed_base = [0.0 if t in FEED_STOPS else f for t, f in zip(TS, feed_base)]
# after the tubing change the recipe catches up at 40 L/h until 12:40
feed_base = [40.0 if minutes('11:55') <= minutes(t) < minutes('12:40') else f for t, f in zip(TS, feed_base)]
feed_rate2 = [f + (e if f > 0 else 0.0) for f, e in zip(feed_base, ar1(0.3, 0.6))]
short = cumsum([32.0 - f for f in feed_base], DT_H)                 # litres behind the recipe
glu2 = [4.20 - 0.045 * s + e for s, e in zip(short, ar1(0.04))]
production_batch(
    PBR[2], 6.90,
    vcd=noisy_pct([21.0 + 0.17 * h for h in HRS], 0.006, 0.7),
    viab=plus_noise([96.2 - 0.05 * h for h in HRS], 0.1, 0.6),
    titer0=2.40, titer_rate=0.025, vol0=10400.0,
    feed_rate=feed_rate2, feed0=820.0,
    base_rate=clamp([24.0 + 46.0 * r + e for r, e in zip(pco2_rise, ar1(3.0, 0.5))], 0, 200), base0=145.0, tank0=61.0,
    ph=[7.00 - 0.07 * r ** 0.8 + e for r, e in zip(pco2_rise, ar1(0.006, 0.7))], temp_c=36.5,
    rpm=plus_noise([52.0] * N, 0.08), kw=plus_noise([16.1] * N, 0.05),
    vib=plus_noise([1.7] * N, 0.06, 0.6), seal=plus_noise([43.0] * N, 0.3),
    o2_per_vcd=8.0, air=plus_noise([220.0] * N, 1.5),
    co2=clamp([12.0 - 10.0 * r + e for r, e in zip(pco2_rise, ar1(0.4, 0.6))], 0, 50),
    overlay=steps({'08:00': 120.0, OVERLAY_CUT: 30.0}), pco2=pco2_pbr2,
    glucose=glu2, osm0=356.0,
    filt_dp=steps({'08:00': 18.5, OVERLAY_CUT: 9.0}), feed_stops=FEED_STOPS)

# ── PBR-3: turnaround after harvesting batch 26-113 yesterday → CIP, SIP (aborted once), cool-down under sterile air ──
def pbr3_profile():
    vessel, jacket, drain, press, rpm = [], [], [], [], []
    cip = [('08:00', 25.0), ('08:10', 75.0), ('08:45', 30.0), ('08:55', 55.0), ('09:15', 25.0), ('09:40', 24.0)]
    for i, t in enumerate(TS):
        m = minutes(t)
        if m < minutes('09:40'):
            v = [x for tt, x in cip if minutes(tt) <= m][-1]
            vessel.append(v); drain.append(v - 3.0); jacket.append(24.0); press.append(0.05)
            rpm.append(20.0)
        elif m < minutes(SIP1_START):
            vessel.append(24.0); drain.append(23.5); jacket.append(24.0); press.append(0.02); rpm.append(0.0)
        elif m < minutes(SIP2_START):
            # SIP #1: heat-up stalls when the clean-steam header sags from 10:20
            f = min(1.0, (m - minutes(SIP1_START)) / 20.0)
            v = 24.0 + (119.5 - 24.0) * f
            d = 24.0 + (108.0 - 24.0) * f
            if m >= minutes(CSG_DIP):
                sag = min(1.0, (m - minutes(CSG_DIP)) / 20.0)
                v = 119.5 - 1.8 * sag
                d = 108.0 + 7.5 * min(1.0, (m - minutes(CSG_DIP)) / 20.0) - 2.0 * max(0.0, (m - minutes('10:40')) / 5.0)
            if m >= minutes(SIP1_ABORT):
                cool = (m - minutes(SIP1_ABORT)) / 55.0
                v = 117.0 - 17.0 * cool
                d = 112.0 - 16.0 * cool
            vessel.append(v); drain.append(d); jacket.append(128.0 if m < minutes(SIP1_ABORT) else 60.0)
            press.append(1.10 if m < minutes(CSG_DIP) else (0.92 if m < minutes(SIP1_ABORT) else 0.35))
            rpm.append(0.0)
        elif m < minutes(SIP2_END):
            f = min(1.0, (m - minutes(SIP2_START)) / 25.0)
            v = 100.0 + (123.4 - 100.0) * f
            d = 96.0 + (122.1 - 96.0) * min(1.0, (m - minutes(SIP2_START)) / 30.0)
            vessel.append(v); drain.append(d); jacket.append(128.0); press.append(1.16); rpm.append(0.0)
        elif m < minutes(SIP_DONE):
            f = (m - minutes(SIP2_END)) / 15.0
            vessel.append(123.4 - 28.0 * f); drain.append(122.0 - 30.0 * f); jacket.append(40.0)
            press.append(0.60); rpm.append(0.0)
        else:
            f = (m - minutes(SIP_DONE)) / 40.0
            vessel.append(95.4 - 53.0 * f ** 0.8); drain.append(92.0 - 51.0 * f ** 0.8); jacket.append(15.0)
            press.append(0.30); rpm.append(0.0)
    return vessel, jacket, drain, press, rpm


p3_vessel, p3_jacket, p3_drain, p3_press, p3_rpm = pbr3_profile()
U3 = PBR[3]
put(U3, 'culture_day', ZERO); put(U3, 'vcd_e6_ml', ZERO); put(U3, 'viability_pct', ZERO)
put(U3, 'titer_g_l', ZERO); put(U3, 'product_mass_kg', ZERO); put(U3, 'working_volume_l', ZERO)
put(U3, 'osmolality_mosm_kg', ZERO)
agitation(U3, p3_rpm, [1.0 if r > 0 else 0.0 for r in p3_rpm],
          plus_noise([0.25] * N, 0.03, 0.6), [30.0 + 0.25 * (v - 25.0) for v in p3_vessel])
after_sip = [minutes(t) >= minutes(SIP_DONE) for t in TS]
gas_and_probes(U3, ZERO, ZERO, ZERO, [20.0 if a else 0.0 for a in after_sip], ZERO, ZERO,
               clamp(plus_noise([92.0] * N, 0.5), 0, 100), ZERO)
# pH probes sit in their pH 7 storage/calibration buffer during turnaround (they are autoclaved separately)
ph_control(U3, plus_noise([7.00] * N, 0.004, 0.7), ZERO, 0.0, 88.0)
temperature(U3, [v + e for v, e in zip(p3_vessel, ar1(0.08, 0.5))], p3_jacket,
            [v + e for v, e in zip(p3_drain, ar1(0.08, 0.5))])
put(f'{U3}_FEED_PUMP', 'feed_pump_rate_l_h', ZERO)
put(f'{U3}_FEED_PUMP', 'feed_interruptions_1h', ZERO)
put(f'{U3}_FEED', 'feed_added_l', ZERO)
put(f'{U3}_FEED', 'glucose_g_l', ZERO)
sip_steam = [minutes(SIP1_START) <= minutes(t) < minutes(SIP1_ABORT) or minutes(SIP2_START) <= minutes(t) < minutes(SIP2_END)
             for t in TS]
put(f'{U3}_EXH', 'exhaust_filter_dp_mbar', [(24.0 if s else 3.0) + e for s, e in zip(sip_steam, ar1(0.3))])
put(f'{U3}_EXH', 'vessel_pressure_barg', [p + e for p, e in zip(p3_press, ar1(0.004, 0.5))])
put(f'{U3}_EXH', 'exhaust_co2_pct', plus_noise([0.04] * N, 0.003))


# ═════════════════════════════════════════════════════════════════════════
# Downstream
# ═════════════════════════════════════════════════════════════════════════
# ── HRV-1: standby; harvested batch 26-113 yesterday, harvests 26-114 tomorrow ──
put(HRV1, 'harvest_flow_l_h', ZERO)
put(HRV1, 'clarified_volume_l', [10950.0] * N)          # batch 26-113 total, held until the next harvest
put(HRV_CENT, 'bowl_speed_rpm', ZERO)
put(HRV_CENT, 'centrate_turbidity_ntu', ZERO)
put(HRV_DF, 'filter_dp_bar', ZERO)
put(HRV_TANK, 'hold_tank_level_pct', ZERO)
put(HRV_TANK, 'hold_tank_temp_c', plus_noise([21.0] * N, 0.1))

# ── CAP-1: Protein A capture, batch 26-113, cycles 1–5 of 8 today ──
# Each cycle: equilibrate 10 min, load 40 min (38 L/min, last 10 min at 26 L/min — dual-flow loading),
# wash 10, elute 5, strip/CIP 5. Cycle 2 is halted 09:55–10:40 by the guard-filter trip (PSIT04).
PH_FLOW = {'eq': 38.0, 'wash': 38.0, 'elute': 20.0, 'regen': 30.0, 'halt': 0.0, 'idle': 0.0}
cap_phase, cap_cycle, cap_tau = [], [], []
for t in TS:
    m = minutes(t)
    ph, cyc, tau = 'idle', 0, 0.0
    for c, st in enumerate(CAP_CYCLES, 1):
        s0 = minutes(st)
        if m < s0:
            break
        rel = m - s0
        halt = 45 if c == 2 else 0
        if c == 2 and minutes(CAP_TRIP) <= m < minutes(CAP_RESTART):
            ph, cyc, tau = 'halt', c, (minutes(CAP_TRIP) - s0 - 10) / 40.0
            continue
        rel_eff = rel - (halt if (c == 2 and m >= minutes(CAP_RESTART)) else 0)
        cyc = c
        if rel_eff < 10:
            ph = 'eq'
        elif rel_eff < 50:
            ph, tau = 'load', (rel_eff - 10 + 5) / 40.0
        elif rel_eff < 60:
            ph = 'wash'
        elif rel_eff < 65:
            ph = 'elute'
        elif rel_eff < 70:
            ph = 'regen'
        else:
            ph = 'idle'
    cap_phase.append(ph); cap_cycle.append(cyc); cap_tau.append(tau)

flow = []
for ph, tau in zip(cap_phase, cap_tau):
    if ph == 'load':
        flow.append(38.0 if tau <= 0.76 else 26.0)
    else:
        flow.append(PH_FLOW[ph])
flow = [f + (e if f > 0 else 0.0) for f, e in zip(flow, ar1(0.25, 0.5))]
put(CAP1, 'skid_flow_l_min', flow)
put(CAP1, 'cycle_number', [float(c) for c in cap_cycle])
put(CAP1, 'load_processed_l', cumsum([f if ph == 'load' else 0.0 for f, ph in
                                      zip(S(CAP1, 'skid_flow_l_min'), cap_phase)], STEP))
yld, cur = [], YIELD_PREV
for i, (ph, c) in enumerate(zip(cap_phase, cap_cycle)):
    if ph == 'regen' and cap_phase[i - 1] == 'elute':
        cur = STEP_YIELD[c - 1]
    yld.append(cur)
put(CAP1, 'step_yield_pct', yld)

bt, last = [], 0.90
for ph, c, tau in zip(cap_phase, cap_cycle, cap_tau):
    if ph == 'load':
        b = 0.10 + (BREAKTHROUGH[c - 1] - 0.10) * tau ** 2.2
        bt.append(b)
        if tau >= 0.999:
            last = BREAKTHROUGH[c - 1]
    else:
        if ph in ('wash', 'elute', 'regen', 'idle', 'eq') and c and cap_tau and bt and ph != 'eq':
            last = BREAKTHROUGH[c - 1] if ph != 'idle' else last
        bt.append(last if ph != 'halt' else bt[-1])
put(CAP_COL, 'breakthrough_pct', [b + (e if b > 0.15 else 0.0) for b, e in zip(bt, ar1(0.03, 0.5))])
put(CAP_COL, 'resin_cycles', [float(RESIN_CYCLES_0 + c) for c in cap_cycle])
put(CAP_COL, 'column_dp_bar', [1.35 * f / 38.0 * (1 + 0.004 * c) + (e if f > 0 else 0.0)
                               for f, c, e in zip(S(CAP1, 'skid_flow_l_min'), cap_cycle, ar1(0.015, 0.5))])
# guard filter: normal ~0.4 bar at load flow; in cycle 2 it plugs (fines in the clarified harvest)
gf = []
for t, ph, f, tau in zip(TS, cap_phase, S(CAP1, 'skid_flow_l_min'), cap_tau):
    base = 0.30 * f / 38.0 + (0.12 * tau if ph == 'load' else 0.0)
    if minutes('09:35') <= minutes(t) < minutes(CAP_TRIP):
        base = {'09:35': 0.58, '09:40': 0.95, '09:45': 1.45, '09:50': 2.18}[t]
    gf.append(base)
put(CAP_GF, 'filter_dp_bar', [g + (e if g > 0 else 0.0) for g, e in zip(gf, ar1(0.01, 0.5))])
UV = {'eq': 0.012, 'wash': 0.12, 'elute': 2.10, 'regen': 0.04, 'idle': 0.01}
COND = {'eq': 16.0, 'load': 13.5, 'wash': 48.0, 'elute': 1.8, 'regen': 21.0, 'halt': 13.5, 'idle': 16.0}
PHV = {'eq': 7.20, 'load': 7.00, 'wash': 7.10, 'elute': 3.65, 'regen': 12.90, 'halt': 7.00, 'idle': 7.20}
put(CAP_DET, 'uv280_au', [(0.30 + 0.06 * b if ph in ('load', 'halt') else UV[ph]) * (1 + e)
                          for ph, b, e in zip(cap_phase, S(CAP_COL, 'breakthrough_pct'), ar1(0.01, 0.5))])
put(CAP_DET, 'conductivity_ms_cm', [COND[ph] * (1 + e) for ph, e in zip(cap_phase, ar1(0.005, 0.5))])
put(CAP_DET, 'effluent_ph', [PHV[ph] + e for ph, e in zip(cap_phase, ar1(0.01, 0.5))])

# ── VIN-1: collects the Protein A eluates of batch 26-113 (low-pH hold starts after cycle 8) ──
elute_steps = [ph == 'elute' for ph in cap_phase]
pool, vol = [], 0.0
for e_ in elute_steps:
    if e_:
        vol += 380.0
    pool.append(vol)
put(VIN1, 'vi_pool_volume_l', [p + (e * 0.5 if p > 0 else 0.0) for p, e in zip(pool, ar1(1.0, 0.5))])
pool_ph, cur = [], 7.00
for i, e_ in enumerate(elute_steps):
    if e_:
        cur = 3.70                         # fresh eluate raises the pool pH slightly
    elif pool[i] > 0:
        cur = cur + (3.60 - cur) * 0.6     # acid trim brings it back to 3.60
    pool_ph.append(cur)
put(VIN1, 'vi_pool_ph', [p + (e if p < 5 else 0.0) for p, e in zip(pool_ph, ar1(0.008, 0.5))])
put(VIN_TANK, 'vi_tank_level_pct', [v / 30.0 for v in S(VIN1, 'vi_pool_volume_l')])
put(VIN_TANK, 'vi_tank_temp_c', plus_noise([19.5] * N, 0.1))
put(VIN_DOSE, 'acid_added_l', cumsum([1.1 if e_ else 0.0 for e_ in elute_steps], 1.0))

# ── POL-1: AEX flow-through + CEX bind/elute on batch 26-112; held 12:10–12:50 by the AHU-3 excursion ──
pol_state = []
for t in TS:
    m = minutes(t)
    if m < minutes('08:30'):
        pol_state.append('eq')
    elif minutes(AHU_TRIP) <= m < minutes(POL_RESUME):
        pol_state.append('hold')
    else:
        pol_state.append('load')
pol_flow = [(30.0 if s != 'hold' else 0.0) for s in pol_state]
pol_flow = [f + (e if f > 0 else 0.0) for f, e in zip(pol_flow, ar1(0.2, 0.5))]
put(POL1, 'skid_flow_l_min', pol_flow)
put(POL1, 'load_processed_l', cumsum([f if s == 'load' else 0.0 for f, s in zip(S(POL1, 'skid_flow_l_min'), pol_state)], STEP))
put(POL1, 'step_yield_pct', plus_noise([97.1] * N, 0.08))
loading = [p * 0.0009 for p in S(POL1, 'load_processed_l')]
put(POL_AEX, 'adsorber_loading_g_ml', loading)
put(POL_AEX, 'filter_dp_bar', [(0.75 + 0.02 * l) * f / 30.0 for l, f in zip(loading, S(POL1, 'skid_flow_l_min'))])
put(POL_COL, 'column_dp_bar', [1.10 * f / 30.0 + (e if f > 0 else 0.0) for f, e in zip(S(POL1, 'skid_flow_l_min'), ar1(0.01, 0.5))])
put(POL_COL, 'breakthrough_pct', [0.15 + e for e in ar1(0.01, 0.5)])
put(POL_COL, 'resin_cycles', [64.0] * N)
put(POL_DET, 'uv280_au', [(0.18 if s == 'load' else 0.02) * (1 + e) for s, e in zip(pol_state, ar1(0.02, 0.5))])
put(POL_DET, 'conductivity_ms_cm', [(7.8 if s == 'load' else 12.0) * (1 + e) for s, e in zip(pol_state, ar1(0.004, 0.5))])
put(POL_DET, 'effluent_ph', plus_noise([5.50] * N, 0.01, 0.5))

# ── VF-1: standby; pre-use water flush 13:00–13:30 for tomorrow's run ──
flush = window('13:00', '13:30')
put(VF1, 'vf_flux_lmh', [(90.0 + e) if f else 0.0 for f, e in zip(flush, ar1(1.0, 0.5))])
put(VF1, 'vf_throughput_l_m2', ZERO)
put(VF_PRE, 'filter_dp_bar', [(0.30 + e) if f else 0.0 for f, e in zip(flush, ar1(0.01, 0.5))])
put(VF_FLT, 'vf_pressure_bar', [(2.10 + e) if f else 0.0 for f, e in zip(flush, ar1(0.02, 0.5))])

# ── UFDF-1: standby, then CIP 12:00–13:50 (from CIP-1), then normalized water permeability test ──
uf_cip, uf_nwp = window('12:00', '13:50'), window('13:50', '14:10')
put(UF1, 'tmp_bar', [0.90 if c else (0.70 if n else 0.0) for c, n in zip(uf_cip, uf_nwp)])
put(UF1, 'permeate_flux_lmh', [(55.0 + e) if c else ((30.3 + e * 0.2) if n else 0.0)
                               for c, n, e in zip(uf_cip, uf_nwp, ar1(1.0, 0.5))])
put(UF1, 'retentate_conc_g_l', ZERO)
nwp = [44.1 if not n else f / 0.70 for n, f in zip(uf_nwp, S(UF1, 'permeate_flux_lmh'))]
put(UF_TFF, 'membrane_nwp_lmh_bar', nwp)
put(UF_TANK, 'ret_tank_level_pct', [(30.0 + e) if (c or n) else 0.0 for c, n, e in zip(uf_cip, uf_nwp, ar1(0.5, 0.5))])

# ── BDS-1: frozen storage of batches 26-109 … 26-111 (and 26-108 awaiting shipment) ──
put(BDS1, 'bds_inventory_kg', [118.4] * N)
put(BDS1, 'bds_lots_stored', [4.0] * N)
put(BDS_FF, 'filter_dp_bar', ZERO)
door = interp({'08:00': 0.0, '10:30': 0.0, '10:35': 2.2, '10:45': 1.0, '11:05': 0.1, '11:20': 0.0, '14:05': 0.0})
put(BDS_FRZ, 'freezer_temp_c', [-45.0 + d + e for d, e in zip(door, ar1(0.15))])
put(BDS_FRZ, 'freezer_compressor_duty_pct', [55.0 + 18.0 * d + e for d, e in zip(door, ar1(1.5))])


# ═════════════════════════════════════════════════════════════════════════
# Utilities & support
# ═════════════════════════════════════════════════════════════════════════
# ── CIP-1: circuit 1 = PBR-3 (08:00–09:40), circuit 2 = UFDF-1 (12:00–13:50) ──
CIP_PLAN = [  # (start, step code, supply temp °C, flow L/min, return conductivity mS/cm)
    ('08:00', 1, 25.0, 450.0, 0.05), ('08:10', 2, 75.0, 450.0, 52.0), ('08:45', 3, 30.0, 450.0, None),
    ('08:55', 4, 55.0, 450.0, 9.5), ('09:15', 5, 25.0, 450.0, None), ('09:40', 0, 0.0, 0.0, 0.0),
    ('12:00', 1, 25.0, 150.0, 0.05), ('12:15', 2, 50.0, 150.0, 25.0), ('13:05', 3, 25.0, 150.0, None),
    ('13:15', 5, 25.0, 150.0, None), ('13:50', 0, 0.0, 0.0, 0.0)]
cip_code, cip_temp, cip_flow, cip_cond = [], [], [], []
prev_cond, t_in_step, temp_idle = 0.0, 0, 30.0
for t in TS:
    m = minutes(t)
    st = [p for p in CIP_PLAN if minutes(p[0]) <= m][-1]
    code, temp, fl, cond = st[1], st[2], st[3], st[4]
    since_step = (m - minutes(st[0])) // STEP
    if cond is None:                              # rinse: conductivity decays toward WFI (~1 µS/cm)
        cond = 0.0012 + prev_cond * math.exp(-1.1 * (since_step + 1)) if since_step == 0 else \
            0.0012 + (cip_cond[-1] - 0.0012) * math.exp(-1.1)
    if code == 0:
        temp = 22.0
    cip_code.append(float(code)); cip_temp.append(temp); cip_flow.append(fl); cip_cond.append(cond)
    prev_cond = cond
put(CIP1, 'cip_step_code', cip_code)
put(CIP1, 'cip_supply_temp_c', [t_ + (e if c else 0.0) for t_, c, e in zip(cip_temp, cip_code, ar1(0.3, 0.5))])
put(CIP1, 'cip_supply_flow_l_min', [f + (e if f else 0.0) for f, e in zip(cip_flow, ar1(3.0, 0.5))])
put(CIP1, 'cip_return_conductivity_ms_cm', [c * (1 + e) for c, e in zip(cip_cond, ar1(0.01, 0.5))])
cip_running = [c > 0 for c in cip_code]

# ── MP-1: production medium for batch 26-117 (12,000 L tank), filling with WFI from 11:30 ──
mp_fill = [minutes(t) >= minutes('11:30') for t in TS]
put(MP1, 'media_tank_level_pct', cumsum([2800.0 if f else 0.0 for f in mp_fill], DT_H / 120.0))
put(MP1, 'osmolality_mosm_kg', [(300.0 - 15.0 * math.exp(-(minutes(t) - minutes('11:30')) / 30.0) + e) if f else 0.0
                                for t, f, e in zip(TS, mp_fill, ar1(0.8, 0.6))])
put(MP1, 'media_temp_c', plus_noise([21.0] * N, 0.15))

# ── BP-1: Protein A equilibration/wash buffer (8,000 L); CAP-1 draws on it; new lot made 10:00–11:00 ──
bp_make = window('10:00', '11:00')
bp_draw = [(f * STEP if ph in ('eq', 'wash') else 0.0) for f, ph in zip(S(CAP1, 'skid_flow_l_min'), cap_phase)]
put(BP1, 'buffer_tank_level_pct', cumsum([(2400.0 * DT_H if mk else 0.0) - d for mk, d in zip(bp_make, bp_draw)],
                                         1 / 80.0, 55.0))
put(BP1, 'conductivity_ms_cm', [c + e for c, e in zip(interp({'08:00': 15.2, '10:00': 15.2, '10:10': 11.8, '10:30': 14.6,
                                                              '10:45': 15.2, '14:05': 15.2}), ar1(0.05, 0.6))])
put(BP1, 'buffer_ph', plus_noise([7.40] * N, 0.01, 0.6))

# ── WFI-1: 6-effect still → 30,000 L tank at 85 °C → hot loop (return ≥ 80 °C) ──
still_deg = [min(1.0, h / 4.667) for h in HRS]                      # 08:00 → 12:40 drift (vent half-closed)
still_deg = [d if minutes(t) < minutes(STILL_VENT_FIX) else
             still_deg[i_of(STILL_VENT_FIX)] * math.exp(-(minutes(t) - minutes(STILL_VENT_FIX)) / 12.0)
             for t, d in zip(TS, still_deg)]
still_out = [STILL_OUT0 - (STILL_OUT0 - STILL_OUT_LOW) * d + e for d, e in zip(still_deg, ar1(12.0, 0.7))]
put(WFI_STILL, 'still_output_l_h', still_out)
put(WFI_STILL, 'still_steam_kg_h', [778.0 * (1 + 0.045 * d) + e for d, e in zip(still_deg, ar1(4.0, 0.7))])
draw = [900.0 + (1800.0 if (c and minutes(t) < minutes('10:00')) else 0.0) + (1200.0 if (c and minutes(t) >= minutes('12:00')) else 0.0)
        + (2400.0 if mk else 0.0) + (2800.0 if mf else 0.0) + (500.0 if fl else 0.0) + e
        for t, c, mk, mf, fl, e in zip(TS, cip_running, bp_make, mp_fill, flush, ar1(40.0, 0.6))]
put(WFI1, 'wfi_draw_l_h', draw)
lvl = cumsum([o - d for o, d in zip(S(WFI_STILL, 'still_output_l_h'), S(WFI1, 'wfi_draw_l_h'))], DT_H / 300.0, 72.0)
put(WFI_TANK, 'wfi_tank_level_pct', lvl)
put(WFI_TANK, 'wfi_tank_temp_c', plus_noise([85.0] * N, 0.2))
put(WFI1, 'wfi_available_l', [l * 300.0 for l in S(WFI_TANK, 'wfi_tank_level_pct')])
put(WFI_LOOP, 'loop_return_temp_c', [81.6 - 0.00015 * (d - 900) + e for d, e in zip(draw, ar1(0.2))])
put(WFI_LOOP, 'loop_conductivity_us_cm', plus_noise([0.48] * N, 0.012))
put(WFI_LOOP, 'loop_toc_ppb', plus_noise([72.0] * N, 4.0))
put(WFI_LOOP, 'loop_velocity_m_s', [1.68 - 0.00005 * (d - 900) + e for d, e in zip(draw, ar1(0.01))])

# ── CSG-1: clean steam at 3.0 barg; feed-pump cavitation from 10:10 (root cause of PSIT03) ──
hunt = [(14.0 * math.sin(i * 1.9) if minutes(CSG_LEVEL_HUNT) <= minutes(t) < minutes(CSG_FIXED) else 0.0)
        for i, t in enumerate(TS)]
put(CSG1, 'cs_generator_level_pct', [55.0 + h + e for h, e in zip(hunt, ar1(0.6))])
put(CSG1, 'cs_header_pressure_barg', [p + e for p, e in zip(
    interp({'08:00': 3.0, CSG_DIP: 3.0, '10:30': 1.95, '10:40': 1.62, '10:50': 1.72, '11:05': 1.85,
            CSG_FIXED: 2.90, '11:20': 3.0, '14:05': 3.0}), ar1(0.025, 0.6))])
sip_draw = []
for t in TS:
    m = minutes(t)
    if minutes(SIP1_START) <= m < minutes(CSG_DIP) or minutes(SIP2_START) <= m < minutes('12:05'):
        sip_draw.append(850.0)
    elif minutes(CSG_DIP) <= m < minutes(SIP1_ABORT):
        sip_draw.append(480.0)
    elif minutes('12:05') <= m < minutes(SIP2_END):
        sip_draw.append(320.0)
    else:
        sip_draw.append(0.0)
put(CSG1, 'cs_flow_kg_h', [140.0 + s + e for s, e in zip(sip_draw, ar1(8.0, 0.6))])

# ── AHU-3: post-viral suite HVAC (Grade C rooms, cascade C → airlock → D corridor) ──
fan_a = [72.0 if minutes(t) < minutes(AHU_TRIP) else 0.0 for t in TS]
fan_b = [74.0 if minutes(t) >= minutes(AHU_OK) else 0.0 for t in TS]
put(FAN_A, 'fan_speed_pct', [f + (e if f else 0.0) for f, e in zip(fan_a, ar1(0.3))])
put(FAN_B, 'fan_speed_pct', [f + (e if f else 0.0) for f, e in zip(fan_b, ar1(0.3))])
put(FAN_A, 'fan_motor_current_a', [(31.0 + e) if f else 0.0 for f, e in zip(fan_a, ar1(0.3))])
put(FAN_B, 'fan_motor_current_a', [(32.2 + e) if f else 0.0 for f, e in zip(fan_b, ar1(0.3))])
air = [max(1200.0, 18500.0 * (a + b) / 72.0) for a, b in zip(S(FAN_A, 'fan_speed_pct'), S(FAN_B, 'fan_speed_pct'))]
put(AHU3, 'supply_airflow_m3_h', [a + e for a, e in zip(air, ar1(60.0))])
put(AHU3, 'supply_air_temp_c', [17.5 + (1.3 if a < 5000 else 0.0) + e for a, e in zip(air, ar1(0.1))])
put(HEPA, 'hepa_dp_pa', [max(0.0, 242.0 * (a / 18500.0) ** 2 + e * min(1.0, a / 18500.0)) for a, e in zip(S(AHU3, 'supply_airflow_m3_h'), ar1(1.5))])
air_frac = lagged([min(1.05, a / 18500.0) for a in S(AHU3, 'supply_airflow_m3_h')], k=0.75)
for sensor, base in ((DP_CHROM, 15.2), (DP_UF, 14.1), (DP_AL, 7.6)):
    lo = -1.6 if sensor == DP_AL else 1.0
    put(sensor, 'room_dp_pa', [lo + (base - lo) * min(1.0, f) ** 1.5 + e for f, e in zip(air_frac, ar1(0.25, 0.6))])
put(ROOMS, 'suite_min_dp_pa', [min(S(x, 'room_dp_pa')[i] for x in (DP_CHROM, DP_UF, DP_AL)) for i in range(N)])
put(ROOMS, 'room_temp_c', [20.5 + 1.3 * (1 - min(1.0, f)) + e for f, e in zip(lagged(air_frac, k=0.4), ar1(0.08))])


# ═════════════════════════════════════════════════════════════════════════
# Rollups: process cells, areas, site
# ═════════════════════════════════════════════════════════════════════════
ONE = [1] * N
in_service = {
    SBR1: ONE, PBR[1]: ONE, PBR[2]: ONE, PBR[3]: [0] * N, HRV1: [0] * N,
    CAP1: [0 if ph in ('halt', 'idle') else 1 for ph in cap_phase],
    VIN1: [1 if p > 0 else 0 for p in S(VIN1, 'vi_pool_volume_l')],
    POL1: [0 if s == 'hold' else 1 for s in pol_state],
    VF1: [0] * N, UF1: [0] * N, BDS1: ONE, WFI1: ONE, CSG1: ONE,
    CIP1: [1 if c else 0 for c in cip_running],
    AHU3: [1 if a > 5000 else 0 for a in S(AHU3, 'supply_airflow_m3_h')],
    MP1: [1 if f else 0 for f in mp_fill], BP1: ONE,
}
CELLS = [a['id'] for a in assets if a['assetType'] == 'process_cell']
for c in CELLS:
    units = [u for u in kids[c]]
    put(c, 'units_in_service_count', [float(sum(in_service[u][i] for u in units)) for i in range(N)])
    put(c, 'units_total_count', [float(len(units))] * N)
for area in (USP, DSP, UTIL):
    put(area, 'units_in_service_count', [sum(S(c, 'units_in_service_count')[i] for c in kids[area]) for i in range(N)])


def desc_of_type(root, types):
    out, stack = [], list(kids.get(root, []))
    while stack:
        c = stack.pop()
        if A[c]['assetType'] in types:
            out.append(c)
        stack.extend(kids.get(c, []))
    return out


def sum_of(root, types, key):
    ids = desc_of_type(root, types)
    return [sum(S(x, key)[i] for x in ids) for i in range(N)]


put(USP, 'area_product_mass_kg', sum_of(USP, {'production_bioreactor'}, 'product_mass_kg'))
put(USP, 'area_o2_demand_slpm', sum_of(USP, {'gas_control_module'}, 'o2_flow_slpm'))
put(DSP, 'dsp_load_flow_l_min', sum_of(DSP, {'capture_skid', 'polish_skid'}, 'skid_flow_l_min'))
put(UTIL, 'wfi_draw_l_h', S(WFI1, 'wfi_draw_l_h'))
put(UTIL, 'suite_min_dp_pa', S(ROOMS, 'suite_min_dp_pa'))
put(SITE, 'active_culture_volume_l', sum_of(SITE, {'production_bioreactor'}, 'working_volume_l'))
put(SITE, 'batches_in_process_count', [5.0] * N)
pco2_nor_t = next(t for t, p in zip(TS, S(f'{PBR[2]}_GAS_PCO2', 'pco2_mmhg')) if p > NOR_PCO2)
DEV_TIMES = {'08:00': 2.0, '10:00': 3.0, SIP1_ABORT: 4.0, '12:15': 5.0}
dev = steps(DEV_TIMES)
dev = [d + (1.0 if minutes(t) >= minutes(pco2_nor_t) else 0.0) for t, d in zip(TS, dev)]
put(SITE, 'open_deviations_count', dev)

# ── Current values (spec §5.3): last point of every series; static keys only here ──
values = {}
for aid, props in series.items():
    values[aid] = {}
    for k, s_ in props.items():
        values[aid][k] = s_[-1] if k not in STATIC else rnd(s_[0], PROPS[k][5])
for aid in list(series):
    for k in list(series[aid]):
        if k in STATIC:
            del series[aid][k]

# ═════════════════════════════════════════════════════════════════════════
# Relationships (spec §3.6)
# ═════════════════════════════════════════════════════════════════════════
rels = []


def edge(a, b, layer, label=None):
    assert a in A and b in A, (a, b)
    rels.append({'sourceAssetId': a, 'targetAssetId': b, 'relationshipType': 'feeds_into', 'label': label, 'layer': layer})


# Product path, unit level (seed → production → harvest → capture → VI → polish → VF → UF/DF → BDS)
for k in (1, 2, 3):
    edge(SBR1, PBR[k], 'process_flow', 'seed transfer (next: batch 26-117 → PBR-3)' if k == 3 else 'seed transfer')
    edge(PBR[k], HRV1, 'process_flow', 'harvest')
edge(HRV1, CAP1, 'process_flow', 'clarified harvest')
edge(CAP1, VIN1, 'process_flow', 'Protein A eluate')
edge(VIN1, POL1, 'process_flow', 'neutralized VI pool')
edge(POL1, VF1, 'process_flow', 'CEX pool')
edge(VF1, UF1, 'process_flow', 'virus-filtered pool')
edge(UF1, BDS1, 'process_flow', 'formulated bulk')
# Product path, equipment-module level
edge(HRV_CENT, HRV_DF, 'process_flow', 'centrate')
edge(HRV_DF, HRV_TANK, 'process_flow')
edge(HRV_TANK, CAP_GF, 'process_flow', 'clarified harvest')
edge(CAP_GF, CAP_COL, 'process_flow')
edge(CAP_COL, CAP_DET, 'process_flow')
edge(CAP_DET, VIN_TANK, 'process_flow', 'eluate peak only (UV-gated)')
edge(VIN_DOSE, VIN_TANK, 'chemical_dosing', 'acid to pH 3.6, base to neutralize')
edge(VIN_TANK, POL_AEX, 'process_flow')
edge(POL_AEX, POL_COL, 'process_flow', 'AEX flow-through loads CEX')
edge(POL_COL, POL_DET, 'process_flow')
edge(POL_DET, VF_PRE, 'process_flow')
edge(VF_PRE, VF_FLT, 'process_flow')
edge(VF_FLT, UF_TANK, 'process_flow')
edge(UF_TANK, UF_TFF, 'process_flow', 'retentate feed')
edge(UF_TFF, UF_TANK, 'process_flow', 'retentate return (recirculation loop)')
edge(UF_TANK, BDS_FF, 'process_flow')
edge(BDS_FF, BDS_FRZ, 'process_flow', 'filled DS bottles')
# Inside a bioreactor: gas path and control signals
for u in (SBR1, PBR[1], PBR[2], PBR[3]):
    edge(f'{u}_GAS_DOA', f'{u}_GAS', 'control', 'DO cascade (air → O₂)')
    edge(f'{u}_PH_BASE', f'{u}_PH', 'chemical_dosing', 'base addition')
    edge(f'{u}_GAS', f'{u}_PH', 'control', 'CO₂ sparge is the acid-side pH actuator')
for k in (1, 2, 3):
    edge(f'{PBR[k]}_GAS', f'{PBR[k]}_EXH', 'off_gas', 'sparge + overlay off-gas')
    edge(MP1, f'{PBR[k]}_FEED', 'media', 'feed medium')
edge(MP1, PBR[3], 'media', 'batch medium fill (26-117)')
edge(MP1, SBR1, 'media', 'seed medium')
# Buffers
for u in (CAP1, POL1, VIN1, UF1):
    edge(BP1, u, 'buffer', 'process buffers')
# WFI (with the still → tank → loop → tank cycle)
edge(WFI_STILL, WFI_TANK, 'wfi', 'distillate')
edge(WFI_TANK, WFI_LOOP, 'wfi', 'loop supply')
edge(WFI_LOOP, WFI_TANK, 'wfi', 'loop return (≥ 80 °C)')
for u in (MP1, BP1, CIP1, VF1):
    edge(WFI_LOOP, u, 'wfi', 'point of use')
# Clean steam (SIP)
for u in (SBR1, PBR[1], PBR[2], PBR[3], HRV1, VIN1):
    edge(CSG1, u, 'clean_steam', 'SIP')
# CIP circuits. Only the supply side is drawn: a return edge back to CIP-1 makes the skid appear twice in
# a unit's Related Assets view (one row per direction), which reads as a duplicate in the demo.
for u in (SBR1, PBR[1], PBR[2], PBR[3], HRV1, UF1):
    edge(CIP1, u, 'cip', 'CIP supply / return')
# HVAC: AHU-3 serves the post-viral suite
edge(FAN_A, HEPA, 'hvac')
edge(FAN_B, HEPA, 'hvac', 'standby fan')
edge(HEPA, ROOMS, 'hvac', 'supply air to Rm 2.14, 2.16, AL-7')
for u in (POL1, VF1, UF1, BDS1):
    edge(AHU3, u, 'hvac', 'post-viral suite air')

# ═════════════════════════════════════════════════════════════════════════
# Unit status (spec §6.6)
# ═════════════════════════════════════════════════════════════════════════
PRODUCT = {
    SBR1: 'N-1 seed · batch 26-117', PBR[1]: 'SLP-201 · batch 26-114 (day 13)',
    PBR[2]: 'SLP-201 · batch 26-116 (day 7)', PBR[3]: 'Turnaround → batch 26-117',
    HRV1: 'Ready · harvest 26-114 tomorrow', CAP1: 'Batch 26-113 · Protein A cycle 5/8',
    VIN1: 'Batch 26-113 · eluate pool', POL1: 'Batch 26-112 · AEX/CEX polish',
    VF1: 'Pre-use flush done · 26-112 next', UF1: 'CIP complete · NWP test',
    BDS1: 'Frozen DS · 4 lots', WFI1: 'WFI hot loop (80 °C)', CSG1: 'Clean steam 3 bar(g)',
    CIP1: 'CIP circuits', AHU3: 'Post-viral suite (Grade C)', MP1: 'Production medium · 26-117',
    BP1: 'Protein A buffers · 26-113',
}
unit_status = {u: {'state': 'running', 'statusSinceMinutes': None, 'mode': 'STEADY', 'product': PRODUCT[u]}
               for u in UNITS}
# PBR-3 has been in turnaround since batch 26-113 was harvested yesterday at 18:30 (dirty hold, then CIP/SIP today)
unit_status[PBR[3]].update({'state': 'changeover', 'mode': 'CHANGEOVER', 'statusSinceMinutes': NOW_MIN + 24 * 60 - (18 * 60 + 30)})
unit_status[UF1].update({'state': 'changeover', 'mode': 'CHANGEOVER', 'statusSinceMinutes': NOW_MIN - minutes('12:00')})
unit_status[HRV1]['mode'] = 'STANDBY'
unit_status[VF1]['mode'] = 'STANDBY'


# ═════════════════════════════════════════════════════════════════════════
# Attention items — evidence read back from the series
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


def since(t):
    return NOW_MIN - minutes(t)


def fmt(v, key):
    unit, d = PROPS[key][1], min(PROPS[key][5], 2)
    s_ = f'{v:,.{d}f}'
    if unit == '%':
        return f'{s_}%'
    return f'{s_} {unit}' if unit else s_


def v(aid, key, t):
    return S(aid, key)[i_of(t)]


def rng_(aid, key, t0, t1):
    return S(aid, key)[i_of(t0):i_of(t1) + 1]


def mean_(xs):
    return sum(xs) / len(xs)


def hhmm(total_min):
    total_min = int(round(total_min / 5.0) * 5)
    return f'{total_min // 60:02d}:{total_min % 60:02d}'


def since_text(mins, resolved):
    h, m = divmod(mins, 60)
    body = f'{h}h {m}m ago' if h else f'{m}m ago'
    return f'Resolved {body}' if resolved else body


def item(iid, aid, key, points, severity, state, outcome, since_t, signal, interp_text, detail):
    ev, evp = [], []
    for t, note in points:
        x = v(aid, key, t)
        ev.append(x)
        evp.append({'time': t, 'value': fmt(x, key), 'label': note})
    unit_id = unit_of(aid)
    mins = since(since_t)
    return {
        'id': iid, 'assetId': aid, 'unitId': unit_id, 'primaryProperty': key,
        'asset': label_of(aid) if unit_id else A[aid]['name'],
        'line': A[unit_id]['name'] if unit_id else A[aid]['name'],
        'severity': severity, 'signal': signal, 'aiInterpretation': interp_text,
        'since': since_text(mins, outcome == 'resolved'), 'sinceMinutes': mins, 'attentionState': state,
        'detail': {**detail, 'evidence': ev, 'evidencePoints': evp, 'outcomeStatus': outcome},
    }


P1U, P2U, P3U = PBR[1], PBR[2], PBR[3]
q = {}
# PSIT01 — PBR-1 agitation
q['vib0'], q['vib_now'] = v(f'{P1U}_AGIT', 'gearbox_vibration_mms', AGIT_START), v(f'{P1U}_AGIT', 'gearbox_vibration_mms', '14:05')
q['seal0'], q['seal_now'] = v(f'{P1U}_AGIT', 'seal_temp_c', AGIT_START), v(f'{P1U}_AGIT', 'seal_temp_c', '14:05')
q['kw0'], q['kw_now'] = v(f'{P1U}_AGIT', 'agitator_power_kw', AGIT_START), v(f'{P1U}_AGIT', 'agitator_power_kw', '14:05')
q['vib_p2'] = v(f'{P2U}_AGIT', 'gearbox_vibration_mms', '14:05')
q['vib_rate'] = (q['vib_now'] - v(f'{P1U}_AGIT', 'gearbox_vibration_mms', '13:05'))
q['to_alarm_h'] = (7.1 - q['vib_now']) / max(q['vib_rate'], 0.01)
# PSIT02 — SBR-1 DO probe B
dob, doa = f'{SBR1}_GAS_DOB', f'{SBR1}_GAS_DOA'
q['dob_min'], q['dob_max'] = min(rng_(dob, 'do_pct', *DOB_WINDOW)), max(rng_(dob, 'do_pct', *DOB_WINDOW))
q['doa_min'], q['doa_max'] = min(rng_(doa, 'do_pct', *DOB_WINDOW)), max(rng_(doa, 'do_pct', *DOB_WINDOW))
q['qb_min'] = min(rng_(dob, 'probe_quality_index', *DOB_WINDOW))
q['o2_rng'] = max(rng_(f'{SBR1}_GAS', 'o2_flow_slpm', *DOB_WINDOW)) - min(rng_(f'{SBR1}_GAS', 'o2_flow_slpm', *DOB_WINDOW))
# PSIT03 — PBR-3 SIP cold point / CSG-1
q['drain_pk1'] = max(rng_(f'{P3U}_TEMP', 'drain_temp_c', SIP1_START, SIP1_ABORT))
q['vessel_pk1'] = max(rng_(f'{P3U}_TEMP', 'culture_temp_c', SIP1_START, SIP1_ABORT))
q['cs_min'] = min(rng_(CSG1, 'cs_header_pressure_barg', CSG_DIP, CSG_FIXED))
q['lvl_min'] = min(rng_(CSG1, 'cs_generator_level_pct', CSG_LEVEL_HUNT, CSG_FIXED))
q['lvl_max'] = max(rng_(CSG1, 'cs_generator_level_pct', CSG_LEVEL_HUNT, CSG_FIXED))
q['drain_hold'] = min(rng_(f'{P3U}_TEMP', 'drain_temp_c', SIP2_HOLD, '13:05'))
q['f0'] = sum(10 ** ((x - 121.1) / 10) * STEP for x in rng_(f'{P3U}_TEMP', 'drain_temp_c', SIP2_HOLD, '13:05'))
# PSIT04 — CAP-1 trip
q['gf0'] = v(CAP_GF, 'filter_dp_bar', '09:30')
q['f_before'] = v(CAP1, 'skid_flow_l_min', '09:50')
q['gf_pk'] = v(CAP_GF, 'filter_dp_bar', '09:50')
q['gf_new'] = v(CAP_GF, 'filter_dp_bar', '10:45')
q['c2_loaded'] = v(CAP1, 'load_processed_l', '09:50') - v(CAP1, 'load_processed_l', '09:15')
q['bp_level'] = v(BP1, 'buffer_tank_level_pct', '10:40')
# PSIT05 — CAP-1 breakthrough
q['bt'] = [v(CAP_COL, 'breakthrough_pct', t) for t in ('08:45', '10:40', '11:50', '13:00')]
q['bt_now'] = v(CAP_COL, 'breakthrough_pct', '14:05')
q['cyc_now'] = values[CAP_COL]['resin_cycles']
q['cdp0'], q['cdp_now'] = v(CAP_COL, 'column_dp_bar', '08:20'), v(CAP_COL, 'column_dp_bar', '13:45')
q['loadvol'] = v(CAP1, 'load_processed_l', '14:05')
q['cyc_kg'] = 1400 * 5.4 / 1000                      # ≈1,400 L load per cycle at 5.4 g/L harvest titer
q['loss_kg'] = sum(STEP_YIELD[0] - y for y in STEP_YIELD[1:]) / 100 * q['cyc_kg']
# PSIT06 — AHU-3
q['air0'], q['air_min'] = v(AHU3, 'supply_airflow_m3_h', '12:05'), min(rng_(AHU3, 'supply_airflow_m3_h', AHU_TRIP, '12:20'))
q['dp_ch0'], q['dp_ch_min'] = v(DP_CHROM, 'room_dp_pa', '12:05'), min(rng_(DP_CHROM, 'room_dp_pa', AHU_TRIP, '12:30'))
q['dp_al_min'] = min(rng_(DP_AL, 'room_dp_pa', AHU_TRIP, '12:30'))
q['dp_ok_t'] = next(t for t in TS[i_of(AHU_OK):] if v(ROOMS, 'suite_min_dp_pa', t) >= 5.0)
q['rt_pk'] = max(rng_(ROOMS, 'room_temp_c', AHU_TRIP, '12:45'))
q['pol_lost_l'] = 30.0 * (minutes(POL_RESUME) - minutes(AHU_TRIP))
# PSIT07 — PBR-2 pCO2
pco2 = f'{P2U}_GAS_PCO2'
q['pc0'], q['pc_now'] = v(pco2, 'pco2_mmhg', PCO2_START), v(pco2, 'pco2_mmhg', '14:05')
q['pc_rate'] = (q['pc_now'] - v(pco2, 'pco2_mmhg', '13:05'))
q['par_eta'] = NOW_MIN + (PAR_PCO2 - q['pc_now']) / q['pc_rate'] * 60
q['ph0'], q['ph_now'] = v(f'{P2U}_PH', 'culture_ph', '10:10'), v(f'{P2U}_PH', 'culture_ph', '14:05')
q['bp0'], q['bp_now'] = mean_(rng_(f'{P2U}_PH_BASE', 'base_pump_rate_ml_min', '09:00', '10:10')), mean_(rng_(f'{P2U}_PH_BASE', 'base_pump_rate_ml_min', '13:35', '14:05'))
q['osm0'], q['osm_now'] = v(P2U, 'osmolality_mosm_kg', '10:10'), v(P2U, 'osmolality_mosm_kg', '14:05')
q['co2_0'], q['co2_now'] = v(f'{P2U}_GAS', 'co2_flow_slpm', '10:10'), v(f'{P2U}_GAS', 'co2_flow_slpm', '14:05')
q['off0'], q['off_now'] = v(f'{P2U}_EXH', 'exhaust_co2_pct', '10:10'), v(f'{P2U}_EXH', 'exhaust_co2_pct', '14:05')
q['vcd2'] = v(P2U, 'vcd_e6_ml', '14:05')
q['pc_p1'] = v(f'{P1U}_GAS_PCO2', 'pco2_mmhg', '14:05')
# PSIT08 — WFI still
q['so0'], q['so_low'] = v(WFI_STILL, 'still_output_l_h', '08:00'), min(rng_(WFI_STILL, 'still_output_l_h', '11:00', STILL_VENT_FIX))
q['ss0'], q['ss_pk'] = v(WFI_STILL, 'still_steam_kg_h', '08:00'), max(rng_(WFI_STILL, 'still_steam_kg_h', '11:00', STILL_VENT_FIX))
q['so_ok'] = v(WFI_STILL, 'still_output_l_h', STILL_OK)
q['ssc'] = 100 * ((q['ss_pk'] / q['so_low']) / (q['ss0'] / q['so0']) - 1)
q['lvl_min_wfi'] = min(S(WFI_TANK, 'wfi_tank_level_pct'))
# PSIT09 — PBR-2 feed pump
fp = f'{P2U}_FEED_PUMP'
q['stops'] = len(FEED_STOPS)
q['short_pk'] = max(short)
q['glu0'], q['glu_min'] = v(f'{P2U}_FEED', 'glucose_g_l', '08:30'), min(S(f'{P2U}_FEED', 'glucose_g_l'))
q['glu_now'] = v(f'{P2U}_FEED', 'glucose_g_l', '14:05')
q['int_pk'] = max(S(fp, 'feed_interruptions_1h'))
# PSIT10 — PBR-1 viability
q['via0'], q['via_flag'], q['via_now'] = v(P1U, 'viability_pct', '08:00'), v(P1U, 'viability_pct', VIAB_FLAG), v(P1U, 'viability_pct', '14:05')
q['via_rate'] = (v(P1U, 'viability_pct', '12:05') - q['via_now']) / 2
q['via_eta'] = NOW_MIN + (q['via_now'] - 70.0) / q['via_rate'] * 60
q['forecast_now'] = VIAB0 - 0.35 * 6.083
q['tit0'], q['tit_now'] = v(P1U, 'titer_g_l', '08:00'), v(P1U, 'titer_g_l', '14:05')
q['vcd1_0'], q['vcd1_now'] = v(P1U, 'vcd_e6_ml', '08:00'), v(P1U, 'vcd_e6_ml', '14:05')
# PSIT11 — SBR-1 seed window vs PBR-3 readiness
q['svcd_now'] = v(SBR1, 'seed_vcd_e6_ml', '14:05')
q['svcd_18'] = q['svcd_now'] * math.exp(k_seed * (minutes(TRANSFER_PLAN) - NOW_MIN) / 60)
q['svcd_cross'] = NOW_MIN + math.log(TRANSFER_MAX / q['svcd_now']) / k_seed * 60
q['ready'] = minutes(SIP_DONE) + sum(m_ for _, m_ in READY_STEPS)
q['gap'] = q['ready'] - q['svcd_cross']
q['need'] = q['ready'] - NOW_MIN
q['left'] = q['svcd_cross'] - NOW_MIN

attention = [
    item('PSIT01', f'{P1U}_AGIT', 'gearbox_vibration_mms',
         [(AGIT_START, 'Divergence begins'), ('10:30', ''), ('11:30', ''), ('12:30', ''), ('13:15', ''), ('13:45', ''),
          ('14:05', f'Current — PBR-2 reads {q["vib_p2"]:.1f} mm/s')],
         'medium', 'investigate', 'none', AGIT_START,
         'PBR-1 agitator gearbox vibration climbing at constant speed',
         'Gearbox vibration on PBR-1\'s agitator has more than doubled since about 09:20 while speed stayed at 48 rpm, and the mechanical seal is running warmer. PBR-2\'s identical drive is flat. The batch has one day left before harvest.',
         {'signal': f'Gearbox vibration {q["vib_now"]:.1f} mm/s at 14:05, up from {q["vib0"]:.1f} at 09:20 (alert 4.5, alarm 7.1). Seal temperature {q["seal0"]:.0f} → {q["seal_now"]:.0f} °C.',
          'observed': f'Agitator speed steady at 48 rpm; power up slightly ({q["kw0"]:.1f} → {q["kw_now"]:.2f} kW). DO, pH and temperature control normal. PBR-2\'s gearbox, same model, reads {q["vib_p2"]:.1f} mm/s.',
          'derived': f'Vibration, seal temperature and power are rising together at unchanged speed, so it is the drive, not the process. The rise is accelerating: {q["vib_rate"]:.1f} mm/s in the last hour, which would reach the 7.1 alarm in about {q["to_alarm_h"]:.0f} hours if it continues.',
          'inferred': 'Possible gearbox bearing wear or lubrication loss, with heat reaching the bottom-mounted mechanical seal. Not yet confirmed.',
          'recommendation': 'Take a portable vibration spectrum and check gearbox oil level and seal barrier condensate. Do not stop the agitator mid-batch; agree a plan with MS&T to reach tomorrow\'s 08:00 harvest, or harvest early if the seal barrier pressure drops.',
          'relatedOccurrences': [{'date': '2026-03-11', 'summary': 'PBR-3 agitator gearbox bearing replaced at turnaround after a slow vibration rise over one batch.'}],
          'whatChangedSummary': 'No speed, setpoint or maintenance change on PBR-1 today.',
          'whatChanged': [{'time': AGIT_START, 'source': 'Event', 'description': 'PBR-1 gearbox vibration leaves its normal band.', 'related': True},
                          {'time': '12:40', 'source': 'Alarm', 'description': 'Seal temperature high (advisory, 50 °C).', 'related': True}],
          'confidence': 'Three related signals agree; cause not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'Medium — a seal failure mid-batch is a sterility breach and loses ~64 kg of antibody', 'riskLevel': 'medium',
          'expectedOutcome': 'Batch reaches harvest; gearbox inspected at turnaround'}),
    item('PSIT02', f'{SBR1}_GAS_DOB', 'do_pct',
         [('09:30', 'Normal'), ('09:35', 'First jump'), ('09:50', ''), ('10:10', ''), ('10:25', 'Lowest reading'),
          ('10:35', ''), (DOB_FIXED, 'Connector reseated')],
         'medium', 'watch', 'resolved', DOB_FIXED,
         'SBR-1 DO probe B jumping — probe A, O₂ flow and cells all say otherwise',
         'The seed bioreactor\'s monitoring DO probe swung between 14% and 64% for an hour. Control probe A held 40%, the O₂ sparge never moved and the culture kept growing, so the process was fine: a loose probe cable connector.',
         {'signal': f'DO probe B read between {q["dob_min"]:.0f}% and {q["dob_max"]:.0f}% from 09:35 to 10:40; probe A stayed between {q["doa_min"]:.1f}% and {q["doa_max"]:.1f}%.',
          'observed': f'O₂ sparge flow varied by only {q["o2_rng"]:.1f} slpm over the window; pCO₂, pH and viable cell density on trend. Probe B\'s own signal-quality index fell to {q["qb_min"]:.0f} (normal ~96).',
          'derived': 'A real DO swing of that size would move the DO cascade and both probes together. Only one probe moved, and its diagnostic dropped with it — an instrument fault, not the culture.',
          'inferred': 'Intermittent connection in the probe B cable; confirmed when the connector was found loose.',
          'recommendation': 'Record the probe B excursion in the batch record as an instrument event (no process impact); check the connector strain relief before the next SIP.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Instrument technician reseated the probe B connector at 10:40; readings normal from 10:45.',
          'whatChanged': [{'time': '09:35', 'source': 'Alarm', 'description': 'SBR-1 DO B deviation from DO A (> 5 %).', 'related': True},
                          {'time': '09:48', 'source': 'Operator Action', 'description': 'Operator confirmed control is on probe A; O₂ flow unchanged.', 'related': True},
                          {'time': '10:40', 'source': 'Maintenance', 'description': 'Probe B cable connector found loose and reseated.', 'related': True}],
          'confidence': 'Confirmed by field check', 'confidenceLevel': 'high',
          'risk': 'Low — control never used probe B; the seed was unaffected', 'riskLevel': 'low',
          'expectedOutcome': 'Probe B tracking probe A; event documented'}),
    item('PSIT03', f'{P3U}_TEMP', 'drain_temp_c',
         [(SIP1_START, 'SIP #1 starts'), ('10:25', ''), ('10:40', 'Stalls below 121.1 °C'), (SIP1_ABORT, 'SIP aborted'),
          (SIP2_START, 'SIP #2 starts'), (SIP2_HOLD, 'Hold achieved'), (SIP_DONE, 'SIP complete')],
         'high', 'watch', 'resolved', SIP_DONE,
         'PBR-3 SIP failed on the drain cold point — the cause was the clean steam supply',
         'PBR-3\'s first sterilization never got its drain thermocouple to 121.1 °C and was aborted. The vessel was fine: the clean steam header had sagged from 3.0 to about 1.7 bar(g) because CSG-1\'s feed pump was cavitating. After the strainer was cleaned the second SIP passed.',
         {'signal': f'Drain (cold point) temperature peaked at {q["drain_pk1"]:.1f} °C at 10:40 during SIP #1 (target ≥ 121.1 °C for the hold); vessel reached {q["vessel_pk1"]:.1f} °C.',
          'observed': f'CSG-1 generator level began hunting between {q["lvl_min"]:.0f}% and {q["lvl_max"]:.0f}% at 10:10; header pressure fell to {q["cs_min"]:.2f} bar(g) from 10:20; vessel pressure dropped from 1.10 to 0.92 bar(g) at the same time. Steam traps on PBR-3 checked OK.',
          'derived': 'The steam supply problem started 10–20 minutes before the cold spot and explains it: lower steam pressure means a lower saturation temperature and slower purging of air and condensate from the drain leg.',
          'inferred': 'Clean steam generator feed pump cavitation (blocked suction strainer); confirmed when the strainer was cleaned at 11:10.',
          'recommendation': 'Close the deviation with CSG-1 as root cause; add the feed-pump strainer to the CSG-1 PM route. PBR-3 SIP #2 passed and can proceed to the pressure hold.',
          'relatedOccurrences': [{'date': '2026-05-21', 'summary': 'HRV-1 SIP extended 20 min when clean steam pressure dipped during a simultaneous VIN-1 SIP.'}],
          'whatChangedSummary': f'CSG-1 strainer cleaned 11:10; SIP #2 held all points ≥ 121.1 °C from 12:10 to 13:10 (drain min {q["drain_hold"]:.1f} °C, F₀ ≈ {q["f0"]:.0f} min).',
          'whatChanged': [{'time': CSG_LEVEL_HUNT, 'source': 'Event', 'description': 'CSG-1 generator level starts hunting.', 'related': True},
                          {'time': CSG_DIP, 'source': 'Alarm', 'description': 'Clean steam header pressure low (2.5 bar(g)).', 'related': True},
                          {'time': SIP1_ABORT, 'source': 'Event', 'description': 'PBR-3 SIP #1 aborted — cold point below 121.1 °C at hold start. Deviation raised.', 'related': True},
                          {'time': '11:10', 'source': 'Maintenance', 'description': 'CSG-1 feed pump suction strainer cleaned; level steady.', 'related': True},
                          {'time': SIP2_START, 'source': 'Operator Action', 'description': 'PBR-3 SIP #2 started.', 'related': True}],
          'confidence': 'Confirmed — steam supply restored, SIP #2 passed', 'confidenceLevel': 'high',
          'risk': 'Low now, but the lost 95 minutes put the 26-117 seed transfer at risk (PSIT11)', 'riskLevel': 'low',
          'expectedOutcome': 'PBR-3 sterile and ready for pressure hold'}),
    item('PSIT04', CAP1, 'skid_flow_l_min',
         [('09:30', 'Cycle 2 loading'), ('09:45', 'Guard filter DP climbing'), ('09:50', ''), (CAP_TRIP, 'Pump stopped — DP high-high'),
          ('10:20', ''), (CAP_RESTART, 'Restarted on new filter'), ('11:05', 'Cycle 3 starts')],
         'high', 'watch', 'resolved', CAP_RESTART,
         'CAP-1 stopped mid-load — guard filter pressure high-high',
         'The Protein A skid shut its feed pump during cycle 2 when the guard filter in front of the column hit its 2.5 bar interlock. The column itself was fine. The filter was replaced and the load resumed after 45 minutes, inside the validated 4-hour load hold.',
         {'signal': f'Skid flow went from {q["f_before"]:.0f} L/min (second stage of the dual-flow load) to 0 at 09:55; guard filter DP rose from {q["gf0"]:.2f} bar at 09:30 to {q["gf_pk"]:.2f} bar at 09:50.',
          'observed': f'{q["c2_loaded"]:,.0f} L of cycle 2 load was on the column when it stopped. Column DP normal before and after; after the filter change the guard filter read {q["gf_new"]:.2f} bar at full flow.',
          'derived': 'Only the guard filter DP rose, and fast (minutes, not cycles) — a filter plugging with fines, not column fouling or a compressed bed.',
          'inferred': 'Guard filter plugged by fines in the clarified harvest; the harvest hold tank sample showed higher-than-usual turbidity (27 NTU vs < 10).',
          'recommendation': 'Record the interruption and the hold time in the batch record; send the used filter and a harvest sample to QC; ask MS&T to review HRV-1 depth-filter performance before tomorrow\'s harvest.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Guard filter replaced 10:35; cycle 2 load resumed at 10:40 and completed; cycles 3–5 ran normally.',
          'whatChanged': [{'time': CAP_TRIP, 'source': 'Alarm', 'description': 'CAP-1 guard filter DP high-high — feed pump interlock.', 'related': True},
                          {'time': '10:00', 'source': 'Operator Action', 'description': 'Load hold started (validated limit 4 h); deviation raised.', 'related': True},
                          {'time': '10:35', 'source': 'Maintenance', 'description': 'Guard filter replaced and integrity-checked.', 'related': True},
                          {'time': CAP_RESTART, 'source': 'Operator Action', 'description': 'Cycle 2 load resumed.', 'related': True}],
          'confidence': 'Confirmed — DP normal on the new filter', 'confidenceLevel': 'high',
          'risk': 'Low — resumed well inside the hold time; about 50 minutes lost on the purification schedule', 'riskLevel': 'low',
          'expectedOutcome': 'Cycles 3–8 on the new filter; QC result on the filter and harvest sample'}),
    item('PSIT05', CAP_COL, 'breakthrough_pct',
         [('08:45', 'Cycle 1 end of load'), ('10:40', 'Cycle 2'), ('11:50', 'Cycle 3'), ('13:00', 'Cycle 4'),
          ('13:45', ''), ('14:00', ''), ('14:05', 'Cycle 5 (still loading)')],
         'medium', 'investigate', 'none', '11:50',
         'Protein A cycles on schedule — but more antibody is going out with the flow-through each cycle',
         'Every CAP-1 cycle today has loaded the same volume on time, so the purification plan looks on track. But the flow-through breakthrough at the end of each load has risen from about 1% to over 4%, and the step yield has fallen with it.',
         {'signal': f'End-of-load breakthrough: {q["bt"][0]:.1f}% → {q["bt"][1]:.1f}% → {q["bt"][2]:.1f}% → {q["bt"][3]:.1f}% (cycles 1–4); cycle 5 is already at {q["bt_now"]:.1f}% with a sample still to go.',
          'observed': f'Step yield {STEP_YIELD[0]:.1f}% → {STEP_YIELD[1]:.1f}% → {STEP_YIELD[2]:.1f}% → {STEP_YIELD[3]:.1f}%. Load volume, flow and residence time are identical every cycle; column DP unchanged ({q["cdp0"]:.2f} vs {q["cdp_now"]:.2f} bar). Resin is on cycle {q["cyc_now"]:.0f} of its 200-cycle validated lifetime.',
          'derived': f'The headline (volume processed, cycles on time) hides a loss of about {q["loss_kg"]:.1f} kg of antibody over cycles 2–4 compared with cycle 1. The trend is cycle-over-cycle, not a one-off, and the guard-filter event (PSIT04) does not explain cycles 3 and 4.',
          'inferred': 'Possible loss of dynamic binding capacity (resin near end of life, or incomplete regeneration), or a higher harvest titer than the load volume assumes. Not yet confirmed.',
          'recommendation': 'Ask QC for a rush titer on the cycle 4 flow-through and the harvest pool; if capacity is down, reduce load per cycle for cycles 6–8 per the batch record\'s load-challenge range and bring forward the column repack.',
          'relatedOccurrences': [{'date': '2026-07-02', 'summary': 'CAP-1 DBC check at cycle 160 was 88% of initial (alert limit 85%).'}],
          'whatChangedSummary': 'No recipe or buffer change; new buffer lot from BP-1 in use since cycle 3.',
          'whatChanged': [{'time': '10:40', 'source': 'Maintenance', 'description': 'Guard filter replaced (PSIT04).', 'related': False},
                          {'time': '11:05', 'source': 'Event', 'description': 'Cycle 3 starts on the new BP-1 buffer lot.', 'related': False}],
          'confidence': 'Loss is measured; cause not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'Medium — about 0.3 kg of antibody lost per cycle and rising; cycles 6–8 still to run', 'riskLevel': 'medium',
          'expectedOutcome': 'Breakthrough back under 1.5% on cycles 6–8'}),
    item('PSIT06', AHU3, 'supply_airflow_m3_h',
         [('12:05', 'Normal'), (AHU_TRIP, 'Fan A trips'), ('12:15', ''), ('12:20', ''), (AHU_OK, 'Fan B running'),
          ('12:35', ''), (POL_RESUME, 'POL-1 resumed')],
         'high', 'watch', 'recovering', POL_RESUME,
         'AHU-3 lost its supply fan — post-viral suite pressures collapsed and POL-1 was stopped',
         'AHU-3\'s duty fan tripped on a drive fault at 12:10. Room pressures in the post-viral suite fell to near zero and the airlock reversed, so POL-1 was put on hold. The standby fan was started at 12:22 and pressures recovered by 12:30.',
         {'signal': f'Supply airflow fell from {q["air0"]:,.0f} to {q["air_min"]:,.0f} m³/h at 12:10. Chromatography room DP {q["dp_ch0"]:.1f} → {q["dp_ch_min"]:.1f} Pa; airlock AL-7 reversed to {q["dp_al_min"]:.1f} Pa.',
          'observed': f'Room temperature peaked at {q["rt_pk"]:.1f} °C. POL-1 on hold 12:10–12:50 (about {q["pol_lost_l"]:,.0f} L of load deferred). Room DPs back above 5 Pa at {q["dp_ok_t"]}.',
          'derived': 'One cause (the fan) produced every downstream symptom in order: airflow, then room pressures, then the processing hold. UF/DF CIP and the DS freezer were not affected.',
          'inferred': 'Fan A variable-speed drive tripped on overcurrent; drive fault log confirms.',
          'recommendation': 'Keep Fan B on duty. Wait for the post-excursion EM plates (read at 48–72 h) before dispositioning POL-1\'s hold; raise a work order on the Fan A drive.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Standby Fan B started 12:22; pressures normal from 12:30; POL-1 resumed 12:50 after a room clearance check. EM results pending.',
          'whatChanged': [{'time': AHU_TRIP, 'source': 'Alarm', 'description': 'AHU-3 Fan A drive fault; post-viral suite DP low alarms.', 'related': True},
                          {'time': '12:12', 'source': 'Operator Action', 'description': 'POL-1 placed on hold; open connections suspended.', 'related': True},
                          {'time': '12:15', 'source': 'Event', 'description': 'Deviation raised for the pressure-cascade excursion.', 'related': True},
                          {'time': FANB_START, 'source': 'Operator Action', 'description': 'Standby Fan B started.', 'related': True},
                          {'time': '12:40', 'source': 'Field Check', 'description': 'Post-excursion EM air and surface samples taken.', 'related': True},
                          {'time': POL_RESUME, 'source': 'Operator Action', 'description': 'POL-1 resumed after QA clearance.', 'related': True}],
          'confidence': 'Confirmed — drive fault log', 'confidenceLevel': 'high',
          'risk': 'Medium until the EM results are in — POL-1 disposition waits on them', 'riskLevel': 'medium',
          'expectedOutcome': 'EM results within limits; Fan A drive repaired'}),
    item('PSIT07', f'{P2U}_GAS_PCO2', 'pco2_mmhg',
         [('10:10', 'Normal'), (PCO2_START, 'Starts rising'), ('11:15', ''), (pco2_nor_t, 'Above NOR (120)'), ('13:00', ''),
          ('13:35', ''), ('14:05', 'Current')],
         'high', 'act', 'none', PCO2_START,
         'PBR-2 dissolved CO₂ building up — past its normal range and heading for the proven acceptable limit',
         f'pCO₂ in PBR-2 has risen steadily since about 10:15 and left its normal operating range (≤ {NOR_PCO2:.0f} mmHg) at {pco2_nor_t}. The pH has sunk to the bottom of its dead band, the pH loop has all but stopped sparging CO₂ and is pumping more base, and osmolality is creeping up. At this rate pCO₂ reaches the {PAR_PCO2:.0f} mmHg PAR limit around {hhmm(q["par_eta"])}.',
         {'signal': f'pCO₂ {q["pc_now"]:.0f} mmHg at 14:05, up from {q["pc0"]:.0f} at 10:15; rising about {q["pc_rate"]:.0f} mmHg/h (NOR ≤ {NOR_PCO2:.0f}, PAR ≤ {PAR_PCO2:.0f}).',
          'observed': f'Culture pH {q["ph0"]:.2f} → {q["ph_now"]:.2f}; CO₂ sparge {q["co2_0"]:.0f} → {q["co2_now"]:.0f} slpm; base pump {q["bp0"]:.0f} → {q["bp_now"]:.0f} mL/min; osmolality {q["osm0"]:.0f} → {q["osm_now"]:.0f} mOsm/kg; off-gas CO₂ {q["off0"]:.1f} → {q["off_now"]:.1f}%. VCD {q["vcd2"]:.1f} ×10⁶/mL (near peak). DO steady at 40%. PBR-1 pCO₂ steady at {q["pc_p1"]:.0f} mmHg.',
          'derived': 'CO₂ is being produced faster than it is being stripped. The pH loop is already doing what it can (CO₂ sparge almost off); the extra base it adds raises osmolality, so waiting makes two CPPs worse.',
          'inferred': 'Hypotheses: reduced CO₂ stripping (headspace overlay or sparge air lower than the recipe), or higher CO₂ production at peak cell density. Not yet diagnosed.',
          'recommendation': 'Check the overlay and air-sparge flows against the day-7 recipe values and restore them if they differ; if pCO₂ is still rising in 30 minutes, raise air sparge within its NOR per SOP. Take an offline blood-gas sample to confirm the probe. Notify QA of the NOR excursion.',
          'relatedOccurrences': [{'date': '2026-06-19', 'summary': 'PBR-1 pCO₂ reached 135 mmHg on day 8; recovered after overlay was increased.'}],
          'whatChangedSummary': 'Planned exhaust filter swap at 10:05; pCO₂ began rising about 10 minutes later.',
          'whatChanged': [{'time': OVERLAY_CUT, 'source': 'Maintenance', 'description': 'PBR-2 exhaust filter swapped (planned, during batch).', 'related': True},
                          {'time': pco2_nor_t, 'source': 'Alarm', 'description': f'pCO₂ above NOR ({NOR_PCO2:.0f} mmHg) — minor deviation raised.', 'related': True},
                          {'time': '13:10', 'source': 'Alarm', 'description': 'pH at low dead-band edge for 60 min.', 'related': True}],
          'confidence': 'Trend is clear; cause not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'High — above 150 mmHg glycosylation and titer suffer; crossing the PAR puts batch 26-116 disposition at risk', 'riskLevel': 'high',
          'expectedOutcome': 'pCO₂ back under 120 mmHg within 2 hours of the fix'}),
    item('PSIT08', WFI_STILL, 'still_output_l_h',
         [('08:00', 'Shift start'), ('09:30', ''), ('11:00', ''), ('12:00', ''), (STILL_VENT_FIX, 'Vent valve opened'),
          ('13:00', ''), (STILL_OK, 'Output restored')],
         'low', 'watch', 'resolved', STILL_OK,
         'WFI still making less water for more steam',
         'WFI-1\'s still output slid about 11% over the morning while its plant-steam use crept up. It was a non-condensable gas vent valve left partly closed after yesterday\'s PM, which blankets the condensing surfaces. Output was back to normal 40 minutes after it was opened.',
         {'signal': f'Distillate output fell from {q["so0"]:,.0f} to {q["so_low"]:,.0f} L/h by 12:40 while plant steam rose from {q["ss0"]:,.0f} to {q["ss_pk"]:,.0f} kg/h.',
          'observed': f'Distillate conductivity, TOC and loop temperature all normal. The WFI tank dipped to {q["lvl_min_wfi"]:.0f}% during the afternoon media-prep and CIP draws; no user was limited.',
          'derived': f'Steam per litre of WFI rose about {q["ssc"]:.0f}% — a heat-transfer loss inside the still, not a feed or demand problem.',
          'inferred': 'Non-condensable vent valve on effect 1 left half-closed after yesterday\'s PM; confirmed and opened at 12:40.',
          'recommendation': 'Add a vent-valve position check to the post-PM return-to-service checklist.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Vent valve opened 12:40; output back to 3,050 L/h by 13:20.',
          'whatChanged': [{'time': '08:00', 'source': 'Event', 'description': 'Still returned to service after PM (yesterday 17:30).', 'related': True},
                          {'time': '12:25', 'source': 'Field Check', 'description': 'Utilities tech finds the effect-1 vent valve half-closed.', 'related': True},
                          {'time': STILL_VENT_FIX, 'source': 'Maintenance', 'description': 'Vent valve opened.', 'related': True}],
          'confidence': 'Confirmed in the field', 'confidenceLevel': 'high',
          'risk': 'Low — caught before WFI supply limited any user', 'riskLevel': 'none',
          'expectedOutcome': 'Still at rated output'}),
    item('PSIT09', f'{P2U}_FEED_PUMP', 'feed_pump_rate_l_h',
         [('08:35', 'Normal'), ('08:40', 'Stop 1'), ('09:25', 'Stop 3'), ('10:20', 'Stop 5'), ('11:30', 'Stop 8'),
          ('11:50', 'Tubing replaced'), ('12:45', 'Back on recipe')],
         'medium', 'watch', 'resolved', '12:40',
         'PBR-2 feed pump stopping every 20–30 minutes',
         'PBR-2\'s continuous feed pump stopped eight times on its flow alarm before 11:30. Each stop was short and restarted automatically, but together they left the batch about 27 L behind the feed recipe and glucose dipped. The peristaltic tubing was worn and was replaced at 11:50.',
         {'signal': f'{q["stops"]} flow-alarm stops between 08:40 and 11:30 (up to {q["int_pk"]:.0f} in one hour); normal is none.',
          'observed': f'Feed fell up to {q["short_pk"]:.0f} L behind recipe; glucose went from {q["glu0"]:.1f} to {q["glu_min"]:.1f} g/L; now {q["glu_now"]:.1f} g/L. No other PBR-2 loop affected.',
          'derived': 'The stops were regular and self-clearing, which points to the pump head rather than the feed line or the medium.',
          'inferred': 'Worn peristaltic tubing slipping in the pump head; confirmed when replaced.',
          'recommendation': 'Record the feed shortfall and catch-up in the batch record; check tubing change interval on all feed pumps.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Tubing replaced 11:45–11:55; catch-up at 40 L/h until 12:40.',
          'whatChanged': [{'time': '08:40', 'source': 'Alarm', 'description': 'PBR-2 feed flow low (first of eight).', 'related': True},
                          {'time': '11:45', 'source': 'Maintenance', 'description': 'Feed pump tubing replaced.', 'related': True},
                          {'time': '11:55', 'source': 'Setpoint Change', 'description': 'Catch-up rate 40 L/h until the recipe total is met.', 'related': True}],
          'confidence': 'Confirmed by maintenance', 'confidenceLevel': 'high',
          'risk': 'Low — glucose stayed above 3 g/L', 'riskLevel': 'low',
          'expectedOutcome': 'Feed on recipe; glucose back above 3.5 g/L'}),
    item('PSIT10', P1U, 'viability_pct',
         [('08:00', 'Shift start'), (VIAB_FLAG, 'Below forecast'), ('11:00', ''), ('12:00', ''), ('13:00', ''),
          ('13:30', ''), ('14:05', 'Current')],
         'medium', 'investigate', 'none', VIAB_FLAG,
         'PBR-1 viability falling faster than forecast while titer still looks healthy',
         f'PBR-1 is on day 13 and its titer is still climbing, but viability has been dropping about {q["via_rate"]:.1f} points an hour — roughly three times the forecast. At this rate it reaches the 70% harvest criterion around {hhmm(q["via_eta"] % 1440)} tonight, before the planned 08:00 harvest.',
         {'signal': f'Viability {q["via_now"]:.1f}% at 14:05, down from {q["via0"]:.1f}% at 08:00 (forecast {q["forecast_now"]:.1f}%).',
          'observed': f'Titer {q["tit0"]:.2f} → {q["tit_now"]:.2f} g/L; VCD {q["vcd1_0"]:.1f} → {q["vcd1_now"]:.1f} ×10⁶/mL; pCO₂, DO, pH, temperature and glucose on target. The agitator drive is also showing rising vibration (PSIT01).',
          'derived': 'Output (titer) is fine, so the headline does not show it; the product quality risk grows as cells lyse (host cell protein, DNA and proteases rise, and harvest gets harder to clarify).',
          'inferred': 'Possible causes: end-of-culture decline arriving early, or added shear from the agitator drive issue. Not yet diagnosed.',
          'recommendation': 'Take an extra viability sample at 16:00 and ask MS&T whether to bring the harvest forward to this evening; confirm HRV-1 and a harvest crew are available.',
          'relatedOccurrences': [{'date': '2026-04-08', 'summary': 'Batch 26-071 harvested 10 h early at 71% viability; DS met specifications.'}],
          'whatChangedSummary': 'No process change on PBR-1 today; agitator vibration rising since 09:20.',
          'whatChanged': [{'time': '09:12', 'source': 'Field Check', 'description': 'Daily sample: viability 83.6% (forecast 83.8%).', 'related': True},
                          {'time': VIAB_FLAG, 'source': 'Event', 'description': 'Online capacitance viability drops below forecast band.', 'related': True},
                          {'time': AGIT_START, 'source': 'Event', 'description': 'Agitator gearbox vibration starts rising (PSIT01).', 'related': False}],
          'confidence': 'Trend is clear; cause not yet diagnosed', 'confidenceLevel': 'medium',
          'risk': 'Medium — harvest below 70% viability needs a deviation and extra clearance testing', 'riskLevel': 'medium',
          'expectedOutcome': 'Harvest decision made before viability reaches 72%'}),
    item('PSIT11', SBR1, 'seed_vcd_e6_ml',
         [('08:00', 'Shift start'), ('10:00', ''), ('11:30', ''), ('12:30', ''), (SIP_DONE, 'PBR-3 SIP complete'),
          (PLAN_FLAGGED, 'Schedule check flags gap'), ('14:05', 'Current')],
         'medium', 'act', 'none', PLAN_FLAGGED,
         'Seed for batch 26-117 will outgrow its transfer window before PBR-3 is ready',
         f'SBR-1\'s cells will pass the {TRANSFER_MAX:.1f} ×10⁶/mL transfer limit around {hhmm(q["svcd_cross"])}. PBR-3 still needs a pressure hold, media fill, QA release and equilibration after its repeated SIP, which puts it ready around {hhmm(q["ready"])}. The time needed is longer than the time left.',
         {'signal': f'Seed VCD {q["svcd_now"]:.2f} ×10⁶/mL at 14:05, doubling about every {SEED_DOUBLING_H:.0f} h; it reaches {TRANSFER_MAX:.1f} at about {hhmm(q["svcd_cross"])} (planned transfer {TRANSFER_PLAN}, when it would be {q["svcd_18"]:.2f}).',
          'observed': f'PBR-3 SIP finished at {SIP_DONE}, 95 minutes later than planned because SIP #1 was aborted (PSIT03). Remaining steps: ' +
                      '; '.join(f'{n} {m_} min' for n, m_ in READY_STEPS) + '. Seed viability 97–98%.',
          'derived': f'Time needed: about {q["need"] // 60}h {q["need"] % 60:02d}m (ready {hhmm(q["ready"])}). Time left: about {int(q["left"]) // 60}h {int(q["left"]) % 60:02d}m (window closes {hhmm(q["svcd_cross"])}). Short by about {int(round(q["gap"] / 5) * 5)} minutes.',
          'inferred': 'n/a — a schedule conflict, not a fault.',
          'recommendation': 'Decide by 15:00 with MS&T and QA: apply the approved seed-hold contingency (drop SBR-1 to 33 °C to slow growth) or re-sequence media fill and QA review in parallel where the procedure allows. Do not let the seed pass 6.0 ×10⁶/mL without a decision.',
          'relatedOccurrences': [{'date': '2026-02-17', 'summary': 'Seed-hold contingency used for batch 26-031 after a PBR-1 SIP repeat; transfer 3 h late, batch normal.'}],
          'whatChangedSummary': 'PBR-3 SIP repeated (PSIT03); readiness moved from 18:00 to about 20:00.',
          'whatChanged': [{'time': SIP1_ABORT, 'source': 'Event', 'description': 'PBR-3 SIP #1 aborted.', 'related': True},
                          {'time': SIP_DONE, 'source': 'Event', 'description': 'PBR-3 SIP #2 complete — 95 min behind plan.', 'related': True},
                          {'time': PLAN_FLAGGED, 'source': 'Scheduling', 'description': 'Production scheduler flags the seed-window conflict.', 'related': True}],
          'confidence': 'n/a — schedule arithmetic, not a diagnosis', 'confidenceLevel': 'n/a',
          'risk': 'Medium — an overgrown seed means a failed transfer criterion and a lost production slot', 'riskLevel': 'medium',
          'expectedOutcome': 'Contingency agreed and seed transferred inside its criteria'}),
]

for a in attention:
    if a['detail']['outcomeStatus'] == 'none' and a['unitId']:
        us = unit_status[a['unitId']]
        us['state'] = 'attention'
        us['statusSinceMinutes'] = max(us['statusSinceMinutes'] or 0, a['sinceMinutes'])


# ═════════════════════════════════════════════════════════════════════════
# Work items (spec §6.8)
# ═════════════════════════════════════════════════════════════════════════
def work(wid, text, desc, aid, wtype, prio, stype, slabel, src, role, start, due, dur, done, completed, created):
    iso = lambda t: f'{DATE}T{t}:00' if t else None
    return {'id': wid, 'text': text, 'description': desc, 'assetId': aid, 'assetLabel': label_of(aid) if aid else None,
            'workType': wtype, 'priority': prio, 'sourceType': stype, 'sourceLabel': slabel, 'source': src,
            'assignedRole': role, 'plannedStart': iso(start), 'dueAt': iso(due), 'estimatedDurationMinutes': dur,
            'done': done, 'completedAt': iso(completed), 'createdAt': iso(created)}


sig = {a['id']: a['signal'] for a in attention}
fr = lambda i: f'From: {sig[i]}'
work_items = [
    work('wk-p01', 'Shift handover and tier-1 huddle', 'Review the batch board, open deviations, today\'s CIP/SIP plan and the 26-117 seed transfer.',
         None, 'HUDDLE', 'routine', 'planned', None, 'operator', 'Shift Lead', '07:45', '08:00', 15, True, '08:03', '07:30'),
    work('wk-p02', 'PBR-1 daily sample (day 13)', 'VCD/viability, metabolites, offline pH and pCO₂ by blood-gas analyzer; titer sample to QC.',
         PBR[1], 'SAMPLE', 'routine', 'planned', None, 'operator', 'Upstream Operator', '09:00', '09:30', 20, True, '09:12', '07:30'),
    work('wk-p03', 'PBR-2 daily sample (day 7)', 'VCD/viability, metabolites, offline pH and pCO₂; osmolality.',
         PBR[2], 'SAMPLE', 'routine', 'planned', None, 'operator', 'Upstream Operator', '09:30', '10:00', 20, True, '09:41', '07:30'),
    work('wk-p04', 'WFI point-of-use sampling', 'Weekly TOC, conductivity, endotoxin and bioburden samples at POU 3, 7 and 12.',
         WFI_LOOP, 'SAMPLE', 'routine', 'planned', None, 'operator', 'QC Sampler', '10:00', '11:00', 45, True, '10:48', '07:30'),
    work('wk-p05', 'EM viable air sampling: post-viral suite', 'Routine active air and settle plates in Rm 2.14, 2.16 and AL-7 during operations.',
         ROOMS, 'ENV_MONITORING', 'routine', 'planned', None, 'operator', 'QC Microbiology', '11:00', '11:45', 40, True, '11:38', '07:30'),
    work('wk-p06', 'Review CAP-1 electronic batch record, cycles 1–2', 'Review by exception: the cycle 2 interruption and hold time need a comment before QA review.',
         CAP1, 'DOCUMENTATION', 'important', 'planned', None, 'operator', 'Downstream Lead', '13:00', '14:00', 45, True, '13:52', '07:30'),
    work('wk-p07', 'Sample and release 26-117 production medium', 'Osmolality, pH, appearance and bioburden sample from MP-1; QA release before transfer to PBR-3.',
         MP1, 'QUALITY_RELEASE', 'important', 'planned', None, 'operator', 'QC / QA', '14:30', '15:30', 60, False, None, '07:30'),
    work('wk-s01', 'Check SBR-1 DO probe B', 'Compare probe B with probe A; check cable, connector and transmitter.',
         f'{SBR1}_GAS_DOB', 'INSTRUMENT_CHECK', 'important', 'situation', fr('PSIT02'), 'ai', 'Instrument Technician', '09:50', '10:30', 30, True, '10:40', '09:48'),
    work('wk-s02', 'Replace CAP-1 guard filter and resume load', 'Replace and integrity-check the guard filter; resume cycle 2 inside the 4 h load hold.',
         CAP1, 'MAINTENANCE', 'urgent', 'situation', fr('PSIT04'), 'ai', 'Downstream Operator', '10:05', '10:45', 30, True, '10:38', '10:00'),
    work('wk-s03', 'Investigate PBR-3 SIP cold point; check clean steam', 'Check PBR-3 drain-leg steam trap and the CSG-1 header pressure trend before repeating SIP.',
         f'{P3U}_TEMP', 'INSPECTION', 'urgent', 'situation', fr('PSIT03'), 'ai', 'Utilities Technician', '10:50', '11:30', 30, True, '11:12', '10:47'),
    work('wk-s04', 'Replace PBR-2 feed pump tubing', 'Aseptic tubing change on the feed pump head; set catch-up rate per batch record.',
         f'{P2U}_FEED_PUMP', 'MAINTENANCE', 'important', 'situation', fr('PSIT09'), 'ai', 'Upstream Operator', '11:40', '12:00', 15, True, '11:55', '11:35'),
    work('wk-s05', 'Post-excursion EM sampling and deviation', 'Air and surface samples in the post-viral suite; open the pressure-cascade deviation; clear POL-1 to resume.',
         AHU3, 'ENV_MONITORING', 'urgent', 'situation', fr('PSIT06'), 'ai', 'QC Microbiology', '12:30', '12:50', 20, True, '12:48', '12:14'),
    work('wk-s06', 'Check PBR-2 overlay and sparge vs recipe; confirm pCO₂', 'Compare gas flows with the day-7 recipe; offline blood-gas pCO₂; notify QA of the NOR excursion.',
         f'{P2U}_GAS_PCO2', 'PROCEDURE', 'urgent', 'situation', fr('PSIT07'), 'ai', 'Upstream Operator', '14:05', '14:20', 15, False, None, '13:15'),
    work('wk-s07', 'Vibration route on PBR-1 agitator drive', 'Portable spectrum on the gearbox; check oil level and seal barrier condensate pressure.',
         f'{P1U}_AGIT', 'INSPECTION', 'important', 'situation', fr('PSIT01'), 'ai', 'Reliability Technician', None, '15:00', 30, False, None, '12:45'),
    work('wk-s08', 'Seed transfer decision: SBR-1 → PBR-3', 'MS&T, QA and production agree the seed-hold contingency or a re-sequenced PBR-3 readiness plan.',
         SBR1, 'HUDDLE', 'urgent', 'situation', fr('PSIT11'), 'ai', 'Shift Lead', '14:30', '15:00', 20, False, None, '13:42'),
]

# ── Write ───────────────────────────────────────────────────────────────
properties = {
    'properties': {k: {'label': p[0], 'unit': p[1], 'category': p[2], 'tier': p[3], 'range': p[4], 'decimals': p[5],
                       **({'static': True} if k in STATIC else {})}
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

# Sanity checks the generator relies on: same keys per type, and every value inside its gauge range.
for a in assets:
    expect = set(TYPE_PROPS[a['assetType']])
    got = set(values.get(a['id'], {}))
    assert got == expect, (a['id'], sorted(expect ^ got))
for aid, props in series.items():
    for k, s_ in props.items():
        lo, hi = PROPS[k][4]
        assert lo <= min(s_) and max(s_) <= hi, (aid, k, min(s_), max(s_), (lo, hi))
print(f'Wrote {len(files)} files to {os.path.relpath(OUT, REPO)}: {len(assets)} assets, {len(UNITS)} units, '
      f'{len(rels)} edges, {len(attention)} attention items, {len(work_items)} work items')
