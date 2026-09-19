#!/usr/bin/env python3
"""Boreas Ridge wind farm — generic industry pack generator.

Writes the 8 runtime files of INDUSTRY_PACK_SPEC.md §6 to public/data/wind/
(or the folder given as the first argument). Deterministic: fixed seed, no
inputs, so rerunning it reproduces the pack byte for byte.

    python3 ModelAndData/industries/wind/generate.py [OUTDIR]

Everything the scenarios need (which asset, when it starts, how big) lives
in the SCENARIO constants just below, and SCENARIOS.md describes the same
numbers in prose. Evidence points in attention-items.json are READ BACK from
the generated series, so the story and the data can't disagree.

Physics, deliberately simple (75% realism / 25% demo clarity, spec §2):
- One site wind speed (a winter front: ~10.5 m/s overnight, a lull around
  08:00, 12.8 m/s by 14:00), plus a fixed per-turbine wake offset and noise.
- Power from a tabulated power curve (2.3 MW geared / 3.3 MW direct drive).
- Temperatures chase a target set by load fraction and ambient, with
  thermal lag (first-order, per 10-minute step). Vibration scales with load.
- Rollups (feeder/site power and availability, drivetrain vibration) are
  computed from the child series at every point, as declared in
  properties.json derivations.
"""
import json
import math
import os
import random
import sys

SEED = 20260114
rng = random.Random(SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'public', 'data', 'wind')
SEP = ' · '

# ── Timeline (spec §4.2) — a January day, so icing is physically plausible;
# 10-minute steps, the standard SCADA averaging interval. "Now" = 14:00.
DATE = '2026-01-14'
START, END, STEP = 0, 14 * 60, 10
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
HSB_TURBINE = 'WTG-05'         # BSIT01 — HS bearing degradation (archetype 05)
HSB_START = '06:00'
HSB_RISE_C = 14.0              # extra bearing temperature by "now"
FAN_TURBINE = 'WTG-03'         # BSIT02 — generator cooling fan stopped (07)
FAN_OFF, FAN_RESET = '09:40', '11:20'
TRAFO_TURBINE = 'WTG-10'       # BSIT03 — pad transformer fault trips Feeder 2 (09)
TRAFO_HEAT, FEEDER_TRIP, FEEDER_RESTORE = '09:20', '10:10', '10:50'
ANEMO_TURBINE = 'WTG-12'       # BSIT04 — iced nacelle anemometer (06)
ANEMO_START, ANEMO_FIX = '06:40', '09:50'
CONV_TURBINE = 'WTG-09'        # BSIT05 — converter trip after condensation (11)
CONV_TRIP, CONV_RESTART = '12:30', '13:10'
PITCH_TURBINE = 'WTG-14'       # BSIT06 — pitch battery, recurring safety stops (12)
PITCH_STOPS = ['11:50', '12:40', '13:20', '13:50']
YAW_TURBINE = 'WTG-17'         # BSIT07 — static yaw misalignment after vane swap (08)
YAW_OFFSET_DEG = 11.0
ICE_TURBINE = 'WTG-22'         # BSIT08 — blade icing on Feeder 4 (13)
ICE_START, ICE_PEAK, ICE_CLEAR = '04:30', '07:30', '10:40'
CURTAIL_RECEIVED = '13:45'     # BSIT09 — curtailment instruction (14)
CURTAIL_LIMIT_KW = 45000
MAINT_TURBINE = 'WTG-02'       # planned gearbox oil change, down from 08:30
MAINT_START = '08:30'

# ── Hierarchy (spec §3.1) ────────────────────────────────────────────────
SITE_ID, SITE_NAME = 'BOREAS', 'Boreas Ridge'
FEEDERS = [  # (feeder number, turbine type, turbine count) — phase 1 geared, phase 2 direct drive
    (1, 'wtg_geared', 6),
    (2, 'wtg_geared', 7),
    (3, 'wtg_geared', 6),
    (4, 'wtg_direct_drive', 5),
]
RATED = {'wtg_geared': 2300.0, 'wtg_direct_drive': 3300.0}
SUBSYSTEMS = {
    'wtg_geared': [
        ('ROTOR', 'Rotor', 'rotor', [('PITCH', 'Pitch System', 'pitch_system')]),
        ('DRIVETRAIN', 'Drivetrain', 'drivetrain', [('MAINBRG', 'Main Bearing', 'main_bearing'),
                                                     ('GEARBOX', 'Gearbox', 'gearbox'),
                                                     ('HSBRG', 'HS Bearing', 'hs_bearing')]),
        ('GENERATOR', 'Generator', 'dfig_generator', [('GENBRG', 'Generator Bearing', 'generator_bearing'),
                                                      ('FAN', 'Cooling Fan', 'cooling_fan')]),
        ('CONVERTER', 'Converter', 'converter', []),
        ('YAW', 'Yaw System', 'yaw_system', [('YAWDRIVE', 'Yaw Drive', 'yaw_drive')]),
        ('TRAFO', 'Pad Transformer', 'pad_transformer', []),
    ],
    'wtg_direct_drive': [
        ('ROTOR', 'Rotor', 'rotor', [('PITCH', 'Pitch System', 'pitch_system')]),
        ('MAINSHAFT', 'Main Shaft', 'main_shaft', [('MAINBRG', 'Main Bearing', 'main_bearing')]),
        ('GENERATOR', 'Generator', 'pm_generator', [('FAN', 'Cooling Fan', 'cooling_fan')]),
        ('CONVERTER', 'Converter', 'converter', []),
        ('YAW', 'Yaw System', 'yaw_system', [('YAWDRIVE', 'Yaw Drive', 'yaw_drive')]),
        ('TRAFO', 'Pad Transformer', 'pad_transformer', []),
    ],
}

