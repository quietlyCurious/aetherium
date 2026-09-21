#!/usr/bin/env python3
"""Validate an industry pack in public/data/<model>/ against INDUSTRY_PACK_SPEC.md.

Usage:  python3 ModelAndData/tools/validate_industry_pack.py <model> [--repo PATH]

The pack's shape comes from its public/data/models.json entry:
  generic     — the v2 format every new pack uses (spec §6, checks per §8)
  four-level  — legacy water/wastewater format (spec §12)
  refinery    — not covered (hierarchy lives in src/assetData.js)

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


# ─────────────────────────────────────────────────────────────────────────────
# Generic packs (spec v2 §6/§8)
# ─────────────────────────────────────────────────────────────────────────────

GENERIC_FILES = {'assets': 'assets.json', 'assetRelationships': 'asset-relationships.json',
                 'properties': 'properties.json', 'assetValues': 'asset-values.json',
                 'assetTelemetry': 'asset-telemetry.json', 'unitStatus': 'unit-status.json',
                 'attentionItems': 'attention-items.json', 'workItems': 'work-items.json'}
# Optional roles a generic pack adds by listing them in its models.json "files" block.
GENERIC_OPTIONAL_FILES = {'explanations': 'explanations.json'}
ID_RE = re.compile(r'^[A-Z0-9_]+$')
SLUG_RE = re.compile(r'^[a-z0-9_]+$')
HMI_CATEGORIES = ['Flow / WIP', 'Events / Losses', 'Stability', 'Quality', 'Derived Metric', 'Condition']
GENERIC_ATT_KEYS = ATT_KEYS + ['assetId', 'unitId', 'primaryProperty']
GENERIC_WORK_KEYS = WORK_KEYS + ['assetId', 'createdAt']
DERIV_FNS = {'sum': sum, 'mean': statistics.mean, 'min': min, 'max': max, 'count': len}


def validate_generic(repo, model, entry, R):
    d = os.path.join(repo, 'public', 'data', model)
    files = {**GENERIC_FILES, **{k: v for k, v in (entry.get('files') or {}).items() if k in GENERIC_FILES}}
    data = {}
    for role, name in files.items():
        p = os.path.join(d, name)
        if not os.path.exists(p):
            R.err('files', f'missing {name}'); continue
        with open(p, encoding='utf-8') as f:
            data[role] = json.load(f)
    unknown = set(entry.get('files') or {}) - set(GENERIC_FILES) - set(GENERIC_OPTIONAL_FILES)
    if unknown: R.err('registry', f'files block has unknown roles {sorted(unknown)}')
    for role, name in GENERIC_OPTIONAL_FILES.items():
        listed = role in (entry.get('files') or {})
        present = os.path.exists(os.path.join(d, name))
        if present and not listed:
            R.warn('registry', f'{name} exists but models.json doesn\'t list it under "files", so the app won\'t load it (§14)')
        if listed and not present:
            R.err('registry', f'models.json lists {name} but the file is missing')
    if R.errors:
        R.print(); sys.exit(1)
    A, REL, PROPS, VAL, TEL, US, ATT, WK = (data[k] for k in GENERIC_FILES)

    # ── Registration ────────────────────────────────────────────────────
    S = 'registry'
    levels = [l['id'] if isinstance(l, dict) else l for l in entry.get('levels') or []]
    unit_level = entry.get('unitLevel')
    if not entry.get('label'): R.warn(S, 'models.json entry has no label')
    if not levels: R.err(S, 'models.json entry needs "levels"')
    if len(set(levels)) != len(levels): R.err(S, 'duplicate level ids')
    if unit_level not in levels: R.err(S, f'unitLevel {unit_level!r} is not one of the levels')
    if levels and not 3 <= len(levels) <= 7: R.warn('budget', f'{len(levels)} levels (§7: 3–7)')
    depth_of = {lv: i for i, lv in enumerate(levels)}

    # ── Hierarchy ───────────────────────────────────────────────────────
    S = 'hierarchy'
    M, kids = {}, defaultdict(list)
    for a in A:
        miss = [k for k in ['id', 'parentId', 'name', 'assetType', 'assetLevel'] if k not in a]
        if miss: R.err(S, f'{a.get("id")} missing {miss}'); continue
        if a['id'] in M: R.err(S, f'duplicate id {a["id"]}')
        M[a['id']] = a
        if not ID_RE.match(a['id']): R.err(S, f'id {a["id"]!r} is not UPPER_SNAKE_CASE')
        if not SLUG_RE.match(a['assetType']): R.err(S, f'{a["id"]} assetType {a["assetType"]!r} is not snake_case')
        if a['assetLevel'] not in depth_of: R.err(S, f'{a["id"]} assetLevel {a["assetLevel"]!r} is not a declared level')
    for a in M.values():
        if a['parentId'] is None:
            if depth_of.get(a['assetLevel']) != 0: R.err(S, f'root {a["id"]} is not at the first level')
        elif a['parentId'] not in M:
            R.err(S, f'{a["id"]} parent {a["parentId"]} does not exist')
        else:
            kids[a['parentId']].append(a)
            p = M[a['parentId']]
            if a['assetLevel'] in depth_of and p['assetLevel'] in depth_of and depth_of[a['assetLevel']] != depth_of[p['assetLevel']] + 1:
                R.err(S, f'{a["id"]} ({a["assetLevel"]}) is not exactly one level below its parent ({p["assetLevel"]})')
    for pid, ch in kids.items():
        names = Counter(c['name'] for c in ch)
        for n, c in names.items():
            if c > 1: R.err(S, f'{pid} has {c} children named {n!r}')
        if len(ch) > 40: R.warn('budget', f'{pid} has {len(ch)} children (§7: ≤ 40)')
    types_by_level = defaultdict(set)
    for a in M.values(): types_by_level[a['assetType']].add(a['assetLevel'])
    for t, lvls in types_by_level.items():
        if len(lvls) > 1: R.err(S, f'assetType {t!r} used on several levels {sorted(lvls)}')
    unused = [lv for lv in levels if not any(a['assetLevel'] == lv for a in M.values())]
    if unused: R.warn(S, f'declared levels with no assets: {unused}')
    # same-type consistency: property keys and child-type sets (§3.1)
    by_type = defaultdict(list)
    for a in M.values(): by_type[(a['assetLevel'], a['assetType'])].append(a)
    for (lv, t), inst in by_type.items():
        keysets = {tuple(sorted(VAL.get(a['id'], {}))) for a in inst}
        if len(keysets) > 1: R.err(S, f'type {t} instances have different property keys ({len(keysets)} variants)')
        childsets = {tuple(sorted({c['assetType'] for c in kids.get(a['id'], [])})) for a in inst}
        if len(childsets) > 1: R.warn(S, f'type {t} instances have different child types (fine for containers like a feeder with mixed turbines; otherwise consider splitting the type)')
    if len(M) > 400: R.warn('budget', f'{len(M)} assets (§7: ≤ 400 soft)')
    units = [a['id'] for a in A if a.get('assetLevel') == unit_level]
    if len(units) > 24: R.warn('budget', f'{len(units)} units at {unit_level!r} (§7: ≤ 24 soft)')

    def unit_of(aid):
        a = M.get(aid)
        while a and a['assetLevel'] != unit_level:
            a = M.get(a['parentId'])
        return a['id'] if a else None

    def label_of(aid):
        names, a = [], M.get(aid)
        while a:
            names.insert(0, a['name'])
            if a['assetLevel'] == unit_level: return SEP.join(names)
            a = M.get(a['parentId'])
        return M[aid]['name'] if aid in M else None

    # ── Properties ──────────────────────────────────────────────────────
    S = 'properties'
    P = PROPS.get('properties') if isinstance(PROPS, dict) else None
    if not isinstance(P, dict): R.err(S, 'properties.json needs a "properties" object'); P = {}
    used = {k for v in VAL.values() for k in v}
    for k in sorted(used - set(P)): R.err(S, f'{k} used by an asset but has no metadata')
    for k in sorted(set(P) - used): R.warn(S, f'{k} has metadata but no asset uses it')
    cats = set()
    for k, m in P.items():
        for f in ['label', 'unit', 'category', 'tier', 'range']:
            if f not in m: R.err(S, f'{k} metadata missing {f!r}')
        if m.get('tier') not in TIERS: R.err(S, f'{k} tier {m.get("tier")!r}')
        r = m.get('range')
        if not (isinstance(r, list) and len(r) == 2 and all(isinstance(x, (int, float)) for x in r) and r[0] < r[1]):
            R.err(S, f'{k} range {r!r} malformed')
        if m.get('category'): cats.add(m['category'])
        if re.search(r'\(.*\)', m.get('label', '')) and m.get('unit') and m['unit'] in m['label']:
            R.warn(S, f'{k} label repeats its unit: {m["label"]!r}')
    extra = sorted(cats - set(HMI_CATEGORIES))
    if extra: R.warn(S, f'extra categories (listed after the standard six): {extra}')
    if len(cats) > 8: R.err(S, f'{len(cats)} categories (§3.4: ≤ 8)')
    tiers = Counter(P[k].get('tier') for k in used if k in P)
    if tiers and tiers['P1'] / sum(tiers.values()) > 0.5: R.warn(S, f'{tiers["P1"]} of {sum(tiers.values())} keys are P1 (aim ~35%)')
    for (lv, t), inst in by_type.items():
        n = len(VAL.get(inst[0]['id'], {}))
        if n == 0: R.warn(S, f'type {t} has no properties (empty preview in the Configurator)')
        elif n > 8: R.warn(S, f'type {t} has {n} properties (§3.3: about 2–8)')
    type_labels = PROPS.get('typeLabels', {}) if isinstance(PROPS, dict) else {}
    for t in type_labels:
        if t not in types_by_level: R.warn(S, f'typeLabels names unknown assetType {t!r}')

    # ── Timeline, values, series ────────────────────────────────────────
    S = 'telemetry'
    tl = TEL.get('timeline') or {}
    ts = TEL.get('timestamps') or []
    grid = []
    try:
        step = tl['stepMinutes']
        if step not in (1, 2, 5, 10, 15): R.err(S, f'stepMinutes {step} (allowed 1, 2, 5, 10, 15)')
        datetime.fromisoformat(tl['date'])
        start, end = tmin(tl['start']), tmin(tl['end'])
        if end <= start or (end - start) % step: R.err(S, 'timeline start/end/step do not form a whole grid')
        grid = [f'{m // 60:02d}:{m % 60:02d}' for m in range(start, end + 1, step)]
    except (KeyError, ValueError, TypeError) as e:
        R.err(S, f'timeline malformed: {e}')
    if grid and ts != grid: R.err(S, 'timestamps do not match timeline')
    npts = len(ts)
    if not 40 <= npts <= 200: R.warn('budget', f'{npts} points per series (§7: 40–200)')
    now_min = tmin(tl['end']) if grid else None
    SER = TEL.get('series') or {}
    for aid in set(VAL) - set(M): R.err('values', f'values for unknown asset {aid}')
    for aid in set(SER) - set(M): R.err(S, f'series for unknown asset {aid}')
    out_of_range, bad_pct = Counter(), set()
    for aid, vals in VAL.items():
        for k, v in vals.items():
            if not isinstance(v, (int, float)) or isinstance(v, bool): R.err('values', f'{aid}.{k} is not a number'); continue
            meta = P.get(k, {})
            s = SER.get(aid, {}).get(k)
            if meta.get('static'):
                if s is not None: R.err(S, f'{aid}.{k} is static but has a series')
                continue
            if s is None: R.err(S, f'{aid}.{k} has no series (mark it static if it is a nameplate value)'); continue
            if len(s) != npts or not all(isinstance(x, (int, float)) for x in s): R.err(S, f'{aid}.{k}: series is not {npts} numbers'); continue
            if not close(v, s[-1], 1e-9): R.err('values', f'{aid}.{k}: current {v} != last point {s[-1]} (§5.3)')
            r = meta.get('range')
            if isinstance(r, list) and len(r) == 2 and (min(s) < r[0] or max(s) > r[1]): out_of_range[k] += 1
            # Percentages stay in 0–100 unless the metric's declared range says it's
            # a ratio that can exceed it (performance vs curve, transformer load).
            pct_hi = max(100, r[1]) if isinstance(r, list) and len(r) == 2 else 100
            if (k.endswith('_pct') or meta.get('unit') == '%') and (min(s) < 0 or max(s) > pct_hi): bad_pct.add(k)
        for k in set(SER.get(aid, {})) - set(vals): R.err(S, f'{aid}.{k} has a series but no current value')
    for k, n in out_of_range.items(): R.warn('ranges', f'{k}: {n} asset(s) go outside its gauge range')
    for k in sorted(bad_pct): R.err('physics', f'{k} goes outside 0–100 (or above its declared range)')

    # ── Derivations (§3.5) ──────────────────────────────────────────────
    S = 'derivations'
    def descendants(aid, scope):
        out, stack = [], list(kids.get(aid, []))
        while stack:
            c = stack.pop(); out.append(c)
            if scope == 'descendants': stack.extend(kids.get(c['id'], []))
        return out
    for dv in (PROPS.get('derivations') or []) if isinstance(PROPS, dict) else []:
        fn = dv.get('fn')
        if fn == 'formula':
            if not dv.get('note'): R.warn(S, f'{dv.get("assetType")}.{dv.get("property")}: formula derivation has no note')
            continue
        if fn not in DERIV_FNS: R.err(S, f'unknown fn {fn!r}'); continue
        from_types = set((dv.get('fromType') or '').split('|'))
        scope = dv.get('scope', 'children')
        targets = [a for a in M.values() if a['assetType'] == dv.get('assetType')]
        if not targets: R.err(S, f'no assets of type {dv.get("assetType")!r}'); continue
        bad = 0
        for t in targets:
            srcs = [c['id'] for c in descendants(t['id'], scope) if c['assetType'] in from_types]
            target_s = SER.get(t['id'], {}).get(dv.get('property'))
            if not srcs or target_s is None: R.err(S, f'{t["id"]}.{dv.get("property")}: no source assets or no target series'); continue
            src_s = [SER.get(x, {}).get(dv.get('of')) for x in srcs]
            if any(x is None for x in src_s): R.err(S, f'{t["id"]}: a source asset has no {dv.get("of")!r} series'); continue
            for i in range(npts):
                exp = DERIV_FNS[fn]([x[i] for x in src_s])
                if not close(target_s[i], exp, max(0.051, abs(exp) * 1e-4)): bad += 1; break
        if bad: R.err(S, f'{dv.get("assetType")}.{dv.get("property")} = {fn}({dv.get("of")}) fails on {bad} asset(s)')

    # ── Relationships ───────────────────────────────────────────────────
    S = 'relationships'
    for r in REL:
        miss = [k for k in ['sourceAssetId', 'targetAssetId', 'relationshipType', 'label', 'layer'] if k not in r]
        if miss: R.err(S, f'edge missing {miss}: {r}'); continue
        if r['sourceAssetId'] not in M or r['targetAssetId'] not in M: R.err(S, f'edge endpoint missing: {r["sourceAssetId"]} -> {r["targetAssetId"]}')
        elif M[r['targetAssetId']].get('parentId') == r['sourceAssetId'] or M[r['sourceAssetId']].get('parentId') == r['targetAssetId']:
            if r['layer'] in ('containment', 'contains'): R.err(S, f'containment edge {r["sourceAssetId"]} -> {r["targetAssetId"]} (containment comes from parentId)')
        if not r.get('layer'): R.err(S, f'edge without layer: {r["sourceAssetId"]} -> {r["targetAssetId"]}')
    if len({(r.get('sourceAssetId'), r.get('targetAssetId'), r.get('layer')) for r in REL}) != len(REL): R.err(S, 'duplicate edges')

    # ── Unit status ─────────────────────────────────────────────────────
    S = 'units'
    for u in units:
        if u not in US: R.err(S, f'unit {u} has no unit-status entry')
    for k, v in US.items():
        if k not in units: R.err(S, f'unit-status entry {k} is not a {unit_level!r} asset')
        if v.get('state') not in LINE_STATES: R.err(S, f'{k} state {v.get("state")!r}')
        if v.get('mode') not in MODES: R.warn(S, f'{k} mode {v.get("mode")!r} has no color yet (shows neutral)')
        if not v.get('product'): R.warn(S, f'{k} has no product')

    # ── Attention items ─────────────────────────────────────────────────
    S = 'attention'
    ids = Counter(a.get('id') for a in ATT)
    for i, n in ids.items():
        if n > 1: R.err(S, f'duplicate id {i}')
    open_units = defaultdict(list)
    for a in ATT:
        aid = a.get('id')
        for k in GENERIC_ATT_KEYS:
            if k not in a: R.err(S, f'{aid} missing {k}')
        dt = a.get('detail', {})
        for k in DETAIL_KEYS:
            if k not in dt: R.err(S, f'{aid} detail missing {k}')
        for fld, allowed in [('severity', SEVERITY), ('attentionState', ATT_STATES)]:
            if a.get(fld) not in allowed: R.err(S, f'{aid} {fld} {a.get(fld)!r}')
        for fld, allowed in [('confidenceLevel', CONF), ('riskLevel', RISK), ('outcomeStatus', OUTCOME)]:
            if dt.get(fld) not in allowed: R.err(S, f'{aid} {fld} {dt.get(fld)!r}')
        asset = a.get('assetId')
        if asset not in M: R.err(S, f'{aid} assetId {asset!r} does not exist'); continue
        exp_unit = unit_of(asset)
        if exp_unit is None:
            # Above the unit level (a site, a feeder, a substation): no unit to name.
            if a.get('unitId') is not None: R.err(S, f'{aid} is on {asset}, above the unit level, so unitId must be null')
            if a.get('line') != M[asset]['name']: R.warn(S, f'{aid} line {a.get("line")!r} (expected the asset\'s own name {M[asset]["name"]!r})')
        elif a.get('unitId') not in units: R.err(S, f'{aid} unitId {a.get("unitId")!r} is not a unit')
        elif a['unitId'] != exp_unit: R.err(S, f'{aid} unitId {a["unitId"]} is not the unit above {asset} ({exp_unit})')
        if a.get('primaryProperty') not in VAL.get(asset, {}): R.err(S, f'{aid} primaryProperty {a.get("primaryProperty")!r} is not a property of {asset}')
        if exp_unit and a.get('asset') != label_of(asset): R.warn(S, f'{aid} asset label {a.get("asset")!r} (expected {label_of(asset)!r})')
        if a.get('unitId') in M and a.get('line') != M[a['unitId']]['name']: R.warn(S, f'{aid} line {a.get("line")!r} (expected unit name {M[a["unitId"]]["name"]!r})')
        pts = dt.get('evidencePoints', [])
        if len(dt.get('evidence', [])) != len(pts): R.warn(S, f'{aid}: evidence has {len(dt.get("evidence", []))} values, evidencePoints {len(pts)}')
        if not 5 <= len(pts) <= 8: R.warn(S, f'{aid}: {len(pts)} evidencePoints (§7: 5–8)')
        off = [p.get('time') for p in pts if p.get('time') not in ts]
        if off: R.err(S, f'{aid}: evidencePoints off the timeline grid: {off[:4]}')
        times = [p['time'] for p in pts if p.get('time') in ts]
        if times != sorted(times): R.err(S, f'{aid}: evidencePoints not in time order')
        resolved_txt, mins = parse_since(a.get('since', ''))
        if mins is None: R.err(S, f'{aid}: since {a.get("since")!r} not in "[Resolved ]Xh Ym ago" form')
        elif mins != a.get('sinceMinutes'): R.err(S, f'{aid}: since text says {mins}m, sinceMinutes={a.get("sinceMinutes")}')
        if resolved_txt is not None and resolved_txt != (dt.get('outcomeStatus') == 'resolved'):
            R.err(S, f'{aid}: "Resolved" in since text disagrees with outcomeStatus')
        if dt.get('outcomeStatus') == 'none':
            open_units[a.get('unitId')].append(a.get('sinceMinutes', 0))
        for r in dt.get('relatedOccurrences', []):
            if set(r) != {'date', 'summary'}: R.err(S, f'{aid}: relatedOccurrence keys {sorted(r)}')
        for w in dt.get('whatChanged', []):
            if not {'time', 'source', 'description', 'related'} <= set(w): R.err(S, f'{aid}: whatChanged entry missing keys')
    for u, mins in open_units.items():
        if u is None: continue  # items above the unit level have no unit tile
        st = US.get(u, {})
        if st.get('state') != 'attention': R.warn('units', f'{u} has open attention items but state is {st.get("state")!r}')
        elif st.get('statusSinceMinutes') != max(mins): R.warn('units', f'{u} statusSinceMinutes {st.get("statusSinceMinutes")} != oldest open item {max(mins)}')

    # ── Scenario coverage (§4.1) ────────────────────────────────────────
    S = 'scenarios'
    n = len(ATT)
    if not 6 <= n <= 14: R.warn(S, f'{n} attention items (§4.1: 6–14)')
    good = [a for a in ATT if a.get('assetId') in M]
    if len({a['unitId'] for a in good if a.get('unitId')}) < min(4, len(units)): R.warn(S, 'items touch fewer than 4 units')
    if len({M[a['assetId']]['assetType'] for a in good}) < 4: R.warn(S, 'items touch fewer than 4 asset types')
    if len({M[a['assetId']]['assetLevel'] for a in good}) < 2: R.warn(S, 'all items are on one hierarchy level')
    if not any(kids.get(a['assetId']) for a in good): R.warn(S, 'no item is on a non-leaf asset')
    oc = Counter(a.get('detail', {}).get('outcomeStatus') for a in ATT)
    if oc['none'] < 2: R.warn(S, f'{oc["none"]} open items (want ≥ 2)')
    if oc['recovering'] < 1: R.warn(S, 'no recovering item')
    if not any(a.get('attentionState') == 'act' for a in ATT): R.warn(S, 'no "act" item')
    if not any(a.get('severity') == 'high' for a in ATT): R.warn(S, 'no high-severity item')
    if not any(a.get('sinceMinutes', 999) <= 30 for a in ATT): R.warn(S, 'no item within 30 min of now')

    # ── Work items ──────────────────────────────────────────────────────
    S = 'work'
    for w in WK:
        wid = w.get('id')
        for k in GENERIC_WORK_KEYS:
            if k not in w: R.err(S, f'{wid} missing {k}')
        if w.get('priority') not in PRIORITY: R.err(S, f'{wid} priority {w.get("priority")!r}')
        if w.get('sourceType') not in SRC_TYPE: R.err(S, f'{wid} sourceType {w.get("sourceType")!r}')
        if w.get('source') not in SRC: R.err(S, f'{wid} source {w.get("source")!r}')
        if w.get('assetId') is not None and w['assetId'] not in M: R.err(S, f'{wid} assetId {w["assetId"]!r} does not exist')
        if w.get('sourceType') == 'situation' and not str(w.get('sourceLabel') or '').startswith('From: '):
            R.warn(S, f'{wid} situation work item sourceLabel should be "From: <situation>"')
        for k in ['plannedStart', 'dueAt', 'completedAt', 'createdAt']:
            v = w.get(k)
            if v:
                try:
                    dtv = datetime.fromisoformat(v)
                    if v.endswith('Z'): R.err(S, f'{wid}.{k} must be local time without Z')
                    if grid and dtv.date().isoformat() != tl['date']: R.warn(S, f'{wid}.{k} not on the timeline date')
                except ValueError:
                    R.err(S, f'{wid}.{k} not ISO: {v}')
        if w.get('done') and not w.get('completedAt'): R.err(S, f'{wid} done but no completedAt')
        if not w.get('done') and w.get('completedAt'): R.err(S, f'{wid} not done but has completedAt')
    if not 8 <= len(WK) <= 15: R.warn('budget', f'{len(WK)} work items (§7: 8–15)')
    if sum(1 for w in WK if not w.get('done')) < 2: R.warn(S, 'fewer than 2 open work items')

    # ── Explanations (optional, spec §14) ───────────────────────────────
    exp_path = os.path.join(d, 'explanations.json')
    exp_kb = 0
    if os.path.exists(exp_path):
        exp_kb = os.path.getsize(exp_path) // 1024
        with open(exp_path, encoding='utf-8') as f:
            validate_explanations(json.load(f), ATT, WK, TEL, M, R)
        if exp_kb > 1024: R.warn('budget', f'explanations.json is {exp_kb} KB (§14: ≤ 1 MB)')

    # ── Sizes ───────────────────────────────────────────────────────────
    total = 0
    for name in set(files.values()):
        sz = os.path.getsize(os.path.join(d, name)); total += sz
        if sz > 3_000_000: R.err('budget', f'{name} is {sz // 1024} KB (§7: ≤ 3 MB)')
    if total > 5_000_000: R.err('budget', f'pack is {total // 1024} KB (§7: ≤ 5 MB)')

    print(f'Industry pack: {model}  (generic; {len(levels)} levels, {len(M)} assets, {len(units)} units, '
          f'{len(REL)} edges, {len(used)} property keys, {npts} points, {len(ATT)} attention, {len(WK)} work, {total // 1024} KB'
          + (f'; explanations {exp_kb} KB' if exp_kb else '') + ')\n')
    sys.exit(1 if R.print() else 0)


EXP_ITEM_KEYS = ['detectorId', 'detectedAt', 'conclusion', 'chart', 'checks', 'references', 'ruledOut', 'confidence', 'action']
CHECK_STATUS = {'match', 'nomatch', 'pending'}
CHECK_ROLE = {'required', 'supporting'}
SERIES_STYLES = {'primary', 'expected', 'reference', 'secondary', 'peer'}
REF_KINDS = {'textbook', 'early', 'lookalike', 'variant'}
VERDICT_KINDS = {'match', 'partial', 'nomatch'}
RULE_OUT_VERDICTS = {'ruled out', 'unlikely', 'not yet checked'}


def validate_explanations(E, ATT, WK, TEL, M, R):
    """explanations.json (spec §14): every item and detector reference
    resolves, every chart's series fits its axis, every time is on the grid."""
    S = 'explanations'
    ts = TEL.get('timestamps') or []
    on_grid = set(ts)
    att_ids = {a['id'] for a in ATT}
    work_ids = {w['id'] for w in WK}
    dets = E.get('detectors') or {}
    items = E.get('items') or {}

    def chart_ok(where, c):
        if not isinstance(c, dict):
            R.err(S, f'{where}: chart is not an object'); return
        x = c.get('x')
        n = len(x['values']) if x else len(ts)
        if x and x.get('unit') not in ('h', 'min'): R.err(S, f'{where}: x.unit {x.get("unit")!r}')
        y = c.get('y')
        if not (isinstance(y, list) and len(y) == 2 and y[0] < y[1]): R.err(S, f'{where}: y must be [lo, hi]')
        for sr in c.get('series') or []:
            if sr.get('style') not in SERIES_STYLES: R.err(S, f'{where}: series {sr.get("id")} style {sr.get("style")!r}')
            if len(sr.get('values') or []) != n: R.err(S, f'{where}: series {sr.get("id")} has {len(sr.get("values") or [])} points, axis has {n}')
        if not c.get('series'): R.err(S, f'{where}: no series')
        b = c.get('band')
        if b and (len(b.get('lo') or []) != n or len(b.get('hi') or []) != n): R.err(S, f'{where}: band length')
        sg = c.get('shadeGap')
        if sg and not all(any(sr.get('id') == g for sr in c['series']) for g in sg): R.err(S, f'{where}: shadeGap ids')
        for m in c.get('markers') or []:
            if not x and m.get('time') not in on_grid: R.err(S, f'{where}: marker time {m.get("time")!r} off the grid')
        for t in c.get('window') or []:
            if t not in on_grid: R.err(S, f'{where}: window time {t!r} off the grid')

    def spark_ok(where, sp):
        if len(sp.get('values') or []) != len(ts): R.err(S, f'{where}: spark has {len(sp.get("values") or [])} points')
        b = sp.get('band')
        if b and (len(b['lo']) != len(ts) or len(b['hi']) != len(ts)): R.err(S, f'{where}: spark band length')
        for t in (sp.get('highlight') or []) + (sp.get('window') or []):
            if t not in on_grid: R.err(S, f'{where}: spark time {t!r} off the grid')

    for did, dd in dets.items():
        for k in ['id', 'name', 'archetype', 'summary', 'pipeline', 'definition', 'run']:
            if k not in dd: R.err(S, f'detector {did} missing {k}')
        for f in (dd.get('run') or {}).get('fired') or []:
            if f.get('assetId') not in M: R.err(S, f'detector {did} fired on unknown asset {f.get("assetId")!r}')
    for iid, x in items.items():
        w = iid
        if iid not in att_ids: R.err(S, f'{iid} is not an attention item'); continue
        for k in EXP_ITEM_KEYS:
            if k not in x: R.err(S, f'{w} missing {k}')
        if x.get('detectorId') not in dets: R.err(S, f'{w} detectorId {x.get("detectorId")!r} not in detectors')
        if x.get('detectedAt') not in on_grid: R.err(S, f'{w} detectedAt {x.get("detectedAt")!r} off the grid')
        con = x.get('conclusion') or {}
        if con.get('confidence') not in CONF: R.err(S, f'{w} conclusion.confidence {con.get("confidence")!r}')
        if (x.get('confidence') or {}).get('level') not in CONF: R.err(S, f'{w} confidence.level')
        if x.get('rootCauseAssetId') and x['rootCauseAssetId'] not in M: R.err(S, f'{w} rootCauseAssetId unknown')
        if 'chart' in x: chart_ok(f'{w} chart', x['chart'])
        req = [c for c in x.get('checks') or [] if c.get('role') == 'required']
        if not req: R.err(S, f'{w} has no required checks')
        for c in x.get('checks') or []:
            cw = f'{w} check {c.get("id")}'
            if c.get('status') not in CHECK_STATUS: R.err(S, f'{cw} status {c.get("status")!r}')
            if c.get('role') not in CHECK_ROLE: R.err(S, f'{cw} role {c.get("role")!r}')
            if c.get('role') == 'required' and c.get('status') != 'match': R.err(S, f'{cw}: a raised item needs every required check to match')
            for k in ('label', 'value', 'why'):
                if not c.get(k): R.err(S, f'{cw} missing {k}')
            if c.get('spark'): spark_ok(cw, c['spark'])
        refs = x.get('references') or []
        if not 2 <= len(refs) <= 3: R.warn(S, f'{w} has {len(refs)} reference examples (§14: 2–3)')
        if refs and not any(r.get('kind') == 'lookalike' for r in refs): R.warn(S, f'{w} has no look-alike reference')
        for r in refs:
            rw = f'{w} reference {r.get("id")}'
            if r.get('kind') not in REF_KINDS: R.err(S, f'{rw} kind {r.get("kind")!r}')
            if (r.get('verdict') or {}).get('kind') not in VERDICT_KINDS: R.err(S, f'{rw} verdict kind')
            for k, ch in enumerate(r.get('charts') or []):
                chart_ok(f'{rw} chart {k}', ch)
                if not ch.get('x'): R.err(S, f'{rw} chart {k} needs a relative x axis')
        for ro in x.get('ruledOut') or []:
            if ro.get('verdict') not in RULE_OUT_VERDICTS: R.err(S, f'{w} rule-out {ro.get("cause")!r} verdict {ro.get("verdict")!r}')
            if ro.get('chart'): chart_ok(f'{w} rule-out {ro.get("cause")!r}', ro['chart'])
        for wid in (x.get('action') or {}).get('workItemIds') or []:
            if wid not in work_ids: R.err(S, f'{w} action work item {wid!r} does not exist')
    missing = sorted(att_ids - set(items))
    if missing: R.warn(S, f'attention items with no explanation (the app falls back to the plain AI view): {missing}')


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    model = args[0]
    repo = args[args.index('--repo') + 1] if '--repo' in args else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    d = os.path.join(repo, 'public', 'data', model)
    R = Report()

    # models.json registration (spec §9) — also supplies any per-role
    # filename overrides, so this validates exactly the files the app loads.
    overrides = {}
    reg_path = os.path.join(repo, 'public', 'data', 'models.json')
    try:
        with open(reg_path, encoding='utf-8') as f:
            registry = json.load(f)
        entry = next((m for m in registry if m.get('id') == model), None)
        if entry is None:
            R.warn('registry', f'"{model}" is not listed in public/data/models.json, so the app will not offer it')
        else:
            shape = entry.get('shape', 'four-level')
            if shape == 'generic':
                validate_generic(repo, model, entry, R)
                return
            if shape != 'four-level':
                R.err('registry', f'models.json shape is {shape!r}; this validator covers generic and four-level packs only')
            if not entry.get('label'):
                R.warn('registry', 'models.json entry has no label')
            overrides = entry.get('files') or {}
    except FileNotFoundError:
        R.err('registry', 'public/data/models.json not found')
    ROLE_OF = {'asset-data.json': 'assetData', 'asset-relationships.json': 'assetRelationships',
               'station-telemetry.json': 'stationTelemetry', 'station-full-properties.json': 'stationFullProperties',
               'station-metrics.json': 'stationMetrics', 'station-sparklines.json': 'stationSparklines',
               'equipment-telemetry.json': 'equipmentTelemetry', 'equipment-metrics.json': 'equipmentMetrics',
               'line-telemetry.json': 'lineTelemetry', 'line-rollups.json': 'lineRollups',
               'plant-telemetry.json': 'plantTelemetry', 'plant-rollups.json': 'plantRollups',
               'line-status.json': 'lineStatus', 'operating-context.json': 'operatingContext',
               'property-labels.json': 'propertyLabels', 'property-categories.json': 'propertyCategories',
               'property-tiers.json': 'propertyTiers', 'property-ranges.json': 'propertyRanges',
               'attention-items.json': 'attentionItems', 'work-items.json': 'workItems'}
    unknown = set(overrides) - set(ROLE_OF.values())
    if unknown: R.err('registry', f'models.json files block has unknown roles {sorted(unknown)}')

    def load(*names, required=True):
        names = [overrides.get(ROLE_OF.get(n), n) for n in names]
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                with open(p, encoding='utf-8') as f:
                    return json.load(f)
        if required:
            R.err('files', f'missing {" or ".join(names)}')
        return None

    A = load('asset-data.json')
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
