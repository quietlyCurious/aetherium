#!/usr/bin/env python3
"""Halcyon Point combined-cycle plant — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/ccgt/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/ccgt/generate.py [OUTDIR]

The plant: one 2x1 power block (two F-class gas turbines, two triple-pressure
reheat HRSGs, one reheat condensing steam turbine) plus a common plant area
(circulating water / cooling tower, fuel gas yard, switchyard). Six levels:
site → area → unit → system → equipment → component, with branches that stop
at different depths.

Everything the scenarios need (which asset, when, how big) lives in the
SCENARIO constants below; SCENARIOS.md describes the same numbers in prose.
Evidence points in attention-items.json are READ BACK from the generated
series, so the story and the data can't disagree.

Physics, deliberately simple (75% realism / 25% demo clarity, spec §2):
- One summer day, 08:00–14:05 at 5-minute steps. Ambient climbs 78 → 95 °F,
  which lowers gas turbine capability (~0.42 %/°F) and raises CW temperature.
- The block runs on AGC: net output follows a dispatch target. Each step the
  controller solves for the GT load that meets the target, given the steam
  turbine's lagged response (HRSG thermal inertia, first-order per step).
- Steam turbine output = 0.56 × lagged GT output, reduced by condenser
  backpressure and by any steam lost through a passing bypass valve.
- Condenser backpressure comes from the saturation pressure at
  (CW supply + CW range + TTD); CW supply = wet bulb + tower approach.
- Rollups (gross output, fuel input, availability, CW flow, fan power, export)
  are computed from the child series at every point, as declared in
  properties.json derivations.
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'ccgt')
SEP = ' · '
UNIT_LEVEL = 'unit'

# ── Timeline (spec §4.2) — the default shared demo day. "Now" = 14:05. ──
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}


def i_of(t):
    return IDX[t]


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


NOW_MIN = END

# ── Scenario constants (SCENARIOS.md describes each one) ─────────────────
BFP_START = '09:30'            # HSIT01 — HRSG-2 BFP-A bearing degradation (05)
BFP_TEMP_RISE_F = 24.0         #   extra bearing temperature by "now"
BFP_VIB_RISE_IPS = 0.15        #   extra vibration by "now" (accelerating)
FOUL_DRIFT_PTS = 0.95          # HSIT02 — CTG-2 compressor fouling (03): efficiency points lost 08:00→11:25
WASH_START, WASH_END = '11:30', '12:00'
WASH_RECOVERY = 0.62           #   share of the fouling loss the online wash recovers
TC_FAULT, TC_REJECT = '10:05', '11:05'   # HSIT03 — CTG-2 exhaust TC-14 intermittent open circuit (06)
FAN_TRIP, FAN_RESET = '10:50', '11:40'   # HSIT04 — CT cell 6 fan motor trip → condenser backpressure (07)
FAN_CELL = 6
DRUM_START = '13:20'           # HSIT05 — HRSG-1 HP drum level oscillation (10)
DRUM_MANUAL_MOVES = ['13:25', '13:45']
XMTR_OUT = '13:10'             #   HP steam flow transmitter valved out for calibration (planned)
HEATER_TRIP, HEATER_RESTORE, RELOAD_DONE = '08:35', '09:15', '09:45'   # HSIT06 — fuel heater trip cascade (09)
LEAK_START = '11:45'           # HSIT07 — STG-1 HP bypass valve passing (08)
LEAK_FRAC_NOW = 0.034          #   share of HP steam passing to the condenser by "now"
SLIP_SP_CHANGE, SLIP_FIX = '02:10', '11:15'   # HSIT08 — HRSG-1 NOx setpoint lowered overnight → ammonia slip drift (13)
SLIP_DETECT = '09:30'
COMB_SPIKES = ['11:20', '12:15', '12:50', '13:20', '13:40', '13:55']   # HSIT09 — CTG-1 combustion dynamics excursions (12)
NH3_TRIP, NH3_RESTORE = '12:20', '12:35'  # HSIT10 — HRSG-2 ammonia forwarding pump trip (11)
CEMS_FOUND = '13:45'           # HSIT11 — HRSG-2 CEMS daily calibration window closing (14)
CEMS_LAST_CAL_H_AT_START = 19.5   # hours since last good daily cal at 08:00 (yesterday 12:30)
CEMS_GRACE_H = 26.0
CWP_C_MAINT = ('09:30', '10:45')  # planned: CW pump C bearing lube (it is the spare pump)

# ── Plant constants ──────────────────────────────────────────────────────
GT_RATED_ISO = 280.0           # MW at 59 °F
ST_RATED = 300.0
ST_RATIO = 0.56                # steam turbine MW per GT MW in a 2x1 (≈ half the GT total)
LAG = 0.35                     # first-order HRSG / ST response per 5-min step
SITE_ID, SITE_NAME = 'HALCYON', 'Halcyon Point'

# ── Property metadata (spec §3.4): label, unit, category, tier, range, decimals
PROPS = {
    # site / area
    'net_output_mw': ('Net Output', 'MW', 'Flow / WIP', 'P1', [0, 900], 1),
    'dispatch_target_mw': ('Dispatch Target (AGC)', 'MW', 'Flow / WIP', 'P2', [0, 900], 1),
    'gross_output_mw': ('Gross Output', 'MW', 'Flow / WIP', 'P2', [0, 900], 1),
    'net_heat_rate_btu_kwh': ('Net Heat Rate (HHV)', 'Btu/kWh', 'Derived Metric', 'P1', [5000, 8000], 0),
    'equiv_availability_pct': ('Equivalent Availability (24 h)', '%', 'Derived Metric', 'P1', [80, 100], 2),
    'aux_load_mw': ('Auxiliary Load', 'MW', 'Events / Losses', 'P3', [0, 40], 2),
    'ambient_temp_f': ('Ambient Temperature', '°F', 'Environmental', 'P2', [40, 110], 1),
    'block_fuel_input_mmbtu_h': ('Block Fuel Heat Input', 'MMBtu/h', 'Flow / WIP', 'P2', [0, 6000], 0),
    'common_aux_load_mw': ('Common Auxiliary Load', 'MW', 'Events / Losses', 'P2', [0, 10], 2),
    # gas turbine
    'gen_output_mw': ('Generator Output', 'MW', 'Flow / WIP', 'P1', [0, 350], 1),
    'fuel_heat_input_mmbtu_h': ('Fuel Heat Input (HHV)', 'MMBtu/h', 'Flow / WIP', 'P2', [0, 3500], 0),
    'gt_heat_rate_btu_kwh': ('GT Heat Rate (HHV)', 'Btu/kWh', 'Derived Metric', 'P2', [8000, 11500], 0),
    'corrected_output_pct': ('Corrected Output vs New & Clean', '%', 'Derived Metric', 'P2', [85, 102], 2),
    'rated_output_mw': ('Rated Output (ISO)', 'MW', 'Derived Metric', 'P3', [0, 350], 0),
    'inlet_filter_dp_inh2o': ('Inlet Filter DP', 'inH₂O', 'Condition', 'P1', [0, 8], 2),
    'compressor_inlet_temp_f': ('Compressor Inlet Temperature', '°F', 'Environmental', 'P2', [40, 110], 1),
    'compressor_discharge_pressure_psig': ('Compressor Discharge Pressure', 'psig', 'Flow / WIP', 'P2', [100, 350], 1),
    'compressor_discharge_temp_f': ('Compressor Discharge Temperature', '°F', 'Condition', 'P3', [500, 1000], 0),
    'compressor_efficiency_pct': ('Compressor Isentropic Efficiency', '%', 'Derived Metric', 'P1', [80, 95], 2),
    'igv_position_deg': ('IGV Position', '°', 'Stability', 'P3', [30, 90], 1),
    'combustion_dynamics_psi': ('Combustion Dynamics (hot tone)', 'psi', 'Stability', 'P1', [0, 5], 2),
    'gt_exit_nox_ppm': ('GT Exit NOx @15% O₂', 'ppm', 'Environmental', 'P2', [0, 25], 1),
    'gcv_position_pct': ('Gas Control Valve Position', '%', 'Stability', 'P2', [0, 100], 1),
    'fuel_gas_intervalve_pressure_psig': ('Inter-Valve (P2) Pressure', 'psig', 'Flow / WIP', 'P3', [0, 600], 1),
    'exhaust_temp_f': ('Exhaust Temperature (avg)', '°F', 'Condition', 'P1', [800, 1300], 1),
    'exhaust_temp_spread_f': ('Exhaust Temperature Spread', '°F', 'Stability', 'P1', [0, 150], 1),
    'wheelspace_temp_f': ('Wheelspace Temperature', '°F', 'Condition', 'P3', [500, 1000], 1),
    'bearing_metal_temp_f': ('Bearing Metal Temperature', '°F', 'Condition', 'P1', [80, 300], 1),
    'shaft_vibration_mils': ('Shaft Vibration', 'mils pk-pk', 'Condition', 'P2', [0, 8], 2),
    'lube_oil_header_pressure_psig': ('Lube Oil Header Pressure', 'psig', 'Condition', 'P1', [0, 40], 1),
    'lube_oil_header_temp_f': ('Lube Oil Header Temperature', '°F', 'Condition', 'P2', [80, 160], 1),
    'lo_pump_discharge_pressure_psig': ('Pump Discharge Pressure', 'psig', 'Flow / WIP', 'P2', [0, 120], 1),
    'lo_pump_motor_current_a': ('Pump Motor Current', 'A', 'Electrical', 'P3', [0, 200], 1),
    'lo_cooler_oil_dt_f': ('Oil Temperature Drop', '°F', 'Condition', 'P2', [0, 40], 1),
    'cooler_water_outlet_temp_f': ('Cooling Water Outlet Temperature', '°F', 'Condition', 'P3', [60, 140], 1),
    'stator_winding_temp_f': ('Stator Winding Temperature', '°F', 'Condition', 'P1', [60, 260], 1),
    'gen_reactive_mvar': ('Reactive Power', 'Mvar', 'Electrical', 'P2', [-100, 150], 1),
    'gen_terminal_voltage_kv': ('Terminal Voltage', 'kV', 'Electrical', 'P3', [15, 21], 2),
    'cold_air_temp_f': ('Cold Air Temperature', '°F', 'Condition', 'P3', [60, 140], 1),
    'h2_purity_pct': ('Hydrogen Purity', '%', 'Condition', 'P1', [94, 100], 2),
    'h2_pressure_psig': ('Hydrogen Pressure', 'psig', 'Condition', 'P2', [0, 90], 1),
    'cold_gas_temp_f': ('Cold Gas Temperature', '°F', 'Condition', 'P3', [60, 140], 1),
    'field_current_a': ('Field Current', 'A', 'Electrical', 'P2', [0, 4000], 0),
    'field_voltage_v': ('Field Voltage', 'V', 'Electrical', 'P3', [0, 600], 0),
    'gsu_top_oil_temp_f': ('Top Oil Temperature', '°F', 'Condition', 'P1', [60, 240], 1),
    'gsu_winding_hotspot_f': ('Winding Hot-Spot Temperature', '°F', 'Condition', 'P2', [60, 280], 1),
    'gsu_load_pct': ('Transformer Load', '%', 'Flow / WIP', 'P2', [0, 120], 1),
    'dga_h2_ppm': ('Dissolved Hydrogen (DGA)', 'ppm', 'Condition', 'P2', [0, 120], 0),
    'dga_tdcg_ppm': ('Total Dissolved Combustible Gas', 'ppm', 'Condition', 'P3', [0, 900], 0),
    # HRSG
    'hp_steam_flow_klb_h': ('HP Steam Flow', 'klb/h', 'Flow / WIP', 'P1', [0, 900], 1),
    'total_steam_flow_klb_h': ('Total Steam Flow', 'klb/h', 'Flow / WIP', 'P2', [0, 1100], 1),
    'stack_temp_f': ('Stack Temperature', '°F', 'Condition', 'P2', [100, 300], 1),
    'hp_steam_pressure_psig': ('HP Steam Pressure', 'psig', 'Flow / WIP', 'P1', [0, 2800], 0),
    'hp_steam_temp_f': ('HP Steam Temperature', '°F', 'Condition', 'P1', [800, 1150], 1),
    'drum_level_in': ('Drum Level (from NWL)', 'in', 'Stability', 'P1', [-15, 15], 2),
    'hp_drum_pressure_psig': ('HP Drum Pressure', 'psig', 'Flow / WIP', 'P2', [0, 2800], 0),
    'ip_drum_pressure_psig': ('IP Drum Pressure', 'psig', 'Flow / WIP', 'P2', [0, 700], 1),
    'lp_drum_pressure_psig': ('LP Drum Pressure', 'psig', 'Flow / WIP', 'P2', [0, 150], 1),
    'fcv_position_pct': ('Feedwater Valve Position', '%', 'Stability', 'P1', [0, 100], 1),
    'hp_fw_flow_klb_h': ('HP Feedwater Flow', 'klb/h', 'Flow / WIP', 'P2', [0, 900], 1),
    'sh_interstage_temp_f': ('Superheater Interstage Temperature', '°F', 'Condition', 'P1', [500, 1150], 1),
    'sh_tube_metal_temp_f': ('Superheater Tube Metal Temperature', '°F', 'Condition', 'P2', [700, 1300], 1),
    'attemp_spray_flow_klb_h': ('Spray Water Flow', 'klb/h', 'Flow / WIP', 'P1', [0, 60], 2),
    'attemp_valve_position_pct': ('Spray Valve Position', '%', 'Stability', 'P2', [0, 100], 1),
    'attemp_superheat_margin_f': ('Superheat Margin Downstream', '°F', 'Condition', 'P2', [0, 400], 1),
    'ip_steam_pressure_psig': ('IP Steam Pressure', 'psig', 'Flow / WIP', 'P1', [0, 700], 1),
    'hot_reheat_temp_f': ('Hot Reheat Temperature', '°F', 'Condition', 'P1', [800, 1150], 1),
    'rh_tube_metal_temp_f': ('Reheater Tube Metal Temperature', '°F', 'Condition', 'P2', [700, 1300], 1),
    'rh_steam_flow_klb_h': ('Reheat Steam Flow', 'klb/h', 'Flow / WIP', 'P3', [0, 1000], 1),
    'lp_steam_pressure_psig': ('LP Steam Pressure', 'psig', 'Flow / WIP', 'P1', [0, 120], 1),
    'lp_steam_temp_f': ('LP Steam Temperature', '°F', 'Condition', 'P3', [300, 700], 1),
    'fw_header_pressure_psig': ('Feedwater Header Pressure', 'psig', 'Flow / WIP', 'P1', [0, 3000], 0),
    'fw_cation_conductivity_us_cm': ('Feedwater Cation Conductivity', 'µS/cm', 'Quality', 'P2', [0, 0.5], 3),
    'bfp_discharge_pressure_psig': ('Discharge Pressure', 'psig', 'Flow / WIP', 'P1', [0, 3000], 0),
    'bfp_flow_gpm': ('Pump Flow', 'gpm', 'Flow / WIP', 'P2', [0, 2500], 0),
    'bfp_speed_rpm': ('Pump Speed (VFD)', 'rpm', 'Stability', 'P3', [0, 4000], 0),
    'motor_current_a': ('Motor Current', 'A', 'Electrical', 'P1', [0, 700], 1),
    'motor_winding_temp_f': ('Motor Winding Temperature', '°F', 'Condition', 'P2', [60, 300], 1),
    'pump_bearing_temp_f': ('Pump Bearing Temperature', '°F', 'Condition', 'P1', [60, 260], 1),
    'pump_vibration_ips': ('Pump Vibration', 'in/s', 'Condition', 'P1', [0, 0.4], 3),
    'scr_inlet_nox_ppm': ('SCR Inlet NOx', 'ppm', 'Environmental', 'P3', [0, 25], 2),
    'nox_removal_pct': ('NOx Removal', '%', 'Derived Metric', 'P2', [0, 100], 1),
    'ammonia_slip_ppm': ('Ammonia Slip', 'ppm', 'Environmental', 'P1', [0, 6], 2),
    'ammonia_flow_lb_h': ('Aqueous Ammonia Flow', 'lb/h', 'Flow / WIP', 'P1', [0, 250], 1),
    'nh3_nox_ratio': ('NH₃/NOx Molar Ratio', '', 'Stability', 'P2', [0, 1.6], 3),
    'catalyst_dp_inh2o': ('Catalyst DP', 'inH₂O', 'Condition', 'P2', [0, 6], 2),
    'scr_inlet_temp_f': ('Catalyst Inlet Temperature', '°F', 'Condition', 'P2', [400, 800], 1),
    'stack_nox_ppm': ('Stack NOx @15% O₂', 'ppm', 'Environmental', 'P1', [0, 10], 2),
    'stack_co_ppm': ('Stack CO @15% O₂', 'ppm', 'Environmental', 'P3', [0, 10], 2),
    'stack_o2_pct': ('Stack O₂', '%', 'Environmental', 'P3', [0, 21], 2),
    'hours_since_cal_h': ('Hours Since Daily Calibration', 'h', 'Events / Losses', 'P2', [0, 36], 2),
    # steam turbine
    'throttle_pressure_psig': ('Throttle Pressure', 'psig', 'Flow / WIP', 'P2', [0, 2800], 0),
    'throttle_temp_f': ('Throttle Temperature', '°F', 'Condition', 'P2', [800, 1150], 1),
    'hp_exhaust_temp_f': ('HP Exhaust Temperature', '°F', 'Condition', 'P2', [400, 900], 1),
    'rotor_stress_pct': ('Rotor Stress (of limit)', '%', 'Condition', 'P3', [0, 100], 1),
    'lp_exhaust_hood_temp_f': ('LP Exhaust Hood Temperature', '°F', 'Condition', 'P1', [60, 200], 1),
    'crossover_pressure_psig': ('Crossover Pressure', 'psig', 'Flow / WIP', 'P3', [0, 120], 1),
    'hp_bypass_position_pct': ('HP Bypass Valve Position', '%', 'Stability', 'P1', [0, 100], 1),
    'hp_bypass_downstream_temp_f': ('HP Bypass Downstream Temperature', '°F', 'Condition', 'P2', [100, 900], 1),
    'hrh_bypass_position_pct': ('Hot Reheat Bypass Position', '%', 'Stability', 'P3', [0, 100], 1),
    'condenser_backpressure_inhga': ('Condenser Backpressure', 'inHgA', 'Condition', 'P1', [1, 4], 3),
    'hotwell_level_in': ('Hotwell Level', 'in', 'Stability', 'P2', [0, 48], 1),
    'condenser_ttd_f': ('Terminal Temperature Difference', '°F', 'Derived Metric', 'P2', [0, 20], 2),
    'air_inleakage_scfm': ('Air In-leakage', 'scfm', 'Condition', 'P2', [0, 20], 2),
    'cleanliness_factor_pct': ('Cleanliness Factor', '%', 'Derived Metric', 'P3', [0, 100], 1),
    'vacuum_pump_current_a': ('Vacuum Pump Current', 'A', 'Electrical', 'P2', [0, 160], 1),
    'vp_seal_water_temp_f': ('Seal Water Temperature', '°F', 'Condition', 'P3', [50, 130], 1),
    'cep_discharge_pressure_psig': ('Discharge Pressure', 'psig', 'Flow / WIP', 'P1', [0, 500], 1),
    'cep_flow_gpm': ('Condensate Flow', 'gpm', 'Flow / WIP', 'P2', [0, 5000], 0),
    'cep_motor_current_a': ('Motor Current', 'A', 'Electrical', 'P3', [0, 300], 1),
    # common plant
    'cw_supply_temp_f': ('CW Supply Temperature', '°F', 'Condition', 'P1', [60, 110], 2),
    'cw_return_temp_f': ('CW Return Temperature', '°F', 'Condition', 'P2', [60, 130], 2),
    'cw_flow_kgpm': ('CW Flow', 'kgpm', 'Flow / WIP', 'P1', [0, 300], 1),
    'ct_approach_f': ('Tower Approach', '°F', 'Derived Metric', 'P1', [0, 20], 2),
    'wet_bulb_temp_f': ('Wet-Bulb Temperature', '°F', 'Environmental', 'P2', [40, 90], 1),
    'basin_level_pct': ('Basin Level', '%', 'Flow / WIP', 'P3', [0, 100], 1),
    'ct_fan_power_kw': ('Total Fan Power', 'kW', 'Electrical', 'P2', [0, 2000], 1),
    'ct_cell_fan_power_kw': ('Fan Power', 'kW', 'Electrical', 'P1', [0, 250], 1),
    'cell_outlet_temp_f': ('Cell Outlet Water Temperature', '°F', 'Condition', 'P2', [60, 110], 1),
    'ct_gearbox_vibration_ips': ('Gearbox Vibration', 'in/s', 'Condition', 'P1', [0, 0.6], 3),
    'ct_gearbox_oil_temp_f': ('Gearbox Oil Temperature', '°F', 'Condition', 'P2', [60, 220], 1),
    'cw_header_pressure_psig': ('CW Header Pressure', 'psig', 'Flow / WIP', 'P1', [0, 50], 2),
    'cwp_flow_kgpm': ('Pump Flow', 'kgpm', 'Flow / WIP', 'P1', [0, 150], 1),
    'cwp_motor_current_a': ('Motor Current', 'A', 'Electrical', 'P2', [0, 400], 1),
    'fuel_gas_supply_pressure_psig': ('Fuel Gas Supply Pressure', 'psig', 'Flow / WIP', 'P1', [0, 800], 1),
    'fuel_gas_flow_kscfh': ('Fuel Gas Flow', 'kscf/h', 'Flow / WIP', 'P2', [0, 7000], 0),
    'filter_sep_dp_psid': ('Filter/Separator DP', 'psid', 'Condition', 'P1', [0, 15], 2),
    'separator_liquid_level_pct': ('Liquid Sump Level', '%', 'Condition', 'P3', [0, 100], 1),
    'fuel_gas_temp_f': ('Fuel Gas Temperature', '°F', 'Quality', 'P1', [60, 500], 1),
    'modified_wobbe_index': ('Modified Wobbe Index', '', 'Quality', 'P1', [35, 60], 2),
    'heater_water_flow_gpm': ('Heating Water Flow', 'gpm', 'Flow / WIP', 'P2', [0, 300], 1),
    'gas_hhv_btu_scf': ('Gas Heating Value (HHV)', 'Btu/scf', 'Quality', 'P2', [950, 1100], 1),
    'wobbe_index_btu_scf': ('Wobbe Index', 'Btu/scf', 'Quality', 'P2', [1250, 1450], 1),
    'hc_dew_point_f': ('Hydrocarbon Dew Point', '°F', 'Quality', 'P3', [-20, 80], 1),
    'net_export_mw': ('Net Export', 'MW', 'Flow / WIP', 'P1', [0, 900], 1),
    'bus_voltage_kv': ('Bus Voltage', 'kV', 'Electrical', 'P1', [330, 370], 2),
    'grid_frequency_hz': ('Grid Frequency', 'Hz', 'Stability', 'P2', [59.9, 60.1], 3),
    'line_flow_mw': ('Line Flow', 'MW', 'Flow / WIP', 'P1', [0, 600], 1),
    'line_mvar': ('Line Reactive Flow', 'Mvar', 'Electrical', 'P3', [-200, 200], 1),
}
STATIC = {'rated_output_mw'}

TYPE_PROPS = {
    'cc_plant': ['net_output_mw', 'dispatch_target_mw', 'gross_output_mw', 'net_heat_rate_btu_kwh',
                 'equiv_availability_pct', 'aux_load_mw', 'ambient_temp_f'],
    'power_block': ['gross_output_mw', 'block_fuel_input_mmbtu_h', 'equiv_availability_pct'],
    'common_plant': ['common_aux_load_mw'],
    # gas turbine
    'gas_turbine': ['gen_output_mw', 'equiv_availability_pct', 'fuel_heat_input_mmbtu_h', 'gt_heat_rate_btu_kwh',
                    'corrected_output_pct', 'rated_output_mw'],
    'gt_inlet_filter': ['inlet_filter_dp_inh2o', 'compressor_inlet_temp_f'],
    'gt_compressor': ['compressor_efficiency_pct', 'compressor_discharge_pressure_psig', 'compressor_discharge_temp_f',
                      'igv_position_deg'],
    'dln_combustor': ['combustion_dynamics_psi', 'gt_exit_nox_ppm'],
    'gas_control_valve': ['gcv_position_pct', 'fuel_gas_intervalve_pressure_psig'],
    'gt_turbine_section': ['exhaust_temp_f', 'exhaust_temp_spread_f', 'wheelspace_temp_f'],
    'journal_bearing': ['bearing_metal_temp_f', 'shaft_vibration_mils'],
    'lube_oil_system': ['lube_oil_header_pressure_psig', 'lube_oil_header_temp_f'],
    'lube_oil_pump': ['lo_pump_discharge_pressure_psig', 'lo_pump_motor_current_a'],
    'lube_oil_cooler': ['lo_cooler_oil_dt_f', 'cooler_water_outlet_temp_f'],
    'h2_cooled_generator': ['stator_winding_temp_f', 'gen_reactive_mvar', 'gen_terminal_voltage_kv'],
    'air_cooled_generator': ['stator_winding_temp_f', 'gen_reactive_mvar', 'gen_terminal_voltage_kv', 'cold_air_temp_f'],
    'h2_cooling_system': ['h2_purity_pct', 'h2_pressure_psig', 'cold_gas_temp_f'],
    'static_exciter': ['field_current_a', 'field_voltage_v'],
    'gsu_transformer': ['gsu_top_oil_temp_f', 'gsu_winding_hotspot_f', 'gsu_load_pct', 'dga_h2_ppm', 'dga_tdcg_ppm'],
    # HRSG
    'hrsg': ['hp_steam_flow_klb_h', 'total_steam_flow_klb_h', 'stack_temp_f'],
    'hrsg_hp_section': ['hp_steam_pressure_psig', 'hp_steam_temp_f'],
    'hp_drum': ['drum_level_in', 'hp_drum_pressure_psig'],
    'feedwater_control_valve': ['fcv_position_pct', 'hp_fw_flow_klb_h'],
    'hp_superheater': ['sh_interstage_temp_f', 'sh_tube_metal_temp_f'],
    'attemperator': ['attemp_spray_flow_klb_h', 'attemp_valve_position_pct', 'attemp_superheat_margin_f'],
    'hrsg_ip_section': ['ip_steam_pressure_psig', 'hot_reheat_temp_f'],
    'ip_drum': ['drum_level_in', 'ip_drum_pressure_psig'],
    'reheater': ['rh_tube_metal_temp_f', 'rh_steam_flow_klb_h'],
    'hrsg_lp_section': ['lp_steam_pressure_psig', 'lp_steam_temp_f'],
    'lp_drum': ['drum_level_in', 'lp_drum_pressure_psig'],
    'feedwater_system': ['fw_header_pressure_psig', 'fw_cation_conductivity_us_cm'],
    'boiler_feed_pump': ['bfp_discharge_pressure_psig', 'bfp_flow_gpm', 'bfp_speed_rpm'],
    'pump_motor': ['motor_current_a', 'motor_winding_temp_f'],
    'pump_bearings': ['pump_bearing_temp_f', 'pump_vibration_ips'],
    'scr_system': ['nox_removal_pct', 'ammonia_slip_ppm', 'scr_inlet_nox_ppm'],
    'ammonia_skid': ['ammonia_flow_lb_h', 'nh3_nox_ratio'],
    'scr_catalyst': ['catalyst_dp_inh2o', 'scr_inlet_temp_f'],
    'cems_analyzer': ['stack_nox_ppm', 'stack_co_ppm', 'stack_o2_pct', 'hours_since_cal_h'],
    # steam turbine
    'steam_turbine': ['gen_output_mw', 'equiv_availability_pct', 'throttle_pressure_psig', 'throttle_temp_f',
                      'rated_output_mw'],
    'st_hpip_turbine': ['hp_exhaust_temp_f', 'rotor_stress_pct'],
    'st_lp_turbine': ['lp_exhaust_hood_temp_f', 'crossover_pressure_psig'],
    'steam_bypass': ['hp_bypass_position_pct', 'hp_bypass_downstream_temp_f', 'hrh_bypass_position_pct'],
    'condenser': ['condenser_backpressure_inhga', 'hotwell_level_in', 'condenser_ttd_f', 'air_inleakage_scfm',
                  'cleanliness_factor_pct'],
    'vacuum_pump': ['vacuum_pump_current_a', 'vp_seal_water_temp_f'],
    'condensate_pump': ['cep_discharge_pressure_psig', 'cep_flow_gpm', 'cep_motor_current_a'],
    # common plant
    'circulating_water': ['cw_supply_temp_f', 'cw_return_temp_f', 'cw_flow_kgpm'],
    'cooling_tower': ['ct_approach_f', 'wet_bulb_temp_f', 'basin_level_pct', 'ct_fan_power_kw'],
    'cooling_tower_cell': ['ct_cell_fan_power_kw', 'cell_outlet_temp_f'],
    'ct_fan_gearbox': ['ct_gearbox_vibration_ips', 'ct_gearbox_oil_temp_f'],
    'cw_pump_station': ['cw_header_pressure_psig', 'cw_flow_kgpm'],
    'cw_pump': ['cwp_flow_kgpm', 'cwp_motor_current_a', 'pump_vibration_ips'],
    'fuel_gas_yard': ['fuel_gas_supply_pressure_psig', 'fuel_gas_flow_kscfh'],
    'filter_separator': ['filter_sep_dp_psid', 'separator_liquid_level_pct'],
    'performance_heater': ['fuel_gas_temp_f', 'modified_wobbe_index', 'heater_water_flow_gpm'],
    'gas_chromatograph': ['gas_hhv_btu_scf', 'wobbe_index_btu_scf', 'hc_dew_point_f'],
    'switchyard': ['net_export_mw'],
    'hv_bus': ['bus_voltage_kv', 'grid_frequency_hz'],
    'line_terminal': ['line_flow_mw', 'line_mvar'],
}
TYPE_LABELS = {
    'cc_plant': 'Combined-Cycle Plant',
    'hrsg': 'HRSG',
    'gt_inlet_filter': 'GT Inlet Filter House',
    'gt_compressor': 'GT Compressor',
    'dln_combustor': 'DLN Combustion System',
    'gt_turbine_section': 'GT Turbine Section',
    'h2_cooled_generator': 'Generator (Hydrogen-Cooled)',
    'air_cooled_generator': 'Generator (Air-Cooled, TEWAC)',
    'h2_cooling_system': 'Hydrogen Cooling System',
    'gsu_transformer': 'GSU Transformer',
    'hrsg_hp_section': 'HRSG HP Section',
    'hrsg_ip_section': 'HRSG IP / Reheat Section',
    'hrsg_lp_section': 'HRSG LP Section',
    'hp_drum': 'HP Drum',
    'ip_drum': 'IP Drum',
    'lp_drum': 'LP Drum',
    'hp_superheater': 'HP Superheater',
    'scr_system': 'SCR / Emissions',
    'scr_catalyst': 'SCR Catalyst',
    'cems_analyzer': 'CEMS Analyzer',
    'st_hpip_turbine': 'ST HP/IP Turbine',
    'st_lp_turbine': 'ST LP Turbine',
    'cw_pump': 'CW Pump',
    'cw_pump_station': 'CW Pump Station',
    'ct_fan_gearbox': 'CT Fan Gearbox',
    'hv_bus': 'HV Bus',
}
DERIVATIONS = [
    {'assetType': 'cc_plant', 'property': 'gross_output_mw', 'fn': 'sum', 'of': 'gen_output_mw',
     'fromType': 'gas_turbine|steam_turbine', 'scope': 'descendants'},
    {'assetType': 'power_block', 'property': 'gross_output_mw', 'fn': 'sum', 'of': 'gen_output_mw',
     'fromType': 'gas_turbine|steam_turbine', 'scope': 'children'},
    {'assetType': 'power_block', 'property': 'block_fuel_input_mmbtu_h', 'fn': 'sum', 'of': 'fuel_heat_input_mmbtu_h',
     'fromType': 'gas_turbine', 'scope': 'children'},
    {'assetType': 'cc_plant', 'property': 'equiv_availability_pct', 'fn': 'mean', 'of': 'equiv_availability_pct',
     'fromType': 'gas_turbine|steam_turbine', 'scope': 'descendants'},
    {'assetType': 'power_block', 'property': 'equiv_availability_pct', 'fn': 'mean', 'of': 'equiv_availability_pct',
     'fromType': 'gas_turbine|steam_turbine', 'scope': 'children'},
    {'assetType': 'cooling_tower', 'property': 'ct_fan_power_kw', 'fn': 'sum', 'of': 'ct_cell_fan_power_kw',
     'fromType': 'cooling_tower_cell', 'scope': 'children'},
    {'assetType': 'cw_pump_station', 'property': 'cw_flow_kgpm', 'fn': 'sum', 'of': 'cwp_flow_kgpm',
     'fromType': 'cw_pump', 'scope': 'children'},
    {'assetType': 'circulating_water', 'property': 'cw_flow_kgpm', 'fn': 'sum', 'of': 'cwp_flow_kgpm',
     'fromType': 'cw_pump', 'scope': 'descendants'},
    {'assetType': 'switchyard', 'property': 'net_export_mw', 'fn': 'sum', 'of': 'line_flow_mw',
     'fromType': 'line_terminal', 'scope': 'children'},
    {'assetType': 'cc_plant', 'property': 'net_output_mw', 'fn': 'formula',
     'note': 'gross_output_mw − aux_load_mw (equals Switchyard net_export_mw)'},
    {'assetType': 'cc_plant', 'property': 'aux_load_mw', 'fn': 'formula',
     'note': 'block auxiliaries (BFPs ~4.6 MW + 1.2% of gross + 3 MW misc) + Common Plant common_aux_load_mw'},
    {'assetType': 'common_plant', 'property': 'common_aux_load_mw', 'fn': 'formula',
     'note': '(CW pump motor power + cooling tower fan power) / 1000 + 0.6 MW fuel yard and buildings'},
    {'assetType': 'cc_plant', 'property': 'net_heat_rate_btu_kwh', 'fn': 'formula',
     'note': 'Power Block block_fuel_input_mmbtu_h × 1,000 / net_output_mw (HHV basis)'},
    {'assetType': 'gas_turbine', 'property': 'gt_heat_rate_btu_kwh', 'fn': 'formula',
     'note': 'fuel_heat_input_mmbtu_h × 1,000 / gen_output_mw (simple-cycle, HHV)'},
    {'assetType': 'gas_turbine', 'property': 'equiv_availability_pct', 'fn': 'formula',
     'note': 'NERC GADS EAF over a rolling 24 h: (1 − Σ equivalent derated hours / 24 h) × 100; derated fraction = 1 − load limit / capability'},
    {'assetType': 'steam_turbine', 'property': 'equiv_availability_pct', 'fn': 'formula',
     'note': 'as for gas_turbine; the ST is derated whenever its HRSG steam is (GT runback)'},
    {'assetType': 'gas_turbine', 'property': 'corrected_output_pct', 'fn': 'formula',
     'note': 'base-load capability corrected to ISO ambient / new-and-clean capability × 100'},
    {'assetType': 'hrsg', 'property': 'total_steam_flow_klb_h', 'fn': 'formula',
     'note': 'HP + IP + LP steam flow (IP ≈ 16% and LP ≈ 13% of HP at these loads)'},
    {'assetType': 'scr_system', 'property': 'nox_removal_pct', 'fn': 'formula',
     'note': '(1 − stack_nox_ppm / scr_inlet_nox_ppm) × 100'},
    {'assetType': 'scr_system', 'property': 'scr_inlet_nox_ppm', 'fn': 'formula',
     'note': 'equals the paired GT Combustion System gt_exit_nox_ppm (exhaust_gas edge)'},
    {'assetType': 'fuel_gas_yard', 'property': 'fuel_gas_flow_kscfh', 'fn': 'formula',
     'note': 'sum of both CTGs fuel_heat_input_mmbtu_h × 1,000 / gas_hhv_btu_scf'},
    {'assetType': 'cooling_tower', 'property': 'ct_approach_f', 'fn': 'formula',
     'note': 'Circulating Water cw_supply_temp_f − wet_bulb_temp_f'},
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


def ar1(sd, phi=0.85):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi), zero mean."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def lagged(targets, start=None, k=LAG):
    x, out = (targets[0] if start is None else start), []
    for tgt in targets:
        x += (tgt - x) * k
        out.append(x)
    return out


def window(t0, t1):
    return [minutes(t0) <= minutes(t) < minutes(t1) for t in TS]


def ramp(t0, t1, amount, power=1.0):
    """0 up to t0, rising to `amount` at t1 (optionally accelerating), held after."""
    a, b = minutes(t0), minutes(t1)
    return [0 if minutes(t) <= a else amount * min(1, (minutes(t) - a) / (b - a)) ** power for t in TS]


def add_(*arrays):
    return [sum(v) for v in zip(*arrays)]


def plus_noise(base, sd, phi=0.85):
    return [b + e for b, e in zip(base, ar1(sd, phi))]


def rnd(x, d):
    return round(x + 0.0, d)


def psat_inhga(temp_f):
    """Saturation pressure of water (Magnus), °F → inHg absolute."""
    c = (temp_f - 32) / 1.8
    return 0.61094 * math.exp(17.625 * c / (c + 243.04)) * 0.2953


def tsat_f_from_psig(p):
    """Rough saturation temperature for drum pressures (fit to steam tables, 50–2500 psig)."""
    return 115.0 * (p + 14.7) ** 0.225 + 20.0


# ── Environment: a hot late-August day ───────────────────────────────────
ambient = plus_noise(interp({'08:00': 78.0, '10:00': 84.5, '12:00': 91.0, '14:05': 95.2}), 0.35)
rh = plus_noise(interp({'08:00': 71.0, '11:00': 55.0, '14:05': 43.0}), 1.0)
wet_bulb = plus_noise(interp({'08:00': 70.6, '11:00': 73.4, '14:05': 75.6}), 0.25)
DISPATCH_RAMP = ('09:50', '10:25')   # AGC target raised for the afternoon peak
dispatch = interp({'08:00': 650.0, DISPATCH_RAMP[0]: 650.0, DISPATCH_RAMP[1]: 705.0, '14:05': 705.0})

# ── Build the asset tree ─────────────────────────────────────────────────
assets, kids = [], {}


def add(aid, parent, name, atype, level):
    assets.append({'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level})
    kids.setdefault(parent, []).append(aid)
    return aid


add(SITE_ID, None, SITE_NAME, 'cc_plant', 'site')
BLK = add(f'{SITE_ID}_B1', SITE_ID, 'Block 1', 'power_block', 'area')


def build_ctg(n):
    u = add(f'{BLK}_CTG{n}', BLK, f'CTG-{n}', 'gas_turbine', 'unit')
    add(f'{u}_INLET', u, 'Inlet Filter House', 'gt_inlet_filter', 'system')
    add(f'{u}_COMP', u, 'Compressor', 'gt_compressor', 'system')
    comb = add(f'{u}_COMB', u, 'Combustion System', 'dln_combustor', 'system')
    add(f'{comb}_GCV', comb, 'Gas Control Valve', 'gas_control_valve', 'equipment')
    turb = add(f'{u}_TURB', u, 'Turbine Section', 'gt_turbine_section', 'system')
    add(f'{turb}_BRG1', turb, 'Bearing #1', 'journal_bearing', 'equipment')
    add(f'{turb}_BRG2', turb, 'Bearing #2', 'journal_bearing', 'equipment')
    build_lube(u)
    gen = add(f'{u}_GEN', u, 'Generator', 'h2_cooled_generator', 'system')
    add(f'{gen}_H2', gen, 'Hydrogen System', 'h2_cooling_system', 'equipment')
    add(f'{gen}_EXC', gen, 'Exciter', 'static_exciter', 'equipment')
    add(f'{u}_GSU', u, 'GSU Transformer', 'gsu_transformer', 'system')
    return u


def build_lube(u):
    lube = add(f'{u}_LUBE', u, 'Lube Oil System', 'lube_oil_system', 'system')
    add(f'{lube}_LOPA', lube, 'Lube Oil Pump A', 'lube_oil_pump', 'equipment')
    add(f'{lube}_LOPB', lube, 'Lube Oil Pump B', 'lube_oil_pump', 'equipment')
    add(f'{lube}_LOC', lube, 'Lube Oil Cooler', 'lube_oil_cooler', 'equipment')


def build_hrsg(n):
    u = add(f'{BLK}_HRSG{n}', BLK, f'HRSG-{n}', 'hrsg', 'unit')
    hp = add(f'{u}_HP', u, 'HP Section', 'hrsg_hp_section', 'system')
    drum = add(f'{hp}_DRUM', hp, 'HP Drum', 'hp_drum', 'equipment')
    add(f'{drum}_FCV', drum, 'Feedwater Control Valve', 'feedwater_control_valve', 'component')
    sh = add(f'{hp}_SH', hp, 'HP Superheater', 'hp_superheater', 'equipment')
    add(f'{sh}_ATT', sh, 'HP Attemperator', 'attemperator', 'component')
    ip = add(f'{u}_IP', u, 'IP / Reheat Section', 'hrsg_ip_section', 'system')
    add(f'{ip}_DRUM', ip, 'IP Drum', 'ip_drum', 'equipment')
    add(f'{ip}_RH', ip, 'Reheater', 'reheater', 'equipment')
    lp = add(f'{u}_LP', u, 'LP Section', 'hrsg_lp_section', 'system')
    add(f'{lp}_DRUM', lp, 'LP Drum', 'lp_drum', 'equipment')
    fw = add(f'{u}_FW', u, 'Feedwater System', 'feedwater_system', 'system')
    for p in 'AB':
        bfp = add(f'{fw}_BFP{p}', fw, f'BFP-{p}', 'boiler_feed_pump', 'equipment')
        add(f'{bfp}_MTR', bfp, 'Motor', 'pump_motor', 'component')
        add(f'{bfp}_BRG', bfp, 'Pump Bearings', 'pump_bearings', 'component')
    scr = add(f'{u}_SCR', u, 'SCR / Emissions', 'scr_system', 'system')
    add(f'{scr}_NH3', scr, 'Ammonia Skid', 'ammonia_skid', 'equipment')
    add(f'{scr}_CAT', scr, 'Catalyst', 'scr_catalyst', 'equipment')
    add(f'{scr}_CEMS', scr, 'Stack CEMS', 'cems_analyzer', 'equipment')
    return u


CTG = {1: build_ctg(1)}
HRSG = {1: build_hrsg(1)}
CTG[2] = build_ctg(2)
HRSG[2] = build_hrsg(2)
STG = add(f'{BLK}_STG1', BLK, 'STG-1', 'steam_turbine', 'unit')
hpip = add(f'{STG}_HPIP', STG, 'HP/IP Turbine', 'st_hpip_turbine', 'system')
add(f'{hpip}_BRG1', hpip, 'Bearing #1', 'journal_bearing', 'equipment')
add(f'{hpip}_BRG2', hpip, 'Bearing #2', 'journal_bearing', 'equipment')
lpt = add(f'{STG}_LPT', STG, 'LP Turbine', 'st_lp_turbine', 'system')
add(f'{lpt}_BRG3', lpt, 'Bearing #3', 'journal_bearing', 'equipment')
add(f'{lpt}_BRG4', lpt, 'Bearing #4', 'journal_bearing', 'equipment')
add(f'{STG}_BYP', STG, 'Steam Bypass', 'steam_bypass', 'system')
cond = add(f'{STG}_COND', STG, 'Condenser', 'condenser', 'system')
for p in 'AB':
    add(f'{cond}_VP{p}', cond, f'Vacuum Pump {p}', 'vacuum_pump', 'equipment')
for p in 'AB':
    add(f'{cond}_CEP{p}', cond, f'Condensate Pump {p}', 'condensate_pump', 'equipment')
build_lube(STG)
stgen = add(f'{STG}_GEN', STG, 'Generator', 'air_cooled_generator', 'system')
add(f'{stgen}_EXC', stgen, 'Exciter', 'static_exciter', 'equipment')
add(f'{STG}_GSU', STG, 'GSU Transformer', 'gsu_transformer', 'system')

CP = add(f'{SITE_ID}_CP', SITE_ID, 'Common Plant', 'common_plant', 'area')
CW = add(f'{CP}_CW', CP, 'Circulating Water', 'circulating_water', 'unit')
CT = add(f'{CW}_CT', CW, 'Cooling Tower', 'cooling_tower', 'system')
CELLS = []
for c in range(1, 9):
    cell = add(f'{CT}_CELL{c}', CT, f'Cell {c}', 'cooling_tower_cell', 'equipment')
    add(f'{cell}_GBX', cell, 'Fan Gearbox', 'ct_fan_gearbox', 'component')
    CELLS.append(cell)
CWPS = add(f'{CW}_CWPS', CW, 'CW Pump Station', 'cw_pump_station', 'system')
CWP = {p: add(f'{CWPS}_CWP{p}', CWPS, f'CW Pump {p}', 'cw_pump', 'equipment') for p in 'ABC'}
FG = add(f'{CP}_FG', CP, 'Fuel Gas Yard', 'fuel_gas_yard', 'unit')
FSEP = add(f'{FG}_FSEP', FG, 'Filter/Separator', 'filter_separator', 'system')
HTR = add(f'{FG}_HTR', FG, 'Performance Heater', 'performance_heater', 'system')
GC = add(f'{FG}_GC', FG, 'Gas Chromatograph', 'gas_chromatograph', 'system')
SWYD = add(f'{CP}_SWYD', CP, 'Switchyard', 'switchyard', 'unit')
BUS = add(f'{SWYD}_BUS', SWYD, '345 kV Bus', 'hv_bus', 'system')
LINES = [add(f'{SWYD}_LINE{k}', SWYD, f'Line {k} Terminal', 'line_terminal', 'system') for k in (1, 2)]

A = {a['id']: a for a in assets}
UNITS = [a['id'] for a in assets if a['assetLevel'] == UNIT_LEVEL]

series = {}


def put(aid, key, values, decimals=None):
    assert key in TYPE_PROPS[A[aid]['assetType']], (aid, key)
    d = PROPS[key][5] if decimals is None else decimals
    lo, hi = PROPS[key][4]
    series.setdefault(aid, {})[key] = [rnd(v, d) for v in values]


def S(aid, key):
    return series[aid][key]


# ── Scenario shapes used by the plant simulation ────────────────────────
# CTG-2 compressor fouling: efficiency loss (points) drifting all morning, part-recovered by the wash.
foul_pts = []
for t in TS:
    m = minutes(t)
    drift = 0.35 + FOUL_DRIFT_PTS * min(1.0, (m - START) / (minutes('11:25') - START))
    if m < minutes(WASH_START):
        foul_pts.append(drift)
    else:
        full = 0.35 + FOUL_DRIFT_PTS
        rec = WASH_RECOVERY * full * min(1.0, (m - minutes(WASH_START)) / (minutes('12:30') - minutes(WASH_START)))
        foul_pts.append(full - rec + 0.012 * (m - minutes('12:30')) / 5 * (m > minutes('12:30')))
FOUL = {1: [0.08] * N, 2: foul_pts}          # compressor efficiency points lost vs new & clean
# Heater trip → both GTs run back on fuel temperature / MWI out of band.
runback_limit = interp({'08:00': 999, HEATER_TRIP: 999, '08:40': 204, '08:45': 183, '09:20': 183,
                        '09:30': 200, '09:40': 216, RELOAD_DONE: 999, '14:05': 999})
leak = [0.0 if minutes(t) <= minutes(LEAK_START) else
        LEAK_FRAC_NOW * ((minutes(t) - minutes(LEAK_START)) / (END - minutes(LEAK_START))) ** 0.8 for t in TS]
fan6_off = window(FAN_TRIP, FAN_RESET)

# ── Block simulation: AGC holds net output at the dispatch target ────────
gt_mw = {1: [0.0] * N, 2: [0.0] * N}
gt_cap = {1: [0.0] * N, 2: [0.0] * N}
gt_limit_used = [False] * N
st_mw, bp, cw_sup, cw_ret, aux, gross = [0.0] * N, [0.0] * N, [0.0] * N, [0.0] * N, [0.0] * N, [0.0] * N
approach = lagged([8.1 + (2.3 if off else 0.0) for off in fan6_off], k=0.5)
approach = [a + e for a, e in zip(approach, ar1(0.12))]
ttd = plus_noise([6.4] * N, 0.12)
st_state = 0.56 * 2 * 213.0
bp_prev, aux_prev = 2.35, 19.5
agc_err = ar1(1.1, 0.5)
gt_noise = {1: ar1(0.6, 0.5), 2: ar1(0.6, 0.5)}
for i in range(N):
    for g in (1, 2):
        base = GT_RATED_ISO * (1 - 0.0042 * (ambient[i] - 59))
        gt_cap[g][i] = base * (1 - 0.021 * FOUL[g][i])            # ~2.1% output per efficiency point
    k_eff = ST_RATIO * (1 - 0.05 * (bp_prev - 2.3)) * (1 - 0.72 * leak[i])
    target = dispatch[i] + agc_err[i]
    gt_total = (target + aux_prev - (1 - LAG) * st_state) / (1 + LAG * k_eff)
    share = {1: 0.505 * gt_total, 2: 0.495 * gt_total}
    for g in (1, 2):
        lim = min(gt_cap[g][i], runback_limit[i])
        if runback_limit[i] < gt_cap[g][i]:
            gt_limit_used[i] = True
        if share[g] > lim:
            other = 2 if g == 1 else 1
            share[other] += share[g] - lim
            share[g] = lim
    for g in (1, 2):
        lim = min(gt_cap[g][i], runback_limit[i])
        share[g] = min(share[g], lim)
        gt_mw[g][i] = share[g] + gt_noise[g][i]
    st_state += (k_eff * (gt_mw[1][i] + gt_mw[2][i]) - st_state) * LAG
    st_mw[i] = st_state
    # Condenser: heat to reject ∝ ST output + any bypass steam; CW supply from the tower.
    cw_sup[i] = wet_bulb[i] + approach[i]
    rng_f = 20.4 * (st_mw[i] / 250.0) * (1 + 0.45 * leak[i])
    cw_ret[i] = cw_sup[i] + rng_f
    bp[i] = psat_inhga(cw_ret[i] + ttd[i])
    bp_prev = bp[i]
    gross[i] = gt_mw[1][i] + gt_mw[2][i] + st_mw[i]
    aux[i] = aux_prev = 4.6 + 0.012 * gross[i] + 3.0 + 3.65 + rng.gauss(0, 0.05)

# Round the unit outputs first so every rollup sums the stored values exactly.
put(CTG[1], 'gen_output_mw', gt_mw[1])
put(CTG[2], 'gen_output_mw', gt_mw[2])
put(STG, 'gen_output_mw', st_mw)
GT_MW = {g: S(CTG[g], 'gen_output_mw') for g in (1, 2)}
ST_MW = S(STG, 'gen_output_mw')
gross_r = [rnd(a + b + c, 1) for a, b, c in zip(GT_MW[1], GT_MW[2], ST_MW)]


# ── Gas turbines ────────────────────────────────────────────────────────
STEPS_24H = 24 * 60 // STEP


def eaf(derate_frac):
    """Rolling 24-hour equivalent availability; no derates before 08:00 today."""
    out, lost = [], 0.0
    for d in derate_frac:
        lost += d
        out.append(100 * (1 - lost / STEPS_24H))
    return out


gt_fuel, gt_nox, gt_derate = {}, {}, {}
runback_frac = [max(0.0, 1 - runback_limit[i] / gt_cap[1][i]) if runback_limit[i] < gt_cap[1][i] else 0.0
                for i in range(N)]
for g in (1, 2):
    u = CTG[g]
    mw = GT_MW[g]
    cap_clean = [GT_RATED_ISO * (1 - 0.0042 * (a - 59)) for a in ambient]
    lf = [m / c for m, c in zip(mw, cap_clean)]
    foul = FOUL[g]
    hr = [9420 * (1 + 0.22 * max(0.0, 0.97 - x) ** 1.4) * (1 + 0.0105 * f) * (1 + 0.0012 * (a - 78)) + e
          for x, f, a, e in zip(lf, foul, ambient, ar1(9, 0.7))]
    heater_pen = [0.012 if (minutes(HEATER_TRIP) <= minutes(t) < minutes('09:45')) else 0.0 for t in TS]
    hr = [h * (1 + p) for h, p in zip(hr, heater_pen)]
    fuel = [m * h / 1000 for m, h in zip(mw, hr)]
    put(u, 'fuel_heat_input_mmbtu_h', fuel)
    gt_fuel[g] = S(u, 'fuel_heat_input_mmbtu_h')
    put(u, 'gt_heat_rate_btu_kwh', [f * 1000 / m for f, m in zip(gt_fuel[g], mw)])
    put(u, 'corrected_output_pct', [100 * (1 - 0.021 * f) + e for f, e in zip(foul, ar1(0.08, 0.6))])
    gt_derate[g] = runback_frac
    put(u, 'equiv_availability_pct', eaf(runback_frac))
    # Inlet
    dp0 = 2.05 if g == 1 else 2.45
    put(f'{u}_INLET', 'inlet_filter_dp_inh2o', [dp0 * (0.8 + 0.2 * x) + 0.02 * (minutes(t) - START) / 60 + e
                                                 for x, t, e in zip(lf, TS, ar1(0.03))])
    put(f'{u}_INLET', 'compressor_inlet_temp_f', [a + 0.8 + e for a, e in zip(ambient, ar1(0.15))])
    # Compressor: IGVs close at part load to hold exhaust temperature
    igv = [min(86.0, 57 + 33 * x) + e for x, e in zip(lf, ar1(0.25))]
    eff = [88.65 - f + (-0.25 if minutes(WASH_START) <= minutes(t) < minutes(WASH_END) and g == 2 else 0) + e
           for f, t, e in zip(foul, TS, ar1(0.05, 0.7))]
    put(f'{u}_COMP', 'compressor_efficiency_pct', eff)
    put(f'{u}_COMP', 'igv_position_deg', igv)
    cpd = [14.7 * (11.5 + 5.6 * x) * (1 - 0.012 * f) - 14.7 + e for x, f, e in zip(lf, foul, ar1(0.5))]
    put(f'{u}_COMP', 'compressor_discharge_pressure_psig', cpd)
    put(f'{u}_COMP', 'compressor_discharge_temp_f', [690 + 95 * x + 0.9 * (a - 59) + 3.5 * f + e
                                                      for x, a, f, e in zip(lf, ambient, foul, ar1(1.2))])
    # Combustion: dynamics and NOx rise with the heater trip (fuel temp / MWI out of band);
    # CTG-1 shows recurring hot-tone excursions from late morning (HSIT09).
    base_dyn = interp({'08:00': 1.02, '11:00': 1.08, '14:05': 1.34}) if g == 1 else [1.0] * N
    heater_dyn = interp({'08:00': 0, HEATER_TRIP: 0, '08:50': 0.95, '09:15': 1.05, '09:40': 0.2, '09:50': 0, '14:05': 0})
    dyn = [b + h + e for b, h, e in zip(base_dyn, heater_dyn, ar1(0.06, 0.4))]
    nox = [9.0 + 0.9 * (x - 0.85) + 3.0 * h + e for x, h, e in zip(lf, heater_dyn, ar1(0.18, 0.7))]
    if g == 1:
        spike_vals = [2.62, 2.81, 2.94, 3.02, 3.21, 3.38]
        for t, sv in zip(COMB_SPIKES, spike_vals):
            dyn[i_of(t)] = sv + rng.gauss(0, 0.03)
            nox[i_of(t)] += 1.4 + 0.2 * rng.random()
    put(f'{u}_COMB', 'combustion_dynamics_psi', [max(0.3, d) for d in dyn])
    put(f'{u}_COMB', 'gt_exit_nox_ppm', nox)
    gt_nox[g] = S(f'{u}_COMB', 'gt_exit_nox_ppm')
    put(f'{u}_COMB_GCV', 'gcv_position_pct', [22 + 44 * x + e for x, e in zip(lf, ar1(0.4))])
    put(f'{u}_COMB_GCV', 'fuel_gas_intervalve_pressure_psig', [300 + 110 * x + e for x, e in zip(lf, ar1(1.5))])
    # Turbine section. Exhaust held high at part load by IGV temperature control.
    exh = [1112 + 55 * max(0.0, 0.93 - x) + 0.35 * (a - 78) + 3.2 * f + e
           for x, a, f, e in zip(lf, ambient, foul, ar1(1.5))]
    put(f'{u}_TURB', 'exhaust_temp_f', exh)
    spread = [31 + 4 * (1 - x) + e for x, e in zip(lf, ar1(1.6, 0.6))]
    spread = [s + 9 * h for s, h in zip(spread, heater_dyn)]
    if g == 2:
        erratic = {'10:05': 71.0, '10:10': 44.0, '10:15': 96.0, '10:20': 38.0, '10:25': 103.0, '10:30': 58.0,
                   '10:35': 112.0, '10:40': 41.0, '10:45': 94.0, '10:50': 36.0, '10:55': 108.0, '11:00': 77.0}
        for t, val in erratic.items():
            spread[i_of(t)] = val + rng.gauss(0, 1.0)
    put(f'{u}_TURB', 'exhaust_temp_spread_f', spread)
    put(f'{u}_TURB', 'wheelspace_temp_f', [742 + 55 * x + 0.3 * (a - 78) + e for x, a, e in zip(lf, ambient, ar1(1.2))])
    for b, (t0, v0) in (('BRG1', (192, 2.3)), ('BRG2', (203, 2.9))):
        tgt = [t0 + 14 * (x - 0.8) + 0.25 * (a - 78) for x, a in zip(lf, ambient)]
        put(f'{u}_TURB_{b}', 'bearing_metal_temp_f', plus_noise(lagged(tgt, k=0.4), 0.5))
        put(f'{u}_TURB_{b}', 'shaft_vibration_mils', [v0 + 0.3 * (x - 0.8) + e for x, e in zip(lf, ar1(0.06))])
    # Generator, H2, exciter, GSU
    gen = f'{u}_GEN'
    mvar = [42 + 0.08 * m + e for m, e in zip(mw, ar1(2.5, 0.8))]
    put(gen, 'gen_reactive_mvar', mvar)
    put(gen, 'gen_terminal_voltage_kv', [18.0 + 0.002 * q + e for q, e in zip(mvar, ar1(0.03))])
    put(gen, 'stator_winding_temp_f', plus_noise(lagged([118 + 0.24 * m + 0.2 * (a - 78) for m, a in zip(mw, ambient)], k=0.3), 0.5))
    put(f'{gen}_H2', 'h2_purity_pct', plus_noise([98.35 if g == 1 else 97.9] * N, 0.05, 0.9))
    put(f'{gen}_H2', 'h2_pressure_psig', plus_noise([60.0 if g == 1 else 59.2] * N, 0.2, 0.9))
    put(f'{gen}_H2', 'cold_gas_temp_f', plus_noise([100 + 0.35 * (w - 70) for w in wet_bulb], 0.3))
    put(f'{gen}_EXC', 'field_current_a', [1250 + 3.6 * m + 3.5 * q + e for m, q, e in zip(mw, mvar, ar1(8))])
    put(f'{gen}_EXC', 'field_voltage_v', [175 + 0.55 * m + e for m, e in zip(mw, ar1(2))])
    mva = [math.hypot(m, q) for m, q in zip(mw, mvar)]
    put(f'{u}_GSU', 'gsu_load_pct', [100 * s / 330 for s in mva])
    oil = lagged([95 + 0.24 * s + 0.6 * (a - 78) for s, a in zip(mva, ambient)], k=0.15)
    put(f'{u}_GSU', 'gsu_top_oil_temp_f', plus_noise(oil, 0.3))
    put(f'{u}_GSU', 'gsu_winding_hotspot_f', plus_noise([o + 22 + 0.06 * s for o, s in zip(oil, mva)], 0.4))
    put(f'{u}_GSU', 'dga_h2_ppm', plus_noise([46.0 if g == 1 else 38.0] * N, 0.8, 0.9))
    put(f'{u}_GSU', 'dga_tdcg_ppm', plus_noise([312.0 if g == 1 else 268.0] * N, 3.0, 0.9))


def lube_system(u, load_frac, cw_temp, oil_base):
    lube = f'{u}_LUBE'
    lo_t = [oil_base + 0.45 * (c - 80) + 3 * x + e for c, x, e in zip(cw_temp, load_frac, ar1(0.25))]
    put(lube, 'lube_oil_header_temp_f', lo_t)
    put(lube, 'lube_oil_header_pressure_psig', plus_noise([25.2] * N, 0.12))
    put(f'{lube}_LOPA', 'lo_pump_discharge_pressure_psig', plus_noise([68.0] * N, 0.4))
    put(f'{lube}_LOPA', 'lo_pump_motor_current_a', plus_noise([104.0] * N, 0.6))
    put(f'{lube}_LOPB', 'lo_pump_discharge_pressure_psig', [0.0] * N)
    put(f'{lube}_LOPB', 'lo_pump_motor_current_a', [0.0] * N)
    put(f'{lube}_LOC', 'lo_cooler_oil_dt_f', [17.5 + 4 * x + e for x, e in zip(load_frac, ar1(0.2))])
    put(f'{lube}_LOC', 'cooler_water_outlet_temp_f', [c + 12 + 3 * x + e for c, x, e in zip(cw_temp, load_frac, ar1(0.25))])


for g in (1, 2):
    lube_system(CTG[g], [m / 250 for m in GT_MW[g]], cw_sup, 117.0)
lube_system(STG, [m / 280 for m in ST_MW], cw_sup, 115.0)

# ── HRSGs ───────────────────────────────────────────────────────────────
hp_flow, stack_nox_by, bfp_flow_a = {}, {}, {}
for g in (1, 2):
    u = HRSG[g]
    mw = GT_MW[g]
    hpf = [2.46 * m + e for m, e in zip(lagged(mw), ar1(2.0, 0.6))]
    hp_flow[g] = hpf
    put(u, 'hp_steam_flow_klb_h', hpf)
    put(u, 'total_steam_flow_klb_h', [h * 1.29 + e for h, e in zip(S(u, 'hp_steam_flow_klb_h'), ar1(1.5, 0.5))])
    put(u, 'stack_temp_f', [176 + 0.03 * m + 0.25 * (a - 78) + e for m, a, e in zip(mw, ambient, ar1(0.5))])
    exh = S(f'{CTG[g]}_TURB', 'exhaust_temp_f')
    # HP section — sliding pressure with steam flow
    hp_p = [760 + 2.02 * h + e for h, e in zip(hpf, ar1(4))]
    put(f'{u}_HP', 'hp_steam_pressure_psig', hp_p)
    put(f'{u}_HP', 'hp_steam_temp_f', plus_noise([1049.0] * N, 1.2, 0.6))
    drum = f'{u}_HP_DRUM'
    level = ar1(0.55, 0.6)
    fcv = [44 + 0.034 * h + e for h, e in zip(hpf, ar1(0.5, 0.6))]
    fw = [h * 1.012 + e for h, e in zip(hpf, ar1(2.0, 0.4))]
    if g == 1:
        # HSIT05 — single-element control + manual valve moves → growing level oscillation.
        amps = {'13:20': 1.6, '13:25': -2.4, '13:30': 3.1, '13:35': -3.4, '13:40': 3.9, '13:45': -4.8,
                '13:50': 5.3, '13:55': -5.9, '14:00': 6.4, '14:05': -6.9}
        for t, a in amps.items():
            k = i_of(t)
            level[k] = a + rng.gauss(0, 0.15)
            # The valve leads the level by roughly half a cycle; flow follows the valve.
            fcv[k] = fcv[k] - 2.4 * a + rng.gauss(0, 0.3)
            fw[k] = fw[k] - 11.5 * a + rng.gauss(0, 1.5)
    put(drum, 'drum_level_in', level)
    put(drum, 'hp_drum_pressure_psig', [p + 85 + 0.02 * h for p, h in zip(hp_p, hpf)])
    put(f'{drum}_FCV', 'fcv_position_pct', fcv)
    put(f'{drum}_FCV', 'hp_fw_flow_klb_h', fw)
    # Superheater + attemperator. HRSG-1 overnight NOx setpoint change doesn't touch steam side.
    spray = [9.0 + 0.045 * (e_ - 1120) + 0.012 * h + n for e_, h, n in zip(exh, hpf, ar1(0.5, 0.6))]
    spray = [max(1.5, s) for s in spray]
    put(f'{u}_HP_SH_ATT', 'attemp_spray_flow_klb_h', spray)
    put(f'{u}_HP_SH_ATT', 'attemp_valve_position_pct', [6 + 1.55 * s + e for s, e in zip(spray, ar1(0.4))])
    tsat = [tsat_f_from_psig(p) for p in hp_p]
    inter = [930 - 3.2 * s + 0.4 * (e_ - 1120) + n for s, e_, n in zip(spray, exh, ar1(1.5))]
    put(f'{u}_HP_SH', 'sh_interstage_temp_f', inter)
    put(f'{u}_HP_SH_ATT', 'attemp_superheat_margin_f', [x - t for x, t in zip(inter, tsat)])
    put(f'{u}_HP_SH', 'sh_tube_metal_temp_f', [1078 + 0.25 * (e_ - 1120) + n for e_, n in zip(exh, ar1(1.5))])
    # IP / reheat
    ip_p = [180 + 0.36 * h + e for h, e in zip(hpf, ar1(1.2))]
    put(f'{u}_IP', 'ip_steam_pressure_psig', ip_p)
    put(f'{u}_IP', 'hot_reheat_temp_f', plus_noise([1046.0] * N, 1.2, 0.6))
    put(f'{u}_IP_DRUM', 'drum_level_in', ar1(0.5, 0.6))
    put(f'{u}_IP_DRUM', 'ip_drum_pressure_psig', [p + 32 for p in ip_p])
    put(f'{u}_IP_RH', 'rh_tube_metal_temp_f', [1071 + 0.22 * (e_ - 1120) + n for e_, n in zip(exh, ar1(1.4))])
    put(f'{u}_IP_RH', 'rh_steam_flow_klb_h', [h * 1.15 + e for h, e in zip(hpf, ar1(1.5))])
    # LP
    lp_p = [34 + 0.05 * h + e for h, e in zip(hpf, ar1(0.5))]
    put(f'{u}_LP', 'lp_steam_pressure_psig', lp_p)
    put(f'{u}_LP', 'lp_steam_temp_f', plus_noise([552.0] * N, 1.5))
    put(f'{u}_LP_DRUM', 'drum_level_in', ar1(0.45, 0.6))
    put(f'{u}_LP_DRUM', 'lp_drum_pressure_psig', [p + 8 for p in lp_p])
    # Feedwater system and pumps (A running, B standby)
    fw_hdr = [hp + 330 + e for hp, e in zip(hp_p, ar1(5))]
    put(f'{u}_FW', 'fw_header_pressure_psig', fw_hdr)
    put(f'{u}_FW', 'fw_cation_conductivity_us_cm', plus_noise([0.118 if g == 1 else 0.124] * N, 0.004, 0.9))
    bfa, bfb = f'{u}_FW_BFPA', f'{u}_FW_BFPB'
    gpm = [(f + 0.16 * h) * 1000 / 60 / 7.72 for f, h in zip(S(f'{drum}_FCV', 'hp_fw_flow_klb_h'), hpf)]
    gpm = [x + e for x, e in zip(gpm, ar1(6, 0.4))]
    put(bfa, 'bfp_flow_gpm', gpm)
    bfp_flow_a[g] = S(bfa, 'bfp_flow_gpm')
    put(bfa, 'bfp_discharge_pressure_psig', [p + 90 - 0.02 * (q - 1300) + e for p, q, e in zip(fw_hdr, gpm, ar1(4))])
    put(bfa, 'bfp_speed_rpm', [2600 + 0.55 * q + e for q, e in zip(gpm, ar1(6))])
    for k in ('bfp_discharge_pressure_psig', 'bfp_flow_gpm', 'bfp_speed_rpm'):
        put(bfb, k, [0.0] * N)
    # BFP-A components. HSIT01: HRSG-2 BFP-A bearing wear from 09:30.
    wear_t = ramp(BFP_START, '14:05', BFP_TEMP_RISE_F, 1.25) if g == 2 else [0.0] * N
    wear_v = ramp(BFP_START, '14:05', BFP_VIB_RISE_IPS, 1.8) if g == 2 else [0.0] * N
    wear_i = ramp(BFP_START, '14:05', 7.0, 1.3) if g == 2 else [0.0] * N
    amps_ = [210 + 0.13 * q + w + e for q, w, e in zip(gpm, wear_i, ar1(1.5))]
    put(f'{bfa}_MTR', 'motor_current_a', amps_)
    put(f'{bfa}_MTR', 'motor_winding_temp_f', plus_noise(lagged([128 + 0.17 * a + 0.3 * (amb - 78) for a, amb in zip(amps_, ambient)], k=0.3), 0.5))
    brg_base = 158.0 if g == 1 else 161.0
    put(f'{bfa}_BRG', 'pump_bearing_temp_f',
        [brg_base + 0.01 * (q - 1300) + 0.2 * (a - 78) + w + e for q, a, w, e in zip(gpm, ambient, wear_t, ar1(0.5))])
    put(f'{bfa}_BRG', 'pump_vibration_ips', [0.118 + w + abs(e) * 0.4 + e for w, e in zip(wear_v, ar1(0.006, 0.5))])
    put(f'{bfb}_MTR', 'motor_current_a', [0.0] * N)
    put(f'{bfb}_MTR', 'motor_winding_temp_f', plus_noise([a + 12 for a in ambient], 0.3))
    put(f'{bfb}_BRG', 'pump_bearing_temp_f', plus_noise([a + 9 for a in ambient], 0.3))
    put(f'{bfb}_BRG', 'pump_vibration_ips', [0.008 + abs(e) for e in ar1(0.002)])

    # SCR. HRSG-1: the NOx trim setpoint was lowered overnight → controller keeps
    # pushing NH3/NOx up, slip climbs nonlinearly; setpoint restored at 11:15 (HSIT08).
    # HRSG-2: ammonia forwarding pump trip 12:20–12:35 (HSIT10).
    nox_in = gt_nox[g]
    if g == 1:
        ratio = [r + e for r, e in zip(interp({'08:00': 0.893, '09:30': 0.918, '11:10': 0.949, '11:15': 0.949,
                                                '11:35': 0.874, '12:00': 0.866, '14:05': 0.868}), ar1(0.003, 0.6))]
    else:
        ratio = [0.868 + e for e in ar1(0.003, 0.6)]
        trip = {'12:20': 0.30, '12:25': 0.0, '12:30': 0.0, '12:35': 0.74, '12:40': 0.91}
        for t, r in trip.items():
            ratio[i_of(t)] = r
    removal = [min(0.95, 0.955 * r) if r > 0.05 else 0.0 for r in ratio]
    if g == 2:   # the catalyst stays partly loaded with stored NH3 for a few minutes
        removal[i_of('12:20')] = 0.56
        removal[i_of('12:25')] = 0.12
        removal[i_of('12:30')] = 0.04
    stack = [n * (1 - rm) + e for n, rm, e in zip(nox_in, removal, ar1(0.03, 0.5))]
    slip = [1.2 + 90 * max(0.0, r - 0.80) ** 1.8 + e if r > 0.05 else 0.1 for r, e in zip(ratio, ar1(0.04, 0.5))]
    slip = [max(0.05, s) for s in slip]
    exh_flow_lbh = [4.1e6 * (0.75 + 0.25 * m / 250) for m in mw]
    nh3 = [r * n * 1e-6 * f / 28.8 * 17 / 0.19 for r, n, f in zip(ratio, nox_in, exh_flow_lbh)]
    put(f'{u}_SCR_NH3', 'nh3_nox_ratio', ratio)
    put(f'{u}_SCR_NH3', 'ammonia_flow_lb_h', nh3)
    put(f'{u}_SCR', 'scr_inlet_nox_ppm', nox_in)
    put(f'{u}_SCR_CEMS', 'stack_nox_ppm', stack)
    stack_nox_by[g] = S(f'{u}_SCR_CEMS', 'stack_nox_ppm')
    put(f'{u}_SCR', 'nox_removal_pct', [100 * (1 - s / n) for s, n in zip(stack_nox_by[g], S(f'{u}_SCR', 'scr_inlet_nox_ppm'))])
    put(f'{u}_SCR', 'ammonia_slip_ppm', slip)
    put(f'{u}_SCR_CAT', 'catalyst_dp_inh2o', [2.7 + 0.5 * (m / 250) + e for m, e in zip(mw, ar1(0.03))])
    put(f'{u}_SCR_CAT', 'scr_inlet_temp_f', [598 + 0.12 * (e_ - 1120) + 0.06 * m + n for e_, m, n in zip(exh, mw, ar1(1.0))])
    put(f'{u}_SCR_CEMS', 'stack_co_ppm', plus_noise([1.1 + 0.3 * max(0, 0.85 - m / 250) for m in mw], 0.06))
    put(f'{u}_SCR_CEMS', 'stack_o2_pct', plus_noise([12.6 + 1.2 * (1 - m / 250) for m in mw], 0.05))
    if g == 2:
        hrs = [CEMS_LAST_CAL_H_AT_START + (minutes(t) - START) / 60 for t in TS]
    else:   # HRSG-1's daily cal ran at 06:00 as scheduled
        hrs = [2.0 + (minutes(t) - START) / 60 for t in TS]
    put(f'{u}_SCR_CEMS', 'hours_since_cal_h', hrs)

# ── Steam turbine ───────────────────────────────────────────────────────
hp_avg = [(a + b) / 2 for a, b in zip(S(f'{HRSG[1]}_HP', 'hp_steam_pressure_psig'), S(f'{HRSG[2]}_HP', 'hp_steam_pressure_psig'))]
st_frac = [m / 280 for m in ST_MW]
put(STG, 'throttle_pressure_psig', [p - 55 for p in hp_avg])
put(STG, 'throttle_temp_f', plus_noise([1044.0] * N, 1.0, 0.6))
st_derate = [runback_frac[i] * 0.9 for i in range(N)]     # steam follows the GT runback
put(STG, 'equiv_availability_pct', eaf(st_derate))
put(f'{STG}_HPIP', 'hp_exhaust_temp_f', plus_noise([655 + 18 * (x - 0.9) for x in st_frac], 1.0))
rs = [18 + 180 * abs(b - a) / 280 for a, b in zip([ST_MW[0]] + ST_MW[:-1], ST_MW)]
put(f'{STG}_HPIP', 'rotor_stress_pct', plus_noise(rs, 0.6, 0.5))
put(f'{STG}_LPT', 'lp_exhaust_hood_temp_f', [cr + t - 3 + e for cr, t, e in zip(cw_ret, ttd, ar1(0.4))])
put(f'{STG}_LPT', 'crossover_pressure_psig', [30 + 28 * x + e for x, e in zip(st_frac, ar1(0.4))])
for b, (t0, v0) in (('HPIP_BRG1', (178, 2.1)), ('HPIP_BRG2', (184, 2.4)), ('LPT_BRG3', (171, 2.6)), ('LPT_BRG4', (169, 2.2))):
    put(f'{STG}_{b}', 'bearing_metal_temp_f', plus_noise([t0 + 10 * (x - 0.9) + 0.2 * (a - 78) for x, a in zip(st_frac, ambient)], 0.5))
    put(f'{STG}_{b}', 'shaft_vibration_mils', plus_noise([v0 + 0.2 * (x - 0.9) for x in st_frac], 0.05))
# HSIT07: HP bypass indicates closed but passes steam — downstream temperature rises.
put(f'{STG}_BYP', 'hp_bypass_position_pct', [0.0] * N)
put(f'{STG}_BYP', 'hrh_bypass_position_pct', [0.0] * N)
put(f'{STG}_BYP', 'hp_bypass_downstream_temp_f',
    plus_noise([232 + 11500 * lk ** 0.9 * (1 if lk > 0 else 0) for lk in leak], 1.5))
put(f'{STG}_COND', 'condenser_backpressure_inhga', bp)
put(f'{STG}_COND', 'hotwell_level_in', plus_noise([24.0] * N, 0.4, 0.6))
put(f'{STG}_COND', 'condenser_ttd_f', ttd)
put(f'{STG}_COND', 'air_inleakage_scfm', plus_noise([4.2] * N, 0.15))
put(f'{STG}_COND', 'cleanliness_factor_pct', plus_noise([84.5] * N, 0.3))
put(f'{STG}_COND_VPA', 'vacuum_pump_current_a', plus_noise([96.0] * N, 0.6))
put(f'{STG}_COND_VPA', 'vp_seal_water_temp_f', [c + 6 + e for c, e in zip(cw_sup, ar1(0.3))])
put(f'{STG}_COND_VPB', 'vacuum_pump_current_a', [0.0] * N)
put(f'{STG}_COND_VPB', 'vp_seal_water_temp_f', [a - 2 + e for a, e in zip(ambient, ar1(0.3))])
cond_gpm = [(h1 + h2) * 1.29 * 1000 / 60 / 8.2 for h1, h2 in zip(hp_flow[1], hp_flow[2])]
put(f'{STG}_COND_CEPA', 'cep_flow_gpm', plus_noise(cond_gpm, 12, 0.5))
put(f'{STG}_COND_CEPA', 'cep_discharge_pressure_psig', [395 - 0.012 * q + e for q, e in zip(cond_gpm, ar1(1.5))])
put(f'{STG}_COND_CEPA', 'cep_motor_current_a', [95 + 0.018 * q + e for q, e in zip(cond_gpm, ar1(0.8))])
for k in ('cep_flow_gpm', 'cep_discharge_pressure_psig', 'cep_motor_current_a'):
    put(f'{STG}_COND_CEPB', k, [0.0] * N)
stg = f'{STG}_GEN'
st_mvar = plus_noise([30 + 0.07 * m for m in ST_MW], 2.0, 0.8)
put(stg, 'gen_reactive_mvar', st_mvar)
put(stg, 'gen_terminal_voltage_kv', [18.0 + 0.002 * q + e for q, e in zip(st_mvar, ar1(0.03))])
put(stg, 'cold_air_temp_f', [c + 14 + e for c, e in zip(cw_sup, ar1(0.3))])
put(stg, 'stator_winding_temp_f', plus_noise(lagged([128 + 0.21 * m + 0.4 * (c - 80) for m, c in zip(ST_MW, cw_sup)], k=0.3), 0.5))
put(f'{stg}_EXC', 'field_current_a', [1150 + 3.9 * m + 3.5 * q + e for m, q, e in zip(ST_MW, st_mvar, ar1(8))])
put(f'{stg}_EXC', 'field_voltage_v', [165 + 0.58 * m + e for m, e in zip(ST_MW, ar1(2))])
st_mva = [math.hypot(m, q) for m, q in zip(ST_MW, st_mvar)]
put(f'{STG}_GSU', 'gsu_load_pct', [100 * s / 340 for s in st_mva])
oil = lagged([95 + 0.23 * s + 0.6 * (a - 78) for s, a in zip(st_mva, ambient)], k=0.15)
put(f'{STG}_GSU', 'gsu_top_oil_temp_f', plus_noise(oil, 0.3))
put(f'{STG}_GSU', 'gsu_winding_hotspot_f', plus_noise([o + 22 + 0.06 * s for o, s in zip(oil, st_mva)], 0.4))
put(f'{STG}_GSU', 'dga_h2_ppm', plus_noise([41.0] * N, 0.8, 0.9))
put(f'{STG}_GSU', 'dga_tdcg_ppm', plus_noise([284.0] * N, 3.0, 0.9))

# ── Common plant: circulating water and cooling tower ───────────────────
put(CW, 'cw_supply_temp_f', cw_sup)
put(CW, 'cw_return_temp_f', cw_ret)
cwp_on = {'A': [True] * N, 'B': [True] * N, 'C': [False] * N}
for p in 'AB':
    put(CWP[p], 'cwp_flow_kgpm', plus_noise([96.5 if p == 'A' else 95.2] * N, 0.3))
    put(CWP[p], 'cwp_motor_current_a', plus_noise([188.0 if p == 'A' else 191.0] * N, 0.8))
    put(CWP[p], 'pump_vibration_ips', plus_noise([0.105 if p == 'A' else 0.121] * N, 0.004))
put(CWP['C'], 'cwp_flow_kgpm', [0.0] * N)
put(CWP['C'], 'cwp_motor_current_a', [0.0] * N)
put(CWP['C'], 'pump_vibration_ips', [0.0] * N)
put(CWPS, 'cw_flow_kgpm', [rnd(a + b + c, 1) for a, b, c in zip(*(S(CWP[p], 'cwp_flow_kgpm') for p in 'ABC'))])
put(CW, 'cw_flow_kgpm', S(CWPS, 'cw_flow_kgpm'))
put(CWPS, 'cw_header_pressure_psig', plus_noise([27.8] * N, 0.15))
put(CT, 'wet_bulb_temp_f', wet_bulb)
put(CT, 'ct_approach_f', [s - w for s, w in zip(S(CW, 'cw_supply_temp_f'), S(CT, 'wet_bulb_temp_f'))])
put(CT, 'basin_level_pct', plus_noise([63.0] * N, 0.4))
for c, cell in enumerate(CELLS, start=1):
    off = fan6_off if c == FAN_CELL else [False] * N
    base_kw = 171 + rng.uniform(-4, 4)
    put(cell, 'ct_cell_fan_power_kw', [0.0 if o else base_kw + e for o, e in zip(off, ar1(1.2))])
    put(cell, 'cell_outlet_temp_f', [(r - 3.0) if o else s + rng.uniform(-0.4, 0.4) + e
                                     for o, s, r, e in zip(off, cw_sup, cw_ret, ar1(0.2))])
    gbx = f'{cell}_GBX'
    vib0 = 0.14 + rng.uniform(-0.02, 0.03)
    put(gbx, 'ct_gearbox_vibration_ips', [0.012 if o else vib0 + e for o, e in zip(off, ar1(0.006))])
    put(gbx, 'ct_gearbox_oil_temp_f', plus_noise(lagged([a + 5 if o else 138 + 0.5 * (a - 78) for o, a in zip(off, ambient)], k=0.25), 0.4))
put(CT, 'ct_fan_power_kw', [rnd(sum(S(cell, 'ct_cell_fan_power_kw')[i] for cell in CELLS), 1) for i in range(N)])
common_aux = [(sum(S(CWP[p], 'cwp_motor_current_a')[i] for p in 'ABC') * 4.16 * 1.732 * 0.88
               + S(CT, 'ct_fan_power_kw')[i]) / 1000 + 0.6 for i in range(N)]
put(CP, 'common_aux_load_mw', common_aux)

# ── Common plant: fuel gas yard ─────────────────────────────────────────
hhv = plus_noise([1036.0] * N, 0.8, 0.9)
put(GC, 'gas_hhv_btu_scf', hhv)
put(GC, 'wobbe_index_btu_scf', [h * 1.318 + e for h, e in zip(hhv, ar1(0.4))])
put(GC, 'hc_dew_point_f', plus_noise([34.0] * N, 0.6))
heater_off = window(HEATER_TRIP, HEATER_RESTORE)
water = [0.0 if o else 182 + e for o, e in zip(heater_off, ar1(1.5))]
put(HTR, 'heater_water_flow_gpm', water)
gtemp_tgt = [95 + 0.3 * (a - 78) if o else 365.0 for o, a in zip(heater_off, ambient)]
gtemp = [g + e for g, e in zip(lagged(gtemp_tgt, start=365.0, k=0.32), ar1(0.8))]
put(HTR, 'fuel_gas_temp_f', gtemp)
lhv = [h * 0.902 for h in hhv]
put(HTR, 'modified_wobbe_index', [l / math.sqrt(0.585 * (t + 460)) for l, t in zip(lhv, S(HTR, 'fuel_gas_temp_f'))])
fuel_total = [a + b for a, b in zip(gt_fuel[1], gt_fuel[2])]
put(FG, 'fuel_gas_flow_kscfh', [f * 1000 / h for f, h in zip(fuel_total, S(GC, 'gas_hhv_btu_scf'))])
put(FG, 'fuel_gas_supply_pressure_psig', [548 - 0.004 * f + e for f, e in zip(fuel_total, ar1(1.5))])
put(FSEP, 'filter_sep_dp_psid', [2.6 + 0.00045 * f + e for f, e in zip(fuel_total, ar1(0.05))])
put(FSEP, 'separator_liquid_level_pct', plus_noise(interp({'08:00': 18.0, '14:05': 23.0}), 0.3))

# ── Plant totals ────────────────────────────────────────────────────────
blk_gross = gross_r
put(BLK, 'gross_output_mw', blk_gross)
put(SITE_ID, 'gross_output_mw', blk_gross)
put(BLK, 'block_fuel_input_mmbtu_h', [rnd(a + b, 0) for a, b in zip(gt_fuel[1], gt_fuel[2])])
put(BLK, 'equiv_availability_pct', [(a + b + c) / 3 for a, b, c in zip(S(CTG[1], 'equiv_availability_pct'),
                                                                        S(CTG[2], 'equiv_availability_pct'),
                                                                        S(STG, 'equiv_availability_pct'))])
put(SITE_ID, 'equiv_availability_pct', S(BLK, 'equiv_availability_pct'))
block_aux = [4.6 + 0.012 * g + 3.0 for g in blk_gross]
put(SITE_ID, 'aux_load_mw', [b + c for b, c in zip(block_aux, S(CP, 'common_aux_load_mw'))])
net = [rnd(g - a, 1) for g, a in zip(blk_gross, S(SITE_ID, 'aux_load_mw'))]
put(SITE_ID, 'net_output_mw', net)
put(SITE_ID, 'dispatch_target_mw', dispatch)
put(SITE_ID, 'net_heat_rate_btu_kwh', [f * 1000 / n for f, n in zip(S(BLK, 'block_fuel_input_mmbtu_h'), net)])
put(SITE_ID, 'ambient_temp_f', ambient)

# ── Switchyard ──────────────────────────────────────────────────────────
l1 = [rnd(n * 0.522 + e, 1) for n, e in zip(net, ar1(1.2, 0.6))]
put(LINES[0], 'line_flow_mw', l1)
put(LINES[1], 'line_flow_mw', [n - a for n, a in zip(net, S(LINES[0], 'line_flow_mw'))])
put(SWYD, 'net_export_mw', [rnd(a + b, 1) for a, b in zip(S(LINES[0], 'line_flow_mw'), S(LINES[1], 'line_flow_mw'))])
put(LINES[0], 'line_mvar', plus_noise([58.0] * N, 3.0))
put(LINES[1], 'line_mvar', plus_noise([51.0] * N, 3.0))
put(BUS, 'bus_voltage_kv', plus_noise([351.5] * N, 0.6))
put(BUS, 'grid_frequency_hz', plus_noise([60.0] * N, 0.008, 0.4))

# Current values = last point (spec §5.3); nameplate is static.
values = {aid: {k: s[-1] for k, s in props.items()} for aid, props in series.items()}
for g in (1, 2):
    values[CTG[g]]['rated_output_mw'] = GT_RATED_ISO
values[STG]['rated_output_mw'] = ST_RATED

# ── Relationships (spec §3.6) ────────────────────────────────────────────
rels = []


def edge(a, b, layer, label=None):
    assert a in A and b in A, (a, b)
    rels.append({'sourceAssetId': a, 'targetAssetId': b, 'relationshipType': 'feeds_into', 'label': label, 'layer': layer})


# fuel gas
edge(FSEP, HTR, 'fuel_gas')
edge(FSEP, GC, 'fuel_gas', 'analyzer sample line')
for g in (1, 2):
    edge(HTR, f'{CTG[g]}_COMB_GCV', 'fuel_gas', 'heated fuel gas')
for g in (1, 2):
    c, h = CTG[g], HRSG[g]
    # air / gas path through the gas turbine
    edge(f'{c}_INLET', f'{c}_COMP', 'gas_path', 'filtered inlet air')
    edge(f'{c}_COMP', f'{c}_COMB', 'gas_path', 'compressor discharge air')
    edge(f'{c}_COMB', f'{c}_TURB', 'gas_path', 'hot combustion gas')
    # exhaust gas through the HRSG
    edge(f'{c}_TURB', f'{h}_HP', 'exhaust_gas', 'GT exhaust')
    edge(f'{h}_HP', f'{h}_SCR', 'exhaust_gas')
    edge(f'{h}_SCR', f'{h}_IP', 'exhaust_gas')
    edge(f'{h}_IP', f'{h}_LP', 'exhaust_gas')
    edge(f'{h}_SCR_CAT', f'{h}_SCR_CEMS', 'exhaust_gas', 'stack gas sample')
    edge(f'{h}_SCR_NH3', f'{h}_SCR_CAT', 'chemical_dosing', 'vaporized aqueous ammonia')
    # power
    edge(f'{c}_TURB', f'{c}_GEN', 'power', 'shaft')
    edge(f'{c}_GEN', f'{c}_GSU', 'power', '18 kV')
    edge(f'{c}_GSU', BUS, 'power', '18 kV → 345 kV')
    # steam
    edge(f'{h}_HP_DRUM', f'{h}_HP_SH', 'steam', 'saturated steam')
    edge(f'{h}_HP_SH', f'{STG}_HPIP', 'steam', 'main steam')
    edge(f'{STG}_HPIP', f'{h}_IP_RH', 'steam', 'cold reheat')
    edge(f'{h}_IP_DRUM', f'{h}_IP_RH', 'steam', 'IP steam joins cold reheat')
    edge(f'{h}_IP_RH', f'{STG}_HPIP', 'steam', 'hot reheat')
    edge(f'{h}_LP_DRUM', f'{STG}_LPT', 'steam', 'LP admission')
    edge(f'{h}_HP_SH', f'{STG}_BYP', 'steam', 'HP bypass (startup / trip)')
    # condensate and feedwater
    edge(f'{STG}_COND_CEPA', f'{h}_LP_DRUM', 'feedwater', 'condensate via LP economizer')
    edge(f'{STG}_COND_CEPB', f'{h}_LP_DRUM', 'feedwater', 'standby')
    for p in 'AB':
        edge(f'{h}_LP_DRUM', f'{h}_FW_BFP{p}', 'feedwater', 'BFP suction')
        edge(f'{h}_FW_BFP{p}', f'{h}_HP_DRUM_FCV', 'feedwater', 'HP feedwater')
        edge(f'{h}_FW_BFP{p}', f'{h}_IP_DRUM', 'feedwater', 'IP feedwater (interstage bleed)')
        edge(f'{h}_FW_BFP{p}', f'{h}_HP_SH_ATT', 'feedwater', 'spray water')
    edge(f'{h}_IP', HTR, 'feedwater', 'IP economizer water for fuel heating')
    # lube oil
    lube = f'{c}_LUBE'
    edge(f'{lube}_LOPA', f'{lube}_LOC', 'lube_oil')
    edge(f'{lube}_LOPB', f'{lube}_LOC', 'lube_oil', 'standby')
    for b in ('BRG1', 'BRG2'):
        edge(f'{lube}_LOC', f'{c}_TURB_{b}', 'lube_oil', 'bearing oil')
    edge(f'{lube}_LOC', f'{c}_GEN', 'lube_oil', 'generator bearings')
    edge(CWPS, f'{lube}_LOC', 'cooling_water', 'via closed cooling water')
# steam turbine internals
edge(f'{STG}_HPIP', f'{STG}_LPT', 'steam', 'IP exhaust crossover')
edge(f'{STG}_LPT', f'{STG}_COND', 'steam', 'exhaust steam')
edge(f'{STG}_BYP', f'{STG}_COND', 'steam', 'bypass steam to condenser')
edge(f'{STG}_LPT', f'{STG}_GEN', 'power', 'shaft')
edge(f'{STG}_GEN', f'{STG}_GSU', 'power', '18 kV')
edge(f'{STG}_GSU', BUS, 'power', '18 kV → 345 kV')
lube = f'{STG}_LUBE'
edge(f'{lube}_LOPA', f'{lube}_LOC', 'lube_oil')
edge(f'{lube}_LOPB', f'{lube}_LOC', 'lube_oil', 'standby')
for b in ('HPIP_BRG1', 'HPIP_BRG2', 'LPT_BRG3', 'LPT_BRG4'):
    edge(f'{lube}_LOC', f'{STG}_{b}', 'lube_oil', 'bearing oil')
edge(CWPS, f'{lube}_LOC', 'cooling_water', 'via closed cooling water')
# circulating water loop (a real cycle)
for p in 'ABC':
    edge(CWP[p], f'{STG}_COND', 'cooling_water', 'circulating water' if p != 'C' else 'spare pump')
edge(f'{STG}_COND', CT, 'cooling_water', 'warm water return')
edge(CT, CWPS, 'cooling_water', 'cold water basin')
# grid
for ln in LINES:
    edge(BUS, ln, 'power', '345 kV')

# ── Unit status (spec §6.6) ──────────────────────────────────────────────
PRODUCT = {'gas_turbine': 'Grid export (AGC)', 'steam_turbine': 'Grid export (AGC)', 'hrsg': 'HP / IP / LP steam',
           'circulating_water': 'Cooling water', 'fuel_gas_yard': 'Fuel gas to CTGs', 'switchyard': '345 kV export'}
unit_status = {u: {'state': 'running', 'statusSinceMinutes': None, 'mode': 'STEADY',
                   'product': PRODUCT[A[u]['assetType']]} for u in UNITS}


# ── Attention items — evidence read back from the series ────────────────
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
    unit, d = PROPS[key][1], PROPS[key][5]
    d = min(d, 2)
    s = f'{v:,.{d}f}'
    if unit == '%':
        return f'{s}%'
    return f'{s} {unit}' if unit else s


def evidence(aid, key, points):
    ev, evp = [], []
    for t, note in points:
        v = S(aid, key)[i_of(t)]
        ev.append(v)
        evp.append({'time': t, 'value': fmt(v, key), 'label': note})
    return ev, evp


def since_text(mins, resolved):
    h, m = divmod(mins, 60)
    body = f'{h}h {m}m ago' if h else f'{m}m ago'
    return f'Resolved {body}' if resolved else body


def item(iid, aid, key, points, severity, state, outcome, since_t, signal, interp_text, detail):
    ev, evp = evidence(aid, key, points)
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


def v(aid, key, t):
    return S(aid, key)[i_of(t)]


def mean_(xs):
    return sum(xs) / len(xs)


# Assets the scenarios sit on
bfp2_brg = f'{HRSG[2]}_FW_BFPA_BRG'
bfp1_brg = f'{HRSG[1]}_FW_BFPA_BRG'
comp2 = f'{CTG[2]}_COMP'
turb2 = f'{CTG[2]}_TURB'
condenser = f'{STG}_COND'
drum1 = f'{HRSG[1]}_HP_DRUM'
scr1 = f'{HRSG[1]}_SCR'
comb1 = f'{CTG[1]}_COMB'
nh3_2 = f'{HRSG[2]}_SCR_NH3'
cems2 = f'{HRSG[2]}_SCR_CEMS'

# Numbers quoted in the narrative text, computed from the series.
q = {}
q['bfp_now'] = v(bfp2_brg, 'pump_bearing_temp_f', '14:05')
q['bfp_sib'] = v(bfp1_brg, 'pump_bearing_temp_f', '14:05')
q['bfp_t0'] = v(bfp2_brg, 'pump_bearing_temp_f', '09:30')
q['bfp_vib0'] = v(bfp2_brg, 'pump_vibration_ips', '09:30')
q['bfp_vib'] = v(bfp2_brg, 'pump_vibration_ips', '14:05')
q['bfp_flow'] = mean_(S(f'{HRSG[2]}_FW_BFPA', 'bfp_flow_gpm')[i_of('09:30'):])
q['eff1'] = v(f'{CTG[1]}_COMP', 'compressor_efficiency_pct', '11:25')
q['eff2_0'] = v(comp2, 'compressor_efficiency_pct', '08:00')
q['eff2_min'] = v(comp2, 'compressor_efficiency_pct', '11:25')
q['eff2_now'] = v(comp2, 'compressor_efficiency_pct', '14:05')
q['co2_min'] = v(CTG[2], 'corrected_output_pct', '11:25')
q['co2_now'] = v(CTG[2], 'corrected_output_pct', '14:05')
q['hr_gap_min'] = v(CTG[2], 'gt_heat_rate_btu_kwh', '11:25') / v(CTG[1], 'gt_heat_rate_btu_kwh', '11:25') - 1
q['spread_max'] = max(S(turb2, 'exhaust_temp_spread_f')[i_of(TC_FAULT):i_of(TC_REJECT)])
q['spread_ok'] = v(turb2, 'exhaust_temp_spread_f', '11:10')
q['bp0'] = v(condenser, 'condenser_backpressure_inhga', '10:45')
q['bp_pk'] = max(S(condenser, 'condenser_backpressure_inhga')[i_of('10:50'):i_of('11:50')])
q['cws0'] = v(CW, 'cw_supply_temp_f', '10:45')
q['cws_pk'] = max(S(CW, 'cw_supply_temp_f')[i_of('10:50'):i_of('11:50')])
q['lvl_now'] = v(drum1, 'drum_level_in', '14:05')
q['lvl_prev'] = v(drum1, 'drum_level_in', '14:00')
q['fuel_t_min'] = min(S(HTR, 'fuel_gas_temp_f'))
q['mwi0'] = v(HTR, 'modified_wobbe_index', '08:30')
q['mwi_max'] = max(S(HTR, 'modified_wobbe_index'))
q['net_0830'] = v(SITE_ID, 'net_output_mw', '08:30')
q['net_min'] = min(S(SITE_ID, 'net_output_mw')[i_of('08:35'):i_of('10:00')])
q['st_0830'] = v(STG, 'gen_output_mw', '08:30')
q['st_min'] = min(S(STG, 'gen_output_mw')[i_of('08:35'):i_of('10:00')])
q['hr_0'] = v(SITE_ID, 'net_heat_rate_btu_kwh', LEAK_START)
q['gthr_rise'] = (v(CTG[1], 'gt_heat_rate_btu_kwh', '14:05') + v(CTG[2], 'gt_heat_rate_btu_kwh', '14:05')) / (v(CTG[1], 'gt_heat_rate_btu_kwh', LEAK_START) + v(CTG[2], 'gt_heat_rate_btu_kwh', LEAK_START)) - 1
q['hr_now'] = v(SITE_ID, 'net_heat_rate_btu_kwh', '14:05')
q['byp_t0'] = v(f'{STG}_BYP', 'hp_bypass_downstream_temp_f', LEAK_START)
q['byp_now'] = v(f'{STG}_BYP', 'hp_bypass_downstream_temp_f', '14:05')
q['st_share_0'] = v(STG, 'gen_output_mw', LEAK_START) / (v(CTG[1], 'gen_output_mw', LEAK_START) + v(CTG[2], 'gen_output_mw', LEAK_START))
q['st_share_now'] = v(STG, 'gen_output_mw', '14:05') / (v(CTG[1], 'gen_output_mw', '14:05') + v(CTG[2], 'gen_output_mw', '14:05'))
q['slip_pk'] = v(scr1, 'ammonia_slip_ppm', SLIP_FIX)
q['slip2'] = mean_(S(f'{HRSG[2]}_SCR', 'ammonia_slip_ppm')[:i_of('12:15')])
q['stacknox1_pk'] = v(f'{HRSG[1]}_SCR_CEMS', 'stack_nox_ppm', SLIP_FIX)
q['nox2_pk'] = max(S(cems2, 'stack_nox_ppm')[i_of('12:20'):i_of('12:45')])
q['dyn_base'] = mean_(S(comb1, 'combustion_dynamics_psi')[i_of('10:00'):i_of('11:15')])
q['cems_now'] = v(cems2, 'hours_since_cal_h', '14:05')

attention = [
    item('HSIT01', bfp2_brg, 'pump_bearing_temp_f',
         [('09:30', 'Divergence begins'), ('10:30', ''), ('11:30', ''), ('12:30', ''), ('13:15', ''), ('13:45', ''), ('14:05', f'Current — HRSG-1 BFP-A {q["bfp_sib"]:.0f} °F')],
         'medium', 'investigate', 'none', BFP_START,
         'HRSG-2 BFP-A bearings running hotter and rougher at the same flow',
         'Pump bearing temperature and vibration have both been climbing since about 09:30 while flow and speed held steady — the pattern of a mechanical change inside the pump, not a load change.',
         {'signal': f'BFP-A bearing temperature is {q["bfp_now"]:.0f} °F at 14:05, up from {q["bfp_t0"]:.0f} °F at 09:30; the identical HRSG-1 BFP-A reads {q["bfp_sib"]:.0f} °F. Vibration is {q["bfp_vib"]:.3f} in/s, up from {q["bfp_vib0"]:.3f}.',
          'observed': f'Pump flow averaged {q["bfp_flow"]:,.0f} gpm with no step change; bearing temperature rising steadily and vibration rising faster in the last hour; motor current up about 7 A.',
          'derived': 'Temperature residual against the sister pump is growing, and vibration is accelerating rather than stepping — consistent with progressive wear, not a sensor offset (two independent signals agree).',
          'inferred': 'Early bearing distress on BFP-A: possible causes include lubricant degradation, bearing wear, or a developing misalignment. Not yet confirmed.',
          'recommendation': 'Take a handheld vibration spectrum and an oil sample on the next round; confirm BFP-B is ready and plan a controlled swap to BFP-B if the trend continues.',
          'relatedOccurrences': [{'date': '2026-03-11', 'summary': 'HRSG-1 BFP-B outboard bearing replaced after a 2-week vibration trend.'}],
          'whatChangedSummary': 'No maintenance, speed or setpoint change on HRSG-2 feedwater during the window — the trend is intrinsic.',
          'whatChanged': [{'time': '09:30', 'source': 'Event', 'description': 'Bearing temperature residual crosses the 2σ band vs. HRSG-1 BFP-A.', 'related': True},
                          {'time': '12:40', 'source': 'Field Check', 'description': 'Rounds operator reports BFP-A louder than normal; oil sight glass level normal.', 'related': True}],
          'confidence': 'Two independent signals agree (temperature and vibration)', 'confidenceLevel': 'medium',
          'risk': 'Medium — standby pump available, but an unplanned BFP trip would disturb HRSG-2 drum levels', 'riskLevel': 'medium',
          'expectedOutcome': 'Controlled swap to BFP-B and a planned bearing inspection'}),
    item('HSIT02', comp2, 'compressor_efficiency_pct',
         [('08:00', 'Shift start'), ('09:30', ''), ('10:45', ''), ('11:25', 'Before wash'), ('12:00', 'Wash complete'), ('12:30', ''), ('14:05', 'Current')],
         'medium', 'watch', 'recovering', WASH_START,
         'CTG-2 needing more fuel for the same megawatts — compressor efficiency drifting down',
         'CTG-2 compressor efficiency and corrected output have been sliding against CTG-1 all morning while AGC hid it by loading the unit harder. Online water wash at 11:30 recovered most of it.',
         {'signal': f'CTG-2 compressor efficiency fell from {q["eff2_0"]:.2f}% to {q["eff2_min"]:.2f}% by 11:25 (CTG-1: {q["eff1"]:.2f}%); corrected output {q["co2_min"]:.1f}% of new-and-clean. Now {q["eff2_now"]:.2f}% / {q["co2_now"]:.1f}%.',
          'observed': 'Compressor discharge pressure lower and exhaust temperature a few °F higher than CTG-1 at matched load; IGVs slightly more open.',
          'derived': f'CTG-2 heat rate ran about {100 * q["hr_gap_min"]:.1f}% above CTG-1 at 11:25 — roughly the penalty expected for this efficiency loss.',
          'inferred': 'Recoverable compressor fouling (airborne dust and pollen in dry harvest weather). The rest needs an offline crank wash at the next outage.',
          'recommendation': 'Keep watching the post-wash trend; add CTG-2 to the offline-wash list for the September outage; check inlet filter DP trend.',
          'relatedOccurrences': [{'date': '2026-08-14', 'summary': 'CTG-2 online wash recovered 0.6 pts of compressor efficiency.'}],
          'whatChangedSummary': 'Online water wash 11:30–12:00; efficiency recovered about 60% of the loss.',
          'whatChanged': [{'time': '10:40', 'source': 'Operator Action', 'description': 'Performance engineer confirms CTG-2 vs CTG-1 gap on corrected basis.', 'related': True},
                          {'time': '11:30', 'source': 'Operator Action', 'description': 'CTG-2 online compressor water wash started.', 'related': True},
                          {'time': '12:00', 'source': 'Event', 'description': 'Wash sequence complete.', 'related': True}],
          'confidence': 'Confirmed — efficiency stepped back up after the wash', 'confidenceLevel': 'high',
          'risk': 'Low — lost efficiency only; no equipment risk', 'riskLevel': 'low',
          'expectedOutcome': 'Efficiency holding near 88% until the offline wash'}),
    item('HSIT03', turb2, 'exhaust_temp_spread_f',
         [('10:00', 'Normal'), ('10:05', 'Erratic'), ('10:15', ''), ('10:35', 'Peak'), ('10:50', ''), ('11:05', 'TC-14 rejected'), ('11:10', 'Normal')],
         'high', 'watch', 'resolved', TC_REJECT,
         'CTG-2 exhaust spread jumping around — one thermocouple, not the combustor',
         'The spread was jumping between normal and alarm levels every few minutes, but combustion dynamics, NOx, wheelspace and the worst-thermocouple location never moved — a failing exhaust thermocouple, not a combustion problem.',
         {'signal': f'CTG-2 exhaust spread swung between about 36 °F and {q["spread_max"]:.0f} °F from 10:05 to 11:00, with no trend.',
          'observed': 'The same thermocouple (TC-14) was the low reader on every spike; dynamics, NOx and adjacent thermocouples stayed flat.',
          'derived': 'A real combustion spread follows load and moves around the annulus; this one stayed at one position and alternated with normal readings — an intermittent open circuit.',
          'inferred': 'TC-14 junction or extension cable failing.',
          'recommendation': 'Reject TC-14 in the controller and replace it at the next outage; watch the remaining adjacent-TC protection logic.',
          'relatedOccurrences': [{'date': '2026-05-02', 'summary': 'CTG-1 TC-22 rejected for the same intermittent open-circuit signature.'}],
          'whatChangedSummary': f'TC-14 rejected by the controls technician at 11:05; spread back to {q["spread_ok"]:.0f} °F.',
          'whatChanged': [{'time': '10:05', 'source': 'Alarm', 'description': 'Exhaust spread high alarm (intermittent).', 'related': True},
                          {'time': '10:20', 'source': 'Operator Action', 'description': 'Checked combustion dynamics and NOx — both normal.', 'related': True},
                          {'time': '11:05', 'source': 'Maintenance', 'description': 'TC-14 rejected in controller.', 'related': True}],
          'confidence': 'Confirmed — spread normal after rejecting one thermocouple', 'confidenceLevel': 'high',
          'risk': 'Low — caught before a spurious high-spread trip', 'riskLevel': 'low',
          'expectedOutcome': 'Spread normal; TC-14 on the outage list'}),
    item('HSIT04', condenser, 'condenser_backpressure_inhga',
         [('10:45', 'Baseline'), ('10:50', 'CT cell 6 fan stops'), ('11:10', ''), ('11:35', 'Peak'), ('11:40', 'Fan reset'), ('12:00', ''), ('12:20', 'Back on wet-bulb trend')],
         'medium', 'watch', 'resolved', '12:20',
         'Condenser vacuum getting worse with nothing wrong at the condenser',
         'Backpressure rose while air in-leakage, hotwell level and TTD all stayed normal. The cause was upstream on the cooling water loop: cooling tower cell 6 fan had stopped, so the water coming back to the condenser was warmer.',
         {'signal': f'Condenser backpressure rose from {q["bp0"]:.2f} to {q["bp_pk"]:.2f} inHgA between 10:45 and 11:35, at steady steam turbine load.',
          'observed': f'CW supply temperature up from {q["cws0"]:.1f} °F to {q["cws_pk"]:.1f} °F; cooling tower cell 6 fan power 0 kW from 10:50; condenser air in-leakage and TTD unchanged.',
          'derived': 'Tower approach rose about 2 °F with one of eight cells without a fan — enough to explain the whole backpressure rise.',
          'inferred': 'Cell 6 fan motor tripped (thermal overload in high ambient); condenser itself healthy.',
          'recommendation': 'Reset the cell 6 fan motor at the MCC after a field check of the gearbox; confirm backpressure returns.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Cell 6 fan restarted at 11:40 after a field check; backpressure back on its wet-bulb trend by 12:20.',
          'whatChanged': [{'time': '10:50', 'source': 'Alarm', 'description': 'CT cell 6 fan motor overload trip.', 'related': True},
                          {'time': '11:30', 'source': 'Field Check', 'description': 'Gearbox oil and vibration checked on site — normal.', 'related': True},
                          {'time': '11:40', 'source': 'Operator Action', 'description': 'Cell 6 fan motor reset and restarted.', 'related': True}],
          'confidence': 'Confirmed — backpressure recovered as soon as the fan restarted', 'confidenceLevel': 'high',
          'risk': 'Low — about 2 MW of steam turbine output for an hour', 'riskLevel': 'low',
          'expectedOutcome': 'All eight cells in service'}),
    item('HSIT05', drum1, 'drum_level_in',
         [('13:15', 'Normal'), ('13:20', 'Swing starts'), ('13:30', ''), ('13:40', ''), ('13:50', ''), ('14:00', ''), ('14:05', 'Current')],
         'high', 'act', 'none', DRUM_START,
         'HRSG-1 HP drum level swinging wider every cycle',
         'Drum level and feedwater valve are oscillating with growing amplitude since 13:20. It started soon after the drum level control lost its steam-flow input, and manual valve moves appear to be adding to it rather than damping it.',
         {'signal': f'HP drum level swinging between {q["lvl_prev"]:+.1f} in and {q["lvl_now"]:+.1f} in at 14:05; the swing was about ±1.5 in at 13:20.',
          'observed': 'Feedwater control valve and HP feedwater flow oscillating in step with the level; HP steam flow steady; steam flow transmitter valved out for calibration since 13:10; manual valve moves at 13:25 and 13:45.',
          'derived': 'Without the steam-flow term, the controller is effectively single-element and chases swell and shrink; each manual correction lands out of phase with the level.',
          'inferred': 'A control-loop interaction (single-element control plus manual corrections), not a feedwater supply problem — BFP-A pressure is steady.',
          'recommendation': 'Stop manual valve moves, return the valve to auto, and restore the steam-flow transmitter so the loop goes back to three-element control. Be ready for a high-level trip if the swing reaches ±8 in.',
          'relatedOccurrences': [{'date': '2025-11-20', 'summary': 'HRSG-2 drum level oscillation during a transmitter calibration; settled after three-element control was restored.'}],
          'whatChangedSummary': 'Steam flow transmitter out for calibration from 13:10; operator manual feedwater valve moves at 13:25 and 13:45.',
          'whatChanged': [{'time': '13:10', 'source': 'Maintenance', 'description': 'HP steam flow transmitter valved out for calibration (planned).', 'related': True},
                          {'time': '13:25', 'source': 'Operator Action', 'description': 'Manual feedwater valve adjustment.', 'related': True},
                          {'time': '13:45', 'source': 'Operator Action', 'description': 'Manual feedwater valve adjustment.', 'related': True}],
          'confidence': 'Timing and control mode strongly suggest the loop; not yet proven', 'confidenceLevel': 'medium',
          'risk': 'High — a drum high/low level trip would take HRSG-1 and CTG-1 offline', 'riskLevel': 'high',
          'expectedOutcome': 'Level back within ±2 in under three-element control'}),
    item('HSIT06', HTR, 'fuel_gas_temp_f',
         [('08:30', 'Normal'), ('08:35', 'Heating water lost'), ('08:50', ''), ('09:10', 'Minimum'), ('09:15', 'Heater restored'), ('09:30', ''), ('09:45', 'Recovered')],
         'high', 'watch', 'resolved', RELOAD_DONE,
         'Fuel gas heater tripped — both gas turbines ran back and the steam turbine followed',
         'Loss of heating water to the fuel gas performance heater cooled the fuel below its Wobbe band, both CTGs ran back on fuel-temperature protection, and HRSG steam and steam turbine output fell over the next 10–15 minutes.',
         {'signal': f'Fuel gas temperature fell from 365 °F to {q["fuel_t_min"]:.0f} °F by 09:10; plant net output dropped from {q["net_0830"]:.0f} to {q["net_min"]:.0f} MW.',
          'observed': f'Heater heating-water flow 0 gpm from 08:35; Modified Wobbe Index up from {q["mwi0"]:.1f} to {q["mwi_max"]:.1f} (band ±5%); combustion dynamics and NOx up on both CTGs (HRSG-2 stack NOx touched {max(S(cems2, "stack_nox_ppm")[:i_of("10:00")]):.1f} ppm; the 1-hour average stayed under 2.0); STG-1 output fell from {q["st_0830"]:.0f} to {q["st_min"]:.0f} MW.',
          'derived': 'Everything downstream moved in the order the fuel → gas turbine → HRSG → steam turbine path predicts, with the steam side lagging 10–15 minutes.',
          'inferred': 'Heating-water control valve failed closed (positioner air supply).',
          'recommendation': 'Restore heating water, let the fuel temperature recover before reloading the CTGs, then release the load limit.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Positioner air line repaired and heating water restored at 09:15; CTGs back at the AGC target by 09:45.',
          'whatChanged': [{'time': '08:35', 'source': 'Alarm', 'description': 'Performance heater low heating-water flow.', 'related': True},
                          {'time': '08:40', 'source': 'Event', 'description': 'CTG-1 and CTG-2 runback on fuel temperature / MWI.', 'related': True},
                          {'time': '09:15', 'source': 'Maintenance', 'description': 'Heating-water valve positioner air line repaired.', 'related': True},
                          {'time': '09:45', 'source': 'Operator Action', 'description': 'CTG load limits released; AGC back in control.', 'related': True}],
          'confidence': 'Confirmed by field repair', 'confidenceLevel': 'high',
          'risk': 'Low now — cost was about 70 min of derate and an AGC deviation', 'riskLevel': 'low',
          'expectedOutcome': 'Heater in service; availability impact logged'}),
    item('HSIT07', SITE_ID, 'net_heat_rate_btu_kwh',
         [(LEAK_START, 'Baseline'), ('12:15', ''), ('12:45', ''), ('13:15', ''), ('13:35', ''), ('13:50', ''), ('14:05', 'Current')],
         'medium', 'investigate', 'none', LEAK_START,
         'Plant hitting its dispatch target, but burning more fuel to do it',
         'Net output is right on the AGC target, so nothing looks wrong on the headline number. But net heat rate has crept up and the steam turbine is making a smaller share of the megawatts — the gas turbines are quietly covering a steam-side loss.',
         {'signal': f'Net heat rate {q["hr_now"]:,.0f} Btu/kWh at 14:05, up from {q["hr_0"]:,.0f} at {LEAK_START}, while net output tracks the {dispatch[-1]:.0f} MW target.',
          'observed': f'STG-1 output per GT MW down from {q["st_share_0"]:.3f} at {LEAK_START} to {q["st_share_now"]:.3f} now; HP bypass valve shows 0% open, but its downstream temperature has risen from {q["byp_t0"]:.0f} °F to {q["byp_now"]:.0f} °F; condenser heat load slightly up.',
          'derived': f'The gas turbines\' own heat rates rose only {100 * q["gthr_rise"]:.1f}% over the same period (hotter air), while plant net heat rate rose {100 * (q["hr_now"] / q["hr_0"] - 1):.1f}%. The difference is a loss inside the steam cycle, which AGC is covering by loading the gas turbines.',
          'inferred': 'Hypothesis: HP steam is reaching the condenser without making power — a passing valve on the steam side is the leading candidate, not yet confirmed.',
          'recommendation': 'Check HP bypass downstream temperature against its warm-up line; do a thermography sweep of the bypass and drain valves on the next round before deciding on any isolation.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'No operator or maintenance action on the steam turbine or bypass system today.',
          'whatChanged': [{'time': LEAK_START, 'source': 'Event', 'description': 'Steam turbine share of block output starts falling.', 'related': True},
                          {'time': DISPATCH_RAMP[0], 'source': 'Setpoint Change', 'description': 'AGC target ramped 650 → 705 MW for the afternoon peak.', 'related': False}],
          'confidence': 'Loss is real; location not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'Medium — costs fuel every hour; a badly passing bypass valve can erode its seat further', 'riskLevel': 'medium',
          'expectedOutcome': 'Loss located and isolated or scheduled'}),
    item('HSIT08', scr1, 'ammonia_slip_ppm',
         [('08:00', 'Shift start'), ('09:30', 'Flagged'), ('10:30', ''), ('11:10', ''), ('11:15', 'Peak — setpoint restored'), ('11:40', ''), ('12:00', 'Back to normal')],
         'medium', 'watch', 'resolved', '12:00',
         'HRSG-1 ammonia slip climbing toward its 5 ppm limit while NOx looked great',
         'Stack NOx on HRSG-1 was unusually low, which looked like good news, but ammonia slip was rising steeply. The NOx trim setpoint had been lowered overnight, so the controller kept adding ammonia to chase it.',
         {'signal': f'HRSG-1 ammonia slip reached {q["slip_pk"]:.1f} ppm at {SLIP_FIX} (permit limit 5 ppm); stack NOx {q["stacknox1_pk"]:.2f} ppm.',
          'observed': f'NH₃/NOx molar ratio climbing all morning; slip rising faster than linearly; HRSG-2 at the same load steady at about {q["slip2"]:.1f} ppm slip.',
          'derived': 'Slip rises steeply once the molar ratio passes about 0.9 — the SCR was being over-fed, not failing.',
          'inferred': 'NOx trim setpoint lowered from 1.5 to 1.0 ppm by night shift (for margin during the CEMS calibration) and not restored.',
          'recommendation': 'Restore the 1.5 ppm NOx trim setpoint and confirm slip comes back under 2 ppm.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Setpoint restored at 11:15; slip back to normal by 12:00.',
          'whatChanged': [{'time': '02:10', 'source': 'Setpoint Change', 'description': 'HRSG-1 NOx trim setpoint 1.5 → 1.0 ppm (night shift).', 'related': True},
                          {'time': '11:15', 'source': 'Setpoint Change', 'description': 'NOx trim setpoint restored to 1.5 ppm.', 'related': True}],
          'confidence': 'Confirmed — slip fell as soon as the setpoint was restored', 'confidenceLevel': 'high',
          'risk': 'Low — caught below the permit limit; ammonium bisulfate fouling risk avoided', 'riskLevel': 'low',
          'expectedOutcome': 'Slip under 2 ppm with NOx at 1.5 ppm'}),
    item('HSIT09', comb1, 'combustion_dynamics_psi',
         [('10:00', 'Baseline'), ('11:20', '1st excursion'), ('12:15', ''), ('12:50', ''), ('13:20', ''), ('13:40', ''), ('13:55', 'Latest')],
         'medium', 'investigate', 'none', COMB_SPIKES[0],
         'CTG-1 combustion dynamics excursions getting more frequent',
         'Short hot-tone excursions on CTG-1 have come closer together since 11:20 as ambient and load climbed. Each clears on its own, but six in under three hours is above this unit\'s normal and the baseline is creeping up.',
         {'signal': f'Six hot-tone excursions between 11:20 and 13:55, the latest {v(comb1, "combustion_dynamics_psi", "13:55"):.2f} psi against a {q["dyn_base"]:.2f} psi baseline; intervals shrinking from 55 to 15 minutes.',
          'observed': 'Each excursion lasts one interval, with a small NOx bump; CTG-2 at similar load shows none; fuel gas temperature and Wobbe index steady.',
          'derived': 'Excursions line up with rising compressor inlet temperature, not with load steps.',
          'inferred': 'Possible tuning margin loss at high ambient on CTG-1 (fuel split or can-to-can imbalance). Needs the dynamics spectrum to narrow down.',
          'recommendation': 'Pull the high-speed dynamics data for the six events; ask the combustion tuning engineer whether an ambient-based fuel split bias is due. Hold CTG-1 load steady rather than ramping hard meanwhile.',
          'relatedOccurrences': [{'date': '2026-07-22', 'summary': 'CTG-1 hot-tone excursions on a 97 °F afternoon; cleared in the evening without action.'}],
          'whatChangedSummary': 'No tuning or fuel changes today; ambient up from 78 °F to 95 °F.',
          'whatChanged': [{'time': '11:20', 'source': 'Alarm', 'description': 'Combustion dynamics high (hot tone) — cleared in the same interval.', 'related': True},
                          {'time': '13:55', 'source': 'Alarm', 'description': 'Sixth excursion; interval now 15 minutes.', 'related': True}],
          'confidence': 'Pattern is clear; cause not yet diagnosed', 'confidenceLevel': 'medium',
          'risk': 'Medium — sustained high dynamics damage combustion hardware; a big excursion can trip the unit', 'riskLevel': 'medium',
          'expectedOutcome': 'Excursions stop after a tuning adjustment or as ambient falls'}),
    item('HSIT10', nh3_2, 'ammonia_flow_lb_h',
         [('12:15', 'Normal'), ('12:20', 'Pump trip'), ('12:25', 'No flow'), ('12:30', ''), ('12:35', 'Standby pump on'), ('12:45', ''), ('12:55', 'Recovered')],
         'high', 'watch', 'resolved', NH3_RESTORE,
         'HRSG-2 ammonia flow went to zero — stack NOx spiked',
         'The ammonia forwarding pump tripped and the standby pump didn\'t auto-start, so the SCR lost its reagent. Stack NOx rose within minutes as stored ammonia on the catalyst ran out.',
         {'signal': f'Ammonia flow 0 lb/h from 12:20 to 12:35; stack NOx peaked at {q["nox2_pk"]:.1f} ppm (limit 2.0 ppm, 1-hour average).',
          'observed': 'Forwarding pump A motor trip alarm; pump B did not auto-start; catalyst inlet temperature and GT NOx unchanged.',
          'derived': 'NOx removal fell from about 83% to near zero, with a short lag while stored ammonia on the catalyst was consumed.',
          'inferred': 'Pump A motor trip plus failed auto-start of pump B.',
          'recommendation': 'Start pump B locally, then investigate the auto-start failure. Log the excess emission event for the quarterly report.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Pump B started locally at 12:35; NOx back under 2 ppm by 12:45. The 1-hour average exceeded the limit for one hour.',
          'whatChanged': [{'time': '12:20', 'source': 'Alarm', 'description': 'Ammonia forwarding pump A motor trip.', 'related': True},
                          {'time': '12:35', 'source': 'Operator Action', 'description': 'Forwarding pump B started locally by the field operator.', 'related': True}],
          'confidence': 'Confirmed', 'confidenceLevel': 'high',
          'risk': 'Low now — one excess emission hour to report', 'riskLevel': 'low',
          'expectedOutcome': 'Pump B running; auto-start logic tested'}),
    item('HSIT11', cems2, 'hours_since_cal_h',
         [('08:00', 'Shift start'), ('10:00', ''), ('12:00', ''), ('13:00', ''), ('13:45', 'Found by DAHS review'), ('14:05', 'Current')],
         'medium', 'act', 'none', CEMS_FOUND,
         'HRSG-2 CEMS daily calibration missed — data goes invalid at 14:30',
         'The 06:00 automatic calibration on the HRSG-2 CEMS aborted on low calibration gas pressure. The last good calibration was 12:30 yesterday, so HRSG-2 emissions data goes out of control at 14:30 unless a manual calibration passes first.',
         {'signal': f'{q["cems_now"]:.1f} hours since the last passing daily calibration; data stays valid for {CEMS_GRACE_H:.0f} hours (until 14:30).',
          'observed': 'Auto-cal aborted at 06:00 on low cal gas cylinder pressure; analyzer readings themselves look normal.',
          'derived': 'A cylinder swap (≈ 30 min) plus a manual calibration (≈ 20 min) needs ~50 minutes; 25 minutes remain.',
          'inferred': 'The deadline will be missed unless the calibration starts immediately; some substitute data hours are likely either way.',
          'recommendation': 'Get the CEMS technician on the cylinder swap now, run the manual calibration, and tell the environmental coordinator to expect substitute data from 14:30.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Found at 13:45 during the DAHS review; calibration not yet started.',
          'whatChanged': [{'time': '06:00', 'source': 'Alarm', 'description': 'CEMS auto-calibration aborted — low cal gas pressure.', 'related': True},
                          {'time': '13:45', 'source': 'Field Check', 'description': 'DAHS review finds the missed calibration.', 'related': True}],
          'confidence': 'n/a — a compliance deadline, not a diagnosis', 'confidenceLevel': 'n/a',
          'risk': 'Medium — out-of-control CEMS hours need substitute data and are reportable', 'riskLevel': 'medium',
          'expectedOutcome': 'Calibration passed; data back in control'}),
]

for a in attention:
    if a['detail']['outcomeStatus'] == 'none' and a['unitId']:
        us = unit_status[a['unitId']]
        us['state'] = 'attention'
        us['statusSinceMinutes'] = max(us['statusSinceMinutes'] or 0, a['sinceMinutes'])


# ── Work items (spec §6.8) ──────────────────────────────────────────────
def work(wid, text, desc, aid, wtype, prio, stype, slabel, src, role, start, due, dur, done, completed, created):
    iso = lambda t: f'{DATE}T{t}:00' if t else None
    return {'id': wid, 'text': text, 'description': desc, 'assetId': aid, 'assetLabel': label_of(aid) if aid else None,
            'workType': wtype, 'priority': prio, 'sourceType': stype, 'sourceLabel': slabel, 'source': src,
            'assignedRole': role, 'plannedStart': iso(start), 'dueAt': iso(due), 'estimatedDurationMinutes': dur,
            'done': done, 'completedAt': iso(completed), 'createdAt': iso(created)}


sig = {a['id']: a['signal'] for a in attention}
work_items = [
    work('wk-h01', 'Shift turnover and AGC dispatch review', 'Review night-shift log, the HRSG-1 NOx setpoint change and the afternoon dispatch schedule.', None,
         'HUDDLE', 'routine', 'planned', None, 'operator', 'Control Room Operator', '07:45', '08:00', 15, True, '08:02', '07:30'),
    work('wk-h02', 'Operator rounds: HRSGs and BOP', 'Walk-down of both HRSGs, BFPs, CW pumps and fuel gas yard.', BLK,
         'INSPECTION', 'routine', 'planned', None, 'operator', 'Field Operator', '09:00', '10:30', 90, True, '10:24', '07:30'),
    work('wk-h03', 'Water chemistry grab samples', 'Cation conductivity, silica, pH and sodium on HP/IP/LP drums and feedwater of both HRSGs.', BLK,
         'SAMPLE', 'routine', 'planned', None, 'operator', 'Chemistry Technician', '10:00', '11:00', 60, True, '10:52', '07:30'),
    work('wk-h04', 'CW Pump C bearing lubrication', 'Spare pump: tag out, grease motor and pump bearings, return to standby.', CWP['C'],
         'MAINTENANCE', 'routine', 'planned', None, 'operator', 'Maintenance', CWP_C_MAINT[0], '11:00', 60, True, CWP_C_MAINT[1], '07:30'),
    work('wk-h05', 'GSU-1 online DGA review', 'Monthly review of the online dissolved-gas monitor against the last lab sample.', f'{CTG[1]}_GSU',
         'INSPECTION', 'routine', 'planned', None, 'operator', 'Electrical Technician', '12:00', '13:00', 30, True, '12:40', '07:30'),
    work('wk-h06', 'Calibrate HRSG-1 HP steam flow transmitter', 'Quarterly calibration. Drum level control drops to single-element while the transmitter is valved out.', f'{HRSG[1]}_HP',
         'INSTRUMENT_CHECK', 'routine', 'planned', None, 'operator', 'I&C Technician', XMTR_OUT, '14:30', 60, False, None, '07:30'),
    work('wk-h07', 'Restore fuel heater heating water', 'Repair the heating-water valve positioner air line; restore flow before reloading the CTGs.', HTR,
         'MAINTENANCE', 'urgent', 'situation', f'From: {sig["HSIT06"]}', 'ai', 'Maintenance', '08:40', '09:15', 30, True, '09:15', '08:38'),
    work('wk-h08', 'Reject CTG-2 exhaust TC-14', 'Reject TC-14 in the controller; add a replacement to the outage list.', turb2,
         'INSTRUMENT_CHECK', 'important', 'situation', f'From: {sig["HSIT03"]}', 'ai', 'I&C Technician', '10:30', '11:15', 20, True, '11:05', '10:25'),
    work('wk-h09', 'CTG-2 online compressor water wash', 'Run the online wash sequence; record efficiency before and after.', comp2,
         'PROCEDURE', 'important', 'situation', f'From: {sig["HSIT02"]}', 'ai', 'Control Room Operator', '11:30', '12:00', 30, True, '12:00', '10:45'),
    work('wk-h10', 'Check and reset CT cell 6 fan', 'Check gearbox oil and vibration locally, then reset the fan motor at the MCC.', CELLS[FAN_CELL - 1],
         'INSPECTION', 'important', 'situation', f'From: {sig["HSIT04"]}', 'ai', 'Field Operator', '11:10', '11:45', 30, True, '11:40', '11:05'),
    work('wk-h11', 'Start HRSG-2 ammonia pump B locally', 'Start forwarding pump B at the skid; then test the auto-start logic.', nh3_2,
         'PROCEDURE', 'urgent', 'situation', f'From: {sig["HSIT10"]}', 'ai', 'Field Operator', '12:22', '12:35', 10, True, '12:35', '12:21'),
    work('wk-h12', 'Restore HRSG-1 three-element drum control', 'Stop manual valve moves, return the FCV to auto, and put the steam flow transmitter back in service.', drum1,
         'PROCEDURE', 'urgent', 'situation', f'From: {sig["HSIT05"]}', 'ai', 'Control Room Operator', '14:05', '14:15', 10, False, None, '13:50'),
    work('wk-h13', 'Manual CEMS calibration: HRSG-2', 'Swap the calibration gas cylinder and run the daily calibration error test.', cems2,
         'QUALITY_CHECK', 'urgent', 'situation', f'From: {sig["HSIT11"]}', 'ai', 'CEMS Technician', '14:05', '14:30', 50, False, None, '13:47'),
    work('wk-h14', 'Vibration and oil check: HRSG-2 BFP-A', 'Handheld vibration spectrum and oil sample; prepare a swap to BFP-B.', bfp2_brg,
         'INSPECTION', 'important', 'situation', f'From: {sig["HSIT01"]}', 'ai', 'Maintenance', None, '16:00', 60, False, None, '10:40'),
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
    for k, s in props.items():
        lo, hi = PROPS[k][4]
        assert lo <= min(s) and max(s) <= hi, (aid, k, min(s), max(s), (lo, hi))
print(f'Wrote {len(files)} files to {os.path.relpath(OUT, REPO)}: {len(assets)} assets, {len(UNITS)} units, '
      f'{len(rels)} edges, {N} points, {len(attention)} attention items, {len(work_items)} work items')