# ── Property metadata (spec §3.4) ───────────────────────────────────────
PROPS = {
    # site / circuit level
    'farm_power_kw': ('Farm Output', 'kW', 'Flow / WIP', 'P1', [0, 65000], 0),
    'capacity_factor_pct': ('Capacity Factor', '%', 'Derived Metric', 'P1', [0, 100], 1),
    'availability_pct': ('Availability', '%', 'Derived Metric', 'P1', [0, 100], 1),
    'feeder_power_kw': ('Feeder Output', 'kW', 'Flow / WIP', 'P1', [0, 20000], 0),
    'feeder_current_a': ('Feeder Current', 'A', 'Electrical', 'P2', [0, 400], 0),
    'export_power_kw': ('Export Power', 'kW', 'Flow / WIP', 'P1', [0, 65000], 0),
    'poi_voltage_kv': ('POI Voltage', 'kV', 'Electrical', 'P2', [220, 242], 1),
    'reactive_power_kvar': ('Reactive Power', 'kvar', 'Electrical', 'P3', [-15000, 15000], 0),
    'transformer_oil_temp_c': ('Transformer Oil Temperature', '°C', 'Condition', 'P2', [-10, 110], 1),
    'met_wind_speed_ms': ('Reference Wind Speed', 'm/s', 'Environmental', 'P1', [0, 25], 1),
    'wind_direction_deg': ('Wind Direction', '°', 'Environmental', 'P2', [0, 360], 0),
    'ambient_temp_c': ('Ambient Temperature', '°C', 'Environmental', 'P1', [-20, 20], 1),
    'relative_humidity_pct': ('Relative Humidity', '%', 'Environmental', 'P2', [0, 100], 0),
    # turbine level
    'active_power_kw': ('Active Power', 'kW', 'Flow / WIP', 'P1', [0, 3500], 0),
    'wind_speed_ms': ('Nacelle Wind Speed', 'm/s', 'Environmental', 'P1', [0, 25], 1),
    'power_curve_perf_pct': ('Power Curve Performance', '%', 'Derived Metric', 'P2', [0, 130], 1),
    'rated_power_kw': ('Rated Power', 'kW', 'Derived Metric', 'P3', [0, 3500], 0),
    # subsystems and components
    'rotor_speed_rpm': ('Rotor Speed', 'rpm', 'Flow / WIP', 'P1', [0, 20], 1),
    'blade_pitch_angle_deg': ('Blade Pitch Angle', '°', 'Stability', 'P2', [-5, 95], 1),
    'pitch_battery_voltage_v': ('Pitch Battery Voltage', 'V', 'Condition', 'P1', [150, 260], 1),
    'pitch_motor_current_a': ('Pitch Motor Current', 'A', 'Electrical', 'P3', [0, 40], 1),
    'pitch_deviation_deg': ('Blade Pitch Deviation', '°', 'Stability', 'P2', [0, 3], 2),
    'drivetrain_vibration_mms': ('Drivetrain Vibration (max)', 'mm/s', 'Condition', 'P1', [0, 10], 2),
    'bearing_temp_c': ('Bearing Temperature', '°C', 'Condition', 'P1', [-10, 110], 1),
    'vibration_mms': ('Vibration', 'mm/s', 'Condition', 'P2', [0, 10], 2),
    'gearbox_oil_temp_c': ('Gearbox Oil Temperature', '°C', 'Condition', 'P1', [-10, 90], 1),
    'gearbox_oil_pressure_bar': ('Gearbox Oil Pressure', 'bar', 'Condition', 'P3', [0, 6], 2),
    'oil_particle_count': ('Oil Debris Count', 'particles/h', 'Condition', 'P2', [0, 40], 0),
    'generator_speed_rpm': ('Generator Speed', 'rpm', 'Flow / WIP', 'P2', [0, 2000], 0),
    'stator_winding_temp_c': ('Stator Winding Temperature', '°C', 'Condition', 'P1', [-10, 160], 1),
    'coolant_temp_c': ('Coolant Temperature', '°C', 'Condition', 'P2', [-10, 80], 1),
    'cooling_fan_current_a': ('Fan Motor Current', 'A', 'Electrical', 'P1', [0, 20], 1),
    'converter_temp_c': ('Converter Temperature', '°C', 'Condition', 'P2', [-10, 90], 1),
    'dc_link_voltage_v': ('DC Link Voltage', 'V', 'Electrical', 'P3', [0, 1300], 0),
    'cabinet_humidity_pct': ('Cabinet Humidity', '%', 'Condition', 'P1', [0, 100], 0),
    'yaw_error_deg': ('Yaw Error (measured)', '°', 'Stability', 'P1', [-20, 20], 1),
    'nacelle_direction_deg': ('Nacelle Direction', '°', 'Stability', 'P3', [0, 360], 0),
    'yaw_motor_current_a': ('Yaw Motor Current', 'A', 'Electrical', 'P2', [0, 30], 1),
    'transformer_load_pct': ('Transformer Load', '%', 'Flow / WIP', 'P1', [0, 120], 1),
}
STATIC = {'rated_power_kw'}
TYPE_PROPS = {
    'wind_farm': ['farm_power_kw', 'capacity_factor_pct', 'availability_pct'],
    'collector_feeder': ['feeder_power_kw', 'feeder_current_a', 'availability_pct'],
    'collector_substation': ['export_power_kw', 'poi_voltage_kv', 'reactive_power_kvar', 'transformer_oil_temp_c'],
    'met_mast': ['met_wind_speed_ms', 'wind_direction_deg', 'ambient_temp_c', 'relative_humidity_pct'],
    'wtg_geared': ['active_power_kw', 'wind_speed_ms', 'power_curve_perf_pct', 'availability_pct', 'rated_power_kw'],
    'wtg_direct_drive': ['active_power_kw', 'wind_speed_ms', 'power_curve_perf_pct', 'availability_pct', 'rated_power_kw'],
    'rotor': ['rotor_speed_rpm', 'blade_pitch_angle_deg'],
    'pitch_system': ['pitch_battery_voltage_v', 'pitch_motor_current_a', 'pitch_deviation_deg'],
    'drivetrain': ['drivetrain_vibration_mms'],
    'main_shaft': ['drivetrain_vibration_mms'],
    'main_bearing': ['bearing_temp_c', 'vibration_mms'],
    'hs_bearing': ['bearing_temp_c', 'vibration_mms'],
    'generator_bearing': ['bearing_temp_c', 'vibration_mms'],
    'gearbox': ['gearbox_oil_temp_c', 'gearbox_oil_pressure_bar', 'oil_particle_count'],
    'dfig_generator': ['generator_speed_rpm', 'stator_winding_temp_c'],
    'pm_generator': ['stator_winding_temp_c', 'coolant_temp_c'],
    'cooling_fan': ['cooling_fan_current_a'],
    'converter': ['converter_temp_c', 'dc_link_voltage_v', 'cabinet_humidity_pct'],
    'yaw_system': ['yaw_error_deg', 'nacelle_direction_deg'],
    'yaw_drive': ['yaw_motor_current_a'],
    'pad_transformer': ['transformer_oil_temp_c', 'transformer_load_pct'],
}
TYPE_LABELS = {
    'wtg_geared': 'WTG 2.3 MW Geared',
    'wtg_direct_drive': 'WTG 3.3 MW Direct Drive',
    'hs_bearing': 'HS Bearing',
    'dfig_generator': 'DFIG Generator',
    'pm_generator': 'PM Generator',
    'met_mast': 'Met Mast',
}
DERIVATIONS = [
    {'assetType': 'collector_feeder', 'property': 'feeder_power_kw', 'fn': 'sum', 'of': 'active_power_kw',
     'fromType': 'wtg_geared|wtg_direct_drive', 'scope': 'children'},
    {'assetType': 'collector_feeder', 'property': 'availability_pct', 'fn': 'mean', 'of': 'availability_pct',
     'fromType': 'wtg_geared|wtg_direct_drive', 'scope': 'children'},
    {'assetType': 'wind_farm', 'property': 'farm_power_kw', 'fn': 'sum', 'of': 'active_power_kw',
     'fromType': 'wtg_geared|wtg_direct_drive', 'scope': 'descendants'},
    {'assetType': 'wind_farm', 'property': 'availability_pct', 'fn': 'mean', 'of': 'availability_pct',
     'fromType': 'wtg_geared|wtg_direct_drive', 'scope': 'descendants'},
    {'assetType': 'drivetrain', 'property': 'drivetrain_vibration_mms', 'fn': 'max', 'of': 'vibration_mms',
     'fromType': 'main_bearing|hs_bearing', 'scope': 'children'},
    {'assetType': 'main_shaft', 'property': 'drivetrain_vibration_mms', 'fn': 'max', 'of': 'vibration_mms',
     'fromType': 'main_bearing', 'scope': 'children'},
    {'assetType': 'wind_farm', 'property': 'capacity_factor_pct', 'fn': 'formula',
     'note': 'farm_power_kw / installed capacity (60,200 kW) × 100'},
    {'assetType': 'collector_feeder', 'property': 'feeder_current_a', 'fn': 'formula',
     'note': 'feeder_power_kw × 1000 / (√3 × 34,500 V × 0.98 power factor)'},
    {'assetType': 'collector_substation', 'property': 'export_power_kw', 'fn': 'formula',
     'note': 'sum of feeder_power_kw × 0.975 (collector cable + main transformer losses)'},
]


# ── Helpers ─────────────────────────────────────────────────────────────
def interp(points):
    """Piecewise-linear profile over the timeline from {'HH:MM': value}."""
    pts = sorted((minutes(t), v) for t, v in points.items())
    out = []
    for t in TS:
        m = minutes(t)
        for (m0, v0), (m1, v1) in zip(pts, pts[1:]):
            if m0 <= m <= m1:
                out.append(v0 + (v1 - v0) * (m - m0) / (m1 - m0) if m1 > m0 else v0)
                break
        else:
            out.append(pts[0][1] if m < pts[0][0] else pts[-1][1])
    return out


