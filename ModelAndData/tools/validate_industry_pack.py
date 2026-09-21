#!/usr/bin/env python3
"""Validate an industry pack in public/data/<model>/ against INDUSTRY_PACK_SPEC.md.

Usage:  python3 ModelAndData/tools/validate_industry_pack.py <model> [--repo PATH]
        python3 ModelAndData/tools/validate_industry_pack.py --all [--repo PATH]

Every pack uses the generic format (spec §6, checks per §8). --all
validates every model listed in public/data/models.json.

Standard library only. Exit code 1 if any ERROR is reported.
ERROR   = breaks the app or violates a hard rule in the spec.
WARN    = allowed, but needs a stated reason (spec §8).
"""
import json, os, re, sys, statistics
from collections import Counter, defaultdict
from datetime import datetime

SEP = ' \u00b7 '
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
        return R.print() or 1
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
    return R.print()


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
    repo = args[args.index('--repo') + 1] if '--repo' in args else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    try:
        with open(os.path.join(repo, 'public', 'data', 'models.json'), encoding='utf-8') as f:
            registry = json.load(f)
    except FileNotFoundError:
        print('ERROR public/data/models.json not found'); sys.exit(1)
    models = [m['id'] for m in registry] if args[0] == '--all' else [args[0]]
    failed = []
    for model in models:
        R = Report()
        entry = next((m for m in registry if m.get('id') == model), None)
        if entry is None:
            R.err('registry', f'"{model}" is not listed in public/data/models.json, so the app will not offer it')
            errors = R.print()
        else:
            errors = validate_generic(repo, model, entry, R)
        if errors:
            failed.append(model)
        if len(models) > 1:
            print('─' * 72)
    if len(models) > 1:
        print(f'{len(models) - len(failed)} of {len(models)} packs valid' + (f'; errors in {failed}' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
