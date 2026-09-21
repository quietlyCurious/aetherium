#!/usr/bin/env python3
"""Convert the three legacy packs (refinery, water, wastewater) into the
generic 8-file format of INDUSTRY_PACK_SPEC.md §6.

This is how public/data/{refinery,water,wastewater}/ were produced. The
legacy 20-file packs it reads were deleted after the conversion; to rerun
it, check out the last commit that still has them and point --src at it:

    git worktree add ../aetherium-legacy 004d401
    python3 ModelAndData/tools/convert_legacy_to_generic.py --src ../aetherium-legacy
    git worktree remove ../aetherium-legacy

Options:
    --src DIR     repo checkout holding the legacy packs (default: this repo)
    --out DIR     repo to write public/data/<model>/ into (default: this repo)
    --only NAME   convert just one pack

Standard library only. Deterministic: the same input gives the same output.

What stays the same, so saved Configurator settings keep working:
- every asset id, assetType and assetLevel (the hierarchy is copied as-is)
- every property key that was already shown, except as listed below

What changes, and why:
- Data is keyed by real asset id. The legacy packs keyed the same stations
  and lines by other ids (AUR_L01_INTAKE, MERIDIAN_MER_T01) and the app
  translated with string rules; generic packs never do that.
- Refinery stations also get their instrument tags ("measured" series,
  already labelled in the legacy metadata) and their throughput, so every
  attention item has a real series to show. The tags are renamed to the
  spec's snake_case-with-unit keys (BearingTempC → bearing_temp_c).
- Text-valued properties (bottleneck_station, best_line, worst_line,
  best_train, worst_train) are dropped: generic values are numeric.
- Data quirks from spec §12 are fixed:
  * percentages clamped to 0–100, and negative noise on times, rates and
    indices clamped to 0 (keys naming an offset or deviation stay signed);
  * plant-level rollups recomputed from their lines at every point, and
    declared as derivations (sum / mean / max), so the validator checks them;
  * missing ranges derived from the data, and ranges widened where the
    data went outside them;
  * evidence points moved onto the 5-minute grid (keeping their order, one
    point per grid time) and clipped to the timeline; the primary series
    is reshaped to pass through the numeric evidence at those times, so
    the Trend chart and the evidence table agree;
  * every property declares its decimals;
  * work-item times lose their "Z" (they are local times on the demo day);
  * "Meridian & Confluence" work items point at the Meridian plant.
"""
import json
import os
import re
import sys

SEP = ' · '
DATE = '2026-08-28'
STEP = 5

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

UNIT_SUFFIXES = [
    ('_pct', '%'), ('_mg_l', 'mg/L'), ('_ntu', 'NTU'), ('_psi', 'psi'), ('_gpm', 'gpm'),
    ('_scfm', 'scfm'), ('_rpm', 'rpm'), ('_mms', 'mm/s'), ('_temp_c', '°C'), ('_c', '°C'),
    ('_a', 'A'), ('_per_min', '/min'), ('_min', 'min'), ('_ft', 'ft'), ('_per_s', '1/s'), ('_per_day', '/day'),
    ('_per_week', '/week'), ('_per_hr', '/hr'), ('_hrs', 'h'), ('_days', 'days'),
    ('_gpd_ft', 'gpd/ft'), ('_svi', 'mL/g'), ('_ph', 'pH'),
]
# Percent-type keys that the legacy data let drift above 100.
PERCENT_WORDS = ('availability', 'performance', 'oee', 'quality_factor', 'health_index')
# Keys that may legitimately go negative; every other series is clamped at 0
# (the legacy noise pushed times, rates and indices slightly below zero).
SIGNED_WORDS = ('offset', 'deviation')

# Refinery instrument tags → spec keys (snake_case, unit last).
MEASURED_KEYS = {
    'BearingTempC': 'bearing_temp_c', 'CalibrationScore': 'calibration_score',
    'ControlEffortPct': 'control_effort_pct', 'ControllerOutputPct': 'controller_output_pct',
    'FlowRate': 'flow_rate_per_min', 'InputCharacteristicIndex': 'input_characteristic_index',
    'LocalGaugePressure': 'local_gauge_pressure_psi', 'MotorCurrentA': 'motor_current_a',
    'PressurePV': 'process_pressure_psi', 'PurityPct': 'purity_pct', 'RejectRatePct': 'reject_rate_pct',
    'TemperatureC': 'temperature_c', 'TransferRate': 'transfer_rate_per_min', 'VibrationMmS': 'vibration_mms',
}
STATION_THROUGHPUT = 'throughput_per_min'