def ar1(sd, phi=0.85):
    """Slowly drifting noise (lag-1 autocorrelation ≈ phi), zero mean."""
    x, out = rng.gauss(0, sd), []
    for _ in range(N):
        x = phi * x + rng.gauss(0, sd * math.sqrt(1 - phi * phi))
        out.append(x)
    return out


def lagged(targets, start, k=0.35):
    """First-order thermal lag toward each step's target."""
    x, out = start, []
    for tgt in targets:
        x += (tgt - x) * k
        out.append(x)
    return out


def window(t0, t1):
    return [minutes(t0) <= minutes(t) < minutes(t1) for t in TS]


def ramp(t0, t1, amount):
    """0 before t0, linear to `amount` at t1, held after."""
    a, b = minutes(t0), minutes(t1)
    return [0 if minutes(t) <= a else amount * min(1, (minutes(t) - a) / (b - a)) for t in TS]


CURVE = [(3, 0), (4, .03), (5, .08), (6, .16), (7, .27), (8, .42), (9, .60), (10, .78), (11, .92), (12, .99), (13, 1.0),
         (25, 1.0), (25.01, 0)]


def curve(v, ttype):
    """Power-curve fraction; the direct-drive machine reaches rated ~0.5 m/s later."""
    v = v - (0.5 if ttype == 'wtg_direct_drive' else 0)
    if v <= CURVE[0][0]:
        return 0.0
    for (v0, p0), (v1, p1) in zip(CURVE, CURVE[1:]):
        if v0 <= v <= v1:
            return p0 + (p1 - p0) * (v - v0) / (v1 - v0)
    return 0.0


def rnd(x, d):
    return round(x + 0.0, d)


# ── Environment: one winter-front day ────────────────────────────────────
site_wind = [max(0.5, w + n) for w, n in zip(
    interp({'00:00': 10.6, '03:00': 9.6, '06:00': 7.4, '08:00': 6.3, '10:00': 8.4, '12:00': 11.4, '14:00': 12.8}),
    ar1(0.35, 0.7))]
ambient = [a + n for a, n in zip(interp({'00:00': -3.5, '06:00': -5.2, '09:00': -2.0, '10:30': 0.4, '14:00': 2.6}), ar1(0.2))]
humidity = [min(99, h + n) for h, n in zip(interp({'00:00': 92, '06:00': 97, '10:00': 88, '14:00': 74}), ar1(1.2))]
wind_dir = [d + n for d, n in zip(interp({'00:00': 292, '08:00': 281, '14:00': 268}), ar1(3.0))]

# ── Build the asset tree ─────────────────────────────────────────────────
assets, kids = [], {}


def add(aid, parent, name, atype, level):
    assets.append({'id': aid, 'parentId': parent, 'name': name, 'assetType': atype, 'assetLevel': level})
    kids.setdefault(parent, []).append(aid)
    return aid


add(SITE_ID, None, SITE_NAME, 'wind_farm', 'site')
turbines = []   # (turbine id, name, type, feeder id)
n = 0
for fnum, ttype, count in FEEDERS:
    fid = add(f'{SITE_ID}_F{fnum}', SITE_ID, f'Feeder {fnum}', 'collector_feeder', 'circuit')
    for _ in range(count):
        n += 1
        tname = f'WTG-{n:02d}'
        tid = add(f'{fid}_WTG{n:02d}', fid, tname, ttype, 'turbine')
        turbines.append((tid, tname, ttype, fid))
        for code, sname, stype, comps in SUBSYSTEMS[ttype]:
            sid = add(f'{tid}_{code}', tid, sname, stype, 'subsystem')
            for ccode, cname, ctype in comps:
                add(f'{sid}_{ccode}', sid, cname, ctype, 'component')
SUB_ID = add(f'{SITE_ID}_SUB', SITE_ID, 'Collector Substation', 'collector_substation', 'circuit')
MET_ID = add(f'{SITE_ID}_MET', SITE_ID, 'Met Mast', 'met_mast', 'circuit')
A = {a['id']: a for a in assets}
T_BY_NAME = {name: (tid, ttype, fid) for tid, name, ttype, fid in turbines}
INSTALLED_KW = sum(RATED[t] for _, _, t, _ in turbines)


def sub(tid, code):
    return f'{tid}_{code}'


series = {}


def put(aid, key, values, decimals=None):
    d = PROPS[key][5] if decimals is None else decimals
    series.setdefault(aid, {})[key] = [rnd(v, d) for v in values]


