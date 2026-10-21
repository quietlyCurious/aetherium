#!/usr/bin/env python3
"""Meridian (conventional drinking-water treatment) — detectors and
explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every water detector on every asset it applies to, using only the
pack's runtime files in public/data/water/, and writes
public/data/water/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus each
detector's definition and where it fired today.

    python3 ModelAndData/industries/water/generate.py     # the data
    python3 ModelAndData/industries/water/explain.py      # the explanations

Detectors never read generate.py's scenario constants, SCENARIOS.md, or an
attention item's own text. If a detector misses a scenario, or fires where
no attention item exists, the run report says so and the exit code is 1 for
a miss.

Meridian is the one pack where every unit is identical: six trains running
the same duty on the same day. So "expected" here is usually one of three
things — the stage's own level over the first part of the shift (dose,
headloss, blanket, contact time), the same stage on the other five trains
(peer spread), or the process physics (dose against the jar-test optimum
for the raw water, CT = free chlorine residual × T₁₀, a mass balance on the
sludge blanket). Cross-instrument agreement does the rest: a settled-water
turbidimeter is judged against the filter downstream of it, a metering
pump's delivery against the dose it produces, a backwash against the
backwash pump's own flow.

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
                             print_report, series, spark, threshold)
from detectors.build import signed as _signed    # noqa: E402


# ── Small helpers (same shape as pharma/explain.py) ─────────────────────
def join_names(names):
    if not names:
        return ''
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ' and ' + names[-1]


def work_ids_for(pack, item):
    ids = []
    sig = item['signal']
    for w in pack.work:
        if w['sourceType'] != 'situation':
            continue
        if w['assetId'] == item['assetId'] or (w.get('sourceLabel') or '') == f'From: {sig}':
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
    return [round(h_min + k * step, 4) for k in range(n + 1)]


def minutes_grid(m_min, m_max, step):
    return list(range(m_min, m_max + 1, step))


def ref_chart(label, unit, y, grid, grid_unit, ref_values, live_values, live_label, decimals=1, thresholds=None):
    return chart(unit, y, [series('ref', 'Reference example', ref_values, 'reference', 2),
                           series('live', live_label, live_values, 'primary', 2)],
                 title=label, x={'unit': grid_unit, 'values': grid}, decimals=decimals, thresholds=thresholds)


def median(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def mean_between(v, i0, i1):
    return B.mean(v[max(0, i0):i1 + 1])


def signed(v, decimals=1):          # noqa: F811 — the toolkit's, without a '−0.0'
    return _signed(None if v is None else round(v, decimals) + 0.0, decimals)


def pct(value, base):
    """Percent change of value against base."""
    if base in (None, 0) or value is None:
        return None
    return 100.0 * (value / base - 1.0)


def tmin(pack, k):
    """Minutes since midnight of grid point k."""
    h, m = pack.ts[k].split(':')
    return int(h) * 60 + int(m)


def hhmm(iso_or_hm):
    return iso_or_hm[11:16] if len(iso_or_hm) > 5 else iso_or_hm


def clock(minutes):
    """Minutes since today's midnight → 'HH:MM', with 'tomorrow' past midnight."""
    d, r = divmod(int(round(minutes)), 1440)
    s = f'{r // 60:02d}:{r % 60:02d}'
    return s if d == 0 else s + (' tomorrow' if d == 1 else f' (+{d} days)')


def win(pack, k0, k1, pad=6):
    return [pack.ts[max(0, k0 - pad)], pack.ts[min(pack.now, k1 + pad)]]


def idx_at(pack, iso):
    """Grid index of an ISO (or HH:MM) time — the first grid point at or after it."""
    if not iso:
        return None
    hm = hhmm(iso)
    for k, t in enumerate(pack.ts):
        if t >= hm:
            return k
    return None


REPAIR_TYPES = ('MAINTENANCE', 'INSPECTION', 'INSTRUMENT_CHECK')


def done_work(pack, aids, types=REPAIR_TYPES):
    """Done work items on any of these assets, earliest first: [(item, completion index)].
    The work list, not telemetry — detectors use it for confidence only."""
    out = []
    for w in pack.work:
        if w['assetId'] in aids and w.get('done') and (types is None or w['workType'] in types):
            k = idx_at(pack, w.get('completedAt'))
            if k is not None:
                out.append((w, k))
    return sorted(out, key=lambda x: x[1])


def open_work(pack, aids, types=None):
    return [w for w in pack.work if w['assetId'] in aids and not w.get('done')
            and (types is None or w['workType'] in types)]


def wtime(w):
    return hhmm(w.get('completedAt') or w.get('plannedStart') or '')


def maintenance_records(item, after_time, words):
    """Maintenance and field-check entries logged on the item after a time that
    mention one of `words`. This is the pack's maintenance log as the app shows
    it (a field result, not telemetry); detectors use it for confidence only."""
    def mins(t):
        h, m = t.split(':')
        return int(h) * 60 + int(m)
    out = []
    for w in item['detail'].get('whatChanged', []):
        if w.get('source') in ('Maintenance', 'Field Check') and mins(w['time']) >= mins(after_time):
            if any(x in w['description'].lower() for x in words):
                out.append(w)
    return out


# ── Water-specific plumbing ─────────────────────────────────────────────
#: the one piece of equipment in each stage that the process flow runs through
FLOW_EQUIP = {'intake': 'raw_water_pump', 'coagulation': 'rapid_mix_basin',
              'flocculation': 'flocculation_basin', 'sedimentation': 'sedimentation_basin',
              'filtration': 'filter_bed', 'disinfection': 'chlorine_contact_basin'}


def stage_of(pack, aid, atype):
    """The same train's stage of a given type (the train is the unit of operation)."""
    u = pack.unit_of(aid)
    if u is None:
        return None
    for c in pack.children.get(u, []):
        if pack.asset(c)['assetType'] == atype:
            return c
    return None


def next_stage(pack, stage):
    """The stage downstream on the process_flow layer (edges are equipment-level)."""
    eq = pack.child_of_type(stage, FLOW_EQUIP.get(pack.asset(stage)['assetType'], ''))
    if eq is None:
        return None
    for t in pack.targets(eq, 'process_flow'):
        p = pack.parent(t)
        if p != stage:
            return p
    return None


def prev_stage(pack, stage):
    """The stage upstream on the process_flow layer."""
    eq = pack.child_of_type(stage, FLOW_EQUIP.get(pack.asset(stage)['assetType'], ''))
    if eq is None:
        return None
    for s in pack.sources(eq, 'process_flow'):
        p = pack.parent(s)
        if p != stage:
            return p
    return None


def tname(pack, aid):
    """'T02' — the train a stage belongs to."""
    u = pack.unit_of(aid)
    return pack.name(u) if u else pack.name(aid)


def peers_of(pack, aid):
    return [a for a in pack.of_type(pack.asset(aid)['assetType']) if a != aid]


