#!/usr/bin/env python3
"""Solace Park (biologics, mAb drug substance) — detectors and explanations
(INDUSTRY_PACK_SPEC.md §14).

Runs every pharma detector on every asset it applies to, using only the
pack's runtime files in public/data/pharma/, and writes
public/data/pharma/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus
each detector's definition and where it fired today.

    python3 ModelAndData/industries/pharma/generate.py     # the data
    python3 ModelAndData/industries/pharma/explain.py      # the explanations

Detectors never read generate.py's scenario constants. If a detector
misses a scenario, or fires where no attention item exists, the run report
says so and the exit code is 1 for a miss.

A biologics plant has few identical machines running the same duty at the
same time (PBR-1 is on day 13 at 33 °C, PBR-2 on day 7 at 36.5 °C), so
"expected" here is usually the asset's own behaviour earlier in the shift
at the same setpoint, a redundant instrument on the same vessel (DO probe
A against B), or physics (steam saturation pressure, F₀). Sister assets
are used to rule out shared causes.

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
                           check, dur, marker, nice_domain, num, reference, ruled_out, run_pack, print_report,
                           series, spark, threshold)
from detectors.build import signed as _signed    # noqa: E402


# ── Small helpers (same shape as ccgt/explain.py) ───────────────────────
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
    return [round(h_min + k * step, 3) for k in range(n + 1)]


def minutes_grid(m_min, m_max, step):
    return list(range(m_min, m_max + 1, step))


def ref_chart(label, unit, y, grid, grid_unit, ref_values, live_values, live_label, decimals=1, thresholds=None):
    return chart(unit, y, [series('ref', 'Reference example', ref_values, 'reference', 3),
                           series('live', live_label, live_values, 'primary', 3)],
                 title=label, x={'unit': grid_unit, 'values': grid}, decimals=decimals, thresholds=thresholds)


def short(pack, aid):
    """'PBR-2 pCO₂ Probe' style name: the unit plus the asset's own name."""
    u = pack.unit_of(aid)
    if u is None or u == aid:
        return pack.name(aid)
    return f'{pack.name(u)} {pack.name(aid)}'


def idx_at(pack, iso):
    """Grid index of an ISO time (first grid point at or after it), or None."""
    if not iso:
        return None
    hm = iso[11:16]
    for k, t in enumerate(pack.ts):
        if t >= hm:
            return k
    return None


REPAIR_TYPES = ('MAINTENANCE', 'INSPECTION', 'INSTRUMENT_CHECK')


def done_work(pack, aids, types=REPAIR_TYPES):
    """Done work items on any of these assets, earliest first: [(item, index of completion)].
    By default only hands-on work (maintenance, inspection, instrument checks), not reviews or samples."""
    out = []
    for w in pack.work:
        if w['assetId'] in aids and w.get('done') and (types is None or w['workType'] in types):
            k = idx_at(pack, w.get('completedAt'))
            if k is not None:
                out.append((w, k))
    return sorted(out, key=lambda x: x[1])


def wtime(w):
    """A work item's real completion time, HH:MM."""
    return (w.get('completedAt') or '')[11:16]


def open_work(pack, aids, types=None):
    return [w for w in pack.work if w['assetId'] in aids and not w.get('done')
            and (types is None or w['workType'] in types)]