# ── Per-turbine simulation ───────────────────────────────────────────────
def simulate(tid, name, ttype, fid):
    rated = RATED[ttype]
    wake = rng.uniform(-0.06, 0.04)
    wind = [max(0.3, w * (1 + wake) + e) for w, e in zip(site_wind, ar1(0.25, 0.6))]
    eff = [rng.uniform(0.985, 1.0) + e for e in ar1(0.006, 0.8)]      # this machine's normal efficiency
    running = [True] * N
    stop_frac = [0.0] * N                                               # share of a 10-min interval lost to a short stop

    # Scenario effects on the machine itself
    if name == MAINT_TURBINE:
        for i, w in enumerate(window(MAINT_START, '23:59')):
            if w: running[i] = False
    if fid == f'{SITE_ID}_F2':
        for i, w in enumerate(window(FEEDER_TRIP, FEEDER_RESTORE)):
            if w: running[i] = False
    if name == TRAFO_TURBINE:
        for i, w in enumerate(window(FEEDER_TRIP, '23:59')):
            if w: running[i] = False
    if name == CONV_TURBINE:
        for i, w in enumerate(window(CONV_TRIP, CONV_RESTART)):
            if w: running[i] = False
    if name == PITCH_TURBINE:
        for t in PITCH_STOPS:
            stop_frac[i_of(t)] = 0.65
    if name == YAW_TURBINE:
        eff = [e * math.cos(math.radians(YAW_OFFSET_DEG)) ** 2.5 for e in eff]
    if ttype == 'wtg_direct_drive':                                      # Feeder 4 blade icing
        depth = 0.24 if name == ICE_TURBINE else rng.uniform(0.09, 0.14)
        ice = [a + b for a, b in zip(ramp(ICE_START, ICE_PEAK, depth), ramp(ICE_PEAK, ICE_CLEAR, -depth))]
        eff = [e * (1 - max(0.0, x)) for e, x in zip(eff, ice)]
    if name == FAN_TURBINE:                                               # generator derates slightly when hot
        eff = [e * (0.96 if w else 1) for e, w in zip(eff, window('10:50', FAN_RESET))]

    power = []
    for i in range(N):
        p = rated * curve(wind[i], ttype) * eff[i] * (1 - stop_frac[i]) if running[i] else 0.0
        power.append(max(0.0, min(rated, p * (1 + rng.gauss(0, 0.012)))))
    pf = [p / rated for p in power]

    # Nacelle anemometer (what the turbine *reports*)
    meas_wind = [w + rng.gauss(0, 0.06) for w in wind]
    if name == ANEMO_TURBINE:
        for i, w in enumerate(window(ANEMO_START, ANEMO_FIX)):
            if w: meas_wind[i] = wind[i] * rng.uniform(0.52, 0.72)
    perf = []
    for i in range(N):
        expected = rated * curve(meas_wind[i], ttype)
        if not running[i]:
            perf.append(0.0)
        elif expected < 0.05 * rated:
            # Too little expected power to judge a ratio — unless the machine
            # is clearly producing, which means the wind reading is wrong.
            perf.append(130.0 if power[i] > 0.1 * rated else 100 + rng.gauss(0, 1.0))
        else:
            perf.append(min(130.0, 100 * power[i] / expected))
    avail, up = [], 0
    for i in range(N):
        up += 1 if running[i] else 0
        avail.append(100 * up / (i + 1))

    put(tid, 'active_power_kw', power)
    put(tid, 'wind_speed_ms', meas_wind)
    put(tid, 'power_curve_perf_pct', perf)
    put(tid, 'availability_pct', avail, 2)

    # Rotor & pitch
    rotor = sub(tid, 'ROTOR')
    if ttype == 'wtg_geared':
        rpm = [min(17.5, 6 + 1.05 * w) if r else 0.0 for w, r in zip(wind, running)]
        vr = 12.0
    else:
        rpm = [min(14.5, 3.8 + 0.85 * w) if r else 0.0 for w, r in zip(wind, running)]
        vr = 12.5
    pitch = [(max(0.0, (w - vr) * 2.4) + 0.4 + rng.gauss(0, 0.2)) if r else 88.0 for w, r in zip(wind, running)]
    for t in (PITCH_STOPS if name == PITCH_TURBINE else []):
        pitch[i_of(t)] = 58.0          # blades went to feather for part of the interval
    put(rotor, 'rotor_speed_rpm', [r + (rng.gauss(0, 0.15) if r else 0) for r in rpm])
    put(rotor, 'blade_pitch_angle_deg', pitch)
    pit = sub(rotor, 'PITCH')
    batt = [238 + e for e in ar1(0.8)]
    if name == PITCH_TURBINE:
        batt = [b - d for b, d in zip(batt, interp({'00:00': 8, '06:00': 12, '11:50': 26, '14:00': 33}))]
    dp = [0.0] + [abs(pitch[i] - pitch[i - 1]) for i in range(1, N)]
    put(pit, 'pitch_battery_voltage_v', batt)
    put(pit, 'pitch_motor_current_a', [min(39, 4.5 + 1.6 * d + rng.gauss(0, 0.6)) if r else 0.3 for d, r in zip(dp, running)])
    put(pit, 'pitch_deviation_deg', [max(0.02, 0.15 + rng.gauss(0, 0.04)) for _ in range(N)])

    # Bearings & drivetrain
    def bearing(aid, base, span, vib0, vib_span, extra_t=None, extra_v=None):
        tgt = [base + span * p + 0.35 * a for p, a in zip(pf, ambient)]
        if extra_t: tgt = [x + e for x, e in zip(tgt, extra_t)]
        temp = [t + e for t, e in zip(lagged(tgt, tgt[0]), ar1(0.35))]
        vib = [(vib0 + vib_span * p + (e if extra_v else 0)) + rng.gauss(0, 0.08) if r else 0.05
               for p, r, e in zip(pf, running, extra_v or [0] * N)]
        put(aid, 'bearing_temp_c', temp)
        put(aid, 'vibration_mms', [max(0.02, v) for v in vib])
        return [rnd(max(0.02, v), 2) for v in vib]

    if ttype == 'wtg_geared':
        dt = sub(tid, 'DRIVETRAIN')
        v1 = bearing(sub(dt, 'MAINBRG'), 24, 12, 0.7, 0.45)
        hsb_t = ramp(HSB_START, '14:00', HSB_RISE_C) if name == HSB_TURBINE else None
        hsb_v = ramp(HSB_START, '14:00', 0.9) if name == HSB_TURBINE else None
        v2 = bearing(sub(dt, 'HSBRG'), 49, 26, 1.4, 1.1, hsb_t, hsb_v)
        put(dt, 'drivetrain_vibration_mms', [max(a, b) for a, b in zip(v1, v2)])
        gb = sub(dt, 'GEARBOX')
        tgt = [43 + 20 * p + 0.25 * a for p, a in zip(pf, ambient)]
        if name == HSB_TURBINE:
            tgt = [x + e for x, e in zip(tgt, ramp(HSB_START, '14:00', 3.5))]
        put(gb, 'gearbox_oil_temp_c', [t + e for t, e in zip(lagged(tgt, tgt[0], 0.25), ar1(0.25))])
        put(gb, 'gearbox_oil_pressure_bar', [(2.9 + 0.35 * p + rng.gauss(0, 0.05)) if r else 0.4 for p, r in zip(pf, running)])
        parts = [max(0, 3 + rng.gauss(0, 1.2)) for _ in range(N)]
        if name == HSB_TURBINE:
            parts = [p + e for p, e in zip(parts, ramp(HSB_START, '14:00', 19))]
        put(gb, 'oil_particle_count', parts)
        gen = sub(tid, 'GENERATOR')
        bearing(sub(gen, 'GENBRG'), 41, 22, 1.0, 0.8)
        put(gen, 'generator_speed_rpm', [r * 105 + (rng.gauss(0, 6) if r else 0) for r in rpm])
        fan_on = [not w for w in window(FAN_OFF, FAN_RESET)] if name == FAN_TURBINE else [True] * N
        stator_tgt = [(58 + 55 * p + 0.3 * a) + (0 if f else 26 + 30 * p) for p, a, f in zip(pf, ambient, fan_on)]
        put(gen, 'stator_winding_temp_c', [t + e for t, e in zip(lagged(stator_tgt, stator_tgt[0], 0.3), ar1(0.5))])
        put(sub(gen, 'FAN'), 'cooling_fan_current_a',
            [(6 + 4 * p + rng.gauss(0, 0.15)) if (r and f) else 0.0 for p, r, f in zip(pf, running, fan_on)])
    else:
        ms = sub(tid, 'MAINSHAFT')
        v1 = bearing(sub(ms, 'MAINBRG'), 26, 13, 0.8, 0.5)
        put(ms, 'drivetrain_vibration_mms', v1)
        gen = sub(tid, 'GENERATOR')
        stator_tgt = [52 + 60 * p + 0.3 * a for p, a in zip(pf, ambient)]
        put(gen, 'stator_winding_temp_c', [t + e for t, e in zip(lagged(stator_tgt, stator_tgt[0], 0.3), ar1(0.5))])
        cool_tgt = [22 + 22 * p + 0.3 * a for p, a in zip(pf, ambient)]
        put(gen, 'coolant_temp_c', [t + e for t, e in zip(lagged(cool_tgt, cool_tgt[0], 0.3), ar1(0.3))])
        put(sub(gen, 'FAN'), 'cooling_fan_current_a', [(6 + 4 * p + rng.gauss(0, 0.15)) if r else 0.0 for p, r in zip(pf, running)])

    # Converter
    conv = sub(tid, 'CONVERTER')
    ctgt = [33 + 19 * p + 0.2 * a for p, a in zip(pf, ambient)]
    put(conv, 'converter_temp_c', [t + e for t, e in zip(lagged(ctgt, ctgt[0]), ar1(0.3))])
    dcl = 1100 if ttype == 'wtg_geared' else 1150
    put(conv, 'dc_link_voltage_v', [(dcl + rng.gauss(0, 4)) if r else 0.0 for r in running])
    hum = [34 + 12 * (1 - p) + e for p, e in zip(pf, ar1(1.5))]
    if name == CONV_TURBINE:
        hum = [h + e for h, e in zip(hum, interp({'00:00': 4, '06:00': 12, '08:00': 18, '11:30': 30, '12:20': 36,
                                                  '12:30': 36, '13:10': 30, '14:00': 18}))]
    put(conv, 'cabinet_humidity_pct', [min(99, h) for h in hum])

    # Yaw
    yaw = sub(tid, 'YAW')
    put(yaw, 'yaw_error_deg', [(e + rng.gauss(0, 1.2)) if r else 0.0 for e, r in zip(ar1(1.8, 0.6), running)])
    true_offset = YAW_OFFSET_DEG if name == YAW_TURBINE else 0.0
    put(yaw, 'nacelle_direction_deg', [(d - true_offset + rng.gauss(0, 2)) % 360 for d in wind_dir])
    put(sub(yaw, 'YAWDRIVE'), 'yaw_motor_current_a',
        [(rng.uniform(11, 17) if rng.random() < 0.09 else 1.4 + rng.gauss(0, 0.2)) if r else 0.0 for r in running])

    # Pad-mount transformer
    tr = sub(tid, 'TRAFO')
    ttgt = [29 + 30 * p + 0.35 * a for p, a in zip(pf, ambient)]
    if name == TRAFO_TURBINE:
        # Internal fault developing: oil heats with no matching load change, then
        # the unit is isolated and cools toward ambient.
        heat = ramp(TRAFO_HEAT, FEEDER_TRIP, 34)
        after = window(FEEDER_TRIP, '23:59')
        ttgt = [a if off else t + h for t, h, a, off in zip(ttgt, heat, ambient, after)]
    put(tr, 'transformer_oil_temp_c', [t + e for t, e in zip(lagged(ttgt, ttgt[0], 0.3), ar1(0.3))])
    put(tr, 'transformer_load_pct', [100 * p * 1.02 for p in pf])
    return running


