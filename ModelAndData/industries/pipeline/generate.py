#!/usr/bin/env python3
"""Lodestar Pipeline — natural gas transmission line — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/pipeline/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/pipeline/generate.py [OUTDIR]

The pipeline: a 310-mile, 36-inch interstate transmission mainline (MAOP
1,000 psig) running west to east through three operating districts. Gas
enters at two receipt meter stations, is boosted by three compressor
stations (gas-turbine centrifugal at Wren and Ashby, gas-engine
reciprocating at Kettle Creek), and leaves at two city gates, a power-plant
delivery (Halcyon Point — the `ccgt` pack's plant) and an end-of-line
interconnect. Five levels: system → district → facility → equipment →
component. The unit of operation is the facility: every station and every
line segment gets a tile, so the Now strip reads as the pipeline's
schematic, west to east.

Everything the scenarios need (which asset, when, how big) lives in the
SCENARIO constants below; SCENARIOS.md describes the same numbers in prose.
Evidence points in attention-items.json are READ BACK from the generated
series, so the story and the data can't disagree.

Hydraulics, deliberately simple (75% realism / 25% demo clarity, spec §2):
- Each line segment is a gas "tank": line pack (MMscf) integrates inflow −
  outflow every 5 minutes, and average pressure = line pack / (k × miles).
- Friction: p_in² − p_out² = C × miles × Q² (the general-flow-equation
  shape), so p_in and p_out straddle the average pressure by ∝ Q² / p_avg.
  Pressures at mainline valves along a segment follow the same equation.
- Receipts and deliveries are set by shippers (exogenous profiles). Each
  compressor station runs "suction control": it moves more gas when its
  upstream segment packs and less when it drafts, limited by the running
  units' horsepower and by a discharge-pressure ceiling below MAOP.
- Station horsepower ∝ Q × (r^0.23 − 1); fuel ∝ horsepower × heat rate.
  Every rollup (station power and fuel, line pack, meter-station flows) is
  computed from the stored child series, as declared in properties.json.
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'pipeline')
SEP = ' · '
UNIT_LEVEL = 'facility'

# ── Timeline (spec §4.2) — the default shared demo day. "Now" = 14:05. ──
DATE = '2026-08-28'
START, END, STEP = 8 * 60, 14 * 60 + 5, 5
TS = [f'{m // 60:02d}:{m % 60:02d}' for m in range(START, END + 1, STEP)]
N = len(TS)
IDX = {t: i for i, t in enumerate(TS)}
DT_DAY = STEP / 1440.0            # one step as a fraction of a gas day (flows are MMscf/d)


def i_of(t):
    return IDX[t]


def minutes(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


NOW_MIN = END

# ── Scenario constants (SCENARIOS.md describes each one) ─────────────────
DGS_START = '09:10'              # LSIT01 — Wren CU-2 outboard dry gas seal degradation (05)
DGS_RISE_SCFM = 3.30             #   extra primary vent flow by "now" (accelerating)
MLV_NOISE = ('10:20', '10:55')   # LSIT02 — MLV 1-2 pressure transmitter intermittent (06)
MLV_SPIKES = {'10:20': -64, '10:30': -108, '10:35': 36, '10:45': -92, '10:50': -37}   # psi reading error
MLV_FIXED = '11:00'
RCUT_START, RCUT_LOW, RCUT_BACK, RCUT_DONE = '08:40', '08:45', '09:30', '09:50'   # LSIT03 — Harlow receipt cut (09)
RCUT_FLOW = 640.0                #   Harlow receipt during the cut (MMscf/d), nominated 905
HEATER_OUT, HEATER_RELIT = '10:15', '12:10'   # LSIT04 — Bexley line heater flame-out → regulator icing (07)
CU3_VALVE, CU3_TRIP = '11:25', '11:55'        # LSIT05 — Kettle Creek CU-3 valve failure → vibration trip at 11:52 (11);
                                              #   11:55 is the first sample with the unit down
CU5_START, CU5_LOADED = '12:15', '12:35'      #   standby CU-5 started / fully loaded
ASHBY_SP_CHANGE = '12:50'        # LSIT07 — Ashby discharge ceiling lowered 985 → 965 psig (ends 04 build)
OSC_START = '13:15'              # LSIT06 — Ashby discharge-pressure oscillation (10)
OSC_MANUAL = ['13:20', '13:40']  #   manual setpoint moves by gas control
MARLOW_CUT = ('10:30', '10:45')  # LSIT07 — Marlow interconnect restricted downstream (04)
MARLOW_CUT_FLOW = 612.0
DEHY_START, DEHY_FIX, DEHY_OK = '09:00', '11:05', '12:00'   # LSIT08 — Sable Ridge glycol dehy upset (13)
RECYCLE_START = '11:30'          # LSIT09 — Wren CU-1 anti-surge recycle valve passing (08)
RECYCLE_LEAK_NOW = 58.0          #   MMscf/d recirculating through CU-1 by "now"
KNOCK_TIMES = ['11:40', '12:25', '12:55', '13:15', '13:30', '13:45', '13:55', '14:05']   # LSIT10 — KC CU-2 knock events (12)
OFO_TOLERANCE = 1.9              # LSIT11 — Halcyon Point imbalance tolerance under today's OFO (±2% of 95 MMscf)
IMB_FOUND = '13:45'
GAS_DAY_START = '09:00'          # NAESB gas day starts 9:00 a.m. Central

# ── Pipeline constants ───────────────────────────────────────────────────
SYS_ID, SYS_NAME = 'LODESTAR', 'Lodestar Pipeline'
MAOP = 1000.0
K_MILE = 0.00274                 # MMscf of line pack per psi per mile (36-in pipe, ~870 psia)
C_FRIC = 0.00480                 # (psi² per mile) per (MMscf/d)² — p_in² − p_out² = C × miles × Q²
HP_C = 449.0                     # hp per MMscf/d per unit of (r^0.23 − 1)
HHV = 1035.0                     # Btu/scf, pipeline gas
DISCH_CEILING = 985.0            # psig, station discharge limit (15 psi under MAOP)
SEG_MILES = {1: 68, 2: 84, 3: 84, 4: 74}
SEG_MP = {1: (0, 68), 2: (68, 152), 3: (152, 236), 4: (236, 310)}
MLV_MP = {1: [18, 42, 60], 2: [88, 110, 132], 3: [172, 194, 216], 4: [256, 278, 298]}

# ── Property metadata (spec §3.4): label, unit, category, tier, range, decimals
PROPS = {
    # system / district
    'total_receipts_mmscfd': ('Total Receipts', 'MMscf/d', 'Flow / WIP', 'P1', [0, 2000], 1),
    'total_deliveries_mmscfd': ('Total Deliveries', 'MMscf/d', 'Flow / WIP', 'P1', [0, 2000], 1),
    'system_line_pack_mmscf': ('System Line Pack', 'MMscf', 'Flow / WIP', 'P1', [500, 1000], 2),
    'line_pack_change_mmscf_h': ('Line Pack Change Rate', 'MMscf/h', 'Stability', 'P2', [-15, 15], 2),
    'system_fuel_mmscfd': ('Compressor Fuel (all stations)', 'MMscf/d', 'Events / Losses', 'P2', [0, 30], 2),
    'district_line_pack_mmscf': ('District Line Pack', 'MMscf', 'Flow / WIP', 'P1', [0, 500], 2),
    'district_fuel_mmscfd': ('District Compressor Fuel', 'MMscf/d', 'Events / Losses', 'P2', [0, 12], 2),
    # line segment
    'seg_inlet_pressure_psig': ('Inlet Pressure', 'psig', 'Flow / WIP', 'P1', [700, 1100], 1),
    'seg_outlet_pressure_psig': ('Outlet Pressure', 'psig', 'Flow / WIP', 'P1', [500, 1000], 1),
    'seg_flow_mmscfd': ('Segment Flow (inlet)', 'MMscf/d', 'Flow / WIP', 'P2', [0, 1500], 1),
    'line_pack_mmscf': ('Line Pack', 'MMscf', 'Flow / WIP', 'P2', [80, 260], 2),
    'maop_psig': ('MAOP', 'psig', 'Derived Metric', 'P3', [0, 1200], 0),
    'mlv_pressure_psig': ('Line Pressure at Valve', 'psig', 'Flow / WIP', 'P1', [500, 1100], 1),
    'pressure_roc_psi_min': ('Pressure Rate of Change', 'psi/min', 'Stability', 'P2', [-30, 30], 2),
    'valve_position_pct': ('Valve Position', '%', 'Condition', 'P3', [0, 100], 0),
    'rectifier_output_v': ('Rectifier Output Voltage', 'V', 'Electrical', 'P3', [0, 50], 2),
    'rectifier_output_a': ('Rectifier Output Current', 'A', 'Electrical', 'P2', [0, 60], 2),
    'pipe_to_soil_mv': ('Pipe-to-Soil Potential', 'mV', 'Condition', 'P1', [-1600, -400], 0),
    # compressor station
    'station_suction_pressure_psig': ('Suction Pressure', 'psig', 'Flow / WIP', 'P1', [500, 1000], 1),
    'station_discharge_pressure_psig': ('Discharge Pressure', 'psig', 'Flow / WIP', 'P1', [800, 1100], 1),
    'station_flow_mmscfd': ('Station Throughput', 'MMscf/d', 'Flow / WIP', 'P1', [0, 1500], 1),
    'station_power_hp': ('Station Power', 'hp', 'Flow / WIP', 'P2', [0, 60000], 0),
    'station_fuel_mmscfd': ('Station Fuel', 'MMscf/d', 'Events / Losses', 'P2', [0, 12], 3),
    'compression_ratio': ('Compression Ratio', '', 'Derived Metric', 'P2', [1.0, 1.6], 3),
    'filter_sep_dp_psid': ('Filter/Separator DP', 'psid', 'Condition', 'P2', [0, 20], 2),
    'separator_liquid_level_pct': ('Liquid Level', '%', 'Quality', 'P1', [0, 100], 1),
    'cooler_inlet_temp_f': ('Cooler Inlet Temperature', '°F', 'Condition', 'P3', [60, 200], 1),
    'cooler_outlet_temp_f': ('Station Discharge Temperature', '°F', 'Condition', 'P1', [60, 140], 1),
    'cooler_fans_running': ('Cooler Fans Running', '', 'Condition', 'P3', [0, 8], 0),
    # turbine-driven centrifugal unit
    'unit_flow_mmscfd': ('Compressor Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 800], 1),
    'unit_power_hp': ('Unit Power', 'hp', 'Flow / WIP', 'P2', [0, 20000], 0),
    'unit_fuel_mmscfd': ('Unit Fuel', 'MMscf/d', 'Events / Losses', 'P2', [0, 5], 3),
    'recycle_valve_pct': ('Recycle Valve Command', '%', 'Stability', 'P1', [0, 100], 1),
    'unit_speed_pct': ('Compressor Speed', '%', 'Stability', 'P3', [0, 110], 1),
    'rated_power_hp': ('Rated Power (ISO)', 'hp', 'Derived Metric', 'P3', [0, 20000], 0),
    'gp_speed_pct': ('Gas Producer Speed', '%', 'Stability', 'P2', [0, 110], 1),
    'pt_inlet_temp_f': ('Power Turbine Inlet Temp (T5)', '°F', 'Condition', 'P1', [0, 1600], 1),
    'inlet_filter_dp_inh2o': ('Inlet Filter DP', 'inH₂O', 'Condition', 'P3', [0, 8], 2),
    'comp_discharge_temp_f': ('Compressor Discharge Temperature', '°F', 'Condition', 'P2', [60, 200], 1),
    'comp_vibration_mils': ('Shaft Vibration', 'mils pk-pk', 'Condition', 'P1', [0, 4], 2),
    'polytropic_eff_pct': ('Polytropic Efficiency', '%', 'Derived Metric', 'P3', [70, 90], 2),
    'primary_vent_flow_scfm': ('Primary Vent Flow (NDE)', 'scfm', 'Condition', 'P1', [0, 10], 2),
    'seal_gas_filter_dp_psid': ('Seal Gas Filter DP', 'psid', 'Condition', 'P2', [0, 20], 2),
    'seal_gas_supply_dp_psid': ('Seal Gas Supply DP', 'psid', 'Stability', 'P3', [0, 120], 1),
    'lube_oil_pressure_psig': ('Lube Oil Header Pressure', 'psig', 'Condition', 'P1', [0, 100], 1),
    'lube_oil_temp_f': ('Lube Oil Temperature', '°F', 'Condition', 'P2', [80, 220], 1),
    # engine-driven reciprocating unit
    'recip_unit_flow_mmscfd': ('Compressor Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 400], 1),
    'recip_unit_power_hp': ('Unit Power', 'hp', 'Flow / WIP', 'P2', [0, 8000], 0),
    'recip_unit_fuel_mmscfd': ('Unit Fuel', 'MMscf/d', 'Events / Losses', 'P2', [0, 2], 3),
    'engine_speed_rpm': ('Engine Speed', 'rpm', 'Stability', 'P2', [0, 1200], 0),
    'recip_rated_power_hp': ('Rated Power', 'hp', 'Derived Metric', 'P3', [0, 8000], 0),
    'engine_exhaust_temp_f': ('Engine Exhaust Temperature', '°F', 'Condition', 'P2', [100, 1200], 1),
    'jacket_water_temp_f': ('Jacket Water Temperature', '°F', 'Condition', 'P3', [60, 250], 1),
    'knock_events_1h': ('Detonation Events (last hour)', '', 'Events / Losses', 'P1', [0, 10], 0),
    'cyl_discharge_temp_f': ('Cylinder Discharge Temperature', '°F', 'Condition', 'P2', [40, 260], 1),
    'valve_temp_dev_f': ('Valve Cover Temp Deviation (max)', '°F', 'Condition', 'P1', [0, 60], 1),
    'frame_vibration_ips': ('Frame Vibration', 'in/s', 'Condition', 'P1', [0, 1.2], 3),
    'rod_load_pct': ('Rod Load (of rating)', '%', 'Condition', 'P3', [0, 100], 1),
    # meter stations
    'receipt_flow_mmscfd': ('Receipt Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 1500], 1),
    'receipt_nominated_mmscfd': ('Scheduled Receipt', 'MMscf/d', 'Flow / WIP', 'P2', [0, 1500], 1),
    'receipt_pressure_psig': ('Receipt Pressure', 'psig', 'Flow / WIP', 'P2', [700, 1100], 1),
    'field_receipt_flow_mmscfd': ('Receipt Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 400], 1),
    'field_receipt_nominated_mmscfd': ('Scheduled Receipt', 'MMscf/d', 'Flow / WIP', 'P2', [0, 400], 1),
    'meter_flow_mmscfd': ('Meter Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 600], 1),
    'small_meter_flow_mmscfd': ('Meter Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 200], 2),
    'sos_spread_fps': ('Speed-of-Sound Path Spread', 'ft/s', 'Quality', 'P2', [0, 3], 2),
    'meter_gain_db': ('Transducer Gain (avg)', 'dB', 'Condition', 'P3', [0, 80], 1),
    'gas_hhv_btu_scf': ('Heating Value (HHV)', 'Btu/scf', 'Quality', 'P1', [950, 1150], 1),
    'co2_mol_pct': ('CO₂', 'mol %', 'Quality', 'P2', [0, 3], 3),
    'relative_density': ('Relative Density', '', 'Quality', 'P3', [0.55, 0.7], 4),
    'water_content_lb_mmscf': ('Water Content', 'lb/MMscf', 'Quality', 'P1', [0, 10], 2),
    'h2s_gr_100scf': ('H₂S', 'gr/100 scf', 'Quality', 'P2', [0, 0.3], 3),
    'hc_dew_point_f': ('Hydrocarbon Dew Point', '°F', 'Quality', 'P3', [-40, 40], 1),
    # deliveries
    'cg_delivery_flow_mmscfd': ('Delivery Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 300], 2),
    'cg_inlet_pressure_psig': ('Inlet (Line) Pressure', 'psig', 'Flow / WIP', 'P3', [600, 1000], 1),
    'cg_outlet_pressure_psig': ('Outlet (LDC) Pressure', 'psig', 'Stability', 'P1', [150, 450], 1),
    'reg_flow_mmscfd': ('Run Flow', 'MMscf/d', 'Flow / WIP', 'P2', [0, 150], 2),
    'reg_outlet_temp_f': ('Outlet Gas Temperature', '°F', 'Condition', 'P1', [0, 100], 1),
    'reg_travel_pct': ('Regulator Travel', '%', 'Stability', 'P2', [0, 100], 1),
    'bath_temp_f': ('Water Bath Temperature', '°F', 'Condition', 'P1', [80, 240], 1),
    'heater_outlet_temp_f': ('Gas Outlet Temperature', '°F', 'Condition', 'P2', [30, 130], 1),
    'burner_firing_pct': ('Burner Firing Rate', '%', 'Stability', 'P3', [0, 100], 1),
    'odorant_rate_lb_mmscf': ('Odorant Injection Rate', 'lb/MMscf', 'Quality', 'P1', [0, 2], 3),
    'odorant_tank_level_pct': ('Odorant Tank Level', '%', 'Flow / WIP', 'P3', [0, 100], 1),
    'pp_delivery_flow_mmscfd': ('Delivery Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 200], 2),
    'pp_scheduled_flow_mmscfd': ('Scheduled Quantity', 'MMscf/d', 'Flow / WIP', 'P2', [0, 200], 2),
    'gas_day_imbalance_mmscf': ('Gas-Day Imbalance', 'MMscf', 'Events / Losses', 'P1', [-4, 4], 3),
    'pp_delivery_pressure_psig': ('Delivery Pressure', 'psig', 'Flow / WIP', 'P3', [400, 700], 1),
    'ic_delivery_flow_mmscfd': ('Delivery Flow', 'MMscf/d', 'Flow / WIP', 'P1', [0, 1500], 1),
    'ic_scheduled_flow_mmscfd': ('Scheduled Quantity', 'MMscf/d', 'Flow / WIP', 'P2', [0, 1500], 1),
    'ic_delivery_pressure_psig': ('Delivery Pressure', 'psig', 'Flow / WIP', 'P1', [500, 1000], 1),
}
STATIC = {'maop_psig', 'rated_power_hp', 'recip_rated_power_hp'}

TYPE_PROPS = {
    'pipeline_system': ['total_receipts_mmscfd', 'total_deliveries_mmscfd', 'system_line_pack_mmscf',
                        'line_pack_change_mmscf_h', 'system_fuel_mmscfd'],
    'operating_district': ['district_line_pack_mmscf', 'district_fuel_mmscfd'],
    # facilities (the unit level)
    'plant_receipt_station': ['receipt_flow_mmscfd', 'receipt_nominated_mmscfd', 'receipt_pressure_psig'],
    'field_receipt_station': ['field_receipt_flow_mmscfd', 'field_receipt_nominated_mmscfd', 'receipt_pressure_psig'],
    'pipeline_segment': ['seg_inlet_pressure_psig', 'seg_outlet_pressure_psig', 'seg_flow_mmscfd', 'line_pack_mmscf',
                         'maop_psig'],
    'turbine_compressor_station': ['station_suction_pressure_psig', 'station_discharge_pressure_psig', 'station_flow_mmscfd',
                                   'station_power_hp', 'station_fuel_mmscfd', 'compression_ratio'],
    'recip_compressor_station': ['station_suction_pressure_psig', 'station_discharge_pressure_psig', 'station_flow_mmscfd',
                           'station_power_hp', 'station_fuel_mmscfd', 'compression_ratio'],
    'city_gate_station': ['cg_delivery_flow_mmscfd', 'cg_inlet_pressure_psig', 'cg_outlet_pressure_psig'],
    'power_plant_delivery': ['pp_delivery_flow_mmscfd', 'pp_scheduled_flow_mmscfd', 'gas_day_imbalance_mmscf',
                             'pp_delivery_pressure_psig'],
    'interconnect_delivery': ['ic_delivery_flow_mmscfd', 'ic_scheduled_flow_mmscfd', 'ic_delivery_pressure_psig'],
    # equipment
    'mainline_valve': ['mlv_pressure_psig', 'pressure_roc_psi_min', 'valve_position_pct'],
    'cp_rectifier': ['rectifier_output_v', 'rectifier_output_a', 'pipe_to_soil_mv'],
    'filter_separator': ['filter_sep_dp_psid', 'separator_liquid_level_pct'],
    'gas_aftercooler': ['cooler_inlet_temp_f', 'cooler_outlet_temp_f', 'cooler_fans_running'],
    'turbine_compressor_unit': ['unit_flow_mmscfd', 'unit_power_hp', 'unit_fuel_mmscfd', 'recycle_valve_pct',
                                'unit_speed_pct', 'rated_power_hp'],
    'recip_compressor_unit': ['recip_unit_flow_mmscfd', 'recip_unit_power_hp', 'recip_unit_fuel_mmscfd',
                              'engine_speed_rpm', 'recip_rated_power_hp'],
    'meter_run_16in': ['meter_flow_mmscfd', 'sos_spread_fps', 'meter_gain_db'],
    'meter_run_8in': ['small_meter_flow_mmscfd', 'sos_spread_fps', 'meter_gain_db'],
    'gas_chromatograph': ['gas_hhv_btu_scf', 'co2_mol_pct', 'relative_density'],
    'gas_quality_analyzer': ['water_content_lb_mmscf', 'h2s_gr_100scf', 'hc_dew_point_f'],
    'regulator_run': ['reg_flow_mmscfd', 'reg_outlet_temp_f', 'reg_travel_pct'],
    'line_heater': ['bath_temp_f', 'heater_outlet_temp_f', 'burner_firing_pct'],
    'odorizer': ['odorant_rate_lb_mmscf', 'odorant_tank_level_pct'],
    # components
    'gas_turbine_driver': ['gp_speed_pct', 'pt_inlet_temp_f', 'inlet_filter_dp_inh2o'],
    'centrifugal_compressor': ['comp_discharge_temp_f', 'comp_vibration_mils', 'polytropic_eff_pct'],
    'dry_gas_seal_system': ['primary_vent_flow_scfm', 'seal_gas_filter_dp_psid', 'seal_gas_supply_dp_psid'],
    'lube_oil_console': ['lube_oil_pressure_psig', 'lube_oil_temp_f'],
    'gas_engine_driver': ['engine_exhaust_temp_f', 'jacket_water_temp_f', 'knock_events_1h'],
    'recip_compressor_frame': ['cyl_discharge_temp_f', 'valve_temp_dev_f', 'frame_vibration_ips', 'rod_load_pct'],
}
TYPE_LABELS = {
    'pipeline_system': 'Pipeline System',
    'plant_receipt_station': 'Receipt Meter Station (Plant Tailgate)',
    'field_receipt_station': 'Receipt Meter Station (Field Tie-in)',
    'city_gate_station': 'City Gate Station',
    'turbine_compressor_station': 'Compressor Station (Turbine / Centrifugal)',
    'recip_compressor_station': 'Compressor Station (Engine / Reciprocating)',
    'power_plant_delivery': 'Power Plant Delivery Station',
    'interconnect_delivery': 'Interconnect Delivery Station',
    'mainline_valve': 'Mainline Valve (MLV)',
    'cp_rectifier': 'CP Rectifier',
    'filter_separator': 'Filter/Separator',
    'gas_aftercooler': 'Gas Aftercooler',
    'turbine_compressor_unit': 'Compressor Unit (Gas Turbine / Centrifugal)',
    'recip_compressor_unit': 'Compressor Unit (Gas Engine / Reciprocating)',
    'meter_run_16in': 'Ultrasonic Meter Run (16-in)',
    'meter_run_8in': 'Ultrasonic Meter Run (8-in)',
    'gas_chromatograph': 'Gas Chromatograph',
    'gas_quality_analyzer': 'Moisture / H₂S Analyzer',
    'line_heater': 'Line Heater (Water Bath)',
    'dry_gas_seal_system': 'Dry Gas Seal System',
    'recip_compressor_frame': 'Compressor Frame & Cylinders',
}
DERIVATIONS = [
    {'assetType': 'pipeline_system', 'property': 'system_line_pack_mmscf', 'fn': 'sum', 'of': 'line_pack_mmscf',
     'fromType': 'pipeline_segment', 'scope': 'descendants'},
    {'assetType': 'pipeline_system', 'property': 'system_fuel_mmscfd', 'fn': 'sum', 'of': 'station_fuel_mmscfd',
     'fromType': 'turbine_compressor_station|recip_compressor_station', 'scope': 'descendants'},
    {'assetType': 'operating_district', 'property': 'district_line_pack_mmscf', 'fn': 'sum', 'of': 'line_pack_mmscf',
     'fromType': 'pipeline_segment', 'scope': 'children'},
    {'assetType': 'operating_district', 'property': 'district_fuel_mmscfd', 'fn': 'sum', 'of': 'station_fuel_mmscfd',
     'fromType': 'turbine_compressor_station|recip_compressor_station', 'scope': 'children'},
    {'assetType': 'plant_receipt_station', 'property': 'receipt_flow_mmscfd', 'fn': 'sum', 'of': 'meter_flow_mmscfd',
     'fromType': 'meter_run_16in', 'scope': 'children'},
    {'assetType': 'field_receipt_station', 'property': 'field_receipt_flow_mmscfd', 'fn': 'sum',
     'of': 'small_meter_flow_mmscfd', 'fromType': 'meter_run_8in', 'scope': 'children'},
    {'assetType': 'city_gate_station', 'property': 'cg_delivery_flow_mmscfd', 'fn': 'sum', 'of': 'reg_flow_mmscfd',
     'fromType': 'regulator_run', 'scope': 'children'},
    {'assetType': 'power_plant_delivery', 'property': 'pp_delivery_flow_mmscfd', 'fn': 'sum',
     'of': 'small_meter_flow_mmscfd', 'fromType': 'meter_run_8in', 'scope': 'children'},
    {'assetType': 'interconnect_delivery', 'property': 'ic_delivery_flow_mmscfd', 'fn': 'sum', 'of': 'meter_flow_mmscfd',
     'fromType': 'meter_run_16in', 'scope': 'children'},
    # formulas (not simple aggregates, or aggregates across differently-keyed types)
    {'assetType': 'turbine_compressor_station|recip_compressor_station', 'property': 'station_power_hp', 'fn': 'formula',
     'note': 'Σ unit power: unit_power_hp (turbine units) or recip_unit_power_hp (recip units) — two keys because the gauges differ'},
    {'assetType': 'turbine_compressor_station|recip_compressor_station', 'property': 'station_fuel_mmscfd', 'fn': 'formula',
     'note': 'Σ unit fuel: unit_fuel_mmscfd (turbine units) or recip_unit_fuel_mmscfd (recip units)'},
    {'assetType': 'turbine_compressor_station|recip_compressor_station', 'property': 'station_flow_mmscfd', 'fn': 'formula',
     'note': 'station throughput meter = Σ compressor flow − recycle flow; it is NOT the sum of unit flows while any unit recycles'},
    {'assetType': 'turbine_compressor_station|recip_compressor_station', 'property': 'compression_ratio', 'fn': 'formula',
     'note': '(discharge + 14.7) / (suction + 14.7), absolute pressures'},
    {'assetType': 'pipeline_system', 'property': 'total_receipts_mmscfd', 'fn': 'formula',
     'note': 'Harlow receipt_flow_mmscfd + Sable Ridge field_receipt_flow_mmscfd'},
    {'assetType': 'pipeline_system', 'property': 'total_deliveries_mmscfd', 'fn': 'formula',
     'note': 'Σ city gate, power plant and interconnect delivery flows'},
    {'assetType': 'pipeline_system', 'property': 'line_pack_change_mmscf_h', 'fn': 'formula',
     'note': '(system_line_pack_mmscf[t] − system_line_pack_mmscf[t − 5 min]) × 12 — positive = packing, negative = drafting'},
    {'assetType': 'pipeline_segment', 'property': 'line_pack_mmscf', 'fn': 'formula',
     'note': 'integrates (inflow − outflow − station fuel) each step; average pressure = line pack / (0.00274 × miles)'},
    {'assetType': 'power_plant_delivery', 'property': 'gas_day_imbalance_mmscf', 'fn': 'formula',
     'note': 'Σ (delivery − scheduled) × 5/1440 since the 09:00 gas-day start; before 09:00 it is the prior gas day'},
]

# One entry per asset type (the two compressor-station types share their formulas)
DERIVATIONS = [{**d, 'assetType': t} for d in DERIVATIONS for t in d['assetType'].split('|')]


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


def lagged(targets, start=None, k=0.35):
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


def plus_noise(base, sd, phi=0.85):
    return [b + e for b, e in zip(base, ar1(sd, phi))]


def rnd(x, d):
    return round(x + 0.0, d)


def after(t):
    return [minutes(x) >= minutes(t) for x in TS]


# ── Build the asset tree ─────────────────────────────────────────────────
assets, kids = [], {}


def add(aid, parent, name, atype, level):
    assets.append({'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level})
    kids.setdefault(parent, []).append(aid)
    return aid


def build_segment(district, n):
    a, b = SEG_MP[n]
    seg = add(f'{SYS_ID}_SEG{n}', district, f'Segment {n} (MP {a}–{b})', 'pipeline_segment', 'facility')
    mlvs = [add(f'{seg}_MLV{k}', seg, f'MLV {n}-{k} (MP {mp})', 'mainline_valve', 'equipment')
            for k, mp in enumerate(MLV_MP[n], 1)]
    rects = [add(f'{seg}_CP{k}', seg, f'Rectifier R-{n}{k}', 'cp_rectifier', 'equipment') for k in (1, 2)]
    return seg, mlvs, rects


def build_turbine_unit(station, k):
    u = add(f'{station}_CU{k}', station, f'CU-{k}', 'turbine_compressor_unit', 'equipment')
    add(f'{u}_GT', u, 'Gas Turbine', 'gas_turbine_driver', 'component')
    add(f'{u}_COMP', u, 'Centrifugal Compressor', 'centrifugal_compressor', 'component')
    add(f'{u}_DGS', u, 'Dry Gas Seals', 'dry_gas_seal_system', 'component')
    add(f'{u}_LUBE', u, 'Lube Oil Console', 'lube_oil_console', 'component')
    return u


def build_recip_unit(station, k):
    u = add(f'{station}_CU{k}', station, f'CU-{k}', 'recip_compressor_unit', 'equipment')
    add(f'{u}_ENG', u, 'Gas Engine', 'gas_engine_driver', 'component')
    add(f'{u}_FRAME', u, 'Compressor Frame', 'recip_compressor_frame', 'component')
    add(f'{u}_LUBE', u, 'Lube Oil Console', 'lube_oil_console', 'component')
    return u


def build_station(district, code, name, kind, n_units):
    st = add(f'{SYS_ID}_{code}', district, name, f'{kind}_compressor_station', 'facility')
    scrub = add(f'{st}_SCRUB', st, 'Inlet Filter/Separator', 'filter_separator', 'equipment')
    builder = build_turbine_unit if kind == 'turbine' else build_recip_unit
    units = [builder(st, k) for k in range(1, n_units + 1)]
    cool = add(f'{st}_COOL', st, 'Aftercooler', 'gas_aftercooler', 'equipment')
    return st, scrub, units, cool


add(SYS_ID, None, SYS_NAME, 'pipeline_system', 'system')
DW = add(f'{SYS_ID}_W', SYS_ID, 'West District', 'operating_district', 'district')
DC = add(f'{SYS_ID}_C', SYS_ID, 'Central District', 'operating_district', 'district')
DE = add(f'{SYS_ID}_E', SYS_ID, 'East District', 'operating_district', 'district')

# West: Harlow receipt → Segment 1 → Wren compressor station
HAR = add(f'{SYS_ID}_HARLOW', DW, 'Harlow Receipt', 'plant_receipt_station', 'facility')
HAR_FSEP = add(f'{HAR}_FSEP', HAR, 'Filter/Separator', 'filter_separator', 'equipment')
HAR_RUNS = [add(f'{HAR}_RUN{r}', HAR, f'Meter Run {r}', 'meter_run_16in', 'equipment') for r in 'ABC']
HAR_GC = add(f'{HAR}_GC', HAR, 'Gas Chromatograph', 'gas_chromatograph', 'equipment')
HAR_QA = add(f'{HAR}_QA', HAR, 'Moisture / H₂S Analyzer', 'gas_quality_analyzer', 'equipment')
SEG, MLV, RECT = {}, {}, {}
SEG[1], MLV[1], RECT[1] = build_segment(DW, 1)
WREN, WREN_SCRUB, WREN_U, WREN_COOL = build_station(DW, 'WREN', 'Wren Compressor Station', 'turbine', 3)

# Central: Segment 2 (+ Sable Ridge receipt, − Bexley city gate) → Kettle Creek compressor station
SEG[2], MLV[2], RECT[2] = build_segment(DC, 2)
SAB = add(f'{SYS_ID}_SABLE', DC, 'Sable Ridge Receipt', 'field_receipt_station', 'facility')
SAB_FSEP = add(f'{SAB}_FSEP', SAB, 'Filter/Separator', 'filter_separator', 'equipment')
SAB_RUNS = [add(f'{SAB}_RUN{r}', SAB, f'Meter Run {r}', 'meter_run_8in', 'equipment') for r in 'AB']
SAB_QA = add(f'{SAB}_QA', SAB, 'Moisture / H₂S Analyzer', 'gas_quality_analyzer', 'equipment')


def build_city_gate(district, code, name):
    cg = add(f'{SYS_ID}_{code}', district, name, 'city_gate_station', 'facility')
    heater = add(f'{cg}_HTR', cg, 'Line Heater', 'line_heater', 'equipment')
    regs = [add(f'{cg}_REG{r}', cg, f'Regulator Run {r}', 'regulator_run', 'equipment') for r in 'AB']
    odor = add(f'{cg}_ODOR', cg, 'Odorizer', 'odorizer', 'equipment')
    return cg, heater, regs, odor


BEX, BEX_HTR, BEX_REG, BEX_ODOR = build_city_gate(DC, 'BEXLEY', 'Bexley City Gate')
KC, KC_SCRUB, KC_U, KC_COOL = build_station(DC, 'KETTLE', 'Kettle Creek Compressor Station', 'recip', 5)

# East: Segment 3 (− Halcyon Point) → Ashby compressor station → Segment 4 (− Tolland) → Marlow interconnect
SEG[3], MLV[3], RECT[3] = build_segment(DE, 3)
HAL = add(f'{SYS_ID}_HALCYON', DE, 'Halcyon Point Delivery', 'power_plant_delivery', 'facility')
HAL_FSEP = add(f'{HAL}_FSEP', HAL, 'Filter/Separator', 'filter_separator', 'equipment')
HAL_RUN = add(f'{HAL}_RUNA', HAL, 'Meter Run A', 'meter_run_8in', 'equipment')
ASH, ASH_SCRUB, ASH_U, ASH_COOL = build_station(DE, 'ASHBY', 'Ashby Compressor Station', 'turbine', 2)
SEG[4], MLV[4], RECT[4] = build_segment(DE, 4)
TOL, TOL_HTR, TOL_REG, TOL_ODOR = build_city_gate(DE, 'TOLLAND', 'Tolland City Gate')
MAR = add(f'{SYS_ID}_MARLOW', DE, 'Marlow Interconnect', 'interconnect_delivery', 'facility')
MAR_RUNS = [add(f'{MAR}_RUN{r}', MAR, f'Meter Run {r}', 'meter_run_16in', 'equipment') for r in 'ABC']

A = {a['id']: a for a in assets}
UNITS = [a['id'] for a in assets if a['assetLevel'] == UNIT_LEVEL]

series = {}


def put(aid, key, values, decimals=None):
    assert key in TYPE_PROPS[A[aid]['assetType']], (aid, key)
    d = PROPS[key][5] if decimals is None else decimals
    series.setdefault(aid, {})[key] = [rnd(v, d) for v in values]


def S(aid, key):
    return series[aid][key]


# ── Shipper-driven receipts and deliveries (MMscf/d) ────────────────────
# Harlow processing plant tailgate: nominated 905; residue compressor trip cuts it 08:40–10:20.
harlow_nom = [905.0] * N
harlow = plus_noise(interp({'08:00': 905.0, RCUT_START: 905.0, RCUT_LOW: RCUT_FLOW, RCUT_BACK: RCUT_FLOW + 8,
                            RCUT_DONE: 905.0, '14:05': 905.0}), 1.6, 0.7)
sable_nom = [180.0] * N
sable = plus_noise([181.5] * N, 0.9, 0.7)
# Bexley LDC load: a warm August day, gentle morning shoulder.
bexley = plus_noise(interp({'08:00': 151.0, '10:30': 141.0, '14:05': 131.0}), 0.8)
tolland = plus_noise(interp({'08:00': 96.0, '11:00': 91.0, '14:05': 88.0}), 0.5)
# Halcyon Point takes fuel for a 2x1 combined-cycle block (the ccgt pack): its fuel heater trip
# (08:35–09:45) runs the gas turbines back, then AGC ramps the block for the afternoon peak.
halcyon = plus_noise(interp({'08:00': 95.2, '08:35': 95.4, '08:45': 88.0, '09:00': 83.9, '09:20': 83.7,
                             '09:40': 97.3, '10:00': 99.0, '10:25': 103.2, '11:00': 104.4, '14:05': 105.4}), 0.25, 0.6)
halcyon_sched = [95.0] * N
marlow_delta = interp({'08:00': 0.0, MARLOW_CUT[0]: 0.0, MARLOW_CUT[1]: 1.0, '14:05': 1.0})   # 0 → 1 restriction share
marlow_noise = ar1(2.0, 0.7)

# ── Hydraulic simulation ────────────────────────────────────────────────
# Gas control's station throughputs for the day (MMscf/d). These are scripted from the scenario
# story rather than solved by a controller, so each disturbance lands exactly where SCENARIOS.md
# says it does; line pack and every pressure are then computed from them (mass balance + friction).
wren_q = plus_noise(interp({'08:00': 905.0, '08:45': 902.0, '08:55': 790.0, '09:05': 708.0, '09:30': 702.0,
                            '09:45': 770.0, '10:00': 885.0, '10:15': 935.0, '10:40': 918.0, '11:00': 906.0,
                            '14:05': 905.0}), 1.5, 0.6)
kc_q = plus_noise(interp({'08:00': 932.0, '09:05': 930.0, '09:20': 872.0, '09:40': 818.0, '09:55': 808.0,
                          '10:15': 880.0, '10:35': 938.0, '11:00': 944.0, '11:50': 944.0, CU3_TRIP: 826.0,
                          CU5_START: 830.0, CU5_LOADED: 935.0, '12:45': 978.0, '13:10': 950.0, '13:30': 900.0,
                          '14:05': 884.0}), 1.5, 0.6)
ashby_q = plus_noise(interp({'08:00': 833.0, '09:35': 832.0, '09:55': 796.0, '10:10': 766.0, '10:25': 772.0,
                             '10:45': 828.0, '11:50': 834.0, '12:10': 806.0, '12:40': 772.0, ASHBY_SP_CHANGE: 768.0,
                             '13:05': 630.0, '14:05': 640.0}), 1.5, 0.6)
P_REF = {1: 875.0, 2: 860.0, 3: 870.0, 4: 890.0}      # 08:00 average pressure per segment
KSEG = {n: K_MILE * SEG_MILES[n] for n in SEG_MILES}
TURB_RATED, RECIP_RATED = 15000.0, 6500.0
SURGE_MIN = 380.0                                     # MMscf/d minimum flow per turbine unit (recycle below it)


def seg_pressures(n, L, q_in, q_out):
    """Inlet and outlet pressure from line pack (average pressure) and the pipe flows at each end."""
    pa = L / KSEG[n]
    q = 0.5 * (q_in + q_out)
    d = C_FRIC * SEG_MILES[n] * q * q / (4 * pa)
    return pa + d, pa - d


def p_at(p_in, p_out, frac):
    """Pressure a fraction of the way along a segment (general flow equation profile)."""
    return math.sqrt(max(p_in ** 2 - (p_in ** 2 - p_out ** 2) * frac, 1.0))


def head(r):
    return r ** 0.23 - 1


def gt_heat_rate(load):
    return 7600.0 * (1 + 0.45 * max(0.0, 1 - load) ** 2)


def fuel_mmscfd(hp, heat_rate):
    return hp * heat_rate * 24 / HHV / 1e6


osc_amp = [0.0 if minutes(t) < minutes(OSC_START) else math.exp((minutes(t) - minutes(OSC_START)) / 30.0)
           for t in TS]                                # grows ×5 in 50 minutes
osc_phase = [math.sin(2 * math.pi * (minutes(t) - minutes(OSC_START)) / 20.0 + math.pi / 4) for t in TS]
ashby_q = [q + 7.0 * a * ph for q, a, ph in zip(ashby_q, osc_amp, osc_phase)]

# Marlow (end of line) takes what its downstream pipeline can accept; balanced at 08:00.
D4_BASE = None
L = {n: KSEG[n] * P_REF[n] for n in SEG_MILES}
fuel = {'W': 3.3, 'K': 3.9, 'A': 3.3}
SIM = []
for i in range(N):
    if D4_BASE is None:
        D4_BASE = ashby_q[0] - fuel['A'] - tolland[0]
    d4 = D4_BASE + (MARLOW_CUT_FLOW - D4_BASE) * interp({'08:00': 0.0, MARLOW_CUT[0]: 0.0, MARLOW_CUT[1]: 1.0,
                                                         '14:05': 1.0})[i] + marlow_noise[i]
    W, K, Aq = wren_q[i], kc_q[i], ashby_q[i]
    ends = {1: (harlow[i], W), 2: (W - fuel['W'], K), 3: (K - fuel['K'], Aq), 4: (Aq - fuel['A'], d4)}
    net = {1: harlow[i] - W,
           2: W - fuel['W'] + sable[i] - bexley[i] - K,
           3: K - fuel['K'] - halcyon[i] - Aq,
           4: Aq - fuel['A'] - tolland[i] - d4}
    if i > 0:
        for n in SEG_MILES:
            L[n] += net[n] * DT_DAY
    p = {n: seg_pressures(n, L[n], *ends[n]) for n in SEG_MILES}
    hp, new_fuel = {}, {}
    for s, q, up, dn in (('W', W, 1, 2), ('K', K, 2, 3), ('A', Aq, 3, 4)):
        r = (p[dn][0] + 14.7) / (p[up][1] + 14.7)
        hp[s] = HP_C * q * head(r)
        hr = 7300.0 if s == 'K' else gt_heat_rate(hp[s] / (2 * TURB_RATED))
        new_fuel[s] = fuel_mmscfd(hp[s], hr)
    fuel = new_fuel
    SIM.append({'L': dict(L), 'p': p, 'D4': d4, 'hp': hp, 'fuel': dict(fuel), 'ends': ends})

MARLOW_SCHED = round(D4_BASE)
Lser = {n: [r['L'][n] for r in SIM] for n in SEG_MILES}
Pin = {n: [r['p'][n][0] for r in SIM] for n in SEG_MILES}
Pout = {n: [r['p'][n][1] for r in SIM] for n in SEG_MILES}
Qst = {'W': wren_q, 'K': kc_q, 'A': ashby_q}
D4 = [r['D4'] for r in SIM]
# Ashby's loop interaction shows directly in its discharge pressure (= Segment 4 inlet).
osc_p = [22.0 * a / math.exp(50 / 30.0) * ph if a else 0.0 for a, ph in zip(osc_amp, osc_phase)]
Pin[4] = [p + o for p, o in zip(Pin[4], osc_p)]

# ── Environment ─────────────────────────────────────────────────────────
ambient = plus_noise(interp({'08:00': 76.0, '10:00': 82.5, '12:00': 89.0, '14:05': 93.0}), 0.4)
GAS_T = 74.0                      # buried-pipe gas temperature arriving at each station (°F)


def split(total, shares, d, noise_sd=0.0):
    """Split a total across children so the rounded parts sum exactly to the rounded total."""
    noises = [ar1(noise_sd, 0.7) if noise_sd else [0.0] * N for _ in shares]
    out = [[] for _ in shares]
    for i in range(N):
        tot = rnd(total[i], d)
        w = [max(0.0, sh + nz[i]) for sh, nz in zip(shares, noises)]
        sw = sum(w) or 1.0
        parts = [rnd(tot * x / sw, d) for x in w[:-1]]
        parts.append(rnd(tot - sum(parts), d))
        for k, v in enumerate(parts):
            out[k].append(v)
    return out


def sawtooth_level(base, amp, period_steps, phase=0):
    """Separator liquid level: slow fill, periodic dump."""
    return [base + amp * (((i + phase) % period_steps) / period_steps) for i in range(N)]


def filter_sep(aid, flow, flow_ref, dp_ref, level_base, extra_level=None, phase=0):
    put(aid, 'filter_sep_dp_psid', [dp_ref * (q / flow_ref) ** 2 + e for q, e in zip(flow, ar1(0.05))])
    lvl = sawtooth_level(level_base, 9.0, 9, phase)
    if extra_level:
        lvl = [a + b for a, b in zip(lvl, extra_level)]
    put(aid, 'separator_liquid_level_pct', [v + e for v, e in zip(lvl, ar1(0.6))])


def meter_diag(aid, flow, flow_max, gain0):
    put(aid, 'sos_spread_fps', [0.38 + 0.25 * (q / flow_max) + e for q, e in zip(flow, ar1(0.05))])
    put(aid, 'meter_gain_db', [gain0 + 4.0 * (q / flow_max) + e for q, e in zip(flow, ar1(0.3))])


# ── Receipts ────────────────────────────────────────────────────────────
har_runs = split(harlow, [0.34, 0.33, 0.33], 1, 0.004)
for aid, fl in zip(HAR_RUNS, har_runs):
    put(aid, 'meter_flow_mmscfd', fl)
for aid, fl, g in zip(HAR_RUNS, har_runs, (38.2, 40.1, 37.4)):
    meter_diag(aid, fl, 600, g)
put(HAR, 'receipt_flow_mmscfd', [sum(x) for x in zip(*har_runs)])
put(HAR, 'receipt_nominated_mmscfd', harlow_nom)
put(HAR, 'receipt_pressure_psig', [p + 4 + e for p, e in zip(Pin[1], ar1(0.8))])
filter_sep(HAR_FSEP, harlow, 905, 5.2, 18.0)
put(HAR_GC, 'gas_hhv_btu_scf', plus_noise([1036.4] * N, 0.6))
put(HAR_GC, 'co2_mol_pct', plus_noise([0.86] * N, 0.01))
put(HAR_GC, 'relative_density', plus_noise([0.5962] * N, 0.0006))
put(HAR_QA, 'water_content_lb_mmscf', plus_noise([2.85] * N, 0.05))
put(HAR_QA, 'h2s_gr_100scf', plus_noise([0.062] * N, 0.003))
put(HAR_QA, 'hc_dew_point_f', plus_noise([-12.0] * N, 0.4))

sab_runs = split(sable, [0.5, 0.5], 2, 0.004)
for aid, fl in zip(SAB_RUNS, sab_runs):
    put(aid, 'small_meter_flow_mmscfd', fl)
for aid, fl, g in zip(SAB_RUNS, sab_runs, (34.6, 35.3)):
    meter_diag(aid, fl, 200, g)
put(SAB, 'field_receipt_flow_mmscfd', [sum(x) for x in zip(*sab_runs)])
put(SAB, 'field_receipt_nominated_mmscfd', sable_nom)
put(SAB, 'receipt_pressure_psig', [p_at(a, b, 27 / 84) + 6 + e for a, b, e in zip(Pin[2], Pout[2], ar1(0.8))])
# Glycol dehydration upset upstream: water climbs, glycol carries over into the separator.
water = interp({'08:00': 3.15, DEHY_START: 3.2, '09:30': 3.9, '10:00': 4.7, '10:30': 5.6, '10:50': 6.2, DEHY_FIX: 6.55,
                '11:20': 5.9, '11:40': 4.4, DEHY_OK: 3.5, '14:05': 3.3})
put(SAB_QA, 'water_content_lb_mmscf', plus_noise(water, 0.04, 0.6))
put(SAB_QA, 'h2s_gr_100scf', plus_noise([0.108] * N, 0.004))
put(SAB_QA, 'hc_dew_point_f', plus_noise([-7.5] * N, 0.4))
glycol = interp({'08:00': 0.0, '09:25': 0.0, '10:00': 7.0, '10:40': 22.0, DEHY_FIX: 34.0, '11:15': 36.0, '11:25': 6.0,
                 '14:05': 0.0})
filter_sep(SAB_FSEP, sable, 181.5, 3.1, 20.0, glycol, phase=3)

# ── Line segments, mainline valves and CP rectifiers ────────────────────
seg_inflow = {1: harlow, 2: [q - r['fuel']['W'] for q, r in zip(Qst['W'], SIM)],
              3: [q - r['fuel']['K'] for q, r in zip(Qst['K'], SIM)],
              4: [q - r['fuel']['A'] for q, r in zip(Qst['A'], SIM)]}
mlv_true = {}
for n in SEG_MILES:
    seg = SEG[n]
    put(seg, 'seg_inlet_pressure_psig', Pin[n])
    put(seg, 'seg_outlet_pressure_psig', Pout[n])
    put(seg, 'seg_flow_mmscfd', seg_inflow[n])
    put(seg, 'line_pack_mmscf', Lser[n])
    a0 = SEG_MP[n][0]
    for k, (mlv, mp) in enumerate(zip(MLV[n], MLV_MP[n])):
        frac = (mp - a0) / SEG_MILES[n]
        # Ashby's discharge oscillation fades along Segment 4
        true_p = [p_at(pi - (osc_p[i] if n == 4 else 0.0), po, frac) + (osc_p[i] * math.exp(-(mp - a0) / 15) if n == 4 else 0.0)
                  for i, (pi, po) in enumerate(zip(Pin[n], Pout[n]))]
        true_p = [v + e for v, e in zip(true_p, ar1(0.5, 0.6))]
        mlv_true[mlv] = true_p
        reading = list(true_p)
        if n == 1 and k == 1:                   # MLV 1-2: intermittent transmitter (LSIT02)
            for t, err in MLV_SPIKES.items():
                reading[i_of(t)] += err
        put(mlv, 'mlv_pressure_psig', reading)
        stored = S(mlv, 'mlv_pressure_psig')
        roc = [0.0] + [(b - a) / STEP for a, b in zip(stored, stored[1:])]
        roc[0] = roc[1]
        put(mlv, 'pressure_roc_psi_min', roc)
        put(mlv, 'valve_position_pct', [100.0] * N)
    for k, rect in enumerate(RECT[n]):
        v0 = 17.5 + 3.0 * ((n + k) % 3)
        put(rect, 'rectifier_output_v', plus_noise([v0] * N, 0.08))
        put(rect, 'rectifier_output_a', plus_noise([v0 * 1.22] * N, 0.1))
        put(rect, 'pipe_to_soil_mv', plus_noise([-1040.0 - 35 * ((n * 2 + k) % 4)] * N, 3.0))
    series[seg]['maop_psig'] = [MAOP]           # static; moved to asset-values below

# ── Compressor stations ─────────────────────────────────────────────────
def station_ratio(up, dn):
    return [(pd + 14.7) / (ps + 14.7) for pd, ps in zip(Pin[dn], Pout[up])]


recycle_leak = [RECYCLE_LEAK_NOW * v for v in ramp(RECYCLE_START, '14:05', 1.0, 1.25)]
dgs_rise = ramp(DGS_START, '14:05', DGS_RISE_SCFM, 1.6)


def turbine_units(st, units, q, ratio, running, leak=None, vent_rise=None, filt_dp=(2.4, 2.9, 2.6)):
    """Gas-turbine / centrifugal units: equal load sharing, recycle to hold minimum flow."""
    n_run = [sum(r[i] for r in running) for i in range(N)]
    tot_hp, tot_fuel = [0.0] * N, [0.0] * N
    for k, u in enumerate(units):
        run_k = running[k]
        share = [q[i] / n_run[i] if run_k[i] else 0.0 for i in range(N)]
        flow = [max(s, SURGE_MIN) if run_k[i] else 0.0 for i, s in enumerate(share)]
        recyc = [((SURGE_MIN - s) / 250.0 * 100 if run_k[i] and s < SURGE_MIN else (0.0 if run_k[i] else 100.0))
                 for i, s in enumerate(share)]
        if leak and k == 0:
            flow = [f + lk for f, lk in zip(flow, leak)]       # passing recycle valve: command still reads 0
        flow = [f + e if f else 0.0 for f, e in zip(flow, ar1(1.2, 0.6))]
        hp = [HP_C * f * head(r) for f, r in zip(flow, ratio)]
        load = [h / TURB_RATED for h in hp]
        fuel = [fuel_mmscfd(h, gt_heat_rate(l)) if h else 0.0 for h, l in zip(hp, load)]
        put(u, 'unit_flow_mmscfd', flow)
        put(u, 'unit_power_hp', hp)
        put(u, 'unit_fuel_mmscfd', fuel)
        put(u, 'recycle_valve_pct', [min(100.0, max(0.0, v + (e if 0 < v < 100 else 0))) for v, e in zip(recyc, ar1(0.4))])
        put(u, 'unit_speed_pct', [70 + 30 * l + e if l else 0.0 for l, e in zip(load, ar1(0.2))])
        series[u]['rated_power_hp'] = [TURB_RATED]
        tot_hp = [a + b for a, b in zip(tot_hp, S(u, 'unit_power_hp'))]
        tot_fuel = [a + b for a, b in zip(tot_fuel, S(u, 'unit_fuel_mmscfd'))]
        # components
        amb_k = [a + e for a, e in zip(ambient, ar1(0.3))]
        put(f'{u}_GT', 'gp_speed_pct', [88 + 10 * l + e if l else 0.0 for l, e in zip(load, ar1(0.2))])
        put(f'{u}_GT', 'pt_inlet_temp_f', [1060 + 230 * l + 0.8 * (a - 76) + e if l else a
                                            for l, a, e in zip(load, amb_k, ar1(2.0))])
        put(f'{u}_GT', 'inlet_filter_dp_inh2o', [(filt_dp[k] * (0.75 + 0.25 * l) + 0.015 * i / 12) if l else 0.3
                                                  for i, l in enumerate(load)])
        eta = 0.825 - 0.006 * k
        ct = [((GAS_T + 460) * r ** (0.286 / eta) - 460) + e if l else a for r, l, a, e in zip(ratio, load, amb_k, ar1(0.4))]
        put(f'{u}_COMP', 'comp_discharge_temp_f', ct)
        put(f'{u}_COMP', 'comp_vibration_mils', [0.85 + 0.2 * k + 0.25 * l + e if l else 0.06 for l, e in zip(load, ar1(0.03))])
        put(f'{u}_COMP', 'polytropic_eff_pct', [100 * eta + e if l else 70.0 for l, e in zip(load, ar1(0.08))])
        vent0 = 1.30 + 0.08 * k
        vent = [vent0 + (vent_rise[i] if vent_rise and k == 1 else 0.0) if l else 0.9 for i, l in enumerate(load)]
        put(f'{u}_DGS', 'primary_vent_flow_scfm', [v + e for v, e in zip(vent, ar1(0.04))])
        put(f'{u}_DGS', 'seal_gas_filter_dp_psid', [4.1 + 0.2 * k + 0.55 * (v - vent0 if l else 0) + e
                                                     for v, l, e in zip(vent, load, ar1(0.05))])
        put(f'{u}_DGS', 'seal_gas_supply_dp_psid', [48 + e if l else 12 + e for l, e in zip(load, ar1(0.6))])
        put(f'{u}_LUBE', 'lube_oil_pressure_psig', [30.5 - 0.3 * k + e if l else 27.0 + e for l, e in zip(load, ar1(0.25))])
        put(f'{u}_LUBE', 'lube_oil_temp_f', [138 + 0.45 * (a - 76) + 6 * l + e if l else 104 + e
                                              for l, a, e in zip(load, ambient, ar1(0.4))])
    return tot_hp, tot_fuel


def station_common(st, scrub, cool, q, up, dn, hp_sum, fuel_sum, cool_in, fans):
    put(st, 'station_suction_pressure_psig', Pout[up])
    put(st, 'station_discharge_pressure_psig', Pin[dn])
    put(st, 'station_flow_mmscfd', q)
    put(st, 'station_power_hp', hp_sum)
    put(st, 'station_fuel_mmscfd', fuel_sum)
    put(st, 'compression_ratio', station_ratio(up, dn))
    filter_sep(scrub, q, 905, 4.4, 16.0, phase=up * 2)
    put(cool, 'cooler_inlet_temp_f', cool_in)
    put(cool, 'cooler_outlet_temp_f', [a + 11.5 + e for a, e in zip(ambient, ar1(0.4))])
    put(cool, 'cooler_fans_running', fans)


fans_am_pm = [4 if minutes(t) < minutes('10:40') else (5 if minutes(t) < minutes('12:20') else 6) for t in TS]

# Wren: CU-1 and CU-2 run, CU-3 is the standby unit.
ratio_w = station_ratio(1, 2)
run_w = [[True] * N, [True] * N, [False] * N]
w_hp, w_fuel = turbine_units(WREN, WREN_U, Qst['W'], ratio_w, run_w, leak=recycle_leak, vent_rise=dgs_rise)
w_ct = [0.5 * (a + b) for a, b in zip(S(f'{WREN_U[0]}_COMP', 'comp_discharge_temp_f'), S(f'{WREN_U[1]}_COMP', 'comp_discharge_temp_f'))]
station_common(WREN, WREN_SCRUB, WREN_COOL, Qst['W'], 1, 2, w_hp, w_fuel, w_ct, fans_am_pm)

# Ashby: both units run (no standby); after the 12:50 ceiling change they drop into recycle.
ratio_a = station_ratio(3, 4)
run_a = [[True] * N, [True] * N]
a_hp, a_fuel = turbine_units(ASH, ASH_U, Qst['A'], ratio_a, run_a, filt_dp=(2.2, 2.7))
a_ct = [0.5 * (a + b) for a, b in zip(S(f'{ASH_U[0]}_COMP', 'comp_discharge_temp_f'), S(f'{ASH_U[1]}_COMP', 'comp_discharge_temp_f'))]
station_common(ASH, ASH_SCRUB, ASH_COOL, Qst['A'], 3, 4, a_hp, a_fuel, a_ct, fans_am_pm)

# Kettle Creek: five gas-engine reciprocating units; CU-5 is standby. CU-3 trips at 11:52.
ratio_k = station_ratio(2, 3)
cu3_up = [not x for x in after(CU3_TRIP)]
cu5_avail = interp({'08:00': 0.0, CU5_START: 0.0, CU5_LOADED: 1.0, '14:05': 1.0})
knock_dip = [0.09 if t in KNOCK_TIMES else 0.0 for t in TS]
weights = [[1.0] * N, [1.0 - kd for kd in knock_dip], [1.0 if u else 0.0 for u in cu3_up], [1.0] * N, cu5_avail]
k_hp, k_fuel = [0.0] * N, [0.0] * N
valve_dev3 = interp({'08:00': 5.8, CU3_VALVE: 6.0, '11:35': 11.5, '11:40': 17.0, '11:45': 24.0, '11:50': 29.5})
vib3 = interp({'08:00': 0.21, '11:35': 0.22, '11:40': 0.30, '11:45': 0.47, '11:50': 0.93})
for k, u in enumerate(KC_U):
    w = weights[k]
    flow = [Qst['K'][i] * w[i] / sum(ww[i] for ww in weights) for i in range(N)]
    flow = [f + e if f > 0.5 else 0.0 for f, e in zip(flow, ar1(0.8, 0.6))]
    hp = [HP_C * f * head(r) for f, r in zip(flow, ratio_k)]
    load = [h / RECIP_RATED for h in hp]
    assert max(load) < 1.0, (u, max(load))
    put(u, 'recip_unit_flow_mmscfd', flow)
    put(u, 'recip_unit_power_hp', hp)
    put(u, 'recip_unit_fuel_mmscfd', [fuel_mmscfd(h, 7300 * (1 + 0.2 * (1 - l) ** 2)) if h else 0.0 for h, l in zip(hp, load)])
    put(u, 'engine_speed_rpm', [850 + 150 * l + e if l else 0.0 for l, e in zip(load, ar1(2.0))])
    series[u]['recip_rated_power_hp'] = [RECIP_RATED]
    k_hp = [a + b for a, b in zip(k_hp, S(u, 'recip_unit_power_hp'))]
    k_fuel = [a + b for a, b in zip(k_fuel, S(u, 'recip_unit_fuel_mmscfd'))]
    running = [l > 0 for l in load]
    # engine: exhaust cools after a trip, jacket water held warm by its heater on standby
    exh, jw, last_exh, last_jw = [], [], 110.0, 150.0
    for i, (l, a) in enumerate(zip(load, ambient)):
        if running[i]:
            last_exh = 770 + 160 * l + 0.6 * (a - 76)
            last_jw = 184 + 6 * l
        else:
            last_exh = max(110.0, last_exh - 0.35 * (last_exh - 100))
            last_jw = max(150.0, last_jw - 0.12 * (last_jw - 140))
        exh.append(last_exh)
        jw.append(last_jw)
    put(f'{u}_ENG', 'engine_exhaust_temp_f', [x + e for x, e in zip(exh, ar1(2.0))])
    put(f'{u}_ENG', 'jacket_water_temp_f', [x + e for x, e in zip(jw, ar1(0.4))])
    events = KNOCK_TIMES if k == 1 else (['12:40'] if k == 3 else [])
    ev_m = [minutes(t) for t in events]
    put(f'{u}_ENG', 'knock_events_1h', [sum(1 for m in ev_m if minutes(t) - 60 < m <= minutes(t)) for t in TS])
    cyl = [((GAS_T + 460) * r ** (0.286 / 0.86) - 460) + 12 + e if run else a for r, run, a, e in
           zip(ratio_k, running, ambient, ar1(0.5))]
    put(f'{u}_FRAME', 'cyl_discharge_temp_f', cyl)
    dev = valve_dev3 if k == 2 else [4.5 + 0.7 * k] * N
    put(f'{u}_FRAME', 'valve_temp_dev_f', [d + e if run else 1.2 for d, run, e in zip(dev, running, ar1(0.3))])
    vib = vib3 if k == 2 else [0.2 + 0.015 * k] * N
    put(f'{u}_FRAME', 'frame_vibration_ips', [v + e if run else 0.02 for v, run, e in zip(vib, running, ar1(0.008))])
    put(f'{u}_FRAME', 'rod_load_pct', [52 + 18 * l + e if run else 0.0 for l, run, e in zip(load, running, ar1(0.4))])
    put(f'{u}_LUBE', 'lube_oil_pressure_psig', [55.0 + e if run else 30.0 + e for run, e in zip(running, ar1(0.3))])
    lot, last = [], 160.0
    for run, a in zip(running, ambient):
        last = (168 + 0.35 * (a - 76)) if run else max(120.0, last - 0.15 * (last - 110))
        lot.append(last)
    put(f'{u}_LUBE', 'lube_oil_temp_f', [x + e for x, e in zip(lot, ar1(0.4))])
k_ct = [sum(S(f'{u}_FRAME', 'cyl_discharge_temp_f')[i] * (S(u, 'recip_unit_flow_mmscfd')[i] > 0) for u in KC_U) /
        max(1, sum(S(u, 'recip_unit_flow_mmscfd')[i] > 0 for u in KC_U)) for i in range(N)]
station_common(KC, KC_SCRUB, KC_COOL, Qst['K'], 2, 3, k_hp, k_fuel, k_ct, fans_am_pm)

# ── Deliveries ──────────────────────────────────────────────────────────
def city_gate(cg, heater, regs, odor, flow, inlet_p, outlet_sp, bath, firing, hunt=None, reg_a_extra=None):
    runs = split(flow, [0.52, 0.48], 2, 0.003)
    for aid, fl in zip(regs, runs):
        put(aid, 'reg_flow_mmscfd', fl)
    put(cg, 'cg_delivery_flow_mmscfd', [sum(x) for x in zip(*runs)])
    put(cg, 'cg_inlet_pressure_psig', inlet_p)
    out_p = [outlet_sp + (hunt[i] if hunt else 0.0) + e for i, e in enumerate(ar1(0.6))]
    put(cg, 'cg_outlet_pressure_psig', out_p)
    put(heater, 'bath_temp_f', [b + e for b, e in zip(bath, ar1(0.3))])
    h_out = [50 + (b - 80) * 0.42 + e for b, e in zip(S(heater, 'bath_temp_f'), ar1(0.25))]
    put(heater, 'heater_outlet_temp_f', h_out)
    put(heater, 'burner_firing_pct', [f + (e if 0 < f < 100 else 0) for f, e in zip(firing, ar1(1.0))])
    for k, aid in enumerate(regs):
        jt = [0.07 * (pi - po) for pi, po in zip(inlet_p, out_p)]
        put(aid, 'reg_outlet_temp_f', [h - j - 0.6 * k + e for h, j, e in zip(h_out, jt, ar1(0.3))])
        trav = [100 * f / 150 * 0.95 + (hunt[i] * 1.5 if hunt and k == 0 else 0.0) + e
                for i, (f, e) in enumerate(zip(S(aid, 'reg_flow_mmscfd'), ar1(0.5)))]
        put(aid, 'reg_travel_pct', trav)
    put(odor, 'odorant_rate_lb_mmscf', plus_noise([0.93] * N, 0.012))
    put(odor, 'odorant_tank_level_pct', [62.0 - 0.02 * i + e for i, e in enumerate(ar1(0.05))])


bex_inlet = [p_at(a, b, 42 / 84) for a, b in zip(Pin[2], Pout[2])]
bath_bex, firing_bex, b = [], [], 178.0
for t in TS:
    m = minutes(t)
    if minutes(HEATER_OUT) <= m < minutes(HEATER_RELIT):
        b -= 1.9 + 0.004 * (m - minutes(HEATER_OUT)); f = 0.0
    elif m >= minutes(HEATER_RELIT) and b < 177.5:
        b = min(178.0, b + 4.0); f = 100.0
    else:
        b = 178.0; f = 44.0
    bath_bex.append(b); firing_bex.append(f)
hunt_bex = [(7.5 * math.sin(i * 2.1) * min(1.0, (minutes(t) - minutes('11:20')) / 20)
             if minutes('11:20') <= minutes(t) < minutes(HEATER_RELIT) else 0.0) for i, t in enumerate(TS)]
city_gate(BEX, BEX_HTR, BEX_REG, BEX_ODOR, bexley, bex_inlet, 300.0, bath_bex, firing_bex, hunt_bex)

tol_inlet = [p_at(a - o, b, 42 / 74) for a, b, o in zip(Pin[4], Pout[4], osc_p)]
city_gate(TOL, TOL_HTR, TOL_REG, TOL_ODOR, tolland, tol_inlet, 250.0, [172.0] * N, [38.0] * N)

put(HAL_RUN, 'small_meter_flow_mmscfd', halcyon)
meter_diag(HAL_RUN, halcyon, 200, 33.8)
put(HAL, 'pp_delivery_flow_mmscfd', S(HAL_RUN, 'small_meter_flow_mmscfd'))
put(HAL, 'pp_scheduled_flow_mmscfd', halcyon_sched)
imb, acc = [], 0.62          # prior gas day's closing position at 08:00 (+0.62 MMscf)
for i, t in enumerate(TS):
    q = S(HAL, 'pp_delivery_flow_mmscfd')[i]
    if t == GAS_DAY_START:
        acc = 0.0
    else:
        acc += (q - halcyon_sched[i]) * DT_DAY
    imb.append(acc)
put(HAL, 'gas_day_imbalance_mmscf', imb)
put(HAL, 'pp_delivery_pressure_psig', plus_noise([562.0] * N, 1.0))
filter_sep(HAL_FSEP, halcyon, 100, 2.3, 14.0, phase=5)

mar_runs = split(D4, [0.34, 0.33, 0.33], 1, 0.004)
for aid, fl, g in zip(MAR_RUNS, mar_runs, (39.0, 38.1, 40.4)):
    put(aid, 'meter_flow_mmscfd', fl)
    meter_diag(aid, fl, 600, g)
put(MAR, 'ic_delivery_flow_mmscfd', [sum(x) for x in zip(*mar_runs)])
put(MAR, 'ic_scheduled_flow_mmscfd', [float(MARLOW_SCHED)] * N)
put(MAR, 'ic_delivery_pressure_psig', [p + e for p, e in zip(Pout[4], ar1(0.5))])

# ── System and district rollups ─────────────────────────────────────────
segs = [SEG[n] for n in SEG_MILES]
stations = [WREN, KC, ASH]
put(SYS_ID, 'system_line_pack_mmscf', [sum(S(s, 'line_pack_mmscf')[i] for s in segs) for i in range(N)])
lp = S(SYS_ID, 'system_line_pack_mmscf')
put(SYS_ID, 'line_pack_change_mmscf_h', [(lp[max(i, 1)] - lp[max(i, 1) - 1]) * 60 / STEP for i in range(N)])
put(SYS_ID, 'system_fuel_mmscfd', [sum(S(s, 'station_fuel_mmscfd')[i] for s in stations) for i in range(N)])
put(SYS_ID, 'total_receipts_mmscfd', [a + b for a, b in zip(S(HAR, 'receipt_flow_mmscfd'), S(SAB, 'field_receipt_flow_mmscfd'))])
put(SYS_ID, 'total_deliveries_mmscfd', [a + b + c + d for a, b, c, d in zip(
    S(BEX, 'cg_delivery_flow_mmscfd'), S(TOL, 'cg_delivery_flow_mmscfd'), S(HAL, 'pp_delivery_flow_mmscfd'),
    S(MAR, 'ic_delivery_flow_mmscfd'))])
for dist in (DW, DC, DE):
    ch = kids[dist]
    put(dist, 'district_line_pack_mmscf', [sum(S(s, 'line_pack_mmscf')[i] for s in ch if A[s]['assetType'] == 'pipeline_segment')
                                          for i in range(N)])
    put(dist, 'district_fuel_mmscfd', [sum(S(s, 'station_fuel_mmscfd')[i] for s in ch if A[s]['assetType'].endswith('_compressor_station'))
                                      for i in range(N)])

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

# ── Relationships (spec §3.6) ────────────────────────────────────────────
rels = []


def edge(a, b, layer, label=None):
    assert a in A and b in A, (a, b)
    rels.append({'sourceAssetId': a, 'targetAssetId': b, 'relationshipType': 'feeds_into', 'label': label, 'layer': layer})


# Facility-level mainline, west to east (what the Now strip and unit diagrams read)
chain = [HAR, SEG[1], WREN, SEG[2], KC, SEG[3], ASH, SEG[4], MAR]
for a, b in zip(chain, chain[1:]):
    edge(a, b, 'gas_flow')
edge(SAB, SEG[2], 'gas_flow', 'field gas tie-in at MP 95')
edge(SEG[2], BEX, 'gas_flow', 'lateral at MP 110')
edge(SEG[3], HAL, 'gas_flow', 'plant lateral at MP 194')
edge(SEG[4], TOL, 'gas_flow', 'lateral at MP 278')
# Equipment-level mainline: meter runs → MLVs → station yard → MLVs …
edge(HAR_FSEP, HAR_RUNS[0], 'gas_flow')
for r in HAR_RUNS[1:]:
    edge(HAR_FSEP, r, 'gas_flow')
for r in HAR_RUNS:
    edge(r, MLV[1][0], 'gas_flow', 'custody transfer into the mainline')
edge(HAR_FSEP, HAR_GC, 'sample', 'analyzer sample probe')
edge(HAR_FSEP, HAR_QA, 'sample', 'analyzer sample probe')
for n in SEG_MILES:
    for a, b in zip(MLV[n], MLV[n][1:]):
        edge(a, b, 'gas_flow')
    for k, rect in enumerate(RECT[n]):
        edge(rect, MLV[n][min(k + (1 if k else 0), 2)], 'cathodic_protection', 'CP current (test station at valve site)')
        if k == 0:
            edge(rect, MLV[n][1], 'cathodic_protection', 'CP current (test station at valve site)')


def station_edges(scrub, units, cool, up_mlv, dn_mlv, kind):
    edge(up_mlv, scrub, 'gas_flow', 'station suction')
    for u in units:
        edge(scrub, u, 'gas_flow', 'unit suction')
        edge(u, cool, 'gas_flow', 'unit discharge')
        if kind == 'turbine':
            edge(scrub, f'{u}_GT', 'fuel_gas', 'fuel gas')
            edge(f'{u}_GT', f'{u}_COMP', 'power', 'power turbine shaft')
            edge(f'{u}_COMP', f'{u}_DGS', 'seal_gas', 'filtered discharge gas as seal gas')
            edge(f'{u}_LUBE', f'{u}_GT', 'lube_oil')
            edge(f'{u}_LUBE', f'{u}_COMP', 'lube_oil')
        else:
            edge(scrub, f'{u}_ENG', 'fuel_gas', 'fuel gas')
            edge(f'{u}_ENG', f'{u}_FRAME', 'power', 'crankshaft coupling')
            edge(f'{u}_LUBE', f'{u}_ENG', 'lube_oil')
            edge(f'{u}_LUBE', f'{u}_FRAME', 'lube_oil', 'frame and cylinder lubrication')
    edge(cool, scrub, 'gas_flow', 'anti-surge recycle')
    edge(cool, dn_mlv, 'gas_flow', 'station discharge')


station_edges(WREN_SCRUB, WREN_U, WREN_COOL, MLV[1][-1], MLV[2][0], 'turbine')
station_edges(KC_SCRUB, KC_U, KC_COOL, MLV[2][-1], MLV[3][0], 'recip')
station_edges(ASH_SCRUB, ASH_U, ASH_COOL, MLV[3][-1], MLV[4][0], 'turbine')
# Receipt and delivery taps
edge(SAB_FSEP, SAB_RUNS[0], 'gas_flow')
edge(SAB_FSEP, SAB_RUNS[1], 'gas_flow')
for r in SAB_RUNS:
    edge(r, MLV[2][1], 'gas_flow', 'enters between MLV 2-1 and 2-2')
edge(SAB_FSEP, SAB_QA, 'sample', 'analyzer sample probe')


def city_gate_edges(mlv, heater, regs, odor):
    edge(mlv, heater, 'gas_flow', 'lateral')
    for r in regs:
        edge(heater, r, 'gas_flow', 'heated gas')
        edge(odor, r, 'chemical_dosing', 'mercaptan injected downstream')


city_gate_edges(MLV[2][1], BEX_HTR, BEX_REG, BEX_ODOR)
city_gate_edges(MLV[4][1], TOL_HTR, TOL_REG, TOL_ODOR)
edge(MLV[3][1], HAL_FSEP, 'gas_flow', 'plant lateral')
edge(HAL_FSEP, HAL_RUN, 'gas_flow')
for r in MAR_RUNS:
    edge(MLV[4][2], r, 'gas_flow', 'end of line')
# de-duplicate (the rectifier loop above can repeat an edge)
_seen, _rels = set(), []
for r in rels:
    key = (r['sourceAssetId'], r['targetAssetId'], r['layer'])
    if key not in _seen:
        _seen.add(key); _rels.append(r)
rels = _rels

# ── Unit status (spec §6.6) ──────────────────────────────────────────────
PRODUCT = {'plant_receipt_station': 'Residue gas receipt', 'field_receipt_station': 'Field gas receipt',
           'pipeline_segment': 'Transport + line pack', 'turbine_compressor_station': 'Compression',
           'recip_compressor_station': 'Compression',
           'city_gate_station': 'LDC delivery (odorized)', 'power_plant_delivery': 'Power-plant fuel',
           'interconnect_delivery': 'Interconnect delivery'}
unit_status = {u: {'state': 'running', 'statusSinceMinutes': None, 'mode': 'STEADY',
                   'product': PRODUCT[A[u]['assetType']]} for u in UNITS}
unit_status[ASH]['mode'] = 'CONTROLLED_HOLD'     # held on a lowered discharge limit since 12:50


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
    unit, d = PROPS[key][1], min(PROPS[key][5], 2)
    s_ = f'{v:,.{d}f}'
    if unit == '%':
        return f'{s_}%'
    return f'{s_} {unit}' if unit else s_


def evidence(aid, key, points):
    ev, evp = [], []
    for t, note in points:
        v_ = S(aid, key)[i_of(t)]
        ev.append(v_)
        evp.append({'time': t, 'value': fmt(v_, key), 'label': note})
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


def rng_(aid, key, t0, t1):
    return S(aid, key)[i_of(t0):i_of(t1) + 1]


def mean_(xs):
    return sum(xs) / len(xs)


dgs2, dgs1 = f'{WREN_U[1]}_DGS', f'{WREN_U[0]}_DGS'
mlv12 = MLV[1][1]
bex_a = BEX_REG[0]
cu3, cu2e = KC_U[2], f'{KC_U[1]}_ENG'

q = {}
# LSIT01
q['vent_now'], q['vent_t0'] = v(dgs2, 'primary_vent_flow_scfm', '14:05'), v(dgs2, 'primary_vent_flow_scfm', DGS_START)
q['vent_sib'] = v(dgs1, 'primary_vent_flow_scfm', '14:05')
q['vent_slope_h'] = (q['vent_now'] - v(dgs2, 'primary_vent_flow_scfm', '13:35')) * 2
q['vent_to_alarm_min'] = round((6.0 - q['vent_now']) / q['vent_slope_h'] * 60 / 5) * 5
q['sgf0'], q['sgf_now'] = v(dgs2, 'seal_gas_filter_dp_psid', DGS_START), v(dgs2, 'seal_gas_filter_dp_psid', '14:05')
q['vib2'] = mean_(rng_(f'{WREN_U[1]}_COMP', 'comp_vibration_mils', DGS_START, '14:05'))
# LSIT02
q['mlv_low'] = v(mlv12, 'mlv_pressure_psig', '10:30')
q['mlv_true'] = mlv_true[mlv12][i_of('10:30')]
q['mlv_pct'] = 100 * (q['mlv_true'] - q['mlv_low']) / q['mlv_true']
q['roc_min'] = min(rng_(mlv12, 'pressure_roc_psi_min', '10:15', '11:00'))
q['roc_max'] = max(rng_(mlv12, 'pressure_roc_psi_min', '10:15', '11:00'))
q['mlv11_rng'] = max(rng_(MLV[1][0], 'mlv_pressure_psig', '10:15', '11:00')) - min(rng_(MLV[1][0], 'mlv_pressure_psig', '10:15', '11:00'))
q['mlv13_rng'] = max(rng_(MLV[1][2], 'mlv_pressure_psig', '10:15', '11:00')) - min(rng_(MLV[1][2], 'mlv_pressure_psig', '10:15', '11:00'))
# LSIT03
q['har0'], q['har_min'] = v(HAR, 'receipt_flow_mmscfd', '08:35'), min(rng_(HAR, 'receipt_flow_mmscfd', '08:45', '09:30'))
q['har_end'] = v(HAR, 'receipt_flow_mmscfd', RCUT_DONE)
q['w_min'] = min(S(WREN, 'station_flow_mmscfd')[:i_of('10:00')])
q['rec_max'] = max(S(WREN_U[0], 'recycle_valve_pct')[:i_of('10:00')])
q['k_min'] = min(S(KC, 'station_flow_mmscfd')[:i_of('11:00')])
q['k_min_t'] = TS[S(KC, 'station_flow_mmscfd')[:i_of('11:00')].index(q['k_min'])]
q['a_min'] = min(S(ASH, 'station_flow_mmscfd')[:i_of('11:00')])
q['a_min_t'] = TS[S(ASH, 'station_flow_mmscfd')[:i_of('11:00')].index(q['a_min'])]
q['p2a'], q['p2min'] = v(SEG[2], 'seg_inlet_pressure_psig', '08:35'), min(S(SEG[2], 'seg_inlet_pressure_psig')[:i_of('10:30')])
q['lp_draft'] = v(SYS_ID, 'system_line_pack_mmscf', '08:40') - min(S(SYS_ID, 'system_line_pack_mmscf')[:i_of('11:00')])
# LSIT04
q['rt0'], q['rt_min'] = v(bex_a, 'reg_outlet_temp_f', '10:10'), min(rng_(bex_a, 'reg_outlet_temp_f', '11:00', '12:30'))
q['bath_min'] = min(S(BEX_HTR, 'bath_temp_f'))
q['hout0'], q['hout_min'] = v(BEX_HTR, 'heater_outlet_temp_f', '10:10'), min(S(BEX_HTR, 'heater_outlet_temp_f'))
q['cg_swing'] = (max(rng_(BEX, 'cg_outlet_pressure_psig', '11:20', '12:05')) - min(rng_(BEX, 'cg_outlet_pressure_psig', '11:20', '12:05'))) / 2
q['jt_drop'] = mean_([h - r for h, r in zip(S(BEX_HTR, 'heater_outlet_temp_f'), S(bex_a, 'reg_outlet_temp_f'))])
q['cut_psi'] = mean_([a - b for a, b in zip(S(BEX, 'cg_inlet_pressure_psig'), S(BEX, 'cg_outlet_pressure_psig'))])
# LSIT05
q['cu3_q'] = v(cu3, 'recip_unit_flow_mmscfd', '11:50')
q['k0'], q['k_trip_min'] = v(KC, 'station_flow_mmscfd', '11:50'), min(rng_(KC, 'station_flow_mmscfd', '11:55', '12:30'))
q['dev0'], q['devpk'] = v(f'{cu3}_FRAME', 'valve_temp_dev_f', '11:25'), v(f'{cu3}_FRAME', 'valve_temp_dev_f', '11:50')
q['vib0'], q['vibpk'] = v(f'{cu3}_FRAME', 'frame_vibration_ips', '11:25'), v(f'{cu3}_FRAME', 'frame_vibration_ips', '11:50')
q['ks0'], q['kspk'] = v(KC, 'station_suction_pressure_psig', '11:50'), max(rng_(KC, 'station_suction_pressure_psig', '11:55', '12:40'))
q['kd0'], q['kdmin'] = v(KC, 'station_discharge_pressure_psig', '11:50'), min(rng_(KC, 'station_discharge_pressure_psig', '11:55', '12:40'))
q['l3_0'], q['l3_min'] = v(SEG[3], 'line_pack_mmscf', '11:50'), min(rng_(SEG[3], 'line_pack_mmscf', '11:55', '12:40'))
q['kload'] = 100 * mean_([v(u, 'recip_unit_power_hp', '12:10') for u in (KC_U[0], KC_U[1], KC_U[3])]) / RECIP_RATED
# LSIT06
q['osc_lo'], q['osc_hi'] = min(rng_(ASH, 'station_discharge_pressure_psig', '13:45', '14:05')), max(rng_(ASH, 'station_discharge_pressure_psig', '13:45', '14:05'))
q['osc_a0'] = (max(rng_(ASH, 'station_discharge_pressure_psig', '13:15', '13:30')) - min(rng_(ASH, 'station_discharge_pressure_psig', '13:15', '13:30'))) / 2
q['a_rec'] = max(rng_(ASH_U[0], 'recycle_valve_pct', '13:15', '14:05'))
q['a_qamp'] = (max(rng_(ASH, 'station_flow_mmscfd', '13:45', '14:05')) - min(rng_(ASH, 'station_flow_mmscfd', '13:45', '14:05'))) / 2
q['mlv41_amp'] = (max(rng_(MLV[4][0], 'mlv_pressure_psig', '13:45', '14:05')) - min(rng_(MLV[4][0], 'mlv_pressure_psig', '13:45', '14:05'))) / 2
# LSIT07
q['l4_0'], q['l4_pk'] = v(SEG[4], 'line_pack_mmscf', '10:30'), max(S(SEG[4], 'line_pack_mmscf'))
q['l4_pk_t'] = TS[S(SEG[4], 'line_pack_mmscf').index(q['l4_pk'])]
q['l4_now'] = v(SEG[4], 'line_pack_mmscf', '14:05')
q['m_p0'], q['m_ppk'] = v(MAR, 'ic_delivery_pressure_psig', '10:30'), max(S(MAR, 'ic_delivery_pressure_psig'))
q['a_dpk'] = max(S(ASH, 'station_discharge_pressure_psig')[:i_of(ASHBY_SP_CHANGE)])
q['mar_q'] = mean_(rng_(MAR, 'ic_delivery_flow_mmscfd', '11:00', '14:05'))
q['a_q0'], q['a_qnow'] = mean_(rng_(ASH, 'station_flow_mmscfd', '11:00', '11:45')), mean_(rng_(ASH, 'station_flow_mmscfd', '13:10', '14:05'))
q['l4_rate'] = (q['l4_pk'] - q['l4_now']) / ((NOW_MIN - minutes(q['l4_pk_t'])) / 60)
q['l3_rate'] = (v(SEG[3], 'line_pack_mmscf', '14:05') - v(SEG[3], 'line_pack_mmscf', '13:05')) 
q['sys_rate'] = v(SYS_ID, 'system_line_pack_mmscf', '14:05') - v(SYS_ID, 'system_line_pack_mmscf', '13:05')
# LSIT08
q['w0'], q['wpk'] = v(SAB_QA, 'water_content_lb_mmscf', DEHY_START), max(S(SAB_QA, 'water_content_lb_mmscf'))
q['w_end'] = v(SAB_QA, 'water_content_lb_mmscf', DEHY_OK)
q['sep_pk'] = max(S(SAB_FSEP, 'separator_liquid_level_pct'))
q['sab_q'] = mean_(rng_(SAB, 'field_receipt_flow_mmscfd', DEHY_START, DEHY_OK))
# LSIT09
q['wf0'], q['wf_now'] = v(WREN, 'station_fuel_mmscfd', '11:25'), v(WREN, 'station_fuel_mmscfd', '14:05')
q['wq'] = mean_(rng_(WREN, 'station_flow_mmscfd', '11:30', '14:05'))
q['c1'], q['c2'] = v(WREN_U[0], 'unit_flow_mmscfd', '14:05'), v(WREN_U[1], 'unit_flow_mmscfd', '14:05')
q['p1'], q['p2'] = v(WREN_U[0], 'unit_power_hp', '14:05'), v(WREN_U[1], 'unit_power_hp', '14:05')
q['f1'], q['f2'] = v(WREN_U[0], 'unit_fuel_mmscfd', '14:05'), v(WREN_U[1], 'unit_fuel_mmscfd', '14:05')
q['r0'], q['r_now'] = v(WREN, 'compression_ratio', '11:25'), v(WREN, 'compression_ratio', '14:05')
q['wf_ratio_part'] = (q['f2'] * 2) - q['wf0']       # what fuel would be if CU-1 matched CU-2
# LSIT10
q['knocks'] = len(KNOCK_TIMES)
q['knock_now'] = v(cu2e, 'knock_events_1h', '14:05')
q['amb0'], q['amb_now'] = ambient[i_of('11:40')], ambient[-1]
# LSIT11
q['imb_now'] = v(HAL, 'gas_day_imbalance_mmscf', '14:05')
q['imb_rate'] = (q['imb_now'] - v(HAL, 'gas_day_imbalance_mmscf', '12:05')) / 2
q['imb_cross_min'] = NOW_MIN + (OFO_TOLERANCE - q['imb_now']) / q['imb_rate'] * 60
q['imb_cross'] = f'{int(q["imb_cross_min"] // 60):02d}:{int(round(q["imb_cross_min"] % 60 / 5) * 5) % 60:02d}'
q['hal_q'] = mean_(rng_(HAL, 'pp_delivery_flow_mmscfd', '10:30', '14:05'))

attention = [
    item('LSIT01', dgs2, 'primary_vent_flow_scfm',
         [(DGS_START, 'Divergence begins'), ('10:15', ''), ('11:15', ''), ('12:15', ''), ('13:00', ''), ('13:40', ''),
          ('14:05', f'Current — CU-1 reads {q["vent_sib"]:.2f} scfm')],
         'medium', 'investigate', 'none', DGS_START,
         'Wren CU-2 dry gas seal venting more gas every hour at the same speed',
         'Primary vent flow on CU-2\'s non-drive-end seal has roughly quadrupled since about 09:10, while speed, suction pressure and seal gas supply held steady. CU-1\'s seals, on the same gas, are flat.',
         {'signal': f'Primary vent flow {q["vent_now"]:.2f} scfm at 14:05, up from {q["vent_t0"]:.2f} at 09:10 (alarm 6.0, trip 8.0). CU-1 reads {q["vent_sib"]:.2f} scfm.',
          'observed': f'Rise is smooth and getting faster; seal gas filter DP up from {q["sgf0"]:.1f} to {q["sgf_now"]:.1f} psid as more seal gas is drawn; shaft vibration steady around {q["vib2"]:.2f} mils; seal gas supply DP steady.',
          'derived': f'Two related signals agree (vent flow and seal gas filter DP), and the sister unit on the same gas is flat, so it is not a gas-quality or header problem. At the last half hour\'s rate the 6.0 scfm alarm comes in about {q["vent_to_alarm_min"]} minutes.',
          'inferred': 'Leakage across the NDE primary seal is increasing. Possible causes include seal-face wear or contamination, or a secondary-seal problem pressurising the primary vent. Not yet confirmed.',
          'recommendation': 'Check secondary vent pressure and the separation-gas supply; plan a controlled swap from CU-2 to standby CU-3 before the alarm rather than waiting for a trip.',
          'relatedOccurrences': [{'date': '2025-12-03', 'summary': 'Ashby CU-1 NDE seal replaced after vent flow climbed over two weeks (contaminated seal gas after a pigging run).'}],
          'whatChangedSummary': 'No speed, seal gas or maintenance change on CU-2 today — the trend is inside the seal.',
          'whatChanged': [{'time': DGS_START, 'source': 'Event', 'description': 'CU-2 NDE primary vent flow leaves its normal band.', 'related': True},
                          {'time': '12:30', 'source': 'Field Check', 'description': 'Station technician confirms the vent flowmeter against the local rotameter.', 'related': True}],
          'confidence': 'Two related signals agree; cause not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'Medium — a seal failure trips CU-2 and vents gas; CU-3 is available as standby', 'riskLevel': 'medium',
          'expectedOutcome': 'CU-3 in service and CU-2 seal cartridge replaced'}),
    item('LSIT02', mlv12, 'mlv_pressure_psig',
         [('10:15', 'Normal'), ('10:20', 'First drop'), ('10:30', 'Rupture-rate alert'), ('10:35', ''), ('10:45', ''),
          ('10:50', ''), (MLV_FIXED, 'Transmitter replaced')],
         'high', 'watch', 'resolved', MLV_FIXED,
         'Potential-rupture alarm at MLV 1-2 — but only one transmitter saw it',
         'MLV 1-2 pressure fell more than 10% in one scan and bounced back, several times. MLV 1-1, MLV 1-3, Harlow and Wren never moved and the line stayed in balance, so it was a failing transmitter, not a rupture.',
         {'signal': f'MLV 1-2 read {q["mlv_low"]:.0f} psig at 10:30 while the line was near {q["mlv_true"]:.0f} psig — a {q["mlv_pct"]:.0f}% drop in five minutes, which meets the potential-rupture rule (10% in 15 minutes).',
          'observed': f'Rate of change swung between {q["roc_min"]:.1f} and +{q["roc_max"]:.1f} psi/min. MLV 1-1 moved {q["mlv11_rng"]:.1f} psi and MLV 1-3 {q["mlv13_rng"]:.1f} psi over the same window; Harlow receipts and Wren throughput were steady.',
          'derived': 'A real rupture draws both neighbouring valves down within minutes and opens a gap between Harlow receipts and Wren throughput. Neither happened, and the reading kept returning to the true line pressure — an intermittent signal.',
          'inferred': 'Intermittent open circuit in the MLV 1-2 pressure transmitter loop.',
          'recommendation': 'Replace the transmitter, then record the alert and the no-rupture determination in the rupture-mitigation file.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Technician found water in the transmitter conduit; transmitter replaced at 11:00.',
          'whatChanged': [{'time': '10:30', 'source': 'Alarm', 'description': 'MLV 1-2 pressure rate-of-change (potential rupture) alarm.', 'related': True},
                          {'time': '10:33', 'source': 'Operator Action', 'description': 'Gas controller checked MLV 1-1, MLV 1-3 and line balance; no pressure loss elsewhere.', 'related': True},
                          {'time': '10:48', 'source': 'Field Check', 'description': 'Technician at MP 42: no release; water in the transmitter conduit.', 'related': True},
                          {'time': MLV_FIXED, 'source': 'Maintenance', 'description': 'Transmitter replaced and checked against a test gauge.', 'related': True}],
          'confidence': 'Confirmed in the field — no release at MP 42', 'confidenceLevel': 'high',
          'risk': 'Low — a false valve closure would have cut about 900 MMscf/d of throughput', 'riskLevel': 'low',
          'expectedOutcome': 'Transmitter replaced; alert documented'}),
    item('LSIT03', HAR, 'receipt_flow_mmscfd',
         [('08:35', 'Normal'), (RCUT_LOW, 'Plant trip — receipts cut'), ('09:00', ''), ('09:15', ''), (RCUT_BACK, 'Plant restarting'),
          ('09:40', ''), (RCUT_DONE, 'Restored')],
         'high', 'watch', 'resolved', RCUT_DONE,
         'Harlow receipts dropped 30% — every station downstream felt it',
         'The Harlow processing plant\'s residue compressor tripped and receipts fell to about 640 MMscf/d. Wren went into recycle, then Kettle Creek and Ashby backed off in turn, and system line pack drew down before Harlow came back.',
         {'signal': f'Harlow receipts fell from {q["har0"]:.0f} to {q["har_min"]:.0f} MMscf/d at 08:45 and were back at {q["har_end"]:.0f} by 09:50.',
          'observed': f'Wren throughput fell to {q["w_min"]:.0f} MMscf/d and its recycle valves opened to {q["rec_max"]:.0f}%; Kettle Creek reached a low of {q["k_min"]:.0f} at {q["k_min_t"]} and Ashby {q["a_min"]:.0f} at {q["a_min_t"]}; Segment 2 inlet pressure fell from {q["p2a"]:.0f} to {q["p2min"]:.0f} psig.',
          'derived': f'Each station\'s dip followed the one upstream by 15–30 minutes, in flow order — one cause moving downstream, not separate problems. System line pack drew down {q["lp_draft"]:.1f} MMscf.',
          'inferred': 'Receipt loss at the source: the plant confirmed a residue compressor trip.',
          'recommendation': 'Confirm Harlow\'s make-up plan with scheduling and log the receipt shortfall for the shipper.',
          'relatedOccurrences': [{'date': '2026-07-09', 'summary': 'Harlow plant power dip cut receipts for 25 minutes; Wren recycled, no downstream impact.'}],
          'whatChangedSummary': 'Plant residue compressor restarted at 09:30; receipts back at nomination by 09:50.',
          'whatChanged': [{'time': '08:42', 'source': 'Event', 'description': 'Harlow plant control room reports a residue compressor trip.', 'related': True},
                          {'time': '08:50', 'source': 'Operator Action', 'description': 'Wren throughput reduced to protect suction pressure; units drop into recycle.', 'related': True},
                          {'time': RCUT_BACK, 'source': 'Event', 'description': 'Plant residue compressor restarted.', 'related': True},
                          {'time': RCUT_DONE, 'source': 'Event', 'description': 'Receipts back at the 905 MMscf/d nomination.', 'related': True}],
          'confidence': 'Confirmed by the plant', 'confidenceLevel': 'high',
          'risk': 'Low now — the line absorbed it on line pack', 'riskLevel': 'low',
          'expectedOutcome': 'Receipts at nomination; line pack recovering'}),
    item('LSIT04', bex_a, 'reg_outlet_temp_f',
         [('10:10', 'Normal'), ('10:45', ''), ('11:20', 'Regulator starts hunting'), ('11:40', ''), ('12:00', 'Minimum'),
          (HEATER_RELIT, 'Heater relit'), ('12:45', 'Recovered')],
         'medium', 'watch', 'resolved', '12:45',
         'Bexley regulator icing up — the cause was the line heater upstream',
         'Regulator Run A\'s outlet gas cooled toward freezing and the regulator began to hunt. The regulator was fine: the line heater upstream had lost its flame at 10:15, so gas reached the regulators cold and the pressure cut chilled it further.',
         {'signal': f'Run A outlet gas fell from {q["rt0"]:.1f} °F to a low of {q["rt_min"]:.1f} °F around 12:00; Bexley outlet pressure swung about ±{q["cg_swing"]:.0f} psi from 11:20.',
          'observed': f'Heater burner firing 0% from 10:15; bath temperature fell from 178 °F to {q["bath_min"]:.0f} °F and heater outlet gas from {q["hout0"]:.0f} °F to {q["hout_min"]:.0f} °F. Run B cooled in step. Inlet pressure and flow normal. Sable Ridge gas was wetter than usual from 09:30 to 11:30, but the temperature follows the heater, not the moisture.',
          'derived': f'The cooling started at the heater more than an hour before the regulator symptom. The regulator outlet stayed about {q["jt_drop"]:.0f} °F below the heater outlet throughout — the Joule-Thomson drop expected for a {q["cut_psi"]:.0f} psi pressure cut.',
          'inferred': 'Line heater flame failure (pilot out); confirmed in the field.',
          'recommendation': 'Relight the heater and check the flame safeguard; clear any ice from the Run A pilot before relying on it.',
          'relatedOccurrences': [{'date': '2026-01-19', 'summary': 'Tolland line heater pilot failed in a cold snap; Run B regulator froze and the monitor took over.'}],
          'whatChangedSummary': 'Heater relit at 12:10 after the flame rod was cleaned; outlet gas back above 45 °F by 12:45.',
          'whatChanged': [{'time': HEATER_OUT, 'source': 'Alarm', 'description': 'Bexley line heater flame failure (low-priority alarm).', 'related': True},
                          {'time': '11:20', 'source': 'Alarm', 'description': 'Bexley outlet pressure deviation.', 'related': True},
                          {'time': '11:45', 'source': 'Field Check', 'description': 'Technician finds the heater off and frost on the Run A pilot.', 'related': True},
                          {'time': HEATER_RELIT, 'source': 'Maintenance', 'description': 'Flame rod cleaned; heater relit.', 'related': True}],
          'confidence': 'Confirmed in the field', 'confidenceLevel': 'high',
          'risk': 'Low now — caught before the regulator froze and the monitor took over', 'riskLevel': 'low',
          'expectedOutcome': 'Heater firing normally; outlet gas above 45 °F'}),
    item('LSIT05', cu3, 'recip_unit_flow_mmscfd',
         [('11:20', 'Normal'), (CU3_VALVE, 'Valve temps start rising'), ('11:40', ''), ('11:50', 'Vibration high-high'),
          (CU3_TRIP, 'Unit down'), (CU5_START, 'CU-5 starting'), (CU5_LOADED, 'CU-5 loaded')],
         'high', 'watch', 'resolved', CU5_LOADED,
         'Kettle Creek CU-3 shut down on high vibration — the station lost a quarter of its horsepower',
         'CU-3 tripped at 11:52 on frame vibration high-high. Its valve-cover temperatures had started climbing about 25 minutes earlier, the usual sign of a failing compressor valve. Station throughput fell until standby CU-5 was fully loaded at 12:35.',
         {'signal': f'CU-3 went from {q["cu3_q"]:.0f} MMscf/d to 0 at 11:52; station throughput fell from {q["k0"]:.0f} to {q["k_trip_min"]:.0f} MMscf/d.',
          'observed': f'Valve cover temperature deviation rose from {q["dev0"]:.1f} °F to {q["devpk"]:.1f} °F (11:25–11:50) and frame vibration from {q["vib0"]:.2f} to {q["vibpk"]:.2f} in/s. Suction pressure rose from {q["ks0"]:.0f} to {q["kspk"]:.0f} psig as Segment 2 packed; discharge fell from {q["kd0"]:.0f} to {q["kdmin"]:.0f} psig and Segment 3 line pack from {q["l3_0"]:.1f} to {q["l3_min"]:.1f} MMscf as it drew down. The three remaining units ran at about {q["kload"]:.0f}% load.',
          'derived': 'The valve temperature rose before the vibration did, and the engine side stayed normal — a mechanical failure inside a compressor cylinder, not an engine problem.',
          'inferred': 'Broken suction valve plate on cylinder 3; confirmed when the valve cap was pulled at 13:30.',
          'recommendation': 'Keep CU-3 locked out; replace the valve and check the cylinder and discharge bottle for fragments before restart.',
          'relatedOccurrences': [{'date': '2026-06-02', 'summary': 'CU-3 cylinder 2 discharge valve replaced after a valve temperature alarm (no trip).'}],
          'whatChangedSummary': 'CU-5 started at 12:15 and was fully loaded at 12:35; CU-3 remains down for valve replacement.',
          'whatChanged': [{'time': CU3_VALVE, 'source': 'Event', 'description': 'CU-3 cylinder 3 valve cover temperature starts rising.', 'related': True},
                          {'time': '11:52', 'source': 'Alarm', 'description': 'CU-3 shutdown — frame vibration high-high.', 'related': True},
                          {'time': CU5_START, 'source': 'Operator Action', 'description': 'Standby CU-5 started.', 'related': True},
                          {'time': CU5_LOADED, 'source': 'Event', 'description': 'CU-5 fully loaded; station throughput restored.', 'related': True},
                          {'time': '13:30', 'source': 'Maintenance', 'description': 'Valve cap pulled: suction valve plate broken.', 'related': True}],
          'confidence': 'Confirmed by inspection', 'confidenceLevel': 'high',
          'risk': 'Low now — CU-5 carries the load; no spare unit left at Kettle Creek', 'riskLevel': 'low',
          'expectedOutcome': 'CU-3 back after valve replacement'}),
    item('LSIT06', ASH, 'station_discharge_pressure_psig',
         [('13:10', 'Normal'), ('13:20', 'Manual setpoint move'), ('13:30', ''), ('13:40', 'Manual setpoint move'),
          ('13:50', ''), ('14:00', ''), ('14:05', 'Current')],
         'high', 'act', 'none', OSC_START,
         'Ashby discharge pressure swinging wider every cycle',
         'Since 13:15 Ashby\'s discharge pressure has oscillated on a roughly 20-minute cycle, and each swing is larger than the last. It started soon after Ashby was held to a lower discharge limit with both units running close to minimum flow; two manual setpoint changes appear to have added to it.',
         {'signal': f'Discharge swung between {q["osc_lo"]:.0f} and {q["osc_hi"]:.0f} psig in the last cycle; the swing was about ±{q["osc_a0"]:.0f} psi at 13:20.',
          'observed': f'Both units\' recycle valves are opening and closing in step (CU-1 up to {q["a_rec"]:.0f}%); station throughput is swinging about ±{q["a_qamp"]:.0f} MMscf/d. MLV 4-1, 20 miles downstream, sees about ±{q["mlv41_amp"]:.0f} psi.',
          'derived': 'The discharge-pressure controller and the two anti-surge controllers are all acting on the same flow. With the units near minimum flow, each recycle move shifts discharge pressure, which moves the discharge controller again. The manual moves at 13:20 and 13:40 landed out of phase with the swing.',
          'inferred': 'Hypothesis: a control-loop interaction between discharge-pressure control and anti-surge recycle, amplified by the manual moves. Not yet proven.',
          'recommendation': 'Stop manual setpoint moves. Put one unit on fixed base load and let the other trim, or return Ashby to suction control with the 965 psig discharge limit as an override.',
          'relatedOccurrences': [{'date': '2026-03-17', 'summary': 'Ashby discharge oscillated for 40 minutes at low flow after a unit swap; settled once one unit was base-loaded.'}],
          'whatChangedSummary': 'Discharge limit lowered to 965 psig at 12:50; units dropped below minimum flow at about 13:05; manual setpoint moves at 13:20 and 13:40.',
          'whatChanged': [{'time': ASHBY_SP_CHANGE, 'source': 'Setpoint Change', 'description': 'Ashby discharge limit lowered 985 → 965 psig (Segment 4 packing).', 'related': True},
                          {'time': '13:05', 'source': 'Event', 'description': 'Both units below minimum flow; anti-surge recycle valves start to open.', 'related': True},
                          {'time': OSC_MANUAL[0], 'source': 'Operator Action', 'description': 'Gas controller lowers the discharge setpoint 5 psi.', 'related': True},
                          {'time': OSC_MANUAL[1], 'source': 'Operator Action', 'description': 'Gas controller raises the discharge setpoint 5 psi.', 'related': True}],
          'confidence': 'Timing and control mode point to the loops; not yet proven', 'confidenceLevel': 'medium',
          'risk': 'High — a big swing can surge-trip a unit or push Segment 4 back toward MAOP', 'riskLevel': 'high',
          'expectedOutcome': 'Discharge steady within ±3 psi'}),
    item('LSIT07', SEG[4], 'line_pack_mmscf',
         [(MARLOW_CUT[0], 'Marlow restricted'), ('11:00', ''), ('11:30', ''), ('12:00', ''), ('12:30', ''),
          (ASHBY_SP_CHANGE, 'Ashby limit lowered'), ('14:05', 'Current')],
         'medium', 'watch', 'recovering', ASHBY_SP_CHANGE,
         'Segment 4 filling up — Marlow is taking less than we send',
         'Since 10:30 the Marlow interconnect has accepted well under its schedule, so gas built up in Segment 4 and Ashby\'s discharge crept toward its limit. Holding Ashby to a lower discharge limit at 12:50 stopped the build, and the segment is slowly unpacking.',
         {'signal': f'Segment 4 line pack rose from {q["l4_0"]:.1f} to {q["l4_pk"]:.1f} MMscf (peak at {q["l4_pk_t"]}); Marlow delivery pressure rose from {q["m_p0"]:.0f} to {q["m_ppk"]:.0f} psig; Ashby discharge reached {q["a_dpk"]:.0f} psig (limit 985, MAOP 1,000).',
          'observed': f'Marlow has taken about {q["mar_q"]:.0f} MMscf/d against a {MARLOW_SCHED} MMscf/d schedule since 11:00; Ashby throughput reduced from about {q["a_q0"]:.0f} to {q["a_qnow"]:.0f} MMscf/d. Segment 4 is now {q["l4_now"]:.1f} MMscf.',
          'derived': f'Segment 4 is unpacking at about {q["l4_rate"]:.1f} MMscf/h, but the gas has moved upstream rather than gone: Segment 3 gained {q["l3_rate"]:.1f} MMscf and the whole system {q["sys_rate"]:.1f} MMscf in the last hour, because receipts are unchanged.',
          'inferred': 'Downstream constraint: the Marlow-side pipeline posted a compressor outage at 10:40. The line will keep packing until receipts are cut to match.',
          'recommendation': 'Keep Ashby limited. Make sure scheduling cuts Harlow\'s confirmation to match Marlow\'s ID2 renomination (effective 16:00), and watch Kettle Creek discharge as Segment 3 packs.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Ashby discharge limit lowered at 12:50; Marlow\'s shipper renominated in the ID2 cycle (effective 16:00).',
          'whatChanged': [{'time': MARLOW_CUT[0], 'source': 'Event', 'description': 'Marlow interconnect flow drops; downstream operator posts a critical notice at 10:40.', 'related': True},
                          {'time': '12:30', 'source': 'Event', 'description': 'Marlow shipper renominates at the ID2 deadline (effective 16:00).', 'related': True},
                          {'time': ASHBY_SP_CHANGE, 'source': 'Setpoint Change', 'description': 'Ashby discharge limit lowered 985 → 965 psig.', 'related': True}],
          'confidence': 'Confirmed — cause is the downstream restriction', 'confidenceLevel': 'high',
          'risk': 'Medium — the line keeps packing until 16:00; margin to MAOP at Kettle Creek and Ashby is shrinking', 'riskLevel': 'medium',
          'expectedOutcome': 'Segment 4 back near 181 MMscf once the ID2 cuts take effect'}),
    item('LSIT08', SAB_QA, 'water_content_lb_mmscf',
         [(DEHY_START, 'Normal'), ('09:45', ''), ('10:15', ''), ('10:45', ''), (DEHY_FIX, 'Peak — producer fixes dehydrator'),
          ('11:30', ''), (DEHY_OK, 'Back to normal')],
         'medium', 'watch', 'resolved', DEHY_OK,
         'Sable Ridge gas getting wetter — heading for the 7 lb/MMscf tariff limit',
         'Water content at the Sable Ridge receipt doubled over two hours while flow stayed on nomination, and the filter/separator started collecting liquid at the same time. That pattern points to the producer\'s glycol dehydrator.',
         {'signal': f'Water content rose from {q["w0"]:.1f} to {q["wpk"]:.1f} lb/MMscf (tariff limit 7.0) between 09:00 and 11:05.',
          'observed': f'Filter/separator liquid level climbed to {q["sep_pk"]:.0f}%, with more frequent dumps; H₂S and hydrocarbon dew point unchanged; receipts steady at about {q["sab_q"]:.0f} MMscf/d.',
          'derived': 'At its 10:00–11:00 rate the water content would have crossed 7.0 lb/MMscf around 11:30. Liquid in the separator plus rising water is the signature of glycol carry-over from a dehydrator losing circulation.',
          'inferred': 'Glycol circulation pump failure at the producer\'s contactor; confirmed by the producer.',
          'recommendation': 'Tell the producer the receipt will be refused as non-conforming at 7.0 lb/MMscf; send the separator liquid sample to the lab.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Producer restored glycol circulation at 11:05; water back under 3.5 lb/MMscf by 12:00.',
          'whatChanged': [{'time': '10:00', 'source': 'Alarm', 'description': 'Sable Ridge moisture warning (5 lb/MMscf).', 'related': True},
                          {'time': '10:20', 'source': 'Operator Action', 'description': 'Gas controller calls the producer; shut-in warned at 7.0 lb/MMscf.', 'related': True},
                          {'time': DEHY_FIX, 'source': 'Maintenance', 'description': 'Producer restores the glycol circulation pump.', 'related': True},
                          {'time': '11:25', 'source': 'Event', 'description': 'Separator dumps accumulated liquid (sample: glycol and water).', 'related': True}],
          'confidence': 'Confirmed by the producer', 'confidenceLevel': 'high',
          'risk': 'Low — caught before the tariff limit; no wet gas reached a city gate', 'riskLevel': 'low',
          'expectedOutcome': 'Gas back in spec; lab result on the liquid sample'}),
    item('LSIT09', WREN, 'station_fuel_mmscfd',
         [('11:25', 'Baseline'), ('11:55', ''), ('12:25', ''), ('12:55', ''), ('13:25', ''), ('13:45', ''), ('14:05', 'Current')],
         'medium', 'investigate', 'none', RECYCLE_START,
         'Wren moving the same gas but burning more fuel to do it',
         'Wren\'s throughput has been flat at about 905 MMscf/d since 11:30, yet its fuel keeps rising. Some of that is the higher discharge pressure as the line packs, but CU-1 is now compressing noticeably more gas than CU-2 even though they share load equally — gas is going round CU-1 without leaving the station.',
         {'signal': f'Station fuel {q["wf_now"]:.2f} MMscf/d at 14:05, up {100 * (q["wf_now"] / q["wf0"] - 1):.0f}% from {q["wf0"]:.2f} at 11:25, at a steady throughput of {q["wq"]:.0f} MMscf/d.',
          'observed': f'CU-1 compressor flow {q["c1"]:.0f} vs CU-2 {q["c2"]:.0f} MMscf/d; CU-1 power {q["p1"]:,.0f} hp vs {q["p2"]:,.0f}; both recycle valve commands at 0%. Compression ratio up from {q["r0"]:.3f} to {q["r_now"]:.3f}.',
          'derived': f'If CU-1 burned what CU-2 burns, station fuel would be about {q["f2"] * 2:.2f} MMscf/d — the ratio change explains that part. The other {q["f1"] - q["f2"]:.2f} MMscf/d matches about {q["c1"] - q["c2"]:.0f} MMscf/d circulating through CU-1, which the station throughput meter cannot see.',
          'inferred': 'Possible passing anti-surge recycle valve on CU-1 (seat damage or an actuator not fully closing), or a bias in CU-1\'s flow measurement. Not yet confirmed.',
          'recommendation': 'Check CU-1\'s recycle line temperature downstream of the valve and do an acoustic check; stroke-test the valve. If confirmed, shift load to CU-2 and CU-3 and plan the repair.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'No maintenance or control change at Wren since the morning receipt cut.',
          'whatChanged': [{'time': RECYCLE_START, 'source': 'Event', 'description': 'CU-1 flow starts to diverge from CU-2 at equal load sharing.', 'related': True},
                          {'time': '10:40', 'source': 'Event', 'description': 'Line starts packing after the Marlow restriction (raises Wren discharge pressure).', 'related': False}],
          'confidence': 'The loss is real; where it goes is not yet confirmed', 'confidenceLevel': 'medium',
          'risk': 'Medium — fuel lost every hour, and a passing valve erodes its seat further', 'riskLevel': 'medium',
          'expectedOutcome': 'Recycle valve checked; CU-1 fuel back in line with CU-2'}),
    item('LSIT10', cu2e, 'knock_events_1h',
         [('11:35', 'Baseline'), ('11:40', '1st event'), ('12:25', ''), ('12:55', ''), ('13:30', ''), ('13:45', ''), ('14:05', 'Latest')],
         'medium', 'investigate', 'none', KNOCK_TIMES[0],
         'Kettle Creek CU-2 engine detonating more and more often',
         'CU-2\'s knock detection has retarded timing and shed load eight times since 11:40, and the events are getting closer together as the afternoon heats up and the station runs harder. Each clears within a few minutes, but the rate is well above this engine\'s normal of none or one an hour.',
         {'signal': f'{q["knocks"]} detonation events since 11:40; {q["knock_now"]:.0f} in the last hour. CU-4 had one at 12:40; CU-1 and CU-5 none.',
          'observed': f'CU-2 power dips about 9% at each event; jacket water and exhaust temperatures normal; ambient up from {q["amb0"]:.0f} °F to {q["amb_now"]:.0f} °F; the three remaining units ran at about {q["kload"]:.0f}% load after CU-3 tripped.',
          'derived': 'Events line up with high load and rising intake-air temperature, not with fuel quality (Harlow heating value and Sable Ridge composition steady).',
          'inferred': 'Possible causes: warm charge air (engine aftercooler), ignition wear on some cylinders, or air/fuel ratio drift. Per-cylinder knock data is needed to narrow it down.',
          'recommendation': 'Pull CU-2\'s per-cylinder knock log; check its engine aftercooler water temperature; trim CU-2 load now that CU-5 is carrying load.',
          'relatedOccurrences': [{'date': '2026-08-11', 'summary': 'CU-2 knock events on a 96 °F afternoon; cleared overnight, no action taken.'}],
          'whatChangedSummary': 'CU-3 trip at 11:52 put the remaining units at high load; CU-5 on line at 12:35.',
          'whatChanged': [{'time': '11:52', 'source': 'Event', 'description': 'CU-3 trip — remaining units loaded harder.', 'related': True},
                          {'time': CU5_LOADED, 'source': 'Event', 'description': 'CU-5 fully loaded.', 'related': True}],
          'confidence': 'Pattern is clear; cause not yet diagnosed', 'confidenceLevel': 'medium',
          'risk': 'Medium — sustained detonation damages pistons and heads; a severe event shuts the engine down', 'riskLevel': 'medium',
          'expectedOutcome': 'Events back to 0–1 an hour after a load trim or repair'}),
    item('LSIT11', HAL, 'gas_day_imbalance_mmscf',
         [(GAS_DAY_START, 'Gas day starts'), ('10:00', ''), ('11:00', ''), ('12:00', ''), ('13:00', ''), (IMB_FOUND, 'Flagged by scheduling'),
          ('14:05', 'Current')],
         'medium', 'act', 'none', IMB_FOUND,
         'Halcyon Point over-taking — imbalance will pass the OFO tolerance before a renomination can help',
         f'The plant has taken about {q["hal_q"] - 95:.0f} MMscf/d above its 95 MMscf/d schedule since its load ramp at 10:00. Under today\'s OFO the tolerance is ±{OFO_TOLERANCE} MMscf. At the current rate that is reached around {q["imb_cross"]}, but the next renomination (ID3, 17:00 deadline) does not take effect until 20:00.',
         {'signal': f'Gas-day imbalance {q["imb_now"]:+.2f} MMscf at 14:05 (tolerance ±{OFO_TOLERANCE}), growing about {q["imb_rate"]:.2f} MMscf/h.',
          'observed': f'Delivery averaging {q["hal_q"]:.1f} MMscf/d since 10:30 against a 95 MMscf/d schedule; the ID2 deadline (12:30) passed with no Halcyon renomination.',
          'derived': f'Time left to the tolerance: about {int(q["imb_cross_min"] - NOW_MIN)} minutes. Time needed to fix it by renomination: until 20:00. The nomination route alone cannot close the gap.',
          'inferred': 'The shipper\'s nomination was not updated when the plant\'s dispatch was raised for the afternoon peak.',
          'recommendation': 'Call the shipper and the plant now: either arrange an imbalance trade or park-and-loan to cover it, or hold the take at 95 MMscf/d until 20:00. Log the call; OFO penalties apply past the tolerance.',
          'relatedOccurrences': [{'date': '2026-07-30', 'summary': 'Halcyon Point over-take on a peak afternoon; covered by an imbalance trade.'}],
          'whatChangedSummary': 'Plant take rose above schedule with its 10:00 load ramp; ID2 deadline passed without a renomination.',
          'whatChanged': [{'time': '07:00', 'source': 'Event', 'description': 'OFO in effect today (hot-weather power burn; ±2% daily tolerance).', 'related': True},
                          {'time': '10:00', 'source': 'Event', 'description': 'Halcyon take rises above schedule with the plant\'s load ramp.', 'related': True},
                          {'time': '12:30', 'source': 'Event', 'description': 'ID2 nomination deadline passes — no Halcyon renomination.', 'related': True},
                          {'time': IMB_FOUND, 'source': 'Scheduling', 'description': 'Gas scheduler flags the imbalance trend.', 'related': True}],
          'confidence': 'n/a — a commercial deadline, not a diagnosis', 'confidenceLevel': 'n/a',
          'risk': 'Medium — OFO penalties and a tighter line if other shippers follow', 'riskLevel': 'medium',
          'expectedOutcome': 'Imbalance held inside tolerance; ID3 renomination confirmed'}),
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
    work('wk-l01', 'Shift turnover and gas control briefing', 'Review the night log, today\'s OFO, confirmed nominations and the ID1/ID2 cycle deadlines.', None,
         'HUDDLE', 'routine', 'planned', None, 'operator', 'Gas Controller', '07:45', '08:00', 15, True, '08:02', '07:30'),
    work('wk-l02', 'Aerial patrol: Segments 1 and 2', 'Right-of-way patrol for encroachment, excavation and signs of leakage.', SEG[1],
         'PATROL', 'routine', 'planned', None, 'operator', 'Aerial Patrol', '08:30', '12:00', 180, True, '11:50', '07:30'),
    work('wk-l03', 'Rectifier readings: Segment 3', 'Bi-monthly rectifier inspection (output voltage and current) and pipe-to-soil reads at the MLV test stations.', SEG[3],
         'INSPECTION', 'routine', 'planned', None, 'operator', 'Corrosion Technician', '09:00', '12:00', 150, True, '11:40', '07:30'),
    work('wk-l04', 'Annual inspection and partial stroke: MLV 3-2', 'Inspect and partially operate the valve; check actuator power gas and remote control.', MLV[3][1],
         'INSPECTION', 'routine', 'planned', None, 'operator', 'Pipeline Technician', '10:00', '11:30', 90, True, '11:10', '07:30'),
    work('wk-l05', 'Odorant sniff test: Tolland City Gate', 'Odor-intensity check at the outlet and tank level reading.', TOL_ODOR,
         'QUALITY_CHECK', 'routine', 'planned', None, 'operator', 'Measurement Technician', '12:30', '13:30', 30, True, '13:05', '07:30'),
    work('wk-l06', 'Monthly meter diagnostics review: Harlow Run B', 'Review speed-of-sound spread, gain and profile factors against the baseline.', HAR_RUNS[1],
         'INSTRUMENT_CHECK', 'routine', 'planned', None, 'operator', 'Measurement Technician', '13:00', '15:00', 45, True, '13:50', '07:30'),
    work('wk-l07', 'Confirm Harlow restart and receipt plan', 'Call the Harlow plant; confirm restart time and whether the day\'s nomination will be met.', HAR,
         'COORDINATION', 'urgent', 'situation', f'From: {sig["LSIT03"]}', 'ai', 'Gas Scheduler', '08:45', '09:15', 15, True, '09:05', '08:44'),
    work('wk-l08', 'Check MLV 1-2 site and pressure transmitter', 'Drive to MP 42; confirm no release; test and replace the transmitter.', mlv12,
         'INSTRUMENT_CHECK', 'urgent', 'situation', f'From: {sig["LSIT02"]}', 'ai', 'Pipeline Technician', '10:33', '11:00', 25, True, '11:00', '10:32'),
    work('wk-l09', 'Call Sable Ridge producer about wet gas', 'Warn the producer that the receipt will be refused at 7.0 lb/MMscf; ask for the dehydrator status.', SAB_QA,
         'COORDINATION', 'important', 'situation', f'From: {sig["LSIT08"]}', 'ai', 'Gas Controller', '10:15', '10:30', 10, True, '10:20', '10:05'),
    work('wk-l10', 'Relight Bexley line heater', 'Check the flame safeguard, clean the flame rod, relight; clear ice from the Run A pilot.', BEX_HTR,
         'MAINTENANCE', 'urgent', 'situation', f'From: {sig["LSIT04"]}', 'ai', 'Measurement Technician', '11:25', '12:15', 30, True, HEATER_RELIT, '11:22'),
    work('wk-l11', 'Pull CU-3 cylinder valves for inspection', 'Lock out CU-3; replace the broken suction valve; check the cylinder and discharge bottle for fragments.', cu3,
         'MAINTENANCE', 'important', 'situation', f'From: {sig["LSIT05"]}', 'ai', 'Compressor Mechanic', '13:00', '17:00', 240, False, None, '12:40'),
    work('wk-l12', 'Stabilize Ashby discharge control', 'Stop manual moves; base-load one unit and let the other trim, or return to suction control with the discharge override.', ASH,
         'PROCEDURE', 'urgent', 'situation', f'From: {sig["LSIT06"]}', 'ai', 'Gas Controller', '14:05', '14:20', 15, False, None, '13:55'),
    work('wk-l13', 'Call Halcyon Point shipper about the imbalance', 'Arrange an imbalance trade or park-and-loan, or agree to hold the take at schedule until 20:00.', HAL,
         'COORDINATION', 'urgent', 'situation', f'From: {sig["LSIT11"]}', 'ai', 'Gas Scheduler', '14:05', '14:30', 20, False, None, '13:47'),
    work('wk-l14', 'Check Wren CU-2 seal vent; prepare CU-3', 'Check secondary vent and separation gas; purge and pre-lube CU-3 for a swap.', dgs2,
         'INSPECTION', 'important', 'situation', f'From: {sig["LSIT01"]}', 'ai', 'Station Technician', None, '15:30', 60, False, None, '12:20'),
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