PACKS = {
    'refinery': {
        'label': 'Refinery',
        'levels': [('refinery', 'Refinery'), ('line', 'Line'), ('station', 'Station')],
        'unitLevel': 'line', 'plantTelemetry': 'refinery-telemetry.json', 'plantRollups': 'refinery-rollups.json',
        'plantPrefix': 'refinery_', 'stageLevel': 'station', 'equipmentLevel': None,
    },
    'water': {
        'label': 'Water',
        'levels': [('plant', 'Plant'), ('train', 'Train'), ('stage', 'Stage'), ('equipment', 'Equipment')],
        'unitLevel': 'train', 'plantTelemetry': 'plant-telemetry.json', 'plantRollups': 'plant-rollups.json',
        'plantPrefix': 'plant_', 'stageLevel': 'stage', 'equipmentLevel': 'equipment',
    },
    'wastewater': {
        'label': 'Wastewater',
        'levels': [('plant', 'Plant'), ('train', 'Train'), ('stage', 'Stage'), ('equipment', 'Equipment')],
        'unitLevel': 'train', 'plantTelemetry': 'plant-telemetry.json', 'plantRollups': 'plant-rollups.json',
        'plantPrefix': 'plant_', 'stageLevel': 'stage', 'equipmentLevel': 'equipment',
    },
}

# Primary property per attention item, where the legacy sparkline doesn't
# name one (line-level items, refinery items whose evidence is a tag).
PRIMARY_OVERRIDES = {
    'SIT02': 'line_throughput', 'SIT14': 'line_throughput',
    'SIT03': STATION_THROUGHPUT, 'SIT08': STATION_THROUGHPUT, 'SIT09': STATION_THROUGHPUT,
    'SIT12': STATION_THROUGHPUT,
    'SIT05': 'vibration_mms', 'SIT06': 'process_pressure_psi', 'SIT07': 'reject_rate_pct',
    'SIT10': 'charge_rate', 'SIT11': 'transfer_rate_per_min', 'SIT13': 'purity_pct', 'SIT04': 'buffer_level',
    'WSIT06': 'headloss_ft',
}


def infer_unit(key):
    for suf, unit in UNIT_SUFFIXES:
        if key.endswith(suf):
            return unit
    return ''


def tmin(t):
    h, m = t.split(':')
    return int(h) * 60 + int(m)


def hhmm(x):
    return f'{x // 60:02d}:{x % 60:02d}'


def parse_asset_data_js(path):
    """The legacy refinery hierarchy lived in src/assetData.js as object literals."""
    text = open(path, encoding='utf-8').read()
    out = []
    pat = re.compile(r"\{\s*id:\s*'([^']+)',\s*parentId:\s*(null|'[^']*'),\s*name:\s*'([^']+)',\s*"
                     r"assetType:\s*'([^']+)',\s*assetLevel:\s*'([^']+)'\s*\}")
    for m in pat.finditer(text):
        pid = None if m.group(2) == 'null' else m.group(2).strip("'")
        out.append({'id': m.group(1), 'parentId': pid, 'name': m.group(3), 'assetType': m.group(4), 'assetLevel': m.group(5)})
    return out


def place_on_grid(minutes, grid):
    """Strictly increasing grid indices for each time: first keep the largest
    single move as small as possible, then the total (a small dynamic
    programme — there are only a handful of points)."""
    n, g = len(minutes), len(grid)
    if n == 0:
        return []
    INF = float('inf')
    for limit in sorted({abs(t - m) for t in grid for m in minutes}):
        cost = [[INF] * g for _ in range(n)]
        back = [[-1] * g for _ in range(n)]
        for k in range(g):
            if abs(grid[k] - minutes[0]) <= limit:
                cost[0][k] = abs(grid[k] - minutes[0])
        for i in range(1, n):
            best, arg = INF, -1
            for k in range(g):
                if k > 0 and cost[i - 1][k - 1] < best:
                    best, arg = cost[i - 1][k - 1], k - 1
                if best < INF and abs(grid[k] - minutes[i]) <= limit:
                    cost[i][k] = best + abs(grid[k] - minutes[i])
                    back[i][k] = arg
        k = min(range(g), key=lambda j: cost[n - 1][j])
        if cost[n - 1][k] == INF:
            continue
        out = [k]
        for i in range(n - 1, 0, -1):
            k = back[i][k]
            out.append(k)
        return out[::-1]
    raise ValueError('evidence points cannot be placed on the grid')