running_by_turbine = {tid: simulate(tid, name, ttype, fid) for tid, name, ttype, fid in turbines}

# ── Rollups (derivations, at every point) ────────────────────────────────
for fnum, _, _ in FEEDERS:
    fid = f'{SITE_ID}_F{fnum}'
    tids = [t for t, _, _, f in turbines if f == fid]
    fp = [round(sum(series[t]['active_power_kw'][i] for t in tids), 0) for i in range(N)]
    put(fid, 'feeder_power_kw', fp)
    put(fid, 'availability_pct', [sum(series[t]['availability_pct'][i] for t in tids) / len(tids) for i in range(N)], 2)
    put(fid, 'feeder_current_a', [p * 1000 / (math.sqrt(3) * 34500 * 0.98) for p in fp])
tids = [t for t, _, _, _ in turbines]
farm = [round(sum(series[t]['active_power_kw'][i] for t in tids), 0) for i in range(N)]
put(SITE_ID, 'farm_power_kw', farm)
put(SITE_ID, 'availability_pct', [sum(series[t]['availability_pct'][i] for t in tids) / len(tids) for i in range(N)], 2)
put(SITE_ID, 'capacity_factor_pct', [100 * p / INSTALLED_KW for p in farm])

# Substation and met mast
feeder_sum = [sum(series[f'{SITE_ID}_F{f}']['feeder_power_kw'][i] for f, _, _ in FEEDERS) for i in range(N)]
put(SUB_ID, 'export_power_kw', [s * 0.975 for s in feeder_sum])
put(SUB_ID, 'poi_voltage_kv', [231.2 + e for e in ar1(0.4)])
put(SUB_ID, 'reactive_power_kvar', [-0.08 * s + e for s, e in zip(feeder_sum, ar1(250))])
stgt = [34 + 26 * s / INSTALLED_KW + 0.35 * a for s, a in zip(feeder_sum, ambient)]
put(SUB_ID, 'transformer_oil_temp_c', [t + e for t, e in zip(lagged(stgt, stgt[0], 0.2), ar1(0.25))])
put(MET_ID, 'met_wind_speed_ms', site_wind)
put(MET_ID, 'wind_direction_deg', [d % 360 for d in wind_dir])
put(MET_ID, 'ambient_temp_c', ambient)
put(MET_ID, 'relative_humidity_pct', humidity)

# Current values = last point (spec §5.3); nameplate is static.
values = {aid: {k: s[-1] for k, s in props.items()} for aid, props in series.items()}
for tid, _, ttype, _ in turbines:
    values[tid]['rated_power_kw'] = RATED[ttype]

# ── Relationships (spec §3.6) ────────────────────────────────────────────
rels = []


def edge(a, b, layer, label=None):
    rels.append({'sourceAssetId': a, 'targetAssetId': b, 'relationshipType': 'feeds_into', 'label': label, 'layer': layer})


for tid, _, ttype, fid in turbines:
    chain = ['ROTOR', 'DRIVETRAIN' if ttype == 'wtg_geared' else 'MAINSHAFT', 'GENERATOR', 'CONVERTER', 'TRAFO']
    for a, b in zip(chain, chain[1:]):
        edge(sub(tid, a), sub(tid, b), 'power', 'mechanical power' if a in ('ROTOR', 'DRIVETRAIN', 'MAINSHAFT') else None)
    edge(sub(tid, 'TRAFO'), fid, 'power', '690 V → 34.5 kV')
    edge(sub(sub(tid, 'GENERATOR'), 'FAN'), sub(tid, 'GENERATOR'), 'cooling', 'cooling air')
for fnum, _, _ in FEEDERS:
    edge(f'{SITE_ID}_F{fnum}', SUB_ID, 'power', '34.5 kV collector')
edge(MET_ID, SITE_ID, 'reference', 'reference wind for power-curve checks')

# ── Unit status (spec §6.6) ──────────────────────────────────────────────
unit_status = {tid: {'state': 'running', 'statusSinceMinutes': None, 'mode': 'STEADY', 'product': 'Grid export'}
               for tid, _, _, _ in turbines}


def since(t):
    return NOW_MIN - minutes(t)


unit_status[T_BY_NAME[MAINT_TURBINE][0]].update(state='down', statusSinceMinutes=since(MAINT_START), mode='MAINTENANCE')
unit_status[T_BY_NAME[TRAFO_TURBINE][0]].update(state='down', statusSinceMinutes=since(FEEDER_TRIP), mode='STOPPED')

# ── Attention items — evidence read back from the series ────────────────


def label_of(aid):
    names, a = [], A[aid]
    while a:
        names.insert(0, a['name'])
        if a['assetLevel'] == 'turbine':
            return SEP.join(names)
        a = A.get(a['parentId'])
    return A[aid]['name']


def unit_of(aid):
    a = A[aid]
    while a and a['assetLevel'] != 'turbine':
        a = A.get(a['parentId'])
    return a['id'] if a else None


def fmt(v, unit, d):
    s = f'{v:,.{d}f}'
    return f'{s} {unit}' if unit and unit != '%' else (f'{s}%' if unit == '%' else s)


def evidence(aid, key, points):
    """points: [(time, note)] → evidence numbers + evidencePoints from the real series."""
    label, unit, _, _, _, d = PROPS[key]
    ev, evp = [], []
    for t, note in points:
        v = series[aid][key][i_of(t)]
        ev.append(v)
        evp.append({'time': t, 'value': fmt(v, unit, d), 'label': note})
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
        'asset': label_of(aid), 'line': A[unit_id]['name'] if unit_id else A[aid]['name'],
        'severity': severity, 'signal': signal, 'aiInterpretation': interp_text,
        'since': since_text(mins, outcome == 'resolved'), 'sinceMinutes': mins, 'attentionState': state,
        'detail': {**detail, 'evidence': ev, 'evidencePoints': evp, 'outcomeStatus': outcome},
    }


def T(name):
    return T_BY_NAME[name][0]


hsb = sub(sub(T(HSB_TURBINE), 'DRIVETRAIN'), 'HSBRG')
fan_gen = sub(T(FAN_TURBINE), 'GENERATOR')
feeder2 = f'{SITE_ID}_F2'
anemo_t = T(ANEMO_TURBINE)
conv = sub(T(CONV_TURBINE), 'CONVERTER')
pitch = sub(sub(T(PITCH_TURBINE), 'ROTOR'), 'PITCH')
yaw_t = T(YAW_TURBINE)
ice_t = T(ICE_TURBINE)


def v(aid, key, t):
    return series[aid][key][i_of(t)]


def mean_since(aid, key, t0):
    xs = series[aid][key][i_of(t0):]
    return sum(xs) / len(xs)


