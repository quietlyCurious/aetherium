#!/usr/bin/env python3
"""Halcyon Point (combined cycle) — detectors and explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every ccgt detector on every asset it applies to, using only the
pack's runtime files in public/data/ccgt/, and writes
public/data/ccgt/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus
each detector's definition and where it fired today.

    python3 ModelAndData/industries/ccgt/generate.py     # the data
    python3 ModelAndData/industries/ccgt/explain.py      # the explanations

Detectors never read generate.py's scenario constants. If a detector
misses a scenario, or fires where no attention item exists, the run report
says so and the exit code is 1 for a miss.

Most ccgt equipment comes in pairs (two CTGs, two HRSGs, one running BFP
per HRSG), so "expected" here usually means "what the sister unit does at
the same time", not a fleet regression as on a wind farm.

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
                           check, dur, marker, nice_domain, num, reference, ruled_out, run_pack, print_report,
                           series, spark, threshold)
from detectors.build import signed as _signed    # noqa: E402


# ── Small helpers (same shape as wind/explain.py) ───────────────────────
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


# ── ccgt-specific helpers ────────────────────────────────────────────────
def short(pack, aid):
    """'HRSG-2 BFP-A' style name: the unit plus the asset's own name."""
    u = pack.unit_of(aid)
    if u is None or u == aid:
        return pack.name(aid)
    return f'{pack.name(u)} {pack.name(aid)}'


def targets(pack, aid, layer):
    return [e['targetAssetId'] for e in pack.relationships
            if e['sourceAssetId'] == aid and e['layer'] == layer]


def idx_at(pack, iso):
    """Grid index of an ISO time (first grid point at or after it), or None."""
    if not iso:
        return None
    hm = iso[11:16]
    for k, t in enumerate(pack.ts):
        if t >= hm:
            return k
    return None


def done_work(pack, aids, types=None):
    """Done work items on any of these assets: [(item, index of completion)]."""
    out = []
    for w in pack.work:
        if w['assetId'] in aids and w.get('done') and (types is None or w['workType'] in types):
            k = idx_at(pack, w.get('completedAt'))
            if k is not None:
                out.append((w, k))
    return out


def open_work(pack, aids, types=None):
    return [w for w in pack.work if w['assetId'] in aids and not w.get('done')
            and (types is None or w['workType'] in types)]


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
    sy = math.sqrt(sum((y - my) ** 2 for _, y in pts))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in pts) / (sx * sy)


def diffs(v):
    return [None] + [None if a is None or b is None else b - a for a, b in zip(v, v[1:])]


def psat_inhga(t_f):
    """Water saturation pressure (Antoine), °F → inHgA."""
    tc = (t_f - 32) / 1.8
    return 10 ** (8.07131 - 1730.63 / (233.426 + tc)) / 25.4


def tsat_f(p_inhga):
    tc = 1730.63 / (8.07131 - math.log10(p_inhga * 25.4)) - 233.426
    return tc * 1.8 + 32


def pct(v, ref):
    return None if v is None or not ref else 100.0 * v / ref


def signed(v, decimals=1):          # noqa: F811 — the toolkit's, without a '−0.0'
    return _signed(None if v is None else round(v, decimals) + 0.0, decimals)


def running(pack, flow_aid, key, min_value, minutes=60):
    return B.running_mask(pack.series(flow_aid, key), min_value, pack.steps(minutes))


