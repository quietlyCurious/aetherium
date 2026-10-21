#!/usr/bin/env python3
"""Aurelia & Ferrum (refinery) — detectors and explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every refinery detector on every asset it applies to, using only the
pack's runtime files in public/data/refinery/, and writes
public/data/refinery/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus each
detector's definition and where it fired today.

    python3 ModelAndData/industries/refinery/generate.py    # the data
    python3 ModelAndData/industries/refinery/explain.py     # the explanations

Detectors never read generate.py's scenario constants. If a detector misses
a scenario, or fires where no attention item exists, the run report says so
and the exit code is 1 for a miss.

The process is fictional on purpose (RESEARCH.md): a serial line of stations
with one pace, no store except the Aurelia Buffer, and a handful of
instrument tags. So "expected" here is usually one of three things: the
line's own target rate, the station immediately up- or downstream on the
`process_flow` layer, or the same station type on the eleven other lines.
The vocabulary is manufacturing flow — starvation, blocking, buffer
absorption, micro-stops, changeover, OEE — and nothing else.

Standard library only.
"""
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'ModelAndData', 'tools'))

from detectors import blocks as B                     # noqa: E402
from detectors.build import (Detector, Finding, Rng, MATCH, NO_MATCH, PENDING, aligned, band, chart,  # noqa: E402
                             check, dur, marker, nice_domain, num, reference, ruled_out, run_pack,
                             print_report, series, spark, threshold)
from detectors.build import signed as _signed    # noqa: E402


# ── Small helpers (same shape as ccgt/explain.py) ───────────────────────
def join_names(names):
    if not names:
        return ''
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ' and ' + names[-1]


def work_ids_for(pack, item):
    """The situation-driven jobs this item's recommendation is about: on the item's own
    asset, or anywhere on its line — a downstream restriction is inspected at the station
    that has it, not at the buffer that showed it (SIT04 / wk-010)."""
    aid = item['assetId']
    line = pack.unit_of(aid)
    scope = {aid} | ({line} | set(pack.descendants(line)) if line else set())
    return [w['id'] for w in pack.work if w['sourceType'] == 'situation' and w['assetId'] in scope]


def conclusion(label, text, level, level_text):
    return {'label': label, 'text': text, 'confidence': level, 'confidenceText': level_text}


def confidence(level, because, not_higher=None, raise_if=None, lower_if=None, confirmed_by=None):
    out = {'level': level, 'because': because}
    if not_higher: out['notHigherBecause'] = not_higher
    if raise_if: out['raiseIf'] = raise_if
    if lower_if: out['lowerIf'] = lower_if
    if confirmed_by: out['confirmedBy'] = confirmed_by
    return out


def action(item, pack):
    return {'text': item['detail']['recommendation'], 'workItemIds': work_ids_for(pack, item)}


def hours_grid(h_max, step=0.5, h_min=0.0):
    n = int(round((h_max - h_min) / step))
    return [round(h_min + k * step, 3) for k in range(n + 1)]


def minutes_grid(m_min, m_max, step):
    return list(range(m_min, m_max + 1, step))


def ref_chart(label, unit, y, grid, grid_unit, ref_values, live_values, live_label, decimals=1, thresholds=None):
    return chart(unit, y, [series('ref', 'Reference example', ref_values, 'reference', 3),
                           series('live', live_label, live_values, 'primary', 3)],
                 title=label, x={'unit': grid_unit, 'values': grid}, decimals=decimals, thresholds=thresholds)


def median(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def mean_between(v, i0, i1):
    return B.mean(v[max(0, i0):i1 + 1])


def pearson(a, b):
    pts = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pts) < 3:
        return None
    mx = sum(x for x, _ in pts) / len(pts)
    my = sum(y for _, y in pts) / len(pts)
    sx = math.sqrt(sum((x - mx) ** 2 for x, _ in pts))
    sy = math.sqrt(sum((y - my) ** 2 for x, y in pts))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in pts) / (sx * sy)


def diffs(v):
    return [None] + [None if a is None or b is None else b - a for a, b in zip(v, v[1:])]


def signed(v, decimals=1):          # noqa: F811 — the toolkit's, without a '−0.0'
    return _signed(None if v is None else round(v, decimals) + 0.0, decimals)


def clock(minutes):
    """Minutes from midnight → HH:MM."""
    minutes = int(round(minutes))
    return f'{(minutes // 60) % 24:02d}:{minutes % 60:02d}'


def tmin(ts):
    return int(ts[:2]) * 60 + int(ts[3:5])


def idx_at(pack, iso):
    """Grid index of an ISO timestamp (first grid point at or after it), or None."""
    if not iso:
        return None
    hm = iso[11:16]
    for k, t in enumerate(pack.ts):
        if t >= hm:
            return k
    return None


# ── Refinery shapes ──────────────────────────────────────────────────────
def st(pack, aid):
    """'F2 · Power Charge' — the line plus the station, as the UI labels it."""
    line = pack.unit_of(aid)
    if line is None or line == aid:
        return pack.name(aid)
    return f'{pack.name(line)} · {pack.name(aid)}'


def line_of(pack, aid):
    return pack.unit_of(aid)


def line_state(pack, aid):
    line = pack.unit_of(aid)
    return (pack.unit_status.get(line) or {}).get('state')


def in_changeover(pack, aid):
    return line_state(pack, aid) == 'changeover'


def product_of(pack, aid):
    line = pack.unit_of(aid)
    return (pack.unit_status.get(line) or {}).get('product') or ''


def nxt(pack, aid):
    """The next station down the line on the process_flow layer, or None."""
    t = pack.targets(aid, 'process_flow')
    return t[0] if t else None


def prv(pack, aid):
    s = pack.sources(aid, 'process_flow')
    return s[0] if s else None


def downstream(pack, aid):
    out, x = [], nxt(pack, aid)
    while x:
        out.append(x)
        x = nxt(pack, x)
    return out


def upstream(pack, aid):
    out, x = [], prv(pack, aid)
    while x:
        out.append(x)
        x = prv(pack, x)
    return out


def stations(pack, line):
    """The line's stations in flow order."""
    kids = pack.children.get(line, [])
    head = next((k for k in kids if not pack.sources(k, 'process_flow')), None)
    if head is None:
        return list(kids)
    return [head] + downstream(pack, head)


def target(pack, aid):
    """The line target rate series behind a station."""
    return pack.series(pack.unit_of(aid), 'line_target_rate')


def rate(pack, aid):
    return pack.series(aid, 'throughput_per_min')


def baseline(values, i0, i1):
    """Median of a series over an index range — 'what this tag normally reads'."""
    return median(values[max(0, i0):i1 + 1])


def peers_of(pack, aid):
    return [a for a in pack.of_type(pack.asset(aid)['assetType']) if a != aid]


def peer_median(pack, peers, key):
    """Per-point median across peers (all of them count; stations never stand idle)."""
    out = []
    for k in range(pack.n):
        vals = [pack.series(p, key)[k] for p in peers if pack.has(p, key)]
        out.append(statistics.median(vals) if vals else None)
    return out


def extrema(values, lo, hi):
    """Turning points of values[lo:hi+1] as [(index, value)], ends included."""
    out = [(lo, values[lo])]
    for k in range(lo + 1, hi):
        a, b, c = values[k - 1], values[k], values[k + 1]
        if (b - a) * (c - b) < 0:
            out.append((k, b))
    out.append((hi, values[hi]))
    return out


def episodes(mask, max_gap=0):
    """Runs of True in mask, merging gaps of up to max_gap False points."""
    out = []
    for s, e in B.runs(mask):
        if out and s - out[-1][1] - 1 <= max_gap:
            out[-1] = (out[-1][0], e)
        else:
            out.append((s, e))
    return out