# Numbers quoted in the narrative text, computed from the series.
_f1 = [t for t, _, _, f in turbines if f == f'{SITE_ID}_F1' and t not in (T(HSB_TURBINE), T(MAINT_TURBINE))]
_sib = [v(sub(sub(t, 'DRIVETRAIN'), 'HSBRG'), 'bearing_temp_c', '14:00') for t in _f1]
sib_lo, sib_hi = min(_sib), max(_sib)
fan_rise = v(fan_gen, 'stator_winding_temp_c', '11:10') - v(fan_gen, 'stator_winding_temp_c', '09:20')
trafo_rise = v(sub(T(TRAFO_TURBINE), 'TRAFO'), 'transformer_oil_temp_c', '10:00') - v(sub(T(TRAFO_TURBINE), 'TRAFO'), 'transformer_oil_temp_c', '09:20')
yaw_perf = mean_since(yaw_t, 'power_curve_perf_pct', '08:00')
_f3 = [t for t, _, _, f in turbines if f == f'{SITE_ID}_F3' and t not in (yaw_t, T(PITCH_TURBINE))]
f3_perf = sum(mean_since(t, 'power_curve_perf_pct', '08:00') for t in _f3) / len(_f3)
_f4 = [t for t, _, _, f in turbines if f == f'{SITE_ID}_F4' and t != ice_t]
f4_perf = sum(v(t, 'power_curve_perf_pct', '07:30') for t in _f4) / len(_f4)


