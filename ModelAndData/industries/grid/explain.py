#!/usr/bin/env python3
"""Vesper Grid — detectors and explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every grid detector on every asset it applies to, using only the pack's
runtime files in public/data/grid/, and writes public/data/grid/explanations.json:
one explanation per attention item (the checks, what was ruled out, reference
examples, confidence), plus each detector's definition and where it fired today.

    python3 ModelAndData/industries/grid/generate.py     # the data
    python3 ModelAndData/industries/grid/explain.py      # the explanations

Detectors never read generate.py's scenario constants or the attention items'
text. If a detector misses a scenario, or fires where no attention item
exists, the run report says so and the exit code is 1 for a miss.

Topology comes from asset-relationships.json: circuits are edges between the
two line bays at either end (transmission, subtransmission and supply layers),
buses connect to bays (station_bus) and transformers (transformation), and
reactive plant connects to its bus (reactive_support). Where a detector reads
the maintenance log or the work list (an inspection result, a completed
settings change), it says so, and only uses it for confidence, never to fire.

Standard library only.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'ModelAndData', 'tools'))

from detectors import blocks as B                     # noqa: E402
from detectors.build import (Detector, Finding, Rng, MATCH, NO_MATCH, PENDING, aligned, chart,  # noqa: E402
                             check, dur, marker, nice_domain, num, reference, ruled_out, run_pack, print_report,
                             series, signed, spark, threshold)

CIRCUIT_LAYERS = ('transmission', 'subtransmission', 'supply')
ELECTRICAL_LAYERS = CIRCUIT_LAYERS + ('transformation', 'station_bus', 'reactive_support')
LINE_BAYS = ('ehv_line_bay', 'hv_line_bay', 'sub_line_bay')
XFMR_TYPES = ('autotransformer', 'power_transformer')
BREAKERS = ('sf6_breaker', 'monitored_breaker')
SUBSTATIONS = ('bulk_substation', 'subtransmission_substation', 'supply_substation')
DISTRICTS = ('bulk_district', 'subtransmission_district', 'supply_district')
MW_KEYS = ('mw_flow_mw', 'sub_mw_flow_mw', 'ehv_mw_flow_mw')


# ── Small shared helpers ─────────────────────────────────────────────────
def tmin(t):
    return int(t[:2]) * 60 + int(t[3:5])


def hhmm(m):
    m = int(round(m))
    return f'{(m // 60) % 24:02d}:{m % 60:02d}'


def median(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    n = len(vals)
    return vals[n // 2] if n % 2 else 0.5 * (vals[n // 2 - 1] + vals[n // 2])


def mean_between(values, i0, i1):
    return B.mean(values[max(0, i0):i1 + 1])


def join_names(names):
    names = list(names)
    if not names:
        return ''
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ' and ' + names[-1]


def dom(*arrays, pad=0.08, floor=None, ceil=None):
    """nice_domain that ignores None and survives empty arrays."""
    arrs = [[v for v in a if v is not None] for a in arrays]
    arrs = [a for a in arrs if a]
    return [round(v, 9) for v in nice_domain(*arrs, pad=pad, floor=floor, ceil=ceil)]


def win(pack, i0, i1):
    return [pack.ts[max(0, i0)], pack.ts[min(pack.now, i1)]]


def hours_grid(h_max, step=0.25, h_min=0.0):
    n = int(round((h_max - h_min) / step))
    return [round(h_min + k * step, 3) for k in range(n + 1)]


def minutes_grid(m_min, m_max, step):
    return list(range(m_min, m_max + 1, step))


def ref_chart(label, unit, y, grid, grid_unit, ref_values, live_values, live_label, decimals=1, thresholds=None):
    return chart(unit, y, [series('ref', 'Reference example', ref_values, 'reference', 3),
                           series('live', live_label, live_values, 'primary', 3)],
                 title=label, x={'unit': grid_unit, 'values': grid}, decimals=decimals, thresholds=thresholds)


def conclusion(label, text, level, level_text):
    return {'label': label, 'text': text, 'confidence': level, 'confidenceText': level_text}


def confidence(level, because, not_higher=None, raise_if=None, lower_if=None, confirmed_by=None):
    out = {'level': level, 'because': because}
    if not_higher: out['notHigherBecause'] = not_higher
    if raise_if: out['raiseIf'] = raise_if
    if lower_if: out['lowerIf'] = lower_if
    if confirmed_by: out['confirmedBy'] = confirmed_by
    return out


def work_ids_for(pack, item, extra=()):
    ids = []
    sig = item['signal']
    for w in pack.work:
        if w['sourceType'] != 'situation':
            continue
        if w['assetId'] == item['assetId'] or (w.get('sourceLabel') or '') == f'From: {sig}':
            ids.append(w['id'])
    return ids + [w for w in extra if w not in ids]


def action(item, pack, extra=()):
    return {'text': item['detail']['recommendation'], 'workItemIds': work_ids_for(pack, item, extra)}


def maintenance_records(item, after_time, words):
    """Field and maintenance entries logged on the item after a time that mention
    one of `words`. This is the maintenance log as the app shows it (an
    inspection result, not telemetry); detectors use it for confidence only."""
    out = []
    for w in item['detail'].get('whatChanged', []):
        if w.get('source') in ('Maintenance', 'Field Check') and tmin(w['time']) >= tmin(after_time):
            if any(x in w['description'].lower() for x in words):
                out.append(w)
    return out


def done_work(pack, aid, types=None):
    """Completed work items on an asset (the work list, not telemetry), earliest first."""
    out = [w for w in pack.work if w['assetId'] == aid and w.get('done') and w.get('completedAt')
           and (types is None or w['workType'] in types)]
    return sorted(out, key=lambda w: w['completedAt'])


def w_time(iso):
    return iso[11:16]


def on_grid_at_or_after(pack, t):
    """First timeline index at or after clock time t."""
    m = tmin(t)
    for k, x in enumerate(pack.ts):
        if tmin(x) >= m:
            return k
    return pack.now


# ── Topology ─────────────────────────────────────────────────────────────
def station(pack, aid):
    return pack.unit_of(aid)


def sname(pack, aid):
    """Station name for an asset ('Larkspur')."""
    u = pack.unit_of(aid)
    return pack.name(u) if u else pack.name(aid)


def circuit(pack, bay):
    """(remote bay, circuit label) for a line bay, via the circuit layers."""
    for e in pack.relationships:
        if e['layer'] in CIRCUIT_LAYERS:
            if e['sourceAssetId'] == bay:
                return e['targetAssetId'], e['label']
            if e['targetAssetId'] == bay:
                return e['sourceAssetId'], e['label']
    return None, None


def circuit_name(pack, bay):
    """'Orrin–Larkspur 138 kV' from the circuit edge; ties are named from their two stations."""
    rem, lab = circuit(pack, bay)
    if not lab:
        return pack.name(bay)
    if lab[0].isdigit():                        # '69 kV tie — normally open; …'
        ends = sorted([bay, rem], key=lambda b: 0 if any(e['sourceAssetId'] == b and e['label'] == lab
                                                          for e in pack.relationships) else 1)
        return f'{sname(pack, ends[0])}–{sname(pack, ends[1])} {lab.split(" — ")[0]}'
    return lab


def mw_key(pack, bay):
    return next((k for k in MW_KEYS if pack.has(bay, k)), None)


def mw(pack, bay):
    k = mw_key(pack, bay)
    return pack.series(bay, k) if k else None


def bay_bus(pack, bay):
    """The bus a bay connects to (station_bus layer)."""
    t = [x for x in pack.targets(bay, 'station_bus') if pack.asset(x)['assetType'] == 'bus_section']
    return t[0] if t else None


def neighbours(pack, a):
    out = []
    for e in pack.relationships:
        if e['layer'] in ELECTRICAL_LAYERS:
            if e['sourceAssetId'] == a:
                out.append(e['targetAssetId'])
            elif e['targetAssetId'] == a:
                out.append(e['sourceAssetId'])
    return out


def electrical_path(pack, a, b):
    """Shortest path between two assets over the electrical layers, or None."""
    prev, frontier, seen = {a: None}, [a], {a}
    while frontier:
        nxt = []
        for x in frontier:
            for y in neighbours(pack, x):
                if y not in seen:
                    seen.add(y)
                    prev[y] = x
                    nxt.append(y)
        if b in seen:
            break
        frontier = nxt
    if b not in prev:
        return None
    path, x = [], b
    while x is not None:
        path.append(x)
        x = prev[x]
    return list(reversed(path))


def stations_on(pack, path):
    out = []
    for x in path:
        s = station(pack, x)
        if s and s not in out:
            out.append(s)
    return out


def bus_name(pack, bus):
    return f'{sname(pack, bus)} {pack.name(bus).replace(" Bus", "")} bus'


def xf_name(pack, xf):
    """'Kessler T1' for an autotransformer or power transformer."""
    return f'{sname(pack, xf)} {pack.name(pack.parent(xf)).replace(" Transformer", "")}'


def element_name(pack, b):
    """A contingency element in words: the circuit for a line bay, 'Larkspur T1' for a transformer bay."""
    if pack.asset(b)['assetType'] in LINE_BAYS + ('gen_tie_bay',):
        return circuit_name(pack, b) if circuit(pack, b)[0] else f'{sname(pack, b)} {pack.name(b)}'
    return f'{sname(pack, b)} {pack.name(b).replace(" Transformer", "")}'


def plant_name(pack, a):
    """'Wyndham 138 kV capacitor bank', 'Thorne 345 kV shunt reactor' for reactive plant or its bay."""
    bay = a if pack.asset(a)['assetType'] in ('capacitor_bay', 'reactor_bay') else pack.parent(a)
    n = pack.name(bay)
    return f'{sname(pack, bay)} {n.split(" kV ")[0]} kV {n.split(" kV ")[1].lower()}' if ' kV ' in n else f'{sname(pack, bay)} {n}'


def xf_of(pack, aid):
    """The transformer a component belongs to."""
    for x in [aid] + pack.ancestors(aid):
        if pack.asset(x)['assetType'] in XFMR_TYPES:
            return x
    return None


def buses_of_station(pack, st):
    return [c for c in pack.children.get(st, []) if pack.asset(c)['assetType'] == 'bus_section']


def line_bays_of(pack, st):
    return [c for c in pack.children.get(st, []) if pack.asset(c)['assetType'] in LINE_BAYS]


def xfmr_bays_of(pack, st):
    return [c for c in pack.children.get(st, []) if pack.asset(c)['assetType'] in ('autotransformer_bay', 'transformer_bay')]


def breaker_of(pack, bay):
    return next((c for c in pack.children.get(bay, []) if pack.asset(c)['assetType'] in BREAKERS), None)


def regulated_bus(pack, xf):
    """The bus a transformer's tap changer regulates: its low-voltage (output) side."""
    t = [x for x in pack.targets(xf, 'transformation') if pack.asset(x)['assetType'] == 'bus_section']
    return t[0] if t else None


def dead_since(values, i, dead):
    """True if |values| stays below dead from i to the end."""
    return all(abs(v) < dead for v in values[i:])


