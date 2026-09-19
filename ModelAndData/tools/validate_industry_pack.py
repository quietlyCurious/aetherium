#!/usr/bin/env python3
"""Validate a 4-level industry pack in public/data/<model>/ against INDUSTRY_PACK_SPEC.md.

Usage:  python3 ModelAndData/tools/validate_industry_pack.py <model> [--repo PATH]

Standard library only. Exit code 1 if any ERROR is reported.
ERROR   = breaks the app or violates a hard rule in the spec.
WARN    = allowed, but needs a stated reason (spec §8).
"""
import json, os, re, sys, statistics
from collections import Counter, defaultdict
from datetime import datetime

SEP = ' \u00b7 '
LEVELS = ['plant', 'train', 'stage', 'equipment']
UNIVERSAL = ['performance', 'availability', 'quality_factor', 'throughput', 'oee', 'wip', 'queue_length', 'scrap_rate']
PCT_UNIVERSAL = ['performance', 'availability', 'quality_factor', 'oee']
LINE_KEYS = ['line_throughput', 'line_target_rate', 'line_oee', 'line_availability', 'line_quality_factor',
             'total_wip', 'instability_index', 'system_health_index', 'flow_efficiency']
PLANT_KEYS = ['plant_throughput', 'plant_target_rate', 'plant_oee', 'plant_availability',
              'plant_quality_factor', 'plant_health_index', 'plant_instability_index']
CATEGORIES = {'Flow / WIP', 'Events / Losses', 'Stability', 'Quality', 'Derived Metric', 'Condition'}
TIERS = {'P1', 'P2', 'P3'}
LINE_STATES = {'running', 'attention', 'changeover', 'down'}
MODES = {'STEADY', 'CHANGEOVER', 'RAMP_UP', 'RAMP_DOWN', 'STOPPED', 'MAINTENANCE', 'CONTROLLED_HOLD'}
SEVERITY = {'high', 'medium', 'low'}
ATT_STATES = {'urgent', 'act', 'investigate', 'watch'}
CONF = {'high', 'medium', 'low', 'n/a'}
RISK = {'high', 'medium', 'low', 'none'}
OUTCOME = {'resolved', 'recovering', 'none'}
PRIORITY = {'urgent', 'important', 'routine'}
SRC_TYPE = {'planned', 'situation'}
SRC = {'operator', 'ai'}
GRID = [f'{h:02d}:{m:02d}' for h in range(8, 15) for m in range(0, 60, 5) if (h, m) <= (14, 5)]
NOW_MIN = 14 * 60 + 5
ATT_KEYS = ['id', 'severity', 'asset', 'line', 'signal', 'aiInterpretation', 'since', 'sinceMinutes', 'attentionState', 'detail']
DETAIL_KEYS = ['signal', 'observed', 'derived', 'inferred', 'recommendation', 'evidence', 'evidencePoints',
               'relatedOccurrences', 'whatChangedSummary', 'whatChanged', 'confidence', 'confidenceLevel',
               'risk', 'riskLevel', 'expectedOutcome', 'outcomeStatus']
WORK_KEYS = ['id', 'text', 'description', 'assetLabel', 'workType', 'priority', 'sourceType', 'sourceLabel', 'source',
             'assignedRole', 'plannedStart', 'dueAt', 'estimatedDurationMinutes', 'done', 'completedAt']


class Report:
    def __init__(self):
        self.errors, self.warns = defaultdict(list), defaultdict(list)

    def err(self, section, msg): self.errors[section].append(msg)
    def warn(self, section, msg): self.warns[section].append(msg)

    def print(self, cap=8):
        for title, bucket in (('ERROR', self.errors), ('WARN', self.warns)):
            for section, msgs in bucket.items():
                print(f'{title:5} [{section}] {len(msgs)} issue(s)')
                for m in msgs[:cap]:
                    print(f'        - {m}')
                if len(msgs) > cap:
                    print(f'        … {len(msgs) - cap} more')
        n_e = sum(map(len, self.errors.values())); n_w = sum(map(len, self.warns.values()))
        print(f'\n{n_e} error(s), {n_w} warning(s)')
        return n_e