# ═════════════════════════════════════════════════════════════════════════
# 1. Coagulant metering-pump delivery loss — archetype 05 (degradation)
# ═════════════════════════════════════════════════════════════════════════
class CoagulantDeliveryLoss(Detector):
    id = 'water.coagulant_delivery_loss'
    name = 'Coagulant metering-pump delivery loss'
    version = '0.1'
    archetype = '05 Component degradation'
    applies_to = 'coagulation stages'
    summary = ('Delivered coagulant dose drifting below the jar-test target while the raw water holds steady, with '
               'the metering pump losing discharge pressure and stroke stability at the same setting — a worn '
               'diaphragm or slipping check valves, not a setpoint change.')
    pipeline = [
        ('Expected dose', 'the stage\'s own dose over the first 90 minutes, moved with raw turbidity the way the '
                          'jar-test optimum moves (ratio to the power 0.2)'),
        ('Residual', 'actual − expected, as a percentage: coagulant the water is not getting'),
        ('Raw water', 'check the raw turbidity has not moved, so the jar-test target has not moved either'),
        ('The pump', 'delivered flow and discharge pressure against their own first 90 minutes'),
        ('Downstream', 'jar-test deviation, floc formation and settled-water turbidity, one residence time behind'),
        ('Conclusion', 'all required checks → raise; an independent check agrees → medium; recalibration done and '
                       'the dose back on target → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'coagulation'},
        'inputs': {'dose': 'self.coagulant_dose_mg_l', 'stability': 'self.coagulant_pump_stability',
                   'jar': 'self.jar_test_deviation_pct', 'floc': 'self.floc_formation_index',
                   'pump': 'child coagulant_metering_pump.dosing_flow_rate_gpm, .discharge_pressure_psi, .vibration_mms',
                   'raw': 'same train intake.raw_water_turbidity_ntu',
                   'settled': 'downstream sedimentation.settled_water_turbidity_ntu (process_flow)',
                   'peers': 'the other five coagulation stages', 'work': 'done work items on this stage and its pump'},
        'peers': {'same': 'assetType', 'count': 5,
                  'use': 'each train has its own jar-test optimum and dose setpoint, so peers are used for the '
                         'shape of the drift, not its level'},
        'expected': {'model': 'own baseline moved with raw turbidity', 'target': 'coagulant_dose_mg_l',
                     'formula': 'median(dose over baseline_min) × (raw ÷ raw_baseline) ^ dose_exp',
                     'fitOn': 'this stage\'s own first baseline_min'},
        'params': {'baseline_min': 90, 'dose_exp': 0.2, 'drop_pct': 10.0, 'watch_pct': 4.0, 'sustain_min': 20,
                   'raw_band_pct': 40.0, 'flow_drop_pct': 8.0, 'press_drop_pct': 5.0, 'avg_min': 30,
                   'stab_drop': 1.5, 'jar_limit_pct': 6.0, 'settled_rise_ntu': 0.4, 'lag_min': 20,
                   'floc_drop': 5.0, 'peer_band_pct': 5.0, 'recovered_min': 30, 'recovered_band_pct': 6.0},
        'checks': [
            {'id': 'short', 'role': 'required', 'rule': 'dose residual < −drop_pct of the expected dose'},
            {'id': 'sustained', 'role': 'required', 'rule': 'residual below −drop_pct for sustain_min'},
            {'id': 'raw', 'role': 'required', 'rule': 'raw turbidity within ±raw_band_pct of its baseline over the episode'},
            {'id': 'pump', 'role': 'required',
             'rule': 'pump flow < −flow_drop_pct and discharge pressure < −press_drop_pct of their baselines, '
                     'averaged over avg_min'},
            {'id': 'stability', 'role': 'supporting', 'independent': True, 'rule': 'stroke stability down > stab_drop points'},
            {'id': 'jar', 'role': 'supporting', 'independent': True, 'rule': 'jar-test deviation > jar_limit_pct'},
            {'id': 'settled', 'role': 'supporting', 'independent': True,
             'rule': 'settled-water turbidity up > settled_rise_ntu, starting at least lag_min after the dose fell'},
            {'id': 'floc', 'role': 'supporting', 'rule': 'floc formation index down > floc_drop points'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'the other coagulation stages hold their dose within ±peer_band_pct'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True,
             'rule': 'after a done maintenance item on the pump, the residual is back inside ±recovered_band_pct '
                     'for recovered_min'},
        ],
        'ruleOut': ['raw-water change moving the jar-test optimum', 'operator or controller setpoint change',
                    'coagulant tank running low or a wrong batch', 'dose transmitter fault',
                    'blocked injection point'],
        'confidence': {'low': 'required checks only',
                       'medium': 'an independent measurement (stroke stability, bench jar test or the settled-water '
                                 'turbidimeter) agrees',
                       'high': 'the pump was inspected or recalibrated and the dose came back to target'},
        'references': ['textbook: diaphragm wear', 'variant: check-valve slip', 'look-alike: setpoint lowered'],
    }

    def candidates(self, pack):
        return pack.of_type('coagulation')

    def _ctx(self, pack, aid):
        p = self.p
        pump = pack.child_of_type(aid, 'coagulant_metering_pump')
        intake = stage_of(pack, aid, 'intake')
        if pump is None or intake is None:
            return None
        nb = pack.steps(p['baseline_min'])
        dose = pack.series(aid, 'coagulant_dose_mg_l')
        raw = pack.series(intake, 'raw_water_turbidity_ntu')
        flow = pack.series(pump, 'dosing_flow_rate_gpm')
        press = pack.series(pump, 'discharge_pressure_psi')
        d0, r0 = median(dose[:nb]), median(raw[:nb])
        f0, p0 = median(flow[:nb]), median(press[:nb])
        if not d0 or not r0 or not f0 or not p0:
            return None
        exp = [d0 * (r / r0) ** p['dose_exp'] for r in raw]
        res = [pct(d, e) for d, e in zip(dose, exp)]
        return dict(pump=pump, intake=intake, dose=dose, raw=raw, flow=flow, press=press,
                    d0=d0, r0=r0, f0=f0, p0=p0, exp=exp, res=res)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        res, raw, flow, press = c['res'], c['raw'], c['flow'], c['press']
        low = [v is not None and v < -p['drop_pct'] for v in res]
        watch = [v is not None and v < -p['watch_pct'] for v in res]
        na = pack.steps(p['avg_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(low, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            if max(abs(pct(v, c['r0'])) for v in raw[onset:i + 1]) > p['raw_band_pct']:
                continue
            if pct(mean_between(flow, i - na + 1, i), c['f0']) > -p['flow_drop_pct']:
                continue
            if pct(mean_between(press, i - na + 1, i), c['p0']) > -p['press_drop_pct']:
                continue
            c.update(onset=onset, alert=s0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        pump, intake = c['pump'], c['intake']
        dose, raw, flow, press, res, exp = c['dose'], c['raw'], c['flow'], c['press'], c['res'], c['exp']
        onset, alert = c['onset'], c['alert']
        nb = pack.steps(p['baseline_min'])
        na = pack.steps(p['avg_min'])
        worst = min(range(onset, now + 1), key=lambda k: res[k])
        flow_pct = pct(mean_between(flow, i - na + 1, i), c['f0'])
        press_pct = pct(mean_between(press, i - na + 1, i), c['p0'])
        raw_dev = max(abs(pct(v, c['r0'])) for v in raw[onset:now + 1])

        stab = pack.series(aid, 'coagulant_pump_stability')
        s0 = median(stab[:nb])
        stab_drop = s0 - min(stab[onset:now + 1])
        stab_ok = stab_drop > p['stab_drop']
        jar = pack.series(aid, 'jar_test_deviation_pct')
        jar_max = max(jar[onset:now + 1])
        jar_k = max(range(onset, now + 1), key=lambda k: jar[k])
        jar_ok = jar_max > p['jar_limit_pct']
        sed = next_stage(pack, next_stage(pack, aid) or aid)
        if sed is None or pack.asset(sed)['assetType'] != 'sedimentation':
            sed = stage_of(pack, aid, 'sedimentation')
        settled = pack.series(sed, 'settled_water_turbidity_ntu')
        st0 = median(settled[:nb])
        st_k = max(range(onset, now + 1), key=lambda k: settled[k])
        st_rise = settled[st_k] - st0
        st_ok = st_rise > p['settled_rise_ntu'] and pack.minutes_between(onset, st_k) >= p['lag_min']
        floc_s = pack.series(aid, 'floc_formation_index')
        fl0 = median(floc_s[:nb])
        fl_min = min(floc_s[onset:now + 1])
        floc_ok = fl0 - fl_min > p['floc_drop']

        peers, skipped, pdrift = [], [], {}
        for o in peers_of(pack, aid):
            co = self._ctx(pack, o)
            if co is None:
                continue
            if max(abs(pct(v, co['r0'])) for v in co['raw'][onset:now + 1]) > p['raw_band_pct']:
                skipped.append(o)          # its own raw water moved, so its target moved too
                continue
            peers.append(o)
            pdrift[o] = min(co['res'][onset:now + 1])
        peers_ok = bool(peers) and all(abs(v) < p['peer_band_pct'] for v in pdrift.values())

        fixes = [(w, k) for w, k in done_work(pack, [aid, pump]) if k >= onset]
        fix = fixes[0] if fixes else None
        recovered = False
        if fix:
            k1 = fix[1] + pack.steps(p['recovered_min'])
            recovered = k1 <= now and min(res[fix[1] + 1:k1 + 1]) > -p['recovered_band_pct']
        logs = maintenance_records(item, ts[onset], ['pump', 'calibrat', 'diaphragm'])
        level = 'high' if (recovered and logs) else ('medium' if (stab_ok or jar_ok or st_ok) else 'low')
        rd = nice_domain(res, [-p['drop_pct'] - 2, 2], pad=0.1)
        w1 = win(pack, onset, now)

        checks = [
            check('short', 'Dose below the jar-test target for this raw water', 'required', MATCH,
                  f'{num(dose[worst], 1)} mg/L at {ts[worst]} against {num(exp[worst], 1)} mg/L expected '
                  f'({signed(res[worst], 1)} %). The flag level is {signed(-p["drop_pct"], 0)} %.',
                  'Coagulant dose is set from a jar test and paced to flow. At a steady raw water the target does not '
                  'move, so a falling delivered dose means the water is being under-dosed.',
                  spark(res, rd, threshold_value=-p['drop_pct'], highlight=[ts[alert], ts[worst]])),
            check('sustained', 'Held low, not one bad sample', 'required', MATCH,
                  f'Below {signed(-p["drop_pct"], 0)} % since {ts[alert]} ({dur(pack.minutes_between(alert, i))} by '
                  f'{ts[i]}); first below {signed(-p["watch_pct"], 0)} % at {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} below the flag level, so a single sample or a flow-pacing wobble '
                  f'cannot raise it.',
                  spark(res, rd, threshold_value=-p['drop_pct'], highlight=[ts[alert], ts[i]])),
            check('raw', 'Raw water unchanged, so the target has not moved', 'required', MATCH,
                  f'Raw turbidity {num(min(raw[onset:now + 1]), 1)}–{num(max(raw[onset:now + 1]), 1)} NTU through the '
                  f'episode against {num(c["r0"], 1)} NTU this morning (at most {num(raw_dev, 0)} % off; the band is '
                  f'±{num(p["raw_band_pct"], 0)} %).',
                  'The jar-test optimum rises with raw turbidity. With the raw water flat, nothing justifies less '
                  'coagulant — this is lost delivery, not a re-optimised dose.',
                  spark(raw, nice_domain(raw, [c['r0']]), band_lo=[c['r0'] * (1 - p['raw_band_pct'] / 100)] * pack.n,
                        band_hi=[c['r0'] * (1 + p['raw_band_pct'] / 100)] * pack.n)),
            check('pump', 'The metering pump is delivering less at the same setting', 'required', MATCH,
                  f'Pumped flow {num(mean_between(flow, i - na + 1, i), 2)} gpm over the last {dur(p["avg_min"])} '
                  f'against {num(c["f0"], 2)} gpm this morning ({signed(flow_pct, 1)} %), discharge pressure '
                  f'{num(mean_between(press, i - na + 1, i), 2)} psi against {num(c["p0"], 2)} psi '
                  f'({signed(press_pct, 1)} %).',
                  'A diaphragm that has lost its seal, or check valves that slip, move less liquid per stroke and '
                  'build less pressure. A lowered setpoint would cut the flow with the pressure unchanged.',
                  spark(press, nice_domain(press, [c['p0']]), threshold_value=c['p0'] * (1 - p['press_drop_pct'] / 100),
                        window=w1)),
            check('stability', 'Stroke stability falling with it', 'supporting', MATCH if stab_ok else NO_MATCH,
                  f'{num(min(stab[onset:now + 1]), 1)} at its lowest against {num(s0, 1)} this morning '
                  f'({signed(-stab_drop, 1)} points; the flag is {signed(-p["stab_drop"], 1)}).',
                  'A separate measurement on the pump. Stroke-to-stroke delivery gets ragged as a diaphragm hardens '
                  'or a valve seat leaks, before the average dose has moved far.',
                  spark(stab, nice_domain(stab, [s0]), threshold_value=s0 - p['stab_drop'], window=w1)),
            check('jar', 'Bench jar test disagrees with the plant', 'supporting', MATCH if jar_ok else NO_MATCH,
                  f'Jar-test deviation {num(jar_max, 1)} % at {ts[jar_k]} against {num(median(jar[:nb]), 1)} % this '
                  f'morning; the limit is {num(p["jar_limit_pct"], 0)} %.',
                  'The jar test is a bench measurement with its own sample and operator. It says the dose in the '
                  'water is the wrong one, independently of the dosing instruments.',
                  spark(jar, nice_domain(jar, [p['jar_limit_pct']]), threshold_value=p['jar_limit_pct'], window=w1)),
            check('settled', 'Settled water turbidity followed, one residence time behind', 'supporting',
                  MATCH if st_ok else NO_MATCH,
                  f'{num(settled[st_k], 2)} NTU at {ts[st_k]} against {num(st0, 2)} NTU this morning '
                  f'({signed(st_rise, 2)} NTU), {dur(pack.minutes_between(onset, st_k))} after the dose started to '
                  f'fall.',
                  'A different sensor, a stage downstream. Under-dosed water makes weaker floc that settles worse, '
                  'and it shows up after flocculation and settling, not at once.',
                  spark(settled, nice_domain(settled, [st0]), threshold_value=st0 + p['settled_rise_ntu'], window=w1)),
            check('floc', 'Floc formation poorer in the rapid mix', 'supporting', MATCH if floc_ok else NO_MATCH,
                  f'Floc formation index {num(fl_min, 0)} at its lowest against {num(fl0, 0)} this morning '
                  f'({signed(fl_min - fl0, 0)} points).',
                  'Too little metal salt leaves particles charged and they do not stick. The index drops with the '
                  'dose and comes back with it.',
                  spark(floc_s, nice_domain(floc_s, [fl0]), window=w1)),
            check('peers', 'Comparable trains dosed to target', 'supporting', MATCH if peers_ok else NO_MATCH,
                  (f'{join_names([tname(pack, o) for o in peers])}: at worst '
                   f'{signed(min(pdrift.values()), 1)} % off their own expected dose over the same window, inside '
                   f'±{num(p["peer_band_pct"], 0)} %.' if peers else 'No other coagulation stage to compare with.'),
                  'All six trains share the coagulant storage, the raw water source and the jar-test schedule. Only '
                  'this train lost dose, so the chemical and the lab work are not the problem.',
                  None),
            check('recovered', 'Dose back on target after the pump was worked on', 'supporting',
                  MATCH if recovered else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" completed {wtime(fix[0])}; residual back inside '
                   f'±{num(p["recovered_band_pct"], 0)} % from {ts[fix[1] + 1]} and held '
                   f'{dur(pack.minutes_between(fix[1], now))}.' if recovered else
                   'No work on the pump recorded yet.' if fix is None else
                   f'Work finished {wtime(fix[0])}; not yet {dur(p["recovered_min"])} back on target.'),
                  'The strongest test there is: the dose came back the moment the pump was recalibrated, with nothing '
                  'else touched.',
                  spark(res, rd, threshold_value=-p['drop_pct'],
                        highlight=[ts[fix[1]], ts[now]] if fix else None, window=w1)),
        ]
        main = chart('mg/L', nice_domain(dose, exp, pad=0.1),
                     [series('actual', f'{tn} coagulant dose', dose, 'primary', 2),
                      series('expected', 'Jar-test target for this raw water', exp, 'expected', 2)],
                     title='What we see',
                     caption=f'{tn} delivered coagulant dose against the jar-test target for the raw water at the '
                             f'time. The shaded gap is coagulant the water did not get.',
                     shade_gap=['actual', 'expected'], decimals=1,
                     markers=[marker(ts[onset], 'Drift begins'), marker(ts[alert], f'{signed(-p["drop_pct"], 0)} %')]
                     + ([marker(ts[fix[1]], 'Pump recalibrated')] if fix else []))

        grid = hours_grid(4, 0.25)
        r = Rng(4101)
        tb = [-1.0 - 4.2 * hh + r.gauss(0.5) for hh in grid]
        tb_p = [-0.3 - 2.6 * hh + r.gauss(0.3) for hh in grid]
        vr = [-1.0 - 5.0 * math.floor(hh / 1.0) + r.gauss(0.4) for hh in grid]
        vr_p = [-0.3 - 2.2 * math.floor(hh / 1.0) + r.gauss(0.3) for hh in grid]
        la = [(-0.5 if hh < 0.5 else -13.0) + r.gauss(0.4) for hh in grid]
        la_p = [r.gauss(0.25) for hh in grid]
        live = f'{tn}, today'
        live_r = aligned(res, onset, pack.step_min, grid)
        live_p = aligned([pct(v, c['p0']) for v in press], onset, pack.step_min, grid)

        def pair(a, b):
            return [ref_chart('Dose against target (h from the first drift)', '%', [-22, 4], grid, 'h', a, live_r,
                              live, 0, [threshold(-p['drop_pct'], 'Flag')]),
                    ref_chart('Pump discharge pressure against normal', '%', [-16, 4], grid, 'h', b, live_p, live, 0)]
        refs = [
            reference('wear', 'textbook', 'Textbook', 'Metering-pump diaphragm wear',
                      'The diaphragm hardens and loses its seal. Delivery per stroke falls a little every hour, '
                      'discharge pressure sags with it, and the dose drifts below target until someone checks it '
                      'against the calibration column.', 'match', 'Closest match',
                      ['Same slow, continuous loss of delivery', 'Pressure falling with the flow',
                       'Found and corrected by recalibration' if recovered else 'Corrected by recalibration'],
                      pair(tb, tb_p)),
            reference('valve', 'variant', 'Variant', 'Check valves slipping on grit',
                      'Grit or crystallised coagulant holds a ball check off its seat. Delivery drops in steps as '
                      'the valve re-seats and slips again, rather than drifting, and a flush often restores it.',
                      'partial', 'Same cause family, different shape',
                      ['Steps rather than a drift', 'Worth flushing the valves before rebuilding the head'],
                      pair(vr, vr_p)),
            reference('setpoint', 'lookalike', 'Look-alike', 'Someone lowered the dose setpoint',
                      'A jar test finds a lower optimum, the operator lowers the setpoint, and the dose steps down '
                      'and stays there. Nothing is wrong: the pump still makes its pressure and strokes cleanly.',
                      'nomatch', 'Does not match',
                      [f'Today the dose drifted over {dur(pack.minutes_between(onset, worst))} instead of stepping',
                       f'Discharge pressure fell {signed(press_pct, 1)} % — a setpoint change leaves it flat'],
                      pair(la, la_p)),
        ]
        tank = pack.child_of_type(aid, 'coagulant_storage_tank')
        tlev = pack.series(tank, 'level_pct') if tank else None
        ro = [
            ruled_out('A raw-water change moving the jar-test optimum', 'ruled out',
                      f'Raw turbidity stayed {num(min(raw[onset:now + 1]), 1)}–{num(max(raw[onset:now + 1]), 1)} NTU '
                      f'and pH {num(min(pack.series(c["intake"], "raw_water_ph")[onset:now + 1]), 2)}–'
                      f'{num(max(pack.series(c["intake"], "raw_water_ph")[onset:now + 1]), 2)} through the episode. '
                      f'The target the dose is judged against moved less than 1 %.'),
            ruled_out('An operator or controller setpoint change', 'ruled out',
                      f'Discharge pressure fell {signed(press_pct, 1)} % and stroke stability '
                      f'{signed(-stab_drop, 1)} points while the flow fell. Turning a pump down does not make it '
                      f'lose pressure or stroke unevenly.'),
            ruled_out('Coagulant tank low, or a weak batch', 'ruled out' if tlev else 'not yet checked',
                      (f'Storage tank level {num(min(tlev), 0)}–{num(max(tlev), 0)} % all shift, and the other five '
                       f'trains dose from the same chemical with no drift.' if tlev else
                       'No tank level found on this stage.')),
            ruled_out('A faulty dose transmitter (the dose is really on target)', 'ruled out' if st_ok else 'unlikely',
                      (f'The water agrees with the reading: settled turbidity rose {signed(st_rise, 2)} NTU and the '
                       f'bench jar test came out {num(jar_max, 1)} % off. A reading-only fault leaves both flat.'
                       if st_ok else 'Settled turbidity barely moved, so the shortfall is not yet confirmed in the water.')),
            ruled_out('A blocked injection point', 'not yet checked',
                      'A plugged injector shows the same dose loss but with discharge pressure *rising*, and here it '
                      'fell. The inspection covers both; the injection quill is worth a look while the head is open.'),
        ]
        return {
            'conclusion': conclusion(
                'Cause' if level == 'high' else 'Most likely cause',
                f'The {tn} coagulant metering pump lost delivery — worn diaphragm or slipping check valves — so the '
                f'dose fell {signed(res[worst], 0)} % below the jar-test target'
                + (f'; recalibration at {wtime(fix[0])} put it back' if recovered else ''),
                level,
                'Confirmed by inspection and by the dose coming back' if level == 'high' else
                'Pump data and an independent check agree' if level == 'medium' else 'Dosing instruments only'),
            'rootCauseAssetId': pump,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': (f'Left out of the train comparison: {join_names([tname(pack, o) for o in skipped])} — their '
                         f'own raw turbidity moved more than ±{num(p["raw_band_pct"], 0)} % in this window, so their '
                         f'jar-test target moved with it and a dose gap there means something different.'
                         if skipped else None),
            'confidence': confidence(
                level,
                'The dose shortfall, the pump\'s own flow and pressure, the bench jar test and the settled-water '
                'turbidimeter are four separate measurements and all four point at the pump'
                + (f'. The pump was opened at {wtime(fix[0])} and the dose returned to target straight after.'
                   if recovered else '.'),
                None if level == 'high' else 'Nobody has opened the pump head yet; from trends alone a worn diaphragm '
                                            'and slipping check valves look the same.',
                None if level == 'high' else 'The calibration column shows less than the set stroke volume, or the '
                                             'head shows a worn diaphragm.',
                'The calibration column draws down exactly as set. Then suspect the dose transmitter or the '
                'injection point rather than the pump.',
                f'Pump inspection and recalibration at {wtime(fix[0])}, dose back to '
                f'{num(dose[now], 1)} mg/L' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'coagulant_dose_mg_l',
                      'formula': f'{num(c["d0"], 1)} mg/L × (raw turbidity ÷ {num(c["r0"], 1)} NTU) ^ '
                                 f'{p["dose_exp"]}',
                      'fittedOn': f'{tn}\'s own first {dur(p["baseline_min"])}; the exponent is the weak rise of the '
                                  f'jar-test optimum with raw turbidity'},
            'impact': (f'About {dur(pack.minutes_between(onset, fix[1] if fix else now))} of water treated below the '
                       f'jar-test target, worst {signed(res[worst], 0)} %. Settled water reached '
                       f'{num(settled[st_k], 2)} NTU against {num(st0, 1)} NTU normally on this train; filter '
                       f'effluent stayed at '
                       f'{num(max(pack.series(stage_of(pack, aid, "filtration"), "filter_effluent_turbidity_ntu")), 2)} '
                       f'NTU, well inside the 0.3 NTU limit, so no finished-water exceedance.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Sludge blanket accumulation — archetype 04 (accumulation)
# ═════════════════════════════════════════════════════════════════════════
class SludgeBlanketRise(Detector):
    id = 'water.sludge_blanket_rise'
    name = 'Sludge blanket rising toward the weir'
    version = '0.1'
    archetype = '04 Accumulation'
    applies_to = 'sedimentation stages'
    summary = ('A sludge blanket climbing steadily past the level where floc starts to carry over, because the '
               'solids coming in have gone up and the desludge cycle has not: solids in are beating solids out.')
    pipeline = [
        ('Rise rate', 'blanket level slope over the last hour, in % of basin depth per hour'),
        ('Height', 'how far it is above the level where carryover starts'),
        ('Hold it', 'the rise has to keep up for sustain_min, so one stirred sample cannot raise it'),
        ('Other basins', 'the other five blankets, which share the raw water and the desludge schedule'),
        ('Mass balance', 'solids in (raw turbidity × dose) against solids out (desludge cycle time)'),
        ('Conclusion', 'all required checks → raise; the blanket falls after an extra cycle → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'sedimentation'},
        'inputs': {'blanket': 'self.sludge_blanket_level_pct', 'settled': 'self.settled_water_turbidity_ntu',
                   'weir': 'self.weir_overflow_rate_gpd_ft',
                   'collector': 'child sludge_collector.cycle_time_min, .motor_current_a, .travel_speed_pct',
                   'basin': 'child sedimentation_basin.level_pct',
                   'raw': 'same train intake.raw_water_turbidity_ntu',
                   'carryover': 'upstream flocculation.floc_carryover_risk (process_flow)',
                   'peers': 'the other five sedimentation stages', 'work': 'done work items on this stage'},
        'peers': {'same': 'assetType', 'count': 5, 'use': 'rule out a plant-wide solids load or a shared timer change'},
        'expected': {'model': 'own baseline', 'target': 'sludge_blanket_level_pct',
                     'formula': 'median(blanket over baseline_min) — a blanket in balance sits still',
                     'fitOn': 'this basin\'s own first baseline_min'},
        'params': {'baseline_min': 90, 'rise_pct_h': 8.0, 'sustain_min': 30, 'blanket_pct': 45.0,
                   'weir_pct': 70.0, 'level_explains_frac': 0.3, 'cycle_stretch_pct': 15.0,
                   'raw_rise_pct': 20.0, 'current_rise_pct': 4.0, 'settled_rise_ntu': 0.2, 'weir_band_pct': 3.0,
                   'cleared_min': 20, 'peer_net_frac': 0.35, 'peer_net_cap_pct': 5.0},
        'checks': [
            {'id': 'rising', 'role': 'required', 'rule': 'blanket slope over the last hour > rise_pct_h'},
            {'id': 'high', 'role': 'required', 'rule': 'blanket above blanket_pct of basin depth'},
            {'id': 'sustained', 'role': 'required', 'rule': 'the rise has held for sustain_min'},
            {'id': 'basin', 'role': 'required',
             'rule': 'the basin level change could explain less than level_explains_frac of the blanket rise '
                     '(blanket is a share of basin depth)'},
            {'id': 'peers', 'role': 'required',
             'rule': 'every other basin gains less than peer_net_frac of this one\'s rise over the same window, '
                     'and less than peer_net_cap_pct points'},
            {'id': 'desludge', 'role': 'supporting', 'rule': 'collector cycle time stretched more than cycle_stretch_pct'},
            {'id': 'load', 'role': 'supporting', 'independent': True, 'rule': 'raw turbidity up more than raw_rise_pct'},
            {'id': 'current', 'role': 'supporting', 'independent': True,
             'rule': 'collector motor current up more than current_rise_pct (a thicker blanket to drag)'},
            {'id': 'carryover', 'role': 'supporting', 'independent': True,
             'rule': 'settled-water turbidity up more than settled_rise_ntu once the blanket is above blanket_pct'},
            {'id': 'cleared', 'role': 'supporting', 'independent': True,
             'rule': 'blanket back under blanket_pct within cleared_min of a desludge cycle at raised travel speed'},
        ],
        'ruleOut': ['a plant-wide solids load', 'a basin level change (false blanket reading)',
                    'the collector drive stopped or jammed', 'more flow through the basin',
                    'a blanket-sensor fault'],
        'confidence': {'low': 'required checks only',
                       'medium': 'the raw-water analyser or the collector current agrees',
                       'high': 'the blanket dropped as soon as an extra desludge cycle ran'},
        'references': ['textbook: desludge behind the solids load', 'variant: collector drive slipping',
                       'look-alike: solids surge the timer kept up with'],
    }

    def candidates(self, pack):
        return pack.of_type('sedimentation')

    def _ctx(self, pack, aid):
        p = self.p
        coll = pack.child_of_type(aid, 'sludge_collector')
        basin = pack.child_of_type(aid, 'sedimentation_basin')
        if coll is None or basin is None:
            return None
        nb = pack.steps(p['baseline_min'])
        bl = pack.series(aid, 'sludge_blanket_level_pct')
        slope = [B.slope_per_hour(bl, k, pack.steps(60), pack.step_min) for k in range(pack.n)]
        return dict(coll=coll, basin=basin, bl=bl, slope=slope, b0=median(bl[:nb]),
                    lev=pack.series(basin, 'level_pct'), l0=median(pack.series(basin, 'level_pct')[:nb]))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        bl, slope = c['bl'], c['slope']
        up = [s is not None and s > p['rise_pct_h'] for s in slope]
        peer_ctx = {}
        for o in peers_of(pack, aid):
            co = self._ctx(pack, o)
            if co:
                peer_ctx[o] = co
        for i in range(pack.n):
            s0 = B.sustained_since(up, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if bl[i] < p['blanket_pct']:
                continue
            onset = s0
            while onset > 0 and (slope[onset - 1] or 0) > p['rise_pct_h'] / 2:
                onset -= 1
            net = bl[i] - bl[onset]
            lev_explains = c['b0'] * max(abs(pct(v, c['l0'])) for v in c['lev'][onset:i + 1]) / 100.0
            if net <= 0 or lev_explains > p['level_explains_frac'] * net:
                continue
            if not peer_ctx:
                continue
            if any(co['bl'][i] - co['bl'][onset] > min(p['peer_net_frac'] * net, p['peer_net_cap_pct'])
                   for co in peer_ctx.values()):
                continue
            c.update(onset=onset, alert=s0, peer_ctx=peer_ctx)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        coll, basin = c['coll'], c['basin']
        bl, slope, b0 = c['bl'], c['slope'], c['b0']
        onset, alert = c['onset'], c['alert']
        nb = pack.steps(p['baseline_min'])
        peak = max(range(onset, now + 1), key=lambda k: bl[k])
        rate = slope[i]
        to_weir = (p['weir_pct'] - bl[i]) / rate * 60 if rate and rate > 0 else None

        cyc = pack.series(coll, 'cycle_time_min')
        c0 = median(cyc[:nb])
        cyc_k = max(range(onset, now + 1), key=lambda k: cyc[k])
        cyc_pct = pct(cyc[cyc_k], c0)
        cyc_ok = cyc_pct > p['cycle_stretch_pct']
        intake = stage_of(pack, aid, 'intake')
        raw = pack.series(intake, 'raw_water_turbidity_ntu')
        r0 = median(raw[:pack.steps(60)])
        raw_now = mean_between(raw, onset, now)
        raw_pct = pct(raw_now, r0)
        raw_ok = raw_pct > p['raw_rise_pct']
        amp = pack.series(coll, 'motor_current_a')
        a0 = median(amp[:nb])
        settled = pack.series(aid, 'settled_water_turbidity_ntu')
        st0 = median(settled[:nb])
        st_k = max(range(onset, now + 1), key=lambda k: settled[k])
        st_ok = settled[st_k] - st0 > p['settled_rise_ntu']
        speed = pack.series(coll, 'travel_speed_pct')
        sp0 = median(speed[:nb])
        extra = [k for k in range(onset, pack.n) if pct(speed[k], sp0) > 20]
        cleared = None
        if extra:
            k0 = extra[0]
            back = [k for k in range(k0, pack.n) if bl[k] < p['blanket_pct']]
            if back and pack.minutes_between(k0, back[0]) <= p['cleared_min'] + pack.step_min:
                cleared = (k0, back[0])
        # the collector current is read before any extra cycle, so raised travel
        # speed cannot be mistaken for a thicker blanket
        amp_end = (cleared[0] - 1) if cleared else now
        amp_k = max(range(onset, amp_end + 1), key=lambda k: amp[k])
        amp_pct = pct(amp[amp_k], a0)
        amp_ok = amp_pct > p['current_rise_pct']
        weir = pack.series(aid, 'weir_overflow_rate_gpd_ft')
        w0 = median(weir[:nb])
        weir_dev = max(abs(pct(v, w0)) for v in weir[onset:now + 1])
        peer_net = {o: co['bl'][i] - co['bl'][onset] for o, co in c['peer_ctx'].items()}
        own_net = bl[i] - bl[onset]
        lev_dev = max(abs(pct(v, c['l0'])) for v in c['lev'][onset:i + 1])
        lev_explains = c['b0'] * lev_dev / 100.0
        reviews = done_work(pack, [aid, coll], types=None)
        review = next(((w, k) for w, k in reviews if k >= onset), None)
        logs = maintenance_records(item, ts[onset], ['desludge', 'timer', 'cycle'])
        level = 'high' if (cleared and (review or logs)) else ('medium' if (raw_ok or amp_ok) else 'low')
        bd = nice_domain(bl, [b0, p['weir_pct']], pad=0.05)
        w1 = win(pack, onset, now)

        checks = [
            check('rising', 'Blanket climbing, not sitting still', 'required', MATCH,
                  f'{signed(rate, 1)} % of basin depth per hour at {ts[i]} ({num(bl[onset], 1)} % at {ts[onset]} → '
                  f'{num(bl[i], 1)} % at {ts[i]}). The flag rate is {num(p["rise_pct_h"], 0)} %/h.',
                  'A blanket in balance sits at one level: what settles into it is swept out by the collector. A '
                  'steady climb means more is coming in than is going out.',
                  spark(slope, nice_domain([s for s in slope if s is not None], [0, p['rise_pct_h']]),
                        threshold_value=p['rise_pct_h'])),
            check('high', 'Above the level where floc starts to carry over', 'required', MATCH,
                  f'{num(bl[i], 1)} % of basin depth at {ts[i]}, peak {num(bl[peak], 1)} % at {ts[peak]}, against '
                  f'{num(b0, 1)} % this morning. Carryover starts around {num(p["blanket_pct"], 0)} %.',
                  'Below about 45 % the blanket is a filter that helps. Above it, floc is close enough to the launder '
                  'to be pulled over the weir with the settled water.',
                  spark(bl, bd, threshold_value=p['blanket_pct'])),
            check('sustained', 'The rise held', 'required', MATCH,
                  f'Rising faster than {num(p["rise_pct_h"], 0)} %/h since {ts[alert]} '
                  f'({dur(pack.minutes_between(alert, i))} by {ts[i]}).',
                  f'Needs {dur(p["sustain_min"])} of it. A collector pass or a stirred sample can lift one reading; it '
                  f'cannot hold a trend.',
                  spark(bl, bd, highlight=[ts[alert], ts[i]])),
            check('basin', 'Not a basin-level artefact', 'required', MATCH,
                  f'Sedimentation basin level {num(min(c["lev"][onset:i + 1]), 1)}–'
                  f'{num(max(c["lev"][onset:i + 1]), 1)} % against {num(c["l0"], 1)} % this morning — at most '
                  f'{num(lev_dev, 1)} % off, which could account for {num(lev_explains, 1)} of the '
                  f'{num(own_net, 1)} points the blanket gained.',
                  'The blanket is measured as a share of basin depth. A lower water level would make it read higher '
                  'with no more sludge in the basin — but only in proportion, and the numbers do not come close.',
                  spark(c['lev'], nice_domain(c['lev'], [c['l0']]))),
            check('peers', 'The other five basins steady', 'required', MATCH,
                  f'{join_names([tname(pack, o) for o in peer_net])}: at most '
                  f'{signed(max(peer_net.values()), 1)} points between {ts[onset]} and {ts[i]}, against '
                  f'{signed(own_net, 1)} points here.',
                  'All six basins share the source water, the coagulant and the desludge schedule. Only this one is '
                  'filling up, so it is this basin\'s balance that changed.',
                  spark(c['peer_ctx'][max(peer_net, key=lambda o: peer_net[o])]['bl'], bd)),
            check('desludge', 'Desludge cycle running slower than it was', 'supporting',
                  MATCH if cyc_ok else NO_MATCH,
                  f'Collector cycle time {num(cyc[cyc_k], 1)} min at {ts[cyc_k]} against {num(c0, 1)} min this '
                  f'morning ({signed(cyc_pct, 0)} %). The flag is {signed(p["cycle_stretch_pct"], 0)} %.',
                  'Cycle time is how long between sweeps to the hopper. Stretch it and less sludge leaves per hour, '
                  'whatever is settling out.',
                  spark(cyc, nice_domain(cyc, [c0]), threshold_value=c0 * (1 + p['cycle_stretch_pct'] / 100))),
            check('load', 'More solids coming in', 'supporting', MATCH if raw_ok else NO_MATCH,
                  f'Raw turbidity averaged {num(raw_now, 1)} NTU since {ts[onset]} against {num(r0, 1)} NTU at shift '
                  f'start ({signed(raw_pct, 0)} %).',
                  'The intake analyser, upstream and independent. More turbidity in means more floc settling out per '
                  'hour, so the same desludge cycle falls behind.',
                  spark(raw, nice_domain(raw, [r0]), threshold_value=r0 * (1 + p['raw_rise_pct'] / 100))),
            check('current', 'Collector working harder', 'supporting', MATCH if amp_ok else NO_MATCH,
                  f'Collector motor current {num(amp[amp_k], 1)} A at {ts[amp_k]} against {num(a0, 1)} A this '
                  f'morning ({signed(amp_pct, 0)} %), read before any extra cycle so raised travel speed is not in '
                  f'it.',
                  'A separate sensor, on the drive. A deeper, denser blanket is heavier to drag, so the current rises '
                  'with the blanket — which also says the blanket is real, not a reading.',
                  spark(amp, nice_domain(amp, [a0]), window=w1)),
            check('carryover', 'Settled water starting to carry floc', 'supporting', MATCH if st_ok else NO_MATCH,
                  f'Settled turbidity {num(settled[st_k], 2)} NTU at {ts[st_k]} against {num(st0, 2)} NTU this '
                  f'morning ({signed(settled[st_k] - st0, 2)} NTU).',
                  'The consequence that matters: floc leaving over the weir loads the filters. It moves only once the '
                  'blanket is high, which is what the blanket level predicted.',
                  spark(settled, nice_domain(settled, [st0]), threshold_value=st0 + p['settled_rise_ntu'], window=w1)),
            check('cleared', 'The blanket dropped as soon as an extra cycle ran', 'supporting',
                  MATCH if cleared else PENDING,
                  (f'Collector travel speed up to {num(max(speed[cleared[0]:cleared[1] + 1]), 0)} % from {ts[cleared[0]]} '
                   f'(normally {num(sp0, 0)} %); blanket {num(bl[cleared[0]], 1)} % → {num(bl[cleared[1]], 1)} % by '
                   f'{ts[cleared[1]]} and {num(bl[now], 1)} % now.' if cleared else
                   'No extra desludge cycle in the data yet.'),
                  'Desludging is the only thing that was changed, and the blanket came down within minutes. That '
                  'closes the mass balance: the way out was the problem.',
                  spark(bl, bd, threshold_value=p['blanket_pct'],
                        highlight=[ts[cleared[0]], ts[cleared[1]]] if cleared else None)),
        ]
        main = chart('% of basin depth', bd,
                     [series('actual', f'{tn} sludge blanket', bl, 'primary', 1),
                      series('expected', 'In balance (this morning\'s level)', [b0] * pack.n, 'expected', 1)],
                     title='What we see',
                     caption=f'{tn} sludge blanket against the level it held while solids in and solids out were in '
                             f'balance. Carryover starts around {num(p["blanket_pct"], 0)} %; the weir is at '
                             f'{num(p["weir_pct"], 0)} %.',
                     shade_gap=['actual', 'expected'], decimals=0,
                     thresholds=[threshold(p['blanket_pct'], 'Carryover'), threshold(p['weir_pct'], 'Weir')],
                     markers=[marker(ts[onset], 'Rise begins'), marker(ts[peak], 'Peak')]
                     + ([marker(ts[cleared[0]], 'Extra desludge')] if cleared else []))

        grid = hours_grid(3, 0.25)
        r = Rng(4202)
        tb = [(33 + 13.0 * hh if hh <= 1.75 else 55.8 - 28 * (hh - 1.75)) + r.gauss(0.4) for hh in grid]
        tb_c = [(15 + 6.0 * min(hh, 1.75) if hh <= 1.75 else 13.0) + r.gauss(0.2) for hh in grid]
        vr = [(33 + 11.0 * hh) + r.gauss(0.4) for hh in grid]
        vr_c = [15.2 + r.gauss(0.2) for hh in grid]
        la = [(33 + 9.0 * hh if hh < 0.75 else 39.8 + 1.0 * (hh - 0.75)) + r.gauss(0.4) for hh in grid]
        la_c = [(15 - 2.5 * min(hh, 0.75)) + r.gauss(0.2) for hh in grid]
        live = f'{tn}, today'
        live_b = aligned(bl, onset, pack.step_min, grid)
        live_c = aligned(cyc, onset, pack.step_min, grid)

        def pair(a, b):
            return [ref_chart('Sludge blanket (h from the start of the rise)', '% of depth', [28, 72], grid, 'h', a,
                              live_b, live, 0, [threshold(p['blanket_pct'], 'Carryover'),
                                                threshold(p['weir_pct'], 'Weir')]),
                    ref_chart('Desludge cycle time', 'min', [10, 28], grid, 'h', b, live_c, live, 0)]
        refs = [
            reference('behind', 'textbook', 'Textbook', 'Desludging left behind by the solids load',
                      'Raw turbidity steps up, the auto-cycle timer stays where it was, and the blanket climbs at a '
                      'near-constant rate for hours. An extra cycle at raised travel speed pulls it straight back '
                      'down, and the timer is re-set for the new loading.', 'match', 'Closest match',
                      ['Same straight climb', 'Same cure: one extra cycle' if cleared else 'Cure: one extra cycle',
                       'Timer worth re-checking against raw turbidity'], pair(tb, tb_c)),
            reference('drive', 'variant', 'Variant', 'Collector drive slipping or chain jammed',
                      'The same rise, but from the other side of the balance: the collector is cycling on time and '
                      'simply is not moving sludge. Travel speed drops away and motor current spikes or collapses.',
                      'partial', 'Same symptom, different cause',
                      [f'Here cycle time stretched {signed(cyc_pct, 0)} % — the drive was running, just not often '
                       f'enough', 'Check travel speed and current before the timer'], pair(vr, vr_c)),
            reference('kept', 'lookalike', 'Look-alike', 'Solids surge the desludging kept up with',
                      'Raw turbidity rises the same way, but the cycle shortens with it. The blanket lifts a few '
                      'points and flattens below the carryover level. Nothing to do.',
                      'nomatch', 'Does not match',
                      [f'Today the blanket went to {num(bl[peak], 1)} %, not a few points',
                       'There the cycle time came down; here it went up'], pair(la, la_c)),
        ]
        ro = [
            ruled_out('A plant-wide solids load', 'ruled out',
                      f'{join_names([tname(pack, o) for o in peer_net])} all held their blankets within '
                      f'{signed(max(peer_net.values()), 1)} points on the same source water while this one gained '
                      f'{signed(own_net, 1)}.'),
            ruled_out('A basin level change making the blanket read high', 'ruled out',
                      f'Basin level stayed within {num(lev_dev, 1)} % of {num(c["l0"], 1)} %, worth '
                      f'{num(lev_explains, 1)} points of blanket reading against the {num(own_net, 1)} points it '
                      f'actually gained.'),
            ruled_out('The collector stopped or jammed', 'ruled out',
                      f'It kept running the whole time: travel speed {num(min(speed[onset:now + 1]), 0)}–'
                      f'{num(max(speed[onset:now + 1]), 0)} % and current {num(min(amp[onset:now + 1]), 1)}–'
                      f'{num(max(amp[onset:now + 1]), 1)} A. The cycle got longer, not absent.'),
            ruled_out('More flow through the basin', 'ruled out',
                      f'Weir overflow rate stayed within {num(weir_dev, 1)} % of {num(w0, 0)} gpd/ft '
                      f'(band ±{num(p["weir_band_pct"], 0)} %), so the basin was not being pushed harder.'),
            ruled_out('A blanket-sensor fault', 'ruled out' if amp_ok else 'unlikely',
                      (f'Two other things agree with it: collector current rose {signed(amp_pct, 0)} % as the '
                       f'blanket '
                       f'thickened, and settled turbidity rose {signed(settled[st_k] - st0, 2)} NTU once it passed '
                       f'{num(p["blanket_pct"], 0)} %.' if amp_ok else
                       'The collector current barely moved, so the sensor has not been independently confirmed.')),
        ]
        return {
            'conclusion': conclusion(
                'Cause' if level == 'high' else 'Most likely cause',
                f'Solids into the {tn} basin went up ({signed(raw_pct, 0)} % raw turbidity) while the desludge cycle '
                f'stretched {signed(cyc_pct, 0)} %, so the blanket gained {num(bl[peak] - bl[onset], 0)} points in '
                f'{dur(pack.minutes_between(onset, peak))}'
                + ('; an extra cycle brought it back' if cleared else ''),
                level,
                'Confirmed: the blanket fell as soon as an extra cycle ran' if level == 'high' else
                'Raw water and collector data agree' if level == 'medium' else 'Blanket level only'),
            'rootCauseAssetId': coll,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(
                level,
                'Both sides of the balance are measured: the intake analyser shows more solids arriving and the '
                'collector shows longer gaps between sweeps. The blanket, the collector current and the settled-water '
                'turbidimeter are three separate instruments and all three moved together'
                + (f'. An extra cycle at {ts[cleared[0]]} reversed it within '
                   f'{dur(pack.minutes_between(cleared[0], cleared[1]))}.' if cleared else '.'),
                None if level == 'high' else 'Nothing has been changed yet, so the mass balance has not been tested.',
                None if level == 'high' else 'The blanket falls after an extra desludge cycle.',
                'The blanket keeps rising after an extra cycle. Then the collector is not clearing the hopper — check '
                'the drive, the chain and the sludge line.',
                (f'Blanket {num(bl[cleared[0]], 1)} % → {num(bl[cleared[1]], 1)} % after the extra cycle at '
                 f'{ts[cleared[0]]}' if cleared else None)),
            'action': action(item, pack),
            'model': {'target': 'sludge_blanket_level_pct',
                      'formula': f'{num(b0, 1)} % of basin depth, the level it held while in balance',
                      'fittedOn': f'{tn}\'s own first {dur(p["baseline_min"])}'},
            'impact': ((f'At {signed(rate, 1)} %/h the blanket would have reached the weir at '
                        f'{num(p["weir_pct"], 0)} % in about {dur(to_weir)}, around '
                        f'{clock(tmin(pack, i) + to_weir)}. ' if to_weir else '')
                       + (f'It peaked at {num(bl[peak], 1)} % and was back to {num(bl[now], 1)} % by {ts[now]}; '
                          f'settled turbidity gave up {signed(settled[st_k] - st0, 2)} NTU on the way and filter '
                          f'effluent never moved.' if cleared else
                          f'It is at {num(bl[now], 1)} % now.')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Filter media fouling — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class FilterMediaFouling(Detector):
    id = 'water.filter_media_fouling'
    name = 'Filter media fouling'
    version = '0.1'
    archetype = '03 Quiet drift'
    applies_to = 'filtration stages'
    summary = ('Headloss climbing several times faster than the other filters through an uninterrupted run, with the '
               'filtered water still well inside its limit and no extra solids arriving — resistance building in the '
               'bed itself, so every run is shorter than the last.')
    pipeline = [
        ('One run only', 'take a window with no backwash in it; a reset makes the slope meaningless'),
        ('Rate', 'headloss slope over the window, in ft/h, and the largest single 5-minute step'),
        ('Water quality', 'filter effluent turbidity, which says whether the bed is still catching solids'),
        ('Load', 'settled-water turbidity into this filter against the other five'),
        ('Peers', 'the same slope on the other filters, which take the same kind of water'),
        ('Conclusion', 'fast, steady, clean and unexplained by load → raise; the bed ΔP agrees → medium'),
    ]
    definition = {
        'appliesTo': {'assetType': 'filtration'},
        'inputs': {'headloss': 'self.headloss_ft', 'effluent': 'self.filter_effluent_turbidity_ntu',
                   'runtime': 'self.filter_run_time_hrs', 'ufrv': 'self.unit_filter_run_volume_gal_sf',
                   'bed': 'child filter_bed.differential_pressure_psi',
                   'settled': 'upstream sedimentation.settled_water_turbidity_ntu (process_flow)',
                   'peers': 'the other five filtration stages', 'work': 'open inspection items on this stage'},
        'peers': {'same': 'assetType', 'count': 5,
                  'use': 'the normal headloss rate for this water, and the load each filter is taking'},
        'expected': {'model': 'peer headloss rate', 'target': 'headloss_ft',
                     'formula': 'median slope of the other filters over the same window, in ft/h',
                     'fitOn': 'the five other filters, on points with no backwash in the window'},
        'params': {'window_min': 120, 'slope_ft_h': 0.20, 'step_ft': 0.15, 'reset_drop_ft': 1.0,
                   'eff_limit_ntu': 0.15, 'ife_limit_ntu': 0.30, 'load_band_pct': 25.0, 'peer_slope_ft_h': 0.18,
                   'runtime_drop_pct': 20.0, 'ufrv_drop_pct': 20.0, 'bed_rise_pct': 10.0, 'alarm_ft': 6.0},
        'checks': [
            {'id': 'rate', 'role': 'required',
             'rule': 'headloss slope over window_min > slope_ft_h, with no backwash in the window'},
            {'id': 'steady', 'role': 'required', 'rule': 'largest single-interval headloss step < step_ft'},
            {'id': 'clean', 'role': 'required', 'rule': 'filter effluent turbidity below eff_limit_ntu throughout'},
            {'id': 'load', 'role': 'required',
             'rule': 'settled-water turbidity into this filter within ±load_band_pct of the peer median'},
            {'id': 'peers', 'role': 'required', 'rule': 'every other filter\'s slope below peer_slope_ft_h'},
            {'id': 'bed', 'role': 'supporting', 'independent': True,
             'rule': 'filter-bed differential pressure up more than bed_rise_pct'},
            {'id': 'runtime', 'role': 'supporting', 'rule': 'projected run length down more than runtime_drop_pct'},
            {'id': 'ufrv', 'role': 'supporting', 'rule': 'unit filter run volume down more than ufrv_drop_pct'},
            {'id': 'inspection', 'role': 'supporting', 'independent': True,
             'rule': 'a bed inspection has been raised and reported'},
        ],
        'ruleOut': ['more solids arriving (upstream upset)', 'floc breakthrough late in the run',
                    'a headloss transmitter fault', 'a backwash that did not finish',
                    'higher filtration rate (more flow)'],
        'confidence': {'low': 'required checks only',
                       'medium': 'the filter bed\'s own differential pressure agrees',
                       'high': 'a bed inspection or a media core confirms it'},
        'references': ['textbook: mudballs in the bed', 'variant: media loss', 'look-alike: solids load after a storm'],
    }

    def candidates(self, pack):
        return pack.of_type('filtration')

    def _ctx(self, pack, aid):
        p = self.p
        bed = pack.child_of_type(aid, 'filter_bed')
        sed = prev_stage(pack, aid) or stage_of(pack, aid, 'sedimentation')
        if bed is None or sed is None:
            return None
        hl = pack.series(aid, 'headloss_ft')
        resets = [k for k in range(1, pack.n) if hl[k - 1] - hl[k] > p['reset_drop_ft']]
        wnd = pack.steps(p['window_min'])
        slope = []
        for k in range(pack.n):
            k0 = k - wnd
            if k0 < 0 or any(k0 < r <= k for r in resets):
                slope.append(None)
            else:
                slope.append(B.slope_per_hour(hl, k, wnd + 1, pack.step_min))
        return dict(bed=bed, sed=sed, hl=hl, resets=resets, slope=slope, wnd=wnd)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        hl, slope, wnd = c['hl'], c['slope'], c['wnd']
        eff = pack.series(aid, 'filter_effluent_turbidity_ntu')
        settled = pack.series(c['sed'], 'settled_water_turbidity_ntu')
        peer_ctx = {}
        for o in peers_of(pack, aid):
            co = self._ctx(pack, o)
            if co:
                peer_ctx[o] = co
        if not peer_ctx:
            return Finding(aid, False)
        for i in range(pack.n):
            if slope[i] is None or slope[i] <= p['slope_ft_h']:
                continue
            k0 = i - wnd
            if B.max_step(hl, k0 + 1, i) >= p['step_ft']:
                continue
            if max(eff[k0:i + 1]) >= p['eff_limit_ntu']:
                continue
            peer_load = median([median(pack.series(co['sed'], 'settled_water_turbidity_ntu')[k0:i + 1])
                                for co in peer_ctx.values()])
            if abs(pct(median(settled[k0:i + 1]), peer_load)) > p['load_band_pct']:
                continue
            best_peer = max((co['slope'][i] or 0.0) for co in peer_ctx.values())
            if best_peer > p['peer_slope_ft_h']:
                continue
            c.update(onset=k0, eff=eff, settled=settled, peer_ctx=peer_ctx, peer_load=peer_load)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        bed, sed = c['bed'], c['sed']
        hl, slope, wnd, onset = c['hl'], c['slope'], c['wnd'], c['onset']
        eff, settled, peer_ctx = c['eff'], c['settled'], c['peer_ctx']
        rate_now = slope[now] if slope[now] is not None else slope[i]
        peer_rates = {o: co['slope'][now] if co['slope'][now] is not None else co['slope'][i]
                      for o, co in peer_ctx.items()}
        peer_rates = {o: v for o, v in peer_rates.items() if v is not None}
        peer_med = median(list(peer_rates.values()))
        exp = [hl[0] + peer_med * (k * pack.step_min / 60.0) for k in range(pack.n)]
        step = B.max_step(hl, 1, now)
        rt = pack.series(aid, 'filter_run_time_hrs')
        rt_pct = pct(rt[now], rt[0])
        rt_ok = rt_pct < -p['runtime_drop_pct']
        uf = pack.series(aid, 'unit_filter_run_volume_gal_sf')
        uf_pct = pct(uf[now], uf[0])
        uf_ok = uf_pct < -p['ufrv_drop_pct']
        dp = pack.series(bed, 'differential_pressure_psi')
        dp0 = median(dp[:pack.steps(60)])
        dp_pct = pct(dp[now], dp0)
        dp_ok = dp_pct > p['bed_rise_pct']
        bw = pack.series(aid, 'backwash_frequency_per_week')
        insp = open_work(pack, [aid, bed], types=('INSPECTION', 'MAINTENANCE'))
        done_insp = [w for w, _ in done_work(pack, [aid, bed], types=('INSPECTION',))]
        level = 'high' if done_insp else ('medium' if dp_ok else 'low')
        to_alarm = (p['alarm_ft'] - hl[now]) / rate_now * 60 if rate_now and rate_now > 0 else None
        hd = nice_domain(hl, exp, [p['alarm_ft']], pad=0.05)
        peer_worst = max(peer_rates, key=lambda o: peer_rates[o])

        checks = [
            check('rate', 'Headloss climbing several times faster than the other filters', 'required', MATCH,
                  f'{num(rate_now, 2)} ft/h over the last {dur(p["window_min"])} against {num(peer_med, 2)} ft/h on '
                  f'the other five ({num(rate_now / peer_med, 1)}×). {num(hl[0], 2)} ft at {ts[0]} → '
                  f'{num(hl[now], 2)} ft now, with no backwash in between.',
                  'Headloss is the pressure it takes to push water through the bed. At a steady load it climbs at a '
                  'steady rate; a faster rate means the bed is holding more resistance than the solids explain.',
                  spark([s if s is not None else None for s in slope],
                        nice_domain([s for s in slope if s is not None], [0, p['slope_ft_h']]),
                        threshold_value=p['slope_ft_h'])),
            check('steady', 'A creep, not a step', 'required', MATCH,
                  f'Largest single 5-minute change {num(step, 2)} ft, against a {num(p["step_ft"], 2)} ft limit; '
                  f'{num(hl[now] - hl[0], 2)} ft gained over {dur(pack.minutes_between(0, now))}.',
                  'Fouling accumulates grain by grain. A valve moving, a flow change or a transmitter fault shows up '
                  'as one jump instead.',
                  spark(hl, hd)),
            check('clean', 'Filtered water still well inside its limit', 'required', MATCH,
                  f'Filter effluent {num(min(eff), 2)}–{num(max(eff), 2)} NTU all shift, against a '
                  f'{num(p["ife_limit_ntu"], 1)} NTU regulatory limit and a {num(p["eff_limit_ntu"], 2)} NTU check '
                  f'level.',
                  'The bed is still doing its job: it is catching solids, not passing them. That is what separates '
                  'fouling from breakthrough, where turbidity rises before headloss does.',
                  spark(eff, [0, p['ife_limit_ntu'] * 1.1], threshold_value=p['eff_limit_ntu'])),
            check('load', 'No extra solids arriving', 'required', MATCH,
                  f'Settled water into this filter {num(median(settled[onset:now + 1]), 2)} NTU against '
                  f'{num(c["peer_load"], 2)} NTU median on the other trains '
                  f'({signed(pct(median(settled[onset:now + 1]), c["peer_load"]), 0)} %; band '
                  f'±{num(p["load_band_pct"], 0)} %).',
                  'A filter fed dirtier water loads up faster, and that would be the upstream\'s problem, not the '
                  'bed\'s. This filter is taking the same water as the rest.',
                  spark(settled, nice_domain(settled, [c['peer_load']]))),
            check('peers', 'The other five filters rising normally', 'required', MATCH,
                  f'{join_names([f"{tname(pack, o)} {num(v, 2)}" for o, v in peer_rates.items()])} ft/h, all under '
                  f'the {num(p["peer_slope_ft_h"], 2)} ft/h limit.',
                  'Same raw water, same coagulant, same filtration rate. If the water were the cause, every bed '
                  'would be loading like this one.',
                  spark(peer_ctx[peer_worst]['hl'], hd)),
            check('bed', 'The bed\'s own differential pressure agrees', 'supporting', MATCH if dp_ok else NO_MATCH,
                  f'Filter-bed ΔP {num(dp[now], 2)} psi now against {num(dp0, 2)} psi in the first hour '
                  f'({signed(dp_pct, 0)} %).',
                  'A separate transmitter across the bed, not the headloss gauge. Two instruments on different taps '
                  'reading the same rise means the resistance is in the media.',
                  spark(dp, nice_domain(dp, [dp0]), threshold_value=dp0 * (1 + p['bed_rise_pct'] / 100))),
            check('runtime', 'Run length shortening', 'supporting', MATCH if rt_ok else NO_MATCH,
                  f'Projected run {num(rt[now], 0)} h now against {num(rt[0], 0)} h at shift start '
                  f'({signed(rt_pct, 0)} %), so backwash frequency goes from {num(bw[0], 1)} to '
                  f'{num(bw[now], 1)} per week.',
                  'The run ends when headloss reaches terminal. A steeper climb from the same start means a shorter '
                  'run and more backwashes, which is where the cost shows up.',
                  spark(rt, nice_domain(rt), threshold_value=rt[0] * (1 - p['runtime_drop_pct'] / 100))),
            check('ufrv', 'Less water per square foot per run', 'supporting', MATCH if uf_ok else NO_MATCH,
                  f'Unit filter run volume {num(uf[now], 0)} gal/ft² against {num(uf[0], 0)} gal/ft² at shift start '
                  f'({signed(uf_pct, 0)} %).',
                  'UFRV is the production a filter gets out of one run. It falls with run length, and it is the '
                  'number that says how much net water the fouling is costing.',
                  spark(uf, nice_domain(uf))),
            check('inspection', 'Bed inspection result', 'supporting',
                  MATCH if done_insp else (PENDING if insp else NO_MATCH),
                  (f'"{done_insp[0]["text"]}" completed {wtime(done_insp[0])}.' if done_insp else
                   f'"{insp[0]["text"]}" raised, due {hhmm(insp[0]["dueAt"])} — not done yet.' if insp else
                   'No bed inspection raised.'),
                  'Only a look in the bed separates mudballs from media loss or a gravel upset. Until then this stays '
                  'a trend, not a diagnosis.',
                  None),
        ]
        main = chart('ft', hd,
                     [series('actual', f'{tn} headloss', hl, 'primary', 2),
                      series('expected', f'At the other filters\' rate ({num(peer_med, 2)} ft/h)', exp, 'expected', 2)]
                     + [series(f'p{k}', tname(pack, o), peer_ctx[o]['hl'], 'peer', 2)
                        for k, o in enumerate(sorted(peer_ctx)[:2])],
                     title='What we see',
                     caption=f'{tn} filter headloss against what the same run would have cost at the other filters\' '
                             f'rate. The gap is resistance the solids load does not explain.',
                     shade_gap=['actual', 'expected'], decimals=1,
                     thresholds=[threshold(p['alarm_ft'], 'Backwash alarm')],
                     markers=[marker(ts[i], 'Flagged')])

        grid = hours_grid(8, 0.5)
        r = Rng(4303)
        tb = [2.5 + 0.33 * hh + 0.004 * hh * hh + r.gauss(0.03) for hh in grid]
        tb_e = [0.08 + r.gauss(0.004) for hh in grid]
        vr = [2.5 + 0.30 * hh + r.gauss(0.03) for hh in grid]
        vr_e = [0.08 + (0.0 if hh < 4 else 0.055 * (hh - 4)) + r.gauss(0.004) for hh in grid]
        la = [2.5 + (0.09 * hh if hh < 2 else 0.09 * 2 + 0.45 * (hh - 2)) + r.gauss(0.03) for hh in grid]
        la_e = [0.08 + (0.0 if hh < 1.5 else 0.02) + r.gauss(0.004) for hh in grid]
        live = f'{tn}, today'
        live_h = aligned(hl, 0, pack.step_min, grid)
        live_e = aligned(eff, 0, pack.step_min, grid)

        def pair(a, b):
            return [ref_chart('Headloss through one run (h from the start of the run)', 'ft', [2, 7], grid, 'h', a,
                              live_h, live, 1, [threshold(p['alarm_ft'], 'Alarm')]),
                    ref_chart('Filter effluent turbidity', 'NTU', [0, 0.35], grid, 'h', b, live_e, live, 2,
                              [threshold(p['ife_limit_ntu'], 'Limit')])]
        refs = [
            reference('mudball', 'textbook', 'Textbook', 'Mudballs and surface crust in the bed',
                      'Incomplete backwashes leave floc behind; it rolls into mudballs that block part of the bed. '
                      'The water goes through what is left, so headloss climbs three or four times faster while '
                      'filtered turbidity stays excellent. Found by probing the bed; fixed by air scour or an '
                      'extended wash.', 'match', 'Closest match',
                      [f'Same rate: {num(rate_now, 2)} ft/h against {num(peer_med, 2)} ft/h normal',
                       'Same clean filtered water', 'Needs the bed opened to be sure'], pair(tb, tb_e)),
            reference('medialoss', 'variant', 'Variant', 'Media loss leaving a short bed',
                      'Repeated washes carry fine media out. Headloss climbs for the same reason — less bed doing the '
                      'work — but a short bed eventually lets floc through, so turbidity creeps up late in the run.',
                      'partial', 'Same rate, different end',
                      [f'Today filtered water held at {num(max(eff), 2)} NTU',
                       'A core sample tells the two apart', 'Worth measuring bed depth at the same visit'],
                      pair(vr, vr_e)),
            reference('storm', 'lookalike', 'Look-alike', 'Heavy solids load after a storm',
                      'Headloss climbs just as fast, but because the water is dirtier: settled turbidity rose first, '
                      'and every filter on the plant loads up together. The bed is fine.',
                      'nomatch', 'Does not match',
                      [f'Settled water here is {signed(pct(median(settled[onset:now + 1]), c["peer_load"]), 0)} % off '
                       f'the other trains, not high',
                       f'The other five filters are rising at {num(peer_med, 2)} ft/h'], pair(la, la_e)),
        ]
        ro = [
            ruled_out('More solids arriving from upstream', 'ruled out',
                      f'Settled water into this filter is {num(median(settled[onset:now + 1]), 2)} NTU against '
                      f'{num(c["peer_load"], 2)} NTU on the other trains, and this train\'s raw turbidity and '
                      f'coagulant dose are both normal.'),
            ruled_out('Floc breakthrough late in the run', 'ruled out',
                      f'Breakthrough shows as turbidity rising before headloss tops out. Filter effluent stayed '
                      f'{num(min(eff), 2)}–{num(max(eff), 2)} NTU, about a third of the '
                      f'{num(p["ife_limit_ntu"], 1)} NTU limit.'),
            ruled_out('A headloss transmitter fault', 'ruled out' if dp_ok else 'unlikely',
                      (f'The filter bed\'s own ΔP transmitter rose {signed(dp_pct, 0)} % over the same hours — a '
                       f'second instrument on a different tap.' if dp_ok else
                       'The bed ΔP has not moved enough yet to confirm the headloss reading independently.')),
            ruled_out('A backwash that did not finish', 'ruled out',
                      f'There was no backwash on this filter at all today: headloss never dropped more than '
                      f'{num(p["reset_drop_ft"], 1)} ft, and the backwash pump held '
                      f'{num(min(pack.series(pack.child_of_type(aid, "backwash_pump"), "flow_rate_gpm")), 0)}–'
                      f'{num(max(pack.series(pack.child_of_type(aid, "backwash_pump"), "flow_rate_gpm")), 0)} gpm '
                      f'with no wash step. The climb is one uninterrupted run.'),
            ruled_out('A higher filtration rate (more flow through this filter)', 'ruled out',
                      f'Train throughput {num(min(pack.series(pack.unit_of(aid), "line_throughput")), 2)}–'
                      f'{num(max(pack.series(pack.unit_of(aid), "line_throughput")), 2)} MGD all shift, and the weir '
                      f'loading upstream is flat, so the bed is taking the same gpm/ft² as this morning.'),
        ]
        return {
            'conclusion': conclusion(
                'Most likely cause',
                f'Resistance building inside the {tn} filter bed — mudballs or lost media depth — climbing '
                f'{num(rate_now / peer_med, 1)}× faster than the other filters while the filtered water stays clean',
                level,
                'Bed inspection confirms it' if level == 'high' else
                'Headloss and the bed\'s own ΔP agree' if level == 'medium' else 'One instrument only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                f'Two instruments on the filter (headloss and bed ΔP) agree, the load into it matches the other '
                f'trains, and all five of them are rising at {num(peer_med, 2)} ft/h. That places the extra '
                f'resistance in this bed.',
                'Nobody has been in the bed. From the trend alone, mudballs, a surface crust and lost media depth '
                'look the same; they need different work.',
                'The bed inspection finds mudballs, a crust, or bed depth below spec.',
                'The bed probes clean and measures full depth. Then look at the underdrain and the gravel layer, '
                'and re-check the backwash rate and duration.',
                None),
            'action': action(item, pack),
            'model': {'target': 'headloss_ft',
                      'formula': f'start {num(hl[0], 2)} ft + {num(peer_med, 2)} ft/h × hours into the run',
                      'fittedOn': f'the other five filters\' slope over the same {dur(p["window_min"])} window'},
            'impact': ((f'At {num(rate_now, 2)} ft/h this run reaches the {num(p["alarm_ft"], 1)} ft backwash alarm in '
                        f'about {dur(to_alarm)}, around {clock(tmin(pack, now) + to_alarm)}. ' if to_alarm else '')
                       + f'Projected run length is down from {num(rt[0], 0)} h to {num(rt[now], 0)} h and UFRV from '
                         f'{num(uf[0], 0)} to {num(uf[now], 0)} gal/ft², about '
                         f'{num(abs(uf_pct), 0)} % less water per run — more backwash water, less net production.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Settled-water turbidimeter fault — archetype 06 (instrument, not process)
# ═════════════════════════════════════════════════════════════════════════
class SettledTurbidimeterFault(Detector):
    id = 'water.settled_turbidimeter_fault'
    name = 'Settled-water turbidimeter fault'
    version = '0.1'
    archetype = '06 Signal noise'
    applies_to = 'sedimentation stages'
    summary = ('A settled-water turbidimeter swinging by whole NTU between one five-minute sample and the next, '
               'while the filter it feeds, the blanket under it, the dose ahead of it and the other five basins all '
               'stay flat. Nothing physical can move that fast and leave no trace.')
    pipeline = [
        ('Erratic', 'count sample-to-sample jumps bigger than step_ntu in a one-hour window, and the direction changes'),
        ('Downstream', 'the filter this basin feeds, over the same window plus one residence time'),
        ('Upstream', 'raw turbidity and coagulant dose — is there anything that could make settled water move?'),
        ('The basin', 'blanket level, the one thing that puts floc over the weir'),
        ('Other basins', 'the same signal on the other five trains'),
        ('Conclusion', 'erratic with nothing confirming it → the instrument; a grab sample and a clean-up → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'sedimentation'},
        'inputs': {'settled': 'self.settled_water_turbidity_ntu', 'blanket': 'self.sludge_blanket_level_pct',
                   'effluent': 'downstream filtration.filter_effluent_turbidity_ntu (process_flow)',
                   'raw': 'same train intake.raw_water_turbidity_ntu',
                   'dose': 'same train coagulation.coagulant_dose_mg_l',
                   'floc': 'upstream flocculation.floc_size_index',
                   'peers': 'the other five sedimentation stages',
                   'work': 'done instrument-check work items on this stage'},
        'peers': {'same': 'assetType', 'count': 5, 'use': 'how steady this signal normally is across the plant'},
        'expected': {'model': 'steady process', 'target': 'settled_water_turbidity_ntu',
                     'formula': 'median(reading over the hour before the swings) — the water either side of the '
                                'episode',
                     'fitOn': 'this basin\'s own reading before and after the episode'},
        'params': {'window_min': 60, 'step_ntu': 0.4, 'min_steps': 4, 'min_reversals': 3, 'eff_step_ntu': 0.03,
                   'lag_min': 25, 'raw_band_pct': 25.0, 'dose_band_pct': 8.0, 'blanket_band_pct': 3.0,
                   'peer_step_ntu': 0.25, 'shift_ntu': 0.2, 'quiet_min': 45},
        'checks': [
            {'id': 'erratic', 'role': 'required',
             'rule': '≥ min_steps sample-to-sample jumps > step_ntu within window_min, with ≥ min_reversals '
                     'direction changes'},
            {'id': 'filter', 'role': 'required',
             'rule': 'filter effluent turbidity moves less than eff_step_ntu over the window plus lag_min'},
            {'id': 'upstream', 'role': 'required',
             'rule': 'raw turbidity within ±raw_band_pct and coagulant dose within ±dose_band_pct over the window'},
            {'id': 'blanket', 'role': 'required', 'rule': 'blanket level within ±blanket_band_pct of its own level'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'no peer basin jumps more than peer_step_ntu'},
            {'id': 'nofloc', 'role': 'supporting', 'independent': True, 'rule': 'floc size index steady through the window'},
            {'id': 'noshift', 'role': 'supporting',
             'rule': 'the mean reading before and after the episode differ by less than shift_ntu'},
            {'id': 'cleaned', 'role': 'supporting', 'independent': True,
             'rule': 'after a done instrument check, no jump above step_ntu for quiet_min'},
        ],
        'ruleOut': ['a real settled-water turbidity event', 'floc carryover from the blanket',
                    'a coagulation upset', 'a raw-water change', 'a plant-wide analyser or calculation fault'],
        'confidence': {'low': 'required checks only',
                       'medium': 'an independent measurement (the downstream filter, the floc index) stays flat',
                       'high': 'a grab sample disagreed with the sensor and cleaning restored agreement'},
        'references': ['textbook: fouled optics or bubbles', 'variant: loose sample line',
                       'look-alike: real floc carryover'],
    }

    def candidates(self, pack):
        return pack.of_type('sedimentation')

    def _jumps(self, pack, aid):
        p = self.p
        st = pack.series(aid, 'settled_water_turbidity_ntu')
        d = [None] + [st[k] - st[k - 1] for k in range(1, pack.n)]
        big = [k for k in range(1, pack.n) if abs(d[k]) > p['step_ntu']]
        return st, d, big

    def evaluate(self, pack, aid):
        p = self.p
        st, d, big = self._jumps(pack, aid)
        if len(big) < p['min_steps']:
            return Finding(aid, False)
        filt = next_stage(pack, aid) or stage_of(pack, aid, 'filtration')
        intake = stage_of(pack, aid, 'intake')
        coag = stage_of(pack, aid, 'coagulation')
        if filt is None or intake is None or coag is None:
            return Finding(aid, False)
        eff = pack.series(filt, 'filter_effluent_turbidity_ntu')
        raw = pack.series(intake, 'raw_water_turbidity_ntu')
        dose = pack.series(coag, 'coagulant_dose_mg_l')
        bl = pack.series(aid, 'sludge_blanket_level_pct')
        w = pack.steps(p['window_min'])
        lag = pack.steps(p['lag_min'])
        nb = pack.steps(p['window_min'])
        for i in range(w, pack.n):
            k0 = i - w
            recent = [k for k in big if k0 < k <= i]
            if len(recent) < p['min_steps']:
                continue
            rev = sum(1 for a, b in zip(recent, recent[1:]) if d[a] * d[b] < 0)
            if rev < p['min_reversals']:
                continue
            if B.max_step(eff, k0 + 1, min(pack.n - 1, i + lag)) > p['eff_step_ntu']:
                continue
            r0 = median(raw[:nb])
            if max(abs(pct(v, r0)) for v in raw[k0:i + 1]) > p['raw_band_pct']:
                continue
            d0 = median(dose[:nb])
            if max(abs(pct(v, d0)) for v in dose[k0:i + 1]) > p['dose_band_pct']:
                continue
            b0 = median(bl[:nb])
            if max(abs(v - b0) for v in bl[k0:i + 1]) > p['blanket_band_pct']:
                continue
            onset = recent[0] - 1
            return Finding(aid, True, i, st=st, d=d, big=big, filt=filt, intake=intake, coag=coag,
                           eff=eff, raw=raw, dose=dose, bl=bl, onset=onset, r0=r0, d0=d0, b0=b0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        st, d, big = c['st'], c['d'], c['big']
        eff, raw, dose, bl = c['eff'], c['raw'], c['dose'], c['bl']
        onset = c['onset']
        lag = pack.steps(p['lag_min'])
        last = big[-1]
        episode = [k for k in big]
        lo_k = min(range(onset, last + 1), key=lambda k: st[k])
        hi_k = max(range(onset, last + 1), key=lambda k: st[k])
        before = mean_between(st, max(0, onset - pack.steps(60)), onset)
        after = mean_between(st, min(now, last + 1), now)
        shift = abs(after - before)
        noshift_ok = shift < p['shift_ntu']
        rev = sum(1 for a, b in zip(big, big[1:]) if d[a] * d[b] < 0)
        eff_step = B.max_step(eff, onset, min(now, last + lag))
        floc_stage = prev_stage(pack, aid) or stage_of(pack, aid, 'flocculation')
        fsz = pack.series(floc_stage, 'floc_size_index')
        fs_dev = max(abs(v - median(fsz[:pack.steps(60)])) for v in fsz[onset:last + 1])
        floc_ok = fs_dev < 3.0
        peer_step = {}
        for o in peers_of(pack, aid):
            ost, od, obig = self._jumps(pack, o)
            peer_step[o] = B.max_step(ost, 1, now)
        peers_ok = all(v <= p['peer_step_ntu'] for v in peer_step.values())
        checks_done = [(w, k) for w, k in done_work(pack, [aid], types=('INSTRUMENT_CHECK', 'MAINTENANCE'))
                       if k >= onset]
        fix = checks_done[0] if checks_done else None
        cleaned = False
        if fix:
            k1 = fix[1] + pack.steps(p['quiet_min'])
            cleaned = k1 <= now and not [k for k in big if k > fix[1]]
        logs = maintenance_records(item, ts[onset], ['grab sample', 'sensor', 'clean'])
        level = 'high' if (cleaned and logs) else ('medium' if (eff_step <= p['eff_step_ntu'] and floc_ok) else 'low')
        sd = nice_domain(st, pad=0.08, floor=0)
        w1 = win(pack, onset, last, pad=4)
        truth = [before] * pack.n

        checks = [
            check('erratic', 'Reading jumping by whole NTU between samples', 'required', MATCH,
                  f'{len(big)} jumps over {num(p["step_ntu"], 1)} NTU between {ts[onset]} and {ts[last]}, '
                  f'{rev} of them reversals; largest {num(max(abs(d[k]) for k in big), 1)} NTU in one 5-minute step. '
                  f'Low {num(st[lo_k], 1)} NTU at {ts[lo_k]}, high {num(st[hi_k], 1)} NTU at {ts[hi_k]}.',
                  'Settled water comes out of a basin with about half an hour of residence time. That volume cannot '
                  'change its turbidity by 2 NTU and back in five minutes — the mixing alone would not allow it.',
                  spark(st, sd, highlight=[ts[onset], ts[last]])),
            check('filter', 'The filter it feeds never noticed', 'required', MATCH,
                  f'Filter effluent on {tn} moved at most {num(eff_step, 3)} NTU per sample through the episode and '
                  f'the {dur(p["lag_min"])} after it ({num(min(eff[onset:last + lag + 1]), 2)}–'
                  f'{num(max(eff[onset:last + lag + 1]), 2)} NTU), against a {num(p["eff_step_ntu"], 2)} NTU check.',
                  'A real 4.6 NTU slug of settled water arrives at the filter about one residence time later and '
                  'loads it: headloss and effluent turbidity both answer. Neither did.',
                  spark(eff, [0, 0.33], threshold_value=0.3, window=w1)),
            check('upstream', 'Nothing upstream to cause it', 'required', MATCH,
                  f'Raw turbidity {num(min(raw[onset:last + 1]), 1)}–{num(max(raw[onset:last + 1]), 1)} NTU '
                  f'(±{num(p["raw_band_pct"], 0)} % band) and coagulant dose '
                  f'{num(min(dose[onset:last + 1]), 1)}–{num(max(dose[onset:last + 1]), 1)} mg/L '
                  f'(±{num(p["dose_band_pct"], 0)} % band) right through the episode.',
                  'Settled turbidity moves when the water coming in changes or when the coagulant dose does. Both '
                  'were steady, so there was nothing for the basin to react to.',
                  spark(dose, nice_domain(dose, [c['d0']]), window=w1)),
            check('blanket', 'The blanket stayed put', 'required', MATCH,
                  f'Sludge blanket {num(min(bl[onset:last + 1]), 1)}–{num(max(bl[onset:last + 1]), 1)} % of basin '
                  f'depth against {num(c["b0"], 1)} % before the episode, inside '
                  f'±{num(p["blanket_band_pct"], 0)} points.',
                  'The one way a settled-water turbidimeter sees a genuine spike is floc carried over from a high '
                  'blanket. This blanket was nowhere near the carryover level and never moved.',
                  spark(bl, nice_domain(bl, [c['b0']]), window=w1)),
            check('peers', 'The other five basins quiet', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'Largest sample-to-sample move elsewhere: '
                  f'{num(max(peer_step.values()), 2)} NTU on '
                  f'{tname(pack, max(peer_step, key=lambda o: peer_step[o]))}, against '
                  f'{num(max(abs(d[k]) for k in big), 1)} NTU here.',
                  'Six identical turbidimeters on six identical basins. Only this one is noisy, so it is not the '
                  'analyser type, the calculation or a plant-wide upset.',
                  spark(pack.series(max(peer_step, key=lambda o: peer_step[o]), 'settled_water_turbidity_ntu'), sd)),
            check('nofloc', 'Floc coming out of flocculation unchanged', 'supporting', MATCH if floc_ok else NO_MATCH,
                  f'Floc size index moved at most {num(fs_dev, 1)} points from {num(median(fsz[:pack.steps(60)]), 0)} '
                  f'through the episode.',
                  'A separate measurement one stage back. Weak or broken floc is what would really put solids over '
                  'the weir; the floc was the same size all the way through.',
                  spark(fsz, nice_domain(fsz), window=w1)),
            check('noshift', 'Same level before and after', 'supporting', MATCH if noshift_ok else NO_MATCH,
                  f'{num(before, 2)} NTU in the hour before, {num(after, 2)} NTU since {ts[min(now, last + 1)]} '
                  f'({signed(after - before, 2)} NTU).',
                  'The swings came and went without leaving the water any different. A real event changes where the '
                  'process settles; a measurement fault does not.',
                  spark(st, sd, band_lo=[before - p['shift_ntu']] * pack.n, band_hi=[before + p['shift_ntu']] * pack.n)),
            check('cleaned', 'Steady since the sensor was checked and cleaned', 'supporting',
                  MATCH if cleaned else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" completed {wtime(fix[0])}'
                   + (f'; the log records "{logs[0]["description"]}"' if logs else '')
                   + f'. No jump over {num(p["step_ntu"], 1)} NTU in the '
                     f'{dur(pack.minutes_between(fix[1], now))} since.' if cleaned else
                   'No instrument check recorded yet.' if fix is None else
                   f'Checked {wtime(fix[0])}, but the reading has jumped again since.'),
                  'A field operator compared the sensor against a bench meter and cleaned it. The swings stopped and '
                  'the reading sat on the grab-sample value — the fault was in the instrument.',
                  spark(st, sd, highlight=[ts[fix[1]], ts[now]] if fix else None)),
        ]
        main = chart('NTU', sd,
                     [series('actual', f'{tn} settled-water turbidimeter', st, 'primary', 2),
                      series('expected', 'The water either side of the episode', truth, 'expected', 2),
                      series('eff', f'{tn} filter effluent (×10, for scale)', [v * 10 for v in eff], 'secondary', 2)],
                     title='What we see',
                     caption=f'{tn} settled-water reading against the level it sat at before and after. The filter '
                             f'effluent below it, scaled ×10 to be visible, never answered any of the swings.',
                     decimals=1,
                     markers=[marker(ts[onset], 'Swings begin'), marker(ts[hi_k], f'{num(st[hi_k], 1)} NTU')]
                     + ([marker(ts[fix[1]], 'Cleaned')] if fix else []))

        grid = minutes_grid(0, 90, 5)
        r = Rng(4404)
        patt = [0.0, 0.5, -0.2, 1.5, 0.4, 1.8, 2.6, 0.2, 1.7, 0.0, 0.9, 0.7, 0.0, 0.1, -0.1, 0.0, 0.0, 0.0, 0.0]
        tb = [2.0 + (patt[k] if k < len(patt) else 0.0) + r.gauss(0.05) for k in range(len(grid))]
        tb_e = [0.08 + r.gauss(0.003) for _ in grid]
        vr = [2.0 + (0.9 if 20 <= m <= 70 else 0.0) + (0.8 if (m // 5) % 2 else -0.5) * (1 if 20 <= m <= 70 else 0)
              + r.gauss(0.06) for m in grid]
        vr_e = [0.08 + r.gauss(0.003) for _ in grid]
        la = [2.0 + (0.0 if m < 15 else min(2.4, 0.045 * (m - 15))) + r.gauss(0.04) for m in grid]
        la_e = [0.08 + (0.0 if m < 40 else min(0.16, 0.004 * (m - 40))) + r.gauss(0.003) for m in grid]
        live = f'{tn}, today'
        live_s = aligned(st, onset, pack.step_min, grid, 'min')
        live_e = aligned(eff, onset, pack.step_min, grid, 'min')

        def pair(a, b):
            return [ref_chart('Settled-water reading (min from the first swing)', 'NTU', [1.2, 5.2], grid, 'min', a,
                              live_s, live, 1),
                    ref_chart('Filter effluent turbidity', 'NTU', [0, 0.33], grid, 'min', b, live_e, live, 2,
                              [threshold(0.3, 'Limit')])]
        refs = [
            reference('optics', 'textbook', 'Textbook', 'Fouled optics or air bubbles in the sample cell',
                      'Algae film on the lens or bubbles crossing the beam throw the reading up and down by whole '
                      'NTU with nothing else moving. A grab sample on a bench meter settles it in two minutes; '
                      'cleaning the cell and re-zeroing fixes it.', 'match', 'Closest match',
                      ['Same spiky, two-directional pattern', 'Same flat filter effluent',
                       'Confirmed by grab sample' if cleaned else 'Confirm with a grab sample'], pair(tb, tb_e)),
            reference('line', 'variant', 'Variant', 'Loose or partly blocked sample line',
                      'Air drawn into a loose fitting gives the same noise, but usually with the average pulled off '
                      'as well, because the cell is no longer seeing a representative sample.',
                      'partial', 'Same family, slight difference',
                      [f'Here the average held: {num(before, 2)} NTU before, {num(after, 2)} NTU after',
                       'Worth checking the fitting and flow to the cell at the same visit'], pair(vr, vr_e)),
            reference('carryover', 'lookalike', 'Look-alike', 'Real floc carryover from a high blanket',
                      'Genuine settled-water turbidity rises smoothly as the blanket reaches the launder, and the '
                      'filter answers about one residence time later with more headloss and a little turbidity. '
                      'Both signals move; the fix is desludging, not cleaning.', 'nomatch', 'Does not match',
                      [f'Today the blanket stayed at {num(median(bl[onset:last + 1]), 1)} %, far below carryover',
                       f'Filter effluent moved {num(eff_step, 3)} NTU, which is nothing'], pair(la, la_e)),
        ]
        ro = [
            ruled_out('A real settled-water turbidity event', 'ruled out',
                      f'The filter downstream moved {num(eff_step, 3)} NTU and its headloss kept its normal slope. '
                      f'A {num(st[hi_k], 1)} NTU slug would have shown up there within the residence time.'),
            ruled_out('Floc carryover from the blanket', 'ruled out',
                      f'Blanket {num(min(bl[onset:last + 1]), 1)}–{num(max(bl[onset:last + 1]), 1)} % of basin depth, '
                      f'well under the 45 % where carryover starts, and it did not move during the swings.'),
            ruled_out('A coagulation upset', 'ruled out',
                      f'Coagulant dose held {num(min(dose[onset:last + 1]), 1)}–{num(max(dose[onset:last + 1]), 1)} '
                      f'mg/L and floc size index moved at most {num(fs_dev, 1)} points.'),
            ruled_out('A raw-water change', 'ruled out',
                      f'Raw turbidity {num(min(raw[onset:last + 1]), 1)}–{num(max(raw[onset:last + 1]), 1)} NTU and '
                      f'pH flat on this intake through the episode.'),
            ruled_out('A plant-wide analyser or calculation fault', 'ruled out' if peers_ok else 'not yet checked',
                      (f'The other five settled-water turbidimeters moved at most '
                       f'{num(max(peer_step.values()), 2)} NTU between samples all shift.' if peers_ok else
                       'Another basin is noisy too, so a shared cause is still open.')),
        ]
        return {
            'conclusion': conclusion(
                'Cause' if level == 'high' else 'Most likely cause',
                f'The {tn} settled-water turbidimeter itself — fouled optics, bubbles or a loose sample line. The '
                f'water stayed at about {num(before, 1)} NTU throughout'
                + (f'; cleaning at {wtime(fix[0])} restored agreement' if cleaned else ''),
                level,
                'Confirmed by grab sample and cleaning' if level == 'high' else
                'Nothing physical confirms the swings' if level == 'medium' else 'Reading only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': None,
            'confidence': confidence(
                level,
                'Four independent measurements — the filter effluent downstream, the blanket in this basin, the floc '
                'size one stage back and the dose ahead of it — all stayed flat while the reading swung by '
                f'{num(st[hi_k] - st[lo_k], 1)} NTU'
                + (f'. A grab sample at the time disagreed with the sensor, and cleaning it restored agreement.'
                   if cleaned else '.'),
                None if level == 'high' else 'A grab sample has not been compared with the sensor yet.',
                None if level == 'high' else 'A bench reading on a grab sample disagrees with the sensor.',
                'The grab sample reads what the sensor read. Then the swings are real and the basin needs looking at '
                'rather than the instrument.',
                (f'Grab sample and sensor clean-up, {wtime(fix[0])}; steady for '
                 f'{dur(pack.minutes_between(fix[1], now))} since' if cleaned else None)),
            'action': action(item, pack),
            'model': {'target': 'settled_water_turbidity_ntu',
                      'formula': f'{num(before, 2)} NTU, the mean over the hour before the swings',
                      'fittedOn': f'{tn}\'s own reading either side of the episode'},
            'impact': (f'Measurement only. The train\'s quality factor and the filter downstream never moved, and '
                       f'nothing was dosed or desludged on the strength of the bad readings. The cost is '
                       f'{dur(pack.minutes_between(onset, last))} of a settled-water signal an operator could not '
                       f'trust, on the stage that is the plant\'s early warning for the filters.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Storm raw-water turbidity shock — archetype 09 (cascade)
# ═════════════════════════════════════════════════════════════════════════
class RawTurbidityShock(Detector):
    id = 'water.raw_turbidity_shock'
    name = 'Storm raw-water turbidity shock'
    version = '0.1'
    archetype = '09 Cascade failure'
    applies_to = 'intakes'
    summary = ('Raw turbidity at one intake rising several times over in under two hours, confirmed by the screen '
               'and the rake on the same channel, and then working its way down the train — coagulant demand, '
               'settled water, the filters and chlorine demand, each one stage behind the last.')
    pipeline = [
        ('Shock', 'raw turbidity against its own baseline: a ratio, not a difference'),
        ('Rate', 'how fast it is rising, in NTU/h — runoff arrives in minutes, a drifting sensor does not'),
        ('The channel agrees', 'screen differential pressure and rake torque on the same water'),
        ('Other intakes', 'the other five, which share the source but not this channel'),
        ('Cascade', 'dose, settled water, filtered water and chlorine demand, in process order with their lags'),
        ('Conclusion', 'raw water plus the mechanical signals → real shock; the chain and the recovery → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'intake'},
        'inputs': {'raw': 'self.raw_water_turbidity_ntu, .raw_water_ph, .intake_flow_variability, '
                          '.screen_differential_pressure_psi',
                   'screen': 'child intake_screen.differential_pressure_psi, .rake_motor_torque_pct, '
                             '.cleaning_cycles_per_hr',
                   'downstream': 'coagulation.coagulant_dose_mg_l, sedimentation.settled_water_turbidity_ntu, '
                                 'filtration.filter_effluent_turbidity_ntu, disinfection.chlorine_demand_mg_l',
                   'peers': 'the other five intakes'},
        'peers': {'same': 'assetType', 'count': 5,
                  'use': 'rule out a plant-wide analyser or calculation change; each train draws through its own '
                         'screen and channel'},
        'expected': {'model': 'own baseline', 'target': 'raw_water_turbidity_ntu',
                     'formula': 'median(raw turbidity over baseline_min) — the river before the storm',
                     'fitOn': 'this intake\'s own first baseline_min'},
        'params': {'baseline_min': 120, 'shock_ratio': 2.0, 'rise_ntu_h': 15.0, 'sustain_min': 15,
                   'screen_rise_pct': 8.0, 'torque_rise_pct': 8.0, 'cycles_rise_per_h': 0.5, 'ph_drop': 0.08,
                   'var_rise': 0.8, 'dose_rise_pct': 10.0, 'settled_limit_ntu': 5.0, 'filtered_limit_ntu': 0.30,
                   'back_band_pct': 25.0},
        'checks': [
            {'id': 'shock', 'role': 'required', 'rule': 'raw turbidity > shock_ratio × its baseline'},
            {'id': 'fast', 'role': 'required', 'rule': 'rising faster than rise_ntu_h over the last hour'},
            {'id': 'sustained', 'role': 'required', 'rule': 'above the ratio for sustain_min'},
            {'id': 'screen', 'role': 'required',
             'rule': 'screen differential pressure up > screen_rise_pct and rake torque up > torque_rise_pct'},
            {'id': 'cycles', 'role': 'supporting', 'independent': True,
             'rule': 'screen cleaning cycles up more than cycles_rise_per_h'},
            {'id': 'ph', 'role': 'supporting', 'independent': True, 'rule': 'raw pH down more than ph_drop'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'the other intakes stay inside their own baseline bands'},
            {'id': 'dose', 'role': 'supporting', 'rule': 'coagulant dose raised more than dose_rise_pct in response'},
            {'id': 'held', 'role': 'supporting', 'independent': True,
             'rule': 'settled water stayed under settled_limit_ntu and filtered water under filtered_limit_ntu'},
            {'id': 'recovered', 'role': 'supporting',
             'rule': 'raw turbidity back inside ±back_band_pct of baseline and the dose back to setpoint'},
        ],
        'ruleOut': ['an intake turbidimeter fault', 'a plant-wide source change',
                    'solids stirred up by the raw-water pumps', 'an algae bloom', 'a coagulation problem'],
        'confidence': {'low': 'required checks only',
                       'medium': 'the screen and rake confirm real solids in the water',
                       'high': 'the whole downstream chain followed in process order and the event recovered'},
        'references': ['textbook: storm shock absorbed', 'variant: shock with a late dose response',
                       'look-alike: intake turbidimeter fault'],
    }

    def candidates(self, pack):
        return pack.of_type('intake')

    def _ctx(self, pack, aid):
        p = self.p
        screen = pack.child_of_type(aid, 'intake_screen')
        if screen is None:
            return None
        nb = pack.steps(p['baseline_min'])
        raw = pack.series(aid, 'raw_water_turbidity_ntu')
        r0 = median(raw[:nb])
        rate = [B.slope_per_hour(raw, k, pack.steps(60), pack.step_min) for k in range(pack.n)]
        return dict(screen=screen, raw=raw, r0=r0, rate=rate, nb=nb)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        raw, r0, rate = c['raw'], c['r0'], c['rate']
        screen = c['screen']
        dp = pack.series(screen, 'differential_pressure_psi')
        tq = pack.series(screen, 'rake_motor_torque_pct')
        nb = c['nb']
        dp0, tq0 = median(dp[:nb]), median(tq[:nb])
        hot = [v > p['shock_ratio'] * r0 for v in raw]
        for i in range(pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if rate[i] is None or rate[i] < p['rise_ntu_h']:
                continue
            if pct(max(dp[s0:i + 1]), dp0) < p['screen_rise_pct']:
                continue
            if pct(max(tq[s0:i + 1]), tq0) < p['torque_rise_pct']:
                continue
            onset = s0
            while onset > 0 and raw[onset - 1] > r0 * (1 + p['back_band_pct'] / 100):
                onset -= 1
            c.update(onset=onset, alert=s0, dp=dp, tq=tq, dp0=dp0, tq0=tq0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        raw, r0, rate = c['raw'], c['r0'], c['rate']
        dp, tq, dp0, tq0 = c['dp'], c['tq'], c['dp0'], c['tq0']
        onset, alert = c['onset'], c['alert']
        nb = c['nb']
        peak = max(range(onset, now + 1), key=lambda k: raw[k])
        back = next((k for k in range(peak, pack.n) if raw[k] < r0 * (1 + p['back_band_pct'] / 100)), None)
        screen = c['screen']
        cy = pack.series(screen, 'cleaning_cycles_per_hr')
        cy0 = median(cy[:nb])
        cy_ok = max(cy[onset:now + 1]) - cy0 > p['cycles_rise_per_h']
        ph = pack.series(aid, 'raw_water_ph')
        ph0 = median(ph[:nb])
        ph_ok = ph0 - min(ph[onset:now + 1]) > p['ph_drop']
        var = pack.series(aid, 'intake_flow_variability')
        var0 = median(var[:nb])

        coag = next_stage(pack, aid) or stage_of(pack, aid, 'coagulation')
        sed = stage_of(pack, aid, 'sedimentation')
        filt = stage_of(pack, aid, 'filtration')
        dis = stage_of(pack, aid, 'disinfection')
        dose = pack.series(coag, 'coagulant_dose_mg_l')
        d0 = median(dose[:nb])
        dose_k = max(range(onset, now + 1), key=lambda k: dose[k])
        dose_pct = pct(dose[dose_k], d0)
        dose_ok = dose_pct > p['dose_rise_pct']
        dose_start = next((k for k in range(onset, now + 1) if pct(dose[k], d0) > p['dose_rise_pct'] / 2), dose_k)
        settled = pack.series(sed, 'settled_water_turbidity_ntu')
        st_k = max(range(onset, now + 1), key=lambda k: settled[k])
        eff = pack.series(filt, 'filter_effluent_turbidity_ntu')
        eff_k = max(range(onset, now + 1), key=lambda k: eff[k])
        dem = pack.series(dis, 'chlorine_demand_mg_l')
        dem0 = median(dem[:nb])
        dem_k = max(range(onset, now + 1), key=lambda k: dem[k])
        held_ok = settled[st_k] < p['settled_limit_ntu'] and eff[eff_k] < p['filtered_limit_ntu']
        recovered = back is not None and abs(pct(dose[now], d0)) < p['dose_rise_pct'] / 2

        peer_ratio = {}
        for o in peers_of(pack, aid):
            co = self._ctx(pack, o)
            if co:
                peer_ratio[o] = max(co['raw']) / co['r0']
        peers_ok = all(v < p['shock_ratio'] for v in peer_ratio.values())
        level = 'high' if (held_ok and recovered and dose_ok) else ('medium' if cy_ok or ph_ok else 'low')
        rd = nice_domain(raw, [r0], pad=0.06, floor=0)
        w1 = win(pack, onset, now)
        exp = [r0] * pack.n

        checks = [
            check('shock', f'Raw turbidity {num(raw[peak] / r0, 1)}× its baseline', 'required', MATCH,
                  f'{num(raw[peak], 1)} NTU at {ts[peak]} against {num(r0, 1)} NTU before the event '
                  f'({num(raw[peak] / r0, 1)}×). The flag is {num(p["shock_ratio"], 1)}×.',
                  'Runoff after rain carries the catchment\'s silt into the river. A plant sized for 8–11 NTU has to '
                  'treat several times that, and every barrier downstream feels it.',
                  spark(raw, rd, threshold_value=p['shock_ratio'] * r0)),
            check('fast', 'Arrived at storm speed', 'required', MATCH,
                  f'{signed(rate[i], 0)} NTU/h over the hour to {ts[i]}, peaking at '
                  f'{signed(max(v for v in rate if v is not None), 0)} NTU/h; '
                  f'{num(raw[onset], 1)} → {num(raw[peak], 1)} NTU in '
                  f'{dur(pack.minutes_between(onset, peak))}.',
                  'Runoff reaches an intake in tens of minutes. A fouling or drifting analyser cannot climb at this '
                  'rate, and neither can a seasonal change in the source.',
                  spark([v for v in rate], nice_domain([v for v in rate if v is not None], [0, p['rise_ntu_h']]),
                        threshold_value=p['rise_ntu_h'])),
            check('sustained', 'Stayed up, then came back', 'required', MATCH,
                  f'Above {num(p["shock_ratio"], 1)}× baseline from {ts[alert]} to '
                  f'{ts[back] if back else ts[now]} ({dur(pack.minutes_between(alert, back if back else now))}).',
                  f'Needs {dur(p["sustain_min"])} above the flag, so one dirty sample off the screen rake cannot '
                  f'raise a storm.',
                  spark(raw, rd, threshold_value=p['shock_ratio'] * r0, highlight=[ts[alert], ts[back or now]])),
            check('screen', 'The screen and rake agree there are solids in the water', 'required', MATCH,
                  f'Screen ΔP {num(max(dp[onset:now + 1]), 2)} psi against {num(dp0, 2)} psi before '
                  f'({signed(pct(max(dp[onset:now + 1]), dp0), 0)} %), rake torque '
                  f'{num(max(tq[onset:now + 1]), 0)} % against {num(tq0, 0)} % '
                  f'({signed(pct(max(tq[onset:now + 1]), tq0), 0)} %).',
                  'Two mechanical measurements, nothing to do with the turbidimeter. Debris and silt blind the '
                  'screen, which costs head and makes the rake work harder. That is real water, not a reading.',
                  spark(tq, nice_domain(tq, [tq0]), threshold_value=tq0 * (1 + p['torque_rise_pct'] / 100),
                        window=w1)),
            check('cycles', 'Screen cleaning itself more often', 'supporting', MATCH if cy_ok else NO_MATCH,
                  f'{num(max(cy[onset:now + 1]), 1)} cleaning cycles/h at the peak against {num(cy0, 1)} /h before '
                  f'({signed(max(cy[onset:now + 1]) - cy0, 1)} /h).',
                  'The screen controller cleans on differential pressure, so its cycle count is a third, '
                  'independent vote that the water got dirty.',
                  spark(cy, nice_domain(cy, [cy0]), threshold_value=cy0 + p['cycles_rise_per_h'], window=w1)),
            check('ph', 'Raw pH dipped, as runoff does', 'supporting', MATCH if ph_ok else NO_MATCH,
                  f'pH {num(min(ph[onset:now + 1]), 2)} at the worst against {num(ph0, 2)} before '
                  f'({signed(min(ph[onset:now + 1]) - ph0, 2)}); intake flow variability '
                  f'{num(max(var[onset:now + 1]), 1)} against {num(var0, 1)}.',
                  'Storm water is softer and slightly more acidic than river baseflow, and it arrives unevenly. Both '
                  'fit runoff rather than a sensor problem.',
                  spark(ph, nice_domain(ph, [ph0]), threshold_value=ph0 - p['ph_drop'], window=w1)),
            check('peers', 'The other five intakes did not see it', 'supporting', MATCH if peers_ok else NO_MATCH,
                  f'Worst elsewhere: {num(max(peer_ratio.values()), 2)}× baseline on '
                  f'{tname(pack, max(peer_ratio, key=lambda o: peer_ratio[o]))}, against '
                  f'{num(raw[peak] / r0, 1)}× here. Each train draws through its own screen and channel.',
                  'A plant-wide analyser change or a calculation fault would move all six at once. A storm cell over '
                  'part of the catchment reaches one intake channel first.',
                  spark(pack.series(max(peer_ratio, key=lambda o: peer_ratio[o]), 'raw_water_turbidity_ntu'), rd)),
            check('dose', 'Coagulant dose raised to match', 'supporting', MATCH if dose_ok else NO_MATCH,
                  f'{num(dose[dose_k], 1)} mg/L at {ts[dose_k]} against {num(d0, 1)} mg/L baseline '
                  f'({signed(dose_pct, 0)} %), first raised at {ts[dose_start]} — '
                  f'{dur(pack.minutes_between(onset, dose_start))} into the event.',
                  'More turbidity needs more coagulant to destabilise it. This is the operator\'s answer to the '
                  'shock, and the rest of the plant\'s behaviour has to be read with it in mind.',
                  spark(dose, nice_domain(dose, [d0]), threshold_value=d0 * (1 + p['dose_rise_pct'] / 100),
                        window=w1)),
            check('held', 'The barriers downstream held', 'supporting', MATCH if held_ok else NO_MATCH,
                  f'Settled water peaked {num(settled[st_k], 2)} NTU at {ts[st_k]} (limit of concern '
                  f'{num(p["settled_limit_ntu"], 0)} NTU), filtered water {num(eff[eff_k], 2)} NTU at {ts[eff_k]} '
                  f'against the {num(p["filtered_limit_ntu"], 1)} NTU limit; chlorine demand '
                  f'{num(dem[dem_k], 2)} mg/L against {num(dem0, 2)} mg/L.',
                  'The cascade is visible stage by stage, each one behind the last, and each one stayed inside its '
                  'limit. That is what "absorbed" means and it is why this is a logged event, not an exceedance.',
                  spark(eff, [0, p['filtered_limit_ntu'] * 1.1], threshold_value=p['filtered_limit_ntu'],
                        window=w1)),
            check('recovered', 'Back to baseline, dose back to setpoint', 'supporting',
                  MATCH if recovered else NO_MATCH,
                  (f'Raw turbidity {num(raw[back], 1)} NTU by {ts[back]} (inside '
                   f'±{num(p["back_band_pct"], 0)} % of {num(r0, 1)} NTU) and dose back to '
                   f'{num(dose[now], 1)} mg/L.' if back else 'Still above baseline.'),
                  'The event is over, and the plant came back to where it started without a single limit touched. '
                  'The record is worth keeping for the next one.',
                  spark(raw, rd, threshold_value=r0 * (1 + p['back_band_pct'] / 100),
                        highlight=[ts[peak], ts[back]] if back else None)),
        ]
        main = chart('NTU', rd,
                     [series('actual', f'{tn} raw water turbidity', raw, 'primary', 1),
                      series('expected', 'Before the storm', exp, 'expected', 1),
                      series('settled', f'{tn} settled water', settled, 'secondary', 2),
                      series('filtered', f'{tn} filtered water (×50, for scale)', [v * 50 for v in eff],
                             'secondary', 2)],
                     title='What we see',
                     caption=f'{tn} raw turbidity against its pre-storm level, with settled and filtered water on '
                             f'the same axis (filtered ×50 to be visible). The shock is {num(raw[peak] / r0, 1)}× at '
                             f'the intake and barely visible by the time it leaves the filters.',
                     shade_gap=['actual', 'expected'], decimals=0,
                     markers=[marker(ts[onset], 'Storm arriving'), marker(ts[dose_start], 'Dose raised'),
                              marker(ts[peak], f'Peak {num(raw[peak], 0)} NTU')]
                     + ([marker(ts[back], 'Back to baseline')] if back else []))

        grid = hours_grid(4, 0.25)
        r = Rng(4505)
        bump = lambda hh, mu, sd, amp: amp * math.exp(-((hh - mu) ** 2) / (2 * sd * sd))
        tb = [9.0 + bump(hh, 1.6, 0.55, 60.0) + r.gauss(0.5) for hh in grid]
        tb_f = [0.08 + bump(hh, 2.2, 0.7, 0.03) + r.gauss(0.003) for hh in grid]
        vr = [9.0 + bump(hh, 1.6, 0.55, 60.0) + r.gauss(0.5) for hh in grid]
        vr_f = [0.08 + bump(hh, 2.4, 0.8, 0.23) + r.gauss(0.004) for hh in grid]
        la = [9.0 + bump(hh, 1.6, 0.55, 55.0) + r.gauss(0.6) for hh in grid]
        la_f = [0.08 + r.gauss(0.003) for hh in grid]
        live = f'{tn}, today'
        live_r = aligned(raw, onset, pack.step_min, grid)
        live_f = aligned(eff, onset, pack.step_min, grid)

        def pair(a, b):
            return [ref_chart('Raw water turbidity (h from the start of the event)', 'NTU', [0, 80], grid, 'h', a,
                              live_r, live, 0),
                    ref_chart('Filtered water turbidity', 'NTU', [0, 0.35], grid, 'h', b, live_f, live, 2,
                              [threshold(p['filtered_limit_ntu'], 'Limit')])]
        refs = [
            reference('absorbed', 'textbook', 'Textbook', 'Storm shock absorbed by an early dose increase',
                      'Raw turbidity goes up five to ten times in an hour. The dose is raised as soon as the trend '
                      'is clear, settled water lifts a little, and filtered water hardly moves. The plant rides it '
                      'out and the event is logged for the seasonal playbook.', 'match', 'Closest match',
                      [f'Same {num(raw[peak] / r0, 1)}× shock and recovery',
                       f'Dose raised {signed(dose_pct, 0)} % at {ts[dose_start]}',
                       f'Filtered water peaked {num(eff[eff_k], 2)} NTU'], pair(tb, tb_f)),
            reference('late', 'variant', 'Variant', 'The same shock with a late dose response',
                      'Identical at the intake, but the dose is not raised until settled turbidity has already '
                      'climbed. Under-dosed floc reaches the filters, turbidity runs close to the 0.3 NTU limit and '
                      'the filters need washing early.', 'nomatch', 'What was avoided',
                      [f'Here the dose went up at {ts[dose_start]} with raw turbidity still climbing to '
                       f'{num(raw[peak], 0)} NTU, and settled water turned down from {ts[st_k]}',
                       'The margin on filtered water is the whole value of responding early'],
                      pair(vr, vr_f)),
            reference('sensor', 'lookalike', 'Look-alike', 'Intake turbidimeter fault',
                      'The reading climbs the same way, but the screen differential pressure, the rake torque and '
                      'the cleaning cycles all stay flat, and nothing downstream reacts. Cleaning the sensor ends '
                      'the "storm".', 'nomatch', 'Does not match',
                      [f'Screen ΔP {signed(pct(max(dp[onset:now + 1]), dp0), 0)} % and rake torque '
                       f'{signed(pct(max(tq[onset:now + 1]), tq0), 0)} % here',
                       f'Settled water followed {dur(pack.minutes_between(peak, st_k)) if st_k > peak else "within one residence time"}'
                       f' behind'], pair(la, la_f)),
        ]
        pumps = pack.child_of_type(aid, 'raw_water_pump')
        pflow = pack.series(pumps, 'flow_rate_gpm') if pumps else None
        alg = pack.series(aid, 'algae_risk_index')
        ro = [
            ruled_out('An intake turbidimeter fault', 'ruled out',
                      f'Three mechanical signals on the same channel moved with it: screen ΔP '
                      f'{signed(pct(max(dp[onset:now + 1]), dp0), 0)} %, rake torque '
                      f'{signed(pct(max(tq[onset:now + 1]), tq0), 0)} % and cleaning cycles '
                      f'{signed(max(cy[onset:now + 1]) - cy0, 1)} /h.'),
            ruled_out('A plant-wide source change', 'ruled out' if peers_ok else 'not yet checked',
                      (f'The other five intakes stayed within {num(max(peer_ratio.values()), 2)}× of their own '
                       f'baselines through the same two hours.' if peers_ok else
                       'Another intake moved as well, so a shared source change is still open.')),
            ruled_out('Solids stirred up by the raw-water pumps', 'ruled out' if pflow else 'not yet checked',
                      (f'Raw pump flow {num(min(pflow[onset:now + 1]), 0)}–{num(max(pflow[onset:now + 1]), 0)} gpm '
                       f'through the event, so nothing changed in how the channel was being drawn down.'
                       if pflow else 'No raw pump flow found.')),
            ruled_out('An algae bloom', 'ruled out',
                      f'Algae risk index {num(min(alg[onset:now + 1]), 1)}–{num(max(alg[onset:now + 1]), 1)} against '
                      f'{num(median(alg[:nb]), 1)} before, and a bloom builds over days, not in '
                      f'{dur(pack.minutes_between(onset, peak))}.'),
            ruled_out('A coagulation problem on this train', 'ruled out',
                      f'The dose was raised {signed(dose_pct, 0)} % deliberately and the pump\'s discharge pressure '
                      f'and stroke stability held. Settled turbidity went up with the raw water and came down as '
                      f'the dose caught up.'),
        ]
        return {
            'conclusion': conclusion(
                'Cause',
                f'Storm runoff into the {tn} intake took raw turbidity {num(r0, 0)} → {num(raw[peak], 0)} NTU; the '
                f'dose increase at {ts[dose_start]} absorbed it and no barrier downstream left its limits',
                level,
                'Four intake instruments and the whole downstream chain agree' if level == 'high' else
                'The screen and rake confirm real solids' if level == 'medium' else 'Turbidity reading only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(
                level,
                'Four separate instruments on this intake — turbidimeter, screen differential pressure, rake torque '
                'and cleaning cycles — moved together, pH fell the way runoff does, and the disturbance then '
                'appeared at coagulation, sedimentation, filtration and disinfection in process order, each one '
                'stage behind the last. The intake is back to baseline and the dose back to setpoint.',
                None,
                None,
                'A later check finds the intake turbidimeter fouled; then part of the peak was reading, not water. '
                'The screen and rake data make that unlikely.',
                f'Raw turbidity back to {num(raw[back], 1)} NTU by {ts[back]}, dose back to '
                f'{num(dose[now], 1)} mg/L' if back else None),
            'action': action(item, pack),
            'model': {'target': 'raw_water_turbidity_ntu',
                      'formula': f'{num(r0, 1)} NTU, the median over the first {dur(p["baseline_min"])}',
                      'fittedOn': f'{tn}\'s own pre-storm baseline'},
            'impact': (f'Peak {num(raw[peak], 0)} NTU, {num(raw[peak] / r0, 1)}× baseline, over '
                       f'{dur(pack.minutes_between(onset, back if back else now))}. Settled water reached '
                       f'{num(settled[st_k], 2)} NTU and filtered water {num(eff[eff_k], 2)} NTU, '
                       f'{num(100 * (1 - eff[eff_k] / p["filtered_limit_ntu"]), 0)} % below the '
                       f'{num(p["filtered_limit_ntu"], 1)} NTU limit. Chlorine demand rose '
                       f'{signed(pct(dem[dem_k], dem0), 0)} %, and the extra coagulant cost about '
                       f'{num(pack.minutes_between(dose_start, now) / 60.0, 1)} h at up to '
                       f'{signed(dose_pct, 0)} % over setpoint.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Backwashing far more often than its cycle — archetype 12 (micro-events)
# ═════════════════════════════════════════════════════════════════════════
class FilterBackwashCycling(Detector):
    id = 'water.filter_backwash_cycling'
    name = 'Filter backwashing more often than its cycle'
    version = '0.1'
    archetype = '12 Recurring micro-events'
    applies_to = 'filtration stages'
    summary = ('A filter washing every forty minutes instead of every two days. Each wash is textbook — headloss '
               'resets, the pump runs, the bed ripens and the water is clean — so nothing alarms; the finding is '
               'the count, and the fact that each run ends far below terminal headloss.')
    pipeline = [
        ('Find the washes', 'headloss resets bigger than reset_drop_ft, confirmed by the backwash pump'),
        ('Count', 'how many in the last window_min, against this filter\'s own normal cycle'),
        ('Each one normal', 'headloss back near its clean value and effluent back in spec within recover_min'),
        ('Why so soon', 'headloss at the moment each wash starts, against terminal headloss'),
        ('Cost', 'projected run length, unit filter run volume, backwash cycles per day'),
        ('Conclusion', 'repeated complete washes on one filter → raise; the pump data agrees → medium'),
    ]
    definition = {
        'appliesTo': {'assetType': 'filtration'},
        'inputs': {'headloss': 'self.headloss_ft', 'effluent': 'self.filter_effluent_turbidity_ntu',
                   'runtime': 'self.filter_run_time_hrs', 'ufrv': 'self.unit_filter_run_volume_gal_sf',
                   'frequency': 'self.backwash_frequency_per_week',
                   'bed': 'child filter_bed.backwash_cycles_per_day',
                   'pump': 'child backwash_pump.flow_rate_gpm, .process_motor_current_a (backwash layer)',
                   'peers': 'the other five filtration stages'},
        'peers': {'same': 'assetType', 'count': 5, 'use': 'how often a healthy filter on this water washes'},
        'expected': {'model': 'own normal cycle', 'target': 'backwash interval',
                     'formula': '168 h ÷ backwash_frequency_per_week at shift start',
                     'fitOn': 'this filter\'s own projected cycle before the washes started'},
        'params': {'reset_drop_ft': 1.0, 'window_min': 240, 'min_events': 3, 'max_interval_min': 90,
                   'clean_band_ft': 0.5, 'ripen_ntu': 0.15, 'recover_min': 20, 'pump_rise_pct': 4.0,
                   'pump_frac': 0.6,
                   'terminal_ft': 6.0, 'reload_ratio': 3.0, 'ufrv_drop_pct': 25.0, 'runtime_drop_pct': 25.0,
                   'counter_rise_pct': 25.0},
        'checks': [
            {'id': 'count', 'role': 'required', 'rule': '≥ min_events headloss resets > reset_drop_ft within window_min'},
            {'id': 'interval', 'role': 'required',
             'rule': 'mean gap between washes < max_interval_min, against 168 ÷ backwash_frequency_per_week'},
            {'id': 'complete', 'role': 'required',
             'rule': 'each wash returns headloss to within clean_band_ft of the lowest reset value and effluent '
                     'under ripen_ntu within recover_min'},
            {'id': 'pump', 'role': 'supporting', 'independent': True,
             'rule': 'backwash pump flow up more than pump_rise_pct in at least pump_frac of the reset samples'},
            {'id': 'early', 'role': 'supporting',
             'rule': 'headloss at each wash well below terminal_ft'},
            {'id': 'reload', 'role': 'supporting',
             'rule': 'headloss climbs more than reload_ratio × its pre-event rate between washes'},
            {'id': 'cost', 'role': 'supporting',
             'rule': 'projected run length down > runtime_drop_pct and UFRV down > ufrv_drop_pct'},
            {'id': 'counter', 'role': 'supporting', 'rule': 'the bed\'s own backwash-cycles/day counter agrees'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'the other filters wash at most once in the window'},
        ],
        'ruleOut': ['one routine end-of-run backwash', 'a headloss transmitter fault',
                    'dirtier water into this filter', 'a backwash that keeps failing and retrying',
                    'floc breakthrough forcing early washes'],
        'confidence': {'low': 'required checks only',
                       'medium': 'the backwash pump confirms every wash independently',
                       'high': 'a media condition check explains why the runs are short'},
        'references': ['textbook: degraded media, short runs', 'variant: run-time trigger set too tight',
                       'look-alike: one routine end-of-run wash'],
    }

    def candidates(self, pack):
        return pack.of_type('filtration')

    def _washes(self, pack, aid):
        p = self.p
        hl = pack.series(aid, 'headloss_ft')
        return hl, [k for k in range(1, pack.n) if hl[k - 1] - hl[k] > p['reset_drop_ft']]

    def evaluate(self, pack, aid):
        p = self.p
        hl, washes = self._washes(pack, aid)
        if len(washes) < p['min_events']:
            return Finding(aid, False)
        eff = pack.series(aid, 'filter_effluent_turbidity_ntu')
        bw = pack.series(aid, 'backwash_frequency_per_week')
        w = pack.steps(p['window_min'])
        rec = pack.steps(p['recover_min'])
        clean = min(hl[k] for k in washes)
        for i in range(pack.n):
            recent = [k for k in washes if i - w < k and k + 1 <= i]
            if len(recent) < p['min_events']:
                continue
            gaps = [pack.minutes_between(a, b) for a, b in zip(recent, recent[1:])]
            if not gaps or sum(gaps) / len(gaps) > p['max_interval_min']:
                continue
            ok = True
            for k in recent:
                if hl[k] - clean > p['clean_band_ft']:
                    ok = False
                if min(eff[k:min(pack.n, k + rec + 1)]) > p['ripen_ntu']:
                    ok = False
            if not ok:
                continue
            return Finding(aid, True, i, hl=hl, washes=washes, eff=eff, bw=bw, clean=clean,
                           recent=recent, gaps=gaps)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        hl, washes, eff, bw, clean = c['hl'], c['washes'], c['eff'], c['bw'], c['clean']
        first, last = washes[0], washes[-1]
        gaps = [pack.minutes_between(a, b) for a, b in zip(washes, washes[1:])]
        mean_gap = sum(gaps) / len(gaps)
        normal_h = 168.0 / bw[0] if bw[0] else None
        rec = pack.steps(p['recover_min'])
        bed = pack.child_of_type(aid, 'filter_bed')
        pump = pack.child_of_type(aid, 'backwash_pump')
        pf = pack.series(pump, 'flow_rate_gpm')
        pa = pack.series(pump, 'process_motor_current_a')
        pf0, pa0 = median(pf[:first]), median(pa[:first])
        pump_hits = [k for k in washes if pct(pf[k], pf0) > p['pump_rise_pct']]
        pump_ok = len(pump_hits) >= max(p['min_events'], p['pump_frac'] * len(washes))
        starts = [max(range(max(0, k - 1 - pack.steps(60)), k), key=lambda j: hl[j]) for k in washes]
        at_wash = [hl[k - 1] for k in washes]
        early_ok = max(at_wash) < p['terminal_ft'] - 1.0
        pre_rate = B.slope_per_hour(hl, first - 1, pack.steps(120), pack.step_min)
        seg_rates = []
        for a, b in zip(washes, washes[1:]):
            if b - a >= 4:
                r_ = B.slope_per_hour(hl, b - 1, b - a - 1, pack.step_min)
                if r_:
                    seg_rates.append(r_)
        reload_rate = median(seg_rates) if seg_rates else None
        reload_ok = bool(reload_rate and pre_rate and reload_rate > p['reload_ratio'] * abs(pre_rate))
        rt = pack.series(aid, 'filter_run_time_hrs')
        uf = pack.series(aid, 'unit_filter_run_volume_gal_sf')
        rt_pct, uf_pct = pct(rt[now], rt[0]), pct(uf[now], uf[0])
        cost_ok = rt_pct < -p['runtime_drop_pct'] and uf_pct < -p['ufrv_drop_pct']
        cnt = pack.series(bed, 'backwash_cycles_per_day')
        cnt_pct = pct(cnt[now], median(cnt[:first]))
        cnt_ok = cnt_pct > p['counter_rise_pct']
        ripe = [max(eff[k:min(pack.n, k + rec + 1)]) for k in washes]
        peer_w = {}
        for o in peers_of(pack, aid):
            _, ow = self._washes(pack, o)
            peer_w[o] = ow
        peers_ok = all(len(v) <= 1 for v in peer_w.values())
        with_one = [o for o, v in peer_w.items() if len(v) == 1]
        media = open_work(pack, [aid, bed], types=('INSPECTION', 'MAINTENANCE'))
        done_media = [w for w, _ in done_work(pack, [aid, bed], types=('INSPECTION',))]
        level = 'high' if done_media else ('medium' if pump_ok else 'low')
        hd = nice_domain(hl, [clean, p['terminal_ft']], pad=0.05)
        w1 = win(pack, first, now)

        checks = [
            check('count', f'{len(washes)} backwashes since {ts[first]}', 'required', MATCH,
                  f'Washes at {join_names([ts[k] for k in washes])} — {len(c["recent"])} inside '
                  f'{dur(p["window_min"])} when it was flagged at {ts[i]}. Each one drops headloss to about '
                  f'{num(clean, 1)} ft.',
                  'A backwash is a reset: headloss falls from whatever it had reached back to the clean-bed value. '
                  'Counting the resets counts the washes without needing an event log.',
                  spark(hl, hd, threshold_value=clean + p['reset_drop_ft'])),
            check('interval', f'About {dur(mean_gap)} between washes instead of {num(normal_h, 0)} hours',
                  'required', MATCH,
                  f'Gaps of {join_names([dur(g) for g in gaps])} (mean {dur(mean_gap)}), against this filter\'s own '
                  f'projected cycle of {num(normal_h, 0)} h at shift start '
                  f'({num(bw[0], 1)} washes/week → {num(bw[now], 1)} now).',
                  'A rapid gravity filter on water like this runs 24–72 hours between washes. Forty minutes is not a '
                  'short run, it is a different machine.',
                  spark(bw, nice_domain(bw, [bw[0]]), threshold_value=bw[0])),
            check('complete', 'Every wash finished properly', 'required', MATCH,
                  f'Headloss back to {num(min(hl[k] for k in washes), 1)}–{num(max(hl[k] for k in washes), 1)} ft '
                  f'each time (clean bed about {num(clean, 1)} ft) and filter effluent back under '
                  f'{num(p["ripen_ntu"], 2)} NTU within {dur(p["recover_min"])}; ripening peaks '
                  f'{num(min(ripe), 2)}–{num(max(ripe), 2)} NTU.',
                  'This is what says the washes themselves are healthy. Nothing is failing and retrying: each cycle '
                  'cleans the bed, the bed ripens, the water comes back in spec. Only the number is wrong.',
                  spark(eff, [0, 0.33], threshold_value=p['ripen_ntu'], window=w1)),
            check('pump', 'The backwash pump confirms each one', 'supporting', MATCH if pump_ok else NO_MATCH,
                  f'In {len(pump_hits)} of the {len(washes)} reset samples the backwash pump stepped up: flow to '
                  f'{num(max(pf[k] for k in washes), 0)} gpm against {num(pf0, 0)} gpm between washes '
                  f'({signed(pct(max(pf[k] for k in washes), pf0), 0)} %), with motor current up to '
                  f'{signed(pct(max(pa[k] for k in washes), pa0), 0)} % in the same samples.',
                  'A separate asset with its own instruments, on the backwash relationship to this bed. It says the '
                  'resets are real washes and not a headloss transmitter dropping out.',
                  spark(pf, nice_domain(pf), window=w1)),
            check('early', 'Each run ends far below terminal headloss', 'supporting',
                  MATCH if early_ok else NO_MATCH,
                  f'Headloss at the wash: {join_names([num(v, 1) for v in at_wash])} ft, against a '
                  f'{num(p["terminal_ft"], 1)} ft terminal value. '
                  + (f'For comparison {tname(pack, with_one[0])} ran to '
                     f'{num(pack.series(with_one[0], "headloss_ft")[peer_w[with_one[0]][0] - 1], 1)} ft before its '
                     f'one wash today.' if with_one else ''),
                  'A filter should be washed when it has used up its headloss, or when turbidity says so. Washing at '
                  'three and a half feet throws away run length — either the trigger is set too tight or the bed is '
                  'loading so fast that something else trips first.',
                  spark(hl, hd, threshold_value=p['terminal_ft'])),
            check('reload', 'The bed loads up again within the hour', 'supporting',
                  MATCH if reload_ok else NO_MATCH,
                  (f'{num(reload_rate, 1)} ft/h between washes, against {num(abs(pre_rate), 2)} ft/h on this same '
                   f'filter before {ts[first]} ({num(reload_rate / abs(pre_rate), 0)}×).'
                   if reload_ok else 'Not enough points between washes to measure the rate.'),
                  'Each fresh bed is back to terminal in well under an hour. Media that has lost its grading, or a '
                  'bed too shallow after repeated washing, takes solids in the top inch instead of through the depth.',
                  None),
            check('cost', 'Run length and production per run both down', 'supporting', MATCH if cost_ok else NO_MATCH,
                  f'Projected run {num(rt[now], 0)} h against {num(rt[0], 0)} h at shift start '
                  f'({signed(rt_pct, 0)} %); unit filter run volume {num(uf[now], 0)} against {num(uf[0], 0)} '
                  f'gal/ft² ({signed(uf_pct, 0)} %).',
                  'UFRV is how much water a filter makes per run. Every wash also costs its own backwash water, so '
                  'this is where the lost net production shows up.',
                  spark(uf, nice_domain(uf))),
            check('counter', 'The bed\'s own cycle counter agrees', 'supporting', MATCH if cnt_ok else NO_MATCH,
                  f'Backwash cycles/day {num(cnt[now], 2)} now against {num(median(cnt[:first]), 2)} before the first '
                  f'wash ({signed(cnt_pct, 0)} %).',
                  'The filter bed keeps its own running count, from the valve sequence rather than from headloss. It '
                  'is rising the same way.',
                  spark(cnt, nice_domain(cnt), window=w1)),
            check('peers', 'The other filters washed once or not at all', 'supporting', MATCH if peers_ok else NO_MATCH,
                  (f'{join_names([f"{tname(pack, o)} {len(v)}" for o, v in sorted(peer_w.items())])} washes today, '
                   f'against {len(washes)} here.' if peer_w else 'No other filter to compare with.'),
                  'Same water, same filtration rate, same backwash settings as a group. The pattern is on this '
                  'filter only, so it is this bed or this filter\'s own triggers.',
                  spark(pack.series(sorted(peer_w)[0], 'headloss_ft'), hd)),
        ]
        main = chart('ft', hd,
                     [series('actual', f'{tn} headloss', hl, 'primary', 2),
                      series('expected', f'Clean bed ({num(clean, 1)} ft)', [clean] * pack.n, 'expected', 2)]
                     + ([series('peer', f'{tname(pack, with_one[0])} (one routine wash)',
                                pack.series(with_one[0], 'headloss_ft'), 'peer', 2)] if with_one else []),
                     title='What we see',
                     caption=f'{tn} filter headloss. Each sawtooth is a complete backwash; the filter is spending '
                             f'about {dur(mean_gap)} per run instead of {num(normal_h, 0)} hours.'
                             + (f' {tname(pack, with_one[0])} underneath shows what one routine end-of-run wash '
                                f'looks like.' if with_one else ''),
                     decimals=1,
                     thresholds=[threshold(p['terminal_ft'], 'Terminal headloss')],
                     markers=[marker(ts[k], f'{n + 1}') for n, k in enumerate(washes)])

        grid = hours_grid(3, 1 / 12)
        r = Rng(4606)
        saw = lambda hh, period, lo, rate: lo + rate * (hh % period)
        tb = [saw(hh, 0.75, 2.0, 2.2) + r.gauss(0.03) for hh in grid]
        tb_e = [0.075 + (0.04 if (hh % 0.75) < 0.12 else 0.0) + r.gauss(0.003) for hh in grid]
        vr = [saw(hh, 0.75, 2.0, 0.6) + r.gauss(0.03) for hh in grid]
        vr_e = [0.075 + (0.04 if (hh % 0.75) < 0.12 else 0.0) + r.gauss(0.003) for hh in grid]
        la = [(5.3 + 0.09 * hh if hh < 2.0 else 1.75 + 0.09 * (hh - 2.0)) + r.gauss(0.03) for hh in grid]
        la_e = [0.075 + (0.04 if 2.0 <= hh < 2.15 else 0.0) + r.gauss(0.003) for hh in grid]
        live = f'{tn}, today'
        live_h = aligned(hl, first, pack.step_min, grid)
        live_e = aligned(eff, first, pack.step_min, grid)

        def pair(a, b):
            return [ref_chart('Headloss (h from the first wash)', 'ft', [1.5, 6.5], grid, 'h', a, live_h, live, 1,
                              [threshold(p['terminal_ft'], 'Terminal')]),
                    ref_chart('Filter effluent turbidity', 'NTU', [0, 0.2], grid, 'h', b, live_e, live, 2)]
        refs = [
            reference('media', 'textbook', 'Textbook', 'Degraded media — short runs, clean water',
                      'Media that has lost its grading, or a bed left shallow by years of washing, catches solids in '
                      'the top layer. Headloss builds in minutes instead of hours, the filter washes again, and the '
                      'cycle repeats. The water stays good right up to the point where the bed gives up.',
                      'match', 'Closest match',
                      [f'Same sawtooth every {dur(mean_gap)}', f'Same {num(reload_rate, 1)} ft/h reload rate'
                       if reload_ok else 'Same fast reload', 'Needs a media condition check to confirm'],
                      pair(tb, tb_e)),
            reference('trigger', 'variant', 'Variant', 'Run-time or turbidity trigger set too tight',
                      'Nothing wrong with the bed: the wash trigger simply fires early, so the filter washes at low '
                      'headloss with a normal climb rate in between. The same count of washes, for a reason that is '
                      'fixed in the control system rather than in the bed.', 'partial',
                      'Fits the count, not the climb',
                      [f'Here the climb between washes is {num(reload_rate, 1)} ft/h, not the normal '
                       f'{num(abs(pre_rate), 2)} ft/h' if reload_ok else 'Check the climb rate between washes',
                       'Worth reading the trigger setpoints before touching the media'], pair(vr, vr_e)),
            reference('routine', 'lookalike', 'Look-alike', 'One routine end-of-run backwash',
                      'A healthy filter runs to terminal headloss over a day or two, washes once, ripens and starts '
                      'again. One reset in a shift, from a high headloss, and no change in frequency.',
                      'nomatch', 'Does not match',
                      [f'{len(washes)} washes here, not one',
                       f'Washing at {num(median(at_wash), 1)} ft instead of near {num(p["terminal_ft"], 1)} ft']
                      + ([f'{tname(pack, with_one[0])} did exactly this at '
                          f'{ts[peer_w[with_one[0]][0]]} today'] if with_one else []),
                      pair(la, la_e)),
        ]
        sed = prev_stage(pack, aid) or stage_of(pack, aid, 'sedimentation')
        settled = pack.series(sed, 'settled_water_turbidity_ntu')
        peer_load = median([median(pack.series(prev_stage(pack, o) or stage_of(pack, o, 'sedimentation'),
                                               'settled_water_turbidity_ntu')) for o in peer_w])
        ro = [
            ruled_out('One routine end-of-run backwash', 'ruled out',
                      f'{len(washes)} washes in {dur(pack.minutes_between(first, last))}, each from about '
                      f'{num(median(at_wash), 1)} ft rather than one from terminal headloss.'),
            ruled_out('A headloss transmitter fault', 'ruled out' if pump_ok else 'unlikely',
                      (f'{len(pump_hits)} of {len(washes)} resets line up with the backwash pump stepping up to '
                       f'{num(max(pf[k] for k in washes), 0)} gpm and its motor current rising '
                       f'{signed(pct(max(pa[k] for k in washes), pa0), 0)} %, and with a ripening spike on the '
                       f'effluent turbidimeter. Three instruments, three assets.' if pump_ok else
                       'Not every reset is matched by the backwash pump, so a transmitter problem is still open.')),
            ruled_out('Dirtier water into this filter', 'ruled out',
                      f'Settled water into it is {num(median(settled), 2)} NTU against {num(peer_load, 2)} NTU '
                      f'median on the other trains, and this train\'s raw turbidity and dose are both normal.'),
            ruled_out('A backwash failing and retrying', 'ruled out',
                      f'Each wash completed: headloss back to {num(clean, 1)} ft, pump flow and current normal in '
                      f'the sample, effluent back under {num(p["ripen_ntu"], 2)} NTU within '
                      f'{dur(p["recover_min"])}. A failing wash leaves headloss high.'),
            ruled_out('Floc breakthrough forcing early washes', 'ruled out',
                      f'Effluent turbidity between washes stayed {num(min(eff[first:now + 1]), 2)}–'
                      f'{num(max(eff[first:now + 1]), 2)} NTU, and the only peaks are the ripening spikes just after '
                      f'each wash, not a rise before one.'),
        ]
        return {
            'conclusion': conclusion(
                'Most likely cause',
                f'The {tn} bed is reaching its wash point in about {dur(mean_gap)} instead of {num(normal_h, 0)} h, '
                f'and it is being washed at {num(median(at_wash), 1)} ft rather than near terminal headloss — early '
                f'media degradation, or a wash trigger set too tight for this bed',
                level,
                'A media check explains it' if level == 'high' else
                'Every wash is independently confirmed, the cause is not' if level == 'medium' else
                'Headloss only'),
            'rootCauseAssetId': bed,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(
                level,
                f'The washes themselves are certain: {len(pump_hits)} of {len(washes)} resets are matched by a step '
                f'in the backwash pump\'s own flow, with its motor current up in the same samples, and by a '
                f'ripening spike on the effluent turbidimeter. The '
                f'count against this filter\'s own {num(normal_h, 0)} h cycle is arithmetic.',
                'Why the runs are short is not settled. Degraded media and a trigger set too tight look identical '
                'from outside the filter, and nobody has checked either yet.',
                'A media condition check finds the bed shallow or its grading lost, or the wash trigger setpoints '
                'turn out to be tighter than the other filters\'.',
                'The bed probes clean and full depth and the triggers match the other filters. Then look at air '
                'binding and at the backwash rate itself, which can leave a bed that loads fast.',
                None),
            'action': action(item, pack),
            'model': {'target': 'backwash interval',
                      'formula': f'168 h ÷ {num(bw[0], 1)} washes/week = {num(normal_h, 0)} h between washes',
                      'fittedOn': f'{tn}\'s own projected cycle before {ts[first]}'},
            'impact': (f'{len(washes)} washes in {dur(pack.minutes_between(first, last))}, where a '
                       f'{num(normal_h, 0)} h cycle would have taken this filter '
                       f'{num(100 * pack.minutes_between(first, last) / 60.0 / normal_h, 0)} % of the way to one. '
                       f'UFRV is down {signed(uf_pct, 0)} % to {num(uf[now], 0)} gal/ft² and projected run length '
                       f'{signed(rt_pct, 0)} % to {num(rt[now], 0)} h, so the filter is making much less water '
                       f'between washes and using backwash water each time; the train loses about '
                       f'{num(abs(pct(min(pack.series(pack.unit_of(aid), "line_throughput")), median(pack.series(pack.unit_of(aid), "line_throughput")))), 1)} % '
                       f'of throughput in each wash sample.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. CT margin narrowing during contact-basin work — archetype 14 (compliance)
# ═════════════════════════════════════════════════════════════════════════
class CtMarginLoss(Detector):
    id = 'water.ct_margin_loss'
    name = 'CT margin narrowing'
    version = '0.1'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'disinfection stages'
    summary = ('Disinfection credit running out of margin: CT actual falling toward CT required because the contact '
               'basin has lost usable volume, with the free chlorine residual unchanged. Healthy equipment, a '
               'compliance number to watch.')
    pipeline = [
        ('Margin', 'CT actual against CT required, as a percentage'),
        ('Rate', 'how fast CT is falling, and how long the margin lasts at that rate'),
        ('Split it', 'CT = residual × T₁₀, so compare the change in each: C against T'),
        ('The limit', 'CT required, which moves with temperature and pH'),
        ('The basin', 'contact basin level and residence time; and the flow, which also shortens contact time'),
        ('Conclusion', 'margin thin, falling, and all of it contact time → raise; the maintenance record → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'disinfection'},
        'inputs': {'ct': 'self.ct_value_actual, .ct_value_required', 'time': 'self.contact_time_min',
                   'residual': 'self.chlorine_residual_mg_l', 'demand': 'self.chlorine_demand_mg_l',
                   'basin': 'child chlorine_contact_basin.level_pct, .residence_time_min',
                   'feed': 'child chlorine_feed_pump.dosing_flow_rate_gpm, .discharge_pressure_psi',
                   'flow': 'train.line_throughput', 'peers': 'the other five disinfection stages',
                   'log': 'the item\'s maintenance log (confidence only)'},
        'peers': {'same': 'assetType', 'count': 5,
                  'use': 'the margin the rest of the plant is holding on the same water temperature and pH'},
        'expected': {'model': 'CT physics', 'target': 'ct_value_actual',
                     'formula': 'free chlorine residual × T₁₀ × k; the margin is CT actual ÷ CT required − 1',
                     'fitOn': 'this stage\'s own residual and contact time over the first baseline_min'},
        'params': {'baseline_min': 120, 'margin_pct': 18.0, 'sustain_min': 10, 'project_min': 90,
                   'time_drop_pct': 8.0, 'res_band_pct': 4.0, 'req_band_pct': 3.0, 'level_drop_pct': 5.0,
                   'flow_band_pct': 3.0, 'slope_window_min': 60,
                   'peer_gap_pct': 8.0},
        'checks': [
            {'id': 'margin', 'role': 'required', 'rule': 'CT actual ÷ CT required − 1 < margin_pct'},
            {'id': 'falling', 'role': 'required',
             'rule': 'at the last slope_window_min rate, CT reaches CT required within project_min'},
            {'id': 'sustained', 'role': 'required', 'rule': 'the margin has been under margin_pct for sustain_min'},
            {'id': 'time', 'role': 'required',
             'rule': 'contact time down > time_drop_pct while the residual stays within ±res_band_pct'},
            {'id': 'limit', 'role': 'required', 'rule': 'CT required within ±req_band_pct of its baseline'},
            {'id': 'basin', 'role': 'supporting', 'independent': True,
             'rule': 'contact basin level down > level_drop_pct and residence time down with it'},
            {'id': 'flow', 'role': 'supporting', 'rule': 'train throughput within ±flow_band_pct of its baseline'},
            {'id': 'feed', 'role': 'supporting', 'independent': True,
             'rule': 'chlorine feed pump steady — the residual is being held, not chased'},
            {'id': 'peers', 'role': 'supporting',
             'rule': 'every other train\'s margin is more than peer_gap_pct points wider than this one\'s'},
            {'id': 'log', 'role': 'supporting', 'independent': True,
             'rule': 'a maintenance record on this basin in the hour before the fall'},
        ],
        'ruleOut': ['loss of chlorine residual', 'a colder or higher-pH water raising the required CT',
                    'more flow through the basin', 'a chlorine feed fault',
                    'a CT calculation or analyser change across the plant'],
        'confidence': {'low': 'required checks only',
                       'medium': 'the basin level and residence time agree that volume is out of service',
                       'high': 'a maintenance record puts planned work on this basin at the time the fall starts'},
        'references': ['textbook: baffle work with the residual raised first',
                       'variant: volume out of service with no compensation',
                       'look-alike: colder water raising the required CT'],
    }

    def candidates(self, pack):
        return pack.of_type('disinfection')

    def _ctx(self, pack, aid):
        p = self.p
        basin = pack.child_of_type(aid, 'chlorine_contact_basin')
        if basin is None:
            return None
        nb = pack.steps(p['baseline_min'])
        ct = pack.series(aid, 'ct_value_actual')
        req = pack.series(aid, 'ct_value_required')
        margin = [pct(a, b) for a, b in zip(ct, req)]
        tt = pack.series(aid, 'contact_time_min')
        cl = pack.series(aid, 'chlorine_residual_mg_l')
        return dict(basin=basin, ct=ct, req=req, margin=margin, tt=tt, cl=cl, nb=nb,
                    t0=median(tt[:nb]), c0=median(cl[:nb]), q0=median(req[:nb]))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        ct, req, margin, tt, cl = c['ct'], c['req'], c['margin'], c['tt'], c['cl']
        thin = [v is not None and v < p['margin_pct'] for v in margin]
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(thin, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(ct, i, sw, pack.step_min)
            if slope is None or slope >= 0:
                continue
            left = (ct[i] - req[i]) / (-slope) * 60.0
            if left > p['project_min']:
                continue
            if pct(tt[i], c['t0']) > -p['time_drop_pct']:
                continue
            if abs(pct(cl[i], c['c0'])) > p['res_band_pct']:
                continue
            if abs(pct(req[i], c['q0'])) > p['req_band_pct']:
                continue
            onset = s0
            while onset > 0 and pct(tt[onset - 1], c['t0']) < -p['time_drop_pct'] / 4:
                onset -= 1
            c.update(onset=onset, alert=s0, slope=slope, left=left)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        tn = tname(pack, aid)
        basin = c['basin']
        ct, req, margin, tt, cl = c['ct'], c['req'], c['margin'], c['tt'], c['cl']
        onset, alert = c['onset'], c['alert']
        nb = c['nb']
        slope = B.slope_per_hour(ct, now, pack.steps(p['slope_window_min']), pack.step_min)
        left = (ct[now] - req[now]) / (-slope) * 60.0 if slope and slope < 0 else None
        t_pct = pct(tt[now], c['t0'])
        c_pct = pct(cl[now], c['c0'])
        ct_pct = pct(ct[now], median(ct[:nb]))
        lev = pack.series(basin, 'level_pct')
        res_t = pack.series(basin, 'residence_time_min')
        l0, rt0 = median(lev[:nb]), median(res_t[:nb])
        lev_pct, rt_pct = pct(lev[now], l0), pct(res_t[now], rt0)
        basin_ok = lev_pct < -p['level_drop_pct']
        flow = pack.series(pack.unit_of(aid), 'line_throughput')
        f0 = median(flow[:nb])
        flow_dev = max(abs(pct(v, f0)) for v in flow[onset:now + 1])
        flow_ok = flow_dev < p['flow_band_pct']
        feed = pack.child_of_type(aid, 'chlorine_feed_pump')
        ff = pack.series(feed, 'dosing_flow_rate_gpm')
        ff_dev = max(abs(pct(v, median(ff[:nb]))) for v in ff[onset:now + 1])
        feed_ok = ff_dev < 10.0
        dem = pack.series(aid, 'chlorine_demand_mg_l')
        peer_margin = {}
        for o in peers_of(pack, aid):
            co = self._ctx(pack, o)
            if co:
                peer_margin[o] = co['margin'][now]
        peers_ok = all(v - margin[now] > p['peer_gap_pct'] for v in peer_margin.values())
        logs = maintenance_records(item, ts[max(0, onset - pack.steps(60))], ['baffle', 'basin', 'contact'])
        lev_onset = idx_at(pack, logs[0]['time']) if logs else onset
        level = 'high' if logs else ('medium' if basin_ok else 'low')
        md = nice_domain(ct, req, pad=0.06)
        w1 = win(pack, onset, now)

        checks = [
            check('margin', f'CT margin down to {signed(margin[now], 1)} %', 'required', MATCH,
                  f'CT actual {num(ct[now], 0)} against {num(req[now], 0)} required at {ts[now]} — '
                  f'{num(ct[now] - req[now], 0)} units of margin, {signed(margin[now], 1)} %. It was '
                  f'{signed(margin[onset], 1)} % at {ts[onset]}. The watch level is {num(p["margin_pct"], 0)} %.',
                  'CT is the disinfection credit: free chlorine residual multiplied by the contact time T₁₀. It has '
                  'to stay above the required CT for today\'s temperature and pH, every sample, for the log '
                  'inactivation the plant claims.',
                  spark(margin, nice_domain(margin, [0, p['margin_pct']]), threshold_value=p['margin_pct'])),
            check('falling', f'At this rate the margin lasts about {dur(left)}', 'required', MATCH,
                  f'CT falling {num(slope, 0)} per hour over the last {dur(p["slope_window_min"])}; '
                  f'{num(ct[now] - req[now], 0)} units of margin ÷ {num(abs(slope), 0)} per hour = '
                  f'{dur(left)}, around {clock(tmin(pack, now) + left)}. The projection flag is '
                  f'{dur(p["project_min"])}.',
                  'This is the number that makes it urgent rather than interesting: a straight-line projection of '
                  'the last hour onto the required CT. It is arithmetic, not a forecast of the work.',
                  spark(ct, md, threshold_value=req[now], highlight=[ts[alert], ts[now]])),
            check('sustained', 'Not one sample', 'required', MATCH,
                  f'Margin under {num(p["margin_pct"], 0)} % since {ts[alert]} '
                  f'({dur(pack.minutes_between(alert, now))}), and falling every sample since {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} under the watch level. CT is computed from two measurements, so a '
                  f'single noisy sample on either should not raise it.',
                  spark(margin, nice_domain(margin, [0, p['margin_pct']]), threshold_value=p['margin_pct'],
                        highlight=[ts[alert], ts[now]])),
            check('time', 'All of the loss is contact time, none of it residual', 'required', MATCH,
                  f'Contact time T₁₀ {num(tt[now], 1)} min against {num(c["t0"], 1)} min this morning '
                  f'({signed(t_pct, 1)} %); free chlorine residual {num(cl[now], 2)} mg/L against '
                  f'{num(c["c0"], 2)} mg/L ({signed(c_pct, 1)} %). CT itself is {signed(ct_pct, 1)} %.',
                  'CT is a product, so the percentage changes add up: T₁₀ down about a sixth and the residual flat '
                  'accounts for the whole CT loss. Nothing has gone wrong with dosing.',
                  spark(tt, nice_domain(tt, [c['t0']]), threshold_value=c['t0'] * (1 - p['time_drop_pct'] / 100))),
            check('limit', 'The required CT has not moved', 'required', MATCH,
                  f'CT required {num(min(req[onset:now + 1]), 0)}–{num(max(req[onset:now + 1]), 0)} against '
                  f'{num(c["q0"], 0)} this morning, inside ±{num(p["req_band_pct"], 0)} %.',
                  'Required CT rises in colder water and at higher pH. It has not moved, so the margin narrowed '
                  'because the plant side fell, not because the bar went up.',
                  spark(req, nice_domain(req, [c['q0']]))),
            check('basin', 'Basin volume out of service', 'supporting', MATCH if basin_ok else NO_MATCH,
                  f'Contact basin level {num(lev[now], 0)} % against {num(l0, 0)} % this morning '
                  f'({signed(lev_pct, 0)} %), and its residence time {num(res_t[now], 1)} min against '
                  f'{num(rt0, 1)} min ({signed(rt_pct, 0)} %).',
                  'Two separate instruments on the basin itself. T₁₀ is residence time times the baffling factor, so '
                  'taking volume or baffles out of service cuts contact time directly and immediately.',
                  spark(lev, nice_domain(lev, [l0]), threshold_value=l0 * (1 - p['level_drop_pct'] / 100))),
            check('flow', 'Not more flow', 'supporting', MATCH if flow_ok else NO_MATCH,
                  f'Train throughput {num(min(flow[onset:now + 1]), 2)}–{num(max(flow[onset:now + 1]), 2)} MGD '
                  f'against {num(f0, 2)} MGD this morning (within {num(flow_dev, 1)} %).',
                  'The other way to lose contact time is to push more water through the same basin. The train is '
                  'running at the same rate, so it is the basin that changed, not the flow.',
                  spark(flow, nice_domain(flow, [f0]), window=w1)),
            check('feed', 'Chlorine feed steady, not chasing the residual', 'supporting',
                  MATCH if feed_ok else NO_MATCH,
                  f'Feed pump flow within {num(ff_dev, 1)} % of its morning rate and chlorine demand '
                  f'{num(dem[now], 2)} mg/L against {num(median(dem[:nb]), 2)} mg/L.',
                  'If the residual were being held up against a rising demand, the feed pump would be working '
                  'harder. It is not — so there is headroom to raise the residual deliberately if the margin gets '
                  'thinner.',
                  spark(ff, nice_domain(ff), window=w1)),
            check('peers', 'The other five trains keep their usual margin', 'supporting',
                  MATCH if peers_ok else NO_MATCH,
                  f'{join_names([f"{tname(pack, o)} {signed(v, 0)} %" for o, v in sorted(peer_margin.items())])} '
                  f'against {signed(margin[now], 1)} % here, on the same water temperature and pH — every one of '
                  f'them at least {num(min(v - margin[now] for v in peer_margin.values()), 0)} points wider.',
                  'All six trains disinfect the same water with the same required CT. Only this basin lost margin, '
                  'which is where a plant-wide cause would have shown.',
                  spark(pack.series(max(peer_margin, key=lambda o: peer_margin[o]), 'ct_value_actual'), md)),
            check('log', 'Planned work logged on this basin', 'supporting', MATCH if logs else PENDING,
                  (f'"{logs[0]["description"]}" logged at {logs[0]["time"]}, when the basin was '
                   f'{num(lev[lev_onset], 0)} % full; it is {num(lev[now], 0)} % now, and contact time was '
                   f'measurably short by {ts[onset]}.'
                   if logs else 'No maintenance record on this basin yet.'),
                  'The maintenance log, not telemetry. It explains the lost volume and tells the operator the margin '
                  'comes back when the work finishes — this is a planned consequence, not a fault.',
                  None),
        ]
        main = chart('CT (mg/L · min)', md,
                     [series('actual', f'{tn} CT actual', ct, 'primary', 1),
                      series('required', 'CT required', req, 'expected', 1)],
                     title='What we see',
                     caption=f'{tn} disinfection credit against the credit it has to make. The gap is the margin: '
                             f'{num(ct[onset] - req[onset], 0)} units at {ts[onset]}, '
                             f'{num(ct[now] - req[now], 0)} now.',
                     shade_gap=['actual', 'required'], decimals=0,
                     markers=[marker(ts[onset], 'Contact time starts falling'),
                              marker(ts[alert], f'Margin under {num(p["margin_pct"], 0)} %')])

        grid = hours_grid(2, 1 / 12)
        r = Rng(4707)
        reqline = [120.0 + r.gauss(0.3) for _ in grid]
        tb = [155.0 - 26.0 * hh + 18.0 * max(0.0, hh - 0.5) + r.gauss(0.6) for hh in grid]
        vr = [155.0 - 26.0 * hh + r.gauss(0.6) for hh in grid]
        la = [152.0 + r.gauss(0.8) for hh in grid]
        la_req = [120.0 + 14.0 * min(hh, 1.5) + r.gauss(0.3) for hh in grid]
        live = f'{tn}, today'
        live_ct = aligned(ct, onset, pack.step_min, grid)

        def ct_chart(label, ref_values, req_values):
            return chart('CT', [100, 175], [series('ref', 'Reference example', ref_values, 'reference', 1),
                                            series('req', 'CT required', req_values, 'expected', 1),
                                            series('live', live, live_ct, 'primary', 1)],
                         title=label, x={'unit': 'h', 'values': grid}, decimals=0)
        refs = [
            reference('compensated', 'textbook', 'Textbook', 'Baffle work with the residual raised first',
                      'The crew takes a bay out, contact time drops, and the operator lifts the free chlorine '
                      'residual by a couple of tenths before the work starts. CT dips and then flattens well clear '
                      'of the required value, and the margin never gets interesting.', 'partial',
                      'What today still has time to be',
                      [f'Residual here is unchanged at {num(cl[now], 2)} mg/L',
                       f'The feed pump has headroom ({num(ff_dev, 1)} % off its morning rate)'],
                      [ct_chart('CT actual against required (h from the start of the fall)', tb, reqline)]),
            reference('uncompensated', 'variant', 'Variant', 'Volume out of service with no compensation',
                      'The same work with the dosing left alone. CT keeps falling at the rate the lost volume sets '
                      'and crosses the required value, which is a treatment-technique violation to report whether or '
                      'not the water was unsafe.', 'nomatch', 'Where today is heading',
                      [f'At {num(slope, 0)} per hour the crossing is about {dur(left)} away',
                       'Raising the residual or cutting the flow both stop it'],
                      [ct_chart('CT actual against required', vr, reqline)]),
            reference('cold', 'lookalike', 'Look-alike', 'Colder water raising the required CT',
                      'The margin narrows by the same amount, but from the other side: CT actual is flat and the '
                      'required CT climbs as the water cools or the pH rises. Nothing is out of service and the fix '
                      'is dosing, not the basin.', 'nomatch', 'Does not match',
                      [f'Required CT held {num(min(req[onset:now + 1]), 0)}–{num(max(req[onset:now + 1]), 0)} today',
                       f'Contact time fell {signed(t_pct, 0)} % — that is the whole story'],
                      [ct_chart('CT actual against required', la, la_req)]),
        ]
        ro = [
            ruled_out('Loss of chlorine residual', 'ruled out',
                      f'Free chlorine residual {num(cl[now], 2)} mg/L against {num(c["c0"], 2)} mg/L this morning '
                      f'({signed(c_pct, 1)} %), and chlorine demand is flat at {num(dem[now], 2)} mg/L.'),
            ruled_out('Colder or higher-pH water raising the required CT', 'ruled out',
                      f'CT required stayed {num(min(req[onset:now + 1]), 0)}–{num(max(req[onset:now + 1]), 0)} '
                      f'through the fall, within ±{num(p["req_band_pct"], 0)} % of {num(c["q0"], 0)}.'),
            ruled_out('More flow through the basin', 'ruled out',
                      f'Train throughput held within {num(flow_dev, 1)} % of {num(f0, 2)} MGD, so the shorter '
                      f'contact time is lost volume, not velocity.'),
            ruled_out('A chlorine feed fault', 'ruled out' if feed_ok else 'unlikely',
                      (f'Feed pump flow within {num(ff_dev, 1)} % of its morning rate with normal discharge '
                       f'pressure, and the residual it is holding has not moved.' if feed_ok else
                       'The feed pump rate has moved; worth checking before blaming the basin.')),
            ruled_out('A plant-wide CT calculation or analyser change', 'ruled out' if peers_ok else 'not yet checked',
                      (f'The other five trains are at '
                       f'{join_names([signed(v, 0) + " %" for _, v in sorted(peer_margin.items())])} margin, every '
                       f'one of them well above this basin on the same required CT.' if peers_ok else
                       'Another train is thin as well, so a shared cause is still open.')),
        ]
        return {
            'conclusion': conclusion(
                'What\'s needed',
                f'Hold the margin until the {tn} contact basin is back in service: contact time is down '
                f'{signed(t_pct, 0)} % ({num(c["t0"], 0)} → {num(tt[now], 0)} min) at an unchanged residual, which '
                f'leaves {num(ct[now] - req[now], 0)} CT units — about {dur(left)} at the present rate',
                level,
                'The cause is a logged, planned job; the margin is the thing to manage' if level == 'high' else
                'The basin data explains it' if level == 'medium' else 'CT arithmetic only'),
            'rootCauseAssetId': basin,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(
                level,
                'CT is a product of two measured numbers and the split is unambiguous: contact time '
                f'{signed(t_pct, 1)} %, residual {signed(c_pct, 1)} %, CT {signed(ct_pct, 1)} %. The basin level and '
                f'residence time, two instruments on the basin, agree that volume is out of service'
                + (f', and the maintenance log puts planned baffle work on this basin at {logs[0]["time"]}.'
                   if logs else '.'),
                None if logs else 'Nothing in the records yet explains the lost volume.',
                None if logs else 'A maintenance record or a permit confirms work on this basin.',
                'The basin level comes back without any work being recorded. Then the level instrument or a valve '
                'line-up is the thing to check, not the baffles.',
                f'Maintenance log: "{logs[0]["description"]}" at {logs[0]["time"]}' if logs else None),
            'action': action(item, pack),
            'model': {'target': 'ct_value_actual',
                      'formula': f'free chlorine residual × T₁₀ × k; today {num(cl[now], 2)} mg/L × '
                                 f'{num(tt[now], 1)} min → {num(ct[now], 0)} against {num(req[now], 0)} required',
                      'fittedOn': f'{tn}\'s own residual and contact time over the first {dur(p["baseline_min"])}'},
            'impact': (f'Margin {num(ct[onset] - req[onset], 0)} → {num(ct[now] - req[now], 0)} CT units in '
                       f'{dur(pack.minutes_between(onset, now))}, {signed(margin[now], 1)} % above the required '
                       f'value against {signed(median([v for v in peer_margin.values()]), 0)} % on the other '
                       f'trains. Still compliant every sample so far. Raising the residual from '
                       f'{num(cl[now], 2)} to {num(cl[now] * req[now] * 1.15 / ct[now], 2)} mg/L would restore a '
                       f'15 % margin at the present contact time; so would cutting the flow.'),
        }


DETECTORS = [CoagulantDeliveryLoss(), SludgeBlanketRise(), FilterMediaFouling(),
             SettledTurbidimeterFault(), RawTurbidityShock(), FilterBackwashCycling(), CtMarginLoss()]


def main():
    pack, out, report, path = run_pack(REPO, 'water', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())