attention = [
    item('BSIT01', hsb, 'bearing_temp_c',
         [('06:00', 'Divergence begins (low wind)'), ('08:00', ''), ('10:00', ''), ('11:00', ''), ('12:00', ''), ('13:00', ''), ('14:00', 'Current — siblings ~75 °C')],
         'high', 'investigate', 'none', HSB_START,
         'Gearbox HS bearing running hotter than its siblings at the same load',
         'HS-shaft bearing temperature has climbed about 14 °C against load since 06:00, with the gearbox oil debris count rising alongside it — the classic early signature of bearing surface damage.',
         {'signal': f'WTG-05 HS bearing is {v(hsb, "bearing_temp_c", "14:00"):.0f} °C at 14:00; the other running Feeder 1 turbines, at the same power, read {sib_lo:.0f}–{sib_hi:.0f} °C.',
          'observed': 'Bearing temperature trend diverges from the power-normalised fleet trend from 06:00; oil debris counter up from ~3 to ~22 particles/h; HS bearing vibration up ~0.9 mm/s.',
          'derived': 'Temperature residual (actual minus load/ambient model) is rising steadily, not stepping — consistent with progressive wear rather than a sensor offset.',
          'inferred': 'Early-stage HS bearing damage (spalling). Weeks, not hours, to functional failure at this rate, but trending the wrong way.',
          'recommendation': 'Keep running with a lower temperature alarm; schedule borescope and oil sample at the next low-wind window; order a replacement bearing kit.',
          'relatedOccurrences': [{'date': '2025-11-03', 'summary': 'WTG-11 HS bearing replaced after a similar 3-week temperature and debris trend.'}],
          'whatChangedSummary': 'No maintenance or setpoint change on WTG-05 in the window — the trend is intrinsic.',
          'whatChanged': [{'time': '06:00', 'source': 'Event', 'description': 'Bearing temperature residual crosses the 2σ band.', 'related': True},
                          {'time': '11:40', 'source': 'Field Check', 'description': 'Oil debris counter reading confirmed on site.', 'related': True}],
          'confidence': 'Two independent signals agree (temperature and oil debris)', 'confidenceLevel': 'medium',
          'risk': 'High if ignored — a failed HS bearing can take the gearbox with it', 'riskLevel': 'high',
          'expectedOutcome': 'Planned repair before failure'}),
    item('BSIT02', fan_gen, 'stator_winding_temp_c',
         [('09:20', 'Baseline'), ('09:40', 'Fan current drops to 0 A'), ('10:10', ''), ('10:40', ''), ('11:10', 'Peak'), ('11:30', 'Fan reset'), ('12:10', 'Back to normal')],
         'medium', 'watch', 'resolved', FAN_RESET,
         'Generator winding temperature climbed, fan motor had stopped',
         'The winding temperature rise looked like a generator problem, but it started exactly when the cooling fan motor current dropped to zero — the generator was fine, its cooling had stopped.',
         {'signal': f'WTG-03 stator winding temperature rose {fan_rise:.0f} °C between 09:20 and 11:10 at steady load.',
          'observed': 'Cooling fan motor current fell from ~9 A to 0 A at 09:40; the winding temperature started climbing within the next interval.',
          'derived': 'Load and ambient were unchanged, so the heat input didn’t change — the heat removal did.',
          'inferred': 'Fan motor protection tripped; the generator itself was healthy.',
          'recommendation': 'Reset the fan motor breaker, then watch the winding temperature come back down before closing out.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Fan motor breaker reset remotely at 11:20; winding temperature back to normal by 12:10.',
          'whatChanged': [{'time': '09:40', 'source': 'Event', 'description': 'Cooling fan current 0 A.', 'related': True},
                          {'time': '10:50', 'source': 'Alarm', 'description': 'Generator thermal derate applied by the turbine controller.', 'related': True},
                          {'time': '11:20', 'source': 'Operator Action', 'description': 'Fan motor breaker reset remotely.', 'related': True}],
          'confidence': 'Confirmed — temperature fell as soon as the fan restarted', 'confidenceLevel': 'high',
          'risk': 'Low — caught before a winding over-temperature trip', 'riskLevel': 'low',
          'expectedOutcome': 'Fan running, winding temperature normal'}),
    item('BSIT03', feeder2, 'feeder_power_kw',
         [('09:50', 'Normal'), ('10:00', ''), ('10:10', 'Feeder breaker trips'), ('10:20', ''), ('10:40', 'WTG-10 isolated'), ('10:50', 'Feeder re-energised'), ('11:00', 'Recovering')],
         'high', 'watch', 'resolved', FEEDER_RESTORE,
         'Feeder 2 tripped and took seven turbines offline',
         'All seven Feeder 2 turbines stopped in the same interval — a feeder-level event, not seven turbine faults. WTG-10’s pad transformer had been heating with no matching load before the trip.',
         {'signal': f'Feeder 2 output fell from {v(feeder2, "feeder_power_kw", "10:00") / 1000:.1f} MW to 0 at 10:10; export dropped by the same amount.',
          'observed': f'Feeder breaker opened on ground fault; WTG-07…13 all lost grid at the same time; WTG-10 transformer oil temperature had risen {trafo_rise:.0f} °C since 09:20 at constant load.',
          'derived': 'The only asset with an abnormal trend before the trip was WTG-10’s pad transformer — the likely origin.',
          'inferred': 'Internal fault in WTG-10’s pad-mount transformer; its own protection didn’t clear it, so the feeder breaker did.',
          'recommendation': 'Isolate WTG-10 at its loop-feed switches, re-energise Feeder 2, and keep WTG-10 out of service for transformer testing.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'WTG-10 isolated at 10:40; Feeder 2 re-energised at 10:50 without it. Six turbines back online.',
          'whatChanged': [{'time': '10:10', 'source': 'Alarm', 'description': 'Feeder 2 breaker trip, ground fault.', 'related': True},
                          {'time': '10:40', 'source': 'Field Check', 'description': 'WTG-10 transformer isolated at loop-feed switches.', 'related': True},
                          {'time': '10:50', 'source': 'Operator Action', 'description': 'Feeder 2 breaker closed.', 'related': True}],
          'confidence': 'Confirmed by field crew (oil discoloration, pressure relief operated)', 'confidenceLevel': 'high',
          'risk': 'Contained — WTG-10 out of service until the transformer is replaced', 'riskLevel': 'medium',
          'expectedOutcome': 'Feeder 2 restored; WTG-10 transformer replacement planned'}),
    item('BSIT04', anemo_t, 'wind_speed_ms',
         [('06:20', 'Baseline'), ('06:40', 'Reading drops'), ('07:30', ''), ('08:20', ''), ('09:10', ''), ('09:50', 'Heater reset'), ('10:00', 'Normal')],
         'low', 'watch', 'resolved', ANEMO_FIX,
         'Nacelle wind speed read low on WTG-12 while it kept producing normally',
         'WTG-12 reported roughly a third less wind than its neighbours and the met mast, but its power stayed where they are — the measurement was wrong, not the wind.',
         {'signal': f'At 08:20 WTG-12 reported {v(anemo_t, "wind_speed_ms", "08:20"):.1f} m/s while the met mast read {v(MET_ID, "met_wind_speed_ms", "08:20"):.1f} m/s.',
          'observed': 'Power output tracked the neighbours; power-curve performance computed against its own wind reading jumped above 120%.',
          'derived': 'Nothing else corroborated a low-wind condition — rotor speed, pitch and power all said normal wind.',
          'inferred': 'Iced nacelle anemometer (ambient −5 °C, humidity 97%); anemometer heater circuit had tripped.',
          'recommendation': 'Reset the anemometer heater and confirm the reading returns to the met-mast reference.',
          'relatedOccurrences': [{'date': '2025-12-19', 'summary': 'Same anemometer heater trip on WTG-12 during freezing fog.'}],
          'whatChangedSummary': 'Heater circuit reset remotely at 09:50; reading back in line within one interval.',
          'whatChanged': [{'time': '06:40', 'source': 'Event', 'description': 'Anemometer reading diverges from neighbours.', 'related': True},
                          {'time': '09:50', 'source': 'Operator Action', 'description': 'Anemometer heater reset.', 'related': True}],
          'confidence': 'Confirmed — reading recovered as soon as the heater came back', 'confidenceLevel': 'high',
          'risk': 'Low — control uses the reading for yaw and cut-out, but power was unaffected', 'riskLevel': 'low',
          'expectedOutcome': 'Measurement restored'}),
    item('BSIT05', conv, 'cabinet_humidity_pct',
         [('06:00', ''), ('08:00', 'Low load, cold'), ('11:30', ''), ('12:20', ''), ('12:30', 'Converter trip'), ('13:10', 'Restart'), ('14:00', 'Current')],
         'medium', 'watch', 'recovering', CONV_TRIP,
         'Converter tripped on a phase-module fault after a humid, low-load morning',
         'Cabinet humidity rose through the cold low-wind morning; the converter tripped as load ramped back up. Field data shows most converter faults are moisture-related, not heat-related.',
         {'signal': 'WTG-09 converter tripped at 12:30 on a phase-module fault; turbine restarted 13:10 after cabinet heaters ran.',
          'observed': f'Cabinet humidity climbed from {v(conv, "cabinet_humidity_pct", "06:00"):.0f}% to {v(conv, "cabinet_humidity_pct", "12:20"):.0f}% between 06:00 and 12:20 through a cold, low-load morning; converter temperature was normal.',
          'derived': 'Trip happened on the load ramp, with no over-temperature — pointing at condensation, not thermal stress.',
          'inferred': 'Condensation on the phase module; the cabinet heater thermostat may be set too low for this cold spell.',
          'recommendation': 'Keep running; check the cabinet heater thermostat and inspect the phase module for moisture tracking at the next visit.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Restarted 13:10 after heaters ran for 40 minutes; humidity falling.',
          'whatChanged': [{'time': '12:30', 'source': 'Alarm', 'description': 'Converter phase-module fault, turbine stopped.', 'related': True},
                          {'time': '13:10', 'source': 'Operator Action', 'description': 'Remote restart after cabinet heating.', 'related': True}],
          'confidence': 'Likely — consistent with field studies, not yet inspected', 'confidenceLevel': 'medium',
          'risk': 'Medium — a repeat trip could damage the module', 'riskLevel': 'medium',
          'expectedOutcome': 'Humidity back below 50% within the hour'}),
    item('BSIT06', pitch, 'pitch_battery_voltage_v',
         [('06:00', ''), ('09:00', ''), ('11:50', 'Safety stop #1'), ('12:40', 'Safety stop #2'), ('13:20', 'Safety stop #3'), ('13:50', 'Safety stop #4'), ('14:00', 'Current')],
         'high', 'act', 'none', PITCH_STOPS[0],
         'WTG-14 keeps stopping on pitch battery checks — four times since 11:50',
         'Each stop is short and the turbine restarts on its own, but the pitch backup battery is too weak to guarantee feathering the blades on a grid loss. The stops will keep coming and the safety margin is gone.',
         {'signal': f'Pitch backup battery voltage is {v(pitch, "pitch_battery_voltage_v", "14:00"):.0f} V (nominal ~238 V); four automatic safety stops since 11:50.',
          'observed': 'Battery voltage has been falling since midnight; each stop takes 5–7 minutes, then the turbine auto-restarts.',
          'derived': 'Stops are getting closer together (50, 40, 30 minutes apart) as the battery gets weaker in the cold.',
          'inferred': 'End-of-life pitch battery pack; cold weather is pushing it under the test threshold.',
          'recommendation': 'Stop WTG-14 and keep it stopped until the battery pack is replaced — without it, the blades may not feather on a grid loss.',
          'relatedOccurrences': [{'date': '2026-01-06', 'summary': 'WTG-15 pitch battery pack replaced after low-voltage warnings.'}],
          'whatChangedSummary': 'No change yet — waiting on a decision to stop the turbine.',
          'whatChanged': [{'time': '11:50', 'source': 'Alarm', 'description': 'Pitch battery test failed, safety stop.', 'related': True},
                          {'time': '12:40', 'source': 'Alarm', 'description': 'Pitch battery test failed, safety stop.', 'related': True},
                          {'time': '13:20', 'source': 'Alarm', 'description': 'Pitch battery test failed, safety stop.', 'related': True},
                          {'time': '13:50', 'source': 'Alarm', 'description': 'Pitch battery test failed, safety stop.', 'related': True}],
          'confidence': 'High — battery voltage and stop pattern agree', 'confidenceLevel': 'high',
          'risk': 'High — blades may not feather on a grid loss', 'riskLevel': 'high',
          'expectedOutcome': 'Battery pack replaced, turbine back in service'}),
    item('BSIT07', yaw_t, 'power_curve_perf_pct',
         [('02:00', ''), ('05:00', ''), ('08:00', ''), ('10:00', ''), ('12:00', ''), ('14:00', 'Current')],
         'medium', 'investigate', 'none', '09:00',
         'WTG-17 producing ~5% under its power curve, with nothing reported wrong',
         'WTG-17 is available and running, and its measured yaw error reads near zero — yet it’s steadily below its curve while its Feeder 3 neighbours aren’t. That combination points at a wind vane that’s pointing the wrong way.',
         {'signal': f'WTG-17 has averaged {yaw_perf:.0f}% of its power curve since 08:00, versus {f3_perf:.0f}% for the other healthy Feeder 3 turbines.',
          'observed': 'Availability 100%; measured yaw error averages ~0°; nacelle direction sits ~11° off the met-mast wind direction.',
          'derived': 'A steady ~11° misalignment explains a ~5% loss (cos² to cos³ law); the controller can’t see it because it trusts the vane.',
          'inferred': 'Wind vane offset after yesterday’s vane replacement.',
          'recommendation': 'Check the vane’s north-mark alignment against the nacelle axis and correct the offset parameter.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Wind vane replaced on WTG-17 yesterday afternoon.',
          'whatChanged': [{'time': '09:00', 'source': 'Event', 'description': 'Underperformance flagged after a full night of data.', 'related': True}],
          'confidence': 'Medium — pattern fits, not yet checked on site', 'confidenceLevel': 'medium',
          'risk': 'Low safety risk; ~5% lost energy on this turbine until fixed', 'riskLevel': 'low',
          'expectedOutcome': 'Performance back to ~99%'}),
    item('BSIT08', ice_t, 'power_curve_perf_pct',
         [('04:00', 'Baseline'), ('05:30', ''), ('07:30', 'Worst'), ('09:00', ''), ('10:00', ''), ('10:40', 'Temperature above 0 °C'), ('11:00', 'Normal')],
         'medium', 'watch', 'resolved', ICE_CLEAR,
         'Feeder 4 turbines under their power curve in freezing fog — blade icing',
         'Performance fell on all five Feeder 4 turbines together at −5 °C and 97% humidity, worst on WTG-22, and recovered as the temperature rose above freezing.',
         {'signal': f'WTG-22 fell to {v(ice_t, "power_curve_perf_pct", "07:30"):.0f}% of its power curve at 07:30; the other Feeder 4 machines averaged {f4_perf:.0f}%.',
          'observed': 'Ambient −5 °C and 97% humidity at the met mast; rotor speed lower than expected for the wind; no fault codes.',
          'derived': 'A site-wide, weather-correlated loss on one feeder (the ridge-top string) is a signature of icing, not of any one machine.',
          'inferred': 'Rime ice on the blades of the exposed Feeder 4 string.',
          'recommendation': 'Keep running while ice-throw risk is managed (access restrictions); watch recovery as it warms.',
          'relatedOccurrences': [{'date': '2025-12-19', 'summary': 'Feeder 4 icing event, 6 hours, similar pattern.'}],
          'whatChangedSummary': 'Ambient crossed 0 °C at ~10:30; performance back to normal by 11:00.',
          'whatChanged': [{'time': '05:00', 'source': 'Operator Action', 'description': 'Ice-throw access restriction posted for Feeder 4 roads.', 'related': True},
                          {'time': '11:10', 'source': 'Operator Action', 'description': 'Access restriction lifted.', 'related': True}],
          'confidence': 'High — pattern, weather and recovery all agree', 'confidenceLevel': 'high',
          'risk': 'Low — lost energy only; ice throw managed by access control', 'riskLevel': 'low',
          'expectedOutcome': 'Resolved as temperatures rose'}),
    item('BSIT09', SUB_ID, 'export_power_kw',
         [('13:00', ''), ('13:20', ''), ('13:40', ''), ('13:50', 'Instruction received 13:45'), ('14:00', 'Current')],
         'medium', 'act', 'none', CURTAIL_RECEIVED,
         'Grid operator curtailment: cap export at 45 MW from 14:30',
         'Wind is still rising and export is already above the cap. The plant controller setpoint must be lowered before 14:30 — and WTG-14’s pending stop changes how much the others need to give up.',
         {'signal': f'Export is {v(SUB_ID, "export_power_kw", "14:00") / 1000:.1f} MW at 14:00 and rising with the wind; the instruction caps it at 45.0 MW from 14:30.',
          'observed': 'Dispatch instruction received 13:45; wind at the met mast 12.8 m/s and forecast to keep rising through the afternoon.',
          'derived': 'At the forecast wind, uncurtailed export would reach ~57 MW — about 12 MW has to be shed.',
          'inferred': 'A plant-level setpoint of 45 MW will spread the curtailment across turbines automatically.',
          'recommendation': 'Enter the 45 MW setpoint in the power plant controller by 14:20 and confirm it with the grid operator.',
          'relatedOccurrences': [],
          'whatChangedSummary': 'Instruction logged; setpoint not yet entered.',
          'whatChanged': [{'time': '13:45', 'source': 'Event', 'description': 'Curtailment instruction received from the grid operator.', 'related': True}],
          'confidence': 'n/a — an instruction, not a diagnosis', 'confidenceLevel': 'n/a',
          'risk': 'Medium — non-compliance penalties if export isn’t capped in time', 'riskLevel': 'medium',
          'expectedOutcome': 'Export held at or under 45 MW from 14:30'}),
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
    work('wk-b01', 'Morning SCADA review and handover', 'Review overnight alarms, availability and the icing forecast with the night shift.', None,
         'HUDDLE', 'routine', 'planned', None, 'operator', 'Operator', '07:00', '07:15', 15, True, '07:18', '06:30'),
    work('wk-b02', 'Permit to work: WTG-02 gearbox oil change', 'Issue the permit and confirm LOTO before the crew climbs.', T('WTG-02'),
         'PERMIT', 'important', 'planned', None, 'operator', 'Operator', '08:15', '08:30', 15, True, '08:27', '07:00'),
    work('wk-b03', 'WTG-02 gearbox oil change', 'Planned oil change and filter replacement.', T('WTG-02'),
         'MAINTENANCE', 'routine', 'planned', None, 'operator', 'Maintenance', '08:30', '16:00', 420, False, None, '07:00'),
    work('wk-b04', 'Met mast sensor check', 'Monthly check of the met mast anemometers and humidity sensor against the reference.', MET_ID,
         'INSTRUMENT_CHECK', 'routine', 'planned', None, 'operator', 'Field Operator', '09:00', '10:00', 45, True, '09:52', '07:00'),
    work('wk-b05', 'Collector substation monthly inspection', 'Walk-down, oil levels, relay targets, battery charger.', SUB_ID,
         'INSPECTION', 'routine', 'planned', None, 'operator', 'Field Operator', '12:00', '13:00', 60, True, '12:55', '07:00'),
    work('wk-b06', 'Reset WTG-12 anemometer heater', 'Reset the heater circuit and confirm the reading against the met mast.', anemo_t,
         'INSTRUMENT_CHECK', 'routine', 'situation', f'From: {sig["BSIT04"]}', 'ai', 'Operator', '09:45', '10:00', 10, True, '09:52', '09:30'),
    work('wk-b07', 'Isolate WTG-10 and re-energise Feeder 2', 'Open WTG-10 loop-feed switches, then close the Feeder 2 breaker.', feeder2,
         'PROCEDURE', 'urgent', 'situation', f'From: {sig["BSIT03"]}', 'ai', 'Field Operator', '10:15', '10:50', 35, True, '10:50', '10:12'),
    work('wk-b08', 'WTG-10 pad transformer test and replacement', 'Oil sample, insulation tests; order a replacement unit.', sub(T('WTG-10'), 'TRAFO'),
         'MAINTENANCE', 'important', 'situation', f'From: {sig["BSIT03"]}', 'ai', 'Maintenance', '13:00', '17:00', 180, False, None, '10:55'),
    work('wk-b09', 'Replace WTG-14 pitch battery pack', 'Stop WTG-14, replace the pitch backup battery pack, run the pitch battery test.', pitch,
         'MAINTENANCE', 'urgent', 'situation', f'From: {sig["BSIT06"]}', 'ai', 'Maintenance', '14:30', '16:30', 120, False, None, '13:25'),
    work('wk-b10', 'Enter 45 MW curtailment setpoint', 'Set the power plant controller to 45 MW and confirm with the grid operator.', SUB_ID,
         'PROCEDURE', 'urgent', 'situation', f'From: {sig["BSIT09"]}', 'ai', 'Operator', '14:00', '14:20', 10, False, None, '13:46'),
    work('wk-b11', 'Borescope and oil sample: WTG-05 gearbox', 'At the next low-wind window; bring a spare HS bearing kit quote.', hsb,
         'INSPECTION', 'important', 'situation', f'From: {sig["BSIT01"]}', 'ai', 'Maintenance', None, '18:00', 120, False, None, '11:45'),
    work('wk-b12', 'Check WTG-17 wind vane alignment', 'Verify the vane north mark against the nacelle axis; correct the offset.', sub(yaw_t, 'YAW'),
         'INSPECTION', 'important', 'situation', f'From: {sig["BSIT07"]}', 'ai', 'Field Operator', None, '17:00', 60, False, None, '09:05'),
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

# Sanity check the type rule the generator relies on: same keys per type.
for a in assets:
    expect = set(TYPE_PROPS[a['assetType']])
    got = set(values.get(a['id'], {}))
    assert got == expect, (a['id'], sorted(expect ^ got))
print(f'Wrote {len(files)} files to {os.path.relpath(OUT, REPO)}: {len(assets)} assets, {len(turbines)} turbines, '
      f'{len(rels)} edges, {N} points, {len(attention)} attention items, {len(work_items)} work items')