# ═════════════════════════════════════════════════════════════════════════
# 1. Bushing C1 power factor climbing — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class BushingDeterioration(Detector):
    id = 'grid.bushing_pf_rise'
    name = 'Bushing insulation deteriorating'
    archetype = '05 Component degradation'
    applies_to = 'bushing sets'
    summary = ('A transformer bushing\'s C1 power factor climbing steadily above its own baseline, with its capacitance '
               'and leakage current moving the same way and every other bushing in the fleet flat: the condenser core '
               'is deteriorating, not the reading.')
    pipeline = [
        ('Baseline', 'each bushing set\'s own C1 power factor over the first hour of the window'),
        ('Residual', 'power factor now minus that baseline, in percentage points'),
        ('Checks', 'above baseline · rising steadily · sustained · capacitance · leakage current · other bushings flat · '
                   'transformer load and oil normal'),
        ('Conclusion', 'all required checks → raise an item; the capacitance trend, a separate quantity, sets confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'bushing_set'},
        'inputs': {'pf': 'self.bushing_c1_pf_pct', 'cap': 'self.bushing_cap_dev_pct',
                   'leak': 'self.bushing_leakage_current_ma', 'load': 'parent[transformer].xfmr_loading_pct',
                   'oil': 'parent[transformer].top_oil_temp_c', 'dga': 'sibling[dga_monitor]'},
        'peers': {'same': 'assetType', 'use': 'the other bushing sets, to show the rise is not ambient or seasonal'},
        'expected': {'model': 'own baseline', 'target': 'pf', 'formula': 'mean(pf) over the first baseline_min'},
        'params': {'baseline_min': 60, 'rise_pts': 0.10, 'watch_pts': 0.03, 'sustain_min': 30, 'slope_window_min': 120,
                   'min_slope_pts_h': 0.05, 'max_step_pts': 0.05, 'cap_rise_pts': 1.0, 'leak_rise_pct': 5.0,
                   'peer_band_pts': 0.03, 'load_max_pct': 90.0, 'oil_band_c': 5.0,
                   'new_pf_pct': 0.5, 'outage_pf_pct': 1.0, 'urgent_pf_pct': 2.0, 'cap_investigate_pct': 5.0},
        'checks': [
            {'id': 'high', 'role': 'required', 'rule': 'pf − baseline > rise_pts'},
            {'id': 'gradual', 'role': 'required', 'rule': 'slope(pf, slope_window_min) > min_slope_pts_h and no step > max_step_pts since onset'},
            {'id': 'sustained', 'role': 'required', 'rule': 'pf − baseline > rise_pts for sustain_min'},
            {'id': 'cap', 'role': 'supporting', 'independent': True, 'rule': 'capacitance deviation up > cap_rise_pts from its own baseline'},
            {'id': 'leak', 'role': 'supporting', 'rule': 'leakage current up > leak_rise_pct from its own baseline'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'every other bushing set within ±peer_band_pts of its own baseline'},
            {'id': 'load', 'role': 'supporting', 'rule': 'transformer below load_max_pct and top oil within oil_band_c of its sister bank'},
        ],
        'ruleOut': ['main-tank fault', 'load or temperature effect', 'monitor or sensor fault', 'surface contamination'],
        'confidence': {'low': 'required checks only', 'medium': 'capacitance rising with it',
                       'high': 'confirmed by an offline power factor and capacitance test'},
        'references': ['textbook: grading layers shorting', 'variant: moisture ingress without shorted layers',
                       'look-alike: temperature swing on the reading'],
    }

    def candidates(self, pack):
        return pack.of_type('bushing_set')

    def evaluate(self, pack, aid):
        p = self.p
        pf = pack.series(aid, 'bushing_c1_pf_pct')
        nb = pack.steps(p['baseline_min'])
        base = B.mean(pf[:nb])
        res = [v - base for v in pf]
        hot = B.gt(res, p['rise_pts'])
        watch = B.gt(res, p['watch_pts'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(nb, pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            while onset > nb and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(pf, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_pts_h'] and B.max_step(pf, onset, i) < p['max_step_pts']:
                return Finding(aid, True, i, pf=pf, base=base, res=res, nb=nb, onset=onset, alert=s0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        xf = xf_of(pack, aid)
        xname = xf_name(pack, xf)
        pf, base, res, nb, onset, alert = c['pf'], c['base'], c['res'], c['nb'], c['onset'], c['alert']
        slope = B.slope_per_hour(pf, now, pack.steps(p['slope_window_min']), pack.step_min)
        slope1 = B.slope_per_hour(pf, now, pack.steps(60), pack.step_min)
        step = B.max_step(pf, onset, now)

        cap = pack.series(aid, 'bushing_cap_dev_pct')
        cap_base = B.mean(cap[:nb])
        cap_ok = cap[now] - cap_base > p['cap_rise_pts']
        leak = pack.series(aid, 'bushing_leakage_current_ma')
        leak_base = B.mean(leak[:nb])
        leak_pct = (leak[now] - leak_base) / leak_base * 100
        leak_ok = leak_pct > p['leak_rise_pct']

        peers = [a for a in pack.of_type('bushing_set') if a != aid]
        pdev = {a: [v - B.mean(pack.series(a, 'bushing_c1_pf_pct')[:nb]) for v in pack.series(a, 'bushing_c1_pf_pct')]
                for a in peers}
        pmax = max(max(abs(v) for v in d) for d in pdev.values())
        peers_ok = pmax < p['peer_band_pts']
        p_lo = [min(d[k] for d in pdev.values()) for k in range(pack.n)]
        p_hi = [max(d[k] for d in pdev.values()) for k in range(pack.n)]

        load = pack.series(xf, 'xfmr_loading_pct')
        oil = pack.series(xf, 'top_oil_temp_c')
        st = station(pack, xf)
        sisters = [x for x in pack.descendants(st) if pack.asset(x)['assetType'] in XFMR_TYPES and x != xf]
        sis = sisters[0] if sisters else None
        sis_oil = pack.series(sis, 'top_oil_temp_c') if sis else None
        oil_gap = abs(oil[now] - sis_oil[now]) if sis else None
        load_ok = load[now] < p['load_max_pct'] and (oil_gap is None or oil_gap < p['oil_band_c'])

        dga = pack.child_of_type(xf, 'dga_monitor')
        h2 = pack.series(dga, 'dga_h2_ppm')
        c2h2 = pack.series(dga, 'dga_c2h2_ppm')
        c2h4 = pack.series(dga, 'dga_c2h4_ppm')
        rate = pack.series(dga, 'dga_tdcg_rate_ppm_day')

        level = 'medium' if cap_ok else 'low'
        tested = [w for w in done_work(pack, aid) if 'test' in (w['text'] or '').lower()]
        if tested:
            level = 'high'
        ratio = pf[now] / base
        eta1 = (p['outage_pf_pct'] - pf[now]) / slope1 * 60 if slope1 and slope1 > 0 and pf[now] < p['outage_pf_pct'] else None
        eta2 = (p['urgent_pf_pct'] - pf[now]) / slope1 * 60 if slope1 and slope1 > 0 else None
        y_res = dom(res, [-0.05, p['rise_pts'] * 1.3], pad=0.05)
        cap_rel = [v - cap_base for v in cap]
        y_cap = dom(cap_rel, [-0.2, p['cap_rise_pts'] * 1.2])

        checks = [
            check('high', 'Power factor well above its own baseline', 'required', MATCH,
                  f'C1 power factor {num(pf[now], 3)} % now against {num(base, 3)} % in the first hour '
                  f'({signed(res[now], 3)} points, {num(ratio, 1)}× baseline). Alert level is +{num(p["rise_pts"], 2)} points.',
                  'Power factor measures the losses in the bushing\'s paper-and-oil insulation. Moisture or partial discharge '
                  'in the condenser core raises it. The baseline is this bushing\'s own, so its nameplate value doesn\'t matter.',
                  spark(res, y_res, threshold_value=p['rise_pts'])),
            check('gradual', 'Rising steadily, not jumping', 'required', MATCH,
                  f'{signed(slope, 3)} points per hour over the last {dur(p["slope_window_min"])}. Largest '
                  f'{pack.step_min}-min step since {ts[onset]}: {num(step, 3)} points.',
                  'Insulation deteriorates progressively. A monitor or wiring fault usually shows as a step.',
                  spark(pf, dom(pf, [base]), highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained, not a passing excursion', 'required', MATCH,
                  f'More than +{num(p["rise_pts"], 2)} points since {ts[alert]} '
                  f'({dur(pack.minutes_between(alert, now))}); above +{num(p["watch_pts"], 2)} since {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} above the alert level, so a humidity or temperature swing on the reading '
                  'doesn\'t raise an item.',
                  spark(res, y_res, threshold_value=p['rise_pts'], highlight=[ts[alert], ts[now]])),
            check('cap', 'Capacitance rising with it', 'supporting', MATCH if cap_ok else NO_MATCH,
                  f'Capacitance deviation {num(cap_base, 2)} % in the first hour, {num(cap[now], 2)} % now '
                  f'({signed(cap[now] - cap_base, 2)} points). Investigate level is {num(p["cap_investigate_pct"], 0)} %.',
                  'A separate quantity from the same tap. Shorted grading layers raise capacitance; a surface or '
                  'temperature effect on the power factor reading does not.',
                  spark(cap_rel, y_cap, threshold_value=p['cap_rise_pts'])),
            check('leak', 'Leakage current up', 'supporting', MATCH if leak_ok else NO_MATCH,
                  f'{num(leak_base, 1)} mA in the first hour, {num(leak[now], 1)} mA now ({signed(leak_pct, 1)} %).',
                  'More capacitance and more loss both draw more current through the insulation at the same voltage.',
                  spark(leak, dom(leak))),
            check('peers', 'Every other bushing flat', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'The other {len(peers)} bushing sets stayed within ±{num(pmax, 3)} points of their own baselines all day.',
                  'Ambient temperature and humidity reach every bushing in the fleet. Only this one moved.',
                  spark(res, dom(res, p_lo, p_hi), p_lo, p_hi)),
            check('load', 'Transformer load and oil normal', 'supporting', MATCH if load_ok else NO_MATCH,
                  f'{xname} at {num(load[now], 0)} % of nameplate; top oil {num(oil[now], 1)} °C' +
                  (f', {num(oil_gap, 1)} °C from {xf_name(pack, sis)} at the same load.' if sis else '.'),
                  'Bushing power factor rises with temperature. With the load and the oil where they should be, the '
                  'change is in the insulation.',
                  spark(load, dom(load, [0]))),
        ]
        main = chart('%', dom(pf, [base, p['new_pf_pct']], pad=0.05, floor=0),
                     [series('actual', f'{xname} bushing C1 power factor', pf, 'primary', 3),
                      series('expected', 'Its own baseline (first hour)', [base] * pack.n, 'expected', 3)],
                     title='What we see',
                     caption=f'C1 power factor on the {xname} 345 kV bushings against their own first-hour baseline. The shaded '
                             f'gap is the rise.',
                     shade_gap=['actual', 'expected'],
                     thresholds=[threshold(p['new_pf_pct'], 'New-bushing level')] +
                                ([threshold(p['outage_pf_pct'], 'Remove at next outage')] if max(pf) > 0.8 * p['outage_pf_pct'] else []),
                     markers=[marker(ts[onset], 'Rise begins'), marker(ts[alert], f'+{num(p["rise_pts"], 2)} points')],
                     decimals=3)

        # Reference examples (hours since onset); shapes follow RESEARCH.md §5.1.
        h_live = pack.minutes_between(onset, now) / 60
        grid = hours_grid(max(6, round(h_live + 1.5)), 0.25)
        r = Rng(101)
        tb = [(0 if h <= 0 else 0.10 * h + 0.012 * h * h) + r.gauss(0.004) for h in grid]
        tb_c = [(0 if h <= 0 else 0.62 * h + 0.05 * h * h) + r.gauss(0.03) for h in grid]
        mo = [(0 if h <= 0 else 0.06 * h) + r.gauss(0.004) for h in grid]
        mo_c = [r.gauss(0.03) for h in grid]
        te = [0.05 * (1 - math.cos(h / 6.0 * 3.14159)) + r.gauss(0.004) for h in grid]
        te_c = [r.gauss(0.03) for h in grid]
        lp = aligned(res, onset, pack.step_min, grid)
        lc = aligned(cap_rel, onset, pack.step_min, grid)
        live = f'{xname}, today'

        def pair(a, b):
            return [ref_chart('C1 power factor above baseline', 'pts', dom(a, lp, pad=0.05), grid, 'h', a, lp, live, 3),
                    ref_chart('Capacitance deviation change', 'pts', dom(b, lc, pad=0.05), grid, 'h', b, lc, live, 2)]
        refs = [
            reference('layers', 'textbook', 'Textbook', 'Grading layers shorting in the core',
                      'Partial discharge or moisture shorts the foil layers one after another. Power factor and capacitance '
                      'climb together and speed up; the bushing comes out before it fails.',
                      'match', 'Closest match', ['Power factor and capacitance rising together, as here',
                                                 f'Capacitance up {num(cap[now] - cap_base, 1)} points in {dur(h_live * 60)}'],
                      pair(tb, tb_c)),
            reference('moisture', 'variant', 'Variant', 'Moisture ingress, no layers shorted yet',
                      'Water through a failed gasket raises the losses, so power factor climbs, but capacitance holds '
                      'until layers start to short.',
                      'partial', 'Earlier stage of the same failure',
                      ['Here capacitance is already moving, so it is past this stage', 'Same test confirms either'],
                      pair(mo, mo_c)),
            reference('temp', 'lookalike', 'Look-alike', 'Temperature swing on the reading',
                      'Uncorrected power factor follows oil and ambient temperature through the day and comes back down '
                      'overnight. Capacitance doesn\'t move and every bushing on the site does the same.',
                      'nomatch', 'Doesn\'t match',
                      [f'The other {len(peers)} bushing sets stayed flat through the same heat',
                       'Here capacitance moves too'], pair(te, te_c)),
        ]
        c2h2_rise = c2h2[now] - B.mean(c2h2[:nb])
        rate_ratio = rate[now] / B.mean(rate[:nb])
        ro = [
            ruled_out('Fault in the main tank', 'unlikely',
                      f'{xname} DGA: acetylene {num(c2h2[now], 2)} ppm ({signed(c2h2_rise, 2)}), ethylene '
                      f'{num(c2h4[now], 1)} ppm, combustible gas rate {num(rate[now], 1)} ppm/day ({num(rate_ratio, 1)}× its '
                      f'first hour). Hydrogen crept up {num(h2[now] - B.mean(h2[:nb]), 0)} ppm, which is present but not a '
                      'fault pattern. The bushing core has its own oil, separate from the tank.'),
            ruled_out('Load or temperature', 'ruled out',
                      f'{xname} at {num(load[now], 0)} % of nameplate' +
                      (f', top oil within {num(oil_gap, 1)} °C of {xf_name(pack, sis)}, whose bushings stayed flat.'
                       if sis else '.')),
            ruled_out('Monitor or sensor fault', 'ruled out',
                      'Power factor, capacitance and leakage current all moved, gradually and in the direction shorted '
                      'layers produce. A failed tap adapter or monitor input jumps, or moves one quantity.'),
            ruled_out('Surface contamination on the porcelain', 'not yet checked',
                      'Dirt or moisture on the outside can raise online power factor on a humid day. The offline test with '
                      'a guard lead separates surface from core.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'The {xname} 345 kV bushing\'s condenser core is deteriorating', level,
                                     'Capacitance and leakage current agree' if cap_ok else 'Power factor only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(level,
                                     'Power factor, capacitance and leakage current, three quantities from the bushing '
                                     'monitor, moved together, gradually, while every other bushing and the transformer\'s '
                                     'own load and oil stayed normal.',
                                     None if level == 'high' else
                                     'Nobody has tested the bushing offline yet, and the online monitor can\'t separate a '
                                     'surface effect from the core.',
                                     None if level == 'high' else
                                     'The Doble test at the outage shows power factor and capacitance up against nameplate and '
                                     'the sister phases.',
                                     'The offline test, corrected to 20 °C, reads close to nameplate. Then look at the monitor '
                                     'and the surface.'),
            'action': action(item, pack),
            'impact': (f'At the last hour\'s rate ({signed(slope1, 3)} points/h) power factor reaches '
                       f'{num(p["outage_pf_pct"], 1)} % (remove at the next outage) in about {dur(eta1)}'
                       + (f' and {num(p["urgent_pf_pct"], 1)} % (don\'t wait for one) in about {dur(eta2)}' if eta2 else '')
                       + '. Monitored failures have come anywhere from ten days to minutes after a trend like this.')
                      if eta1 else
                      (f'Power factor is past {num(p["outage_pf_pct"], 1)} % (remove at the next outage). Monitored failures '
                       'have come anywhere from ten days to minutes after a trend like this.'),
            'model': {'target': 'bushing_c1_pf_pct', 'formula': f'own baseline {num(base, 3)} %',
                      'fittedOn': f'this bushing set, {ts[0]}–{ts[nb - 1]}'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Combustible gas rate creeping up — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class DgaThermalGassing(Detector):
    id = 'grid.dga_thermal_gassing'
    name = 'Transformer gassing from a thermal fault'
    archetype = '03 Quiet drift'
    applies_to = 'DGA monitors'
    summary = ('A transformer\'s total dissolved combustible gas rate climbing well above its own normal, with hydrogen '
               'and ethylene rising and acetylene flat: something inside the tank is overheating, without arcing.')
    pipeline = [
        ('Baseline', 'each monitor\'s own TDCG rate, hydrogen, ethylene and acetylene over the first hour'),
        ('Trend', 'rate against its baseline, and its slope over the last two hours'),
        ('Checks', 'rate multiplied · still rising · sustained · hydrogen and ethylene up · no acetylene · moisture flat · '
                   'other transformers flat'),
        ('Conclusion', 'rising rate with thermal gases and no acetylene → thermal fault; the lab resample confirms'),
    ]
    definition = {
        'appliesTo': {'assetType': 'dga_monitor'},
        'inputs': {'rate': 'self.dga_tdcg_rate_ppm_day', 'tdcg': 'self.dga_tdcg_ppm', 'h2': 'self.dga_h2_ppm',
                   'c2h4': 'self.dga_c2h4_ppm', 'c2h2': 'self.dga_c2h2_ppm', 'moisture': 'self.moisture_rel_sat_pct',
                   'load': 'parent[transformer].xfmr_loading_pct', 'ltc': 'sibling[oltc].ltc_tank_diff_temp_c'},
        'peers': {'same': 'assetType', 'use': 'the other DGA monitors, to show the rise isn\'t a site-wide effect'},
        'expected': {'model': 'own baseline', 'target': 'rate', 'formula': 'mean(rate) over the first baseline_min'},
        'params': {'baseline_min': 60, 'ratio': 2.0, 'rise_ppm_day': 1.5, 'sustain_min': 60, 'slope_window_min': 120,
                   'min_slope_ppm_day_h': 0.5, 'h2_rise_ppm': 10.0, 'c2h4_rise_ppm': 5.0, 'c2h2_max_rise_ppm': 0.5,
                   'moisture_band_pct': 1.0, 'peer_ratio': 1.5, 'action_ppm_day': 30.0, 'ltc_band_c': 2.0},
        'checks': [
            {'id': 'rate', 'role': 'required', 'rule': 'rate > ratio × baseline and rate − baseline > rise_ppm_day'},
            {'id': 'rising', 'role': 'required', 'rule': 'slope(rate, slope_window_min) > min_slope_ppm_day_h'},
            {'id': 'sustained', 'role': 'required', 'rule': 'rate check held for sustain_min'},
            {'id': 'gases', 'role': 'supporting', 'independent': True, 'rule': 'H2 up > h2_rise_ppm and C2H4 up > c2h4_rise_ppm'},
            {'id': 'noarc', 'role': 'supporting', 'rule': 'C2H2 within c2h2_max_rise_ppm of its baseline'},
            {'id': 'moisture', 'role': 'supporting', 'rule': 'moisture within ±moisture_band_pct of its baseline'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'every other monitor\'s rate below peer_ratio × its own baseline'},
        ],
        'ruleOut': ['arcing', 'higher load', 'tap changer oil leaking into the main tank', 'monitor error'],
        'confidence': {'low': 'required checks only', 'medium': 'individual gases confirm it',
                       'high': 'a laboratory sample confirms the rate'},
        'references': ['textbook: overheated joint (thermal fault)', 'variant: arcing', 'look-alike: monitor drift'],
    }

    def candidates(self, pack):
        return pack.of_type('dga_monitor')

    def evaluate(self, pack, aid):
        p = self.p
        rate = pack.series(aid, 'dga_tdcg_rate_ppm_day')
        nb = pack.steps(p['baseline_min'])
        base = B.mean(rate[:nb])
        up = [v > p['ratio'] * base and v - base > p['rise_ppm_day'] for v in rate]
        sw = pack.steps(p['slope_window_min'])
        for i in range(nb, pack.n):
            s0 = B.sustained_since(up, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(rate, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_ppm_day_h']:
                return Finding(aid, True, i, rate=rate, base=base, nb=nb, alert=s0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        xf = xf_of(pack, aid)
        xname = xf_name(pack, xf)
        rate, base, nb, alert = c['rate'], c['base'], c['nb'], c['alert']
        # the rise began where the rate first left its own first-hour band for good
        sd = max(0.05, B.stdev(rate[:nb]))
        onset = alert
        while onset > 0 and rate[onset - 1] > base + 3 * sd:
            onset -= 1
        slope = B.slope_per_hour(rate, now, pack.steps(p['slope_window_min']), pack.step_min)
        g = {k: pack.series(aid, k) for k in ('dga_h2_ppm', 'dga_c2h4_ppm', 'dga_c2h2_ppm', 'dga_tdcg_ppm',
                                              'moisture_rel_sat_pct')}
        gb = {k: B.mean(v[:nb]) for k, v in g.items()}
        d = {k: g[k][now] - gb[k] for k in g}
        gases_ok = d['dga_h2_ppm'] > p['h2_rise_ppm'] and d['dga_c2h4_ppm'] > p['c2h4_rise_ppm']
        arc_ok = abs(d['dga_c2h2_ppm']) < p['c2h2_max_rise_ppm']
        moist_ok = max(abs(v - gb['moisture_rel_sat_pct']) for v in g['moisture_rel_sat_pct']) < p['moisture_band_pct'] * 1.5 \
            and abs(d['moisture_rel_sat_pct']) < p['moisture_band_pct']
        peers = [a for a in pack.of_type('dga_monitor') if a != aid]
        pr = {a: pack.series(a, 'dga_tdcg_rate_ppm_day') for a in peers}
        pratio = {a: v[now] / B.mean(v[:nb]) for a, v in pr.items()}
        peers_ok = max(pratio.values()) < p['peer_ratio']
        prel = {a: [x / B.mean(v[:nb]) for x in v] for a, v in pr.items()}
        p_lo = [min(v[k] for v in prel.values()) for k in range(pack.n)]
        p_hi = [max(v[k] for v in prel.values()) for k in range(pack.n)]
        own_rel = [v / base for v in rate]

        load = pack.series(xf, 'xfmr_loading_pct')
        st = station(pack, xf)
        sisters = [x for x in pack.descendants(st) if pack.asset(x)['assetType'] in XFMR_TYPES and x != xf]
        sis = sisters[0] if sisters else None
        sis_dga = pack.child_of_type(sis, 'dga_monitor') if sis else None
        sis_rate = pack.series(sis_dga, 'dga_tdcg_rate_ppm_day') if sis_dga else None
        sis_load = pack.series(sis, 'xfmr_loading_pct') if sis else None
        oltc = pack.child_of_type(xf, 'oltc')
        ltc = pack.series(oltc, 'ltc_tank_diff_temp_c') if oltc else None
        ltc_ok = ltc is not None and max(ltc) - min(ltc) < p['ltc_band_c'] and max(ltc) < 0

        level = 'medium' if gases_ok else 'low'
        lab = [w for w in done_work(pack, xf, ('SAMPLE',)) if tmin(w_time(w['completedAt'])) >= tmin(ts[onset])]
        if lab:
            level = 'high'
        tdcg_gain = d['dga_tdcg_ppm']
        span_h = pack.minutes_between(0, now) / 60
        implied = tdcg_gain / span_h * 24 if span_h else None
        y_rate = dom(rate, [0, base * p['ratio']], pad=0.05, floor=0)

        checks = [
            check('rate', 'Gas rate multiplied', 'required', MATCH,
                  f'TDCG rate {num(rate[now], 2)} ppm/day now against {num(base, 2)} ppm/day in the first hour '
                  f'({num(rate[now] / base, 1)}×). Above {num(p["ratio"], 0)}× since {ts[alert]}.',
                  'Combustible gases dissolve in the oil when something inside overheats or arcs. The rate at which '
                  'they build up matters more than the total.',
                  spark(rate, y_rate, threshold_value=round(base * p['ratio'], 2))),
            check('rising', 'Still rising', 'required', MATCH,
                  f'{signed(slope, 2)} ppm/day per hour over the last {dur(p["slope_window_min"])}; rising since about '
                  f'{ts[onset]}.',
                  'A developing hot spot makes gas faster as it grows. A one-off event leaves a step and a flat rate.',
                  spark(rate, y_rate, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained for hours', 'required', MATCH,
                  f'Above {num(p["ratio"], 0)}× its baseline for {dur(pack.minutes_between(alert, now))}.',
                  f'Needs {dur(p["sustain_min"])}, so an oil-temperature swing through the monitor doesn\'t raise it.',
                  spark(own_rel, dom(own_rel, [1, p['ratio']]), threshold_value=p['ratio'], highlight=[ts[alert], ts[now]])),
            check('gases', 'Hydrogen and ethylene rising', 'supporting', MATCH if gases_ok else NO_MATCH,
                  f'Hydrogen {num(gb["dga_h2_ppm"], 1)} → {num(g["dga_h2_ppm"][now], 1)} ppm, ethylene '
                  f'{num(gb["dga_c2h4_ppm"], 1)} → {num(g["dga_c2h4_ppm"][now], 1)} ppm since the first hour. TDCG '
                  f'{signed(tdcg_gain, 0)} ppm in {dur(span_h * 60)}, which on its own would be about '
                  f'{num(implied, 0)} ppm/day: faster than the monitor\'s rate says. One of the two figures is wrong, and '
                  'only a lab sample can say which.',
                  'Separate gas channels. Ethylene with hydrogen is the signature of overheated oil and paper '
                  '(thermal fault); the rate figure alone can\'t say what kind of fault it is.',
                  spark(g['dga_c2h4_ppm'], dom(g['dga_c2h4_ppm']))),
            check('noarc', 'No acetylene', 'supporting', MATCH if arc_ok else NO_MATCH,
                  f'Acetylene {num(gb["dga_c2h2_ppm"], 2)} ppm in the first hour, {num(g["dga_c2h2_ppm"][now], 2)} ppm now.',
                  'Acetylene needs an arc, above about 700 °C. Without it the fault is thermal, not a discharge.',
                  spark(g['dga_c2h2_ppm'], [0, max(1.0, max(g['dga_c2h2_ppm']) * 1.5)])),
            check('moisture', 'Moisture flat', 'supporting', MATCH if moist_ok else NO_MATCH,
                  f'Moisture in oil {num(gb["moisture_rel_sat_pct"], 1)} → {num(g["moisture_rel_sat_pct"][now], 1)} % saturation.',
                  'Wet oil or a leak would move moisture. It didn\'t, so the gas isn\'t coming from a breathing or sealing problem.',
                  spark(g['moisture_rel_sat_pct'], dom(g['moisture_rel_sat_pct'], pad=0.5))),
            check('peers', 'Other transformers flat', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'The other {len(peers)} monitors\' rates are {num(min(pratio.values()), 2)}–'
                  f'{num(max(pratio.values()), 2)}× their own first hour, through the same hot day.',
                  'The afternoon heat reaches every transformer. Only this one started making gas.',
                  spark(own_rel, dom(own_rel, p_lo, p_hi), p_lo, p_hi)),
        ]
        main = chart('ppm/day', y_rate,
                     [series('actual', f'{xname} TDCG rate', rate, 'primary', 2),
                      series('expected', 'Its own first-hour rate', [base] * pack.n, 'expected', 2)] +
                     ([series('sister', f'{xf_name(pack, sis)} (same station)', sis_rate, 'peer', 2)] if sis_rate else []),
                     title='What we see',
                     caption=f'Dissolved combustible gas rate on {xname} against its own first hour' +
                             (f' and its sister bank {xf_name(pack, sis)}.' if sis else '.') +
                             f' The {num(p["action_ppm_day"], 0)} ppm/day action level is well above this chart.',
                     shade_gap=['actual', 'expected'],
                     markers=[marker(ts[onset], 'Rise begins'), marker(ts[alert], f'{num(p["ratio"], 0)}× baseline')])

        # Reference examples (hours since onset); shapes follow RESEARCH.md §5.2 (weeks-long in reality).
        h_live = pack.minutes_between(onset, now) / 60
        grid = hours_grid(max(6, round(h_live + 1)), 0.25)
        r = Rng(202)
        lr = aligned(rate, onset, pack.step_min, grid)
        la = aligned(g['dga_c2h2_ppm'], onset, pack.step_min, grid)
        tb = [base + (0 if h <= 0 else 0.9 * h + 0.06 * h * h) + r.gauss(0.08) for h in grid]
        tb_a = [gb['dga_c2h2_ppm'] + r.gauss(0.01) for h in grid]
        ar = [base + (0 if h <= 0 else 1.1 * h) + r.gauss(0.1) for h in grid]
        ar_a = [gb['dga_c2h2_ppm'] + (0 if h <= 0 else 0.35 * h) + r.gauss(0.02) for h in grid]
        dr = [base + (0 if h <= 0 else 0.8 * h) + r.gauss(0.08) for h in grid]
        dr_a = [gb['dga_c2h2_ppm'] + r.gauss(0.01) for h in grid]
        live = f'{xname}, today'

        def pair(a, b):
            return [ref_chart('TDCG rate', 'ppm/day', dom(a, lr, pad=0.05, floor=0), grid, 'h', a, lr, live, 2),
                    ref_chart('Acetylene', 'ppm', dom(b, la, [0, 1], pad=0.05, floor=0), grid, 'h', b, la, live, 2)]
        refs = [
            reference('joint', 'textbook', 'Textbook', 'Overheated joint or blocked duct (thermal fault)',
                      'A loose lead connection or a blocked cooling duct cooks the oil and paper around it. Hydrogen, '
                      'methane and ethylene build over days to weeks; acetylene stays near zero.',
                      'match', 'Closest match', ['Rate climbing, acetylene flat, as here',
                                                 'Weeks-long in reality: today shows only the start'], pair(tb, tb_a)),
            reference('arc', 'variant', 'Variant', 'Low-energy arcing',
                      'A floating shield or poor contact sparks. The rate rises the same way, but acetylene appears '
                      'from the start.',
                      'nomatch', 'Same rate, different fault',
                      [f'Acetylene here moved {signed(d["dga_c2h2_ppm"], 2)} ppm', 'Arcing would call for a faster outage'],
                      pair(ar, ar_a)),
            reference('drift', 'lookalike', 'Look-alike', 'Online monitor drifting',
                      'A monitor\'s sensor or calibration drifts and the reported rate creeps up. The lab sample drawn the '
                      'same day reads normal.',
                      'partial', 'Not ruled out until the lab sample',
                      ['Individual gases moving in a thermal-fault pattern argue against drift',
                       'The rate and concentration figures disagree with each other'], pair(dr, dr_a)),
        ]
        ro = [
            ruled_out('Arcing inside the tank', 'ruled out',
                      f'Acetylene {num(g["dga_c2h2_ppm"][now], 2)} ppm, {signed(d["dga_c2h2_ppm"], 2)} since the first hour.'),
            ruled_out('Higher load', 'ruled out',
                      (f'{xf_name(pack, sis)}, the same design at the same station, carried {num(max(sis_load), 0)} % at '
                       f'its peak today against {num(max(load), 0)} % here, and its gas rate stayed at '
                       f'{num(sis_rate[now], 2)} ppm/day. The rise here began at {ts[onset]}, before the afternoon load.')
                      if sis_rate else f'Loading stayed at or below {num(max(load), 0)} %.'),
            ruled_out('Tap changer oil leaking into the main tank', 'unlikely' if ltc_ok else 'not yet checked',
                      (f'The tap changer compartment stayed {num(-max(ltc), 1)}–{num(-min(ltc), 1)} °C cooler than the '
                       'main tank. A leaking diverter adds acetylene too.') if ltc else 'No tap changer temperature.'),
            ruled_out('Monitor error', 'not yet checked',
                      'Separate gas channels rose in a thermal pattern, which a single drifting sensor rarely does, but '
                      'the rate and the concentrations disagree. Only the laboratory sample settles it.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'A developing thermal fault (overheating, not arcing) inside {xname}',
                                     level, 'Separate gases agree' if gases_ok else 'Gas rate only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The rate has more than doubled and is still rising, hydrogen and ethylene climbed on '
                                     'their own channels, and acetylene stayed flat, which is the thermal-fault pattern.',
                                     None if level == 'high' else
                                     'This is one online monitor, and its rate and its concentrations don\'t agree with '
                                     'each other. No laboratory sample yet.',
                                     None if level == 'high' else
                                     'The lab resample confirms the gases, and a Duval triangle places them in a thermal zone.',
                                     'The lab sample shows today\'s concentrations flat. Then it is the monitor.'),
            'action': action(item, pack),
            'impact': (f'At {signed(slope, 2)} ppm/day per hour the monitor\'s rate would be about '
                       f'{num(rate[now] + slope * (24 * 60 - tmin(ts[now])) / 60, 0)} ppm/day by midnight, '
                       + ('still under' if rate[now] + slope * (24 * 60 - tmin(ts[now])) / 60 < p['action_ppm_day'] else 'past')
                       + f' the {num(p["action_ppm_day"], 0)} ppm/day action level. The concentrations, if the lab confirms '
                       + ('them, would already be past it.' if implied and implied > p['action_ppm_day'] else 'them, agree.')),
            'model': {'target': 'dga_tdcg_rate_ppm_day', 'formula': f'own baseline {num(base, 2)} ppm/day',
                      'fittedOn': f'this monitor, {ts[0]}–{ts[nb - 1]}'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. CVT reading drifting away from the redundant measurement — archetype 06
# ═════════════════════════════════════════════════════════════════════════
class CvtRatioDrift(Detector):
    id = 'grid.cvt_ratio_drift'
    name = 'Voltage transformer reading drifting (instrument, not the bus)'
    archetype = '06 Signal noise'
    applies_to = 'CVTs'
    summary = ('A coupling-capacitor voltage transformer\'s output drifts away from the redundant measurement of the same '
               'bus, while the bus voltage in SCADA and the buses at the other end of its circuits stay put, and its own '
               'capacitance changes: the capacitor stack is failing, the voltage is fine.')
    pipeline = [
        ('Cross-check', 'the relay\'s redundant-measurement deviation between this CVT and the other relay on the bus'),
        ('Compare', 'the CVT\'s secondary voltage change against the SCADA bus voltage and the buses one circuit away'),
        ('Checks', 'disagreement · nothing else moved · stack capacitance · power factor · kept out of control'),
        ('Conclusion', 'one measurement moving alone is the instrument; the capacitance change says which part'),
    ]
    definition = {
        'appliesTo': {'assetType': 'cvt'},
        'inputs': {'dev': 'self.v_redundant_dev_pct', 'secondary': 'self.cvt_secondary_v', 'cap': 'self.cvt_cap_dev_pct',
                   'pf': 'self.cvt_pf_pct', 'bus': 'parent[bus_section].bus_voltage_pu (or the bay\'s bus)',
                   'neighbours': 'bus_voltage_pu at the far end of every circuit from this station at the same voltage'},
        'params': {'baseline_min': 60, 'dev_alert_pct': 2.0, 'alarm_pct': 5.0, 'sustain_min': 15, 'alone_ratio': 0.5,
                   'cap_rise_pts': 1.0, 'pf_rise_pts': 0.05, 'nameplate_band_pct': 2.0},
        'checks': [
            {'id': 'disagree', 'role': 'required', 'rule': 'dev > dev_alert_pct for sustain_min'},
            {'id': 'alone', 'role': 'required', 'rule': '|Δ bus voltage| and every |Δ neighbour bus voltage| < alone_ratio × |Δ secondary| (as % of baseline)'},
            {'id': 'stack', 'role': 'supporting', 'independent': True, 'rule': 'capacitance deviation up > cap_rise_pts'},
            {'id': 'pf', 'role': 'supporting', 'rule': 'CVT power factor up > pf_rise_pts'},
            {'id': 'blocked', 'role': 'supporting', 'rule': 'a completed work item took the CVT out of voltage control'},
        ],
        'ruleOut': ['a real voltage drop', 'secondary wiring or fuse', 'the redundant measurement is the wrong one', 'ferroresonance'],
        'confidence': {'low': 'required checks only', 'medium': 'the CVT\'s own capacitance confirms a stack problem',
                       'high': 'confirmed by an offline capacitance test or replacement'},
        'references': ['textbook: capacitor elements shorting', 'variant: blown secondary fuse', 'look-alike: a real voltage sag'],
    }

    def candidates(self, pack):
        return pack.of_type('cvt')

    def _bus(self, pack, aid):
        par = pack.parent(aid)
        return par if pack.asset(par)['assetType'] == 'bus_section' else bay_bus(pack, par)

    def _neighbour_buses(self, pack, bus):
        st = station(pack, bus)
        out = []
        for b in pack.children.get(st, []):
            if pack.asset(b)['assetType'] not in LINE_BAYS or bay_bus(pack, b) != bus:
                continue
            rem, _ = circuit(pack, b)
            rb = bay_bus(pack, rem) if rem else None
            if rb and rb not in out:
                out.append(rb)
        return out

    def evaluate(self, pack, aid):
        p = self.p
        dev = pack.series(aid, 'v_redundant_dev_pct')
        sec = pack.series(aid, 'cvt_secondary_v')
        bus = self._bus(pack, aid)
        nb = pack.steps(p['baseline_min'])
        s_base = B.mean(sec[:nb])
        vb = pack.series(bus, 'bus_voltage_pu') if bus else None
        nbrs = self._neighbour_buses(pack, bus) if bus else []
        hi = B.gt(dev, p['dev_alert_pct'])
        for i in range(nb, pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            # compare like with like: median of the last 3 scans against the first hour, so a one-scan fault dip
            # on the bus doesn't count as the bus "moving"
            d_sec = abs(median(sec[i - 2:i + 1]) - s_base) / s_base * 100
            if vb is None:
                continue
            d_bus = abs(median(vb[i - 2:i + 1]) - B.mean(vb[:nb])) / B.mean(vb[:nb]) * 100
            d_nb = [abs(median(pack.series(x, 'bus_voltage_pu')[i - 2:i + 1]) - B.mean(pack.series(x, 'bus_voltage_pu')[:nb]))
                    / B.mean(pack.series(x, 'bus_voltage_pu')[:nb]) * 100 for x in nbrs]
            if d_bus < p['alone_ratio'] * d_sec and all(x < p['alone_ratio'] * d_sec for x in d_nb):
                return Finding(aid, True, i, dev=dev, sec=sec, s_base=s_base, bus=bus, nbrs=nbrs, nb=nb, alert=s0,
                               d_sec=d_sec, d_bus=d_bus, d_nb=d_nb)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        dev, sec, s_base, bus, nbrs, nb, alert = c['dev'], c['sec'], c['s_base'], c['bus'], c['nbrs'], c['nb'], c['alert']
        cname = f'{bus_name(pack, bus)} CVT' if pack.parent(aid) == bus else f'{sname(pack, aid)} {pack.name(pack.parent(aid))} CVT'
        d_base = B.mean(dev[:nb])
        sd = max(0.02, B.stdev(dev[:nb]))
        onset = alert
        while onset > nb and dev[onset - 1] > d_base + 4 * sd:
            onset -= 1
        alarm_at = B.first_true(B.gt(dev, p['alarm_pct']))
        vb = pack.series(bus, 'bus_voltage_pu')
        vb_base = B.mean(vb[:nb])
        sec_rel = [(v - s_base) / s_base * 100 for v in sec]
        bus_rel = [(v - vb_base) / vb_base * 100 for v in vb]
        nrel = {x: [(v - B.mean(pack.series(x, 'bus_voltage_pu')[:nb])) / B.mean(pack.series(x, 'bus_voltage_pu')[:nb]) * 100
                    for v in pack.series(x, 'bus_voltage_pu')] for x in nbrs}
        d_sec_now = abs(median(sec_rel[now - 2:now + 1]))
        d_bus_now = abs(median(bus_rel[now - 2:now + 1]))
        cap = pack.series(aid, 'cvt_cap_dev_pct')
        cap_base = B.mean(cap[:nb])
        cap_ok = cap[now] - cap_base > p['cap_rise_pts']
        pf = pack.series(aid, 'cvt_pf_pct')
        pf_base = B.mean(pf[:nb])
        pf_ok = pf[now] - pf_base > p['pf_rise_pts']
        blocks = done_work(pack, aid)
        blk = blocks[0] if blocks else None
        blk_i = on_grid_at_or_after(pack, w_time(blk['completedAt'])) if blk else None
        flat_after = blk is not None and max(dev[blk_i:]) - min(dev[blk_i:]) < 0.3
        # other CVTs in the fleet for the band
        others = [a for a in pack.of_type('cvt') if a != aid]
        o_hi = [max(pack.series(a, 'v_redundant_dev_pct')[k] for a in others) for k in range(pack.n)]
        o_lo = [min(pack.series(a, 'v_redundant_dev_pct')[k] for a in others) for k in range(pack.n)]
        o_max = max(o_hi)
        # the SCADA bus voltage's own steps today, and whether its neighbours made them in the same scan
        bus_steps = [k for k in range(1, pack.n) if bus_rel[k - 1] - bus_rel[k] > 1.0]
        shared = [k for k in bus_steps if nbrs and any(nrel[x][k - 1] - nrel[x][k] > 0.5 for x in nbrs)]
        level = 'medium' if cap_ok else 'low'
        replaced = [w for w in blocks if any(x in (w['text'] or '').lower() for x in ('replace', 'capacitance test'))]
        if replaced:
            level = 'high'
        y_dev = dom(dev, [0, p['alarm_pct'] * 1.1], floor=0)
        y_rel = dom(sec_rel, bus_rel, *nrel.values(), pad=0.05)
        nb_names = [bus_name(pack, x) for x in nbrs]

        checks = [
            check('disagree', 'Disagrees with the redundant measurement', 'required', MATCH,
                  f'{num(dev[now], 2)} % apart now, against {num(d_base, 2)} % in the first hour. Over '
                  f'{num(p["dev_alert_pct"], 0)} % since {ts[alert]}' +
                  (f', past the {num(p["alarm_pct"], 0)} % alarm at {ts[alarm_at]}.' if alarm_at is not None else '.'),
                  f'The two relays on this bus should read the same voltage. The alarm point, {num(p["alarm_pct"], 0)} % '
                  '(0.05 pu), is the published redundant-measurement check.',
                  spark(dev, y_dev, band_lo=o_lo, band_hi=o_hi, threshold_value=p['alarm_pct'],
                        highlight=[ts[onset], ts[now]])),
            check('alone', 'Nothing else saw the voltage change', 'required', MATCH,
                  f'CVT output {signed(-d_sec_now if sec_rel[now] < 0 else d_sec_now, 1)} % from its first hour; the SCADA '
                  f'bus voltage {signed(bus_rel[now], 1)} %' +
                  (', and ' + join_names(f'{n} {signed(nrel[x][now], 1)} %' for n, x in zip(nb_names, nbrs)) if nbrs else '')
                  + '.' + ((' The SCADA bus voltage\'s own steps today (' +
                            join_names(f'{signed(bus_rel[k] - bus_rel[k - 1], 1)} % at {ts[k]}' for k in bus_steps) +
                            ') showed on its neighbours in the same scan; the CVT\'s drift never did.')
                           if bus_steps and len(shared) == len(bus_steps) else ''),
                  'A real voltage change moves every measurement of it together, here and one circuit away. An instrument '
                  'fault moves one.',
                  spark(sec_rel, y_rel)),
            check('stack', 'The CVT\'s capacitance changed', 'supporting', MATCH if cap_ok else NO_MATCH,
                  f'Capacitance deviation {num(cap_base, 2)} % in the first hour, {num(cap[now], 2)} % now. A healthy stack '
                  f'stays within {num(p["nameplate_band_pct"], 0)} % of nameplate.',
                  'A separate measurement of the capacitor stack itself. Shorted elements change the divider ratio and '
                  'the capacitance at the same time.',
                  spark(cap, dom(cap, [0]))),
            check('pf', 'Its power factor rose', 'supporting', MATCH if pf_ok else NO_MATCH,
                  f'{num(pf_base, 3)} % → {num(pf[now], 3)} %.',
                  'Damaged or wet elements add loss in the stack.',
                  spark(pf, dom(pf))),
            check('blocked', 'Kept out of voltage control', 'supporting', MATCH if blk else PENDING,
                  (f'{blk["text"]}: done at {w_time(blk["completedAt"])}. The deviation has '
                   + ('held flat since.' if flat_after else 'kept moving since.')) if blk
                  else 'Still an input to automatic voltage control.',
                  'If the tap changer believes a low reading it raises the real voltage to "fix" it. Removing the input '
                  'stops a sensor fault becoming a control problem.',
                  spark(dev, y_dev, highlight=[ts[blk_i], ts[now]]) if blk else None),
        ]
        main = chart('%', y_rel,
                     [series(x, n, nrel[x], 'peer', 2) for x, n in zip(nbrs, nb_names)] +
                     [series('bus', f'{bus_name(pack, bus)} voltage in SCADA', bus_rel, 'secondary', 2),
                      series('cvt', f'{cname} output', sec_rel, 'primary', 2)],
                     title='What we see',
                     caption=f'Change from the first hour, in %, for the CVT\'s secondary voltage, the bus voltage in SCADA, '
                             f'and the buses at the far end of its circuits. Only the CVT walked away.',
                     markers=[marker(ts[onset], 'Drift begins')] +
                             ([marker(ts[alarm_at], f'{num(p["alarm_pct"], 0)} % alarm')] if alarm_at is not None else []) +
                             ([marker(ts[blk_i], 'Blocked from control')] if blk else []),
                     decimals=2)

        grid = hours_grid(max(6, round(pack.minutes_between(onset, now) / 60 + 1)), 0.25)
        r = Rng(303)
        ld = aligned([v - d_base for v in dev], onset, pack.step_min, grid)
        lb = aligned(bus_rel, onset, pack.step_min, grid)
        el = [(0 if h <= 0 else min(6.0, 1.9 * h)) + r.gauss(0.04) for h in grid]
        el_b = [r.gauss(0.05) for h in grid]
        fu = [(0 if h < 1 else 12.0) + r.gauss(0.04) for h in grid]
        fu_b = [r.gauss(0.05) for h in grid]
        sa = [r.gauss(0.05) for h in grid]
        sa_b = [(0 if h < 1 else -4.0 if h < 2.5 else -0.5) + r.gauss(0.05) for h in grid]
        live = f'{cname}, today'

        def pair(a, b):
            return [ref_chart('Redundant-measurement deviation (change)', '%', dom(a, ld, pad=0.05), grid, 'h', a, ld, live, 2),
                    ref_chart('Bus voltage in SCADA (change)', '%', dom(b, lb, [-1, 1], pad=0.05), grid, 'h', b, lb,
                              'Bus, today', 2)]
        refs = [
            reference('elements', 'textbook', 'Textbook', 'Capacitor elements shorting in the stack',
                      'Elements in the high-voltage stack short one by one. The ratio drifts over hours; the other relay '
                      'and the bus stay where they were, and the CVT\'s capacitance moves.',
                      'match', 'Closest match', ['Gradual drift, bus flat, as here',
                                                 f'Capacitance up {num(cap[now] - cap_base, 1)} points here'], pair(el, el_b)),
            reference('fuse', 'variant', 'Variant', 'Blown secondary fuse or open wiring',
                      'The same "only one measurement moved" pattern, but all at once: the reading steps to near zero in '
                      'one scan and the capacitance doesn\'t change.',
                      'nomatch', 'Same pattern, different part', ['Here the drift took hours', 'Here the capacitance moved'],
                      pair(fu, fu_b)),
            reference('sag', 'lookalike', 'Look-alike', 'A real voltage sag',
                      'A real sag moves every measurement of the bus together and the buses nearby too. The two relays '
                      'still agree, so the deviation stays flat.',
                      'nomatch', 'Doesn\'t match', ['Here the deviation grew while the bus stayed put',
                                                    'Neighbouring buses didn\'t follow'], pair(sa, sa_b)),
        ]
        ro = [
            ruled_out('A real voltage drop on the bus', 'ruled out',
                      f'The SCADA bus voltage is {signed(bus_rel[now], 1)} % from its first hour against the CVT\'s '
                      f'{signed(sec_rel[now], 1)} %, and ' + (join_names(nb_names) + ' didn\'t follow.' if nbrs else
                                                               'nothing nearby followed.')),
            ruled_out('Secondary wiring or a fuse', 'unlikely',
                      'Those fail as a step, and they don\'t change the stack\'s capacitance. This drifted for '
                      f'{dur(pack.minutes_between(onset, alarm_at if alarm_at is not None else now))} and the capacitance moved.'),
            ruled_out('The other relay is the one that\'s wrong', 'ruled out',
                      f'The redundant measurement agrees with the bus voltage in SCADA and with the neighbouring buses. '
                      f'Every other CVT in the fleet stayed within {num(o_max, 2)} % of its partner.'),
            ruled_out('Ferroresonance in the CVT', 'unlikely',
                      'Ferroresonance shows as distorted, oscillating output, often after switching. This is a smooth, '
                      'one-way drift.'),
        ]
        return {
            'conclusion': conclusion('Cause' if level == 'high' else 'Most likely cause',
                                     f'The {cname}\'s capacitor stack is failing; the bus voltage was never low', level,
                                     'Its own capacitance confirms it' if cap_ok else 'Only the one measurement moved'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(level,
                                     'Only this CVT moved: the other relay, the SCADA bus voltage and the buses one circuit '
                                     'away all held, and the CVT\'s own capacitance changed the way shorted elements change it.',
                                     None if level == 'high' else
                                     'Nobody has tested the CVT offline yet. Blocking it contained the risk; it didn\'t '
                                     'confirm the cause.',
                                     None if level == 'high' else
                                     'The offline capacitance test at the next clearance reads well off nameplate.',
                                     'The bus voltage or a neighbouring bus starts moving with it. Then treat it as a real '
                                     'voltage problem.'),
            'action': action(item, pack),
            'impact': (f'Believed by automatic voltage control, a reading {num(abs(sec_rel[now]), 1)} % low would push the '
                       f'real bus voltage up by about that much, to roughly {num(vb[now] * (1 + abs(sec_rel[now]) / 100), 3)} pu, '
                       f'past the 1.05 pu limit.') if vb[now] * (1 + abs(sec_rel[now]) / 100) > 1.05 else
                      (f'Believed by automatic voltage control, a reading {num(abs(sec_rel[now]), 1)} % low would push the real '
                       f'bus voltage up by about that much, to roughly {num(vb[now] * (1 + abs(sec_rel[now]) / 100), 3)} pu.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Tap changer hunting — archetype 10 (overcorrection loop)
# ═════════════════════════════════════════════════════════════════════════
class OltcHunting(Detector):
    id = 'grid.oltc_hunting'
    name = 'Tap changer hunting'
    archetype = '10 Overcorrection loop'
    applies_to = 'tap changers'
    summary = ('A tap changer operating many times its normal rate while the voltage it regulates stays inside the band '
               'and the tap position swings back and forth with no net drift: the controls are chasing each other, not '
               'the voltage.')
    pipeline = [
        ('Baseline', 'each tap changer\'s own operation rate over the first hour'),
        ('Rate', 'operations per day against that baseline, and against the fleet\'s normal'),
        ('Regulated voltage', 'the bus on the transformer\'s output side (transformation layer)'),
        ('Checks', 'rate multiplied · sustained · voltage in band · tap swinging · another regulator in step · settled after '
                   'a settings change'),
        ('Conclusion', 'lots of tapping with nothing to correct → hunting; confirmed when a wider bandwidth settles it'),
    ]
    definition = {
        'appliesTo': {'assetType': 'oltc'},
        'inputs': {'rate': 'self.oltc_ops_per_day', 'tap': 'self.tap_position', 'count': 'self.oltc_ops_total',
                   'voltage': 'regulated bus (transformation target of the parent transformer).bus_voltage_pu',
                   'load': 'parent[transformer].xfmr_loading_pct', 'ltc': 'self.ltc_tank_diff_temp_c'},
        'params': {'baseline_min': 60, 'ratio': 3.0, 'min_ops_day': 25.0, 'sustain_min': 30, 'band_lo_pu': 0.95,
                   'band_hi_pu': 1.05, 'tap_window_min': 60, 'min_reversals': 4, 'peer_ratio': 1.5, 'peer_lag_min': 20,
                   'settled_ops_day': 20.0, 'settled_min': 30, 'service_ops': 75000},
        'checks': [
            {'id': 'rate', 'role': 'required', 'rule': 'rate > max(min_ops_day, ratio × baseline)'},
            {'id': 'sustained', 'role': 'required', 'rule': 'rate check held for sustain_min'},
            {'id': 'inband', 'role': 'required', 'rule': 'regulated bus voltage inside band_lo_pu–band_hi_pu throughout'},
            {'id': 'swing', 'role': 'supporting', 'rule': '≥ min_reversals tap reversals per tap_window_min while the rate is high'},
            {'id': 'parallel', 'role': 'supporting', 'independent': True,
             'rule': 'another tap changer\'s rate rose > peer_ratio × its baseline, starting within peer_lag_min'},
            {'id': 'settled', 'role': 'supporting', 'independent': True,
             'rule': 'after a completed settings change on this tap changer, rate < settled_ops_day for settled_min'},
        ],
        'ruleOut': ['a real voltage excursion', 'load swings', 'a counter fault', 'a mechanism fault'],
        'confidence': {'low': 'required checks only', 'medium': 'another regulator moved in step',
                       'high': 'the rate settled after the settings change'},
        'references': ['textbook: bandwidth narrower than two steps', 'variant: two regulators fighting',
                       'look-alike: a steep load ramp'],
    }

    def candidates(self, pack):
        return pack.of_type('oltc')

    def evaluate(self, pack, aid):
        p = self.p
        rate = pack.series(aid, 'oltc_ops_per_day')
        nb = pack.steps(p['baseline_min'])
        base = B.mean(rate[:nb])
        xf = xf_of(pack, aid)
        bus = regulated_bus(pack, xf)
        v = pack.series(bus, 'bus_voltage_pu') if bus else None
        lim = max(p['min_ops_day'], p['ratio'] * base)
        hi = B.gt(rate, lim)
        for i in range(nb, pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if v is None or not all(p['band_lo_pu'] <= x <= p['band_hi_pu'] for x in v[s0:i + 1]):
                continue
            return Finding(aid, True, i, rate=rate, base=base, lim=lim, bus=bus, v=v, nb=nb, alert=s0, xf=xf)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        rate, base, lim, bus, v, nb, alert, xf = (c[k] for k in ('rate', 'base', 'lim', 'bus', 'v', 'nb', 'alert', 'xf'))
        xname = xf_name(pack, xf)
        tap = pack.series(aid, 'tap_position')
        total = pack.series(aid, 'oltc_ops_total')
        onset = alert
        while onset > nb and rate[onset - 1] > 1.5 * base:
            onset -= 1
        peak_i = max(range(pack.n), key=lambda k: rate[k])
        # reversals in the hour before detection
        # tap reversals over the high-rate run, per tap_window_min
        run_end = next((k for k in range(alert, pack.n) if rate[k] <= lim), pack.now + 1) - 1
        seg = tap[alert:run_end + 1]
        moves = [b - a for a, b in zip(seg, seg[1:]) if b != a]
        rev = sum(1 for a, b in zip(moves, moves[1:]) if (a > 0) != (b > 0))
        run_h = max(pack.minutes_between(alert, run_end), p['tap_window_min']) / 60
        rev_h = rev / run_h * p['tap_window_min'] / 60
        swing_ok = rev_h >= p['min_reversals']
        t_lo, t_hi = min(seg), max(seg)
        # the parallel regulator: any other tap changer whose rate rose over the same window
        others = [a for a in pack.of_type('oltc') if a != aid]
        par, par_on = None, None
        for o in others:
            r_o = pack.series(o, 'oltc_ops_per_day')
            ob = B.mean(r_o[:nb])
            k = B.first_true(B.gt(r_o, p['peer_ratio'] * ob), nb)
            if k is not None and abs(pack.minutes_between(onset, k)) <= p['peer_lag_min']:
                par, par_on = o, k
                break
        par_rate = pack.series(par, 'oltc_ops_per_day') if par else None
        par_ok = par is not None
        # settled after a settings change on this tap changer (the work list: completed procedure)
        chg = [w for w in done_work(pack, aid) if tmin(w_time(w['completedAt'])) > tmin(ts[alert])]
        chg_i = on_grid_at_or_after(pack, w_time(chg[0]['completedAt'])) if chg else None
        settled_at = None
        if chg_i is not None:
            low = B.lt(rate, p['settled_ops_day'])
            for k in range(chg_i, pack.n):
                s0 = B.sustained_since(low, k)
                if s0 is not None and pack.minutes_between(s0, k) >= p['settled_min']:
                    settled_at = s0
                    break
        settled = settled_at is not None
        level = 'high' if settled else 'medium' if par_ok else 'low'
        load = pack.series(xf, 'xfmr_loading_pct')
        l_step = B.max_step(load, onset, now)
        ltc = pack.series(aid, 'ltc_tank_diff_temp_c')
        v_lo, v_hi = min(v[onset:]), max(v[onset:])
        v_step_i = max(range(1, onset + 1), key=lambda k: abs(v[k] - v[k - 1]))
        v_step = v[v_step_i] - v[v_step_i - 1]
        hunt_end = settled_at if settled else now
        ops_added = total[hunt_end] - total[onset]
        years_now = p['service_ops'] / rate[peak_i] / 365
        years_norm = p['service_ops'] / base / 365
        y_r = dom(rate, [0, lim], floor=0)
        window = win(pack, onset - 12, now)

        checks = [
            check('rate', 'Tapping many times its normal rate', 'required', MATCH,
                  f'Up to {num(rate[peak_i], 1)} operations/day at {ts[peak_i]}, against {num(base, 1)}/day in the first hour '
                  f'({num(rate[peak_i] / base, 0)}×). The alert level here is {num(lim, 0)}/day.',
                  'Each operation wears the diverter contacts. Normal tap changers in this fleet run 4–8 a day.',
                  spark(rate, y_r, threshold_value=round(lim, 1))),
            check('sustained', 'Sustained, not a burst', 'required', MATCH,
                  f'Above {num(lim, 0)}/day from {ts[alert]} to ' + (f'{ts[settled_at]}' if settled else 'now') + '.',
                  f'Needs {dur(p["sustain_min"])}, so a few quick taps to follow a real voltage step don\'t raise it.',
                  spark(rate, y_r, threshold_value=round(lim, 1), highlight=[ts[alert], ts[hunt_end]])),
            check('inband', 'The voltage it regulates stayed in band', 'required', MATCH,
                  f'{bus_name(pack, bus)} held {num(v_lo, 3)}–{num(v_hi, 3)} pu while it hunted, inside '
                  f'{num(p["band_lo_pu"], 2)}–{num(p["band_hi_pu"], 2)} pu.',
                  'A tap changer should only move when the voltage leaves its bandwidth. Nothing on the voltage display '
                  'looked wrong, which is why this goes unnoticed.',
                  spark(v, dom(v, [p['band_lo_pu'] + 0.02]), window=window)),
            check('swing', 'Tap position swinging back and forth', 'supporting', MATCH if swing_ok else NO_MATCH,
                  f'{rev} reversals between {ts[alert]} and {ts[run_end]} (about {num(rev_h, 0)} an hour), between taps '
                  f'{num(t_lo, 0)} and {num(t_hi, 0)}, and it finished ' +
                  ('back where it started.' if seg[-1] == seg[0] else
                   f'{num(abs(seg[-1] - seg[0]), 0)} step{"" if abs(seg[-1] - seg[0]) == 1 else "s"} from where it started.'),
                  'Hunting raises, overshoots, lowers, overshoots. A tap changer following load moves one way.',
                  spark(tap, dom(tap, pad=0.2), window=window)),
            check('parallel', 'Another regulator moved in step', 'supporting', MATCH if par_ok else NO_MATCH,
                  (f'{xf_name(pack, xf_of(pack, par))} tap changer rose from {num(B.mean(par_rate[:nb]), 1)} to '
                   f'{num(max(par_rate), 1)}/day at {ts[par_on]} and back when this one settled.') if par_ok
                  else 'No other tap changer changed its rate.',
                  'A separate counter on another transformer. Two regulators on the same voltage, fighting each other, '
                  'both tap more.',
                  spark(par_rate, dom(par_rate, [0], floor=0)) if par_ok else None),
            check('settled', 'Settled after the settings change', 'supporting', MATCH if settled else PENDING,
                  (f'{chg[0]["text"]} at {w_time(chg[0]["completedAt"])}; below {num(p["settled_ops_day"], 0)}/day from '
                   f'{ts[settled_at]} and {num(rate[now], 1)}/day now.') if settled else
                  (f'{chg[0]["text"]} at {w_time(chg[0]["completedAt"])}, not settled yet.' if chg else 'No settings change yet.'),
                  'Widening the bandwidth or lengthening the delay removed the overcorrection, and nothing in the network '
                  'changed. That confirms the controls, not the voltage, were the cause.',
                  spark(rate, y_r, highlight=[ts[chg_i], ts[settled_at]] if settled else None)),
        ]
        main = chart('ops/day', y_r,
                     ([series('par', f'{xf_name(pack, xf_of(pack, par))} tap changer', par_rate, 'peer', 1)] if par_ok else []) +
                     [series('actual', f'{xname} tap changer', rate, 'primary', 1),
                      series('expected', 'Its own first-hour rate', [base] * pack.n, 'expected', 1)],
                     title='What we see',
                     caption=f'Tap operations per day on {xname}' + (f' and on {xf_name(pack, xf_of(pack, par))}' if par_ok else '')
                             + f'. The regulated {bus_name(pack, bus)} stayed inside its band the whole time.',
                     shade_gap=['actual', 'expected'],
                     markers=[marker(ts[onset], 'Hunting begins')] + ([marker(ts[chg_i], 'Settings changed')] if chg else []))

        grid = hours_grid(6, 0.25)
        r = Rng(404)
        lr = aligned(rate, onset, pack.step_min, grid)
        lv = aligned(v, onset, pack.step_min, grid)
        v0 = v[max(0, onset - 1)]

        def hunt(h, top, off):
            if h < 0:
                return base
            if off is not None and h >= off:
                return base * 2.5 + (top - base * 2.5) * 2.718 ** (-(h - off) / 0.3)
            return base + (top - base) * (1 - 2.718 ** (-h / 0.25))
        off_h = pack.minutes_between(onset, chg_i) / 60 if chg else None
        tb = [hunt(h, 56, off_h if off_h else 3.0) + r.gauss(0.6) for h in grid]
        tb_v = [v0 + r.gauss(0.002) for h in grid]
        fi = [hunt(h, 40, None) + r.gauss(0.6) for h in grid]
        fi_v = [v0 + r.gauss(0.002) for h in grid]
        rp = [base + (0 if h < 0 else 3.5 * min(h, 3)) + r.gauss(0.6) for h in grid]
        rp_v = [v0 - (0 if h < 0 else 0.006 * min(h, 3)) + r.gauss(0.002) for h in grid]
        live = f'{xname}, today'

        def pair(a, b):
            return [ref_chart('Tap operations per day', 'ops/day', dom(a, lr, [0], floor=0), grid, 'h', a, lr, live, 1),
                    ref_chart('Regulated bus voltage', 'pu', dom(b, lv, pad=0.3), grid, 'h', b, lv, 'Bus, today', 3)]
        refs = [
            reference('band', 'textbook', 'Textbook', 'Bandwidth narrower than two tap steps',
                      'One tap step moves the voltage further than the bandwidth, so every correction lands on the other side '
                      'of the band. The rate jumps several-fold with the voltage in band, until the bandwidth is widened.',
                      'match', 'Closest match', ['Same jump with the voltage in band',
                                                 'Same drop once the setting was changed' if settled else 'Watch for the drop after the change'],
                      pair(tb, tb_v)),
            reference('fight', 'variant', 'Variant', 'Two paralleled regulators fighting',
                      'Two banks on the same voltage with mismatched settings or a failed paralleling scheme tap against '
                      'each other, with circulating current between them. Both counters climb.',
                      'partial', 'Part of the picture' if par_ok else 'Possible',
                      ['Another tap changer rose in step here' if par_ok else 'No other counter moved here',
                       'Check the paralleling scheme as well as the bandwidth'], pair(fi, fi_v)),
            reference('ramp', 'lookalike', 'Look-alike', 'Steep load ramp, healthy regulator',
                      'Load climbs fast and the voltage sags, so the tap changer steps up repeatedly, always the same way. '
                      'Busy, but every operation is needed.',
                      'nomatch', 'Doesn\'t match', ['Here the tap went back and forth', 'Here the voltage never needed it'],
                      pair(rp, rp_v)),
        ]
        ro = [
            ruled_out('A real voltage excursion', 'ruled out',
                      f'{bus_name(pack, bus)} stayed at {num(v_lo, 3)}–{num(v_hi, 3)} pu. Its largest move today was '
                      f'{signed(v_step, 3)} pu at {ts[v_step_i]}, which one or two taps correct, not dozens.'),
            ruled_out('Load swings', 'ruled out',
                      f'{xname} load rose smoothly with the morning ramp; its largest {pack.step_min}-minute change while '
                      f'hunting was {num(l_step, 1)} points of loading.'),
            ruled_out('A counter or telemetry fault', 'ruled out',
                      f'The tap position itself swung between {num(t_lo, 0)} and {num(t_hi, 0)}, and the operations counter gained '
                      f'{num(ops_added, 0)} while it hunted.'),
            ruled_out('A mechanism fault', 'unlikely' if settled else 'not yet checked',
                      f'The tap changer compartment stayed {num(-max(ltc), 1)}–{num(-min(ltc), 1)} °C below the main tank'
                      + (', and a settings change alone stopped it.' if settled else '.')),
        ]
        return {
            'conclusion': conclusion('Cause' if settled else 'Most likely cause',
                                     f'{xname}\'s voltage regulator was hunting: bandwidth too narrow for its tap step', level,
                                     'Confirmed: settled once the bandwidth was widened' if settled
                                     else 'Tapping with nothing to correct'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'It tapped over ten times its normal rate with the voltage inside the band, and the rate '
                                     'fell back once the bandwidth and delay were widened, with nothing else changed.'
                                     if settled else 'It tapped far above its normal rate with the voltage inside the band.',
                                     None if settled else 'The settings haven\'t been changed yet, so the loop isn\'t closed.',
                                     None if settled else 'The rate falls back once the bandwidth is widened.',
                                     'The rate climbs again with the new settings. Then look at the paralleling scheme.',
                                     'Rate settled after the settings change' if settled else None),
            'action': action(item, pack),
            'impact': (f'At {num(rate[peak_i], 0)} operations/day a {p["service_ops"]:,}-operation maintenance interval lasts about '
                       f'{num(years_now, 1)} years instead of {num(years_norm, 0)}. A month of hunting at that rate is '
                       f'{num(rate[peak_i] * 30 / (base * 365), 1)} years of normal wear.'),
            'model': {'target': 'oltc_ops_per_day', 'formula': f'own baseline {num(base, 1)} ops/day',
                      'fittedOn': f'this tap changer, {ts[0]}–{ts[nb - 1]}'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Line locked out after a failed reclose — archetype 11 (hard block)
# ═════════════════════════════════════════════════════════════════════════
class LineLockout(Detector):
    id = 'grid.line_lockout'
    name = 'Line locked out after a failed reclose'
    archetype = '11 Hard block'
    applies_to = 'line bays'
    summary = ('A circuit\'s flow drops from load to zero in one scan and stays there, the breaker counts a trip, a '
               'reclose and a second trip, and the far end opened too: a permanent fault, and the circuit is locked out.')
    pipeline = [
        ('Trip', 'MW flow from above min_before_mw to below dead_mw in one scan, and still dead lockout_min later'),
        ('Breaker record', 'the bay\'s breaker: reclose counter +1 and operations counter +2 in the same scan'),
        ('Far end', 'the bay at the other end of the circuit (transmission, subtransmission or supply layer)'),
        ('Checks', 'dead · reclose attempted · both ends open · voltage dip · far-end breaker · flow moved elsewhere'),
        ('Conclusion', 'one item per circuit, filed at whichever end the operator\'s item is on'),
    ]
    definition = {
        'appliesTo': {'assetType': list(LINE_BAYS)},
        'inputs': {'flow': 'self.(mw_flow_mw | sub_mw_flow_mw | ehv_mw_flow_mw)', 'breaker': 'child[breaker]',
                   'far': 'circuit partner bay', 'bus': 'station_bus target.bus_voltage_pu',
                   'paths': 'the other line and transformer bays at both stations'},
        'params': {'min_before_mw': 10.0, 'dead_mw': 1.0, 'lockout_min': 10, 'reclose_scans': 1, 'dip_pu': 0.02,
                   'pickup_pct': 20.0},
        'checks': [
            {'id': 'dead', 'role': 'required', 'rule': '|flow| > min_before_mw, then < dead_mw in one scan and for lockout_min'},
            {'id': 'reclose', 'role': 'required', 'rule': 'breaker reclose count +1 and operations +2 within ±reclose_scans'},
            {'id': 'both', 'role': 'required', 'rule': 'far-end flow < dead_mw from the same scan'},
            {'id': 'dip', 'role': 'supporting', 'independent': True, 'rule': 'bus voltage at both ends dipped > dip_pu in that scan'},
            {'id': 'far_breaker', 'role': 'supporting', 'independent': True, 'rule': 'far-end breaker also counted a reclose'},
            {'id': 'pickup', 'role': 'supporting', 'rule': 'another circuit at either station picked up > pickup_pct in the same scan'},
        ],
        'ruleOut': ['telemetry loss', 'planned switching', 'a stuck breaker', 'what caused the fault'],
        'confidence': {'medium': 'required checks', 'high': 'both terminals recorded the sequence independently, with the fault dip'},
        'references': ['textbook: permanent fault, lockout', 'variant: temporary fault, successful reclose',
                       'look-alike: telemetry loss'],
    }

    def candidates(self, pack):
        return pack.of_type(*LINE_BAYS)

    def group(self, pack, aid):
        rem, lab = circuit(pack, aid)
        return tuple(sorted([aid, rem])) if rem else aid

    def _dead_at(self, pack, flow):
        p = self.p
        lk = pack.steps(p['lockout_min'])
        for i in range(1, pack.n - lk):
            if abs(flow[i - 1]) > p['min_before_mw'] and all(abs(v) < p['dead_mw'] for v in flow[i:i + lk + 1]):
                return i
        return None

    def _reclosed(self, pack, cb, i):
        if cb is None:
            return False
        rc = pack.series(cb, 'reclose_ops_count')
        ops = pack.series(cb, 'breaker_ops_total')
        k0, k1 = max(0, i - 1 - self.p['reclose_scans']), min(pack.now, i + self.p['reclose_scans'])
        return rc[k1] - rc[k0] >= 1 and ops[k1] - ops[k0] >= 2

    def evaluate(self, pack, aid):
        p = self.p
        flow = mw(pack, aid)
        if flow is None:
            return Finding(aid, False)
        i = self._dead_at(pack, flow)
        if i is None:
            return Finding(aid, False)
        cb = breaker_of(pack, aid)
        if not self._reclosed(pack, cb, i):
            return Finding(aid, False)
        rem, _ = circuit(pack, aid)
        rflow = mw(pack, rem) if rem else None
        if rflow is None or abs(rflow[i]) >= p['dead_mw']:
            return Finding(aid, False)
        return Finding(aid, True, i + pack.steps(p['lockout_min']), trip=i, flow=flow, cb=cb, rem=rem, rflow=rflow)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, c['trip']
        flow, cb, rem, rflow = c['flow'], c['cb'], c['rem'], c['rflow']
        cname = circuit_name(pack, aid)
        here, there = sname(pack, aid), sname(pack, rem)
        rcb = breaker_of(pack, rem)
        rc = pack.series(cb, 'reclose_ops_count')
        ops = pack.series(cb, 'breaker_ops_total')
        i2t = pack.series(cb, 'accum_interrupt_i2t_ka2s')
        wear = pack.series(cb, 'contact_wear_pct')
        far_ok = self._reclosed(pack, rcb, i)
        b_here, b_there = bay_bus(pack, aid), bay_bus(pack, rem)
        v_here, v_there = pack.series(b_here, 'bus_voltage_pu'), pack.series(b_there, 'bus_voltage_pu')
        dip_here, dip_there = v_here[i - 1] - v_here[i], v_there[i - 1] - v_there[i]
        dip_ok = dip_here > p['dip_pu'] and dip_there > p['dip_pu']
        # every bus's dip in the same scan, deepest first
        dips = sorted(((b, pack.series(b, 'bus_voltage_pu')[i - 1] - pack.series(b, 'bus_voltage_pu')[i])
                       for b in pack.of_type('bus_section')), key=lambda x: -x[1])
        dips = [(b, d) for b, d in dips if d > 0.005]
        # who picked up the flow
        cands = []
        for st in (station(pack, aid), station(pack, rem)):
            for b in line_bays_of(pack, st):
                if b in (aid, rem):
                    continue
                fl = mw(pack, b)
                if fl and abs(fl[i - 1]) > 5 and (abs(fl[i]) - abs(fl[i - 1])) / abs(fl[i - 1]) * 100 > p['pickup_pct']:
                    cands.append((b, fl[i - 1], fl[i]))
        pick_ok = bool(cands)
        before = flow[i - 1]
        out_min = pack.minutes_between(i, now)
        level = 'high' if (far_ok and dip_ok) else 'medium'
        patrol = [w for w in pack.work_for_asset(aid) + pack.work_for_asset(rem) if not w.get('done')]
        window = win(pack, i - 12, now)
        y_f = dom(flow, rflow, [0], pad=0.1)
        # post-contingency change at both stations (what the lockout did to the next contingency)
        ctg = {st: pack.series(st, 'worst_post_ctg_loading_pct') for st in (station(pack, aid), station(pack, rem))}

        checks = [
            check('dead', 'Flow to zero in one scan, and stayed there', 'required', MATCH,
                  f'{num(abs(before), 1)} MW at {ts[i - 1]}, {num(abs(flow[i]), 1)} MW at {ts[i]}, and dead since: out '
                  f'{dur(out_min)} now.',
                  'A load can\'t drop 50 MW in five minutes on its own. The circuit opened.',
                  spark(flow, y_f, window=window)),
            check('reclose', 'The breaker tripped, reclosed and tripped again', 'required', MATCH,
                  f'{here} breaker: reclose counter {num(rc[i - 1], 0)} → {num(rc[i + 1], 0)}, operations '
                  f'{num(ops[i - 1], 0)} → {num(ops[i + 1], 0)}, interrupting duty {signed(i2t[i + 1] - i2t[i - 1], 2)} kA²s.',
                  'One reclose and two operations is trip, reclose, trip. Most line faults are temporary and clear on the '
                  'reclose; this one was still there, so the relay locked out.',
                  spark(rc, dom(rc, pad=0.5), window=window)),
            check('both', 'The far end opened too', 'required', MATCH,
                  f'{there} end: {num(abs(rflow[i - 1]), 1)} MW → {num(abs(rflow[i]), 1)} MW in the same scan.',
                  'A line fault trips both ends. One end open alone would point at that breaker or its relay.',
                  spark(rflow, y_f, window=window)),
            check('dip', 'Voltage dipped at both ends in that scan', 'supporting', MATCH if dip_ok else NO_MATCH,
                  f'{bus_name(pack, b_here)} {num(dip_here, 3)} pu, {bus_name(pack, b_there)} {num(dip_there, 3)} pu, at '
                  f'{ts[i]} and back on the next scan. ' +
                  (f'Every 138 kV and 69 kV bus that saw it dipped in the same scan, deepest at {join_names(bus_name(pack, b) for b, _ in dips[:3])}.'
                   if len(dips) > 2 else ''),
                  'A separate measurement. A fault pulls the voltage down everywhere at once, deepest nearest the fault. '
                  'Switching a healthy line out doesn\'t.',
                  spark(v_here, dom(v_here[i - 12:], pad=0.1), window=window)),
            check('far_breaker', 'Both breakers recorded it', 'supporting', MATCH if far_ok else NO_MATCH,
                  (f'{there} breaker: reclose counter {num(pack.series(rcb, "reclose_ops_count")[i - 1], 0)} → '
                   f'{num(pack.series(rcb, "reclose_ops_count")[i + 1], 0)}, operations +'
                   f'{num(pack.series(rcb, "breaker_ops_total")[i + 1] - pack.series(rcb, "breaker_ops_total")[i - 1], 0)}.')
                  if rcb else 'No breaker record at the far end.',
                  'Two relays at two stations saw the same sequence, independently.',
                  spark(pack.series(rcb, 'reclose_ops_count'), dom(pack.series(rcb, 'reclose_ops_count'), pad=0.5),
                        window=window) if rcb else None),
            check('pickup', 'The flow moved onto other circuits', 'supporting', MATCH if pick_ok else NO_MATCH,
                  (join_names(f'{circuit_name(pack, b)} {num(abs(a0), 0)} → {num(abs(a1), 0)} MW' for b, a0, a1 in cands[:3])
                   + ' in the same scan.') if pick_ok else 'No other circuit at either station picked up.',
                  'Power divides by impedance: when a path opens, the parallel paths carry its flow at once.',
                  spark(mw(pack, cands[0][0]), dom(mw(pack, cands[0][0]), pad=0.1), window=window) if pick_ok else None),
        ]
        main = chart('MW', y_f,
                     [series('far', f'{there} end', [abs(v) for v in rflow], 'secondary', 1),
                      series('near', f'{here} end', [abs(v) for v in flow], 'primary', 1)] +
                     [series(b, circuit_name(pack, b), [abs(v) for v in mw(pack, b)], 'peer', 1) for b, _, _ in cands[:2]],
                     title='What we see',
                     caption=f'MW flow on {cname} at both ends, and the circuits that picked up its flow.',
                     markers=[marker(ts[i], 'Fault, trip, reclose, lockout')] +
                             ([marker(w_time(patrol[0]['plannedStart']), 'Patrol starts')]
                              if patrol and w_time(patrol[0]['plannedStart']) in pack.ts else []))

        grid = minutes_grid(-30, 120, 5)
        r = Rng(505)
        lf = aligned([abs(v) for v in flow], i, pack.step_min, grid, 'min')
        lr = aligned(rc, i, pack.step_min, grid, 'min')
        rc0 = rc[i - 1]
        f0 = abs(before)
        tb = [(f0 + r.gauss(0.5) if m < 0 else 0.0) for m in grid]
        tb_r = [rc0 if m < 0 else rc0 + 1 for m in grid]
        tm = [(f0 + r.gauss(0.5)) for m in grid]
        tm_r = [rc0 if m < 0 else rc0 + 1 for m in grid]
        cl = [(f0 + r.gauss(0.5) if m < 0 else f0) for m in grid]
        cl_r = [rc0 for m in grid]
        live = f'{cname}, today'

        def pair(a, b):
            return [ref_chart('MW flow', 'MW', dom(a, lf, [0], pad=0.1), grid, 'min', a, lf, live, 1),
                    ref_chart('Reclose counter', '', dom(b, lr, pad=0.5), grid, 'min', b, lr, live, 0)]
        refs = [
            reference('permanent', 'textbook', 'Textbook', 'Permanent fault: trip, reclose, lockout',
                      'Something stays on the line (a fallen conductor, a tree, damaged insulation). The reclose finds the '
                      'fault still there, trips again and locks out until a patrol clears it.',
                      'match', 'Closest match', ['Flow to zero and staying there', 'One reclose, two operations, as here'],
                      pair(tb, tb_r)),
            reference('temporary', 'variant', 'Variant', 'Temporary fault, successful reclose',
                      'Lightning or a brief contact. The line trips and recloses within a second; the reclose counter steps '
                      'but at five-minute scans the flow barely shows it.',
                      'nomatch', 'The usual outcome, not today\'s',
                      ['85–95 % of line faults clear like this', f'Here the flow never came back ({dur(out_min)})'],
                      pair(tm, tm_r)),
            reference('telemetry', 'lookalike', 'Look-alike', 'Telemetry lost at one end',
                      'The RTU or its channel drops out and the flow freezes or reads zero at one end. The breaker counters '
                      'don\'t move and the far end keeps reading load.',
                      'nomatch', 'Doesn\'t match', ['Here both ends read zero', 'Here both breakers counted the sequence'],
                      pair(cl, cl_r)),
        ]
        others_ok = all(abs(mw(pack, b)[now]) > 0 or abs(mw(pack, b)[i - 1]) < p['dead_mw']
                        for b in line_bays_of(pack, station(pack, aid)) if b != aid)
        ro = [
            ruled_out('Telemetry loss', 'ruled out',
                      f'Both ends read zero, both breakers counted the operations, the buses dipped, and the other bays at '
                      f'{here} kept reporting' + (' normally.' if others_ok else '.')),
            ruled_out('Planned switching', 'ruled out',
                      'An operator opening a line doesn\'t add a reclose or a voltage dip. No switching on this circuit is '
                      'in today\'s work list before the trip.'),
            ruled_out('A stuck breaker', 'ruled out',
                      'Both ends opened cleanly in the same scan and nothing else at either station lost its flow, so no '
                      'breaker-failure protection operated.'),
            ruled_out('What caused the fault', 'not yet checked',
                      'The data can\'t say whether it was vegetation, lightning, contamination or damage. That is what the '
                      'patrol is for; don\'t try to return the circuit until it reports.'),
        ]
        worst_before = {s: v[i - 1] for s, v in ctg.items()}
        worst_after = {s: max(v[i:]) for s, v in ctg.items()}
        return {
            'conclusion': conclusion('Cause', f'{cname} tripped on a fault, failed its reclose and is locked out', level,
                                     'Recorded at both ends' if level == 'high' else 'Recorded at this end'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The trip is recorded independently at both ends: both flows went to zero, both '
                                     'breakers counted trip, reclose, trip, and every nearby bus dipped in the same scan.'
                                     if level == 'high' else 'The flow and this end\'s breaker record the trip and failed reclose.',
                                     'The lockout itself is certain; what caused the fault is not known until the patrol reports.',
                                     None, 'A breaker counter turns out to have been reset by maintenance. Then check the relay '
                                           'event reports.'),
            'action': action(item, pack),
            'impact': (f'The circuit is out of the contingency set. Worst post-contingency loading went from '
                       + join_names(f'{num(worst_before[s], 0)} % to {num(worst_after[s], 0)} % at {pack.name(s)}' for s in ctg)
                       + ' once its flow moved elsewhere.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Substation exposed on the next contingency — archetype 09 (cascade)
# ═════════════════════════════════════════════════════════════════════════
class PostContingencyExposure(Detector):
    id = 'grid.post_contingency_exposure'
    name = 'Exposed on the next contingency after an element loss'
    archetype = '09 Cascade failure'
    applies_to = 'substations'
    summary = ('A substation\'s worst post-contingency loading jumps in the same scan that a circuit at or next to it '
               'loses its flow, and with that circuit still out it has no margin left: one lost element has pushed its '
               'flow onto paths that can\'t survive the next one.')
    pipeline = [
        ('Exposure', 'the station\'s worst N-1 post-contingency loading (max over its line and transformer bays) against '
                     'the 95 % advisory level and 100 % of emergency rating'),
        ('Step', 'a jump of step_pts or more within step_window_min: redistribution, not load growth'),
        ('Cause', 'a circuit at this station, or at the far end of one of its circuits, going dead in that scan and '
                  'still out'),
        ('Checks', 'no margin · stepped · circuit lost · parallel flows up · relief after a tie closed · rising again'),
        ('Conclusion', 'a cascade from the lost element; one item per lost circuit (both ends of the stressed path '
                       'group together); the mitigation\'s side effects are shown, not hidden'),
    ]
    definition = {
        'appliesTo': {'assetType': list(SUBSTATIONS)},
        'inputs': {'worst': 'self.worst_post_ctg_loading_pct', 'elements': 'children[line/transformer bays].post_ctg_loading_pct',
                   'lost': 'MW flow on line bays at this station and one circuit away',
                   'tie': 'sub_line_bay flow going from ~0 to > tie_mw (a normally-open tie closed)'},
        'params': {'sol_pct': 100.0, 'advisory_pct': 95.0, 'sustain_min': 10, 'step_pts': 20.0, 'step_window_min': 15,
                   'dead_mw': 1.0, 'min_before_mw': 10.0, 'pickup_pct': 20.0, 'tie_mw': 5.0, 'relief_min': 30,
                   'relief_pts': 5.0},
        'checks': [
            {'id': 'over', 'role': 'required', 'rule': 'worst > advisory_pct for sustain_min (reported against sol_pct too)'},
            {'id': 'step', 'role': 'required', 'rule': 'worst rose > step_pts within step_window_min at some earlier scan'},
            {'id': 'lost', 'role': 'required', 'rule': 'a line bay here or one circuit away went from > min_before_mw to < dead_mw in that scan, and is still dead'},
            {'id': 'redistribution', 'role': 'supporting', 'independent': True, 'rule': 'measured MW on a parallel path rose > pickup_pct in that scan'},
            {'id': 'relief', 'role': 'supporting', 'independent': True, 'rule': 'after a normally-open tie closed, worst fell > relief_pts within relief_min'},
            {'id': 'rising', 'role': 'supporting', 'rule': 'worst rising again over the last hour'},
        ],
        'ruleOut': ['load growth', 'a study artefact', 'an actual overload'],
        'confidence': {'medium': 'measured flows moved with the study', 'high': 'switching relieved it as the study predicted'},
        'references': ['textbook: parallel path after a line loss', 'variant: relieved by switching, exposure moves',
                       'look-alike: load growth to the limit'],
    }

    def candidates(self, pack):
        return pack.of_type(*SUBSTATIONS)

    def _nearby_line_bays(self, pack, st):
        out = list(line_bays_of(pack, st))
        for b in line_bays_of(pack, st):
            rem, _ = circuit(pack, b)
            if rem:
                for b2 in line_bays_of(pack, station(pack, rem)):
                    if b2 not in out:
                        out.append(b2)
        return out

    def group(self, pack, aid):
        """Both ends of the stressed path see the same exposure: one item per lost circuit."""
        f = self.evaluate(pack, aid)
        if not f.fired:
            return aid
        rem, _ = circuit(pack, f.ctx['lost'][0])
        return tuple(sorted([f.ctx['lost'][0], rem]))

    def evaluate(self, pack, aid):
        p = self.p
        w = pack.series(aid, 'worst_post_ctg_loading_pct')
        over = B.gt(w, p['advisory_pct'])
        sw = pack.steps(p['step_window_min'])
        bays = self._nearby_line_bays(pack, aid)
        flows = {b: mw(pack, b) for b in bays}
        for i in range(1, pack.n):
            s0 = B.sustained_since(over, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            # the latest scan j ≤ i where a nearby circuit went dead (and is still dead at i) and the exposure jumped
            for j in range(i, 0, -1):
                lost = [b for b, fl in flows.items() if fl and abs(fl[j - 1]) > p['min_before_mw']
                        and all(abs(x) < p['dead_mw'] for x in fl[j:i + 1])]
                if lost and max(w[j:min(pack.n, j + sw)]) - w[j - 1] >= p['step_pts']:
                    return Finding(aid, True, i, w=w, cross=s0, step_at=j, lost=lost)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        w, cross, j, lost = c['w'], c['cross'], c['step_at'], c['lost']
        name = pack.name(aid)
        lost_bay = next((b for b in lost if station(pack, b) == aid), lost[0])
        lname = circuit_name(pack, lost_bay)
        peak = max(range(cross, pack.n), key=lambda k: w[k])
        sol_i = B.first_true(B.gt(w, p['sol_pct']), j)
        others = [s for s in self.candidates(pack) if s != aid and self.group(pack, s) == self.group(pack, aid)]
        elems = [b for b in pack.children.get(aid, []) if pack.has(b, 'post_ctg_loading_pct')]
        worst_el = max(elems, key=lambda b: pack.series(b, 'post_ctg_loading_pct')[peak])
        worst_now = max(elems, key=lambda b: pack.series(b, 'post_ctg_loading_pct')[now])
        # parallel paths: every other line or transformer bay here or one circuit away whose MW/MVA jumped in scan j
        movers = []
        for b in self._nearby_line_bays(pack, aid):
            if b in lost:
                continue
            fl = mw(pack, b)
            if fl and abs(fl[j - 1]) > 5 and (abs(fl[j]) - abs(fl[j - 1])) / abs(fl[j - 1]) * 100 > p['pickup_pct']:
                movers.append((b, abs(fl[j - 1]), abs(fl[j])))
        movers.sort(key=lambda x: -(x[2] - x[1]))
        red_ok = bool(movers)
        # a normally-open tie closing after the crossing (any sub_line_bay anywhere from ~0 to > tie_mw)
        tie, tie_i = None, None
        for b in pack.of_type('sub_line_bay'):
            fl = mw(pack, b)
            for k in range(cross, pack.n):
                if abs(fl[k - 1]) < p['dead_mw'] <= abs(fl[k]) and max(abs(x) for x in fl[k:k + 3]) > p['tie_mw'] \
                        and max(abs(x) for x in fl[:cross]) < p['dead_mw']:
                    tie, tie_i = b, k
                    break
            if tie:
                break
        rel_i = None
        if tie:
            rel_i = next((k for k in range(tie_i, min(pack.n, tie_i + pack.steps(p['relief_min']) + 1))
                          if w[tie_i - 1] - w[k] > p['relief_pts']), None)
        relief_ok = rel_i is not None
        slope = B.slope_per_hour(w, now, pack.steps(60), pack.step_min)
        rising_ok = slope is not None and slope > 0.5
        eta = (p['sol_pct'] - w[now]) / slope * 60 if rising_ok and w[now] < p['sol_pct'] else None
        # who else carries exposure after the tie (the honest part)
        shifted = []
        if tie:
            for s in pack.of_type(*SUBSTATIONS):
                if s == aid:
                    continue
                ws = pack.series(s, 'worst_post_ctg_loading_pct')
                if ws[min(pack.now, tie_i + 2)] - ws[tie_i - 1] > 5 and ws[now] > p['advisory_pct'] - 5:
                    shifted.append((s, ws[tie_i - 1], ws[now]))
        level = 'high' if relief_ok else 'medium' if red_ok else 'low'
        y_w = dom(w, [p['sol_pct'] + 5], pad=0.05, floor=0)
        tie_name = circuit_name(pack, tie) if tie else None

        checks = [
            check('over', 'No margin left on the next contingency', 'required', MATCH,
                  f'Worst post-contingency loading above {num(p["advisory_pct"], 0)} % from {ts[cross]}' +
                  (f', past {num(p["sol_pct"], 0)} % of emergency rating at {ts[sol_i]}' if sol_i is not None else '') +
                  f'; peak {num(w[peak], 1)} % at {ts[peak]}, on {element_name(pack, worst_el)}. {num(w[now], 1)} % now.',
                  'Above 95 % the next single outage would take an element to its emergency rating; above 100 % it would '
                  'overload it, an SOL exceedance that needs an operating plan.',
                  spark(w, y_w, threshold_value=p['sol_pct'], highlight=[ts[cross], ts[peak]])),
            check('step', 'It jumped; load didn\'t creep there', 'required', MATCH,
                  f'{num(w[j - 1], 1)} % at {ts[j - 1]}, {num(w[min(pack.now, j + pack.steps(p["step_window_min"]))], 1)} % '
                  f'{dur(p["step_window_min"])} later.',
                  'Load growth moves post-contingency loading a point or two an hour. A jump like this is the network '
                  'changing shape.',
                  spark(w, y_w, highlight=[ts[j - 1], ts[min(pack.now, j + 3)]])),
            check('lost', 'A circuit next to it went out in that scan', 'required', MATCH,
                  f'{lname}: {num(abs(mw(pack, lost_bay)[j - 1]), 1)} MW at {ts[j - 1]}, zero from {ts[j]}' +
                  (', and still out.' if dead_since(mw(pack, lost_bay), j, p['dead_mw']) else '.'),
                  'With that circuit gone, its flow and its role in the contingency set move to the paths that are left.',
                  spark(mw(pack, lost_bay), dom(mw(pack, lost_bay), [0], pad=0.1))),
            check('redistribution', 'Measured flows moved the same way', 'supporting', MATCH if red_ok else NO_MATCH,
                  (join_names(f'{circuit_name(pack, b)} {num(a0, 0)} → {num(a1, 0)} MW' for b, a0, a1 in movers[:3]) +
                   f' in the {ts[j]} scan.') if red_ok else 'No parallel circuit changed.',
                  'A separate source: SCADA flows, not the contingency study. The study and the meters agree on where the '
                  'flow went.',
                  spark(mw(pack, movers[0][0]), dom(mw(pack, movers[0][0]), pad=0.1)) if red_ok else None),
            check('relief', 'Relieved when a tie was closed', 'supporting', MATCH if relief_ok else (NO_MATCH if tie else PENDING),
                  (f'{tie_name} closed at {ts[tie_i]} ({num(abs(mw(pack, tie)[tie_i - 1]), 1)} → '
                   f'{num(abs(mw(pack, tie)[min(pack.now, tie_i + 2)]), 1)} MW); worst post-contingency loading '
                   f'{num(w[tie_i - 1], 1)} → {num(w[rel_i], 1)} % by {ts[rel_i]}.') if relief_ok else
                  (f'{tie_name} closed at {ts[tie_i]} but the exposure stayed.' if tie else 'No switching yet.'),
                  'Acting on the cause (moving load off the stressed path) moved the study result the way the diagnosis '
                  'predicts.',
                  spark(w, y_w, threshold_value=p['sol_pct'], highlight=[ts[tie_i], ts[rel_i]] if relief_ok else None)),
            check('rising', 'Climbing again with the load', 'supporting', MATCH if rising_ok else NO_MATCH,
                  f'{signed(slope, 1)} points per hour over the last hour; {num(w[now], 1)} % now'
                  + (f', which reaches {num(p["sol_pct"], 0)} % again at about {hhmm(tmin(ts[now]) + eta)}.' if eta else '.'),
                  'The relief was a fixed amount of MW. The load ramp keeps adding to what is left.',
                  spark(w, y_w, threshold_value=p['sol_pct'], window=win(pack, now - 24, now))),
        ]
        main = chart('%', y_w,
                     [series(b, element_name(pack, b), pack.series(b, 'post_ctg_loading_pct'), 'peer', 1)
                      for b in elems if max(pack.series(b, 'post_ctg_loading_pct')) > 70] +
                     [series('worst', f'{name} worst post-contingency loading', w, 'primary', 1)],
                     title='What we see',
                     caption=f'Worst N-1 post-contingency loading at {name}, as % of emergency rating, and the elements it is '
                             f'made of.',
                     thresholds=[threshold(p['sol_pct'], 'Emergency rating'), threshold(p['advisory_pct'], 'Advisory')],
                     markers=[marker(ts[j], f'{lname} out')] + ([marker(ts[tie_i], 'Tie closed')] if tie else []))

        grid = minutes_grid(-30, 240, 10)
        r = Rng(606)
        lw = aligned(w, j, pack.step_min, grid, 'min')
        w0 = w[j - 1]
        tb = [(w0 + 0.03 * m if m < 0 else w0 + 40 + 0.05 * m) + r.gauss(0.4) for m in grid]
        va = [(w0 + 0.03 * m if m < 0 else w0 + 40 + 0.05 * m - (18 if m >= 60 else 0) + (0.04 * (m - 60) if m >= 60 else 0))
              + r.gauss(0.4) for m in grid]
        lg = [w0 + 0.12 * (m + 30) + r.gauss(0.4) for m in grid]
        live = f'{name}, today'
        th = [threshold(p['sol_pct'], 'Emergency rating')]

        def one(a):
            return [ref_chart('Worst post-contingency loading', '%', dom(a, lw, [p['sol_pct']], pad=0.05), grid, 'min', a,
                              lw, live, 1, th)]
        refs = [
            reference('parallel', 'textbook', 'Textbook', 'Parallel path after a line loss',
                      'A circuit trips; its flow divides onto the parallel paths in the same scan, and the next contingency '
                      'now overloads one of them. On 14 August 2003 each loss pushed the next line closer to its rating.',
                      'match', 'Closest match', ['A jump in one scan, with the circuit loss', 'Over the rating within minutes'],
                      one(tb)),
            reference('relieved', 'variant', 'Variant', 'Relieved by switching; the exposure moves',
                      'Closing a normally-open tie takes load off the stressed path. Flow divides by impedance, so part '
                      'of it lands on a third element, and the load ramp takes the margin back.',
                      'match' if relief_ok else 'partial', 'What happened next' if relief_ok else 'Possible next step',
                      [f'{tie_name} closed at {ts[tie_i]}' if tie else 'No tie closed yet'] +
                      ([f'{pack.name(s)} rose from {num(a0, 0)} % to {num(a1, 0)} %' for s, a0, a1 in shifted[:1]]),
                      one(va)),
            reference('growth', 'lookalike', 'Look-alike', 'Load growth to the limit',
                      'Post-contingency loading climbs a point or two an hour with the load until it meets the rating. '
                      'No step, no element lost: the fix is dispatch, not switching.',
                      'nomatch', 'Doesn\'t match', ['Here it jumped in one scan', 'Here a circuit went out at that moment'],
                      one(lg)),
        ]
        load_rate = B.slope_per_hour(w, j - 1, pack.steps(60), pack.step_min)
        el_load = pack.series(worst_now, 'loading_pct')
        ro = [
            ruled_out('Load growth', 'ruled out',
                      f'Before the step it was rising {signed(load_rate, 1)} points an hour; the step was '
                      f'{num(w[min(pack.now, j + 2)] - w[j - 1], 0)} points in {dur(3 * pack.step_min)}.'),
            ruled_out('A study artefact', 'ruled out' if red_ok else 'unlikely',
                      'Measured MW flows on the parallel circuits moved in the same scan, by the amounts the study implies.'
                      if red_ok else 'The study changed exactly when the circuit went out.'),
            ruled_out('An actual overload now', 'ruled out',
                      f'Pre-contingency, {element_name(pack, worst_now)} '
                      f'is at {num(el_load[now], 0)} % of its normal rating. The exposure is to the next outage, not today\'s '
                      'flows.'),
        ]
        return {
            'conclusion': conclusion('Cause', f'Losing {lname} put {name} one contingency from overload', level,
                                     'Relieved by switching, as the study predicted' if relief_ok else 'Measured flows agree'),
            'rootCauseAssetId': lost_bay,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The exposure jumped in the scan the circuit went out, the measured flows moved onto the '
                                     'same paths, and closing the tie brought it down.' if relief_ok else
                                     'The exposure jumped in the scan the circuit went out and the measured flows agree.',
                                     None if relief_ok else 'No switching has tested it yet.',
                                     None, 'The study\'s contingency list or ratings turn out to be out of date.',
                                     'Relief after the tie was closed' if relief_ok else None),
            'action': action(item, pack),
            **({'grouped': [name] + [pack.name(s) for s in others]} if others else {}),
            'impact': ((f'At {signed(slope, 1)} points an hour, {name} is back over {num(p["sol_pct"], 0)} % at about '
                        f'{hhmm(tmin(ts[now]) + eta)}, before the evening peak. ' if eta else '') +
                       (f'The tie also moved exposure: ' + join_names(f'{pack.name(s)} went from {num(a0, 0)} % to '
                                                                      f'{num(a1, 0)} %' for s, a0, a1 in shifted) + '. '
                        if shifted else '') +
                       (join_names(f'{pack.name(s)} ({num(pack.series(s, "worst_post_ctg_loading_pct")[now], 1)} % now)'
                                   for s in others) +
                        ' shows the same exposure from the other end of the stressed path; this item covers it.'
                        if others else '')).strip() or None,
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. Bus voltage sag caused by reactive plant elsewhere — archetype 07 (ghost signal)
# ═════════════════════════════════════════════════════════════════════════
REACTIVE_KEYS = {'shunt_cap_bank': 'cap_bank_mvar', 'shunt_reactor': 'reactor_mvar'}


class VoltageSagUpstream(Detector):
    id = 'grid.voltage_sag_upstream'
    name = 'Bus voltage sag caused by lost reactive support elsewhere'
    archetype = '07 Ghost signal'
    applies_to = 'bus sections'
    summary = ('A bus drops below the 0.95 pu pre-contingency floor in one scan and stays there, and in the same scan a '
               'capacitor bank somewhere on the connected network loses its output: the symptom is at the weak end of the '
               'network, the cause is where the support was lost.')
    pipeline = [
        ('Symptom', 'bus voltage held below floor_pu (3-scan median, so one noisy scan doesn\'t decide it) for '
                    'sustain_min, entered by a step of step_pu or more'),
        ('Search', 'every shunt capacitor bank and reactor for an output step in the same scan'),
        ('Trace', 'the electrical path from the bus to that bank (supply, subtransmission, transformation, station_bus and '
                  'reactive_support layers)'),
        ('Checks', 'below floor · stepped · support lost in that scan · the bank\'s own unbalance · sag deepest far away · '
                   'no local change · recovered after taps were raised'),
        ('Conclusion', 'the item stays on the bus that alarmed; the explanation names the root-cause asset'),
    ]
    definition = {
        'appliesTo': {'assetType': 'bus_section'},
        'inputs': {'v': 'self.bus_voltage_pu', 'banks': 'every shunt_cap_bank.cap_bank_mvar and shunt_reactor.reactor_mvar',
                   'unbalance': 'bank.cap_neutral_unbal_a', 'load': 'station_bus targets[load_bay].served_load_mw',
                   'taps': 'tap_position on transformers along the path'},
        'params': {'floor_pu': 0.95, 'sustain_min': 15, 'step_pu': 0.03, 'bank_drop_mvar': 20.0, 'coincide_scans': 1,
                   'unbal_ratio': 3.0, 'load_step_pct': 5.0, 'tap_raise_steps': 2, 'recover_min': 30, 'dead_mw': 1.0},
        'checks': [
            {'id': 'low', 'role': 'required', 'rule': 'median of the last 3 scans of v < floor_pu for sustain_min'},
            {'id': 'step', 'role': 'required', 'rule': 'v fell > step_pu in one scan to get there'},
            {'id': 'support', 'role': 'required', 'rule': 'a connected shunt bank lost > bank_drop_mvar within ±coincide_scans'},
            {'id': 'unbalance', 'role': 'supporting', 'independent': True, 'rule': 'that bank\'s neutral unbalance stepped > unbal_ratio × and stayed'},
            {'id': 'gradient', 'role': 'supporting', 'rule': 'this bus sagged more than the bank\'s own bus, in the same scan'},
            {'id': 'local', 'role': 'supporting', 'rule': 'load at this station changed < load_step_pct and no circuit here went dead'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True,
             'rule': 'a tap changer feeding this voltage level raised ≥ tap_raise_steps in one scan, and v > floor_pu within recover_min'},
        ],
        'ruleOut': ['a local load step', 'a line outage', 'a voltage transformer fault here', 'the transmission lockout'],
        'confidence': {'medium': 'required checks + the bank\'s own unbalance', 'high': 'voltage recovered when support was restored by taps'},
        'references': ['textbook: capacitor bank trip', 'variant: generator reactive limit', 'look-alike: fault-cleared dip'],
    }

    def candidates(self, pack):
        return pack.of_type('bus_section')

    def _banks(self, pack):
        return [a for t in REACTIVE_KEYS for a in pack.of_type(t)]

    def evaluate(self, pack, aid):
        p = self.p
        v = pack.series(aid, 'bus_voltage_pu')
        med = [median(v[max(0, k - 2):k + 1]) for k in range(pack.n)]
        low = B.lt(med, p['floor_pu'])
        for i in range(1, pack.n):
            sm = B.sustained_since(low, i)
            if sm is None or pack.minutes_between(sm, i) < p['sustain_min']:
                continue
            # the step that took it there: the largest one-scan drop just before the low run (a bus can land exactly
            # on the floor for a scan or two before the median goes under it)
            s0 = max(range(max(1, sm - pack.steps(p['sustain_min']) - 1), sm + 1), key=lambda k: v[k - 1] - v[k])
            if max(v[s0:sm + 1]) > p['floor_pu']:
                continue
            if v[s0 - 1] - v[s0] < p['step_pu']:
                continue
            for bank in self._banks(pack):
                q = pack.series(bank, REACTIVE_KEYS[pack.asset(bank)['assetType']])
                cs = p['coincide_scans']
                drop = max(q[k - 1] - q[k] for k in range(max(1, s0 - cs), min(pack.n, s0 + cs + 1)))
                if drop < p['bank_drop_mvar']:
                    continue
                path = electrical_path(pack, aid, bank)
                if path:
                    return Finding(aid, True, i, v=v, start=s0, bank=bank, path=path)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        v, s0, bank, path = c['v'], c['start'], c['bank'], c['path']
        bname = plant_name(pack, bank)
        here = bus_name(pack, aid)
        qkey = REACTIVE_KEYS[pack.asset(bank)['assetType']]
        q = pack.series(bank, qkey)
        bank_bus = pack.targets(bank, 'reactive_support')[0]
        via = [pack.name(s) for s in stations_on(pack, path)]
        unb = pack.series(bank, 'cap_neutral_unbal_a') if pack.has(bank, 'cap_neutral_unbal_a') else None
        unb_ok = unb is not None and min(unb[s0:]) > p['unbal_ratio'] * B.mean(unb[:s0])
        # sag depth everywhere in that scan
        depth = {b: pack.series(b, 'bus_voltage_pu')[s0 - 1] - pack.series(b, 'bus_voltage_pu')[s0]
                 for b in pack.of_type('bus_section')}
        ranked = sorted([b for b in depth if depth[b] > 0.005], key=lambda b: -depth[b])
        grad_ok = depth[aid] > depth[bank_bus]
        # local changes at this station
        st = station(pack, aid)
        loads = [b for b in pack.targets(aid, 'station_bus') if pack.has(b, 'served_load_mw')]
        l_now = sum(pack.series(b, 'served_load_mw')[s0] for b in loads)
        l_before = sum(pack.series(b, 'served_load_mw')[s0 - 1] for b in loads)
        l_step = abs(l_now - l_before) / l_before * 100 if l_before else 0.0
        dead_here = [b for b in line_bays_of(pack, st) if mw(pack, b) and abs(mw(pack, b)[s0 - 1]) > p['dead_mw']
                     and abs(mw(pack, b)[s0]) < p['dead_mw']]
        local_ok = l_step < p['load_step_pct'] and not dead_here
        # taps raised on transformers along the path, then recovery
        # taps raised on the transformers that feed this bus's voltage level (a deliberate multi-step raise in
        # one scan: automatic control moves one step at a time), then recovery within recover_min
        raised = []
        level_kv = pack.name(aid).split(' ')[0]
        xfs = [x for x in pack.of_type(*XFMR_TYPES)
               if regulated_bus(pack, x) and pack.name(regulated_bus(pack, x)).split(' ')[0] == level_kv]
        end_low = next((k for k in range(s0 + 1, pack.n - 1) if v[k] >= p['floor_pu'] and v[k + 1] >= p['floor_pu']
                        and v[k + 1] > v[s0] + p['step_pu'] / 2), None)
        for x in xfs:
            o = pack.child_of_type(x, 'oltc')
            if not o or end_low is None:
                continue
            tp = pack.series(o, 'tap_position')
            k0 = max(s0 + 1, end_low - pack.steps(p['recover_min']))
            k = next((k for k in range(k0, end_low + 1) if tp[k] - tp[k - 1] >= p['tap_raise_steps']), None)
            if k is not None:
                raised.append((x, tp[k - 1], tp[k], k))
        recovered = bool(raised) and end_low is not None
        level = 'high' if recovered else 'medium' if unb_ok else 'low'
        t_raise = min(k for *_, k in raised) if raised else None
        window = win(pack, s0 - 12, now)
        y_v = dom(v, [p['floor_pu'] - 0.01, 1.0], pad=0.1)

        checks = [
            check('low', 'Below the pre-contingency floor', 'required', MATCH,
                  f'{here} {num(min(v[s0:end_low or now]), 3)} pu at its lowest; held at or under {num(p["floor_pu"], 2)} pu '
                  f'from {ts[s0]}' + (f' to {ts[end_low - 1]}.' if end_low else ' until now.'),
                  'System voltage should stay between 0.95 and 1.05 pu with everything in service. Below that, the next '
                  'contingency starts from too low.',
                  spark(v, y_v, threshold_value=p['floor_pu'], window=window)),
            check('step', 'It stepped down in one scan', 'required', MATCH,
                  f'{num(v[s0 - 1], 3)} pu at {ts[s0 - 1]}, {num(v[s0], 3)} pu at {ts[s0]}.',
                  'A step means something switched. Load growth pulls voltage down slowly.',
                  spark(v, y_v, highlight=[ts[s0 - 1], ts[s0]], window=window)),
            check('support', 'Reactive support was lost in the same scan', 'required', MATCH,
                  f'{bname}: {num(q[s0 - 1], 1)} MVAr at {ts[s0 - 1]}, {num(q[s0], 1)} MVAr at {ts[s0]}. It is '
                  f'{len(via) - 1} stations away, via {join_names(via[1:-1]) if len(via) > 2 else via[-1]}.',
                  'A shunt capacitor bank supplies reactive power locally. When it drops out, the MVAr has to come from '
                  'further away, and voltage falls furthest where the network is weakest.',
                  spark(q, dom(q, [0], pad=0.1), window=window)),
            check('unbalance', 'The bank\'s own protection saw a failed can', 'supporting', MATCH if unb_ok else NO_MATCH,
                  (f'Neutral unbalance current {num(B.mean(unb[:s0]), 3)} A before, {num(unb[s0], 3)} A from {ts[s0]}, and it '
                   f'stayed there.') if unb else 'No unbalance measurement on this bank.',
                  'A separate measurement at the bank. A step that doesn\'t come back is a failed element and its fuse, '
                  'not a drifting reading. The first failure alarms; the protection trips the bank.',
                  spark(unb, dom(unb, [0]), window=window) if unb else None),
            check('gradient', 'Sagged most far from the cause', 'supporting', MATCH if grad_ok else NO_MATCH,
                  f'Same scan: ' + ', '.join(f'{bus_name(pack, b)} {num(depth[b], 3)}' for b in ranked[:5]) +
                  f' pu; the bank\'s own {bus_name(pack, bank_bus)} {num(depth[bank_bus], 3)} pu.',
                  'Every bus saw it at once, deepest at the electrically weak end. The alarm is furthest from the cause.',
                  spark([pack.series(bank_bus, 'bus_voltage_pu')[k] for k in range(pack.n)], y_v, window=window)),
            check('local', 'Nothing changed locally', 'supporting', MATCH if local_ok else NO_MATCH,
                  f'Load at {pack.name(st)} moved {num(l_step, 1)} % in that scan' +
                  (' and every circuit there stayed in service.' if not dead_here else
                   f'; {join_names(circuit_name(pack, b) for b in dead_here)} went out.'),
                  'A local load step or a lost feed would also sag this bus, but only this bus and its neighbours.',
                  None),
            check('recovered', 'Recovered when taps were raised', 'supporting', MATCH if recovered else PENDING,
                  (join_names(f'{xf_name(pack, x)} tap {num(b0, 0)} → {num(a0, 0)}' for x, b0, a0, _ in raised) +
                   f' at {ts[t_raise]}; {here} back above {num(p["floor_pu"], 2)} pu by {ts[end_low]}, '
                   f'{num(v[now], 3)} pu now.') if recovered else 'No tap or reactive action yet.',
                  'Raising taps restores voltage the way the lost MVAr would have. The bus answered, so reactive support '
                  'was the problem; the bank still needs repair.',
                  spark(v, y_v, threshold_value=p['floor_pu'], highlight=[ts[t_raise], ts[end_low]] if recovered else None)),
        ]
        main = chart('pu', y_v,
                     [series(b, bus_name(pack, b), pack.series(b, 'bus_voltage_pu'), 'peer', 3) for b in ranked[1:4]] +
                     [series('bank_bus', f'{bus_name(pack, bank_bus)} (the bank\'s bus)', pack.series(bank_bus, 'bus_voltage_pu'),
                             'secondary', 3),
                      series('bus', here, v, 'primary', 3)],
                     title='What we see',
                     caption=f'{here} against the other buses that sagged in the same scan, and the bus the capacitor bank '
                             f'sits on. The furthest bus sagged most.',
                     thresholds=[threshold(p['floor_pu'], 'Pre-contingency floor')],
                     markers=[marker(ts[s0], f'{bname} out')] + ([marker(ts[t_raise], 'Taps raised')] if recovered else []),
                     decimals=3)

        grid = minutes_grid(-30, 180, 10)
        r = Rng(707)
        lv = aligned(v, s0, pack.step_min, grid, 'min')
        v0 = v[s0 - 1]
        d = depth[aid]
        tb = [(v0 if m < 0 else v0 - d - 0.0001 * m) + r.gauss(0.001) for m in grid]
        ge = [(v0 if m < 0 else v0 - 0.0004 * min(m, 90)) + r.gauss(0.001) for m in grid]
        fd = [(v0 - 0.06 if m == 0 else v0) + r.gauss(0.001) for m in grid]
        live = f'{here}, today'
        th = [threshold(p['floor_pu'], 'Floor')]

        def one(a):
            return [ref_chart('Bus voltage', 'pu', dom(a, lv, [p['floor_pu']], pad=0.1), grid, 'min', a, lv, live, 3, th)]
        refs = [
            reference('captrip', 'textbook', 'Textbook', 'Capacitor bank trips on unbalance',
                      'A failed can blows its fuse, the unbalance protection trips the bank, and every bus nearby steps '
                      'down in the same scan, the weak end of the network most. It holds there until support is restored.',
                      'match', 'Closest match', ['One-scan step, holding low, as here', 'Recovered with taps' if recovered
                                                 else 'Waiting for taps or the bank'], one(tb)),
            reference('genlimit', 'variant', 'Variant', 'A generator reaches its reactive limit',
                      'A nearby unit hits its over-excitation limit and stops supplying MVAr. Voltage slides over minutes '
                      'instead of stepping, and the MVAr loss shows at the generator, not a bank.',
                      'nomatch', 'Same symptom, different source', ['Here the voltage stepped', 'Here a bank lost its output'],
                      one(ge)),
            reference('fault', 'lookalike', 'Look-alike', 'Fault dip, cleared',
                      'A fault anywhere nearby pulls every bus down for one scan; once it clears, the voltage comes straight '
                      'back.', 'nomatch', 'Doesn\'t match',
                      [f'Here it stayed low for {dur(pack.minutes_between(s0, end_low or now))}', 'No reclose or trip at that time'],
                      one(fd)),
        ]
        cvt = pack.child_of_type(aid, 'cvt')
        cvt_dev = pack.series(cvt, 'v_redundant_dev_pct') if cvt else None
        lock = [b for b in pack.of_type(*LINE_BAYS) if mw(pack, b) and abs(mw(pack, b)[0]) > p['dead_mw']
                and abs(mw(pack, b)[now]) < p['dead_mw']]
        lock_i = None
        if lock:
            fl = mw(pack, lock[0])
            lock_i = next(k for k in range(1, pack.n) if abs(fl[k]) < p['dead_mw'] and abs(fl[k - 1]) > p['dead_mw'])
        ro = [
            ruled_out('A local load step', 'ruled out', f'Load at {pack.name(st)} moved {num(l_step, 1)} % in that scan.'),
            ruled_out('A line outage', 'ruled out',
                      'No circuit anywhere on the network lost its flow at ' + ts[s0] + '.'),
            ruled_out('A voltage transformer fault here', 'ruled out',
                      (f'The neighbouring buses sagged in the same scan, and this bus\'s CVT stayed within '
                       f'{num(max(cvt_dev), 2)} % of its redundant partner.') if cvt_dev else
                      'The neighbouring buses sagged in the same scan.'),
        ] + ([ruled_out(f'The {circuit_name(pack, lock[0])} lockout', 'ruled out',
                        f'That came at {ts[lock_i]}, {dur(pack.minutes_between(s0, lock_i))} after this sag began.')]
             if lock_i and lock_i > s0 else [])
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'{bname} tripped at {ts[s0]}; {here} sagged because that support was lost, '
                                     f'{len(via) - 1} stations away', level,
                                     'Confirmed: voltage recovered when taps replaced the support' if recovered
                                     else 'Same scan, and the bank\'s own unbalance stepped'),
            'rootCauseAssetId': bank,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The sag, the bank\'s MVAr loss and its unbalance step are all in the same scan, the sag '
                                     'is deepest far from the bank, and the bus recovered once taps made up the support.'
                                     if recovered else
                                     'The sag, the bank\'s MVAr loss and its unbalance step are all in the same scan.',
                                     None if recovered else 'Nothing has restored support yet, so the loop isn\'t closed.',
                                     None if recovered else 'Raising taps or returning the bank brings the voltage back.',
                                     'The voltage stays low with the taps raised. Then look for a second cause.',
                                     'Recovery after the taps were raised' if recovered else None),
            'action': action(item, pack),
            'impact': f'The taps are an interim fix; the {num(q[s0 - 1], 0)} MVAr the bank supplied is still missing from '
                      f'the network\'s reactive reserve until it is repaired.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. Repeated momentary faults on one circuit — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
class RecurringMomentaries(Detector):
    id = 'grid.recurring_momentaries'
    name = 'Repeated momentary faults on one circuit'
    archetype = '12 Recurring micro-events'
    applies_to = 'breakers'
    summary = ('A breaker\'s reclose counter stepping several times in a shift, each time with the line back in service '
               'on the next scan and a voltage dip on the buses it feeds: repeated temporary faults at one place, each too '
               'short to alarm.')
    pipeline = [
        ('Events', 'steps in the breaker\'s reclose counter; a successful reclose leaves the line carrying load on the next scan'),
        ('Count', 'successful recloses within window_min'),
        ('Checks', 'repeated · each reclose held · bus dips each time · duty adding up · no other circuit at those times · '
                   'quiet since'),
        ('Conclusion', 'a pattern at one location, before it becomes a permanent fault'),
    ]
    definition = {
        'appliesTo': {'assetType': list(BREAKERS)},
        'inputs': {'count': 'self.reclose_ops_count', 'ops': 'self.breaker_ops_total', 'i2t': 'self.accum_interrupt_i2t_ka2s',
                   'wear': 'self.contact_wear_pct', 'flow': 'parent bay MW', 'buses': 'buses at both ends of the circuit'},
        'params': {'min_events': 3, 'window_min': 240, 'dead_mw': 1.0, 'dip_pu': 0.02, 'quiet_mult': 2.0},
        'checks': [
            {'id': 'repeated', 'role': 'required', 'rule': '≥ min_events reclose steps within window_min'},
            {'id': 'held', 'role': 'required', 'rule': 'the line carried load on the scan after each one'},
            {'id': 'dips', 'role': 'supporting', 'independent': True, 'rule': 'a bus at either end dipped > dip_pu at every event'},
            {'id': 'duty', 'role': 'supporting', 'rule': 'interrupting duty and contact wear stepped with each event'},
            {'id': 'isolated', 'role': 'supporting', 'rule': 'no other breaker counted a reclose at those times'},
            {'id': 'quiet', 'role': 'supporting', 'independent': True,
             'rule': 'no event for quiet_mult × the mean interval, after a patrol cleared a cause (maintenance log)'},
        ],
        'ruleOut': ['a storm', 'relay or breaker misoperation', 'overload'],
        'confidence': {'medium': 'bus dips confirm real faults', 'high': 'a patrol found and cleared a cause, and it stopped'},
        'references': ['textbook: vegetation growing into a line', 'variant: contamination flashover', 'look-alike: lightning storm'],
    }

    def candidates(self, pack):
        return pack.of_type(*BREAKERS)

    def _events(self, pack, aid):
        rc = pack.series(aid, 'reclose_ops_count')
        return [k for k in range(1, pack.n) if rc[k] > rc[k - 1]]

    def evaluate(self, pack, aid):
        p = self.p
        bay = pack.parent(aid)
        flow = mw(pack, bay)
        if flow is None:
            return Finding(aid, False)
        ev = [k for k in self._events(pack, aid) if abs(flow[k]) > p['dead_mw'] and abs(flow[min(pack.now, k + 1)]) > p['dead_mw']]
        w = pack.steps(p['window_min'])
        for n, k in enumerate(ev):
            inside = [e for e in ev[:n + 1] if k - e <= w]
            if len(inside) >= p['min_events']:
                return Finding(aid, True, k, events=ev, flow=flow, bay=bay)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        ev, flow, bay = c['events'], c['flow'], c['bay']
        cname = circuit_name(pack, bay)
        rem, _ = circuit(pack, bay)
        rc = pack.series(aid, 'reclose_ops_count')
        i2t = pack.series(aid, 'accum_interrupt_i2t_ka2s')
        wear = pack.series(aid, 'contact_wear_pct')
        buses = [x for x in (bay_bus(pack, bay), bay_bus(pack, rem) if rem else None) if x]
        vb = {b: pack.series(b, 'bus_voltage_pu') for b in buses}
        dip = {b: [vb[b][k - 1] - vb[b][k] for k in ev] for b in buses}
        deep = max(buses, key=lambda b: B.mean(dip[b]))
        dips_ok = all(max(dip[b][n] for b in buses) > p['dip_pu'] for n in range(len(ev)))
        duty_ok = all(i2t[k] > i2t[k - 1] and wear[k] > wear[k - 1] for k in ev)
        others = [b for b in pack.of_type(*BREAKERS) if b != aid]
        coinc = []
        for b in others:
            r2 = pack.series(b, 'reclose_ops_count')
            coinc += [(b, k) for k in ev if r2[k] > r2[k - 1]]
        iso_ok = not coinc
        gaps = [pack.minutes_between(a, b) for a, b in zip(ev, ev[1:])]
        mean_gap = B.mean(gaps) if gaps else None
        quiet = pack.minutes_between(ev[-1], now)
        cleared = maintenance_records(item, ts[ev[0]], ['patrol', 'cleared', 'vegetation'])
        quiet_ok = mean_gap is not None and quiet >= p['quiet_mult'] * mean_gap and bool(cleared)
        level = 'high' if quiet_ok else 'medium' if dips_ok else 'low'
        load = pack.series(bay, 'loading_pct')
        y_rc = dom(rc, pad=0.2)
        times = [ts[k] for k in ev]

        checks = [
            check('repeated', f'{len(ev)} recloses in one shift', 'required', MATCH,
                  f'Reclose counter {num(rc[0], 0)} → {num(rc[now], 0)}: at {join_names(times)}. The third came at '
                  f'{ts[f.at]}, inside {dur(p["window_min"])}.',
                  'One reclose is routine; most line faults are temporary. Several on the same circuit in a few hours is '
                  'a cause that keeps coming back to the same place.',
                  spark(rc, y_rc, highlight=[times[0], times[-1]])),
            check('held', 'Every reclose held', 'required', MATCH,
                  f'{cname} carried {num(min(abs(flow[k]) for k in ev), 1)}–{num(max(abs(flow[k]) for k in ev), 1)} MW in '
                  f'the scans of the events; no customer lost supply.',
                  'Each event was over in under a second, so none reaches the outage log and none raises an alarm on its own.',
                  spark(flow, dom(flow, [0], pad=0.1))),
            check('dips', 'The voltage dipped each time', 'supporting', MATCH if dips_ok else NO_MATCH,
                  f'{bus_name(pack, deep)} dipped {num(min(dip[deep]), 3)}–{num(max(dip[deep]), 3)} pu at each event and '
                  f'recovered on the next scan' +
                  (f'; {join_names(bus_name(pack, b) for b in buses if b != deep)} '
                   f'{num(B.mean([x for b in buses if b != deep for x in dip[b]]), 3)} pu on average.' if len(buses) > 1 else '.'),
                  'A separate measurement. Real faults pull the voltage down; a breaker opening on its own wouldn\'t.',
                  spark(vb[deep], dom(vb[deep], pad=0.1), highlight=[times[0], times[-1]])),
            check('duty', 'Breaker duty adding up', 'supporting', MATCH if duty_ok else NO_MATCH,
                  f'Interrupting duty {signed(i2t[now] - i2t[0], 2)} kA²s and contact wear {signed(wear[now] - wear[0], 1)} '
                  f'points today, {num(wear[now], 1)} % now.',
                  'Every fault interruption erodes the contacts in proportion to the square of the current.',
                  spark(wear, dom(wear, pad=0.2))),
            check('isolated', 'Only this circuit', 'supporting', MATCH if iso_ok else NO_MATCH,
                  f'None of the other {len(others)} breakers counted a reclose at those times.' if iso_ok else
                  f'{len(coinc)} other breaker operations at the same times.',
                  'A storm makes many circuits reclose within minutes. One circuit alone points at one place on it.',
                  None),
            check('quiet', 'Quiet since the patrol', 'supporting', MATCH if quiet_ok else PENDING,
                  (f'Maintenance log {cleared[0]["time"]}: {cleared[0]["description"].rstrip(".")}. No event for '
                   f'{dur(quiet)} since, against an average of {dur(mean_gap)} between events before.') if quiet_ok else
                  (f'No event for {dur(quiet)}; the average gap was {dur(mean_gap)}.' if mean_gap else 'Only one event so far.'),
                  'Clearing a cause and seeing the events stop closes the loop.',
                  spark(rc, y_rc, highlight=[times[-1], ts[now]])),
        ]
        main = chart('', y_rc,
                     [series('count', f'{cname} reclose counter ({sname(pack, aid)})', rc, 'primary', 0)],
                     title='What we see',
                     caption=f'Successful auto-recloses on {cname}. Each step is a fault the breaker cleared and reclosed '
                             f'through in under a second.',
                     markers=[marker(t, f'Reclose {n + 1}') for n, t in enumerate(times)], decimals=0)

        # Reference examples: events per hour, on hours since the first event
        grid = hours_grid(8, 0.5)
        r = Rng(808)
        cum = [sum(1 for k in ev if pack.minutes_between(ev[0], k) / 60 <= g) if g >= 0 else 0 for g in grid]
        live_cum = [cum[n] if ev[0] + pack.steps(g * 60) <= now else None for n, g in enumerate(grid)]
        veg = [min(7, int(0.9 * g + 0.8 * r.u()) + (1 if g >= 0 else 0)) for g in grid]
        dew = [(1 if g >= 0 else 0) + (2 if g >= 0.5 else 0) + (1 if g >= 1.5 else 0) for g in grid]
        storm = [(0 if g < 0 else 6 if g < 1.5 else 6) for g in grid]

        def one(a):
            return [ref_chart('Recloses since the first event', '', dom(a, [x for x in live_cum if x is not None], [0], pad=0.1),
                              grid, 'h', a, live_cum, f'{cname}, today', 0)]
        refs = [
            reference('veg', 'textbook', 'Textbook', 'Vegetation growing into the line',
                      'On a hot afternoon the conductor sags with load and a limb makes contact every hour or so. Each fault '
                      'clears on reclose until one doesn\'t. A patrol finds the tree.',
                      'match', 'Closest match', ['Steady run of successful recloses, one circuit', 'Stopped once the limb was cleared'
                                                 if quiet_ok else 'Patrol is the next step'], one(veg)),
            reference('dew', 'variant', 'Variant', 'Contamination flashover',
                      'Salt or dust on insulators flashes over when morning dew wets it. Events bunch early and stop as the '
                      'day dries out.', 'partial', 'Possible, less likely',
                      ['Here the events kept coming through midday', 'Insulator washing, not tree work, fixes it'], one(dew)),
            reference('storm', 'lookalike', 'Look-alike', 'Lightning storm passing',
                      'A storm front makes many circuits reclose within the same half hour, then nothing. It isn\'t a '
                      'problem on any one circuit.', 'nomatch', 'Doesn\'t match',
                      ['Here no other circuit reclosed', f'Here the events were spread over {dur(pack.minutes_between(ev[0], ev[-1]))}'],
                      one(storm)),
        ]
        ro = [
            ruled_out('A storm or system-wide disturbance', 'ruled out',
                      f'No other breaker among {len(others)} reclosed at those times.' if iso_ok else
                      'Other breakers reclosed at the same times.'),
            ruled_out('Relay or breaker misoperation', 'ruled out' if dips_ok else 'not yet checked',
                      f'The bus voltage dipped at every event, which a breaker opening on its own wouldn\'t cause.'),
            ruled_out('Overload', 'ruled out', f'{cname} was at {num(max(load), 0)} % of its normal rating at most.'),
        ]
        return {
            'conclusion': conclusion('Cause' if quiet_ok else 'Most likely cause',
                                     f'Repeated temporary faults at one place on {cname}' +
                                     (f'; the patrol found and cleared it' if quiet_ok else ''), level,
                                     'Stopped after the patrol cleared it' if quiet_ok else 'Real faults, each time'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Each event was a real fault (the buses dipped) on this circuit alone, and the events '
                                     'stopped once the patrol cleared the contact.' if quiet_ok else
                                     'Each event was a real fault on this circuit alone.',
                                     None if quiet_ok else 'The cause hasn\'t been found yet.',
                                     None if quiet_ok else 'A patrol finds the contact point and the events stop.',
                                     'Another reclose on this circuit today. Then the cause wasn\'t the one cleared.',
                                     'Quiet after the patrol' if quiet_ok else None),
            'action': action(item, pack),
            'impact': f'{len(ev)} faults in {dur(pack.minutes_between(ev[0], ev[-1]))} added {signed(wear[now] - wear[0], 1)} points '
                      f'of contact wear. Left alone, a contact like this usually becomes a permanent fault and a lockout.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Transformer winding hot spot climbing — archetype 04 (accumulation)
# ═════════════════════════════════════════════════════════════════════════
class TransformerHotSpot(Detector):
    id = 'grid.transformer_hot_spot'
    name = 'Transformer hot spot building up under load'
    archetype = '04 Accumulation'
    applies_to = 'transformers'
    summary = ('A transformer\'s winding hot spot climbing past the alert level over hours, with every cooling stage '
               'running and the temperature matching what its load and the ambient predict: heat is coming in faster '
               'than it can leave, because of load, not a cooling fault.')
    pipeline = [
        ('Expected value', 'hot spot from the transformer\'s own loading (fast and slow thermal lags) and ambient, fitted '
                           'on the other ten transformers'),
        ('Parallel bank', 'the other transformer of the same kind at the same substation'),
        ('Checks', 'over the alert · heat building · matches load and ambient · cooling all on · load shared unevenly · '
                   'back down after rebalancing'),
        ('Conclusion', 'thermal accumulation from load; confirmed when moving load brings it down'),
    ]
    definition = {
        'appliesTo': {'assetType': list(XFMR_TYPES)},
        'inputs': {'hs': 'self.winding_hotspot_temp_c', 'load': 'self.xfmr_loading_pct', 'mva': 'self.(auto_load_mva | xfmr_load_mva)',
                   'ambient': 'network.ambient_temp_c', 'fans': 'child[cooling_group].cooling_fans_running_n',
                   'pump': 'child[cooling_group].oil_pump_flow_pct', 'parallel': 'same-type transformer at the same substation'},
        'peers': {'same': 'transformers', 'use': 'fit the thermal model on every other transformer'},
        'expected': {'model': 'linear', 'target': 'hs',
                     'features': ['ema((load/100)², tau_fast_steps)', 'ema((load/100)², tau_slow_steps)', 'ambient']},
        'params': {'alert_c': 105.0, 'limit_c': 110.0, 'cyclic_c': 120.0, 'sustain_min': 10, 'rise_window_min': 120,
                   'min_rise_c': 15.0, 'tau_fast_steps': 3, 'tau_slow_steps': 9, 'model_band_c': 5.0, 'share_gap_pct': 15.0,
                   'match_pct': 5.0, 'recover_margin_c': 5.0, 'recover_min': 30, 'pump_min_pct': 90.0},
        'checks': [
            {'id': 'hot', 'role': 'required', 'rule': 'hs > alert_c for sustain_min'},
            {'id': 'building', 'role': 'required', 'rule': 'hs rose > min_rise_c over rise_window_min'},
            {'id': 'model', 'role': 'supporting', 'independent': True, 'rule': '|hs − expected| < model_band_c while over the alert'},
            {'id': 'cooling', 'role': 'supporting', 'rule': 'all fans running (the most seen today) and pump flow > pump_min_pct'},
            {'id': 'share', 'role': 'supporting', 'independent': True, 'rule': 'parallel bank loading lower by > share_gap_pct points'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True,
             'rule': 'after the two banks came within match_pct, hs < min(alert_c, peak − recover_margin_c) for recover_min'},
        ],
        'ruleOut': ['cooling failure', 'winding temperature indicator error', 'internal fault', 'the load increase alone'],
        'confidence': {'medium': 'the load-and-ambient model agrees', 'high': 'rebalancing the load brought it down'},
        'references': ['textbook: hot day, overloaded bank', 'variant: cooling stage failed', 'look-alike: indicator drift'],
    }

    def candidates(self, pack):
        return pack.of_type(*XFMR_TYPES)

    def evaluate(self, pack, aid):
        p = self.p
        hs = pack.series(aid, 'winding_hotspot_temp_c')
        hot = B.gt(hs, p['alert_c'])
        rw = pack.steps(p['rise_window_min'])
        for i in range(1, pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if hs[i] - min(hs[max(0, i - rw):i + 1]) < p['min_rise_c']:
                continue
            return Finding(aid, True, i, hs=hs, alert=s0)
        return Finding(aid, False)

    def _mva(self, pack, aid):
        return pack.series(aid, 'auto_load_mva' if pack.has(aid, 'auto_load_mva') else 'xfmr_load_mva')

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        hs, alert = c['hs'], c['alert']
        xname = xf_name(pack, aid)
        amb = pack.series(pack.first_of_type('transmission_network'), 'ambient_temp_c')
        peers = [a for a in pack.of_type(*XFMR_TYPES) if a != aid]

        def feats(a):
            k2 = [(v / 100) ** 2 for v in pack.series(a, 'xfmr_loading_pct')]
            return [[x, y, t] for x, y, t in zip(B.ema(k2, p['tau_fast_steps']), B.ema(k2, p['tau_slow_steps']), amb)]
        model, exp = B.fleet_expected(pack, aid, peers + [aid], 'winding_hotspot_temp_c', feats,
                                      lambda a: [True] * pack.n, ['fast load²', 'slow load²', 'ambient'])
        res = [h - e for h, e in zip(hs, exp)]
        over = [k for k in range(pack.n) if hs[k] > p['alert_c']]
        peak = max(range(pack.n), key=lambda k: hs[k])
        m_max = max(abs(res[k]) for k in over)
        model_ok = m_max < p['model_band_c']
        load = pack.series(aid, 'xfmr_loading_pct')
        mva = self._mva(pack, aid)
        rw = pack.steps(p['rise_window_min'])
        rise = hs[f.at] - min(hs[max(0, f.at - rw):f.at + 1])
        cool = pack.child_of_type(aid, 'cooling_group')
        fans = pack.series(cool, 'cooling_fans_running_n')
        pump = pack.series(cool, 'oil_pump_flow_pct')
        fan_max = max(fans)
        cool_ok = all(fans[k] == fan_max for k in over) and min(pump[k] for k in over) > p['pump_min_pct']
        fan_on = B.first_true([x == fan_max for x in fans])
        st = station(pack, aid)
        par = next((x for x in pack.descendants(st) if x != aid and pack.asset(x)['assetType'] == pack.asset(aid)['assetType']), None)
        p_load = pack.series(par, 'xfmr_loading_pct') if par else None
        p_mva = self._mva(pack, par) if par else None
        gap = [a - b for a, b in zip(load, p_load)] if par else None
        share_ok = par is not None and gap[peak] > p['share_gap_pct']
        # rebalanced: first time after the peak the two banks come within match_pct
        reb = next((k for k in range(peak, pack.n) if abs(gap[k]) < p['match_pct']), None) if par else None
        rec_at = None
        if reb is not None:
            cool_mask = B.lt(hs, min(p['alert_c'], hs[peak] - p['recover_margin_c']))
            for k in range(reb, pack.n):
                s0 = B.sustained_since(cool_mask, k)
                if s0 is not None and pack.minutes_between(s0, k) >= p['recover_min']:
                    rec_at = s0
                    break
        recovered = rec_at is not None
        level = 'high' if recovered else 'medium' if (model_ok or share_ok) else 'low'
        dga = pack.child_of_type(aid, 'dga_monitor')
        rate = pack.series(dga, 'dga_tdcg_rate_ppm_day')
        c2h2 = pack.series(dga, 'dga_c2h2_ppm')
        y_t = dom(hs, exp, [p['limit_c']], pad=0.05)
        start = B.first_true([m > mva[0] * 1.15 for m in mva]) or 0
        lag = pack.minutes_between(max(range(pack.n), key=lambda k: load[k]), peak)
        pname = xf_name(pack, par) if par else None

        checks = [
            check('hot', 'Past the hot-spot alert', 'required', MATCH,
                  f'{num(hs[peak], 1)} °C at {ts[peak]}; over {num(p["alert_c"], 0)} °C from {ts[alert]} to '
                  f'{ts[over[-1]]}. The continuous limit for a 65 °C-rise winding is {num(p["limit_c"], 0)} °C.',
                  'Insulation ageing roughly doubles for every 6 °C of hot spot. Above 110 °C the winding is using life '
                  'faster than it was designed to.',
                  spark(hs, y_t, threshold_value=p['alert_c'], highlight=[ts[alert], ts[over[-1]]])),
            check('building', 'Heat building up for hours', 'required', MATCH,
                  f'{signed(rise, 1)} °C in the {dur(p["rise_window_min"])} before {ts[f.at]}; loading went from '
                  f'{num(load[max(0, f.at - rw)], 0)} % to {num(load[f.at], 0)} %.',
                  'A transformer\'s oil and winding take tens of minutes to follow load. When load keeps rising, heat in '
                  'exceeds heat out and the temperature climbs scan after scan.',
                  spark(hs, y_t, highlight=[ts[max(0, f.at - rw)], ts[f.at]])),
            check('model', 'Exactly what its load and the weather predict', 'supporting', MATCH if model_ok else NO_MATCH,
                  f'Within {num(m_max, 1)} °C of the thermal model while over the alert (model fitted on the other '
                  f'{len(model.peers)} transformers).',
                  'A separate estimate, from load and ambient only. If cooling or the indicator were at fault, the reading '
                  'would pull away from it.',
                  spark(res, dom(res, [-p['model_band_c'], p['model_band_c']]), band_lo=[-p['model_band_c']] * pack.n,
                        band_hi=[p['model_band_c']] * pack.n)),
            check('cooling', 'All cooling running', 'supporting', MATCH if cool_ok else NO_MATCH,
                  f'{num(fan_max, 0)} fans from {ts[fan_on]}; oil pump flow {num(min(pump[k] for k in over), 0)} % or more '
                  'while over the alert.',
                  'With every stage already on there is nothing left to switch in; the only lever left is load.',
                  spark(fans, [0, fan_max + 2])),
            check('share', 'Its parallel bank carried much less', 'supporting', MATCH if share_ok else NO_MATCH,
                  (f'At {ts[peak]} {xname} {num(mva[peak], 1)} MVA ({num(load[peak], 0)} %) against {pname} '
                   f'{num(p_mva[peak], 1)} MVA ({num(p_load[peak], 0)} %).') if par else 'No parallel bank at this station.',
                  'A separate meter on the other bank. Identical banks in parallel should share load equally; a tap '
                  'mismatch pushes more through one.',
                  spark(gap, dom(gap, [0]), threshold_value=p['share_gap_pct']) if par else None),
            check('recovered', 'Came down when the load was rebalanced', 'supporting', MATCH if recovered else PENDING,
                  (f'The banks within {num(abs(gap[reb]), 1)} points of each other from {ts[reb]}; hot spot below '
                   f'{num(min(p["alert_c"], hs[peak] - p["recover_margin_c"]), 1)} °C from {ts[rec_at]} while the load '
                   f'ramp continued, {num(hs[now], 1)} °C now.')
                  if recovered else ('Load still uneven.' if par else 'No rebalancing possible.'),
                  'Moving load off the bank, and nothing else, brought the temperature down. That confirms load was the cause.',
                  spark(hs, y_t, threshold_value=p['alert_c'], highlight=[ts[reb], ts[rec_at]] if recovered else None)),
        ]
        main = chart('°C', y_t,
                     ([series('par', f'{pname} hot spot', pack.series(par, 'winding_hotspot_temp_c'), 'peer', 1)] if par else []) +
                     [series('expected', 'Expected for its load and ambient', exp, 'expected', 1),
                      series('actual', f'{xname} winding hot spot', hs, 'primary', 1)],
                     title='What we see',
                     caption=f'{xname}\'s winding hot spot, what its load and ambient predict, and its parallel bank. The '
                             f'reading tracks the prediction: the heat is load.',
                     thresholds=[threshold(p['alert_c'], 'Alert'), threshold(p['limit_c'], 'Continuous limit')],
                     markers=[marker(ts[start], 'Load rising')] + ([marker(ts[reb], 'Banks rebalanced')] if reb is not None else []))

        grid = minutes_grid(-60, 180, 10)
        r = Rng(909)
        lh = aligned(hs, peak, pack.step_min, grid, 'min')
        h0 = hs[peak]
        tb = [(h0 - 0.12 * (-m) - 0.0006 * m * m if m < 0 else h0 - 9 * (1 - 2.718 ** (-m / 35))) + r.gauss(0.3) for m in grid]
        cf = [h0 - 12 + (0.15 * (m + 60) if m < 0 else 9 + 0.02 * m) + r.gauss(0.3) for m in grid]
        dr = [h0 - 6 + 0.05 * (m + 60) + r.gauss(0.3) for m in grid]
        live = f'{xname}, today'
        th = [threshold(p['alert_c'], 'Alert')]

        def one(a):
            return [ref_chart('Winding hot spot (minutes from the peak)', '°C', dom(a, lh, [p['alert_c']], pad=0.05), grid,
                              'min', a, lh, live, 1, th)]
        refs = [
            reference('hotday', 'textbook', 'Textbook', 'Hot day, overloaded bank, load moved',
                      'Load and ambient climb together, the hot spot follows two or three scans behind, peaks past the '
                      'alert, and comes back down within the hour once load is moved off the bank.',
                      'match', 'Closest match', [f'Peak {dur(max(0, lag))} after the load peak here',
                                                 'Down within the hour after rebalancing' if recovered else 'Waiting on a load transfer'],
                      one(tb)),
            reference('coolfail', 'variant', 'Variant', 'A cooling stage fails at moderate load',
                      'A fan group or pump trips. The hot spot steps up and stays above what the load predicts, and moving '
                      'load only partly helps.', 'nomatch', 'Doesn\'t match',
                      [f'Here the reading stayed within {num(m_max, 1)} °C of the prediction', 'Here every fan was running'],
                      one(cf)),
            reference('wti', 'lookalike', 'Look-alike', 'Winding temperature indicator drifting',
                      'The indicator\'s heater or calibration drifts and the reading creeps up while load is flat. Top oil '
                      'and the calculated hot spot don\'t move.', 'nomatch', 'Doesn\'t match',
                      ['Here load rose with it', 'Here it fell as soon as the load did'], one(dr)),
        ]
        ro = [
            ruled_out('Cooling failure', 'ruled out',
                      f'{num(fan_max, 0)} fans running and pump flow normal throughout, and the reading stayed within '
                      f'{num(m_max, 1)} °C of what load and ambient predict.'),
            ruled_out('Winding temperature indicator error', 'ruled out' if model_ok else 'not yet checked',
                      'The indicator agrees with the hot spot calculated from load and ambient, and it came down when the '
                      'load did.' if recovered else 'The indicator agrees with the hot spot calculated from load and ambient.'),
            ruled_out('An internal fault', 'ruled out',
                      f'DGA on {xname}: combustible gas rate {num(rate[now], 1)} ppm/day, acetylene {num(c2h2[now], 2)} ppm, '
                      'both flat.'),
            ruled_out('The extra load alone', 'unlikely' if share_ok else 'not yet checked',
                      (f'Shared equally, the peak load would have put both banks near '
                       f'{num((load[peak] + p_load[peak]) / 2, 0)} %. The uneven split is what pushed {xname} past the alert.')
                      if par else 'No parallel bank to share with.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'{xname} was carrying more than its share on a hot afternoon; heat built up from load, '
                                     f'not a cooling fault', level,
                                     'Confirmed: back down once the banks were rebalanced' if recovered
                                     else 'Matches the load-and-ambient model'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The reading matched a thermal model fitted on the other transformers, every cooling '
                                     'stage was already on, the parallel bank was carrying far less, and the hot spot came '
                                     'down once the load was evened out.' if recovered else
                                     'The reading matches the load-and-ambient model and the parallel bank carries less.',
                                     None if recovered else 'Load hasn\'t been moved yet.',
                                     None if recovered else 'The hot spot falls once load is shared evenly.',
                                     'The hot spot climbs again at the same load. Then check the cooling and the indicator.',
                                     'Recovery after rebalancing' if recovered else None),
            'action': action(item, pack),
            'impact': (f'The evening peak is still ahead with ambient at {num(amb[now], 1)} °C. With the banks matched, '
                       f'{xname} is at {num(hs[now], 1)} °C and {pname} at '
                       f'{num(pack.series(par, "winding_hotspot_temp_c")[now], 1)} °C.') if par else None,
            'model': {'target': 'winding_hotspot_temp_c',
                      'formula': f'{num(model.coef[0], 1)} + {num(model.coef[1], 1)}·fast(load²) + '
                                 f'{num(model.coef[2], 1)}·slow(load²) + {num(model.coef[3], 2)}·ambient',
                      'fittedOn': f'{len(model.peers)} other transformers, {ts[0]}–{ts[now]}'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 10. Reactive reserve nearly gone while MW looks fine — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class ReactiveReserveLow(Detector):
    id = 'grid.reactive_reserve_low'
    name = 'Reactive reserve nearly gone behind comfortable MW'
    archetype = '08 Throughput illusion'
    applies_to = 'bulk substations'
    summary = ('A station\'s reactive reserve falls to less than half the operating target while its MW loadings and '
               'post-contingency loadings look comfortable: the headline numbers are fine, the voltage support behind '
               'them is almost used up.')
    pipeline = [
        ('Reserve', 'the station\'s reactive reserve against this utility\'s operating target (not a standard)'),
        ('Headline', 'MW loading of every line and transformer bay at the station, and its worst post-contingency loading'),
        ('Where it went', 'shunt banks anywhere that lost output in the scan the reserve first stepped, and the station\'s own '
                          'switchable reactive plant'),
        ('Checks', 'reserve low · MW comfortable · a source lost elsewhere · own reactor committed · other stations down too'),
        ('Conclusion', 'a reserve problem hidden behind normal MW; confidence from the lost source'),
    ]
    definition = {
        'appliesTo': {'assetType': 'bulk_substation', 'with': 'mvar_reserve_mvar'},
        'inputs': {'reserve': 'self.mvar_reserve_mvar', 'worst': 'self.worst_post_ctg_loading_pct',
                   'loading': 'children[line and transformer bays].loading_pct',
                   'banks': 'every shunt_cap_bank.cap_bank_mvar', 'own': 'children[reactor_bay | capacitor_bay].reactive_available_mvar'},
        'params': {'target_mvar': 120.0, 'alert_mvar': 60.0, 'sustain_min': 15, 'mw_ok_pct': 80.0, 'ctg_ok_pct': 95.0,
                   'step_mvar': 25.0, 'bank_drop_mvar': 20.0, 'own_drop_mvar': 20.0},
        'checks': [
            {'id': 'low', 'role': 'required', 'rule': 'reserve < alert_mvar (half the target) for sustain_min'},
            {'id': 'headline', 'role': 'required', 'rule': 'every bay loading < mw_ok_pct and worst post-contingency < ctg_ok_pct'},
            {'id': 'lost', 'role': 'supporting', 'independent': True,
             'rule': 'a shunt bank lost > bank_drop_mvar in the scan the reserve first stepped > step_mvar'},
            {'id': 'own', 'role': 'supporting', 'rule': 'the station\'s own switchable reactive fell > own_drop_mvar'},
            {'id': 'wide', 'role': 'supporting', 'rule': 'another station\'s reserve stepped in the same scan'},
        ],
        'ruleOut': ['a metering error', 'a MW problem', 'low voltage now'],
        'confidence': {'medium': 'the lost source is measured separately', 'high': 'reserve recovers when the source returns'},
        'references': ['textbook: reserve eroding before voltage trouble', 'variant: generator at its reactive limit',
                       'look-alike: planned reactor switching'],
    }

    def candidates(self, pack):
        return [a for a in pack.of_type('bulk_substation') if pack.has(a, 'mvar_reserve_mvar')]

    def _bays(self, pack, aid):
        return [b for b in pack.children.get(aid, []) if pack.has(b, 'loading_pct')]

    def evaluate(self, pack, aid):
        p = self.p
        rv = pack.series(aid, 'mvar_reserve_mvar')
        w = pack.series(aid, 'worst_post_ctg_loading_pct')
        bays = self._bays(pack, aid)
        low = B.lt(rv, p['alert_mvar'])
        for i in range(1, pack.n):
            s0 = B.sustained_since(low, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if w[i] >= p['ctg_ok_pct'] or any(pack.series(b, 'loading_pct')[i] >= p['mw_ok_pct'] for b in bays):
                continue
            return Finding(aid, True, i, rv=rv, w=w, bays=bays, alert=s0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        rv, w, bays, alert = c['rv'], c['w'], c['bays'], c['alert']
        name = pack.name(aid)
        # first big step in the reserve
        step_i = next((k for k in range(2, pack.n) if rv[k - 2] - rv[k] > p['step_mvar']), None)
        s1 = None
        if step_i is not None:
            s1 = max((step_i - 1, step_i), key=lambda k: rv[k - 1] - rv[k])
        lost = []
        for bank in pack.of_type('shunt_cap_bank'):
            q = pack.series(bank, 'cap_bank_mvar')
            if s1 is not None and max(q[k - 1] - q[k] for k in range(max(1, s1 - 1), min(pack.n, s1 + 2))) > p['bank_drop_mvar']:
                lost.append(bank)
        lost_ok = bool(lost)
        own = [b for b in pack.children.get(aid, []) if pack.has(b, 'reactive_available_mvar')]
        own_drop = [(b, pack.series(b, 'reactive_available_mvar')) for b in own]
        own_drop = [(b, v) for b, v in own_drop if max(v[:alert + 1]) - v[now] > p['own_drop_mvar']]
        own_ok = bool(own_drop)
        own_i = None
        if own_ok:
            v = own_drop[0][1]
            own_i = next(k for k in range(1, pack.n) if v[k - 1] - v[k] > 5)
        wide = []
        for s in self.candidates(pack):
            if s == aid or s1 is None:
                continue
            r2 = pack.series(s, 'mvar_reserve_mvar')
            if r2[max(0, s1 - 1)] - r2[min(pack.now, s1 + 3)] > p['step_mvar']:
                wide.append((s, r2))
        wide_ok = bool(wide)
        loads = {b: pack.series(b, 'loading_pct')[now] for b in bays}
        top = max(loads, key=lambda b: loads[b])
        top_name = element_name(pack, top)
        bus = next((b for b in buses_of_station(pack, aid) if pack.name(b).startswith('345')), buses_of_station(pack, aid)[0])
        vb = pack.series(bus, 'bus_voltage_pu')
        level = 'medium' if lost_ok else 'low'
        y_r = dom(rv, [0, p['target_mvar'] + 20], floor=0)
        lname = plant_name(pack, lost[0]) if lost_ok else None
        headline = [b for b in bays if pack.asset(b)['assetType'] in LINE_BAYS]

        checks = [
            check('low', 'Reserve below half the operating target', 'required', MATCH,
                  f'{num(rv[now], 1)} MVAr now, {num(rv[0], 1)} MVAr at {ts[0]}. Under {num(p["alert_mvar"], 0)} MVAr since '
                  f'{ts[alert]}; the operating target is {num(p["target_mvar"], 0)} MVAr.',
                  'Reactive reserve is the MVAr the station can still add to hold voltage after the next contingency. The '
                  'target is this utility\'s own; no published real-time number exists.',
                  spark(rv, y_r, threshold_value=p['alert_mvar'])),
            check('headline', 'MW flows look comfortable', 'required', MATCH,
                  f'Highest loading at {name}: {top_name} at {num(loads[top], 0)} % of normal rating; worst post-contingency '
                  f'loading {num(w[now], 1)} %.',
                  'Nothing on the MW display suggests a problem. That is the illusion: flows and voltage support are '
                  'separate limits.',
                  spark(w, [0, 110], threshold_value=p['ctg_ok_pct'])),
            check('lost', 'A reactive source was lost elsewhere', 'supporting', MATCH if lost_ok else NO_MATCH,
                  (f'The reserve fell {num(rv[s1 - 1] - rv[s1], 1)} MVAr at {ts[s1]}, the same scan {lname} went from '
                   f'{num(pack.series(lost[0], "cap_bank_mvar")[s1 - 1], 1)} to '
                   f'{num(pack.series(lost[0], "cap_bank_mvar")[s1], 1)} MVAr.') if lost_ok else
                  'No shunt bank changed when the reserve first stepped.',
                  'A separate measurement at a different station. The network\'s reserve is shared: support lost anywhere '
                  'is reserve used up everywhere.',
                  spark(pack.series(lost[0], 'cap_bank_mvar'), [0, 60]) if lost_ok else None),
            check('own', 'Its own reactive plant is committed', 'supporting', MATCH if own_ok else NO_MATCH,
                  (f'{plant_name(pack, own_drop[0][0])}: switchable reactive available '
                   f'{num(max(own_drop[0][1][:alert + 1]), 1)} → {num(own_drop[0][1][now], 1)} MVAr from {ts[own_i]}.')
                  if own_ok else 'No change in the station\'s own switchable reactive plant.',
                  'Once the station\'s own plant is committed to holding voltage, there is little left to switch in after '
                  'a contingency.',
                  spark(own_drop[0][1], [0, 60]) if own_ok else None),
            check('wide', 'Other stations lost reserve at the same moment', 'supporting', MATCH if wide_ok else NO_MATCH,
                  join_names(f'{pack.name(s)} {num(r2[s1 - 1], 0)} → {num(r2[now], 0)} MVAr' for s, r2 in wide) + '.'
                  if wide_ok else 'No other station stepped at the same time.',
                  'A metering fault would hit one station. A lost source shows up across the network.',
                  spark(wide[0][1], y_r, threshold_value=p['target_mvar']) if wide_ok else None),
        ]
        main = chart('MVAr', y_r,
                     [series(s, f'{pack.name(s)} reserve', r2, 'peer', 1) for s, r2 in wide] +
                     [series('reserve', f'{name} reactive reserve', rv, 'primary', 1)],
                     title='What we see',
                     caption=f'Reactive reserve at {name}' + (' and ' + join_names(pack.name(s) for s, _ in wide) if wide else '')
                             + '. The MW flows at the same stations stayed well inside their ratings.',
                     thresholds=[threshold(p['target_mvar'], 'Operating target'), threshold(p['alert_mvar'], 'Alert (half)')],
                     markers=([marker(ts[s1], f'{lname} out')] if lost_ok else []) +
                             ([marker(ts[own_i], 'Reactor committed')] if own_ok else []))

        grid = hours_grid(5, 0.25)
        r = Rng(1010)
        base_i = s1 - 1 if s1 else 0
        lr = aligned(rv, base_i, pack.step_min, grid)
        r0 = rv[base_i]

        def erode(h):
            if h <= 0:
                return r0
            return r0 - 55 - 75 * min(1.0, max(0.0, (h - 1.5) / 0.5))
        tb = [erode(h) + r.gauss(1.5) for h in grid]
        gl = [r0 - (0 if h <= 0 else min(90, 30 * h)) + r.gauss(1.5) for h in grid]
        sw = [r0 - (50 if 0.5 <= h < 0.75 else 0) + r.gauss(1.5) for h in grid]
        live = f'{name}, today'
        th = [threshold(p['target_mvar'], 'Target')]

        def one(a):
            return [ref_chart('Reactive reserve', 'MVAr', dom(a, lr, [0], floor=0), grid, 'h', a, lr, live, 0, th)]
        refs = [
            reference('erode', 'textbook', 'Textbook', 'Reserve eroding while MW looks normal',
                      'A source trips and takes a slice of reserve; later the station\'s own plant is committed to hold '
                      'voltage on the load ramp. Voltage still looks fine, because the reserve is what\'s holding it there.',
                      'match', 'Closest match', ['A step, then a second slide as local plant is used', 'MW normal throughout'],
                      one(tb)),
            reference('genlim', 'variant', 'Variant', 'A generator reaches its reactive limit',
                      'The same erosion without a step: a nearby unit slides to its over-excitation limit as load rises.',
                      'nomatch', 'Same symptom, different source', ['Here the first loss was a step in one scan'], one(gl)),
            reference('switch', 'lookalike', 'Look-alike', 'Planned reactor or capacitor switching',
                      'Reserve dips for a few minutes while plant is switched, then comes back.', 'nomatch', 'Doesn\'t match',
                      [f'Here it has stayed low for {dur(pack.minutes_between(alert, now))}'], one(sw)),
        ]
        ro = [
            ruled_out('A metering error', 'ruled out' if (lost_ok or wide_ok) else 'not yet checked',
                      'The first drop matches a shunt bank that went to zero at another station, and other stations\' '
                      'reserve fell at the same moment.' if lost_ok and wide_ok else 'A separate source confirms the drop.'),
            ruled_out('A MW problem', 'ruled out',
                      f'Every line and transformer at {name} is under {num(p["mw_ok_pct"], 0)} % of normal rating and the '
                      f'worst post-contingency loading is {num(w[now], 0)} %.'),
            ruled_out('Low voltage now', 'ruled out',
                      f'{bus_name(pack, bus)} is at {num(vb[now], 3)} pu. The reserve is what is holding it there; the risk is '
                      'the next contingency, not the present.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     (f'{name}\'s reactive reserve went to replace {lname}, then into holding voltage on the '
                                      f'load ramp' if lost_ok else f'{name}\'s reactive reserve is nearly used up'), level,
                                     'The lost bank is measured separately' if lost_ok else 'Reserve figure only'),
            **({'rootCauseAssetId': lost[0]} if lost_ok else {}),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The reserve stepped in the same scan a capacitor bank at another station went to zero, '
                                     'other stations lost reserve at the same moment, and the station\'s own reactor then '
                                     'became committed.' if lost_ok else 'The reserve figure is low; its cause isn\'t measured.',
                                     'The reserve is a derived figure, and the target is this utility\'s own. It hasn\'t '
                                     'been tested by returning the bank.',
                                     'The reserve comes back by about the bank\'s rating when it returns to service.',
                                     'A voltage-stability study shows enough margin at this reserve. Then the target is '
                                     'conservative for today.'),
            'action': action(item, pack),
            'impact': f'{num(rv[now], 0)} MVAr against a {num(p["target_mvar"], 0)} MVAr target, with the evening peak still '
                      f'ahead. The next contingency starts with most of the voltage support already spent.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 11. Voltage distortion drifting toward the limit — archetype 13 (quality drift)
# ═════════════════════════════════════════════════════════════════════════
class VoltageThdDrift(Detector):
    id = 'grid.voltage_thd_drift'
    name = 'Voltage distortion drifting toward the limit'
    archetype = '13 Quality drift'
    applies_to = 'bus sections'
    summary = ('A bus\'s voltage THD climbing steadily from its own normal, faster than at any neighbouring bus, with '
               'the RMS voltage normal: a harmonic source is growing on or below this bus, and the limit is ahead.')
    pipeline = [
        ('Baseline', 'each bus\'s own THD over the first hour'),
        ('Trend', 'THD above baseline and its slope over two hours; projected time to the limit'),
        ('Gradient', 'the rise here against the buses one circuit away and the higher-voltage bus at the same station'),
        ('Checks', 'above normal · rising · sustained · negative sequence up · strongest here · voltage normal'),
        ('Conclusion', 'a growing harmonic source at or below this bus, before the limit is crossed'),
    ]
    definition = {
        'appliesTo': {'assetType': 'bus_section'},
        'inputs': {'thd': 'self.bus_voltage_thd_pct', 'nsv': 'self.neg_seq_voltage_pct', 'v': 'self.bus_voltage_pu',
                   'neighbours': 'buses at the far end of this bus\'s circuits, and the other bus at the same station'},
        'params': {'baseline_min': 60, 'rise_pts': 0.6, 'ratio': 1.5, 'sustain_min': 60, 'slope_window_min': 120,
                   'min_slope_pts_h': 0.1, 'limit_pct': 2.5, 'nsv_rise_pts': 0.15, 'v_lo_pu': 0.95, 'v_hi_pu': 1.05},
        'checks': [
            {'id': 'rise', 'role': 'required', 'rule': 'thd − baseline > rise_pts and thd > ratio × baseline'},
            {'id': 'trend', 'role': 'required', 'rule': 'slope(thd, slope_window_min) > min_slope_pts_h'},
            {'id': 'sustained', 'role': 'required', 'rule': 'rise held for sustain_min'},
            {'id': 'nsv', 'role': 'supporting', 'independent': True, 'rule': 'negative-sequence voltage up > nsv_rise_pts'},
            {'id': 'gradient', 'role': 'supporting', 'rule': 'every neighbouring bus rose less'},
            {'id': 'voltage', 'role': 'supporting', 'rule': 'RMS voltage within v_lo_pu–v_hi_pu'},
        ],
        'ruleOut': ['background distortion from the transmission system', 'a meter problem', 'capacitor resonance', 'load growth alone'],
        'confidence': {'medium': 'negative-sequence voltage agrees', 'high': 'the source is found (a site survey)'},
        'references': ['textbook: a nonlinear load growing', 'variant: harmonic filter out of service',
                       'look-alike: resonance after capacitor switching'],
    }

    def candidates(self, pack):
        return pack.of_type('bus_section')

    def _neighbours(self, pack, aid):
        st = station(pack, aid)
        out = [b for b in buses_of_station(pack, st) if b != aid]
        for b in pack.children.get(st, []):
            if pack.asset(b)['assetType'] in LINE_BAYS and bay_bus(pack, b) == aid:
                rem, _ = circuit(pack, b)
                rb = bay_bus(pack, rem) if rem else None
                if rb and rb not in out:
                    out.append(rb)
        return out

    def evaluate(self, pack, aid):
        p = self.p
        thd = pack.series(aid, 'bus_voltage_thd_pct')
        nb = pack.steps(p['baseline_min'])
        base = B.mean(thd[:nb])
        up = [v - base > p['rise_pts'] and v > p['ratio'] * base for v in thd]
        sw = pack.steps(p['slope_window_min'])
        for i in range(nb, pack.n):
            s0 = B.sustained_since(up, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(thd, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_pts_h']:
                return Finding(aid, True, i, thd=thd, base=base, nb=nb, alert=s0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        thd, base, nb, alert = c['thd'], c['base'], c['nb'], c['alert']
        here = bus_name(pack, aid)
        sd = max(0.02, B.stdev(thd[:nb]))
        sm = B.rolling_mean(thd, 3)
        onset = next(k for k in range(nb, pack.n) if all(x > base + 2 * sd for x in sm[k:alert + 1]))
        slope = B.slope_per_hour(thd, now, pack.steps(p['slope_window_min']), pack.step_min)
        rise = B.mean(thd[now - 2:now + 1]) - base
        eta = (p['limit_pct'] - thd[now]) / slope * 60 if slope and slope > 0 and thd[now] < p['limit_pct'] else None
        nsv = pack.series(aid, 'neg_seq_voltage_pct')
        nsv_base = B.mean(nsv[:nb])
        nsv_rise = B.mean(nsv[now - 2:now + 1]) - nsv_base
        nsv_ok = nsv_rise > p['nsv_rise_pts']
        nbrs = self._neighbours(pack, aid)
        n_rise = {b: B.mean(pack.series(b, 'bus_voltage_thd_pct')[now - 2:now + 1]) -
                  B.mean(pack.series(b, 'bus_voltage_thd_pct')[:nb]) for b in nbrs}
        grad_ok = all(v < rise for v in n_rise.values())
        v = pack.series(aid, 'bus_voltage_pu')
        v_ok = all(p['v_lo_pu'] <= x <= p['v_hi_pu'] for x in v)
        st = station(pack, aid)
        xfb = xfmr_bays_of(pack, st)
        xf = pack.child_of_type(xfb[0], 'power_transformer') or pack.child_of_type(xfb[0], 'autotransformer') if xfb else None
        xload = pack.series(xf, 'xfmr_loading_pct') if xf else None
        level = 'medium' if nsv_ok else 'low'
        y_t = dom(thd, [p['limit_pct']], [0], floor=0)
        rel = [x - base for x in thd]
        n_rel = {b: [x - B.mean(pack.series(b, 'bus_voltage_thd_pct')[:nb]) for x in pack.series(b, 'bus_voltage_thd_pct')]
                 for b in nbrs}
        hv = [b for b in nbrs if station(pack, b) == st]
        remote = [b for b in nbrs if b not in hv]

        checks = [
            check('rise', 'Distortion well above its normal', 'required', MATCH,
                  f'THD {num(thd[now], 2)} % now against {num(base, 2)} % in the first hour ({signed(rise, 2)} points).',
                  'Voltage distortion comes from harmonic currents drawn by nonlinear loads (drives, rectifiers, arc '
                  'furnaces) flowing through the network impedance.',
                  spark(thd, y_t, threshold_value=p['limit_pct'])),
            check('trend', 'Still rising', 'required', MATCH,
                  f'{signed(slope, 2)} points per hour over the last {dur(p["slope_window_min"])}; rising since about '
                  f'{ts[onset]}.',
                  'A source that is growing, not a one-off switching event.',
                  spark(thd, y_t, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Held for hours', 'required', MATCH,
                  f'More than {num(p["rise_pts"], 1)} points above normal since {ts[alert]}.',
                  f'Needs {dur(p["sustain_min"])}, so a short burst from one load starting doesn\'t raise it.',
                  spark(rel, dom(rel, [0, p['rise_pts']]), threshold_value=p['rise_pts'], highlight=[ts[alert], ts[now]])),
            check('nsv', 'Negative-sequence voltage rising too', 'supporting', MATCH if nsv_ok else NO_MATCH,
                  f'{num(nsv_base, 2)} % in the first hour, {num(nsv[now], 2)} % now.',
                  'A separate power-quality quantity. Large single-phase or unbalanced nonlinear loads raise both.',
                  spark(nsv, dom(nsv, [0]))),
            check('gradient', 'Strongest here', 'supporting', MATCH if grad_ok else NO_MATCH,
                  f'Rise since the first hour: {here} {signed(rise, 2)}, ' +
                  ', '.join(f'{bus_name(pack, b)} {signed(n_rise[b], 2)}' for b in nbrs) + ' points.',
                  'Distortion is worst nearest its source and weaker one circuit away. The bus above it at the same '
                  'station staying flat puts the source below this bus, not on the transmission system.',
                  spark(rel, dom(rel, *n_rel.values()))),
            check('voltage', 'RMS voltage normal', 'supporting', MATCH if v_ok else NO_MATCH,
                  f'{num(min(v), 3)}–{num(max(v), 3)} pu all day.',
                  'This is a waveform-quality problem, not a voltage-level problem; the voltage display shows nothing.',
                  spark(v, dom(v, [p['v_lo_pu'] + 0.03]))),
        ]
        main = chart('%', y_t,
                     [series(b, bus_name(pack, b), pack.series(b, 'bus_voltage_thd_pct'), 'peer', 2) for b in nbrs] +
                     [series('thd', f'{here} voltage THD', thd, 'primary', 2),
                      series('expected', 'Its own first-hour level', [base] * pack.n, 'expected', 2)],
                     title='What we see',
                     caption=f'Voltage THD at {here} and at the buses around it. The limit line is the conservative reading '
                             f'for this voltage class (see the rise check).',
                     shade_gap=['thd', 'expected'],
                     thresholds=[threshold(p['limit_pct'], 'Limit (IEEE 519)')],
                     markers=[marker(ts[onset], 'Rise begins')], decimals=2)
        checks[0]['why'] += (f' The limit used here, {num(p["limit_pct"], 1)} %, is IEEE 519\'s value for 69–161 kV buses; '
                             f'the standard puts a bus at exactly 69 kV in its 5 % class, so {num(p["limit_pct"], 1)} % is the '
                             'conservative reading.') if pack.name(aid).startswith('69') else ''

        h_live = pack.minutes_between(onset, now) / 60
        grid = hours_grid(max(6, round(h_live + 1)), 0.25)
        r = Rng(1111)
        lt = aligned(rel, onset, pack.step_min, grid)
        tb = [(0 if h <= 0 else 0.22 * h) + r.gauss(0.03) for h in grid]
        fl = [(0 if h < 1 else 0.9) + r.gauss(0.03) for h in grid]
        rs = [(0 if h < 1 or h > 1.75 else 1.4) + r.gauss(0.03) for h in grid]
        live = f'{here}, today'

        def one(a):
            return [ref_chart('THD above its normal', 'pts', dom(a, lt, [0], pad=0.05), grid, 'h', a, lt, live, 2)]
        refs = [
            reference('load', 'textbook', 'Textbook', 'A nonlinear load growing on the feeder',
                      'A customer\'s drives or rectifiers ramp up with their production. Distortion climbs steadily through '
                      'the day, strongest at the nearest bus.',
                      'match', 'Closest match', ['Steady climb, strongest here', 'Rising with the day, as here'], one(tb)),
            reference('filter', 'variant', 'Variant', 'A harmonic filter taken out of service',
                      'A customer\'s or the utility\'s filter bank trips or is switched out. THD steps up in one scan and '
                      'holds.', 'nomatch', 'Doesn\'t match', ['Here the rise was gradual'], one(fl)),
            reference('resonance', 'lookalike', 'Look-alike', 'Resonance after capacitor switching',
                      'Switching a capacitor bank tunes the network near a harmonic; THD jumps while it is in, and drops when '
                      'it comes out.', 'nomatch', 'Doesn\'t match', ['No capacitor switching here today', 'Here it ramped'],
                      one(rs)),
        ]
        ro = [
            ruled_out('Background distortion from the transmission system', 'ruled out' if hv else 'not yet checked',
                      (f'{join_names(bus_name(pack, b) for b in hv)} at the same station moved '
                       f'{join_names(signed(n_rise[b], 2) for b in hv)} points.') if hv else 'No higher-voltage bus here.'),
            ruled_out('A meter problem', 'unlikely',
                      (f'{join_names(bus_name(pack, b) for b in remote)} rose too, by less ('
                       f'{join_names(signed(n_rise[b], 2) for b in remote)} points), and negative-sequence voltage moved here. '
                       'One meter can\'t make its neighbours drift.') if remote else 'Negative-sequence voltage moved with it.'),
            ruled_out('Capacitor resonance', 'unlikely',
                      'Resonance switches in and out with the bank. This rose smoothly over hours, and there is no shunt '
                      'bank at this station.'),
            ruled_out('Load growth alone', 'unlikely',
                      (f'The station transformer\'s loading moved {num(xload[0], 0)} → {num(xload[now], 0)} % while THD '
                       f'rose {num(thd[now] / base, 1)}×. Ordinary load doesn\'t add distortion in proportion.') if xload
                      else 'THD rose far faster than load.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'A growing harmonic source at or below {here}, still under the limit', level,
                                     'Negative-sequence voltage agrees' if nsv_ok else 'Distortion only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Distortion is rising steadily, strongest at this bus and weaker one circuit away, with '
                                     'negative-sequence voltage rising alongside.',
                                     'The source is inferred from the gradient; nobody has surveyed the customers on this bus.',
                                     'A power-quality survey finds the load, or the rise follows a customer\'s production pattern.',
                                     'A second meter on the bus reads normal. Then check this one.'),
            'action': action(item, pack),
            'impact': (f'At {signed(slope, 2)} points per hour it reaches {num(p["limit_pct"], 1)} % at about '
                       f'{hhmm(tmin(ts[now]) + eta)}, around the evening peak.') if eta else
                      f'Already at or past {num(p["limit_pct"], 1)} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 12. Planned clearance can't be taken today — archetype 14 (plan at risk)
# ═════════════════════════════════════════════════════════════════════════
class ClearanceAtRisk(Detector):
    id = 'grid.clearance_at_risk'
    name = 'Planned clearance not safe to take today'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'districts'
    summary = ('A clearance planned for today in a district whose worst post-contingency loading has no margin left, with '
               'an element already out: taking one more element out would leave the next contingency uncovered.')
    pipeline = [
        ('Plan', 'open planned work items in the district whose title is a clearance or outage, due today'),
        ('Margin', 'the district\'s worst N-1 post-contingency loading against the 95 % advisory level'),
        ('Network state', 'circuits in the district that were carrying load and are now dead'),
        ('Checks', 'clearance planned · no margin · element already out · rising with the load · the element itself loaded'),
        ('Conclusion', 'defer the clearance until the network is intact; this is a planning call, not a diagnosis'),
    ]
    definition = {
        'appliesTo': {'assetType': list(DISTRICTS)},
        'inputs': {'worst': 'self.worst_post_ctg_loading_pct', 'work': 'work-items (planned, open, title names a clearance or outage)',
                   'element': 'the work item\'s asset.post_ctg_loading_pct', 'circuits': 'line bays in the district'},
        'params': {'advisory_pct': 95.0, 'sol_pct': 100.0, 'lead_h': 3, 'dead_mw': 1.0, 'min_before_mw': 10.0,
                   'clearance_words': ['clearance', 'outage']},
        'checks': [
            {'id': 'planned', 'role': 'required', 'rule': 'an open planned clearance on an element in the district, starting within lead_h'},
            {'id': 'margin', 'role': 'required', 'rule': 'worst post-contingency loading ≥ advisory_pct'},
            {'id': 'out', 'role': 'supporting', 'rule': 'a circuit in the district that carried > min_before_mw is dead now'},
            {'id': 'rising', 'role': 'supporting', 'rule': 'worst post-contingency loading rising over the last hour'},
            {'id': 'element', 'role': 'supporting', 'rule': 'the element to be cleared is itself above advisory_pct - 5'},
        ],
        'confidence': {'n/a': 'a planning deadline, not a diagnosis'},
        'references': ['textbook: taken with the network intact', 'variant: taken with a circuit already out',
                       'look-alike: tight margin that eases after the peak'],
    }

    def candidates(self, pack):
        return pack.of_type(*DISTRICTS)

    def _clearances(self, pack, aid):
        members = set(pack.descendants(aid))
        out = []
        for w in pack.work:
            if w['sourceType'] != 'planned' or w.get('done') or w['assetId'] not in members:
                continue
            txt = (w.get('text') or '').lower()
            if any(x in txt for x in self.p['clearance_words']):
                out.append(w)
        return out

    def evaluate(self, pack, aid):
        p = self.p
        cl = self._clearances(pack, aid)
        if not cl:
            return Finding(aid, False)
        w = pack.series(aid, 'worst_post_ctg_loading_pct')
        for i in range(pack.n):
            for x in cl:
                start = tmin(w_time(x['plannedStart']))
                if tmin(pack.ts[i]) < start - p['lead_h'] * 60:
                    continue
                if w[i] >= p['advisory_pct']:
                    return Finding(aid, True, i, w=w, clr=x)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        w, clr = c['w'], c['clr']
        name = pack.name(aid)
        el = clr['assetId']
        el_name = element_name(pack, el)
        el_ctg = pack.series(el, 'post_ctg_loading_pct') if pack.has(el, 'post_ctg_loading_pct') else None
        el_ok = el_ctg is not None and el_ctg[now] > p['advisory_pct'] - 5
        members = pack.descendants(aid)
        out = []
        for b in members:
            if pack.asset(b)['assetType'] in LINE_BAYS:
                fl = mw(pack, b)
                if fl and max(abs(x) for x in fl) > p['min_before_mw'] and abs(fl[now]) < p['dead_mw']:
                    out.append(b)
        seen, out_c = set(), []
        for b in out:
            key = self._key(pack, b)
            if key not in seen:
                seen.add(key)
                out_c.append(b)
        out_ok = bool(out_c)
        out_since = None
        if out_ok:
            fl = mw(pack, out_c[0])
            out_since = next(k for k in range(1, pack.n) if abs(fl[k]) < p['dead_mw'] <= abs(fl[k - 1]))
        slope = B.slope_per_hour(w, now, pack.steps(60), pack.step_min)
        rising_ok = slope is not None and slope > 0.5
        eta = (p['sol_pct'] - w[now]) / slope * 60 if rising_ok and w[now] < p['sol_pct'] else None
        above = B.gt(w, p['advisory_pct'])
        start_i = on_grid_at_or_after(pack, w_time(clr['plannedStart']))
        due = w_time(clr['dueAt'])
        worst_st = max((s for s in pack.descendants(aid) if pack.asset(s)['assetType'] in SUBSTATIONS),
                       key=lambda s: pack.series(s, 'worst_post_ctg_loading_pct')[now])
        y_w = dom(w, [p['sol_pct'] + 5], pad=0.05, floor=0)

        checks = [
            check('planned', 'A clearance is planned today', 'required', MATCH,
                  f'{clr["text"]} ({clr["id"]}): planned from {w_time(clr["plannedStart"])}, due {due}, '
                  f'{clr["assignedRole"].lower()}.',
                  'A clearance takes the element out of service for the work. The rest of the network must be able to '
                  'lose one more element while it is out.',
                  None),
            check('margin', 'No post-contingency margin in the district', 'required', MATCH,
                  f'{name}\'s worst post-contingency loading {num(w[now], 1)} % now, at {pack.name(worst_st)}; at or above '
                  f'{num(p["advisory_pct"], 0)} % for {dur(pack.minutes_between(B.sustained_since(above, now) or now, now))}.'
                  if above[now] else f'{name}\'s worst post-contingency loading reached {num(max(w), 1)} % today.',
                  'Above 95 % there is no margin left inside the emergency rating. Taking an element out for work makes '
                  'the next contingency a double contingency the study doesn\'t cover.',
                  spark(w, y_w, threshold_value=p['advisory_pct'])),
            check('out', 'The network isn\'t intact', 'supporting', MATCH if out_ok else NO_MATCH,
                  (join_names(circuit_name(pack, b) for b in out_c) + f' out since {ts[out_since]}.') if out_ok
                  else 'Every circuit in the district is in service.',
                  'With a circuit already out, the district has used its N-1; a clearance on top of it is N-2.',
                  spark(mw(pack, out_c[0]), dom(mw(pack, out_c[0]), [0], pad=0.1)) if out_ok else None),
            check('rising', 'Still rising with the load', 'supporting', MATCH if rising_ok else NO_MATCH,
                  f'{signed(slope, 1)} points per hour over the last hour' +
                  (f'; {num(p["sol_pct"], 0)} % at about {hhmm(tmin(ts[now]) + eta)} at this rate.' if eta else '.'),
                  'The evening peak is still ahead, so the margin gets smaller, not bigger, through the afternoon.',
                  spark(w, y_w, window=win(pack, now - 24, now))),
            check('element', 'The element itself is heavily loaded', 'supporting', MATCH if el_ok else NO_MATCH,
                  f'{el_name} worst post-contingency loading {num(el_ctg[now], 1)} % now.' if el_ctg else
                  f'No post-contingency figure for {el_name}.',
                  'Its own load would have to go somewhere while it\'s out, onto elements with no margin either.',
                  spark(el_ctg, y_w, threshold_value=p['advisory_pct']) if el_ctg else None),
        ]
        main = chart('%', y_w,
                     ([series('el', f'{el_name} post-contingency', el_ctg, 'peer', 1)] if el_ctg else []) +
                     [series('worst', f'{name} worst post-contingency loading', w, 'primary', 1)],
                     title='What we see',
                     caption=f'{name}\'s worst N-1 post-contingency loading today, and the element the clearance would take '
                             f'out. The clearance was planned to start at {w_time(clr["plannedStart"])}.',
                     thresholds=[threshold(p['sol_pct'], 'Emergency rating'), threshold(p['advisory_pct'], 'Advisory')],
                     markers=([marker(ts[out_since], 'Circuit out')] if out_ok else []) +
                             ([marker(ts[start_i], 'Clearance planned')] if start_i < pack.n else []))

        grid = hours_grid(8, 0.25, -2)
        r = Rng(1212)
        lw = aligned(w, start_i, pack.step_min, grid)
        base = w[0]
        intact = [min(80, base + 3 * (h + 6)) + r.gauss(0.4) for h in grid]
        outc = [w[start_i] + 3 * h + (12 if h >= 0 else 0) + r.gauss(0.4) for h in grid]
        ease = [w[start_i] + (2.5 * h if h < 3 else 7.5 - 4 * (h - 3)) + r.gauss(0.4) for h in grid]
        live = f'{name}, today'
        th = [threshold(p['sol_pct'], 'Emergency rating'), threshold(p['advisory_pct'], 'Advisory')]

        def one(a):
            return [ref_chart('Worst post-contingency loading (hours from planned start)', '%', dom(a, lw, [p['sol_pct']], pad=0.05),
                              grid, 'h', a, lw, live, 1, th)]
        refs = [
            reference('intact', 'textbook', 'Textbook', 'Clearance taken with the network intact',
                      'Every circuit in service and the worst post-contingency loading well under 95 %. The element comes out, '
                      'the study still passes, and the work goes ahead.',
                      'nomatch', 'Not today', [f'Today {name} is at {num(w[now], 0)} %',
                                               'Saturday, with the circuit back, looks like this'], one(intact)),
            reference('taken', 'variant', 'What to avoid', 'Taken anyway with a circuit already out',
                      'The element comes out on top of an existing outage; the post-contingency loading jumps and the next '
                      'contingency would overload something. The work has to be stopped or a load-shed plan prepared.',
                      'nomatch', 'Avoid', ['That is today\'s situation if the clearance goes ahead'], one(outc)),
            reference('ease', 'lookalike', 'Look-alike', 'Tight margin that eases after the peak',
                      'Margin is tight at midday but the load falls away in the evening, so the clearance can move to late '
                      'evening instead of another day.',
                      'nomatch', 'Not today', ['Today the peak is still ahead and a circuit is out'], one(ease)),
        ]
        return {
            'conclusion': conclusion('What\'s needed',
                                     f'Defer the {el_name} clearance until the network is intact and the margin is back',
                                     'n/a', 'A planning call from the network state, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': [], 'excluded': None,
            'confidence': confidence('n/a', 'This is a planning decision read straight from the contingency results and the '
                                            'work list, not something the data had to diagnose. The study with the element '
                                            'out isn\'t in the published data, so it isn\'t recomputed here.'),
            'action': action(item, pack, extra=[clr['id']]),
            'impact': (f'{name} is at {num(w[now], 1)} % now, the clearance package is due at {due}, and the evening '
                       f'peak comes after that. A study with {el_name} out, run on today\'s network, should back the deferral '
                       f'in the switching log.'),
        }

    def _key(self, pack, b):
        rem, _ = circuit(pack, b)
        return tuple(sorted([b, rem])) if rem else b


DETECTORS = [BushingDeterioration(), DgaThermalGassing(), CvtRatioDrift(), OltcHunting(), LineLockout(),
             PostContingencyExposure(), VoltageSagUpstream(), RecurringMomentaries(), TransformerHotSpot(),
             ReactiveReserveLow(), VoltageThdDrift(), ClearanceAtRisk()]


def main():
    pack, out, report, path = run_pack(REPO, 'grid', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