def median(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def mean_between(v, i0, i1):
    return B.mean(v[max(0, i0):i1 + 1])


def diffs(v):
    return [None] + [None if a is None or b is None else b - a for a, b in zip(v, v[1:])]


def signed(v, decimals=1):          # noqa: F811 — the toolkit's, without a '−0.0'
    return _signed(None if v is None else round(v, decimals) + 0.0, decimals)


def tmin(pack, k):
    """Minutes since midnight of grid point k."""
    h, m = pack.ts[k].split(':')
    return int(h) * 60 + int(m)


def clock(minutes):
    """Minutes since today's midnight → 'HH:MM', with 'tomorrow' past midnight."""
    d, r = divmod(int(round(minutes)), 1440)
    s = f'{r // 60:02d}:{r % 60:02d}'
    return s if d == 0 else s + (' tomorrow' if d == 1 else f' (+{d} days)')


def stepped(values, k0, k1):
    """[(index, value)] where the value changes between k0 and k1: for signals held between updates."""
    return [(k, values[k]) for k in range(max(1, k0), k1 + 1) if values[k] != values[k - 1]]


def tsat_c(p_barg):
    """Saturation temperature of steam (°C) at a gauge pressure in bar (Antoine, water)."""
    p_mmhg = (p_barg + 1.01325) * 750.062
    return 1730.63 / (8.07131 - math.log10(p_mmhg)) - 233.426


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


# ═════════════════════════════════════════════════════════════════════════
# 1. Agitator drive wear — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class AgitatorDriveWear(Detector):
    id = 'pharma.agitator_drive_wear'
    name = 'Agitator drive wear'
    archetype = '05 Component degradation'
    applies_to = 'agitator drives'
    summary = ('A bioreactor agitator\'s gearbox vibrating more and more at an unchanged speed, gradually and '
               'speeding up, with the mechanical seal below it warming as well.')
    pipeline = [
        ('Running', 'agitator above 10 rpm for the last hour; a stopped or steaming vessel says nothing about wear'),
        ('Expected value', 'the drive\'s own vibration over the first hour of the shift, at the same speed'),
        ('Residual', 'actual − expected: vibration the speed doesn\'t explain'),
        ('Checks', 'higher · rising steadily · sustained · same speed · seal warmer · power · other drives flat'),
        ('Conclusion', 'all required checks → raise; seal temperature (a separate sensor) agrees → medium'),
    ]
    definition = {
        'appliesTo': {'assetType': 'agitation_module'},
        'inputs': {'vib': 'self.gearbox_vibration_mms', 'speed': 'self.agitator_speed_rpm',
                   'power': 'self.agitator_power_kw', 'seal': 'self.seal_temp_c',
                   'peers': 'other agitation_module.gearbox_vibration_mms (running ones)'},
        'peers': {'same': 'assetType', 'count': 'agitator running (speed > min_rpm for run_min)',
                  'use': 'rule out a shared cause only; drives differ in size and speed'},
        'expected': {'model': 'own baseline at constant speed', 'target': 'vib',
                     'formula': 'median(vib over the first baseline_min)', 'fitOn': 'self'},
        'params': {'min_rpm': 10, 'run_min': 60, 'baseline_min': 60, 'rise_mms': 0.5, 'watch_mms': 0.25,
                   'sustain_min': 30, 'slope_window_min': 120, 'min_slope_mms_h': 0.15, 'max_step_mms': 0.4,
                   'speed_band_rpm': 1.0, 'seal_rise_c': 3.0, 'power_rise_pct': 1.5, 'peer_band_mms': 0.3,
                   'iso_alert_mms': 4.5, 'iso_alarm_mms': 7.1},
        'checks': [
            {'id': 'up', 'role': 'required', 'rule': 'vib − baseline > rise_mms'},
            {'id': 'gradual', 'role': 'required', 'rule': 'slope(residual, slope_window_min) > min_slope_mms_h and maxStep(vib since onset) < max_step_mms'},
            {'id': 'sustained', 'role': 'required', 'rule': 'vib − baseline > rise_mms for sustain_min'},
            {'id': 'speed', 'role': 'required', 'rule': 'speed within ±speed_band_rpm of its baseline all shift'},
            {'id': 'seal', 'role': 'supporting', 'independent': True, 'rule': 'seal temperature > baseline + seal_rise_c'},
            {'id': 'power', 'role': 'supporting', 'rule': 'agitator power > baseline × (1 + power_rise_pct/100) at the same speed'},
            {'id': 'peers', 'role': 'supporting', 'rule': 'every other running drive within ±peer_band_mms of its own baseline'},
        ],
        'ruleOut': ['process load (speed change)', 'faulty vibration sensor', 'a shared cause across the suite',
                    'seal problem on its own'],
        'confidence': {'low': 'required checks only', 'medium': 'seal temperature agrees (independent sensor)',
                       'high': 'confirmed by a vibration spectrum, an oil check or inspection'},
        'references': ['textbook: gearbox bearing wear', 'early stage: lubricant breakdown', 'look-alike: speed step'],
    }

    def candidates(self, pack):
        return pack.of_type('agitation_module')

    def _ctx(self, pack, aid):
        p = self.p
        speed = pack.series(aid, 'agitator_speed_rpm')
        run = B.running_mask(speed, p['min_rpm'], pack.steps(p['run_min']))
        nb = pack.steps(p['baseline_min'])
        if not all(v > p['min_rpm'] for v in speed[:nb]):
            return None
        vib = pack.series(aid, 'gearbox_vibration_mms')
        base = median(vib[:nb])
        sbase = median(speed[:nb])
        res = [v - base if r else None for v, r in zip(vib, run)]
        return dict(speed=speed, run=run, vib=vib, base=base, sbase=sbase, res=res)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        res, sp = c['res'], c['speed']
        hi, watch = B.gt(res, p['rise_mms']), B.gt(res, p['watch_mms'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if max(abs(v - c['sbase']) for v in sp[:i + 1]) > p['speed_band_rpm']:
                continue
            onset = s0
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(res, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_mms_h'] and B.max_step(c['vib'], onset, i) < p['max_step_mms']:
                c.update(onset=onset, alert=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        vib, res, speed, base = c['vib'], c['res'], c['speed'], c['base']
        onset, alert = c['onset'], c['alert']
        nb = pack.steps(p['baseline_min'])
        exp = [base] * pack.n
        slope = B.slope_per_hour(res, now, pack.steps(p['slope_window_min']), pack.step_min)
        slope_1h = B.slope_per_hour(res, now, pack.steps(60), pack.step_min)
        step = B.max_step(vib, onset, now)
        seal = pack.series(aid, 'seal_temp_c')
        seal0 = median(seal[:nb])
        seal_ok = seal[now] - seal0 > p['seal_rise_c']
        seal_on = next((k for k in range(nb, now + 1) if seal[k] - seal0 > p['seal_rise_c']), None)
        pw = pack.series(aid, 'agitator_power_kw')
        pw0 = median(pw[:nb])
        pw_now = mean_between(pw, now - pack.steps(30) + 1, now)
        pw_pct = 100 * (pw_now / pw0 - 1)
        pw_ok = pw_pct > p['power_rise_pct']
        others = [a for a in self.candidates(pack) if a != aid]
        running, idle, drift = [], [], {}
        for o in others:
            osp = pack.series(o, 'agitator_speed_rpm')
            if all(v > p['min_rpm'] for v in osp[:nb]) and osp[now] > p['min_rpm']:
                ov = pack.series(o, 'gearbox_vibration_mms')
                running.append(o)
                drift[o] = mean_between(ov, now - pack.steps(30) + 1, now) - median(ov[:nb])
            else:
                idle.append(o)
        peers_ok = bool(running) and all(abs(d) < p['peer_band_mms'] for d in drift.values())
        level = 'medium' if seal_ok else 'low'
        to_alarm = (p['iso_alarm_mms'] - vib[now]) / slope_1h if slope_1h and slope_1h > 0 else None
        pk = max(running, key=lambda o: abs(drift[o])) if running else None
        pv = pack.series(running[0], 'gearbox_vibration_mms') if running else None
        rd = nice_domain(res, [0, p['rise_mms']], pad=0.1)
        sd = nice_domain(speed, [c['sbase'] - 2, c['sbase'] + 2])

        checks = [
            check('up', 'Vibrating more than it did at the same speed', 'required', MATCH,
                  f'{num(vib[now], 2)} mm/s now against {num(base, 2)} mm/s over the first hour '
                  f'({signed(res[now], 2)} mm/s). Flag level is +{num(p["rise_mms"], 1)} mm/s.',
                  'At a fixed speed a healthy gearbox vibrates at a fixed level. Extra vibration is coming from '
                  'inside the drive.',
                  spark(res, rd, threshold_value=p['rise_mms'])),
            check('gradual', 'Rising steadily, and faster', 'required', MATCH,
                  f'{signed(slope, 2)} mm/s per hour over the last {dur(p["slope_window_min"])}, '
                  f'{signed(slope_1h, 2)} mm/s per hour over the last hour. Largest 5-min step: {num(step, 2)} mm/s.',
                  'Wear grows gradually and speeds up as damaged surfaces make more damage. A loose sensor or cable '
                  'jumps instead.',
                  spark(res, rd, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained, not a passing spike', 'required', MATCH,
                  f'Above +{num(p["rise_mms"], 1)} mm/s since {ts[alert]} ({dur(pack.minutes_between(alert, now))}); '
                  f'above +{num(p["watch_mms"], 2)} mm/s since {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} above the flag level, so a sampling spike can\'t raise it.',
                  spark(res, rd, threshold_value=p['rise_mms'], highlight=[ts[alert], ts[now]])),
            check('speed', 'Same speed all shift', 'required', MATCH,
                  f'{num(min(speed), 1)}–{num(max(speed), 1)} rpm all day (setpoint about {num(c["sbase"], 0)} rpm).',
                  'Vibration rises with speed. With the speed unchanged, the process isn\'t asking more of the drive.',
                  spark(speed, sd)),
            check('seal', 'Mechanical seal warming too', 'supporting', MATCH if seal_ok else NO_MATCH,
                  f'{num(seal[now])} °C now against {num(seal0)} °C over the first hour'
                  + (f'; more than +{num(p["seal_rise_c"], 0)} °C since {ts[seal_on]}.' if seal_on is not None else '.'),
                  'A separate sensor. Friction heat from a worn gearbox bearing travels down the shaft to the '
                  'bottom-entry seal.',
                  spark(seal, nice_domain(seal, [seal0]), threshold_value=seal0 + p['seal_rise_c'])),
            check('power', 'Drawing a little more power', 'supporting', MATCH if pw_ok else NO_MATCH,
                  f'{num(pw_now, 2)} kW over the last 30 min against {num(pw0, 2)} kW in the first hour '
                  f'({signed(pw_pct, 1)} %), at the same speed.',
                  'Friction in a worn drive costs power. A small rise at constant speed fits; a large one would '
                  'point at the process (foam, viscosity).',
                  spark(pw, nice_domain(pw))),
            check('peers', 'Other agitators unchanged', 'supporting', MATCH if peers_ok else NO_MATCH,
                  (f'{join_names([short(pack, o) for o in running])}: within {num(max(abs(d) for d in drift.values()), 2)} '
                   f'mm/s of their own first hour.' if running else 'No other agitator running to compare with.'),
                  'Drives in the same suite share power supply, floor and utilities. Only this one changed.',
                  spark(pv, nice_domain(pv, vib)) if pv else None),
        ]
        main = chart('mm/s', nice_domain(vib, [base, p['iso_alert_mms']], pad=0.05),
                     [series('actual', f'{uname} gearbox vibration', vib, 'primary', 2),
                      series('expected', 'Expected at the same speed', exp, 'expected', 2)],
                     title='What we see',
                     caption=f'{uname} agitator gearbox vibration against its own level over the first hour, at the '
                             f'same {num(c["sbase"], 0)} rpm. The shaded gap is vibration the speed doesn\'t explain.',
                     shade_gap=['actual', 'expected'], decimals=2,
                     thresholds=[threshold(p['iso_alert_mms'], 'Alert')],
                     markers=[marker(ts[onset], 'Divergence begins'), marker(ts[alert], f'Flag: +{num(p["rise_mms"], 1)} mm/s')])

        grid = hours_grid(6, 0.25)
        r = Rng(2101)
        tb = [0.15 * hh + 0.07 * hh * hh + r.gauss(0.05) for hh in grid]
        tb_s = [0.25 * hh + 0.12 * hh * hh + r.gauss(0.2) for hh in grid]
        ea = [0.12 * hh + r.gauss(0.05) for hh in grid]
        ea_s = [0.2 * hh + r.gauss(0.2) for hh in grid]
        la = [(0.0 if hh < 1.5 else 0.9) + r.gauss(0.05) for hh in grid]
        la_s = [r.gauss(0.2) for hh in grid]
        live_r = aligned(res, onset, pack.step_min, grid)
        live_s = aligned([v - seal0 for v in seal], onset, pack.step_min, grid)
        live = f'{uname}, today'

        def pair(a, b):
            return [ref_chart('Extra vibration at the same speed (h from onset)', 'mm/s', [-0.5, 3.5], grid, 'h', a,
                              live_r, live, 2),
                    ref_chart('Seal temperature rise', '°C', [-2, 12], grid, 'h', b, live_s, live, 1)]
        refs = [
            reference('wear', 'textbook', 'Textbook', 'Gearbox bearing wear, confirmed at turnaround',
                      'Vibration climbs and speeds up over a day, the seal warms behind it, and the spectrum shows '
                      'bearing defect frequencies. The batch is nursed to harvest and the bearing replaced.',
                      'match', 'Closest match',
                      ['Same accelerating climb at constant speed', 'Seal temperature following'], pair(tb, tb_s)),
            reference('lube', 'early', 'Early stage', 'Lubricant breaking down',
                      'A slower, straight rise with the seal barely moving. An oil check catches it before an alarm does.',
                      'partial', 'Same direction, slower',
                      [f'{uname} is past this stage: the rise is speeding up', 'Where an oil check pays for itself'],
                      pair(ea, ea_s)),
            reference('speed', 'lookalike', 'Look-alike', 'Speed step after a recipe change',
                      'Vibration steps up the moment the agitator speed is raised, then stays flat. Nothing is wrong; '
                      'it is the new operating point.',
                      'nomatch', 'Doesn\'t match',
                      [f'Speed held {num(min(speed), 1)}–{num(max(speed), 1)} rpm here', 'This is a curve, not a step'],
                      pair(la, la_s)),
        ]
        ro = [
            ruled_out('More load from the process (speed or setpoint change)', 'ruled out',
                      f'Speed stayed {num(min(speed), 1)}–{num(max(speed), 1)} rpm all day and power rose only '
                      f'{signed(pw_pct, 1)} %. A load change would move both much more.'),
            ruled_out('Faulty vibration sensor', 'ruled out' if seal_ok else 'unlikely',
                      f'The rise is smooth (largest 5-min step {num(step, 2)} mm/s)'
                      + (f', and the seal temperature, a separate sensor, rose {signed(seal[now] - seal0)} °C with it.'
                         if seal_ok else '.')),
            ruled_out('Something shared across the suite (supply, floor, utilities)', 'ruled out' if peers_ok else 'not yet checked',
                      (f'{join_names([short(pack, o) for o in running])} stayed within {num(max(abs(d) for d in drift.values()), 2)} '
                       f'mm/s of their own level.' if running else 'No other agitator running today.')),
            ruled_out('A seal problem on its own', 'not yet checked',
                      'The seal warmed as the vibration rose, which fits heat from the drive. Seal barrier pressure '
                      'and condensate are not in the data; the vibration route checks them.'),
        ]
        excl = (f'Not used for comparison: {join_names([short(pack, o) for o in idle])} (not running all shift). '
                f'A stopped agitator shows nothing about wear.') if idle else None
        return {
            'conclusion': conclusion('Most likely cause', f'Wear in the {uname} agitator gearbox (bearing or lubrication), '
                                     'with heat reaching the mechanical seal', level,
                                     'Vibration and seal temperature agree' if seal_ok else 'Vibration only so far'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': excl,
            'confidence': confidence(level,
                                     'Vibration and seal temperature are separate sensors and both point at the drive, at '
                                     'an unchanged speed.' if seal_ok else 'Only the vibration shows it so far.',
                                     'Nobody has taken a vibration spectrum or checked the oil yet. From trends alone, '
                                     'bearing wear and lubricant loss look alike.',
                                     'The spectrum shows gearbox bearing defect frequencies, or the oil is low or dark.',
                                     'The spectrum is clean. Then check the sensor mounting and the seal barrier system.'),
            'action': action(item, pack),
            'model': {'target': 'gearbox_vibration_mms',
                      'formula': f'{num(base, 2)} mm/s, the median over the first {dur(p["baseline_min"])} at '
                                 f'{num(c["sbase"], 0)} rpm',
                      'fittedOn': 'this drive\'s own first hour; speed unchanged since'},
            'impact': (f'At the last hour\'s rate ({signed(slope_1h, 2)} mm/s per hour) it would reach the '
                       f'{num(p["iso_alarm_mms"], 1)} mm/s alarm in about {dur(to_alarm * 60)}, around '
                       f'{clock(tmin(pack, now) + to_alarm * 60)}.' if to_alarm else None),
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. DO probe fault — archetype 06 (instrument, not process)
# ═════════════════════════════════════════════════════════════════════════
class DoProbeFault(Detector):
    id = 'pharma.do_probe_fault'
    name = 'Dissolved-oxygen probe fault'
    archetype = '06 Signal noise'
    applies_to = 'DO probes'
    summary = ('One DO probe jumping up and down by tens of percent while the redundant probe in the same vessel, '
               'the O₂ sparge that the DO loop drives, and the culture itself all stay steady.')
    pipeline = [
        ('Erratic', 'count large up-and-down jumps on the probe over the last 30 minutes'),
        ('Redundant probe', 'the other DO probe in the same vessel, over the same 30 minutes'),
        ('What the process says', 'O₂ sparge flow (the DO loop\'s output) and the culture\'s growth'),
        ('Probe diagnostic', 'the transmitter\'s signal-quality index'),
        ('Conclusion', 'nothing physical confirms the swings → instrument; clean after a connector fix → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'do_probe'},
        'inputs': {'do': 'self.do_pct', 'quality': 'self.probe_quality_index',
                   'partner': 'sibling do_probe.do_pct', 'o2': 'parent[gas_control_module].o2_flow_slpm',
                   'culture': 'unit.vcd_e6_ml or seed_vcd_e6_ml; sibling pco2_probe.pco2_mmhg',
                   'fix': 'done work items on this probe'},
        'params': {'min_do_pct': 5, 'jump_pts': 10, 'min_jumps': 3, 'window_min': 30, 'disagree_pts': 10,
                   'partner_band_pts': 3.0, 'o2_step_slpm': 1.0, 'quality_drop': 20, 'agree_pts': 2.0,
                   'recover_min': 30, 'vcd_drop_pct': 2.0},
        'checks': [
            {'id': 'erratic', 'role': 'required', 'rule': '≥ min_jumps alternating jumps > jump_pts within window_min'},
            {'id': 'disagree', 'role': 'required', 'rule': '|DO − partner DO| > disagree_pts inside the window'},
            {'id': 'partner', 'role': 'required', 'rule': 'partner DO range < partner_band_pts over the window'},
            {'id': 'o2', 'role': 'required', 'rule': 'largest 5-min change in O₂ sparge < o2_step_slpm over the window'},
            {'id': 'quality', 'role': 'supporting', 'independent': True, 'rule': 'quality index < partner quality − quality_drop during the episode'},
            {'id': 'culture', 'role': 'supporting', 'independent': True, 'rule': 'VCD did not fall by more than vcd_drop_pct over the episode'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'within ±agree_pts of the partner for recover_min after a done work item on this probe'},
        ],
        'confidence': {'medium': 'required checks + probe diagnostic or culture agrees', 'high': 'clean again after the probe was fixed'},
    }

    def candidates(self, pack):
        return pack.of_type('do_probe')

    def _jumps(self, v, i0, i1, jump):
        d = diffs(v)
        out, last = [], 0
        for k in range(max(1, i0), i1 + 1):
            if abs(d[k]) > jump and (last == 0 or (d[k] > 0) != (last > 0)):
                out.append(k)
                last = d[k]
        return out

    def evaluate(self, pack, aid):
        p = self.p
        gas = pack.parent(aid)
        partner = next((x for x in pack.children.get(gas, []) if x != aid and pack.asset(x)['assetType'] == 'do_probe'), None)
        if partner is None or not pack.has(gas, 'o2_flow_slpm'):
            return Finding(aid, False)
        do, pdo, o2 = pack.series(aid, 'do_pct'), pack.series(partner, 'do_pct'), pack.series(gas, 'o2_flow_slpm')
        w = pack.steps(p['window_min'])
        for i in range(w, pack.n):
            i0 = i - w + 1
            if min(pdo[i0:i + 1]) < p['min_do_pct']:
                continue
            jumps = self._jumps(do, i0, i, p['jump_pts'])
            if len(jumps) < p['min_jumps']:
                continue
            if max(abs(a - b) for a, b in zip(do[i0:i + 1], pdo[i0:i + 1])) <= p['disagree_pts']:
                continue
            if max(pdo[i0:i + 1]) - min(pdo[i0:i + 1]) >= p['partner_band_pts']:
                continue
            if B.max_step(o2, i0, i) >= p['o2_step_slpm']:
                continue
            start = jumps[0]
            while True:
                earlier = self._jumps(do, start - w, start - 1, p['jump_pts'])
                if not earlier:
                    break
                start = earlier[0]
            return Finding(aid, True, i, do=do, pdo=pdo, o2=o2, partner=partner, gas=gas, start=start, i0=i0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        do, pdo, o2, partner, start, i0 = c['do'], c['pdo'], c['o2'], c['partner'], c['start'], c['i0']
        pname, name = pack.name(partner), pack.name(aid)
        jumps_all = self._jumps(do, start, now, p['jump_pts'])
        end = jumps_all[-1]
        n_j = len(jumps_all)
        lo, hi = min(do[start:end + 1]), max(do[start:end + 1])
        q, pq = pack.series(aid, 'probe_quality_index'), pack.series(partner, 'probe_quality_index')
        qmin = min(q[start:end + 1])
        q_ok = qmin < median(pq[start:end + 1]) - p['quality_drop']
        vkey = 'vcd_e6_ml' if pack.has(unit, 'vcd_e6_ml') else 'seed_vcd_e6_ml'
        vcd = pack.series(unit, vkey)
        v0, v1 = mean_between(vcd, start - 2, start), mean_between(vcd, end, end + 2)
        vcd_ok = (v1 / v0 - 1) * 100 > -p['vcd_drop_pct']
        pco2p = pack.descendant_of_type(unit, 'pco2_probe')
        pco2 = pack.series(pco2p, 'pco2_mmhg') if pco2p else None
        fixes = [(w, k) for w, k in done_work(pack, [aid]) if k >= start]
        fix = fixes[0] if fixes else None
        fixed = False
        if fix:
            k = fix[1]
            k1 = k + pack.steps(p['recover_min'])
            fixed = k1 <= now and all(abs(a - b) <= p['agree_pts'] for a, b in zip(do[k:k1 + 1], pdo[k:k1 + 1]))
        indep = q_ok or vcd_ok
        level = 'high' if fixed else ('medium' if indep else 'low')
        w_ep = win(pack, start, fix[1] if fix else end, 6)
        dd = [0, 80]
        o_lo, o_hi = min(o2[start:end + 1]), max(o2[start:end + 1])

        checks = [
            check('erratic', f'{name} jumping', 'required', MATCH,
                  f'{n_j} swings of more than {num(p["jump_pts"], 0)} points between {ts[start]} and {ts[end]}, from '
                  f'{num(lo, 1)} % to {num(hi, 1)} %. Flagged at {ts[i]}.',
                  'Dissolved oxygen in a 2,000 L or 12,000 L vessel can\'t move tens of percent in five minutes and '
                  'back: the liquid holds too much oxygen and the loop is too slow.',
                  spark(do, dd, pdo, pdo, window=w_ep)),
            check('disagree', f'Disagrees with {pname}', 'required', MATCH,
                  f'Up to {num(max(abs(a - b) for a, b in zip(do[start:end + 1], pdo[start:end + 1])), 1)} points apart; '
                  f'normally within {num(p["agree_pts"], 0)}.',
                  'Two probes in the same liquid should read the same. When they part, one of them is wrong.',
                  spark([a - b for a, b in zip(do, pdo)], [-40, 40], threshold_value=p['disagree_pts'], window=w_ep)),
            check('partner', f'{pname} steady', 'required', MATCH,
                  f'{pname} read {num(min(pdo[start:end + 1]), 1)}–{num(max(pdo[start:end + 1]), 1)} % over the same time.',
                  f'{pname} is the probe the DO loop controls on. It saw nothing.',
                  spark(pdo, [30, 50], window=w_ep)),
            check('o2', 'O₂ sparge never moved', 'required', MATCH,
                  f'O₂ flow {num(o_lo, 1)}–{num(o_hi, 1)} slpm through the episode, rising slowly with the cells; largest '
                  f'5-min change {num(B.max_step(o2, start, end), 1)} slpm.',
                  'If oxygen had really dropped or spiked, the DO loop would have opened or closed the O₂ valve.',
                  spark(o2, nice_domain(o2), window=w_ep)),
            check('quality', 'Probe diagnostic dropped', 'supporting', MATCH if q_ok else NO_MATCH,
                  f'Signal quality fell to {num(qmin, 0)} (from about {num(median(q[:start]), 0)}); {pname} stayed at '
                  f'{num(min(pq[start:end + 1]), 0)}–{num(max(pq[start:end + 1]), 0)}.',
                  'The transmitter\'s own check of the probe signal. A loose connector or wet cable drags it down.',
                  spark(q, [0, 100], pq, pq, window=w_ep)),
            check('culture', 'Culture kept growing', 'supporting', MATCH if vcd_ok else NO_MATCH,
                  f'VCD {num(v0, 2)} → {num(v1, 2)} ×10⁶/mL across the episode'
                  + (f'; pCO₂ {num(min(pco2[start:end + 1]), 1)}–{num(max(pco2[start:end + 1]), 1)} mmHg.' if pco2 else '.'),
                  'Cells starved of oxygen, or hit by a spike, stop growing and change their CO₂ output. They didn\'t.',
                  spark(vcd, nice_domain(vcd))),
            check('fixed', 'Clean since the probe was fixed', 'supporting',
                  MATCH if fixed else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" done at {wtime(fix[0])}. Since then within {num(p["agree_pts"], 0)} points of '
                   f'{pname}.' if fixed else 'No fix recorded yet.' if fix is None else
                   f'Checked at {wtime(fix[0])}, but it still disagrees.'),
                  'If the swings stop when the probe is worked on, and nothing else changed, the fault was in the probe '
                  'or its connection.',
                  spark(do, dd, pdo, pdo, highlight=[ts[fix[1]], ts[min(now, fix[1] + pack.steps(p['recover_min']))]]
                        if fix else None)),
        ]
        main = chart('%', dd, [series('probe', f'{uname} {name}', do, 'primary', 1),
                               series('partner', f'{uname} {pname}', pdo, 'expected', 1)],
                     title='What we see', decimals=0,
                     caption=f'The two DO probes in {uname}. {pname} held about 40 % while {name} swung '
                             f'between {num(lo, 0)} and {num(hi, 0)} %.',
                     markers=[marker(ts[start], 'First jump')] + ([marker(ts[fix[1]], 'Probe checked')] if fix else []))
        grid = minutes_grid(-30, 120, 5)
        r = Rng(2202)
        spike = lambda m: r.gauss(18) if 0 <= m < 65 else 0.0
        tb = [40 + spike(m) + r.gauss(0.3) for m in grid]
        dr = [40 - (0 if m < 0 else min(15, m * 0.12)) + r.gauss(0.3) for m in grid]
        re = [40 - (0 if m < 0 else 12 * (1 - math.exp(-m / 10))) + r.gauss(0.3) for m in grid]
        live = f'{uname} {name}, today'
        lv = aligned(do, start, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('DO (min from the first jump)', '%', [0, 80], grid, 'min', a, lv, live, 0)]
        refs = [
            reference('connector', 'textbook', 'Textbook', 'Loose or wet connector',
                      'Large random swings on one probe, diagnostic down, the other probe and the O₂ flow flat. '
                      'Reseating or drying the connector stops it at once.', 'match', 'Closest match',
                      ['Same size of swings', 'Same stop after the fix'], mk(tb)),
            reference('membrane', 'variant', 'Variant', 'Membrane fouling or ageing',
                      'The same probe reads slowly lower over hours; the swings are small. Caught by comparing with '
                      'the redundant probe and recalibrated at the next turnaround.', 'nomatch', 'Doesn\'t match',
                      ['A drift, not swings', 'Today the probe came straight back after the fix'], mk(dr)),
            reference('real', 'lookalike', 'Look-alike', 'Real oxygen shortfall',
                      'DO falls on both probes together, and the loop opens the O₂ valve hard to catch it: a sparger '
                      'or supply problem. The culture feels it.', 'nomatch', 'Doesn\'t match',
                      [f'{pname} stayed flat here', f'O₂ flow didn\'t move ({num(o_lo, 1)}–{num(o_hi, 1)} slpm)'], mk(re)),
        ]
        ro = [
            ruled_out('A real change in dissolved oxygen', 'ruled out',
                      f'{pname} held {num(min(pdo[start:end + 1]), 1)}–{num(max(pdo[start:end + 1]), 1)} % and the DO loop '
                      f'didn\'t touch the O₂ valve.'),
            ruled_out('Gas supply or sparger fault', 'ruled out',
                      f'O₂ flow followed its slow daily rise ({num(o_lo, 1)}–{num(o_hi, 1)} slpm) with no steps.'),
            ruled_out('Effect on the culture', 'ruled out' if vcd_ok else 'not yet checked',
                      f'VCD kept rising ({num(v0, 2)} → {num(v1, 2)} ×10⁶/mL). {name} is the monitoring probe, so '
                      f'the loop never acted on its readings.'),
            ruled_out('Both probes drifting', 'ruled out',
                      f'Outside the episode the two probes agree within {num(p["agree_pts"], 0)} points.'),
        ]
        return {
            'conclusion': conclusion('Cause' if fixed else 'Most likely cause',
                                     f'Instrument fault on {uname} {name.split(" (")[0]}, most likely its connector or cable; '
                                     f'the culture was not affected',
                                     level, 'Confirmed: clean since the probe was worked on' if fixed else
                                     'Nothing physical agrees with the swings'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     f'{pname}, the O₂ sparge and the culture all stayed steady, the probe\'s own '
                                     f'diagnostic dropped, and the swings stopped when the probe was checked at {wtime(fix[0])}.' if fixed
                                     else f'{pname}, the O₂ sparge and the culture all stayed steady.',
                                     None if fixed else 'The probe hasn\'t been looked at yet.',
                                     None if fixed else 'The swings stop after the connector is reseated or the probe swapped.',
                                     'The swings come back. Then replace the cable and probe before the next SIP.',
                                     'Clean readings after the probe check' if fixed else None),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. SIP cold point from the clean steam supply — archetype 07 (upstream cause)
# ═════════════════════════════════════════════════════════════════════════
class SipColdPoint(Detector):
    id = 'pharma.sip_cold_point_supply'
    name = 'SIP cold point starved by the clean steam supply'
    archetype = '07 Ghost signal'
    applies_to = 'vessel temperature modules'
    summary = ('A sterilize-in-place stalls with the drain cold point short of 121.1 °C. The vessel isn\'t the '
               'problem: the clean steam header feeding it has sagged, so the steam in the vessel is too cool.')
    pipeline = [
        ('SIP running', 'steam on the jacket (jacket inlet ≥ 121 °C) for at least 15 minutes'),
        ('Stalled short', 'vessel no longer heating while the drain is still under 121.1 °C'),
        ('Follow the clean steam layer', 'upstream to the clean steam generator: header pressure, flow, level'),
        ('Physics', 'saturation temperature of the vessel\'s own pressure'),
        ('Conclusion', 'symptom in the vessel, cause at the generator; a passing SIP once the header recovers → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'temperature_control_module'},
        'inputs': {'jacket': 'self.jacket_inlet_temp_c', 'vessel': 'self.culture_temp_c', 'drain': 'self.drain_temp_c',
                   'pressure': 'unit child exhaust_module.vessel_pressure_barg',
                   'header': 'sources[clean_steam] of the unit: cs_header_pressure_barg, cs_flow_kg_h, cs_generator_level_pct'},
        'expected': {'model': 'physics', 'formula': 'saturation temperature of steam at the vessel pressure (Antoine)'},
        'params': {'sip_jacket_c': 121.0, 'heat_min': 15, 'hold_c': 121.1, 'stall_min': 10, 'stall_rise_c': 1.0,
                   'header_low_barg': 2.5, 'header_ok_barg': 2.9, 'flow_drop_frac': 0.2, 'level_hunt_pct': 10.0,
                   'hunt_window_min': 30, 'hold_min': 30},
        'checks': [
            {'id': 'short', 'role': 'required', 'rule': 'SIP on ≥ heat_min, vessel rose < stall_rise_c in stall_min, drain < hold_c'},
            {'id': 'supply', 'role': 'required', 'rule': 'clean steam header < header_low_barg during this SIP'},
            {'id': 'pressure', 'role': 'supporting', 'independent': True, 'rule': 'Tsat(vessel pressure) < hold_c at the stall'},
            {'id': 'flow', 'role': 'supporting', 'independent': True, 'rule': 'clean steam flow < (1 − flow_drop_frac) × flow at SIP start'},
            {'id': 'hunting', 'role': 'supporting', 'rule': 'generator level range > level_hunt_pct in the hunt_window_min before the stall'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'a later SIP holds drain ≥ hold_c for hold_min with header ≥ header_ok_barg'},
        ],
        'confidence': {'medium': 'required + vessel pressure or steam flow agrees', 'high': 'SIP passed once the header recovered'},
    }

    def candidates(self, pack):
        return pack.of_type('temperature_control_module')

    def _ctx(self, pack, aid):
        unit = pack.unit_of(aid)
        srcs = [s for s in pack.sources(unit, 'clean_steam') if pack.has(s, 'cs_header_pressure_barg')]
        exh = pack.child_of_type(unit, 'exhaust_module')
        if not srcs:
            return None
        csg = srcs[0]
        return dict(unit=unit, csg=csg, exh=exh,
                    jacket=pack.series(aid, 'jacket_inlet_temp_c'), vessel=pack.series(aid, 'culture_temp_c'),
                    drain=pack.series(aid, 'drain_temp_c'), header=pack.series(csg, 'cs_header_pressure_barg'),
                    flow=pack.series(csg, 'cs_flow_kg_h'), level=pack.series(csg, 'cs_generator_level_pct'),
                    press=pack.series(exh, 'vessel_pressure_barg') if exh else None)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        sip = [v >= p['sip_jacket_c'] for v in c['jacket']]
        st = pack.steps(p['stall_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(sip, i)
            if s0 is None or pack.minutes_between(s0, i) < p['heat_min'] or i - st < s0:
                continue
            if c['drain'][i] >= p['hold_c'] or c['vessel'][i] - c['vessel'][i - st] >= p['stall_rise_c']:
                continue
            if min(c['header'][s0:i + 1]) >= p['header_low_barg']:
                continue
            c.update(s0=s0, sip=sip)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit, csg, s0 = c['unit'], c['csg'], c['s0']
        uname, cname = pack.name(unit), pack.name(csg)
        jacket, vessel, drain, header, flow, level_s, press = (c['jacket'], c['vessel'], c['drain'], c['header'],
                                                                 c['flow'], c['level'], c['press'])
        e1 = s0
        while e1 + 1 < pack.n and c['sip'][e1 + 1]:
            e1 += 1
        dpk = max(range(s0, e1 + 1), key=lambda k: drain[k])
        vpk = max(range(s0, e1 + 1), key=lambda k: vessel[k])
        hmin_k = min(range(s0, e1 + 1), key=lambda k: header[k])
        sag0 = next(k for k in range(s0, i + 1) if header[k] < p['header_ok_barg'])
        tsat = [tsat_c(v) if v is not None else None for v in press] if press else None
        pr_ok = tsat is not None and tsat[i] < p['hold_c']
        f0k = s0 + 1 if s0 + 1 <= i else s0
        fl_ok = flow[i] < (1 - p['flow_drop_frac']) * flow[f0k]
        hw = pack.steps(p['hunt_window_min'])
        hunt_rng = max(level_s[max(0, i - hw):i + 1]) - min(level_s[max(0, i - hw):i + 1])
        base_rng = max(level_s[:s0]) - min(level_s[:s0]) if s0 > 2 else None
        hunt_ok = hunt_rng > p['level_hunt_pct']
        hunt0 = next((k for k in range(1, i + 1) if abs(level_s[k] - level_s[k - 1]) > p['level_hunt_pct'] / 2), None)
        # a later SIP that passed with the header healthy
        rec, rec_hold = None, None
        k = e1 + 1
        while k < pack.n:
            if c['sip'][k]:
                s1 = k
                while k + 1 < pack.n and c['sip'][k + 1]:
                    k += 1
                okm = [drain[j] >= p['hold_c'] for j in range(s1, k + 1)]
                best = None
                for j in range(s1, k + 1):
                    r0 = B.sustained_since(okm, j - s1)
                    if r0 is not None:
                        run_len = pack.minutes_between(r0, j - s1)
                        if best is None or run_len > best[2]:
                            best = (r0 + s1, j, run_len)
                if best and best[2] >= p['hold_min'] and min(header[s1:k + 1]) >= p['header_ok_barg']:
                    rec, rec_hold = s1, best
                    break
            k += 1
        recovered = rec is not None
        indep = pr_ok or fl_ok
        level = 'high' if recovered else ('medium' if indep else 'low')
        fixes = done_work(pack, [aid, unit, csg])
        fix = fixes[0] if fixes else None
        back = next((k for k in range(hmin_k, pack.n) if header[k] >= p['header_ok_barg']), None)

        def f0(k0, k1):
            return sum(10 ** ((drain[k] - p['hold_c']) / 10) * pack.step_min for k in range(k0, k1 + 1) if drain[k] >= 100)
        f0_1 = f0(s0, e1)
        f0_2 = f0(rec, rec_hold[1]) if recovered else None
        w1 = win(pack, s0, (rec_hold[1] if recovered else e1), 4)
        td = [90, 130]

        checks = [
            check('short', 'Cold point never reached 121.1 °C', 'required', MATCH,
                  f'SIP steam on from {ts[s0]}. By {ts[i]} the vessel had stopped heating at {num(vessel[i])} °C '
                  f'(peak {num(vessel[vpk])} °C at {ts[vpk]}) and the drain peaked at {num(drain[dpk])} °C at {ts[dpk]}.',
                  'The drain is the coldest point of the vessel. Every point has to reach 121.1 °C before the hold '
                  'can start.',
                  spark(drain, td, threshold_value=p['hold_c'], window=w1)),
            check('supply', f'{cname} header pressure sagged', 'required', MATCH,
                  f'Clean steam header {num(header[s0 - 1], 2)} bar(g) before the SIP, below {num(p["header_ok_barg"], 1)} from '
                  f'{ts[sag0]}, lowest {num(header[hmin_k], 2)} bar(g) at {ts[hmin_k]}.',
                  f'{uname} takes its SIP steam from {cname} on the clean-steam layer. Lower header pressure means '
                  f'cooler steam at the vessel.',
                  spark(header, [0, 4], threshold_value=p['header_low_barg'], window=w1)),
            check('pressure', 'Vessel pressure too low for 121 °C', 'supporting', MATCH if pr_ok else NO_MATCH,
                  (f'{num(press[i], 2)} bar(g) at {ts[i]}: saturated steam at that pressure is {num(tsat[i])} °C, under '
                   f'121.1. At {num(press[s0], 2)} bar(g), earlier in the same SIP, it was {num(tsat[s0])} °C.'
                   if press else 'No vessel pressure found.'),
                  'A separate sensor, and plain physics: steam can\'t be hotter than its saturation temperature, so '
                  'no amount of waiting would have got the drain to 121.1 °C.',
                  spark(tsat, td, threshold_value=p['hold_c'], window=w1) if tsat else None),
            check('flow', 'Less steam delivered, not more used', 'supporting', MATCH if fl_ok else NO_MATCH,
                  f'{cname} flow {num(flow[f0k], 0)} kg/h early in the SIP, {num(flow[i], 0)} kg/h at {ts[i]}.',
                  'A separate meter. If another user were stealing steam, header flow would have gone up as the '
                  'pressure fell. It went down: the generator couldn\'t make it.',
                  spark(flow, [0, 1200], window=w1)),
            check('hunting', f'{cname} level hunting', 'supporting', MATCH if hunt_ok else NO_MATCH,
                  f'Generator level swung over {num(hunt_rng, 0)} points in the {dur(p["hunt_window_min"])} before {ts[i]}'
                  + (f', from {ts[hunt0]}' if hunt0 is not None else '')
                  + (f'; within {num(base_rng, 1)} points earlier in the day.' if base_rng is not None else '.'),
                  'A generator whose feed pump is cavitating can\'t hold its level, and a hunting level means '
                  'unsteady boil-off. It is the earliest sign at the generator.',
                  spark(level_s, [0, 100], window=w1)),
            check('recovered', 'Next SIP passed once the header was back', 'supporting',
                  MATCH if recovered else PENDING,
                  (f'Header back above {num(p["header_ok_barg"], 1)} bar(g) at {ts[back]}. SIP from {ts[rec]}: drain '
                   f'≥ 121.1 °C from {ts[rec_hold[0]]} to {ts[rec_hold[1]]} ({dur(rec_hold[2])}), F₀ about '
                   f'{num(f0_2, 0)} min.' if recovered else 'No repeat SIP yet.'),
                  'Same vessel, same traps, same drain. Only the steam supply changed, and the SIP passed.',
                  spark(drain, td, threshold_value=p['hold_c'], highlight=[ts[rec_hold[0]], ts[rec_hold[1]]] if recovered else None)),
        ]
        on = c['sip']            # the saturation curve only means something while steam is on the vessel
        d_show = [v if v >= td[0] else None for v in drain]
        t_show = [t_ if (t_ is not None and on[k]) else None for k, t_ in enumerate(tsat)] if tsat else None
        main = chart('°C', td, [series('drain', f'{uname} drain (cold point)', d_show, 'primary', 1),
                                series('tsat', 'Steam saturation temperature at vessel pressure (steam on)', t_show,
                                       'expected', 1)]
                     if tsat else [series('drain', f'{uname} drain (cold point)', d_show, 'primary', 1)],
                     title='What we see', decimals=0,
                     caption=f'{uname} drain temperature against the hottest the steam in the vessel could be at its '
                             f'measured pressure. In the first SIP the steam itself was too cool; in the repeat it wasn\'t.',
                     thresholds=[threshold(p['hold_c'], '121.1 °C')],
                     markers=[marker(ts[sag0], f'{cname} header sags'), marker(ts[i], 'Flagged')]
                     + ([marker(ts[rec], 'SIP #2')] if recovered else []), window=w1)
        grid = minutes_grid(-10, 70, 5)
        r = Rng(2303)
        heat = lambda m, top, tau: 25 + (top - 25) * (1 - math.exp(-max(0, m) / tau))
        tb = [heat(m, 116, 12) + r.gauss(0.3) for m in grid]
        tr = [(heat(m, 123, 10) if m < 25 else heat(25, 123, 10) - 4 * math.exp(-(m - 25) / 30)) + r.gauss(0.3) for m in grid]
        ok = [heat(m, 123, 10) + r.gauss(0.3) for m in grid]
        live = f'{uname} drain, today'
        lv = aligned(drain, s0, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Drain temperature (min from steam on)', '°C', [20, 130], grid, 'min', a, lv, live, 0,
                                  [threshold(p['hold_c'], '121.1 °C')])]
        refs = [
            reference('supply', 'textbook', 'Textbook', 'Clean steam header sag',
                      'The generator can\'t keep up (feed pump cavitation, a blocked strainer, too many SIPs at once). '
                      'Vessel pressure and drain stall together, a few degrees short.', 'match', 'Closest match',
                      ['Same stall a few degrees short', 'Header pressure down at the same time'], mk(tb)),
            reference('trap', 'lookalike', 'Look-alike', 'Failed drain trap or air pocket',
                      'The vessel reaches full pressure and temperature, but condensate or air backs up in the drain leg, '
                      'so only the drain lags. Header pressure is normal.', 'nomatch', 'Doesn\'t match',
                      [f'Header fell to {num(header[hmin_k], 2)} bar(g) here', 'Here the whole vessel stalled, not only the drain'],
                      mk(tr)),
            reference('pass', 'variant', 'For comparison', 'A normal SIP',
                      'Steam at full header pressure: vessel 123 °C, drain past 121.1 °C within 25–30 minutes, then the '
                      'hold.', 'partial', 'What SIP #2 looked like' if recovered else 'What it should look like',
                      ['Drain crosses 121.1 °C', 'Header steady at 3 bar(g)'], mk(ok)),
        ]
        ro = [
            ruled_out(f'{uname} steam traps or an air pocket in the drain leg', 'ruled out' if recovered else 'unlikely',
                      (f'The whole vessel stalled at {num(vessel[vpk])} °C, not just the drain, and the repeat SIP through '
                       f'the same traps passed once the header was back.' if recovered else
                       f'The whole vessel stalled at {num(vessel[vpk])} °C, not just the drain.')),
            ruled_out('Another SIP competing for steam', 'ruled out',
                      f'{cname}\'s flow fell from {num(flow[f0k], 0)} to {num(flow[i], 0)} kg/h as the pressure dropped. '
                      f'Extra demand would have pushed flow up.'),
            ruled_out('A faulty drain thermocouple', 'ruled out' if pr_ok else 'unlikely',
                      f'The vessel pressure, a separate sensor, says the steam could only reach {num(tsat[i]) if tsat else "—"} °C.'),
            ruled_out(f'Why {cname} sagged', 'not yet checked',
                      'The level hunting fits feed-pump cavitation (a blocked strainer or low feed tank). The data shows the '
                      'effect; the cause is in the field record.'
                      + (f' Work "{fix[0]["text"]}" was done at {wtime(fix[0])}.' if fix else '')),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'Clean steam supply from {cname} too low; {uname} itself was fine', level,
                                     'Confirmed: the repeat SIP passed once the header recovered' if recovered else
                                     'Header sag explains the stall'),
            'rootCauseAssetId': csg,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The header sagged as the vessel stalled, the vessel pressure says the steam was too cool '
                                     'to sterilize, and the next SIP through the same drain passed once the header was back.'
                                     if recovered else 'The header sagged as the vessel stalled, and the vessel pressure agrees.',
                                     None if recovered else 'No repeat SIP yet.',
                                     None if recovered else 'A repeat SIP passes at normal header pressure.',
                                     'A repeat SIP fails at normal header pressure. Then look at the drain trap and the '
                                     'thermocouple map.',
                                     'Passing SIP after the header recovered' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'drain_temp_c', 'formula': 'Tsat(vessel_pressure_barg + 1.013 bar), Antoine equation for water',
                      'fittedOn': 'physics; no fitted coefficients'},
            'impact': (f'First SIP reached F₀ of only {num(f0_1, 1)} min at the drain and was aborted'
                       + (f'; the repeat reached about {num(f0_2, 0)} min. Time lost to the repeat: '
                          f'{dur(pack.minutes_between(s0, rec))} from the first steam-on to the second.' if recovered else '.')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Skid stopped by a plugging filter — archetype 11 (hard block)
# ═════════════════════════════════════════════════════════════════════════
class SkidFilterStop(Detector):
    id = 'pharma.skid_filter_stop'
    name = 'Chromatography skid stopped by a plugging filter'
    archetype = '11 Hard block'
    applies_to = 'chromatography skids'
    summary = ('A purification skid\'s flow drops to zero in the middle of a load, right after the differential '
               'pressure across one of its filters climbs fast toward the high-high interlock.')
    pipeline = [
        ('Stopped', 'skid flow under 1 L/min for 15 minutes, while load volume was still being added'),
        ('Which part', 'each filter on the skid: DP in the 30 minutes before the stop'),
        ('Column', 'column pressure drop per unit flow, against the first load of the day'),
        ('Consequence', 'the eluate pool downstream, and the load-hold clock'),
        ('Conclusion', 'filter DP to the interlock → filter plugging; normal DP after a filter change → high'),
    ]
    definition = {
        'appliesTo': {'assetType': ['capture_skid', 'polish_skid']},
        'inputs': {'flow': 'self.skid_flow_l_min', 'load': 'self.load_processed_l',
                   'filters': 'children with filter_dp_bar', 'column': 'child chrom_column.column_dp_bar',
                   'pool': 'targets[process_flow] with vi_pool_volume_l', 'fix': 'done work items on this skid'},
        'params': {'stop_lpm': 1.0, 'stop_min': 15, 'load_lookback_min': 15, 'rise_window_min': 30,
                   'filter_rise_bar': 1.0, 'filter_hh_bar': 2.5, 'hh_frac': 0.8, 'column_band_pct': 8.0,
                   'full_flow_frac': 0.9, 'filter_clean_bar': 0.5, 'hold_limit_min': 240, 'pool_step_l': 100},
        'checks': [
            {'id': 'stopped', 'role': 'required', 'rule': 'flow < stop_lpm for stop_min, load_processed rising in the load_lookback_min before'},
            {'id': 'filter', 'role': 'required', 'rule': 'a filter DP rose > filter_rise_bar in rise_window_min and read > hh_frac × filter_hh_bar before the stop'},
            {'id': 'interlock', 'role': 'supporting', 'rule': 'last DP + last 5-min rise ≥ filter_hh_bar'},
            {'id': 'column', 'role': 'supporting', 'independent': True, 'rule': 'column DP per L/min within ±column_band_pct of the first full-flow load'},
            {'id': 'pool', 'role': 'supporting', 'rule': 'eluate reached the pool later than the usual cycle spacing'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'after a done work item, flow ≥ full_flow_frac × normal and filter DP < filter_clean_bar, within hold_limit_min'},
        ],
        'confidence': {'medium': 'required + column normal', 'high': 'normal flow and filter DP after the filter change'},
    }

    def candidates(self, pack):
        return pack.of_type('capture_skid', 'polish_skid')

    def evaluate(self, pack, aid):
        p = self.p
        flow, load = pack.series(aid, 'skid_flow_l_min'), pack.series(aid, 'load_processed_l')
        filters = [x for x in pack.children.get(aid, []) if pack.has(x, 'filter_dp_bar')]
        stopped = B.lt(flow, p['stop_lpm'])
        lb, rw = pack.steps(p['load_lookback_min']), pack.steps(p['rise_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(stopped, i)
            if s0 is None or s0 < 1 or pack.minutes_between(s0, i) < p['stop_min']:
                continue
            if load[s0 - 1] - load[max(0, s0 - 1 - lb)] <= 0:
                continue
            for fl in filters:
                dp = pack.series(fl, 'filter_dp_bar')
                pre = dp[s0 - 1]
                rise = pre - min(dp[max(0, s0 - 1 - rw):s0])
                if rise > p['filter_rise_bar'] and pre > p['hh_frac'] * p['filter_hh_bar']:
                    return Finding(aid, True, i, flow=flow, load=load, filt=fl, dp=dp, s0=s0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        name = pack.name(aid)
        flow, load, fl, dp, s0 = c['flow'], c['load'], c['filt'], c['dp'], c['s0']
        fname = pack.name(fl)
        normal = median([v for v in flow if v > p['stop_lpm']] or [0])
        full = [v >= p['full_flow_frac'] * max(flow) for v in flow]
        restart = next((k for k in range(s0, pack.n) if flow[k] >= p['stop_lpm']), None)
        rw = pack.steps(p['rise_window_min'])
        k_lo = min(range(max(0, s0 - 1 - rw), s0), key=lambda k: dp[k])
        pre = dp[s0 - 1]
        last_rise = dp[s0 - 1] - dp[s0 - 2]
        proj = pre + last_rise
        il_ok = proj >= p['filter_hh_bar']
        col = pack.child_of_type(aid, 'chrom_column')
        cdp = pack.series(col, 'column_dp_bar') if col else None
        perm = [cd / fv if fv > p['stop_lpm'] and ok else None for cd, fv, ok in zip(cdp, flow, full)] if cdp else None
        first_full = next((k for k in range(pack.n) if perm and perm[k] is not None), None)
        p_base = median(perm[first_full:first_full + 4]) if first_full is not None else None
        p_pre = median([perm[k] for k in range(max(0, s0 - rw), s0) if perm[k] is not None]) if perm else None
        col_ok = p_base is not None and p_pre is not None and abs(p_pre / p_base - 1) * 100 < p['column_band_pct']
        tgt = next((t for t in pack.targets(aid, 'process_flow') if pack.has(t, 'vi_pool_volume_l')), None)
        pool_ok, late_txt, late_min = False, 'No eluate pool found downstream.', None
        if tgt:
            pool = pack.series(tgt, 'vi_pool_volume_l')
            steps_k = [k for k in range(1, pack.n) if pool[k] - pool[k - 1] > p['pool_step_l']]
            gaps = [pack.minutes_between(a, b) for a, b in zip(steps_k, steps_k[1:])]
            if gaps:
                usual = median(gaps)
                late = next(((a, b) for a, b in zip(steps_k, steps_k[1:]) if a < s0 < b), None)
                if late:
                    extra = pack.minutes_between(*late) - usual
                    pool_ok = extra > pack.step_min
                    late_min = extra
                    late_txt = (f'{pack.name(tgt)} received eluates at {join_names([ts[k] for k in steps_k])}. The one '
                                f'after the stop took {dur(pack.minutes_between(*late))}, against the usual '
                                f'{dur(usual)}: {dur(extra)} late.')
        fixes = [(w, k) for w, k in done_work(pack, [aid, fl, col]) if k >= s0]
        fix = fixes[0] if fixes else None
        fixed, k_ok = False, None
        if fix and restart is not None:
            k_ok = next((k for k in range(restart, pack.n) if flow[k] >= p['full_flow_frac'] * normal), None)
            fixed = (k_ok is not None and dp[k_ok] < p['filter_clean_bar']
                     and pack.minutes_between(s0, restart) <= p['hold_limit_min'])
        level = 'high' if fixed else ('medium' if col_ok else 'low')
        stop_min = pack.minutes_between(s0, restart) if restart is not None else pack.minutes_between(s0, now)
        w1 = win(pack, k_lo, (k_ok or restart or now), 6)
        cycle = pack.series(aid, 'cycle_number')[s0] if pack.has(aid, 'cycle_number') else None

        checks = [
            check('stopped', f'{name} stopped mid-load', 'required', MATCH,
                  f'Flow {num(flow[s0 - 1], 1)} L/min at {ts[s0 - 1]}, 0 from {ts[s0]}'
                  + (f' to {ts[restart - 1]} ({dur(stop_min)}).' if restart else f' ({dur(stop_min)} so far).')
                  + (f' Cycle {num(cycle, 0)} had {num(load[s0 - 1] - load[max(0, s0 - 1 - pack.steps(p["load_lookback_min"]))], 0)} L '
                     f'loaded in the 15 minutes before.' if cycle else ''),
                  'A skid doesn\'t pause a load on purpose: product sitting on a partly loaded column starts the '
                  'validated hold clock.',
                  spark(flow, [0, 50], window=w1)),
            check('filter', f'{fname} DP climbing fast', 'required', MATCH,
                  f'{num(dp[k_lo], 2)} bar at {ts[k_lo]} → {num(pre, 2)} bar at {ts[s0 - 1]}. High-high interlock '
                  f'{num(p["filter_hh_bar"], 1)} bar.',
                  'A filter collecting solids gets harder to push through by the minute. Here the rise speeds up with '
                  'every reading: a cake is building.',
                  spark(dp, [0, 3], threshold_value=p['filter_hh_bar'], window=w1)),
            check('interlock', 'Past the interlock before the next reading', 'supporting', MATCH if il_ok else NO_MATCH,
                  f'The last 5 minutes added {num(last_rise, 2)} bar; at that rate DP was about {num(proj, 2)} bar by '
                  f'{ts[s0]}, over the {num(p["filter_hh_bar"], 1)} bar trip.',
                  'The interlock acts on the live pressure, not the 5-minute record, so the trip falls between '
                  'two stored readings.', None),
            check('column', 'Column itself normal', 'supporting', MATCH if col_ok else NO_MATCH,
                  (f'Column DP per L/min {num(p_pre, 4)} bar in the half hour before the stop, against {num(p_base, 4)} '
                   f'in the first load of the day ({signed((p_pre / p_base - 1) * 100, 1)} %).' if col_ok or p_pre else
                   'No column pressure found.'),
                  'A separate sensor downstream of the filter. A fouled or compressed bed would push its DP up; it '
                  'didn\'t move.',
                  spark(cdp, [0, 2], window=w1) if cdp else None),
            check('pool', 'Eluate arrived late downstream', 'supporting', MATCH if pool_ok else NO_MATCH, late_txt,
                  'The stop spreads down the line: every minute stopped is a minute later for the next unit.',
                  spark(pack.series(tgt, 'vi_pool_volume_l'), nice_domain(pack.series(tgt, 'vi_pool_volume_l'))) if tgt else None),
            check('fixed', 'Normal after the filter change', 'supporting',
                  MATCH if fixed else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" done {wtime(fix[0])}. Flow back at {ts[restart]}, {num(flow[k_ok], 1)} L/min by '
                   f'{ts[k_ok]} with {fname} DP {num(dp[k_ok], 2)} bar. Stopped {dur(stop_min)}, inside the '
                   f'{dur(p["hold_limit_min"])} validated load hold.' if fixed else
                   'No filter change recorded yet.' if fix is None else 'Restarted, but DP or flow not back to normal.'),
                  'A new filter at normal DP, on the same feed, shows the old one was the restriction.',
                  spark(dp, [0, 3], highlight=[ts[restart], ts[k_ok]] if fixed else None, window=w1)),
        ]
        main = chart('L/min', [0, 50], [series('flow', f'{name} flow', flow, 'primary', 1)],
                     title='What we see', decimals=0,
                     caption=f'{name} skid flow. The load stopped at {ts[s0]}, right after {fname} DP climbed to '
                             f'{num(pre, 2)} bar.',
                     markers=[marker(ts[k_lo], 'Filter DP starts climbing'), marker(ts[s0], 'Stopped')]
                     + ([marker(ts[restart], 'Restarted')] if restart else []))
        grid = minutes_grid(-30, 60, 5)
        r = Rng(2404)
        tb = [(0.3 + 0.02 * max(0, m + 30) + 0.0009 * max(0, m + 30) ** 2 if m < 0 else 0.0) + r.gauss(0.01) for m in grid]
        ea = [(0.3 + 0.012 * (m + 30)) + r.gauss(0.01) for m in grid]
        la = [0.3 + r.gauss(0.01) if m < 0 else 0.0 for m in grid]
        live = f'{fname}, today'
        lv = aligned(dp, s0, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Filter DP (min from the stop)', 'bar', [0, 3], grid, 'min', a, lv, live, 2,
                                  [threshold(p['filter_hh_bar'], 'High-high')])]
        refs = [
            reference('plug', 'textbook', 'Textbook', 'Guard filter plugging on a high-solids load',
                      'DP doubles every few minutes as a cake forms, the interlock trips the feed pump, and a new '
                      'filter on the same load runs normally.', 'match', 'Closest match',
                      ['Same accelerating climb', 'Same trip between readings'], mk(tb)),
            reference('slow', 'early', 'Early warning', 'Steady filter loading',
                      'DP climbs in a straight line through the load. There is time to swap the filter at the end of '
                      'the cycle instead of mid-load.', 'partial', 'Where a trend alarm helps',
                      ['Linear, not accelerating', 'Swap planned, no hold'], mk(ea)),
            reference('pump', 'lookalike', 'Look-alike', 'Pump or valve fault',
                      'Flow stops with filter DP normal right up to the stop. The fault is in the drive or a valve, '
                      'not the filter.', 'nomatch', 'Doesn\'t match',
                      [f'{fname} DP reached {num(pre, 2)} bar here', 'Here the filter change fixed it'], mk(la)),
        ]
        ro = [
            ruled_out('Column blocked or compressed', 'ruled out' if col_ok else 'not yet checked',
                      f'Column DP per L/min stayed within {num(abs(p_pre / p_base - 1) * 100, 1)} % of the first load.'
                      if p_pre and p_base else 'No column pressure found.'),
            ruled_out('Feed pump or valve fault', 'ruled out',
                      f'{fname} DP was the only thing moving before the stop, and the skid ran normally on a new filter.'),
            ruled_out('A planned pause', 'ruled out',
                      'The stop came in the middle of a load, which a recipe never does.'),
            ruled_out('Why the filter plugged', 'not yet checked',
                      'Fines or debris in the clarified harvest are the usual cause. The load pool\'s turbidity is not in '
                      'the data; the used filter and a harvest sample go to QC.'),
        ]
        return {
            'conclusion': conclusion('Cause' if fixed else 'Most likely cause',
                                     f'{fname} plugged and tripped {name} on DP high-high; the column was fine', level,
                                     'Confirmed: normal flow and DP on a new filter' if fixed else 'Filter DP rose to the trip'),
            'rootCauseAssetId': fl,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     f'{fname} DP climbed to the interlock, the column stayed normal, and the skid ran '
                                     f'normally on a new filter.' if fixed else
                                     f'{fname} DP climbed to the interlock and the column stayed normal.',
                                     None if fixed else 'The filter hasn\'t been changed yet.',
                                     None if fixed else 'Flow and DP are normal on a new filter.',
                                     'DP climbs again on the new filter. Then the load itself is the problem.',
                                     'Normal running on a new filter' if fixed else None),
            'action': action(item, pack),
            'impact': (f'{dur(stop_min)} of load hold used, of {dur(p["hold_limit_min"])} allowed.'
                       + (f' The next eluate reached {pack.name(tgt)} {dur(late_min)} late.' if pool_ok else '')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Protein A capacity loss — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class ProteinACapacityLoss(Detector):
    id = 'pharma.protein_a_capacity_loss'
    name = 'Protein A capacity falling cycle over cycle'
    archetype = '08 Throughput illusion'
    applies_to = 'chromatography columns'
    summary = ('Every cycle loads the same volume on time, so the schedule looks fine, but more antibody leaves '
               'with the flow-through at the end of each load: the resin is binding less.')
    pipeline = [
        ('Cycles', 'split the day into load cycles from the skid\'s cycle counter and load volume'),
        ('End of load', 'flow-through breakthrough at the last load reading of each finished cycle'),
        ('Same challenge', 'load volume and flow per cycle'),
        ('Independent', 'step yield per cycle; column DP; the cycle in progress against the last one'),
        ('Conclusion', 'more breakthrough at the same load → dynamic binding capacity falling'),
    ]
    definition = {
        'appliesTo': {'assetType': 'chrom_column', 'needs': 'parent skid with cycle_number and load_processed_l'},
        'inputs': {'bt': 'self.breakthrough_pct', 'dp': 'self.column_dp_bar', 'resin': 'self.resin_cycles',
                   'cycle': 'parent.cycle_number', 'load': 'parent.load_processed_l', 'flow': 'parent.skid_flow_l_min',
                   'yield': 'parent.step_yield_pct'},
        'params': {'min_cycles': 3, 'rise_step_pts': 0.3, 'total_rise_pts': 1.5, 'normal_max_pct': 1.5,
                   'load_band_pct': 5.0, 'yield_drop_pts': 1.0, 'dp_band_bar': 0.05, 'resin_life_min': 100,
                   'resin_life_max': 300},
        'checks': [
            {'id': 'rising', 'role': 'required', 'rule': 'end-of-load breakthrough up ≥ rise_step_pts every cycle for the last min_cycles finished cycles, total ≥ total_rise_pts'},
            {'id': 'above', 'role': 'required', 'rule': 'latest end-of-load breakthrough > normal_max_pct'},
            {'id': 'same', 'role': 'required', 'rule': 'load volume per cycle within ±load_band_pct of the first'},
            {'id': 'yield', 'role': 'supporting', 'independent': True, 'rule': 'step yield falls every cycle, total > yield_drop_pts'},
            {'id': 'dp', 'role': 'supporting', 'rule': 'column DP at full load flow within ±dp_band_bar across cycles'},
            {'id': 'current', 'role': 'supporting', 'rule': 'the cycle in progress is above the last one at the same load volume'},
            {'id': 'resin', 'role': 'supporting', 'rule': 'resin cycles inside the typical resin_life_min–resin_life_max lifetime range'},
        ],
        'confidence': {'medium': 'required + step yield agrees', 'high': 'a DBC test or flow-through titer confirms it'},
    }

    def candidates(self, pack):
        return pack.of_type('chrom_column')

    def _cycles(self, pack, aid):
        skid = pack.parent(aid)
        if not (pack.has(skid, 'cycle_number') and pack.has(skid, 'load_processed_l')):
            return None
        cyc, load = pack.series(skid, 'cycle_number'), pack.series(skid, 'load_processed_l')
        bt = pack.series(aid, 'breakthrough_pct')
        out = []
        for cn in sorted(set(cyc)):
            ks = [k for k in range(pack.n) if cyc[k] == cn]
            lp = [k for k in ks if k > 0 and load[k] > load[k - 1]]
            if not lp:
                continue
            end = lp[-1]
            done = end + 1 if end + 1 < pack.n and not (load[end + 1] > load[end]) else None
            vol = load[end] - load[lp[0] - 1]
            out.append(dict(n=int(cn), start=lp[0], end=end, done=done, bt=bt[end], vol=vol, loads=lp))
        return dict(skid=skid, cyc=cyc, load=load, bt=bt, cycles=out)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._cycles(pack, aid)
        if c is None:
            return Finding(aid, False)
        for i in range(pack.n):
            fin = [x for x in c['cycles'] if x['done'] is not None and x['done'] <= i]
            if len(fin) < p['min_cycles']:
                continue
            last = fin[-p['min_cycles']:]
            if not all(b['bt'] - a['bt'] >= p['rise_step_pts'] for a, b in zip(last, last[1:])):
                continue
            if last[-1]['bt'] - last[0]['bt'] < p['total_rise_pts'] or last[-1]['bt'] <= p['normal_max_pct']:
                continue
            if any(abs(x['vol'] / fin[0]['vol'] - 1) * 100 > p['load_band_pct'] for x in fin):
                continue
            c.update(fin_at=len(fin))
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        skid = c['skid']
        sname, cname = pack.name(skid), pack.name(aid)
        bt, load, cycles = c['bt'], c['load'], c['cycles']
        fin = [x for x in cycles if x['done'] is not None and x['done'] <= now]
        cur = next((x for x in cycles if x['done'] is None), None)
        ys = pack.series(skid, 'step_yield_pct')
        yields = []
        for k, v in stepped(ys, 1, now):
            owner = [x for x in fin if x['end'] < k]
            if owner:
                yields.append((owner[-1]['n'], k, v))
        y_ok = (len(yields) >= 2 and all(b[2] < a[2] for a, b in zip(yields, yields[1:]))
                and yields[0][2] - yields[-1][2] > p['yield_drop_pts'])
        flow = pack.series(skid, 'skid_flow_l_min')
        dp = pack.series(aid, 'column_dp_bar')
        fmax = max(flow)
        dps = [median([dp[k] for k in x['loads'] if flow[k] >= 0.9 * fmax]) for x in fin]
        dps = [d for d in dps if d is not None]
        dp_ok = bool(dps) and max(dps) - min(dps) <= 2 * p['dp_band_bar']
        flows = [median([flow[k] for k in x['loads']]) for x in fin]
        resin = pack.series(aid, 'resin_cycles')
        resin_ok = p['resin_life_min'] <= resin[now] <= p['resin_life_max']
        cur_ok, cur_txt = False, 'No cycle in progress.'
        if cur and fin:
            v_now = load[now] - load[cur['start'] - 1]
            prev = fin[-1]
            k_prev = next((k for k in prev['loads'] if load[k] - load[prev['start'] - 1] >= v_now - 1), prev['end'])
            cur_ok = bt[now] > bt[k_prev]
            cur_txt = (f'Cycle {cur["n"]} is at {num(bt[now], 2)} % after {num(v_now, 0)} L; cycle {prev["n"]} was at '
                       f'{num(bt[k_prev], 2)} % at the same point.')
        ns = [x['n'] for x in fin]
        b, a0, _ = linfit(ns, [x['bt'] for x in fin])
        last_n = max(cyc['n'] for cyc in cycles)
        total_cycles = int(max(c['cyc']))
        proj = {n: a0 + b * n for n in range(last_n + 1, last_n + 4)}
        level = 'medium' if y_ok else 'low'
        flagged = fin[:c['fin_at']]
        bts = [x['bt'] for x in fin]
        per = [None] * pack.n
        for n, x in enumerate(fin):          # each end-of-load value held until the next load ends
            k1 = fin[n + 1]['end'] - 1 if n + 1 < len(fin) else now
            for k in range(x['end'], k1 + 1):
                per[k] = x['bt']
        yd = nice_domain([v for _, _, v in yields] or [90, 96], pad=0.2)

        checks = [
            check('rising', 'More breakthrough every cycle', 'required', MATCH,
                  f'End-of-load breakthrough, cycles {ns[0]}–{ns[-1]}: {join_names([num(v, 1) + " %" for v in bts])}. '
                  f'Flagged at {ts[i]}, when cycle {flagged[-1]["n"]} finished loading.',
                  'Breakthrough at the end of the load is the antibody the resin couldn\'t hold. It should be about the '
                  'same every cycle.',
                  spark(bt, [0, 8], threshold_value=p['normal_max_pct'])),
            check('above', 'Above the normal level', 'required', MATCH,
                  f'Cycle {fin[-1]["n"]} ended at {num(fin[-1]["bt"], 2)} %, against the usual under '
                  f'{num(p["normal_max_pct"], 1)} %.',
                  'The load challenge is set so that little product breaks through. Several percent means product lost '
                  'in the flow-through.',
                  spark(per, [0, 8], threshold_value=p['normal_max_pct'])),
            check('same', 'Same load every cycle', 'required', MATCH,
                  f'Load per cycle {num(min(x["vol"] for x in fin), 0)}–{num(max(x["vol"] for x in fin), 0)} L at '
                  f'{num(min(flows), 1)}–{num(max(flows), 1)} L/min.',
                  'Same volume, same flow, same harvest pool: the only thing left that can change is how much the '
                  'resin can bind.',
                  spark(load, nice_domain(load))),
            check('yield', 'Step yield falling with it', 'supporting', MATCH if y_ok else NO_MATCH,
                  f'Step yield after cycles {join_names([str(n) for n, _, _ in yields])}: '
                  f'{join_names([num(v, 1) + " %" for _, _, v in yields])}.',
                  'Measured from the eluate, not the flow-through, so it is a second, separate view of the same loss.',
                  spark(ys, yd)),
            check('dp', 'Column pressure unchanged', 'supporting', MATCH if dp_ok else NO_MATCH,
                  f'{num(min(dps), 2)}–{num(max(dps), 2)} bar at full load flow, every cycle.' if dps else 'No column DP.',
                  'Fouling that blocks the bed, or a compressed bed that channels, would show in the pressure drop. '
                  'Capacity loss from ligand wear doesn\'t.',
                  spark(dp, [0, 2])),
            check('current', 'The cycle in progress is worse again', 'supporting', MATCH if cur_ok else NO_MATCH, cur_txt,
                  'The trend is still going: nothing has reset it.', spark(bt, [0, 8], window=[ts[max(0, (cur or fin[-1])['start'] - 12)], ts[now]]) if cur else None),
            check('resin', 'Resin late in its life', 'supporting', MATCH if resin_ok else NO_MATCH,
                  f'{num(resin[now], 0)} cycles on this resin. Protein A resins typically last {p["resin_life_min"]}–'
                  f'{p["resin_life_max"]} cycles, losing 10–25 % of binding capacity on the way.',
                  'Each cycle\'s cleaning in sodium hydroxide wears the ligand a little. Late in life, capacity falls '
                  'faster.', None),
        ]
        main = chart('%', [0, 8], [series('bt', f'{cname} breakthrough', bt, 'primary', 2),
                                   series('end', 'End of each load', per, 'expected', 2)],
                     title='What we see', decimals=1,
                     caption=f'Flow-through breakthrough on {sname}, reset at every load. Each cycle loads the same '
                             f'volume, and each one ends higher than the last.',
                     thresholds=[threshold(p['normal_max_pct'], 'Usual maximum')],
                     markers=[marker(ts[x['end']], f'Cycle {x["n"]}') for x in fin])
        # Reference curves: end-of-load breakthrough held from each load's end, on hours from the first load,
        # with cycles every ~70 min as on this skid.
        k0 = cycles[0]['start']
        period_h = median([pack.minutes_between(a['end'], b['end']) for a, b in zip(fin, fin[1:])] or [70]) / 60
        first_end_h = pack.minutes_between(k0, cycles[0]['end']) / 60
        grid = hours_grid(6.5, 0.25)
        r = Rng(2505)

        def held(fn):
            out = []
            for hh in grid:
                n = int((hh - first_end_h) // period_h) + 1 if hh >= first_end_h else 0
                out.append(fn(n) + r.gauss(0.06) if n >= 1 else None)
            return out
        tb = held(lambda n: 0.9 + 0.95 * (n - 1) + 0.12 * (n - 1) ** 2)
        ea = held(lambda n: 0.9 + 0.25 * (n - 1))
        la = held(lambda n: 2.2 if n == 2 else 0.9)
        live = f'{sname}, today'
        lv = aligned(per, k0, pack.step_min, grid)
        mk = lambda a: [ref_chart('End-of-load breakthrough (h from the first load)', '%', [0, 12], grid, 'h', a, lv,
                                  live, 1, [threshold(p['normal_max_pct'], 'Usual maximum')])]
        refs = [
            reference('eol', 'textbook', 'Textbook', 'Resin at the end of its life',
                      'Breakthrough climbs a point or more per cycle at a fixed load, step yield falls with it, pressure '
                      'stays normal. A DBC test finds capacity under the action limit and the column is repacked.',
                      'match', 'Closest match', ['Same climb at the same load', 'Same falling yield, normal DP'], mk(tb)),
            reference('slow', 'early', 'Early stage', 'Normal ageing',
                      'Capacity falls slowly over hundreds of cycles. Breakthrough creeps up a little from batch to '
                      'batch, which a periodic DBC test tracks.', 'partial', 'Same cause, far slower',
                      [f'Today: {signed(b, 1)} points per cycle', 'Normal ageing is a small fraction of that'], mk(ea)),
            reference('event', 'lookalike', 'Look-alike', 'One bad cycle',
                      'A single high breakthrough from a flow upset or a hold on a partly loaded column. The next cycle '
                      'is back to normal.', 'nomatch', 'Doesn\'t match',
                      ['Here every cycle is higher than the one before',
                       'Cycles after the cycle-2 interruption kept climbing'], mk(la)),
        ]
        gf = pack.child_of_type(skid, 'guard_filter')
        gdp = pack.series(gf, 'filter_dp_bar') if gf else None
        later = [x for x in fin if x['n'] >= 3]
        gmax = max(max(gdp[k] for k in x['loads']) for x in later) if gdp and later else None
        det = pack.child_of_type(skid, 'detector_block')
        uv = pack.series(det, 'uv280_au') if det else None
        uv_base = [median([uv[k] for k in range(x['start'] - 3, x['start'])]) for x in fin] if uv else []
        ro = [
            ruled_out('Overloading the column', 'ruled out',
                      f'Every cycle loaded {num(min(x["vol"] for x in fin), 0)}–{num(max(x["vol"] for x in fin), 0)} L at '
                      f'the same flow.'),
            ruled_out('Higher titer in the load', 'unlikely',
                      'All cycles load from the same clarified harvest pool, so the antibody concentration is the same for '
                      'each. A rush titer on the flow-through and the pool would settle it.'),
            ruled_out('The guard-filter stop in cycle 2', 'ruled out' if gmax is not None else 'unlikely',
                      (f'That affected cycle 2 only; cycles 3 onward kept climbing with guard filter DP at most '
                       f'{num(gmax, 2)} bar.' if gmax is not None else 'That affected cycle 2 only.')),
            ruled_out('UV detector drift', 'ruled out' if uv_base else 'not yet checked',
                      (f'The UV baseline before each load stayed at {num(min(uv_base), 3)}–{num(max(uv_base), 3)} AU.'
                       if max(uv_base) - min(uv_base) >= 0.0005 else f'The UV baseline before every load read {num(uv_base[0], 3)} AU.')
                      if uv_base else 'No detector data.'),
            ruled_out('Fouled or compressed bed', 'ruled out' if dp_ok else 'not yet checked',
                      f'Column DP at full flow {num(min(dps), 2)}–{num(max(dps), 2)} bar every cycle.' if dps else ''),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'{cname} losing dynamic binding capacity (resin near end of life)',
                                     level, 'Breakthrough and step yield agree' if y_ok else 'Breakthrough only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Breakthrough rose every cycle at the same load, and step yield, measured from the eluate, '
                                     'fell with it.' if y_ok else 'Breakthrough rose every cycle at the same load.',
                                     'Nobody has measured the binding capacity or the flow-through titer yet.',
                                     'A DBC test shows capacity well below its starting value, or the flow-through titer '
                                     'accounts for the lost yield.',
                                     'DBC is normal. Then look at the load pool\'s titer and the UV calibration.'),
            'action': action(item, pack),
            'impact': (f'Step yield {num(yields[0][2], 1)} → {num(yields[-1][2], 1)} % over cycles '
                       f'{yields[0][0]}–{yields[-1][0]}. ' if yields else '')
            + (f'If the trend continues ({signed(b, 2)} points per cycle), cycles '
               f'{min(proj)}–{max(proj)} would end at about {num(proj[min(proj)], 1)}–{num(proj[max(proj)], 1)} % '
               f'breakthrough.' if proj and max(proj) <= total_cycles + 3 else ''),
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. AHU fan trip → room pressure cascade — archetype 09 (cascade failure)
# ═════════════════════════════════════════════════════════════════════════
class AhuFanTripCascade(Detector):
    id = 'pharma.ahu_fan_trip_cascade'
    name = 'AHU fan trip and cleanroom pressure cascade loss'
    archetype = '09 Cascade failure'
    applies_to = 'air handling units'
    summary = ('An air handling unit loses most of its supply air in one interval as its duty fan stops; the rooms '
               'it serves lose their pressure cascade and open processing in them stops.')
    pipeline = [
        ('Trip', 'supply airflow down by more than half in one interval, and a running fan stopped at the same point'),
        ('Rooms', 'room differential pressures under the 5 Pa minimum, airlock reversal'),
        ('Follow the HVAC layer', 'HEPA bank DP, room temperature, and each process unit the AHU serves'),
        ('Recovery', 'standby fan started, airflow and room pressures back'),
        ('Conclusion', 'upstream fan trip → room excursion → process hold; recovery with the standby fan → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'air_handling_unit'},
        'inputs': {'airflow': 'self.supply_airflow_m3_h', 'fans': 'children ahu_fan: fan_speed_pct, fan_motor_current_a',
                   'hepa': 'child hepa_bank.hepa_dp_pa', 'rooms': 'room_dp_sensor descendants: room_dp_pa; room_monitoring.room_temp_c',
                   'served': 'targets[hvac]: skid_flow_l_min | vf_flux_lmh | permeate_flux_lmh'},
        'params': {'trip_drop_frac': 0.5, 'fan_run_pct': 30, 'fan_stop_pct': 5, 'room_min_pa': 5.0, 'room_within_min': 10,
                   'hepa_drop_frac': 0.5, 'room_temp_rise_c': 0.5, 'stop_within_min': 10, 'recover_frac': 0.9,
                   'recover_within_min': 30},
        'checks': [
            {'id': 'trip', 'role': 'required', 'rule': 'airflow < (1 − trip_drop_frac) × previous, and a fan > fan_run_pct → < fan_stop_pct in the same interval'},
            {'id': 'rooms', 'role': 'required', 'rule': 'a room DP < room_min_pa within room_within_min of the trip'},
            {'id': 'hepa', 'role': 'supporting', 'independent': True, 'rule': 'HEPA DP < (1 − hepa_drop_frac) × before'},
            {'id': 'temp', 'role': 'supporting', 'independent': True, 'rule': 'room temperature up > room_temp_rise_c'},
            {'id': 'process', 'role': 'supporting', 'rule': 'a served unit that was running stopped within stop_within_min'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'another fan running, airflow ≥ recover_frac × before and every room DP ≥ room_min_pa within recover_within_min'},
        ],
        'confidence': {'medium': 'required + HEPA or room temperature agrees', 'high': 'recovered when the standby fan started'},
    }

    def candidates(self, pack):
        return pack.of_type('air_handling_unit')

    def _ctx(self, pack, aid):
        fans = [x for x in pack.children.get(aid, []) if pack.has(x, 'fan_speed_pct')]
        hepa = pack.child_of_type(aid, 'hepa_bank')
        rooms_m = pack.child_of_type(aid, 'room_monitoring')
        sensors = [x for x in pack.descendants(aid) if pack.has(x, 'room_dp_pa')]
        return dict(air=pack.series(aid, 'supply_airflow_m3_h'), fans=fans,
                    speeds={x: pack.series(x, 'fan_speed_pct') for x in fans}, hepa=hepa, rooms_m=rooms_m,
                    sensors=sensors, dps={x: pack.series(x, 'room_dp_pa') for x in sensors})

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if not c['fans'] or not c['sensors']:
            return Finding(aid, False)
        air = c['air']
        rw = pack.steps(p['room_within_min'])
        for i in range(1, pack.n):
            for t in range(max(1, i - rw), i + 1):
                if air[t] >= (1 - p['trip_drop_frac']) * air[t - 1]:
                    continue
                fan = next((x for x in c['fans'] if c['speeds'][x][t - 1] > p['fan_run_pct']
                            and c['speeds'][x][t] < p['fan_stop_pct']), None)
                if fan is None:
                    continue
                if min(c['dps'][s][k] for s in c['sensors'] for k in range(t, i + 1)) < p['room_min_pa']:
                    c.update(trip=t, fan=fan)
                    return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i, t, fan = f.aid, f.at, c['trip'], c['fan']
        name, fname = pack.name(aid), pack.name(fan)
        air, speeds, dps, sensors = c['air'], c['speeds'], c['dps'], c['sensors']
        before = median(air[max(0, t - 6):t])
        standby = [x for x in c['fans'] if x != fan]
        sb = next(((x, k) for x in standby for k in range(t, pack.n) if speeds[x][k] > p['fan_run_pct']), None)
        k_air = next((k for k in range(t, pack.n) if air[k] >= p['recover_frac'] * before), None)
        k_rooms = next((k for k in range(t, pack.n) if all(dps[s][k] >= p['room_min_pa'] for s in sensors)), None)
        k_rec = max(k_air, k_rooms) if k_air is not None and k_rooms is not None else None
        recovered = sb is not None and k_rec is not None and pack.minutes_between(t, k_rec) <= p['recover_within_min']
        hdp = pack.series(c['hepa'], 'hepa_dp_pa') if c['hepa'] else None
        h_ok = hdp is not None and hdp[t] < (1 - p['hepa_drop_frac']) * median(hdp[max(0, t - 6):t])
        rt = pack.series(c['rooms_m'], 'room_temp_c') if c['rooms_m'] and pack.has(c['rooms_m'], 'room_temp_c') else None
        rt0 = median(rt[max(0, t - 6):t]) if rt else None
        rt_pk = max(rt[t:(k_rec or now) + 1]) if rt else None
        t_ok = rt is not None and rt_pk - rt0 > p['room_temp_rise_c']
        low = {s: min(dps[s][t:(k_rec or now) + 1]) for s in sensors}
        worst = min(sensors, key=lambda s: low[s])
        rev = [s for s in sensors if low[s] < 0]
        below_min = pack.minutes_between(t, k_rooms) if k_rooms is not None else pack.minutes_between(t, now)
        served = []
        for x in pack.targets(aid, 'hvac'):
            key = next((k for k in ('skid_flow_l_min', 'vf_flux_lmh', 'permeate_flux_lmh') if pack.has(x, k)), None)
            if key is None:
                served.append((x, None, None, None, 'no process flow measured'))
                continue
            v = pack.series(x, key)
            if v[t - 1] <= 1:
                served.append((x, key, None, None, 'idle before the trip'))
                continue
            k_stop = next((k for k in range(t, min(pack.n, t + pack.steps(p['stop_within_min']) + 1)) if v[k] <= 1), None)
            if k_stop is None:
                served.append((x, key, None, None, 'kept running'))
                continue
            k_res = next((k for k in range(k_stop, pack.n) if v[k] > 0.5 * v[t - 1]), None)
            served.append((x, key, k_stop, k_res, 'stopped'))
        stopped = [s for s in served if s[4] == 'stopped']
        p_ok = bool(stopped)
        level = 'high' if recovered else ('medium' if (h_ok or t_ok) else 'low')
        w1 = win(pack, t, max([k_rec or t] + [s[3] or t for s in stopped]), 6)
        dd = [-5, 20]
        dmin = [min(dps[s][k] for s in sensors) for k in range(pack.n)]
        ps = stopped[0] if stopped else None
        pflow = pack.series(ps[0], ps[1]) if ps else None
        sd = lambda s: f'{pack.name(s)} {num(dps[s][t - 1], 1)} → {num(low[s], 1)} Pa'

        checks = [
            check('trip', f'{fname} stopped, supply air collapsed', 'required', MATCH,
                  f'Airflow {num(air[t - 1], 0)} → {num(air[t], 0)} m³/h at {ts[t]}; {fname} speed '
                  f'{num(speeds[fan][t - 1], 0)} → {num(speeds[fan][t], 0)} % in the same interval.',
                  'A fan that stops in one interval tripped. A slipping belt or loading filter loses air over hours.',
                  spark(air, [0, 22000], window=w1)),
            check('rooms', 'Room pressures lost', 'required', MATCH,
                  f'{"; ".join(sd(s) for s in sensors)}. Under {num(p["room_min_pa"], 0)} Pa for {dur(below_min)}.'
                  + (f' {join_names([pack.name(s) for s in rev])} reversed: air flowed the wrong way.' if rev else ''),
                  'Room pressure is kept up by supply air. Without it, the cascade that keeps air flowing from clean to '
                  'less clean collapses.',
                  spark(dmin, dd, threshold_value=p['room_min_pa'], window=w1)),
            check('hepa', 'HEPA bank DP fell with it', 'supporting', MATCH if h_ok else NO_MATCH,
                  (f'{num(hdp[t - 1], 0)} → {num(hdp[t], 0)} Pa.' if hdp else 'No HEPA DP found.'),
                  'A separate sensor. Pressure drop across the filters needs air moving through them, so the air really '
                  'stopped; it isn\'t an airflow transmitter fault.',
                  spark(hdp, [0, 300], window=w1) if hdp else None),
            check('temp', 'Rooms warmed', 'supporting', MATCH if t_ok else NO_MATCH,
                  (f'Room temperature {num(rt0, 1)} → {num(rt_pk, 1)} °C.' if rt else 'No room temperature found.'),
                  'Supply air also carries the heat away. A separate sensor that agrees the air stopped.',
                  spark(rt, nice_domain(rt), window=w1) if rt else None),
            check('process', 'Processing in the suite stopped', 'supporting', MATCH if p_ok else NO_MATCH,
                  ('; '.join(f'{pack.name(x)} {"stopped at " + ts[ks] + (", resumed " + ts[kr] if kr else ", still stopped") if st == "stopped" else st}'
                             for x, _, ks, kr, st in served) + '.'),
                  f'{name} serves these units on the HVAC layer. Open steps can\'t run while the room cascade is lost.',
                  spark(pflow, nice_domain(pflow), window=w1) if pflow else None),
            check('recovered', 'Back once the standby fan started', 'supporting', MATCH if recovered else PENDING,
                  (f'{pack.name(sb[0])} running at {ts[sb[1]]}; airflow {num(air[k_air], 0)} m³/h at {ts[k_air]}; every '
                   f'room above {num(p["room_min_pa"], 0)} Pa at {ts[k_rooms]}.' if recovered else
                   'Not recovered yet.'),
                  'Starting the other fan restored the rooms. That ties the excursion to the fan, not the rooms or doors.',
                  spark(air, [0, 22000], highlight=[ts[sb[1]], ts[k_rec]] if recovered else None, window=w1)),
        ]
        main = chart('Pa', dd, [series(s.split('_')[-1].lower(), pack.name(s), dps[s], 'primary' if s == worst else 'secondary', 1)
                                for s in sensors],
                     title='What we see', decimals=0,
                     caption=f'Room differential pressures in the suite served by {name}. All fell at {ts[t]} when '
                             f'{fname} stopped' + (f', and recovered by {ts[k_rooms]}.' if k_rooms else '.'),
                     thresholds=[threshold(p['room_min_pa'], 'Minimum'), threshold(0, 'Reversed')],
                     markers=[marker(ts[t], f'{fname} trips')] + ([marker(ts[sb[1]], f'{pack.name(sb[0])} running')] if sb else [])
                     + ([marker(ts[ps[3]], f'{pack.name(ps[0])} resumes')] if ps and ps[3] else []), window=w1)
        grid = minutes_grid(-15, 60, 5)
        r = Rng(2606)
        tb = [(13 if m < 0 else 1 if m < 15 else 13 * (1 - math.exp(-(m - 15) / 5))) + r.gauss(0.3) for m in grid]
        ld = [(13 if m < 0 else 1) + r.gauss(0.3) for m in grid]
        dr = [(13 if m < 0 else 6 if m < 25 else 13) + r.gauss(0.3) for m in grid]
        live = f'{pack.name(worst)}, today'
        lv = aligned(dps[worst], t, pack.step_min, grid, 'min')
        mk = lambda a: [ref_chart('Room DP (min from the trip)', 'Pa', [-5, 20], grid, 'min', a, lv, live, 0,
                                  [threshold(p['room_min_pa'], 'Minimum')])]
        refs = [
            reference('trip', 'textbook', 'Textbook', 'Duty fan trip, standby started by hand',
                      'Room pressures collapse in seconds and stay down until someone starts the standby fan; then they '
                      'recover in minutes. EM sampling follows.', 'match', 'Closest match',
                      ['Same collapse at the trip', 'Same recovery after the standby start'], mk(tb)),
            reference('noauto', 'variant', 'What to avoid', 'No standby fan, or it fails to start',
                      'Pressures stay down until the duty fan is repaired. Every open step in the suite waits, and '
                      'the EM investigation grows.', 'nomatch', 'Avoided today',
                      [f'Standby fan was running within {dur(pack.minutes_between(t, sb[1]))}' if sb else 'No standby start yet'],
                      mk(ld)),
            reference('door', 'lookalike', 'Look-alike', 'Door held open',
                      'One room pair loses part of its differential while a door is open; supply airflow and the HEPA '
                      'DP don\'t change.', 'nomatch', 'Doesn\'t match',
                      [f'Here supply air fell to {num(air[t], 0)} m³/h', 'Here every room fell at once'], mk(dr)),
        ]
        ro = [
            ruled_out('Door held open or a room leak', 'ruled out',
                      f'Every room fell in the same interval, together with supply air and the HEPA DP.'),
            ruled_out('Airflow transmitter fault', 'ruled out' if h_ok else 'unlikely',
                      'HEPA DP and room temperature, two separate sensors, moved with the airflow.'),
            ruled_out('HEPA filters loading', 'ruled out',
                      f'HEPA DP went down, not up, and was {num(hdp[k_rec or now], 0)} Pa after recovery.' if hdp else ''),
            ruled_out('Why the fan tripped', 'not yet checked',
                      f'{fname} went from running to stopped in one interval, which fits a drive or motor trip. The drive\'s '
                      f'fault log will say.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'{fname} tripped; the room pressure loss and the process hold followed from it', level,
                                     'Confirmed: rooms recovered when the standby fan started' if recovered else
                                     'Fan stop and room pressures moved together'),
            'rootCauseAssetId': fan,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The fan stopped, airflow, HEPA DP and every room pressure fell in the same interval, and all '
                                     'came back when the standby fan started.' if recovered else
                                     'The fan stopped and every room pressure fell in the same interval.',
                                     None if recovered else 'The standby fan hasn\'t been started yet.',
                                     None if recovered else 'Pressures recover when the standby fan runs.',
                                     'Pressures stay low with a fan running. Then look for dampers and doors.',
                                     'Recovery on the standby fan' if recovered else None),
            'action': action(item, pack),
            'impact': (f'{dur(below_min)} below the {num(p["room_min_pa"], 0)} Pa minimum'
                       + (f', {join_names([pack.name(s) for s in rev])} reversed' if rev else '')
                       + (f'; {join_names([pack.name(x) + " on hold " + dur(pack.minutes_between(ks, kr or now)) for x, _, ks, kr, _ in stopped])}'
                          if stopped else '')
                       + '. The disposition waits for the EM plates (48–72 h).'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. pCO₂ accumulation — archetype 04 (accumulation)
# ═════════════════════════════════════════════════════════════════════════
class Pco2Accumulation(Detector):
    id = 'pharma.pco2_accumulation'
    name = 'Dissolved CO₂ accumulating'
    archetype = '04 Accumulation or saturation'
    applies_to = 'pCO₂ probes'
    summary = ('Dissolved CO₂ in a running bioreactor climbing steadily: CO₂ is being made faster than the gas flows '
               'strip it. The off-gas and the pH loop confirm it is real, and the time to the proven acceptable '
               'limit is projected.')
    pipeline = [
        ('Baseline', 'the probe\'s own median over the first hour of the shift'),
        ('Accumulating', 'pCO₂ above baseline and still rising over the last 90 minutes'),
        ('Real, not the probe', 'off-gas CO₂ (a separate analyser) and the pH loop\'s response'),
        ('Why', 'what changed on the stripping side (headspace overlay, air sparge) just before the rise; cell density'),
        ('Clock', 'when it crosses the normal operating range and the proven acceptable range at the current rate'),
    ]
    definition = {
        'appliesTo': {'assetType': 'pco2_probe'},
        'inputs': {'pco2': 'self.pco2_mmhg', 'gas': 'parent gas_control_module: overlay_air_slpm, air_sparge_slpm, co2_flow_slpm',
                   'offgas': 'unit child exhaust_module: exhaust_co2_pct, exhaust_filter_dp_mbar, vessel_pressure_barg',
                   'ph': 'unit child ph_control_module.culture_ph; base_pump.base_pump_rate_ml_min',
                   'cells': 'unit.vcd_e6_ml or seed_vcd_e6_ml; unit.osmolality_mosm_kg'},
        'params': {'min_mmhg': 10, 'base_min': 60, 'rise_mmhg': 15, 'watch_mmhg': 5, 'sustain_min': 30,
                   'slope_window_min': 90, 'min_slope_mmhg_h': 6, 'nor_mmhg': 120, 'par_mmhg': 160,
                   'offgas_rise_pct': 0.5, 'ph_drop': 0.03, 'base_rise_frac': 0.3, 'gas_cut_frac': 0.5,
                   'gas_lead_min': 60, 'vcd_rise_pct': 10},
        'checks': [
            {'id': 'up', 'role': 'required', 'rule': 'pCO₂ − baseline > rise_mmhg for sustain_min'},
            {'id': 'rising', 'role': 'required', 'rule': 'slope(pCO₂, slope_window_min) > min_slope_mmhg_h'},
            {'id': 'offgas', 'role': 'supporting', 'independent': True, 'rule': 'off-gas CO₂ up > offgas_rise_pct points'},
            {'id': 'phloop', 'role': 'supporting', 'independent': True, 'rule': 'pH down > ph_drop and base pump up > base_rise_frac'},
            {'id': 'cells', 'role': 'supporting', 'rule': 'VCD up < vcd_rise_pct: more cells don\'t explain it'},
            {'id': 'stripping', 'role': 'supporting', 'rule': 'overlay or air sparge cut by > gas_cut_frac within gas_lead_min before the onset'},
        ],
        'confidence': {'low': 'required checks only', 'medium': 'off-gas or pH loop agrees (independent)',
                       'high': 'offline blood-gas confirms, or pCO₂ turns once stripping is restored'},
    }

    def candidates(self, pack):
        return pack.of_type('pco2_probe')

    def evaluate(self, pack, aid):
        p = self.p
        v = pack.series(aid, 'pco2_mmhg')
        nb = pack.steps(p['base_min'])
        base = median(v[:nb])
        if base is None or base < p['min_mmhg']:
            return Finding(aid, False)
        res = [x - base for x in v]
        hi = B.gt(res, p['rise_mmhg'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(v, i, sw, pack.step_min)
            if slope is None or slope <= p['min_slope_mmhg_h']:
                continue
            onset = s0
            while onset > 0 and res[onset - 1] > p['watch_mmhg']:
                onset -= 1
            return Finding(aid, True, i, v=v, base=base, res=res, alert=s0, onset=onset)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        v, base, onset, alert = c['v'], c['base'], c['onset'], c['alert']
        nb = pack.steps(p['base_min'])
        gas = pack.parent(aid)
        exh = pack.child_of_type(unit, 'exhaust_module')
        phm = pack.child_of_type(unit, 'ph_control_module')
        bp = pack.child_of_type(phm, 'base_pump') if phm else None
        slope = B.slope_per_hour(v, now, pack.steps(p['slope_window_min']), pack.step_min)
        h = pack.steps(30)
        off = pack.series(exh, 'exhaust_co2_pct') if exh else None
        off0, off1 = (median(off[:nb]), mean_between(off, now - h + 1, now)) if off else (None, None)
        off_ok = off is not None and off1 - off0 > p['offgas_rise_pct']
        ph = pack.series(phm, 'culture_ph') if phm else None
        ph0, ph1 = (median(ph[:nb]), mean_between(ph, now - h + 1, now)) if ph else (None, None)
        bpr = pack.series(bp, 'base_pump_rate_ml_min') if bp else None
        b0, b1 = (median(bpr[:nb]), mean_between(bpr, now - h + 1, now)) if bpr else (None, None)
        co2s = pack.series(gas, 'co2_flow_slpm')
        c0, c1 = median(co2s[:nb]), mean_between(co2s, now - h + 1, now)
        ph_ok = ph is not None and bpr is not None and ph0 - ph1 > p['ph_drop'] and b1 > (1 + p['base_rise_frac']) * b0
        vkey = 'vcd_e6_ml' if pack.has(unit, 'vcd_e6_ml') else 'seed_vcd_e6_ml'
        vcd = pack.series(unit, vkey)
        v0, v1 = median(vcd[:nb]), mean_between(vcd, now - h + 1, now)
        vcd_pct = 100 * (v1 / v0 - 1)
        cells_ok = vcd_pct < p['vcd_rise_pct']
        lead = pack.steps(p['gas_lead_min'])
        cut = None
        for key, label in (('overlay_air_slpm', 'Headspace overlay air'), ('air_sparge_slpm', 'Air sparge')):
            g = pack.series(gas, key)
            for k in range(max(1, onset - lead), min(pack.n, onset + 2)):
                prev = median(g[max(0, k - 6):k])
                if prev and g[k] < (1 - p['gas_cut_frac']) * prev:
                    cut = (key, label, k, prev, g[k], g)
                    break
            if cut:
                break
        strip_ok = cut is not None
        indep = off_ok or ph_ok
        level = 'medium' if indep else 'low'
        k_nor = next((k for k in range(pack.n) if v[k] > p['nor_mmhg']), None)
        t_now = tmin(pack, now)
        eta_par = t_now + (p['par_mmhg'] - v[now]) / slope * 60 if slope and slope > 0 and v[now] < p['par_mmhg'] else None
        eta_nor = (t_now + (p['nor_mmhg'] - v[now]) / slope * 60) if k_nor is None and slope and slope > 0 else None
        osm = pack.series(unit, 'osmolality_mosm_kg') if pack.has(unit, 'osmolality_mosm_kg') else None
        fdp = pack.series(exh, 'exhaust_filter_dp_mbar') if exh else None
        vp = pack.series(exh, 'vessel_pressure_barg') if exh else None
        air = pack.series(gas, 'air_sparge_slpm')
        others = [x for x in self.candidates(pack) if x != aid and median(pack.series(x, 'pco2_mmhg')[:nb]) >= p['min_mmhg']]
        oth = [(x, pack.series(x, 'pco2_mmhg')) for x in others]
        proj = [None] * pack.n
        if slope and slope > 0:
            proj[now] = v[now]
        yd = [0, 200]

        checks = [
            check('up', 'Well above where it started', 'required', MATCH,
                  f'{num(v[now], 1)} mmHg now against {num(base, 1)} mmHg over the first hour. More than '
                  f'+{num(p["rise_mmhg"], 0)} mmHg since {ts[alert]}; the rise began about {ts[onset]}.',
                  'Dissolved CO₂ settles where production and stripping balance. A lasting rise means the balance moved.',
                  spark(v, yd, threshold_value=p['nor_mmhg'])),
            check('rising', 'Still climbing', 'required', MATCH,
                  f'{signed(slope, 1)} mmHg per hour over the last {dur(p["slope_window_min"])}.'
                  + (f' Left the normal range ({num(p["nor_mmhg"], 0)} mmHg) at {ts[k_nor]}.' if k_nor is not None else ''),
                  'An accumulation doesn\'t level off by itself until something changes on the production or '
                  'stripping side.',
                  spark(v, yd, threshold_value=p['par_mmhg'], highlight=[ts[max(0, now - pack.steps(p['slope_window_min']))], ts[now]])),
            check('offgas', 'Off-gas CO₂ up too', 'supporting', MATCH if off_ok else NO_MATCH,
                  (f'{num(off0, 2)} → {num(off1, 2)} % CO₂ in the exhaust.' if off else 'No off-gas analyser found.'),
                  'A separate analyser on the exhaust. It rules out a drifting pCO₂ probe.',
                  spark(off, nice_domain(off)) if off else None),
            check('phloop', 'pH loop pushing against it', 'supporting', MATCH if ph_ok else NO_MATCH,
                  (f'pH {num(ph0, 3)} → {num(ph1, 3)}; CO₂ sparge {num(c0, 1)} → {num(c1, 1)} slpm; base pump '
                   f'{num(b0, 1)} → {num(b1, 1)} mL/min.' if ph else 'No pH loop found.'),
                  'Dissolved CO₂ is an acid. The pH loop answers by cutting its own CO₂ and adding base, which is '
                  'what it is doing: two more separate instruments agree.',
                  spark(bpr, nice_domain(bpr)) if bpr else None),
            check('cells', 'Not more cells', 'supporting', MATCH if cells_ok else NO_MATCH,
                  f'VCD {num(v0, 2)} → {num(v1, 2)} ×10⁶/mL ({signed(vcd_pct, 1)} %), while pCO₂ rose '
                  f'{signed(100 * (v[now] / base - 1), 0)} %.',
                  'CO₂ production scales with the number of cells. A few percent more cells can\'t make tens of percent '
                  'more CO₂.',
                  spark(vcd, nice_domain(vcd))),
            check('stripping', 'Less gas stripping the CO₂', 'supporting', MATCH if strip_ok else NO_MATCH,
                  (f'{cut[1]} {num(cut[3], 0)} → {num(cut[4], 0)} slpm at {ts[cut[2]]}, '
                   f'{dur(pack.minutes_between(cut[2], onset)) if cut[2] < onset else "at"} before the rise began'
                   f'{"" if cut[2] < onset else " the same time"}; still {num(cut[5][now], 0)} slpm now.'
                   if strip_ok else 'No overlay or sparge cut found before the rise.'),
                  'CO₂ leaves the liquid into the gas passing over and through it. Less gas, less CO₂ removed.',
                  spark(cut[5], nice_domain(cut[5], [0]), highlight=[ts[cut[2]], ts[now]]) if strip_ok else None),
        ]
        main = chart('mmHg', yd, [series('pco2', f'{uname} pCO₂', v, 'primary', 1)]
                     + [series('peer' + str(n), f'{short(pack, x)} pCO₂', s, 'peer', 1) for n, (x, s) in enumerate(oth)],
                     title='What we see', decimals=0,
                     caption=f'{uname} dissolved CO₂ through the day against the other running bioreactors. Normal '
                             f'operating range up to {num(p["nor_mmhg"], 0)} mmHg; proven acceptable range up to '
                             f'{num(p["par_mmhg"], 0)} mmHg.',
                     thresholds=[threshold(p['nor_mmhg'], 'NOR'), threshold(p['par_mmhg'], 'PAR')],
                     markers=([marker(ts[cut[2]], f'{cut[1]} cut')] if strip_ok else []) + [marker(ts[onset], 'Rise begins')]
                     + ([marker(ts[k_nor], 'Leaves NOR')] if k_nor is not None else []))
        grid = hours_grid(6, 0.25, -0.5)
        r = Rng(2707)
        rise = lambda hh, top, tau: 0 if hh < 0 else top * (1 - math.exp(-hh / tau))
        tb = [90 + rise(hh, 110, 5) + r.gauss(1.0) for hh in grid]
        ea = [90 + 3 * max(0, hh) + r.gauss(1.0) for hh in grid]
        la = [90 + (0 if hh < 0 else min(40, 12 * hh)) + r.gauss(1.0) for hh in grid]
        live = f'{uname}, today'
        lv = aligned(v, onset, pack.step_min, grid)
        mk = lambda a: [ref_chart('pCO₂ (h from the start of the rise)', 'mmHg', [60, 200], grid, 'h', a, lv, live, 0,
                                  [threshold(p['nor_mmhg'], 'NOR'), threshold(p['par_mmhg'], 'PAR')])]
        refs = [
            reference('strip', 'textbook', 'Textbook', 'Stripping gas lost after a change',
                      'Overlay or sparge left low after a filter swap or recipe step. pCO₂ climbs 10–15 mmHg an hour toward a '
                      'new, higher balance; pH sinks to its dead-band edge; base use climbs. Restoring the gas flow turns it '
                      'within the hour.', 'match', 'Closest match',
                      ['Same rate of rise', 'Same pH-loop response'] + (['Same kind of trigger: a gas cut'] if strip_ok else []),
                      mk(tb)),
            reference('scale', 'early', 'Slow variant', 'Rising cell density at scale',
                      'CO₂ builds a few mmHg an hour as the culture peaks in a large vessel with poor stripping. A '
                      'recipe issue, not an event.', 'partial', 'Same direction, far slower',
                      [f'Here VCD moved only {signed(vcd_pct, 1)} %', f'Here {signed(slope, 0)} mmHg per hour'], mk(ea)),
            reference('probe', 'lookalike', 'Look-alike', 'pCO₂ probe drift',
                      'The probe reads higher and higher but nothing else moves: off-gas CO₂, pH and base use stay '
                      'where they were. An offline blood-gas sample shows the gap.', 'nomatch',
                      'Doesn\'t match' if indep else 'Can\'t rule out yet',
                      ([f'Off-gas CO₂ rose {signed(off1 - off0, 2)} points here'] if off else [])
                      + ([f'Base pump went from {num(b0, 0)} to {num(b1, 0)} mL/min'] if bpr else []), mk(la)),
        ]
        ro = [
            ruled_out('More cells making more CO₂', 'ruled out' if cells_ok else 'not yet checked',
                      f'VCD changed {signed(vcd_pct, 1)} %; pCO₂ rose {signed(100 * (v[now] / base - 1), 0)} %.'),
            ruled_out('pCO₂ probe drift', 'ruled out' if off_ok else ('unlikely' if ph_ok else 'not yet checked'),
                      'Off-gas CO₂ and the pH loop, separate instruments, moved with it. The offline sample will close it.'),
            ruled_out('Blocked exhaust filter', 'ruled out' if fdp else 'not yet checked',
                      (f'Exhaust filter DP is {num(fdp[now], 1)} mbar, down from {num(median(fdp[:nb]), 1)}; vessel pressure '
                       f'{num(min(vp[onset:now + 1]), 3)}–{num(max(vp[onset:now + 1]), 3)} bar(g). A blocked filter would raise '
                       f'both.' if fdp and vp else '')),
            ruled_out('More CO₂ sparged by the pH loop', 'ruled out',
                      f'CO₂ sparge fell from {num(c0, 1)} to {num(c1, 1)} slpm.'),
            ruled_out('Air sparge reduced', 'ruled out' if not (strip_ok and cut[0] == 'air_sparge_slpm') else 'not yet checked',
                      f'Air sparge {num(min(air[onset:now + 1]), 0)}–{num(max(air[onset:now + 1]), 0)} slpm since the rise began.'),
        ] + ([ruled_out('Something shared with the other bioreactors', 'ruled out',
                        f'{join_names([short(pack, x) for x, _ in oth])} stayed at '
                        f'{num(min(min(s[onset:now + 1]) for _, s in oth), 0)}–{num(max(max(s[onset:now + 1]) for _, s in oth), 0)} mmHg '
                        f'over the same hours.')] if oth else [])
        return {
            'conclusion': conclusion('Most likely cause',
                                     (f'CO₂ is not being stripped: {cut[1].lower()} has been at {num(cut[4], 0)} slpm since '
                                      f'{ts[cut[2]]}, against {num(cut[3], 0)} before' if strip_ok else
                                      'CO₂ is being produced faster than it is stripped'), level,
                                     'Off-gas and pH loop confirm the rise' if indep else 'pCO₂ probe only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Off-gas CO₂ and the pH loop, both separate from the probe, agree the CO₂ is real, and '
                                     'the rise began right after the gas flow was cut.' if indep and strip_ok else
                                     'Separate instruments agree the CO₂ is real.' if indep else 'Only the probe shows it.',
                                     'No offline blood-gas sample yet, and the gas flow hasn\'t been restored to see '
                                     'pCO₂ turn.',
                                     'pCO₂ levels off and falls within the hour of restoring the overlay, and the offline '
                                     'sample matches the probe.',
                                     'pCO₂ keeps rising with the gas flows at recipe. Then look at the culture itself (lactate '
                                     'shift, cell state).'),
            'action': action(item, pack),
            'impact': (f'At {signed(slope, 1)} mmHg per hour it reaches the {num(p["par_mmhg"], 0)} mmHg PAR at about '
                       f'{clock(eta_par)}.' if eta_par else '')
            + (f' It would leave the NOR at about {clock(eta_nor)}.' if eta_nor else '')
            + (f' Osmolality {num(osm[0], 0)} → {num(osm[now], 0)} mOsm/kg from the extra base.' if osm else ''),
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. WFI still efficiency drift — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class StillEfficiencyDrift(Detector):
    id = 'pharma.wfi_still_drift'
    name = 'WFI still using more steam per litre'
    archetype = '03 Quiet drift'
    applies_to = 'WFI stills'
    summary = ('A multi-effect still slowly making less distillate while using more plant steam: steam per litre '
               'creeping up, with WFI quality unchanged. Typical of non-condensable gases blanketing the condensing '
               'surfaces, or of scale.')
    pipeline = [
        ('Specific steam', 'plant steam ÷ distillate, kg per 1,000 L'),
        ('Baseline', 'its median over the first hour of the shift'),
        ('Checks', 'above baseline · creeping, not stepping · sustained · output down, steam up'),
        ('Quality', 'loop conductivity and TOC against their limits'),
        ('Conclusion', 'slow, recoverable loss; a sudden full recovery after a change → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'multi_effect_still'},
        'inputs': {'out': 'self.still_output_l_h', 'steam': 'self.still_steam_kg_h',
                   'loop': 'targets[wfi] … wfi_loop: loop_conductivity_us_cm, loop_toc_ppb',
                   'tank': 'targets[wfi] wfi_tank.wfi_tank_level_pct', 'draw': 'unit.wfi_draw_l_h'},
        'expected': {'model': 'own baseline', 'target': 'steam / output', 'formula': 'median over the first base_min'},
        'params': {'base_min': 60, 'rise_pct': 6.0, 'sustain_min': 30, 'slope_window_min': 120, 'min_slope_pct_h': 1.5,
                   'max_step_pct': 3.0, 'output_drop_pct': 4.0, 'cond_limit_us_cm': 1.3, 'toc_limit_ppb': 500,
                   'recover_frac': 0.8, 'recover_within_min': 60},
        'checks': [
            {'id': 'ratio', 'role': 'required', 'rule': 'specific steam > baseline × (1 + rise_pct/100)'},
            {'id': 'creep', 'role': 'required', 'rule': 'slope > min_slope_pct_h and no single step > max_step_pct'},
            {'id': 'sustained', 'role': 'required', 'rule': 'above for sustain_min'},
            {'id': 'output', 'role': 'supporting', 'independent': True, 'rule': 'output down > output_drop_pct on its own meter while steam is not down'},
            {'id': 'quality', 'role': 'supporting', 'rule': 'loop conductivity < cond_limit and TOC < toc_limit'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': '≥ recover_frac of the excess gone within recover_within_min of the worst point'},
        ],
        'confidence': {'medium': 'required + output meter agrees', 'high': 'sudden recovery to baseline'},
    }

    def candidates(self, pack):
        return pack.of_type('multi_effect_still')

    def _ctx(self, pack, aid):
        out, steam = pack.series(aid, 'still_output_l_h'), pack.series(aid, 'still_steam_kg_h')
        if min(out) <= 0:
            return None
        spec = [1000 * s / o for s, o in zip(steam, out)]
        nb = pack.steps(self.p['base_min'])
        base = median(spec[:nb])
        pct = [100 * (x / base - 1) for x in spec]
        return dict(out=out, steam=steam, spec=spec, base=base, pct=pct, nb=nb)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        hi = B.gt(c['pct'], p['rise_pct'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(c['pct'], i, sw, pack.step_min)
            if slope is None or slope <= p['min_slope_pct_h'] or B.max_step(c['pct'], 0, i) >= p['max_step_pct']:
                continue
            c.update(alert=s0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        out, steam, spec, base, pct, nb = c['out'], c['steam'], c['spec'], c['base'], c['pct'], c['nb']
        slope = B.slope_per_hour(pct, i, pack.steps(p['slope_window_min']), pack.step_min)
        worst = max(range(pack.n), key=lambda k: pct[k])
        o0, s0 = median(out[:nb]), median(steam[:nb])
        o_w, s_w = mean_between(out, worst - 2, worst), mean_between(steam, worst - 2, worst)
        o_pct, s_pct = 100 * (o_w / o0 - 1), 100 * (s_w / s0 - 1)
        out_ok = o_pct < -p['output_drop_pct'] and s_pct > -1
        tank = next((x for x in pack.targets(aid, 'wfi') if pack.has(x, 'wfi_tank_level_pct')), None)
        loop = next((x for x in (pack.targets(tank, 'wfi') if tank else []) if pack.has(x, 'loop_conductivity_us_cm')), None)
        cond = pack.series(loop, 'loop_conductivity_us_cm') if loop else None
        toc = pack.series(loop, 'loop_toc_ppb') if loop else None
        q_ok = cond is not None and max(cond) < p['cond_limit_us_cm'] and max(toc) < p['toc_limit_ppb']
        rec = next((k for k in range(worst, min(pack.n, worst + pack.steps(p['recover_within_min']) + 1))
                    if pct[k] <= (1 - p['recover_frac']) * pct[worst]), None)
        recovered = rec is not None
        level = 'high' if recovered else ('medium' if out_ok else 'low')
        lvl = pack.series(tank, 'wfi_tank_level_pct') if tank else None
        draw = pack.series(unit, 'wfi_draw_l_h') if pack.has(unit, 'wfi_draw_l_h') else None
        lost = sum(max(0, o0 - o) * pack.step_min / 60 for o in out[:(rec or now) + 1])
        exp_out = [o0] * pack.n

        checks = [
            check('ratio', 'More steam for every litre', 'required', MATCH,
                  f'{num(spec[i], 0)} kg steam per 1,000 L when flagged at {ts[i]}, against {num(base, 0)} in the first '
                  f'hour ({signed(pct[i], 1)} %). Worst {signed(pct[worst], 1)} % at {ts[worst]}.',
                  'A still turns a fixed amount of steam into a fixed amount of distillate. Needing more steam per litre '
                  'means heat is not getting through.',
                  spark(pct, nice_domain(pct, [0, p['rise_pct']]), threshold_value=p['rise_pct'])),
            check('creep', 'Creeping, not stepping', 'required', MATCH,
                  f'{signed(slope, 1)} % per hour over the {dur(p["slope_window_min"])} to {ts[i]}; largest 5-min change '
                  f'{num(B.max_step(pct, 0, i), 1)} %.',
                  'Gas building up in the condensing sides, or scale, grows by the hour. A meter fault would jump.',
                  spark(pct, nice_domain(pct), highlight=[ts[max(0, i - pack.steps(p['slope_window_min']))], ts[i]])),
            check('sustained', 'Sustained', 'required', MATCH,
                  f'Above +{num(p["rise_pct"], 0)} % since {ts[c["alert"]]}.',
                  f'Needs {dur(p["sustain_min"])} above the flag level, so a demand swing can\'t raise it.',
                  spark(pct, nice_domain(pct), threshold_value=p['rise_pct'], highlight=[ts[c['alert']], ts[i]])),
            check('output', 'Less water, more steam, on separate meters', 'supporting', MATCH if out_ok else NO_MATCH,
                  f'Distillate {num(o0, 0)} → {num(o_w, 0)} L/h ({signed(o_pct, 1)} %); plant steam {num(s0, 0)} → '
                  f'{num(s_w, 0)} kg/h ({signed(s_pct, 1)} %).',
                  'Each meter on its own moved the wrong way, so it isn\'t one bad meter making the ratio look worse.',
                  spark(out, nice_domain(out, [o0]), exp_out, exp_out)),
            check('quality', 'WFI quality unchanged', 'supporting', MATCH if q_ok else NO_MATCH,
                  (f'Loop conductivity {num(min(cond), 3)}–{num(max(cond), 3)} µS/cm (limit {num(p["cond_limit_us_cm"], 1)}), '
                   f'TOC {num(min(toc), 0)}–{num(max(toc), 0)} ppb (limit {num(p["toc_limit_ppb"], 0)}).' if cond else
                   'No loop quality found.'),
                  'Carry-over or priming would spoil the distillate. The loss is in capacity, not quality.',
                  spark(cond, [0, 1.5], threshold_value=p['cond_limit_us_cm']) if cond else None),
            check('recovered', 'Back to normal after a change', 'supporting', MATCH if recovered else PENDING,
                  (f'From {signed(pct[worst], 1)} % at {ts[worst]} to {signed(pct[rec], 1)} % by {ts[rec]}; '
                   f'{signed(pct[now], 1)} % now.' if recovered else 'Not recovered yet.'),
                  'Scale and fouling don\'t clear in an hour. A quick full recovery means something was opened or '
                  'reset: typically the non-condensable vent.',
                  spark(pct, nice_domain(pct), highlight=[ts[worst], ts[rec]] if recovered else None)),
        ]
        main = chart('L/h', nice_domain(out, [o0], pad=0.1),
                     [series('out', f'{uname} distillate', out, 'primary', 0),
                      series('exp', 'First-hour output', exp_out, 'expected', 0)],
                     title='What we see', decimals=0, shade_gap=['exp', 'out'],
                     caption=f'{uname} still output against its first hour, while plant steam went from {num(s0, 0)} to '
                             f'{num(steam[worst], 0)} kg/h. The shaded gap is water not made.',
                     markers=[marker(ts[c['alert']], f'+{num(p["rise_pct"], 0)} % steam per litre')]
                     + ([marker(ts[worst], 'Recovery starts')] if recovered else []))
        grid = hours_grid(6, 0.25)
        r = Rng(2808)
        tb = [(2.8 * hh if hh < 4.7 else max(0, 13.2 - 20 * (hh - 4.7))) + r.gauss(0.5) for hh in grid]
        sc = [0.6 * hh + r.gauss(0.5) for hh in grid]
        la = [(0 if hh < 2 else 7) + r.gauss(0.5) for hh in grid]
        live = f'{uname}, today'
        lv = aligned(pct, 0, pack.step_min, grid)
        mk = lambda a: [ref_chart('Extra steam per litre (h from shift start)', '%', [-5, 25], grid, 'h', a, lv, live, 0,
                                  [threshold(p['rise_pct'], 'Flag')])]
        refs = [
            reference('vent', 'textbook', 'Textbook', 'Non-condensable vent left closed',
                      'After maintenance a vent valve is left part-closed. Air collects on the condensing surfaces, and '
                      'steam per litre climbs a few percent an hour. Opening the vent restores it within the hour.',
                      'match', 'Closest match', ['Same steady climb', 'Same quick, full recovery'], mk(tb)),
            reference('scale', 'variant', 'Variant', 'Scale on the evaporator tubes',
                      'Same direction, but over weeks, and it doesn\'t come back until the still is descaled.',
                      'nomatch', 'Doesn\'t match',
                      ['Scale builds over weeks, not hours', 'Here it came back within the hour' if recovered else 'Worth a check'],
                      mk(sc)),
            reference('meter', 'lookalike', 'Look-alike', 'Steam meter re-zeroed',
                      'The ratio steps up in one reading and stays there. Output doesn\'t change.', 'nomatch',
                      'Doesn\'t match', ['This was a creep, not a step', f'Output fell {signed(o_pct, 1)} % on its own meter'],
                      mk(la)),
        ]
        ro = [
            ruled_out('Higher WFI demand', 'ruled out',
                      'Demand draws the tank down; it doesn\'t change how much steam each litre of distillate costs.'
                      + (f' Tank level {num(min(lvl), 0)}–{num(max(lvl), 0)} % today.' if lvl else '')),
            ruled_out('A faulty steam or output meter', 'ruled out' if out_ok else 'unlikely',
                      f'Both meters moved the wrong way on their own ({signed(o_pct, 1)} % output, {signed(s_pct, 1)} % steam).'),
            ruled_out('Carry-over or priming', 'ruled out' if q_ok else 'not yet checked',
                      f'Loop conductivity and TOC stayed well within limits.' if q_ok else 'No quality data.'),
            ruled_out('Scale', 'ruled out' if recovered else 'not yet checked',
                      'Scale doesn\'t clear in an hour; this did.' if recovered else 'Needs an inspection or a descale.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     'Heat transfer lost to non-condensable gas in the still; it cleared within the hour, which scale doesn\'t' if recovered else
                                     'Heat transfer loss in the still (non-condensable gas or scale)', level,
                                     'Recovered fully and quickly' if recovered else 'Output and steam meters agree'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The loss grew slowly, both meters show it, and it cleared within the hour, which only a '
                                     'venting or operating change does.' if recovered else 'Both meters show the loss growing.',
                                     None if recovered else 'Nobody has checked the vent valve or column pressures yet.',
                                     None if recovered else 'Opening the vent brings steam per litre back.',
                                     'It creeps up again. Then check the vent line and plan a descale.',
                                     'Quick full recovery' if recovered else None),
            'action': action(item, pack),
            'impact': f'About {num(lost, 0)} L of WFI not made while output was below its first-hour rate.'
            + (f' WFI draw peaked at {num(max(draw), 0)} L/h this afternoon.' if draw else ''),
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Feed pump micro-stops — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
class FeedPumpMicroStops(Detector):
    id = 'pharma.feed_pump_micro_stops'
    name = 'Feed pump micro-stops'
    archetype = '12 Recurring micro-events'
    applies_to = 'feed pumps'
    summary = ('A bioreactor feed pump stopping for one interval at a time, over and over, and restarting by itself. '
               'Each stop is harmless; together they leave the batch behind its feed recipe.')
    pipeline = [
        ('Find the stops', 'intervals where the pump rate falls under 10 % of its normal rate, with normal running either side'),
        ('Count', 'how many in the last hour'),
        ('Local or shared', 'the other feed pumps on the same medium'),
        ('Effect', 'feed volume behind recipe and glucose'),
        ('Conclusion', 'repeated short stops on one pump → the pump (tubing); none after a repair → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'feed_pump'},
        'inputs': {'rate': 'self.feed_pump_rate_l_h', 'count': 'self.feed_interruptions_1h',
                   'glucose': 'parent feed_module.glucose_g_l', 'others': 'other feed_pump.feed_pump_rate_l_h',
                   'fix': 'done work items on this pump'},
        'params': {'stop_frac': 0.1, 'run_frac': 0.5, 'window_min': 60, 'min_events': 3, 'glucose_drop_g_l': 0.3,
                   'quiet_min': 60, 'catchup_frac': 1.1},
        'checks': [
            {'id': 'repeat', 'role': 'required', 'rule': '≥ min_events one-interval stops (rate < stop_frac × normal, running either side) in window_min'},
            {'id': 'restart', 'role': 'required', 'rule': 'each stop followed by the normal rate (> run_frac × normal)'},
            {'id': 'local', 'role': 'supporting', 'rule': 'no stops on other running feed pumps'},
            {'id': 'glucose', 'role': 'supporting', 'independent': True, 'rule': 'glucose down > glucose_drop_g_l since the first stop'},
            {'id': 'counter', 'role': 'supporting', 'rule': 'the pump\'s own interruption counter agrees'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'no stop for quiet_min after a done work item'},
        ],
        'confidence': {'medium': 'required + glucose agrees', 'high': 'no stops after the repair'},
    }

    def candidates(self, pack):
        return pack.of_type('feed_pump')

    def _stops(self, pack, aid):
        p = self.p
        r = pack.series(aid, 'feed_pump_rate_l_h')
        on = [v for v in r if v > 0]
        if not on:
            return None, r, None
        normal = median([v for v in on if v > p['run_frac'] * median(on)])
        out = [k for k in range(1, pack.n - 1) if r[k] < p['stop_frac'] * normal
               and r[k - 1] > p['run_frac'] * normal and r[k + 1] > p['run_frac'] * normal]
        return out, r, normal

    def evaluate(self, pack, aid):
        p = self.p
        stops, r, normal = self._stops(pack, aid)
        if not stops:
            return Finding(aid, False)
        w = pack.steps(p['window_min'])
        for i in range(pack.n):
            # a stop only counts once the next interval shows the automatic restart
            recent = [k for k in stops if i - w < k and k + 1 <= i]
            if len(recent) >= p['min_events']:
                return Finding(aid, True, i, stops=stops, r=r, normal=normal)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        stops, r, normal = c['stops'], c['r'], c['normal']
        first, last = stops[0], stops[-1]
        gaps = [pack.minutes_between(a, b) for a, b in zip(stops, stops[1:])]
        feed = pack.parent(aid)
        glu = pack.series(feed, 'glucose_g_l') if pack.has(feed, 'glucose_g_l') else None
        g0 = mean_between(glu, first - 3, first - 1) if glu else None
        gmin_k = min(range(first, pack.n), key=lambda k: glu[k]) if glu else None
        g_ok = glu is not None and g0 - glu[gmin_k] > p['glucose_drop_g_l']
        cnt = pack.series(aid, 'feed_interruptions_1h') if pack.has(aid, 'feed_interruptions_1h') else None
        c_ok = cnt is not None and max(cnt[first:last + 2]) >= p['min_events']
        others = []
        for o in self.candidates(pack):
            if o == aid:
                continue
            s2, r2, n2 = self._stops(pack, o)
            if n2:
                others.append((o, s2, r2))
        local_ok = bool(others) and all(not s for _, s, _ in others)
        fixes = [(w, k) for w, k in done_work(pack, [aid, feed]) if k >= first]
        fix = fixes[0] if fixes else None
        fixed = False
        if fix:
            k1 = fix[1] + pack.steps(p['quiet_min'])
            fixed = k1 <= now and not [k for k in stops if k > fix[1]] and min(r[fix[1] + 1:k1 + 1]) > p['run_frac'] * normal
        level = 'high' if fixed else ('medium' if g_ok else 'low')
        end_k = fix[1] if fix else now
        short_l = sum(max(0, normal - r[k]) * pack.step_min / 60 for k in range(first, end_k + 1))
        catch = [k for k in range(end_k, pack.n) if r[k] > p['catchup_frac'] * normal]
        caught_l = sum((r[k] - normal) * pack.step_min / 60 for k in catch)
        behind = [0.0] * pack.n
        acc = 0.0
        for k in range(pack.n):
            acc += (normal - r[k]) * pack.step_min / 60 if k >= first else 0.0
            behind[k] = acc
        w1 = [ts[max(0, first - 6)], ts[now]]
        rd = [0, nice_domain(r)[1]]

        checks = [
            check('repeat', f'{len(stops)} short stops', 'required', MATCH,
                  f'At {join_names([ts[k] for k in stops])}; {num(p["min_events"], 0)} within an hour by {ts[i]}, when flagged.',
                  'A pump that stops once is a blip. One that stops every 20–30 minutes has something wearing or '
                  'slipping.',
                  spark(r, rd, window=w1)),
            check('restart', 'Each time it restarted by itself', 'required', MATCH,
                  f'Every stop lasted one interval, back to about {num(normal, 1)} L/h the next. Gaps between stops: '
                  f'{join_names([dur(g) for g in gaps])}.',
                  'Short, self-clearing stops on a flow alarm point at the pump\'s delivery, not at a supply that ran out.',
                  None),
            check('local', 'Only this pump', 'supporting', MATCH if local_ok else NO_MATCH,
                  (f'{join_names([short(pack, o) for o, _, _ in others])}, on the same feed medium: no stops.' if others
                   else 'No other running feed pump to compare with.'),
                  'Pumps on the same medium share its supply. Only this one stopped, so the medium isn\'t the cause.',
                  spark(others[0][2], rd, window=w1) if others else None),
            check('glucose', 'Glucose dipping', 'supporting', MATCH if g_ok else NO_MATCH,
                  (f'{num(g0, 2)} g/L before the first stop, lowest {num(glu[gmin_k], 2)} g/L at {ts[gmin_k]}; '
                   f'{num(glu[now], 2)} g/L now.' if glu else 'No glucose found.'),
                  'A separate measurement. Less feed means less sugar for the cells; glucose steps down after each stop.',
                  spark(glu, nice_domain(glu), window=w1) if glu else None),
            check('counter', 'The pump\'s alarm counter agrees', 'supporting', MATCH if c_ok else NO_MATCH,
                  (f'Interruptions in the last hour peaked at {num(max(cnt), 0)}.' if cnt else 'No counter.'),
                  'The pump logs each flow-alarm stop. Its count matches what the rate shows.',
                  spark(cnt, [0, 5], threshold_value=p['min_events'] - 0.5, window=w1) if cnt else None),
            check('fixed', 'No stops since the repair', 'supporting', MATCH if fixed else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" done at {wtime(fix[0])}; no stops since ({dur(pack.minutes_between(fix[1], now))}).'
                   if fixed else 'No repair recorded yet.' if fix is None else f'Repaired at {ts[fix[1]]}, not yet '
                   f'{dur(p["quiet_min"])} clean.'),
                  'Stops every 20–30 minutes before, none after: the part that was changed was the cause.',
                  spark(r, rd, highlight=[ts[fix[1]], ts[now]] if fix else None, window=w1)),
        ]
        main = chart('L/h', rd, [series('rate', f'{uname} feed pump', r, 'primary', 1),
                                 series('normal', 'Recipe rate', [normal] * pack.n, 'expected', 1)],
                     title='What we see', decimals=0,
                     caption=f'{uname} feed pump rate. Each dip to zero is one stop on the flow alarm, restarted '
                             f'automatically.' + (f' The higher rate after {ts[fix[1]]} is the catch-up.' if catch and fix else ''),
                     markers=[marker(ts[k], f'{n + 1}') for n, k in enumerate(stops)]
                     + ([marker(ts[fix[1]], 'Repair done')] if fix else []))
        grid = hours_grid(4, 1 / 12)
        rr = Rng(2909)
        at = lambda hh, times: any(abs(hh - t) < 1 / 24 for t in times)
        tb_t = [0, 0.42, 0.75, 1.17, 1.67, 2.08, 2.5, 2.83]
        tb = [(0 if at(hh, tb_t) else 32) + rr.gauss(0.3) for hh in grid]
        ea = [(0 if at(hh, [0, 1.5]) else 32) + rr.gauss(0.3) for hh in grid]
        la = [(0 if 0.5 <= hh < 1.25 else 32) + rr.gauss(0.3) for hh in grid]
        live = f'{uname}, today'
        lv = aligned(r, first, pack.step_min, grid)
        mk = lambda a: [ref_chart('Feed pump rate (h from the first stop)', 'L/h', [0, 45], grid, 'h', a, lv, live, 0)]
        refs = [
            reference('tubing', 'textbook', 'Textbook', 'Worn peristaltic tubing',
                      'The tubing loses its spring, delivery falls off, the flow alarm stops the pump for a moment and it '
                      'restarts. Stops come every 20–30 minutes until the tubing is changed.', 'match', 'Closest match',
                      ['Same one-interval stops', 'Stopped after the tubing change' if fixed else 'Same spacing'], mk(tb)),
            reference('few', 'early', 'Early stage', 'A few stops a shift',
                      'Once or twice a shift. Easy to ignore; a daily count of flow-alarm stops catches it.',
                      'partial', 'Where it started', ['Worth trending the counter'], mk(ea)),
            reference('supply', 'lookalike', 'Look-alike', 'Feed bag empty or line blocked',
                      'One long stop until someone changes the bag or clears the line; other pumps on the same supply '
                      'may stop too.', 'nomatch', 'Doesn\'t match',
                      ['Here every stop was one interval', 'Other feed pumps ran on' if local_ok else 'Check the other pumps'],
                      mk(la)),
        ]
        ro = [
            ruled_out('Feed medium supply', 'ruled out' if local_ok else 'not yet checked',
                      f'{join_names([short(pack, o) for o, _, _ in others])} ran without a stop.' if others else ''),
            ruled_out('A false flow alarm (instrument only)', 'ruled out' if g_ok else 'unlikely',
                      f'Glucose fell from {num(g0, 2)} to {num(glu[gmin_k], 2)} g/L: the feed really wasn\'t delivered.'
                      if glu else ''),
            ruled_out('Recipe or controller change', 'ruled out',
                      f'Between stops the pump ran at its usual {num(normal, 1)} L/h.'),
        ]
        return {
            'conclusion': conclusion('Cause' if fixed else 'Most likely cause',
                                     f'Wear in the {uname} feed pump; the stops ended with "{fix[0]["text"]}"' if fixed else
                                     f'Wear in the {uname} feed pump (tubing or head)', level,
                                     'Confirmed: no stops since the repair' if fixed else 'Glucose confirms feed was missed'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Stops on this pump only, glucose fell with them, and none since the repair.' if fixed
                                     else 'Stops on this pump only, and glucose fell with them.',
                                     None if fixed else 'The pump hasn\'t been inspected yet.',
                                     None if fixed else 'No stops after the tubing is changed.',
                                     'Stops continue on new tubing. Then check the pump head and the flow sensor.',
                                     'No stops after the repair' if fixed else None),
            'action': action(item, pack),
            'impact': (f'About {num(short_l, 0)} L of feed missed against recipe up to {ts[end_k]}'
                       + (f'; the catch-up at {num(max(r[k] for k in catch), 1)} L/h added back about {num(caught_l, 0)} L.'
                          if catch else '.')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 10. Viability falling faster than its trend — archetype 13 (quality drift)
# ═════════════════════════════════════════════════════════════════════════
class ViabilityDecline(Detector):
    id = 'pharma.viability_decline'
    name = 'Viability falling faster than its trend'
    archetype = '13 Quality drift'
    applies_to = 'bioreactors'
    summary = ('A culture\'s viability falling below the trend it was on at the start of the shift, and faster, '
               'heading for the harvest criterion earlier than planned, while titer still rises.')
    pipeline = [
        ('Trend', 'straight line through viability over the first 90 minutes of the shift, carried forward'),
        ('Below it', 'actual below that trend, and falling faster than it'),
        ('Clock', 'when the harvest criterion (70 %) is reached at the recent rate'),
        ('Independent', 'O₂ demand from the DO loop (fewer live cells use less oxygen); VCD; titer'),
        ('Conclusion', 'a faster decline that the headline titer hides; the cause needs offline samples'),
    ]
    definition = {
        'appliesTo': {'assetType': ['production_bioreactor', 'seed_bioreactor']},
        'inputs': {'via': 'self.viability_pct', 'vcd': 'self.vcd_e6_ml or seed_vcd_e6_ml', 'titer': 'self.titer_g_l',
                   'o2': 'child gas_control_module.o2_flow_slpm', 'temp': 'child temperature_control_module.culture_temp_c',
                   'glucose': 'child feed_module.glucose_g_l', 'osm': 'self.osmolality_mosm_kg',
                   'speed': 'child agitation_module.agitator_speed_rpm'},
        'expected': {'model': 'own trend', 'target': 'via', 'formula': 'linear fit over the first base_min, extrapolated'},
        'params': {'min_via_pct': 50, 'base_min': 90, 'gap_pts': 1.0, 'sustain_min': 30, 'slope_window_min': 120,
                   'min_decline_pts_h': 0.5, 'accel_ratio': 1.5, 'harvest_min_pct': 70, 'horizon_h': 24,
                   'o2_drop_pct': 3.0, 'glucose_low_g_l': 1.0, 'osm_high': 400},
        'checks': [
            {'id': 'below', 'role': 'required', 'rule': 'trend − viability > gap_pts for sustain_min'},
            {'id': 'faster', 'role': 'required', 'rule': 'decline over slope_window_min > min_decline_pts_h and > accel_ratio × trend decline'},
            {'id': 'criterion', 'role': 'required', 'rule': 'harvest_min_pct reached within horizon_h at the recent rate'},
            {'id': 'o2', 'role': 'supporting', 'independent': True, 'rule': 'O₂ sparge down > o2_drop_pct (last hour vs first hour)'},
            {'id': 'vcd', 'role': 'supporting', 'rule': 'VCD falling'},
            {'id': 'titer', 'role': 'supporting', 'rule': 'titer still rising (the headline looks healthy)'},
        ],
        'confidence': {'low': 'required checks only', 'medium': 'O₂ demand agrees (independent)',
                       'high': 'offline viability samples confirm the rate'},
    }

    def candidates(self, pack):
        return pack.of_type('production_bioreactor', 'seed_bioreactor')

    def _ctx(self, pack, aid):
        p = self.p
        via = pack.series(aid, 'viability_pct')
        if min(via) < p['min_via_pct']:
            return None
        nb = pack.steps(p['base_min'])
        b, a, _ = linfit(list(range(nb)), via[:nb])
        trend = [a + b * k for k in range(pack.n)]
        gap = [t - v for t, v in zip(trend, via)]
        return dict(via=via, trend=trend, gap=gap, tslope=b * 60 / pack.step_min, nb=nb)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        hi = B.gt(c['gap'], p['gap_pts'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(c['nb'], pack.n):
            s0 = B.sustained_since(hi, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            sl = B.slope_per_hour(c['via'], i, sw, pack.step_min)
            if sl is None or -sl <= p['min_decline_pts_h'] or -sl <= p['accel_ratio'] * max(0.0, -c['tslope']):
                continue
            hrs = (c['via'][i] - p['harvest_min_pct']) / -sl
            if hrs > p['horizon_h']:
                continue
            c.update(alert=s0)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        name = pack.name(aid)
        via, trend, gap, tslope, nb = c['via'], c['trend'], c['gap'], c['tslope'], c['nb']
        sl = B.slope_per_hour(via, now, pack.steps(p['slope_window_min']), pack.step_min)
        hrs = (via[now] - p['harvest_min_pct']) / -sl if sl < 0 else None
        eta = tmin(pack, now) + hrs * 60 if hrs else None
        h = pack.steps(60)
        gas = pack.child_of_type(aid, 'gas_control_module')
        o2 = pack.series(gas, 'o2_flow_slpm') if gas else None
        o0, o1 = (median(o2[:h]), mean_between(o2, now - h + 1, now)) if o2 else (None, None)
        o_pct = 100 * (o1 / o0 - 1) if o2 else None
        o2_ok = o2 is not None and o_pct < -p['o2_drop_pct']
        vkey = 'vcd_e6_ml' if pack.has(aid, 'vcd_e6_ml') else 'seed_vcd_e6_ml'
        vcd = pack.series(aid, vkey)
        vc0, vc1 = median(vcd[:h]), mean_between(vcd, now - h + 1, now)
        vcd_ok = vc1 < vc0
        tit = pack.series(aid, 'titer_g_l') if pack.has(aid, 'titer_g_l') else None
        t_ok = tit is not None and tit[now] > tit[0]
        pm = pack.series(aid, 'product_mass_kg') if pack.has(aid, 'product_mass_kg') else None
        tm = pack.child_of_type(aid, 'temperature_control_module')
        temp = pack.series(tm, 'culture_temp_c') if tm else None
        fm = pack.child_of_type(aid, 'feed_module')
        glu = pack.series(fm, 'glucose_g_l') if fm else None
        osm = pack.series(aid, 'osmolality_mosm_kg') if pack.has(aid, 'osmolality_mosm_kg') else None
        ag = pack.child_of_type(aid, 'agitation_module')
        spd = pack.series(ag, 'agitator_speed_rpm') if ag else None
        agv = pack.series(ag, 'gearbox_vibration_mms') if ag else None
        pco2p = pack.descendant_of_type(aid, 'pco2_probe')
        pco2 = pack.series(pco2p, 'pco2_mmhg') if pco2p else None
        level = 'medium' if o2_ok else 'low'
        fc_now = trend[now]
        vd = nice_domain(via, trend, [p['harvest_min_pct']], pad=0.05)

        checks = [
            check('below', 'Below the trend it was on', 'required', MATCH,
                  f'{num(via[now], 1)} % now; the morning trend puts it at {num(fc_now, 1)} % '
                  f'({signed(-gap[now], 1)} points). More than {num(p["gap_pts"], 0)} point below since {ts[c["alert"]]}.',
                  'Late in a batch viability falls slowly and steadily. Falling away from that line means the cells are '
                  'dying faster than the process expects.',
                  spark(via, vd, trend, trend)),
            check('faster', 'Falling faster', 'required', MATCH,
                  f'{signed(sl, 2)} points per hour over the last {dur(p["slope_window_min"])}, against '
                  f'{signed(tslope, 2)} per hour in the first {dur(p["base_min"])}.',
                  'A rate that keeps growing leaves less time than the planned harvest assumes.',
                  spark(gap, nice_domain(gap, [0]), threshold_value=p['gap_pts'])),
            check('criterion', f'Reaches {num(p["harvest_min_pct"], 0)} % in about {dur(hrs * 60)}', 'required', MATCH,
                  f'At {signed(sl, 2)} points per hour, {name} reaches the {num(p["harvest_min_pct"], 0)} % harvest criterion '
                  f'around {clock(eta)}.',
                  'Below the criterion, harvest brings more host-cell protein, DNA and proteases, and the clarification '
                  'gets harder.', None),
            check('o2', 'Using less oxygen', 'supporting', MATCH if o2_ok else NO_MATCH,
                  (f'O₂ sparge {num(o0, 1)} → {num(o1, 1)} slpm ({signed(o_pct, 1)} %), first hour against last hour.' if o2
                   else 'No O₂ flow found.'),
                  'A separate measurement: the DO loop adds just enough oxygen for the live cells. Fewer live cells, '
                  'less oxygen.',
                  spark(o2, nice_domain(o2)) if o2 else None),
            check('vcd', 'Viable cells falling', 'supporting', MATCH if vcd_ok else NO_MATCH,
                  f'VCD {num(vc0, 2)} → {num(vc1, 2)} ×10⁶/mL.',
                  'Same cell count as viability, so not independent, but it shows live cells are being lost, not only '
                  'dead ones added.',
                  spark(vcd, nice_domain(vcd))),
            check('titer', 'Titer still looks healthy', 'supporting', MATCH if t_ok else NO_MATCH,
                  (f'Titer {num(tit[0], 2)} → {num(tit[now], 2)} g/L'
                   + (f'; product in the vessel {num(pm[0], 1)} → {num(pm[now], 1)} kg.' if pm else '.') if tit else 'No titer.'),
                  'Product already made stays in the broth, so titer keeps rising while the cells decline. The headline '
                  'number hides the problem.',
                  spark(tit, nice_domain(tit)) if tit else None),
        ]
        main = chart('%', vd, [series('via', f'{name} viability', via, 'primary', 1),
                               series('trend', 'Trend at the start of the shift', trend, 'expected', 1)],
                     title='What we see', decimals=0, shade_gap=['trend', 'via'],
                     caption=f'{name} viability against the straight-line trend it was on over the first '
                             f'{dur(p["base_min"])}. The shaded gap is the extra decline.',
                     thresholds=[threshold(p['harvest_min_pct'], 'Harvest criterion')],
                     markers=[marker(ts[c['alert']], f'{num(p["gap_pts"], 0)} point below trend')])
        grid = hours_grid(12, 0.5)
        r = Rng(3010)
        v0 = via[0]
        tb = [v0 - 0.4 * hh - 0.06 * hh * hh + r.gauss(0.15) for hh in grid]
        ea = [v0 - 0.4 * hh + r.gauss(0.15) for hh in grid]
        la = [v0 - 0.4 * hh - (0 if hh < 2 else 3) + r.gauss(0.15) for hh in grid]
        live = f'{name}, today'
        lv = aligned(via, 0, pack.step_min, grid)
        mk = lambda a: [ref_chart('Viability (h from shift start)', '%', [60, 90], grid, 'h', a, lv, live, 0,
                                  [threshold(p['harvest_min_pct'], 'Criterion')])]
        refs = [
            reference('accel', 'textbook', 'Textbook', 'Late-culture decline speeding up',
                      'The decline accelerates over a shift as the culture runs out of steam; O₂ demand and VCD follow. '
                      'The batch is harvested early, at or just above the criterion.', 'match', 'Closest match',
                      ['Same curve away from the trend', 'O₂ demand falling with it' if o2_ok else 'Same shape'], mk(tb)),
            reference('plan', 'early', 'As planned', 'Steady late-culture decline',
                      'Viability loses a few tenths of a point an hour and reaches the criterion after the planned harvest.',
                      'nomatch', 'Where it should be', [f'The trend line on the chart', f'Today {signed(sl, 2)} points per hour'],
                      mk(ea)),
            reference('count', 'lookalike', 'Look-alike', 'Cell counter or sampling error',
                      'One low count, then back on the line. O₂ demand doesn\'t move.', 'nomatch', 'Doesn\'t match',
                      ['Here the decline is smooth over hours', 'O₂ demand fell too' if o2_ok else 'Needs a repeat sample'],
                      mk(la)),
        ]
        ro = [
            ruled_out('Sampling or counter error', 'ruled out' if o2_ok else 'unlikely',
                      'The decline is smooth over hours, and O₂ demand, a separate measurement, fell with it.' if o2_ok
                      else 'The decline is smooth over hours.'),
            ruled_out('Temperature excursion', 'ruled out' if temp else 'not yet checked',
                      f'Vessel temperature {num(min(temp), 2)}–{num(max(temp), 2)} °C all shift.' if temp else ''),
            ruled_out('Nutrient starvation', 'ruled out' if glu and min(glu) > p['glucose_low_g_l'] else 'not yet checked',
                      f'Glucose {num(min(glu), 2)}–{num(max(glu), 2)} g/L, well above depletion.' if glu else ''),
            ruled_out('Osmolality or CO₂ stress', 'unlikely',
                      (f'Osmolality {num(min(osm), 0)}–{num(max(osm), 0)} mOsm/kg' if osm else '')
                      + (f' and pCO₂ {num(min(pco2), 0)}–{num(max(pco2), 0)} mmHg' if pco2 else '')
                      + '. Both steady all day, so they don\'t explain today\'s acceleration'
                      + (f', though osmolality near {num(p["osm_high"], 0)} slows cells in general.' if osm and max(osm) >= p['osm_high'] - 10 else '.')),
            ruled_out('More shear from the agitator', 'not yet checked',
                      (f'Agitator speed unchanged ({num(min(spd), 1)}–{num(max(spd), 1)} rpm), so mixing shear is the same. '
                       f'The drive\'s vibration rose today ({num(agv[0], 1)} → {num(agv[now], 1)} mm/s); a link is possible '
                       f'but not shown by this data.' if spd and agv else '')),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'{name} culture declining faster than planned; on this course it reaches the harvest '
                                     f'criterion around {clock(eta)}', level,
                                     'Viability and O₂ demand agree' if o2_ok else 'Viability only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Viability left its trend smoothly over hours and O₂ demand, measured separately, fell with '
                                     'it.' if o2_ok else 'Viability left its trend smoothly over hours.',
                                     'The rate is from online data. An extra offline viability sample is needed before '
                                     'moving a harvest.',
                                     'The 16:00 offline sample confirms the rate.',
                                     'The offline sample is back on trend. Then check the online viability calibration.'),
            'action': action(item, pack),
            'model': {'target': 'viability_pct', 'formula': f'{num(trend[0], 2)} {signed(tslope, 3)} × hours since 08:00',
                      'fittedOn': f'{name}\'s own first {dur(p["base_min"])}'},
            'impact': (f'Reaches {num(p["harvest_min_pct"], 0)} % around {clock(eta)}, {dur(hrs * 60)} from now.'
                       + (f' Titer is still rising ({num(tit[now], 2)} g/L), so the choice is yield against '
                          f'harvest quality.' if tit else '')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 11. Seed transfer window against vessel readiness — archetype 14 (plan at risk)
# ═════════════════════════════════════════════════════════════════════════
class SeedTransferWindow(Detector):
    id = 'pharma.seed_transfer_window'
    name = 'Seed will pass its transfer limit before the vessel is ready'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'seed bioreactors'
    summary = ('A healthy seed culture growing toward its transfer VCD limit while the empty production bioreactor '
               'it feeds still has its post-SIP turnaround to do. Time needed against time left.')
    pipeline = [
        ('Growth clock', 'exponential fit of seed VCD over the day → when it reaches the transfer limit'),
        ('Destination', 'the empty production bioreactor it feeds on the process-flow layer'),
        ('Readiness', 'its SIP result from the data, plus the standard post-SIP steps'),
        ('Compare', 'ready time against the time the seed reaches its limit'),
        ('Conclusion', 'a decision with a deadline, not a diagnosis'),
    ]
    definition = {
        'appliesTo': {'assetType': 'seed_bioreactor'},
        'inputs': {'vcd': 'self.seed_vcd_e6_ml', 'limit': 'self.transfer_vcd_max_e6_ml (static)',
                   'via': 'self.viability_pct',
                   'dest': 'targets[process_flow] production_bioreactor with working_volume_l = 0',
                   'sip': 'dest temperature_control_module: drain_temp_c, jacket_inlet_temp_c',
                   'medium': 'sources[media] of dest: open QUALITY_RELEASE work items'},
        'params': {'min_fit_min': 120, 'r2_min': 0.95, 'hold_c': 121.1, 'hold_min': 30, 'cool_jacket_c': 30,
                   'pressure_hold_min': 60, 'cool_fill_min': 180, 'qa_release_min': 30, 'equilibration_min': 120,
                   'viability_min_pct': 90, 'limit_default': 6.0},
        'checks': [
            {'id': 'clock', 'role': 'required', 'rule': 'exponential fit (r² ≥ r2_min) reaches the limit at t_limit'},
            {'id': 'ready', 'role': 'required', 'rule': 'destination SIP passed (drain ≥ hold_c for hold_min, then jacket < cool_jacket_c); ready = SIP done + standard steps'},
            {'id': 'short', 'role': 'required', 'rule': 'ready > t_limit'},
            {'id': 'healthy', 'role': 'supporting', 'rule': 'seed viability > viability_min_pct'},
            {'id': 'medium', 'role': 'supporting', 'rule': 'medium release for the fill still open'},
        ],
        'confidence': {'n/a': 'a schedule clash, not a diagnosis'},
    }

    def candidates(self, pack):
        return pack.of_type('seed_bioreactor')

    def _sip_done(self, pack, dest, i):
        p = self.p
        tm = pack.child_of_type(dest, 'temperature_control_module')
        if not tm:
            return None
        drain, jacket = pack.series(tm, 'drain_temp_c'), pack.series(tm, 'jacket_inlet_temp_c')
        ok = [d >= p['hold_c'] for d in drain]
        for k in range(i + 1):
            s0 = B.sustained_since(ok, k)
            if s0 is None or pack.minutes_between(s0, k) < p['hold_min']:
                continue
            e = k
            while e + 1 <= i and ok[e + 1]:
                e += 1
            done = next((j for j in range(e + 1, i + 1) if jacket[j] < p['cool_jacket_c']), None)
            if done is not None:
                return dict(hold0=s0, hold1=e, done=done, drain=drain, tm=tm)
        return None

    def _turnaround(self):
        p = self.p
        return p['pressure_hold_min'] + p['cool_fill_min'] + p['qa_release_min'] + p['equilibration_min']

    def evaluate(self, pack, aid):
        p = self.p
        vcd = pack.series(aid, 'seed_vcd_e6_ml')
        limit = pack.values.get(aid, {}).get('transfer_vcd_max_e6_ml', p['limit_default'])
        dests = [t for t in pack.targets(aid, 'process_flow') if pack.asset(t)['assetType'] == 'production_bioreactor']
        for i in range(pack.steps(p['min_fit_min']), pack.n):
            xs = [tmin(pack, k) for k in range(i + 1)]
            b, a, r2 = linfit(xs, [math.log(v) for v in vcd[:i + 1]])
            if b <= 0 or r2 < p['r2_min'] or vcd[i] >= limit:
                continue
            t_lim = (math.log(limit) - a) / b
            for d in dests:
                if pack.series(d, 'working_volume_l')[i] > 0:
                    continue
                sip = self._sip_done(pack, d, i)
                if sip is None:
                    continue
                ready = tmin(pack, sip['done']) + self._turnaround()
                if ready > t_lim:
                    return Finding(aid, True, i, vcd=vcd, limit=limit, dest=d, sip=sip)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        name = pack.name(aid)
        vcd, limit, dest, sip = c['vcd'], c['limit'], c['dest'], c['sip']
        dname = pack.name(dest)
        xs = [tmin(pack, k) for k in range(now + 1)]
        b, a, r2 = linfit(xs, [math.log(v) for v in vcd[:now + 1]])
        t_lim = (math.log(limit) - a) / b
        dbl_h = math.log(2) / b / 60
        sip = self._sip_done(pack, dest, now) or sip
        steps_ = [('pressure hold', p['pressure_hold_min']), ('cool and medium fill', p['cool_fill_min']),
                  ('QA release', p['qa_release_min']), ('equilibration', p['equilibration_min'])]
        ready = tmin(pack, sip['done']) + self._turnaround()
        t_now = tmin(pack, now)
        needed, left = ready - t_now, t_lim - t_now
        gap = ready - t_lim
        via = pack.series(aid, 'viability_pct')
        h_ok = min(via) > p['viability_min_pct']
        at_ready = math.exp(a + b * ready)
        media = [s for s in pack.sources(dest, 'media')]
        rel = open_work(pack, media, ['QUALITY_RELEASE'])
        med_ok = bool(rel)
        fit = [math.exp(a + b * tmin(pack, k)) for k in range(pack.n)]
        yd = nice_domain(vcd, [limit], pad=0.1)
        drain = sip['drain']

        checks = [
            check('clock', f'{name} reaches {num(limit, 1)} ×10⁶/mL around {clock(t_lim)}', 'required', MATCH,
                  f'VCD {num(vcd[0], 2)} → {num(vcd[now], 2)} ×10⁶/mL today, doubling about every {num(dbl_h, 1)} h '
                  f'(fit r² {num(r2, 3)}). {dur(left)} left.',
                  'Seed cells grow exponentially until they are transferred. Past the limit they run short of '
                  'nutrients and the production batch starts from a stressed seed.',
                  spark(vcd, yd, fit, fit, threshold_value=limit)),
            check('ready', f'{dname} ready around {clock(ready)}', 'required', MATCH,
                  f'SIP hold passed {ts[sip["hold0"]]}–{ts[sip["hold1"]]}, cooled by {ts[sip["done"]]}. Still to do: '
                  + ', '.join(f'{s} {dur(m)}' for s, m in steps_) + f'. {dur(needed)} needed.',
                  f'{dname} is the empty vessel {name} feeds on the process-flow layer. It can\'t take the seed until '
                  f'every step is done and released.',
                  spark(drain, [0, 130], threshold_value=p['hold_c'], highlight=[ts[sip['hold0']], ts[sip['done']]])),
            check('short', f'Short by about {dur(gap)}', 'required', MATCH,
                  f'Time needed {dur(needed)}, time left {dur(left)}. At {clock(ready)} the seed would be at about '
                  f'{num(at_ready, 2)} ×10⁶/mL.',
                  'Without a change, the seed passes its limit before the vessel can take it.', None),
            check('healthy', 'Seed healthy', 'supporting', MATCH if h_ok else NO_MATCH,
                  f'Viability {num(min(via), 1)}–{num(max(via), 1)} % today.',
                  'The problem is the schedule, not the culture. A healthy seed can be slowed down (lower temperature) '
                  'within the approved contingency.',
                  spark(via, [80, 100], threshold_value=p['viability_min_pct'])),
            check('medium', 'Medium for the fill not released yet', 'supporting', MATCH if med_ok else NO_MATCH,
                  (f'"{rel[0]["text"]}" due {rel[0]["dueAt"][11:16]}, not done.' if rel else 'No open medium release.'),
                  'The fill can\'t start until QA releases the medium, so it can\'t be pulled forward past that.', None),
        ]
        main = chart('×10⁶/mL', yd, [series('vcd', f'{name} VCD', vcd, 'primary', 2),
                                     series('fit', 'Exponential fit', fit, 'expected', 2)],
                     title='What we see', decimals=1,
                     caption=f'{name} viable cell density against its exponential fit. At this rate it reaches the '
                             f'{num(limit, 1)} ×10⁶/mL transfer limit around {clock(t_lim)}; {dname} is ready around '
                             f'{clock(ready)}.',
                     thresholds=[threshold(limit, 'Transfer limit')],
                     markers=[marker(ts[sip['done']], f'{dname} SIP done' + (' · flagged' if i == sip['done'] else ''))]
                     + ([marker(ts[i], 'Flagged')] if i != sip['done'] else []))
        grid = minutes_grid(-600, 120, 15)
        lv = []
        for m in grid:
            tt = t_lim + m
            k = (tt - tmin(pack, 0)) / pack.step_min
            lv.append(vcd[int(round(k))] if 0 <= round(k) <= now else None)   # nearest 5-min sample
        grow = lambda m, rate: limit * math.exp(rate * m / 60)
        on = [grow(m, math.log(2) / dbl_h) for m in grid]
        held = [grow(m, math.log(2) / dbl_h) if m < -240 else grow(-240, math.log(2) / dbl_h) * math.exp(math.log(2) / (dbl_h * 2.5) * (m + 240) / 60) for m in grid]
        early = [grow(m + 120, math.log(2) / dbl_h) for m in grid]
        live = 'Today'
        mk = lambda a_: [ref_chart('Seed VCD (min from reaching the limit)', '×10⁶/mL', [3, 8], grid, 'min', a_, lv, live, 1,
                                   [threshold(limit, 'Limit')])]
        refs = [
            reference('hold', 'textbook', 'Textbook', 'Seed held at a lower temperature',
                      'The approved contingency: drop the seed a few degrees to slow growth, buying the hours the vessel '
                      'needs. Decided early, it keeps the batch inside its transfer window.', 'partial',
                      'The usual fix', [f'Needs about {dur(gap)} of slower growth', 'Decide while there is time'], mk(held)),
            reference('miss', 'variant', 'What to avoid', 'Transfer past the limit',
                      'Nobody decides; the seed passes the limit and the batch starts from an overgrown culture, or the '
                      'production slot is lost.', 'nomatch', 'Where today is heading', ['Without a change'], mk(on)),
            reference('early', 'lookalike', 'Look-alike', 'Seed ahead of plan but vessel on time',
                      'The seed runs fast, but the vessel\'s turnaround is on schedule and the transfer happens a little '
                      'early. Nothing to decide.', 'nomatch', 'Not today',
                      [f'Today {dname} needs {dur(needed)} and there is {dur(left)}'], mk(early)),
        ]
        return {
            'conclusion': conclusion('What\'s needed',
                                     f'A decision to close a {dur(gap)} gap: slow {name}\'s growth or shorten {dname}\'s '
                                     f'turnaround, before the seed reaches {num(limit, 1)} ×10⁶/mL around {clock(t_lim)}',
                                     'n/a', 'A schedule clash, not a diagnosis'),
            'rootCauseAssetId': dest,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': [], 'excluded': None,
            'confidence': confidence('n/a', 'The growth clock is read from the seed\'s own VCD and the readiness from '
                                            f'{dname}\'s SIP record plus standard step times. It is arithmetic, not a '
                                            'diagnosis; the step times are the planning values, not a forecast.'),
            'action': action(item, pack),
            'impact': f'Short by about {dur(gap)}. The step times ({dur(self._turnaround())} after SIP) are standard values; '
                      f'any step done in parallel shortens the gap.',
        }


DETECTORS = [AgitatorDriveWear(), DoProbeFault(), SipColdPoint(), SkidFilterStop(), ProteinACapacityLoss(),
             AhuFanTripCascade(), Pco2Accumulation(), StillEfficiencyDrift(), FeedPumpMicroStops(), ViabilityDecline(),
             SeedTransferWindow()]


def main():
    pack, out, report, path = run_pack(REPO, 'pharma', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