# ═════════════════════════════════════════════════════════════════════════
# 1. BFP bearing wear — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class BfpBearingWear(Detector):
    id = 'ccgt.bfp_bearing_wear'
    name = 'Feed pump bearing wear'
    archetype = '05 Component degradation'
    applies_to = 'pump bearing sets'
    summary = ('A running boiler feed pump\'s bearings getting steadily hotter than its sister pump\'s at the same '
               'flow, with vibration rising alongside.')
    pipeline = [
        ('Find peers', 'the other boiler feed pumps that are running (flow above 200 gpm for 60 min); standby pumps '
                       'don\'t count'),
        ('Expected value', 'the running sister pump\'s bearing temperature, plus the steady offset between the two '
                           'pumps learned over the first hour of the day'),
        ('Residual', 'actual − expected: heat the sister pump, and so flow and weather, don\'t explain'),
        ('Checks', 'hotter · rising steadily · sustained · vibration · same flow · motor normal'),
        ('Conclusion', 'all required checks → raise; vibration (a separate sensor) → medium confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'pump_bearings'},
        'inputs': {'temp': 'self.pump_bearing_temp_f', 'vib': 'self.pump_vibration_ips',
                   'flow': 'parent[boiler_feed_pump].bfp_flow_gpm',
                   'motor': 'sibling[pump_motor].motor_winding_temp_f'},
        'peers': {'same': 'assetType', 'count': 'pump running (bfp_flow_gpm > min_flow_gpm for 60 min)'},
        'expected': {'model': 'sister offset', 'target': 'temp',
                     'formula': 'median(running peers temp) + median(offset over baseline_min)', 'fitOn': 'peers'},
        'params': {'min_flow_gpm': 200, 'baseline_min': 60, 'hot_f': 6.0, 'watch_f': 3.0, 'sustain_min': 30,
                   'slope_window_min': 120, 'min_slope_f_per_h': 2.0, 'max_step_f': 3.0,
                   'vib_alert_ips': 0.18, 'vib_ratio': 1.3, 'flow_match_pct': 5.0, 'motor_band_f': 3.0},
        'checks': [
            {'id': 'hot', 'role': 'required', 'rule': 'residual > hot_f'},
            {'id': 'gradual', 'role': 'required', 'rule': 'slope(residual, slope_window_min) > min_slope_f_per_h and maxStep(temp since onset) < max_step_f'},
            {'id': 'sustained', 'role': 'required', 'rule': 'residual > hot_f for sustain_min'},
            {'id': 'vib', 'role': 'supporting', 'independent': True, 'rule': 'vib > vib_alert_ips and vib > vib_ratio × peer vib'},
            {'id': 'flow', 'role': 'supporting', 'rule': '60-min mean flow within flow_match_pct of the sister pump'},
            {'id': 'motor', 'role': 'supporting', 'rule': 'motor winding temperature within motor_band_f of the sister motor'},
        ],
        'ruleOut': ['higher flow', 'hotter weather', 'faulty sensor', 'motor problem'],
        'confidence': {'low': 'required checks only', 'medium': 'vibration agrees (independent sensor)',
                       'high': 'confirmed by vibration spectrum, oil analysis or inspection'},
        'references': ['textbook: rolling-element wear', 'early stage', 'look-alike: temperature element drift'],
    }

    def candidates(self, pack):
        return pack.of_type('pump_bearings')

    def _run(self, pack, bearing):
        return running(pack, pack.parent(bearing), 'bfp_flow_gpm', self.p['min_flow_gpm'])

    def _ctx(self, pack, aid):
        p = self.p
        peers = [b for b in pack.of_type('pump_bearings') if b != aid]
        runs = {b: self._run(pack, b) for b in peers}
        run = self._run(pack, aid)
        temp = pack.series(aid, 'pump_bearing_temp_f')
        pt = {b: pack.series(b, 'pump_bearing_temp_f') for b in peers}
        peer_med = [median([pt[b][k] for b in peers if runs[b][k]]) for k in range(pack.n)]
        diff = [t - m if (r and m is not None) else None for t, m, r in zip(temp, peer_med, run)]
        base = [d for d in diff[:pack.steps(p['baseline_min'])] if d is not None]
        if len(base) < pack.steps(p['baseline_min']) // 2:
            return None
        offset = statistics.median(base)
        exp = [None if m is None else m + offset for m in peer_med]
        res = [None if d is None else d - offset for d in diff]
        return dict(peers=peers, runs=runs, run=run, temp=temp, exp=exp, res=res, offset=offset)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        res = c['res']
        hot = B.gt(res, p['hot_f'])
        watch = B.gt(res, p['watch_f'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(res, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_f_per_h'] and B.max_step(c['temp'], onset, i) < p['max_step_f']:
                c.update(onset=onset, alert=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        pump = pack.parent(aid)
        pname = short(pack, pump)
        res, temp, exp = c['res'], c['temp'], c['exp']
        onset, alert = c['onset'], c['alert']
        running_peers = [b for b in c['peers'] if c['runs'][b][now]]
        idle = [b for b in c['peers'] if not c['runs'][b][now]]
        sis = running_peers[0]
        sis_pump = pack.parent(sis)
        sname = short(pack, sis_pump)
        slope = B.slope_per_hour(res, now, pack.steps(p['slope_window_min']), pack.step_min)
        step = B.max_step(temp, onset, now)
        vib = pack.series(aid, 'pump_vibration_ips')
        svib = pack.series(sis, 'pump_vibration_ips')
        vib0 = mean_between(vib, onset - pack.steps(60), onset)
        vib_ok = vib[now] > p['vib_alert_ips'] and vib[now] > p['vib_ratio'] * svib[now]
        flow = pack.series(pump, 'bfp_flow_gpm')
        sflow = pack.series(sis_pump, 'bfp_flow_gpm')
        h = pack.steps(60)
        fm, sfm = mean_between(flow, now - h + 1, now), mean_between(sflow, now - h + 1, now)
        flow_ok = abs(fm - sfm) / sfm * 100 < p['flow_match_pct']
        mot = pack.series(pack.child_of_type(pump, 'pump_motor'), 'motor_winding_temp_f')
        smot = pack.series(pack.child_of_type(sis_pump, 'pump_motor'), 'motor_winding_temp_f')
        w30 = pack.steps(30)
        mdiff = mean_between(mot, now - w30 + 1, now) - mean_between(smot, now - w30 + 1, now)
        motor_ok = abs(mdiff) < p['motor_band_f']
        level = 'medium' if vib_ok else 'low'
        amb = pack.series(pack.ancestors(aid)[-1], 'ambient_temp_f') if pack.has(pack.ancestors(aid)[-1], 'ambient_temp_f') else None
        stemp = pack.series(sis, 'pump_bearing_temp_f')
        rd = [-5, 30]

        checks = [
            check('hot', 'Hotter than its sister pump explains', 'required', MATCH,
                  f'{signed(res[now])} °F above expected now ({num(temp[now])} °F against {num(exp[now])} °F). '
                  f'Alert level is +{num(p["hot_f"], 0)} °F.',
                  f'{sname} runs the same duty in the same weather. Heat it doesn\'t have is coming from inside this pump.',
                  spark(res, rd, threshold_value=p['hot_f'])),
            check('gradual', 'Rising steadily, not jumping', 'required', MATCH,
                  f'{signed(slope)} °F per hour over the last {dur(p["slope_window_min"])}. '
                  f'Largest 5-min step: {num(step)} °F.',
                  'Bearing wear grows gradually. A sensor or wiring fault usually shows up as a sudden jump.',
                  spark(res, rd, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained, not a passing spike', 'required', MATCH,
                  f'Above +{num(p["hot_f"], 0)} °F since {ts[alert]} ({dur(pack.minutes_between(alert, now))}). '
                  f'Above +{num(p["watch_f"], 0)} °F since {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} above the alert level, so flow swings don\'t trigger it.',
                  spark(res, rd, threshold_value=p['hot_f'], highlight=[ts[alert], ts[now]])),
            check('vib', 'Vibration up too', 'supporting', MATCH if vib_ok else NO_MATCH,
                  f'{num(vib[now], 3)} in/s now, from about {num(vib0, 3)} in/s before {ts[onset]}. '
                  f'{sname}: {num(svib[now], 3)} in/s. ISO alert level: {p["vib_alert_ips"]} in/s.',
                  'A separate sensor. A worn rolling surface makes the pump run rougher as well as hotter.',
                  spark(vib, [0, 0.3], svib, svib, p['vib_alert_ips'], decimals=3)),
            check('flow', 'Same flow as its sister pump', 'supporting', MATCH if flow_ok else NO_MATCH,
                  f'{num(fm, 0)} gpm over the last hour; {sname}: {num(sfm, 0)} gpm.',
                  'More flow means more load on the bearings. Equal flow rules that out.',
                  spark(flow, nice_domain(flow, sflow), sflow, sflow)),
            check('motor', 'Motor running normal', 'supporting', MATCH if motor_ok else NO_MATCH,
                  f'Motor winding {num(mot[now])} °F; {sname} motor {num(smot[now])} °F '
                  f'({signed(mdiff)} °F on the last 30-min average).',
                  'The heat stays in the pump bearings. A motor or coupling problem would warm the motor too.',
                  spark(mot, nice_domain(mot, smot), smot, smot)),
        ]
        main = chart('°F', nice_domain(temp, exp, pad=0.05),
                     [series('actual', f'{pname} bearings', temp, 'primary', 1),
                      series('expected', f'Expected from {sname}', exp, 'expected', 1)],
                     title='What we see',
                     caption=f'{pname} bearing temperature against {sname}, plus the usual {num(c["offset"])} °F '
                             f'between the two pumps. The shaded gap is heat the sister pump doesn\'t have.',
                     shade_gap=['actual', 'expected'],
                     markers=[marker(ts[onset], 'Divergence begins'), marker(ts[alert], f'Alert: +{num(p["hot_f"], 0)} °F')])

        grid = hours_grid(6, 0.25)
        r = Rng(1101)
        tb = [0.0 if hh == 0 else 3.6 * hh + 0.55 * hh * hh + r.gauss(0.5) for hh in grid]
        tb_v = [0.12 + 0.012 * hh + 0.006 * hh * hh + r.gauss(0.005) for hh in grid]
        ea = [1.4 * hh + r.gauss(0.5) for hh in grid]
        ea_v = [0.12 + 0.006 * hh + r.gauss(0.005) for hh in grid]
        dr = [2.3 * hh + r.gauss(0.3) for hh in grid]
        dr_v = [0.12 + r.gauss(0.005) for hh in grid]
        live_r = aligned(res, onset, pack.step_min, grid)
        live_v = aligned(vib, onset, pack.step_min, grid)
        live = f'{pname}, today'

        def pair(a, b):
            return [ref_chart('Unexplained bearing heat (h from onset)', '°F', [-5, 45], grid, 'h', a, live_r, live),
                    ref_chart('Pump vibration', 'in/s', [0, 0.4], grid, 'h', b, live_v, live, 3,
                              [threshold(p['vib_alert_ips'], 'ISO alert')])]
        refs = [
            reference('wear', 'textbook', 'Textbook', 'Rolling-element wear, confirmed',
                      'Heat and vibration climb together and speed up, until the pump is swapped and the bearing '
                      'is found pitted.', 'match', 'Closest match',
                      ['Same steady climb in heat', 'Vibration past the ISO alert level, as here'], pair(tb, tb_v)),
            reference('early', 'early', 'Early stage', 'Lubricant starting to break down',
                      'A slower rise, with vibration barely moving. An oil sample catches it; alarms don\'t.',
                      'partial', 'Same shape, slower',
                      [f'{pname} has passed this stage', 'Where an oil sample pays for itself'], pair(ea, ea_v)),
            reference('drift', 'lookalike', 'Look-alike', 'Temperature element drifting',
                      'The reading creeps up but the bearing is fine. Vibration stays flat.',
                      'nomatch', 'Doesn\'t match',
                      [f'Vibration is flat here; on {pname} it went from {num(vib0, 2)} to {num(vib[now], 2)} in/s',
                       'A drift is a straight line; this heat is speeding up'], pair(dr, dr_v)),
        ]
        ro = [
            ruled_out('More flow through the pump', 'ruled out',
                      f'{pname} averaged {num(fm, 0)} gpm over the last hour and {sname} {num(sfm, 0)} gpm. '
                      f'The comparison is made against the sister pump, so equal duty cancels out.'),
            ruled_out('Hotter weather', 'ruled out',
                      (f'Ambient went from {num(min(amb))} to {num(amb[now])} °F today. ' if amb else '') +
                      f'{sname} sees the same weather and rose only {num(stemp[now] - stemp[onset])} °F since {ts[onset]}; '
                      f'{pname} rose {num(temp[now] - temp[onset])} °F.'),
            ruled_out('Faulty temperature sensor', 'ruled out' if vib_ok else 'unlikely',
                      f'The rise is gradual (largest 5-min step {num(step)} °F), and vibration, a separate sensor, '
                      f'rose with it.' if vib_ok else f'The rise is gradual (largest 5-min step {num(step)} °F).'),
            ruled_out('A motor or coupling problem', 'unlikely' if motor_ok else 'not yet checked',
                      f'The motor winding reads within {num(abs(mdiff))} °F of {sname}\'s motor. A spectrum would show '
                      f'misalignment if it is there.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'Early bearing distress in the pump (wear or lubricant '
                                     'breakdown)', level,
                                     'Heat and vibration agree' if vib_ok else 'Heat only, no second signal yet'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': (f'Left out of the comparison: {join_names([short(pack, pack.parent(b)) for b in idle])} '
                         f'(standby, not running). A pump that isn\'t turning doesn\'t show what normal looks like.')
            if idle else None,
            'confidence': confidence(level,
                                     'Bearing temperature and vibration are measured by separate sensors and both point '
                                     'at this pump, at the same flow as its sister.' if vib_ok else
                                     'Only the temperature shows it so far.',
                                     'Nobody has taken a vibration spectrum or an oil sample yet. From trends alone, '
                                     'wear, lubricant breakdown and misalignment look alike.',
                                     'The spectrum shows bearing defect frequencies, or the oil sample shows wear metals.',
                                     'The spectrum and oil are clean. Then check the temperature element and the lube supply.'),
            'action': action(item, pack),
            'model': {'target': 'pump_bearing_temp_f',
                      'formula': f'{sname} bearing temperature {signed(c["offset"])} °F (offset over the first hour)',
                      'fittedOn': f'{len(running_peers)} running sister pump'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Compressor fouling — archetype 03 (quiet drift)
# ═════════════════════════════════════════════════════════════════════════
class CompressorFouling(Detector):
    id = 'ccgt.compressor_fouling'
    name = 'Gas turbine compressor fouling'
    archetype = '03 Quiet drift'
    applies_to = 'GT compressors'
    summary = ('A gas turbine compressor losing efficiency against its sister unit, slowly and steadily, while '
               'AGC hides it by loading the unit a little harder. Corrected output and heat rate confirm it.')
    pipeline = [
        ('Sister unit', 'the other gas turbine\'s compressor, same weather, same dispatch'),
        ('Gap', 'isentropic efficiency minus the sister\'s, point by point'),
        ('Checks', 'gap below the limit · still widening · sustained · corrected output · heat rate'),
        ('Confirmation', 'a compressor wash on this unit, and how much of the gap it recovered'),
        ('Conclusion', 'a slow, recoverable loss → fouling; recovery after a wash → high confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'gt_compressor'},
        'inputs': {'eff': 'self.compressor_efficiency_pct', 'sister': 'other gt_compressor.compressor_efficiency_pct',
                   'corrected': 'unit.corrected_output_pct', 'heatRate': 'unit.gt_heat_rate_btu_kwh',
                   'cpd': 'self.compressor_discharge_pressure_psig', 'filterDp': 'sibling[gt_inlet_filter].inlet_filter_dp_inh2o',
                   'wash': 'done work items on this compressor'},
        'params': {'gap_pts': 0.6, 'sustain_min': 30, 'slope_window_min': 120, 'max_slope_pts_per_h': -0.15,
                   'corrected_gap_pts': 1.0, 'heat_rate_gap_pct': 0.8, 'wash_recover_frac': 0.5,
                   'recover_within_min': 60, 'filter_dp_alarm_inh2o': 5.0},
        'checks': [
            {'id': 'gap', 'role': 'required', 'rule': 'eff − sister < −gap_pts'},
            {'id': 'widening', 'role': 'required', 'rule': 'slope(gap, slope_window_min) < max_slope_pts_per_h'},
            {'id': 'sustained', 'role': 'required', 'rule': 'gap < −gap_pts for sustain_min'},
            {'id': 'corrected', 'role': 'supporting', 'independent': True, 'rule': 'corrected output below sister by > corrected_gap_pts at the worst point'},
            {'id': 'heatrate', 'role': 'supporting', 'independent': True, 'rule': 'GT heat rate above sister by > heat_rate_gap_pct at the worst point'},
            {'id': 'washed', 'role': 'supporting', 'independent': True, 'rule': 'gap recovers ≥ wash_recover_frac of its worst within recover_within_min of a wash finishing'},
        ],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'recovered after a wash'},
    }

    def candidates(self, pack):
        return pack.of_type('gt_compressor')

    def _ctx(self, pack, aid):
        sis = [c for c in pack.of_type('gt_compressor') if c != aid][0]
        eff, seff = pack.series(aid, 'compressor_efficiency_pct'), pack.series(sis, 'compressor_efficiency_pct')
        gap = [a - b for a, b in zip(eff, seff)]
        return dict(sis=sis, eff=eff, seff=seff, gap=gap)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        low = B.lt(c['gap'], -p['gap_pts'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(low, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(c['gap'], i, sw, pack.step_min)
            if slope is not None and slope < p['max_slope_pts_per_h']:
                c.update(alert=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit, sunit = pack.unit_of(aid), pack.unit_of(c['sis'])
        uname, sname = pack.name(unit), pack.name(sunit)
        eff, seff, gap = c['eff'], c['seff'], c['gap']
        washes = done_work(pack, [aid, unit])
        wash = washes[0] if washes else None
        w_start = idx_at(pack, wash[0]['plannedStart']) if wash else None
        before = (w_start - 1) if wash else now
        worst = min(range(0, before + 1), key=lambda k: gap[k])
        slope = B.slope_per_hour(gap, i, pack.steps(p['slope_window_min']), pack.step_min)
        co, sco = pack.series(unit, 'corrected_output_pct'), pack.series(sunit, 'corrected_output_pct')
        hr, shr = pack.series(unit, 'gt_heat_rate_btu_kwh'), pack.series(sunit, 'gt_heat_rate_btu_kwh')
        co_gap = co[worst] - sco[worst]
        hr_gap = 100 * (hr[worst] / shr[worst] - 1)
        co_ok = co_gap < -p['corrected_gap_pts']
        hr_ok = hr_gap > p['heat_rate_gap_pct']
        rec_k, rec_frac = None, 0.0
        if wash:
            wk = wash[1]
            best = max(range(wk, min(pack.n, wk + pack.steps(p['recover_within_min']) + 1)), key=lambda k: gap[k])
            rec_frac = (gap[best] - gap[worst]) / (0 - gap[worst])
            rec_k = best
        washed = wash is not None and rec_frac >= p['wash_recover_frac']
        independent = sum([co_ok, hr_ok, washed])
        level = 'high' if washed else ('medium' if independent else 'low')
        loss0 = eff[0] - eff[before]
        kept = (eff[now] - eff[before]) / loss0 if loss0 > 0 else None
        mw, smw = pack.series(unit, 'gen_output_mw'), pack.series(sunit, 'gen_output_mw')
        cpd, scpd = pack.series(aid, 'compressor_discharge_pressure_psig'), pack.series(c['sis'], 'compressor_discharge_pressure_psig')
        inlet = pack.child_of_type(unit, 'gt_inlet_filter')
        fdp = pack.series(inlet, 'inlet_filter_dp_inh2o')
        gd = nice_domain(gap, [0], pad=0.1)

        checks = [
            check('gap', f'Less efficient than {sname}', 'required', MATCH,
                  f'{num(eff[i], 2)} % against {sname}\'s {num(seff[i], 2)} % when flagged at {ts[i]} '
                  f'({signed(gap[i], 2)} points). Worst {signed(gap[worst], 2)} points at {ts[worst]}.',
                  'Both compressors breathe the same air on the same day. A gap between them is the machine, not the weather.',
                  spark(gap, gd, threshold_value=-p['gap_pts'], decimals=3)),
            check('widening', 'Getting worse steadily', 'required', MATCH,
                  f'The gap moved {signed(slope, 2)} points per hour over the {dur(p["slope_window_min"])} before {ts[i]}.',
                  'Deposits build up hour by hour. A step would point at an instrument or a control change instead.',
                  spark(gap, gd, highlight=[ts[max(0, i - pack.steps(p['slope_window_min']))], ts[i]])),
            check('sustained', 'Sustained', 'required', MATCH,
                  f'More than {num(p["gap_pts"], 1)} points behind since {ts[c["alert"]]}.',
                  f'Needs {dur(p["sustain_min"])} below the limit, so a single noisy reading doesn\'t count.',
                  spark(gap, gd, threshold_value=-p['gap_pts'], highlight=[ts[c['alert']], ts[i]])),
            check('corrected', 'Corrected output down too', 'supporting', MATCH if co_ok else NO_MATCH,
                  f'{num(co[worst], 1)} % of new-and-clean at {ts[worst]}; {sname} {num(sco[worst], 1)} %.',
                  'Calculated from different measurements. A fouled compressor pushes less air, so the unit can make less.',
                  spark(co, nice_domain(co, sco), sco, sco)),
            check('heatrate', 'Burning more fuel per MW', 'supporting', MATCH if hr_ok else NO_MATCH,
                  f'Heat rate {num(hr[worst], 0)} Btu/kWh at {ts[worst]}, {signed(hr_gap, 1)} % against {sname}.',
                  'A separate meter (fuel flow). The compressor takes more of the turbine\'s work, so each MW costs more gas.',
                  spark(hr, nice_domain(hr, shr), shr, shr)),
            check('washed', 'Recovered after the online wash', 'supporting',
                  MATCH if washed else (PENDING if wash is None else NO_MATCH),
                  (f'Wash {ts[w_start]}–{ts[wash[1]]}. The gap was back to {signed(gap[rec_k], 2)} points by {ts[rec_k]}: '
                   f'{num(100 * rec_frac, 0)} % of it recovered.' if washed else
                   'No wash done yet.' if wash is None else f'Wash done at {ts[wash[1]]}, but the gap didn\'t close.'),
                  'Washing removes deposits and nothing else. If efficiency comes back, the deposits were the cause.',
                  spark(eff, nice_domain(eff, seff), seff, seff, highlight=[ts[w_start], ts[rec_k]] if washed else None)),
        ]
        main = chart('%', nice_domain(eff, seff, pad=0.1),
                     [series('actual', f'{uname} compressor efficiency', eff, 'primary', 2),
                      series('sister', f'{sname} compressor efficiency', seff, 'expected', 2)],
                     title='What we see',
                     caption=f'{uname} compressor isentropic efficiency against {sname} through the day. The shaded gap '
                             f'is the loss the sister unit doesn\'t have.',
                     shade_gap=['sister', 'actual'], decimals=2,
                     markers=[marker(ts[i], 'Flagged')] + ([marker(ts[w_start], 'Online wash'), ] if wash else []))

        grid = hours_grid(6, 0.25)
        r = Rng(1202)
        tb = [(-0.3 - 0.28 * hh if hh < 3.5 else -1.28 + 0.9 * min(1, (hh - 3.5) / 1.0) - 0.05 * max(0, hh - 4.5))
              + r.gauss(0.03) for hh in grid]
        ea = [-0.3 - 0.09 * hh + r.gauss(0.03) for hh in grid]
        la = [(-0.3 if hh < 2 else -1.1) + r.gauss(0.03) for hh in grid]
        live = f'{uname}, today'
        lg = aligned(gap, 0, pack.step_min, grid)
        mk = lambda a: [ref_chart(f'Efficiency gap to {sname} (h from shift start)', 'pts', [-1.6, 0.4], grid, 'h', a, lg,
                                  live, 2, [threshold(-p['gap_pts'], 'Flag')])]
        refs = [
            reference('fouling', 'textbook', 'Textbook', 'Fouling, part-recovered by an online wash',
                      'Efficiency slides a few tenths a day in dusty or pollen-heavy weather. An online wash gets most of '
                      'it back; the rest waits for an offline crank wash.', 'match', 'Closest match',
                      ['Same slow slide, same size', 'Same partial recovery after the wash'], mk(tb)),
            reference('slow', 'early', 'Early stage', 'Clean climate, slow build-up',
                      'A third of the rate. It takes days to reach the flag level, which is why a trend beats an alarm.',
                      'partial', 'Same cause, slower', ['Worth tracking on both units', 'Wash on schedule, not on alarm'], mk(ea)),
            reference('instrument', 'lookalike', 'Look-alike', 'Instrument shift',
                      'A discharge temperature transmitter re-zeroed: calculated efficiency drops in one step. Output and '
                      'heat rate don\'t move.', 'nomatch', 'Doesn\'t match',
                      [f'This is a step; on {uname} it was a slope',
                       'Here heat rate is flat; on ' + uname + f' it ran {signed(hr_gap, 1)} % high'], mk(la)),
        ]
        ro = [
            ruled_out('Hot weather', 'ruled out',
                      f'{sname} runs in the same air and held {num(min(seff), 2)}–{num(max(seff), 2)} % all day.'),
            ruled_out('Inlet filter loading', 'unlikely',
                      f'Inlet filter DP is {num(fdp[now], 2)} inH₂O, well under the {num(p["filter_dp_alarm_inh2o"], 0)} '
                      f'inH₂O alarm. A loaded filter costs output, not compressor efficiency.'),
            ruled_out('A different load', 'ruled out',
                      f'{uname} made {num(mw[worst], 0)} MW at {ts[worst]} and {sname} {num(smw[worst], 0)} MW. '
                      f'CPD was {num(cpd[worst], 0)} psig against {num(scpd[worst], 0)} psig.'),
            ruled_out('A faulty efficiency calculation', 'ruled out' if (hr_ok or co_ok) else 'not yet checked',
                      'Heat rate and corrected output come from other measurements and moved the same way.'),
        ]
        return {
            'conclusion': conclusion('Cause' if washed else 'Most likely cause', 'Compressor fouling — recoverable, '
                                     'partly removed by the online wash' if washed else 'Compressor fouling', level,
                                     'Confirmed: efficiency came back after the wash' if washed else
                                     f'{independent} independent signals agree'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The gap grew slowly, heat rate and corrected output moved with it, and most of it '
                                     'came back after the wash.' if washed else 'Heat rate and corrected output moved with the gap.',
                                     None if washed else 'No wash has been done yet.',
                                     None if washed else 'Efficiency recovers after an online wash.',
                                     'The gap keeps growing quickly after the wash. Then look at the inlet air path and the '
                                     'compressor itself (blade damage).',
                                     'Recovery after the online wash' if washed else None),
            'action': action(item, pack),
            'impact': (f'{uname} ran {signed(hr_gap, 1)} % above {sname}\'s heat rate at the worst point. '
                       + (f'Now {num(eff[now], 2)} %, keeping {num(100 * kept, 0)} % of the recovery; the rest needs an '
                          f'offline wash.' if kept is not None and washed else '')),
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Exhaust thermocouple fault — archetype 06 (instrument, not process)
# ═════════════════════════════════════════════════════════════════════════
class ExhaustThermocoupleFault(Detector):
    id = 'ccgt.exhaust_tc_fault'
    name = 'Exhaust thermocouple failing'
    archetype = '06 Signal noise'
    applies_to = 'GT turbine sections'
    summary = ('Exhaust spread jumping between normal and alarm every few minutes, while everything a real '
               'combustion problem would move — dynamics, NOx, wheelspace, exhaust average — stays flat.')
    pipeline = [
        ('Erratic', 'count large up-and-down jumps in the exhaust spread over the last 30 minutes'),
        ('Alarm level', 'at least one reading above the normal 20–60 °F band'),
        ('Cross-check', 'combustion dynamics and GT NOx on this unit, relative to the sister unit, against the hour before'),
        ('Independent', 'wheelspace and exhaust average temperature; the sister unit\'s spread'),
        ('Conclusion', 'nothing physical confirms the spread → instrument; recovery after rejecting a TC → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'gt_turbine_section'},
        'inputs': {'spread': 'self.exhaust_temp_spread_f', 'exhaust': 'self.exhaust_temp_f', 'wheel': 'self.wheelspace_temp_f',
                   'dynamics': 'sources[gas_path].combustion_dynamics_psi − sister unit\'s',
                   'nox': 'sources[gas_path].gt_exit_nox_ppm − sister unit\'s',
                   'sister': 'other gt_turbine_section.exhaust_temp_spread_f', 'fix': 'done work items on this asset'},
        'params': {'jump_f': 25, 'min_jumps': 3, 'window_min': 30, 'alarm_f': 60, 'dyn_rise_psi': 0.3,
                   'nox_band_ppm': 1.0, 'flat_f': 5.0, 'normal_f': 40, 'recover_within_min': 15},
        'checks': [
            {'id': 'erratic', 'role': 'required', 'rule': '≥ min_jumps alternating jumps > jump_f within window_min'},
            {'id': 'alarm', 'role': 'required', 'rule': 'max(spread, window_min) > alarm_f'},
            {'id': 'nocombustion', 'role': 'required', 'rule': 'dynamics − sister rises < dyn_rise_psi and NOx − sister stays within ±nox_band_ppm of the hour before'},
            {'id': 'flat', 'role': 'supporting', 'independent': True, 'rule': 'wheelspace and exhaust average within ±flat_f through the episode'},
            {'id': 'sister', 'role': 'supporting', 'rule': 'sister spread < normal_f'},
            {'id': 'fixed', 'role': 'supporting', 'independent': True, 'rule': 'spread < normal_f and stays there within recover_within_min of a TC rejection'},
        ],
        'confidence': {'medium': 'required checks + wheelspace flat', 'high': 'spread normal after rejecting one thermocouple'},
    }

    def candidates(self, pack):
        return pack.of_type('gt_turbine_section')

    def _comb(self, pack, aid):
        return next((s for s in pack.sources(aid, 'gas_path') if pack.has(s, 'combustion_dynamics_psi')), None)

    def _jumps(self, spread, i0, i1, jump):
        d = diffs(spread)
        out, last = [], 0
        for k in range(max(1, i0), i1 + 1):
            if abs(d[k]) > jump and (last == 0 or (d[k] > 0) != (last > 0)):
                out.append(k)
                last = d[k]
        return out

    def _rel(self, pack, aid, comb):
        """Dynamics and NOx minus the sister unit's: the shared fuel and weather cancel out."""
        sis = [t for t in pack.of_type('gt_turbine_section') if t != aid][0]
        scomb = self._comb(pack, sis)
        dyn, nox = pack.series(comb, 'combustion_dynamics_psi'), pack.series(comb, 'gt_exit_nox_ppm')
        sdyn, snox = pack.series(scomb, 'combustion_dynamics_psi'), pack.series(scomb, 'gt_exit_nox_ppm')
        return sis, dyn, nox, sdyn, snox, [a - b for a, b in zip(dyn, sdyn)], [a - b for a, b in zip(nox, snox)]

    def evaluate(self, pack, aid):
        p = self.p
        spread = pack.series(aid, 'exhaust_temp_spread_f')
        comb = self._comb(pack, aid)
        if comb is None:
            return Finding(aid, False)
        sis, dyn, nox, sdyn, snox, dd, nd = self._rel(pack, aid, comb)
        w, h = pack.steps(p['window_min']), pack.steps(60)
        for i in range(w, pack.n):
            i0 = i - w + 1
            jumps = self._jumps(spread, i0, i, p['jump_f'])
            if len(jumps) < p['min_jumps'] or max(spread[i0:i + 1]) <= p['alarm_f']:
                continue
            dd0, nd0 = mean_between(dd, i0 - h, i0 - 1), mean_between(nd, i0 - h, i0 - 1)
            if max(dd[i0:i + 1]) - dd0 >= p['dyn_rise_psi']:
                continue
            if max(abs(v - nd0) for v in nd[i0:i + 1]) > p['nox_band_ppm']:
                continue
            start = jumps[0]
            while True:
                earlier = self._jumps(spread, start - w, start - 1, p['jump_f'])
                if not earlier:
                    break
                start = earlier[0]
            return Finding(aid, True, i, spread=spread, comb=comb, dyn=dyn, nox=nox, sdyn=sdyn, snox=snox, sis=sis,
                           start=start)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        spread, dyn, nox = c['spread'], c['dyn'], c['nox']
        sis = c['sis']
        sname = pack.name(pack.unit_of(sis))
        sdyn, snox = c['sdyn'], c['snox']
        sspread = pack.series(sis, 'exhaust_temp_spread_f')
        hot = [v > p['normal_f'] for v in spread]
        # the episode: the first jump through to the last abnormal reading of the run
        w = pack.steps(p['window_min'])
        start = c['start']
        end = start
        k = start
        while k + 1 < pack.n and any(hot[k + 1:k + 1 + pack.steps(p['window_min'])]):
            k += 1
            if hot[k]:
                end = k
        jumps = self._jumps(spread, start, end + 1, p['jump_f'])
        peak = max(range(start, end + 1), key=lambda q: spread[q])
        fixes = [x for x in done_work(pack, [aid, unit]) if start <= x[1] <= end + pack.steps(p['recover_within_min'])]
        fix = fixes[0] if fixes else None
        rest = spread[end + 1:]
        fixed = fix is not None and end + 1 < pack.n and all(v < p['normal_f'] for v in rest) and \
            pack.minutes_between(end, fix[1]) <= p['recover_within_min']
        wheel, exh = pack.series(aid, 'wheelspace_temp_f'), pack.series(aid, 'exhaust_temp_f')
        wr = max(wheel[start:end + 1]) - min(wheel[start:end + 1])
        er = max(exh[start:end + 1]) - min(exh[start:end + 1])
        flat = wr < 2 * p['flat_f'] and er < 2 * p['flat_f']
        sis_ok = max(sspread[start:end + 1]) < p['normal_f']
        level = 'high' if fixed else ('medium' if flat else 'low')
        dyn_base = median(dyn[start:end + 1])
        win = [ts[max(0, start - 18)], ts[min(now, end + 18)]]

        checks = [
            check('erratic', 'Jumping, not trending', 'required', MATCH,
                  f'{len(jumps)} jumps of more than {p["jump_f"]} °F between {ts[start]} and {ts[end]}, alternating up '
                  f'and down; it read {num(min(spread[start:end + 1]), 0)}–{num(spread[peak], 0)} °F.',
                  'A real spread builds and holds. A reading that flips between normal and alarm every few minutes is '
                  'an intermittent connection.',
                  spark(spread, [0, 130], threshold_value=p['alarm_f'], highlight=[ts[start], ts[end]], window=win)),
            check('alarm', 'Above the normal band', 'required', MATCH,
                  f'Peaked at {num(spread[peak])} °F at {ts[peak]}. Normal is 20–{p["alarm_f"]} °F.',
                  'At this level a real spread would be a trip precursor, so it has to be explained, not ignored.',
                  spark(spread, [0, 130], threshold_value=p['alarm_f'], window=win)),
            check('nocombustion', 'Combustion didn\'t change', 'required', MATCH,
                  f'Dynamics stayed {num(min(dyn[start:end + 1]), 2)}–{num(max(dyn[start:end + 1]), 2)} psi '
                  f'({sname}: {num(min(sdyn[start:end + 1]), 2)}–{num(max(sdyn[start:end + 1]), 2)}). GT NOx '
                  f'{num(min(nox[start:end + 1]))}–{num(max(nox[start:end + 1]))} ppm ({sname}: '
                  f'{num(min(snox[start:end + 1]))}–{num(max(snox[start:end + 1]))}).',
                  f'A can burning hot or lean shows in the dynamics and the NOx. Neither moved away from {sname}, '
                  f'which burns the same fuel in the same air.',
                  spark(dyn, [0, 3], sdyn, sdyn, window=win)),
            check('flat', 'Wheelspace and exhaust average flat', 'supporting', MATCH if flat else NO_MATCH,
                  f'Wheelspace moved {num(wr)} °F and exhaust average {num(er)} °F over the episode.',
                  'Separate sensors in the same gas path. A real hot or cold streak changes what they see.',
                  spark(wheel, nice_domain(wheel), window=win)),
            check('sister', f'{sname} normal', 'supporting', MATCH if sis_ok else NO_MATCH,
                  f'{sname} spread {num(min(sspread[start:end + 1]), 0)}–{num(max(sspread[start:end + 1]), 0)} °F at the same time.',
                  'Rules out anything the two units share, such as fuel quality.',
                  spark(sspread, [0, 130], window=win)),
            check('fixed', 'Normal after one thermocouple was rejected', 'supporting',
                  MATCH if fixed else (PENDING if fix is None else NO_MATCH),
                  (f'"{fix[0]["text"]}" done at {ts[fix[1]]}; spread {num(spread[fix[1]])} °F then, {num(spread[now])} °F now, '
                   f'with no further jumps.' if fixed else 'No thermocouple has been rejected yet.' if fix is None else
                   f'Work done at {ts[fix[1]]}, but the spread still jumps.'),
                  'Removing one reading fixed the calculation and nothing else changed: the instrument was the fault.',
                  spark(spread, [0, 130], highlight=[ts[fix[1]], ts[now]] if fixed else None)),
        ]
        main = chart('°F', [0, 130], [series('spread', f'{uname} exhaust spread', spread, 'primary', 1),
                                      series('sister', f'{sname} exhaust spread', sspread, 'expected', 1)],
                     title='What we see',
                     caption=f'{uname} exhaust temperature spread against {sname}. It flips between normal and alarm, '
                             f'with no trend, until one thermocouple is taken out of the calculation.',
                     thresholds=[threshold(p['alarm_f'], 'Top of normal')],
                     markers=[marker(ts[start], 'Jumping starts')] + ([marker(ts[fix[1]], 'TC rejected')] if fix else []),
                     window=[ts[max(0, start - 24)], ts[min(now, end + 24)]])
        grid = minutes_grid(-30, 120, 5)
        r = Rng(1303)
        tc = [(32 + r.gauss(2) if m < 0 or m > 60 else (35 + r.gauss(3) if (m // 5) % 2 else 95 + r.gauss(10))) for m in grid]
        tc_d = [1.0 + r.gauss(0.04) for m in grid]
        cold = [(32 if m < 0 else 32 + min(40, m * 0.6)) + r.gauss(1.5) for m in grid]
        cold_d = [1.0 + r.gauss(0.04) for m in grid]
        can = [(32 if m < 0 else 32 + min(55, m * 1.2)) + r.gauss(2) for m in grid]
        can_d = [(1.0 if m < 0 else 1.0 + min(1.4, m * 0.03)) + r.gauss(0.05) for m in grid]
        ls = aligned(spread, start, pack.step_min, grid, 'min')
        ld = aligned(dyn, start, pack.step_min, grid, 'min')
        live = f'{uname}, today'

        def pair(a, b):
            return [ref_chart('Exhaust spread (min from onset)', '°F', [0, 130], grid, 'min', a, ls, live, 0,
                              [threshold(p['alarm_f'], 'Top of normal')]),
                    ref_chart('Combustion dynamics', 'psi', [0, 3], grid, 'min', b, ld, live, 2)]
        refs = [
            reference('open', 'textbook', 'Textbook', 'Intermittent open thermocouple',
                      'A cracked junction or loose extension cable: the reading drops out and returns. Spread jumps; '
                      'nothing else moves.', 'match', 'Closest match',
                      ['Same flip between normal and alarm', 'Dynamics flat, as here'], pair(tc, tc_d)),
            reference('drift', 'variant', 'Variant', 'Thermocouple drifting low',
                      'A degrading junction reads lower and lower. The spread grows smoothly and stays, with the same '
                      'reader always the low one.', 'partial', 'Same cause, steadier signal',
                      ['Slower and harder to tell from a real cold streak', 'Same fix: reject and replace at the outage'],
                      pair(cold, cold_d)),
            reference('can', 'lookalike', 'Look-alike', 'Real combustor problem',
                      'A can running hot or lean. The spread grows and holds, dynamics climb, and the hot spot moves around '
                      'the annulus with load.', 'nomatch', 'Doesn\'t match',
                      [f'Dynamics rise here; on {uname} they stayed near {num(dyn_base, 1)} psi', 'This spread holds; '
                       f'{uname}\'s flipped every few minutes'], pair(can, can_d)),
        ]
        ro = [
            ruled_out('A combustion problem', 'ruled out',
                      f'Dynamics and NOx stayed level with {sname}\'s throughout, and wheelspace moved only {num(wr)} °F.'),
            ruled_out('Fuel quality', 'ruled out', f'{sname}, on the same fuel, stayed normal.'),
            ruled_out('A real hot-gas-path issue', 'ruled out' if fixed else 'unlikely',
                      'The spread returned to normal the moment one reading was removed, without any change to the '
                      'machine.' if fixed else 'Nothing physical moved with the spread.'),
        ]
        return {
            'conclusion': conclusion('Cause' if fixed else 'Most likely cause',
                                     'A failing exhaust thermocouple — the combustor was fine', level,
                                     'Confirmed: spread normal after rejecting one thermocouple' if fixed
                                     else 'Nothing physical confirms the spread'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The spread jumped with no trend, every physical cross-check stayed flat, and it was '
                                     'normal as soon as one thermocouple was rejected.' if fixed else
                                     'The spread jumped with no trend and every physical cross-check stayed flat.',
                                     None if fixed else 'No thermocouple has been rejected yet.',
                                     None if fixed else 'Rejecting the suspect thermocouple brings the spread back to normal.',
                                     'The spread stays high with the thermocouple rejected. Then treat it as combustion.',
                                     'Spread normal after the thermocouple was rejected' if fixed else None),
            'action': action(item, pack),
            'impact': 'The data here holds the spread only, not each thermocouple, so which position failed comes from '
                      'the control system\'s TC display, not from this detector.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Tower cooling lost, seen at the condenser — archetype 07 (ghost signal)
# ═════════════════════════════════════════════════════════════════════════
def cooling_chain(pack, cond):
    """Walk the cooling_water layer upstream from a condenser: pumps → pump station → tower."""
    pumps = pack.sources(cond, 'cooling_water')
    stations = {pack.parent(x) for x in pumps} | set(pumps)
    towers = []
    for s in stations:
        for t in pack.sources(s, 'cooling_water'):
            if pack.has(t, 'ct_approach_f') and t not in towers:
                towers.append(t)
    return towers


class TowerCoolingLoss(Detector):
    id = 'ccgt.tower_cooling_loss'
    name = 'Condenser vacuum lost to the cooling tower'
    archetype = '07 Ghost signal'
    applies_to = 'condensers'
    summary = ('Condenser backpressure up while the condenser itself is clean and tight: the circulating water '
               'coming back is warmer than the weather explains, because a cooling tower fan has stopped.')
    pipeline = [
        ('Split the backpressure', 'backpressure is the saturation pressure at CW supply + CW range + TTD; CW supply '
                                   'is wet bulb + tower approach'),
        ('Tower share', 'how much backpressure the extra tower approach adds, against its own 90-min baseline'),
        ('Condenser health', 'TTD and air in-leakage against the same baseline'),
        ('Follow the cooling layer', 'upstream to the tower, then each cell\'s fan'),
        ('Conclusion', 'symptom at the condenser, cause on the tower cell; recovery after the fan restarts → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'condenser'},
        'inputs': {'bp': 'self.condenser_backpressure_inhga', 'ttd': 'self.condenser_ttd_f', 'air': 'self.air_inleakage_scfm',
                   'approach': 'sources[cooling_water]…cooling_tower.ct_approach_f',
                   'cells': 'tower children: ct_cell_fan_power_kw, cell_outlet_temp_f; gearbox ct_gearbox_vibration_ips',
                   'cw': 'tower unit: cw_supply_temp_f, cw_return_temp_f'},
        'expected': {'model': 'physics', 'formula': 'bp if approach were normal = Psat(Tsat(bp) − (approach − baseline approach))'},
        'params': {'base_lag_min': 30, 'base_win_min': 90, 'tower_bp_inhga': 0.06, 'sustain_min': 15,
                   'ttd_band_f': 1.0, 'air_band_scfm': 1.0, 'fan_off_frac': 0.1, 'lead_max_min': 30,
                   'recover_within_min': 60, 'hot_cell_f': 5.0, 'gbx_stopped_ips': 0.03},
        'checks': [
            {'id': 'tower', 'role': 'required', 'rule': 'backpressure added by extra approach > tower_bp_inhga for sustain_min'},
            {'id': 'clean', 'role': 'required', 'rule': 'TTD within ±ttd_band_f and air in-leakage within ±air_band_scfm of baseline'},
            {'id': 'fan', 'role': 'required', 'rule': 'a cell fan < fan_off_frac × median cell, stopping ≤ lead_max_min before the rise'},
            {'id': 'hotcell', 'role': 'supporting', 'independent': True, 'rule': 'that cell\'s outlet within hot_cell_f of CW return'},
            {'id': 'gearbox', 'role': 'supporting', 'independent': True, 'rule': 'that cell\'s gearbox vibration < gbx_stopped_ips'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'tower share < half the limit within recover_within_min of the fan restarting'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'backpressure recovered after the fan restarted'},
    }

    def candidates(self, pack):
        return pack.of_type('condenser')

    def _base(self, pack, v, i):
        p = self.p
        i1 = i - pack.steps(p['base_lag_min'])
        i0 = i1 - pack.steps(p['base_win_min'])
        return median(v[max(0, i0):i1 + 1]) if i1 >= 2 else None

    def _ctx(self, pack, aid):
        towers = cooling_chain(pack, aid)
        if not towers:
            return None
        ct = towers[0]
        bp = pack.series(aid, 'condenser_backpressure_inhga')
        ap = pack.series(ct, 'ct_approach_f')
        ttd, air = pack.series(aid, 'condenser_ttd_f'), pack.series(aid, 'air_inleakage_scfm')
        base_ap = [self._base(pack, ap, i) for i in range(pack.n)]
        extra = [None if b is None else a - b for a, b in zip(ap, base_ap)]
        tower_bp = [None if e is None else b - psat_inhga(tsat_f(b) - e) for b, e in zip(bp, extra)]
        cells = [x for x in pack.children.get(ct, []) if pack.has(x, 'ct_cell_fan_power_kw')]
        fans = {x: pack.series(x, 'ct_cell_fan_power_kw') for x in cells}
        return dict(ct=ct, bp=bp, ap=ap, ttd=ttd, air=air, base_ap=base_ap, extra=extra, tower_bp=tower_bp,
                    cells=cells, fans=fans)

    def _off(self, pack, c, cell, k):
        others = [c['fans'][x][k] for x in c['cells'] if x != cell]
        return c['fans'][cell][k] < self.p['fan_off_frac'] * statistics.median(others)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        high = B.gt(c['tower_bp'], p['tower_bp_inhga'])
        for i in range(pack.n):
            s0 = B.sustained_since(high, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            bt, ba = self._base(pack, c['ttd'], i), self._base(pack, c['air'], i)
            if bt is None or abs(c['ttd'][i] - bt) > p['ttd_band_f'] or abs(c['air'][i] - ba) > p['air_band_scfm']:
                continue
            lead = pack.steps(p['lead_max_min'])
            for cell in c['cells']:
                f0 = next((k for k in range(max(0, s0 - lead), i + 1) if self._off(pack, c, cell, k)), None)
                if f0 is None:
                    continue
                fb = f0
                while fb + 1 < pack.n and self._off(pack, c, cell, fb + 1):
                    fb += 1
                c.update(cell=cell, fan_off=f0, fan_back=fb + 1 if fb + 1 < pack.n else None, rise=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        cell, f0, fb, s0 = c['cell'], c['fan_off'], c['fan_back'], c['rise']
        cname = pack.name(cell)
        bp, ap = c['bp'], c['ap']
        # For display, hold the baseline approach at its value when the rise began: a rolling baseline would
        # soak up the event itself and show the tower "better than usual" after the fan restarts.
        b0 = min(s0, f0)
        base_ap = [c['base_ap'][k] if k < b0 else c['base_ap'][b0] for k in range(pack.n)]
        tbp = [None if bb is None else v - psat_inhga(tsat_f(v) - (a_ - bb)) for v, a_, bb in zip(bp, ap, base_ap)]
        cw = pack.unit_of(c['ct'])
        sup, ret = pack.series(cw, 'cw_supply_temp_f'), pack.series(cw, 'cw_return_temp_f')
        wb = pack.series(c['ct'], 'wet_bulb_temp_f')
        high = B.gt(tbp, p['tower_bp_inhga'])
        e = s0
        while e + 1 < pack.n and high[e + 1]:
            e += 1
        peak = max(range(s0, e + 1), key=lambda k: bp[k])
        rec = None
        if fb is not None:
            rec = next((k for k in range(fb, min(pack.n, fb + pack.steps(p['recover_within_min']) + 1))
                        if tbp[k] is not None and tbp[k] < p['tower_bp_inhga'] / 2), None)
        recovered = rec is not None
        outlet = pack.series(cell, 'cell_outlet_temp_f')
        others_out = [median([pack.series(x, 'cell_outlet_temp_f')[k] for x in c['cells'] if x != cell]) for k in range(pack.n)]
        hot_ok = abs(outlet[f0 + 1] - ret[f0 + 1]) < p['hot_cell_f']
        gbx = pack.child_of_type(cell, 'ct_fan_gearbox')
        gv = pack.series(gbx, 'ct_gearbox_vibration_ips') if gbx else None
        gbx_ok = gv is not None and max(gv[f0:(fb or now)]) < p['gbx_stopped_ips']
        level = 'high' if recovered else 'medium'
        fan = c['fans'][cell]
        med_fan = [median([c['fans'][x][k] for x in c['cells'] if x != cell]) for k in range(pack.n)]
        ttd, air = c['ttd'], c['air']
        bt, ba = self._base(pack, ttd, i), self._base(pack, air, i)
        stg = pack.unit_of(aid)
        mw = pack.series(stg, 'gen_output_mw')
        win = [ts[max(0, f0 - 12)], ts[min(now, (rec or e) + 12)]]
        expected = [None if t is None else b - t for b, t in zip(bp, tbp)]

        checks = [
            check('tower', 'Backpressure up because the water came back warmer', 'required', MATCH,
                  f'Tower approach {num(ap[peak])} °F at {ts[peak]} against its usual {num(base_ap[peak])} °F. That adds '
                  f'{num(tbp[peak], 2)} inHgA of the {num(bp[peak], 2)} inHgA backpressure.',
                  'Warmer circulating water raises the temperature, and so the pressure, at which steam condenses.',
                  spark(tbp, [-0.05, 0.25], threshold_value=p['tower_bp_inhga'], window=win, decimals=3)),
            check('clean', 'The condenser itself is fine', 'required', MATCH,
                  f'TTD {num(ttd[i])} °F (baseline {num(bt)}); air in-leakage {num(air[i])} scfm (baseline {num(ba)}).',
                  'Fouled tubes raise TTD; an air leak raises air in-leakage. Neither moved.',
                  spark(ttd, [4, 9], window=win)),
            check('fan', f'Cooling tower {cname} fan stopped', 'required', MATCH,
                  f'Fan power {num(fan[f0 - 1], 0)} kW at {ts[f0 - 1]}, {num(fan[f0], 0)} kW at {ts[f0]}. The other cells: about '
                  f'{num(med_fan[f0], 0)} kW each.',
                  f'{cname} feeds the condenser on the cooling-water layer through the tower basin and the CW pumps. '
                  f'Without its fan, that cell barely cools.',
                  spark(fan, [0, 200], med_fan, med_fan, highlight=[ts[f0], ts[fb or now]], window=win)),
            check('hotcell', 'That cell\'s water isn\'t being cooled', 'supporting', MATCH if hot_ok else NO_MATCH,
                  f'{cname} outlet {num(outlet[f0 + 1])} °F against CW return {num(ret[f0 + 1])} °F; other cells '
                  f'{num(others_out[f0 + 1])} °F.',
                  'A separate sensor. Water leaving the cell almost as hot as it arrived confirms no air is moving.',
                  spark(outlet, [70, 110], others_out, others_out, window=win)),
            check('gearbox', 'Its gearbox stopped turning', 'supporting', MATCH if gbx_ok else NO_MATCH,
                  (f'Gearbox vibration {num(gv[f0], 3)} in/s while stopped, against {num(gv[f0 - 1], 3)} in/s before.'
                   if gv else 'No gearbox signal.'),
                  'A fan motor trip, not a broken gearbox or a fan running with damaged blades.',
                  spark(gv, [0, 0.2], window=win, decimals=3) if gv else None),
            check('recovered', 'Backpressure recovered once the fan restarted', 'supporting',
                  MATCH if recovered else (PENDING if fb is None else NO_MATCH),
                  (f'Fan back at {ts[fb]}; the tower\'s share of backpressure was under '
                   f'{num(p["tower_bp_inhga"] / 2, 2)} inHgA by {ts[rec]}.' if recovered else
                   'The fan hasn\'t restarted yet.' if fb is None else f'Fan back at {ts[fb]}, but backpressure is still high.'),
                  'Restoring the cause and watching the symptom clear is the strongest confirmation there is.',
                  spark(bp, nice_domain(bp), highlight=[ts[fb], ts[rec]] if recovered else None, decimals=3)),
        ]
        main = chart('inHgA', nice_domain(bp, [v for v in expected if v is not None], pad=0.05),
                     [series('actual', 'Condenser backpressure', bp, 'primary', 3),
                      series('expected', 'If the tower held its usual approach', expected, 'expected', 3)],
                     title='What we see',
                     caption='Condenser backpressure against what it would be if the cooling tower held its usual approach '
                             'to wet bulb. The shaded gap is the tower\'s doing, not the condenser\'s.',
                     shade_gap=['actual', 'expected'], decimals=2,
                     markers=[marker(ts[f0], f'{cname} fan stops')] + ([marker(ts[fb], 'Fan restarted')] if fb else []))
        grid = minutes_grid(-30, 150, 5)
        r = Rng(1404)
        rise = lambda m, top, tau: 0.0 if m < 0 else top * (1 - math.exp(-m / tau))
        tb = [(rise(m, 0.2, 12) if m < 50 else rise(50, 0.2, 12) * math.exp(-(m - 50) / 15)) + r.gauss(0.008) for m in grid]
        tb_f = [(0 if 0 <= m < 50 else 168) + r.gauss(1.5) for m in grid]
        vr = [rise(m, 0.07, 30) + r.gauss(0.008) for m in grid]
        vr_f = [(168 if m < 0 else 120) + r.gauss(1.5) for m in grid]
        la = [0.0 + r.gauss(0.008) for m in grid]
        la_f = [168 + r.gauss(1.5) for m in grid]
        lt = aligned(tbp, f0, pack.step_min, grid, 'min')
        lf = aligned(fan, f0, pack.step_min, grid, 'min')
        live = 'Today'

        def pair(a, b):
            return [ref_chart('Backpressure from the tower (min from fan stop)', 'inHgA', [-0.05, 0.25], grid, 'min', a, lt,
                              live, 2),
                    ref_chart(f'Fan power, stopped cell', 'kW', [0, 200], grid, 'min', b, lf, live, 0)]
        refs = [
            reference('trip', 'textbook', 'Textbook', 'Fan motor trip, reset within the hour',
                      'One cell of eight loses its fan. Approach climbs 2 °F, backpressure follows within 20 minutes, and '
                      'both fall back as soon as the fan restarts.', 'match', 'Closest match',
                      ['Same size and timing', 'Same recovery after the reset'], pair(tb, tb_f)),
            reference('slow', 'variant', 'Variant', 'Fan running slow (VFD fault or belt slip)',
                      'The fan runs at reduced power. A smaller, slower rise that is easy to blame on the weather.',
                      'partial', 'Same cause family, milder', ['Fan power down, not zero', 'Check fan speed on the rounds'],
                      pair(vr, vr_f)),
            reference('air', 'lookalike', 'Look-alike', 'Air in-leakage at the condenser',
                      'Backpressure climbs because air blankets the tubes. The tower is fine, so its share stays at zero, '
                      'but air in-leakage and TTD rise.', 'nomatch', 'Doesn\'t match',
                      ['Tower share flat here; today it carried the rise',
                       f'Today air in-leakage stayed at {num(air[peak])} scfm'], pair(la, la_f)),
        ]
        ro = [
            ruled_out('Condenser air in-leakage', 'ruled out',
                      f'Air in-leakage {num(air[peak])} scfm at the peak, against {num(ba)} scfm before.'),
            ruled_out('Fouled condenser tubes', 'ruled out', f'TTD {num(ttd[peak])} °F at the peak, against {num(bt)} °F before.'),
            ruled_out('Hotter weather', 'ruled out',
                      f'Wet bulb went only from {num(wb[f0 - 1])} to {num(wb[peak])} °F, while CW supply went from '
                      f'{num(sup[f0 - 1])} to {num(sup[peak])} °F.'),
            ruled_out('More steam to the condenser', 'ruled out',
                      f'{pack.name(stg)} output held at {num(min(mw[f0:peak + 1]), 0)}–{num(max(mw[f0:peak + 1]), 0)} MW from the fan stop to the peak.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'Cooling tower {cname} fan stopped; the condenser itself was healthy', level,
                                     'Confirmed: backpressure recovered as soon as the fan restarted' if recovered
                                     else 'Fan stopped just before backpressure rose'),
            'rootCauseAssetId': cell,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     f'The {cname} fan stopped first, the extra tower approach accounts for the rise, and '
                                     f'backpressure fell back once the fan restarted.' if recovered else
                                     f'The {cname} fan stopped first and the extra approach accounts for the rise.',
                                     None if recovered else 'The fan hasn\'t restarted yet.',
                                     None if recovered else 'Backpressure falls once the fan is reset.',
                                     'Backpressure stays high with all fans running. Then look at the condenser itself.',
                                     'Recovery after the fan restart' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'condenser_backpressure_inhga',
                      'formula': 'Psat(Tsat(backpressure) − (approach − its median 30–120 min earlier)), Antoine equation',
                      'fittedOn': 'physics; no fitted coefficients'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Drum level oscillation — archetype 10 (overcorrection loop)
# ═════════════════════════════════════════════════════════════════════════
class DrumLevelOscillation(Detector):
    id = 'ccgt.drum_level_oscillation'
    name = 'Drum level control oscillating'
    archetype = '10 Overcorrection loop'
    applies_to = 'HRSG drums'
    summary = ('Drum level and its feedwater valve swinging against each other with growing amplitude while steam '
               'flow and feed pressure are steady: the control loop is feeding the swing, not the process.')
    pipeline = [
        ('Swing', 'level peak-to-peak over the last 30 min, and how often it reverses'),
        ('Growth', 'amplitude now against the 30 min before'),
        ('Loop', 'the drum\'s feedwater control valve: does it move against the level, step by step?'),
        ('Rule out the process', 'steam flow (swell and shrink) and feed pump pressure (supply) steady'),
        ('Context', 'instrument work in progress on this HRSG that could take an input away from the controller'),
    ]
    definition = {
        'appliesTo': {'assetType': ['hp_drum', 'ip_drum', 'lp_drum']},
        'inputs': {'level': 'self.drum_level_in', 'valve': 'child[feedwater_control_valve].fcv_position_pct',
                   'fwFlow': 'child[feedwater_control_valve].hp_fw_flow_klb_h', 'steam': 'unit.hp_steam_flow_klb_h',
                   'supply': 'sources[feedwater] of the valve, running pump.bfp_discharge_pressure_psig',
                   'work': 'open INSTRUMENT_CHECK work on this HRSG'},
        'params': {'window_min': 30, 'p2p_in': 4.0, 'min_reversals': 3, 'reversal_in': 1.0, 'growth_ratio': 1.3,
                   'valve_corr': -0.6, 'trip_in': 8.0, 'steam_steady_pct': 2.0, 'supply_steady_pct': 1.5},
        'checks': [
            {'id': 'swing', 'role': 'required', 'rule': 'p2p(level, window_min) > p2p_in with ≥ min_reversals reversals > reversal_in'},
            {'id': 'growing', 'role': 'required', 'rule': 'p2p now > growth_ratio × p2p over the window before'},
            {'id': 'valve', 'role': 'required', 'rule': 'corr(Δlevel, Δvalve) over window_min < valve_corr'},
            {'id': 'steam', 'role': 'supporting', 'independent': True, 'rule': 'steam flow range < steam_steady_pct of its mean'},
            {'id': 'supply', 'role': 'supporting', 'independent': True, 'rule': 'feed pump discharge pressure range < supply_steady_pct'},
            {'id': 'mode', 'role': 'supporting', 'rule': 'instrument work on this HRSG started before the swing and is still open'},
        ],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent check rules out the process',
                       'high': 'level settles once full control is restored'},
    }

    def candidates(self, pack):
        return pack.of_type('hp_drum', 'ip_drum', 'lp_drum')

    def _p2p(self, v, i0, i1):
        seg = v[max(0, i0):i1 + 1]
        return max(seg) - min(seg)

    def _reversals(self, v, i0, i1):
        d = diffs(v)
        big = [d[k] for k in range(max(1, i0), i1 + 1) if abs(d[k]) > self.p['reversal_in']]
        return sum(1 for a, b in zip(big, big[1:]) if (a > 0) != (b > 0))

    def evaluate(self, pack, aid):
        p = self.p
        fcv = pack.child_of_type(aid, 'feedwater_control_valve')
        if fcv is None:
            return Finding(aid, False)
        lvl = pack.series(aid, 'drum_level_in')
        valve = pack.series(fcv, 'fcv_position_pct')
        w = pack.steps(p['window_min'])
        for i in range(2 * w, pack.n):
            i0 = i - w + 1
            now_p2p, prev_p2p = self._p2p(lvl, i0, i), self._p2p(lvl, i0 - w, i0 - 1)
            if now_p2p <= p['p2p_in'] or self._reversals(lvl, i0, i) < p['min_reversals']:
                continue
            if now_p2p <= p['growth_ratio'] * prev_p2p:
                continue
            corr = pearson(diffs(lvl)[i0:i + 1], diffs(valve)[i0:i + 1])
            if corr is None or corr >= p['valve_corr']:
                continue
            d = diffs(lvl)
            onset = next(k for k in range(i0, i + 1) if abs(d[k]) > p['reversal_in'])
            while onset > 1 and abs(d[onset - 1]) > p['reversal_in']:
                onset -= 1
            return Finding(aid, True, i, fcv=fcv, lvl=lvl, valve=valve, onset=onset, corr=corr)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        lvl, valve, fcv, onset = c['lvl'], c['valve'], c['fcv'], c['onset']
        w = pack.steps(p['window_min'])
        amp = [None if k < w - 1 else self._p2p(lvl, k - w + 1, k) / 2 for k in range(pack.n)]
        hi, lo = max(lvl[now - w + 1:now + 1]), min(lvl[now - w + 1:now + 1])
        corr_now = pearson(diffs(lvl)[now - w + 1:now + 1], diffs(valve)[now - w + 1:now + 1])
        # growth per 10 min over the last 30 min, extrapolated to the trip level
        a_now, a_prev = amp[now], amp[now - pack.steps(20)]
        rate = (a_now - a_prev) / 20.0 if a_prev is not None else None
        to_trip = (p['trip_in'] - a_now) / rate if rate and rate > 0 else None
        steam = pack.series(unit, 'hp_steam_flow_klb_h')
        sw = steam[onset:now + 1]
        s_rng = (max(sw) - min(sw)) / B.mean(sw) * 100
        steam_ok = s_rng < p['steam_steady_pct']
        pumps = [x for x in pack.sources(fcv, 'feedwater') if pack.has(x, 'bfp_discharge_pressure_psig')]
        pump = max(pumps, key=lambda x: pack.series(x, 'bfp_flow_gpm')[now]) if pumps else None
        dp = pack.series(pump, 'bfp_discharge_pressure_psig') if pump else None
        d_rng = (max(dp[onset:now + 1]) - min(dp[onset:now + 1])) / B.mean(dp[onset:now + 1]) * 100 if dp else None
        supply_ok = d_rng is not None and d_rng < p['supply_steady_pct']
        scope = [unit] + pack.descendants(unit)
        inst = [w_ for w_ in open_work(pack, scope, ['INSTRUMENT_CHECK'])
                if idx_at(pack, w_['plannedStart']) is not None and idx_at(pack, w_['plannedStart']) <= onset]
        mode_ok = bool(inst)
        sis = [d for d in pack.of_type(pack.asset(aid)['assetType']) if d != aid]
        sl = pack.series(sis[0], 'drum_level_in') if sis else None
        sname = pack.name(pack.unit_of(sis[0])) if sis else None
        level = 'medium' if (steam_ok or supply_ok) else 'low'
        fw = pack.series(fcv, 'hp_fw_flow_klb_h') if pack.has(fcv, 'hp_fw_flow_klb_h') else None
        win = [ts[max(0, onset - 18)], ts[now]]
        ly = [-p['trip_in'] - 2, p['trip_in'] + 2]

        checks = [
            check('swing', 'Level swinging, not drifting', 'required', MATCH,
                  f'{signed(hi)} to {signed(lo)} in over the last {p["window_min"]} min, reversing at every reading since {ts[onset]}.',
                  'A leak or a supply problem moves the level one way. A swing that reverses again and again is a loop.',
                  spark(lvl, ly, threshold_value=p['trip_in'], window=win)),
            check('growing', 'Each swing bigger than the last', 'required', MATCH,
                  f'Half-swing {num(a_now)} in now against {num(amp[onset - 1])} in over the {p["window_min"]} min before '
                  f'{ts[onset]}' + (f'; growing about {num(rate * 10, 1)} in every 10 min.' if rate else '.'),
                  'A damped loop settles on its own. A growing swing gets closer to the trip limit every cycle.',
                  spark(amp, [0, p['trip_in'] + 1], threshold_value=p['trip_in'], window=win)),
            check('valve', 'The feedwater valve moves against the level', 'required', MATCH,
                  f'Valve {num(min(valve[onset:now + 1]), 0)}–{num(max(valve[onset:now + 1]), 0)} % open; step-by-step '
                  f'correlation with level {num(corr_now, 2)}.',
                  'The valve opens as level falls and closes as it rises, a little too hard each time: the controller is '
                  'part of the swing.',
                  spark(valve, [40, 90], window=win)),
            check('steam', 'Steam flow steady', 'supporting', MATCH if steam_ok else NO_MATCH,
                  f'HP steam flow {num(min(sw), 0)}–{num(max(sw), 0)} klb/h since {ts[onset]} ({num(s_rng, 1)} % range).',
                  'A separate measurement. Swell and shrink come from steam demand changes; there weren\'t any.',
                  spark(steam, nice_domain(steam[onset - 24:], pad=0.3), window=win)),
            check('supply', 'Feed pump pressure steady', 'supporting', MATCH if supply_ok else NO_MATCH,
                  (f'{pack.name(pump)} discharge {num(min(dp[onset:now + 1]), 0)}–{num(max(dp[onset:now + 1]), 0)} psig '
                   f'({num(d_rng, 1)} % range).' if dp else 'No feed pump pressure found.'),
                  'Rules out the pump or the supply side pushing the level around.',
                  spark(dp, nice_domain(dp[onset - 24:], pad=0.3), window=win) if dp else None),
            check('mode', 'An input to the controller is out', 'supporting', MATCH if mode_ok else NO_MATCH,
                  (f'"{inst[0]["text"]}" started {inst[0]["plannedStart"][11:16]}, still open. Without steam flow the '
                   f'controller runs single-element.' if mode_ok else 'No instrument work found on this HRSG.'),
                  'Three-element control uses steam flow to anticipate swell and shrink. Without it, the loop chases the level.',
                  None),
        ]
        main = chart('in', ly, [series('lvl', f'{uname} {pack.name(aid)} level', lvl, 'primary', 2)] +
                     ([series('sister', f'{sname} {pack.name(aid)} level', sl, 'expected', 2)] if sl else []),
                     title='What we see',
                     caption=f'{uname} {pack.name(aid)} level from normal water level, against {sname}. Trip at ±{num(p["trip_in"], 0)} in.'
                             + (f' The steam-flow input went out for calibration at {inst[0]["plannedStart"][11:16]}.' if mode_ok else ''),
                     thresholds=[threshold(p['trip_in'], 'High trip'), threshold(-p['trip_in'], 'Low trip')],
                     markers=[marker(ts[onset], 'Swing starts')],
                     window=[ts[max(0, onset - 36)], ts[now]], decimals=1)
        grid = minutes_grid(-20, 90, 5)
        r = Rng(1505)
        osc = lambda m, a0, g: 0.3 * r.gauss(1) if m < 0 else (1 if (m // 5) % 2 else -1) * a0 * (g ** (m / 10))
        tb = [max(-9, min(9, osc(m, 1.3, 1.28))) for m in grid]
        da = [osc(m, 3.0, 0.7) for m in grid]
        sw_ = [(0.3 * r.gauss(1) if m < 0 else 4.5 * math.exp(-m / 12) * (1 if m < 25 else -0.3)) for m in grid]
        ll = aligned(lvl, onset, pack.step_min, grid, 'min')
        live = f'{uname}, today'
        mk = lambda a: [ref_chart('Drum level (min from the swing starting)', 'in', ly, grid, 'min', a, ll, live, 1,
                                  [threshold(p['trip_in'], 'Trip'), threshold(-p['trip_in'], 'Trip')])]
        refs = [
            reference('single', 'textbook', 'Textbook', 'Single-element control plus manual moves',
                      'With the steam-flow input gone, the controller reacts late; hand corrections land out of phase. '
                      'The swing grows about a quarter each cycle until someone restores the loop or the drum trips.',
                      'match', 'Closest match', ['Same growing swing', 'Same trigger: an input taken out for work'], mk(tb)),
            reference('damped', 'variant', 'What to aim for', 'Loop back in three-element',
                      'The same swing, damped out within 20 minutes once steam flow is back in the controller.',
                      'partial', 'Expected after the fix', ['Take the valve back to auto', 'Restore the steam-flow input'], mk(da)),
            reference('swell', 'lookalike', 'Look-alike', 'Swell after a load step',
                      'A real steam demand change: one big excursion that settles, with steam flow stepping at the start.',
                      'nomatch', 'Doesn\'t match', [f'Steam flow stepped here; on {uname} it held within {num(s_rng, 1)} %',
                                                    'This one settles; today\'s keeps growing'], mk(sw_)),
        ]
        ro = [
            ruled_out('Swell and shrink from a load change', 'ruled out' if steam_ok else 'not yet checked',
                      f'HP steam flow stayed within {num(s_rng, 1)} % since the swing began.'),
            ruled_out('A feed pump or supply problem', 'ruled out' if supply_ok else 'not yet checked',
                      f'Feed pump discharge pressure stayed within {num(d_rng, 1)} %. The feed flow follows the valve, '
                      f'not the other way round.' if dp else 'No pump pressure found.'),
            ruled_out('A faulty level transmitter', 'unlikely',
                      'Feedwater flow ' + (f'({num(min(fw[onset:now + 1]), 0)}–{num(max(fw[onset:now + 1]), 0)} klb/h) ' if fw else '')
                      + 'swings with the valve. The water really is going in and out; the gauge glass will confirm.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'A control-loop interaction: single-element level control, '
                                     'made worse by manual valve moves', level,
                                     'Timing and steady process point at the loop; not yet proven'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The swing started after an input to the controller was taken out, the valve drives '
                                     'it, and steam flow and feed pressure are steady.',
                                     'The loop hasn\'t been put back in three-element control yet, so the cause is still '
                                     'a hypothesis.',
                                     'The swing dies out once the steam-flow input is restored and the valve is back in auto.',
                                     'The swing continues in three-element control. Then check the level transmitters and the '
                                     'valve positioner.'),
            'action': action(item, pack),
            'impact': (f'At the current growth the swing reaches the ±{num(p["trip_in"], 0)} in trip in about '
                       f'{dur(max(5, to_trip))}. A trip takes {uname} and its gas turbine offline.' if to_trip else
                       f'A trip at ±{num(p["trip_in"], 0)} in takes {uname} and its gas turbine offline.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Fuel gas heater trip cascade — archetype 09 (cascade failure)
# ═════════════════════════════════════════════════════════════════════════
class FuelHeaterCascade(Detector):
    id = 'ccgt.fuel_heater_cascade'
    name = 'Fuel gas heater lost, block runs back'
    archetype = '09 Cascade failure'
    applies_to = 'fuel gas heaters'
    summary = ('A fuel gas performance heater loses its heating water, the fuel cools out of its Wobbe band, and '
               'every gas turbine it feeds runs back — with the HRSGs and steam turbine following a few minutes later.')
    pipeline = [
        ('Heater', 'heating-water flow falls to near zero'),
        ('Fuel', 'fuel temperature and Modified Wobbe Index against their values just before'),
        ('Follow the fuel layer', 'every gas turbine fed from this heater: did each run back?'),
        ('Follow exhaust and steam', 'HRSG HP steam and steam turbine output, and how late they moved'),
        ('Conclusion', 'the order of events matches the flow path; recovery after the heater is restored → high'),
    ]
    definition = {
        'appliesTo': {'assetType': 'performance_heater'},
        'inputs': {'water': 'self.heater_water_flow_gpm', 'fuelTemp': 'self.fuel_gas_temp_f', 'mwi': 'self.modified_wobbe_index',
                   'gts': 'targets[fuel_gas] → unit.gen_output_mw', 'hrsgs': 'targets[exhaust_gas] → unit.hp_steam_flow_klb_h',
                   'st': 'targets[steam] → unit.gen_output_mw', 'gas': 'sibling[gas_chromatograph].wobbe_index_btu_scf',
                   'target': 'site.dispatch_target_mw'},
        'params': {'lost_frac': 0.1, 'mwi_band_pct': 5.0, 'runback_pct': 5.0, 'runback_within_min': 20,
                   'lag_min_min': 5, 'gas_band_pct': 1.0, 'recover_f': 30},
        'checks': [
            {'id': 'water', 'role': 'required', 'rule': 'heating water < lost_frac × the reading before'},
            {'id': 'wobbe', 'role': 'required', 'rule': 'MWI outside ±mwi_band_pct of its value before'},
            {'id': 'runback', 'role': 'required', 'rule': 'every fed gas turbine > runback_pct below its output before, within runback_within_min'},
            {'id': 'steam', 'role': 'supporting', 'independent': True, 'rule': 'HRSG steam and ST output fall, ≥ lag_min_min after the gas turbines'},
            {'id': 'gas', 'role': 'supporting', 'independent': True, 'rule': 'gas chromatograph Wobbe within ±gas_band_pct (the gas itself didn\'t change)'},
            {'id': 'restored', 'role': 'supporting', 'independent': True, 'rule': 'fuel back within recover_f °F of before after water is restored'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'fuel and output recovered once heating water was restored'},
    }

    def candidates(self, pack):
        return pack.of_type('performance_heater')

    def _path(self, pack, aid):
        gts = []
        for v in targets(pack, aid, 'fuel_gas'):
            u = pack.unit_of(v)
            if u and pack.has(u, 'gen_output_mw') and u not in gts:
                gts.append(u)
        hrsgs, sts = [], []
        for g in gts:
            for turb in pack.descendants(g):
                for t in targets(pack, turb, 'exhaust_gas'):
                    u = pack.unit_of(t)
                    if u and pack.has(u, 'hp_steam_flow_klb_h') and u not in hrsgs:
                        hrsgs.append(u)
        for h in hrsgs:
            for x in pack.descendants(h):
                for t in targets(pack, x, 'steam'):
                    u = pack.unit_of(t)
                    if u and u not in hrsgs and pack.has(u, 'gen_output_mw') and u not in sts:
                        sts.append(u)
        return gts, hrsgs, sts

    def evaluate(self, pack, aid):
        p = self.p
        water = pack.series(aid, 'heater_water_flow_gpm')
        mwi = pack.series(aid, 'modified_wobbe_index')
        gts, hrsgs, sts = self._path(pack, aid)
        if not gts:
            return Finding(aid, False)
        mw = {g: pack.series(g, 'gen_output_mw') for g in gts}
        for k in range(1, pack.n):
            if not (water[k - 1] > 0 and water[k] < p['lost_frac'] * water[k - 1]):
                continue
            for i in range(k, min(pack.n, k + pack.steps(p['runback_within_min']) + 1)):
                if abs(mwi[i] / mwi[k - 1] - 1) * 100 <= p['mwi_band_pct']:
                    continue
                if all(mw[g][i] < (1 - p['runback_pct'] / 100) * mw[g][k - 1] for g in gts):
                    return Finding(aid, True, i, lost=k, gts=gts, hrsgs=hrsgs, sts=sts, water=water, mwi=mwi, mw=mw)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i, k = f.aid, f.at, c['lost']
        gts, hrsgs, sts, water, mwi, mw = c['gts'], c['hrsgs'], c['sts'], c['water'], c['mwi'], c['mw']
        temp = pack.series(aid, 'fuel_gas_temp_f')
        b = k - 1
        tmin = min(range(k, now + 1), key=lambda q: temp[q])
        back = next((q for q in range(k, pack.n) if water[q] > 0.5 * water[b]), None)
        rec = next((q for q in range(back, pack.n) if abs(temp[q] - temp[b]) < p['recover_f']), None) if back else None
        restored = rec is not None
        gname = join_names([pack.name(g) for g in gts])
        # when each group first fell by more than 2 %
        end_ev = rec or now

        def first_drop(v):
            """When the signal had made half of its total fall (robust to noise at the start)."""
            lo_v = min(v[b:end_ev + 1])
            if lo_v > 0.98 * v[b]:
                return None
            half = v[b] - 0.5 * (v[b] - lo_v)
            return next((q for q in range(b, end_ev + 1) if v[q] <= half), None)
        g_drop = min(first_drop(mw[g]) for g in gts)
        steam = {h: pack.series(h, 'hp_steam_flow_klb_h') for h in hrsgs}
        stmw = {s: pack.series(s, 'gen_output_mw') for s in sts}
        h_drop = min((first_drop(v) for v in steam.values() if first_drop(v) is not None), default=None)
        s_drop = min((first_drop(v) for v in stmw.values() if first_drop(v) is not None), default=None)
        lag_ok = h_drop is not None and s_drop is not None and \
            pack.minutes_between(g_drop, s_drop) >= p['lag_min_min']
        gc = pack.child_of_type(pack.parent(aid), 'gas_chromatograph')
        gw = pack.series(gc, 'wobbe_index_btu_scf') if gc else None
        g_rng = (max(gw[b:(rec or now) + 1]) / min(gw[b:(rec or now) + 1]) - 1) * 100 if gw else None
        gas_ok = g_rng is not None and g_rng < p['gas_band_pct']
        site = pack.ancestors(aid)[-1]
        net, tgt = pack.series(site, 'net_output_mw'), pack.series(site, 'dispatch_target_mw')
        on_tgt = next((q for q in range(back or now, pack.n) if net[q] >= 0.99 * tgt[q]), now) if back else now
        short_mwh = sum(max(0.0, tgt[q] - net[q]) for q in range(b, on_tgt + 1)) * pack.step_min / 60
        level = 'high' if restored else 'medium'
        lo_w = min(mw[g][q] for g in gts for q in range(k, (rec or now) + 1))
        st_lo = min(v[q] for v in stmw.values() for q in range(k, (rec or now) + 1))
        win = [ts[max(0, b - 6)], ts[min(now, (rec or now) + 18)]]
        rel = lambda v: [100 * x / v[b] for x in v]
        band_hi, band_lo = mwi[b] * (1 + p['mwi_band_pct'] / 100), mwi[b] * (1 - p['mwi_band_pct'] / 100)

        checks = [
            check('water', 'Heater lost its heating water', 'required', MATCH,
                  f'{num(water[b], 0)} gpm at {ts[b]}, {num(water[k], 0)} gpm at {ts[k]}.',
                  'The heater warms the fuel with water from the HRSG IP section. No water, no heat.',
                  spark(water, [0, 220], window=win)),
            check('wobbe', 'Fuel out of its Wobbe band', 'required', MATCH,
                  f'Fuel temperature fell from {num(temp[b], 0)} °F to {num(temp[tmin], 0)} °F at {ts[tmin]}; MWI went '
                  f'from {num(mwi[b], 1)} to {num(max(mwi[k:(rec or now) + 1]), 1)} (band ±{num(p["mwi_band_pct"], 0)} %).',
                  'The combustors are tuned for one Modified Wobbe Index. Colder fuel pushes it out of band, and the '
                  'controls protect the combustors by cutting load.',
                  spark(mwi, [40, 53], [band_lo] * pack.n, [band_hi] * pack.n, window=win)),
            check('runback', f'{gname} ran back together', 'required', MATCH,
                  '. '.join(f'{pack.name(g)} {num(mw[g][b], 0)} → {num(min(mw[g][k:(rec or now) + 1]), 0)} MW' for g in gts)
                  + f', halfway down by {ts[g_drop]}.',
                  'Both units share this heater on the fuel-gas layer. A shared cause hits both at the same moment.',
                  spark(mw[gts[0]], nice_domain(*[mw[g] for g in gts], floor=0), window=win)),
            check('steam', 'Steam side followed, later', 'supporting', MATCH if lag_ok else NO_MATCH,
                  (f'Halfway down: gas turbines at {ts[g_drop]}, HRSG steam at {ts[h_drop]}, steam turbine at {ts[s_drop]} '
                   f'({dur(pack.minutes_between(g_drop, s_drop))} after the gas turbines). Steam turbine low point '
                   f'{num(st_lo, 0)} MW.'
                   if lag_ok else 'The steam side didn\'t lag the gas turbines as expected.'),
                  'Less exhaust energy means less steam, but the HRSGs hold heat, so the steam turbine drops minutes '
                  'later. That order is the flow path, not a coincidence.',
                  spark(stmw[sts[0]], nice_domain(stmw[sts[0]]), window=win) if sts else None),
            check('gas', 'The gas itself didn\'t change', 'supporting', MATCH if gas_ok else NO_MATCH,
                  (f'Gas chromatograph Wobbe index stayed within {num(g_rng, 2)} % through the event.' if gw else
                   'No gas analyser found.'),
                  'A separate analyser. If the gas supply had changed, the Wobbe would have moved before heating it.',
                  spark(gw, nice_domain(gw, pad=2), window=win) if gw else None),
            check('restored', 'Everything came back once the water did', 'supporting',
                  MATCH if restored else (PENDING if back is None else NO_MATCH),
                  (f'Heating water back at {ts[back]}; fuel within {p["recover_f"]} °F of normal by {ts[rec]}.' if restored else
                   'Heating water not restored yet.' if back is None else f'Water back at {ts[back]}, fuel still cold.'),
                  'Restoring the one cause cleared every downstream symptom, with no other repair.',
                  spark(temp, [80, 400], highlight=[ts[back], ts[rec]] if restored else None, window=win)),
        ]
        cs = [series('fuel', 'Fuel temperature', rel(temp), 'primary', 1)]
        for g in gts:
            cs.append(series(g, f'{pack.name(g)} output', rel(mw[g]), 'secondary', 1))
        for h in hrsgs:
            cs.append(series(h, f'{pack.name(h)} HP steam', rel(steam[h]), 'peer', 1))
        for s in sts:
            cs.append(series(s, f'{pack.name(s)} output', rel(stmw[s]), 'expected', 1))
        main = chart('% of before', [20, 110], cs, title='What we see',
                     caption=f'Each signal as a percentage of its value at {ts[b]}, just before the heater lost water. '
                             f'Fuel temperature goes first, then the gas turbines, then HRSG steam and the steam turbine. '
                             f'The rise above 100 % afterwards is the AGC target going up, not part of the event.',
                     markers=[marker(ts[k], 'Heating water lost')] + ([marker(ts[back], 'Water restored')] if back else []),
                     window=[ts[max(0, b - 6)], ts[min(now, (rec or now) + 24)]], decimals=0)
        grid = minutes_grid(-15, 90, 5)
        r = Rng(1606)
        tb_f = [(100 if m < 0 else (100 - 70 * (1 - math.exp(-m / 12)) if m < 40 else 30 + 70 * (1 - math.exp(-(m - 40) / 10))))
                + r.gauss(1) for m in grid]
        tb_g = [(100 if m < 5 else (85 if m < 70 else 100)) + r.gauss(0.6) for m in grid]
        pa_f = [(100 if m < 0 else 100 - 25 * min(1, m / 30)) + r.gauss(1) for m in grid]
        pa_g = [100 + r.gauss(0.6) for m in grid]
        tr_f = [100 + r.gauss(1) for m in grid]
        tr_g = [(100 if m < 0 else (100 if m < 5 else 0)) + (r.gauss(0.6) if m < 5 else 0) for m in grid]
        lf = aligned(rel(temp), k, pack.step_min, grid, 'min')
        lg = aligned(rel(mw[gts[0]]), k, pack.step_min, grid, 'min')
        live = 'Today'

        def pair(a, bb):
            return [ref_chart('Fuel temperature (% of before, min from water loss)', '%', [0, 115], grid, 'min', a, lf, live, 0),
                    ref_chart(f'{pack.name(gts[0])} output (% of before)', '%', [0, 115], grid, 'min', bb, lg, live, 0)]
        refs = [
            reference('valve', 'textbook', 'Textbook', 'Heating-water valve fails closed',
                      'Fuel cools within minutes, both gas turbines run back on Wobbe protection, and everything returns '
                      'once the valve is fixed and the fuel warms up.', 'match', 'Closest match',
                      ['Same order of events', 'Same recovery after the repair'], pair(tb_f, tb_g)),
            reference('partial', 'early', 'Early stage', 'Heater fouling or a sticking valve',
                      'Fuel temperature sags slowly and stays inside the band. No runback yet, but less margin.',
                      'partial', 'Same system, milder', ['Worth trending fuel temperature against its setpoint',
                                                         'Caught here, it\'s a maintenance job, not a derate'], pair(pa_f, pa_g)),
            reference('trip', 'lookalike', 'Look-alike', 'Gas turbine trip',
                      'One unit trips on its own protection. Output goes to zero, the fuel stays hot, and the other unit '
                      'carries on.', 'nomatch', 'Doesn\'t match',
                      ['Here fuel temperature is normal', f'Today both units ran back, neither tripped'], pair(tr_f, tr_g)),
        ]
        ro = [
            ruled_out('A change in the gas supply', 'ruled out' if gas_ok else 'not yet checked',
                      f'The gas chromatograph\'s Wobbe index stayed within {num(g_rng, 2)} %; only the fuel temperature changed.'
                      if gw else 'No analyser data.'),
            ruled_out('A fault on one gas turbine', 'ruled out',
                      f'{gname} ran back in the same interval. They share only the fuel supply.'),
            ruled_out('A dispatch instruction', 'ruled out',
                      f'The AGC target stayed at {num(tgt[b], 0)} MW; plant output fell to {num(min(net[k:(rec or now) + 1]), 0)} MW '
                      f'against it.'),
        ]
        return {
            'conclusion': conclusion('Cause' if restored else 'Most likely cause',
                                     'Fuel gas heater lost its heating water; the rest of the block followed', level,
                                     'Confirmed: all units recovered once heating water was restored' if restored
                                     else 'Order of events matches the fuel → gas turbine → steam path'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Heating water went first, then fuel temperature, then both gas turbines, then steam — '
                                     'and everything returned when the water did.' if restored else
                                     'The order of events follows the flow path.',
                                     None if restored else 'Heating water hasn\'t been restored yet.',
                                     None if restored else 'Fuel temperature and output recover once heating water is back.',
                                     'Output stays low with hot fuel. Then look at each gas turbine\'s own limits.',
                                     'Recovery after heating water was restored' if restored else None),
            'action': action(item, pack),
            'impact': f'About {num(short_mwh, 0)} MWh short of the AGC target from {ts[b]} until the block was back on '
                      f'target at {ts[on_tgt]}; the gas turbines were down '
                      f'to {num(lo_w, 0)} MW at the lowest.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. Hidden steam-cycle loss — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class HiddenSteamLoss(Detector):
    id = 'ccgt.hidden_steam_loss'
    name = 'On target, but losing steam'
    archetype = '08 Throughput illusion'
    applies_to = 'plants'
    summary = ('Net output on the dispatch target, but plant heat rate rising faster than the gas turbines explain, '
               'because the steam turbine makes less per gas-turbine MW than it did two hours ago.')
    pipeline = [
        ('Headline', 'net output against the AGC target: is anything visibly wrong?'),
        ('Compare like with like', '30-min averages now and 2 h ago, only when the dispatch target was the same and the '
                                   'block was on it throughout'),
        ('Split the heat rate', 'plant heat rate change against the gas turbines\' own heat rate change'),
        ('Steam turbine', 'its output against what the gas turbines\' output and the condenser backpressure predict'),
        ('Locate', 'steam bypass and drain valves reading closed while hot downstream'),
    ]
    definition = {
        'appliesTo': {'assetType': 'cc_plant'},
        'inputs': {'net': 'self.net_output_mw', 'target': 'self.dispatch_target_mw', 'heatRate': 'self.net_heat_rate_btu_kwh',
                   'gts': 'descendants[gas_turbine]: gen_output_mw, fuel_heat_input_mmbtu_h',
                   'st': 'descendants[steam_turbine].gen_output_mw', 'bp': 'descendants[condenser].condenser_backpressure_inhga',
                   'bypass': 'descendants[steam_bypass]: hp_bypass_position_pct, hp_bypass_downstream_temp_f'},
        'expected': {'model': 'ratio', 'formula': 'ST expected = ST(2 h ago) × GT MW / GT MW(2 h ago) × '
                                                  '(1 − bp_st_pct_per_0p1 % per 0.1 inHgA of extra backpressure)'},
        'params': {'window_h': 2, 'avg_min': 30, 'target_band_pct': 1.0, 'hr_rise_pct': 0.5, 'st_short_pct': 1.2,
                   'bp_st_pct_per_0p1': 0.6, 'gt_share_max': 0.5, 'bypass_rise_f': 100, 'valve_closed_pct': 1.0},
        'checks': [
            {'id': 'ontarget', 'role': 'required', 'rule': '|net − target| ≤ target_band_pct over the whole comparison, target unchanged'},
            {'id': 'heatrate', 'role': 'required', 'rule': 'plant heat rate (30-min mean) up > hr_rise_pct against window_h earlier'},
            {'id': 'steam', 'role': 'required', 'rule': 'ST output > st_short_pct below expected'},
            {'id': 'gts', 'role': 'supporting', 'rule': 'GT heat rate rise < gt_share_max × plant rise'},
            {'id': 'bypass', 'role': 'supporting', 'independent': True, 'rule': 'a bypass reads ≤ valve_closed_pct open while its downstream temperature is up > bypass_rise_f'},
        ],
        'confidence': {'low': 'required checks only', 'medium': 'a closed-reading valve runs hot downstream',
                       'high': 'loss located and confirmed on site (thermography or isolation)'},
    }

    def candidates(self, pack):
        return pack.of_type('cc_plant')

    def _ctx(self, pack, aid):
        d = pack.descendants(aid)
        gts = [x for x in d if pack.asset(x)['assetType'] == 'gas_turbine']
        sts = [x for x in d if pack.asset(x)['assetType'] == 'steam_turbine']
        conds = [x for x in d if pack.has(x, 'condenser_backpressure_inhga')]
        byps = [x for x in d if pack.has(x, 'hp_bypass_downstream_temp_f')]
        if not gts or not sts:
            return None
        gt = [sum(v) for v in zip(*[pack.series(g, 'gen_output_mw') for g in gts])]
        fuel = [sum(v) for v in zip(*[pack.series(g, 'fuel_heat_input_mmbtu_h') for g in gts])]
        st = [sum(v) for v in zip(*[pack.series(s, 'gen_output_mw') for s in sts])]
        bp = pack.series(conds[0], 'condenser_backpressure_inhga') if conds else [0.0] * pack.n
        return dict(gts=gts, sts=sts, byps=byps, gt=gt, fuel=fuel, st=st, bp=bp, conds=conds,
                    net=pack.series(aid, 'net_output_mw'), tgt=pack.series(aid, 'dispatch_target_mw'),
                    hr=pack.series(aid, 'net_heat_rate_btu_kwh'))

    def _at(self, pack, c, i):
        """Compare the 30-min average ending at i with the one window_h earlier, or None if not comparable."""
        p = self.p
        a, w = pack.steps(p['avg_min']), pack.steps(p['window_h'] * 60)
        r1 = i - w
        r0 = r1 - a + 1
        if r0 < 0:
            return None
        span = range(r0, i + 1)
        if len({c['tgt'][k] for k in span}) != 1:
            return None
        if any(abs(c['net'][k] - c['tgt'][k]) > p['target_band_pct'] / 100 * c['tgt'][k] for k in span):
            return None
        m = lambda v, lo, hi: mean_between(v, lo, hi)
        now_, ref = (i - a + 1, i), (r0, r1)
        hr_rise = 100 * (m(c['hr'], *now_) / m(c['hr'], *ref) - 1)
        gthr = lambda rng: m(c['fuel'], *rng) / m(c['gt'], *rng)
        gt_rise = 100 * (gthr(now_) / gthr(ref) - 1)
        dbp = m(c['bp'], *now_) - m(c['bp'], *ref)
        st_exp = m(c['st'], *ref) * m(c['gt'], *now_) / m(c['gt'], *ref) * (1 - p['bp_st_pct_per_0p1'] / 100 * dbp / 0.1)
        st_short = 100 * (1 - m(c['st'], *now_) / st_exp)
        return dict(hr_rise=hr_rise, gt_rise=gt_rise, st_short=st_short, st_exp=st_exp, dbp=dbp, ref=ref)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if c is None:
            return Finding(aid, False)
        for i in range(pack.n):
            x = self._at(pack, c, i)
            if x and x['hr_rise'] > p['hr_rise_pct'] and x['st_short'] > p['st_short_pct']:
                c['first'] = x
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        x = self._at(pack, c, now) or c['first']
        ref0, ref1 = x['ref']
        hr, net, tgt, gt, st, fuel = c['hr'], c['net'], c['tgt'], c['gt'], c['st'], c['fuel']
        ratio = [s / g for s, g in zip(st, gt)]
        gts_ok = x['gt_rise'] < p['gt_share_max'] * x['hr_rise']
        a = pack.steps(p['avg_min'])
        byp_hits = []
        for bx in c['byps']:
            pos = pack.series(bx, 'hp_bypass_position_pct')
            dt = pack.series(bx, 'hp_bypass_downstream_temp_f')
            rise = dt[now] - mean_between(dt, ref0, ref1)
            if max(pos[ref0:now + 1]) <= p['valve_closed_pct'] and rise > p['bypass_rise_f']:
                t0 = next(k for k in range(ref0, now + 1) if dt[k] - dt[ref0] > 10)
                byp_hits.append((bx, dt, pos, rise, t0))
        byp_ok = bool(byp_hits)
        level = 'medium' if byp_ok else 'low'
        st_name = join_names([pack.name(s) for s in c['sts']])
        stg_mw_lost = x['st_exp'] - mean_between(st, now - a + 1, now)
        extra_fuel = mean_between(fuel, now - a + 1, now) * (1 - 1 / (1 + x['hr_rise'] / 100))
        # a steady-running window for display
        start = next((k for k in range(pack.n) if len({tgt[q] for q in range(k, now + 1)}) == 1), 0)
        win = [ts[start], ts[now]]
        bx, dt, pos, rise, t0 = byp_hits[0] if byp_hits else (None, None, None, None, None)
        gt_hr = [f_ * 1000 / g for f_, g in zip(fuel, gt)]
        rel = lambda v, k0: [100 * (q / v[k0] - 1) for q in v]
        since = lambda v: [q if k >= start else None for k, q in enumerate(v)]   # sparks: the steady period only

        checks = [
            check('ontarget', 'Net output on target', 'required', MATCH,
                  f'{num(net[now], 0)} MW against the {num(tgt[now], 0)} MW AGC target, within '
                  f'{num(p["target_band_pct"], 0)} % since {ts[ref0]}.',
                  'This is why nothing alarms: the headline number is right. AGC makes up any loss with more gas.',
                  spark(since(net), nice_domain(net[start:], tgt[start:], pad=0.3), since(tgt), since(tgt), window=win)),
            check('heatrate', 'Plant heat rate up', 'required', MATCH,
                  f'{num(mean_between(hr, now - a + 1, now), 0)} Btu/kWh (last 30 min) against '
                  f'{num(mean_between(hr, ref0, ref1), 0)} at {ts[ref0]}–{ts[ref1]}: {signed(x["hr_rise"], 2)} %.',
                  'The same megawatts now cost more fuel.',
                  spark(since(hr), nice_domain(hr[start:], pad=0.2), window=win)),
            check('steam', 'Steam turbine short of what it should make', 'required', MATCH,
                  f'{st_name} {num(mean_between(st, now - a + 1, now), 1)} MW against {num(x["st_exp"], 1)} MW expected for '
                  f'this gas turbine output and backpressure ({signed(-x["st_short"], 1)} %).',
                  'In a combined cycle the steam turbine\'s share is free power from exhaust heat. Losing it means paying '
                  'for it with gas.',
                  spark(since(ratio), nice_domain(ratio[start:], pad=0.2), window=win, decimals=4)),
            check('gts', 'Not the gas turbines', 'supporting', MATCH if gts_ok else NO_MATCH,
                  f'Gas turbine heat rate {signed(x["gt_rise"], 2)} % over the same time (hotter air), against '
                  f'{signed(x["hr_rise"], 2)} % for the plant.',
                  'If the gas turbines were the problem, their own heat rate would carry the rise.',
                  spark(since(gt_hr), nice_domain(gt_hr[start:], pad=0.2), window=win)),
            check('bypass', 'A valve reading closed runs hot downstream', 'supporting', MATCH if byp_ok else NO_MATCH,
                  (f'{short(pack, bx)}: position {num(max(pos[ref0:now + 1]), 0)} %, downstream temperature '
                   f'{num(dt[ref0], 0)} °F at {ts[ref0]}, {num(dt[now], 0)} °F now, rising since {ts[t0]}.'
                   if byp_ok else 'No closed-reading valve with a hot downstream line.'),
                  'A separate sensor. Downstream of a closed valve the pipe should sit near condenser temperature. '
                  'Heat there means steam is passing the seat.',
                  spark(since(dt), [150, 850], window=win) if byp_ok else None),
        ]
        main = chart('% change', nice_domain(rel(hr, start)[start:], rel(gt_hr, start)[start:], [0], pad=0.2),
                     [series('plant', 'Plant net heat rate', rel(hr, start), 'primary', 2),
                      series('gt', 'Gas turbines\' own heat rate', rel(gt_hr, start), 'expected', 2)],
                     title='What we see',
                     caption=f'Heat rate change since {ts[start]}, when the AGC target last changed. The shaded gap is fuel '
                             f'the gas turbines\' own efficiency doesn\'t explain.',
                     shade_gap=['plant', 'gt'], decimals=2,
                     markers=[marker(ts[i], 'Flagged')] + ([marker(ts[t0], 'Bypass line warming')] if byp_ok else []),
                     window=win)
        grid = hours_grid(4, 0.25)
        r = Rng(1707)
        tb = [(0 if hh < 0.5 else -0.8 * (hh - 0.5)) + r.gauss(0.15) for hh in grid]
        tb_t = [230 + (0 if hh < 0.5 else 550 * (1 - math.exp(-(hh - 0.5) / 2.2))) + r.gauss(3) for hh in grid]
        dr = [-0.5 * hh + r.gauss(0.15) for hh in grid]
        dr_t = [230 + 180 * min(1, hh / 3) + r.gauss(3) for hh in grid]
        la = [-0.9 * hh + r.gauss(0.15) for hh in grid]
        la_t = [230 + r.gauss(3) for hh in grid]
        rratio = [100 * (q / mean_between(ratio, ref0, ref1) - 1) for q in ratio]
        lr = aligned(rratio, ref0, pack.step_min, grid)
        lt = aligned(dt, ref0, pack.step_min, grid) if byp_ok else [None] * len(grid)
        live = 'Today'

        def pair(a_, b_):
            return [ref_chart('Steam turbine MW per GT MW (% change, h)', '%', [-4, 1], grid, 'h', a_, lr, live, 1),
                    ref_chart('Valve downstream temperature', '°F', [150, 850], grid, 'h', b_, lt, live, 0)]
        refs = [
            reference('bypass', 'textbook', 'Textbook', 'HP bypass valve passing',
                      'Seat erosion lets a growing share of HP steam go straight to the condenser. The valve still reads 0 %; '
                      'the line downstream heats up and the steam turbine\'s share slides.', 'match', 'Closest match',
                      ['Same slide in the steam share', 'Same hot line behind a closed valve'], pair(tb, tb_t)),
            reference('drain', 'variant', 'Variant', 'Drain or vent valve passing',
                      'A smaller line, so a smaller loss that grows more slowly. Same fingerprint: hot downstream of a '
                      'closed valve.', 'partial', 'Same mechanism, other valve',
                      ['Thermography finds it on the rounds', 'Check drains too if the bypass reads cool'], pair(dr, dr_t)),
            reference('condenser', 'lookalike', 'Look-alike', 'Condenser losing vacuum',
                      'The steam share slides because backpressure rises, not because steam bypasses the turbine. No '
                      'valve runs hot.', 'nomatch', 'Doesn\'t match',
                      [f'Backpressure moved only {signed(x["dbp"], 2)} inHgA; the expected line already allows for it',
                       'Here nothing heats up downstream of a valve'], pair(la, la_t)),
        ]
        ro = [
            ruled_out('Hotter weather', 'ruled out',
                      f'The gas turbines\' own heat rate rose {signed(x["gt_rise"], 2)} %, less than half the plant\'s '
                      f'{signed(x["hr_rise"], 2)} %.'),
            ruled_out('Condenser backpressure', 'ruled out',
                      f'Backpressure moved {signed(x["dbp"], 2)} inHgA, worth about '
                      f'{num(abs(p["bp_st_pct_per_0p1"] * x["dbp"] / 0.1), 1)} % of steam turbine output. The expected line '
                      f'already includes it.'),
            ruled_out('A different load', 'ruled out', f'Same AGC target ({num(tgt[now], 0)} MW) throughout the comparison.'),
            ruled_out('Where the steam goes', 'not yet checked',
                      'The bypass is the leading candidate, but drains and other valves haven\'t been checked. '
                      'Thermography on the next round will tell.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'HP steam reaching the condenser without making power — a '
                                     'passing valve on the steam side is the leading candidate', level,
                                     'The loss is real; its location isn\'t confirmed'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Heat rate, steam turbine output and a hot line behind a closed valve all point at a '
                                     'steam-side loss.' if byp_ok else 'Heat rate and steam turbine output agree.',
                                     'Nobody has checked the valve on site yet, and other passing valves would look the same '
                                     'from the control room.',
                                     'Thermography shows the bypass valve body and downstream line hot.',
                                     'The bypass is cold on thermography. Then check drains, vents and the attemperators.'),
            'action': action(item, pack),
            'impact': f'About {num(stg_mw_lost, 1)} MW of steam turbine output lost now, made up by about '
                      f'{num(extra_fuel, 0)} MMBtu/h of extra gas.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. Ammonia slip from over-feeding — archetype 13 (quality drift)
# ═════════════════════════════════════════════════════════════════════════
class ScrOverfeedSlip(Detector):
    id = 'ccgt.scr_overfeed_slip'
    name = 'Ammonia slip climbing toward the limit'
    archetype = '13 Quality drift'
    applies_to = 'SCR systems'
    summary = ('Ammonia slip rising steadily above the sister HRSG\'s and past the watch level, while stack NOx looks '
               'better than ever: the SCR is being fed more ammonia than the NOx needs.')
    pipeline = [
        ('Slip', 'against the watch level (60 % of the 5 ppm limit) and the sister HRSG'),
        ('Trend', 'slope over the last 90 minutes'),
        ('Why', 'NH₃/NOx molar ratio on the ammonia skid, stack NOx on the CEMS, catalyst temperature'),
        ('Recovery', 'did slip come back once the ratio did?'),
        ('Conclusion', 'high ratio + low NOx + rising slip → over-feeding, not a failing catalyst'),
    ]
    definition = {
        'appliesTo': {'assetType': 'scr_system'},
        'inputs': {'slip': 'self.ammonia_slip_ppm', 'sister': 'other scr_system.ammonia_slip_ppm',
                   'ratio': 'child[ammonia_skid].nh3_nox_ratio', 'stackNox': 'child[cems_analyzer].stack_nox_ppm',
                   'catTemp': 'child[scr_catalyst].scr_inlet_temp_f'},
        'params': {'limit_ppm': 5.0, 'watch_ppm': 3.0, 'sustain_min': 20, 'sister_gap_ppm': 0.8, 'slope_window_min': 90,
                   'min_slope_ppm_h': 0.3, 'ratio_high': 0.9, 'cat_band_f': 5.0, 'recovered_ppm': 2.5,
                   'recover_within_min': 60},
        'checks': [
            {'id': 'watch', 'role': 'required', 'rule': 'slip > watch_ppm for sustain_min'},
            {'id': 'sister', 'role': 'required', 'rule': 'slip − sister > sister_gap_ppm'},
            {'id': 'rising', 'role': 'required', 'rule': 'slope(slip, slope_window_min) > min_slope_ppm_h'},
            {'id': 'ratio', 'role': 'supporting', 'independent': True, 'rule': 'NH₃/NOx ratio > ratio_high'},
            {'id': 'nox', 'role': 'supporting', 'independent': True, 'rule': 'stack NOx below the sister\'s'},
            {'id': 'catalyst', 'role': 'supporting', 'rule': 'catalyst inlet temperature within cat_band_f of the sister'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'slip < recovered_ppm within recover_within_min of the ratio returning below ratio_high'},
        ],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'slip recovered once the ammonia ratio was brought back'},
    }

    def candidates(self, pack):
        return pack.of_type('scr_system')

    def evaluate(self, pack, aid):
        p = self.p
        sis = [x for x in pack.of_type('scr_system') if x != aid][0]
        slip, sslip = pack.series(aid, 'ammonia_slip_ppm'), pack.series(sis, 'ammonia_slip_ppm')
        high = B.gt(slip, p['watch_ppm'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(high, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            slope = B.slope_per_hour(slip, i, sw, pack.step_min)
            if slip[i] - sslip[i] > p['sister_gap_ppm'] and slope is not None and slope > p['min_slope_ppm_h']:
                return Finding(aid, True, i, sis=sis, slip=slip, sslip=sslip, alert=s0, slope=slope)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i, sis = f.aid, f.at, c['sis']
        unit, sunit = pack.unit_of(aid), pack.unit_of(sis)
        uname, sname = pack.name(unit), pack.name(sunit)
        slip, sslip = c['slip'], c['sslip']
        sk, ssk = pack.child_of_type(aid, 'ammonia_skid'), pack.child_of_type(sis, 'ammonia_skid')
        ce, sce = pack.child_of_type(aid, 'cems_analyzer'), pack.child_of_type(sis, 'cems_analyzer')
        ca, sca = pack.child_of_type(aid, 'scr_catalyst'), pack.child_of_type(sis, 'scr_catalyst')
        ratio, sratio = pack.series(sk, 'nh3_nox_ratio'), pack.series(ssk, 'nh3_nox_ratio')
        nox, snox = pack.series(ce, 'stack_nox_ppm'), pack.series(sce, 'stack_nox_ppm')
        ct, sct = pack.series(ca, 'scr_inlet_temp_f'), pack.series(sca, 'scr_inlet_temp_f')
        peak = max(range(i, now + 1), key=lambda k: slip[k])
        end = peak
        ratio_back = next((k for k in range(peak, pack.n) if ratio[k] < p['ratio_high']), None)
        rec = next((k for k in range(ratio_back, min(pack.n, ratio_back + pack.steps(p['recover_within_min']) + 1))
                    if slip[k] < p['recovered_ppm']), None) if ratio_back is not None else None
        recovered = rec is not None
        ratio_ok = ratio[i] > p['ratio_high']
        nox_ok = nox[i] < snox[i]
        cat_ok = abs(ct[i] - sct[i]) < p['cat_band_f']
        independent = sum([ratio_ok, nox_ok, recovered])
        level = 'high' if recovered else ('medium' if independent else 'low')
        margin_h = (p['limit_ppm'] - slip[i]) / c['slope'] if c['slope'] > 0 else None
        sd = [0, 6]
        checks = [
            check('watch', 'Slip past the watch level', 'required', MATCH,
                  f'{num(slip[i], 2)} ppm at {ts[i]}, above {num(p["watch_ppm"], 1)} ppm since {ts[c["alert"]]}. '
                  f'Peak {num(slip[peak], 2)} ppm at {ts[peak]}; the limit is {num(p["limit_ppm"], 0)} ppm.',
                  'Slip is ammonia the catalyst didn\'t use. It forms ammonium bisulfate that fouls the cold end of the HRSG.',
                  spark(slip, sd, threshold_value=p['watch_ppm'])),
            check('sister', f'Well above {sname}', 'required', MATCH,
                  f'{sname}: {num(sslip[i], 2)} ppm at the same time, at the same load.',
                  'Same gas turbine type and load. The difference is in this SCR\'s dosing or catalyst.',
                  spark(slip, sd, sslip, sslip)),
            check('rising', 'Still rising', 'required', MATCH,
                  f'{signed(c["slope"], 2)} ppm per hour over the {dur(p["slope_window_min"])} before {ts[i]}'
                  + (f'; at that rate the limit is about {dur(60 * margin_h)} away.' if margin_h else '.'),
                  'Slip rises steeply once the ammonia ratio passes about 0.9, so a slow start doesn\'t mean a slow finish.',
                  spark(slip, sd, highlight=[ts[max(0, i - pack.steps(p['slope_window_min']))], ts[i]])),
            check('ratio', 'Ammonia ratio high', 'supporting', MATCH if ratio_ok else NO_MATCH,
                  f'NH₃/NOx molar ratio {num(ratio[i], 3)} at {ts[i]}, up from {num(ratio[0], 3)} at {ts[0]}. '
                  f'{sname}: {num(sratio[i], 3)}.',
                  'A separate measurement on the ammonia skid. More ammonia than the NOx can use ends up as slip.',
                  spark(ratio, [0.8, 1.0], sratio, sratio, p['ratio_high'], decimals=3)),
            check('nox', 'Stack NOx looks unusually good', 'supporting', MATCH if nox_ok else NO_MATCH,
                  f'{num(nox[i], 2)} ppm against {sname}\'s {num(snox[i], 2)} ppm.',
                  'The CEMS, a separate analyser. Over-feeding buys a little extra NOx removal at the cost of slip.',
                  spark(nox, [0, 3], snox, snox)),
            check('catalyst', 'Catalyst at normal temperature', 'supporting', MATCH if cat_ok else NO_MATCH,
                  f'{num(ct[i], 0)} °F; {sname} {num(sct[i], 0)} °F.',
                  'A catalyst running too cold or too hot converts less. Its temperature was normal.',
                  spark(ct, nice_domain(ct, sct), sct, sct)),
            check('recovered', 'Slip came back once the ratio did', 'supporting',
                  MATCH if recovered else (PENDING if ratio_back is None else NO_MATCH),
                  (f'Ratio back under {p["ratio_high"]} at {ts[ratio_back]}; slip {num(slip[rec], 2)} ppm by {ts[rec]}.'
                   if recovered else 'The ratio is still high.' if ratio_back is None else
                   f'Ratio back at {ts[ratio_back]}, but slip is still high.'),
                  'Taking away the extra ammonia took away the slip. The catalyst was fine.',
                  spark(slip, sd, threshold_value=p['recovered_ppm'], highlight=[ts[ratio_back], ts[rec]] if recovered else None)),
        ]
        main = chart('ppm', sd, [series('slip', f'{uname} ammonia slip', slip, 'primary', 2),
                                 series('sister', f'{sname} ammonia slip', sslip, 'expected', 2)],
                     title='What we see', decimals=1,
                     caption=f'{uname} ammonia slip against {sname}. Watch level {num(p["watch_ppm"], 0)} ppm; permit limit '
                             f'{num(p["limit_ppm"], 0)} ppm.',
                     thresholds=[threshold(p['watch_ppm'], 'Watch'), threshold(p['limit_ppm'], 'Limit')],
                     markers=[marker(ts[i], 'Flagged')] + ([marker(ts[ratio_back], 'Ratio back to normal')] if ratio_back else []))
        grid = hours_grid(5, 0.25, -1)
        r = Rng(1808)
        over = [(2.2 if hh < 0 else 2.2 + 0.25 * hh + 0.12 * hh * hh) if hh < 3.25 else 1.9 + 0.2 * r.gauss(1) for hh in grid]
        over = [v + r.gauss(0.06) for v in over]
        age = [2.2 + 0.08 * (hh + 1) + r.gauss(0.06) for hh in grid]
        aig = [(2.2 if hh < 0 else 3.3) + r.gauss(0.2) for hh in grid]
        ls = aligned(slip, c['alert'], pack.step_min, grid)
        live = f'{uname}, today'
        mk = lambda a: [ref_chart('Ammonia slip (h from the watch level)', 'ppm', sd, grid, 'h', a, ls, live, 1,
                                  [threshold(p['limit_ppm'], 'Limit')])]
        refs = [
            reference('setpoint', 'textbook', 'Textbook', 'NOx setpoint too low',
                      'Someone asks the SCR for less NOx than it needs to make. The controller adds ammonia; slip climbs '
                      'faster and faster until the setpoint is put back.', 'match', 'Closest match',
                      ['Same accelerating climb', 'Same fast recovery once the ratio came down'], mk(over)),
            reference('ageing', 'variant', 'Variant', 'Catalyst ageing',
                      'Slip creeps up over months as the catalyst loses activity, and NOx creeps up with it. The ratio '
                      'stays normal.', 'partial', 'Same symptom, slower cause',
                      ['Months, not hours', f'NOx rises here; on {uname} it fell'], mk(age)),
            reference('aig', 'lookalike', 'Look-alike', 'Injection grid out of balance',
                      'A step up in slip after a nozzle plugs: too much ammonia in one part of the duct, too little in '
                      'another. NOx rises too.', 'nomatch', 'Doesn\'t match',
                      ['A step, not a climb', 'NOx doesn\'t improve'], mk(aig)),
        ]
        ro = [
            ruled_out('Catalyst failing or ageing', 'ruled out' if recovered else 'unlikely',
                      'Slip fell back to normal as soon as the ammonia ratio came down, with no work on the catalyst.'
                      if recovered else 'NOx removal got better, not worse.'),
            ruled_out('Catalyst temperature', 'ruled out', f'{num(ct[i], 0)} °F, the same as {sname}.'),
            ruled_out('More NOx from the gas turbine', 'ruled out',
                      f'SCR inlet NOx {num(pack.series(aid, "scr_inlet_nox_ppm")[i], 1)} ppm, normal for this load.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     'The SCR was being over-fed with ammonia (NOx setpoint too low), not failing', level,
                                     'Confirmed: slip fell once the ammonia ratio was brought back' if recovered
                                     else 'Ratio high and NOx low: over-feeding'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The ammonia ratio was high, NOx unusually low, and slip came back as soon as the ratio did.'
                                     if recovered else 'The ammonia ratio is high and NOx unusually low.',
                                     None if recovered else 'The ratio hasn\'t been brought back yet.',
                                     None if recovered else 'Slip falls once the NOx setpoint is restored.',
                                     'Slip stays high at a normal ratio. Then test the catalyst and the injection grid.',
                                     'Recovery once the ratio was restored' if recovered else None),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Combustion dynamics excursions — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
class DynamicsExcursions(Detector):
    id = 'ccgt.dynamics_excursions'
    name = 'Combustion dynamics excursions'
    archetype = '12 Recurring micro-events'
    applies_to = 'DLN combustors'
    summary = ('Short, one-interval spikes in combustion dynamics on one gas turbine, repeating more often, while '
               'the sister unit on the same fuel stays quiet.')
    pipeline = [
        ('Find the spikes', 'intervals where hot-tone dynamics jump above 2 psi and well above the intervals either side'),
        ('Count them', 'how many in the last 3 hours, and whether they are getting closer together'),
        ('Local or shared', 'the sister unit at the same moments, and the fuel\'s Wobbe index'),
        ('Context', 'NOx bump at each spike, baseline creep, compressor inlet temperature'),
        ('Conclusion', 'repeated spikes on one unit only → its tuning margin; the spectrum says why'),
    ]
    definition = {
        'appliesTo': {'assetType': 'dln_combustor'},
        'inputs': {'dyn': 'self.combustion_dynamics_psi', 'nox': 'self.gt_exit_nox_ppm',
                   'sister': 'other dln_combustor.combustion_dynamics_psi',
                   'fuel': 'sources[fuel_gas] of child gas_control_valve: modified_wobbe_index',
                   'cit': 'sibling[gt_inlet_filter].compressor_inlet_temp_f'},
        'params': {'spike_psi': 2.0, 'above_neighbours_psi': 0.8, 'window_min': 180, 'min_events': 3,
                   'nox_bump_ppm': 1.0, 'creep_psi': 0.1, 'fuel_band_pct': 1.0},
        'checks': [
            {'id': 'spikes', 'role': 'required', 'rule': '≥ min_events spikes (dyn > spike_psi and > neighbours + above_neighbours_psi) in window_min'},
            {'id': 'local', 'role': 'required', 'rule': 'no sister spike at the same intervals'},
            {'id': 'closer', 'role': 'supporting', 'rule': 'gaps between spikes shrinking'},
            {'id': 'nox', 'role': 'supporting', 'independent': True, 'rule': 'NOx > neighbours + nox_bump_ppm at most spikes'},
            {'id': 'fuel', 'role': 'supporting', 'independent': True, 'rule': 'MWI within ±fuel_band_pct over the window'},
            {'id': 'creep', 'role': 'supporting', 'rule': 'baseline (median without spikes, last hour) up > creep_psi on the first spike\'s hour'},
        ],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'dynamics spectrum identifies the tone and a tuning change stops the spikes'},
    }

    def candidates(self, pack):
        return pack.of_type('dln_combustor')

    def _spikes(self, pack, aid):
        p = self.p
        d = pack.series(aid, 'combustion_dynamics_psi')
        out = []
        for k in range(1, pack.n):
            nb = [d[k - 1]] + ([d[k + 1]] if k + 1 < pack.n else [])
            if d[k] > p['spike_psi'] and d[k] - max(nb) > p['above_neighbours_psi']:
                out.append(k)
        return out, d

    def evaluate(self, pack, aid):
        p = self.p
        spikes, d = self._spikes(pack, aid)
        sis = [x for x in pack.of_type('dln_combustor') if x != aid][0]
        s_spikes, _ = self._spikes(pack, sis)
        w = pack.steps(p['window_min'])
        for i in range(pack.n):
            recent = [k for k in spikes if i - w < k <= i]
            if len(recent) >= p['min_events'] and not set(recent) & set(s_spikes):
                return Finding(aid, True, i, spikes=spikes, dyn=d, sis=sis)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, sis = f.aid, c['sis']
        unit = pack.unit_of(aid)
        uname, sname = pack.name(unit), pack.name(pack.unit_of(sis))
        spikes, dyn = c['spikes'], c['dyn']
        sdyn = pack.series(sis, 'combustion_dynamics_psi')
        nox = pack.series(aid, 'gt_exit_nox_ppm')
        first = spikes[0]
        gaps = [pack.minutes_between(a, b) for a, b in zip(spikes, spikes[1:])]
        closer = len(gaps) >= 2 and gaps[-1] < gaps[0] and sum(1 for a, b in zip(gaps, gaps[1:]) if b <= a) >= len(gaps) - 2
        bumps = [nox[k] - max(nox[k - 1], nox[k + 1] if k + 1 < pack.n else nox[k - 1]) for k in spikes]
        nox_ok = sum(1 for b in bumps if b > p['nox_bump_ppm']) >= 0.75 * len(spikes)
        gcv = pack.child_of_type(aid, 'gas_control_valve')
        htr = next((x for x in pack.sources(gcv, 'fuel_gas') if pack.has(x, 'modified_wobbe_index')), None) if gcv else None
        mwi = pack.series(htr, 'modified_wobbe_index') if htr else None
        m_rng = (max(mwi[first:now + 1]) / min(mwi[first:now + 1]) - 1) * 100 if mwi else None
        fuel_ok = m_rng is not None and m_rng < 2 * p['fuel_band_pct']
        quiet = [None if k in spikes else v for k, v in enumerate(dyn)]
        h = pack.steps(60)
        base_then = median(quiet[max(0, first - h):first])
        base_now = median(quiet[now - h + 1:now + 1])
        creep_ok = base_now - base_then > p['creep_psi']
        inlet = pack.child_of_type(unit, 'gt_inlet_filter')
        cit = pack.series(inlet, 'compressor_inlet_temp_f') if inlet else None
        level = 'medium' if (nox_ok or fuel_ok) else 'low'
        dd = [0, 4]
        sp_times = [ts[k] for k in spikes]
        checks = [
            check('spikes', f'{len(spikes)} excursions since {ts[first]}', 'required', MATCH,
                  f'At {join_names(sp_times)}: {num(min(dyn[k] for k in spikes), 2)}–{num(max(dyn[k] for k in spikes), 2)} psi, '
                  f'each lasting one interval, against a baseline of about {num(base_now, 2)} psi.',
                  'Hot-tone dynamics near 1 psi are normal; 2–3 psi is high. Each spike is a moment the flame is close to '
                  'its stability edge.',
                  spark(dyn, dd, threshold_value=p['spike_psi'])),
            check('local', f'Only on {uname}', 'required', MATCH,
                  f'{sname} stayed at {num(min(sdyn[first:now + 1]), 2)}–{num(max(sdyn[first:now + 1]), 2)} psi over the same time.',
                  'Both units burn the same gas in the same air. Anything they share would show on both.',
                  spark(sdyn, dd, threshold_value=p['spike_psi'])),
            check('closer', 'Coming closer together', 'supporting', MATCH if closer else NO_MATCH,
                  f'{join_names([dur(g) for g in gaps])} apart.' if gaps else 'Only one so far.',
                  'The unit is spending more of its time near the edge as the afternoon heats up.', None),
            check('nox', 'A NOx bump with each one', 'supporting', MATCH if nox_ok else NO_MATCH,
                  f'GT exit NOx rose {num(min(bumps), 1)}–{num(max(bumps), 1)} ppm above the intervals either side at the spikes.',
                  'A separate analyser. A flame shifting toward a hotter zone makes more NOx, so these are real flame '
                  'events, not a noisy pressure probe.',
                  spark(nox, nice_domain(nox[first - 12:], pad=0.2), window=[ts[first - 12], ts[now]])),
            check('fuel', 'Fuel quality steady', 'supporting', MATCH if fuel_ok else NO_MATCH,
                  f'Modified Wobbe Index within {num(m_rng, 2)} % since {ts[first]}.' if mwi else 'No fuel data found.',
                  'A fuel swing pushes the flame toward instability. The fuel didn\'t move.',
                  spark(mwi, [40, 45], window=[ts[first - 12], ts[now]]) if mwi else None),
            check('creep', 'Baseline creeping up', 'supporting', MATCH if creep_ok else NO_MATCH,
                  f'Median between spikes {num(base_then, 2)} psi in the hour before {ts[first]}, {num(base_now, 2)} psi in '
                  f'the last hour.' + (f' Compressor inlet {num(cit[first], 0)} → {num(cit[now], 0)} °F.' if cit else ''),
                  'Hotter inlet air changes the flame. A rising floor means the margin is shrinking between spikes too.',
                  spark(quiet, [0.5, 2.5])),
        ]
        main = chart('psi', dd, [series('dyn', f'{uname} dynamics (hot tone)', dyn, 'primary', 2),
                                 series('sister', f'{sname} dynamics', sdyn, 'expected', 2)],
                     title='What we see', decimals=1,
                     caption=f'{uname} combustion dynamics against {sname}. Markers are the excursions.',
                     thresholds=[threshold(p['spike_psi'], 'High')],
                     markers=[marker(ts[k], f'{n + 1}') for n, k in enumerate(spikes)])
        grid = hours_grid(4, 1 / 12, -0.5)
        r = Rng(1909)
        at = lambda hh, times: any(abs(hh - t) < 1 / 24 for t in times)
        tb_t = [0, 0.9, 1.5, 2.0, 2.3, 2.55, 2.75, 2.9]
        tb = [(2.7 + 0.1 * hh if at(hh, tb_t) else 1.05 + 0.08 * max(0, hh)) + r.gauss(0.04) for hh in grid]
        ea = [(2.3 if at(hh, [0, 2.2]) else 1.05) + r.gauss(0.04) for hh in grid]
        fu = [(1.0 if hh < 0 else 2.1 if hh < 1 else max(1.0, 2.1 - (hh - 1) * 1.1)) + r.gauss(0.04) for hh in grid]
        ld = aligned(dyn, first, pack.step_min, grid)
        live = f'{uname}, today'
        mk = lambda a: [ref_chart('Dynamics (h from the first excursion)', 'psi', dd, grid, 'h', a, ld, live, 1,
                                  [threshold(p['spike_psi'], 'High')])]
        refs = [
            reference('margin', 'textbook', 'Textbook', 'Tuning margin lost on a hot afternoon',
                      'Excursions start as the air heats up and come closer together; the unit is retuned or the evening '
                      'cools it down.', 'match', 'Closest match', ['Same one-interval spikes', 'Same shrinking gaps'], mk(tb)),
            reference('few', 'early', 'Early stage', 'A few isolated excursions',
                      'One or two spikes in an afternoon. Worth logging; not yet a pattern.',
                      'partial', f'Where {uname} was at {ts[spikes[1]] if len(spikes) > 1 else ts[first]}',
                      ['Pull the spectrum for the first ones', 'Check whether other units show any'], mk(ea)),
            reference('fuel', 'lookalike', 'Look-alike', 'Fuel quality swing',
                      'A burst of richer gas raises dynamics on every unit together, for as long as it lasts, not in spikes.',
                      'nomatch', 'Doesn\'t match', [f'{sname} would show it too', 'A plateau, not spikes'], mk(fu)),
        ]
        ro = [
            ruled_out('Fuel quality', 'ruled out' if fuel_ok else 'not yet checked',
                      f'MWI stayed within {num(m_rng, 2)} %, and {sname} on the same fuel had no excursions.' if mwi else
                      'No fuel data.'),
            ruled_out('A faulty dynamics probe', 'unlikely' if nox_ok else 'not yet checked',
                      'NOx, from a separate analyser, bumped at the same intervals.'),
            ruled_out('Load changes', 'ruled out',
                      f'{uname} output stayed within '
                      f'{num(min(pack.series(unit, "gen_output_mw")[first:now + 1]), 0)}–'
                      f'{num(max(pack.series(unit, "gen_output_mw")[first:now + 1]), 0)} MW, with no ramps at the spikes.'),
            ruled_out('Which can, which tone', 'not yet checked',
                      'The 5-minute data can\'t say. The high-speed dynamics record for each event can.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'Combustion tuning margin shrinking on {uname} as the day heats up',
                                     level, 'Pattern is clear; the cause needs the dynamics spectrum'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The spikes are on one unit only, with the fuel steady, and NOx confirms each one.',
                                     'The 5-minute data shows that it happens, not which can or tone. That needs the '
                                     'high-speed record.',
                                     'The spectrum shows one tone growing with inlet temperature.',
                                     'The spectrum is clean. Then check the dynamics probe and its cabling.'),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 10. Ammonia supply lost — archetype 11 (hard block)
# ═════════════════════════════════════════════════════════════════════════
class AmmoniaSupplyLoss(Detector):
    id = 'ccgt.ammonia_supply_loss'
    name = 'Ammonia supply to the SCR lost'
    archetype = '11 Hard block'
    applies_to = 'ammonia skids'
    summary = ('Ammonia flow to an SCR drops to zero while there is still NOx to remove, and stack NOx at the CEMS '
               'downstream shoots up within minutes.')
    pipeline = [
        ('Flow', 'ammonia flow from normal to near zero within 10 minutes'),
        ('Demand', 'SCR inlet NOx still normal: the ammonia was needed'),
        ('Follow the dosing layer', 'catalyst, then the stack CEMS on the exhaust layer: did NOx rise?'),
        ('Rule out', 'catalyst temperature and gas turbine NOx unchanged'),
        ('Recovery', 'NOx back under the limit once flow returns; the permit hour average'),
    ]
    definition = {
        'appliesTo': {'assetType': 'ammonia_skid'},
        'inputs': {'flow': 'self.ammonia_flow_lb_h', 'inletNox': 'parent[scr_system].scr_inlet_nox_ppm',
                   'stackNox': 'targets[chemical_dosing] → targets[exhaust_gas].stack_nox_ppm',
                   'catTemp': 'targets[chemical_dosing].scr_inlet_temp_f'},
        'params': {'normal_lb_h': 50, 'lost_frac': 0.1, 'within_min': 10, 'demand_ppm': 5.0, 'nox_rise_ratio': 2.0,
                   'nox_within_min': 20, 'limit_ppm': 2.0, 'cat_band_f': 10},
        'checks': [
            {'id': 'lost', 'role': 'required', 'rule': 'flow > normal_lb_h, then < lost_frac × that within within_min'},
            {'id': 'demand', 'role': 'required', 'rule': 'SCR inlet NOx > demand_ppm'},
            {'id': 'nox', 'role': 'required', 'rule': 'stack NOx > nox_rise_ratio × before within nox_within_min'},
            {'id': 'catalyst', 'role': 'supporting', 'rule': 'catalyst temperature within cat_band_f of before'},
            {'id': 'restored', 'role': 'supporting', 'independent': True, 'rule': 'NOx < limit_ppm again after flow returns'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'NOx recovered as soon as ammonia flow returned'},
    }

    def candidates(self, pack):
        return pack.of_type('ammonia_skid')

    def _path(self, pack, aid):
        cats = targets(pack, aid, 'chemical_dosing')
        cems = [t for c_ in cats for t in targets(pack, c_, 'exhaust_gas') if pack.has(t, 'stack_nox_ppm')]
        return (cats[0] if cats else None), (cems[0] if cems else None)

    def evaluate(self, pack, aid):
        p = self.p
        cat, cems = self._path(pack, aid)
        if cems is None:
            return Finding(aid, False)
        flow = pack.series(aid, 'ammonia_flow_lb_h')
        inlet = pack.series(pack.parent(aid), 'scr_inlet_nox_ppm')
        nox = pack.series(cems, 'stack_nox_ppm')
        w = pack.steps(p['within_min'])
        for i in range(1, pack.n):
            normal = [k for k in range(max(0, i - w), i) if flow[k] > p['normal_lb_h']]
            if not normal or flow[i] >= p['lost_frac'] * flow[normal[-1]] or inlet[i] <= p['demand_ppm']:
                continue
            b = normal[-1]
            for j in range(b, min(pack.n, b + pack.steps(p['nox_within_min']) + 1)):
                if nox[j] > p['nox_rise_ratio'] * nox[b]:
                    return Finding(aid, True, max(i, j), cat=cat, cems=cems, flow=flow, inlet=inlet, nox=nox, before=b)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i, b = f.aid, f.at, c['before']
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        flow, inlet, nox = c['flow'], c['inlet'], c['nox']
        drop = b + 1
        back = next((k for k in range(i, pack.n) if flow[k] > 0.5 * flow[b]), None)
        peak = max(range(drop, (back or now) + 2 if back else now + 1), key=lambda k: nox[k])
        under = next((k for k in range(back, pack.n) if nox[k] < p['limit_ppm']), None) if back else None
        restored = under is not None
        ct = pack.series(c['cat'], 'scr_inlet_temp_f')
        cat_ok = max(abs(v - ct[b]) for v in ct[b:(back or now) + 1]) < p['cat_band_f']
        scr = pack.parent(aid)
        rem = pack.series(scr, 'nox_removal_pct')
        # the clock hour holding the peak, for the permit average
        hh = ts[peak][:2]
        hour = [k for k, t in enumerate(ts) if t[:2] == hh]
        avg = B.mean([nox[k] for k in hour])
        comb = None
        for hp in pack.sources(scr, 'exhaust_gas'):
            for turb in pack.sources(hp, 'exhaust_gas'):
                comb = next((x for x in pack.sources(turb, 'gas_path') if pack.has(x, 'gt_exit_nox_ppm')), comb)
        gtn = pack.series(comb, 'gt_exit_nox_ppm') if comb else None
        level = 'high' if restored else 'medium'
        fixes = [x for x in done_work(pack, [aid]) if back is not None and abs(x[1] - back) <= 2]
        win = [ts[max(0, b - 12)], ts[min(now, (under or now) + 12)]]
        checks = [
            check('lost', 'Ammonia flow went to zero', 'required', MATCH,
                  f'{num(flow[b], 0)} lb/h at {ts[b]}, {num(flow[i], 0)} lb/h at {ts[i]}'
                  + (f', back at {ts[back]}.' if back else ', still off.'),
                  'No reagent, no NOx removal: the catalyst needs ammonia to work.',
                  spark(flow, [0, 140], window=win)),
            check('demand', 'The NOx was still there', 'required', MATCH,
                  f'SCR inlet NOx {num(inlet[i], 1)} ppm, as before.',
                  'Rules out the controller cutting ammonia because there was nothing to treat.',
                  spark(inlet, [0, 15], window=win)),
            check('nox', 'Stack NOx shot up', 'required', MATCH,
                  f'{num(nox[b], 2)} ppm before, {num(nox[peak], 2)} ppm at {ts[peak]}. NOx removal fell from '
                  f'{num(rem[b], 0)} % to {num(min(rem[drop:(back or now) + 1]), 0)} %.',
                  'The CEMS sits downstream on the exhaust layer. The short lag is ammonia stored on the catalyst running out.',
                  spark(nox, [0, 10], threshold_value=p['limit_ppm'], window=win)),
            check('catalyst', 'Catalyst temperature unchanged', 'supporting', MATCH if cat_ok else NO_MATCH,
                  f'{num(min(ct[b:(back or now) + 1]), 0)}–{num(max(ct[b:(back or now) + 1]), 0)} °F through the event.'
                  + (f' GT exit NOx {num(min(gtn[b:(back or now) + 1]), 1)}–{num(max(gtn[b:(back or now) + 1]), 1)} ppm.' if gtn else ''),
                  'A cold catalyst or a burst of gas turbine NOx could also raise stack NOx. Neither happened.',
                  spark(ct, nice_domain(ct, pad=1), window=win)),
            check('restored', 'NOx recovered once ammonia returned', 'supporting',
                  MATCH if restored else (PENDING if back is None else NO_MATCH),
                  (f'Flow back at {ts[back]}' + (f' ("{fixes[0][0]["text"]}")' if fixes else '') +
                   f'; NOx under {num(p["limit_ppm"], 0)} ppm by {ts[under]}.' if restored else
                   'Flow not restored yet.' if back is None else 'Flow is back but NOx is still high.'),
                  'Put the reagent back and the symptom cleared: the supply was the whole story.',
                  spark(nox, [0, 10], highlight=[ts[back], ts[under]] if restored else None, window=win)),
        ]
        main = chart('ppm', [0, 10], [series('nox', f'{uname} stack NOx', nox, 'primary', 2)],
                     title='What we see', decimals=0,
                     caption=f'{uname} stack NOx at the CEMS. The ammonia pump tripped and flow went to zero.',
                     thresholds=[threshold(p['limit_ppm'], 'Permit (1-h average)')],
                     markers=[marker(ts[drop], 'Ammonia flow lost')] + ([marker(ts[back], 'Flow back')] if back else []),
                     window=[ts[max(0, b - 24)], ts[min(now, (under or now) + 24)]])
        grid = minutes_grid(-15, 60, 5)
        r = Rng(2010)
        tb = [(1.5 if m < 0 else (1.5 + 7.5 * (1 - math.exp(-m / 5)) if m < 20 else max(1.3, 8.4 * math.exp(-(m - 20) / 4))))
              + r.gauss(0.08) for m in grid]
        lo = [(1.5 if m < 5 else 1.5 + 2.5 * (1 - math.exp(-(m - 5) / 10))) + r.gauss(0.08) for m in grid]
        gt_ = [(1.5 if m < 0 else 4 if m < 25 else 1.5) + r.gauss(0.08) for m in grid]
        ln = aligned(nox, drop, pack.step_min, grid, 'min')
        live = f'{uname}, today'
        mk = lambda a: [ref_chart('Stack NOx (min from flow loss)', 'ppm', [0, 10], grid, 'min', a, ln, live, 0,
                                  [threshold(p['limit_ppm'], 'Permit')])]
        refs = [
            reference('pump', 'textbook', 'Textbook', 'Forwarding pump trip, standby started by hand',
                      'Flow stops, NOx climbs within 5–15 minutes as stored ammonia runs out, and falls within minutes '
                      'of flow returning.', 'match', 'Closest match', ['Same lag and peak', 'Same recovery'], mk(tb)),
            reference('partial', 'variant', 'Variant', 'Flow control valve sticking',
                      'Ammonia flow falls but not to zero. NOx rises less, and more slowly.', 'partial',
                      'Same system, partial loss', ['Look at valve position against demand', 'Same permit risk if it lasts'],
                      mk(lo)),
            reference('gt', 'lookalike', 'Look-alike', 'Gas turbine NOx excursion',
                      'The gas turbine makes more NOx for a while; ammonia flow rises to follow and the stack moves a little.',
                      'nomatch', 'Doesn\'t match', ['Ammonia flow up here; today it went to zero',
                                                     'GT NOx stayed flat today'], mk(gt_)),
        ]
        ro = [
            ruled_out('Catalyst temperature', 'ruled out', f'Held within {num(p["cat_band_f"], 0)} °F.'),
            ruled_out('More NOx from the gas turbine', 'ruled out',
                      f'GT exit NOx {num(min(gtn[b:(back or now) + 1]), 1)}–{num(max(gtn[b:(back or now) + 1]), 1)} ppm, as before.'
                      if gtn else 'Inlet NOx unchanged.'),
            ruled_out('A CEMS fault', 'ruled out', 'NOx removal, calculated from the SCR inlet analyser, fell at the same time.'),
            ruled_out('Why the standby didn\'t start', 'not yet checked', 'The data shows it didn\'t; the auto-start logic '
                      'needs testing.'),
        ]
        return {
            'conclusion': conclusion('Cause' if restored else 'Most likely cause',
                                     'Ammonia supply to the SCR stopped (forwarding pump trip, standby didn\'t start)', level,
                                     'Confirmed: NOx fell once ammonia flow returned' if restored else 'Flow lost, NOx up'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Flow stopped, NOx rose downstream with the expected lag, and fell when flow returned.'
                                     if restored else 'Flow stopped and NOx rose downstream.',
                                     None if restored else 'Flow isn\'t back yet.',
                                     None if restored else 'NOx falls once ammonia flow is restored.',
                                     'NOx stays high with ammonia flowing. Then check the catalyst and the injection grid.',
                                     'Recovery once ammonia flow returned' if restored else None),
            'action': action(item, pack),
            'impact': f'The {hh}:00–{int(hh) + 1:02d}:00 average was {num(avg, 2)} ppm against the {num(p["limit_ppm"], 1)} ppm '
                      f'limit' + (': one reportable excess-emission hour.' if avg > p['limit_ppm'] else '.'),
        }


# ═════════════════════════════════════════════════════════════════════════
# 11. CEMS calibration deadline — archetype 14 (compliance at risk)
# ═════════════════════════════════════════════════════════════════════════
class CemsCalibrationDeadline(Detector):
    id = 'ccgt.cems_calibration_deadline'
    name = 'CEMS daily calibration overdue'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'CEMS analyzers'
    summary = ('A stack CEMS has gone more than 24 hours without a passing daily calibration. Its data stays valid '
               'for 26 hours (40 CFR 75 App. B), so there is a hard deadline and a job that takes time.')
    pipeline = [
        ('Counter', 'hours since the last passing daily calibration, from the analyser'),
        ('Overdue', 'past the 24-hour daily interval without resetting'),
        ('Deadline', 'when the 26-hour grace runs out'),
        ('Plan', 'is a calibration task open, and does the time left cover the work?'),
        ('Conclusion', 'an action with a deadline, not a diagnosis'),
    ]
    definition = {
        'appliesTo': {'assetType': 'cems_analyzer'},
        'inputs': {'hours': 'self.hours_since_cal_h', 'task': 'open QUALITY_CHECK work item on this asset'},
        'params': {'daily_h': 24.0, 'grace_h': 26.0, 'work_min': 50},
        'checks': [
            {'id': 'overdue', 'role': 'required', 'rule': 'hours > daily_h'},
            {'id': 'nopass', 'role': 'required', 'rule': 'hours never reset since the start of the day'},
            {'id': 'time', 'role': 'supporting', 'rule': 'minutes to grace_h against work_min'},
            {'id': 'task', 'role': 'supporting', 'rule': 'calibration task exists and is open'},
        ],
        'confidence': {'n/a': 'a compliance deadline, not a diagnosis'},
    }

    def candidates(self, pack):
        return pack.of_type('cems_analyzer')

    def evaluate(self, pack, aid):
        p = self.p
        h = pack.series(aid, 'hours_since_cal_h')
        for i in range(pack.n):
            if h[i] > p['daily_h'] and all(b >= a for a, b in zip(h[:i + 1], h[1:i + 1])):
                return Finding(aid, True, i, h=h)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i, h = f.aid, f.at, c['h']
        unit = pack.unit_of(aid)
        uname = pack.name(unit)
        left_min = (p['grace_h'] - h[now]) * 60
        now_min = int(ts[now][:2]) * 60 + int(ts[now][3:])
        dl = now_min + left_min
        deadline = f'{int(dl // 60):02d}:{int(round(dl % 60)):02d}'
        last = now_min - h[now] * 60
        last_txt = f'{int((last % 1440) // 60):02d}:{int(round(last % 60)):02d}' + (' yesterday' if last < 0 else '')
        tasks = open_work(pack, [aid])
        task = tasks[0] if tasks else None
        short_by = p['work_min'] - left_min
        hy = nice_domain(h, [p['grace_h']], pad=0.1)
        win = [ts[0], ts[now]]
        checks = [
            check('overdue', 'Daily calibration overdue', 'required', MATCH,
                  f'{num(h[i], 2)} h since the last passing calibration at {ts[i]}, when it was flagged; {num(h[now], 2)} h '
                  f'now. The last pass was at {last_txt}.',
                  'The analyser should pass a calibration every day. Past 24 hours, today\'s was missed.',
                  spark(h, hy, threshold_value=p['daily_h'], window=win)),
            check('nopass', 'No pass since', 'required', MATCH,
                  'The counter has run on without resetting all day.',
                  'A passing calibration resets it to zero. It hasn\'t reset.', None),
            check('time', f'{dur(max(0, left_min))} left, about {dur(p["work_min"])} of work', 'supporting',
                  MATCH if left_min < p['work_min'] else NO_MATCH,
                  f'Data goes out of control at {deadline} ({num(p["grace_h"], 0)} h after the last pass). '
                  + (f'The job needs about {dur(short_by)} more than is left.' if short_by > 0 else
                     'There is still time if it starts now.'),
                  'Out-of-control hours need substitute data and are reportable, so every minute past the deadline counts.',
                  spark(h, hy, threshold_value=p['grace_h'], window=win)),
            check('task', 'Calibration task open', 'supporting', MATCH if task else NO_MATCH,
                  (f'"{task["text"]}", due {task["dueAt"][11:16]}, not started.' if task else 'No calibration task found.'),
                  'The fix is people and gas cylinders, not a setpoint. It has to be on someone\'s list now.', None),
        ]
        main = chart('h', hy, [series('h', f'{uname} CEMS: hours since daily calibration', h, 'primary', 2)],
                     title='What we see',
                     caption=f'Hours since {uname}\'s CEMS last passed its daily calibration.',
                     thresholds=[threshold(p['daily_h'], 'Daily'), threshold(p['grace_h'], 'Data invalid')],
                     markers=[marker(ts[i], 'Overdue')], decimals=0)
        grid = minutes_grid(-120, 60, 15)
        tgt_idx = now + left_min / pack.step_min
        lv = []
        for m in grid:
            k = tgt_idx + m / pack.step_min
            lv.append(h[int(round(k))] if abs(k - round(k)) < 0.05 and 0 <= round(k) <= now else None)
        ok = [p['grace_h'] + m / 60 if m < -20 else 0.0 for m in grid]
        late = [p['grace_h'] + m / 60 if m < 25 else 0.0 for m in grid]
        early = [(p['daily_h'] - 2 + (m + 120) / 60 if m < -90 else 0.0) for m in grid]
        live = 'Today'
        mk = lambda a: [ref_chart('Hours since calibration (min from the deadline)', 'h', [0, 30], grid, 'min', a, lv, live, 0,
                                  [threshold(p['grace_h'], 'Data invalid')])]
        refs = [
            reference('ontime', 'textbook', 'Textbook', 'Manual calibration passes in time',
                      'The cylinder is swapped and a manual calibration passes before the 26-hour mark. No data lost.',
                      'partial', 'Only if it starts now', [f'Needs about {dur(p["work_min"])}', f'{dur(max(0, left_min))} left'],
                      mk(ok)),
            reference('late', 'variant', 'What to avoid', 'Calibration passes late',
                      'The calibration passes after the deadline. The hours in between are out of control and need '
                      'substitute data.', 'nomatch', 'Likely today',
                      ['Tell the environmental coordinator now', 'Log the out-of-control period'], mk(late)),
            reference('early', 'lookalike', 'Look-alike', 'Late but inside the daily window',
                      'A calibration that runs an hour or two late but still inside 24 hours. Nothing to report.',
                      'nomatch', 'Not today', ['Today it is already past 24 hours',
                                               f'{num(h[now], 1)} h since the last pass'], mk(early)),
        ]
        return {
            'conclusion': conclusion('What\'s needed', f'Pass a manual calibration on the {uname} CEMS before {deadline}',
                                     'n/a', 'A compliance deadline, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': [], 'excluded': None,
            'confidence': confidence('n/a', 'This is a regulatory clock, read straight from the analyser, not something '
                                            'the data had to diagnose.'),
            'action': action(item, pack),
        }


DETECTORS = [BfpBearingWear(), CompressorFouling(), ExhaustThermocoupleFault(), TowerCoolingLoss(),
             DrumLevelOscillation(), FuelHeaterCascade(), HiddenSteamLoss(), ScrOverfeedSlip(), DynamicsExcursions(),
             AmmoniaSupplyLoss(), CemsCalibrationDeadline()]


def main():
    pack, out, report, path = run_pack(REPO, 'ccgt', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