# ── The two attention items that share one asset ─────────────────────────
# build.run_pack attaches the FIRST detector that fired on an asset to every
# attention item on that asset. Refinery is the only pack with two items on
# one asset — SIT05/SIT12 on F2 · Power Charge and SIT02/SIT14 on F4 — so the
# detector that fires first hands the other item over to that item's own
# detector here, and corrects the two fields the runner fills in after
# explain() returns (the detector id and the detection time). The file then
# still records which detector found what, and when.
# ═════════════════════════════════════════════════════════════════════════
# 1. Busy shift, nothing wrong — archetype 02 (busy but normal)
# ═════════════════════════════════════════════════════════════════════════
class BusyShiftConfirmed(Detector):
    id = 'refinery.busy_shift_confirmed'
    explains_items = ('SIT02',)
    name = 'Busy shift with every station inside its band'
    archetype = '02 Busy but normal'
    applies_to = 'lines'
    summary = ('A line that carried a planned product changeover on top of a full production shift and still held its '
               'target rate, with a station-by-station sweep finding nothing outside its normal band. The checks are '
               'what makes the all-clear worth reading.')
    pipeline = [
        ('Busy', 'the line has a planned changeover today: its target rate goes to zero and the unit state says '
                 'changeover, so the shift carried a product change as well as production'),
        ('Production window', 'everything before the target went to zero — the part of the shift that had to make rate'),
        ('Rate held', 'line throughput against the planned target through that whole window'),
        ('Station sweep', 'every station on the line, one at a time: rate band, micro-stops, stress, and the condition '
                          'and quality tags each station type carries'),
        ('Conclusion', 'target held and no station exception → raise a positive confirmation, not an alarm'),
    ]
    definition = {
        'appliesTo': {'assetType': 'line'},
        'inputs': {'throughput': 'self.line_throughput', 'targetRate': 'self.line_target_rate',
                   'state': 'unit-status[line].state', 'stations': 'children in process_flow order',
                   'stationRate': 'station.throughput_per_min', 'stress': 'station.system_stress',
                   'condition': 'power_charge.vibration_mms vs the other chargers; refinement.purity_pct; '
                                'inspection.reject_rate_pct; transfer.blocking_time / starvation_time; '
                                'buffer.buffer_level',
                   'lineKpis': 'self.instability_index, self.line_scrap_rate, self.system_health_index',
                   'work': 'work-items on the line and its stations (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the same station type on the other lines of the same refinery'},
        'expected': {'model': 'planned target', 'target': 'station throughput_per_min',
                     'formula': 'line_target_rate ± band_pct', 'fitOn': 'the production plan, not peers'},
        'params': {'hold_pct': 98.5, 'floor_pct': 97.0, 'smooth_min': 30, 'band_pct': 4.5, 'stop_frac': 0.90,
                   'dip_frac': 0.035, 'dip_events_max': 2, 'stress_max': 28.0, 'instab_max': 1.3,
                   'scrap_max': 1.1, 'health_min': 98.5, 'vib_margin_mms': 0.6, 'vib_slope_mms_per_h': 0.25,
                   'purity_drop_pct': 0.30, 'reject_rise_pct': 1.50, 'hold_up_max': 2.0, 'level_band_pts': 12.0},
        'checks': [
            {'id': 'busy', 'role': 'required', 'rule': 'line_target_rate falls to 0 after running > 0, and unit state is changeover → a planned product change on this line today'},
            {'id': 'rate', 'role': 'required', 'rule': 'mean line_throughput over the production window ≥ hold_pct % of target, and the smooth_min mean never below floor_pct %'},
            {'id': 'sweep', 'role': 'required', 'rule': 'no station exception: 15-min mean rate inside ±band_pct of target, no sample below stop_frac × target, ≤ dip_events_max dip episodes, stress < stress_max, and each station type\'s own condition and quality tags inside band'},
            {'id': 'kpis', 'role': 'required', 'rule': 'instability < instab_max, scrap < scrap_max and health > health_min right through the production window'},
            {'id': 'inspected', 'role': 'supporting', 'independent': True, 'rule': 'a condition inspection on this line closed today and raised nothing'},
            {'id': 'planned', 'role': 'supporting', 'rule': 'every planned work item on the line closed inside its own window (planned start + estimated duration, or its due time, whichever is later)'},
            {'id': 'noraised', 'role': 'supporting', 'rule': 'no situation-sourced work item was raised on this line today'},
        ],
        'ruleOut': ['a station hiding behind the line average', 'micro-stops too short to see in the rate',
                    'the changeover itself being a fault', 'work volume as a signal in its own right'],
        'confidence': {'low': 'required checks only', 'medium': 'nothing was raised against the line',
                       'high': 'a condition inspection on the line closed today and nothing was raised against it'},
        'references': ['textbook: busy shift that stayed normal', 'variant: busy shift that did hide a fault',
                       'look-alike: quiet line that looks the same on the headline'],
    }

    def candidates(self, pack):
        return pack.of_type('line')

    def _window(self, pack, aid):
        """(start, end) of the production window: everything before the target went to zero."""
        tgt = pack.series(aid, 'line_target_rate')
        prod = [k for k in range(pack.n) if tgt[k] > 0]
        if not prod:
            return None
        return 0, prod[-1]

    def _sweep(self, pack, aid, i0, i1):
        """One row per station: its range over the window and any exception found."""
        p = self.p
        tgt = median(pack.series(aid, 'line_target_rate')[i0:i1 + 1])
        sm_steps = pack.steps(p['smooth_min'])
        rows = []
        for s in stations(pack, aid):
            atype = pack.asset(s)['assetType']
            r = rate(pack, s)
            sm = B.rolling_mean(r, sm_steps)
            w0 = max(i0 + sm_steps - 1, i0)
            win_sm = [v for v in sm[w0:i1 + 1] if v is not None]
            win = r[i0:i1 + 1]
            issues = []
            if min(win_sm) < tgt * (1 - p['band_pct'] / 100) or max(win_sm) > tgt * (1 + p['band_pct'] / 100):
                issues.append(f'{p["smooth_min"]}-min mean rate outside ±{num(p["band_pct"], 0)} % of target')
            if min(win) < tgt * p['stop_frac']:
                issues.append(f'a sample below {num(100 * p["stop_frac"], 0)} % of target')
            dips = episodes([v < tgt * (1 - p['dip_frac']) for v in r][i0:i1 + 1])
            if len(dips) > p['dip_events_max']:
                issues.append(f'{len(dips)} separate dips below {num(100 * (1 - p["dip_frac"]), 0)} % of target')
            stress = pack.series(s, 'system_stress')[i0:i1 + 1]
            if max(stress) > p['stress_max']:
                issues.append(f'stress peaked at {num(max(stress))}')
            tag = ''
            if atype == 'power_charge':
                vib = pack.series(s, 'vibration_mms')
                pm = peer_median(pack, peers_of(pack, s), 'vibration_mms')
                res = [a - b for a, b in zip(vib, pm)]
                slope = B.slope_per_hour(vib, i1, pack.steps(120), pack.step_min)
                tag = f'vibration {num(min(vib[i0:i1 + 1]), 2)}–{num(max(vib[i0:i1 + 1]), 2)} mm/s'
                if max(res[i0:i1 + 1]) > p['vib_margin_mms']:
                    issues.append(f'vibration {num(max(res[i0:i1 + 1]), 2)} mm/s above the other chargers')
                if slope is not None and slope > p['vib_slope_mms_per_h']:
                    issues.append(f'vibration trending {signed(slope, 2)} mm/s per hour')
            elif atype == 'refinement':
                pur = pack.series(s, 'purity_pct')
                base = baseline(pur, i0, i0 + pack.steps(60))
                tag = f'purity {num(min(pur[i0:i1 + 1]), 2)}–{num(max(pur[i0:i1 + 1]), 2)} %'
                if min(pur[i0:i1 + 1]) < base - p['purity_drop_pct']:
                    issues.append(f'purity {num(min(pur[i0:i1 + 1]), 2)} % against a {num(base, 2)} % baseline')
            elif atype == 'inspection':
                rej = pack.series(s, 'reject_rate_pct')
                base = baseline(rej, i0, i0 + pack.steps(60))
                tag = f'rejects {num(min(rej[i0:i1 + 1], ), 2)}–{num(max(rej[i0:i1 + 1]), 2)} %'
                if max(rej[i0:i1 + 1]) > base + p['reject_rise_pct']:
                    issues.append(f'rejects {num(max(rej[i0:i1 + 1]), 2)} % against a {num(base, 2)} % baseline')
            elif atype == 'transfer':
                blk, stv = pack.series(s, 'blocking_time'), pack.series(s, 'starvation_time')
                tag = (f'blocked {num(max(blk[i0:i1 + 1]), 2)} max, starved {num(max(stv[i0:i1 + 1]), 2)} max')
                if max(blk[i0:i1 + 1]) > p['hold_up_max'] or max(stv[i0:i1 + 1]) > p['hold_up_max']:
                    issues.append('held up or starved past its limit')
            elif atype == 'buffer':
                lvl = pack.series(s, 'buffer_level')
                base = baseline(lvl, i0, i0 + pack.steps(60))
                tag = f'level {num(min(lvl[i0:i1 + 1]))}–{num(max(lvl[i0:i1 + 1]))} %'
                if max(abs(v - base) for v in lvl[i0:i1 + 1]) > p['level_band_pts']:
                    issues.append(f'level moved more than {num(p["level_band_pts"], 0)} points from {num(base)} %')
            elif atype in ('intake', 'bulk_intake'):
                q = pack.series(s, 'input_quality_score')
                tag = f'input quality {num(min(q[i0:i1 + 1]))}–{num(max(q[i0:i1 + 1]))}'
            elif atype == 'output':
                q = pack.series(s, 'on_time_output_rate')
                tag = f'on-time {num(min(q[i0:i1 + 1]))}–{num(max(q[i0:i1 + 1]))} %'
            rows.append(dict(aid=s, name=pack.name(s), lo=min(win), hi=max(win), stress=max(stress),
                             tag=tag, issues=issues))
        return tgt, rows

    def evaluate(self, pack, aid):
        p = self.p
        if line_state(pack, aid) != 'changeover':
            return Finding(aid, False)
        w = self._window(pack, aid)
        if w is None:
            return Finding(aid, False)
        i0, i1 = w
        tgt = pack.series(aid, 'line_target_rate')
        thr = pack.series(aid, 'line_throughput')
        sm = pack.steps(p['smooth_min'])
        smooth = B.rolling_mean(thr, sm)
        tgt_med = median([v for v in tgt[i0:i1 + 1] if v > 0])
        if B.mean(thr[i0:i1 + 1]) < tgt_med * p['hold_pct'] / 100:
            return Finding(aid, False)
        if min(smooth[min(i0 + sm - 1, i1):i1 + 1]) < tgt_med * p['floor_pct'] / 100:
            return Finding(aid, False)
        _, rows = self._sweep(pack, aid, i0, i1)
        if any(r['issues'] for r in rows):
            return Finding(aid, False)
        instab = pack.series(aid, 'instability_index')[i0:i1 + 1]
        scrap = pack.series(aid, 'line_scrap_rate')[i0:i1 + 1]
        health = pack.series(aid, 'system_health_index')[i0:i1 + 1]
        if max(instab) >= p['instab_max'] or max(scrap) >= p['scrap_max'] or min(health) <= p['health_min']:
            return Finding(aid, False)
        return Finding(aid, True, i1, i0=i0, i1=i1, smooth=smooth, rows=rows, tgt=tgt_med,
                       instab=instab, scrap=scrap, health=health)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i0, i1, rows, tgt = f.aid, c['i0'], c['i1'], c['rows'], c['tgt']
        name = pack.name(aid)
        thr = pack.series(aid, 'line_throughput')
        tgts = pack.series(aid, 'line_target_rate')
        prod = thr[i0:i1 + 1]
        worst = min(range(i0, i1 + 1), key=lambda k: thr[k])
        pct = [100 * thr[k] / tgts[k] if tgts[k] > 0 else None for k in range(pack.n)]
        planned = [w for w in pack.work if w['sourceType'] == 'planned'
                   and (w['assetId'] == aid or w['assetId'] in pack.descendants(aid))]
        closed = [w for w in planned if w.get('done')]

        def allowed(w):
            """The end of the window a planned job had: its due time, or its planned start plus the
            time it was estimated to take, whichever is later."""
            return max(tmin(w['dueAt'][11:16]),
                       tmin(w['plannedStart'][11:16]) + (w.get('estimatedDurationMinutes') or 0))

        late = [w for w in closed if tmin(w['completedAt'][11:16]) > allowed(w)]
        raised = [w for w in pack.work if w['sourceType'] == 'situation'
                  and (w['assetId'] == aid or w['assetId'] in pack.descendants(aid))]
        inspections = [w for w in closed if w['workType'] == 'INSPECTION']
        planned_ok = bool(planned) and not late
        noraised_ok = not raised
        inspected_ok = bool(inspections) and noraised_ok
        level = 'high' if inspected_ok else ('medium' if noraised_ok else 'low')
        sweep_txt = '; '.join(f'{r["name"]} {num(r["lo"])}–{num(r["hi"])}/min' + (f', {r["tag"]}' if r['tag'] else '')
                              for r in rows)
        band_lo = [tgt * (1 - p['band_pct'] / 100)] * pack.n
        band_hi = [tgt * (1 + p['band_pct'] / 100)] * pack.n
        yd = nice_domain(prod, [tgt * 0.94, tgt * 1.06], pad=0.02)

        checks = [
            check('busy', 'A planned changeover on top of a full shift', 'required', MATCH,
                  f'{name} is on {product_of(pack, aid)}; its target rate went from {num(tgt, 0)}/min to 0 at '
                  f'{ts[i1 + 1]} and the line state reads changeover. {len(planned)} planned jobs sit on this line '
                  f'today, {len(closed)} of them closed.',
                  'A changeover is the busiest thing a line does short of a breakdown: product switch, material, '
                  'quality release, and the run-down itself. It is planned work, not a fault.',
                  spark(tgts, [0, tgt * 1.1], highlight=[ts[i1 + 1], ts[now]])),
            check('rate', 'Held its target right up to the changeover', 'required', MATCH,
                  f'{num(B.mean(prod))}/min average against a {num(tgt, 0)}/min target '
                  f'({num(100 * B.mean(prod) / tgt)} % of plan) over {dur(pack.minutes_between(i0, i1))}, with the '
                  f'{p["smooth_min"]}-minute mean never below '
                  f'{num(100 * min(v for v in c["smooth"][min(i0 + pack.steps(p["smooth_min"]) - 1, i1):i1 + 1]) / tgt)} '
                  f'% of target (floor {num(p["floor_pct"], 0)} %).',
                  'A line that is genuinely in trouble gives rate away first. Holding plan for a whole shift is the '
                  'single strongest evidence that nothing upstream of Output was limiting.',
                  spark(pct[:i1 + 1] + [None] * (pack.n - i1 - 1), [94, 106], threshold_value=p['hold_pct'])),
            check('sweep', f'All {len(rows)} stations swept, no exception', 'required', MATCH,
                  sweep_txt + f'. Every {p["smooth_min"]}-min mean inside ±{num(p["band_pct"], 0)} % of target; '
                  f'no sample below {num(100 * p["stop_frac"], 0)} %; no station with more than '
                  f'{p["dip_events_max"]} dips; peak stress {num(max(r["stress"] for r in rows))} of 30.',
                  'The line average can hide one slow station: upstream blocks and downstream starves, and the '
                  'Output rate still looks fine for a while. The sweep is what rules that out.',
                  None),
            check('kpis', 'Line KPIs flat all shift', 'required', MATCH,
                  f'Instability {num(min(c["instab"]), 2)}–{num(max(c["instab"]), 2)} (normal is about 1), scrap '
                  f'{num(max(c["scrap"]), 2)} % at worst, health never below {num(min(c["health"]))} %.',
                  'Instability, scrap and health pick up oscillation, stops and quality losses that a rate band '
                  'would miss. All three sat still.',
                  spark(pack.series(aid, 'instability_index'), [0, 4], threshold_value=p['instab_max'])),
            check('inspected', 'A condition inspection on the line came back clean', 'supporting',
                  MATCH if inspected_ok else NO_MATCH,
                  ('; '.join(f'{w["text"]} ({w["id"]}, {w["assetLabel"]}) closed {w["completedAt"][11:16]}'
                             for w in inspections)
                   + ' — and nothing was raised off the back of it.' if inspections else
                   'No condition inspection closed on this line today.'),
                  'Somebody was at the machine today and wrote nothing up. That is a different kind of evidence from '
                  'a trend, and it is what makes this a confirmation rather than an absence of alarms.',
                  None),
            check('planned', 'Planned work closed inside its window', 'supporting',
                  MATCH if planned_ok else NO_MATCH,
                  ('; '.join(f'{w["text"]} {w["plannedStart"][11:16]}+{w.get("estimatedDurationMinutes") or 0} min, '
                             f'done {w["completedAt"][11:16]}' for w in closed if w.get('completedAt'))
                   or 'No closed planned work on this line')
                  + ('. ' + join_names([f'{w["text"]} ran '
                                       f'{dur(tmin(w["completedAt"][11:16]) - allowed(w))} over'
                                       for w in late]) + '.' if late else ' None ran over.'),
                  'Workload is only a problem when tasks start colliding. These were worked one after another, each '
                  'inside its own window.',
                  None),
            check('noraised', 'Nothing raised against the line', 'supporting', MATCH if noraised_ok else NO_MATCH,
                  'No condition- or situation-driven work item exists on this line today.'
                  if noraised_ok else f'{len(raised)} situation-driven item(s) on this line.',
                  'Every other line with a problem today has a job on it that the problem created. This one has none.',
                  None),
        ]
        main = chart('/min', yd,
                     [series('thr', f'{name} throughput', thr[:i1 + 1] + [None] * (pack.n - i1 - 1), 'primary', 1),
                      series('tgt', 'Planned target', [tgt] * pack.n, 'expected', 1)]
                     + [series(f's{k}', pack.name(r['aid']), rate(pack, r['aid'])[:i1 + 1] + [None] * (pack.n - i1 - 1),
                               'peer', 1) for k, r in enumerate(rows)],
                     title='What we see',
                     caption=f'{name} and each of its {len(rows)} stations against the {num(tgt, 0)}/min target, up to '
                             f'the {ts[i1 + 1]} changeover. The band is ±{num(p["band_pct"], 0)} % of target; no '
                             f'station left it.',
                     band=band('±%s %% of target' % num(p['band_pct'], 0), band_lo, band_hi, 1),
                     markers=[marker(ts[worst], f'Lowest sample {num(thr[worst])}/min'),
                              marker(ts[i1 + 1], 'Planned changeover')])

        grid = minutes_grid(0, 360, 15)
        r = Rng(4021)
        normal = [tgt + r.gauss(1.0) for _ in grid]
        hidden = [tgt + r.gauss(1.0) - (0.0 if m < 120 else min(6.0, 0.05 * (m - 120))) for m in grid]
        quiet = [tgt * 0.955 + r.gauss(0.8) for _ in grid]
        live = aligned(thr, i0, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Line throughput (min from shift start)', '/min',
                                  [tgt * 0.9, tgt * 1.07], grid, 'min', a, live, f'{name}, today', 1,
                                  [threshold(tgt, 'Target')])]
        refs = [
            reference('clean', 'textbook', 'Textbook', 'Busy shift that stayed normal',
                      'Full planned workload — sample, inspection, huddle, changeover prep — and the line holds plan '
                      'the whole time, every station inside its band. Nothing to do but record it.',
                      'match', 'Closest match',
                      [f'{name} averaged {num(100 * B.mean(prod) / tgt)} % of plan',
                       'All stations swept clean, so the average is not hiding one of them'], mk(normal)),
            reference('hidden', 'variant', 'What this would look like if it were wrong',
                      'Busy shift that did hide a slow station',
                      'The line average holds for an hour or two while one station quietly loses pace. Upstream '
                      'blocks, downstream starves, WIP climbs, and only then does Output give way.',
                      'nomatch', 'Does not match',
                      ['Here the slow station shows up in the sweep before the line average moves',
                       f'No station on {name} left ±{num(p["band_pct"], 0)} % of target'], mk(hidden)),
            reference('quiet', 'lookalike', 'Look-alike', 'Quiet line a few per cent under plan',
                      'A line with nothing happening on it that still runs 4–5 % under target all day. The headline '
                      'looks calm, but it is losing product every hour.',
                      'nomatch', 'Not this line',
                      [f'{name} averaged {num(100 * B.mean(prod) / tgt)} % of target over '
                       f'{dur(pack.minutes_between(i0, i1))}',
                       'Busy is not the same as behind'], mk(quiet)),
        ]
        ro = [
            ruled_out('One station hiding behind the line average', 'ruled out',
                      f'Each of the {len(rows)} stations was checked on its own rate, not on the line total: '
                      f'{sweep_txt}.'),
            ruled_out('Micro-stops too short to see in the rate', 'ruled out',
                      f'A seconds-long stop still costs a measurable share of a 5-minute rate. No station on {name} '
                      f'had more than {p["dip_events_max"]} dips below {num(100 * (1 - p["dip_frac"]), 0)} % of '
                      f'target, and the Transfer gate never reported being held up or starved past '
                      f'{num(p["hold_up_max"], 1)}.'),
            ruled_out('The changeover itself being a fault', 'ruled out',
                      f'The target rate was set to 0 at {ts[i1 + 1]} and the line state reads changeover. A fault '
                      f'leaves the target where it was and the throughput falls away from it; here the plan moved '
                      f'first, so availability and performance are not charged for it.'),
            ruled_out('Heavy workload as a signal in its own right', 'ruled out',
                      f'{len(planned)} planned jobs is a busy slate, but every one closed inside its window and none '
                      f'of them overlapped. Task count on its own says nothing about the equipment.'),
        ]
        return {
            'conclusion': conclusion('Cause', f'Nothing wrong with {name}: a heavy planned slate, worked on schedule, '
                                              f'on a line that held {num(100 * B.mean(prod) / tgt)} % of plan with '
                                              f'every station inside its band', level,
                                     'Confirmed by a full station sweep and a clean inspection on the line'
                                     if level == 'high' else 'Confirmed by a full station sweep'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'Nothing left out: all {len(rows)} stations on {name} were swept over the whole production '
                        f'window ({ts[i0]}–{ts[i1]}). The changeover itself ({ts[i1 + 1]} onward) is excluded from the '
                        f'rate checks because the plan calls for the line to run down there.',
            'confidence': confidence(level,
                                     'Four independent readings agree: the line held plan, every station was inside '
                                     'its band, the line KPIs never moved, and somebody was physically at the '
                                     'Power Charge drive today and wrote nothing up.' if inspected_ok else
                                     'The line held plan with every station inside its band and no work raised '
                                     'against it.',
                                     None if inspected_ok else 'No condition inspection closed on this line today, '
                                                               'so the all-clear rests on the data alone.',
                                     'Nothing would raise it further — this is a confirmation, not a diagnosis.',
                                     f'Any of these would change the verdict: a station outside '
                                     f'±{num(p["band_pct"], 0)} % of target, more than {p["dip_events_max"]} dips on '
                                     f'any station, charger vibration more than {num(p["vib_margin_mms"], 1)} mm/s '
                                     f'above the other chargers or trending up, purity more than '
                                     f'{num(p["purity_drop_pct"], 2)} % off its baseline, rejects more than '
                                     f'{num(p["reject_rise_pct"], 1)} points up, a Transfer held up past '
                                     f'{num(p["hold_up_max"], 1)}, buffer level more than '
                                     f'{num(p["level_band_pts"], 0)} points off, or line instability above '
                                     f'{num(p["instab_max"], 1)}.',
                                     'The station sweep, the line KPIs, and the closed work list — three different '
                                     'kinds of record, all saying the same thing.'),
            'action': action(item, pack),
            'model': {'target': 'line_throughput and every station throughput_per_min',
                      'formula': f'line_target_rate {num(tgt, 0)}/min ± {num(p["band_pct"], 0)} %',
                      'fittedOn': 'the production plan for the shift, with the other five Power Charge drives used '
                                  'only for the vibration comparison'},
            'impact': f'None. About {num(sum(prod) * pack.step_min, 0)} units made over '
                      f'{dur(pack.minutes_between(i0, i1 + 1))} against a plan of '
                      f'{num(tgt * pack.minutes_between(i0, i1 + 1), 0)}, with {num(max(c["scrap"]), 2)} % scrap at '
                      f'worst.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Refinement regulator going sluggish — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class RefinementRegulatorSluggish(Detector):
    id = 'refinery.refinement_regulator_sluggish'
    name = 'Refinement regulating element responding slowly'
    archetype = '03 Quiet drift'
    applies_to = 'Refinement stations'
    summary = ('A Refinement station losing rate against its line target while its control effort climbs to hold the '
               'setpoint. Effort up and output down together is a mechanical response problem, not a demand change.')
    pipeline = [
        ('Expected', 'the line target rate — what the station is asked to pass'),
        ('Deficit', 'target minus the station rate, as a percentage of target'),
        ('Effort', 'control effort against this station\'s own first-hour baseline and against the other Refinements'),
        ('Checks', 'behind target · effort climbing · sustained · starving downstream · buffer draining · '
                   'upstream paced down'),
        ('Conclusion', 'rate down while effort up → the regulating element, not the demand; recovery after the '
                       'inspection → high confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'refinement'},
        'inputs': {'rate': 'self.throughput_per_min', 'effort': 'self.control_effort_pct',
                   'target': 'line.line_target_rate', 'down': 'targets[process_flow] (Inspection) throughput_per_min',
                   'up': 'sources[process_flow] (Stabilization) throughput_per_min',
                   'buffer': 'line buffer.buffer_level and starvation_risk_index',
                   'wip': 'line.total_wip and flow_efficiency',
                   'work': 'done INSPECTION work items on this station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Refinement stations'},
        'expected': {'model': 'planned target', 'target': 'throughput_per_min',
                     'formula': 'line_target_rate', 'fitOn': 'the production plan'},
        'params': {'deficit_pct': 4.0, 'watch_pct': 2.0, 'sustain_min': 15, 'baseline_min': 60,
                   'effort_rise_pct': 4.0, 'effort_slope_pct_per_h': 3.0, 'slope_window_min': 45,
                   'starve_per_min': 3.0, 'starve_match_per_min': 1.5, 'buffer_drop_pts': 8.0,
                   'wip_rise_lots': 2.0,
                   'recover_frac': 0.6, 'recover_within_min': 45},
        'checks': [
            {'id': 'behind', 'role': 'required', 'rule': 'rate < target × (1 − deficit_pct/100)'},
            {'id': 'effort', 'role': 'required', 'rule': 'control effort > baseline + effort_rise_pct and rising faster than effort_slope_pct_per_h'},
            {'id': 'sustained', 'role': 'required', 'rule': 'behind target for sustain_min'},
            {'id': 'starved', 'role': 'supporting', 'independent': True, 'rule': 'the next station down the line is ≥ starve_per_min behind target at the worst point, and its deficit matches this station\'s to within starve_match_per_min — the whole shortfall passed straight through'},
            {'id': 'buffer', 'role': 'supporting', 'independent': True, 'rule': 'the line buffer drains ≥ buffer_drop_pts while this lasts'},
            {'id': 'upstream', 'role': 'supporting', 'rule': 'the station feeding it paces down too (blocked), and WIP rises ≥ wip_rise_lots'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'rate recovers ≥ recover_frac of the deficit within recover_within_min of the regulator inspection closing'},
        ],
        'ruleOut': ['a lower production demand', 'material shortage upstream', 'a blockage downstream',
                    'a miscounting flow meter'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'rate recovered after the regulator was adjusted'},
        'references': ['textbook: sluggish regulator, adjusted', 'variant: regulator left alone',
                       'look-alike: planned rate cut'],
    }

    def candidates(self, pack):
        return pack.of_type('refinement')

    def _ctx(self, pack, aid):
        p = self.p
        r = rate(pack, aid)
        tgt = target(pack, aid)
        eff = pack.series(aid, 'control_effort_pct')
        bl = pack.steps(p['baseline_min'])
        base = baseline(eff, 0, bl - 1)
        deficit = [100 * (t - v) / t if t > 0 else None for v, t in zip(r, tgt)]
        rise = [e - base for e in eff]
        return dict(r=r, tgt=tgt, eff=eff, base=base, deficit=deficit, rise=rise)

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        behind = [d is not None and d > p['deficit_pct'] for d in c['deficit']]
        watch = [d is not None and d > p['watch_pct'] for d in c['deficit']]
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(behind, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if c['rise'][i] <= p['effort_rise_pct']:
                continue
            slope = B.slope_per_hour(c['eff'], i, sw, pack.step_min)
            if slope is None or slope <= p['effort_slope_pct_per_h']:
                continue
            onset = s0
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            c.update(onset=onset, alert=s0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        r, tgt, eff, deficit, rise = c['r'], c['tgt'], c['eff'], c['deficit'], c['rise']
        onset, alert = c['onset'], c['alert']
        low = min(range(onset, pack.n), key=lambda k: r[k])
        end = next((k for k in range(low, pack.n) if r[k] >= tgt[k] * (1 - p['watch_pct'] / 100)), pack.now)
        down, up = nxt(pack, aid), prv(pack, aid)
        dr, ur = rate(pack, down), rate(pack, up)
        gap_down = B.mean([r[k] - dr[k] for k in range(onset, end + 1)])
        d_def = tgt[low] - dr[low]
        own_def = tgt[low] - r[low]
        starved_ok = (d_def >= p['starve_per_min']
                      and abs(d_def - own_def) <= p['starve_match_per_min'])
        up_drop = baseline(ur, 0, pack.steps(p['baseline_min']) - 1) - min(ur[onset:end + 1])
        buf = pack.descendant_of_type(line, 'buffer')
        lvl = pack.series(buf, 'buffer_level') if buf else None
        buf_drop = (lvl[onset] - min(lvl[onset:end + 1])) if lvl else 0.0
        buf_ok = buf_drop >= p['buffer_drop_pts']
        wip = pack.series(line, 'total_wip')
        wip_rise = max(wip[onset:end + 1]) - wip[onset]
        up_ok = up_drop > 0.5 and wip_rise >= p['wip_rise_lots']
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == aid and w.get('done') and w.get('completedAt')]
        job = jobs[0] if jobs else None
        rec_frac, rec_k = 0.0, None
        if job:
            k0 = job[1]
            span = range(k0, min(pack.n, k0 + pack.steps(p['recover_within_min']) + 1))
            rec_k = max(span, key=lambda k: r[k])
            deepest = tgt[low] - r[low]
            rec_frac = (r[rec_k] - r[low]) / deepest if deepest > 0 else 0.0
        fixed_ok = job is not None and rec_frac >= p['recover_frac']
        independent = sum([starved_ok, buf_ok, fixed_ok])
        level = 'high' if fixed_ok else ('medium' if independent else 'low')
        eslope = B.slope_per_hour(eff, i, pack.steps(p['slope_window_min']), pack.step_min)
        peers = peers_of(pack, aid)
        pe = peer_median(pack, peers, 'control_effort_pct')
        lost = sum(max(0.0, tgt[k] - r[k]) for k in range(onset, end + 1)) * pack.step_min
        yd = nice_domain(r[onset - 2:end + 3] if onset > 2 else r[:end + 3], [tgt[0]], pad=0.1)
        ed = nice_domain(eff, pe, pad=0.1)

        checks = [
            check('behind', 'Behind the line target', 'required', MATCH,
                  f'{num(r[i])}/min against a {num(tgt[i], 0)}/min target when it was flagged at {ts[i]} '
                  f'({signed(-deficit[i])} %). Lowest {num(r[low])}/min at {ts[low]} '
                  f'({signed(-deficit[low])} %). Alert level is {num(p["deficit_pct"], 0)} % behind.',
                  'The station is asked to pass what the plan calls for. Falling short of it, while nothing upstream '
                  'is short of material, means the station itself is the limit.',
                  spark([-d if d is not None else None for d in deficit], [-10, 3],
                        threshold_value=-p['deficit_pct'])),
            check('effort', 'Control effort climbing to compensate', 'required', MATCH,
                  f'{num(eff[i])} % at {ts[i]} against a {num(c["base"])} % baseline ({signed(rise[i])} points), '
                  f'peaking at {num(max(eff))} %. Other Refinements sat at {num(pe[i])} %. Rising '
                  f'{signed(eslope)} points per hour.',
                  'The loop asks the regulating element for more and more to hold the same setpoint. That is what a '
                  'stiff or slow element looks like from the control room: more demand, less result.',
                  spark(eff, ed, pe, pe, threshold_value=c['base'] + p['effort_rise_pct'])),
            check('sustained', 'Sustained, not a passing dip', 'required', MATCH,
                  f'More than {num(p["deficit_pct"], 0)} % behind target since {ts[alert]} '
                  f'({dur(pack.minutes_between(alert, i))} by the time it was raised); drifting since {ts[onset]}, '
                  f'where it first went {num(p["watch_pct"], 0)} % behind.',
                  f'{dur(p["sustain_min"])} of it is needed, so a single slow sample or a batch change cannot '
                  f'trigger it.',
                  spark([-d if d is not None else None for d in deficit], [-10, 3],
                        threshold_value=-p['deficit_pct'], highlight=[ts[onset], ts[end]])),
            check('starved', f'{pack.name(down)} got exactly what this station passed', 'supporting',
                  MATCH if starved_ok else NO_MATCH,
                  f'At the worst sample ({ts[low]}) {pack.name(down)} ran {num(dr[low])}/min — {num(d_def)}/min '
                  f'behind the {num(tgt[low], 0)}/min target, against this station\'s {num(own_def)}/min. The two '
                  f'deficits agree to {num(abs(d_def - own_def))}/min, and over the whole episode the two stations '
                  f'averaged within {num(abs(gap_down))}/min of each other.',
                  'There is no store between Refinement and Inspection, so the shortfall passes straight through: '
                  'Inspection is short by exactly what Refinement did not pass on, in the same five minutes.',
                  spark(dr, yd, r, r, highlight=[ts[onset], ts[end]])),
            check('buffer', 'Line buffer drained to cover it', 'supporting', MATCH if buf_ok else NO_MATCH,
                  (f'{pack.name(buf)} level fell {num(lvl[onset])} % → {num(min(lvl[onset:end + 1]))} % '
                   f'({num(buf_drop)} points) and starvation risk rose to '
                   f'{num(max(pack.series(buf, "starvation_risk_index")[onset:end + 1]))}.' if lvl else
                   'This line has no buffer.'),
                  'The buffer is the only store on the line. It paid for the shortfall so Output barely moved — which '
                  'is exactly why the line throughput looked almost normal.',
                  spark(lvl, [0, 80], highlight=[ts[onset], ts[end]]) if lvl else None),
            check('upstream', f'{pack.name(up)} paced down, WIP up', 'supporting', MATCH if up_ok else NO_MATCH,
                  f'{pack.name(up)} eased to {num(min(ur[onset:end + 1]))}/min ({num(up_drop)}/min off its '
                  f'baseline) and {lname} WIP rose {num(wip[onset])} → {num(max(wip[onset:end + 1]))} lots.',
                  'A station that cannot pass material on blocks the one before it. Blocking upstream and starvation '
                  'downstream put the restriction between them.',
                  spark(wip, nice_domain(wip, pad=0.1), highlight=[ts[onset], ts[end]])),
            check('fixed', 'Recovered after the regulator was adjusted', 'supporting',
                  MATCH if fixed_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; rate back to '
                   f'{num(r[rec_k])}/min by {ts[rec_k]} — {num(100 * rec_frac, 0)} % of the deficit recovered.'
                   if job else 'No closed inspection on this station.'),
                  'Nothing else changed at that moment. A fault that goes away when one element is adjusted was that '
                  'element.',
                  spark(r, yd, highlight=[ts[job[1]], ts[rec_k]]) if job else None),
        ]
        main = chart('/min', yd,
                     [series('rate', f'{name} rate', r, 'primary', 1),
                      series('tgt', 'Line target', tgt, 'expected', 1),
                      series('down', f'{pack.name(down)} rate', dr, 'secondary', 1)],
                     title='What we see',
                     caption=f'{name} against its {num(tgt[0], 0)}/min target, with {pack.name(down)} behind it. The '
                             f'shaded gap is product the plan expected and the station did not pass; Inspection lost '
                             f'the same amount.',
                     shade_gap=['tgt', 'rate'],
                     markers=[marker(ts[onset], 'Drift begins'), marker(ts[i], 'Flagged'),
                              marker(ts[low], f'Lowest {num(r[low])}/min')]
                     + ([marker(ts[job[1]], 'Regulator adjusted')] if job else []))

        grid = minutes_grid(-30, 120, 10)
        rng = Rng(3301)
        base_r = tgt[0]
        tb_r, tb_e, ea_r, ea_e, cut_r, cut_e = [], [], [], [], [], []
        for m in grid:
            x = max(0.0, m) / 60.0
            tb_r.append(base_r - min(10.0, 14.0 * x) + rng.gauss(0.4) + (min(10.0, 14.0 * x) if m > 55 else 0.0))
            tb_e.append(50.0 + min(12.0, 17.0 * x) + rng.gauss(0.3) - (min(12.0, 17.0 * x) if m > 55 else 0.0))
            ea_r.append(base_r - min(18.0, 9.0 * x) + rng.gauss(0.4))
            ea_e.append(50.0 + min(20.0, 10.0 * x) + rng.gauss(0.3))
            cut_r.append(base_r - (0.0 if m < 0 else 9.0) + rng.gauss(0.4))
            cut_e.append(50.0 + rng.gauss(0.3) - (0.0 if m < 0 else 1.5))
        live_r = aligned(r, onset, pack.step_min, grid, 'min')
        live_e = aligned(eff, onset, pack.step_min, grid, 'min')
        pair = lambda a, b: [ref_chart('Station rate (min from onset)', '/min', [base_r - 14, base_r + 5], grid,
                                       'min', a, live_r, f'{name}, today', 1, [threshold(base_r, 'Target')]),
                             ref_chart('Control effort', '%', [44, 68], grid, 'min', b, live_e,
                                       f'{name}, today', 1)]
        refs = [
            reference('adjusted', 'textbook', 'Textbook', 'Sluggish regulator, found and adjusted',
                      'Rate falls a few per cent an hour while effort climbs point for point. An inspection finds the '
                      'element moving slower than spec, it is adjusted, and both curves snap back within minutes.',
                      'match', 'Closest match',
                      [f'Same opposed pair: {signed(-deficit[low])} % of rate for {signed(rise[low])} points of effort',
                       f'{name} came back {dur(pack.minutes_between(low, rec_k))} after the adjustment'
                       if job else 'Recovery after adjustment is the signature'], pair(tb_r, tb_e)),
            reference('left', 'variant', 'What to avoid', 'Regulator left alone',
                      'The same start, nobody acts. Effort saturates, the station settles 12–15 % behind, the buffer '
                      'empties and Output finally follows it down.',
                      'partial', 'Where today was heading',
                      [f'{name} was caught at {signed(-deficit[low])} %',
                       'Past the buffer, the loss reaches the customer'], pair(ea_r, ea_e)),
            reference('cut', 'lookalike', 'Look-alike', 'Planned rate cut',
                      'Rate steps down and stays there, but control effort steps *down* too — the loop was asked for '
                      'less, and it obliged. Nothing is wrong with the element.',
                      'nomatch', 'Does not match',
                      [f'Effort here went {signed(rise[low])} points the other way',
                       f'The {lname} target never moved from {num(tgt[0], 0)}/min'], pair(cut_r, cut_e)),
        ]
        ro = [
            ruled_out('A lower production demand', 'ruled out',
                      f'The {lname} target stayed at {num(tgt[0], 0)}/min the whole time and the line state read '
                      f'running, not changeover. A demand cut would have moved the target and taken the control '
                      f'effort down with the rate; effort went up {signed(rise[low])} points instead.'),
            ruled_out('Material shortage upstream', 'ruled out',
                      f'{pack.name(up)} was holding {num(baseline(ur, 0, pack.steps(60) - 1))}/min before this and '
                      f'only eased to {num(min(ur[onset:end + 1]))}/min after the Refinement rate had already '
                      f'fallen — blocked by it, not short of material. Intake input quality stayed at '
                      f'{num(min(pack.series(stations(pack, line)[0], "input_quality_score")[onset:end + 1]))} or '
                      f'better.'),
            ruled_out('A blockage downstream', 'ruled out',
                      f'{pack.name(down)} was {num(d_def)}/min behind target — starved, not slow — and '
                      f'{pack.name(buf) if buf else "the buffer"} drained {num(buf_drop)} points. A downstream '
                      f'restriction fills the buffer and blocks Refinement; this emptied it and starved Inspection, '
                      f'which is the opposite direction.'),
            ruled_out('A miscounting flow meter', 'unlikely' if not fixed_ok else 'ruled out',
                      f'Four separate measurements moved together — this station\'s rate, {pack.name(down)}\'s rate, '
                      f'the buffer level and the line WIP. A counter fault moves one of them.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     'The Refinement regulating element is responding slowly — the loop is paying '
                                     'more control effort for less throughput', level,
                                     'Confirmed: the rate came back when the element was adjusted' if fixed_ok else
                                     'Rate and effort agree, and downstream lost the same product'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The five other Refinement stations are used only as a sanity check on control effort '
                        f'({num(min(pe))}–{num(max(pe))} % today). The judgement is made against the {lname} target, '
                        f'because every line runs its own product rate.',
            'confidence': confidence(level,
                                     f'Rate, control effort, {pack.name(down)}\'s rate and the buffer level are four '
                                     f'separate measurements and all four point at this station. The rate then '
                                     f'recovered {num(100 * rec_frac, 0)} % within '
                                     f'{dur(pack.minutes_between(job[1], rec_k))} of the element being adjusted.'
                                     if fixed_ok else
                                     'Rate and control effort move in opposite directions, which narrows it to the '
                                     'element itself.',
                                     None if fixed_ok else 'Nobody has been at the element yet; from trends alone a '
                                                           'stiff element and a worn one look the same.',
                                     None if fixed_ok else 'An inspection finds the element slow, or the rate '
                                                           'recovers after it is adjusted.',
                                     'The element checks out as free and in spec — then look at the setpoint itself '
                                     'and at the counter on this station.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'throughput_per_min',
                      'formula': f'line_target_rate = {num(tgt[0], 0)}/min',
                      'fittedOn': f'the {lname} production plan'},
            'impact': f'About {num(lost, 0)} units not made between {ts[onset]} and {ts[end]}, most of it absorbed by '
                      f'{pack.name(buf) if buf else "the line"} rather than lost at Output. Line performance dipped '
                      f'to {num(min(pack.series(line, "line_performance")[onset:end + 1]), 2)} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Buffer filling because Output is restricted — archetype 04 (accumulation)
# ═════════════════════════════════════════════════════════════════════════
class BufferAccumulation(Detector):
    id = 'refinery.buffer_accumulation'
    name = 'Buffer filling from a downstream restriction'
    archetype = '04 Accumulation'
    applies_to = 'Buffers'
    summary = ('A line buffer taking in more than it lets out for long enough to climb well above its working level, '
               'with the inflow unchanged — so the restriction is downstream of the buffer, not a surge upstream.')
    pipeline = [
        ('Net flow', 'inflow minus outflow, sample by sample'),
        ('Mass balance', 'the level rise the net flow should produce, against the level actually read'),
        ('Side', 'inflow against its own baseline: unchanged inflow puts the cause on the outflow side'),
        ('Checks', 'accumulating · level high · balance closes · inflow normal · saturation risk · '
                   'Output behind target'),
        ('Conclusion', 'the station the buffer feeds is the restriction; recovery after it is cleared → high '
                       'confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'buffer'},
        'inputs': {'level': 'self.buffer_level', 'in': 'self.buffer_inflow_rate', 'out': 'self.buffer_outflow_rate',
                   'risk': 'self.saturation_risk_index', 'dwell': 'self.time_in_buffer',
                   'turns': 'self.buffer_turnover_rate',
                   'down': 'targets[process_flow] (Output): throughput_per_min, on_time_output_rate',
                   'target': 'line.line_target_rate',
                   'work': 'done INSPECTION work items on the downstream station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Buffers'},
        'expected': {'model': 'mass balance', 'target': 'buffer_level',
                     'formula': 'level[i] = level[i−1] + (in[i−1] − out[i−1]) × step_min ÷ units_per_pct',
                     'fitOn': 'the buffer\'s own flows'},
        'params': {'net_per_min': 2.0, 'sustain_min': 20, 'rise_pts': 12.0, 'baseline_min': 60,
                   'units_per_pct': 10.4, 'balance_tol_pct': 15.0, 'inflow_band_per_min': 2.5,
                   'inflow_local_min': 60,
                   'risk_rise': 5.0, 'dwell_rise_min': 1.0, 'out_deficit_per_min': 3.0,
                   'drain_frac': 0.6, 'drain_within_min': 60},
        'checks': [
            {'id': 'accumulating', 'role': 'required', 'rule': 'in − out > net_per_min for sustain_min'},
            {'id': 'high', 'role': 'required', 'rule': 'level > first-hour baseline + rise_pts and still rising'},
            {'id': 'balance', 'role': 'required', 'rule': 'integrated net flow ÷ units_per_pct matches the level rise within balance_tol_pct'},
            {'id': 'inflow', 'role': 'required', 'rule': '|median(in over the episode) − median(in over the inflow_local_min before it)| < inflow_band_per_min'},
            {'id': 'risk', 'role': 'supporting', 'independent': True, 'rule': 'saturation risk up by risk_rise and dwell time up by dwell_rise_min'},
            {'id': 'output', 'role': 'supporting', 'independent': True, 'rule': 'the station the buffer feeds runs ≥ out_deficit_per_min below the line target'},
            {'id': 'cleared', 'role': 'supporting', 'independent': True, 'rule': 'level drains ≥ drain_frac of the rise within drain_within_min of the downstream inspection closing'},
        ],
        'ruleOut': ['an upstream surge', 'a level transmitter reading high', 'the level controller\'s setpoint',
                    'a quality hold inside the buffer'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'buffer drained after the downstream restriction was cleared'},
        'references': ['textbook: downstream restriction', 'variant: restriction left in place',
                       'look-alike: upstream catch-up burst'],
    }

    def candidates(self, pack):
        return pack.of_type('buffer')

    def _ctx(self, pack, aid):
        p = self.p
        lvl = pack.series(aid, 'buffer_level')
        inf = pack.series(aid, 'buffer_inflow_rate')
        out = pack.series(aid, 'buffer_outflow_rate')
        net = [a - b for a, b in zip(inf, out)]
        bl = pack.steps(p['baseline_min'])
        return dict(lvl=lvl, inf=inf, out=out, net=net, ilocal=None,
                    lbase=baseline(lvl, 0, bl - 1), ibase=baseline(inf, 0, bl - 1))

    def _balance(self, pack, c, i0, i1):
        """Level rise the flows predict, over (i0, i1]."""
        p = self.p
        units = sum(c['net'][k] for k in range(max(0, i0), i1)) * pack.step_min
        return units / p['units_per_pct']

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        filling = [v > p['net_per_min'] for v in c['net']]
        for i in range(pack.n):
            s0 = B.sustained_since(filling, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0 - 1 if s0 > 0 else 0
            if c['lvl'][i] < c['lbase'] + p['rise_pts']:
                continue
            pred = self._balance(pack, c, onset, i)
            seen = c['lvl'][i] - c['lvl'][onset]
            if pred <= 0 or abs(seen - pred) > abs(pred) * p['balance_tol_pct'] / 100:
                continue
            ilocal = median(c['inf'][max(0, onset - pack.steps(p['inflow_local_min'])):onset + 1])
            if abs(median(c['inf'][onset:i + 1]) - ilocal) > p['inflow_band_per_min']:
                continue
            c['ilocal'] = ilocal
            c.update(onset=onset, alert=s0, pred=pred, seen=seen)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        lvl, inf, out, net = c['lvl'], c['inf'], c['out'], c['net']
        onset = c['onset']
        peak = max(range(onset, pack.n), key=lambda k: lvl[k])
        back = next((k for k in range(peak, pack.n) if lvl[k] <= c['lbase'] + 2.0), pack.now)
        down = nxt(pack, aid)
        dr = rate(pack, down)
        tgt = target(pack, aid)
        out_def = B.mean([tgt[k] - dr[k] for k in range(c['alert'], peak + 1)])
        out_ok = out_def >= p['out_deficit_per_min']
        risk = pack.series(aid, 'saturation_risk_index')
        dwell = pack.series(aid, 'time_in_buffer')
        turns = pack.series(aid, 'buffer_turnover_rate')
        risk_ok = (max(risk[onset:peak + 1]) - risk[onset] >= p['risk_rise']
                   and max(dwell[onset:peak + 1]) - dwell[onset] >= p['dwell_rise_min'])
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == down and w.get('done') and w.get('completedAt')]
        job = jobs[0] if jobs else None
        drain_frac, drain_k = 0.0, None
        rise = lvl[peak] - lvl[onset]
        if job:
            span = range(job[1], min(pack.n, job[1] + pack.steps(p['drain_within_min']) + 1))
            drain_k = min(span, key=lambda k: lvl[k])
            drain_frac = (lvl[peak] - lvl[drain_k]) / rise if rise > 0 else 0.0
        cleared_ok = job is not None and drain_frac >= p['drain_frac']
        independent = sum([risk_ok, out_ok, cleared_ok])
        level = 'high' if cleared_ok else ('medium' if independent else 'low')
        pred_series = [None] * pack.n
        pred_series[onset] = lvl[onset]
        for k in range(onset + 1, pack.n):
            pred_series[k] = pred_series[k - 1] + net[k - 1] * pack.step_min / p['units_per_pct']
        on_time = pack.series(down, 'on_time_output_rate')
        held = rise * p['units_per_pct']
        yd = nice_domain(lvl, [0, 100], pad=0.05, floor=0, ceil=100)
        fd = nice_domain(inf, out, pad=0.1)

        checks = [
            check('accumulating', 'Taking in more than it lets out', 'required', MATCH,
                  f'Inflow {num(B.mean(inf[c["alert"]:peak + 1]))}/min against outflow '
                  f'{num(B.mean(out[c["alert"]:peak + 1]))}/min between {ts[c["alert"]]} and {ts[peak]} — net '
                  f'{signed(B.mean(net[c["alert"]:peak + 1]))}/min for '
                  f'{dur(pack.minutes_between(c["alert"], peak))}.',
                  'A buffer only fills when more arrives than leaves. Everything else about this is working out '
                  'which side of it changed.',
                  spark(net, nice_domain(net, [0], pad=0.2), threshold_value=p['net_per_min'])),
            check('high', 'Level well above its working range', 'required', MATCH,
                  f'{num(lvl[i])} % when flagged at {ts[i]}, peaking at {num(lvl[peak])} % at {ts[peak]}, against a '
                  f'{num(c["lbase"])} % working level ({signed(lvl[peak] - c["lbase"])} points). Alert level is '
                  f'{num(p["rise_pts"], 0)} points above working.',
                  f'{num(rise * p["units_per_pct"], 0)} units of product are now sitting in the buffer instead of '
                  f'moving. At this rate the buffer saturates and the restriction starts blocking Inspection as well.',
                  spark(lvl, yd, threshold_value=c['lbase'] + p['rise_pts'])),
            check('balance', 'The level reading matches the flows', 'required', MATCH,
                  f'The net flow between {ts[onset]} and {ts[i]} accounts for {num(c["pred"])} points of level; the '
                  f'transmitter read {num(c["seen"])} points — {num(100 * abs(c["seen"] - c["pred"]) / abs(c["pred"]))} '
                  f'% apart, against a {num(p["balance_tol_pct"], 0)} % tolerance '
                  f'({num(p["units_per_pct"], 1)} units per %).',
                  'Three instruments have to agree: the two flow meters and the level transmitter. If they do, the '
                  'product really is in the buffer and this is not an indication problem.',
                  spark(lvl, yd, pred_series, pred_series)),
            check('inflow', 'Inflow unchanged — the cause is downstream', 'required', MATCH,
                  f'Inflow averaged {num(median(inf[onset:peak + 1]))}/min against the {num(c["ilocal"])}/min it '
                  f'was running in the hour before (inside ±{num(p["inflow_band_per_min"], 1)}/min) and ranged '
                  f'{num(min(inf[onset:peak + 1]))}–{num(max(inf[onset:peak + 1]))}/min, while outflow fell to '
                  f'{num(min(out[onset:peak + 1]))}/min.',
                  'This is what separates a downstream restriction from an upstream surge. Inspection kept feeding '
                  'the buffer at plan; the buffer could not pass it on.',
                  spark(inf, fd, out, out, threshold_value=c['ibase'])),
            check('risk', 'Saturation risk and dwell time followed', 'supporting',
                  MATCH if risk_ok else NO_MATCH,
                  f'Saturation risk {num(risk[onset])} → {num(max(risk[onset:peak + 1]))}; time in buffer '
                  f'{num(dwell[onset], 1)} → {num(max(dwell[onset:peak + 1]), 1)} min; turnover '
                  f'{num(turns[onset], 2)} → {num(min(turns[onset:peak + 1]), 2)} per hour.',
                  'Dwell time and turnover are computed from the contents, not from the level, so they are a second '
                  'look at the same thing: product is sitting still in there.',
                  spark(risk, nice_domain(risk, pad=0.1), highlight=[ts[onset], ts[peak]])),
            check('output', f'{pack.name(down)} behind target', 'supporting', MATCH if out_ok else NO_MATCH,
                  f'{pack.name(down)} averaged {num(B.mean(dr[c["alert"]:peak + 1]))}/min against a '
                  f'{num(tgt[i], 0)}/min target ({num(out_def)}/min short), lowest {num(min(dr[onset:peak + 1]))}/min. '
                  f'On-time rate {num(on_time[onset])} → {num(min(on_time[onset:peak + 1]))} %.',
                  f'{pack.name(down)} is the station the buffer feeds on the process-flow layer. If it cannot take '
                  f'plan rate, the buffer is where the difference goes.',
                  spark(dr, nice_domain(dr, [tgt[0]], pad=0.1), threshold_value=tgt[0])),
            check('cleared', 'Drained once the restriction was cleared', 'supporting',
                  MATCH if cleared_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; '
                   f'{pack.name(down)} then ran up to {num(max(dr[job[1]:drain_k + 1]))}/min and the level fell '
                   f'{num(lvl[peak])} % → {num(lvl[drain_k])} % by {ts[drain_k]} '
                   f'({num(100 * drain_frac, 0)} % of the rise).' if job else
                   'No closed inspection on the downstream station.'),
                  'Draining needs the downstream station to run *above* plan for a while. That it could, straight '
                  'after the inspection, is the proof the restriction was there and is gone.',
                  spark(lvl, yd, highlight=[ts[job[1]], ts[back]]) if job else None),
        ]
        main = chart('%', yd,
                     [series('lvl', f'{name} level', lvl, 'primary', 1),
                      series('pred', 'Level the flows predict', pred_series, 'expected', 1)],
                     title='What we see',
                     caption=f'{name} level against the level its own inflow and outflow predict '
                             f'({num(p["units_per_pct"], 1)} units per %). They track each other, so the product '
                             f'really is accumulating: about {num(held, 0)} units at the peak.',
                     markers=[marker(ts[c['alert']], 'Net inflow positive'), marker(ts[i], 'Flagged'),
                              marker(ts[peak], f'Peak {num(lvl[peak])} %')]
                     + ([marker(ts[job[1]], 'Restriction cleared')] if job else [])
                     + [marker(ts[back], 'Back to working level')])

        grid = minutes_grid(-20, 160, 10)
        rng = Rng(5507)
        b0 = c['lbase']
        tb, lt, su = [], [], []
        for m in grid:
            x = max(0.0, m)
            tb.append(b0 + min(28.0, 0.31 * x) + rng.gauss(0.4) - (max(0.0, 0.62 * (x - 90)) if x > 90 else 0.0))
            lt.append(min(99.0, b0 + min(57.0, 0.33 * x)) + rng.gauss(0.4))
            su.append(b0 + (min(14.0, 0.45 * x) if x < 40 else max(0.0, 14.0 - 0.33 * (x - 40))) + rng.gauss(0.4))
        live = aligned(lvl, onset, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Buffer level (min from the net flow turning positive)', '%', [20, 100], grid,
                                  'min', a, live, f'{name}, today', 0,
                                  [threshold(b0, 'Working level'), threshold(100, 'Full')])]
        refs = [
            reference('downstream', 'textbook', 'Textbook', 'Downstream restriction, cleared in time',
                      'Inflow steady, outflow a few per minute short, level climbing almost straight. The '
                      'restriction is found and cleared, the downstream station runs above plan for half an hour, '
                      'and the level walks back down.',
                      'match', 'Closest match',
                      [f'{name} rose {num(rise)} points at {signed(B.mean(net[c["alert"]:peak + 1]))}/min net',
                       f'Peak {num(lvl[peak])} %, then back to {num(lvl[back])} %'], mk(tb)),
            reference('late', 'variant', 'What to avoid', 'Restriction left in place',
                      'Nothing is done. The buffer saturates, then it blocks Inspection and Refinement behind it, '
                      'and the whole line is down to the restricted rate — with a full buffer still to empty.',
                      'nomatch', 'Where today was heading',
                      [f'{name} peaked at {num(lvl[peak])} % with {num(100 - lvl[peak])} points to spare',
                       'Past about 90 % the buffer stops absorbing and starts blocking'], mk(lt)),
            reference('surge', 'lookalike', 'Look-alike', 'Upstream catch-up burst',
                      'The level climbs just as fast, but because the *inflow* jumped — an upstream station catching '
                      'up after a stop. It levels off on its own as soon as the burst ends; nothing downstream is '
                      'wrong.',
                      'nomatch', 'Does not match',
                      [f'Inflow here held inside ±{num(p["inflow_band_per_min"], 1)}/min of '
                       f'{num(c["ibase"])}/min all through',
                       f'{pack.name(down)} was {num(out_def)}/min behind plan, which a surge would not explain'],
                      mk(su)),
        ]
        ro = [
            ruled_out('An upstream surge', 'ruled out',
                      f'Inflow averaged {num(median(inf[onset:peak + 1]))}/min against the '
                      f'{num(c["ilocal"])}/min of the hour before — inside '
                      f'±{num(p["inflow_band_per_min"], 1)}/min — and never left '
                      f'{num(min(inf[onset:peak + 1]))}–{num(max(inf[onset:peak + 1]))}/min. The whole net flow '
                      f'came from the outflow side.'),
            ruled_out('A level transmitter reading high', 'ruled out',
                      f'The two flow meters predict {num(c["pred"])} points of rise and the transmitter read '
                      f'{num(c["seen"])}. Three instruments agreeing is not an indication fault, and dwell time and '
                      f'turnover moved with them.'),
            ruled_out('The level controller\'s setpoint', 'ruled out',
                      f'The level controller trims outflow by about 0.3/min per point away from setpoint, so a high '
                      f'level makes it pull *harder*. Outflow still sat {num(out_def)}/min below plan, so the limit '
                      f'is in {pack.name(down)}, not in the controller.'),
            ruled_out('A quality hold inside the buffer', 'unlikely',
                      f'{pack.name(down)} final defect rate stayed at '
                      f'{num(min(pack.series(down, "final_defect_rate")[onset:peak + 1]), 2)}–'
                      f'{num(max(pack.series(down, "final_defect_rate")[onset:peak + 1]), 2)} % and line scrap at '
                      f'{num(max(pack.series(line, "line_scrap_rate")[onset:peak + 1]), 2)} %. Product was held up, '
                      f'not rejected.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'A capacity restriction at {pack.name(down)}: the buffer absorbed what Output '
                                     f'could not release, {num(held, 0)} units at the peak', level,
                                     'Confirmed: the level drained as soon as the restriction was cleared'
                                     if cleared_ok else 'Flows, level and the downstream rate all agree'),
            'rootCauseAssetId': down,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Buffers are not used in the comparison. This is a mass balance on one '
                        f'buffer\'s own flows, so a peer that happens to be filling or draining for its own reasons '
                        f'would only add noise.',
            'confidence': confidence(level,
                                     f'The level, both flow meters, the dwell time and {pack.name(down)}\'s own rate '
                                     f'all tell the same story, and the level fell {num(100 * drain_frac, 0)} % of '
                                     f'the way back within {dur(pack.minutes_between(job[1], drain_k))} of the '
                                     f'restriction being cleared.' if cleared_ok else
                                     'The mass balance closes and the inflow never moved, which puts the cause '
                                     'downstream of the buffer.',
                                     None if cleared_ok else 'Nobody has looked at the downstream station yet.',
                                     None if cleared_ok else 'An inspection finds the restriction, or the level '
                                                             'drains once the station can run above plan again.',
                                     'The downstream station checks out clear — then the outflow valve and the level '
                                     'controller itself are next.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'buffer_level',
                      'formula': f'level[i] = level[i−1] + (in − out) × {pack.step_min} min ÷ '
                                 f'{num(p["units_per_pct"], 1)} units per %',
                      'fittedOn': 'this buffer\'s own inflow and outflow meters'},
            'impact': f'About {num(held, 0)} units held in the buffer at the peak and '
                      f'{dur(max(dwell[onset:peak + 1]))} of dwell instead of '
                      f'{dur(dwell[onset])}. {pack.name(down)} on-time rate dipped to '
                      f'{num(min(on_time[onset:peak + 1]))} %, and the {lname} rolling performance to '
                      f'{num(min(pack.series(line, "line_performance")[onset:peak + 1]), 2)} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Power Charge drive bearing wear — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class ChargerBearingWear(Detector):
    id = 'refinery.charger_bearing_wear'
    explains_items = ('SIT05',)
    name = 'Power Charge drive bearing wear'
    archetype = '05 Component degradation'
    applies_to = 'Power Charge drives'
    summary = ('A Power Charge drive running rougher than the other five chargers and getting worse hour by hour, '
               'while its load — rate, charge demand and motor current — has not changed at all.')
    pipeline = [
        ('Find peers', 'the other five Power Charge drives; they run the same duty on the same product'),
        ('Expected value', 'the peer median vibration plus the steady offset this drive had in the first hour'),
        ('Residual', 'actual minus expected: roughness the other drives do not have'),
        ('Load', 'rate, charge demand and motor current against their own baselines — the load has to be unchanged '
                 'for this to be the machine'),
        ('Checks', 'rougher · climbing · sustained · same load · bearing temperature · energy per unit'),
        ('Conclusion', 'all required checks → raise; bearing temperature agreeing → medium; an inspection would '
                       'make it high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_charge'},
        'inputs': {'vib': 'self.vibration_mms', 'temp': 'self.bearing_temp_c', 'current': 'self.motor_current_a',
                   'charge': 'self.charge_rate', 'rate': 'self.throughput_per_min',
                   'energy': 'self.energy_per_unit', 'health': 'line.system_health_index',
                   'work': 'INSPECTION work items on this station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Power Charge drives'},
        'expected': {'model': 'peer median + own offset', 'target': 'vib',
                     'formula': 'median(peer vibration) + median(own − peer median over baseline_min)',
                     'fitOn': 'peers'},
        'params': {'alert_mms': 0.80, 'watch_mms': 0.40, 'sustain_min': 30, 'baseline_min': 60,
                   'slope_window_min': 120, 'min_slope_mms_per_h': 0.25, 'max_step_mms': 0.35,
                   'load_band_pct': 3.0, 'current_band_pct': 4.0, 'temp_rise_c': 3.0,
                   'energy_rise': 0.08},
        'checks': [
            {'id': 'rough', 'role': 'required', 'rule': 'residual > alert_mms'},
            {'id': 'climbing', 'role': 'required', 'rule': 'slope(vib, slope_window_min) > min_slope_mms_per_h and the largest 5-min step since onset < max_step_mms'},
            {'id': 'sustained', 'role': 'required', 'rule': 'residual > alert_mms for sustain_min'},
            {'id': 'load', 'role': 'required', 'rule': 'rate and charge demand within load_band_pct, motor current within current_band_pct, of their own baselines'},
            {'id': 'temp', 'role': 'supporting', 'independent': True, 'rule': 'bearing temperature up by temp_rise_c since onset'},
            {'id': 'energy', 'role': 'supporting', 'independent': True, 'rule': 'energy per unit up by energy_rise since onset'},
            {'id': 'inspected', 'role': 'supporting', 'independent': True, 'rule': 'a drive inspection on this station has closed'},
        ],
        'ruleOut': ['more load on the drive', 'a loose or failing vibration sensor', 'the charge setpoint',
                    'material variation'],
        'confidence': {'low': 'required checks only', 'medium': 'bearing temperature or energy per unit agrees',
                       'high': 'confirmed by a drive inspection'},
        'references': ['textbook: bearing wear to failure', 'early stage', 'look-alike: vibration from higher load'],
    }

    def candidates(self, pack):
        return pack.of_type('power_charge')

    def _ctx(self, pack, aid):
        p = self.p
        peers = peers_of(pack, aid)
        vib = pack.series(aid, 'vibration_mms')
        pm = peer_median(pack, peers, 'vibration_mms')
        bl = pack.steps(p['baseline_min'])
        off = median([a - b for a, b in zip(vib[:bl], pm[:bl])])
        exp = [None if b is None else b + off for b in pm]
        res = [a - e for a, e in zip(vib, exp)]
        return dict(peers=peers, vib=vib, pm=pm, off=off, exp=exp, res=res)

    def _load_ok(self, pack, aid, i0, i1):
        """Per load signal: its own baseline, the window's median and spread, and whether the
        window sits inside the band. The median is used rather than the extremes so that a
        single short stop elsewhere in the shift cannot make a steady load look variable;
        the count of samples outside the band is reported alongside it."""
        p = self.p
        bl = pack.steps(p['baseline_min'])
        out = {}
        for key, band_pct in (('throughput_per_min', p['load_band_pct']), ('charge_rate', p['load_band_pct']),
                              ('motor_current_a', p['current_band_pct'])):
            v = pack.series(aid, key)
            base = baseline(v, 0, bl - 1)
            win = v[i0:i1 + 1]
            tol = base * band_pct / 100
            outside = [x for x in win if abs(x - base) > tol]
            out[key] = dict(base=base, lo=min(win), hi=max(win), med=median(win), tol=tol,
                            outside=len(outside), n=len(win),
                            ok=abs(median(win) - base) <= tol and len(outside) <= max(1, len(win) // 5))
        return out

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        rough = B.gt(c['res'], p['alert_mms'])
        watch = B.gt(c['res'], p['watch_mms'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(rough, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(c['vib'], i, sw, pack.step_min)
            if slope is None or slope <= p['min_slope_mms_per_h']:
                continue
            if B.max_step(c['vib'], onset, i) >= p['max_step_mms']:
                continue
            load = self._load_ok(pack, aid, onset, i)
            if not all(v['ok'] for v in load.values()):
                continue
            c.update(onset=onset, alert=s0, load=load)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name = st(pack, aid)
        vib, pm, exp, res, off = c['vib'], c['pm'], c['exp'], c['res'], c['off']
        onset, alert = c['onset'], c['alert']
        load = self._load_ok(pack, aid, onset, now)
        slope = B.slope_per_hour(vib, now, pack.steps(p['slope_window_min']), pack.step_min)
        step = B.max_step(vib, onset, now)
        temp = pack.series(aid, 'bearing_temp_c')
        t_rise = temp[now] - baseline(temp, 0, pack.steps(p['baseline_min']) - 1)
        temp_ok = t_rise >= p['temp_rise_c']
        energy = pack.series(aid, 'energy_per_unit')
        e_rise = B.mean(energy[now - pack.steps(60):now + 1]) - baseline(energy, 0, pack.steps(p['baseline_min']) - 1)
        energy_ok = e_rise >= p['energy_rise']
        jobs = [w for w in pack.work if w['assetId'] == aid and w['workType'] == 'INSPECTION']
        done = [w for w in jobs if w.get('done')]
        openj = [w for w in jobs if not w.get('done')]
        inspected_ok = bool(done)
        independent = sum([temp_ok, energy_ok, inspected_ok])
        level = 'high' if inspected_ok else ('medium' if independent else 'low')
        peer_now = [pack.series(q, 'vibration_mms')[now] for q in c['peers']]
        health = pack.series(line, 'system_health_index')
        vd = nice_domain(vib, pm, pad=0.1, floor=0)
        rd = [-1.0, max(1.5, max(res) * 1.2)]

        checks = [
            check('rough', 'Rougher than the other chargers explain', 'required', MATCH,
                  f'{num(vib[now], 2)} mm/s now against {num(exp[now], 2)} mm/s expected '
                  f'({signed(res[now], 2)} mm/s). The other five drives read '
                  f'{num(min(peer_now), 2)}–{num(max(peer_now), 2)} mm/s. Alert level is '
                  f'+{num(p["alert_mms"], 2)} mm/s.',
                  'Six chargers doing the same job on the same two products. Roughness that only one of them has is '
                  'coming from inside that drive train.',
                  spark(res, rd, threshold_value=p['alert_mms'])),
            check('climbing', 'Climbing steadily, not stepping', 'required', MATCH,
                  f'{signed(slope, 2)} mm/s per hour over the last {dur(p["slope_window_min"])}; '
                  f'{num(vib[onset], 2)} → {num(vib[now], 2)} mm/s since {ts[onset]}. Largest 5-minute step '
                  f'{num(step, 2)} mm/s, against a {num(p["max_step_mms"], 2)} mm/s limit.',
                  'Wear accumulates; it does not jump. A loose sensor or a wiring fault shows up as a step.',
                  spark(vib, vd, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained all shift', 'required', MATCH,
                  f'Above +{num(p["alert_mms"], 2)} mm/s since {ts[alert]} '
                  f'({dur(pack.minutes_between(alert, now))}), and above +{num(p["watch_mms"], 2)} mm/s since '
                  f'{ts[onset]}. {dur(p["sustain_min"])} is needed to raise it.',
                  'Load swings and product changes move vibration for a few minutes. Half an hour of it does not '
                  'come and go.',
                  spark(res, rd, threshold_value=p['alert_mms'], highlight=[ts[alert], ts[now]])),
            check('load', 'Load unchanged throughout', 'required', MATCH,
                  f'Median rate {num(load["throughput_per_min"]["med"])}/min against a '
                  f'{num(load["throughput_per_min"]["base"])}/min baseline, charge demand '
                  f'{num(load["charge_rate"]["med"])} % against {num(load["charge_rate"]["base"])} %, motor current '
                  f'{num(load["motor_current_a"]["med"])} A against {num(load["motor_current_a"]["base"])} A — all '
                  f'inside ±{num(p["load_band_pct"], 0)} % (current ±{num(p["current_band_pct"], 0)} %). '
                  + (f'{sum(v["outside"] for v in load.values())} of '
                     f'{sum(v["n"] for v in load.values())} readings sit outside the band, the first of them at '
                     f'{ts[next((k for k in range(onset, pack.n) if pack.series(aid, "throughput_per_min")[k] < load["throughput_per_min"]["base"] - load["throughput_per_min"]["tol"]), onset)]}'
                     f' — the short interruptions on this station that are being looked at separately.'
                     if any(v['outside'] for v in load.values()) else 'No reading outside the band.'),
                  'This is the check that makes it a machine problem. More load means more vibration, legitimately. '
                  'Nothing asked this drive to work harder.',
                  spark(pack.series(aid, 'motor_current_a'), nice_domain(pack.series(aid, 'motor_current_a'), pad=0.3),
                        threshold_value=load['motor_current_a']['base'])),
            check('temp', 'Bearing getting hotter too', 'supporting', MATCH if temp_ok else NO_MATCH,
                  f'{num(temp[now])} °C now, from {num(baseline(temp, 0, pack.steps(60) - 1))} °C over the first '
                  f'hour ({signed(t_rise)} °C). Alert level is +{num(p["temp_rise_c"], 0)} °C.',
                  'A separate sensor on the same housing. A rolling surface that is breaking up rubs as well as '
                  'rattles, so heat and roughness rise together.',
                  spark(temp, nice_domain(temp, pad=0.15))),
            check('energy', 'Taking more energy per unit', 'supporting', MATCH if energy_ok else NO_MATCH,
                  f'{num(B.mean(energy[now - pack.steps(60):now + 1]), 2)} per unit over the last hour against '
                  f'{num(baseline(energy, 0, pack.steps(60) - 1), 2)} over the first ({signed(e_rise, 2)}).',
                  'Friction has to be paid for. The same product costs a little more energy than it did this '
                  'morning, at the same rate.',
                  spark(energy, nice_domain(energy, pad=0.2))),
            check('inspected', 'Confirmed by a drive inspection', 'supporting',
                  MATCH if inspected_ok else PENDING,
                  (f'{done[0]["text"]} ({done[0]["id"]}) closed {done[0]["completedAt"][11:16]}.' if done else
                   (f'{openj[0]["text"]} ({openj[0]["id"]}) started {openj[0]["plannedStart"][11:16]}, due '
                    f'{openj[0]["dueAt"][11:16]} — not closed yet.' if openj else 'No drive inspection raised.')),
                  'Vibration and heat narrow it to the drive train, but only somebody at the machine can tell wear '
                  'from lubrication or from misalignment.',
                  None),
        ]
        main = chart('mm/s', vd,
                     [series('vib', f'{name} vibration', vib, 'primary', 2),
                      series('exp', 'Expected from the other five chargers', exp, 'expected', 2)],
                     title='What we see',
                     caption=f'{name} drive vibration against the other five chargers, plus the '
                             f'{signed(off, 2)} mm/s this drive always ran at. The shaded gap is roughness the load '
                             f'does not explain.',
                     shade_gap=['vib', 'exp'], decimals=2,
                     markers=[marker(ts[onset], 'Divergence begins'),
                              marker(ts[alert], f'Alert +{num(p["alert_mms"], 1)} mm/s'),
                              marker(ts[now], f'{num(vib[now], 2)} mm/s')])

        grid = hours_grid(6, 0.25)
        rng = Rng(7103)
        tb = [0.0 if h == 0 else 0.26 * h + 0.055 * h * h + rng.gauss(0.04) for h in grid]
        tb_t = [60.0 + 1.5 * h + 0.35 * h * h + rng.gauss(0.25) for h in grid]
        ea = [0.10 * h + rng.gauss(0.03) for h in grid]
        ea_t = [60.0 + 0.5 * h + rng.gauss(0.25) for h in grid]
        ld = [(0.9 if 1.0 < h < 3.5 else 0.0) + rng.gauss(0.03) for h in grid]
        ld_t = [60.0 + (3.0 if 1.0 < h < 3.5 else 0.0) + rng.gauss(0.25) for h in grid]
        live_r = aligned(res, onset, pack.step_min, grid)
        live_t = aligned(temp, onset, pack.step_min, grid)
        pair = lambda a, b: [ref_chart('Unexplained vibration (h from onset)', 'mm/s', [-0.5, 3.0], grid, 'h', a,
                                       live_r, f'{name}, today', 2,
                                       [threshold(p['alert_mms'], 'Alert')]),
                             ref_chart('Bearing temperature', '°C', [55, 80], grid, 'h', b, live_t,
                                       f'{name}, today', 0)]
        refs = [
            reference('wear', 'textbook', 'Textbook', 'Bearing wear run to failure',
                      'Roughness and heat climb together and accelerate over a shift or two, until the drive is '
                      'opened at a planned stop and the race is found pitted. Caught here it is a planned swap; '
                      'left alone it is an unplanned line stop.',
                      'match', 'Closest match',
                      [f'Same accelerating shape: {num(vib[onset], 2)} → {num(vib[now], 2)} mm/s',
                       f'Bearing temperature came with it, {signed(t_rise)} °C'], pair(tb, tb_t)),
            reference('early', 'early', 'Early stage', 'Lubricant starting to break down',
                      'A slower, straighter rise with the bearing barely warming. An oil or grease sample catches '
                      'it; vibration alarms do not, because it never gets that far before a regrease fixes it.',
                      'partial', 'Same shape, slower',
                      [f'{name} is past this stage at {num(vib[now], 2)} mm/s',
                       'Worth a grease check at the same visit'], pair(ea, ea_t)),
            reference('load', 'lookalike', 'Look-alike', 'Vibration from higher load',
                      'Roughness up by a similar amount, but only while the charger is pushed hard — it steps up '
                      'with the demand and steps straight back down when the demand does. Nothing is worn.',
                      'nomatch', 'Does not match',
                      [f'Charge demand held {num(load["charge_rate"]["med"])} % on the median all shift',
                       f'Motor current sat at {num(load["motor_current_a"]["med"])} A against a '
                       f'{num(load["motor_current_a"]["base"])} A baseline'], pair(ld, ld_t)),
        ]
        ro = [
            ruled_out('More load on the drive', 'ruled out',
                      f'Rate, charge demand and motor current sat at their baselines right through '
                      f'({num(load["throughput_per_min"]["med"])}/min, {num(load["charge_rate"]["med"])} %, '
                      f'{num(load["motor_current_a"]["med"])} A on the median) while vibration went '
                      f'{num(vib[onset], 2)} → {num(vib[now], 2)} mm/s. Roughness that climbs at constant load is '
                      f'not load.'),
            ruled_out('A loose or failing vibration sensor', 'ruled out' if temp_ok else 'unlikely',
                      f'The rise is gradual — largest 5-minute step {num(step, 2)} mm/s — and the bearing '
                      f'temperature, a separate sensor on the same housing, rose {signed(t_rise)} °C with it.'
                      if temp_ok else
                      f'The rise is gradual: largest 5-minute step {num(step, 2)} mm/s. A loose sensor steps.'),
            ruled_out('The charge setpoint', 'ruled out',
                      f'Charge demand sat at {num(load["charge_rate"]["base"])} % ± '
                      f'{num(p["load_band_pct"], 0)} % and controller output at '
                      f'{num(median(pack.series(aid, "controller_output_pct")))} % through the whole climb. A '
                      f'setpoint change would show in both at the same minute, and in vibration as a step.'),
            ruled_out('Material variation', 'unlikely',
                      f'The {pack.name(line)} Bulk Intake reported input quality '
                      f'{num(min(pack.series(stations(pack, line)[0], "input_quality_score")))}–'
                      f'{num(max(pack.series(stations(pack, line)[0], "input_quality_score")))} and material '
                      f'availability above '
                      f'{num(min(pack.series(stations(pack, line)[0], "material_availability")), 1)} %. Rough '
                      f'material would also show on the other lines running the same product.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     'Progressive wear in the Power Charge drive train — the drive is getting '
                                     'rougher and hotter at a load that has not changed', level,
                                     'Confirmed by inspection' if inspected_ok else
                                     'Vibration and bearing temperature agree; the inspection is still open'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': 'No charger is left out: all six ran all shift, so every one of them counts towards the '
                        'expected value. A charger standing idle would be dropped, because an idle drive does not '
                        'show what normal roughness looks like.',
            'confidence': confidence(level,
                                     'Vibration, bearing temperature and energy per unit are three separate '
                                     'measurements and all three have moved, while every load signal has stayed '
                                     'still.' if (temp_ok or energy_ok) else
                                     'Only the vibration shows it so far.',
                                     f'Nobody has had the drive open yet. {openj[0]["text"]} ({openj[0]["id"]}) '
                                     f'started {openj[0]["plannedStart"][11:16]} and is not closed. From trends '
                                     f'alone, wear, a dry bearing and a slackening coupling look alike.'
                                     if openj else
                                     'From trends alone, wear, a dry bearing and a slackening coupling look alike.',
                                     'The inspection finds wear on the race, or the grease comes back with metal in '
                                     'it.',
                                     'The drive checks out clean — then the vibration sensor mounting and the '
                                     'bearing temperature element are what to look at next.'),
            'action': action(item, pack),
            'model': {'target': 'vibration_mms',
                      'formula': f'median(other eleven chargers) {signed(off, 2)} mm/s (this drive\'s own offset '
                                 f'over the first {dur(p["baseline_min"])})',
                      'fittedOn': f'{len(c["peers"])} peer Power Charge drives'},
            'impact': f'{pack.name(line)} health index {num(baseline(health, 0, 11))} → {num(health[now])} % '
                      f'(about 0.55 points per mm/s of excess roughness) and '
                      f'{signed(e_rise, 2)} energy per unit. No rate lost yet — which is the argument for taking the '
                      f'drive at a planned stop rather than waiting.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Pressure transmitter on a loose connection — archetype 06 (instrument)
# ═════════════════════════════════════════════════════════════════════════
class PressureTransmitterFault(Detector):
    id = 'refinery.pressure_transmitter_fault'
    name = 'Stabilization pressure transmitter reading wrong'
    archetype = '06 Signal noise (instrument)'
    applies_to = 'Stabilization stations'
    summary = ('A Stabilization pressure transmitter jumping around while the local mechanical gauge on the same '
               'vessel, the flow meter and the temperature all sit still. The process did not move; the reading did.')
    pipeline = [
        ('Second tap', 'the local mechanical gauge reads the same pressure through a different tap, so the two '
                       'should track each other'),
        ('Offset', 'the steady difference between transmitter and gauge over the first hour'),
        ('Residual', 'transmitter − gauge − offset: pressure only one of the two can see'),
        ('Jumpiness', 'the largest 5-minute step on each instrument — a connection fault steps, a process swing '
                      'does not'),
        ('Checks', 'disagrees · steps · gauge steady · flow steady · temperature steady · nothing downstream reacts'),
        ('Conclusion', 'the instrument, not the process; a field check against the gauge → high confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'stabilization'},
        'inputs': {'xmtr': 'self.process_pressure_psi', 'gauge': 'self.local_gauge_pressure_psi',
                   'flow': 'self.flow_rate_per_min', 'temp': 'self.temperature_c',
                   'effort': 'self.control_effort', 'dev': 'self.deviation',
                   'rate': 'self.throughput_per_min', 'down': 'targets[process_flow] throughput_per_min',
                   'work': 'done INSTRUMENT_CHECK work items on this station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Stabilization stations (sanity check only)'},
        'expected': {'model': 'second instrument', 'target': 'xmtr',
                     'formula': 'local_gauge_pressure_psi + median(xmtr − gauge over baseline_min)',
                     'fitOn': 'the station\'s own gauge'},
        'params': {'res_psi': 3.0, 'step_psi': 3.0, 'window_min': 15, 'baseline_min': 60,
                   'gauge_step_psi': 1.2, 'gauge_range_psi': 2.5, 'local_min': 60,
                   'flow_band_per_min': 3.0, 'temp_band_c': 1.0,
                   'effort_band_pct': 2.0, 'down_band_per_min': 3.0, 'settle_min': 30},
        'checks': [
            {'id': 'disagrees', 'role': 'required', 'rule': '|xmtr − gauge − offset| > res_psi'},
            {'id': 'steps', 'role': 'required', 'rule': 'largest xmtr step inside window_min > step_psi while the gauge\'s largest step < gauge_step_psi'},
            {'id': 'gauge', 'role': 'required', 'rule': 'the gauge\'s whole range over the episode < gauge_range_psi (it drifts slowly with the vessel, so a fixed morning baseline would not do)'},
            {'id': 'flow', 'role': 'supporting', 'independent': True, 'rule': 'flow meter inside ±flow_band_per_min of its baseline'},
            {'id': 'temp', 'role': 'supporting', 'independent': True, 'rule': 'temperature inside ±temp_band_c of its baseline'},
            {'id': 'loop', 'role': 'supporting', 'rule': 'control effort inside ±effort_band_pct — the loop did not act on the reading'},
            {'id': 'downstream', 'role': 'supporting', 'rule': 'the next station down the line holds rate within down_band_per_min'},
            {'id': 'reseated', 'role': 'supporting', 'independent': True, 'rule': 'the residual settles within settle_min of the instrument check closing'},
        ],
        'ruleOut': ['a real pressure swing', 'the pressure controller hunting', 'a blocked impulse line',
                    'the gauge being the wrong one'],
        'confidence': {'low': 'required checks only', 'medium': 'flow or temperature agrees (independent sensor)',
                       'high': 'confirmed by a field check against the local gauge'},
        'references': ['textbook: loose transmitter connection', 'variant: transmitter drifting',
                       'look-alike: real pressure oscillation'],
    }

    def candidates(self, pack):
        return pack.of_type('stabilization')

    def _ctx(self, pack, aid):
        p = self.p
        x = pack.series(aid, 'process_pressure_psi')
        g = pack.series(aid, 'local_gauge_pressure_psi')
        bl = pack.steps(p['baseline_min'])
        off = median([a - b for a, b in zip(x[:bl], g[:bl])])
        exp = [v + off for v in g]
        res = [a - e for a, e in zip(x, exp)]
        return dict(x=x, g=g, off=off, exp=exp, res=res, gbase=baseline(g, 0, bl - 1), glocal=None)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        w = pack.steps(p['window_min'])
        for i in range(1, pack.n):
            if abs(c['res'][i]) <= p['res_psi']:
                continue
            xs = B.max_step(c['x'], max(1, i - w + 1), i)
            gs = B.max_step(c['g'], max(1, i - w + 1), i)
            if xs <= p['step_psi'] or gs >= p['gauge_step_psi']:
                continue
            ep = [k for k in range(pack.n) if abs(c['res'][k]) > p['res_psi'] / 3]
            onset, end = min(ep), max(ep)
            lw = pack.steps(p['local_min'])
            glocal = median(c['g'][max(0, onset - lw):min(pack.n, end + lw + 1)])
            if max(c['g'][onset:end + 1]) - min(c['g'][onset:end + 1]) > p['gauge_range_psi']:
                continue
            c.update(onset=onset, end=end, xstep=xs, gstep=gs, glocal=glocal)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name = st(pack, aid)
        x, g, exp, res, off = c['x'], c['g'], c['exp'], c['res'], c['off']
        onset, end = c['onset'], c['end']
        worst = max(range(pack.n), key=lambda k: abs(res[k]))
        flow = pack.series(aid, 'flow_rate_per_min')
        tempc = pack.series(aid, 'temperature_c')
        eff = pack.series(aid, 'control_effort')
        bl = pack.steps(p['baseline_min'])
        fbase, tbase, ebase = baseline(flow, 0, bl - 1), baseline(tempc, 0, bl - 1), baseline(eff, 0, bl - 1)
        fdev = max(abs(v - fbase) for v in flow[onset:end + 1])
        tdev = max(abs(v - tbase) for v in tempc[onset:end + 1])
        edev = max(abs(v - ebase) for v in eff[onset:end + 1])
        flow_ok = fdev <= p['flow_band_per_min']
        temp_ok = tdev <= p['temp_band_c']
        loop_ok = edev <= p['effort_band_pct']
        down = nxt(pack, aid)
        dr = rate(pack, down)
        dbase = baseline(dr, 0, bl - 1)
        down_ok = max(abs(v - dbase) for v in dr[onset:end + 1]) <= p['down_band_per_min']
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == aid and w['workType'] == 'INSTRUMENT_CHECK' and w.get('completedAt')]
        job = jobs[0] if jobs else None
        settled_ok = False
        if job:
            k0 = job[1]
            span = range(k0, min(pack.n, k0 + pack.steps(p['settle_min']) + 1))
            settled_ok = all(abs(res[k]) <= p['res_psi'] / 3 for k in span)
        independent = sum([flow_ok, temp_ok, settled_ok])
        level = 'high' if settled_ok else ('medium' if independent else 'low')
        xd = nice_domain(x, g, pad=0.08)
        rd = nice_domain(res, [-p['res_psi'] - 1, p['res_psi'] + 1], pad=0.1)

        checks = [
            check('disagrees', 'Transmitter and gauge disagree', 'required', MATCH,
                  f'{num(x[worst])} psi on the transmitter against {num(g[worst])} psi on the local gauge at '
                  f'{ts[worst]} — {signed(res[worst])} psi once the usual {signed(off, 2)} psi between the two taps '
                  f'is taken out. Alert level is ±{num(p["res_psi"], 0)} psi.',
                  'Both instruments read the same vessel through different taps. They cannot both be right, and the '
                  'mechanical gauge has nothing electrical to go wrong with.',
                  spark(res, rd, threshold_value=p['res_psi'])),
            check('steps', 'It steps, it does not swing', 'required', MATCH,
                  f'Largest 5-minute step on the transmitter {num(c["xstep"])} psi (within {dur(p["window_min"])} of '
                  f'{ts[i]}); on the gauge {num(c["gstep"], 2)} psi. Readings ran '
                  f'{num(min(x[onset:end + 1]))}–{num(max(x[onset:end + 1]))} psi over '
                  f'{dur(pack.minutes_between(onset, end))}.',
                  'Pressure in a vessel of this size cannot move 15 psi and back inside five minutes — there is far '
                  'too much to push around. A connection that makes and breaks can.',
                  spark(diffs(x), nice_domain(diffs(x), [-p['step_psi'], p['step_psi']], pad=0.1),
                        threshold_value=p['step_psi'])),
            check('gauge', 'Local gauge never moved', 'required', MATCH,
                  f'{num(min(g[onset:end + 1]))}–{num(max(g[onset:end + 1]))} psi through the whole episode, against '
                  f'{num(c["glocal"])} psi either side of it — a range of '
                  f'{num(max(g[onset:end + 1]) - min(g[onset:end + 1]), 2)} psi against a '
                  f'{num(p["gauge_range_psi"], 1)} psi limit, while the transmitter covered '
                  f'{num(max(x[onset:end + 1]) - min(x[onset:end + 1]))} psi.',
                  'This is the whole case. The gauge is the independent witness, and it says the pressure was '
                  'steady.',
                  spark(g, xd, threshold_value=c['glocal'])),
            check('flow', 'Flow meter steady', 'supporting', MATCH if flow_ok else NO_MATCH,
                  f'{num(min(flow[onset:end + 1]))}–{num(max(flow[onset:end + 1]))}/min against a '
                  f'{num(fbase)}/min baseline (±{num(fdev, 1)}/min at worst).',
                  'A pressure swing of that size would have pushed the flow about. A separate meter, and it did not '
                  'move.',
                  spark(flow, nice_domain(flow, pad=0.15), highlight=[ts[onset], ts[end]])),
            check('temp', 'Temperature steady', 'supporting', MATCH if temp_ok else NO_MATCH,
                  f'{num(min(tempc[onset:end + 1]), 1)}–{num(max(tempc[onset:end + 1]), 1)} °C against '
                  f'{num(tbase, 1)} °C (±{num(tdev, 2)} °C).',
                  'Pressure and temperature move together in a stabilising stream. One without the other points at '
                  'the instrument.',
                  spark(tempc, nice_domain(tempc, pad=0.2), highlight=[ts[onset], ts[end]])),
            check('loop', 'The control loop did not chase it', 'supporting', MATCH if loop_ok else NO_MATCH,
                  f'Control effort {num(min(eff[onset:end + 1]))}–{num(max(eff[onset:end + 1]))} against a '
                  f'{num(ebase)} baseline (±{num(edev, 2)}), deviation never above '
                  f'{num(max(pack.series(aid, "deviation")[onset:end + 1]), 2)}.',
                  'Worth knowing before trusting the next reading: the loop rode through it, so nothing was done to '
                  'the process on the strength of a bad number.',
                  spark(eff, nice_domain(eff, pad=0.2), highlight=[ts[onset], ts[end]])),
            check('downstream', f'{pack.name(down)} unaffected', 'supporting', MATCH if down_ok else NO_MATCH,
                  f'{pack.name(down)} held {num(min(dr[onset:end + 1]))}–{num(max(dr[onset:end + 1]))}/min '
                  f'against a {num(dbase)}/min baseline; {pack.name(line)} throughput '
                  f'{num(min(pack.series(line, "line_throughput")[onset:end + 1]))}–'
                  f'{num(max(pack.series(line, "line_throughput")[onset:end + 1]))}/min.',
                  'Nothing downstream noticed, which is what you would expect if nothing actually happened.',
                  spark(dr, nice_domain(dr, pad=0.15), highlight=[ts[onset], ts[end]])),
            check('reseated', 'Settled after the field check', 'supporting',
                  MATCH if settled_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; the two instruments '
                   f'have agreed within {num(max(abs(res[k]) for k in range(job[1], pack.n)), 2)} psi ever since.'
                   if job else 'No instrument check on this station.'),
                  'Reseating a connection is not a process change. If the reading comes right and nothing else '
                  'moves, the connection was the fault.',
                  spark(res, rd, highlight=[ts[job[1]], ts[now]]) if job else None),
        ]
        main = chart('psi', xd,
                     [series('x', f'{name} transmitter', x, 'primary', 1),
                      series('exp', f'Local gauge {signed(off, 2)} psi (same vessel)', exp, 'expected', 1)],
                     title='What we see',
                     caption=f'The transmitter against the local mechanical gauge on the same vessel. For '
                             f'{dur(pack.minutes_between(onset, end))} the transmitter wandered '
                             f'{num(min(x[onset:end + 1]))}–{num(max(x[onset:end + 1]))} psi while the gauge held '
                             f'{num(min(g[onset:end + 1]))}–{num(max(g[onset:end + 1]))} psi.',
                     markers=[marker(ts[onset], 'Noise begins'), marker(ts[i], 'Flagged'),
                              marker(ts[worst], f'Peak {num(x[worst])} psi')]
                     + ([marker(ts[job[1]], 'Reseated')] if job else []))

        grid = minutes_grid(-15, 75, 5)
        rng = Rng(6197)
        base_p = c['glocal'] + off
        tb, dr_ref, osc = [], [], []
        for m in grid:
            inside = 0 <= m <= 30
            tb.append(base_p + ((rng.gauss(1.0) + (6.0 if (m // 5) % 3 == 0 else -3.0)) if inside else rng.gauss(0.3)))
            dr_ref.append(base_p + (0.0 if m < 0 else 0.22 * m) + rng.gauss(0.3))
            osc.append(base_p + (3.2 * math.sin(2 * math.pi * m / 20.0) if inside else 0.0) + rng.gauss(0.3))
        live = aligned(x, onset, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Pressure reading (min from onset)', 'psi', [base_p - 8, base_p + 20], grid,
                                  'min', a, live, f'{name}, today', 0)]
        refs = [
            reference('loose', 'textbook', 'Textbook', 'Loose transmitter connection',
                      'Readings jump in both directions by several psi with no pattern, for as long as the '
                      'connection is intermittent, and everything else on the vessel sits still. Reseating it ends '
                      'it on the spot.',
                      'match', 'Closest match',
                      [f'Same both-ways jumps: {num(min(x[onset:end + 1]))}–{num(max(x[onset:end + 1]))} psi',
                       f'Largest step {num(c["xstep"])} psi with the gauge inside {num(c["gstep"], 2)} psi'], mk(tb)),
            reference('drift', 'variant', 'Variant', 'Transmitter drifting',
                      'The same instrument failing differently: the reading creeps away from the gauge in one '
                      'direction and stays there. Easy to believe, and therefore easy to act on by mistake.',
                      'partial', 'Same family, different shape',
                      ['A drift is a straight line; this went up and down',
                       'Both are found the same way — against the local gauge'], mk(dr_ref)),
            reference('real', 'lookalike', 'Look-alike', 'Real pressure oscillation',
                      'A genuine swing of this size: the gauge swings with it, the flow meter swings with it, the '
                      'control loop fights it and the station loses rate. Everything moves, not just the number.',
                      'nomatch', 'Does not match',
                      [f'The gauge held {num(min(g[onset:end + 1]))}–{num(max(g[onset:end + 1]))} psi',
                       f'Flow stayed inside ±{num(fdev, 1)}/min and rate never left its band'], mk(osc)),
        ]
        ro = [
            ruled_out('A real pressure swing', 'ruled out',
                      f'The local gauge on the same vessel stayed inside {num(c["gstep"], 2)} psi and the flow meter '
                      f'inside ±{num(fdev, 1)}/min. A {num(abs(res[worst]))} psi excursion that three other '
                      f'instruments cannot see did not happen.'),
            ruled_out('The pressure controller hunting', 'ruled out',
                      f'Control effort moved by at most {num(edev, 2)} and deviation never exceeded '
                      f'{num(max(pack.series(aid, "deviation")[onset:end + 1]), 2)}. A hunting loop shows as a '
                      f'regular period in effort first; there is nothing there.'),
            ruled_out('A blocked impulse line', 'unlikely',
                      'A plugged tap makes the reading go quiet and lag, not jump about. This one moved further and '
                      'faster than the process can, which is the opposite symptom.'),
            ruled_out('The gauge being the wrong one', 'ruled out' if settled_ok else 'unlikely',
                      f'The field check compared the two on the spot and reseated the transmitter; the two have '
                      f'agreed within {num(max(abs(res[k]) for k in range(job[1], pack.n)), 2)} psi since.'
                      if job else
                      'The gauge agreed with the transmitter before and after the episode, so it is reading the '
                      'vessel correctly.'),
        ]
        return {
            'conclusion': conclusion('Cause',
                                     'The pressure transmitter, not the pressure — an intermittent connection on '
                                     'the transmitter', level,
                                     'Confirmed against the local gauge in the field' if settled_ok else
                                     'Three independent instruments say the process never moved'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Stabilization stations are not part of the judgement — each vessel runs its '
                        f'own pressure. They are only a sanity check that {num(p["res_psi"], 0)} psi is a big number '
                        f'here: across all six stations the transmitter and its gauge normally agree to within about '
                        f'{num(max(abs(v) for v in res[:pack.steps(60)]), 2)} psi.',
            'confidence': confidence(level,
                                     'The gauge, the flow meter and the temperature are three separate measurements '
                                     'on the same vessel and none of them moved, and the reading came right as soon '
                                     'as the connection was reseated.' if settled_ok else
                                     'The gauge, the flow meter and the temperature all say the process was steady.',
                                     None if settled_ok else 'Nobody has been to the transmitter yet.',
                                     None if settled_ok else 'A field comparison against the local gauge.',
                                     'The gauge turns out to be wrong as well — then it is the vessel, and the '
                                     'stabilising loop needs checking.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'process_pressure_psi',
                      'formula': f'local_gauge_pressure_psi {signed(off, 2)} psi (the offset between the two taps '
                                 f'over the first {dur(p["baseline_min"])})',
                      'fittedOn': 'this station\'s own mechanical gauge'},
            'impact': f'None on product. {dur(pack.minutes_between(onset, end))} of pressure indication that could '
                      f'not be trusted, on a station whose job is to hold pressure steady — the risk was somebody '
                      f'acting on it, not the process itself.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Inspection rejects with the cause upstream — archetype 07 (ghost signal)
# ═════════════════════════════════════════════════════════════════════════
class InspectionRejectsUpstream(Detector):
    id = 'refinery.inspection_rejects_upstream'
    name = 'Inspection rejects caused upstream at Refinement'
    archetype = '07 Ghost signal (cause upstream)'
    applies_to = 'Inspection gates'
    summary = ('An Inspection gate rejecting several times more than usual while its own calibration and measurement '
               'noise stay clean, and the Refinement station feeding it lost purity first. The gate is where it '
               'shows, not where it is.')
    pipeline = [
        ('Gate health', 'calibration score, measurement noise and false-reject rate against their own baselines — '
                        'is the gate itself sound?'),
        ('Upstream', 'the Refinement station that feeds it on the process_flow layer'),
        ('Timing', 'when purity left its band against when rejects left theirs; the lead decides which caused which'),
        ('Checks', 'rejects up · gate healthy · purity fell first · quality tags followed · scrap followed · '
                   'fixed upstream'),
        ('Conclusion', 'the upstream station is the cause; adjusting the gate would only hide it'),
    ]
    definition = {
        'appliesTo': {'assetType': 'inspection'},
        'inputs': {'rej': 'self.reject_rate_pct', 'cal': 'self.calibration_score',
                   'noise': 'self.measurement_noise', 'false': 'self.false_reject_rate',
                   'fpy': 'self.first_pass_yield',
                   'up': 'sources[process_flow] (Refinement): purity_pct, defect_rate, yield_rate, consistency_index',
                   'scrap': 'line.line_scrap_rate',
                   'work': 'done QUALITY_CHECK work items on this gate (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Inspection gates'},
        'expected': {'model': 'own baseline and peers', 'target': 'rej',
                     'formula': 'median(own reject rate over baseline_min), cross-checked against the peer band',
                     'fitOn': 'self + peers'},
        'params': {'rise_pct': 1.50, 'ratio': 1.8, 'sustain_min': 15, 'baseline_min': 60,
                   'cal_band': 0.25, 'noise_band': 0.60, 'false_band': 0.40, 'gate_local_min': 60,
                   'purity_drop_pct': 0.15, 'min_lead_min': 10, 'max_lead_min': 60,
                   'fpy_drop_pct': 2.0, 'scrap_rise': 0.20, 'recover_frac': 0.6, 'recover_within_min': 45},
        'checks': [
            {'id': 'rejects', 'role': 'required', 'rule': 'reject rate > baseline + rise_pct and > ratio × baseline for sustain_min'},
            {'id': 'gate', 'role': 'required', 'rule': 'over the episode, mean calibration within cal_band, mean measurement noise within noise_band and mean false-reject rate within false_band of the same tag\'s median over the gate_local_min before it'},
            {'id': 'upstream', 'role': 'required', 'rule': 'the feeding Refinement\'s purity falls purity_drop_pct below baseline, and starts between min_lead_min and max_lead_min before the rejects do'},
            {'id': 'quality', 'role': 'supporting', 'independent': True, 'rule': 'the same Refinement\'s defect rate, yield and consistency move with the purity'},
            {'id': 'carried', 'role': 'supporting', 'independent': True, 'rule': 'first-pass yield falls fpy_drop_pct and line scrap rises scrap_rise — the rejects are real product'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'rejects fall back ≥ recover_frac within recover_within_min of the upstream adjustment'},
        ],
        'ruleOut': ['the gate\'s calibration', 'the gate being set too tight', 'a single bad lot',
                    'Inspection measurement noise'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'an independent quality check confirmed the rejects, and they fell after the upstream '
                               'adjustment'},
        'references': ['textbook: upstream purity loss', 'variant: gate calibration drift',
                       'look-alike: gate set too tight'],
    }

    def candidates(self, pack):
        return pack.of_type('inspection')

    def _ctx(self, pack, aid):
        p = self.p
        bl = pack.steps(p['baseline_min'])
        rej = pack.series(aid, 'reject_rate_pct')
        return dict(rej=rej, rbase=baseline(rej, 0, bl - 1), bl=bl)

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        rej, rbase = c['rej'], c['rbase']
        up = prv(pack, aid)
        if up is None or not pack.has(up, 'purity_pct'):
            return Finding(aid, False)
        pur = pack.series(up, 'purity_pct')
        pbase = baseline(pur, 0, c['bl'] - 1)
        high = [v > rbase + p['rise_pct'] and v > rbase * p['ratio'] for v in rej]
        lowp = [v < pbase - p['purity_drop_pct'] for v in pur]
        for i in range(pack.n):
            s0 = B.sustained_since(high, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            cal = pack.series(aid, 'calibration_score')
            noise = pack.series(aid, 'measurement_noise')
            fr = pack.series(aid, 'false_reject_rate')
            ok = True
            lw = pack.steps(p['gate_local_min'])
            for key, v, bandw in (('cal', cal, p['cal_band']), ('noise', noise, p['noise_band']),
                                  ('false', fr, p['false_band'])):
                base = median(v[max(0, s0 - lw):s0]) if s0 else baseline(v, 0, c['bl'] - 1)
                if abs(B.mean(v[s0:i + 1]) - base) > bandw:
                    ok = False
            if not ok:
                continue
            p0 = B.sustained_since(lowp, i) if lowp[i] else None
            if p0 is None:
                p0 = next((k for k in range(s0, -1, -1) if lowp[k]), None)
                if p0 is not None:
                    p0 = B.sustained_since(lowp, p0)
            if p0 is None:
                continue
            lead = pack.minutes_between(p0, s0)
            if not (p['min_lead_min'] <= lead <= p['max_lead_min']):
                continue
            c.update(up=up, pur=pur, pbase=pbase, alert=s0, p0=p0, lead=lead)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        rej, rbase, up, pur, pbase = c['rej'], c['rbase'], c['up'], c['pur'], c['pbase']
        alert, p0 = c['alert'], c['p0']
        peak = max(range(alert, pack.n), key=lambda k: rej[k])
        end = next((k for k in range(peak, pack.n) if rej[k] <= rbase + p['rise_pct'] / 2), pack.now)
        pmin = min(range(p0, end + 1), key=lambda k: pur[k])
        cal = pack.series(aid, 'calibration_score')
        noise = pack.series(aid, 'measurement_noise')
        fr = pack.series(aid, 'false_reject_rate')
        fpy = pack.series(aid, 'first_pass_yield')
        scrap = pack.series(line, 'line_scrap_rate')
        bl = c['bl']
        lw = pack.steps(p['gate_local_min'])
        local = lambda v, k: median(v[max(0, k - lw):k]) if k else baseline(v, 0, bl - 1)
        defect = pack.series(up, 'defect_rate')
        yld = pack.series(up, 'yield_rate')
        cons = pack.series(up, 'consistency_index')
        quality_ok = (max(defect[p0:end + 1]) > baseline(defect, 0, bl - 1) + 0.2
                      and min(yld[p0:end + 1]) < baseline(yld, 0, bl - 1) - 0.5
                      and min(cons[p0:end + 1]) < baseline(cons, 0, bl - 1) - 0.8)
        fpy_drop = baseline(fpy, 0, bl - 1) - min(fpy[alert:end + 1])
        scrap_rise = max(scrap[alert:end + 1]) - baseline(scrap, 0, bl - 1)
        carried_ok = fpy_drop >= p['fpy_drop_pct'] and scrap_rise >= p['scrap_rise']
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == aid and w.get('done') and w.get('completedAt')]
        job = jobs[0] if jobs else None
        rec_frac, rec_k = 0.0, None
        if job:
            span = range(job[1], min(pack.n, job[1] + pack.steps(p['recover_within_min']) + 1))
            rec_k = min(span, key=lambda k: rej[k])
            rec_frac = (rej[peak] - rej[rec_k]) / (rej[peak] - rbase) if rej[peak] > rbase else 0.0
        fixed_ok = job is not None and rec_frac >= p['recover_frac']
        independent = sum([quality_ok, carried_ok, fixed_ok])
        level = 'high' if (fixed_ok and carried_ok) else ('medium' if independent else 'low')
        peers = peers_of(pack, aid)
        plo, pmed, phi = [], [], []
        for k in range(pack.n):
            vals = [pack.series(q, 'reject_rate_pct')[k] for q in peers]
            plo.append(min(vals)); pmed.append(statistics.median(vals)); phi.append(max(vals))
        rd = nice_domain(rej, phi, pad=0.1, floor=0)
        pd = nice_domain(pur, [pbase], pad=0.3)
        extra = sum(max(0.0, rej[k] - rbase) for k in range(alert, end + 1)) / 100 * \
            B.mean(rate(pack, aid)[alert:end + 1]) * pack.step_min

        checks = [
            check('rejects', 'Rejecting several times its usual share', 'required', MATCH,
                  f'{num(rej[i], 2)} % when flagged at {ts[i]}, peaking at {num(rej[peak], 2)} % at {ts[peak]}, '
                  f'against a {num(rbase, 2)} % baseline — {num(rej[peak] / rbase, 1)}× normal. The other five gates '
                  f'read {num(plo[peak], 2)}–{num(phi[peak], 2)} % at the same moment.',
                  'The gate is doing its job: it is stopping product. The question is only whether the product or '
                  'the gate changed.',
                  spark(rej, rd, plo, phi, threshold_value=rbase + p['rise_pct'])),
            check('gate', 'The gate itself is healthy', 'required', MATCH,
                  f'Over the episode, calibration averaged {num(B.mean(cal[alert:end + 1]), 2)} against '
                  f'{num(local(cal, alert), 2)} in the hour before (±{num(p["cal_band"], 2)} allowed); measurement '
                  f'noise {num(B.mean(noise[alert:end + 1]), 2)} against {num(local(noise, alert), 2)}; '
                  f'false-reject rate {num(B.mean(fr[alert:end + 1]), 2)} % against '
                  f'{num(local(fr, alert), 2)} %. All three inside band.',
                  'If the gate had drifted, its calibration score would have moved and its false-reject rate with '
                  'it. Neither did, so the rejects are product, not measurement.',
                  spark(cal, nice_domain(cal, pad=0.3), threshold_value=baseline(cal, 0, bl - 1))),
            check('upstream', f'{pack.name(up)} lost purity first', 'required', MATCH,
                  f'Purity left its band at {ts[p0]} and the rejects left theirs at {ts[alert]} — '
                  f'{dur(c["lead"])} later. Purity {num(pbase, 2)} % → {num(pur[pmin], 2)} % by {ts[pmin]}.',
                  'Product takes 10–15 minutes to get from Refinement to the gate. Cause has to come before effect '
                  'by about that much, and it did.',
                  spark(pur, pd, threshold_value=pbase - p['purity_drop_pct'], highlight=[ts[p0], ts[alert]])),
            check('quality', f'{pack.name(up)}\'s other quality tags moved with it', 'supporting',
                  MATCH if quality_ok else NO_MATCH,
                  f'Defect rate {num(baseline(defect, 0, bl - 1), 2)} → {num(max(defect[p0:end + 1]), 2)}, yield '
                  f'{num(baseline(yld, 0, bl - 1), 2)} → {num(min(yld[p0:end + 1]), 2)}, consistency '
                  f'{num(baseline(cons, 0, bl - 1), 2)} → {num(min(cons[p0:end + 1]), 2)}.',
                  'Four tags on the upstream station, all saying the same thing at the same time. One drifting tag '
                  'would be an instrument; four is the process.',
                  spark(defect, nice_domain(defect, pad=0.2), highlight=[ts[p0], ts[end]])),
            check('carried', 'The rejects were real product', 'supporting', MATCH if carried_ok else NO_MATCH,
                  f'First-pass yield {num(baseline(fpy, 0, bl - 1))} → {num(min(fpy[alert:end + 1]))} % '
                  f'(−{num(fpy_drop)} points) and {lname} scrap {num(baseline(scrap, 0, bl - 1), 2)} → '
                  f'{num(max(scrap[alert:end + 1]), 2)} %. About {num(extra, 0)} units rejected over and above '
                  f'normal.',
                  'Scrap is weighed, not inferred. Product that is actually scrapped was not a false reject.',
                  spark(fpy, nice_domain(fpy, pad=0.1))),
            check('fixed', 'Rejects fell when the upstream station was adjusted', 'supporting',
                  MATCH if fixed_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; rejects '
                   f'{num(rej[peak], 2)} % → {num(rej[rec_k], 2)} % by {ts[rec_k]} '
                   f'({num(100 * rec_frac, 0)} % of the rise), purity back to {num(pur[rec_k], 2)} %.'
                   if job else 'No quality check on this gate.'),
                  'Nothing was touched at the gate. The rejects went away when the upstream condition did, which '
                  'settles which end the fault was at.',
                  spark(rej, rd, highlight=[ts[job[1]], ts[end]]) if job else None),
        ]
        main = chart('%', rd,
                     [series('rej', f'{name} reject rate', rej, 'primary', 2),
                      series('pmed', 'Other five gates (median)', pmed, 'expected', 2)],
                     title='What we see',
                     caption=f'{name} reject rate against the other five gates. Peak {num(rej[peak], 2)} % at '
                             f'{ts[peak]} — {num(rej[peak] / rbase, 1)}× this gate\'s own {num(rbase, 2)} % '
                             f'baseline — starting {dur(c["lead"])} after {pack.name(up)} purity left its band.',
                     band=band('Other five gates', plo, phi),
                     markers=[marker(ts[p0], f'{pack.name(up)} purity falls'),
                              marker(ts[alert], 'Rejects rise'), marker(ts[peak], f'Peak {num(rej[peak], 2)} %')]
                     + ([marker(ts[job[1]], f'{pack.name(up)} adjusted')] if job else []))

        grid = minutes_grid(-30, 120, 10)
        rng = Rng(8231)
        tb_r, tb_p, cd_r, cd_p, tt_r, tt_p = [], [], [], [], [], []
        for m in grid:
            x = max(0.0, m)
            tb_r.append(rbase + (0.0 if m < 15 else min(5.0, 0.085 * (x - 15))) + rng.gauss(0.08)
                        - (max(0.0, 0.09 * (x - 70)) if x > 70 else 0.0))
            tb_p.append(pbase - min(0.6, 0.009 * x) + rng.gauss(0.01) + (min(0.6, 0.009 * x) if x > 75 else 0.0))
            cd_r.append(rbase + (0.0 if m < 0 else min(4.5, 0.05 * x)) + rng.gauss(0.08))
            cd_p.append(pbase + rng.gauss(0.01))
            tt_r.append(rbase + (0.0 if m < 0 else 4.0) + rng.gauss(0.08))
            tt_p.append(pbase + rng.gauss(0.01))
        live_r = aligned(rej, p0, pack.step_min, grid, 'min')
        live_p = aligned(pur, p0, pack.step_min, grid, 'min')
        pair = lambda a, b: [ref_chart('Reject rate (min from the upstream purity falling)', '%', [0, 9], grid,
                                       'min', a, live_r, f'{name}, today', 1),
                             ref_chart('Upstream purity', '%', [98.2, 99.6], grid, 'min', b, live_p,
                                       f'{pack.name(up)}, today', 2)]
        refs = [
            reference('upstream', 'textbook', 'Textbook', 'Upstream purity loss seen at the gate',
                      'Purity slides first; 10–15 minutes later the gate starts rejecting, and the two curves are '
                      'mirror images with that lag. Adjust the upstream station and both come back together.',
                      'match', 'Closest match',
                      [f'Lead measured at {dur(c["lead"])}, inside the {p["min_lead_min"]}–'
                       f'{p["max_lead_min"]} min transport window',
                       f'Gate calibration never moved from {num(baseline(cal, 0, bl - 1), 2)}'], pair(tb_r, tb_p)),
            reference('caldrift', 'variant', 'Variant', 'Gate calibration drift',
                      'Rejects climb exactly like this, but the upstream purity never moves and the gate\'s own '
                      'calibration score slides with the rejects. The product is fine; the gate is wrong.',
                      'nomatch', 'Does not match',
                      [f'Calibration held {num(min(cal[alert:end + 1]), 2)}–{num(max(cal[alert:end + 1]), 2)} today',
                       f'{pack.name(up)} purity fell {num(pbase - pur[pmin], 2)} %, which a gate fault cannot do'],
                      pair(cd_r, cd_p)),
            reference('tight', 'lookalike', 'Look-alike', 'Gate set too tight',
                      'Somebody narrows the accept window: rejects step up the minute the setting changes and stay '
                      'flat at the new level. The step is instant and square, and nothing upstream moved.',
                      'nomatch', 'Does not match',
                      ['Today the rise was gradual over 35 minutes and then came back',
                       'A tightened window does not recover on its own'], pair(tt_r, tt_p)),
        ]
        ro = [
            ruled_out('The gate\'s calibration', 'ruled out',
                      f'Calibration score sat at {num(min(cal[alert:end + 1]), 2)}–{num(max(cal[alert:end + 1]), 2)} '
                      f'through the whole episode, averaging within {num(p["cal_band"], 2)} of the '
                      f'{num(local(cal, alert), 2)} it read in the hour before, and false rejects never left '
                      f'{num(min(fr[alert:end + 1]), 2)}–{num(max(fr[alert:end + 1]), 2)} %.'),
            ruled_out('The gate being set too tight', 'ruled out',
                      f'A changed accept window steps and stays. This rose over '
                      f'{dur(pack.minutes_between(alert, peak))} and fell back to {num(rej[end], 2)} % by {ts[end]} '
                      f'without anybody touching the gate.'),
            ruled_out('A single bad lot', 'ruled out',
                      f'The elevated rejects ran for {dur(pack.minutes_between(alert, end))} — far longer than one '
                      f'lot takes to pass the gate — and {pack.name(up)}\'s purity, defect rate, yield and '
                      f'consistency were all off for the same stretch.'),
            ruled_out('Inspection measurement noise', 'ruled out',
                      f'Measurement noise stayed at {num(min(noise[alert:end + 1]), 2)}–'
                      f'{num(max(noise[alert:end + 1]), 2)}, and {lname} scrap rose '
                      f'{signed(scrap_rise, 2)} points — noise does not produce scrap.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'A purity loss at {pack.name(up)}, not a problem with the gate — Inspection '
                                     f'is only where it became visible', level,
                                     'Confirmed: an independent check validated the rejects and they fell after the '
                                     'upstream adjustment' if (fixed_ok and carried_ok) else
                                     'Gate healthy, upstream purity fell first'),
            'rootCauseAssetId': up,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Inspection gates are used only as a band for what a normal reject rate '
                        f'looks like today ({num(min(plo))}–{num(max(phi))} %). The timing argument is made inside '
                        f'{lname}, because only this line\'s Refinement feeds this gate.',
            'confidence': confidence(level,
                                     f'The gate\'s own health tags, the upstream quality tags, the first-pass yield '
                                     f'and the weighed scrap are four independent records, and the rejects fell '
                                     f'{num(100 * rec_frac, 0)} % after the upstream adjustment with nothing done at '
                                     f'the gate.' if (fixed_ok and carried_ok) else
                                     'The gate checks out healthy and the upstream purity moved first.',
                                     None if (fixed_ok and carried_ok) else
                                     'The timing argument rests on a 10–15 minute transport lag that is assumed, not '
                                     'measured on this line today.',
                                     None if (fixed_ok and carried_ok) else
                                     'An independent quality check on the rejected product, or recovery after an '
                                     'upstream adjustment.',
                                     'An independent check finds the rejected product in spec — then the gate is '
                                     'over-rejecting after all and the accept window is next.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'reject_rate_pct',
                      'formula': f'this gate\'s own {num(rbase, 2)} % baseline over the first '
                                 f'{dur(p["baseline_min"])}, cross-checked against the other five gates',
                      'fittedOn': f'self plus {len(peers)} peer gates'},
            'impact': f'About {num(extra, 0)} units rejected above normal over '
                      f'{dur(pack.minutes_between(alert, end))}; first-pass yield down to '
                      f'{num(min(fpy[alert:end + 1]))} % and {lname} quality factor to '
                      f'{num(min(pack.series(line, "line_quality_factor")[alert:end + 1]), 2)} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. Gross rate above what the line can take — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class GrossVsEffectiveOutput(Detector):
    id = 'refinery.gross_vs_effective_output'
    name = 'Gross rate above sustainable downstream capacity'
    archetype = '08 Throughput illusion'
    applies_to = 'Power Charge stations'
    summary = ('A Power Charge station pushed above the rate the next station can actually sustain. The headline '
               'number looks healthy, but the difference goes into work in process, blocking time and defects '
               'instead of out of the Output door.')
    pipeline = [
        ('Window', 'a rolling hour — long enough for the difference between gross and shipped to add up to '
                   'something the counters can see through their own noise'),
        ('Gross against shipped', 'this station\'s rate minus the line Output\'s, with the fixed counter bias '
                                  'between the pair removed, added up over the window'),
        ('Where it went', 'the WIP the line gained over the same window — the extra product has to be somewhere'),
        ('Mass balance', 'cumulative gross-minus-shipped against the WIP curve, point by point'),
        ('Checks', 'made more than it shipped · WIP absorbing · Output no better and no worse · balance closes · '
                   'downstream capped · defects up · demand cut'),
        ('Conclusion', 'the gross rate is a number, not product; cut the demand to the sustainable rate'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_charge'},
        'inputs': {'rate': 'self.throughput_per_min', 'charge': 'self.charge_rate',
                   'down': 'targets[process_flow] (Shaping): throughput_per_min, defect_rate, rework_rate',
                   'transfer': 'line transfer: blocking_time', 'out': 'line output.throughput_per_min',
                   'wip': 'line.total_wip and flow_efficiency', 'scrap': 'line.line_scrap_rate',
                   'target': 'line.line_target_rate'},
        'peers': {'same': 'assetType', 'count': 'the other five Power Charge stations (sanity check only)'},
        'expected': {'model': 'downstream pace', 'target': 'rate',
                     'formula': 'downstream 30-min mean rate + the pair\'s own gap over baseline_min',
                     'fitOn': 'the station pair'},
        'params': {'window_min': 60, 'smooth_min': 30, 'bias_min': 120, 'gap_units': 15.0,
                   'wip_rise_lots': 3.0, 'out_gain_per_min': 0.5, 'out_floor_per_min': 3.5,
                   'gap_per_min': 1.2, 'baseline_min': 60, 'block_rise': 0.8,
                   'defect_rise': 0.25, 'scrap_rise': 0.15, 'cut_frac': 0.5, 'balance_r': 0.85},
        'checks': [
            {'id': 'gross', 'role': 'required', 'rule': 'Σ(rate − line Output rate − the pair\'s counter bias) × step over the window > gap_units'},
            {'id': 'wip', 'role': 'required', 'rule': 'line WIP gained ≥ wip_rise_lots across the window'},
            {'id': 'nogain', 'role': 'required', 'rule': 'mean Output rate ≤ its own baseline + out_gain_per_min and never below baseline − out_floor_per_min — the extra never left the line, and nothing collapsed either'},
            {'id': 'balance', 'role': 'required', 'rule': 'cumulative (gross − shipped) correlates with the WIP curve at r > balance_r'},
            {'id': 'blocked', 'role': 'supporting', 'independent': True, 'rule': 'Transfer blocking time up by block_rise'},
            {'id': 'defects', 'role': 'supporting', 'independent': True, 'rule': 'downstream defect and rework rates up by defect_rise, line scrap up by scrap_rise'},
            {'id': 'cut', 'role': 'supporting', 'independent': True, 'rule': 'the gap closes by ≥ cut_frac after the demand is reduced, and WIP drains'},
        ],
        'ruleOut': ['downstream equipment degradation', 'a quality problem making the extra product',
                    'a counting error between the two stations', 'a genuine rate increase'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'the gap closed and WIP drained after the demand was cut'},
        'references': ['textbook: over-pacing into a capped line', 'variant: over-pacing with a buffer to absorb it',
                       'look-alike: a real capacity gain'],
    }

    def candidates(self, pack):
        return pack.of_type('power_charge')

    def _ctx(self, pack, aid):
        p = self.p
        sm = pack.steps(p['smooth_min'])
        bw = pack.steps(p['bias_min'])
        line = line_of(pack, aid)
        down = nxt(pack, aid)
        out_s = pack.descendant_of_type(line, 'output')
        raw, out = rate(pack, aid), rate(pack, out_s)
        bias = median([a - b for a, b in zip(raw[:bw], out[:bw])])
        cum, acc = [], 0.0
        for k in range(pack.n):
            acc += (raw[k] - out[k] - bias) * pack.step_min
            cum.append(acc)
        r = B.rolling_mean(raw, sm)
        rd = B.rolling_mean(rate(pack, down), sm)
        gap = [a - b for a, b in zip(r, rd)]
        gbase = median(gap[:pack.steps(p['baseline_min'])])
        return dict(down=down, out_s=out_s, raw=raw, out=out, bias=bias, cum=cum, r=r, rd=rd,
                    gap=gap, gbase=gbase, excess=[g - gbase for g in gap], sm=sm,
                    obase=median(out[:bw]), wip=pack.series(line, 'total_wip'))

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        w = pack.steps(p['window_min'])
        wip, out, obase, cum = c['wip'], c['out'], c['obase'], c['cum']
        for i in range(w, pack.n):
            s0 = i - w
            if wip[i] - wip[s0] < p['wip_rise_lots']:
                continue
            if B.mean(out[s0:i + 1]) - obase > p['out_gain_per_min']:
                continue
            if min(out[s0:i + 1]) < obase - p['out_floor_per_min']:
                continue
            if cum[i] - cum[s0] < p['gap_units']:
                continue
            rr = pearson(cum[s0:i + 1], wip[s0:i + 1])
            if rr is None or rr < p['balance_r']:
                continue
            slope = B.slope_per_hour(wip, i, w, pack.step_min)
            c.update(alert=s0, wip_slope=slope, balance_r=rr, made=cum[i] - cum[s0])
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        down, gap, excess, gbase = c['down'], c['gap'], c['excess'], c['gbase']
        wip, out, obase, cum = c['wip'], c['out'], c['obase'], c['cum']
        alert = c['alert']
        raw, rawd = c['raw'], rate(pack, down)
        peak = max(range(alert, pack.n), key=lambda k: excess[k])
        end = next((k for k in range(peak, pack.n) if excess[k] <= p['gap_per_min'] / 2), pack.now)
        wip_peak = max(range(alert, pack.n), key=lambda k: wip[k])
        drained = next((k for k in range(wip_peak, pack.n) if wip[k] <= wip[alert] + 1.0), pack.now)
        tgt = target(pack, aid)
        tr = pack.descendant_of_type(line, 'transfer')
        blk = pack.series(tr, 'blocking_time')
        bl = pack.steps(p['baseline_min'])
        blocked_ok = max(blk[alert:peak + 1]) - baseline(blk, 0, bl - 1) >= p['block_rise']
        dd = pack.series(down, 'defect_rate')
        dw = pack.series(down, 'rework_rate')
        scrap = pack.series(line, 'line_scrap_rate')
        defects_ok = (max(dd[alert:peak + 1]) - baseline(dd, 0, bl - 1) >= p['defect_rise']
                      and max(scrap[alert:peak + 1]) - baseline(scrap, 0, bl - 1) >= p['scrap_rise'])
        rec_k = min(range(peak, pack.n), key=lambda k: excess[k])
        cut_frac = (excess[peak] - excess[rec_k]) / excess[peak] if excess[peak] > 0 else 0.0
        cut_ok = cut_frac >= p['cut_frac'] and wip[drained] <= wip[alert] + 1.0
        independent = sum([blocked_ok, defects_ok, cut_ok])
        level = 'high' if cut_ok else ('medium' if independent else 'low')
        flow_eff = pack.series(line, 'flow_efficiency')
        held = (wip[wip_peak] - wip[alert])
        extra_units = cum[max(peak, i)] - cum[alert]
        rd_dom = nice_domain(raw, rawd, [tgt[0]], pad=0.06)

        checks = [
            check('gross', 'Made more than the line shipped', 'required', MATCH,
                  f'{num(c["made"], 0)} units made and not shipped between {ts[alert]} and {ts[i]} — '
                  f'{num(B.mean(raw[alert:i + 1]))}/min at this station against '
                  f'{num(B.mean(out[alert:i + 1]))}/min out of the door, once the {signed(c["bias"], 2)}/min '
                  f'counter bias between the pair is taken out. Alert level is {num(p["gap_units"], 0)} units.',
                  f'{pack.name(down)} is the next station on the line and there is no store between them. Whatever '
                  f'this station makes above {pack.name(down)}\'s pace has nowhere to go but into the line.',
                  spark(cum, nice_domain(cum, pad=0.1), highlight=[ts[alert], ts[i]])),
            check('wip', 'Work in process absorbing the difference', 'required', MATCH,
                  f'{lname} WIP {num(wip[alert])} → {num(wip[i])} lots over the hour to {ts[i]} '
                  f'({signed(wip[i] - wip[alert])} lots, {signed(c["wip_slope"])} per hour), peaking at '
                  f'{num(wip[wip_peak])} at {ts[wip_peak]}. Flow efficiency {num(flow_eff[alert])} → '
                  f'{num(min(flow_eff[alert:peak + 1]))}. Alert level is {num(p["wip_rise_lots"], 1)} lots.',
                  'WIP is material in the line that has not left it. Rising WIP at a steady Output rate means the '
                  'extra product is piling up between stations, not shipping.',
                  spark(wip, nice_domain(wip, pad=0.15), highlight=[ts[alert], ts[wip_peak]])),
            check('nogain', 'Output no better than before — and no worse', 'required', MATCH,
                  f'{pack.name(c["out_s"])} averaged {num(B.mean(out[alert:i + 1]))}/min against its own '
                  f'{num(obase)}/min baseline and a {num(tgt[0], 0)}/min target '
                  f'({signed(B.mean(out[alert:i + 1]) - obase)}/min), and never fell below '
                  f'{num(min(out[alert:i + 1]))}/min.',
                  'This is the whole point. The line was worked harder and shipped the same, so the extra effort '
                  'bought nothing. The floor matters too: a line that is actually broken ships less, and that is a '
                  'different finding.',
                  spark(out, rd_dom, threshold_value=obase)),
            check('balance', 'The missing product is accounted for', 'required', MATCH,
                  f'Cumulative gross minus shipped tracks the WIP curve at r = {num(c["balance_r"], 3)} between '
                  f'{ts[alert]} and {ts[i]} — about {num(extra_units, 0)} units made and not shipped, against '
                  f'{num(held)} lots of WIP added by the peak.',
                  'If the gap were a counting error, the two curves would not follow each other. They do, so the '
                  'product is physically in the line.',
                  spark(cum, nice_domain(cum, pad=0.1), highlight=[ts[alert], ts[peak]])),
            check('blocked', f'{pack.name(tr)} held up more often', 'supporting',
                  MATCH if blocked_ok else NO_MATCH,
                  f'Blocking time {num(baseline(blk, 0, bl - 1), 2)} → {num(max(blk[alert:peak + 1]), 2)} at '
                  f'{ts[max(range(alert, peak + 1), key=lambda k: blk[k])]}.',
                  'Blocking time is measured at the gate, not derived from the rates. The gate spent more of every '
                  'minute waiting for somewhere to put the product.',
                  spark(blk, nice_domain(blk, pad=0.2, floor=0), threshold_value=baseline(blk, 0, bl - 1))),
            check('defects', 'Quality paid for it', 'supporting', MATCH if defects_ok else NO_MATCH,
                  f'{pack.name(down)} defect rate {num(baseline(dd, 0, bl - 1), 2)} → '
                  f'{num(max(dd[alert:peak + 1]), 2)}, rework {num(baseline(dw, 0, bl - 1), 2)} → '
                  f'{num(max(dw[alert:peak + 1]), 2)}; {lname} scrap {num(baseline(scrap, 0, bl - 1), 2)} → '
                  f'{num(max(scrap[alert:peak + 1]), 2)} %.',
                  'Material that waits between stations, and a station run at the edge of its pace, both cost '
                  'quality. The scrap is weighed, so this part of the cost is not an estimate.',
                  spark(dd, nice_domain(dd, pad=0.2), highlight=[ts[alert], ts[peak]])),
            check('cut', 'Demand cut, WIP drained', 'supporting', MATCH if cut_ok else NO_MATCH,
                  f'The gap closed from {num(excess[peak])}/min at {ts[peak]} and reversed to '
                  f'{num(excess[rec_k])}/min by {ts[rec_k]} — the line shipping more than it made — while WIP came '
                  f'back {num(wip[wip_peak])} → {num(wip[drained])} lots by {ts[drained]} and flow efficiency '
                  f'overshot to {num(max(flow_eff[wip_peak:]))}. It has since crept back to '
                  f'{num(excess[pack.now])}/min, still under the {num(p["gap_per_min"], 1)}/min alert.',
                  'Draining means the line shipped more than it made for a while — the stored product finally '
                  'leaving. That is what proves it was stored rather than lost.',
                  spark(wip, nice_domain(wip, pad=0.15), highlight=[ts[wip_peak], ts[drained]])),
        ]
        main = chart('/min', rd_dom,
                     [series('gross', f'{name} gross rate', raw, 'primary', 1),
                      series('down', f'{pack.name(down)} rate', rawd, 'expected', 1),
                      series('out', f'{pack.name(pack.descendant_of_type(line, "output"))} (shipped)', out,
                             'secondary', 1)],
                     title='What we see',
                     caption=f'{name} against the station it feeds and against what actually left the line. The '
                             f'shaded gap is product made and not shipped — about {num(extra_units, 0)} units '
                             f'between {ts[alert]} and {ts[peak]}.',
                     shade_gap=['gross', 'down'],
                     markers=[marker(ts[alert], 'Gap opens'), marker(ts[i], 'Flagged'),
                              marker(ts[peak], f'Widest {num(gap[peak])}/min'),
                              marker(ts[end], 'Demand cut')])

        grid = minutes_grid(-30, 180, 10)
        rng = Rng(9173)
        cap = B.mean(rawd[alert:peak + 1])
        tb_g, tb_w, bu_g, bu_w, re_g, re_w = [], [], [], [], [], []
        w0 = wip[alert]
        for m in grid:
            x = max(0.0, m)
            on = 0.0 if m < 0 else min(2.6, 0.035 * x)
            tb_g.append(cap + on + rng.gauss(0.4))
            tb_w.append(w0 + min(9.0, 0.09 * x) + rng.gauss(0.3))
            bu_g.append(cap + on + rng.gauss(0.4))
            bu_w.append(w0 + rng.gauss(0.3))
            re_g.append(cap + (0.0 if m < 0 else 2.6) + rng.gauss(0.4))
            re_w.append(w0 + rng.gauss(0.3) - (0.0 if m < 0 else 1.0))
        live_g = aligned(raw, alert, pack.step_min, grid, 'min')
        live_w = aligned(wip, alert, pack.step_min, grid, 'min')
        pair = lambda a, b: [ref_chart('Station gross rate (min from the gap opening)', '/min',
                                       [cap - 4, cap + 6], grid, 'min', a, live_g, f'{name}, today', 1,
                                       [threshold(cap, f'{pack.name(down)} pace')]),
                             ref_chart('Line WIP', 'lots', [w0 - 4, w0 + 12], grid, 'min', b, live_w,
                                       f'{lname}, today', 0)]
        refs = [
            reference('overpace', 'textbook', 'Textbook', 'Over-pacing into a capped line',
                      'Demand is raised a few per cent above the limiting station. The gross rate rises and stays '
                      'up, WIP climbs steadily, blocking and defects follow, and the Output rate never improves. It '
                      'ends when somebody compares gross with effective.',
                      'match', 'Closest match',
                      [f'Same flat Output at {num(B.mean(out[alert:peak + 1]))}/min with the gross rate up',
                       f'WIP rose {num(held)} lots at {signed(c["wip_slope"])} per hour'], pair(tb_g, tb_w)),
            reference('buffered', 'variant', 'Variant', 'Over-pacing with a buffer to absorb it',
                      'The same over-pacing on an Aurelia line, where the Buffer takes the difference. WIP barely '
                      'moves, the buffer level climbs instead, and the symptom is a rising level rather than rising '
                      'WIP — but the hidden cost is identical.',
                      'partial', 'Same cause, different store',
                      [f'{lname} is a Ferrum line, so it has no store — the WIP between stations is the buffer',
                       'Which is why blocking time shows up here and would not there'], pair(bu_g, bu_w)),
            reference('real', 'lookalike', 'Look-alike', 'A real capacity gain',
                      'Gross rate up by the same amount, but the Output rate follows it up and WIP stays flat. The '
                      'line genuinely got faster, and the headline number means what it says.',
                      'nomatch', 'Does not match',
                      [f'Output moved {signed(B.mean(out[alert:peak + 1]) - obase)}/min, essentially not at all',
                       f'WIP went the wrong way: {signed(held)} lots'], pair(re_g, re_w)),
        ]
        ro = [
            ruled_out('Downstream equipment degradation', 'ruled out',
                      f'{pack.name(down)} held {num(min(rawd[alert:peak + 1]))}–{num(max(rawd[alert:peak + 1]))}/min '
                      f'all through — its own normal pace — and no condition signal on the line moved. It was not '
                      f'slowing down; this station was speeding up past it.'),
            ruled_out('A quality problem making the extra product', 'ruled out',
                      f'Defects and scrap rose *after* the gap opened, not before '
                      f'({num(baseline(dd, 0, bl - 1), 2)} → {num(max(dd[alert:peak + 1]), 2)}), and both came back '
                      f'when the demand was cut. Quality was a consequence, not the cause.'),
            ruled_out('A counting error between the two stations', 'ruled out',
                      f'The cumulative gap tracks the WIP curve at r = {num(c["balance_r"], 3)}, and the Transfer '
                      f'gate independently reported {num(max(blk[alert:peak + 1]), 2)} of blocking time. Three '
                      f'measurements, one story.'),
            ruled_out('A genuine rate increase', 'ruled out',
                      f'The {lname} target never moved from {num(tgt[0], 0)}/min and Output averaged '
                      f'{num(B.mean(out[alert:peak + 1]))}/min, {signed(B.mean(out[alert:peak + 1]) - obase)}/min '
                      f'from its baseline. Nothing extra was shipped.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'Power Charge demand set above what {pack.name(down)} can sustain — the extra '
                                     f'rate went into WIP, blocking and defects, not out of the door', level,
                                     'Confirmed: the gap closed and the WIP drained after the demand was cut'
                                     if cut_ok else 'Gross, effective and WIP all agree'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Power Charge stations are not part of the judgement — each line has its own '
                        f'limiting station. The comparison that matters is this station against the one it feeds.',
            'confidence': confidence(level,
                                     f'Four measurements that do not share an instrument — the two station rates, '
                                     f'the line WIP and the Transfer gate\'s blocking time — and the gap reversed to '
                                     f'{num(excess[rec_k])}/min with the WIP draining after the demand was cut.'
                                     if cut_ok else
                                     'The rate gap, the WIP slope and the flat Output rate agree, and the cumulative '
                                     'gap accounts for the WIP.',
                                     None if cut_ok else 'The sustainable rate is read off today\'s downstream pace, '
                                                         'not from a capability study.',
                                     None if cut_ok else 'The gap closes and WIP drains after the demand is reduced.',
                                     f'{pack.name(down)} turns out to have been limited by something fixable — then '
                                     f'the capacity, not the pacing, is the thing to work on. The gap has also '
                                     f'crept back to {num(excess[pack.now])}/min since {ts[drained]}; another '
                                     f'{num(p["gap_per_min"] - excess[pack.now], 1)}/min and this would raise '
                                     f'again.'),
            'action': action(item, pack),
            'model': {'target': 'throughput_per_min',
                      'formula': f'{pack.name(down)} {p["smooth_min"]}-min mean rate {signed(gbase, 2)}/min (the '
                                 f'pair\'s own gap over the first {dur(p["baseline_min"])})',
                      'fittedOn': f'the {name} → {pack.name(down)} pair'},
            'impact': f'About {num(extra_units, 0)} units made and not shipped, {num(held)} lots of extra WIP, '
                      f'{lname} scrap up to {num(max(scrap[alert:peak + 1]), 2)} % and flow efficiency down to '
                      f'{num(min(flow_eff[alert:peak + 1]))}. The headline rate never showed any of it.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. Charger interruption cascading down the line — archetype 09 (cascade)
# ═════════════════════════════════════════════════════════════════════════
class ChargerFaultCascade(Detector):
    id = 'refinery.charger_fault_cascade'
    name = 'Power Charge interruption cascading down the line'
    archetype = '09 Cascade failure'
    applies_to = 'Power Charge stations'
    summary = ('A Power Charge station whose output collapses to idle for one sample, taking the stations after it '
               'down in flow order within the same five minutes and blocking the one before it. The order of events '
               'is what names the origin.')
    pipeline = [
        ('Collapse', 'the station\'s rate against its own hour-before baseline, and its motor current against idle'),
        ('Spread', 'every station downstream on the process_flow layer, in order, in the same sample'),
        ('Attenuation', 'the deficit should shrink with distance: material already past the charger keeps moving'),
        ('Upstream', 'the feeding station drops too, but it is blocked, not stopped — and material availability is '
                     'normal'),
        ('Checks', 'collapse · drive at idle · downstream in order · attenuating · upstream blocked · recovery'),
        ('Conclusion', 'the first station to fall, with its drive at idle, is the origin; everything after it is '
                       'consequence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_charge'},
        'inputs': {'rate': 'self.throughput_per_min', 'current': 'self.motor_current_a',
                   'ctrl': 'self.controller_output_pct', 'charge': 'self.charge_rate',
                   'chain': 'targets[process_flow], recursively, each station\'s throughput_per_min',
                   'up': 'sources[process_flow] throughput_per_min and the line head\'s material_availability',
                   'starve': 'line transfer: starvation_time, blocking_time',
                   'line': 'line.total_wip, instability_index, line_availability',
                   'work': 'done MAINTENANCE work items on this station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Power Charge stations (sanity check only)'},
        'expected': {'model': 'own recent baseline', 'target': 'rate',
                     'formula': 'median(rate over the hour before the sample)', 'fitOn': 'self'},
        'params': {'baseline_min': 60, 'collapse_frac': 0.30, 'idle_frac': 0.40, 'recover_frac': 0.80,
                   'down_frac': 0.60, 'up_frac': 0.80, 'avail_pct': 98.0, 'starve_rise': 1.0,
                   'ctrl_spike_pct': 8.0, 'instab_rise': 3.0},
        'checks': [
            {'id': 'collapse', 'role': 'required', 'rule': 'rate < collapse_frac × its own hour-before baseline'},
            {'id': 'idle', 'role': 'required', 'rule': 'motor current < idle_frac × its baseline in the same sample'},
            {'id': 'order', 'role': 'required', 'rule': 'every station downstream is below down_frac of its baseline in the same sample'},
            {'id': 'attenuating', 'role': 'required', 'rule': 'the deficit shrinks with distance downstream'},
            {'id': 'recovered', 'role': 'required', 'rule': 'the next sample is back above recover_frac of baseline — an interruption, not a stop'},
            {'id': 'upstream', 'role': 'supporting', 'independent': True, 'rule': 'the feeding station is above up_frac × idle (blocked, not stopped) and line-head material availability > avail_pct'},
            {'id': 'starved', 'role': 'supporting', 'independent': True, 'rule': 'Transfer starvation time up by starve_rise in the same sample, then blocking time up in the next'},
            {'id': 'repaired', 'role': 'supporting', 'independent': True, 'rule': 'a maintenance item on this station closed and no further collapse followed'},
        ],
        'ruleOut': ['loss of input material', 'a downstream blockage pushing back', 'a line-wide power event',
                    'a counting glitch'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'the source fault was repaired and nothing recurred'},
        'references': ['textbook: charger interruption', 'variant: supply loss at the head of the line',
                       'look-alike: downstream block'],
    }

    def candidates(self, pack):
        return pack.of_type('power_charge')

    def _base(self, pack, aid, key, i):
        p = self.p
        w = pack.steps(p['baseline_min'])
        v = pack.series(aid, key)
        return baseline(v, max(0, i - w), max(0, i - 1)) or baseline(v, 0, w - 1)

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        r = rate(pack, aid)
        cur = pack.series(aid, 'motor_current_a')
        chain = downstream(pack, aid)
        up = prv(pack, aid)
        head = stations(pack, line_of(pack, aid))[0]
        avail = pack.series(head, 'material_availability') if pack.has(head, 'material_availability') else None
        for i in range(pack.steps(p['baseline_min']), pack.n - 1):
            rb = self._base(pack, aid, 'throughput_per_min', i)
            if r[i] >= rb * p['collapse_frac']:
                continue
            cb = self._base(pack, aid, 'motor_current_a', i)
            if cur[i] >= cb * p['idle_frac']:
                continue
            if r[i + 1] < rb * p['recover_frac']:
                continue
            fr = []
            ok = True
            for s in chain:
                sb = self._base(pack, s, 'throughput_per_min', i)
                f = rate(pack, s)[i] / sb
                fr.append(f)
                if f >= p['down_frac']:
                    ok = False
            if not ok or len(fr) < 2 or not all(b >= a for a, b in zip(fr, fr[1:])):
                continue
            if up is not None:
                ub = self._base(pack, up, 'throughput_per_min', i)
                if rate(pack, up)[i] <= ub * p['idle_frac'] * p['up_frac']:
                    continue
            if avail is not None and avail[i] < p['avail_pct']:
                continue
            return Finding(aid, True, i, r=r, cur=cur, rb=rb, cb=cb, chain=chain, fr=fr, up=up, head=head,
                           avail=avail)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        r, cur, rb, cb, chain, fr, up = c['r'], c['cur'], c['rb'], c['cb'], c['chain'], c['fr'], c['up']
        ur = rate(pack, up)
        ub = self._base(pack, up, 'throughput_per_min', i)
        ctrl = pack.series(aid, 'controller_output_pct')
        ctrl_base = baseline(ctrl, max(0, i - pack.steps(60)), i - 1)
        tr = pack.descendant_of_type(line, 'transfer')
        stv, blk = pack.series(tr, 'starvation_time'), pack.series(tr, 'blocking_time')
        stv_base = baseline(stv, max(0, i - pack.steps(60)), i - 1)
        starved_ok = (stv[i] - stv_base >= p['starve_rise']
                      and blk[i + 1] > baseline(blk, max(0, i - pack.steps(60)), i - 1))
        avail = c['avail']
        up_ok = ur[i] > ub * p['idle_frac'] * p['up_frac'] and (avail is None or min(avail) >= p['avail_pct'])
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == aid and w.get('done') and w.get('completedAt')]
        job = jobs[0] if jobs else None
        recurred = any(r[k] < rb * p['collapse_frac'] for k in range(job[1], pack.n)) if job else True
        repaired_ok = job is not None and not recurred
        independent = sum([starved_ok, up_ok, repaired_ok])
        level = 'high' if repaired_ok else ('medium' if independent else 'low')
        wip = pack.series(line, 'total_wip')
        instab = pack.series(line, 'instability_index')
        avail_k = pack.series(line, 'line_availability')
        reduced = [k for k in range(i + 1, pack.n) if r[k] < rb * 0.97]
        back = next((k for k in range(max(reduced) if reduced else i + 1, pack.n) if r[k] >= rb * 0.97), pack.now)
        lost = (rb - r[i]) * pack.step_min
        rd = nice_domain([0, rb * 1.1], pad=0.02, floor=0)
        chain_names = [pack.name(s) for s in chain]

        checks = [
            check('collapse', 'Output collapsed for one sample', 'required', MATCH,
                  f'{num(r[i])}/min at {ts[i]} against a {num(rb)}/min baseline over the hour before — '
                  f'{num(100 * r[i] / rb, 0)} % of normal. Alert level is below '
                  f'{num(100 * p["collapse_frac"], 0)} %.',
                  'A charger that stops passing material stops the line, because there is nothing to store it in on '
                  'a Ferrum line.',
                  spark(r, rd, threshold_value=rb * p['collapse_frac'])),
            check('idle', 'The drive was at idle, not slowed', 'required', MATCH,
                  f'Motor current {num(cur[i])} A at {ts[i]} against {num(cb)} A normally — '
                  f'{num(100 * cur[i] / cb, 0)} %, which is what the drive draws turning with nothing in it. '
                  f'Controller output spiked to {num(ctrl[i])} % from {num(ctrl_base)} %.',
                  'Current is proportional to what the station is actually working on. At idle current the charger '
                  'was not charging anything — it lost its supply, it did not slow down.',
                  spark(cur, nice_domain(cur, [0], pad=0.1, floor=0), threshold_value=cb * p['idle_frac'])),
            check('order', f'All {len(chain)} stations after it fell in the same sample', 'required', MATCH,
                  '; '.join(f'{pack.name(s)} {num(rate(pack, s)[i])}/min '
                            f'({num(100 * fr[k], 0)} % of normal)' for k, s in enumerate(chain)) + '.',
                  'Material flows one way. A station can only starve the ones after it, so the first one down the '
                  'chain is the origin.',
                  spark([rate(pack, chain[0])[k] for k in range(pack.n)], rd,
                        highlight=[ts[i], ts[min(i + 2, pack.n - 1)]])),
            check('attenuating', 'The deficit shrank with distance', 'required', MATCH,
                  ' → '.join(f'{pack.name(s)} {num(100 * fr[k], 0)} %' for k, s in enumerate(chain))
                  + f'. {chain_names[0]} lost the most, {chain_names[-1]} the least.',
                  'Material already past the charger carried on moving, so the stations further down kept working '
                  'for part of the five minutes. That gradient is the signature of a cascade from one point, not of '
                  'everything failing at once.',
                  None),
            check('recovered', 'Back the next sample', 'required', MATCH,
                  f'{num(r[i + 1])}/min at {ts[i + 1]} — {num(100 * r[i + 1] / rb, 0)} % of baseline — with '
                  f'{pack.name(chain[0])} catching up at {num(rate(pack, chain[0])[i + 1])}/min and '
                  f'{pack.name(tr)} accumulating ({num(blk[i + 1], 2)} blocking time). WIP swung '
                  f'{signed(wip[i] - wip[i - 1])} → {signed(wip[i + 1] - wip[i])} lots.',
                  'An interruption, not a breakdown: supply came back on its own and the line caught up on the '
                  'material that had queued. A hard stop stays at zero.',
                  spark(r, rd, highlight=[ts[i], ts[i + 2]])),
            check('upstream', f'{pack.name(up)} was blocked, not short', 'supporting',
                  MATCH if up_ok else NO_MATCH,
                  f'{pack.name(up)} ran {num(ur[i])}/min at {ts[i]} ({num(100 * ur[i] / ub, 0)} % of normal) — down, '
                  f'but well above the {num(ub * p["idle_frac"], 0)}/min it would read if it had stopped. Material '
                  f'availability stayed at {num(min(avail), 1)} % or better.'
                  if avail is not None else
                  f'{pack.name(up)} ran {num(ur[i])}/min ({num(100 * ur[i] / ub, 0)} % of normal).',
                  'This separates a charger fault from a supply loss. A supply loss empties the head of the line '
                  'first and hardest; here the head was still pushing, with nowhere to push to.',
                  spark(ur, rd, highlight=[ts[i], ts[i + 1]])),
            check('starved', f'{pack.name(tr)} starved, then accumulated', 'supporting',
                  MATCH if starved_ok else NO_MATCH,
                  f'Starvation time {num(stv_base, 2)} → {num(stv[i], 2)} at {ts[i]}, then blocking time '
                  f'{num(blk[i], 2)} → {num(blk[i + 1], 2)} at {ts[i + 1]}.',
                  'The gate is instrumented separately from the counters. Starved in the collapse and blocked in the '
                  'recovery is exactly the order a single upstream interruption produces.',
                  spark(stv, nice_domain(stv, pad=0.2, floor=0), highlight=[ts[i], ts[i + 1]])),
            check('repaired', 'Source fault repaired, nothing since', 'supporting',
                  MATCH if repaired_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; no sample below '
                   f'{num(100 * p["collapse_frac"], 0)} % of baseline since, and rate back to {num(r[back])}/min '
                   f'from {ts[back]}.' if job else 'No maintenance closed on this station.'),
                  'A repair at the named station, followed by no recurrence, is the strongest confirmation an event '
                  'like this gets.',
                  spark(r, rd, highlight=[ts[job[1]], ts[now]]) if job else None),
        ]
        main = chart('/min', rd,
                     [series('pc', f'{name}', r, 'primary', 1)]
                     + [series(f'd{k}', pack.name(s), rate(pack, s), 'secondary' if k == 0 else 'peer', 1)
                        for k, s in enumerate(chain)]
                     + [series('up', pack.name(up), ur, 'peer', 1)],
                     title='What we see',
                     caption=f'{name} and the rest of {lname} through the interruption at {ts[i]}. The charger went '
                             f'to {num(r[i])}/min, {chain_names[0]} to {num(rate(pack, chain[0])[i])}/min, '
                             f'{chain_names[-1]} to {num(rate(pack, chain[-1])[i])}/min, and {pack.name(up)} was '
                             f'blocked at {num(ur[i])}/min.',
                     markers=[marker(ts[i], 'Interruption'), marker(ts[i + 1], 'Brief recovery'),
                              marker(ts[min(i + 2, pack.n - 1)], 'Demand reduced'),
                              marker(ts[back], 'Back to baseline')])

        grid = minutes_grid(-20, 60, 5)
        rng = Rng(1217)
        tb, sup, blkref = [], [], []
        for m in grid:
            tb.append((rb * 0.14 if m == 0 else (rb * 0.99 if m > 0 else rb)) + rng.gauss(0.6))
            sup.append((rb * 0.08 if 0 <= m <= 15 else rb) + rng.gauss(0.6))
            blkref.append((rb if m < 0 else rb * 0.96) + rng.gauss(0.6))
        live = aligned(r, i, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Station rate (min from the event)', '/min', [0, rb * 1.1], grid, 'min', a,
                                  live, f'{name}, today', 0, [threshold(rb, 'Baseline')])]
        refs = [
            reference('charger', 'textbook', 'Textbook', 'Charger interruption',
                      'One sample at idle, downstream deficits in flow order, a catch-up sample straight after, then '
                      'a deliberately reduced demand while the supply is repaired. Availability loses exactly the '
                      'down sample.',
                      'match', 'Closest match',
                      [f'Same single-sample shape at {num(r[i])}/min with the drive at {num(cur[i])} A',
                       f'{lname} availability stepped {num(avail_k[i - 1], 2)} → {num(avail_k[i], 2)} %'], mk(tb)),
            reference('supply', 'variant', 'Variant', 'Supply loss at the head of the line',
                      'The same line, down just as hard, but it starts at Bulk Intake: the head of the line falls '
                      'first and furthest, material availability drops, and the charger is starved rather than '
                      'stopped — its motor current falls with its load instead of to idle.',
                      'nomatch', 'Does not match',
                      [f'{pack.name(up)} held {num(100 * ur[i] / ub, 0)} % of normal, above idle',
                       f'Material availability never went below {num(min(avail), 1)} %'
                       if avail is not None else 'The head of the line was blocked, not empty'], mk(sup)),
            reference('block', 'lookalike', 'Look-alike', 'Downstream block',
                      'A gate jams at the far end of the line. Everything stops too, but the deficit grows with '
                      'distance *upstream* of the block, the blocked station shows a current spike rather than idle, '
                      'and the zero lasts for several samples.',
                      'nomatch', 'Does not match',
                      [f'Here the deficit shrank downstream ({num(100 * fr[0], 0)} % → {num(100 * fr[-1], 0)} %)',
                       f'And it was over in one sample: {num(r[i + 1])}/min at {ts[i + 1]}'], mk(blkref)),
        ]
        ro = [
            ruled_out('Loss of input material', 'ruled out',
                      f'{pack.name(c["head"])} material availability stayed at {num(min(avail), 1)} % or better and '
                      f'{pack.name(up)} was still running at {num(100 * ur[i] / ub, 0)} % of normal — blocked by the '
                      f'charger, not empty.' if avail is not None else
                      f'{pack.name(up)} was still running at {num(100 * ur[i] / ub, 0)} % of normal, so material was '
                      f'arriving.'),
            ruled_out('A downstream blockage pushing back', 'ruled out',
                      f'The deficit got *smaller* with distance downstream ({num(100 * fr[0], 0)} % at '
                      f'{chain_names[0]} to {num(100 * fr[-1], 0)} % at {chain_names[-1]}), and {pack.name(tr)} '
                      f'reported starvation ({num(stv[i], 2)}) rather than blocking ({num(blk[i], 2)}) in the down '
                      f'sample. A block reverses both of those.'),
            ruled_out('A line-wide power event', 'ruled out',
                      f'Only {lname} moved. The other five Ferrum lines held '
                      f'{num(min(pack.series(q, "line_throughput")[i] for q in pack.children[pack.parent(line)] if q != line))}'
                      f'–'
                      f'{num(max(pack.series(q, "line_throughput")[i] for q in pack.children[pack.parent(line)] if q != line))}'
                      f'/min through the same sample.'),
            ruled_out('A counting glitch', 'ruled out',
                      f'The motor current fell to {num(cur[i])} A, the controller output spiked to {num(ctrl[i])} %, '
                      f'the Transfer gate logged {num(stv[i], 2)} of starvation and {lname} instability went '
                      f'{num(instab[i - 1], 2)} → {num(instab[i], 2)}. Counters do not move four other '
                      f'instruments.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'A power-delivery interruption at {name}: it is the first station to fall and '
                                     f'the only one whose drive went to idle — everything after it is consequence',
                                     level,
                                     'Confirmed: the source fault was repaired and nothing has recurred'
                                     if repaired_ok else 'Event order and topology name this station'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Power Charge stations are used only to confirm that nothing happened '
                        f'elsewhere in Ferrum at {ts[i]}. The cascade argument is made along {lname}\'s own '
                        f'process-flow chain, because that is the only path material can take.',
            'confidence': confidence(level,
                                     f'The rate, the motor current, the controller output, the Transfer gate\'s '
                                     f'starvation time and the order the five stations fell in all point at the '
                                     f'charger, and the fault was repaired at {job[0]["completedAt"][11:16]} with no '
                                     f'recurrence since.' if repaired_ok else
                                     'The drive was at idle current while the station upstream was still pushing, '
                                     'and the downstream deficits fall in flow order.',
                                     None if repaired_ok else 'The supply itself has not been examined yet.',
                                     None if repaired_ok else 'A repair at the charger, followed by no recurrence.',
                                     'Another interruption after the repair — then the supply upstream of the '
                                     'charger, not the charger, is the thing to chase.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'throughput_per_min',
                      'formula': f'median of the station\'s own rate over the {dur(p["baseline_min"])} before the '
                                 f'sample = {num(rb)}/min',
                      'fittedOn': 'this station and the four others on its process-flow chain'},
            'impact': f'About {num(lost, 0)} units lost in the down sample and '
                      f'{num(sum(max(0.0, rb - r[k]) for k in range(i, back + 1)) * pack.step_min, 0)} in all to '
                      f'{ts[back]}. {lname} availability {num(avail_k[i - 1], 2)} → {num(avail_k[now], 2)} % (a '
                      f'rolling 24-hour figure, so it stays there), instability peaked at '
                      f'{num(max(instab), 1)} and health dipped to '
                      f'{num(min(pack.series(line, "system_health_index")))} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Manual corrections growing an oscillation — archetype 10 (overcorrection)
# ═════════════════════════════════════════════════════════════════════════
class ManualOvercorrection(Detector):
    id = 'refinery.manual_overcorrection'
    name = 'Manual corrections amplifying a charge-rate oscillation'
    archetype = '10 Overcorrection loop'
    applies_to = 'Power Charge stations'
    summary = ('A charge rate swinging further each cycle while the controller output moves against it, one sample '
               'out of phase. Each correction lands before the last one has settled, so the correcting is what '
               'grows the swing.')
    pipeline = [
        ('Baseline', 'the charge rate the station held for the hour before the swings started, and the '
                     'mid-point of the swing itself (the median through the episode)'),
        ('Cycles', 'turning points either side of that mid-point, and the peak-to-peak of each cycle'),
        ('Growth', 'later cycles against earlier ones — a disturbance decays, a correction loop grows'),
        ('Phase', 'correlation between charge rate and controller output over the episode: pushing against the '
                  'response instead of with it'),
        ('Checks', 'swinging · growing · anti-phase · oscillation index · still running · damped after'),
        ('Conclusion', 'the control action, not the process; go back to the validated setting'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_charge'},
        'inputs': {'charge': 'self.charge_rate', 'ctrl': 'self.controller_output_pct',
                   'osc': 'self.oscillation_index', 'rate': 'self.throughput_per_min',
                   'down': 'targets[process_flow] throughput_per_min',
                   'line': 'line.instability_index, system_health_index'},
        'peers': {'same': 'assetType', 'count': 'the other five Power Charge stations'},
        'expected': {'model': 'own pre-episode setting', 'target': 'charge',
                     'formula': 'median(charge_rate over baseline_min before the first turning point)',
                     'fitOn': 'self'},
        'params': {'baseline_min': 60, 'amp_pct': 2.0, 'min_turns': 4, 'min_pp_pct': 6.0,
                   'growth_ratio': 1.2, 'phase_r': -0.5, 'osc_min': 4.5, 'osc_sustain_min': 5,
                   'pad_steps': 4,
                   'running_frac': 0.90, 'settle_min': 30, 'settle_pct': 3.0},
        'checks': [
            {'id': 'swinging', 'role': 'required', 'rule': 'at least min_turns turning points alternating about the mid-point of the episode, with ≥ 2 cycles of min_pp_pct peak-to-peak'},
            {'id': 'growing', 'role': 'required', 'rule': 'the largest cycle ≥ growth_ratio × the first cycle'},
            {'id': 'phase', 'role': 'required', 'rule': 'corr(charge, controller output) < phase_r over the episode'},
            {'id': 'osc', 'role': 'required', 'rule': 'oscillation index > osc_min for osc_sustain_min'},
            {'id': 'running', 'role': 'required', 'rule': 'rate never below running_frac × baseline — the station kept running, so this is not a trip'},
            {'id': 'carried', 'role': 'supporting', 'independent': True, 'rule': 'throughput and the downstream station swing with it, and line instability rises'},
            {'id': 'damped', 'role': 'supporting', 'independent': True, 'rule': 'the charge rate settles inside settle_pct of baseline for settle_min'},
        ],
        'ruleOut': ['a faulty charge-rate sensor', 'a real process disturbance', 'a drive or mechanical fault',
                    'a controller tuning fault'],
        'confidence': {'low': 'required checks only', 'medium': 'throughput and instability moved with it',
                       'high': 'the swing damped as soon as the corrections stopped'},
        'references': ['textbook: operator-driven oscillation', 'variant: controller tuned too tight',
                       'look-alike: a single process upset'],
    }

    def candidates(self, pack):
        return pack.of_type('power_charge')

    def _cycles(self, pack, aid, i0, i1, base):
        """Alternating turning points about base, with the peak-to-peak of each cycle.

        base is the mid-point of the episode (its median), not the pre-episode setting: the
        first correction is small, and a mid-point that the swing is actually centred on is
        what keeps it from being lost in the slow drift of the setting."""
        p = self.p
        v = pack.series(aid, 'charge_rate')
        amp = base * p['amp_pct'] / 100
        turns = [(k, x) for k, x in extrema(v, i0, i1) if abs(x - base) > amp]
        keep = []
        for k, x in turns:
            if keep and (x - base) * (keep[-1][1] - base) > 0:
                if abs(x - base) > abs(keep[-1][1] - base):
                    keep[-1] = (k, x)
                continue
            keep.append((k, x))
        pp = [abs(b[1] - a[1]) for a, b in zip(keep, keep[1:])]
        return keep, pp

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        v = pack.series(aid, 'charge_rate')
        ctrl = pack.series(aid, 'controller_output_pct')
        osc = pack.series(aid, 'oscillation_index')
        r = rate(pack, aid)
        bl = pack.steps(p['baseline_min'])
        hot = B.gt(osc, p['osc_min'])
        for i in range(bl, pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['osc_sustain_min']:
                continue
            base = baseline(v, max(0, s0 - bl), max(0, s0 - 1))
            i0, i1 = max(0, s0 - p['pad_steps']), min(pack.n - 1, i + p['pad_steps'])
            centre = median(v[i0:i1 + 1])
            keep, pp = self._cycles(pack, aid, i0, i1, centre)
            big = [x for x in pp if x >= base * p['min_pp_pct'] / 100]
            if len(keep) < p['min_turns'] or len(big) < 2:
                continue
            if max(pp) < pp[0] * p['growth_ratio']:
                continue
            rr = pearson(v[i0:i1 + 1], ctrl[i0:i1 + 1])
            if rr is None or rr > p['phase_r']:
                continue
            rbase = baseline(r, max(0, s0 - bl), max(0, s0 - 1))
            if min(r[i0:i1 + 1]) < rbase * p['running_frac']:
                continue
            return Finding(aid, True, i, v=v, ctrl=ctrl, osc=osc, r=r, base=base, centre=centre, rbase=rbase,
                           i0=i0, i1=i1, alert=s0, keep=keep, pp=pp, phase_r=rr)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        v, ctrl, osc, r, base, rbase = c['v'], c['ctrl'], c['osc'], c['r'], c['base'], c['rbase']
        i0, keep, pp = c['i0'], c['keep'], c['pp']
        centre = c['centre']
        start, last = keep[0][0], keep[-1][0]
        end = next((k for k in range(last, pack.n)
                    if all(abs(v[j] - base) <= base * p['settle_pct'] / 100
                           for j in range(k, min(pack.n, k + pack.steps(p['settle_min']) + 1)))), pack.now)
        down = nxt(pack, aid)
        dr = rate(pack, down)
        instab = pack.series(line, 'instability_index')
        health = pack.series(line, 'system_health_index')
        swing_r = max(r[start:last + 1]) - min(r[start:last + 1])
        swing_d = max(dr[start:last + 1]) - min(dr[start:last + 1])
        carried_ok = (swing_r >= rbase * 0.025
                      and max(instab[start:last + 1]) - baseline(instab, 0, pack.steps(60) - 1) >= 3.0)
        damped_ok = end < pack.now and all(abs(v[k] - base) <= base * p['settle_pct'] / 100
                                           for k in range(end, pack.n))
        independent = sum([carried_ok, damped_ok])
        level = 'high' if damped_ok else ('medium' if independent else 'low')
        peers = peers_of(pack, aid)
        posc = [max(pack.series(q, 'oscillation_index')[k] for q in peers) for k in range(pack.n)]
        vd = nice_domain(v, ctrl, pad=0.1)
        period = 2 * pack.step_min

        checks = [
            check('swinging', f'{len(keep)} swings either side of the setting', 'required', MATCH,
                  ' → '.join(f'{num(x, 1)} %' for _, x in keep) + f' between {ts[start]} and {ts[last]}, against a '
                  f'{num(base, 1)} % setting and a {num(centre, 1)} % mid-point. Peak-to-peak '
                  + ', '.join(f'{num(x, 1)}' for x in pp) + ' points.',
                  f'A swing that crosses the setting every {dur(period)} is a loop fighting itself. One disturbance '
                  f'gives one excursion, not five.',
                  spark(v, vd, threshold_value=base, highlight=[ts[start], ts[last]])),
            check('growing', 'Each swing bigger than the last', 'required', MATCH,
                  f'First cycle {num(pp[0], 1)} points peak-to-peak, largest {num(max(pp), 1)} points '
                  f'({num(max(pp) / pp[0], 1)}×). Widest excursion {num(max(v[start:last + 1]), 1)} % against '
                  f'{num(min(v[start:last + 1]), 1)} %.',
                  'This is the decisive one. A process upset decays, because the process damps it. Something has to '
                  'be putting energy in for the swing to grow, and the only thing doing that is the correcting.',
                  spark(v, vd, highlight=[ts[start], ts[last]])),
            check('phase', 'Controller output moving against the rate', 'required', MATCH,
                  f'Correlation {num(c["phase_r"], 2)} between charge rate and controller output over '
                  f'{ts[i0]}–{ts[i]}: controller output {num(min(ctrl[start:last + 1]), 1)}–'
                  f'{num(max(ctrl[start:last + 1]), 1)} % in the opposite direction, sample for sample. The '
                  f'swing crosses the setting about every {dur(period)}, so each move landed while the last one was '
                  f'still working through.',
                  'When a correction arrives before the last one has worked through, it adds to the swing instead of '
                  'cancelling it. Anti-phase is what that looks like in the two traces.',
                  spark(ctrl, vd, v, v, highlight=[ts[start], ts[last]])),
            check('osc', 'Oscillation index above the fleet', 'required', MATCH,
                  f'{num(max(osc[start:last + 1]), 2)} at {ts[max(range(start, last + 1), key=lambda k: osc[k])]} '
                  f'against {num(p["osc_min"], 1)} alert and a worst-of-the-others {num(max(posc), 2)}. '
                  f'{lname} instability {num(instab[start - 1], 2)} → {num(max(instab[start:last + 1]), 2)}.',
                  'The oscillation index is computed from the signal shape, not from its level, so it picks up the '
                  'swinging independently of how big the excursions are.',
                  spark(osc, nice_domain(osc, posc, pad=0.1, floor=0), threshold_value=p['osc_min'])),
            check('running', 'The station never stopped', 'required', MATCH,
                  f'Rate {num(min(r[start:last + 1]))}–{num(max(r[start:last + 1]))}/min through the whole episode, '
                  f'never below {num(100 * min(r[start:last + 1]) / rbase, 0)} % of its {num(rbase)}/min baseline.',
                  'This separates an oscillation from a trip. Nothing failed — the charger did its best to follow a '
                  'setting that would not stay still.',
                  spark(r, nice_domain(r, pad=0.1), threshold_value=rbase * p['running_frac'])),
            check('carried', 'Throughput and the line felt it', 'supporting', MATCH if carried_ok else NO_MATCH,
                  f'Rate swung {num(swing_r)}/min and {pack.name(down)} {num(swing_d)}/min — about '
                  f'{num(100 * swing_d / swing_r, 0)} % of it, as you would expect one station downstream. '
                  f'{lname} health dipped to {num(min(health[start:end + 1]))} %.',
                  'A sensor problem would stay inside the one signal. This moved product.',
                  spark(dr, nice_domain(dr, pad=0.15), highlight=[ts[start], ts[last]])),
            check('damped', 'Damped once the corrections stopped', 'supporting',
                  MATCH if damped_ok else NO_MATCH,
                  f'Back inside ±{num(p["settle_pct"], 1)} % of {num(base, 1)} % from {ts[end]} and steady since '
                  f'({num(min(v[end:]), 1)}–{num(max(v[end:]), 1)} %); oscillation index back to '
                  f'{num(osc[now], 2)} and {lname} instability to {num(instab[now], 2)}.',
                  'Nothing was repaired. The swing stopped when the correcting stopped, which is the clearest '
                  'evidence of what was driving it.',
                  spark(v, vd, threshold_value=base, highlight=[ts[end], ts[now]])),
        ]
        main = chart('%', vd,
                     [series('charge', f'{name} charge rate', v, 'primary', 1),
                      series('ctrl', 'Controller output', ctrl, 'secondary', 1),
                      series('base', 'Validated setting', [base] * pack.n, 'expected', 1)],
                     title='What we see',
                     caption=f'Charge rate and controller output against the {num(base, 1)} % setting the station '
                             f'held all morning. The two move in opposite directions, and the swing grows from '
                             f'{num(pp[0], 1)} to {num(max(pp), 1)} points before it damps.',
                     markers=[marker(ts[start], 'First swing'), marker(ts[i], 'Flagged'),
                              marker(ts[max(range(start, last + 1), key=lambda k: abs(v[k] - base))], 'Widest'),
                              marker(ts[end], 'Stabilised')])

        grid = minutes_grid(-20, 60, 5)
        rng = Rng(2459)
        tb, tight, upset = [], [], []
        for m in grid:
            ph = math.sin(2 * math.pi * m / 10.0)
            tb.append(base + (0.0 if m < 0 else min(7.0, 1.6 + 0.18 * m) * ph *
                              (1.0 if m < 30 else max(0.0, 1 - (m - 30) / 25))) + rng.gauss(0.25))
            tight.append(base + (0.0 if m < 0 else 3.0 * ph) + rng.gauss(0.25))
            upset.append(base + (0.0 if m < 0 else -8.0 * math.exp(-m / 12.0)) + rng.gauss(0.25))
        live = aligned(v, start, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Charge rate (min from the first swing)', '%',
                                  [base - 10, base + 10], grid, 'min', a, live, f'{name}, today', 1,
                                  [threshold(base, 'Validated setting')])]
        refs = [
            reference('operator', 'textbook', 'Textbook', 'Operator-driven oscillation',
                      'Corrections every two or three minutes on a loop that needs five to settle. The swing grows '
                      'for three or four cycles, then damps out within minutes of the hands coming off.',
                      'match', 'Closest match',
                      [f'Same growth: {num(pp[0], 1)} → {num(max(pp), 1)} points peak-to-peak',
                       f'Damped {dur(pack.minutes_between(last, end))} after the last move'], mk(tb)),
            reference('tuning', 'variant', 'Variant', 'Controller tuned too tight',
                      'The same swinging without anyone touching it: constant amplitude, constant period, running '
                      'until the gain is changed. It does not grow and it does not stop on its own.',
                      'nomatch', 'Does not match',
                      [f'This one grew {num(max(pp) / pp[0], 1)}× and then stopped by itself',
                       'A tuning fault would still be swinging now'], mk(tight)),
            reference('upset', 'lookalike', 'Look-alike', 'A single process upset',
                      'One excursion, then an exponential return to setpoint as the loop does its job. Looks '
                      'alarming on the first sample and needs no action at all.',
                      'nomatch', 'Does not match',
                      [f'Today there were {len(keep)} crossings, not one',
                       'An upset decays; this built up'], mk(upset)),
        ]
        ro = [
            ruled_out('A faulty charge-rate sensor', 'ruled out',
                      f'Controller output, station throughput ({num(swing_r)}/min of swing) and {pack.name(down)} '
                      f'({num(swing_d)}/min) all moved with it, and {lname} instability went '
                      f'{num(instab[start - 1], 2)} → {num(max(instab[start:last + 1]), 2)}. A bad reading does not '
                      f'move product.'),
            ruled_out('A real process disturbance', 'ruled out',
                      f'A disturbance decays. This grew from {num(pp[0], 1)} to {num(max(pp), 1)} points over '
                      f'{len(pp)} cycles, with the controller output {num(c["phase_r"], 2)} correlated — pushing '
                      f'against the response rather than with it.'),
            ruled_out('A drive or mechanical fault', 'ruled out',
                      f'Vibration stayed at {num(min(pack.series(aid, "vibration_mms")[start:last + 1]), 2)}–'
                      f'{num(max(pack.series(aid, "vibration_mms")[start:last + 1]), 2)} mm/s and bearing '
                      f'temperature at {num(min(pack.series(aid, "bearing_temp_c")[start:last + 1]))}–'
                      f'{num(max(pack.series(aid, "bearing_temp_c")[start:last + 1]))} °C, and the station never '
                      f'dropped below {num(100 * min(r[start:last + 1]) / rbase, 0)} % of rate.'),
            ruled_out('A controller tuning fault', 'unlikely',
                      f'The loop held {num(base, 1)} % within '
                      f'{num(max(abs(x - base) for x in v[:start]), 2)} points for the '
                      f'{dur(pack.minutes_between(0, start))} before this, and has done again since {ts[end]}. '
                      f'The tuning did not change in between; the number of hands on it did.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'Repeated manual corrections on a loop that needs longer than that to settle '
                                     f'— the correcting grew the swing from {num(pp[0], 1)} to '
                                     f'{num(max(pp), 1)} points', level,
                                     'Confirmed: it damped as soon as the corrections stopped' if damped_ok else
                                     'Growth and anti-phase both point at the control action'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Power Charge stations are used only for the oscillation-index comparison '
                        f'(worst of the others {num(max(posc), 2)} against {num(max(osc), 2)} here). Everything else '
                        f'is this station against its own validated setting.',
            'confidence': confidence(level,
                                     f'The growth across cycles, the {num(c["phase_r"], 2)} correlation with '
                                     f'controller output, the throughput swing and the line instability are four '
                                     f'separate readings, and it damped {dur(pack.minutes_between(last, end))} after '
                                     f'the last move with nothing repaired.' if damped_ok else
                                     'A growing swing with the controller output in anti-phase is a correction loop, '
                                     'not a disturbance.',
                                     None if damped_ok else 'The correction times are taken from the logged setpoint '
                                                            'changes, not measured against the loop\'s own settling '
                                                            'time.',
                                     None if damped_ok else 'The swing damps once the corrections stop.',
                                     'It starts swinging again with nobody touching it — then the controller tuning '
                                     'or the charge-rate sensor is next.'),
            'action': action(item, pack),
            'model': {'target': 'charge_rate',
                      'formula': f'the {num(base, 1)} % setting this station held over the '
                                 f'{dur(p["baseline_min"])} before the first swing',
                      'fittedOn': 'self'},
            'impact': f'No product lost — rate stayed within {num(swing_r)}/min of normal — but {lname} instability '
                      f'peaked at {num(max(instab), 1)} and health dipped to {num(min(health))} %. The cost of this '
                      f'one is the risk while it is growing, not the units.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 10. Transfer gate physically blocked — archetype 11 (hard block)
# ═════════════════════════════════════════════════════════════════════════
class TransferHardBlock(Detector):
    id = 'refinery.transfer_hard_block'
    name = 'Transfer gate physically blocked'
    archetype = '11 Hard block'
    applies_to = 'Transfer gates'
    summary = ('A Transfer gate at zero rate for several samples with its motor current spiking at the moment it '
               'stopped and then sitting at idle. A current spike into a hard stop is an obstruction, not a control '
               'problem.')
    pipeline = [
        ('Stop', 'gate rate at zero for more than one sample — not a dip, a stop'),
        ('Spike', 'motor current in the sample it stopped, against its running baseline'),
        ('Idle', 'motor current through the stop: the drive is turning against nothing, or not turning'),
        ('Hold', 'the rest of the line at zero too — a controlled hold rather than one station failing quietly'),
        ('Checks', 'zero · current spike · idle through · line held · restart surge · availability'),
        ('Conclusion', 'a physical obstruction; hold, confirm, clear with the validated procedure'),
    ]
    definition = {
        'appliesTo': {'assetType': 'transfer'},
        'inputs': {'gate': 'self.transfer_rate_per_min', 'rate': 'self.throughput_per_min',
                   'current': 'self.motor_current_a', 'starve': 'self.starvation_time',
                   'block': 'self.blocking_time', 'stress': 'self.system_stress',
                   'line': 'line.line_throughput, line_availability, line_oee, instability_index',
                   'others': 'the other stations on the line: throughput_per_min',
                   'work': 'done PROCEDURE work items on this gate (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Transfer gates (sanity check only)'},
        'expected': {'model': 'own running baseline', 'target': 'gate',
                     'formula': 'median(transfer_rate_per_min over baseline_min before the stop)', 'fitOn': 'self'},
        'params': {'baseline_min': 60, 'zero_per_min': 1.0, 'min_stop_min': 10, 'spike_ratio': 1.30,
                   'idle_frac': 0.35, 'hold_frac': 0.05, 'restart_ratio': 1.10, 'stress_rise': 8.0,
                   'avail_drop_pct': 0.2},
        'checks': [
            {'id': 'zero', 'role': 'required', 'rule': 'gate rate < zero_per_min for ≥ min_stop_min'},
            {'id': 'spike', 'role': 'required', 'rule': 'motor current in the stopping sample > spike_ratio × its running baseline'},
            {'id': 'idle', 'role': 'required', 'rule': 'motor current < idle_frac × baseline for the rest of the stop'},
            {'id': 'held', 'role': 'required', 'rule': 'every other station on the line is below hold_frac × its baseline during the stop'},
            {'id': 'restart', 'role': 'supporting', 'independent': True, 'rule': 'motor current > restart_ratio × baseline on the first moving sample, and the rate comes back in steps'},
            {'id': 'stress', 'role': 'supporting', 'independent': True, 'rule': 'gate stress up by stress_rise and starvation only at the restart'},
            {'id': 'cleared', 'role': 'supporting', 'independent': True, 'rule': 'a block-clearing procedure closed on this gate and the gate has run normally since'},
        ],
        'ruleOut': ['starved of material', 'a drive or motor failure', 'a control or interlock trip',
                    'a planned changeover'],
        'confidence': {'low': 'required checks only', 'medium': 'the restart surge or the stress trace agrees',
                       'high': 'confirmed visually and cleared by the validated procedure'},
        'references': ['textbook: obstruction at the gate', 'variant: drive failure',
                       'look-alike: starved gate'],
    }

    def candidates(self, pack):
        return pack.of_type('transfer')

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        g = pack.series(aid, 'transfer_rate_per_min')
        cur = pack.series(aid, 'motor_current_a')
        line = line_of(pack, aid)
        others = [s for s in stations(pack, line) if s != aid]
        zero = [v < p['zero_per_min'] for v in g]
        for s0, e0 in B.runs(zero):
            if pack.minutes_between(s0, e0) + pack.step_min < p['min_stop_min'] or s0 == 0:
                continue
            bl = pack.steps(p['baseline_min'])
            gb = baseline(g, max(0, s0 - bl), s0 - 1)
            cb = baseline(cur, max(0, s0 - bl), s0 - 1)
            if max(cur[s0 - 1], cur[s0]) < cb * p['spike_ratio']:
                continue
            if any(cur[k] >= cb * p['idle_frac'] for k in range(s0 + 1, e0 + 1)):
                continue
            held = True
            for s in others:
                sb = baseline(rate(pack, s), max(0, s0 - bl), s0 - 1)
                if min(rate(pack, s)[k] for k in range(s0 + 1, e0 + 1)) >= sb * p['hold_frac']:
                    held = False
            if not held:
                continue
            i = min(e0, pack.n - 1)
            spike_k = s0 if cur[s0] >= cur[s0 - 1] else s0 - 1
            return Finding(aid, True, min(s0 + 1, i), g=g, cur=cur, gb=gb, cb=cb, s0=s0, e0=e0,
                           others=others, spike_k=spike_k)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        g, cur, gb, cb = c['g'], c['cur'], c['gb'], c['cb']
        s0, e0, others, spike_k = c['s0'], c['e0'], c['others'], c['spike_k']
        restart = min(e0 + 1, pack.n - 1)
        back = next((k for k in range(restart, pack.n) if g[k] >= gb * 0.97), pack.now)
        stv = pack.series(aid, 'starvation_time')
        stress = pack.series(aid, 'system_stress')
        bl = pack.steps(p['baseline_min'])
        restart_ok = cur[restart] > cb * p['restart_ratio'] and g[restart] < gb * 0.9
        stress_ok = (max(stress[s0:restart + 1]) - baseline(stress, max(0, s0 - bl), s0 - 1) >= p['stress_rise']
                     and max(stv[restart:back + 1]) > max(stv[s0:e0 + 1]))
        jobs = [(w, idx_at(pack, w.get('completedAt'))) for w in pack.work
                if w['assetId'] == aid and w.get('done') and w.get('completedAt')]
        job = jobs[0] if jobs else None
        cleared_ok = job is not None and back >= job[1] and min(g[back:]) > gb * 0.9
        independent = sum([restart_ok, stress_ok, cleared_ok])
        level = 'high' if cleared_ok else ('medium' if independent else 'low')
        lt = pack.series(line, 'line_throughput')
        la = pack.series(line, 'line_availability')
        lo = pack.series(line, 'line_oee')
        instab = pack.series(line, 'instability_index')
        stop_min = pack.minutes_between(s0, e0) + pack.step_min
        lost = gb * stop_min
        gd = nice_domain([0, gb * 1.1], pad=0.02, floor=0)
        cd = nice_domain(cur, [0], pad=0.05, floor=0)

        checks = [
            check('zero', f'Gate at zero for {dur(stop_min)}', 'required', MATCH,
                  f'{num(g[s0 - 1])}/min at {ts[s0 - 1]}, then 0.0/min from {ts[s0]} to {ts[e0]} — '
                  f'{(e0 - s0 + 1)} samples against a {num(gb)}/min running rate.',
                  'Zero, not low. A gate that is merely slow still passes product; this one passed none at all.',
                  spark(g, gd, threshold_value=p['zero_per_min'])),
            check('spike', 'Motor current spiked as it stopped', 'required', MATCH,
                  f'{num(cur[spike_k])} A at {ts[spike_k]} against a {num(cb)} A running baseline — '
                  f'{num(cur[spike_k] / cb, 1)}× normal. Alert level is {num(p["spike_ratio"], 2)}×.',
                  'The drive pushed hard against something that would not move. That is what separates an '
                  'obstruction from everything else that stops a gate.',
                  spark(cur, cd, threshold_value=cb * p['spike_ratio'])),
            check('idle', 'Then the drive sat at idle', 'required', MATCH,
                  f'{num(min(cur[s0 + 1:e0 + 1]))}–{num(max(cur[s0 + 1:e0 + 1]))} A from {ts[s0 + 1]} to {ts[e0]} — '
                  f'about {num(100 * B.mean(cur[s0 + 1:e0 + 1]) / cb, 0)} % of running current.',
                  'Spike, then idle. The gate was taken out of service deliberately after it jammed, rather than '
                  'being left to grind.',
                  spark(cur, cd, threshold_value=cb * p['idle_frac'], highlight=[ts[s0], ts[e0]])),
            check('held', f'All {len(others)} other stations held at zero too', 'required', MATCH,
                  '; '.join(f'{pack.name(s)} {num(min(rate(pack, s)[s0 + 1:e0 + 1]))}/min'
                            for s in others) + f'. {lname} throughput {num(lt[s0 - 1])} → '
                  f'{num(min(lt[s0:e0 + 1]))}/min.',
                  'A controlled hold: the line was stopped around the jam rather than left to block back station by '
                  'station. It is also why the gate reports neither blocking nor starvation during the stop — it is '
                  'the station that is down.',
                  spark(lt, gd, highlight=[ts[s0], ts[e0]])),
            check('restart', 'Restart surge, then rate in steps', 'supporting',
                  MATCH if restart_ok else NO_MATCH,
                  f'{num(cur[restart])} A at {ts[restart]} ({num(cur[restart] / cb, 1)}× running) with the gate at '
                  f'{num(g[restart])}/min, then {num(g[min(restart + 1, pack.n - 1)])}/min and '
                  f'{num(g[back])}/min by {ts[back]}.',
                  'Breaking out of standstill with a full gate takes more current than running. The stepped recovery '
                  'is the line filling back up behind it.',
                  spark(cur, cd, highlight=[ts[restart], ts[back]])),
            check('stress', 'Gate stress up, starvation only on restart', 'supporting',
                  MATCH if stress_ok else NO_MATCH,
                  f'Stress {num(baseline(stress, max(0, s0 - bl), s0 - 1))} → '
                  f'{num(max(stress[s0:restart + 1]))}; starvation time {num(max(stv[s0:e0 + 1]), 2)} during the '
                  f'hold against {num(max(stv[restart:back + 1]), 2)} at the restart.',
                  'During the hold there was nothing to be starved of. Starvation appears only when the line starts '
                  'moving again and the gate is waiting for material — which is the right way round for a gate that '
                  'was itself the blockage.',
                  spark(stv, nice_domain(stv, pad=0.2, floor=0), highlight=[ts[restart], ts[back]])),
            check('cleared', 'Cleared by the validated procedure', 'supporting',
                  MATCH if cleared_ok else (PENDING if job is None else NO_MATCH),
                  (f'{job[0]["text"]} ({job[0]["id"]}) closed {job[0]["completedAt"][11:16]}; the gate came back '
                   f'through {num(g[restart])}/min and {num(g[min(restart + 1, pack.n - 1)])}/min and has run '
                   f'{num(min(g[back:]))}–{num(max(g[back:]))}/min since {ts[back]}, with current back to '
                   f'{num(cur[now])} A.' if job else 'No clearing procedure closed on this gate.'),
                  'An obstruction is the one failure mode you can confirm by looking. Once it is out and the gate '
                  'runs normally, there is nothing left to diagnose.',
                  spark(g, gd, highlight=[ts[job[1]], ts[now]]) if job else None),
        ]
        main = chart('/min', gd,
                     [series('gate', f'{name} gate rate', g, 'primary', 1),
                      series('line', f'{lname} throughput', lt, 'secondary', 1)],
                     title='What we see',
                     caption=f'The gate rate and the line behind it. Zero from {ts[s0]} to {ts[e0]} '
                             f'({dur(stop_min)}), with motor current spiking to {num(cur[spike_k])} A as it stopped '
                             f'and idling at about {num(B.mean(cur[s0 + 1:e0 + 1]))} A through the hold.',
                     markers=[marker(ts[spike_k], f'Current {num(cur[spike_k])} A'), marker(ts[s0], 'Blocked'),
                              marker(ts[restart], 'Clearing'), marker(ts[back], 'Back to baseline')])

        grid = minutes_grid(-15, 45, 5)
        rng = Rng(3581)
        tb_g, tb_c, dv_g, dv_c, sv_g, sv_c = [], [], [], [], [], []
        for m in grid:
            inside = 0 <= m < 18
            tb_g.append(0.0 if inside else (gb if m < 0 else min(gb, gb * (m - 18) / 12)) + (rng.gauss(0.5) if not inside else 0.0))
            tb_c.append(cb * 1.5 if m == 0 else (cb * 0.2 if inside else (cb * 1.15 if m == 20 else cb + rng.gauss(1.0))))
            dv_g.append(0.0 if m >= 0 else gb + rng.gauss(0.5))
            dv_c.append(cb * 0.0 if m >= 0 else cb + rng.gauss(1.0))
            sv_g.append((gb * 0.2 if inside else gb) + rng.gauss(0.5))
            sv_c.append((cb * 0.35 if inside else cb) + rng.gauss(1.0))
        live_g = aligned(g, s0, pack.step_min, grid, 'min')
        live_c = aligned(cur, s0, pack.step_min, grid, 'min')
        pair = lambda a, b: [ref_chart('Gate rate (min from the stop)', '/min', [0, gb * 1.15], grid, 'min', a,
                                       live_g, f'{name}, today', 0, [threshold(gb, 'Running rate')]),
                             ref_chart('Motor current', 'A', [0, cb * 1.7], grid, 'min', b, live_c,
                                       f'{name}, today', 0, [threshold(cb, 'Running current')])]
        refs = [
            reference('obstruction', 'textbook', 'Textbook', 'Obstruction at the gate',
                      'Current spikes into a hard stop, the line goes to a controlled hold, somebody looks, the '
                      'obstruction comes out, and the restart draws more current than running before the rate steps '
                      'back up.',
                      'match', 'Closest match',
                      [f'Same spike-then-idle: {num(cur[spike_k])} A then {num(B.mean(cur[s0 + 1:e0 + 1]))} A',
                       f'Restart at {num(cur[restart])} A with the gate at {num(g[restart])}/min'],
                      pair(tb_g, tb_c)),
            reference('drive', 'variant', 'Variant', 'Drive failure',
                      'Zero rate just the same, but the current goes to nothing at the same moment — no spike, '
                      'because nothing pushed against anything. The gate will not restart until the drive is '
                      'replaced.',
                      'nomatch', 'Does not match',
                      [f'Today the current went to {num(cur[spike_k])} A first',
                       f'And the gate restarted on its own drive at {ts[restart]}'], pair(dv_g, dv_c)),
            reference('starved', 'lookalike', 'Look-alike', 'Starved gate',
                      'The gate runs but has nothing to pass: rate falls towards zero gradually, current falls with '
                      'the load, starvation time climbs, and the stations *upstream* are the ones at fault.',
                      'nomatch', 'Does not match',
                      [f'Starvation time stayed at {num(max(stv[s0:e0 + 1]), 2)} through the hold',
                       f'And the stop was square: {num(g[s0 - 1])}/min to 0.0/min in one sample'],
                      pair(sv_g, sv_c)),
        ]
        ro = [
            ruled_out('Starved of material', 'ruled out',
                      f'Starvation time read {num(max(stv[s0:e0 + 1]), 2)} through the hold and only rose to '
                      f'{num(max(stv[restart:back + 1]), 2)} at the restart. A starved gate also takes *less* '
                      f'current, not {num(cur[spike_k])} A.'),
            ruled_out('A drive or motor failure', 'ruled out',
                      f'The current spiked to {num(cur[spike_k])} A before the stop and the same drive restarted the '
                      f'gate at {num(cur[restart])} A. A failed drive gives no spike and no restart.'),
            ruled_out('A control or interlock trip', 'unlikely',
                      f'A trip takes the drive straight to idle without a spike. Here {num(cur[spike_k])} A was '
                      f'drawn first, which means the gate was trying to move something.'),
            ruled_out('A planned changeover', 'ruled out',
                      f'{lname} target rate stayed at {num(median(pack.series(line, "line_target_rate")), 0)}/min '
                      f'and the line state read {line_state(pack, aid)}, so the stop is charged against '
                      f'availability: {num(la[s0 - 1], 2)} → {num(la[now], 2)} %.'),
        ]
        return {
            'conclusion': conclusion('Cause',
                                     f'A physical obstruction in the Transfer gate — current spiked into a hard '
                                     f'stop, and the line went to a controlled hold for {dur(stop_min)}', level,
                                     'Confirmed visually and cleared by the validated procedure' if cleared_ok else
                                     'Current spike into a square stop'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Transfer gates are not part of the judgement; this is one gate against its '
                        f'own running rate and current. They do confirm nothing else in Ferrum stopped at {ts[s0]}.',
            'confidence': confidence(level,
                                     f'The gate rate, the motor current, the gate\'s own stress and starvation '
                                     f'traces and the four other stations on the line all agree, and the '
                                     f'obstruction was confirmed at the machine before the gate was cleared.'
                                     if cleared_ok else
                                     'A current spike into a square stop is an obstruction; nothing else produces '
                                     'that pair.',
                                     None if cleared_ok else 'Nobody has looked into the gate yet.',
                                     None if cleared_ok else 'Somebody confirms the obstruction at the gate.',
                                     'The gate is found clear — then the drive, the gate mechanism and the interlock '
                                     'chain are what to look at, and the gate should not be restarted first.',
                                     f'{job[0]["text"]} ({job[0]["id"]}), closed {job[0]["completedAt"][11:16]}'
                                     if job else None),
            'action': action(item, pack),
            'model': {'target': 'transfer_rate_per_min',
                      'formula': f'the gate\'s own running rate {num(gb)}/min and running current {num(cb)} A over '
                                 f'the {dur(p["baseline_min"])} before the stop',
                      'fittedOn': 'self'},
            'impact': f'About {num(lost, 0)} units not made in {dur(stop_min)}. {lname} rolling availability '
                      f'{num(la[s0 - 1], 2)} → {num(la[now], 2)} % and OEE {num(lo[s0 - 1], 2)} → '
                      f'{num(lo[now], 2)} % — 24-hour figures, so they stay down for the rest of the day. '
                      f'Instability peaked at {num(max(instab), 1)}.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 11. Recurring Power Charge micro-stops — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
class ChargerMicroStops(Detector):
    id = 'refinery.charger_micro_stops'
    explains_items = ('SIT12',)
    name = 'Recurring Power Charge micro-stops'
    archetype = '12 Recurring micro-events'
    applies_to = 'Power Charge stations'
    summary = ('A Power Charge station taking repeated short interruptions that each recover on their own. No single '
               'one is worth stopping for; together they are costing a measurable share of the line\'s output.')
    pipeline = [
        ('Baseline', 'the median rate this station held over the two hours before the window — a local baseline, '
                     'because the line pace drifts slowly all day'),
        ('Events', 'samples more than dip_frac below that baseline inside a rolling hour — recurrence, not one event'),
        ('Short', 'each run of them is brief and the rate returns to baseline on its own; the station never goes '
                  'near zero'),
        ('Cost', 'the mean shortfall across the whole stretch, as a share of baseline'),
        ('Checks', 'recurring · self-recovering · never stopped · real loss · downstream starved · supply normal · '
                   'demand peaks'),
        ('Conclusion', 'the accumulation is the finding; inspect at the next pause rather than stopping now'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_charge'},
        'inputs': {'rate': 'self.throughput_per_min', 'charge': 'self.charge_rate',
                   'osc': 'self.oscillation_index', 'current': 'self.motor_current_a',
                   'vib': 'self.vibration_mms',
                   'transfer': 'line transfer: starvation_time, blocking_time',
                   'head': 'line head: material_availability, supply_variability',
                   'line': 'line.instability_index, total_wip',
                   'work': 'open INSPECTION work items on this station (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five Power Charge stations'},
        'expected': {'model': 'own local baseline', 'target': 'rate',
                     'formula': 'median(rate over the baseline_min before the window)', 'fitOn': 'self'},
        'params': {'dip_frac': 0.035, 'window_min': 60, 'baseline_min': 120, 'min_events': 3, 'min_runs': 2,
                   'max_episode_min': 25, 'recover_frac': 0.98, 'stop_frac': 0.50, 'idle_frac': 0.40,
                   'loss_pct': 2.0, 'starve_rise': 0.3, 'avail_pct': 98.0, 'osc_rise': 0.4,
                   'charge_rise_pct': 0.8},
        'checks': [
            {'id': 'recurring', 'role': 'required', 'rule': '≥ min_events samples below (1 − dip_frac) × the local baseline inside window_min, in ≥ min_runs separate runs — recurrence, not one block of reduced rate'},
            {'id': 'short', 'role': 'required', 'rule': 'every run of them ≤ max_episode_min, and the samples between the runs average ≥ recover_frac × baseline — the station is back at full rate in between'},
            {'id': 'notstopped', 'role': 'required', 'rule': 'rate never below stop_frac × baseline and motor current never at idle — not a block or a trip'},
            {'id': 'loss', 'role': 'required', 'rule': 'mean shortfall from the first event to now ≥ loss_pct of baseline'},
            {'id': 'starved', 'role': 'supporting', 'independent': True, 'rule': 'Transfer starvation time rises with the dips by starve_rise, while blocking time does not'},
            {'id': 'supply', 'role': 'supporting', 'independent': True, 'rule': 'line-head material availability stays above avail_pct — not a supply problem'},
            {'id': 'demand', 'role': 'supporting', 'rule': 'charge demand and oscillation index are higher in the dip samples than between them'},
            {'id': 'inspected', 'role': 'supporting', 'independent': True, 'rule': 'an inspection on this station has closed'},
        ],
        'ruleOut': ['input material supply', 'a downstream blockage', 'one long slowdown',
                    'a counting problem at this station'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'confirmed by an inspection of the station'},
        'references': ['textbook: recurring micro-stops', 'variant: one long stop of the same size',
                       'look-alike: normal rate noise'],
    }

    def candidates(self, pack):
        return pack.of_type('power_charge')

    def _events(self, pack, aid, base, i0, i1):
        """Runs of samples more than dip_frac below the local baseline, inside [i0, i1]."""
        p = self.p
        r = rate(pack, aid)
        dip = [i0 <= k <= i1 and v < base * (1 - p['dip_frac']) for k, v in enumerate(r)]
        return B.runs(dip)

    def _base(self, pack, aid, key, i0):
        b = pack.steps(self.p['baseline_min'])
        v = pack.series(aid, key)
        return baseline(v, max(0, i0 - b), i0)

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        r = rate(pack, aid)
        cur = pack.series(aid, 'motor_current_a')
        w = pack.steps(p['window_min'])
        for i in range(w + pack.steps(p['baseline_min']) // 2, pack.n):
            i0 = i - w
            base = self._base(pack, aid, 'throughput_per_min', i0)
            if base is None:
                continue
            ev = self._events(pack, aid, base, i0, i)
            samples = sum(e - s + 1 for s, e in ev)
            if samples < p['min_events'] or len(ev) < p['min_runs']:
                continue
            if any(pack.minutes_between(s, e) + pack.step_min > p['max_episode_min'] for s, e in ev):
                continue
            dip = set(k for s, e in ev for k in range(s, e + 1))
            between = [r[k] for k in range(i0, i + 1) if k not in dip]
            if not between or B.mean(between) < base * p['recover_frac']:
                continue
            if min(r[i0:i + 1]) < base * p['stop_frac']:
                continue
            cb = self._base(pack, aid, 'motor_current_a', i0)
            if min(cur[i0:i + 1]) < cb * p['idle_frac']:
                continue
            loss = 100 * (base - B.mean(r[ev[0][0]:i + 1])) / base
            if loss < p['loss_pct']:
                continue
            return Finding(aid, True, i, r=r, cur=cur, base=base, cb=cb, i0=i0, ev=ev, loss=loss,
                           samples=samples)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        r, cur, base, cb = c['r'], c['cur'], c['base'], c['cb']
        ev = self._events(pack, aid, base, c['i0'], pack.now)
        start = ev[0][0]
        samples = sum(e - s + 1 for s, e in ev)
        loss = 100 * (base - B.mean(r[start:pack.now + 1])) / base
        worst = min(range(start, pack.now + 1), key=lambda k: r[k])
        tr = pack.descendant_of_type(line, 'transfer')
        stv, blk = pack.series(tr, 'starvation_time'), pack.series(tr, 'blocking_time')
        bl = pack.steps(60)
        stv_base = self._base(pack, tr, 'starvation_time', c['i0'])
        blk_base = self._base(pack, tr, 'blocking_time', c['i0'])
        dip_ks = [k for s, e in ev for k in range(s, e + 1)]
        between = [k for k in range(start, pack.now + 1) if k not in dip_ks]
        between_r = [r[k] for k in between]
        starved_ok = (B.mean([stv[k] for k in dip_ks]) - stv_base >= p['starve_rise']
                      and B.mean([blk[k] for k in dip_ks]) <= blk_base + p['starve_rise'])
        head = stations(pack, line)[0]
        avail = pack.series(head, 'material_availability') if pack.has(head, 'material_availability') else None
        supply_ok = avail is not None and min(avail[start:pack.now + 1]) > p['avail_pct']
        ch = pack.series(aid, 'charge_rate')
        osc = pack.series(aid, 'oscillation_index')
        demand_ok = (B.mean([ch[k] for k in dip_ks]) - (B.mean([ch[k] for k in between]) if between else 0)
                     >= base * 0 + p['charge_rise_pct'] * 0.1
                     and B.mean([osc[k] for k in dip_ks])
                     - self._base(pack, aid, 'oscillation_index', c['i0']) >= p['osc_rise'])
        jobs = [w for w in pack.work if w['assetId'] == aid and w['workType'] == 'INSPECTION']
        done = [w for w in jobs if w.get('done')]
        openj = [w for w in jobs if not w.get('done')]
        inspected_ok = bool(done)
        independent = sum([starved_ok, supply_ok, inspected_ok])
        level = 'high' if inspected_ok else ('medium' if independent else 'low')
        vib = pack.series(aid, 'vibration_mms')
        instab = pack.series(line, 'instability_index')
        lost_units = sum(max(0.0, base - r[k]) for k in range(start, pack.now + 1)) * pack.step_min
        rd = nice_domain(r[start:], [base * 0.98, base * 1.02], pad=0.05)
        ev_txt = ', '.join(f'{ts[s]}' + (f'–{ts[e]}' if e > s else '') + f' ({num(min(r[s:e + 1]))}/min)'
                           for s, e in ev)

        checks = [
            check('recurring', f'{samples} interrupted samples in {len(ev)} runs since {ts[start]}', 'required',
                  MATCH,
                  f'{ev_txt}. Each below {num(base * (1 - p["dip_frac"]))}/min '
                  f'({num(100 * p["dip_frac"], 1)} % under the {num(base)}/min this station held over the '
                  f'{dur(p["baseline_min"])} before), inside a {dur(p["window_min"])} window. Alert level is '
                  f'{p["min_events"]} samples in at least {p["min_runs"]} separate runs.',
                  'One dip is a dip. Several in an hour, in separate runs, each recovering on its own, is a '
                  'pattern — and a pattern has a cause worth finding. Separate runs are what distinguishes it from '
                  'a line that has simply been turned down for a while.',
                  spark(r, rd, threshold_value=base * (1 - p['dip_frac']), highlight=[ts[start], ts[now]])),
            check('short', 'Each one recovers by itself', 'required', MATCH,
                  f'Longest run {dur(max(pack.minutes_between(s, e) + pack.step_min for s, e in ev))}, against a '
                  f'{dur(p["max_episode_min"])} limit. The {len(between)} samples between the runs average '
                  f'{num(B.mean(between))}/min — {num(100 * B.mean(between) / base)} % of baseline, above the '
                  f'{num(100 * p["recover_frac"], 0)} % the check asks for.',
                  'Nobody restarted anything. Interruptions that clear themselves are seconds long — the 5-minute '
                  'sample is what makes them look like small dips rather than stops.',
                  spark(r, rd, threshold_value=base * p['recover_frac'])),
            check('notstopped', 'Never actually stopped', 'required', MATCH,
                  f'Lowest rate {num(r[worst])}/min at {ts[worst]} — {num(100 * r[worst] / base, 0)} % of baseline, '
                  f'well above the {num(100 * p["stop_frac"], 0)} % that marks a stop. Motor current never below '
                  f'{num(min(cur[start:]))} A against {num(cb)} A running and about '
                  f'{num(cb * p["idle_frac"])} A at idle.',
                  'This is what separates micro-stops from a block or a trip. The drive kept turning under load the '
                  'whole time.',
                  spark(cur, nice_domain(cur, [0], pad=0.05, floor=0), threshold_value=cb * p['idle_frac'])),
            check('loss', 'The accumulation is real', 'required', MATCH,
                  f'{num(loss)} % average shortfall between {ts[start]} and {ts[now]} '
                  f'({num(B.mean(r[start:pack.now + 1]))}/min against {num(base)}/min) — about '
                  f'{num(lost_units, 0)} units. Alert level is {num(p["loss_pct"], 1)} %.',
                  'Each stop is trivial; the hour is not. This is the number that justifies a job rather than a '
                  'note.',
                  spark(r, rd, threshold_value=base, highlight=[ts[start], ts[now]])),
            check('starved', f'{pack.name(tr)} starved at each dip, not blocked', 'supporting',
                  MATCH if starved_ok else NO_MATCH,
                  f'Starvation time averaged {num(B.mean([stv[k] for k in dip_ks]), 2)} in the dip samples against '
                  f'{num(stv_base, 2)} before the pattern started, peaking at '
                  f'{num(max(stv[k] for k in dip_ks), 2)}; blocking time stayed at '
                  f'{num(B.mean([blk[k] for k in dip_ks]), 2)}.',
                  'The gate is instrumented separately. Starved and not blocked puts the interruption upstream of '
                  'the gate, which on this line means at or before the charger.',
                  spark(stv, nice_domain(stv, pad=0.2, floor=0), threshold_value=stv_base)),
            check('supply', 'Material supply normal', 'supporting', MATCH if supply_ok else NO_MATCH,
                  (f'{pack.name(head)} material availability {num(min(avail[start:]), 1)}–'
                   f'{num(max(avail[start:]), 1)} % and supply variability '
                   f'{num(max(pack.series(head, "supply_variability")[start:]), 2)}.' if avail is not None
                   else 'No material-availability tag on the head of this line.'),
                  'If the line were running short of input, the head of the line would show it first. It did not, '
                  'so the interruptions start inside the line.',
                  spark(avail, nice_domain(avail, [p['avail_pct']], pad=0.2), threshold_value=p['avail_pct'])
                  if avail is not None else None),
            check('demand', 'Worst at the highest charge demand', 'supporting',
                  MATCH if demand_ok else NO_MATCH,
                  f'Charge demand averaged {num(B.mean([ch[k] for k in dip_ks]), 2)} % in the dip samples against '
                  f'{num(B.mean([ch[k] for k in between]), 2)} % between them, peaking at '
                  f'{num(max(ch[k] for k in dip_ks), 2)} %; oscillation index '
                  f'{num(self._base(pack, aid, "oscillation_index", c["i0"]), 2)} → '
                  f'{num(max(osc[start:]), 2)}.',
                  'Both are the charger\'s own signals. If the interruptions cluster where the charger is working '
                  'hardest, the operating region is the leading theory rather than pure chance.',
                  spark(ch, nice_domain(ch, pad=0.2), highlight=[ts[start], ts[now]])),
            check('inspected', 'Confirmed by an inspection', 'supporting', MATCH if inspected_ok else PENDING,
                  (f'{done[0]["text"]} ({done[0]["id"]}) closed {done[0]["completedAt"][11:16]}.' if done else
                   (f'{openj[0]["text"]} ({openj[0]["id"]}) due {openj[0]["dueAt"][11:16]} — not done.'
                    if openj else 'No inspection raised on this station.')),
                  'The data says where and how often. Only somebody at the machine can say whether it is the '
                  'operating region or something wearing.',
                  None),
        ]
        main = chart('/min', rd,
                     [series('rate', f'{name} rate', r, 'primary', 1),
                      series('base', 'Pre-pattern baseline', [base] * pack.n, 'expected', 1)],
                     title='What we see',
                     caption=f'{name} against the {num(base)}/min it held over the {dur(p["baseline_min"])} '
                             f'before. {samples} interrupted samples since {ts[start]}, the deepest '
                             f'{num(r[worst])}/min, averaging {num(loss)} % of output across the whole stretch.',
                     thresholds=[threshold(base * (1 - p['dip_frac']), f'−{num(100 * p["dip_frac"], 0)} %')],
                     markers=[marker(ts[start], 'Pattern starts')]
                     + [marker(ts[s], 'Interruption') for s, _ in ev[:4]]
                     + [marker(ts[worst], f'Deepest {num(r[worst])}/min')])

        grid = minutes_grid(0, 90, 5)
        rng = Rng(4663)
        tb, one, noise = [], [], []
        for m in grid:
            k = m // 5
            tb.append(base - (base * (0.03 + 0.012 * (k % 4)) if k % 3 == 0 else 0.0) + rng.gauss(0.5))
            one.append(base - (base * 0.25 if 30 <= m <= 55 else 0.0) + rng.gauss(0.5))
            noise.append(base + rng.gauss(0.9))
        live = aligned(r, start, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Station rate (min from the first interruption)', '/min',
                                  [base * 0.7, base * 1.05], grid, 'min', a, live, f'{name}, today', 0,
                                  [threshold(base, 'Baseline')])]
        refs = [
            reference('micro', 'textbook', 'Textbook', 'Recurring micro-stops',
                      'Short interruptions every few samples, each recovering unaided, growing slowly in frequency. '
                      'The line keeps running and the headline rate barely moves, which is exactly why these are '
                      'usually found late.',
                      'match', 'Closest match',
                      [f'{samples} interrupted samples and {num(loss)} % of output over '
                       f'{dur(pack.minutes_between(start, pack.now))}',
                       'Still building — the frequency has not settled yet'], mk(tb)),
            reference('onestop', 'variant', 'Variant', 'One long stop of the same size',
                      'The same number of units lost, taken in one go. It is logged, investigated and fixed the '
                      'same day, because a 25-minute stop is impossible to ignore.',
                      'nomatch', 'Does not match — and that is the problem',
                      [f'Today\'s loss arrived in {len(ev)} pieces instead of one',
                       f'Same {num(lost_units, 0)} units, none of it alarmed'], mk(one)),
            reference('noise', 'lookalike', 'Look-alike', 'Normal rate noise',
                      'Every station wanders by a unit or two a minute. It crosses no threshold, has no structure, '
                      'and costs nothing on average.',
                      'nomatch', 'Does not match',
                      [f'Noise averages out; this averages {num(loss)} % down',
                       f'And the deepest sample was {num(100 - 100 * r[worst] / base)} % under baseline'], mk(noise)),
        ]
        ro = [
            ruled_out('Input material supply', 'ruled out' if supply_ok else 'unlikely',
                      f'{pack.name(head)} material availability held {num(min(avail[start:]), 1)} % or better and '
                      f'supply variability stayed at {num(max(pack.series(head, "supply_variability")[start:]), 2)}. '
                      f'A supply problem starves the head of the line first.' if avail is not None else
                      'The head of the line showed no shortage during the dips.'),
            ruled_out('A downstream blockage', 'ruled out',
                      f'{pack.name(tr)} reported starvation ({num(B.mean([stv[k] for k in dip_ks]), 2)} average in '
                      f'the dips) and not blocking ({num(B.mean([blk[k] for k in dip_ks]), 2)}). A blockage '
                      f'downstream reverses those two.'),
            ruled_out('One long slowdown, or a deliberate rate cut', 'ruled out',
                      f'The interruptions come in {len(ev)} separate runs — alert level is {p["min_runs"]} — and '
                      f'the rate comes back in between: the {len(between)} samples of the '
                      f'{pack.now - start + 1} since {ts[start]} that are not in a run average '
                      f'{num(B.mean(between_r))}/min, {num(100 * B.mean(between_r) / base)} % of baseline. '
                      f'A slowdown does not come back in between.'),
            ruled_out('A counting problem at this station', 'ruled out',
                      f'All five stations on {lname} lost the same share in each dip, and {pack.name(tr)} logged the '
                      f'starvation separately. A counter fault affects one counter.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'Repeated short interruptions at the charger, costing about {num(loss)} % of '
                                     f'{lname}\'s output since {ts[start]} — an unstable high-demand operating '
                                     f'region is the leading theory', level,
                                     'Confirmed by inspection' if inspected_ok else
                                     'Pattern, timing and the starvation trace agree; nobody has been at the machine '
                                     'yet'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Power Charge stations are used only to confirm this frequency is unusual: '
                        f'none of them has {p["min_events"]} samples {num(100 * p["dip_frac"], 1)} % below its '
                        f'own local baseline in any {dur(p["window_min"])} window today. The baseline is this '
                        f'station\'s own earlier rate, '
                        f'because each line runs its own product rate.',
            'confidence': confidence(level,
                                     'The pattern is in this station\'s rate, the Transfer gate\'s starvation time '
                                     'and the charger\'s own oscillation index — three separate measurements.'
                                     if (starved_ok or supply_ok) else
                                     'Only the rate shows it so far.',
                                     f'Nobody has been at the machine. The data can say the interruptions start at '
                                     f'or before the charger and cluster at high demand, but it cannot tell an '
                                     f'unstable operating region from something starting to wear — and this drive '
                                     f'is also {num(vib[now] - vib[0], 2)} mm/s rougher than it was this morning, '
                                     f'which is being looked at separately.',
                                     f'The inspection' + (f' ({openj[0]["id"]}, due {openj[0]["dueAt"][11:16]})'
                                                          if openj else '') +
                                     ' finds a cause at the station, or the pattern stops when the charge demand is '
                                     'backed off.',
                                     'The interruptions continue at reduced demand and the inspection finds nothing '
                                     '— then it is the supply to the charger rather than the charger.'),
            'action': action(item, pack),
            'model': {'target': 'throughput_per_min',
                      'formula': f'this station\'s own pre-pattern baseline = {num(base)}/min',
                      'fittedOn': 'self'},
            'impact': f'About {num(lost_units, 0)} units ({num(loss)} % of output) since {ts[start]} and still '
                      f'accumulating. {lname} instability '
                      f'{num(self._base(pack, line, "instability_index", c["i0"]), 2)} → '
                      f'{num(max(instab[start:]), 2)}, and {pack.name(tr)} starvation up to '
                      f'{num(max(stv[k] for k in dip_ks), 2)}.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 12. Purity drifting toward the spec limit — archetype 13 (quality drift)
# ═════════════════════════════════════════════════════════════════════════
class PurityDriftToLimit(Detector):
    id = 'refinery.purity_drift_to_limit'
    name = 'Refinement purity drifting toward the spec limit'
    archetype = '13 Quality drift'
    applies_to = 'Refinement stations'
    summary = ('A Refinement station whose purity has been falling steadily since the input characteristic shifted '
               'and stayed shifted. Still in specification, but the margin is narrowing and the direction is the '
               'finding.')
    pipeline = [
        ('Input', 'the input characteristic index against its own baseline: a shift that persists, not a batch'),
        ('Drift', 'purity slope over the last hour, and how far it has gone from its baseline'),
        ('Margin', 'purity against the specification limit, and the time left at the current slope'),
        ('Compensation', 'control effort: whether the loop is holding the purity or has given up ground'),
        ('Checks', 'falling · persistent input shift · margin narrowing · time to limit · rejects following · '
                   'corrected'),
        ('Conclusion', 'an input shift the current setting no longer covers; adjust before the margin goes'),
    ]
    definition = {
        'appliesTo': {'assetType': 'refinement'},
        'inputs': {'purity': 'self.purity_pct', 'input': 'self.input_characteristic_index',
                   'effort': 'self.control_effort_pct', 'defect': 'self.defect_rate',
                   'down': 'targets[process_flow] (Inspection) reject_rate_pct',
                   'out': 'line output.output_quality_score', 'health': 'line.system_health_index'},
        'peers': {'same': 'assetType', 'count': 'the other five Refinement stations'},
        'expected': {'model': 'own baseline and the spec limit', 'target': 'purity',
                     'formula': 'median(purity over baseline_min); limit = spec_limit_pct', 'fitOn': 'self'},
        'params': {'spec_limit_pct': 98.50, 'margin_pct': 0.40, 'drop_pct': 0.25, 'baseline_min': 60,
                   'slope_window_min': 60, 'min_slope_pct_per_h': 0.20, 'input_rise': 4.0,
                   'input_sustain_min': 30, 'peer_margin_pct': 0.20, 'reject_rise_pct': 0.5,
                   'reject_lag_min': 10, 'recover_frac': 0.7, 'recover_within_min': 45},
        'checks': [
            {'id': 'falling', 'role': 'required', 'rule': 'purity below its baseline by drop_pct and falling faster than min_slope_pct_per_h'},
            {'id': 'input', 'role': 'required', 'rule': 'input characteristic index above its baseline by input_rise for input_sustain_min and still there'},
            {'id': 'margin', 'role': 'required', 'rule': 'purity − spec_limit_pct < margin_pct'},
            {'id': 'peers', 'role': 'required', 'rule': 'the other Refinements are not drifting with it (peer median within peer_margin_pct of its baseline)'},
            {'id': 'rejects', 'role': 'supporting', 'independent': True, 'rule': 'downstream reject rate rises reject_rise_pct about reject_lag_min later'},
            {'id': 'effort', 'role': 'supporting', 'rule': 'control effort stepped up to compensate'},
            {'id': 'corrected', 'role': 'supporting', 'independent': True, 'rule': 'purity recovers ≥ recover_frac within recover_within_min of the control effort step'},
        ],
        'ruleOut': ['measurement drift on the purity analyser', 'normal purity scatter',
                    'a single off-spec lot of input', 'a plant-wide input change'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'the trend reversed after a validated adjustment'},
        'references': ['textbook: input shift, corrected in time', 'variant: shift left uncompensated',
                       'look-alike: purity analyser drift'],
    }

    def candidates(self, pack):
        return pack.of_type('refinement')

    def _ctx(self, pack, aid):
        p = self.p
        bl = pack.steps(p['baseline_min'])
        pur = pack.series(aid, 'purity_pct')
        inp = pack.series(aid, 'input_characteristic_index')
        return dict(pur=pur, inp=inp, pbase=baseline(pur, 0, bl - 1), ibase=baseline(inp, 0, bl - 1), bl=bl)

    def evaluate(self, pack, aid):
        p = self.p
        if in_changeover(pack, aid):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        pur, inp, pbase, ibase = c['pur'], c['inp'], c['pbase'], c['ibase']
        shifted = [v > ibase + p['input_rise'] for v in inp]
        peers = peers_of(pack, aid)
        pm = peer_median(pack, peers, 'purity_pct')
        pmbase = median(pm[:c['bl']])
        for i in range(c['bl'], pack.n):
            if pur[i] > pbase - p['drop_pct'] or pur[i] - p['spec_limit_pct'] >= p['margin_pct']:
                continue
            slope = B.slope_per_hour(pur, i, pack.steps(p['slope_window_min']), pack.step_min)
            if slope is None or slope > -p['min_slope_pct_per_h']:
                continue
            s0 = B.sustained_since(shifted, i)
            if s0 is None or pack.minutes_between(s0, i) < p['input_sustain_min']:
                continue
            if abs(pm[i] - pmbase) > p['peer_margin_pct']:
                continue
            c.update(i0=s0, slope=slope, pm=pm, pmbase=pmbase, peers=peers)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        line = line_of(pack, aid)
        name, lname = st(pack, aid), pack.name(line)
        pur, inp, pbase, ibase = c['pur'], c['inp'], c['pbase'], c['ibase']
        i0, pm, pmbase = c['i0'], c['pm'], c['pmbase']
        limit = p['spec_limit_pct']
        low = min(range(i0, pack.n), key=lambda k: pur[k])
        eff = pack.series(aid, 'control_effort_pct')
        ebase = baseline(eff, 0, c['bl'] - 1)
        step_k = max(range(i0, pack.n), key=lambda k: eff[k] - eff[k - 1] if k > i0 else 0)
        effort_ok = max(eff[step_k:]) - ebase >= 1.5
        slope = B.slope_per_hour(pur, i, pack.steps(p['slope_window_min']), pack.step_min)
        eta = (pur[i] - limit) / (-slope) * 60 if slope < 0 else None
        down = nxt(pack, aid)
        rej = pack.series(down, 'reject_rate_pct')
        rbase = baseline(rej, 0, c['bl'] - 1)
        rej_peak = max(range(i0, pack.n), key=lambda k: rej[k])
        rejects_ok = (rej[rej_peak] - rbase >= p['reject_rise_pct']
                      and pack.minutes_between(low, rej_peak) >= 0)
        span = range(step_k, min(pack.n, step_k + pack.steps(p['recover_within_min']) + 1))
        rec_k = max(span, key=lambda k: pur[k])
        drop = pbase - pur[low]
        rec_frac = (pur[rec_k] - pur[low]) / drop if drop > 0 else 0.0
        corrected_ok = rec_frac >= p['recover_frac'] and effort_ok
        independent = sum([rejects_ok, corrected_ok])
        level = 'high' if corrected_ok else ('medium' if independent else 'low')
        defect = pack.series(aid, 'defect_rate')
        out = pack.descendant_of_type(line, 'output')
        oq = pack.series(out, 'output_quality_score')
        health = pack.series(line, 'system_health_index')
        yd = nice_domain(pur, [limit - 0.1, pbase + 0.1], pad=0.1)
        idom = nice_domain(inp, pad=0.15)

        checks = [
            check('falling', 'Purity falling, steadily', 'required', MATCH,
                  f'{num(pur[i], 2)} % when flagged at {ts[i]}, from a {num(pbase, 2)} % baseline '
                  f'({signed(pur[i] - pbase, 2)} %); lowest {num(pur[low], 2)} % at {ts[low]}. Falling '
                  f'{signed(slope, 2)} % per hour over the last {dur(p["slope_window_min"])}.',
                  'Every reading is still in specification. It is the slope that matters: the same slope for '
                  'another hour takes it out.',
                  spark(pur, yd, threshold_value=limit)),
            check('input', 'Input characteristic shifted and stayed shifted', 'required', MATCH,
                  f'{num(ibase)} → {num(inp[i])} ({signed(inp[i] - ibase)}) since {ts[i0]}, and still '
                  f'{num(inp[now])} now — {dur(pack.minutes_between(i0, now))} at the new level. Alert level is '
                  f'+{num(p["input_rise"], 0)} for {dur(p["input_sustain_min"])}.',
                  'This is the cause, and it is measured upstream of the purity. A shift that persists is a '
                  'different feed, not a batch; the setting that was right this morning is no longer enough for it.',
                  spark(inp, idom, threshold_value=ibase + p['input_rise'], highlight=[ts[i0], ts[now]])),
            check('margin', f'Margin to the {num(limit, 2)} % limit narrowing', 'required', MATCH,
                  f'{num(pur[i] - limit, 2)} % of margin left at {ts[i]} and {num(pur[low] - limit, 2)} % at the '
                  f'lowest point — against {num(pbase - limit, 2)} % this morning. '
                  + (f'At {signed(slope, 2)} % per hour that is about {dur(eta)} to the limit.' if eta else ''),
                  'Operators need the time, not the number. Half an hour of margin is a decision; two hours is a '
                  'note for the next shift.',
                  spark(pur, yd, threshold_value=limit, highlight=[ts[i0], ts[low]])),
            check('peers', 'The other Refinements are steady', 'required', MATCH,
                  f'Peer median purity {num(pm[i], 2)} % at {ts[i]} against a {num(pmbase, 2)} % baseline '
                  f'({signed(pm[i] - pmbase, 2)} %), inside ±{num(p["peer_margin_pct"], 2)} %.',
                  'If every line were drifting, the cause would be the feed to the whole refinery. Only this one '
                  'is, so it is this line\'s input and this station\'s setting.',
                  spark(pm, yd, threshold_value=pmbase)),
            check('rejects', f'{pack.name(down)} rejects followed', 'supporting',
                  MATCH if rejects_ok else NO_MATCH,
                  f'{num(rbase, 2)} % → {num(rej[rej_peak], 2)} % by {ts[rej_peak]}, about '
                  f'{dur(pack.minutes_between(low, rej_peak))} after the purity low. Refinement defect rate '
                  f'{num(baseline(defect, 0, c["bl"] - 1), 2)} → {num(max(defect[i0:]), 2)}.',
                  'An independent gate downstream, seeing the same product 10–15 minutes later. It agrees, which '
                  'makes the purity reading real rather than instrumental.',
                  spark(rej, nice_domain(rej, pad=0.2), threshold_value=rbase + p['reject_rise_pct'])),
            check('effort', 'The loop was asked for more', 'supporting', MATCH if effort_ok else NO_MATCH,
                  f'Control effort {num(ebase)} % → {num(max(eff[step_k:]))} % from {ts[step_k]} and held there '
                  f'({num(eff[now])} % now).',
                  'A step that is held is a deliberate adjustment, not the loop hunting. It is also the thing that '
                  'turned the purity around.',
                  spark(eff, nice_domain(eff, pad=0.2), threshold_value=ebase, highlight=[ts[step_k], ts[now]])),
            check('corrected', 'Trend reversed after the adjustment', 'supporting',
                  MATCH if corrected_ok else NO_MATCH,
                  f'Purity {num(pur[low], 2)} % at {ts[low]} → {num(pur[rec_k], 2)} % by {ts[rec_k]} '
                  f'({num(100 * rec_frac, 0)} % of the drop recovered), with the input characteristic still at '
                  f'{num(inp[rec_k])}.',
                  'The input did not come back; the purity did. That is what tells you the setting, not the feed, '
                  'was what needed changing.',
                  spark(pur, yd, threshold_value=limit, highlight=[ts[step_k], ts[now]])),
        ]
        main = chart('%', yd,
                     [series('pur', f'{name} purity', pur, 'primary', 2),
                      series('base', 'Morning baseline', [pbase] * pack.n, 'expected', 2)],
                     title='What we see',
                     caption=f'{name} purity against the {num(pbase, 2)} % it held this morning and the '
                             f'{num(limit, 2)} % specification limit. It never went out of specification; the '
                             f'closest it came was {num(pur[low] - limit, 2)} % of margin at {ts[low]}.',
                     thresholds=[threshold(limit, 'Spec limit')],
                     markers=[marker(ts[i0], 'Input characteristic shifts'), marker(ts[i], 'Flagged'),
                              marker(ts[low], f'Lowest {num(pur[low], 2)} %'),
                              marker(ts[step_k], 'Adjustment')])

        grid = minutes_grid(-30, 150, 10)
        rng = Rng(5741)
        tb, un, an = [], [], []
        for m in grid:
            x = max(0.0, m)
            tb.append(pbase - min(0.65, 0.0075 * x) + rng.gauss(0.012)
                      + (min(0.6, 0.012 * (x - 95)) if x > 95 else 0.0))
            un.append(max(limit - 0.45, pbase - 0.0075 * x) + rng.gauss(0.012))
            an.append(pbase - min(0.65, 0.0075 * x) + rng.gauss(0.012))
        live = aligned(pur, i0, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Purity (min from the input shift)', '%', [limit - 0.6, pbase + 0.3], grid,
                                  'min', a, live, f'{name}, today', 2,
                                  [threshold(limit, 'Spec limit')])]
        refs = [
            reference('corrected', 'textbook', 'Textbook', 'Input shift, corrected in time',
                      'The input characteristic steps up and stays. Purity slides for an hour or so, a small '
                      'validated adjustment goes in while there is still margin, and the purity comes back without '
                      'anything going out of specification.',
                      'match', 'Closest match',
                      [f'Same persistent shift: {signed(inp[now] - ibase)} on the input index',
                       f'Caught with {num(pur[low] - limit, 2)} % of margin still in hand'], mk(tb)),
            reference('uncomp', 'variant', 'What to avoid', 'Shift left uncompensated',
                      'Nobody adjusts. The purity keeps sliding at the same rate, crosses the limit, and the batch '
                      'becomes a quality investigation instead of a setpoint change.',
                      'nomatch', 'Where today was heading',
                      [f'At {signed(slope, 2)} % per hour the limit was about {dur(eta)} away' if eta else
                       'The slope was unchanged right up to the adjustment',
                       'The cost of waiting is the whole margin'], mk(un)),
            reference('analyser', 'lookalike', 'Look-alike', 'Purity analyser drift',
                      'The reading slides exactly like this, but the input characteristic never moved and the '
                      'downstream gate never saw more rejects. The product is fine; the analyser needs calibrating.',
                      'nomatch', 'Does not match',
                      [f'The input index moved first, {signed(inp[i] - ibase)}',
                       f'And {pack.name(down)} rejects followed at {num(rej[rej_peak], 2)} %'], mk(an)),
        ]
        ro = [
            ruled_out('Measurement drift on the purity analyser', 'ruled out',
                      f'Two independent signals moved with it: the input characteristic index '
                      f'({signed(inp[i] - ibase)}) before, and {pack.name(down)}\'s reject rate '
                      f'({num(rbase, 2)} → {num(rej[rej_peak], 2)} %) after. An analyser drifting on its own moves '
                      f'neither.'),
            ruled_out('Normal purity scatter', 'ruled out',
                      f'Purity sat inside {num(max(abs(v - pbase) for v in pur[:c["bl"]]), 2)} % of '
                      f'{num(pbase, 2)} % all morning. {signed(pur[low] - pbase, 2)} % over '
                      f'{dur(pack.minutes_between(i0, low))}, in one direction, is not scatter.'),
            ruled_out('A single off-spec lot of input', 'ruled out',
                      f'The input characteristic has stayed at {num(inp[now])} for '
                      f'{dur(pack.minutes_between(i0, now))} — it is the new normal, not a lot passing through. A '
                      f'single lot would have cleared the station in minutes.'),
            ruled_out('A plant-wide input change', 'ruled out',
                      f'The other five Refinement stations held {num(min(pm))}–{num(max(pm))} % purity on the same '
                      f'product, within ±{num(p["peer_margin_pct"], 2)} % of their baseline. Only {lname} saw the '
                      f'shift.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'An input characteristic shift that the Refinement setting no longer '
                                     f'compensates for — purity was heading for the {num(limit, 2)} % limit, not at '
                                     f'it', level,
                                     'Confirmed: the trend reversed after a validated adjustment, with the input '
                                     'still shifted' if corrected_ok else
                                     'Input shift, purity slope and downstream rejects all agree'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'The other five Refinement stations are used only to show this is not a refinery-wide feed '
                        f'change. The margin and the time-to-limit are computed against the specification limit, '
                        f'which is the same for all of them.',
            'confidence': confidence(level,
                                     f'The input characteristic index, the purity analyser and '
                                     f'{pack.name(down)}\'s reject rate are three separate measurements in the '
                                     f'right order, and the purity recovered {num(100 * rec_frac, 0)} % after the '
                                     f'adjustment while the input stayed shifted.' if corrected_ok else
                                     'The input shift came first and the downstream gate confirmed the purity '
                                     'reading.',
                                     None if corrected_ok else 'The specification limit is a fixed number in the '
                                                               'detector, not read from the batch record.',
                                     None if corrected_ok else 'A reference quality check on the product, or the '
                                                               'trend reversing after an adjustment.',
                                     f'An independent quality check reads the product at {num(pbase, 2)} % — then '
                                     f'the analyser is the problem and the adjustment should be backed out.'),
            'action': action(item, pack),
            'model': {'target': 'purity_pct',
                      'formula': f'this station\'s own {num(pbase, 2)} % baseline over the first '
                                 f'{dur(p["baseline_min"])}, against a {num(limit, 2)} % specification limit',
                      'fittedOn': 'self, with the other five stations as a refinery-wide cross-check'},
            'impact': f'No product out of specification. {num(pbase - pur[low], 2)} % of quality margin given up at '
                      f'the worst point, {pack.name(down)} rejects up to {num(rej[rej_peak], 2)} %, '
                      f'{pack.name(out)} quality score {num(max(oq[:c["bl"]]), 1)} → {num(min(oq[i0:]), 1)} and '
                      f'{lname} health {num(max(health[:c["bl"]]), 1)} → {num(min(health[i0:]), 1)} %.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 13. Changeover prerequisites against the clock — archetype 14 (plan at risk)
# ═════════════════════════════════════════════════════════════════════════
class ChangeoverScheduleRisk(Detector):
    id = 'refinery.changeover_schedule_risk'
    explains_items = ('SIT14',)
    name = 'Changeover prerequisites against the clock'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'lines'
    summary = ('A planned product changeover whose cross-team prerequisites were still open with less time left '
               'than they need back-to-back. Arithmetic on the plan, not a diagnosis — and the answer was to run '
               'them in parallel.')
    pipeline = [
        ('Plan', 'the open planned changeover on this line and the time it is due'),
        ('Prerequisites', 'the material-staging and quality-release tasks it depends on, and their typical durations'),
        ('Arithmetic', 'request lead plus the remaining prerequisites run back-to-back, against the time left'),
        ('Where it stands now', 'what has since closed, and whether the line has actually started its run-down'),
        ('Checks', 'changeover due · prerequisites open · no slack left · parallel instead · now clear · '
                   'running long'),
        ('Conclusion', 'a coordination decision with a deadline, not an equipment finding'),
    ]
    definition = {
        'appliesTo': {'assetType': 'line'},
        'inputs': {'work': 'work-items on this line: the open CHANGEOVER item, its dependencies, and the '
                           'MATERIAL_STAGE and QUALITY_RELEASE items with their estimatedDurationMinutes',
                   'target': 'self.line_target_rate', 'state': 'unit-status[line].state',
                   'throughput': 'self.line_throughput', 'stations': 'children throughput_per_min'},
        'expected': {'model': 'plan arithmetic', 'target': 'prerequisite completion time',
                     'formula': 'now + request_lead_min + Σ(estimatedDurationMinutes of the open prerequisites) '
                                'against the changeover due time',
                     'fitOn': 'the work list\'s own planned durations'},
        'params': {'lead_min': 120, 'request_lead_min': 60, 'prereq_types': ['MATERIAL_STAGE', 'QUALITY_RELEASE'],
                   'changeover_type': 'CHANGEOVER', 'slack_min': 0, 'rundown_frac': 0.25},
        'checks': [
            {'id': 'due', 'role': 'required', 'rule': 'an open planned CHANGEOVER item on this line, due within lead_min'},
            {'id': 'open', 'role': 'required', 'rule': 'at least one of its MATERIAL_STAGE / QUALITY_RELEASE prerequisites is still incomplete at this time'},
            {'id': 'noslack', 'role': 'required', 'rule': 'request_lead_min + Σ(remaining prerequisite durations) ≥ time left to the changeover due time + slack_min'},
            {'id': 'parallel', 'role': 'supporting', 'rule': 'the prerequisites were worked overlapping rather than back-to-back'},
            {'id': 'clear', 'role': 'supporting', 'independent': True, 'rule': 'every prerequisite and every declared dependency is now done'},
            {'id': 'rundown', 'role': 'supporting', 'independent': True, 'rule': 'the line target has gone to 0, the state reads changeover, and the stations are running down upstream first'},
        ],
        'ruleOut': ['an equipment problem on the line', 'the changeover being started too early',
                    'the prerequisites being optional', 'a material shortage'],
        'confidence': {'n/a': 'a schedule clash worked out from the plan, not a diagnosis'},
        'references': ['textbook: prerequisites run in parallel', 'variant: run back-to-back and missed',
                       'look-alike: prerequisites late but the changeover not due yet'],
    }

    def candidates(self, pack):
        return pack.of_type('line')

    def _plan(self, pack, aid):
        p = self.p
        members = set([aid] + pack.descendants(aid))
        chg = [w for w in pack.work if w['assetId'] in members and w['workType'] == p['changeover_type']]
        pre = [w for w in pack.work if w['assetId'] in members and w['workType'] in p['prereq_types']]
        return (chg[0] if chg else None), sorted(pre, key=lambda w: w['dueAt'])

    def evaluate(self, pack, aid):
        p = self.p
        chg, pre = self._plan(pack, aid)
        if chg is None or not pre or chg.get('done'):
            return Finding(aid, False)
        due = tmin(chg['dueAt'][11:16])
        for i in range(pack.n):
            t = tmin(pack.ts[i])
            if not (0 <= due - t <= p['lead_min']):
                continue
            openp = [w for w in pre
                     if not w.get('completedAt') or tmin(w['completedAt'][11:16]) > t]
            if not openp:
                continue
            need = p['request_lead_min'] + sum(w['estimatedDurationMinutes'] for w in openp)
            if need < (due - t) + p['slack_min']:
                continue
            return Finding(aid, True, i, chg=chg, pre=pre, openp=openp, due=due, need=need, left=due - t)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        name = pack.name(aid)
        chg, pre, openp, due, need, left = c['chg'], c['pre'], c['openp'], c['due'], c['need'], c['left']
        tgt = pack.series(aid, 'line_target_rate')
        thr = pack.series(aid, 'line_throughput')
        zero = [k for k in range(pack.n) if tgt[k] == 0]
        start = min(zero) if zero else None
        state = (pack.unit_status.get(aid) or {}).get('state')
        sts = stations(pack, aid)
        rundown_ok = (start is not None and state == 'changeover'
                      and rate(pack, sts[0])[now] < rate(pack, sts[-1])[now])
        done_times = {w['id']: (w['completedAt'][11:16] if w.get('completedAt') else None) for w in pre}
        clear_ok = all(w.get('done') for w in pre) and all(d.get('done') for d in (chg.get('dependencies') or []))
        windows = [(tmin(w['plannedStart'][11:16]),
                    tmin(w['completedAt'][11:16]) if w.get('completedAt') else None) for w in pre]
        overlap = 0
        if len(windows) >= 2 and all(b is not None for _, b in windows):
            overlap = min(b for _, b in windows) - max(a for a, _ in windows)
        parallel_ok = overlap > 0
        seq_end = max(a for a, _ in windows) + sum(w['estimatedDurationMinutes'] for w in pre)
        late = [w for w in pre if w.get('completedAt') and w['completedAt'][11:16] > w['dueAt'][11:16]]
        elapsed = tmin(ts[now]) - tmin(ts[start]) if start is not None else 0
        over_due = tmin(ts[now]) - due
        out_rate = rate(pack, sts[-1])
        drain = (out_rate[now - 1] - out_rate[now]) / pack.step_min if now > 0 else 0
        eta = out_rate[now] / drain if drain > 0 else None
        level = 'n/a'
        yd = nice_domain(thr, [0], pad=0.05, floor=0)
        prereq_txt = '; '.join(
            f'{w["text"]} ({w["id"]}, {w["assignedRole"]}, {w["estimatedDurationMinutes"]} min typical) due '
            f'{w["dueAt"][11:16]}, ' + (f'done {done_times[w["id"]]}' if done_times[w['id']] else 'not done')
            for w in pre)

        checks = [
            check('due', f'{chg["text"]} due {chg["dueAt"][11:16]}', 'required', MATCH,
                  f'{chg["text"]} ({chg["id"]}, {chg["priority"]}, {chg["estimatedDurationMinutes"]} min planned) '
                  f'on {name}, due {chg["dueAt"][11:16]}. At {ts[i]} that was {dur(left)} away.',
                  'A changeover has a time because the next product is already sold. Everything before it has to '
                  'fit in front of it.',
                  spark(tgt, nice_domain(tgt, [0], pad=0.1, floor=0), highlight=[ts[i], ts[now]])),
            check('open', f'{len(openp)} prerequisite(s) still open at {ts[i]}', 'required', MATCH,
                  prereq_txt + f'. At {ts[i]}: ' + join_names([w['text'] for w in openp]) + ' not yet complete.',
                  'The line cannot change product until the material is staged and Quality has released it. These '
                  'are other teams\' tasks, which is why they need lead time rather than just time.',
                  None),
            check('noslack', f'No slack left at {ts[i]}', 'required', MATCH,
                  f'{dur(p["request_lead_min"])} to get a cross-team request picked up, plus '
                  + ' + '.join(f'{w["estimatedDurationMinutes"]} min' for w in openp)
                  + f' of work back-to-back = {dur(need)}, against {dur(left)} left to {chg["dueAt"][11:16]} — '
                  + (f'short by {dur(need - left)} if they run in sequence.' if need > left else
                     'no slack at all if they run in sequence.'),
                  'This is the whole finding, and it is arithmetic. Run one after the other, the prerequisites no '
                  'longer fit in front of the changeover.',
                  None),
            check('parallel', 'Run in parallel instead', 'supporting', MATCH if parallel_ok else NO_MATCH,
                  (f'Both started {pre[0]["plannedStart"][11:16]} and overlapped by {dur(overlap)}: '
                   + ', '.join(f'{w["text"]} closed {done_times[w["id"]]}' for w in pre if done_times[w['id']])
                   + f'. Back-to-back they would have finished about {clock(seq_end)}, '
                     f'{dur(seq_end - due)} past the {chg["dueAt"][11:16]} target.'
                   if parallel_ok else 'The prerequisites were not worked in parallel.'),
                  'Nothing about the two tasks requires one to wait for the other. Overlapping them is what bought '
                  'the time back — the fix was coordination, not speed.',
                  None),
            check('clear', 'Prerequisites now clear', 'supporting', MATCH if clear_ok else NO_MATCH,
                  ', '.join(f'{w["text"]} {done_times[w["id"]]}' for w in pre if done_times[w['id']])
                  + '; dependencies on ' + chg['id'] + ': '
                  + ', '.join(f'{d["label"]} {"done" if d.get("done") else "open"}'
                              for d in (chg.get('dependencies') or []))
                  + (f'. {len(late)} closed after its due time ('
                     + ', '.join(f'{w["text"]} {dur(tmin(w["completedAt"][11:16]) - tmin(w["dueAt"][11:16]))} late'
                                 for w in late) + ').' if late else '.'),
                  'The risk is spent. What is left is the changeover itself, which is why this reads as recovering '
                  'rather than at risk.',
                  None),
            check('rundown', 'The line is actually running down', 'supporting',
                  MATCH if rundown_ok else NO_MATCH,
                  (f'Target rate went to 0 at {ts[start]} and the state reads {state}. '
                   + ', '.join(f'{pack.name(s)} {num(rate(pack, s)[now])}/min' for s in sts)
                   + f' — upstream first, as the line empties. {dur(elapsed)} elapsed, '
                     f'{dur(abs(over_due))} {"past" if over_due > 0 else "before"} the '
                     f'{chg["dueAt"][11:16]} target'
                   + (f', about {dur(eta)} of run-down left at the current rate.' if eta else '.')
                   if start is not None else 'The changeover has not started.'),
                  'The plan and the plant agree: the changeover is under way and the stations are emptying in flow '
                  'order. Nothing here is a fault — the target was set to zero deliberately.',
                  spark(thr, yd, highlight=[ts[start], ts[now]]) if start is not None else None),
        ]
        main = chart('/min', yd,
                     [series('thr', f'{name} throughput', thr, 'primary', 1),
                      series('tgt', 'Target rate', tgt, 'expected', 1)]
                     + [series(f's{k}', pack.name(s), rate(pack, s), 'peer', 1) for k, s in enumerate(sts)],
                     title='What we see',
                     caption=f'{name} through the day. The prerequisites for {chg["text"]} were still open at '
                             f'{ts[i]} with {dur(left)} to the {chg["dueAt"][11:16]} target and {dur(need)} of work '
                             f'in front of them. Running them in parallel closed the gap; the changeover itself '
                             f'started at {ts[start] if start is not None else "—"}.',
                     markers=[marker(ts[i], 'Prerequisites at risk')]
                     + [marker(done_times[w['id']], w['text'] + ' done') for w in pre
                        if done_times[w['id']] and done_times[w['id']] in ts]
                     + ([marker(ts[start], 'Changeover starts')] if start is not None else []))

        grid = minutes_grid(-120, 60, 15)
        par = [(0.0 if m < -90 else (0.5 if m < -20 else 1.0)) for m in grid]
        seq = [(0.0 if m < -60 else (0.5 if m < 20 else 1.0)) for m in grid]
        early = [(0.0 if m < -110 else 1.0) for m in grid]
        live = []
        for m in grid:
            t = due + m
            if t < tmin(ts[0]) or t > tmin(ts[now]):
                live.append(None)
                continue
            dn = sum(1 for w in pre if w.get('completedAt') and tmin(w['completedAt'][11:16]) <= t)
            live.append(dn / len(pre))
        mk = lambda a: [ref_chart('Prerequisites complete (min from the changeover target)', 'share', [0, 1.1],
                                  grid, 'min', a, live, f'{name}, today', 2,
                                  [threshold(1.0, 'All clear')])]
        refs = [
            reference('parallel', 'textbook', 'Textbook', 'Prerequisites run in parallel',
                      'Materials and Quality are asked at the same time, work side by side, and both close before '
                      'the changeover window opens. The changeover starts on the hour and nobody writes it up.',
                      'match', 'What happened in the end',
                      [f'Both started {pre[0]["plannedStart"][11:16]} and overlapped {dur(overlap)}'
                       if parallel_ok else 'The two requests were parallelised once the clash was seen',
                       f'Last one closed {max(done_times.values())}' if any(done_times.values()) else
                       'Both closed before the target'], mk(par)),
            reference('sequential', 'variant', 'What to avoid', 'Run back-to-back and missed',
                      'The same two tasks, one waiting for the other. Forty minutes plus twenty, plus the time to '
                      'get each one picked up, and the changeover slips past its window — with the next product '
                      'already scheduled behind it.',
                      'nomatch', 'Where this was heading',
                      [f'Back-to-back they would have finished about {clock(seq_end)}',
                       f'{dur(max(0, seq_end - due))} past the {chg["dueAt"][11:16]} target'], mk(seq)),
            reference('early', 'lookalike', 'Look-alike', 'Prerequisites late but the changeover not due yet',
                      'Both tasks overdue on their own due times, and it does not matter: the changeover is hours '
                      'away and there is slack for both. Overdue is not the same as at risk.',
                      'nomatch', 'Not this case',
                      [f'At {ts[i]} there was {dur(left)} left and {dur(need)} of work',
                       f'{len(late)} of the prerequisites did close late, and it still came down to minutes'
                       if late else 'The margin came down to minutes'], mk(early)),
        ]
        ro = [
            ruled_out('An equipment problem on the line', 'ruled out',
                      f'{name} ran {num(min(thr[:start if start is not None else now]))}–'
                      f'{num(max(thr[:start if start is not None else now]))}/min against a '
                      f'{num(median([v for v in tgt if v > 0]), 0)}/min target right up to the changeover, with '
                      f'instability {num(min(pack.series(aid, "instability_index")[:start]), 2)}–'
                      f'{num(max(pack.series(aid, "instability_index")[:start]), 2)}. Nothing on the line is at '
                      f'fault; this is a coordination item.'),
            ruled_out('The changeover being started too early', 'ruled out',
                      f'The target rate went to 0 at {ts[start]}, after both prerequisites had closed '
                      f'({", ".join(f"{w['text']} {done_times[w['id']]}" for w in pre if done_times[w['id']])}). '
                      f'Nothing started before it was released.' if start is not None else
                      'The changeover has not started yet.'),
            ruled_out('The prerequisites being optional', 'ruled out',
                      f'{chg["id"]} carries them as declared dependencies: '
                      + ', '.join(d['label'] for d in (chg.get('dependencies') or []))
                      + '. The changeover cannot be signed off without them.'),
            ruled_out('A material shortage', 'ruled out',
                      f'{pack.name(sts[0])} material availability held '
                      f'{num(min(pack.series(sts[0], "material_availability")), 1)} % or better all day. The '
                      f'material was available; staging it was the task that had not started.'
                      if pack.has(sts[0], 'material_availability') else
                      'Nothing in the line data shows a shortage of input.'),
        ]
        return {
            'conclusion': conclusion('What\'s needed',
                                     f'Nothing further on the prerequisites — they are clear. '
                                     + (f'{chg["text"]} is {dur(abs(over_due))} past its '
                                        f'{chg["dueAt"][11:16]} target with about {dur(eta)} of run-down left.'
                                        if eta and over_due > 0 else
                                        f'{chg["text"]} is under way.'), level,
                                     'A schedule clash worked out from the plan, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': f'No other line is compared. A changeover plan belongs to one line, and {name} is the only '
                        f'line with one today.',
            'confidence': confidence(level,
                                     f'This is arithmetic on the plan: the {chg["dueAt"][11:16]} target and the '
                                     f'{" and ".join(str(w["estimatedDurationMinutes"]) + " min" for w in pre)} '
                                     f'typical durations come from the work list, and the '
                                     f'{dur(p["request_lead_min"])} to get a cross-team request picked up is a '
                                     f'planning value in the detector, not a measurement. Nothing here is '
                                     f'diagnosed, so there is no confidence level to give.',
                                     None, None,
                                     'The two prerequisites turn out not to be parallelisable on this product — '
                                     'then the only lever left is moving the changeover target.',
                                     f'{join_names([w["text"] + " " + (done_times[w["id"]] or "open") for w in pre])}'),
            'action': action(item, pack),
            'impact': f'None on product. The changeover is {dur(abs(over_due))} '
                      f'{"past" if over_due > 0 else "inside"} its {chg["dueAt"][11:16]} target and excluded from '
                      f'availability and performance because it is planned. Had the prerequisites run back-to-back '
                      f'they would have closed about {clock(seq_end)}, pushing the whole changeover '
                      f'{dur(max(0, seq_end - due))} later.',
        }


# ── Registration ─────────────────────────────────────────────────────────
# Two attention items share one asset twice in this pack: F2 · Power Charge
# carries both the vibration trend (SIT05) and the micro-stops (SIT12), and
# the F4 line carries both the busy shift (SIT02) and the changeover plan
# (SIT14). Each of those four detectors names its item in `explains_items`,
# so the runner pairs each item with its own detector instead of with
# whichever fired first. It decides which explanation goes with which item,
# never whether a detector fires.
DETECTORS = [BusyShiftConfirmed(), RefinementRegulatorSluggish(), BufferAccumulation(), ChargerBearingWear(),
             PressureTransmitterFault(), InspectionRejectsUpstream(), GrossVsEffectiveOutput(),
             ChargerFaultCascade(), ManualOvercorrection(), TransferHardBlock(), ChargerMicroStops(),
             PurityDriftToLimit(), ChangeoverScheduleRisk()]


def main():
    pack, out, report, path = run_pack(REPO, 'refinery', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