def tmin(t):
    h, m = t.split(':'); return int(h) * 60 + int(m)


def parse_since(s):
    m = re.fullmatch(r'(Resolved )?(?:(\d+)h )?(\d+)m ago', s)
    if not m:
        return None, None
    return bool(m.group(1)), int(m.group(2) or 0) * 60 + int(m.group(3))


def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    model = args[0]
    repo = args[args.index('--repo') + 1] if '--repo' in args else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    d = os.path.join(repo, 'public', 'data', model)
    R = Report()

    def load(*names, required=True):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                with open(p, encoding='utf-8') as f:
                    return json.load(f)
        if required:
            R.err('files', f'missing {" or ".join(names)}')
        return None

    A = load('asset-data.json', 'water-asset-data.json')
    if A is None:
        R.print(); sys.exit(1)
    REL = load('asset-relationships.json')
    REL_COPY = load(f'asset-relationships-{model}.json', required=False)
    ST = load('station-telemetry.json'); FP = load('station-full-properties.json'); SM = load('station-metrics.json')
    SP = load('station-sparklines.json'); ET = load('equipment-telemetry.json'); EM = load('equipment-metrics.json')
    LT = load('line-telemetry.json'); LR = load('line-rollups.json'); PT = load('plant-telemetry.json')
    PR = load('plant-rollups.json'); LS = load('line-status.json'); OC = load('operating-context.json')
    LAB = load('property-labels.json'); CAT = load('property-categories.json'); TIER = load('property-tiers.json')
    RNG = load('property-ranges.json'); ATT = load('attention-items.json'); WK = load('work-items.json')
    if R.errors:
        R.print(); sys.exit(1)

    # ── Hierarchy ──────────────────────────────────────────────────────────
    S = 'hierarchy'
    M = {}
    for a in A:
        for k in ['id', 'parentId', 'name', 'assetType', 'assetLevel']:
            if k not in a: R.err(S, f'{a.get("id")} missing {k}')
        if a['id'] in M: R.err(S, f'duplicate id {a["id"]}')
        M[a['id']] = a
        if a['assetLevel'] not in LEVELS: R.err(S, f'{a["id"]} bad assetLevel {a["assetLevel"]}')
    by = {lv: [a for a in A if a['assetLevel'] == lv] for lv in LEVELS}
    parent_level = {'train': 'plant', 'stage': 'train', 'equipment': 'stage'}
    for a in A:
        lv = a['assetLevel']
        if lv == 'plant':
            if a['parentId'] is not None: R.err(S, f'plant {a["id"]} has a parent')
        elif M.get(a['parentId'], {}).get('assetLevel') != parent_level.get(lv):
            R.err(S, f'{a["id"]} parent {a["parentId"]} is not a {parent_level.get(lv)}')
    slug = lambda n: n.lower().replace(' ', '_')
    plant_of, train_of = {}, {}
    for p in by['plant']:
        if p['id'] != p['name'].upper().replace(' ', ''): R.err(S, f'plant id {p["id"]} != UPPER(name)')
    prefixes = Counter(p['id'][:3] for p in by['plant'])
    for pfx, n in prefixes.items():
        if n > 1: R.err(S, f'plant prefix {pfx} not unique')
    for t in by['train']:
        p = M[t['parentId']]
        if ' ' in t['name']: R.err(S, f'train name has spaces: {t["name"]}')
        if t['id'] != f'{p["id"]}_{t["name"]}': R.err(S, f'train id {t["id"]} != PLANT_ID_name')
        if t['assetType'] != 'train': R.warn(S, f'train {t["id"]} assetType {t["assetType"]} (existing packs use "train")')
    for s in by['stage']:
        t = M[s['parentId']]; p = M[t['parentId']]
        if s['assetType'] != slug(s['name']): R.err(S, f'stage {s["id"]} assetType != slug(name)')
        if s['id'] != f'{t["id"]}_{s["name"].upper().replace(" ", "_")}': R.err(S, f'stage id {s["id"]} breaks rule')
    for e in by['equipment']:
        if e['assetType'] != slug(e['name']): R.err(S, f'equipment {e["id"]} assetType != slug(name)')
        if e['id'] != f'{e["parentId"]}_{e["name"].upper().replace(" ", "")}': R.err(S, f'equipment id {e["id"]} breaks rule')
    # structure repeats across trains
    seq = {t['id']: [s['assetType'] for s in by['stage'] if s['parentId'] == t['id']] for t in by['train']}
    if len({tuple(v) for v in seq.values()}) > 1: R.warn(S, 'stage types/order differ between trains')
    eq_by_stype = defaultdict(set)
    for s in by['stage']:
        eq_by_stype[s['assetType']].add(tuple(sorted(e['assetType'] for e in by['equipment'] if e['parentId'] == s['id'])))
    for st, v in eq_by_stype.items():
        if len(v) > 1: R.warn(S, f'equipment set for stage type {st} differs between trains')
    for lv, lo, hi in [('plant', 1, 2), ('train', 6, 12), ('stage', 30, 36), ('equipment', 80, 100)]:
        n = len(by[lv])
        if not lo <= n <= hi: R.warn('size', f'{n} {lv} assets (target {lo}–{hi})')
    for s in by['stage']:
        n = sum(1 for e in by['equipment'] if e['parentId'] == s['id'])
        if not 2 <= n <= 3: R.warn('size', f'{s["id"]} has {n} equipment (target 2–3)')

    # expected ids per spec §3.2
    def station_id(s):
        t = M[s['parentId']]; p = M[t['parentId']]
        return f'{p["id"][:3]}_{t["name"]}_{s["assetType"].replace("_", "").upper()}'
    def line_id(t):
        p = M[t['parentId']]; return f'{p["id"]}_{p["id"][:3]}_{t["name"]}'
    def line_label(t):
        return f'{M[t["parentId"]]["name"]}{SEP}{t["name"]}'
    stations = {station_id(s): s for s in by['stage']}
    lines = {line_id(t): t for t in by['train']}
    plants = {p['id']: p for p in by['plant']}
    equips = {e['id']: e for e in by['equipment']}
    label_to_line = {line_label(t): line_id(t) for t in by['train']}

    # ── Key coverage across files ──────────────────────────────────────────
    S = 'coverage'
    def same(name, got, want):
        got, want = set(got), set(want)
        if got != want:
            R.err(S, f'{name}: missing {sorted(want - got)[:4]} extra {sorted(got - want)[:4]}')
    same('station-telemetry.stations', ST['stations'], stations)
    same('station-full-properties', FP, stations)
    same('station-metrics', SM, stations)
    same('equipment-telemetry.equipment', ET['equipment'], equips)
    same('equipment-metrics', EM, equips)
    same('line-telemetry.lines', LT['lines'], lines)
    same('line-rollups', LR, lines)
    same('line-status ids', [x['id'] for x in LS], lines)
    same('operating-context', OC, lines)
    if 'refineries' not in PT: R.err(S, 'plant-telemetry must use top-level key "refineries"')
    same('plant-telemetry.refineries', PT.get('refineries', {}), plants)
    same('plant-rollups', PR, plants)

    # ── Timeline ──────────────────────────────────────────────────────────
    S = 'timeline'
    for name, f in [('station', ST), ('equipment', ET), ('line', LT), ('plant', PT)]:
        if f.get('timestamps') != GRID: R.err(S, f'{name}-telemetry timestamps are not the 74-point 08:00–14:05 5-min grid')
    def series_ok(where, s):
        if not isinstance(s, list) or len(s) != 74 or not all(isinstance(v, (int, float)) for v in s):
            R.err(S, f'{where}: not 74 numbers'); return False
        return True

    # ── Stage telemetry & snapshots ───────────────────────────────────────
    S = 'stations'
    stage_keys, equip_keys = set(), set()
    for sid, blk in ST['stations'].items():
        if sid not in stations: continue
        if sorted(blk.get('universal', {})) != sorted(UNIVERSAL): R.err(S, f'{sid} universal keys != the 8 fixed keys')
        typed = blk.get('typed', {})
        if not 4 <= len(typed) <= 6: R.warn('size', f'{sid} has {len(typed)} typed properties (target 4–6)')
        if set(typed) & set(UNIVERSAL): R.err(S, f'{sid} typed repeats a universal key')
        stage_keys |= set(typed)
        for k, v in list(blk.get('universal', {}).items()) + list(typed.items()):
            series_ok(f'{sid}.{k}', v)
        u = blk.get('universal', {})
        if all(k in u for k in ['oee', 'availability', 'performance', 'quality_factor']):
            bad = sum(1 for i in range(74) if not close(u['oee'][i], u['availability'][i] * u['performance'][i] * u['quality_factor'][i] / 1e4, 0.06))
            if bad: R.err(S, f'{sid}: oee != A*P*Q at {bad} points')
        for k in PCT_UNIVERSAL:
            if k in u and (max(u[k]) > 100 or min(u[k]) < 0): R.err('physics', f'{sid}.{k} outside 0–100 (max {max(u[k])})')
        for k in ['wip', 'queue_length', 'scrap_rate', 'throughput']:
            if k in u and min(u[k]) < 0: R.err('physics', f'{sid}.{k} negative')
        # snapshot rules
        fp = FP.get(sid, {})
        if set(fp) != set(typed): R.err(S, f'{sid}: full-properties keys != typed keys')
        for k, v in fp.items():
            if k in typed and not close(v, typed[k][-1], 1e-6): R.err(S, f'{sid}.{k}: full-properties {v} != last point {typed[k][-1]}')
        sm = SM.get(sid, {})
        for mk, uk in [('throughput', 'throughput'), ('oee', 'oee'), ('wip', 'wip'), ('queueLength', 'queue_length'), ('scrapRate', 'scrap_rate')]:
            if uk in u and not close(sm.get(mk), u[uk][-1], 0.051): R.err(S, f'{sid}.{mk}: metrics {sm.get(mk)} != last universal {u[uk][-1]}')
        st_obj = stations[sid]
        if sm.get('stationType') != st_obj['assetType'].upper(): R.err(S, f'{sid} stationType {sm.get("stationType")} != UPPER(assetType) {st_obj["assetType"].upper()}')
        if sm.get('plant') != M[M[st_obj['parentId']]['parentId']]['name']: R.err(S, f'{sid} plant field wrong')
        hl = sm.get('highlights', [])
        if len(hl) != 2: R.warn(S, f'{sid} has {len(hl)} highlights (expected 2)')
        for h in hl:
            if h.get('label') not in typed: R.err(S, f'{sid} highlight {h.get("label")} not a typed key')
            elif not close(h.get('value'), typed[h['label']][-1], 1e-3): R.err(S, f'{sid} highlight {h["label"]} value != last point')
    for sid, v in SP.items():
        typed = ST['stations'].get(sid, {}).get('typed', {})
        if v.get('property') not in typed: R.err('sparklines', f'{sid}: property {v.get("property")} not typed')
        elif v.get('values') != typed[v['property']]: R.err('sparklines', f'{sid}: values != full typed series')

    # ── Equipment ─────────────────────────────────────────────────────────
    S = 'equipment'
    eq_types_keys = defaultdict(set)
    for eid, blk in ET['equipment'].items():
        if eid not in equips: continue
        equip_keys |= set(blk); eq_types_keys[equips[eid]['assetType']].add(tuple(sorted(blk)))
        if not 2 <= len(blk) <= 5: R.warn('size', f'{eid} has {len(blk)} properties (target 2–5)')
        for k, v in blk.items():
            if series_ok(f'{eid}.{k}', v) and not close(EM.get(eid, {}).get(k), v[-1], 1e-6):
                R.err(S, f'{eid}.{k}: metrics != last point')
        if set(EM.get(eid, {})) != set(blk): R.err(S, f'{eid}: metrics keys != telemetry keys')
    for t, v in eq_types_keys.items():
        if len(v) > 1: R.warn(S, f'equipment type {t} has differing property sets across instances')

    # ── Line & plant rollups ──────────────────────────────────────────────
    S = 'rollups'
    for lid, t in lines.items():
        blk = LT['lines'].get(lid, {})
        if sorted(blk) != sorted(LINE_KEYS): R.err(S, f'{lid} line-telemetry keys != the 9 line keys')
        for k, v in blk.items():
            series_ok(f'{lid}.{k}', v)
        sids = [station_id(s) for s in by['stage'] if s['parentId'] == t['id']]
        us = [ST['stations'][s]['universal'] for s in sids if s in ST['stations']]
        if not us or not all(k in blk for k in LINE_KEYS): continue
        chk = {
            'line_throughput': lambda i: statistics.mean(x['throughput'][i] for x in us),
            'line_oee': lambda i: statistics.mean(x['oee'][i] for x in us),
            'line_availability': lambda i: statistics.mean(x['availability'][i] for x in us),
            'line_quality_factor': lambda i: statistics.mean(x['quality_factor'][i] for x in us),
            'total_wip': lambda i: sum(x['wip'][i] for x in us),
            'system_health_index': lambda i: blk['line_oee'][i],
            'flow_efficiency': lambda i: blk['line_availability'][i],
        }
        for k, fn in chk.items():
            bad = sum(1 for i in range(74) if not close(blk[k][i], fn(i), 0.06))
            if bad: R.err(S, f'{lid}.{k} != formula at {bad}/74 points')
        lr = LR.get(lid, {})
        for k in LINE_KEYS:
            if not close(lr.get(k), blk[k][-1], 0.006): R.err(S, f'{lid}.{k}: rollup != last point')
        tps = {ST['stations'][s]['universal']['throughput'][-1]: SM[s]['stationType'] for s in sids}
        if lr.get('bottleneck_station') != tps[min(tps)]: R.err(S, f'{lid} bottleneck_station {lr.get("bottleneck_station")} != lowest-throughput stage {tps[min(tps)]}')
    for pid, p in plants.items():
        blk = PT['refineries'].get(pid, {})
        if sorted(blk) != sorted(PLANT_KEYS): R.err(S, f'{pid} plant-telemetry keys != the 7 plant keys')
        for k, v in blk.items():
            series_ok(f'{pid}.{k}', v)
        lids = [line_id(t) for t in by['train'] if t['parentId'] == pid]
        ls = [LT['lines'][l] for l in lids if l in LT['lines']]
        if not ls or not all(k in blk for k in PLANT_KEYS): continue
        chk = {
            'plant_throughput': lambda i: sum(x['line_throughput'][i] for x in ls),
            'plant_target_rate': lambda i: sum(x['line_target_rate'][i] for x in ls),
            'plant_oee': lambda i: statistics.mean(x['line_oee'][i] for x in ls),
            'plant_availability': lambda i: statistics.mean(x['line_availability'][i] for x in ls),
            'plant_quality_factor': lambda i: statistics.mean(x['line_quality_factor'][i] for x in ls),
            'plant_health_index': lambda i: blk['plant_oee'][i],
            'plant_instability_index': lambda i: max(x['instability_index'][i] for x in ls),
        }
        for k, fn in chk.items():
            bad = sum(1 for i in range(74) if not close(blk[k][i], fn(i), 0.06))
            if bad: R.err(S, f'{pid}.{k} != formula at {bad}/74 points')
        pr = PR.get(pid, {})
        for k in PLANT_KEYS:
            if not close(pr.get(k), blk[k][-1], 0.006): R.err(S, f'{pid}.{k}: rollup != last point')
        oees = {LT['lines'][l]['line_oee'][-1]: l for l in lids}
        if pr.get('best_train') != oees[max(oees)] or pr.get('worst_train') != oees[min(oees)]:
            R.err(S, f'{pid} best/worst_train do not match line_oee at 14:05')

    # ── Property metadata ─────────────────────────────────────────────────
    S = 'metadata'
    rollup_keys = set(LINE_KEYS) | set(PLANT_KEYS) | {'bottleneck_station', 'best_train', 'worst_train'}
    numeric_keys = stage_keys | equip_keys
    for name, f in [('labels', LAB), ('categories', CAT), ('tiers', TIER)]:
        miss = sorted((numeric_keys | rollup_keys) - set(f))
        if miss: R.err(S, f'property-{name} missing {len(miss)}: {miss[:6]}')
    miss = sorted(numeric_keys - set(RNG))
    if miss: R.err(S, f'property-ranges missing {miss}')
    for k, v in CAT.items():
        if v not in CATEGORIES: R.err(S, f'category for {k} is {v!r}')
    for k, v in TIER.items():
        if v not in TIERS: R.err(S, f'tier for {k} is {v!r}')
    for k, v in RNG.items():
        if not (isinstance(v, list) and len(v) == 2 and v[0] < v[1]): R.err(S, f'range for {k} malformed: {v}')
    tiers = Counter(TIER[k] for k in numeric_keys if k in TIER)
    if tiers and tiers['P1'] / sum(tiers.values()) > 0.5: R.warn(S, f'{tiers["P1"]} of {sum(tiers.values())} keys are P1 (aim ~35%)')
    if not 40 <= len(numeric_keys) <= 55: R.warn('size', f'{len(numeric_keys)} distinct stage/equipment property keys (target 40–55)')
    # values inside ranges; _pct within 0–100
    out = Counter()
    def check_range(k, series):
        if k in RNG:
            lo, hi = RNG[k]
            if min(series) < lo or max(series) > hi: out[k] += 1
        if k.endswith('_pct') and (min(series) < 0 or max(series) > 100): R.err('physics', f'{k} outside 0–100')
    for blk in ST['stations'].values():
        for k, v in blk.get('typed', {}).items(): check_range(k, v)
    for blk in ET['equipment'].values():
        for k, v in blk.items(): check_range(k, v)
    for k, n in out.items():
        R.warn('ranges', f'{k}: {n} asset(s) go outside its gauge range')

    # ── Relationships ─────────────────────────────────────────────────────
    S = 'relationships'
    train_of_eq = lambda eid: M[M[eid]['parentId']]['parentId']
    layers = Counter()
    for r in REL:
        for k in ['sourceAssetId', 'targetAssetId', 'relationshipType', 'label', 'layer']:
            if k not in r: R.err(S, f'edge missing {k}: {r}')
        s, t = r.get('sourceAssetId'), r.get('targetAssetId')
        if s not in equips or t not in equips: R.err(S, f'edge endpoint not an equipment asset: {s} -> {t}'); continue
        if train_of_eq(s) != train_of_eq(t): R.err(S, f'edge crosses trains: {s} -> {t}')
        if not r.get('layer'): R.err(S, f'edge without layer: {s} -> {t}')
        layers[r.get('layer')] += 1
    if 'process_flow' not in layers: R.err(S, 'no process_flow layer')
    if len(set((r['sourceAssetId'], r['targetAssetId'], r['layer']) for r in REL)) != len(REL): R.err(S, 'duplicate edges')
    if REL_COPY is not None and REL_COPY != REL: R.err(S, f'asset-relationships-{model}.json differs from asset-relationships.json')
    if REL_COPY is None: R.warn(S, f'asset-relationships-{model}.json copy missing')
    if not 60 <= len(REL) <= 75: R.warn('size', f'{len(REL)} edges (target 60–75)')

    # ── Line status / context ─────────────────────────────────────────────
    S = 'status'
    ls_by = {x['id']: x for x in LS}
    for x in LS:
        if x.get('state') not in LINE_STATES: R.err(S, f'{x["id"]} state {x.get("state")}')
        if x['id'] in lines and x.get('label') != line_label(lines[x['id']]): R.err(S, f'{x["id"]} label {x.get("label")!r} != {line_label(lines[x["id"]])!r}')
    for k, v in OC.items():
        if v.get('mode') not in MODES: R.err(S, f'{k} mode {v.get("mode")}')
        if not v.get('product'): R.err(S, f'{k} product empty')

    # ── Attention items ───────────────────────────────────────────────────
    S = 'attention'
    ids = Counter(a.get('id') for a in ATT)
    for i, n in ids.items():
        if n > 1: R.err(S, f'duplicate id {i}')
    open_lines = defaultdict(list)
    trains_hit, stypes_hit = set(), set()
    for a in ATT:
        aid = a.get('id')
        for k in ATT_KEYS:
            if k not in a: R.err(S, f'{aid} missing {k}')
        dt = a.get('detail', {})
        for k in DETAIL_KEYS:
            if k not in dt: R.err(S, f'{aid} detail missing {k}')
        if a.get('severity') not in SEVERITY: R.err(S, f'{aid} severity {a.get("severity")}')
        if a.get('attentionState') not in ATT_STATES: R.err(S, f'{aid} attentionState {a.get("attentionState")}')
        if dt.get('confidenceLevel') not in CONF: R.err(S, f'{aid} confidenceLevel {dt.get("confidenceLevel")}')
        if dt.get('riskLevel') not in RISK: R.err(S, f'{aid} riskLevel {dt.get("riskLevel")}')
        if dt.get('outcomeStatus') not in OUTCOME: R.err(S, f'{aid} outcomeStatus {dt.get("outcomeStatus")}')
        parts = a.get('asset', '').split(SEP)
        if a.get('line') not in label_to_line: R.err(S, f'{aid} line {a.get("line")!r} matches no train label')
        else: trains_hit.add(a['line'])
        if len(parts) == 3:
            aid_asset = '_'.join(p.strip().upper().replace(' ', '_') for p in parts)
            if aid_asset not in M or M[aid_asset]['assetLevel'] != 'stage':
                R.err(S, f'{aid} asset {a.get("asset")!r} does not resolve to a stage id ({aid_asset})')
            else:
                stypes_hit.add(M[aid_asset]['assetType'])
                sid = station_id(M[aid_asset])
                if sid not in SP: R.warn(S, f'{aid}: no station-sparklines entry for {sid}')
            if SEP.join(parts[:2]) != a.get('line'): R.err(S, f'{aid} asset and line disagree')
        elif len(parts) != 2:
            R.err(S, f'{aid} asset {a.get("asset")!r} must have 2 or 3 parts')
        pts = dt.get('evidencePoints', [])
        if len(dt.get('evidence', [])) != len(pts): R.warn(S, f'{aid}: evidence has {len(dt.get("evidence", []))} values, evidencePoints has {len(pts)}')
        if not 2 <= len(pts) <= 8: R.warn(S, f'{aid}: {len(pts)} evidencePoints (target 5–8)')
        off = [p['time'] for p in pts if p.get('time') not in GRID]
        if off: R.warn(S, f'{aid}: evidencePoints off the 5-min grid or outside 08:00–14:05: {off[:4]}')
        times = [p['time'] for p in pts if re.fullmatch(r'\d\d:\d\d', p.get('time', ''))]
        if times != sorted(times): R.err(S, f'{aid}: evidencePoints not in time order')
        resolved_txt, mins = parse_since(a.get('since', ''))
        if mins is None: R.err(S, f'{aid}: since {a.get("since")!r} not in "[Resolved ]Xh Ym ago" form')
        elif mins != a.get('sinceMinutes'): R.err(S, f'{aid}: since text says {mins}m, sinceMinutes={a.get("sinceMinutes")}')
        if resolved_txt is not None and resolved_txt != (dt.get('outcomeStatus') == 'resolved'):
            R.err(S, f'{aid}: "Resolved" in since text disagrees with outcomeStatus {dt.get("outcomeStatus")}')
        if dt.get('outcomeStatus') == 'none':
            open_lines[a.get('line')].append(a.get('sinceMinutes', 0))
            if times and a.get('sinceMinutes') is not None and NOW_MIN - a['sinceMinutes'] != tmin(times[0]):
                R.warn(S, f'{aid}: open item starts at {times[0]} but sinceMinutes implies {NOW_MIN - a["sinceMinutes"]}')
        for r in dt.get('relatedOccurrences', []):
            if set(r) != {'date', 'summary'}: R.err(S, f'{aid}: relatedOccurrence keys {sorted(r)}')
        for w in dt.get('whatChanged', []):
            if not {'time', 'source', 'description', 'related'} <= set(w): R.err(S, f'{aid}: whatChanged entry missing keys')
    # line-status consistency with open items
    for lbl, lid in label_to_line.items():
        x = ls_by.get(lid)
        if not x: continue
        if open_lines.get(lbl) and x['state'] != 'attention':
            R.warn('status', f'{lbl} has open attention items but state is {x["state"]}')
        if open_lines.get(lbl) and x['state'] == 'attention' and x.get('statusSinceMinutes') != max(open_lines[lbl]):
            R.warn('status', f'{lbl} statusSinceMinutes {x.get("statusSinceMinutes")} != oldest open item {max(open_lines[lbl])}')
    # coverage minimums
    S = 'scenarios'
    n = len(ATT)
    if n < 8: R.warn(S, f'{n} attention items (spec minimum 8)')
    if len(trains_hit) < 5: R.warn(S, f'items touch {len(trains_hit)} trains (minimum 5)')
    if len(stypes_hit) < 4: R.warn(S, f'items touch {len(stypes_hit)} stage types (minimum 4)')
    oc = Counter(a['detail'].get('outcomeStatus') for a in ATT)
    if oc['none'] < 2: R.warn(S, f'{oc["none"]} open items (want 2–3)')
    if oc['recovering'] < 1: R.warn(S, 'no recovering item')
    if not any(a.get('attentionState') == 'act' for a in ATT): R.warn(S, 'no "act" item')
    if not any(a.get('severity') == 'high' for a in ATT): R.warn(S, 'no high-severity item')
    if not any(a.get('sinceMinutes', 999) <= 30 for a in ATT): R.warn(S, 'no item within 30 min of now (new-item dot stays off)')

    # ── Work items ────────────────────────────────────────────────────────
    S = 'work'
    plant_names = {p['name'] for p in by['plant']}
    for w in WK:
        wid = w.get('id')
        for k in WORK_KEYS:
            if k not in w: R.err(S, f'{wid} missing {k}')
        if w.get('priority') not in PRIORITY: R.err(S, f'{wid} priority {w.get("priority")}')
        if w.get('sourceType') not in SRC_TYPE: R.err(S, f'{wid} sourceType {w.get("sourceType")}')
        if w.get('source') not in SRC: R.err(S, f'{wid} source {w.get("source")}')
        if w.get('sourceType') == 'situation' and not str(w.get('sourceLabel') or '').startswith('From: '): R.warn(S, f'{wid} situation work item sourceLabel should be "From: <situation>"')
        if w.get('sourceType') == 'planned' and w.get('sourceLabel'): R.warn(S, f'{wid} planned work item has a sourceLabel')
        lbl = w.get('assetLabel')
        if lbl and lbl not in plant_names and SEP.join(lbl.split(SEP)[:2]) not in label_to_line: R.err(S, f'{wid} assetLabel {lbl!r} is not a plant name, train label or stage label')
        if lbl and len(lbl.split(SEP)) == 3 and '_'.join(x.strip().upper().replace(' ', '_') for x in lbl.split(SEP)) not in M: R.err(S, f'{wid} stage assetLabel {lbl!r} does not resolve')
        for k in ['plannedStart', 'dueAt', 'completedAt', 'createdAt']:
            v = w.get(k)
            if v:
                try:
                    dtv = datetime.fromisoformat(v)
                    if v.endswith('Z'): R.err(S, f'{wid}.{k} must be local time without Z')
                    if dtv.date().isoformat() != '2026-08-28': R.warn(S, f'{wid}.{k} not on 2026-08-28')
                except ValueError:
                    R.err(S, f'{wid}.{k} not ISO: {v}')
        if w.get('done') and not w.get('completedAt'): R.err(S, f'{wid} done but no completedAt')
        if not w.get('done') and w.get('completedAt'): R.err(S, f'{wid} not done but has completedAt')
    if not 9 <= len(WK) <= 14: R.warn('size', f'{len(WK)} work items (target 9–14)')
    if sum(1 for w in WK if not w.get('done')) < 2: R.warn(S, 'fewer than 2 open work items')

    # ── File sizes ────────────────────────────────────────────────────────
    for f in os.listdir(d):
        sz = os.path.getsize(os.path.join(d, f))
        if sz > 700_000: R.warn('size', f'{f} is {sz // 1024} KB (target < 700 KB)')

    print(f'Industry pack: {model}  ({len(by["plant"])} plant, {len(by["train"])} trains, {len(by["stage"])} stages, '
          f'{len(by["equipment"])} equipment, {len(REL)} edges, {len(numeric_keys)} property keys, '
          f'{len(ATT)} attention, {len(WK)} work)\n')
    sys.exit(1 if R.print() else 0)


if __name__ == '__main__':
    main()
