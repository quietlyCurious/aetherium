#!/usr/bin/env python3
"""Confluence (municipal wastewater treatment plant) — detectors and
explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every wastewater detector on every asset it applies to, using only the
pack's runtime files in public/data/wastewater/, and writes
public/data/wastewater/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus each
detector's definition and where it fired today.

    python3 ModelAndData/industries/wastewater/generate.py    # the data
    python3 ModelAndData/industries/wastewater/explain.py     # the explanations

Detectors never read generate.py's scenario constants, SCENARIOS.md, or an
attention item's own signal, detail or evidence text. If a detector misses a
scenario, or fires where no attention item exists, the run report says so and
the exit code is 1 for a miss.

Confluence is six identical parallel trains, so "expected" here is usually
**what the other five trains read at the same moment**: they share the same
influent, the same weather and the same diurnal flow curve, so a train that
leaves the pack is doing it on its own. Where the six differ by design
(each blower is a different size and sits on its own system curve), the
reference is the asset's own reading early in the shift instead, and the
other trains are used only to rule out a plant-wide cause. Two checks are
pure physics with no fitted coefficients: a blower's flow and discharge
pressure must move the same way on a system curve, and disinfection risk
goes as (CT₀/CT)².

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
from detectors.build import (Detector, Finding, Rng, MATCH, NO_MATCH, PENDING, aligned, chart,  # noqa: E402
                             check, dur, marker, nice_domain, num, reference, ruled_out, run_pack,
                             print_report, series, threshold)
from detectors.build import spark as _spark    # noqa: E402
from detectors.build import band as _band    # noqa: E402
from detectors.build import signed as _signed    # noqa: E402


# ── Small helpers (same shape as pharma/explain.py) ─────────────────────
def spark(values, y, *rest, decimals=None, **kw):
    """The toolkit's spark, with the rounding picked from the y-range's magnitude so
    scfm and mg/L series don't carry two meaningless decimal places each."""
    if decimals is None and y:
        span = abs(y[1] - y[0]) or 1
        decimals = 0 if span >= 200 else 1 if span >= 20 else 2 if span >= 2 else 3
    return _spark(values, y, *rest, decimals=decimals, **kw)


def join_names(names):
    if not names:
        return ''
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ' and ' + names[-1]


def work_ids_for(pack, item):
    """Work items the operator would act on: the ones on the item's asset."""
    ids = []
    for w in pack.work:
        if w.get('sourceType') != 'situation':
            continue
        if w['assetId'] == item['assetId']:
            ids.append(w['id'])
    return ids


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


def short(pack, aid):
    """'T03 Blower' style name: the train plus the asset's own name."""
    u = pack.unit_of(aid)
    if u is None or u == aid:
        return pack.name(aid)
    return f'{pack.name(u)} {pack.name(aid)}'


def tname(pack, aid):
    """The train an asset belongs to, by name ('T03')."""
    u = pack.unit_of(aid)
    return pack.name(u) if u else pack.name(aid)


def idx_at(pack, iso):
    """Grid index of an ISO time (first grid point at or after it), or None."""
    if not iso:
        return None
    hm = iso[11:16]
    for k, t in enumerate(pack.ts):
        if t >= hm:
            return k
    return None


HANDS_ON = ('MAINTENANCE', 'INSPECTION')


def done_work(pack, aids, types=HANDS_ON):
    """Done work items on any of these assets, earliest first: [(item, index)].
    By default only hands-on work, not reviews, samples or paperwork."""
    out = []
    for w in pack.work:
        if w['assetId'] in aids and w.get('done') and (types is None or w['workType'] in types):
            k = idx_at(pack, w.get('completedAt'))
            if k is not None:
                out.append((w, k))
    return sorted(out, key=lambda x: x[1])


def wtime(w):
    return (w.get('completedAt') or '')[11:16]


def open_work(pack, aids, types=None):
    return [w for w in pack.work if w['assetId'] in aids and not w.get('done')
            and (types is None or w['workType'] in types)]