def depth_first(assets):
    kids = {}
    for a in assets:
        kids.setdefault(a['parentId'], []).append(a)
    out = []

    def walk(pid):
        for a in kids.get(pid, []):
            out.append(a)
            walk(a['id'])
    walk(None)
    return out


def convert(model, src_repo, out_repo, report):
    cfg = PACKS[model]
    src = os.path.join(src_repo, 'public', 'data', model)
    L = lambda n: json.load(open(os.path.join(src, n), encoding='utf-8'))

    # ── Hierarchy ───────────────────────────────────────────────────────
    if model == 'refinery':
        assets = parse_asset_data_js(os.path.join(src_repo, 'src', 'assetData.js'))
    else:
        assets = L('water-asset-data.json')
    assets = depth_first(assets)
    M = {a['id']: a for a in assets}
    lv_plant, lv_unit, lv_stage = cfg['levels'][0][0], cfg['unitLevel'], cfg['stageLevel']
    by = lambda lv: [a for a in assets if a['assetLevel'] == lv]

    # Legacy alias ids → real asset ids (the string rules the app used to apply).
    def stage_alias(a):
        unit = M[a['parentId']]
        plant = M[unit['parentId']]
        if model == 'refinery':
            num = re.sub(r'\D', '', unit['name']).zfill(2)
            return f'{plant["id"][:3]}_L{num}_{a["name"].replace(" ", "").upper()}'
        return f'{plant["id"][:3]}_{unit["name"]}_{a["assetType"].replace("_", "").upper()}'

    def unit_alias(a):
        plant = M[a['parentId']]
        if model == 'refinery':
            num = re.sub(r'\D', '', a['name']).zfill(2)
            return f'{plant["id"][:3]}_L{num}'
        return f'{plant["id"]}_{plant["id"][:3]}_{a["name"]}'

    stage_of = {stage_alias(a): a['id'] for a in by(lv_stage)}
    unit_of = {unit_alias(a): a['id'] for a in by(lv_unit)}
    status_unit_of = {a['id']: a['id'] for a in by(lv_unit)}
    status_unit_of.update(unit_of)

    # ── Values and series ───────────────────────────────────────────────
    ST = L('station-telemetry.json')
    ts = ST['timestamps']
    n = len(ts)
    series, values = {}, {}
    numeric = lambda d: {k: v for k, v in d.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}

    PT, PR = L(cfg['plantTelemetry'])['refineries'], L(cfg['plantRollups'])
    for pid in PR:
        series[pid] = {k: list(v) for k, v in PT[pid].items() if k in numeric(PR[pid])}
    LT, LR = L('line-telemetry.json')['lines'], L('line-rollups.json')
    for alias, v in LR.items():
        series[unit_of[alias]] = {k: list(s) for k, s in LT[alias].items() if k in numeric(v)}
    FP = L('station-full-properties.json')
    for alias, v in FP.items():
        aid = stage_of[alias]
        grp = ST['stations'][alias]
        s = {}
        for k in v:                      # a few refinery stations already show a tag
            s[MEASURED_KEYS.get(k, k)] = list(grp['typed'][k] if k in grp['typed'] else grp['measured'][k])
        if model == 'refinery':
            for k, vals in grp.get('measured', {}).items():
                s[MEASURED_KEYS[k]] = list(vals)
            s[STATION_THROUGHPUT] = list(grp['universal']['throughput'])
        series[aid] = s
    if cfg['equipmentLevel']:
        ET, EM = L('equipment-telemetry.json')['equipment'], L('equipment-metrics.json')
        for eid, v in EM.items():
            series[eid] = {k: list(ET[eid][k]) for k in v}
    missing = [a['id'] for a in assets if a['id'] not in series]
    if missing:
        report.append(f'{model}: {len(missing)} assets have no properties: {missing[:4]}')

    # Metadata (merged legacy files, renamed tags)
    lab, cat, tier, rng = (L(f'property-{x}.json') for x in ('labels', 'categories', 'tiers', 'ranges'))
    for old, new in MEASURED_KEYS.items():
        for d in (lab, cat, tier, rng):
            if old in d:
                d[new] = d.pop(old)
    lab.setdefault(STATION_THROUGHPUT, 'Throughput')
    cat.setdefault(STATION_THROUGHPUT, 'Flow / WIP')
    tier.setdefault(STATION_THROUGHPUT, 'P2')

    # Quirk: percentages above 100 (and below 0).
    clamped = set()
    for aid, s in series.items():
        for k, vals in s.items():
            pct = infer_unit(k) == '%' or any(w in k for w in PERCENT_WORDS)
            if pct and (max(vals) > 100 or min(vals) < 0):
                s[k] = [min(100.0, max(0.0, x)) for x in vals]
                clamped.add(k)
    if clamped:
        report.append(f'{model}: clamped to 0–100: {sorted(clamped)}')
    floored = set()
    for aid, s in series.items():
        for k, vals in s.items():
            if min(vals) < 0 and not any(w in k for w in SIGNED_WORDS):
                s[k] = [max(0.0, x) for x in vals]
                floored.add(k)
    if floored:
        report.append(f'{model}: negative noise clamped to 0: {sorted(floored)}')

    # Quirk: plant rollups at every point — recomputed from the lines.
    plant_prefix = cfg['plantPrefix']
    rollup_rules = {'throughput': ('sum', 'line_throughput'), 'target_rate': ('sum', 'line_target_rate'),
                    'oee': ('mean', 'line_oee'), 'availability': ('mean', 'line_availability'),
                    'performance': ('mean', 'line_performance'), 'quality_factor': ('mean', 'line_quality_factor'),
                    'health_index': ('mean', 'system_health_index'), 'instability_index': ('max', 'instability_index')}
    derivations = []
    fns = {'sum': sum, 'mean': lambda v: sum(v) / len(v), 'max': max}
    for plant in by(lv_plant):
        units = [a['id'] for a in by(lv_unit) if a['parentId'] == plant['id']]
        for suffix, (fn, of) in rollup_rules.items():
            key = plant_prefix + suffix
            if key not in series.get(plant['id'], {}) or not all(of in series[u] for u in units):
                continue
            series[plant['id']][key] = [round(fns[fn]([series[u][of][i] for u in units]), 2) for i in range(n)]
    unit_type = by(lv_unit)[0]['assetType']
    plant_type = by(lv_plant)[0]['assetType']
    for suffix, (fn, of) in rollup_rules.items():
        key = plant_prefix + suffix
        if any(key in series.get(p['id'], {}) for p in by(lv_plant)):
            derivations.append({'assetType': plant_type, 'property': key, 'fn': fn, 'of': of,
                                'fromType': unit_type, 'scope': 'children'})
    derivations.append({'assetType': unit_type, 'property': 'line_oee', 'fn': 'formula',
                        'note': 'line_availability × line_performance × line_quality_factor (legacy line model)'})

    # Round, and current value = last point (spec §5.3).
    for aid, s in series.items():
        for k in s:
            s[k] = [round(x, 3) for x in s[k]]
        values[aid] = {k: v[-1] for k, v in s.items()}

    # ── Attention items (before properties.json: evidence edits the series) ─
    grid = set(ts)
    end = tmin(ts[-1])
    start = tmin(ts[0])

    def unit_ancestor(aid):
        a = M.get(aid)
        while a and a['assetLevel'] != lv_unit:
            a = M.get(a['parentId'])
        return a

    def display_label(aid):
        u = unit_ancestor(aid)
        if not u:
            return M[aid]['name']
        path, a = [], M[aid]
        while a['id'] != u['id']:
            path.append(a['name'])
            a = M[a['parentId']]
        path.append(u['name'])
        return SEP.join(reversed(path))

    def label_to_id(lbl):
        cand = '_'.join(p.strip().upper().replace(' ', '_') for p in lbl.split(SEP))
        if cand in M:
            return cand
        # refinery station ids keep their words ('POWER_CHARGE'); water equipment drops the spaces
        cand2 = '_'.join(p.strip().upper().replace(' ', '') for p in lbl.split(SEP))
        return cand2 if cand2 in M else None

    SP = L('station-sparklines.json')
    num_re = re.compile(r'^\s*(-?\d+(?:\.\d+)?)')
    att = L('attention-items.json')
    for a in att:
        aid = label_to_id(a['asset'])
        if not aid:
            report.append(f'{model}: {a["id"]} asset {a["asset"]!r} did not resolve')
            continue
        u = unit_ancestor(aid)
        a['assetId'] = aid
        a['unitId'] = u['id'] if u else None
        alias = next((s for s, x in stage_of.items() if x == aid), None)
        prim = PRIMARY_OVERRIDES.get(a['id']) or (SP[alias]['property'] if alias in SP else None)
        if prim not in series[aid]:
            report.append(f'{model}: {a["id"]} primary property {prim!r} not on {aid}')
        a['primaryProperty'] = prim
        a['asset'] = display_label(aid)
        a['line'] = u['name'] if u else M[aid]['name']
        d = a['detail']
        # Evidence onto the grid: snap, clip to the timeline, merge duplicates.
        # Points inside the timeline go onto the grid, one per grid time and in
        # order, moving each as little as possible in total (minute-apart
        # events stay apart instead of merging).
        inside = [(p, v) for p, v in zip(d['evidencePoints'], d['evidence'])
                  if start - STEP / 2 <= tmin(p['time']) <= end + STEP / 2]
        slots = place_on_grid([tmin(p['time']) for p, _ in inside], [tmin(t) for t in ts])
        pts = [(dict(p, time=ts[k]), v) for (p, v), k in zip(inside, slots)]
        dropped = len(d['evidencePoints']) - len(pts)
        # If the original last point (the "Current" reading) fell off the end, end at "now".
        if dropped and pts and pts[-1][0]['time'] != ts[-1] and any(p['label'] == 'Current' for p in d['evidencePoints']):
            pts.append(({'time': ts[-1], 'value': None, 'label': 'Current'}, None))
        numeric_evidence = all(num_re.match(str(p[0]['value'] or '0')) for p in pts)
        prim_series = series[aid][prim]
        unit_txt = ''
        m0 = num_re.match(str(d['evidencePoints'][0]['value']))
        if m0:
            unit_txt = str(d['evidencePoints'][0]['value'])[m0.end():]
        changed = 0.0
        anchors = [(ts.index(q['time']), float(v)) for q, v in pts if v is not None] if numeric_evidence else []
        if len(anchors) >= 2:
            # Pass exactly through the evidence, keeping the series' own texture:
            # new = line through the evidence + (original − line through the original).
            orig = list(prim_series)
            for (i0, v0), (i1, v1) in zip(anchors, anchors[1:]):
                for i in range(i0, i1 + 1):
                    f = (i - i0) / (i1 - i0) if i1 > i0 else 0
                    base_new = v0 + f * (v1 - v0)
                    base_old = orig[i0] + f * (orig[i1] - orig[i0])
                    prim_series[i] = round(base_new + (orig[i] - base_old), 3)
            for i, v in anchors:
                changed = max(changed, abs(orig[i] - v) / (abs(v) + 1e-9))
        elif len(anchors) == 1:
            i, v = anchors[0]
            changed = abs(prim_series[i] - v) / (abs(v) + 1e-9)
            prim_series[i] = round(v, 3)
        for q, v in pts:
            i = ts.index(q['time'])
            if q['value'] is None:
                val = prim_series[i]
                q['value'] = f'{val:g}{unit_txt}'
        d['evidencePoints'] = [q for q, _ in pts]
        d['evidence'] = [v if v is not None else prim_series[ts.index(q['time'])] for q, v in pts]
        if dropped or changed > 0.05:
            report.append(f'{model}: {a["id"]} evidence: {dropped} point(s) merged or clipped'
                          + (f', primary series moved up to {changed:.0%} to match the evidence' if changed > 0.05 else ''))
        values[aid][prim] = prim_series[-1]

    # ── properties.json ─────────────────────────────────────────────────
    used = sorted({k for v in values.values() for k in v})
    props, derived_ranges, widened = {}, [], []
    for k in used:
        vals = [x for s in series.values() if k in s for x in s[k]]
        lo, hi = min(vals), max(vals)
        r = rng.get(k)
        if not r:
            pad = (hi - lo) * 0.1 or 1
            r = [round(max(0, lo - pad), 1) if lo >= 0 else round(lo - pad, 1), round(hi + pad, 1)]
            derived_ranges.append(k)
        elif lo < r[0] or hi > r[1]:
            span = r[1] - r[0]
            r = [min(r[0], round(lo - 0.05 * span, 1)), max(r[1], round(hi + 0.05 * span, 1))]
            if r[0] < 0 <= lo:
                r[0] = 0
            widened.append(k)
        unit = infer_unit(k)
        pct = unit == '%' or any(w in k for w in PERCENT_WORDS)
        if pct:
            unit = '%'
            r = [max(0, r[0]), min(100, r[1])] if hi <= 100 else r
        props[k] = {'label': lab.get(k, k.replace('_', ' ').title()), 'unit': unit,
                    'category': cat.get(k, 'Derived Metric'), 'tier': tier.get(k, 'P3'), 'range': r}
        # Every property declares its decimals (like the generated packs):
        # small magnitudes get 2, everything else 1.
        props[k]['decimals'] = 2 if max(abs(lo), abs(hi)) < 10 else 1
    if derived_ranges:
        report.append(f'{model}: ranges derived from data: {derived_ranges}')
    if widened:
        report.append(f'{model}: ranges widened to fit the data: {widened}')

    # ── Unit status ─────────────────────────────────────────────────────
    OC = L('operating-context.json')
    unit_status = {}
    for x in L('line-status.json'):
        uid = status_unit_of[x['id']]
        ctx = OC.get(x['id'], {})
        unit_status[uid] = {'state': x['state'], 'statusSinceMinutes': x.get('statusSinceMinutes'),
                            'mode': ctx.get('mode', 'STEADY'), 'product': ctx.get('product', '')}

    # Quirk: a unit that needs attention has been in that state since its
    # oldest open item started (spec §6.6).
    for uid, st in unit_status.items():
        open_items = [a['sinceMinutes'] for a in att if a.get('unitId') == uid and a['detail']['outcomeStatus'] == 'none']
        if st['state'] == 'attention' and open_items and st['statusSinceMinutes'] != max(open_items):
            st['statusSinceMinutes'] = max(open_items)

    # ── Work items ──────────────────────────────────────────────────────
    work = L('work-items.json')
    for w in work:
        lbl = w.get('assetLabel')
        if lbl == 'Meridian & Confluence':
            lbl = by(lv_plant)[0]['name']
        aid = label_to_id(lbl) if lbl else None
        if lbl and not aid:
            report.append(f'{model}: work item {w["id"]} label {lbl!r} did not resolve')
        w['assetId'] = aid
        w['assetLabel'] = display_label(aid) if aid else None
        for k in ('plannedStart', 'dueAt', 'completedAt', 'createdAt'):
            if w.get(k):
                w[k] = w[k].replace('.000Z', '').replace('Z', '')
        if not w.get('createdAt'):
            w['createdAt'] = w.get('plannedStart') or f'{DATE}T{ts[0]}:00'

    # ── Write ───────────────────────────────────────────────────────────
    telemetry = {'timeline': {'date': DATE, 'start': ts[0], 'end': ts[-1], 'stepMinutes': STEP},
                 'timestamps': ts, 'series': series}
    type_labels = {}
    out = {
        'assets.json': assets,
        'asset-relationships.json': L('asset-relationships.json'),
        'properties.json': {'properties': props, 'derivations': derivations, 'typeLabels': type_labels},
        'asset-values.json': values,
        'asset-telemetry.json': telemetry,
        'unit-status.json': unit_status,
        'attention-items.json': att,
        'work-items.json': work,
    }
    dst = os.path.join(out_repo, 'public', 'data', model)
    os.makedirs(dst, exist_ok=True)
    for name, data in out.items():
        compact = name in ('asset-telemetry.json', 'asset-values.json')
        with open(os.path.join(dst, name), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=None if compact else 1,
                      separators=(',', ':') if compact else None)
            f.write('\n')
    return {'id': model, 'label': cfg['label'],
            'levels': [{'id': i, 'label': l} for i, l in cfg['levels']], 'unitLevel': cfg['unitLevel']}


def main():
    args = sys.argv[1:]
    opt = lambda name, default: args[args.index(name) + 1] if name in args else default
    src, out = os.path.abspath(opt('--src', REPO)), os.path.abspath(opt('--out', REPO))
    only = opt('--only', None)
    report, entries = [], []
    for model in PACKS:
        if only and model != only:
            continue
        entries.append(convert(model, src, out, report))
        print(f'Converted {model} → public/data/{model}/')
    for line in report:
        print('  ' + line)
    print('models.json entries:')
    print(json.dumps(entries, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
