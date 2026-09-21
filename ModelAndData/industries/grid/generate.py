#!/usr/bin/env python3
"""Generate the `grid` industry pack — Vesper Grid, an electric transmission
and sub-transmission network (INDUSTRY_PACK_SPEC.md v2, generic format).

    python3 ModelAndData/industries/grid/generate.py [--repo PATH]

Deterministic: one fixed seed, no wall-clock, no network. Rerunning it
reproduces every byte of public/data/grid/*.json.

Layout of this file
    §1  timeline, drivers and small helpers
    §2  property metadata (the `properties.json` payload)
    §3  the network: districts, substations, circuits  -> assets.json
    §4  relationship edges                             -> asset-relationships.json
    §5  baseline telemetry                             -> asset-telemetry.json
    §6  SCENARIOS — every constant of every story lives here
    §7  scenario injection into the series
    §8  rollups, unit status, attention items, work items
    §9  write

Read RESEARCH.md for where the numbers come from and SCENARIOS.md for what
each story is. The scenario constants in §6 are the single source both this
generator and SCENARIOS.md quote, so the data and the story cannot drift.
"""

import argparse, json, math, os, random

# ─────────────────────────────────────────────────────────────────────────────
# §1  Timeline, drivers, helpers
# ─────────────────────────────────────────────────────────────────────────────

SEED = 20260828
TIMELINE = {'date': '2026-08-28', 'start': '08:00', 'end': '14:05', 'stepMinutes': 5}
SEP = ' · '


def build_grid():
    h0, m0 = (int(x) for x in TIMELINE['start'].split(':'))
    h1, m1 = (int(x) for x in TIMELINE['end'].split(':'))
    step = TIMELINE['stepMinutes']
    out = []
    for t in range(h0 * 60 + m0, h1 * 60 + m1 + 1, step):
        out.append(f'{t // 60:02d}:{t % 60:02d}')
    return out


TS = build_grid()
N = len(TS)                                   # 74 points
NOW_MIN = int(TS[-1][:2]) * 60 + int(TS[-1][3:])
IDX = {t: i for i, t in enumerate(TS)}


def at(t):
    """Index of a clock time on the grid."""
    return IDX[t]


def since_minutes(t):
    return NOW_MIN - (int(t[:2]) * 60 + int(t[3:]))


def since_text(t, resolved=False):
    m = since_minutes(t)
    body = f'{m // 60}h {m % 60}m ago' if m >= 60 else f'{m}m ago'
    return ('Resolved ' if resolved else '') + body


def ramp(i, i0, i1, v0, v1, ease=True):
    """Value at index i on a ramp from v0 at i0 to v1 at i1."""
    if i <= i0:
        return v0
    if i >= i1:
        return v1
    f = (i - i0) / (i1 - i0)
    if ease:
        f = f * f * (3 - 2 * f)               # smoothstep
    return v0 + (v1 - v0) * f


def ar1(rng, n, mean, cv, rho=0.88):
    """Slowly drifting AR(1) series around `mean` (spec §5.1)."""
    sd = abs(mean) * cv if mean else cv
    x, out = 0.0, []
    for _ in range(n):
        x = rho * x + rng.gauss(0, sd * math.sqrt(1 - rho * rho))
        out.append(mean + x)
    return out


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


# System load: a hot late-August day rising toward a 17:00–18:00 peak, so the
# 08:00–14:05 window sits on the ramp with the peak still ahead (RESEARCH §1).
LOAD_F = [0.0] * N
AMBIENT = [0.0] * N
_r = random.Random(SEED)
for i in range(N):
    f = i / (N - 1)
    LOAD_F[i] = 0.617 + 0.268 * (f ** 0.92) + _r.gauss(0, 0.0035)
    AMBIENT[i] = 24.4 + 9.3 * (f ** 0.85) + _r.gauss(0, 0.09)
LOAD_F = [round(v, 5) for v in LOAD_F]


# ─────────────────────────────────────────────────────────────────────────────
# §2  Property metadata
# ─────────────────────────────────────────────────────────────────────────────
# label, unit, category, tier, range, decimals, static
P = {}


def prop(key, label, unit, category, tier, rng, decimals=1, static=False):
    P[key] = {'label': label, 'unit': unit, 'category': category, 'tier': tier,
              'range': list(rng), 'decimals': decimals}
    if static:
        P[key]['static'] = True


FLOW, EVT, STAB, QUAL, DERIV, COND = ('Flow / WIP', 'Events / Losses', 'Stability',
                                      'Quality', 'Derived Metric', 'Condition')

# -- line bays, split by voltage class (RESEARCH §3.2) -----------------------
prop('ehv_mw_flow_mw', 'Real Power Flow', 'MW', FLOW, 'P1', (-200, 900), 1)
prop('ehv_mvar_flow_mvar', 'Reactive Power Flow', 'MVAr', FLOW, 'P2', (-200, 300), 1)
prop('ehv_current_a', 'Line Current', 'A', FLOW, 'P2', (0, 1600), 0)
prop('mw_flow_mw', 'Real Power Flow', 'MW', FLOW, 'P1', (-80, 260), 1)
prop('mvar_flow_mvar', 'Reactive Power Flow', 'MVAr', FLOW, 'P2', (-60, 120), 1)
prop('line_current_a', 'Line Current', 'A', FLOW, 'P2', (0, 1100), 0)
prop('sub_mw_flow_mw', 'Real Power Flow', 'MW', FLOW, 'P1', (-30, 75), 1)
prop('sub_mvar_flow_mvar', 'Reactive Power Flow', 'MVAr', FLOW, 'P2', (-20, 35), 1)
prop('sub_current_a', 'Line Current', 'A', FLOW, 'P2', (0, 600), 0)
prop('loading_pct', 'Loading vs Normal Rating', '%', DERIV, 'P1', (0, 150), 1)
prop('post_ctg_loading_pct', 'Worst N-1 Post-Contingency Loading', '%', DERIV, 'P1', (0, 150), 1)
prop('normal_rating_mva', 'Normal Rating', 'MVA', DERIV, 'P3', (0, 1000), 0, static=True)
prop('emergency_rating_mva', 'Emergency Rating', 'MVA', DERIV, 'P3', (0, 1000), 0, static=True)

# -- buses -------------------------------------------------------------------
prop('bus_voltage_pu', 'Bus Voltage', 'pu', STAB, 'P1', (0.90, 1.10), 3)
prop('bus_voltage_thd_pct', 'Voltage Distortion', '%', QUAL, 'P2', (0, 5), 2)
prop('neg_seq_voltage_pct', 'Negative Sequence Voltage', '%', QUAL, 'P3', (0, 5), 2)
prop('nominal_kv', 'Nominal Voltage', 'kV', DERIV, 'P3', (0, 400), 0, static=True)

# -- reactive plant, station service, load -----------------------------------
prop('bay_reactive_mvar', 'Reactive Output', 'MVAr', FLOW, 'P2', (-70, 60), 1)
prop('reactive_available_mvar', 'Switchable Reactive Available', 'MVAr', FLOW, 'P2', (0, 70), 1)
prop('station_service_load_kva', 'Station Service Load', 'kVA', FLOW, 'P3', (0, 500), 0)
prop('served_load_mw', 'Served Load', 'MW', FLOW, 'P1', (0, 260), 1)
prop('served_load_mvar_mvar', 'Served Reactive Load', 'MVAr', FLOW, 'P3', (-10, 25), 1)
prop('load_power_factor_pu', 'Load Power Factor', 'pu', QUAL, 'P2', (0.85, 1.00), 3)

# -- breakers ----------------------------------------------------------------
prop('sf6_pressure_kpa', 'SF6 Pressure', 'kPa', COND, 'P2', (400, 800), 1)
prop('breaker_ops_total', 'Operations Counter', '', EVT, 'P3', (0, 5000), 0)
prop('accum_interrupt_i2t_ka2s', 'Accumulated Interrupted Energy', 'kA²s', EVT, 'P3', (0, 120), 2)
prop('contact_wear_pct', 'Contact Wear', '%', COND, 'P2', (0, 100), 1)
prop('reclose_ops_count', 'Reclose Operations', '', EVT, 'P2', (0, 60), 0)

# -- transformers ------------------------------------------------------------
prop('auto_load_mva', 'Autotransformer Load', 'MVA', FLOW, 'P1', (0, 400), 1)
prop('xfmr_load_mva', 'Transformer Load', 'MVA', FLOW, 'P1', (0, 200), 1)
prop('xfmr_loading_pct', 'Loading vs Nameplate', '%', DERIV, 'P1', (0, 150), 1)
prop('top_oil_temp_c', 'Top Oil Temperature', '°C', COND, 'P2', (0, 120), 1)
prop('winding_hotspot_temp_c', 'Winding Hot-Spot Temperature', '°C', COND, 'P1', (0, 150), 1)
prop('rated_mva', 'Nameplate Rating', 'MVA', DERIV, 'P3', (0, 500), 0, static=True)

# -- instrument transformers and protection ----------------------------------
prop('cvt_secondary_v', 'CVT Secondary Voltage', 'V', STAB, 'P2', (55, 80), 2)
prop('v_redundant_dev_pct', 'Redundant Measurement Deviation', '%', QUAL, 'P2', (0, 10), 2)
prop('cvt_pf_pct', 'CVT Power Factor', '%', COND, 'P3', (0, 1.5), 3)
prop('cvt_cap_dev_pct', 'CVT Capacitance Deviation', '%', COND, 'P3', (0, 5), 2)
prop('goose_msg_age_ms', 'GOOSE Message Age', 'ms', COND, 'P3', (0, 12), 1)
prop('line_diff_latency_ms', 'Line Differential Channel Latency', 'ms', COND, 'P2', (0, 15), 1)
prop('diff_current_pu', 'Differential Current', 'pu', QUAL, 'P2', (0, 0.2), 3)
prop('relay_selftest_faults_n', 'Relay Self-Test Faults', '', EVT, 'P3', (0, 5), 0)

# -- reactive devices, station service, battery ------------------------------
prop('cap_bank_mvar', 'Capacitor Bank Output', 'MVAr', FLOW, 'P2', (0, 60), 1)
prop('cap_neutral_unbal_a', 'Neutral Unbalance Current', 'A', COND, 'P2', (0, 3), 3)
prop('cap_switch_ops_n', 'Bank Switching Operations', '', EVT, 'P3', (0, 1500), 0)
prop('reactor_mvar', 'Shunt Reactor Absorption', 'MVAr', FLOW, 'P2', (0, 70), 1)
prop('reactor_top_oil_temp_c', 'Reactor Top Oil Temperature', '°C', COND, 'P3', (0, 120), 1)
prop('battery_float_voltage_v', 'Battery Float Voltage', 'V', STAB, 'P2', (110, 145), 1)
prop('battery_cell_dev_v', 'Weakest Cell Deviation', 'V', COND, 'P3', (-0.15, 0.15), 3)
prop('charger_output_current_a', 'Charger Output Current', 'A', FLOW, 'P3', (0, 25), 1)
prop('charger_ac_ripple_pct', 'Charger AC Ripple', '%', COND, 'P3', (0, 3), 2)
prop('sst_secondary_v', 'Station Service Secondary Voltage', 'V', STAB, 'P3', (400, 520), 1)

# -- transformer components --------------------------------------------------
prop('tap_position', 'Tap Position', 'step', STAB, 'P2', (-16, 16), 0)
prop('oltc_ops_per_day', 'Tap Operations per Day', 'ops/day', STAB, 'P1', (0, 80), 1)
prop('oltc_ops_total', 'Tap Operations Counter', '', EVT, 'P3', (0, 100000), 0)
prop('ltc_tank_diff_temp_c', 'LTC to Main Tank Differential', '°C', COND, 'P3', (-20, 20), 2)
prop('bushing_c1_pf_pct', 'Bushing C1 Power Factor', '%', COND, 'P1', (0, 1.5), 3)
prop('bushing_cap_dev_pct', 'Bushing Capacitance Deviation', '%', COND, 'P2', (0, 10), 2)
prop('bushing_leakage_current_ma', 'Bushing Leakage Current', 'mA', COND, 'P2', (0, 80), 1)
prop('cooling_fans_running_n', 'Cooling Fans Running', '', COND, 'P2', (0, 12), 0)
prop('oil_pump_flow_pct', 'Oil Pump Flow', '%', COND, 'P3', (0, 120), 1)
prop('radiator_dt_c', 'Radiator Temperature Drop', '°C', COND, 'P3', (0, 40), 1)
prop('dga_h2_ppm', 'Dissolved Hydrogen', 'ppm', COND, 'P2', (0, 150), 1)
prop('dga_c2h4_ppm', 'Dissolved Ethylene', 'ppm', COND, 'P2', (0, 60), 1)
prop('dga_c2h2_ppm', 'Dissolved Acetylene', 'ppm', COND, 'P1', (0, 10), 2)
prop('dga_tdcg_ppm', 'Total Dissolved Combustible Gas', 'ppm', COND, 'P2', (0, 720), 1)
prop('dga_tdcg_rate_ppm_day', 'TDCG Rate of Change', 'ppm/day', COND, 'P1', (0, 40), 2)
prop('moisture_rel_sat_pct', 'Oil Moisture Relative Saturation', '%', COND, 'P3', (0, 40), 2)
prop('trip_coil_peak_a', 'Trip Coil Peak Current', 'A', COND, 'P3', (0, 15), 2)
prop('trip_coil_pickup_ms', 'Trip Coil Pickup Time', 'ms', COND, 'P2', (0, 30), 2)
prop('spring_charge_time_s', 'Spring Charge Time', 's', COND, 'P2', (0, 8), 2)
prop('charging_motor_current_a', 'Charging Motor Current', 'A', COND, 'P3', (0, 12), 2)
prop('close_time_ms', 'Close Time', 'ms', COND, 'P3', (0, 140), 1)

# -- container KPIs ----------------------------------------------------------
prop('worst_post_ctg_loading_pct', 'Worst N-1 Post-Contingency Loading', '%', DERIV, 'P1', (0, 150), 1)
prop('n1_violations_n', 'N-1 Violations', '', EVT, 'P1', (0, 10), 0)
prop('mvar_reserve_mvar', 'Reactive Reserve', 'MVAr', FLOW, 'P1', (0, 200), 1)
prop('system_frequency_hz', 'System Frequency', 'Hz', STAB, 'P1', (59.90, 60.10), 3)
prop('ambient_temp_c', 'Ambient Temperature', '°C', COND, 'P2', (-10, 45), 1)