def median(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def mean_between(v, i0, i1):
    return B.mean(v[max(0, i0):i1 + 1])


def signed(v, decimals=1):          # noqa: F811 — the toolkit's, without a '−0.0'
    return _signed(None if v is None else round(v, decimals) + 0.0, decimals)


def pct(a, b):
    """a as a percentage change from b."""
    return None if not b else 100.0 * (a / b - 1.0)


def tmin(pack, k):
    h, m = pack.ts[k].split(':')
    return int(h) * 60 + int(m)


def clock(minutes):
    """Minutes since today's midnight → 'HH:MM', with 'tomorrow' past midnight."""
    d, r = divmod(int(round(minutes)), 1440)
    s = f'{r // 60:02d}:{r % 60:02d}'
    return s if d == 0 else s + (' tomorrow' if d == 1 else f' (+{d} days)')


def linfit(xs, ys):
    """Least-squares line: (slope, intercept, r²)."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    b = sxy / sxx if sxx else 0.0
    r2 = (sxy * sxy / (sxx * syy)) if sxx and syy else 0.0
    return b, my - b * mx, r2


def win(pack, k0, k1, pad=6):
    return [pack.ts[max(0, k0 - pad)], pack.ts[min(pack.now, k1 + pad)]]


def peer_series(pack, aids, key):
    """Per-point min / median / max across a set of assets."""
    lo, med, hi = [], [], []
    for k in range(pack.n):
        vals = [pack.series(a, key)[k] for a in aids]
        lo.append(min(vals)); med.append(statistics.median(vals)); hi.append(max(vals))
    return lo, med, hi


def peer_median(pack, aids, key):
    return peer_series(pack, aids, key)[1]


def peer_envelope(pack, aids, key, label, decimals=1):
    """A shaded lo–hi band for a group of peers, instead of one line each."""
    lo, _, hi = peer_series(pack, aids, key)
    return _band(label, lo, hi, decimals)


def rolling_sd(values, steps):
    """Standard deviation over the window of `steps` samples ending at each point."""
    out = []
    for k in range(len(values)):
        w = values[max(0, k - steps + 1):k + 1]
        out.append(statistics.pstdev(w) if len(w) > 1 else 0.0)
    return out


def ordinal(n):
    n = int(round(n))
    if 10 <= n % 100 <= 20:
        return f'{n}th'
    return f'{n}' + {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')


def pctile(values, v):
    """Where v sits in the day's readings, 0–100."""
    srt = sorted(values)
    return 100.0 * sum(1 for x in srt if x < v) / len(srt)


def trains_of(pack, aids):
    return join_names([tname(pack, a) for a in aids])


# ═════════════════════════════════════════════════════════════════════════
# 1. Blower air shortfall starving the aeration basin — archetype 05,
#    seen as 07: the symptom is on the stage, the cause is on its blower
# ═════════════════════════════════════════════════════════════════════════
class BlowerAirShortfall(Detector):
    id = 'wastewater.blower_air_shortfall'
    name = 'Blower air shortfall starving the aeration basin'
    archetype = '05 Component degradation (seen as 07: symptom on the stage, cause on its blower)'
    applies_to = 'aeration stages'
    summary = ('Dissolved oxygen sliding below the nitrification range while the air the stage is actually getting '
               'falls behind the other five trains. Following the air_flow layer back to the blower shows air flow '
               'and discharge pressure falling together — the signature of a restriction on the blower\'s own side, '
               'not a plugged diffuser and not an oxygen demand spike.')
    pipeline = [
        ('Symptom', 'DO below the 1.5 mg/L nitrification-support floor, held, on the aeration stage'),
        ('Air delivered', 'header air flow against the median of the other five trains at the same moment'),
        ('Walk the air_flow layer', 'diffuser grid → its blower; read the blower\'s own flow and discharge pressure'),
        ('Locate the cause', 'flow down AND discharge pressure down = supply-side restriction; flow down with '
                             'pressure up would be the diffusers'),
        ('Rule out demand', 'F:M and MLSS inside the plant band — if demand had risen, air would have risen too'),
        ('Conclusion', 'the cause is the blower; recovery after the filter was cleared → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'aeration'},
        'inputs': {'do': 'self.dissolved_oxygen_mg_l', 'header': 'self.blower_air_flow_scfm',
                   'load': 'self.food_to_microorganism_ratio, self.mlss_mg_l',
                   'blower': 'sources[air_flow] of the child diffuser_grid: air_flow_scfm, '
                             'blower_discharge_pressure_psi, discharge_temp_c, vibration_mms',
                   'diffuser': 'child diffuser_grid: backpressure_psi, air_distribution_uniformity_pct',
                   'settling': 'the train\'s secondary_clarifier.secondary_tss_removal_pct',
                   'peers': 'the other aeration stages: dissolved_oxygen_mg_l, blower_air_flow_scfm',
                   'work': 'done MAINTENANCE on this stage (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five trains',
                  'use': 'expected header air flow, and ruling out a plant-wide air or influent event'},
        'expected': {'model': 'peer median at the same time', 'target': 'blower_air_flow_scfm',
                     'formula': 'median(blower_air_flow_scfm of the other aeration stages)',
                     'fitOn': 'the other five trains; no coefficients fitted'},
        'params': {'do_floor_mg_l': 1.5, 'do_target_mg_l': 2.0, 'do_sustain_min': 30, 'air_short_pct': 88.0,
                   'air_watch_pct': 95.0, 'air_sustain_min': 30, 'baseline_min': 15, 'blower_flow_drop_pct': 12.0,
                   'blower_press_drop_pct': 5.0, 'fm_band_max': 0.33, 'mlss_band_mg_l': 3400,
                   'temp_rise_c': 4.0, 'backpressure_drop_pct': 10.0, 'uniformity_drop_pts': 2.0,
                   'peer_do_floor_mg_l': 1.5, 'tss_loss_pts': 0.5, 'recover_pct': 92.0, 'recover_within_min': 30},
        'checks': [
            {'id': 'do', 'role': 'required',
             'rule': 'dissolved_oxygen_mg_l < do_floor_mg_l for do_sustain_min'},
            {'id': 'air', 'role': 'required',
             'rule': 'header air flow < air_short_pct % of the peer median for air_sustain_min (onset walked '
                     'back to where it first fell below air_watch_pct %)'},
            {'id': 'cause', 'role': 'required',
             'rule': 'blower air_flow_scfm < (1 − blower_flow_drop_pct) × its own first baseline_min AND '
                     'blower_discharge_pressure_psi < (1 − blower_press_drop_pct) × its own first baseline_min'},
            {'id': 'demand', 'role': 'required',
             'rule': 'F:M ≤ fm_band_max and MLSS ≤ mlss_band_mg_l throughout — oxygen demand did not spike; '
                     'do_target_mg_l is the chart\'s target line'},
            {'id': 'temp', 'role': 'supporting', 'independent': True,
             'rule': 'blower discharge_temp_c > its own baseline + temp_rise_c'},
            {'id': 'diffuser', 'role': 'supporting', 'independent': True,
             'rule': 'diffuser backpressure_psi down > backpressure_drop_pct % (not up), uniformity down > '
                     'uniformity_drop_pts points'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'every other aeration stage above peer_do_floor_mg_l with header air inside its own band'},
            {'id': 'settling', 'role': 'supporting', 'independent': True,
             'rule': 'secondary_tss_removal_pct lower by tss_loss_pts while DO was below the floor'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True,
             'rule': 'after the done maintenance, blower air ≥ recover_pct % of baseline within recover_within_min '
                     'and DO back above do_floor_mg_l'},
        ],
        'ruleOut': ['oxygen demand spike from the incoming flow', 'fouled or plugged fine-bubble diffusers',
                    'DO probe fault', 'a plant-wide air or influent event', 'blower mechanical damage'],
        'confidence': {'low': 'required checks only',
                       'medium': 'discharge temperature or diffuser backpressure agrees (separate sensors)',
                       'high': 'air and DO recovered after the blower was worked on'},
        'references': ['textbook: inlet filter blinding over a shift', 'early: filter starting to load',
                       'look-alike: fouled diffusers (air down, backpressure UP)'],
    }

    def candidates(self, pack):
        return pack.of_type('aeration')

    def _ctx(self, pack, aid):
        p = self.p
        grid = pack.child_of_type(aid, 'diffuser_grid')
        blower = None
        if grid is not None:
            blower = next((s for s in pack.sources(grid, 'air_flow')
                           if pack.asset(s)['assetType'] == 'blower'), None)
        if blower is None:
            blower = pack.child_of_type(aid, 'blower')
        if blower is None or grid is None:
            return None
        peers = [a for a in self.candidates(pack) if a != aid]
        nb = pack.steps(p['baseline_min'])
        do = pack.series(aid, 'dissolved_oxygen_mg_l')
        hdr = pack.series(aid, 'blower_air_flow_scfm')
        pmed = peer_median(pack, peers, 'blower_air_flow_scfm')
        bair = pack.series(blower, 'air_flow_scfm')
        bpsi = pack.series(blower, 'blower_discharge_pressure_psi')
        return dict(blower=blower, grid=grid, peers=peers, do=do, hdr=hdr, pmed=pmed,
                    ratio=[100.0 * h / m for h, m in zip(hdr, pmed)],
                    bair=bair, bpsi=bpsi, base_air=median(bair[:nb]), base_psi=median(bpsi[:nb]),
                    fm=pack.series(aid, 'food_to_microorganism_ratio'), mlss=pack.series(aid, 'mlss_mg_l'))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        low = B.lt(c['do'], p['do_floor_mg_l'])
        shortfall = B.lt(c['ratio'], p['air_short_pct'])
        watch = B.lt(c['ratio'], p['air_watch_pct'])
        for i in range(pack.n):
            s_do = B.sustained_since(low, i)
            if s_do is None or pack.minutes_between(s_do, i) < p['do_sustain_min']:
                continue
            s_air = B.sustained_since(shortfall, i)
            if s_air is None or pack.minutes_between(s_air, i) < p['air_sustain_min']:
                continue
            if c['bair'][i] > c['base_air'] * (1 - p['blower_flow_drop_pct'] / 100.0):
                continue
            if c['bpsi'][i] > c['base_psi'] * (1 - p['blower_press_drop_pct'] / 100.0):
                continue
            if max(c['fm'][:i + 1]) > p['fm_band_max'] or max(c['mlss'][:i + 1]) > p['mlss_band_mg_l']:
                continue
            onset = s_air
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            c.update(onset=onset, do_from=s_do, air_from=s_air)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tr = tname(pack, aid)
        blower, grid, peers = c['blower'], c['grid'], c['peers']
        bname, gname = pack.name(blower), pack.name(grid)
        do, hdr, pmed, ratio = c['do'], c['hdr'], c['pmed'], c['ratio']
        bair, bpsi = c['bair'], c['bpsi']
        onset, do_from = c['onset'], c['do_from']

        # the worst point of the event, and when it ended
        trough = min(range(onset, now + 1), key=lambda k: do[k])
        back = next((k for k in range(trough, now + 1)
                     if bair[k] >= c['base_air'] * p['recover_pct'] / 100.0), None)
        do_back = next((k for k in range(trough, now + 1) if do[k] >= p['do_floor_mg_l']), None)
        low_min = pack.minutes_between(do_from, do_back if do_back is not None else now)

        # the maintenance that was done on this stage (confidence only, never firing)
        work = done_work(pack, [aid] + pack.descendants(aid))
        fix = work[-1] if work else None
        recovered = (fix is not None and back is not None and do_back is not None
                     and pack.minutes_between(fix[1], back) <= pack.steps(p['recover_within_min']) * pack.step_min
                     and back >= fix[1] - 1)

        # blower condition sensors
        btemp = pack.series(blower, 'discharge_temp_c')
        bvib = pack.series(blower, 'vibration_mms')
        nb = pack.steps(p['baseline_min'])
        t0 = median(btemp[:nb])
        t_peak = max(btemp[onset:trough + 1])
        temp_ok = t_peak - t0 > p['temp_rise_c']
        vib_drift = max(bvib[onset:trough + 1]) - median(bvib[:nb])

        # diffuser grid
        bp = pack.series(grid, 'backpressure_psi')
        un = pack.series(grid, 'air_distribution_uniformity_pct')
        bp0, un0 = median(bp[:nb]), median(un[:nb])
        bp_drop = -pct(min(bp[onset:trough + 1]), bp0)
        un_drop = un0 - min(un[onset:trough + 1])
        diff_ok = bp_drop > p['backpressure_drop_pct'] and un_drop > p['uniformity_drop_pts']

        # peers
        peer_do_min = {a: min(pack.series(a, 'dissolved_oxygen_mg_l')[onset:trough + 1]) for a in peers}
        peer_ratio = {}
        for a in peers:
            others = [x for x in self.candidates(pack) if x != a]
            pm = peer_median(pack, others, 'blower_air_flow_scfm')
            h = pack.series(a, 'blower_air_flow_scfm')
            peer_ratio[a] = min(100.0 * h[k] / pm[k] for k in range(onset, trough + 1))
        peers_ok = (all(v >= p['peer_do_floor_mg_l'] for v in peer_do_min.values())
                    and all(v >= p['air_short_pct'] for v in peer_ratio.values()))

        # settling downstream in the same train
        sec = next((x for x in pack.descendants(pack.unit_of(aid))
                    if pack.asset(x)['assetType'] == 'secondary_clarifier'), None)
        tss = pack.series(sec, 'secondary_tss_removal_pct') if sec else None
        tss_lo = tss_hi = tss_loss = None
        if tss:
            inside = [tss[k] for k in range(pack.n) if do[k] < p['do_floor_mg_l']]
            outside = [tss[k] for k in range(pack.n) if do[k] >= p['do_floor_mg_l']]
            tss_lo, tss_hi = B.mean(inside), B.mean(outside)
            tss_loss = tss_hi - tss_lo
        tss_ok = tss_loss is not None and tss_loss > p['tss_loss_pts']

        level = 'high' if recovered else ('medium' if (temp_ok or diff_ok) else 'low')
        w1 = win(pack, onset, back if back is not None else now, 4)
        air_lost = c['base_air'] - bair[trough]
        air_lost_pct = -pct(bair[trough], c['base_air'])
        psi_drop_pct = -pct(bpsi[trough], c['base_psi'])
        rd = nice_domain(ratio, [p['air_short_pct'], 100.0], pad=0.05)
        dd = nice_domain(do, [0.0, p['do_target_mg_l']], pad=0.05, floor=0.0)

        checks = [
            check('do', 'Dissolved oxygen below the nitrification floor, and it stayed there', 'required', MATCH,
                  f'{num(do[onset], 2)} mg/L at {ts[onset]} down to {num(do[trough], 2)} mg/L at {ts[trough]}; under '
                  f'{num(p["do_floor_mg_l"], 1)} mg/L from {ts[do_from]} for {dur(low_min)}. Flagged at {ts[i]}, after '
                  f'{dur(p["do_sustain_min"])} under the floor.',
                  f'Nitrifiers need about {num(p["do_target_mg_l"], 1)} mg/L to work reliably and start to fail below '
                  f'{num(p["do_floor_mg_l"], 1)} mg/L. A short dip is normal; {dur(low_min)} under the floor is lost '
                  f'nitrification.',
                  spark(do, dd, threshold_value=p['do_floor_mg_l'], highlight=[ts[do_from], ts[trough]], window=w1)),
            check('air', 'Getting less air than the other five trains', 'required', MATCH,
                  f'Header air {num(hdr[trough], 0)} scfm against a peer median of {num(pmed[trough], 0)} scfm at '
                  f'{ts[trough]} — {num(ratio[trough], 0)} %. Below {num(p["air_short_pct"], 0)} % from '
                  f'{ts[c["air_from"]]}; the other trains held {num(min(peer_ratio.values()), 0)}–'
                  f'{num(max(peer_ratio.values()), 0)} % of their own peer median.',
                  'All six trains take the same influent on the same diurnal curve, so they need similar air. A train '
                  'that drops out of the pack is short of air, not short of demand.',
                  spark(ratio, rd, threshold_value=p['air_short_pct'], window=w1)),
            check('cause', f'The {bname}: air flow and discharge pressure fell together', 'required', MATCH,
                  f'{bname} air flow {num(c["base_air"], 0)} → {num(bair[trough], 0)} scfm '
                  f'({signed(-air_lost_pct, 0)} %, {num(air_lost, 0)} scfm of air lost) and discharge pressure '
                  f'{num(c["base_psi"], 2)} → {num(bpsi[trough], 2)} psi ({signed(-psi_drop_pct, 0)} %).',
                  'Walking the air_flow layer back from the diffuser grid lands on this blower. On a system curve, '
                  'less air means less friction loss, so a blower that can\'t draw enough air shows lower flow AND '
                  'lower discharge pressure. A blockage downstream of the blower would push the pressure up instead.',
                  spark(bair, nice_domain(bair, [c['base_air']]),
                        threshold_value=c['base_air'] * (1 - p['blower_flow_drop_pct'] / 100.0), window=w1)),
            check('demand', 'Oxygen demand did not spike', 'required', MATCH,
                  f'F:M {num(min(c["fm"]), 3)}–{num(max(c["fm"]), 3)} and MLSS {num(min(c["mlss"]), 0)}–'
                  f'{num(max(c["mlss"]), 0)} mg/L all shift, both inside the conventional band.',
                  'If the incoming load had risen, the DO controller would have called for MORE air and the header '
                  'would have gone up. Air went down while the load sat still, so the air side is the problem.',
                  spark(c['fm'], nice_domain(c['fm'], [p['fm_band_max']]), threshold_value=p['fm_band_max'])),
            check('temp', 'Blower running hotter', 'supporting', MATCH if temp_ok else NO_MATCH,
                  f'{bname} discharge temperature {num(t0, 1)} → {num(t_peak, 1)} °C ({signed(t_peak - t0, 1)} °C) '
                  f'over the same window.',
                  'A separate sensor. Pulling air through a restriction raises the pressure ratio across the machine, '
                  'and discharge temperature goes with the pressure ratio. It also rules out a flow-meter fault: a '
                  'bad meter would not warm the blower.',
                  spark(btemp, nice_domain(btemp, [t0]), threshold_value=t0 + p['temp_rise_c'], window=w1)),
            check('diffuser', f'{gname} backpressure fell with the air', 'supporting',
                  MATCH if diff_ok else NO_MATCH,
                  f'Backpressure {num(bp0, 2)} → {num(min(bp[onset:trough + 1]), 2)} psi '
                  f'({signed(-bp_drop, 0)} %) and air distribution {num(un0, 1)} → '
                  f'{num(min(un[onset:trough + 1]), 1)} % ({signed(-un_drop, 1)} points).',
                  'Separate sensors on the grid itself. Less air through the same holes means less backpressure, and '
                  'coverage falls off below about 95 % of design air. Fouled diffusers would do the opposite: '
                  'backpressure up at less air.',
                  spark(bp, nice_domain(bp, [bp0]), threshold_value=bp0 * (1 - p['backpressure_drop_pct'] / 100.0),
                        window=w1)),
            check('peers', 'The other five trains were fine', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'Their lowest DO over the same window was {num(min(peer_do_min.values()), 2)}–'
                  f'{num(max(peer_do_min.values()), 2)} mg/L ({trains_of(pack, peers)}), each within '
                  f'{num(min(peer_ratio.values()), 0)}–{num(max(peer_ratio.values()), 0)} % of its own peer median '
                  f'for air.',
                  'The six trains share the influent, the weather and the plant air main. Only this one lost air, so '
                  'it is not a plant-wide blower-house or influent event.',
                  spark([min(pack.series(a, 'dissolved_oxygen_mg_l')[k] for a in peers) for k in range(pack.n)],
                        dd, threshold_value=p['peer_do_floor_mg_l'], window=w1)),
            check('settling', 'Settling got worse while DO was low', 'supporting', MATCH if tss_ok else NO_MATCH,
                  (f'Secondary TSS removal averaged {num(tss_lo, 1)} % while DO was under '
                   f'{num(p["do_floor_mg_l"], 1)} mg/L against {num(tss_hi, 1)} % outside that window '
                   f'({signed(-tss_loss, 1)} points).' if tss_ok or tss_loss is not None else
                   'No secondary clarifier found in this train.'),
                  'A separate measurement a stage downstream. Starved of oxygen the floc goes pin-point and carries '
                  'over the weirs, so the clarifier confirms the aeration basin really was short of air.',
                  spark(tss, nice_domain(tss), window=w1) if tss else None),
            check('recovered', 'Air and DO came back once the blower was worked on', 'supporting',
                  MATCH if recovered else PENDING,
                  (f'"{fix[0]["text"]}" completed {wtime(fix[0])}; {bname} air back to {num(bair[back], 0)} scfm '
                   f'({num(100 * bair[back] / c["base_air"], 0)} % of baseline) at {ts[back]} and DO back above '
                   f'{num(p["do_floor_mg_l"], 1)} mg/L at {ts[do_back]}.' if recovered else
                   'Air has not come back to its baseline yet.'),
                  'Air returning the moment the blower was cleared ties the DO loss to the blower and nothing else. '
                  'Nothing in the basin was changed.',
                  spark(bair, nice_domain(bair, [c['base_air']]),
                        highlight=[ts[fix[1]], ts[back]] if recovered else None, window=w1)),
        ]
        main = chart('mg/L', dd,
                     [series('do', f'{tr} aeration DO', do, 'primary', 2),
                      series('peer', 'Median of the other five trains', peer_median(pack, peers, 'dissolved_oxygen_mg_l'),
                             'expected', 2)],
                     title='What we see',
                     caption=f'Dissolved oxygen in {tr}\'s aeration basin against the median of the other five '
                             f'trains, which take the same influent. The shaded gap is the oxygen the basin should '
                             f'have had.',
                     shade_gap=['do', 'peer'], decimals=2,
                     thresholds=[threshold(p['do_floor_mg_l'], 'Nitrification floor'),
                                 threshold(p['do_target_mg_l'], 'Target')],
                     markers=[marker(ts[onset], 'Air starts falling'), marker(ts[i], 'Flagged')]
                     + ([marker(ts[fix[1]], 'Blower cleared')] if recovered else []))
        air_chart = chart('scfm', nice_domain(hdr, pmed, pad=0.05),
                          [series('hdr', f'{tr} header air flow', hdr, 'primary', 0),
                           series('peer', 'Peer median', pmed, 'expected', 0)],
                          title='Air actually delivered',
                          caption=f'{tr}\'s aeration header against the median of the other five trains. The '
                                  f'shortfall peaked at {num(air_lost, 0)} scfm.',
                          shade_gap=['hdr', 'peer'], decimals=0, window=w1)

        grid_h = hours_grid(4.0, 0.25)
        r = Rng(4703)
        # textbook: inlet filter blinding — air falls, backpressure falls with it
        tb_air = [100 - 23 * min(1.0, (hh / 3.2) ** 0.9) + r.gauss(0.6) for hh in grid_h]
        tb_bp = [100 - 29 * min(1.0, (hh / 3.2) ** 0.9) + r.gauss(0.8) for hh in grid_h]
        ea_air = [100 - 6 * min(1.0, hh / 3.5) + r.gauss(0.6) for hh in grid_h]
        ea_bp = [100 - 8 * min(1.0, hh / 3.5) + r.gauss(0.8) for hh in grid_h]
        la_air = [100 - 14 * min(1.0, (hh / 3.0) ** 1.1) + r.gauss(0.6) for hh in grid_h]
        la_bp = [100 + 26 * min(1.0, (hh / 3.0) ** 1.1) + r.gauss(0.8) for hh in grid_h]
        live_air = aligned([100.0 * v / c['base_air'] for v in bair], onset, pack.step_min, grid_h)
        live_bp = aligned([100.0 * v / bp0 for v in bp], onset, pack.step_min, grid_h)
        live = f'{tr}, today'

        def pair(a, b):
            return [ref_chart('Air delivered, % of normal (h from onset)', '%', [70, 110], grid_h, 'h', a,
                              live_air, live, 0),
                    ref_chart('Diffuser backpressure, % of normal', '%', [60, 140], grid_h, 'h', b, live_bp, live, 0)]
        refs = [
            reference('filter', 'textbook', 'Textbook', 'Blower inlet filter blinding over a shift',
                      'Dust and pollen load the inlet filter. Air flow falls steadily over hours, discharge pressure '
                      'and diffuser backpressure fall with it, discharge temperature climbs, and DO follows the air '
                      'down. The filter ΔP gauge reads high; a clean filter restores everything in minutes.',
                      'match', 'Closest match',
                      ['Same steady air decline, not a step',
                       'Air and backpressure down together — a supply-side restriction',
                       f'{bname} discharge temperature up {signed(t_peak - t0, 1)} °C'],
                      pair(tb_air, tb_bp)),
            reference('early', 'early', 'Early stage', 'Filter just starting to load',
                      'A few percent of air lost over the shift. DO stays inside the band because the controller has '
                      'headroom, and only the inlet ΔP gauge and the air flow trend show it. This is where a filter '
                      'change costs nothing.',
                      'partial', 'Today is well past this',
                      [f'{tr} lost {num(air_lost_pct, 0)} % of its air, not a few percent',
                       'DO had already left the band'],
                      pair(ea_air, ea_bp)),
            reference('diffusers', 'lookalike', 'Look-alike', 'Fouled fine-bubble diffusers',
                      'Biofilm and scale inside the diffuser membranes. DO falls the same way and air flow falls too, '
                      'but the blower has to push harder: discharge pressure and diffuser backpressure both rise. '
                      'The fix is a diffuser clean, not a filter.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here backpressure fell {num(bp_drop, 0)} %, it did not rise',
                       f'Here discharge pressure fell {num(psi_drop_pct, 0)} %'],
                      pair(la_air, la_bp)),
        ]
        ro = [
            ruled_out('An oxygen demand spike in the incoming flow', 'ruled out',
                      f'F:M stayed {num(min(c["fm"]), 3)}–{num(max(c["fm"]), 3)} and MLSS '
                      f'{num(min(c["mlss"]), 0)}–{num(max(c["mlss"]), 0)} mg/L. More demand would have pulled more '
                      f'air; the header fell {num(air_lost_pct, 0)} % instead.',
                      chart('scfm', nice_domain(hdr, pmed, pad=0.05),
                            [series('hdr', f'{tr} header air', hdr, 'primary', 0),
                             series('peer', 'Peer median', pmed, 'expected', 0)], decimals=0,
                            shade_gap=['hdr', 'peer'],
                            caption='Air went down, not up.', window=w1)),
            ruled_out('Fouled or plugged diffusers', 'ruled out',
                      f'{gname} backpressure went DOWN {num(bp_drop, 0)} % and the blower\'s discharge pressure down '
                      f'{num(psi_drop_pct, 0)} %. Plugged diffusers raise both.'),
            ruled_out('DO probe fault', 'ruled out',
                      f'Four other instruments moved with it: header air flow, blower discharge pressure, blower '
                      f'discharge temperature ({signed(t_peak - t0, 1)} °C) and diffuser backpressure. A drifting '
                      f'probe moves alone.'),
            ruled_out('A plant-wide air or influent event', 'ruled out',
                      f'{trains_of(pack, peers)} never went below {num(min(peer_do_min.values()), 2)} mg/L on '
                      f'normal air through the same window.'),
            ruled_out('Blower mechanical damage (bearing, impeller, drive)',
                      'unlikely' if abs(vib_drift) < 0.5 else 'not yet checked',
                      f'{bname} vibration moved {signed(vib_drift, 2)} mm/s from its early-shift level — no bearing or '
                      f'rotor signature. The temperature rise fits a pressure-ratio change, which a restriction '
                      f'explains, and air returned as soon as the machine was cleared.'),
            ruled_out('Why the filter loaded this fast', 'not yet checked',
                      'Inlet filter differential pressure is not instrumented in this model, so how fast it blinded '
                      'has to come off the local gauge and the filter itself. Worth knowing before the next change '
                      'interval is set.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'A restriction on the {tr} {bname}\'s own side cut air delivery '
                                     f'{num(air_lost_pct, 0)} %; the DO collapse in the basin followed from it',
                                     level,
                                     'Confirmed: air and DO recovered when the blower was cleared' if recovered else
                                     'Air flow and discharge pressure fell together'),
            'rootCauseAssetId': blower,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                f'The symptom (DO) and the cause (air flow, discharge pressure, discharge temperature) are separate '
                f'instruments on separate assets, they all moved together, and everything came back when the '
                f'{bname} was cleared.' if recovered else
                'Air flow and discharge pressure fell together, which places the restriction on the blower side.',
                None if recovered else 'Nobody has looked at the blower yet.',
                None if recovered else 'Air returns after the inlet filter is cleared.',
                'Air stays low with a clean filter. Then check the inlet silencer, the butterfly valve position and '
                'the blower itself.',
                f'Air back at {ts[back]} and DO above the floor at {ts[do_back]}, after the inlet filter was '
                f'cleared at {wtime(fix[0])}' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'blower_air_flow_scfm (stage header)',
                      'formula': 'median of the other five aeration stages at the same time point',
                      'fittedOn': 'the other five trains — no coefficients; they share the influent and the diurnal '
                                  'flow curve'},
            'impact': f'{dur(low_min)} below {num(p["do_floor_mg_l"], 1)} mg/L, bottoming at '
                      f'{num(do[trough], 2)} mg/L. Secondary TSS removal ran '
                      f'{num(tss_loss, 1)} points lower through the event'
                      + (f', and T03 health dropped to {num(min(pack.series(pack.unit_of(aid), "system_health_index")), 1)} %.'
                         if pack.has(pack.unit_of(aid), 'system_health_index') else '.')
                      + ' Nitrification lost during a low-DO period takes hours of good DO to rebuild.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Sludge settleability worsening (early bulking) — archetype 13
# ═════════════════════════════════════════════════════════════════════════
class SludgeSettleabilityDrift(Detector):
    id = 'wastewater.sludge_settleability_drift'
    name = 'Sludge settleability worsening — SVI climbing'
    archetype = '13 Quality drift'
    applies_to = 'secondary clarifiers'
    summary = ('Sludge volume index climbing hour after hour on one clarifier while its RAS rate and mechanism load '
               'sit still and the other five trains stay flat. Nothing mechanical and nothing hydraulic changed, so '
               'what changed is the sludge itself.')
    pipeline = [
        ('Level', 'SVI above the watch level and held there'),
        ('Trend', 'rise against the clarifier\'s own first hour, and slope over the last four hours'),
        ('Hold the inputs still', 'RAS rate and mechanism torque unchanged — not hydraulic, not mechanical'),
        ('Cross-check', 'secondary TSS removal falling with it; the other five trains flat'),
        ('Project', 'when the trend reaches the 150 mL/g bulking level'),
        ('Conclusion', 'a settling change in the biology; medium until a microscopic exam says which organism'),
    ]
    definition = {
        'appliesTo': {'assetType': 'secondary_clarifier'},
        'inputs': {'svi': 'self.sludge_settleability_svi', 'ras': 'self.ras_rate_pct',
                   'torque': 'self.clarifier_torque_pct', 'tss': 'self.secondary_tss_removal_pct',
                   'aeration': 'the train\'s aeration stage: mlss_mg_l, food_to_microorganism_ratio, '
                               'sludge_age_days, dissolved_oxygen_mg_l',
                   'peers': 'the other secondary_clarifier stages: sludge_settleability_svi',
                   'work': 'open QUALITY_CHECK on this stage (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five trains',
                  'use': 'rule out a plant-wide influent or biology change'},
        'expected': {'model': 'own first hour', 'target': 'sludge_settleability_svi',
                     'formula': 'median(SVI over the first baseline_min)', 'fitOn': 'self'},
        'params': {'svi_good_mg': 120.0, 'svi_watch_mg': 130.0, 'svi_bulking_mg': 150.0, 'sustain_min': 45,
                   'rise_ml_g': 25.0, 'baseline_min': 60, 'slope_window_min': 240, 'min_slope_ml_g_h': 4.0,
                   'ras_slope_max_pct_h': 2.5, 'ras_lo_pct': 25.0, 'ras_hi_pct': 75.0,
                   'torque_slope_max_pts_h': 2.5,
                   'max_step_ml_g': 3.5, 'tss_drop_pts': 1.0, 'peer_rise_ml_g': 15.0, 'fm_band_max': 0.33,
                   'mlss_band_mg_l': 3400, 'do_floor_mg_l': 1.5},
        'checks': [
            {'id': 'level', 'role': 'required',
             'rule': 'SVI > svi_watch_mg for sustain_min'},
            {'id': 'rise', 'role': 'required',
             'rule': 'SVI now − median(first baseline_min) > rise_ml_g'},
            {'id': 'trend', 'role': 'required',
             'rule': 'slope(SVI, slope_window_min) > min_slope_ml_g_h'},
            {'id': 'ras', 'role': 'required',
             'rule': '|slope(RAS rate over the window)| < ras_slope_max_pct_h, and it stays inside '
                     'ras_lo_pct–ras_hi_pct'},
            {'id': 'mech', 'role': 'required',
             'rule': '|slope(clarifier torque over the window)| < torque_slope_max_pts_h'},
            {'id': 'tss', 'role': 'supporting', 'independent': True,
             'rule': 'secondary_tss_removal_pct down > tss_drop_pts against its own first baseline_min'},
            {'id': 'smooth', 'role': 'supporting',
             'rule': 'largest single 5-min change < max_step_ml_g'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'every other clarifier\'s SVI within peer_rise_ml_g of its own first hour'},
            {'id': 'load', 'role': 'supporting',
             'rule': 'the train\'s MLSS ≤ mlss_band_mg_l and F:M ≤ fm_band_max (svi_good_mg and svi_bulking_mg '
                     'are the chart\'s reference lines; do_floor_mg_l is used by the low-DO rule-out)'},
            {'id': 'exam', 'role': 'supporting',
             'rule': 'a mixed-liquor microscopic exam is on the list but not done (lowers confidence)'},
        ],
        'ruleOut': ['RAS rate too low', 'clarifier mechanism or hydraulic overload', 'a loading or MLSS change',
                    'an SVI test or analyser error', 'low DO driving filaments'],
        'confidence': {'low': 'required checks only',
                       'medium': 'secondary TSS removal, a separate measurement, falls with it',
                       'high': 'a microscopic exam names the organism'},
        'references': ['textbook: filamentous bulking over days', 'variant: a dispersed-growth / deflocculation event',
                       'look-alike: settleometer or sampling error'],
    }

    def candidates(self, pack):
        return pack.of_type('secondary_clarifier')

    def _ctx(self, pack, aid):
        p = self.p
        nb = pack.steps(p['baseline_min'])
        svi = pack.series(aid, 'sludge_settleability_svi')
        return dict(svi=svi, base=median(svi[:nb]),
                    ras=pack.series(aid, 'ras_rate_pct'),
                    torque=pack.series(aid, 'clarifier_torque_pct'),
                    tss=pack.series(aid, 'secondary_tss_removal_pct'))

    def _trend(self, pack, values):
        """Slope over the whole window, in units per hour — 'did this input move at all?'
        A slope is used rather than two window means because a 2-hour mean of an AR(1)
        signal wanders by a couple of points on noise alone."""
        return B.slope_per_hour(values, pack.now, pack.n, pack.step_min)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        hi = B.gt(c['svi'], p['svi_watch_mg'])
        ras_slope, tq_slope = self._trend(pack, c['ras']), self._trend(pack, c['torque'])
        if ras_slope is None or abs(ras_slope) >= p['ras_slope_max_pct_h']:
            return Finding(aid, False)
        if tq_slope is None or abs(tq_slope) >= p['torque_slope_max_pts_h']:
            return Finding(aid, False)
        if not (p['ras_lo_pct'] <= min(c['ras']) and max(c['ras']) <= p['ras_hi_pct']):
            return Finding(aid, False)
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if c['svi'][i] - c['base'] < p['rise_ml_g']:
                continue
            slope = B.slope_per_hour(c['svi'], i, sw, pack.step_min)
            if slope is None or slope < p['min_slope_ml_g_h']:
                continue
            onset = next((k for k in range(pack.n) if c['svi'][k] > c['base'] + 3.0), 0)
            c.update(onset=onset, watch_from=s0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tr = tname(pack, aid)
        svi, base, ras, torque, tss = c['svi'], c['base'], c['ras'], c['torque'], c['tss']
        onset, watch_from = c['onset'], c['watch_from']
        nb = pack.steps(p['baseline_min'])
        slope = B.slope_per_hour(svi, now, pack.steps(p['slope_window_min']), pack.step_min)
        slope_2h = B.slope_per_hour(svi, now, pack.steps(120), pack.step_min)
        step = B.max_step(svi, 1, now)
        exp = [base] * pack.n
        to_bulking = (p['svi_bulking_mg'] - svi[now]) / slope if slope and slope > 0 else None

        ras_slope, tq_slope = self._trend(pack, ras), self._trend(pack, torque)
        ras_ok = abs(ras_slope) < p['ras_slope_max_pct_h'] and p['ras_lo_pct'] <= min(ras) and max(ras) <= p['ras_hi_pct']
        torque_ok = abs(tq_slope) < p['torque_slope_max_pts_h']
        k2 = pack.steps(120)
        ras_a, ras_b = B.mean(ras[:k2]), B.mean(ras[-k2:])
        tq_a, tq_b = B.mean(torque[:k2]), B.mean(torque[-k2:])
        tss0 = median(tss[:nb])
        tss_now = mean_between(tss, now - pack.steps(60) + 1, now)
        tss_ok = tss0 - tss_now > p['tss_drop_pts']
        smooth_ok = step < p['max_step_ml_g']
        peer_tss = {}
        for a in [x for x in self.candidates(pack) if x != aid]:
            v = pack.series(a, 'secondary_tss_removal_pct')
            peer_tss[a] = mean_between(v, now - pack.steps(60) + 1, now) - median(v[:nb])

        peers = [a for a in self.candidates(pack) if a != aid]
        peer_drift = {}
        for a in peers:
            v = pack.series(a, 'sludge_settleability_svi')
            peer_drift[a] = mean_between(v, now - pack.steps(60) + 1, now) - median(v[:nb])
        peers_ok = all(abs(v) < p['peer_rise_ml_g'] for v in peer_drift.values())
        worst_peer = max(peers, key=lambda a: peer_drift[a])

        aer = next((x for x in pack.descendants(pack.unit_of(aid))
                    if pack.asset(x)['assetType'] == 'aeration'), None)
        mlss = pack.series(aer, 'mlss_mg_l') if aer else None
        fm = pack.series(aer, 'food_to_microorganism_ratio') if aer else None
        age = pack.series(aer, 'sludge_age_days') if aer else None
        do = pack.series(aer, 'dissolved_oxygen_mg_l') if aer else None
        load_ok = (mlss is not None and max(mlss) <= p['mlss_band_mg_l'] and max(fm) <= p['fm_band_max'])

        # DO as a possible driver: is this train the lowest in the plant, and did DO move before the SVI did?
        do_rank = do_mean = do_low_min = None
        if do is not None:
            k2 = pack.steps(120)
            others = [a for a in pack.of_type('aeration') if a != aer]
            do_mean = B.mean(do[-k2:])
            peer_means = sorted(B.mean(pack.series(a, 'dissolved_oxygen_mg_l')[-k2:]) for a in others)
            do_rank = sum(1 for v in peer_means if v < do_mean) + 1
            low = B.lt(do, p['do_floor_mg_l'])
            do_low_min = max([(b - a + 1) * pack.step_min for a, b in B.runs(low)] or [0])

        exam = open_work(pack, [aid], ['QUALITY_CHECK'])
        exam_open = bool(exam)
        level = 'medium' if tss_ok else 'low'
        yd = nice_domain(svi, [base, p['svi_bulking_mg']], pad=0.05)
        w1 = [ts[0], ts[now]]

        checks = [
            check('level', f'SVI past the {num(p["svi_watch_mg"], 0)} mL/g watch level and holding', 'required', MATCH,
                  f'{num(svi[now], 1)} mL/g now, above {num(p["svi_watch_mg"], 0)} mL/g since {ts[watch_from]} '
                  f'({dur(pack.minutes_between(watch_from, now))}). Flagged at {ts[i]}.',
                  f'Well-settling sludge sits under about {num(p["svi_good_mg"], 0)} mL/g; above '
                  f'{num(p["svi_bulking_mg"], 0)} mL/g it is bulking and carries over the weirs. In between is the '
                  f'window where a change still costs nothing.',
                  spark(svi, yd, threshold_value=p['svi_watch_mg'], highlight=[ts[watch_from], ts[now]])),
            check('rise', 'Up against its own start of shift', 'required', MATCH,
                  f'{num(base, 1)} mL/g over the first {dur(p["baseline_min"])} to {num(svi[now], 1)} mL/g now '
                  f'({signed(svi[now] - base, 1)} mL/g). Left its baseline at {ts[onset]}.',
                  'An SVI level on its own can be a train\'s normal. A rise of this size against the same clarifier '
                  'earlier the same shift is a change in the sludge.',
                  spark(svi, yd, exp, exp, highlight=[ts[onset], ts[now]])),
            check('trend', 'Climbing all shift, not drifting', 'required', MATCH,
                  f'{signed(slope, 1)} mL/g per hour over the last {dur(p["slope_window_min"])}, '
                  f'{signed(slope_2h, 1)} mL/g per hour over the last 2 hours. Flag level is '
                  f'+{num(p["min_slope_ml_g_h"], 0)} mL/g per hour.',
                  'A settling change in the biology develops over hours to days and keeps going. Normal SVI scatter '
                  'wanders up and down and nets out near zero over four hours.',
                  spark(svi, yd, highlight=[ts[max(0, now - pack.steps(p["slope_window_min"]) + 1)], ts[now]])),
            check('ras', 'RAS rate never changed', 'required', MATCH if ras_ok else NO_MATCH,
                  f'{signed(ras_slope, 2)} % per hour across the whole window (flag level is '
                  f'{num(p["ras_slope_max_pct_h"], 1)}), {num(ras_a, 1)} % over the first 2 hours against '
                  f'{num(ras_b, 1)} % over the last 2. Range {num(min(ras), 1)}–{num(max(ras), 1)} %, inside the '
                  f'{num(p["ras_lo_pct"], 0)}–{num(p["ras_hi_pct"], 0)} % normal band all shift.',
                  'Returning less sludge thins the blanket and lifts the apparent SVI. RAS held still, so the number '
                  'is telling us about the sludge and not about the pump.',
                  spark(ras, nice_domain(ras, [p['ras_lo_pct'] + 5, p['ras_hi_pct'] - 15]))),
            check('mech', 'Nothing changed in the mechanism', 'required', MATCH if torque_ok else NO_MATCH,
                  f'Clarifier torque {signed(tq_slope, 2)} points per hour across the window (flag level is '
                  f'{num(p["torque_slope_max_pts_h"], 1)}), range {num(min(torque), 1)}–'
                  f'{num(max(torque), 1)} %.',
                  'A rising blanket or a dragging mechanism shows up as torque. Flat torque says the clarifier is '
                  'doing the same mechanical work on a sludge that settles worse.',
                  spark(torque, nice_domain(torque))),
            check('tss', 'Clarified effluent getting worse with it', 'supporting', MATCH if tss_ok else NO_MATCH,
                  f'Secondary TSS removal {num(tss0, 1)} % over the first {dur(p["baseline_min"])} against '
                  f'{num(tss_now, 1)} % over the last hour ({signed(tss_now - tss0, 1)} points). The other five '
                  f'clarifiers moved {signed(min(peer_tss.values()), 1)} to {signed(max(peer_tss.values()), 1)} '
                  f'points over the same two windows (a positive number is a gain), so this is the only one that '
                  f'lost ground.',
                  'A separate measurement, and the one that matters for the permit. Sludge that settles more slowly '
                  'leaves more solids in the overflow, which is exactly what this shows.',
                  spark(tss, nice_domain(tss, [tss0]), threshold_value=tss0 - p['tss_drop_pts'])),
            check('smooth', 'A smooth climb, not test scatter', 'supporting', MATCH if smooth_ok else NO_MATCH,
                  f'Largest single 5-minute change {num(step, 2)} mL/g, against '
                  f'{num(min(B.max_step(pack.series(a, "sludge_settleability_svi"), 1, now) for a in peers), 1)}–'
                  f'{num(max(B.max_step(pack.series(a, "sludge_settleability_svi"), 1, now) for a in peers), 1)} mL/g '
                  f'on the other five clarifiers.',
                  'Settleability changes as the floc changes, which is slow. A sampling or settleometer problem jumps '
                  'between readings.',
                  spark(svi, yd, highlight=[ts[onset], ts[now]])),
            check('peers', 'The other five clarifiers are flat', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'{trains_of(pack, peers)} ended within {signed(min(peer_drift.values()), 1)} to '
                  f'{signed(max(peer_drift.values()), 1)} mL/g of their own first hour; the biggest mover was '
                  f'{tname(pack, worst_peer)} at {signed(peer_drift[worst_peer], 1)} mL/g.',
                  'All six trains share the influent. A septic or nutrient-poor influent would push every clarifier; '
                  'only this one moved.',
                  spark(pack.series(worst_peer, 'sludge_settleability_svi'), yd)),
            check('load', 'Loading and inventory normal in this train', 'supporting',
                  MATCH if load_ok else NO_MATCH,
                  (f'MLSS {num(min(mlss), 0)}–{num(max(mlss), 0)} mg/L, F:M {num(min(fm), 3)}–{num(max(fm), 3)}, '
                   f'sludge age {num(min(age), 1)}–{num(max(age), 1)} days — all inside the conventional bands.'
                   if mlss is not None else 'No aeration stage found in this train.'),
                  'Rules out the easy explanations: too much solids inventory, an F:M swing, or sludge held far too '
                  'long. The aeration side is running where it should be.',
                  spark(mlss, nice_domain(mlss)) if mlss is not None else None),
            check('exam', 'Microscopic exam still outstanding', 'supporting', MATCH if exam_open else NO_MATCH,
                  (f'"{exam[0]["text"]}" due {exam[0]["dueAt"][11:16]}, not done.' if exam_open else
                   'No microscopic exam on the list.'),
                  'Only a mixed-liquor exam separates filaments from the other causes of poor settling, and that '
                  'decides the fix. This is why the conclusion stops at medium.',
                  None),
        ]
        main = chart('mL/g', yd,
                     [series('svi', f'{tr} secondary clarifier SVI', svi, 'primary', 1),
                      series('base', 'Its own start of shift', exp, 'expected', 1)],
                     band=peer_envelope(pack, peers, 'sludge_settleability_svi', 'The other five trains', 1),
                     title='What we see',
                     caption=f'Sludge volume index on {tr}\'s secondary clarifier against its own start of shift and '
                             f'the other five trains. {tr} has climbed {num(svi[now] - base, 0)} mL/g since '
                             f'{ts[onset]}; the rest are where they started.',
                     decimals=0,
                     thresholds=[threshold(p['svi_good_mg'], 'Settles well'),
                                 threshold(p['svi_bulking_mg'], 'Bulking')],
                     markers=[marker(ts[onset], 'Leaves baseline'), marker(ts[i], 'Flagged')], window=w1)

        grid_h = hours_grid(12.0, 1.0)
        r = Rng(5519)
        tb = [base + 48 * (1 - math.exp(-hh / 5.0)) + 14 * max(0.0, hh - 6) / 6 + r.gauss(1.2) for hh in grid_h]
        va = [base + 26 * (1 - math.exp(-hh / 1.2)) + r.gauss(1.4) for hh in grid_h]
        la = [base + (0 if hh < 4 else 34) + r.gauss(1.4) for hh in grid_h]
        tb_tss = [tss0 - 0.08 * (tb[k] - base) + r.gauss(0.3) for k in range(len(grid_h))]
        va_tss = [tss0 - 0.16 * (va[k] - base) + r.gauss(0.3) for k in range(len(grid_h))]
        la_tss = [tss0 + r.gauss(0.3) for _ in grid_h]
        live_svi = aligned(svi, onset, pack.step_min, grid_h)
        live_tss = aligned(tss, onset, pack.step_min, grid_h)
        live = f'{tr}, today'

        def pair(a, b):
            return [ref_chart('SVI (h from onset)', 'mL/g', [80, 200], grid_h, 'h', a, live_svi, live, 0,
                              [threshold(p['svi_bulking_mg'], 'Bulking')]),
                    ref_chart('Secondary TSS removal', '%', [70, 95], grid_h, 'h', b, live_tss, live, 1)]
        refs = [
            reference('filaments', 'textbook', 'Textbook', 'Filamentous bulking, confirmed on the microscope',
                      'SVI climbs steadily over a day or two past 150 mL/g, the blanket deepens, TSS carryover '
                      'follows, and the exam shows filaments bridging the floc. The fix depends on which organism: '
                      'more RAS and a selector, or RAS chlorination.',
                      'match', 'Closest match so far',
                      [f'Same slow steady climb ({signed(slope, 1)} mL/g per hour here)',
                       'Same quiet RAS and mechanism',
                       'The exam is what separates this from the variant below'],
                      pair(tb, tb_tss)),
            reference('disperse', 'variant', 'Variant', 'Deflocculation or dispersed growth',
                      'A toxic slug or a sudden nutrient shortage breaks the floc up. SVI rises faster and flattens, '
                      'and the overflow goes cloudy out of proportion to the SVI because fine solids never settle at '
                      'all. The exam shows no filaments.',
                      'partial', 'Same direction, different shape',
                      ['That rise is faster and then flattens; today\'s is still climbing',
                       f'TSS removal here fell {num(tss0 - tss_now, 1)} points, in proportion to the SVI'],
                      pair(va, va_tss)),
            reference('sample', 'lookalike', 'Look-alike', 'Settleometer or sampling error',
                      'The sample is taken from a different point, or the cylinder is read late. SVI steps to a new '
                      'level and stays there, and nothing else in the plant agrees with it.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here the largest 5-minute change is {num(step, 2)} mL/g — a curve, not a step',
                       'Here secondary TSS removal fell with it'],
                      pair(la, la_tss)),
        ]
        ro = [
            ruled_out('RAS rate too low for the inventory', 'ruled out',
                      f'RAS trended {signed(ras_slope, 2)} % per hour — flat — and stayed inside the '
                      f'{num(p["ras_lo_pct"], 0)}–{num(p["ras_hi_pct"], 0)} % range. Nothing on the return side moved '
                      f'while the SVI climbed {num(svi[now] - base, 0)} mL/g.'),
            ruled_out('Clarifier mechanism or hydraulic overload', 'ruled out',
                      f'Torque {num(min(torque), 1)}–{num(max(torque), 1)} % with no trend '
                      f'({signed(tq_slope, 2)} points per hour). A dragging rake or a deepening blanket would load '
                      f'the drive.'),
            ruled_out('A loading or MLSS change', 'ruled out' if load_ok else 'unlikely',
                      f'MLSS {num(min(mlss), 0)}–{num(max(mlss), 0)} mg/L and F:M {num(min(fm), 3)}–'
                      f'{num(max(fm), 3)} in this train, both inside the conventional bands, and sludge age steady at '
                      f'{num(B.mean(age), 1)} days.' if mlss is not None else 'No aeration data for this train.'),
            ruled_out('An SVI test or analyser error', 'ruled out' if tss_ok else 'unlikely',
                      f'Secondary TSS removal, measured separately, fell {num(tss0 - tss_now, 1)} points over the '
                      f'same hours, and the climb is smooth (largest step {num(step, 2)} mL/g). A test problem would '
                      f'step and nothing else would agree.'),
            ruled_out('Low DO driving filamentous growth', 'not yet checked',
                      (f'The classic trigger, and worth asking the lab about: {tr} aeration averaged '
                       f'{num(do_mean, 2)} mg/L over the last 2 hours, the lowest of the six trains, though it never '
                       f'spent more than {dur(do_low_min)} under {num(p["do_floor_mg_l"], 1)} mg/L. The timing is '
                       f'wrong for it to be the trigger — the SVI left its baseline at {ts[onset]}, hours before the '
                       f'DO reached its lowest — but it could be feeding the trend now.'
                       if do is not None and do_rank == 1 else
                       f'{tr} aeration DO sat at {num(do_mean, 2)} mg/L over the last 2 hours, rank '
                       f'{do_rank} of {len(pack.of_type("aeration"))} in the plant. Not an obvious driver.'),
                      chart('mg/L', nice_domain(do, [p['do_floor_mg_l']], floor=0.0),
                            [series('do', f'{tr} aeration DO', do, 'primary', 2)],
                            band=peer_envelope(pack, [a_ for a_ in pack.of_type('aeration') if a_ != aer],
                                               'dissolved_oxygen_mg_l', 'The other five basins', 2),
                            decimals=2, thresholds=[threshold(p['do_floor_mg_l'], 'Nitrification floor')],
                            caption='DO in this basin against the range in the other five.')
                      if do is not None else None),
            ruled_out('Nutrient deficiency or a septic influent', 'not yet checked',
                      'Influent nitrogen, phosphorus and sulphide are not instrumented in this model, and all six '
                      'trains share the influent, so a plant-wide nutrient cause would have moved the other five '
                      'clarifiers too. The exam will see the organism either way.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'A settling change in {tr}\'s sludge — filamentous bulking is the leading '
                                     f'candidate — with nothing hydraulic or mechanical behind it',
                                     level,
                                     'Two separate measurements agree' if tss_ok else 'SVI trend only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                'SVI and secondary TSS removal are separate measurements and both moved the same way, while RAS, '
                'mechanism torque and the whole aeration side held still.' if tss_ok else
                'Only the SVI trend shows it so far.',
                'Nobody has looked at the mixed liquor under a microscope. From trends alone, filaments, dispersed '
                'growth and a nutrient shortage all look like a rising SVI.',
                'The exam finds filaments bridging the floc, or the SVI passes '
                f'{num(p["svi_bulking_mg"], 0)} mL/g with the blanket deepening.',
                'The exam is clean and the SVI flattens. Then treat it as normal sludge variation and re-sample next '
                'shift.',
                None),
            'action': action(item, pack),
            'model': {'target': 'sludge_settleability_svi',
                      'formula': f'{num(base, 1)} mL/g, the median over the first {dur(p["baseline_min"])}',
                      'fittedOn': 'this clarifier\'s own first hour; the other five trains as a cross-check'},
            'impact': (f'At {signed(slope, 1)} mL/g per hour it reaches the {num(p["svi_bulking_mg"], 0)} mL/g '
                       f'bulking level in about {dur(to_bulking * 60)}, around '
                       f'{clock(tmin(pack, now) + to_bulking * 60)}. Secondary TSS removal has already lost '
                       f'{num(tss0 - tss_now, 1)} points.' if to_bulking else
                       f'Secondary TSS removal has lost {num(tss0 - tss_now, 1)} points so far.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Primary sludge collector stall at peak flow — archetype 11,
#    with a 09-style knock-on into aeration
# ═════════════════════════════════════════════════════════════════════════
class ClarifierCollectorStall(Detector):
    id = 'wastewater.clarifier_collector_stall'
    name = 'Primary sludge collector stalled, solids carrying over'
    archetype = '11 Hard block (with a 09-style knock-on into aeration)'
    applies_to = 'primary clarifiers'
    summary = ('A primary clarifier\'s sludge collector goes from running to stopped in one interval after its drive '
               'current had been climbing. The blanket rises, TSS and BOD removal fall within minutes, and the '
               'solids that get away turn up as extra load on the aeration basin the clarifier feeds.')
    pipeline = [
        ('Stop', 'collector motor current and travel speed to zero in one interval, from running'),
        ('Effect', 'primary TSS removal falls and the sludge blanket rises within minutes'),
        ('Why then', 'drive current already above its own level, at a flow in the top of the day\'s range'),
        ('Rule out the flow', 'the other five trains took the same peak and held their TSS removal'),
        ('Follow the process flow', 'the aeration basin the clarifier feeds, after the lag'),
        ('Conclusion', 'a mechanical stop on the collector; restart and recovery → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'primary_clarifier'},
        'inputs': {'tss': 'self.primary_tss_removal_pct', 'bod': 'self.primary_bod_removal_pct',
                   'blanket': 'self.sludge_blanket_level_pct', 'scum': 'self.scum_removal_rate',
                   'collector': 'child sludge_collector: motor_current_a, travel_speed_pct, cycle_time_min',
                   'skimmer': 'child scum_skimmer: motor_current_a, travel_speed_pct',
                   'flow': 'sources[process_flow] of the child basin: influent_pump.flow_rate_gpm',
                   'downstream': 'targets[process_flow] of the child basin: the aeration basin\'s stage '
                                 '(food_to_microorganism_ratio, dissolved_oxygen_mg_l)',
                   'peers': 'the other primary_clarifier stages: primary_tss_removal_pct',
                   'work': 'done MAINTENANCE on this stage (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five trains',
                  'use': 'rule out the peak flow as the cause on its own'},
        'expected': {'model': 'own level just before the stop', 'target': 'primary_tss_removal_pct',
                     'formula': 'median(TSS removal over the pre_min before the stop)', 'fitOn': 'self'},
        'params': {'stop_current_a': 0.10, 'stop_speed_pct': 1.0, 'run_current_a': 1.0, 'pre_min': 30,
                   'tss_drop_pts': 10.0, 'tss_within_min': 20, 'blanket_rise_pts': 5.0,
                   'blanket_within_min': 45, 'overload_pct': 8.0,
                   'flow_pctile': 70.0, 'peer_tss_band_pts': 12.0, 'bod_drop_pts': 2.0,
                   'knock_fm_rise': 0.015, 'knock_do_drop': 0.20, 'knock_within_min': 60,
                   'restart_within_min': 30, 'recover_pct': 97.0, 'recover_within_min': 45,
                   'scum_band_pts': 4.0},
        'checks': [
            {'id': 'stop', 'role': 'required',
             'rule': 'collector motor_current_a ≤ stop_current_a and travel_speed_pct ≤ stop_speed_pct, from '
                     '> run_current_a in the interval before'},
            {'id': 'tss', 'role': 'required',
             'rule': 'primary_tss_removal_pct falls > tss_drop_pts below its pre_min median within tss_within_min'},
            {'id': 'blanket', 'role': 'supporting', 'independent': True,
             'rule': 'sludge_blanket_level_pct rises > blanket_rise_pts within blanket_within_min of the stop'},
            {'id': 'overload', 'role': 'supporting',
             'rule': 'collector motor_current_a > overload_pct % above its own running median before the stop'},
            {'id': 'peak', 'role': 'supporting',
             'rule': 'influent flow at the stop above the flow_pctile-th percentile of the day'},
            {'id': 'bod', 'role': 'supporting', 'independent': True,
             'rule': 'primary_bod_removal_pct falls > bod_drop_pts over the same window'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'every other primary clarifier stayed within peer_tss_band_pts of its own pre-stop level'},
            {'id': 'knock', 'role': 'supporting',
             'rule': 'the aeration stage it feeds: F:M up > knock_fm_rise and DO down > knock_do_drop within '
                     'knock_within_min'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True,
             'rule': 'collector running again within restart_within_min and TSS removal back to recover_pct % of '
                     'its pre-stop level within recover_within_min'},
        ],
        'ruleOut': ['a hydraulic surge on its own', 'a weir or scum problem', 'a TSS analyser fault',
                    'a solids loading change from upstream', 'the collector drive\'s own fault code'],
        'confidence': {'low': 'required checks only',
                       'medium': 'BOD removal, a separate measurement, fell with it',
                       'high': 'the collector restarted and TSS removal came straight back'},
        'references': ['textbook: drive overload trip at peak flow', 'variant: collector left out of service',
                       'look-alike: hydraulic surge with the collector running'],
    }

    def candidates(self, pack):
        return pack.of_type('primary_clarifier')

    def _ctx(self, pack, aid):
        collector = pack.child_of_type(aid, 'sludge_collector')
        basin = pack.child_of_type(aid, 'primary_clarifier_basin')
        if collector is None or basin is None:
            return None
        pump = next((s for s in pack.sources(basin, 'process_flow')
                     if pack.has(s, 'flow_rate_gpm')), None)
        down = None
        for t in pack.targets(basin, 'process_flow'):
            parent = pack.parent(t)
            if parent and pack.asset(parent)['assetType'] == 'aeration':
                down = parent
        return dict(collector=collector, basin=basin, pump=pump, down=down,
                    cur=pack.series(collector, 'motor_current_a'),
                    spd=pack.series(collector, 'travel_speed_pct'),
                    tss=pack.series(aid, 'primary_tss_removal_pct'),
                    blanket=pack.series(aid, 'sludge_blanket_level_pct'))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        cur, spd, tss, blanket = c['cur'], c['spd'], c['tss'], c['blanket']
        stopped = [cur[k] <= p['stop_current_a'] and spd[k] <= p['stop_speed_pct'] for k in range(pack.n)]
        npre, nw = pack.steps(p['pre_min']), pack.steps(p['tss_within_min'])
        nb = pack.steps(p['blanket_within_min'])
        for s0, s1 in B.runs(stopped):
            if s0 == 0 or cur[s0 - 1] <= p['run_current_a']:
                continue
            tss0 = median(tss[max(0, s0 - npre):s0])
            b0 = median(blanket[max(0, s0 - npre):s0])
            lo = min(range(s0, min(pack.n, s1 + nw + 1)), key=lambda k: tss[k])
            if tss0 - tss[lo] <= p['tss_drop_pts']:
                continue
            hi = max(range(s0, min(pack.n, s1 + nb + 1)), key=lambda k: blanket[k])
            fired = next((k for k in range(s0, pack.n) if tss0 - tss[k] > p['tss_drop_pts']), lo)
            c.update(stop=s0, end=s1, tss0=tss0, b0=b0, low=lo, high=hi, stopped=stopped)
            return Finding(aid, True, fired, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tr = tname(pack, aid)
        col, pump, down = c['collector'], c['pump'], c['down']
        cname = pack.name(col)
        cur, spd, tss, blanket = c['cur'], c['spd'], c['tss'], c['blanket']
        s0, s1, tss0, b0, lo, hi = c['stop'], c['end'], c['tss0'], c['b0'], c['low'], c['high']
        stop_min = (s1 - s0 + 1) * pack.step_min
        npre = pack.steps(p['pre_min'])

        restart = next((k for k in range(s1 + 1, pack.n) if cur[k] > p['run_current_a']), None)
        back = next((k for k in range(lo, pack.n) if tss[k] >= tss0 * p['recover_pct'] / 100.0), None)
        recovered = (restart is not None and back is not None
                     and pack.minutes_between(s0, restart) <= p['restart_within_min']
                     and pack.minutes_between(restart, back) <= p['recover_within_min'])
        work = done_work(pack, [aid] + pack.descendants(aid))
        fix = work[-1] if work else None

        run_cur = [v for v in cur[:s0] if v > p['run_current_a']]
        cur_med = median(run_cur) if run_cur else None
        cur_pre = max(cur[max(0, s0 - npre):s0])
        overload_pct = pct(cur_pre, cur_med) if cur_med else None
        over_ok = overload_pct is not None and overload_pct > p['overload_pct']
        restart_cur = max(cur[restart:min(pack.n, restart + pack.steps(30) + 1)]) if restart is not None else None

        flow = pack.series(pump, 'flow_rate_gpm') if pump else None
        fl_pct = pctile(flow, flow[s0]) if flow else None
        peak_ok = fl_pct is not None and fl_pct >= p['flow_pctile']

        bod = pack.series(aid, 'primary_bod_removal_pct')
        bod0 = median(bod[max(0, s0 - npre):s0])
        bod_lo = min(bod[s0:min(pack.n, s1 + pack.steps(p['tss_within_min']) + 1)])
        bod_ok = bod0 - bod_lo > p['bod_drop_pts']

        scum = pack.series(aid, 'scum_removal_rate')
        skim = pack.child_of_type(aid, 'scum_skimmer')
        skim_cur = pack.series(skim, 'motor_current_a') if skim else None
        scum0 = median(scum[max(0, s0 - npre):s0])
        scum_lo = min(scum[s0:min(pack.n, hi + 1)])
        scum_flat = scum0 - scum_lo < p['scum_band_pts']

        peers = [a for a in self.candidates(pack) if a != aid]
        peer_drop = {}
        for a in peers:
            v = pack.series(a, 'primary_tss_removal_pct')
            base = median(v[max(0, s0 - npre):s0])
            peer_drop[a] = base - min(v[s0:min(pack.n, hi + 1)])
        peers_ok = all(v < p['peer_tss_band_pts'] for v in peer_drop.values())
        worst_peer = max(peers, key=lambda a: peer_drop[a])
        peer_flow_rise = {}
        for a in peers:
            b = pack.child_of_type(a, 'primary_clarifier_basin')
            pp = next((s for s in pack.sources(b, 'process_flow') if pack.has(s, 'flow_rate_gpm')), None)
            if pp:
                v = pack.series(pp, 'flow_rate_gpm')
                peer_flow_rise[a] = pctile(v, v[s0])

        kw = pack.steps(p['knock_within_min'])
        fm = do = None
        fm_rise = do_drop = None
        if down is not None:
            fm = pack.series(down, 'food_to_microorganism_ratio')
            do = pack.series(down, 'dissolved_oxygen_mg_l')
            fm0 = median(fm[max(0, s0 - npre):s0])
            do0 = median(do[max(0, s0 - npre):s0])
            fm_rise = max(fm[s0:min(pack.n, s0 + kw + 1)]) - fm0
            do_drop = do0 - min(do[s0:min(pack.n, s0 + kw + 1)])
        knock_ok = (fm_rise is not None and fm_rise > p['knock_fm_rise'] and do_drop > p['knock_do_drop'])
        # how big the same move was on the other five trains over the same window — the honest caveat
        peer_fm_rise = {}
        for a in pack.of_type('aeration'):
            if a == down:
                continue
            v = pack.series(a, 'food_to_microorganism_ratio')
            peer_fm_rise[a] = max(v[s0:min(pack.n, s0 + kw + 1)]) - median(v[max(0, s0 - npre):s0])

        blanket_ok = blanket[hi] - b0 > p['blanket_rise_pts']
        level = 'high' if recovered else ('medium' if (bod_ok or blanket_ok) else 'low')
        w1 = win(pack, s0, back if back is not None else hi, 6)
        yd = nice_domain(tss, [tss0], pad=0.08)
        exp = [tss0] * pack.n

        checks = [
            check('stop', f'{cname} went from running to stopped in one interval', 'required', MATCH,
                  f'Motor current {num(cur[s0 - 1], 2)} → {num(cur[s0], 2)} A and travel speed '
                  f'{num(spd[s0 - 1], 1)} → {num(spd[s0], 1)} % at {ts[s0]}; stopped for {dur(stop_min)}'
                  + (f', running again at {ts[restart]} at {num(restart_cur, 2)} A.' if restart is not None
                     else ', still stopped.'),
                  'Zero current with zero travel is a stopped drive, not a slow one. A worn chain or a dragging flight '
                  'loses speed over hours; a drive that trips does it between two samples.',
                  spark(cur, nice_domain(cur, [0.0], floor=0.0), threshold_value=p['stop_current_a'], window=w1)),
            check('tss', 'TSS removal fell as soon as it stopped', 'required', MATCH,
                  f'{num(tss0, 1)} % over the {dur(p["pre_min"])} before the stop down to {num(tss[lo], 1)} % at '
                  f'{ts[lo]} ({signed(tss[lo] - tss0, 1)} points) — past the {num(p["tss_drop_pts"], 0)}-point flag '
                  f'level at {ts[i]}.',
                  'The collector is what takes settled sludge out of the tank. With it stopped the sludge stays put, '
                  'the effective depth shrinks, and solids leave over the weirs within minutes.',
                  spark(tss, yd, exp, exp, threshold_value=tss0 - p['tss_drop_pts'], window=w1)),
            check('blanket', 'Sludge blanket rose at the same time', 'supporting',
                  MATCH if blanket[hi] - b0 > p['blanket_rise_pts'] else NO_MATCH,
                  f'{num(b0, 1)} % before the stop to {num(blanket[hi], 1)} % at {ts[hi]} '
                  f'({signed(blanket[hi] - b0, 1)} points); flag level is '
                  f'+{num(p["blanket_rise_pts"], 0)} points within {dur(p["blanket_within_min"])}.',
                  'Sludge still arrives while nothing is being pulled out, so the blanket climbs toward the weirs. '
                  'This is the mechanism, measured on a separate instrument from the TSS removal.',
                  spark(blanket, nice_domain(blanket, [b0]), threshold_value=b0 + p['blanket_rise_pts'], window=w1)),
            check('overload', 'The drive was already working too hard', 'supporting',
                  MATCH if over_ok else NO_MATCH,
                  (f'Peak current {num(cur_pre, 2)} A in the {dur(p["pre_min"])} before the stop against a running '
                   f'median of {num(cur_med, 2)} A ({signed(overload_pct, 0)} %)'
                   + (f'; {num(restart_cur, 2)} A on the restart, easing off after.' if restart_cur else '.')
                   if over_ok else f'Current held near its {num(cur_med, 2)} A median before the stop.'),
                  'Heavy sludge or debris under the flights loads the drive before the overload device lets go. A '
                  'current climb and then a trip is the mechanical story; an electrical fault drops out with no '
                  'warning.',
                  spark(cur, nice_domain(cur, [0.0], floor=0.0),
                        threshold_value=cur_med * (1 + p['overload_pct'] / 100.0) if cur_med else None, window=w1)),
            check('peak', 'It happened at the top of the day\'s flow', 'supporting',
                  MATCH if peak_ok else NO_MATCH,
                  (f'{tr} influent {num(flow[s0], 0)} gpm at {ts[s0]} — the {ordinal(fl_pct)} percentile of the '
                   f'day\'s readings (day range {num(min(flow), 0)}–{num(max(flow), 0)} gpm).' if flow else
                   'No influent flow signal found upstream of this clarifier.'),
                  'More flow means more solids arriving and more drag on the flights, which is why these drives trip '
                  'during the late-morning peak and not at 04:00.',
                  spark(flow, nice_domain(flow), highlight=[ts[s0], ts[s1]], window=w1) if flow else None),
            check('bod', 'BOD removal followed it down', 'supporting', MATCH if bod_ok else NO_MATCH,
                  f'Primary BOD removal {num(bod0, 1)} → {num(bod_lo, 1)} % ({signed(bod_lo - bod0, 1)} points) over '
                  f'the same window.',
                  'A separate measurement. Much of the BOD a primary removes rides on the settleable solids, so BOD '
                  'removal has to move with TSS removal. It rules out a TSS analyser problem.',
                  spark(bod, nice_domain(bod, [bod0]), window=w1)),
            check('peers', 'The other five trains took the same peak and held', 'supporting',
                  MATCH if peers_ok else NO_MATCH,
                  f'{trains_of(pack, peers)} lost at most {num(max(peer_drop.values()), 1)} points of TSS removal '
                  f'over the same window ({tname(pack, worst_peer)} worst), against '
                  f'{num(tss0 - tss[lo], 1)} points here, on flows in the '
                  f'{num(min(peer_flow_rise.values()), 0)}–{num(max(peer_flow_rise.values()), 0)}th percentile of '
                  f'their own day.',
                  'The whole plant saw the same morning peak. If the flow alone were enough, every primary would have '
                  'lost solids. Only the one with the stopped collector did.',
                  spark(pack.series(worst_peer, 'primary_tss_removal_pct'), yd, window=w1)),
            check('knock', 'Extra load turned up in aeration behind it', 'supporting',
                  MATCH if knock_ok else NO_MATCH,
                  (f'{tr} aeration F:M {signed(fm_rise, 3)} and DO {signed(-do_drop, 2)} mg/L within '
                   f'{dur(p["knock_within_min"])} of the stop. For scale, the other five aeration stages moved '
                   f'{signed(min(peer_fm_rise.values()), 3)} to {signed(max(peer_fm_rise.values()), 3)} on F:M over '
                   f'the same window.' if fm is not None else 'No downstream aeration stage found.'),
                  'Following the process-flow edge from the primary basin to the aeration basin: solids that escape '
                  'the primary arrive as organic load a stage later. Honest caveat — the morning peak alone moves '
                  'F:M by about as much on the other trains, so this is consistent with the stall, not proof of it.',
                  spark(fm, nice_domain(fm), window=w1) if fm is not None else None),
            check('recovered', 'Back to normal once it was restarted', 'supporting',
                  MATCH if recovered else PENDING,
                  (f'Running again at {ts[restart]} ({dur(pack.minutes_between(s0, restart))} after the stop); TSS '
                   f'removal back to {num(tss[back], 1)} % at {ts[back]}, the blanket back to '
                   f'{num(blanket[min(now, back + pack.steps(45))], 1)} % after'
                   + (f'. "{fix[0]["text"]}" completed {wtime(fix[0])}.' if fix else '.')
                   if recovered else 'Not back to its pre-stop level yet.'),
                  'Removal returning as soon as the flights moved again ties the solids loss to the collector and to '
                  'nothing in the influent.',
                  spark(tss, yd, highlight=[ts[restart], ts[back]] if recovered else None, window=w1)),
        ]
        main = chart('%', yd,
                     [series('tss', f'{tr} primary TSS removal', tss, 'primary', 1),
                      series('exp', 'Its level before the stop', exp, 'expected', 1)],
                     band=peer_envelope(pack, peers, 'primary_tss_removal_pct', 'The other five trains', 1),
                     title='What we see',
                     caption=f'Primary TSS removal on {tr} against its level before the stop and the other five '
                             f'trains. {tr} lost {num(tss0 - tss[lo], 0)} points in '
                             f'{dur(pack.minutes_between(s0, lo))} and came back within '
                             f'{dur(pack.minutes_between(s0, back))} of the stop.' if back is not None else
                             f'Primary TSS removal on {tr} against its level before the stop.',
                     decimals=0, shade_gap=['tss', 'exp'],
                     markers=[marker(ts[s0], f'{cname} stops')]
                     + ([marker(ts[restart], 'Restarted')] if restart is not None else [])
                     + ([marker(ts[back], 'Back to baseline')] if back is not None else []), window=w1)

        grid_m = minutes_grid(-20, 90, 5)
        r = Rng(6133)
        tb = [(tss0 + r.gauss(0.5) if m < 0 else
               max(tss0 - 24, tss0 - 1.7 * m) + r.gauss(0.5) if m < 15 else
               min(tss0, tss0 - 24 + 1.1 * (m - 15)) + r.gauss(0.5)) for m in grid_m]
        va = [(tss0 + r.gauss(0.5) if m < 0 else max(tss0 - 30, tss0 - 1.7 * m) + r.gauss(0.6)) for m in grid_m]
        la = [(tss0 + r.gauss(0.5) if m < 0 else
               tss0 - 6 * math.exp(-((m - 25) / 22.0) ** 2) + r.gauss(0.6)) for m in grid_m]
        tb_b = [(b0 + r.gauss(0.4) if m < 0 else
                 min(b0 + 12, b0 + 0.8 * m) + r.gauss(0.4) if m < 20 else
                 max(b0, b0 + 12 - 0.18 * (m - 20)) + r.gauss(0.4)) for m in grid_m]
        va_b = [(b0 + r.gauss(0.4) if m < 0 else min(b0 + 30, b0 + 0.8 * m) + r.gauss(0.4)) for m in grid_m]
        la_b = [(b0 + 3 * math.exp(-((m - 30) / 25.0) ** 2) + r.gauss(0.4)) for m in grid_m]
        live_tss = aligned(tss, s0, pack.step_min, grid_m, 'min')
        live_b = aligned(blanket, s0, pack.step_min, grid_m, 'min')
        live = f'{tr}, today'

        def pair(a, b):
            return [ref_chart('Primary TSS removal (min from the stop)', '%', [30, 70], grid_m, 'min', a,
                              live_tss, live, 0),
                    ref_chart('Sludge blanket', '%', [20, 70], grid_m, 'min', b, live_b, live, 0)]
        refs = [
            reference('trip', 'textbook', 'Textbook', 'Drive overload trip at peak flow, restarted by hand',
                      'Current climbs for a few minutes as heavy sludge builds under the flights, the overload device '
                      'lets go, and removal falls about a point a minute. An operator clears the obstruction and '
                      'restarts; removal is back inside half an hour. The follow-up is chain tension and shear-pin '
                      'condition before the next peak.',
                      'match', 'Closest match',
                      [f'Same drive current climb before the stop ({signed(overload_pct, 0)} %)',
                       f'Same fall and the same recovery after {dur(pack.minutes_between(s0, restart))}'
                       if restart is not None else 'Same fall'],
                      pair(tb, tb_b)),
            reference('outofservice', 'variant', 'What to avoid', 'Collector left out of service',
                      'The same trip, but nobody restarts it. The blanket keeps climbing, solids go over the weirs '
                      'for hours, and the day\'s TSS average is at risk. The aeration basin takes the whole primary '
                      'load.',
                      'nomatch', 'Avoided today',
                      [f'Stopped for {dur(stop_min)} here, not hours',
                       f'Blanket peaked at {num(blanket[hi], 0)} % and came back'],
                      pair(va, va_b)),
            reference('surge', 'lookalike', 'Look-alike', 'Hydraulic surge with the collector running',
                      'A wet-weather or pump-station surge shortens the detention time in every primary at once. '
                      'Removal dips a few points across the plant and recovers as the flow eases. The collector never '
                      'stops and the blanket barely moves.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here the collector current went to {num(cur[s0], 2)} A',
                       f'Here {tr} lost {num(tss0 - tss[lo], 0)} points while the other five lost at most '
                       f'{num(max(peer_drop.values()), 1)}'],
                      pair(la, la_b)),
        ]
        ro = [
            ruled_out('A hydraulic surge on its own', 'ruled out',
                      f'The other five primaries were on flows between the '
                      f'{ordinal(min(peer_flow_rise.values()))} and {ordinal(max(peer_flow_rise.values()))} '
                      f'percentile of their own day at the same moment and '
                      f'lost at most {num(max(peer_drop.values()), 1)} points of removal. '
                      f'{tr} lost {num(tss0 - tss[lo], 1)}.',
                      chart('%', yd, [series('tss', f'{tr}', tss, 'primary', 1)], decimals=0,
                            band=peer_envelope(pack, peers, 'primary_tss_removal_pct',
                                               'The other five trains', 1),
                            caption='Same peak, one train affected.', window=w1)),
            ruled_out('A weir, scum or skimmer problem', 'ruled out' if scum_flat else 'unlikely',
                      (f'Scum removal held {num(scum0, 1)} → {num(scum_lo, 1)} % through the event and the '
                       f'{pack.name(skim)} drew {num(min(skim_cur[s0:hi + 1]), 2)}–'
                       f'{num(max(skim_cur[s0:hi + 1]), 2)} A with no interruption.' if skim_cur else
                       f'Scum removal held {num(scum0, 1)} → {num(scum_lo, 1)} %.')),
            ruled_out('A TSS analyser fault', 'ruled out',
                      f'Three other instruments moved with it: the blanket level ({signed(blanket[hi] - b0, 1)} '
                      f'points by {ts[hi]}), primary BOD removal ({signed(bod_lo - bod0, 1)} points) and the '
                      f'collector\'s own motor current. A bad analyser moves alone.'),
            ruled_out('A solids loading change from upstream', 'ruled out',
                      f'{tr} influent flow was {num(flow[s0], 0)} gpm, inside the day\'s '
                      f'{num(min(flow), 0)}–{num(max(flow), 0)} gpm range, and removal was back to '
                      f'{num(tss[back], 1)} % within {dur(pack.minutes_between(s0, back))} of the restart with no '
                      f'change upstream.' if flow and back is not None else
                      'Influent flow stayed inside the day\'s range.'),
            ruled_out('Why the drive tripped — shear pin, chain or debris', 'not yet checked',
                      f'The drive\'s own fault code and a look at the chain tension will say which. The current '
                      f'climb to {num(cur_pre, 2)} A before the stop and {num(restart_cur, 2)} A on the restart point '
                      f'at mechanical load rather than an electrical fault.' if restart_cur else
                      'The drive\'s fault code will say which.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'The {tr} {cname} stopped under load at {ts[s0]}; the solids carryover, the '
                                     f'rising blanket and the extra load on aeration all followed from it',
                                     level,
                                     'Confirmed: removal came straight back when the flights moved again'
                                     if recovered else 'Stop and solids loss in the same interval'),
            'rootCauseAssetId': col,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                f'The collector stopped and TSS removal, the blanket level and BOD removal all moved with it, and '
                f'all three came back within {dur(pack.minutes_between(s0, back))} of the restart.'
                if recovered else
                'The collector stopped and the solids loss followed in the same interval.',
                None if recovered else 'The collector has not been restarted yet.',
                None if recovered else 'Removal recovers once the flights move again.',
                'Removal stays low with the collector running. Then look at the weirs, the flow split and the '
                'influent solids.',
                f'Restart at {ts[restart]} and recovery by {ts[back]}' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'primary_tss_removal_pct',
                      'formula': f'{num(tss0, 1)} %, the median over the {dur(p["pre_min"])} before the stop',
                      'fittedOn': 'this clarifier just before the stop; the other five trains as a cross-check on '
                                  'the flow'},
            'impact': f'{dur(pack.minutes_between(s0, back))} from stop to full recovery, with removal down to '
                      f'{num(tss[lo], 0)} % at the worst point — {num(tss0 - tss[lo], 0)} points of solids past the '
                      f'primary, during the day\'s peak flow. The blanket reached {num(blanket[hi], 0)} % and the '
                      f'aeration basin behind it saw F:M {signed(fm_rise, 3)}.'
                      if back is not None else 'Still carrying over.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. RAS rate out of balance with the load — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class RasLoadImbalance(Detector):
    id = 'wastewater.ras_load_imbalance'
    name = 'RAS rate not following the load — F:M drifting above target'
    archetype = '03 Quiet drift (control effort not following the load)'
    applies_to = 'aeration stages'
    summary = ('The food-to-microorganism ratio climbing past its target while the return activated sludge rate sits '
               'on one number, hour after hour, and the solids inventory it is supposed to hold up slides instead. '
               'The air flow rising at the same time says the load really did go up.')
    pipeline = [
        ('Drift', 'F:M above the target band and held there'),
        ('Control effort', 'RAS rate flat over the two hours F:M spent climbing, against the other five trains'),
        ('Independent load check', 'header air flow rising: the blowers can see the extra demand'),
        ('Inventory', 'MLSS not building while F:M rises — the return is not keeping up'),
        ('Response', 'what happened to F:M and MLSS when RAS was finally moved'),
        ('Conclusion', 'a control-setpoint miss, confirmed by the response → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'aeration'},
        'inputs': {'fm': 'self.food_to_microorganism_ratio', 'mlss': 'self.mlss_mg_l',
                   'do': 'self.dissolved_oxygen_mg_l', 'air': 'self.blower_air_flow_scfm',
                   'age': 'self.sludge_age_days',
                   'ras': 'sources[process_flow] of the child aeration_basin → the ras_pump, and its parent '
                          'secondary_clarifier: ras_rate_pct, sludge_settleability_svi',
                   'pump': 'that ras_pump: flow_rate_gpm, process_motor_current_a',
                   'flow': 'the train\'s influent pump: flow_rate_gpm',
                   'peers': 'the other aeration stages and their RAS loops',
                   'work': 'done INSPECTION on this stage (confidence only)'},
        'peers': {'same': 'assetType', 'count': 'the other five trains',
                  'use': 'show what a RAS rate that does follow the load looks like'},
        'expected': {'model': 'the design target band', 'target': 'food_to_microorganism_ratio',
                     'formula': 'conventional activated sludge: 0.20–0.32 d⁻¹',
                     'fitOn': 'RESEARCH.md design range; the other five trains as a cross-check'},
        'params': {'fm_high': 0.32, 'fm_low': 0.20, 'fm_sustain_min': 30, 'fm_rise': 0.040,
                   'drift_window_min': 120, 'ras_flat_sd_pct': 0.6, 'mlss_hold_mg_l': 150.0,
                   'air_rise_pct': 2.5, 'ras_step_pts': 4.0, 'pump_step_pct': 5.0, 'mlss_build_mg_l': 150.0,
                   'fm_recover_min': 60, 'do_floor_mg_l': 1.5, 'svi_band_mg': 130.0},
        'checks': [
            {'id': 'drift', 'role': 'required',
             'rule': 'F:M > fm_high for fm_sustain_min'},
            {'id': 'rise', 'role': 'required',
             'rule': 'F:M rose > fm_rise over the drift_window_min before the flag'},
            {'id': 'flat', 'role': 'required',
             'rule': 'stdev(RAS rate over the drift_window_min ending where F:M crossed fm_high) < '
                     'ras_flat_sd_pct — the two hours F:M spent climbing'},
            {'id': 'air', 'role': 'required', 'independent': True,
             'rule': 'header air flow up > air_rise_pct % from the F:M low point to the F:M peak'},
            {'id': 'inventory', 'role': 'supporting',
             'rule': 'MLSS at the F:M peak no more than mlss_hold_mg_l above where the climb started'},
            {'id': 'flow', 'role': 'supporting', 'independent': True,
             'rule': 'the train\'s influent flow up over the drift window'},
            {'id': 'aeration', 'role': 'supporting',
             'rule': 'DO stayed above do_floor_mg_l — not an air shortfall'},
            {'id': 'settling', 'role': 'supporting',
             'rule': 'the train\'s SVI below svi_band_mg — not a biology problem'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'the other five trains\' RAS rates move (sd ≥ ras_flat_sd_pct) and none of them holds F:M '
                     'above fm_high for fm_sustain_min'},
            {'id': 'response', 'role': 'supporting', 'independent': True,
             'rule': 'RAS stepped up ≥ ras_step_pts, pump flow up ≥ pump_step_pct %, MLSS built ≥ mlss_build_mg_l '
                     'and F:M back inside the band within fm_recover_min'},
        ],
        'ruleOut': ['an MLSS analyser error', 'a load spike with RAS tracking correctly', 'an air or DO shortfall',
                    'bulking sludge', 'wasting too hard'],
        'confidence': {'low': 'required checks only',
                       'medium': 'influent flow agrees with the air flow that the load rose',
                       'high': 'F:M and MLSS responded to the RAS change'},
        'references': ['textbook: manual RAS left behind a load ramp', 'variant: RAS pump losing capacity',
                       'look-alike: MLSS analyser drifting low'],
    }

    def candidates(self, pack):
        return pack.of_type('aeration')

    def _ctx(self, pack, aid):
        basin = pack.child_of_type(aid, 'aeration_basin')
        if basin is None:
            return None
        pump = next((s for s in pack.sources(basin, 'process_flow')
                     if pack.asset(s)['assetType'] == 'ras_pump'), None)
        if pump is None:
            return None
        clar = pack.parent(pump)
        if clar is None or not pack.has(clar, 'ras_rate_pct'):
            return None
        return dict(basin=basin, pump=pump, clar=clar,
                    fm=pack.series(aid, 'food_to_microorganism_ratio'),
                    mlss=pack.series(aid, 'mlss_mg_l'),
                    air=pack.series(aid, 'blower_air_flow_scfm'),
                    do=pack.series(aid, 'dissolved_oxygen_mg_l'),
                    ras=pack.series(clar, 'ras_rate_pct'))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        fm, mlss, ras = c['fm'], c['mlss'], c['ras']
        hi = B.gt(fm, p['fm_high'])
        dw = pack.steps(p['drift_window_min'])
        sds = rolling_sd(ras, dw)
        air = c['air']
        for i in range(pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['fm_sustain_min']:
                continue
            k0 = max(0, i - dw + 1)
            if fm[i] - min(fm[k0:i + 1]) < p['fm_rise']:
                continue
            # RAS flatness is measured over the two hours F:M spent climbing, which end where it
            # crossed the ceiling — not at the flag, by when a correction may already have moved RAS.
            if sds[s0] >= p['ras_flat_sd_pct']:
                continue
            onset = min(range(k0, i + 1), key=lambda k: fm[k])
            peak = max(range(onset, pack.n), key=lambda k: fm[k])
            rise_pct = pct(B.mean(air[max(0, peak - 6):peak + 1]), B.mean(air[max(0, onset - 6):onset + 1]))
            if rise_pct is None or rise_pct <= p['air_rise_pct']:
                continue
            c.update(onset=onset, drift_from=s0, ras_sd=sds[s0])
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tr = tname(pack, aid)
        pump, clar = c['pump'], c['clar']
        fm, mlss, air, do, ras = c['fm'], c['mlss'], c['air'], c['do'], c['ras']
        onset, drift_from = c['onset'], c['drift_from']
        dw = pack.steps(p['drift_window_min'])
        peak = max(range(onset, now + 1), key=lambda k: fm[k])

        # the RAS step, if it happened
        step_at = next((k for k in range(onset, now + 1)
                        if ras[k] - B.mean(ras[max(0, k - dw):k]) > p['ras_step_pts']), None)
        ras_pre = B.mean(ras[:step_at]) if step_at is not None else B.mean(ras)
        ras_post = B.mean(ras[step_at:]) if step_at is not None else None
        pflow = pack.series(pump, 'flow_rate_gpm')
        pcur = pack.series(pump, 'process_motor_current_a')
        pf_pre = B.mean(pflow[:step_at]) if step_at is not None else None
        pf_post = B.mean(pflow[step_at:]) if step_at is not None else None
        mlss_min = min(mlss[onset:now + 1])
        mlss_post = max(mlss[step_at:]) if step_at is not None else None
        fm_back = next((k for k in range(peak, now + 1) if fm[k] <= p['fm_high']), None)
        responded = (step_at is not None and ras_post - ras_pre > p['ras_step_pts']
                     and pct(pf_post, pf_pre) > p['pump_step_pct']
                     and mlss_post - mlss_min > p['mlss_build_mg_l']
                     and fm_back is not None
                     and pack.minutes_between(step_at, fm_back) <= p['fm_recover_min'])

        mlss_hold_ok = (B.mean(mlss[max(0, peak - 3):peak + 1])
                        - B.mean(mlss[max(0, onset - 3):onset + 1])) < p['mlss_hold_mg_l']
        air_pre = B.mean(air[max(0, onset - 6):onset + 1])
        air_peak = B.mean(air[max(0, peak - 6):peak + 1])
        air_pct = pct(air_peak, air_pre)
        air_ok = air_pct > p['air_rise_pct']

        prelim = next((x for x in pack.descendants(pack.unit_of(aid))
                       if pack.asset(x)['assetType'] == 'influent_pump'), None)
        flow = pack.series(prelim, 'flow_rate_gpm') if prelim else None
        fl_pre = B.mean(flow[max(0, onset - 6):onset + 1]) if flow else None
        fl_peak = B.mean(flow[max(0, peak - 6):peak + 1]) if flow else None
        fl_pct = pct(fl_peak, fl_pre) if flow else None
        flow_ok = fl_pct is not None and fl_pct > 0

        do_ok = min(do[onset:now + 1]) > p['do_floor_mg_l']
        svi = pack.series(clar, 'sludge_settleability_svi')
        svi_ok = max(svi) < p['svi_band_mg']

        peers = [a for a in self.candidates(pack) if a != aid]
        peer_sd, peer_fm, peer_clar = {}, {}, {}
        for a in peers:
            cc = self._ctx(pack, a)
            if cc is None:
                continue
            peer_sd[a] = min(rolling_sd(cc['ras'], dw)[dw - 1:])
            over = B.runs(B.gt(cc['fm'], p['fm_high']))
            peer_fm[a] = max([(b - x + 1) * pack.step_min for x, b in over] or [0])
            peer_clar[a] = cc['clar']
        peers_ok = (bool(peer_sd) and all(v >= p['ras_flat_sd_pct'] for v in peer_sd.values())
                    and all(v < p['fm_sustain_min'] for v in peer_fm.values()))

        age = pack.series(aid, 'sludge_age_days')
        level = 'high' if responded else ('medium' if flow_ok else 'low')
        w1 = win(pack, onset, now, 4)
        fd = nice_domain(fm, [p['fm_high'], p['fm_low']], pad=0.08)
        rd = nice_domain(ras, [25.0, 60.0], pad=0.05)
        band_lo = [p['fm_low']] * pack.n
        band_hi = [p['fm_high']] * pack.n

        checks = [
            check('drift', f'F:M above the {num(p["fm_high"], 2)} target ceiling and holding', 'required', MATCH,
                  f'{num(fm[onset], 3)} at {ts[onset]} climbing to {num(fm[peak], 3)} at {ts[peak]}; above '
                  f'{num(p["fm_high"], 2)} from {ts[drift_from]}. Flagged at {ts[i]}, after '
                  f'{dur(p["fm_sustain_min"])} over the ceiling.',
                  f'Conventional activated sludge runs at an F:M of about {num(p["fm_low"], 2)}–'
                  f'{num(p["fm_high"], 2)} d⁻¹. Above that the bugs are overfed: settling gets worse and effluent BOD '
                  f'follows.',
                  spark(fm, fd, band_lo, band_hi, threshold_value=p['fm_high'],
                        highlight=[ts[drift_from], ts[peak]], window=w1)),
            check('rise', 'A steady climb, not a blip', 'required', MATCH,
                  f'{signed(fm[peak] - fm[onset], 3)} over {dur(pack.minutes_between(onset, peak))}, from the low '
                  f'point at {ts[onset]}. Flag level is +{num(p["fm_rise"], 3)} over '
                  f'{dur(p["drift_window_min"])}.',
                  'F:M is organic load divided by the solids holding it. A steady rise means one of the two moved and '
                  'stayed moved.',
                  spark(fm, fd, highlight=[ts[onset], ts[peak]], window=w1)),
            check('flat', 'RAS rate sat on one number the whole time', 'required', MATCH,
                  f'{num(B.mean(ras[onset:(step_at or now)]), 1)} % with a standard deviation of '
                  f'{num(c["ras_sd"], 2)} points over the {dur(p["drift_window_min"])} F:M spent climbing, against '
                  f'{num(min(peer_sd.values()), 2)}–{num(max(peer_sd.values()), 2)} points on the other five '
                  f'trains\' quietest two hours.',
                  'RAS is the operator\'s handle on the solids inventory. A rate this steady is a manual setpoint '
                  'nobody moved, not a controller following the load.',
                  spark(ras, rd, highlight=[ts[onset], ts[(step_at or now)]], window=w1)),
            check('air', 'The blowers could see the extra load', 'required', MATCH,
                  f'Header air {num(air_pre, 0)} → {num(air_peak, 0)} scfm ({signed(air_pct, 1)} %) over the same '
                  f'hours, on a DO controller that was holding its setpoint.',
                  'An independent read on the load: oxygen demand goes with organic load, so a DO controller that has '
                  'to push more air is telling us the load really did rise. It is not an F:M calculation artefact.',
                  spark(air, nice_domain(air), window=w1)),
            check('inventory', 'Solids inventory never built to meet the load', 'supporting',
                  MATCH if mlss_hold_ok else NO_MATCH,
                  f'MLSS {num(B.mean(mlss[max(0, onset - 3):onset + 1]), 0)} mg/L when the climb started against '
                  f'{num(B.mean(mlss[max(0, peak - 3):peak + 1]), 0)} mg/L at the F:M peak, bottoming at '
                  f'{num(mlss_min, 0)} mg/L. Holding F:M would have needed it to build.',
                  'Holding F:M steady under a rising load means returning more solids. With RAS fixed, the inventory '
                  'drifts the wrong way and F:M rises twice as fast — numerator up, denominator down.',
                  spark(mlss, nice_domain(mlss), window=w1)),
            check('flow', 'Incoming flow rose with it', 'supporting', MATCH if flow_ok else NO_MATCH,
                  (f'{tr} influent {num(fl_pre, 0)} → {num(fl_peak, 0)} gpm ({signed(fl_pct, 1)} %) over the drift.'
                   if flow else 'No influent flow signal found for this train.'),
                  'A third measurement on the load side, upstream of everything else. More flow at the same strength '
                  'is more load into the basin.',
                  spark(flow, nice_domain(flow), window=w1) if flow else None),
            check('aeration', 'Not an air or DO problem', 'supporting', MATCH if do_ok else NO_MATCH,
                  f'DO held {num(min(do[onset:now + 1]), 2)}–{num(max(do[onset:now + 1]), 2)} mg/L right through, '
                  f'above the {num(p["do_floor_mg_l"], 1)} mg/L floor.',
                  'If aeration had been the problem, DO would have fallen as the load rose. It did not: the air side '
                  'kept up. What did not keep up was the sludge return.',
                  spark(do, nice_domain(do, [p['do_floor_mg_l']], floor=0.0),
                        threshold_value=p['do_floor_mg_l'], window=w1)),
            check('settling', 'Not a settling or bulking problem', 'supporting', MATCH if svi_ok else NO_MATCH,
                  f'{tr} SVI {num(min(svi), 0)}–{num(max(svi), 0)} mL/g all shift, below the '
                  f'{num(p["svi_band_mg"], 0)} mL/g watch level.',
                  'Bulking sludge would also raise F:M, by losing solids over the weirs. Settleability never moved '
                  'here, so the solids are in the system — just not being returned fast enough.',
                  spark(svi, nice_domain(svi, [p['svi_band_mg']]), threshold_value=p['svi_band_mg'])),
            check('peers', 'The other five trains kept RAS moving', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'{trains_of(pack, list(peer_sd))}: RAS standard deviation {num(min(peer_sd.values()), 2)}–'
                  f'{num(max(peer_sd.values()), 2)} points over two hours, and none of them held F:M above '
                  f'{num(p["fm_high"], 2)} for more than {dur(max(peer_fm.values()))} '
                  f'(flag level {dur(p["fm_sustain_min"])}).',
                  'Same influent, same diurnal curve, same rising load. The five trains whose RAS followed the load '
                  'never left the F:M band. That is the comparison that makes this a control miss.',
                  spark(pack.series(peer_clar[max(peer_sd, key=lambda a: peer_sd[a])], 'ras_rate_pct'), rd)
                  if peer_sd else None),
            check('response', 'F:M and MLSS answered the RAS change', 'supporting',
                  MATCH if responded else PENDING,
                  (f'RAS {num(ras_pre, 1)} → {num(ras_post, 1)} % at {ts[step_at]}; RAS pump flow '
                   f'{num(pf_pre, 0)} → {num(pf_post, 0)} gpm ({signed(pct(pf_post, pf_pre), 0)} %) and motor '
                   f'current {num(B.mean(pcur[:step_at]), 1)} → {num(B.mean(pcur[step_at:]), 1)} A; MLSS built '
                   f'{num(mlss_min, 0)} → {num(mlss_post, 0)} mg/L and F:M was back under '
                   f'{num(p["fm_high"], 2)} by {ts[fm_back]} '
                   f'({dur(pack.minutes_between(step_at, fm_back))} after the change).'
                   if responded else 'RAS has not been changed yet.'),
                  'The test of the whole explanation: move the one input the detector blames and the output has to '
                  'follow. It did, on four instruments — RAS rate, pump flow, pump current and MLSS.',
                  spark(fm, fd, threshold_value=p['fm_high'],
                        highlight=[ts[step_at], ts[fm_back]] if responded else None, window=w1)),
        ]
        main = chart('', fd,
                     [series('fm', f'{tr} F:M ratio', fm, 'primary', 3),
                      series('ras', f'{tr} RAS rate ÷ 100', [v / 100.0 for v in ras], 'secondary', 3)],
                     title='What we see',
                     caption=f'{tr}\'s F:M ratio against its RAS rate (shown ÷ 100 to share the axis). The load rose '
                             f'from {ts[onset]}; RAS did not move until {ts[step_at]}, and F:M came back inside the '
                             f'band within {dur(pack.minutes_between(step_at, fm_back))}.'
                             if responded else
                             f'{tr}\'s F:M ratio against its RAS rate (shown ÷ 100 to share the axis).',
                     band=_band('Target F:M band', band_lo, band_hi, 3), decimals=3,
                     thresholds=[threshold(p['fm_high'], 'Target ceiling')],
                     markers=[marker(ts[onset], 'Load starts rising'), marker(ts[i], 'Flagged')]
                     + ([marker(ts[step_at], 'RAS raised')] if step_at is not None else []), window=w1)

        grid_h = hours_grid(5.0, 0.25)
        r = Rng(7013)
        f0 = fm[onset]
        tb = [f0 + 0.075 * min(1.0, hh / 3.0) + r.gauss(0.004) for hh in grid_h]
        tb_r = [ras_pre + r.gauss(0.2) for _ in grid_h]
        va = [f0 + 0.055 * min(1.0, hh / 3.0) + r.gauss(0.004) for hh in grid_h]
        va_r = [ras_pre + 7 * min(1.0, hh / 1.5) - 9 * max(0.0, min(1.0, (hh - 1.5) / 2.5)) + r.gauss(0.3)
                for hh in grid_h]
        la = [f0 + 0.07 * min(1.0, hh / 2.0) + r.gauss(0.004) for hh in grid_h]
        la_r = [ras_pre + r.gauss(0.2) for _ in grid_h]
        live_fm = aligned(fm, onset, pack.step_min, grid_h)
        live_ras = aligned(ras, onset, pack.step_min, grid_h)
        live = f'{tr}, today'

        def pair(a, b):
            return [ref_chart('F:M ratio (h from the load rise)', '', [0.20, 0.42], grid_h, 'h', a, live_fm, live, 3,
                              [threshold(p['fm_high'], 'Ceiling')]),
                    ref_chart('RAS rate', '%', [30, 60], grid_h, 'h', b, live_ras, live, 0)]
        refs = [
            reference('manual', 'textbook', 'Textbook', 'Manual RAS setpoint left behind a load ramp',
                      'The diurnal load climbs through the morning, RAS stays where the night shift left it, and F:M '
                      'walks out of the band while MLSS thins. Raising RAS brings both back within the hour. The '
                      'lasting fix is flow-pacing RAS off the influent signal.',
                      'match', 'Closest match',
                      [f'Same flat RAS ({num(c["ras_sd"], 2)} points of standard deviation here)',
                       'Same MLSS sliding while F:M rose',
                       f'Same quick answer to the RAS change ({dur(pack.minutes_between(step_at, fm_back))})'
                       if responded else 'Waiting on the RAS change'],
                      pair(tb, tb_r)),
            reference('pump', 'variant', 'Variant', 'RAS pump losing capacity',
                      'The setpoint is being chased, but the pump cannot make it: the rate command moves while actual '
                      'flow and motor current do not, and F:M drifts anyway. A worn impeller or a partly blocked '
                      'suction. The giveaway is a RAS rate that moves without the flow following.',
                      'nomatch', 'Doesn\'t match',
                      ['Here RAS never moved at all until it was raised by hand',
                       f'Here pump flow followed the change ({signed(pct(pf_post, pf_pre), 0)} %)'
                       if responded else 'Here the pump has not been asked for more yet'],
                      pair(va, va_r)),
            reference('mlss', 'lookalike', 'Look-alike', 'MLSS analyser drifting low',
                      'F:M is calculated from MLSS, so an analyser reading low invents an F:M rise out of nothing. '
                      'Air flow and influent flow stay flat, and a lab MLSS disagrees with the online reading.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here header air rose {signed(air_pct, 1)} % — the load was real',
                       f'Here MLSS answered the RAS change ({signed(mlss_post - mlss_min, 0)} mg/L)'
                       if responded else 'Here influent flow rose with it'],
                      pair(la, la_r)),
        ]
        ro = [
            ruled_out('An MLSS analyser error', 'ruled out',
                      f'Two independent load signals rose with the F:M: header air {signed(air_pct, 1)} % and '
                      f'{tr} influent flow {signed(fl_pct, 1)} %. And MLSS built '
                      f'{signed(mlss_post - mlss_min, 0)} mg/L the moment RAS was raised, which a drifting analyser '
                      f'would not do.' if responded else
                      f'Header air rose {signed(air_pct, 1)} % with the F:M, so the load was real.'),
            ruled_out('A load spike with RAS tracking it correctly', 'ruled out',
                      f'RAS held {num(B.mean(ras[onset:(step_at or now)]), 1)} % with {num(c["ras_sd"], 2)} points of '
                      f'standard deviation over two hours while the other five trains moved '
                      f'{num(min(peer_sd.values()), 2)}–{num(max(peer_sd.values()), 2)} points and none of them '
                      f'held F:M over the ceiling for more than {dur(max(peer_fm.values()))}.'),
            ruled_out('An air or DO shortfall', 'ruled out' if do_ok else 'unlikely',
                      f'DO never went below {num(min(do[onset:now + 1]), 2)} mg/L and the header air rose to meet the '
                      f'demand. The air side was the part that worked.'),
            ruled_out('Bulking sludge losing solids over the weirs', 'ruled out' if svi_ok else 'unlikely',
                      f'{tr} SVI {num(min(svi), 0)}–{num(max(svi), 0)} mL/g, below the '
                      f'{num(p["svi_band_mg"], 0)} mL/g watch level, and clarifier torque gave no sign of a deep '
                      f'blanket.'),
            ruled_out('Wasting too hard (WAS set too high)', 'unlikely',
                      f'Sludge age held {num(min(age), 1)}–{num(max(age), 1)} days, inside the conventional 5–15 day '
                      f'range, so the inventory was not being thrown away. WAS flow itself is not instrumented in '
                      f'this model — the sludge-age trend is the proxy.'),
            ruled_out('Why the setpoint was left behind', 'not yet checked',
                      'Whether RAS is on a manual setpoint by design or an auto flow-pacing loop failed is not in the '
                      'data. The RAS rate review on the work list is where that answer comes from.'),
        ]
        return {
            'conclusion': conclusion('Cause' if responded else 'Most likely cause',
                                     f'{tr}\'s RAS rate was left on {num(ras_pre, 1)} % while the incoming load rose, '
                                     f'so F:M climbed to {num(fm[peak], 3)} and the solids inventory thinned',
                                     level,
                                     'Confirmed: F:M and MLSS answered the RAS change' if responded else
                                     'Load rose on three instruments while RAS held still'),
            'rootCauseAssetId': clar,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                f'Three independent instruments say the load rose (F:M, header air, influent flow), the RAS rate was '
                f'measurably flat against five trains that were not, and F:M and MLSS both answered within '
                f'{dur(pack.minutes_between(step_at, fm_back))} of the RAS change.' if responded else
                'The load rose on independent instruments while the RAS rate held still.',
                None if responded else 'RAS has not been moved yet, so the explanation has not been tested.',
                None if responded else 'F:M falls back inside the band when RAS is raised.',
                'F:M stays high after RAS is raised. Then suspect the RAS pump\'s delivery, or a lab MLSS that '
                'disagrees with the online analyser.',
                f'F:M back under {num(p["fm_high"], 2)} within {dur(pack.minutes_between(step_at, fm_back))} of the '
                f'RAS change' if responded else None),
            'action': action(item, pack),
            'model': {'target': 'food_to_microorganism_ratio',
                      'formula': f'design band {num(p["fm_low"], 2)}–{num(p["fm_high"], 2)} d⁻¹ for conventional '
                                 f'activated sludge',
                      'fittedOn': 'RESEARCH.md design ranges; the other five trains confirm the band is reachable '
                                  'today'},
            'impact': f'{dur(pack.minutes_between(drift_from, fm_back))} above the F:M ceiling, peaking at '
                      f'{num(fm[peak], 3)}, with MLSS {num(mlss_min, 0)} mg/L at its thinnest. Sustained, that is '
                      f'where poor settling and effluent BOD start; it was caught before the SVI moved.'
                      if responded else
                      f'Above the F:M ceiling since {ts[drift_from]}, peaking at {num(fm[peak], 3)}.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Effluent margin before the DMR deadline — archetype 14
# ═════════════════════════════════════════════════════════════════════════
class EffluentMarginBeforeDmr(Detector):
    id = 'wastewater.effluent_margin_before_dmr'
    name = 'Effluent quality borderline with the DMR deadline close'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'disinfection stages'
    summary = ('The fecal coliform risk index on one train sitting well above where it started the shift and inside '
               'the top quarter of its permit margin, with the chlorine residual and CT both nominal. Healthy '
               'equipment, a number that has to be reported, and a filing deadline — a decision with a clock on it, '
               'not a fault.')
    pipeline = [
        ('The hour that gets reported', 'the half-hour average of the risk index now, and the worst sample in the '
                                        'last hour, against the permit limit'),
        ('Margin', 'how much room is left — this is margin, not an exceedance'),
        ('Hydraulic driver', 'this train\'s share of the plant\'s flow over the last hour: more flow, less '
                             'contact time'),
        ('Disinfection healthy', 'chlorine residual in band and CT close to its own baseline'),
        ('Physics', 'risk goes as (CT₀/CT)², so how much of the rise does the shorter contact time explain?'),
        ('Clock', 'the open DMR task\'s due time against the work it needs, and the projection to the limit'),
        ('Conclusion', 'a reporting decision with a deadline, not a diagnosis'),
    ]
    definition = {
        'appliesTo': {'assetType': 'disinfection'},
        'inputs': {'risk': 'self.effluent_fecal_coliform_risk', 'residual': 'self.chlorine_residual_mg_l',
                   'ct': 'self.ct_value_actual', 'dechlor': 'self.dechlorination_residual_mg_l',
                   'contact': 'child chlorine_contact_basin: residence_time_min, level_pct',
                   'throughput': 'the train\'s line_throughput, as a share of all six trains\' total',
                   'peers': 'the other disinfection stages: effluent_fecal_coliform_risk, ct_value_actual',
                   'work': 'open DOCUMENTATION work item on this stage (the deadline; supporting only)'},
        'peers': {'same': 'assetType', 'count': 'the other five trains',
                  'use': 'show that the rise is this train\'s own, not a plant-wide shift'},
        'expected': {'model': 'CT physics, no fitted coefficients', 'target': 'effluent_fecal_coliform_risk',
                     'formula': 'risk₀ × (CT₀ / CT)^ct_exponent',
                     'fitOn': 'this stage\'s own first baseline_min (risk₀, CT₀)'},
        'params': {'risk_limit': 20.0, 'rise': 2.0, 'watch': 1.5, 'smooth_min': 30, 'assess_min': 60,
                   'margin_pct': 40.0, 'baseline_min': 180, 'flow_window_min': 60, 'share_rise_pct': 1.5,
                   'residual_lo_mg_l': 0.5, 'residual_hi_mg_l': 1.0, 'ct_band_pct': 15.0, 'ct_exponent': 2.0,
                   'unexplained': 0.8, 'flat_slope': 3.0, 'report_min': 40, 'dechlor_max_mg_l': 0.15,
                   'peer_share_margin_pct': 1.0},
        'checks': [
            {'id': 'inside', 'role': 'required',
             'rule': 'every sample in the last assess_min < risk_limit, and risk_limit − mean(risk over '
                     'smooth_min) < margin_pct % of risk_limit'},
            {'id': 'load', 'role': 'required', 'independent': True,
             'rule': 'this train\'s share of the six trains\' throughput over the last flow_window_min is up > '
                     'share_rise_pct % on the rest of the shift'},
            {'id': 'healthy', 'role': 'required',
             'rule': 'mean chlorine residual over the last assess_min inside residual_lo_mg_l–residual_hi_mg_l and '
                     'mean CT within ct_band_pct % of its own baseline'},
            {'id': 'elevated', 'role': 'supporting',
             'rule': 'mean(risk over smooth_min) ≥ median(first baseline_min) + rise, and how long that average has '
                     'been above +watch'},
            {'id': 'physics', 'role': 'supporting', 'independent': True,
             'rule': 'risk − risk₀ × (CT₀/CT)^ct_exponent > unexplained — part of the rise is not contact time'},
            {'id': 'flat', 'role': 'supporting',
             'rule': '|slope(risk, last hour)| < flat_slope — borderline, not running away'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'this train\'s flow-share rise exceeds every other train\'s by peer_share_margin_pct'},
            {'id': 'dechlor', 'role': 'supporting', 'independent': True,
             'rule': 'dechlorination residual below dechlor_max_mg_l — the discharge end is in order'},
            {'id': 'clock', 'role': 'supporting',
             'rule': 'minutes to the open DMR task\'s due time against report_min of work'},
        ],
        'ruleOut': ['lost disinfection (feed pump, residual or CT)', 'an overfeed being masked by dechlorination',
                    'a plant-wide effluent shift', 'an analyser fault', 'where the extra load came from'],
        'confidence': {'n/a': 'a margin and a deadline, read off the instruments — not a diagnosis'},
    }

    def candidates(self, pack):
        return pack.of_type('disinfection')

    def _ctx(self, pack, aid):
        p = self.p
        nb = pack.steps(p['baseline_min'])
        basin = pack.child_of_type(aid, 'chlorine_contact_basin')
        risk = pack.series(aid, 'effluent_fecal_coliform_risk')
        ct = pack.series(aid, 'ct_value_actual')
        res = pack.series(aid, 'chlorine_residual_mg_l')
        r0, ct0 = median(risk[:nb]), median(ct[:nb])
        pred = [r0 * (ct0 / v) ** p['ct_exponent'] for v in ct]
        st = pack.steps(p['smooth_min'])
        unit = pack.unit_of(aid)
        share = None
        if unit is not None and pack.has(unit, 'line_throughput'):
            trains = [u for u in pack.of_type('train') if pack.has(u, 'line_throughput')]
            tot = [sum(pack.series(u, 'line_throughput')[k] for u in trains) for k in range(pack.n)]
            own = pack.series(unit, 'line_throughput')
            share = [100.0 * a / b for a, b in zip(own, tot)]
        return dict(basin=basin, risk=risk, ct=ct, res=res, r0=r0, ct0=ct0, pred=pred, share=share,
                    rm=B.rolling_mean(risk, st),
                    rr=B.rolling_mean([a - b for a, b in zip(risk, pred)], st))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c['share'] is None:
            return Finding(aid, False)
        now, rm = pack.now, c['rm']
        aw, fw = pack.steps(p['assess_min']), pack.steps(p['flow_window_min'])
        lim = p['risk_limit']

        def ok(i):
            """Is the number this stage would report, as of point i, inside the limit but short of margin,
            on healthy disinfection and a rising share of the plant's flow?"""
            if i < max(aw, fw):
                return False
            seg = range(i - aw + 1, i + 1)
            if rm[i] is None or max(c['risk'][k] for k in seg) >= lim:
                return False
            if (lim - rm[i]) >= lim * p['margin_pct'] / 100.0:
                return False
            sh = pct(B.mean(c['share'][i - fw + 1:i + 1]), B.mean(c['share'][:i - fw + 1]))
            if sh is None or sh <= p['share_rise_pct']:
                return False
            if not (p['residual_lo_mg_l'] <= B.mean([c['res'][k] for k in seg]) <= p['residual_hi_mg_l']):
                return False
            return abs(pct(B.mean([c['ct'][k] for k in seg]), c['ct0'])) <= p['ct_band_pct']

        # A margin-before-a-deadline detector asks about the number about to be reported, so the
        # condition has to hold now; the raise time is where the current run of it started.
        if not ok(now):
            return Finding(aid, False)
        fired = now
        while fired > 0 and ok(fired - 1):
            fired -= 1
        share_pct = pct(B.mean(c['share'][-fw:]), B.mean(c['share'][:pack.n - fw]))
        hi = [v is not None and v >= c['r0'] + p['watch'] for v in rm]
        s0 = B.sustained_since(hi, now)
        c.update(elev_from=s0 if s0 is not None else fired, share_pct=share_pct, assess_from=now - aw + 1)
        return Finding(aid, True, fired, **c)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tr = tname(pack, aid)
        risk, ct, res, r0, ct0, pred = c['risk'], c['ct'], c['res'], c['r0'], c['ct0'], c['pred']
        rm, rr, share = c['rm'], c['rr'], c['share']
        elev = c['elev_from']
        basin = c['basin']
        peak = max(range(elev, now + 1), key=lambda k: risk[k])
        margin = p['risk_limit'] - rm[now]
        margin_peak = p['risk_limit'] - risk[peak]
        seg = range(c['assess_from'], now + 1)
        res_mean = B.mean([res[k] for k in seg])
        ct_mean = B.mean([ct[k] for k in seg])
        ct_mean_pct = pct(ct_mean, ct0)
        fw = pack.steps(p['flow_window_min'])
        share_pct = c['share_pct']
        slope_1h = B.slope_per_hour(risk, now, pack.steps(60), pack.step_min)
        slope_all = B.slope_per_hour(risk, now, pack.steps(2 * p['assess_min']), pack.step_min)

        explained = pred[peak] - r0
        unexplained = risk[peak] - pred[peak]
        phys_ok = rr[now] > p['unexplained']
        ct_pct = pct(ct[peak], ct0)
        flat_ok = abs(slope_1h) < p['flat_slope']

        rt = pack.series(basin, 'residence_time_min') if basin else None
        rt0 = median(rt[:pack.steps(p['baseline_min'])]) if rt else None
        rt_pct = pct(B.mean(rt[-fw:]), rt0) if rt else None
        unit = pack.unit_of(aid)
        thr = pack.series(unit, 'line_throughput') if pack.has(unit, 'line_throughput') else None
        thr_pct = pct(B.mean(thr[-fw:]), B.mean(thr[:pack.n - fw])) if thr else None

        peers = [a for a in self.candidates(pack) if a != aid]
        peer_drift, peer_share = {}, {}
        for a in peers:
            cc = self._ctx(pack, a)
            peer_drift[a] = B.mean([cc['risk'][k] for k in seg]) - cc['r0']
            peer_share[a] = pct(B.mean(cc['share'][-fw:]), B.mean(cc['share'][:pack.n - fw]))
        peers_ok = share_pct > max(peer_share.values()) + p['peer_share_margin_pct']
        worst_peer = max(peers, key=lambda a: peer_drift[a])

        dech = pack.series(aid, 'dechlorination_residual_mg_l')
        dech_ok = max(dech) < p['dechlor_max_mg_l']

        tasks = open_work(pack, [aid], ['DOCUMENTATION']) or open_work(pack, [aid])
        task = tasks[0] if tasks else None
        due_min = None
        if task and task.get('dueAt'):
            due_min = int(task['dueAt'][11:13]) * 60 + int(task['dueAt'][14:16])
        t_now = tmin(pack, now)
        left = (due_min - t_now) if due_min is not None else None
        need = (task.get('estimatedDurationMinutes') or p['report_min']) if task else p['report_min']
        slack = (left - need) if left is not None else None
        clock_ok = left is not None and left >= need
        to_limit = (p['risk_limit'] - rm[now]) / slope_1h if slope_1h and slope_1h > 0 else None

        yd = nice_domain(risk, [r0, p['risk_limit']], pad=0.05, floor=0.0)
        w1 = [ts[0], ts[now]]

        checks = [
            check('inside', f'Still inside the limit, with {num(margin, 1)} of margin', 'required', MATCH,
                  f'Worst sample in the last {dur(p["assess_min"])} {num(max(risk[k] for k in seg), 1)} against a '
                  f'limit of {num(p["risk_limit"], 0)}; the day\'s peak was {num(risk[peak], 1)} at {ts[peak]} '
                  f'({num(margin_peak, 1)} of margin). {num(margin, 1)} '
                  f'({num(100 * margin / p["risk_limit"], 0)} % of the limit) left on the half-hour average now.',
                  f'Nothing is out of compliance. The flag is that the margin has gone under '
                  f'{num(p["margin_pct"], 0)} % of the limit, which is where a single bad grab sample stops being '
                  f'academic.',
                  spark(risk, yd, threshold_value=p['risk_limit'], window=w1)),
            check('load', 'This train is taking more of the plant\'s flow', 'required', MATCH,
                  f'{tr}\'s share of the six trains\' throughput {signed(share_pct, 1)} % over the last '
                  f'{dur(p["flow_window_min"])} against the rest of the shift, while '
                  f'{trains_of(pack, peers)} moved {signed(min(peer_share.values()), 1)} to '
                  f'{signed(max(peer_share.values()), 1)} %'
                  + (f'. Contact time {signed(rt_pct, 1)} % on {signed(thr_pct, 1)} % more treated flow.'
                     if rt and thr else '.'),
                  'Comparing shares removes the plant-wide diurnal curve: the rest of the plant is coming off its '
                  'morning peak and this train is not. More flow through the same contact basin is less contact '
                  'time, and that is the mechanism behind the number.',
                  spark(share, nice_domain(share), window=w1)),
            check('healthy', 'Disinfection itself is in order', 'required', MATCH,
                  f'Chlorine residual averaging {num(res_mean, 2)} mg/L over the last {dur(p["assess_min"])} (range '
                  f'{num(min(res[k] for k in seg), 2)}–{num(max(res[k] for k in seg), 2)}), inside the '
                  f'{num(p["residual_lo_mg_l"], 1)}–{num(p["residual_hi_mg_l"], 1)} mg/L band; CT averaging '
                  f'{num(ct_mean, 1)} against a baseline of {num(ct0, 1)} ({signed(ct_mean_pct, 1)} %), inside the '
                  f'{num(p["ct_band_pct"], 0)} % band.',
                  'This separates a compliance item from a fault. The feed pump is holding its residual and the '
                  'contact basin is giving its CT; the equipment is doing its job.',
                  spark(res, nice_domain(res, [p['residual_lo_mg_l'], p['residual_hi_mg_l']]),
                        [p['residual_lo_mg_l']] * pack.n, [p['residual_hi_mg_l']] * pack.n, window=w1)),
            check('elevated', 'Running above where the shift started', 'supporting',
                  MATCH if rm[now] - r0 >= p['rise'] else NO_MATCH,
                  f'{num(r0, 1)} over the first {dur(p["baseline_min"])} against {num(rm[now], 1)} on the last '
                  f'{dur(p["smooth_min"])} ({signed(rm[now] - r0, 1)}), peaking at {num(risk[peak], 1)} at '
                  f'{ts[peak]}. The half-hour average has been above {num(r0 + p["watch"], 1)} since {ts[elev]} '
                  f'({dur(pack.minutes_between(elev, now))}).',
                  'The absolute level is each train\'s own; a step up against this stage\'s own morning is what '
                  'makes today\'s sample worth watching. Reading the half-hour average keeps single noisy samples '
                  'out of it.',
                  spark(rm, yd, [r0 + p['watch']] * pack.n, [r0 + p['watch']] * pack.n,
                        highlight=[ts[elev], ts[now]], window=w1)),
            check('physics', 'Shorter contact explains part of it, not all', 'supporting',
                  MATCH if phys_ok else NO_MATCH,
                  f'Risk goes as (CT₀/CT)². CT was {signed(ct_pct, 1)} % at {ts[peak]}, which accounts for '
                  f'{signed(explained, 1)} of the {signed(risk[peak] - r0, 1)} rise at that point; '
                  f'{num(unexplained, 1)} is left over, and the half-hour average of the leftover is '
                  f'{signed(rr[now], 1)} now against a flag level of {num(p["unexplained"], 1)}.',
                  'A physics model with nothing fitted: CT is residual × contact time, and disinfection kill goes as '
                  'the square of CT. The part the arithmetic cannot explain is solids and load carried through from '
                  'upstream, shielding organisms from the chlorine.',
                  spark(rr, nice_domain(rr, [0.0]), threshold_value=p['unexplained'], window=w1)),
            check('flat', 'Borderline, not running away', 'supporting', MATCH if flat_ok else NO_MATCH,
                  f'{signed(slope_1h, 1)} per hour over the last hour, {signed(slope_all, 1)} per hour over the last '
                  f'{dur(2 * p["assess_min"])}. Flag level for "stable" is under {num(p["flat_slope"], 0)} per '
                  f'hour.',
                  'This is what makes it a reporting decision rather than a developing failure: the index stepped up '
                  'and then sat there. A failure would keep climbing.',
                  spark(risk, yd, highlight=[ts[max(0, now - pack.steps(60))], ts[now]], window=w1)),
            check('peers', 'It is this train\'s own, not the whole plant', 'supporting',
                  MATCH if peers_ok else NO_MATCH,
                  f'{tr}\'s flow share is {signed(share_pct, 1)} % against '
                  f'{signed(max(peer_share.values()), 1)} % for the next-highest train, and it is '
                  f'{signed(rm[now] - r0, 1)} off its own baseline against '
                  f'{signed(peer_drift[worst_peer], 1)} for {tname(pack, worst_peer)}, the nearest of the other '
                  f'five (range {signed(min(peer_drift.values()), 1)} to {signed(max(peer_drift.values()), 1)}).',
                  'All six trains discharge the same day\'s effluent. A plant-wide shift would be a different '
                  'conversation with the regulator; one train is a sampling and reporting question. The flow share '
                  'is the cleaner comparison — the risk index wanders by a point or two on its own.',
                  spark(pack.series(worst_peer, 'effluent_fecal_coliform_risk'), yd, window=w1)),
            check('dechlor', 'Discharge end in order', 'supporting', MATCH if dech_ok else NO_MATCH,
                  f'Dechlorinated residual {num(min(dech), 3)}–{num(max(dech), 3)} mg/L, under '
                  f'{num(p["dechlor_max_mg_l"], 2)} mg/L all shift.',
                  'A separate instrument at the end of the line. The bisulfite is doing its job, so the coliform '
                  'number is not an artefact of chlorine still being in the sample.',
                  spark(dech, nice_domain(dech, [0.0, p['dechlor_max_mg_l']], floor=0.0),
                        threshold_value=p['dechlor_max_mg_l'])),
            check('clock', (f'{dur(left)} to the filing deadline, about {dur(need)} of work'
                            if left is not None else 'No filing deadline found'), 'supporting',
                  MATCH if clock_ok else NO_MATCH,
                  (f'"{task["text"]}" due {task["dueAt"][11:16]}, not done; {dur(need)} of work with '
                   f'{dur(slack)} of slack. The final effluent sample has to be pulled before that.'
                   if task and left is not None else 'No open reporting task on this stage.'),
                  'The deadline is not the binding constraint today — the number that goes on the form is. Once the '
                  'sample is taken the reported value is fixed, so the sample timing matters more than the filing '
                  'time.',
                  None),
        ]
        main = chart('', yd,
                     [series('risk', f'{tr} effluent fecal coliform risk', risk, 'primary', 1),
                      series('pred', 'What CT alone predicts', pred, 'expected', 1)],
                     band=peer_envelope(pack, peers, 'effluent_fecal_coliform_risk',
                                        'The other five trains', 1),
                     title='What we see',
                     caption=f'{tr}\'s fecal coliform risk index against what the (CT₀/CT)² relationship alone would '
                             f'predict, and the other five trains. The gap is the part shorter contact time does not '
                             f'explain.',
                     shade_gap=['risk', 'pred'], decimals=1,
                     thresholds=[threshold(p['risk_limit'], 'Permit limit'),
                                 threshold(r0 + p['rise'], 'Watch level')],
                     markers=[marker(ts[elev], 'Half-hour average steps up'), marker(ts[i], 'Flagged'),
                              marker(ts[peak], f'Highest, {num(margin_peak, 1)} under the limit')], window=w1)

        grid_m = minutes_grid(-60, 240, 15)
        r = Rng(8221)
        tb = [(r0 + r.gauss(0.4) if m < 0 else
               min(r0 + 4.6, r0 + 0.08 * m) + r.gauss(0.5)) for m in grid_m]
        va = [(r0 + r.gauss(0.4) if m < 0 else r0 + 0.055 * m + r.gauss(0.5)) for m in grid_m]
        la = [(r0 + r.gauss(0.4) if m < 0 else min(r0 + 9.0, r0 + 0.25 * m) + r.gauss(0.6)) for m in grid_m]
        tb_ct = [(ct0 + r.gauss(0.8) if m < 0 else max(ct0 * 0.95, ct0 - 0.02 * m) + r.gauss(0.8)) for m in grid_m]
        va_ct = [(ct0 + r.gauss(0.8) if m < 0 else max(ct0 * 0.94, ct0 - 0.025 * m) + r.gauss(0.8)) for m in grid_m]
        la_ct = [(ct0 + r.gauss(0.8) if m < 0 else max(ct0 * 0.62, ct0 - 0.18 * m) + r.gauss(0.8)) for m in grid_m]
        live_r = aligned(risk, elev, pack.step_min, grid_m, 'min')
        live_ct = aligned(ct, elev, pack.step_min, grid_m, 'min')
        live = f'{tr}, today'

        def pair(a, b):
            return [ref_chart('Fecal coliform risk index (min from the step up)', '', [5, 25], grid_m, 'min', a,
                              live_r, live, 0, [threshold(p['risk_limit'], 'Permit limit')]),
                    ref_chart('CT delivered', '', [30, 85], grid_m, 'min', b, live_ct, live, 0)]
        refs = [
            reference('borderline', 'textbook', 'Textbook', 'Borderline day reported, and defended',
                      'The index steps up with the afternoon flow and flattens well inside the limit. The operator '
                      'pulls an extra grab sample, notes the flow and contact time on the bench sheet, and files the '
                      'DMR on time. The margin is documented, so the number is defensible even if the next sample is '
                      'worse.',
                      'match', 'Where today should land',
                      [f'Same step-and-flatten shape ({signed(slope_1h, 1)} per hour now)',
                       f'Same intact CT ({signed(ct_mean_pct, 1)} %)',
                       f'{dur(left)} left for {dur(need)} of work' if left is not None else 'Filing window open'],
                      pair(tb, tb_ct)),
            reference('late', 'variant', 'What to avoid', 'Sample pulled late, or the DMR filed late',
                      'The final sample is taken at the worst hour of the day, or the paperwork slips past the '
                      'deadline. A late or missing DMR is a violation in its own right, whatever the water quality '
                      'was.',
                      'nomatch', 'Avoidable today',
                      ['The index is flat, so sample timing is a choice, not a race',
                       'The filing task is already open on the list'],
                      pair(va, va_ct)),
            reference('ctloss', 'lookalike', 'Look-alike', 'Real loss of disinfection',
                      'A chlorine feed pump air-locking or a short-circuiting contact basin. The risk index climbs '
                      'the same way, but the residual sags and CT falls hard with it, and the index keeps going past '
                      'the limit. That is a fault, with a different response.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here residual held {num(min(res[k] for k in seg), 2)}–'
                       f'{num(max(res[k] for k in seg), 2)} mg/L',
                       f'Here CT only moved {signed(ct_mean_pct, 1)} %'],
                      pair(la, la_ct)),
        ]
        ro = [
            ruled_out('Lost disinfection — feed pump, residual or contact time', 'ruled out',
                      f'Chlorine residual stayed {num(min(res[k] for k in seg), 2)}–'
                      f'{num(max(res[k] for k in seg), 2)} '
                      f'mg/L inside its band and CT averaged {signed(ct_mean_pct, 1)} %, well within the '
                      f'{num(p["ct_band_pct"], 0)} % band. The dose is being delivered.',
                      chart('', nice_domain(ct, [ct0], pad=0.08),
                            [series('ct', f'{tr} CT delivered', ct, 'primary', 1),
                             series('base', 'Its own start of shift', [ct0] * pack.n, 'expected', 1)],
                            decimals=0, caption='CT held through the elevated period.', window=w1)),
            ruled_out('A chlorine overfeed masked by dechlorination', 'ruled out',
                      f'Dechlorinated residual {num(min(dech), 3)}–{num(max(dech), 3)} mg/L and the chlorine '
                      f'residual never went above {num(max(res), 2)} mg/L. Nothing is being over-dosed and hidden.'),
            ruled_out('A plant-wide effluent shift', 'ruled out',
                      f'Every other train\'s share of the plant flow moved {signed(min(peer_share.values()), 1)} '
                      f'to {signed(max(peer_share.values()), 1)} % against {signed(share_pct, 1)} % here, and '
                      f'{tr} is the furthest off its own baseline ({signed(rm[now] - r0, 1)} against '
                      f'{signed(peer_drift[worst_peer], 1)} for {tname(pack, worst_peer)}). One train moved.'),
            ruled_out('An analyser fault on the risk index', 'unlikely',
                      f'The rise is partly accounted for by measured CT ({signed(explained, 1)} of '
                      f'{signed(risk[peak] - r0, 1)}), so at least part of it is arithmetic off two other '
                      f'instruments. A grab sample settles the rest, which is what the recommendation asks for.'),
            ruled_out('Where the extra load came from', 'not yet checked',
                      f'Influent strength and effluent TSS are not instrumented in this model. The '
                      f'{num(rr[now], 1)} the CT arithmetic cannot explain is consistent with solids carried '
                      f'through at {signed(thr_pct, 1)} % more treated flow, but the grab sample and the secondary '
                      f'clarifier bench sheet are what confirm it.' if thr else
                      'Influent strength and effluent TSS are not instrumented in this model; the grab sample '
                      'confirms it.'),
        ]
        return {
            'conclusion': conclusion('What\'s needed',
                                     f'Pull the final effluent sample while the index is flat at '
                                     f'{num(rm[now], 1)} ({num(margin, 1)} under the '
                                     f'{num(p["risk_limit"], 0)} limit) and file the DMR by '
                                     f'{clock(due_min)}' if due_min is not None else
                                     f'Pull the final effluent sample while the index is flat and file the DMR',
                                     'n/a', 'A margin and a deadline, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                'n/a',
                f'Everything here is read straight off instruments: the index against its own morning, the margin '
                f'against the permit limit, the residual and CT against their bands, and the filing time off the work '
                f'list. The only inference is the (CT₀/CT)² split, and it is arithmetic, not a diagnosis.',
                None,
                None,
                None,
                None),
            'action': action(item, pack),
            'model': {'target': 'effluent_fecal_coliform_risk',
                      'formula': f'{num(r0, 1)} × ({num(ct0, 1)} / CT)^{num(p["ct_exponent"], 0)}',
                      'fittedOn': f'this stage\'s own first {dur(p["baseline_min"])}; no coefficients fitted — the '
                                  f'exponent is the CT disinfection relationship'},
            'impact': (f'{num(margin, 1)} of margin to the {num(p["risk_limit"], 0)} limit '
                       f'({num(100 * margin / p["risk_limit"], 0)} % of it). At the last hour\'s rate '
                       f'({signed(slope_1h, 1)} per hour) the index would not reach the limit for about '
                       f'{dur(to_limit * 60)}, around {clock(t_now + to_limit * 60)} — after the sample and after '
                       f'the filing deadline.' if to_limit else
                       f'{num(margin, 1)} of margin to the {num(p["risk_limit"], 0)} limit, and the index is not '
                       f'rising. A missed DMR filing, on the other hand, is a violation on its own.'),
        }


DETECTORS = [BlowerAirShortfall(), SludgeSettleabilityDrift(), ClarifierCollectorStall(),
             RasLoadImbalance(), EffluentMarginBeforeDmr()]


def main():
    pack, out, report, path = run_pack(REPO, 'wastewater', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