TYPE_LABELS = {
    'transmission_network': 'Transmission Network',
    'bulk_district': 'Bulk District (345 kV)',
    'subtransmission_district': 'Sub-Transmission District (138 kV)',
    'supply_district': 'Supply District (69 kV)',
    'bulk_substation': 'Bulk Substation (345/138 kV)',
    'subtransmission_substation': 'Sub-Transmission Substation (138/69 kV)',
    'supply_substation': 'Supply Substation (69 kV)',
    'ehv_line_bay': 'EHV Line Bay (345 kV)',
    'hv_line_bay': 'HV Line Bay (138 kV)',
    'sub_line_bay': 'Sub-Transmission Line Bay (69 kV)',
    'gen_tie_bay': 'Generation Tie Bay',
    'autotransformer_bay': 'Autotransformer Bay',
    'transformer_bay': 'Transformer Bay',
    'capacitor_bay': 'Capacitor Bank Bay',
    'reactor_bay': 'Shunt Reactor Bay',
    'station_service_bay': 'Station Service Bay',
    'load_bay': 'Load Bay',
    'bus_section': 'Bus Section',
    'sf6_breaker': 'SF6 Circuit Breaker',
    'monitored_breaker': 'SF6 Circuit Breaker (Monitored)',
    'autotransformer': 'Autotransformer',
    'power_transformer': 'Power Transformer',
    'cvt': 'CVT',
    'protection_ied': 'Protection IED',
    'shunt_cap_bank': 'Shunt Capacitor Bank',
    'shunt_reactor': 'Shunt Reactor',
    'station_battery': 'Station Battery',
    'station_service_xfmr': 'Station Service Transformer',
    'oltc': 'On-Load Tap Changer',
    'bushing_set': 'Bushing Set',
    'cooling_group': 'Cooling Group',
    'dga_monitor': 'DGA Monitor',
    'trip_coil': 'Trip Coil',
    'breaker_mechanism': 'Breaker Mechanism',
}

DERIVATIONS = [
    {'assetType': t, 'property': 'worst_post_ctg_loading_pct', 'fn': 'max',
     'of': 'post_ctg_loading_pct',
     'fromType': 'ehv_line_bay|hv_line_bay|sub_line_bay|gen_tie_bay|autotransformer_bay|transformer_bay',
     'scope': 'descendants'}
    for t in ['bulk_substation', 'subtransmission_substation', 'supply_substation',
              'bulk_district', 'subtransmission_district', 'supply_district',
              'transmission_network']
] + [
    {'assetType': t, 'property': 'served_load_mw', 'fn': 'sum', 'of': 'served_load_mw',
     'fromType': 'load_bay', 'scope': 'descendants'}
    for t in ['supply_substation', 'supply_district', 'transmission_network']
] + [
    {'assetType': 'transmission_network', 'property': 'n1_violations_n', 'fn': 'formula',
     'note': 'Count of elements whose worst post-contingency loading exceeds 100% of '
             'emergency rating. A count of a condition, not an aggregate of a series, so '
             'it is computed in generate.py (§8) rather than by the derivation engine.'},
]


# ─────────────────────────────────────────────────────────────────────────────
# §3  The network
# ─────────────────────────────────────────────────────────────────────────────

ASSETS, BY_ID, KIDS = [], {}, {}


def add(aid, parent, name, atype, level):
    a = {'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level}
    ASSETS.append(a)
    BY_ID[aid] = a
    KIDS.setdefault(parent, []).append(aid)
    return aid


# id, name, district, type, nameplate transformers, extras
SUBSTATIONS = [
    # (id, name, district, kind, transformer tags, extras)
    ('ALDERGATE', 'Aldergate', 'KELDON', 'bulk', ['T1', 'T2'], {'gen_tie': 'Halcyon Point Tie'}),
    ('WYNDHAM', 'Wyndham', 'KELDON', 'bulk', ['T1'], {'cap': 50.0}),
    ('KESSLER', 'Kessler', 'KELDON', 'bulk', ['T1', 'T2'], {}),
    ('THORNE', 'Thorne', 'KELDON', 'bulk', ['T1'], {'gen_tie': 'Boreas Ridge Tie', 'reactor': 50.0}),
    ('BEXHILL', 'Bexhill', 'HARROW', 'sub', ['T1'], {}),
    ('ORRIN', 'Orrin', 'HARROW', 'sub', ['T1'], {}),
    ('LARKSPUR', 'Larkspur', 'HARROW', 'sub', ['T1'], {}),
    ('WEXFORD', 'Wexford', 'HARROW', 'sub', ['T1'], {}),
    ('COLVIN', 'Colvin', 'HARROW', 'sub', ['T1'], {}),
    ('PELL', 'Pell', 'SANBOURNE', 'supply', [], {'loads': [('Pell 12 kV Load A', 21.0), ('Pell 12 kV Load B', 15.5)]}),
    ('NAVARRE', 'Navarre', 'SANBOURNE', 'supply', [], {'loads': [('Navarre 12 kV Load', 24.0)]}),
    ('DUNMORE', 'Dunmore', 'SANBOURNE', 'supply', [], {'loads': [('Dunmore 12 kV Load A', 18.5), ('Dunmore 12 kV Load B', 12.0)]}),
    ('TILBURY', 'Tilbury', 'SANBOURNE', 'supply', [], {'loads': [('Tilbury 12 kV Load', 26.5)]}),
]

# A transforming station's banks carry what it delivers to the voltage level
# below it, so both the load and the nameplate come from the circuits leaving
# it — sized up the standard ladder to land near 58 % at the start of the
# window, which puts them in the 75–85 % range at the afternoon peak.
LADDER = [25, 50, 75, 100, 150, 200, 250, 300, 400]
LOW_KV = {'bulk': 138, 'sub': 69}


def station_throughput(sid, kind):
    return sum(abs(c[4]) for c in CIRCUITS
               if c[1] == sid and c[3] == LOW_KV[kind])


def rate_bank(thru_mva, n_banks):
    per = thru_mva / n_banks
    for r in LADDER:
        if per / r <= 0.58:
            return r
    return LADDER[-1]
DISTRICTS = [
    ('KELDON', 'Keldon District', 'bulk_district'),
    ('HARROW', 'Harrow District', 'subtransmission_district'),
    ('SANBOURNE', 'Sanbourne District', 'supply_district'),
]

# (key, station A, station B, kV, base MW at A, normal MVA, emergency MVA, note)
CIRCUITS = [
    ('ALD_WYN', 'ALDERGATE', 'WYNDHAM', 345, 372.0, 780, 900, None),
    ('WYN_KES', 'WYNDHAM', 'KESSLER', 345, 288.0, 780, 900, None),
    ('KES_THO', 'KESSLER', 'THORNE', 345, -188.0, 780, 900, None),
    ('THO_ALD', 'THORNE', 'ALDERGATE', 345, -302.0, 780, 900, None),
    ('ALD_KES', 'ALDERGATE', 'KESSLER', 345, 296.0, 780, 900, None),
    ('ALD_BEX', 'ALDERGATE', 'BEXHILL', 138, 96.0, 215, 248, None),
    ('ALD_ORR', 'ALDERGATE', 'ORRIN', 138, 84.0, 215, 248, None),
    ('WYN_LAR', 'WYNDHAM', 'LARKSPUR', 138, 92.0, 215, 248, None),
    ('KES_WEX', 'KESSLER', 'WEXFORD', 138, 78.0, 215, 248, None),
    ('KES_COL', 'KESSLER', 'COLVIN', 138, 71.0, 215, 248, None),
    ('THO_COL', 'THORNE', 'COLVIN', 138, 64.0, 215, 248, None),
    ('BEX_ORR', 'BEXHILL', 'ORRIN', 138, 30.0, 180, 207, None),
    ('ORR_LAR', 'ORRIN', 'LARKSPUR', 138, 48.0, 180, 207, None),
    ('LAR_WEX', 'LARKSPUR', 'WEXFORD', 138, -26.0, 180, 207, None),
    ('WEX_COL', 'WEXFORD', 'COLVIN', 138, 21.0, 180, 207, None),
    ('BEX_PEL', 'BEXHILL', 'PELL', 69, 37.0, 75, 86, None),
    ('ORR_NAV', 'ORRIN', 'NAVARRE', 69, 25.0, 75, 86, None),
    ('LAR_DUN', 'LARKSPUR', 'DUNMORE', 69, 31.0, 75, 86, None),
    ('WEX_TIL', 'WEXFORD', 'TILBURY', 69, 17.0, 75, 86, None),
    ('COL_TIL', 'COLVIN', 'TILBURY', 69, 12.0, 75, 86, None),
    ('PEL_NAV', 'PELL', 'NAVARRE', 69, -0.9, 50, 58, '69 kV tie \u2014 normally closed'),
    ('NAV_DUN', 'NAVARRE', 'DUNMORE', 69, 0.0, 50, 58,
     '69 kV tie \u2014 normally open; closed 11:20 to transfer load off Larkspur T1'),
    ('DUN_TIL', 'DUNMORE', 'TILBURY', 69, -1.4, 50, 58, '69 kV tie \u2014 normally closed'),
]
CIRC = {c[0]: c for c in CIRCUITS}

SUB_TYPE = {'bulk': 'bulk_substation', 'sub': 'subtransmission_substation',
            'supply': 'supply_substation'}
BAY_TYPE = {345: 'ehv_line_bay', 138: 'hv_line_bay', 69: 'sub_line_bay'}
# Which line bays carry a monitored breaker (online trip-coil / mechanism
# monitoring, retrofitted to the important positions first) — RESEARCH §2.2.
MONITORED_KV = {345}
# Line CVTs are fitted at 345 kV; 138 kV and 69 kV line bays take their voltage
# reference from the bus CVT. Line current differential (and therefore a line
# IED with an 87L channel) is used at 138 kV and above; 69 kV circuits are
# protected by overcurrent from the bus relay panel — RESEARCH §2.2.
CVT_KV = {345}
IED_KV = {345, 138}

BUS_IDS, BAY_META, XFMR_META = {}, {}, {}


def build_assets():
    add('VESPER', None, 'Vesper Grid', 'transmission_network', 'network')
    for did, dname, dtype in DISTRICTS:
        add(f'VESPER_{did}', 'VESPER', dname, dtype, 'district')

    for sid, sname, did, kind, tags, extra in SUBSTATIONS:
        st = add(f'VESPER_{sid}', f'VESPER_{did}', sname, SUB_TYPE[kind], 'substation')
        thru = station_throughput(sid, kind) * 1.04 if tags else 0.0
        rated = rate_bank(thru, len(tags)) if tags else 0

        # bus sections
        kvs = {'bulk': [345, 138], 'sub': [138, 69], 'supply': [69]}[kind]
        for kv in kvs:
            bus = add(f'{st}_BUS{kv}', st, f'{kv} kV Bus', 'bus_section', 'bay')
            BUS_IDS[(sid, kv)] = bus
            add(f'{bus}_CVT', bus, 'Bus CVT', 'cvt', 'device')
            add(f'{bus}_IED', bus, 'Bus Differential IED', 'protection_ied', 'device')

        # line bays, one per circuit end
        for key, a, b, kv, mw, nrm, emg, note in CIRCUITS:
            if sid not in (a, b):
                continue
            far = b if sid == a else a
            far_name = next(x[1] for x in SUBSTATIONS if x[0] == far)
            bay = add(f'{st}_BAY_{far}{kv}', st, f'{far_name} {kv} kV Line',
                      BAY_TYPE[kv], 'bay')
            BAY_META[bay] = {'circuit': key, 'kv': kv, 'end': 'a' if sid == a else 'b',
                             'normal': nrm, 'emerg': emg, 'station': sid, 'far': far}
            monitored = kv in MONITORED_KV
            cb = add(f'{bay}_CB', bay, 'Circuit Breaker',
                     'monitored_breaker' if monitored else 'sf6_breaker', 'device')
            if monitored:
                add(f'{cb}_TC', cb, 'Trip Coil', 'trip_coil', 'component')
                add(f'{cb}_MECH', cb, 'Mechanism', 'breaker_mechanism', 'component')
            if kv in CVT_KV:
                add(f'{bay}_CVT', bay, 'Line CVT', 'cvt', 'device')
            if kv in IED_KV:
                add(f'{bay}_IED', bay, 'Line Protection IED', 'protection_ied', 'device')

        # generation tie bay
        if extra.get('gen_tie'):
            bay = add(f'{st}_GENTIE', st, extra['gen_tie'], 'gen_tie_bay', 'bay')
            BAY_META[bay] = {'circuit': None, 'kv': 345, 'end': 'a', 'normal': 780,
                             'emerg': 900, 'station': sid, 'far': None,
                             'gen_mw': 372.0 if sid == 'ALDERGATE' else 214.0}
            cb = add(f'{bay}_CB', bay, 'Circuit Breaker', 'monitored_breaker', 'device')
            add(f'{cb}_TC', cb, 'Trip Coil', 'trip_coil', 'component')
            add(f'{cb}_MECH', cb, 'Mechanism', 'breaker_mechanism', 'component')
            add(f'{bay}_CVT', bay, 'Tie CVT', 'cvt', 'device')
            add(f'{bay}_IED', bay, 'Tie Protection IED', 'protection_ied', 'device')

        # transformer bays
        for tag in tags:
            bay = add(f'{st}_{tag}', st, f'{tag} Transformer',
                      'autotransformer_bay' if kind == 'bulk' else 'transformer_bay', 'bay')
            dev_type = 'autotransformer' if kind == 'bulk' else 'power_transformer'
            dev = add(f'{bay}_XFMR', bay,
                      'Autotransformer' if kind == 'bulk' else 'Power Transformer',
                      dev_type, 'device')
            XFMR_META[dev] = {'rated': rated, 'station': sid, 'tag': tag, 'kind': kind,
                              'bay': bay, 'share': thru / len(tags) / rated,
                              'thru_mva': thru / len(tags)}
            BAY_META[bay] = {'circuit': None, 'kv': 345 if kind == 'bulk' else 138,
                             'end': 'a', 'normal': rated, 'emerg': round(rated * 1.15),
                             'station': sid, 'far': None, 'xfmr': dev}
            add(f'{dev}_OLTC', dev, 'Tap Changer', 'oltc', 'component')
            add(f'{dev}_BUSH', dev, 'Bushing Set', 'bushing_set', 'component')
            add(f'{dev}_COOL', dev, 'Cooling Group', 'cooling_group', 'component')
            add(f'{dev}_DGA', dev, 'DGA Monitor', 'dga_monitor', 'component')
            cb = add(f'{bay}_CB', bay, 'Circuit Breaker', 'sf6_breaker', 'device')
            add(f'{bay}_IED', bay, 'Transformer Protection IED', 'protection_ied', 'device')

        # reactive plant
        if extra.get('cap'):
            bay = add(f'{st}_CAPBANK', st, '138 kV Capacitor Bank', 'capacitor_bay', 'bay')
            add(f'{bay}_CAP', bay, 'Shunt Capacitor Bank', 'shunt_cap_bank', 'device')
            add(f'{bay}_CB', bay, 'Circuit Breaker', 'sf6_breaker', 'device')
        if extra.get('reactor'):
            bay = add(f'{st}_REACTOR', st, '345 kV Shunt Reactor', 'reactor_bay', 'bay')
            add(f'{bay}_RX', bay, 'Shunt Reactor', 'shunt_reactor', 'device')
            add(f'{bay}_CB', bay, 'Circuit Breaker', 'sf6_breaker', 'device')

        # load bays
        for lname, mw in extra.get('loads', []):
            bay = add(f'{st}_LOAD{len(KIDS.get(st, [])):02d}', st, lname, 'load_bay', 'bay')
            BAY_META[bay] = {'load_mw': mw, 'station': sid}

        # station service
        ss = add(f'{st}_SS', st, 'Station Service', 'station_service_bay', 'bay')
        add(f'{ss}_BATT', ss, 'Station Battery', 'station_battery', 'device')
        add(f'{ss}_SST', ss, 'Station Service Transformer', 'station_service_xfmr', 'device')


build_assets()
OF_TYPE = {}
for a in ASSETS:
    OF_TYPE.setdefault(a['assetType'], []).append(a['id'])


def label_of(aid):
    names, a = [], BY_ID[aid]
    while a:
        names.insert(0, a['name'])
        if a['assetLevel'] == 'substation':
            return SEP.join(names)
        a = BY_ID.get(a['parentId'])
    return BY_ID[aid]['name']


def unit_of(aid):
    a = BY_ID[aid]
    while a and a['assetLevel'] != 'substation':
        a = BY_ID.get(a['parentId'])
    return a['id'] if a else None


# ─────────────────────────────────────────────────────────────────────────────
# §4  Relationships
# ─────────────────────────────────────────────────────────────────────────────

EDGES = []


def edge(src, dst, layer, label=None, rtype='feeds_into'):
    EDGES.append({'sourceAssetId': src, 'targetAssetId': dst, 'relationshipType': rtype,
                  'label': label, 'layer': layer})


def build_edges():
    layer_of_kv = {345: 'transmission', 138: 'subtransmission', 69: 'supply'}
    for key, a, b, kv, mw, nrm, emg, note in CIRCUITS:
        ba, bb = f'VESPER_{a}_BAY_{b}{kv}', f'VESPER_{b}_BAY_{a}{kv}'
        name = f'{BY_ID["VESPER_" + a]["name"]}–{BY_ID["VESPER_" + b]["name"]} {kv} kV'
        edge(ba, bb, layer_of_kv[kv], note or name)
        # the 87L current-differential channel spans the same circuit, on its own layer
        if kv in IED_KV:
            edge(f'{ba}_IED', f'{bb}_IED', 'protection',
                 f'87L current differential channel — {name}', 'exchanges_with')

    for bay, meta in BAY_META.items():
        st = BY_ID[bay]['parentId']
        sid = meta['station']
        if BY_ID[bay]['assetType'] in ('ehv_line_bay', 'hv_line_bay', 'sub_line_bay', 'gen_tie_bay'):
            edge(bay, BUS_IDS[(sid, meta['kv'])], 'station_bus', None)
        elif BY_ID[bay]['assetType'] == 'load_bay':
            edge(BUS_IDS[(sid, 69)], bay, 'station_bus', None)
        elif BY_ID[bay]['assetType'] in ('autotransformer_bay', 'transformer_bay'):
            hi, lo = (345, 138) if meta['kv'] == 345 else (138, 69)
            edge(BUS_IDS[(sid, hi)], meta['xfmr'], 'transformation', f'{hi} kV winding')
            edge(meta['xfmr'], BUS_IDS[(sid, lo)], 'transformation', f'{lo} kV winding')

    for sid, sname, did, kind, tags, extra in SUBSTATIONS:
        st = f'VESPER_{sid}'
        if extra.get('cap'):
            edge(f'{st}_CAPBANK_CAP', BUS_IDS[(sid, 138)], 'reactive_support',
                 f'{extra["cap"]:.0f} MVAr shunt capacitor bank')
        if extra.get('reactor'):
            edge(f'{st}_REACTOR_RX', BUS_IDS[(sid, 345)], 'reactive_support',
                 f'{extra["reactor"]:.0f} MVAr shunt reactor')
        batt = f'{st}_SS_BATT'
        edge(f'{st}_SS_SST', batt, 'station_service', 'battery charger supply')
        # the station battery supplies every trip path in the station
        for aid in ASSETS:
            if aid['parentId'] and aid['id'].startswith(st + '_') and aid['assetType'] == 'trip_coil':
                edge(batt, aid['id'], 'dc_supply', '125 VDC trip supply')
        for kv in ({'bulk': [345, 138], 'sub': [138, 69], 'supply': [69]}[kind]):
            edge(batt, f'{BUS_IDS[(sid, kv)]}_IED', 'dc_supply', '125 VDC relay supply')

    # protection: each line/transformer IED trips its own breaker
    for a in ASSETS:
        if a['assetType'] != 'protection_ied':
            continue
        cb = a['parentId'] + '_CB'
        if cb in BY_ID:
            edge(a['id'], cb, 'protection', 'trip path')


build_edges()

# ─────────────────────────────────────────────────────────────────────────────
# §5  Baseline telemetry
# ─────────────────────────────────────────────────────────────────────────────

SERIES = {}     # assetId -> {key: [...]}
STATIC = {}     # assetId -> {key: value}


def put(aid, key, values):
    SERIES.setdefault(aid, {})[key] = list(values)


def put_static(aid, key, value):
    STATIC.setdefault(aid, {})[key] = value


def rng_for(aid, key):
    return random.Random(f'{SEED}:{aid}:{key}')


def jitter(aid, spread=0.02):
    return 1.0 + (random.Random(f'{SEED}:j:{aid}').random() - 0.5) * 2 * spread


def flow_series(base_mw, aid):
    """MW on a circuit end, scaled by the system load driver."""
    r = rng_for(aid, 'mw')
    j = jitter(aid, 0.015)
    noise = ar1(r, N, 0.0, 1.0, 0.9)
    out = []
    for i in range(N):
        v = base_mw * j * (LOAD_F[i] / LOAD_F[0])
        out.append(v + noise[i] * abs(base_mw) * 0.012)
    return out


def build_baseline():
    # network root
    r = rng_for('VESPER', 'f')
    put('VESPER', 'system_frequency_hz', [60.0 + x for x in ar1(r, N, 0.0, 0.009, 0.72)])
    put('VESPER', 'ambient_temp_c', AMBIENT)

    # line bays and generation ties
    for bay, meta in BAY_META.items():
        t = BY_ID[bay]['assetType']
        if t in ('ehv_line_bay', 'hv_line_bay', 'sub_line_bay', 'gen_tie_bay'):
            kv = meta['kv']
            if t == 'gen_tie_bay':
                base = meta['gen_mw']
            else:
                c = CIRC[meta['circuit']]
                base = c[4] if meta['end'] == 'a' else -c[4] * 0.982   # line losses
            mw = flow_series(base, bay)
            rq = rng_for(bay, 'q')
            q0 = max(abs(base), 4.0) * 0.13
            mvar = ar1(rq, N, q0 * jitter(bay, 0.2), 0.05, 0.9)
            mw_key, q_key, a_key = {
                345: ('ehv_mw_flow_mw', 'ehv_mvar_flow_mvar', 'ehv_current_a'),
                138: ('mw_flow_mw', 'mvar_flow_mvar', 'line_current_a'),
                69: ('sub_mw_flow_mw', 'sub_mvar_flow_mvar', 'sub_current_a'),
            }[kv]
            put(bay, mw_key, mw)
            put(bay, q_key, mvar)
            put(bay, a_key, [0.0] * N)                 # filled in §7 after scenarios
            put(bay, 'loading_pct', [0.0] * N)
            put(bay, 'post_ctg_loading_pct', [0.0] * N)
            put_static(bay, 'normal_rating_mva', meta['normal'])
            put_static(bay, 'emergency_rating_mva', meta['emerg'])
        elif t in ('autotransformer_bay', 'transformer_bay'):
            put(bay, 'loading_pct', [0.0] * N)
            put(bay, 'post_ctg_loading_pct', [0.0] * N)
            put_static(bay, 'normal_rating_mva', meta['normal'])
            put_static(bay, 'emergency_rating_mva', meta['emerg'])
        elif t == 'load_bay':
            r = rng_for(bay, 'l')
            j = jitter(bay, 0.03)
            base = meta['load_mw'] * j
            mw = [base * (LOAD_F[i] / LOAD_F[0]) + x for i, x in enumerate(ar1(r, N, 0.0, 0.25, 0.9))]
            put(bay, 'served_load_mw', mw)
            put(bay, 'served_load_mvar_mvar', [v * 0.31 for v in mw])
            put(bay, 'load_power_factor_pu', ar1(rng_for(bay, 'pf'), N, 0.955, 0.004, 0.9))

    # buses
    for (sid, kv), bus in BUS_IDS.items():
        r = rng_for(bus, 'v')
        base = {345: 1.024, 138: 1.014, 69: 1.008}[kv] * jitter(bus, 0.006)
        # voltage sags a little as load rises through the morning
        v = [base - 0.012 * (LOAD_F[i] - LOAD_F[0]) / 0.27 + x
             for i, x in enumerate(ar1(r, N, 0.0, 0.0022, 0.93))]
        put(bus, 'bus_voltage_pu', v)
        put(bus, 'bus_voltage_thd_pct', ar1(rng_for(bus, 'thd'), N,
                                            {345: 0.72, 138: 0.94, 69: 1.05}[kv] * jitter(bus, 0.12), 0.06))
        put(bus, 'neg_seq_voltage_pct', ar1(rng_for(bus, 'ns'), N, 0.38 * jitter(bus, 0.25), 0.08))
        put_static(bus, 'nominal_kv', kv)

    # transformers
    for dev, meta in XFMR_META.items():
        bay = meta['bay']
        rated = meta['rated']
        base_mva = meta['thru_mva'] * jitter(dev, 0.03)
        mva = [base_mva * (LOAD_F[i] / LOAD_F[0]) + x
               for i, x in enumerate(ar1(rng_for(dev, 'm'), N, 0.0, 0.9, 0.92))]
        key = 'auto_load_mva' if meta['kind'] == 'bulk' else 'xfmr_load_mva'
        put(dev, key, mva)
        put(dev, 'xfmr_loading_pct', [100.0 * v / rated for v in mva])
        put(dev, 'top_oil_temp_c', [0.0] * N)          # filled by thermal_pass()
        put(dev, 'winding_hotspot_temp_c', [0.0] * N)
        put_static(dev, 'rated_mva', rated)
        # components
        oltc = f'{dev}_OLTC'
        tp = ar1(rng_for(oltc, 't'), N, 2.2 * jitter(oltc, 0.5), 0.25, 0.96)
        put(oltc, 'tap_position', [round(v) for v in tp])
        put(oltc, 'oltc_ops_per_day', ar1(rng_for(oltc, 'o'), N, 5.6 * jitter(oltc, 0.2), 0.07))
        base_ops = 41000 + int(random.Random(f'{SEED}:{oltc}').random() * 19000)
        put(oltc, 'oltc_ops_total', [float(base_ops + i // 26) for i in range(N)])
        put(oltc, 'ltc_tank_diff_temp_c', ar1(rng_for(oltc, 'd'), N, -5.4 * jitter(oltc, 0.15), 0.035))

        bush = f'{dev}_BUSH'
        put(bush, 'bushing_c1_pf_pct', ar1(rng_for(bush, 'p'), N, 0.34 * jitter(bush, 0.12), 0.012))
        put(bush, 'bushing_cap_dev_pct', ar1(rng_for(bush, 'c'), N, 0.41 * jitter(bush, 0.3), 0.02))
        put(bush, 'bushing_leakage_current_ma', ar1(rng_for(bush, 'l'), N, 40.5 * jitter(bush, 0.08), 0.008))

        cool = f'{dev}_COOL'
        put(cool, 'cooling_fans_running_n', [0.0] * N)   # filled by thermal_pass()
        put(cool, 'radiator_dt_c', [0.0] * N)
        put(cool, 'oil_pump_flow_pct', ar1(rng_for(cool, 'f'), N, 100.0, 0.006))

        dga = f'{dev}_DGA'
        jj = jitter(dga, 0.25)
        put(dga, 'dga_h2_ppm', ar1(rng_for(dga, 'h'), N, 38.0 * jj, 0.015, 0.97))
        put(dga, 'dga_c2h4_ppm', ar1(rng_for(dga, 'e'), N, 16.5 * jj, 0.015, 0.97))
        put(dga, 'dga_c2h2_ppm', [abs(v) for v in ar1(rng_for(dga, 'a'), N, 0.32 * jj, 0.06, 0.97)])
        put(dga, 'dga_tdcg_ppm', ar1(rng_for(dga, 't'), N, 246.0 * jj, 0.012, 0.97))
        put(dga, 'dga_tdcg_rate_ppm_day', [abs(v) for v in ar1(rng_for(dga, 'rt'), N, 2.1 * jj, 0.05, 0.96)])
        put(dga, 'moisture_rel_sat_pct', ar1(rng_for(dga, 'm'), N, 7.4 * jj, 0.03, 0.95))

    # breakers, CVTs, IEDs, batteries, station service, reactive devices
    for a in ASSETS:
        aid, t = a['id'], a['assetType']
        if t in ('sf6_breaker', 'monitored_breaker'):
            put(aid, 'sf6_pressure_kpa', [648.0 * jitter(aid, 0.012) + 1.6 * (AMBIENT[i] - 28.0) / 6.0 + x
                                          for i, x in enumerate(ar1(rng_for(aid, 's'), N, 0.0, 0.35, 0.95))])
            ops = 620 + int(random.Random(f'{SEED}:{aid}:ops').random() * 1600)
            put(aid, 'breaker_ops_total', [float(ops)] * N)
            put(aid, 'accum_interrupt_i2t_ka2s',
                [round(9.0 + random.Random(f'{SEED}:{aid}:i2t').random() * 42.0, 2)] * N)
            put(aid, 'contact_wear_pct',
                [round(14.0 + random.Random(f'{SEED}:{aid}:w').random() * 34.0, 1)] * N)
            put(aid, 'reclose_ops_count',
                [float(3 + int(random.Random(f'{SEED}:{aid}:rc').random() * 14))] * N)
        elif t == 'trip_coil':
            put(aid, 'trip_coil_peak_a', ar1(rng_for(aid, 'p'), N, 6.05 * jitter(aid, 0.05), 0.01))
            put(aid, 'trip_coil_pickup_ms', ar1(rng_for(aid, 'k'), N, 8.9 * jitter(aid, 0.06), 0.012))
        elif t == 'breaker_mechanism':
            put(aid, 'spring_charge_time_s', ar1(rng_for(aid, 'c'), N, 3.05 * jitter(aid, 0.07), 0.012))
            put(aid, 'charging_motor_current_a', ar1(rng_for(aid, 'm'), N, 4.45 * jitter(aid, 0.06), 0.014))
            put(aid, 'close_time_ms', ar1(rng_for(aid, 'x'), N, 57.5 * jitter(aid, 0.05), 0.008))
        elif t == 'cvt':
            bus_kv = 345
            par = BY_ID[a['parentId']]
            if par['assetType'] == 'bus_section':
                bus_kv = int(par['name'].split(' ')[0])
            else:
                bus_kv = BAY_META.get(par['id'], {}).get('kv', 138)
            vref = {345: 68.9, 138: 68.2, 69: 67.8}[bus_kv]
            put(aid, 'cvt_secondary_v', ar1(rng_for(aid, 'v'), N, vref * jitter(aid, 0.004), 0.0022, 0.93))
            put(aid, 'v_redundant_dev_pct', [abs(v) for v in
                                             ar1(rng_for(aid, 'd'), N, 0.28 * jitter(aid, 0.3), 0.09, 0.95)])
            put(aid, 'cvt_pf_pct', ar1(rng_for(aid, 'p'), N, 0.305 * jitter(aid, 0.12), 0.012, 0.96))
            put(aid, 'cvt_cap_dev_pct', [abs(v) for v in
                                         ar1(rng_for(aid, 'c'), N, 0.36 * jitter(aid, 0.3), 0.03, 0.97)])
        elif t == 'protection_ied':
            put(aid, 'goose_msg_age_ms', ar1(rng_for(aid, 'g'), N, 3.3 * jitter(aid, 0.15), 0.06))
            put(aid, 'line_diff_latency_ms', ar1(rng_for(aid, 'l'), N, 5.2 * jitter(aid, 0.1), 0.03))
            put(aid, 'diff_current_pu', [abs(v) for v in
                                         ar1(rng_for(aid, 'd'), N, 0.011 * jitter(aid, 0.25), 0.1)])
            put(aid, 'relay_selftest_faults_n', [0.0] * N)
        elif t == 'station_battery':
            put(aid, 'battery_float_voltage_v', ar1(rng_for(aid, 'v'), N, 132.1 * jitter(aid, 0.006), 0.0012))
            put(aid, 'battery_cell_dev_v', ar1(rng_for(aid, 'c'), N, -0.012 * jitter(aid, 0.4), 0.06))
            put(aid, 'charger_output_current_a', ar1(rng_for(aid, 'i'), N, 7.9 * jitter(aid, 0.12), 0.03))
            put(aid, 'charger_ac_ripple_pct', [abs(v) for v in
                                               ar1(rng_for(aid, 'r'), N, 0.29 * jitter(aid, 0.2), 0.05)])
        elif t == 'station_service_xfmr':
            put(aid, 'sst_secondary_v', ar1(rng_for(aid, 'v'), N, 481.0 * jitter(aid, 0.008), 0.0025))
        elif t == 'station_service_bay':
            put(aid, 'station_service_load_kva',
                [186.0 * jitter(aid, 0.15) + 34.0 * (AMBIENT[i] - 24.0) / 9.0 + x
                 for i, x in enumerate(ar1(rng_for(aid, 'k'), N, 0.0, 2.0, 0.9))])
        elif t == 'shunt_cap_bank':
            put(aid, 'cap_bank_mvar', ar1(rng_for(aid, 'q'), N, 49.4, 0.008, 0.95))
            put(aid, 'cap_neutral_unbal_a', [abs(v) for v in ar1(rng_for(aid, 'n'), N, 0.148, 0.05, 0.96)])
            put(aid, 'cap_switch_ops_n', [812.0] * N)
        elif t == 'shunt_reactor':
            put(aid, 'reactor_mvar', ar1(rng_for(aid, 'q'), N, 48.6, 0.01, 0.95))
            put(aid, 'reactor_top_oil_temp_c', [AMBIENT[i] + 29.5 + x for i, x in
                                                enumerate(ar1(rng_for(aid, 't'), N, 0.0, 0.3, 0.93))])
        elif t == 'bulk_substation':
            put(aid, 'mvar_reserve_mvar', ar1(rng_for(aid, 'r'), N, 163.0 * jitter(aid, 0.08), 0.02, 0.95))

    # reactive bays mirror their own device, so they come after it
    for a in ASSETS:
        if a['assetType'] not in ('capacitor_bay', 'reactor_bay'):
            continue
        aid = a['id']
        dev = f'{aid}_CAP' if f'{aid}_CAP' in BY_ID else f'{aid}_RX'
        sign = 1.0 if dev.endswith('_CAP') else -1.0
        src = 'cap_bank_mvar' if sign > 0 else 'reactor_mvar'
        put(aid, 'bay_reactive_mvar', [sign * v for v in SERIES[dev][src]])
        put(aid, 'reactive_available_mvar', ar1(rng_for(aid, 'a'), N, 50.0, 0.004, 0.95))


build_baseline()


# ─────────────────────────────────────────────────────────────────────────────
# §6  SCENARIOS — every constant of every story
# ─────────────────────────────────────────────────────────────────────────────
# Each entry is read by the injector (§7) AND quoted in SCENARIOS.md, so the
# narrative and the telemetry are generated from the same numbers.

S = {
    'S01': dict(id='GSIT01', arch='05 Component degradation',
                asset='VESPER_ALDERGATE_T1_XFMR_BUSH', prop='bushing_c1_pf_pct',
                start='09:30', peak='14:05', severity='high', state='act',
                outcome='none', evid=['09:30', '10:30', '11:30', '12:30', '13:30', '14:05']),
    'S02': dict(id='GSIT02', arch='03 Quiet drift',
                asset='VESPER_KESSLER_T2_XFMR_DGA', prop='dga_tdcg_rate_ppm_day',
                start='08:10', peak='14:05', severity='medium', state='investigate',
                outcome='none', evid=['08:10', '09:30', '10:50', '12:10', '13:20', '14:05']),
    'S03': dict(id='GSIT03', arch='06 Signal noise / instrument fault',
                asset='VESPER_LARKSPUR_BUS138_CVT', prop='v_redundant_dev_pct',
                start='09:00', fixed='12:10', severity='medium', state='watch',
                outcome='resolved', evid=['09:00', '10:00', '11:00', '11:35', '12:10', '13:10', '14:05']),
    'S04': dict(id='GSIT04', arch='10 Overcorrection loop',
                asset='VESPER_WYNDHAM_T1_XFMR_OLTC', prop='oltc_ops_per_day',
                start='09:50', fixed='12:45', severity='medium', state='act',
                outcome='recovering', evid=['09:45', '09:55', '10:10', '12:40', '12:55', '13:20', '14:05']),
    'S05': dict(id='GSIT05', arch='11 Hard block',
                asset='VESPER_ORRIN_BAY_LARKSPUR138', prop='mw_flow_mw',
                start='10:15', severity='high', state='act', outcome='none',
                evid=['10:00', '10:10', '10:15', '10:20', '11:00', '14:05']),
    'S06': dict(id='GSIT06', arch='09 Cascade / flow redistribution',
                asset='VESPER_LARKSPUR', prop='worst_post_ctg_loading_pct',
                start='10:15', tie='11:20', severity='high', state='act',
                outcome='recovering', evid=['10:10', '10:20', '11:05', '11:20', '11:40', '13:00', '14:05']),
    'S07': dict(id='GSIT07', arch='07 Ghost signal (cause upstream)',
                asset='VESPER_DUNMORE_BUS69', prop='bus_voltage_pu',
                start='09:40', fixed='10:35', severity='medium', state='watch',
                outcome='resolved', evid=['09:35', '09:40', '10:05', '10:25', '10:40', '11:00', '14:05']),
    'S08': dict(id='GSIT08', arch='12 Recurring micro-events',
                asset='VESPER_WEXFORD_BAY_TILBURY69_CB', prop='reclose_ops_count',
                start='08:25', fixed='12:20', severity='low', state='watch',
                outcome='resolved', events=['08:25', '09:15', '10:05', '11:10', '12:00'],
                evid=['08:10', '08:25', '09:15', '10:05', '11:10', '12:00', '14:05']),
    'S09': dict(id='GSIT09', arch='04 Accumulation / saturation',
                asset='VESPER_KESSLER_T1_XFMR', prop='winding_hotspot_temp_c',
                start='10:20', peak='12:30', fixed='12:50', severity='high',
                state='watch', outcome='resolved',
                evid=['10:20', '11:20', '12:35', '12:50', '13:10', '13:40', '14:05']),
    'S10': dict(id='GSIT10', arch='08 Throughput illusion',
                asset='VESPER_THORNE', prop='mvar_reserve_mvar',
                start='11:40', severity='medium', state='investigate', outcome='none',
                evid=['09:35', '09:45', '11:10', '11:25', '11:40', '14:05']),
    'S11': dict(id='GSIT11', arch='13 Quality drift',
                asset='VESPER_COLVIN_BUS69', prop='bus_voltage_thd_pct',
                start='09:05', severity='low', state='investigate', outcome='none',
                evid=['09:05', '10:05', '11:05', '12:05', '13:05', '14:05']),
    'S12': dict(id='GSIT12', arch='14 Plan or compliance at risk',
                asset='VESPER_HARROW', prop='worst_post_ctg_loading_pct',
                start='13:40', severity='medium', state='investigate', outcome='none',
                evid=['13:40', '13:45', '13:50', '13:55', '14:00', '14:05']),
}

# Scenario magnitudes, kept next to the stories they belong to.
S01_PF = (0.34, 0.93)             # C1 power factor, baseline -> now (investigate > 0.5 %)
S01_CAP = (0.41, 4.10)            # capacitance deviation %, investigate > 5 %
S01_LEAK = (40.5, 56.8)           # leakage current mA
S02_RATE = (2.1, 9.4)             # TDCG rate ppm/day (action level 30)
S02_C2H4 = (16.5, 44.0)           # ethylene ppm
S02_H2 = (38.0, 96.0)             # hydrogen ppm
S02_TDCG = (246.0, 402.0)
S03_DEV = (0.28, 6.15)            # redundant deviation % (alarm 5 %)
S03_VSEC = (68.2, 63.9)           # the drifting phase's secondary volts
S04_OPS = (5.6, 58.0, 13.5)       # ops/day: normal, hunting, after bandwidth fix
S05_FLOW = 0.0                    # MW after lockout
S06_PCTG = (78.5, 104.2, 95.8)    # Larkspur worst post-contingency loading
S07_PU = (1.012, 0.951, 0.996)    # Dunmore 69 kV bus pu: normal, sag, after tap raise
S07_UNBAL = (0.148, 1.31)         # Wyndham cap bank neutral unbalance step
S09_STATION_MVA = 22.0            # extra Kessler 138 kV throughput after the lockout
S09_IMBALANCE_MVA = 27.0          # T1 over / T2 under, from the tap mismatch
S09_KES_WEX_MW = 12.0             # where the extra throughput goes
S09_KES_COL_MW = 10.0
S10_RESERVE = (163.0, 38.0)       # Thorne reactive reserve MVAr
S10_STEP_MVAR = 52.0              # lost with the Wyndham capacitor bank at 09:40
S10_SLIDE_MVAR = 73.0             # committed to holding 345 kV volts, 11:10-11:40
S11_THD = (1.05, 2.12)            # Colvin 69 kV bus THD % (IEEE 519 limit 2.5 %)
S12_PCTG = 97.4                   # Harrow worst post-contingency loading at 14:05


# ─────────────────────────────────────────────────────────────────────────────
# §7  Scenario injection
# ─────────────────────────────────────────────────────────────────────────────

def blend(aid, key, fn):
    """Replace a series with fn(i, baseline_value), keeping its own noise."""
    base = SERIES[aid][key]
    SERIES[aid][key] = [fn(i, base[i]) for i in range(N)]


def inject():
    # ── S01  Aldergate T1 bushing degradation (archetype 05) ────────────────
    b = 'VESPER_ALDERGATE_T1_XFMR_BUSH'
    i0, i1 = at(S['S01']['start']), N - 1
    blend(b, 'bushing_c1_pf_pct', lambda i, v: v + ramp(i, i0, i1, 0, S01_PF[1] - S01_PF[0], False) ** 1.0)
    blend(b, 'bushing_cap_dev_pct', lambda i, v: v + ramp(i, i0, i1, 0, S01_CAP[1] - S01_CAP[0], False))
    blend(b, 'bushing_leakage_current_ma', lambda i, v: v + ramp(i, i0, i1, 0, S01_LEAK[1] - S01_LEAK[0], False))
    # the transformer's own DGA stays quiet — the defect is in the bushing core
    blend('VESPER_ALDERGATE_T1_XFMR_DGA', 'dga_h2_ppm', lambda i, v: v + ramp(i, i0, i1, 0, 7.0))

    # ── S02  Kessler T2 slow internal thermal fault (archetype 03) ──────────
    d = 'VESPER_KESSLER_T2_XFMR_DGA'
    i0 = at(S['S02']['start'])
    blend(d, 'dga_tdcg_rate_ppm_day', lambda i, v: v + ramp(i, i0, N - 1, 0, S02_RATE[1] - S02_RATE[0], False))
    blend(d, 'dga_c2h4_ppm', lambda i, v: v + ramp(i, i0, N - 1, 0, S02_C2H4[1] - S02_C2H4[0], False))
    blend(d, 'dga_h2_ppm', lambda i, v: v + ramp(i, i0, N - 1, 0, S02_H2[1] - S02_H2[0], False))
    blend(d, 'dga_tdcg_ppm', lambda i, v: v + ramp(i, i0, N - 1, 0, S02_TDCG[1] - S02_TDCG[0], False))
    # acetylene stays flat: thermal fault, not arcing (RESEARCH §5.2)

    # ── S03  Larkspur 138 kV bus CVT element failure (archetype 06) ─────────
    c = 'VESPER_LARKSPUR_BUS138_CVT'
    i0, i1 = at(S['S03']['start']), at(S['S03']['fixed'])
    blend(c, 'v_redundant_dev_pct', lambda i, v: v + ramp(i, i0, i1, 0, S03_DEV[1] - S03_DEV[0], False))
    blend(c, 'cvt_secondary_v', lambda i, v: v + ramp(i, i0, i1, 0, S03_VSEC[1] - S03_VSEC[0], False))
    blend(c, 'cvt_cap_dev_pct', lambda i, v: v + ramp(i, i0, i1, 0, 2.6, False))
    blend(c, 'cvt_pf_pct', lambda i, v: v + ramp(i, i0, i1, 0, 0.22, False))
    # nothing else moves. That absence is the scenario (spec §5.2 note 3).

    # ── S04  Wyndham T1 tap changer hunting (archetype 10) ──────────────────
    o = 'VESPER_WYNDHAM_T1_XFMR_OLTC'
    i0, i1 = at(S['S04']['start']), at(S['S04']['fixed'])
    def ops(i, v):
        if i < i0:
            return v
        if i <= i1:
            return v + ramp(i, i0, i0 + 6, 0, S04_OPS[1] - S04_OPS[0])
        return v + ramp(i, i1, i1 + 8, S04_OPS[1] - S04_OPS[0], S04_OPS[2] - S04_OPS[0])
    blend(o, 'oltc_ops_per_day', ops)
    r = rng_for(o, 'hunt')
    blend(o, 'tap_position', lambda i, v: v + (r.choice([-2, -1, 1, 2]) if i0 <= i <= i1 + 6 else 0))
    cum = 0.0
    tot = list(SERIES[o]['oltc_ops_total'])
    for i in range(N):
        cum += SERIES[o]['oltc_ops_per_day'][i] * (TIMELINE['stepMinutes'] / 1440.0)
        tot[i] = tot[0] + cum
    SERIES[o]['oltc_ops_total'] = tot
    # the paralleled bank at Aldergate counter-phases slightly
    blend('VESPER_ALDERGATE_T1_XFMR_OLTC', 'oltc_ops_per_day',
          lambda i, v: v + (6.2 if i0 <= i <= i1 else 0))

    # ── S07  Wyndham capacitor can failure -> Dunmore voltage sag (07) ──────
    cap = 'VESPER_WYNDHAM_CAPBANK_CAP'
    i0, i1 = at(S['S07']['start']), at(S['S07']['fixed'])
    blend(cap, 'cap_neutral_unbal_a', lambda i, v: (v + S07_UNBAL[1] - S07_UNBAL[0]) if i >= i0 else v)
    blend(cap, 'cap_bank_mvar', lambda i, v: 0.0 if i >= i0 else v)
    blend('VESPER_WYNDHAM_CAPBANK', 'bay_reactive_mvar', lambda i, v: 0.0 if i >= i0 else v)
    blend('VESPER_WYNDHAM_CAPBANK', 'reactive_available_mvar', lambda i, v: 0.0 if i >= i0 else v)
    for bus, depth in [('VESPER_DUNMORE_BUS69', 1.0), ('VESPER_LARKSPUR_BUS69', 0.72),
                       ('VESPER_LARKSPUR_BUS138', 0.34), ('VESPER_WYNDHAM_BUS138', 0.22),
                       ('VESPER_NAVARRE_BUS69', 0.41), ('VESPER_TILBURY_BUS69', 0.30)]:
        drop = (S07_PU[0] - S07_PU[1]) * depth
        back = (S07_PU[2] - S07_PU[1]) * depth
        def sag(i, v, drop=drop, back=back, i0=i0, i1=i1):
            if i < i0:
                return v
            if i < i1:
                return v - drop
            return v - drop + ramp(i, i1, i1 + 3, 0, back)
        blend(bus, 'bus_voltage_pu', sag)
    # taps were raised to recover the 69 kV buses
    for x in ['VESPER_LARKSPUR_T1_XFMR_OLTC', 'VESPER_COLVIN_T1_XFMR_OLTC']:
        blend(x, 'tap_position', lambda i, v: v + (2 if i >= i1 else 0))

    # ── S05  Orrin–Larkspur 138 kV fault, failed reclose, lockout (11) ──────
    i0 = at(S['S05']['start'])
    for bay in ['VESPER_ORRIN_BAY_LARKSPUR138', 'VESPER_LARKSPUR_BAY_ORRIN138']:
        for k in ['mw_flow_mw', 'mvar_flow_mvar']:
            blend(bay, k, lambda i, v: 0.0 if i >= i0 else v)
        cb = f'{bay}_CB'
        blend(cb, 'breaker_ops_total', lambda i, v: v + (2 if i >= i0 else 0))
        blend(cb, 'reclose_ops_count', lambda i, v: v + (1 if i >= i0 else 0))
        blend(cb, 'accum_interrupt_i2t_ka2s', lambda i, v: v + (3.84 if i >= i0 else 0))
        blend(cb, 'contact_wear_pct', lambda i, v: v + (1.6 if i >= i0 else 0))
    # every bus registers the fault in the same scan; depth by electrical distance
    for bus, depth in [('VESPER_ORRIN_BUS138', 0.062), ('VESPER_LARKSPUR_BUS138', 0.058),
                       ('VESPER_BEXHILL_BUS138', 0.031), ('VESPER_ALDERGATE_BUS138', 0.018),
                       ('VESPER_WYNDHAM_BUS138', 0.015), ('VESPER_KESSLER_BUS345', 0.006)]:
        blend(bus, 'bus_voltage_pu', lambda i, v, d=depth: v - d if i == i0 else v)

    # ── S06  Flow redistribution onto the parallel paths (archetype 09) ─────
    tie = at(S['S06']['tie'])
    # the 61 MW Orrin->Larkspur was carrying now arrives the long way round
    for bay, share in [('VESPER_WYNDHAM_BAY_LARKSPUR138', 0.55),
                       ('VESPER_LARKSPUR_BAY_WYNDHAM138', -0.55),
                       ('VESPER_WEXFORD_BAY_LARKSPUR138', 0.28),
                       ('VESPER_LARKSPUR_BAY_WEXFORD138', -0.28),
                       ('VESPER_BEXHILL_BAY_ORRIN138', 0.41),
                       ('VESPER_ORRIN_BAY_BEXHILL138', -0.41)]:
        blend(bay, 'mw_flow_mw',
              lambda i, v, s=share: v + (61.0 * s if i >= i0 else 0))
    # Larkspur T1 picks up the 69 kV load its 138 kV neighbour used to help carry
    lt = 'VESPER_LARKSPUR_T1_XFMR'
    blend(lt, 'xfmr_load_mva', lambda i, v: v + (ramp(i, i0, i0 + 4, 0, 23.0)
                                                 - (ramp(i, tie, tie + 4, 0, 13.0) if i >= tie else 0)))
    # closing the normally-open tie at 11:20 moves load — and loads Bexhill instead
    for bay, mw in [('VESPER_NAVARRE_BAY_DUNMORE69', 11.2), ('VESPER_DUNMORE_BAY_NAVARRE69', -11.0),
                    ('VESPER_ORRIN_BAY_NAVARRE69', 6.8), ('VESPER_NAVARRE_BAY_ORRIN69', -6.7),
                    ('VESPER_BEXHILL_BAY_PELL69', 4.1), ('VESPER_PELL_BAY_BEXHILL69', -4.0),
                    ('VESPER_LARKSPUR_BAY_DUNMORE69', -11.4), ('VESPER_DUNMORE_BAY_LARKSPUR69', 11.2)]:
        blend(bay, 'sub_mw_flow_mw', lambda i, v, m=mw: v + (ramp(i, tie, tie + 3, 0, m)))
    blend('VESPER_BEXHILL_T1_XFMR', 'xfmr_load_mva', lambda i, v: v + ramp(i, tie, tie + 4, 0, 7.4))

    # ── S08  Recurring momentary faults on Wexford–Tilbury 69 kV (12) ───────
    cb = S['S08']['asset']
    for k, step in [('reclose_ops_count', 1.0), ('breaker_ops_total', 2.0),
                    ('accum_interrupt_i2t_ka2s', 0.42), ('contact_wear_pct', 0.35)]:
        idxs = [at(t) for t in S['S08']['events']]
        blend(cb, k, lambda i, v, idxs=idxs, step=step: v + step * sum(1 for x in idxs if i >= x))
    for t in S['S08']['events']:
        j = at(t)
        blend('VESPER_TILBURY_BUS69', 'bus_voltage_pu', lambda i, v, j=j: v - 0.043 if i == j else v)
        blend('VESPER_WEXFORD_BUS69', 'bus_voltage_pu', lambda i, v, j=j: v - 0.028 if i == j else v)

    # ── S09  Kessler T1 thermal accumulation on a hot afternoon (04) ────────
    # Only load is injected here. The winding temperature is whatever the
    # thermal model (thermal_pass) makes of that load and the ambient, so the
    # excursion is a consequence rather than a drawn curve.
    i0, ip, ifx = at(S['S09']['start']), at(S['S09']['peak']), at(S['S09']['fixed'])
    # the redistribution reaches Kessler as extra 138 kV throughput
    for bay, mw in [('VESPER_KESSLER_BAY_WEXFORD138', S09_KES_WEX_MW),
                    ('VESPER_WEXFORD_BAY_KESSLER138', -S09_KES_WEX_MW),
                    ('VESPER_KESSLER_BAY_COLVIN138', S09_KES_COL_MW),
                    ('VESPER_COLVIN_BAY_KESSLER138', -S09_KES_COL_MW)]:
        blend(bay, 'mw_flow_mw', lambda i, v, m=mw: v + ramp(i, i0, i0 + 4, 0, m))
    # both banks share the extra, but a tap mismatch puts far more of it on T1
    half = S09_STATION_MVA / 2.0
    blend('VESPER_KESSLER_T1_XFMR', 'auto_load_mva',
          lambda i, v: v + ramp(i, i0, ip, 0, half + S09_IMBALANCE_MVA, False)
          - (ramp(i, ifx, ifx + 5, 0, S09_IMBALANCE_MVA) if i >= ifx else 0))
    blend('VESPER_KESSLER_T2_XFMR', 'auto_load_mva',
          lambda i, v: v + ramp(i, i0, ip, 0, half - S09_IMBALANCE_MVA, False)
          + (ramp(i, ifx, ifx + 5, 0, S09_IMBALANCE_MVA) if i >= ifx else 0))
    # rebalancing the taps is what fixes the sharing
    blend('VESPER_KESSLER_T1_XFMR_OLTC', 'tap_position', lambda i, v: v + (-1 if i >= ifx else 0))

    # ── S11  Colvin 69 kV harmonic drift toward the IEEE 519 limit (13) ─────
    i0 = at(S['S11']['start'])
    blend('VESPER_COLVIN_BUS69', 'bus_voltage_thd_pct',
          lambda i, v: v + ramp(i, i0, N - 1, 0, S11_THD[1] - S11_THD[0], False))
    blend('VESPER_COLVIN_BUS69', 'neg_seq_voltage_pct',
          lambda i, v: v + ramp(i, i0, N - 1, 0, 0.42, False))
    blend('VESPER_TILBURY_BUS69', 'bus_voltage_thd_pct',
          lambda i, v: v + ramp(i, i0, N - 1, 0, 0.51, False))

    # ── S10  Thorne reactive reserve exhausted while MW looks fine (08) ─────
    i0 = at(S['S10']['start'])
    blend('VESPER_THORNE', 'mvar_reserve_mvar',
          lambda i, v: v - (S10_STEP_MVAR if i >= at('09:40') else 0)
          - ramp(i, at('11:10'), i0, 0, S10_SLIDE_MVAR))
    blend('VESPER_WYNDHAM', 'mvar_reserve_mvar',
          lambda i, v: v - ramp(i, at('09:40'), at('10:10'), 0, 50.0))
    blend('VESPER_THORNE_REACTOR', 'reactive_available_mvar',
          lambda i, v: v - ramp(i, at('11:10'), i0, 0, 41.0))


inject()


def thermal_pass():
    """Top oil, hot spot, cooling stages and radiator drop, from the final load.

    Run after the scenarios so a load change shows up as a temperature change
    with the right lag, instead of the two being drawn independently. Top oil
    chases a load-and-ambient target with a first-order lag; hot spot sits
    above it by a gradient that grows with load (RESEARCH §3.3).
    """
    for dev, meta in XFMR_META.items():
        rated = meta['rated']
        key = 'auto_load_mva' if meta['kind'] == 'bulk' else 'xfmr_load_mva'
        mva = SERIES[dev][key]
        SERIES[dev]['xfmr_loading_pct'] = [100.0 * v / rated for v in mva]
        r = rng_for(dev, 'to')
        top, hot, fans, rad = [], [], [], []
        to = AMBIENT[0] + 12.0 + 44.0 * (mva[0] / rated) ** 2
        for i in range(N):
            ld = mva[i] / rated
            to += (AMBIENT[i] + 12.0 + 44.0 * ld * ld - to) * 0.14
            top.append(to + r.gauss(0, 0.12))
            hot.append(top[-1] + 12.0 + 20.0 * ld * ld)
            fans.append(float(0 if ld < 0.45 else 4 if ld < 0.62 else 8 if ld < 0.78 else 12))
            rad.append(8.5 + 7.0 * ld)
        SERIES[dev]['top_oil_temp_c'] = top
        SERIES[dev]['winding_hotspot_temp_c'] = hot
        cool = f'{dev}_COOL'
        SERIES[cool]['cooling_fans_running_n'] = fans
        SERIES[cool]['radiator_dt_c'] = [v + x for v, x in
                                         zip(rad, ar1(rng_for(cool, 'r'), N, 0.0, 0.25, 0.9))]


thermal_pass()


# ─────────────────────────────────────────────────────────────────────────────
# §8  Derived quantities, rounding, rollups, status, items
# ─────────────────────────────────────────────────────────────────────────────

def derive_loadings():
    """Currents and loading percentages, after the scenarios have moved flows."""
    for bay, meta in BAY_META.items():
        t = BY_ID[bay]['assetType']
        if t in ('ehv_line_bay', 'hv_line_bay', 'sub_line_bay', 'gen_tie_bay'):
            kv = meta['kv']
            mw_key, q_key, a_key = {
                345: ('ehv_mw_flow_mw', 'ehv_mvar_flow_mvar', 'ehv_current_a'),
                138: ('mw_flow_mw', 'mvar_flow_mvar', 'line_current_a'),
                69: ('sub_mw_flow_mw', 'sub_mvar_flow_mvar', 'sub_current_a'),
            }[kv]
            mw, q = SERIES[bay][mw_key], SERIES[bay][q_key]
            amps, load, pctg = [], [], []
            for i in range(N):
                mva = math.hypot(mw[i], q[i])
                amps.append(mva * 1000.0 / (math.sqrt(3) * kv))
                load.append(100.0 * mva / meta['normal'])
                pctg.append(100.0 * mva * ctg_k(bay, i, CTG_BASE_LINE) / meta['emerg'])
            SERIES[bay][a_key] = amps
            SERIES[bay]['loading_pct'] = load
            SERIES[bay]['post_ctg_loading_pct'] = pctg
        elif t in ('autotransformer_bay', 'transformer_bay'):
            dev = meta['xfmr']
            key = 'auto_load_mva' if 'auto_load_mva' in SERIES[dev] else 'xfmr_load_mva'
            ld = SERIES[dev][key]
            SERIES[bay]['loading_pct'] = [100.0 * v / meta['normal'] for v in ld]
            SERIES[bay]['post_ctg_loading_pct'] = [
                100.0 * ld[i] * ctg_k(bay, i, CTG_BASE_XFMR) / meta['emerg'] for i in range(N)]


# Contingency severity: how much worse an element gets under the worst single
# contingency in the study set, as a multiple of its present flow. It is a
# function of TIME, because the study set itself changes when the topology
# does: losing Orrin–Larkspur at 10:15 leaves the elements around it carrying
# the next outage alone, and closing the Navarre–Dunmore tie at 11:20 shares
# some of that exposure back out — and pushes a little of it onto Bexhill.
CTG_BASE_LINE, CTG_BASE_XFMR = 1.205, 1.165
LOCKOUT_I, TIE_I = at(S['S05']['start']), at(S['S06']['tie'])
# element: (after the lockout, after the tie closes)
CTG_EXPOSED = {
    'VESPER_LARKSPUR_BAY_WYNDHAM138': (1.60, 1.49), 'VESPER_WYNDHAM_BAY_LARKSPUR138': (1.60, 1.49),
    'VESPER_LARKSPUR_BAY_WEXFORD138': (1.52, 1.44), 'VESPER_WEXFORD_BAY_LARKSPUR138': (1.52, 1.44),
    'VESPER_LARKSPUR_T1': (1.40, 1.31),
    'VESPER_BEXHILL_BAY_ORRIN138': (1.38, 1.44), 'VESPER_ORRIN_BAY_BEXHILL138': (1.38, 1.44),
    'VESPER_BEXHILL_T1': (1.21, 1.35),
    'VESPER_LARKSPUR_BAY_DUNMORE69': (1.41, 1.30), 'VESPER_DUNMORE_BAY_LARKSPUR69': (1.41, 1.30),
    'VESPER_NAVARRE_BAY_DUNMORE69': (1.21, 1.37), 'VESPER_DUNMORE_BAY_NAVARRE69': (1.21, 1.37),
}


def ctg_k(bay, i, base):
    if bay not in CTG_EXPOSED:
        return base
    after, post_tie = CTG_EXPOSED[bay]
    if i < LOCKOUT_I:
        return base
    if i < TIE_I:
        return ramp(i, LOCKOUT_I, LOCKOUT_I + 2, base, after)
    return ramp(i, TIE_I, TIE_I + 2, after, post_tie)


derive_loadings()


def round_all():
    for aid, blk in SERIES.items():
        for k, v in blk.items():
            dec = P[k].get('decimals', 3)
            lo, hi = P[k]['range']
            blk[k] = [round(clamp(x, lo, hi), dec) for x in v]


round_all()


def descendants(aid):
    out, stack = [], list(KIDS.get(aid, []))
    while stack:
        c = stack.pop()
        out.append(c)
        stack.extend(KIDS.get(c, []))
    return out


ROLLUP_SRC = {'ehv_line_bay', 'hv_line_bay', 'sub_line_bay', 'gen_tie_bay',
              'autotransformer_bay', 'transformer_bay'}


def rollups():
    for a in ASSETS:
        if a['assetLevel'] not in ('substation', 'district', 'network'):
            continue
        kids = descendants(a['id'])
        srcs = [c for c in kids if BY_ID[c]['assetType'] in ROLLUP_SRC]
        worst = [round(max(SERIES[c]['post_ctg_loading_pct'][i] for c in srcs), 3) for i in range(N)]
        put(a['id'], 'worst_post_ctg_loading_pct', worst)
        loads = [c for c in kids if BY_ID[c]['assetType'] == 'load_bay']
        if loads:
            put(a['id'], 'served_load_mw',
                [round(sum(SERIES[c]['served_load_mw'][i] for c in loads), 3) for i in range(N)])
        # N-1 violations: how many elements are above 100 % post-contingency
        put(a['id'], 'n1_violations_n',
            [float(min(10, sum(1 for c in srcs if SERIES[c]['post_ctg_loading_pct'][i] > 100.0)))
             for i in range(N)])


rollups()

VALUES = {}
for aid, blk in SERIES.items():
    VALUES[aid] = {k: v[-1] for k, v in blk.items()}
for aid, blk in STATIC.items():
    VALUES.setdefault(aid, {}).update(blk)


# ── unit status ─────────────────────────────────────────────────────────────
OPEN_BY_UNIT = {}
for k, sc in S.items():
    if sc['outcome'] == 'none':
        u = unit_of(sc['asset'])
        if u:
            OPEN_BY_UNIT.setdefault(u, []).append(since_minutes(sc['start']))

STATION_MODE = {
    'ALDERGATE': ('attention', 'STEADY'), 'WYNDHAM': ('attention', 'STEADY'),
    'KESSLER': ('attention', 'RAMP_UP'), 'THORNE': ('attention', 'STEADY'),
    'BEXHILL': ('running', 'RAMP_UP'), 'ORRIN': ('attention', 'CONTROLLED_HOLD'),
    'LARKSPUR': ('attention', 'RAMP_UP'), 'WEXFORD': ('running', 'STEADY'),
    'COLVIN': ('attention', 'STEADY'), 'PELL': ('running', 'MAINTENANCE'),
    'NAVARRE': ('running', 'STEADY'), 'DUNMORE': ('changeover', 'CHANGEOVER'),
    'TILBURY': ('running', 'STEADY'),
}
# Units with nothing open date their state from the start of shift, except
# Dunmore, which has been backfed through the closed tie since 11:20.
STATUS_SINCE = {'DUNMORE': since_minutes('11:20')}
PRODUCT = {'bulk_substation': '345 kV bulk transfer',
           'subtransmission_substation': '138 kV supply',
           'supply_substation': '69 kV distribution supply'}

UNIT_STATUS = {}
for sid, sname, did, kind, tags, extra in SUBSTATIONS:
    uid = f'VESPER_{sid}'
    state, mode = STATION_MODE[sid]
    mins = max(OPEN_BY_UNIT.get(uid, [0])) if uid in OPEN_BY_UNIT else None
    if mins is None:
        live = [since_minutes(sc['start']) for sc in S.values()
                if unit_of(sc['asset']) == uid and sc['outcome'] == 'recovering']
        mins = max(live) if live else STATUS_SINCE.get(sid, since_minutes('08:00'))
    UNIT_STATUS[uid] = {'state': state,
                        'statusSinceMinutes': mins,
                        'mode': mode, 'product': PRODUCT[SUB_TYPE[kind]]}


# ── attention items ─────────────────────────────────────────────────────────
def fmt(key, value):
    dec = P[key].get('decimals', 2)
    unit = P[key]['unit']
    return f'{value:.{dec}f}{(" " + unit) if unit else ""}'


def evidence(sc, labels):
    pts, vals = [], []
    ser = SERIES[sc['asset']][sc['prop']]
    for t in sc['evid']:
        v = ser[at(t)]
        vals.append(v)
        pts.append({'time': t, 'value': fmt(sc['prop'], v), 'label': labels.get(t, '')})
    return vals, pts


NARR = {
    'S01': dict(
        signal='Aldergate T1 345 kV bushing C1 power factor still climbing',
        ai='C1 power factor on the A-phase 345 kV bushing has risen from 0.376 % at 09:30 to {last}, with '
           'capacitance deviation and leakage current moving with it. Three independent bushing measurements '
           'trending together points at the condenser core, not the instrument.',
        labels={'09:30': 'Baseline', '12:30': 'Doubled from baseline', '13:30': 'Doble scheduled', '14:05': 'Now'},
        detail_signal='C1 power factor {last} against a 0.376 % baseline at 09:30 — it doubled at 12:30 and is '
                      'still rising. Capacitance deviation is up from 0.50 % to 4.19 % and leakage current from '
                      '43.4 mA to 59.7 mA.',
        observed='C1 power factor, capacitance deviation and leakage current on the A-phase 345 kV bushing are '
                 'all rising monotonically since 09:30. B and C phase bushings are flat. Top oil 64.6 °C, normal '
                 'for the load, and T1 is only at 68 % of nameplate.',
        derived='Power factor has doubled from this bushing\u2019s own baseline, which is the published trigger for '
                'closer monitoring; a tripling is the trigger to remove from service. Capacitance deviation is '
                'still under the 5 % investigate threshold but rising faster than power factor, which is the '
                'order you expect when grading layers short.',
        inferred='Moisture ingress or partial discharge shorting grading layers in the condenser core. Shorted '
                 'layers raise capacitance, which is what the deviation trend shows.',
        recommendation='Doble power factor and capacitance test at the next outage window, corrected to 20 °C and '
                       'compared against nameplate and the sister phases. Treat monitored evolution as '
                       'unpredictable: documented cases run from ten days of warning down to minutes.',
        changed_summary='Bushing monitor alerts at 09:30 and 12:30; no switching or load change on T1.',
        changed=[('09:30', 'Alarm', 'Bushing monitor first-stage alert on A-phase C1 power factor', True),
                 ('12:30', 'Alarm', 'Second-stage alert: power factor doubled from baseline', True),
                 ('13:30', 'Maintenance', 'Doble test added to the Saturday outage request', True)],
        occ=[{'date': '2026-03-18', 'summary': 'Wyndham T1 C-phase bushing replaced after a similar power factor '
                                               'trend; core found wet at teardown.'}],
        confidence='Three independent bushing measurements agree', conf='high',
        risk='High — bushing failure takes the transformer and can damage adjacent plant', risk_lvl='high',
        expected='Power factor continues to rise until the bushing is replaced.'),
    'S02': dict(
        signal='Kessler T2 combustible gas rate creeping up',
        ai='TDCG rate of change has climbed from 1.77 ppm/day at 08:10 to {last}, with ethylene and hydrogen '
           'rising together and acetylene flat. That gas pattern is thermal, not arcing.',
        labels={'08:10': 'Baseline', '10:50': 'Rate doubled', '12:10': 'Ethylene confirms', '14:05': 'Now'},
        detail_signal='TDCG rate {last} against 1.77 ppm/day this morning. Ethylene 41.6 ppm (from 13.9), '
                      'hydrogen 90.0 ppm (from 31.7), total combustible gas 363.1 ppm, acetylene unchanged at '
                      '0.27 ppm.',
        observed='Ethylene, hydrogen and total combustible gas all rising through the shift on T2 only. '
                 'Acetylene flat. T2 load and winding temperature are normal for the day, and T1 next to it '
                 'shows nothing.',
        derived='Rising methane, ethane and ethylene with no acetylene is the published thermal-fault signature. '
                'The rate is still well below the 30 ppm/day action level, so this is a trend to track rather '
                'than a reason to remove the bank.',
        inferred='A developing local hot spot — a loose joint or a blocked oil duct is the usual cause at this '
                 'gas pattern. Not yet confirmed.',
        recommendation='Resample from the main tank within 24 hours and confirm the rate rather than the absolute '
                       'values. Run Duval triangle on the confirmed sample. Keep T2 loaded normally meanwhile.',
        changed_summary='No switching, no load change on T2 — the gas trend is the only thing that moved.',
        changed=[('08:10', 'Event', 'Online DGA monitor rate-of-change advisory on T2', True),
                 ('11:15', 'Field Check', 'Infrared scan of T2 bushings and leads found nothing external', True)],
        occ=[],
        confidence='Single online monitor, not yet confirmed by lab sample', conf='medium',
        risk='Medium — slow-evolving, but the gas pattern is unambiguous', risk_lvl='medium',
        expected='Lab resample confirms or clears the rate before end of week.'),
    'S03': dict(
        signal='Larkspur 138 kV bus CVT reading low — nothing else agrees',
        ai='The A-phase bus CVT drifted {last} away from the redundant relay measurement with no corresponding '
           'movement in MW, MVAr, line current or the adjacent bus. A real voltage change moves every '
           'measurement together; this one moved alone.',
        labels={'09:00': 'Baseline', '11:35': 'Past 5 % alarm', '12:10': 'Auto control blocked', '14:05': 'Now'},
        detail_signal='Redundant measurement deviation {last}, past the 5 % alarm threshold at 11:35, while angle '
                      'deviation stayed under 2°. Secondary voltage fell from 68.01 V to 63.80 V over the same '
                      'window.',
        observed='One CVT secondary drifting down since 09:00. The redundant relay on the same bus, the '
                 'Wyndham–Larkspur line CVT, the 138 kV MW and MVAr flows and the 69 kV bus voltage are all '
                 'unchanged.',
        derived='Magnitude deviation above 0.05 pu between two relays on the same bus, with angle deviation under '
                'the 10° threshold, is the published instrument-fault signature rather than a system event.',
        inferred='Capacitor elements shorting in the CVT stack, which lowers the ratio. Moisture in the stack '
                 'gives the same signature.',
        recommendation='Automatic voltage control using this CVT was blocked at 12:10 so the tap changer stops '
                       'chasing a voltage that was never wrong. Replace the CVT at the next clearance; offline '
                       'capacitance should be within 1–2 % of nameplate.',
        changed_summary='Auto voltage control blocked on this input at 12:10; the drift stopped mattering.',
        changed=[('09:00', 'Event', 'Redundant measurement deviation advisory raised', True),
                 ('11:35', 'Alarm', 'Deviation crossed the 5 % alarm threshold', True),
                 ('12:10', 'Operator Action', 'Blocked Larkspur bus CVT as a voltage control source', True)],
        occ=[{'date': '2026-05-02', 'summary': 'Kessler 345 kV line CVT replaced for the same slow ratio drift.'}],
        confidence='Confirmed by redundant measurement cross-check', conf='high',
        risk='Low — caught before the voltage control scheme acted on it', risk_lvl='low',
        expected='Bus voltage regulation unaffected; CVT replaced at the next clearance.'),
    'S04': dict(
        signal='Wyndham T1 tap changer hunting',
        ai='Tap operations per day jumped from 4.6 to a peak of 57.5 after 09:50, with the tap oscillating either '
           'side of its normal position and no net drift, and it held there for three hours. Regulated voltage '
           'never left its band, so nothing looked wrong on the voltage gauge — the wear was the whole story.',
        labels={'09:45': 'Normal', '10:10': 'Hunting', '12:55': 'Bandwidth widened', '14:05': 'Now'},
        detail_signal='Tap operations per day peaked at 57.5 against a normal 4.6, with tap position cycling ±2 '
                      'steps. Since the bandwidth change at 12:45 the rate is back to {last}.',
        observed='Tap position oscillating ±2 steps with no net direction from 09:50. Regulated 138 kV bus '
                 'voltage stayed inside band throughout. The paralleled Aldergate T1 was tapping in counter-phase '
                 'over the same window.',
        derived='Bandwidth was set at 1.5 V against a 0.75 V per step regulator — less than the two steps required '
                'to prevent hunting. At the peak rate this bank would consume its 50,000–100,000 operation '
                'maintenance interval years early.',
        inferred='Control bandwidth too narrow, aggravated by the parallel bank fighting it.',
        recommendation='Bandwidth widened to 2.0 V at 12:45 and the time delay lengthened to 30 s. Review the '
                       'paralleling scheme and the line-drop compensation settings before the next hot spell.',
        changed_summary='Bandwidth widened from 1.5 V to 2.0 V and the time delay set to 30 s at 12:45.',
        changed=[('09:50', 'Event', 'Tap operation rate advisory on T1', True),
                 ('10:10', 'Event', 'Operation rate settled near 57/day', True),
                 ('12:45', 'Setpoint Change', 'Voltage regulator bandwidth 1.5 V \u2192 2.0 V, delay 20 s \u2192 30 s', True)],
        occ=[{'date': '2026-06-09', 'summary': 'Same bank hunted for two days after a paralleling scheme change; '
                                               'settings were reverted.'}],
        confidence='Confirmed by tap position and bandwidth review', conf='high',
        risk='Medium — no operational risk, but contact wear was accumulating fast', risk_lvl='medium',
        expected='Operation rate settles near 12–15/day over the next few hours.'),
    'S05': dict(
        signal='Orrin\u2013Larkspur 138 kV locked out after a failed reclose',
        ai='A single-phase-to-ground fault at 10:15 tripped both ends. The one reclose attempt failed and the '
           'lockout relay operated, so the circuit is out of service and out of the contingency set. Line patrol '
           'is en route.',
        labels={'10:10': 'Pre-fault', '10:15': 'Fault and trip', '10:20': 'Reclose failed \u2014 lockout',
                '14:05': 'Still out'},
        detail_signal='Flow went from 56.2 MW to zero in one scan at 10:15. The breaker operations counter stepped '
                      'by 2, the reclose counter by 1, and accumulated interrupted energy by 3.84 kA\u00b2s.',
        observed='Both ends open and locked out since 10:20. Every 138 kV bus registered a voltage dip in the '
                 'same scan — 0.063 pu at Orrin, 0.058 pu at Larkspur, 0.018 pu at Aldergate — and all recovered '
                 'on fault clearing.',
        derived='Sag depth falls off with electrical distance from the fault and every bus saw it simultaneously, '
                'which is consistent with a fault on this circuit rather than a local problem at either station.',
        inferred='A permanent fault. Most transmission faults are temporary and clear on the first reclose; this '
                 'one did not, so there is something physically on the line.',
        recommendation='Patrol between structures 41 and 78 first, where the fault locator puts it. Hold the '
                       'restricted configuration until the circuit is back: the binding contingency is now the '
                       'Wyndham\u2013Larkspur circuit, not this one.',
        changed_summary='Circuit tripped, reclosed unsuccessfully and locked out; configuration restricted since.',
        changed=[('10:15', 'Event', 'A-phase to ground fault, both ends tripped', True),
                 ('10:20', 'Event', 'Reclose attempt unsuccessful \u2014 86 lockout operated', True),
                 ('10:35', 'Operator Action', 'Restricted configuration declared for Harrow District', True),
                 ('11:05', 'Field Check', 'Line patrol dispatched to structures 41\u201378', True)],
        occ=[{'date': '2026-07-02', 'summary': 'Same circuit tripped and reclosed successfully during a storm cell.'}],
        confidence='Confirmed by relay event report and fault locator', conf='high',
        risk='High — the network is running on one path where it had two', risk_lvl='high',
        expected='Circuit restored once the patrol finds and clears the cause.'),
    'S06': dict(
        signal='Larkspur exposed on the next contingency',
        ai='With Orrin\u2013Larkspur out, the flow it carried is arriving the long way round. Larkspur\u2019s worst '
           'post-contingency loading crossed 100 % of emergency rating at 10:35 and peaked at 105.1 % at 11:20. '
           'Closing the Navarre\u2013Dunmore tie pulled it back under, but the margin is gone.',
        labels={'10:10': 'Before the lockout', '10:20': 'Flow redistributed', '11:05': 'Above 100 %',
                '11:20': 'Tie closed', '14:05': 'Now'},
        detail_signal='Worst N-1 post-contingency loading peaked at 105.1 % of emergency rating at 11:20 and is '
                      '{last} now. Pre-contingency loading peaked at 86.0 % — nothing is actually overloaded.',
        observed='Wyndham\u2013Larkspur went from 105.5 MW to 140.7 MW and Larkspur\u2013Wexford from 30.5 MW to 48.1 MW '
                 'within three scans of the lockout. Larkspur T1 rose from 36.0 MVA to 61.9 MVA. Closing the '
                 '69 kV tie at 11:20 moved 11.2 MW to Navarre and took T1 back to 51.7 MVA.',
        derived='The binding contingency is now loss of Wyndham\u2013Larkspur, which would put Larkspur T1 and the '
                'Larkspur\u2013Wexford circuit above their emergency ratings. Closing the tie transferred load but '
                'also put 8.1 MVA onto Bexhill T1, whose own worst case is now 97.3 % — the exposure moved '
                'rather than disappearing.',
        inferred='This is redistribution, not a fault: flow divides by impedance, and the 138 kV network was '
                 'never sized to carry what the lost circuit was carrying.',
        recommendation='Hold the restricted configuration and keep the tie closed until Orrin\u2013Larkspur is back. '
                       'Defer any switching in Harrow District that would take a second element out. Watch '
                       'Bexhill T1, which is now the second most exposed element.',
        changed_summary='Tie closed at 11:20 to relieve Larkspur T1; exposure partly transferred to Bexhill.',
        changed=[('10:15', 'Event', 'Orrin\u2013Larkspur 138 kV lockout \u2014 flow redistributed', True),
                 ('10:35', 'Alarm', 'Worst post-contingency loading crossed 100 % of emergency rating', True),
                 ('11:20', 'Operator Action', 'Closed the normally-open Navarre\u2013Dunmore 69 kV tie', True),
                 ('11:40', 'Event', 'Bexhill T1 loading up 8.1 MVA as a result of the transfer', True)],
        occ=[{'date': '2026-08-11', 'summary': 'Same circuit out for planned work; the tie was closed then too, '
                                               'with the same transfer to Bexhill.'}],
        confidence='Confirmed by contingency analysis and measured flows', conf='high',
        risk='High — no margin for a second element loss in Harrow District', risk_lvl='high',
        expected='Margin returns when Orrin\u2013Larkspur is restored.'),
    'S07': dict(
        signal='Dunmore 69 kV bus voltage sagged — cause was two stations away',
        ai='Dunmore\u2019s 69 kV bus fell to 0.943 pu, below the 0.95 pu pre-contingency floor. Nothing at Dunmore '
           'changed: the Wyndham 138 kV capacitor bank tripped on neutral unbalance at 09:40, and Dunmore is the '
           'electrically weakest point behind it.',
        labels={'09:35': 'Normal', '09:40': 'Cap bank trips', '10:25': 'Lowest point',
                '10:40': 'Taps raised', '14:05': 'Now'},
        detail_signal='Bus voltage 1.007 pu \u2192 0.943 pu at its lowest, against a 0.95 pu pre-contingency floor. '
                      'Recovered to 0.977 pu after the tap change at 10:35 and is {last} now.',
        observed='Wyndham capacitor bank neutral unbalance current stepped from 0.144 A to 1.314 A at 09:40 and '
                 'stayed there; the bank went out in the same scan. Dunmore sagged 0.064 pu, Larkspur 69 kV '
                 '0.044 pu, and Wyndham\u2019s own 138 kV bus only 0.018 pu.',
        derived='The deepest sag is furthest from the cause, which is normal for a reactive loss: voltage falls '
                'where the network is weakest, not where the equipment failed. A step in neutral unbalance that '
                'does not return is a failed capacitor can and its fuse, not a measurement drift.',
        inferred='One capacitor can failed and its fuse operated, unbalancing the bank enough to trip it. The next '
                 'failure in the same phase group will come sooner than this one did.',
        recommendation='Larkspur and Colvin taps were raised two steps at 10:35 as the interim fix. Inspect the '
                       'bank, find the failed can, and re-baseline the inherent unbalance before returning it. '
                       'Until then Wyndham and Thorne are short of reactive reserve.',
        changed_summary='Wyndham capacitor bank tripped on neutral unbalance; taps raised to recover 69 kV voltage.',
        changed=[('09:40', 'Event', 'Wyndham 138 kV capacitor bank tripped on neutral unbalance', True),
                 ('09:55', 'Alarm', 'Dunmore 69 kV undervoltage advisory', True),
                 ('10:35', 'Operator Action', 'Raised Larkspur and Colvin tap positions two steps', True)],
        occ=[{'date': '2025-09-30', 'summary': 'Same bank lost a can; the unbalance step was about the same size.'}],
        confidence='Confirmed by the timing of the unbalance step', conf='high',
        risk='Low — voltage recovered, but the bank is out and reserve is thin', risk_lvl='low',
        expected='Voltage holds with the raised taps until the bank is repaired.'),
    'S08': dict(
        signal='Five momentary faults on Wexford\u2013Tilbury 69 kV this shift',
        ai='The circuit auto-reclosed successfully five times between 08:25 and 12:00. No customer was '
           'interrupted and no single event was worth an alarm, but the pattern is well above this circuit\u2019s '
           'normal rate and the breaker has been accumulating wear.',
        labels={'08:10': 'Baseline', '08:25': 'First event', '12:00': 'Fifth', '14:05': 'Quiet since patrol'},
        detail_signal='Reclose counter {last} against 5 at the start of shift — events at 08:25, 09:15, 10:05, '
                      '11:10 and 12:00. Accumulated interrupted energy is up 2.10 kA\u00b2s and contact wear up 1.8 '
                      'points over the same period.',
        observed='Each event is a successful reclose within a second; Tilbury 69 kV registered a 0.043 pu dip at '
                 'each one and Wexford 0.028 pu. Nothing since the 12:20 patrol.',
        derived='Five momentaries in under four hours against a normal rate of about one a week. Momentary '
                'outages last under a minute by definition, which is why none of them reached the outage log.',
        inferred='Something intermittent on the line — vegetation or wildlife. Repeated temporary faults on one '
                 'circuit usually become a permanent one.',
        recommendation='The patrol found and cleared a limb contacting the B phase near structure 22 at 12:20. '
                       'Keep the circuit on watch to end of shift and raise a vegetation work order for the span.',
        changed_summary='Line patrol cleared a limb at structure 22 at 12:20; no events since.',
        changed=[('08:25', 'Event', 'First successful auto-reclose', True),
                 ('11:10', 'Event', 'Fourth event \u2014 pattern escalated to a work order', True),
                 ('12:20', 'Maintenance', 'Patrol cleared vegetation contact at structure 22', True)],
        occ=[{'date': '2026-06-27', 'summary': 'Same span produced three momentaries before a limb was removed.'}],
        confidence='Confirmed by patrol', conf='high',
        risk='Low — caught before it became a permanent fault', risk_lvl='low',
        expected='No further events; the span is added to the vegetation plan.'),
    'S09': dict(
        signal='Kessler T1 winding hot spot climbing on the afternoon ramp',
        ai='Hot spot rose from 73.7 °C at 10:20 to 107.9 °C at 12:50 as ambient and load climbed together. All '
           'twelve fans were already running, and T1 was carrying 54 MVA more than T2 — the two banks were not '
           'sharing the extra load evenly.',
        labels={'10:20': 'Ramp starts', '12:35': '105 °C alert', '12:50': 'Peak',
                '13:10': 'Recovering', '14:05': 'Now'},
        detail_signal='Winding hot spot 73.7 °C \u2192 107.9 °C between 10:20 and 12:50, past the 105 °C alert at '
                      '12:35 and against a 110 °C continuous limit for a 65 °C rise unit. Loading peaked at '
                      '93.9 % of nameplate with ambient at 32.1 °C. It is {last} now.',
        observed='All cooling stages ran from the start of the ramp and top oil followed the hot spot at the '
                 'expected gradient, so the cooling was working — there simply was not any more of it. T1 was at '
                 '140.8 MVA against T2\u2019s 87.1 MVA at 12:45 on identical 150 MVA banks.',
        derived='Hot spot tracked the value calculated from load and ambient within 2 °C throughout, which rules '
                'out a cooling fault and confirms genuine overload. Aging roughly doubles for every 6 °C above '
                'the design point, so the excursion costs real life even though nothing tripped.',
        inferred='Load plus ambient, made worse by unequal sharing between the paralleled banks. The '
                 'redistributed flow after the Orrin\u2013Larkspur lockout put more through Kessler than the day '
                 'would otherwise have done, and the tap mismatch sent most of it to T1.',
        recommendation='Taps were rebalanced at 12:50 and both banks now sit near 116.6 MVA, with the hot spot '
                       'back under 100 °C. Keep them matched until ambient drops, and check the paralleling '
                       'settings before the morning ramp rather than during it.',
        changed_summary='Tap positions rebalanced at 12:50; the banks now share evenly and the hot spot is falling.',
        changed=[('10:20', 'Event', 'Load and hot spot rise began with the redistribution', True),
                 ('12:35', 'Alarm', 'Winding temperature alert at 105 °C', True),
                 ('12:50', 'Operator Action', 'Rebalanced T1/T2 tap positions \u2014 24 MVA moved to T2', True)],
        occ=[{'date': '2026-07-19', 'summary': 'T1 reached 106 °C on the July peak day; same mitigation used.'}],
        confidence='Confirmed against the calculated hot spot', conf='high',
        risk='Medium — brief excursion, small loss of life, no damage', risk_lvl='medium',
        expected='Hot spot stays below 100 °C through the evening peak with the banks matched.'),
    'S10': dict(
        signal='Thorne reactive reserve nearly gone while MW flows look comfortable',
        ai='Thorne\u2019s 345 kV circuits are at 57 % and 34 % of normal rating and nothing on the MW display looks '
           'wrong. The reactive reserve behind those flows has fallen from 168.5 MVAr to {last} — the Wyndham '
           'bank is out and the shunt reactor is now committed.',
        labels={'09:35': 'Normal', '09:45': 'Capacitor bank lost', '11:25': 'Reactor committed',
                '11:40': 'Below target', '14:05': 'Now'},
        detail_signal='Reactive reserve {last} against a 120 MVAr operating target and 168.5 MVAr this morning. '
                      'It stepped down 52 MVAr when the Wyndham bank tripped at 09:40 and slid a further '
                      '73 MVAr between 11:10 and 11:40. MW loading is unchanged.',
        observed='Wyndham\u2019s 50 MVAr capacitor bank has been out since 09:40, taking Wyndham\u2019s own reserve from '
                 '161.2 MVAr to 109.9 MVAr as well. Thorne\u2019s switchable reactive fell a further 41 MVAr as the '
                 'reactor was committed to holding 345 kV voltage through the ramp.',
        derived='Real power headroom and reactive headroom are not the same headroom. The loading percentage '
                'everyone watches says there is plenty of room; the reactive reserve says the next voltage '
                'event has almost nothing left to answer it with.',
        inferred='Not a fault. The reserve was consumed by the capacitor bank outage and the afternoon ramp, and '
                 'no single display shows both halves of it.',
        recommendation='Restore the Wyndham bank as the first priority — it is worth more here than any '
                       'redispatch. Until then, treat a voltage event in Keldon or Harrow as unbacked, and '
                       'pre-position the Thorne reactor out of service rather than in.',
        changed_summary='Capacitor bank outage plus the afternoon ramp consumed the reserve; MW flows unchanged.',
        changed=[('09:40', 'Event', 'Wyndham capacitor bank out \u2014 50 MVAr of support lost', True),
                 ('11:40', 'Alarm', 'Reactive reserve fell below the 120 MVAr operating target', True)],
        occ=[],
        confidence='Derived from reactive plant status, not measured directly', conf='medium',
        risk='Medium — nothing is wrong now, and little is available if it goes wrong', risk_lvl='medium',
        expected='Reserve recovers when the Wyndham bank returns.'),
    'S11': dict(
        signal='Colvin 69 kV voltage distortion drifting toward the limit',
        ai='Total harmonic distortion on the Colvin 69 kV bus has drifted from 0.97 % to {last} through the day '
           'while voltage, flows and every equipment temperature stayed normal. The IEEE 519 limit for this '
           'voltage class is 2.5 %.',
        labels={'09:05': 'Baseline', '11:05': 'Halfway to limit', '13:05': 'Still rising', '14:05': 'Now'},
        detail_signal='Bus THD {last} against a 2.5 % limit for 69 kV, up from 0.97 % at 09:05. Negative sequence '
                      'voltage has risen 0.43 points over the same window, and Tilbury one circuit away is up '
                      '0.56 points.',
        observed='Distortion rising steadily at Colvin and, more weakly, at Tilbury. Bus voltage, MW and MVAr '
                 'flows and transformer temperatures are all normal.',
        derived='The rise tracks the load ramp, and the distortion is worse closer to Colvin, so the source is '
                'downstream of Colvin rather than on the 138 kV system.',
        inferred='A customer drive load that has come on and is running without its filter bank. Not confirmed '
                 'with the customer yet.',
        recommendation='Put a power quality recorder on the Colvin 69 kV bus before the evening peak and contact '
                       'the customer about filter status. If it reaches 2.5 % the limit is absolute regardless of '
                       'who caused it.',
        changed_summary='Nothing switched; distortion has simply tracked upward with load since 09:05.',
        changed=[('09:05', 'Event', 'Power quality advisory raised on the Colvin 69 kV bus', True),
                 ('13:05', 'Event', 'Distortion passed 2.0 %, still below the limit', True)],
        occ=[{'date': '2026-04-15', 'summary': 'Colvin reached 2.3 % during a customer commissioning test.'}],
        confidence='Source inferred from the distortion gradient, not confirmed', conf='medium',
        risk='Medium — the limit is absolute and the evening peak is still ahead', risk_lvl='medium',
        expected='Distortion keeps rising with load unless the filter bank is returned.'),
    'S12': dict(
        signal='Bexhill T1 relay test clearance cannot be taken today',
        ai='The Bexhill T1 protection test is due on 31 August under its six-year interval and needs four hours. '
           'With Orrin\u2013Larkspur still out, taking T1 out of service would put Harrow District above 100 % post '
           'contingency — and there are under four hours of switching window left.',
        labels={'13:40': 'Clearance reviewed', '13:50': 'Contingency checked', '14:05': 'Now'},
        detail_signal='District worst post-contingency loading {last} with T1 in service. The study with T1 out '
                      'returns 118 % on the Bexhill\u2013Orrin circuit. Time needed 4h 00m; time left in the '
                      'switching window 3h 55m.',
        observed='The clearance request was reviewed at 13:40 and the contingency study run at 13:50. Both the '
                 'margin and the clock fail.',
        derived='Time needed exceeds time left even before the contingency result, so this is a scheduling '
                'problem first and a reliability problem second. The compliance date is still three days out.',
        inferred='Not an equipment problem at all — a plan that assumed the network would be intact.',
        recommendation='Defer the clearance to Saturday and pair it with the Aldergate T1 bushing Doble test, '
                       'which needs the same crew. If Orrin\u2013Larkspur is not back by Friday, escalate the '
                       'compliance date rather than taking the element out.',
        changed_summary='Clearance reviewed against the current configuration and deferred.',
        changed=[('13:40', 'Documentation', 'Bexhill T1 clearance request reviewed for today', True),
                 ('13:50', 'Event', 'Contingency study with T1 out returned 118 % on Bexhill\u2013Orrin', True)],
        occ=[],
        confidence='Confirmed by the contingency study', conf='high',
        risk='Medium — the compliance date is 31 August, three days out', risk_lvl='medium',
        expected='Clearance rescheduled to Saturday with the network intact.'),
}


def build_attention():
    items = []
    for key in sorted(S):
        sc, nr = S[key], NARR[key]
        aid = sc['asset']
        last = fmt(sc['prop'], SERIES[aid][sc['prop']][-1])
        vals, pts = evidence(sc, nr['labels'])
        u = unit_of(aid)
        above_unit = BY_ID[aid]['assetLevel'] in ('network', 'district')
        resolved = sc['outcome'] == 'resolved'
        t_since = sc.get('fixed') if resolved else sc['start']
        items.append({
            'id': sc['id'],
            'assetId': aid,
            'unitId': None if above_unit else u,
            'primaryProperty': sc['prop'],
            'asset': BY_ID[aid]['name'] if above_unit else label_of(aid),
            'line': BY_ID[aid]['name'] if above_unit else BY_ID[u]['name'],
            'severity': sc['severity'],
            'signal': nr['signal'],
            'aiInterpretation': nr['ai'].format(last=last),
            'since': since_text(t_since, resolved),
            'sinceMinutes': since_minutes(t_since),
            'attentionState': sc['state'],
            'detail': {
                'signal': nr['detail_signal'].format(last=last),
                'observed': nr['observed'],
                'derived': nr['derived'],
                'inferred': nr['inferred'],
                'recommendation': nr['recommendation'],
                'evidence': vals,
                'evidencePoints': pts,
                'relatedOccurrences': nr['occ'],
                'whatChangedSummary': nr['changed_summary'],
                'whatChanged': [{'time': t, 'source': s, 'description': d, 'related': r}
                                for t, s, d, r in nr['changed']],
                'confidence': nr['confidence'],
                'confidenceLevel': nr['conf'],
                'risk': nr['risk'],
                'riskLevel': nr['risk_lvl'],
                'expectedOutcome': nr['expected'],
                'outcomeStatus': sc['outcome'],
            },
        })
    return items


ATTENTION = build_attention()


# ── work items ──────────────────────────────────────────────────────────────
D = TIMELINE['date']


def work(wid, text, desc, asset, wtype, prio, role, planned, due, mins, done,
         completed=None, src_label=None, created='08:00'):
    return {
        'id': wid, 'text': text, 'description': desc,
        'assetId': asset, 'assetLabel': label_of(asset) if asset else None,
        'workType': wtype, 'priority': prio,
        'sourceType': 'situation' if src_label else 'planned',
        'sourceLabel': f'From: {src_label}' if src_label else None,
        'source': 'ai' if src_label else 'operator',
        'assignedRole': role,
        'plannedStart': f'{D}T{planned}:00', 'dueAt': f'{D}T{due}:00',
        'estimatedDurationMinutes': mins,
        'done': done, 'completedAt': f'{D}T{completed}:00' if completed else None,
        'createdAt': f'{D}T{created}:00',
    }


WORK = [
    work('wk-g01', 'Shift turnover and outage log review',
         'Review open clearances, elements out of service and the overnight outage log with the outgoing '
         'transmission operator.', 'VESPER', 'HUDDLE', 'routine', 'Operator',
         '08:00', '08:20', 20, True, '08:18'),
    work('wk-g02', 'Same-day load forecast review',
         'Compare the same-day forecast against actual demand and the ambient trend; confirm the evening peak '
         'assumption still holds.', 'VESPER', 'DOCUMENTATION', 'routine', 'Operator',
         '08:30', '09:00', 25, True, '08:57'),
    work('wk-g03', 'Kessler monthly substation inspection',
         'Monthly walk-down: visual and auditory inspection of primary plant, oil levels, SF6 gauges, yard '
         'condition and security.', 'VESPER_KESSLER', 'INSPECTION', 'routine', 'Substation Technician',
         '09:00', '11:00', 110, True, '10:52'),
    work('wk-g04', 'Pell station battery four-month check',
         'PRC-005 four-month check: verify float voltage, inspect electrolyte levels and station DC grounds, '
         'record per-cell voltages.', 'VESPER_PELL_SS_BATT', 'PROCEDURE', 'important', 'Substation Technician',
         '09:30', '12:00', 90, True, '11:41'),
    work('wk-g05', 'Wyndham T1 annual oil sample',
         'Draw the annual main-tank oil sample for DGA and oil quality; ship to the lab with the LTC sample.',
         'VESPER_WYNDHAM_T1_XFMR', 'SAMPLE', 'routine', 'Substation Technician',
         '10:00', '12:00', 45, True, '11:12'),
    work('wk-g06', 'Larkspur–Dunmore ROW vegetation inspection',
         'Annual vegetation inspection of the 69 kV right of way; record any encroachment toward the minimum '
         'clearance distance.', 'VESPER_LARKSPUR_BAY_DUNMORE69', 'INSPECTION', 'routine', 'Field Operator',
         '10:30', '15:00', 150, False),
    work('wk-g07', 'Bexhill T1 protection test clearance package',
         'Prepare the switching order and clearance package for the six-year protection system test on Bexhill '
         'T1, due 31 August.', 'VESPER_BEXHILL_T1', 'DOCUMENTATION', 'important', 'Relay Technician',
         '13:00', '16:00', 60, False),
    work('wk-g08', 'Doble test Aldergate T1 345 kV bushings',
         'Power factor and capacitance test on all three 345 kV bushings, corrected to 20 °C and compared '
         'against nameplate and the sister phases.', 'VESPER_ALDERGATE_T1_XFMR_BUSH', 'MAINTENANCE', 'urgent',
         'Substation Technician', '13:30', '17:00', 180, False,
         src_label='Aldergate T1 345 kV bushing C1 power factor still climbing', created='13:30'),
    work('wk-g09', 'Resample Kessler T2 main tank for DGA',
         'Confirm the rate of change with a laboratory sample rather than the online monitor; run Duval triangle '
         'on the result.', 'VESPER_KESSLER_T2_XFMR', 'SAMPLE', 'important', 'Substation Technician',
         '11:30', '16:00', 45, False,
         src_label='Kessler T2 combustible gas rate creeping up', created='11:20'),
    work('wk-g10', 'Block Larkspur bus CVT as a voltage control source',
         'Remove the drifting bus CVT from the automatic voltage control scheme so the tap changer stops '
         'chasing it; log the block and raise the replacement request.', 'VESPER_LARKSPUR_BUS138_CVT',
         'PROCEDURE', 'urgent', 'Operator', '12:05', '12:30', 20, True, '12:10',
         src_label='Larkspur 138 kV bus CVT reading low — nothing else agrees', created='11:55'),
    work('wk-g11', 'Widen Wyndham T1 regulator bandwidth',
         'Change voltage regulator bandwidth from 1.5 V to 2.0 V and time delay from 20 s to 30 s; record the '
         'as-left settings.', 'VESPER_WYNDHAM_T1_XFMR_OLTC', 'PROCEDURE', 'important', 'Relay Technician',
         '12:35', '13:15', 30, True, '12:45',
         src_label='Wyndham T1 tap changer hunting', created='12:20'),
    work('wk-g12', 'Patrol Orrin–Larkspur 138 kV, structures 41–78',
         'Ground patrol the fault-located section for a permanent fault; report before any attempt to return '
         'the circuit to service.', 'VESPER_ORRIN_BAY_LARKSPUR138', 'FIELD_CHECK', 'urgent', 'Field Operator',
         '11:05', '15:00', 210, False,
         src_label='Orrin–Larkspur 138 kV locked out after a failed reclose', created='10:40'),
    work('wk-g13', 'Switching order: close Navarre–Dunmore 69 kV tie',
         'Execute the switching order to close the normally-open tie and confirm the resulting flows against '
         'the contingency study.', 'VESPER_NAVARRE_BAY_DUNMORE69', 'PROCEDURE', 'urgent', 'Field Operator',
         '11:05', '11:30', 25, True, '11:20',
         src_label='Larkspur exposed on the next contingency', created='10:50'),
]


# ─────────────────────────────────────────────────────────────────────────────
# §9  Write
# ─────────────────────────────────────────────────────────────────────────────

def write(repo):
    out = os.path.join(repo, 'public', 'data', 'grid')
    os.makedirs(out, exist_ok=True)

    def dump(name, obj):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')

    # depth-first order (spec §6.1)
    ordered, stack = [], [a['id'] for a in ASSETS if a['parentId'] is None]
    while stack:
        cur = stack.pop(0)
        ordered.append(BY_ID[cur])
        stack = KIDS.get(cur, []) + stack

    dump('assets.json', ordered)
    dump('asset-relationships.json', EDGES)
    dump('properties.json', {'properties': P, 'derivations': DERIVATIONS,
                             'typeLabels': TYPE_LABELS})
    dump('asset-values.json', VALUES)
    dump('asset-telemetry.json', {'timeline': TIMELINE, 'timestamps': TS, 'series': SERIES})
    dump('unit-status.json', UNIT_STATUS)
    dump('attention-items.json', ATTENTION)
    dump('work-items.json', WORK)

    n_static = sum(len(v) for v in STATIC.values())
    print(f'grid pack written to {out}')
    print(f'  {len(ASSETS)} assets, {len(set(a["assetType"] for a in ASSETS))} types, '
          f'{len(EDGES)} edges, {len(P)} property keys ({n_static} static values)')
    print(f'  {len(UNIT_STATUS)} units, {len(ATTENTION)} attention items, {len(WORK)} work items, '
          f'{N} points')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', '..', '..')))
    write(ap.parse_args().repo)
