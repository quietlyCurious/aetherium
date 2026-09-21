#!/usr/bin/env python3
"""Lodestar Pipeline — detectors and explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every pipeline detector on every asset it applies to, using only the
pack's runtime files in public/data/pipeline/, and writes
public/data/pipeline/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus
each detector's definition and where it fired today.

    python3 ModelAndData/industries/pipeline/generate.py     # the data
    python3 ModelAndData/industries/pipeline/explain.py      # the explanations

Detectors never read generate.py's scenario constants. If a detector
misses a scenario, or fires where no attention item exists, the run report
says so and the exit code is 1 for a miss.

Two inputs aren't telemetry and are declared below as external feeds, the
way wind's explain.py declares its dispatch instruction: today's OFO notice
and the pipeline's nomination-cycle calendar (both from the pipeline's
commercial system in production).

Standard library only.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'ModelAndData', 'tools'))

from detectors import blocks as B                     # noqa: E402
from detectors.build import (Detector, Finding, Rng, MATCH, NO_MATCH, PENDING, aligned, band, chart,  # noqa: E402
                           check, dur, marker, nice_domain, num, reference, ruled_out, run_pack, print_report,
                           series, signed, spark, threshold)

# ── External feeds (not telemetry) ──────────────────────────────────────
# Today's Operational Flow Order, as posted by the pipeline (in production,
# from the pipeline's informational postings / commercial system).
OFO = {'posted': '07:00', 'tolerancePct': 2.0, 'source': 'Lodestar OFO notice (hot-weather power burn)'}
# The pipeline's nomination calendar for intraday cycles (tariff): when each
# cycle closes and when a renomination made in it takes effect.
GAS_DAY_START = '09:00'
NOMINATION_CYCLES = [
    {'cycle': 'ID1', 'deadline': '10:00', 'effective': '14:00'},
    {'cycle': 'ID2', 'deadline': '12:30', 'effective': '16:00'},
    {'cycle': 'ID3', 'deadline': '17:00', 'effective': '20:00'},
]

STATION_TYPES = ('turbine_compressor_station', 'recip_compressor_station')


# ── Small shared helpers ─────────────────────────────────────────────────
def tmin(t):
    return int(t[:2]) * 60 + int(t[3:5])


def hhmm(m):
    m = int(round(m))
    return f'{(m // 60) % 24:02d}:{m % 60:02d}'


def targets(pack, aid, layer):
    """Assets with a relationship edge OUT of aid on the given layer."""
    return [e['targetAssetId'] for e in pack.relationships
            if e['sourceAssetId'] == aid and e['layer'] == layer]


def downstream_chain(pack, aid):
    """Facilities in gas-flow order downstream of aid (first branch that continues the mainline)."""
    out, cur, seen = [], aid, {aid}
    while True:
        nxt = [t for t in targets(pack, cur, 'gas_flow') if pack.asset(t)['assetLevel'] == 'facility' and t not in seen]
        # the mainline continues through segments and stations; deliveries end a branch
        main = [t for t in nxt if pack.asset(t)['assetType'] in STATION_TYPES + ('pipeline_segment',)]
        if not main:
            return out
        cur = main[0]
        seen.add(cur)
        out.append(cur)


def mean_between(values, i0, i1):
    return B.mean(values[max(0, i0):i1 + 1])


def median(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    n = len(vals)
    return vals[n // 2] if n % 2 else 0.5 * (vals[n // 2 - 1] + vals[n // 2])


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


def maintenance_records(item, after_time, words):
    """Field and maintenance entries logged on the item after a time that mention
    one of `words` (the part this detector is about). This is the pack's
    maintenance log as the app shows it — an inspection result, not telemetry."""
    out = []
    for w in item['detail'].get('whatChanged', []):
        if w.get('source') in ('Maintenance', 'Field Check') and tmin(w['time']) >= tmin(after_time):
            if any(x in w['description'].lower() for x in words):
                out.append(w)
    return out


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


def dom(*arrays, pad=0.08, floor=None, ceil=None):
    """nice_domain that ignores None and survives empty arrays."""
    arrs = [[v for v in a if v is not None] for a in arrays]
    arrs = [a for a in arrs if a]
    return [round(v, 9) for v in nice_domain(*arrs, pad=pad, floor=floor, ceil=ceil)]


def win(pack, i0, i1):
    return [pack.ts[max(0, i0)], pack.ts[min(pack.now, i1)]]


def short_name(pack, aid):
    """'Wren' for 'Wren Compressor Station', 'Bexley' for 'Bexley City Gate' — for sentences."""
    n = pack.name(aid)
    for tail in (' Compressor Station', ' City Gate', ' Receipt', ' Delivery', ' Interconnect'):
        if n.endswith(tail):
            return n[:-len(tail)]
    return n


def unit_name(pack, uid):
    """'Wren CU-2': a compressor unit named with its station."""
    return f'{short_name(pack, pack.parent(uid))} {pack.name(uid)}'


def unit_running(pack, uid, min_flow=1.0):
    key = 'unit_flow_mmscfd' if pack.has(uid, 'unit_flow_mmscfd') else 'recip_unit_flow_mmscfd'
    return [v > min_flow for v in pack.series(uid, key)]


# ═════════════════════════════════════════════════════════════════════════
# 1. Dry gas seal leakage rising — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class DryGasSealLeak(Detector):
    id = 'pipeline.dry_gas_seal_leak'
    name = 'Dry gas seal leakage rising'
    archetype = '05 Component degradation'
    applies_to = 'dry gas seals'
    summary = ('A compressor\'s primary seal vent flow climbing steadily above what its sister seals and its own '
               'normal offset explain, with the unit\'s speed unchanged: more gas is getting across the seal faces.')
    pipeline = [
        ('Find peers', 'every other dry gas seal on the line whose unit is running (compressor flow above zero)'),
        ('Expected value', 'this seal\'s own first-hour offset from the peers, plus the peers\' median now — so '
                           'anything that moves every seal (gas conditions, suction pressure) cancels out'),
        ('Residual', 'actual − expected vent flow: leakage the gas conditions don\'t explain'),
        ('Checks', 'above expected · rising gradually · sustained · seal gas filter DP · vibration · speed'),
        ('Conclusion', 'all required checks → raise an item; the seal gas filter DP, a separate sensor, sets confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'dry_gas_seal_system'},
        'inputs': {'vent': 'self.primary_vent_flow_scfm', 'filter': 'self.seal_gas_filter_dp_psid',
                   'supply': 'self.seal_gas_supply_dp_psid', 'speed': 'parent[unit].unit_speed_pct',
                   'vib': 'sources[layer=seal_gas].comp_vibration_mils'},
        'peers': {'same': 'assetType', 'count': 'unit running (compressor flow > 1 MMscf/d)'},
        'expected': {'model': 'offset', 'target': 'vent',
                     'formula': 'peerMedian(vent) now + (own − peerMedian) over the first baseline_min'},
        'params': {'baseline_min': 60, 'rise_scfm': 0.5, 'watch_scfm': 0.15, 'sustain_min': 30,
                   'slope_window_min': 60, 'min_slope_scfm_h': 0.2, 'max_step_scfm': 0.3,
                   'filter_rise_psid': 0.5, 'vib_band_mils': 0.15, 'speed_band_pct': 3.0,
                   'alarm_scfm': 6.0, 'trip_scfm': 8.0},
        'checks': [
            {'id': 'high', 'role': 'required', 'rule': 'residual > rise_scfm'},
            {'id': 'gradual', 'role': 'required', 'rule': 'slope(residual, slope_window_min) > min_slope_scfm_h and maxStep(since onset) < max_step_scfm'},
            {'id': 'sustained', 'role': 'required', 'rule': 'residual > rise_scfm for sustain_min'},
            {'id': 'filter', 'role': 'supporting', 'independent': True, 'rule': 'filter DP up > filter_rise_psid on its own baseline, peers flat'},
            {'id': 'vib', 'role': 'supporting', 'rule': 'shaft vibration within ±vib_band_mils of its baseline'},
            {'id': 'speed', 'role': 'supporting', 'rule': 'unit speed within ±speed_band_pct over the last hour'},
        ],
        'ruleOut': ['seal gas header or gas quality', 'higher load or suction pressure', 'vent flowmeter fault',
                    'rotor or bearing problem'],
        'confidence': {'low': 'required checks only', 'medium': 'seal gas filter DP agrees',
                       'high': 'confirmed by secondary-vent reading or seal inspection'},
        'references': ['textbook: face wear, swapped out before trip', 'variant: liquid contamination', 'look-alike: flowmeter drift'],
    }

    def candidates(self, pack):
        return pack.of_type('dry_gas_seal_system')

    def _ctx(self, pack, aid):
        p = self.p
        peers = [a for a in pack.of_type('dry_gas_seal_system') if a != aid]
        runs = {a: unit_running(pack, pack.parent(a)) for a in peers + [aid]}
        vent = pack.series(aid, 'primary_vent_flow_scfm')
        pv = {a: pack.series(a, 'primary_vent_flow_scfm') for a in peers}
        med = [median([pv[a][k] for a in peers if runs[a][k]]) for k in range(pack.n)]
        nb = pack.steps(p['baseline_min'])
        own_off = B.mean([vent[k] - med[k] for k in range(nb) if runs[aid][k] and med[k] is not None])
        exp = [None if m is None or own_off is None else m + own_off for m in med]
        res = [None if (e is None or not runs[aid][k]) else vent[k] - e for k, e in enumerate(exp)]
        return dict(peers=peers, runs=runs, vent=vent, pv=pv, med=med, exp=exp, res=res, own_off=own_off, nb=nb)

    def evaluate(self, pack, aid):
        p = self.p
        if not any(unit_running(pack, pack.parent(aid))):
            return Finding(aid, False)
        c = self._ctx(pack, aid)
        res = c['res']
        hot = B.gt(res, p['rise_scfm'])
        watch = B.gt(res, p['watch_scfm'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(c['nb'], pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            while onset > c['nb'] and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(res, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_scfm_h'] and B.max_step(res, onset, i) < p['max_step_scfm']:
                c.update(onset=onset, alert=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        uid = pack.parent(aid)
        uname = unit_name(pack, uid)
        vent, exp, res = c['vent'], c['exp'], c['res']
        onset, alert, nb = c['onset'], c['alert'], c['nb']
        runs = c['runs']
        running_peers = [a for a in c['peers'] if runs[a][now]]
        idle = [a for a in c['peers'] if not runs[a][now]]

        slope = B.slope_per_hour(res, now, pack.steps(p['slope_window_min']), pack.step_min)
        slope30 = B.slope_per_hour(vent, now, pack.steps(30), pack.step_min)
        step = B.max_step(res, onset, now)
        eta = (p['alarm_scfm'] - vent[now]) / slope30 * 60 if slope30 and slope30 > 0 else None

        flt = pack.series(aid, 'seal_gas_filter_dp_psid')
        f_base = mean_between(flt, 0, nb - 1)
        f_peer = {a: pack.series(a, 'seal_gas_filter_dp_psid') for a in running_peers}
        f_peer_d = [v[now] - mean_between(v, 0, nb - 1) for v in f_peer.values()]
        filter_ok = flt[now] - f_base > p['filter_rise_psid'] and max(abs(d) for d in f_peer_d) < p['filter_rise_psid']
        f_lo = [min(v[k] - mean_between(v, 0, nb - 1) for v in f_peer.values()) for k in range(pack.n)]
        f_hi = [max(v[k] - mean_between(v, 0, nb - 1) for v in f_peer.values()) for k in range(pack.n)]
        f_rel = [v - f_base for v in flt]

        comp = next((a for a in pack.sources(aid, 'seal_gas') if pack.has(a, 'comp_vibration_mils')), None)
        vib = pack.series(comp, 'comp_vibration_mils') if comp else None
        v_base = mean_between(vib, onset - pack.steps(60), onset) if vib else None
        vib_ok = vib is not None and max(abs(v - v_base) for v in vib[onset:now + 1]) < p['vib_band_mils']

        speed = pack.series(uid, 'unit_speed_pct')
        hr = pack.steps(60)
        sp_rng = max(speed[now - hr:now + 1]) - min(speed[now - hr:now + 1])
        speed_ok = sp_rng < p['speed_band_pct']
        supply = pack.series(aid, 'seal_gas_supply_dp_psid')
        station = pack.parent(uid)
        suction = pack.series(station, 'station_suction_pressure_psig')

        sisters = [a for a in running_peers if pack.parent(pack.parent(a)) == station]
        sis = sisters[0] if sisters else running_peers[0]
        sis_name = unit_name(pack, pack.parent(sis))
        sis_v = pack.series(sis, 'primary_vent_flow_scfm')

        independent = 1 if filter_ok else 0
        level = 'medium' if independent else 'low'
        y_res = dom(res, [-0.3, p['rise_scfm'] * 1.2], pad=0.05)

        checks = [
            check('high', 'Venting more than its sister seals explain', 'required', MATCH,
                  f'{num(vent[now], 2)} scfm now against {num(exp[now], 2)} scfm expected '
                  f'({signed(res[now], 2)} scfm). Alert level is +{num(p["rise_scfm"], 1)} scfm.',
                  'Gas that gets across worn or damaged seal faces leaves through the primary vent. The expected '
                  'line moves with the other seals, so gas conditions cancel out.',
                  spark(res, y_res, threshold_value=p['rise_scfm'])),
            check('gradual', 'Rising steadily, not jumping', 'required', MATCH,
                  f'{signed(slope, 2)} scfm per hour over the last {dur(p["slope_window_min"])}, and faster now '
                  f'({signed(slope30, 2)} scfm/h over the last 30 min). Largest {pack.step_min}-min step: {num(step, 2)} scfm.',
                  'Face wear grows gradually and speeds up. A meter or wiring fault usually shows up as a jump.',
                  spark(res, y_res, highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained, not a passing spike', 'required', MATCH,
                  f'Above +{num(p["rise_scfm"], 1)} scfm since {ts[alert]} ({dur(pack.minutes_between(alert, now))}). '
                  f'Above +{num(p["watch_scfm"], 2)} scfm since {ts[onset]}.',
                  f'Needs {dur(p["sustain_min"])} above the alert level, so a pressure transient doesn\'t trigger it.',
                  spark(res, y_res, threshold_value=p['rise_scfm'], highlight=[ts[alert], ts[now]])),
            check('filter', 'Seal gas filter DP rising with it', 'supporting', MATCH if filter_ok else NO_MATCH,
                  f'{num(f_base, 2)} psid in the first hour, {num(flt[now], 2)} psid now. The other running seals moved '
                  f'{num(min(f_peer_d), 2)} to {signed(max(f_peer_d), 2)} psid.',
                  'A separate sensor. A leaking seal draws more seal gas, so more flows through the filter.',
                  spark(f_rel, dom(f_rel, f_lo, f_hi), f_lo, f_hi)),
            check('vib', 'Shaft vibration steady', 'supporting', MATCH if vib_ok else NO_MATCH,
                  (f'{num(vib[now], 2)} mils now, {num(v_base, 2)} mils before the rise.' if vib else 'No vibration reading.'),
                  'A rub or a bearing problem would show on the shaft first. This points at the seal faces themselves.',
                  spark(vib, dom(vib, [0])) if vib else None),
            check('speed', 'At the same speed', 'supporting', MATCH if speed_ok else NO_MATCH,
                  f'{uname} speed stayed within {num(sp_rng, 1)} points over the last hour ({num(speed[now], 1)} % now).',
                  'Seal leakage rises with speed and sealed pressure. With both steady, the change is in the seal.',
                  spark(speed, dom(speed, pad=0.2), window=win(pack, onset, now))),
        ]

        main = chart('scfm', dom(vent, exp, [p['alarm_scfm']], pad=0.05, floor=0),
                     [series('actual', f'{uname} primary vent flow', vent, 'primary', 2),
                      series('expected', 'Expected (its sister seals + its normal offset)', exp, 'expected', 2)],
                     title='What we see',
                     caption=f'{uname}\'s primary seal vent flow against what the other running seals say it should '
                             f'read. The shaded gap is leakage that gas conditions don\'t explain.',
                     shade_gap=['actual', 'expected'],
                     thresholds=[threshold(p['alarm_scfm'], 'Alarm'), ],
                     markers=[marker(ts[onset], 'Divergence begins'), marker(ts[alert], f'Alert: +{num(p["rise_scfm"], 1)} scfm')])
        peer_chart = chart('scfm', dom(*[pack.series(a, 'primary_vent_flow_scfm') for a in running_peers], vent, floor=0),
                           [series(a, unit_name(pack, pack.parent(a)), pack.series(a, 'primary_vent_flow_scfm'), 'peer', 2)
                            for a in running_peers] + [series('self', uname, vent, 'primary', 2)],
                           caption=f'Primary vent flow, every running unit on the line.')

        # Reference examples (hours since onset); shapes follow RESEARCH.md §5 #5.
        h_live = pack.minutes_between(onset, now) / 60
        grid = hours_grid(max(6, round(h_live + 1.5)), 0.25)
        r = Rng(111)
        wear = lambda h, a, b: 0.0 if h <= 0 else a * h + b * h * h
        tb = [wear(h, 0.35, 0.12) + r.gauss(0.03) for h in grid]
        tb_f = [wear(h, 0.18, 0.05) + r.gauss(0.03) for h in grid]
        li = [(0.0 if h < 1 else 0.9 + 0.1 * (h - 1)) + (0.6 if 2.5 < h < 3.5 else 0) + r.gauss(0.05) for h in grid]
        li_f = [(0.0 if h < 1 else 0.9 + 0.35 * (h - 1)) + r.gauss(0.03) for h in grid]
        fm = [0.22 * h + r.gauss(0.03) for h in grid]
        fm_f = [r.gauss(0.03) for h in grid]
        lr = aligned(res, onset, pack.step_min, grid)
        lf = aligned([v - f_base for v in flt], onset, pack.step_min, grid)
        live = f'{uname}, today'

        def pair(a, b):
            return [ref_chart('Vent flow above expected', 'scfm', dom(a, lr, pad=0.05), grid, 'h', a, lr, live, 2),
                    ref_chart('Seal gas filter DP change', 'psid', dom(b, lf, pad=0.05), grid, 'h', b, lf, live, 2)]
        refs = [
            reference('wear', 'textbook', 'Textbook', 'Face wear, swapped before the trip',
                      'Leakage climbs slowly for hours, then faster. Filter DP follows. The unit is swapped to standby '
                      'before the high-high vent trip.',
                      'match', 'Closest match', ['Same accelerating climb', 'Filter DP rising alongside, as here'], pair(tb, tb_f)),
            reference('liquid', 'variant', 'Variant', 'Liquid in the seal gas',
                      'Condensate or oil reaches the seal faces. Leakage steps up and bursts, and the filter loads up fast.',
                      'partial', 'Same symptom, different cause',
                      [f'{uname} climbs smoothly, without bursts', 'Check the seal gas filter drains before blaming the faces'],
                      pair(li, li_f)),
            reference('meter', 'lookalike', 'Look-alike', 'Vent flowmeter drift',
                      'The flowmeter reads high and creeps up. The seal is fine, so filter DP stays flat and the local '
                      'rotameter disagrees.',
                      'nomatch', 'Doesn\'t match',
                      [f'Filter DP flat here; on {uname} it rose {num(flt[now] - f_base, 1)} psid', 'A straight creep, not accelerating'],
                      pair(fm, fm_f)),
        ]
        meter_checked = maintenance_records(item, ts[onset], ['flowmeter', 'rotameter'])
        ro = [
            ruled_out('Seal gas supply or gas quality', 'ruled out',
                      f'{sis_name}\'s seals read {num(sis_v[now], 2)} scfm, flat all day, and seal gas supply DP on '
                      f'{uname} held at {num(min(supply[onset:]), 0)}–{num(max(supply[onset:]), 0)} psid:', peer_chart),
            ruled_out('Higher load or suction pressure', 'ruled out',
                      f'Speed held within {num(sp_rng, 1)} points over the last hour, and suction pressure moved '
                      f'{num(min(suction[onset:]), 0)}–{num(max(suction[onset:]), 0)} psig for every unit alike. '
                      'The expected line already carries anything common to all seals.'),
            ruled_out('Vent flowmeter fault', 'ruled out' if meter_checked else 'unlikely',
                      (f'{meter_checked[0]["time"]}: {meter_checked[0]["description"]} ' if meter_checked else '') +
                      'The seal gas filter DP, a separate sensor, rose with it.'),
            ruled_out('Rotor or bearing problem', 'unlikely' if vib_ok else 'not yet checked',
                      f'Shaft vibration {num(vib[now], 2)} mils, the same as before the rise.' if vib else 'No shaft vibration reading.'),
            ruled_out('Secondary seal or separation gas', 'not yet checked',
                      'A secondary-seal problem can pressurise the primary vent. The secondary vent pressure isn\'t in SCADA; '
                      'it needs a local reading.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'Leakage across the primary seal is growing on {uname}',
                                     level, 'The seal gas filter DP agrees' if independent else 'Vent flow only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': (f'Left out of the comparison: {join_names([unit_name(pack, pack.parent(a)) for a in idle])} '
                         f'(standby, not rotating). A seal on a stopped unit doesn\'t show what normal looks like at speed.')
                        if idle else None,
            'confidence': confidence(level,
                                     'Vent flow and seal gas filter DP are separate sensors and both say more gas is crossing '
                                     'this seal, while the sister seals stay flat.',
                                     'Nobody has read the secondary vent or looked at the seal. SCADA can\'t tell face wear from '
                                     'a secondary-seal problem.',
                                     'The secondary vent reads normal, pointing at the primary faces, or the removed cartridge '
                                     'shows face damage.',
                                     'The filter DP rise turns out to be a loading filter element. Then recheck the vent '
                                     'flowmeter.'),
            'action': action(item, pack),
            'impact': (f'At the last 30 minutes\' rate ({signed(slope30, 2)} scfm/h) the {num(p["alarm_scfm"], 1)} scfm '
                       f'alarm comes in about {dur(eta)}, and the {num(p["trip_scfm"], 1)} scfm trip after that.')
                      if eta else None,
            'model': {'target': 'primary_vent_flow_scfm',
                      'formula': f'median(other running seals) {signed(c["own_off"], 2)} scfm (own offset, first hour)',
                      'fittedOn': f'{len(running_peers)} running seals, {ts[0]}–{ts[nb - 1]}'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. MLV pressure transmitter fault — archetype 06 (instrument, not process)
# ═════════════════════════════════════════════════════════════════════════
class MlvTransmitterFault(Detector):
    id = 'pipeline.mlv_transmitter_fault'
    name = 'False rupture alarm from a failing transmitter'
    archetype = '06 Signal noise'
    applies_to = 'mainline valves'
    summary = ('One valve site\'s pressure meets the rupture rule (≥ 10 % loss in 15 minutes), but it jumps back '
               'between scans and the valve sites either side don\'t move: the transmitter is wrong, not the pipe.')
    pipeline = [
        ('Rupture rule', 'pressure loss against the highest reading in the previous 15 minutes (49 CFR 192.635 style)'),
        ('Neighbours', 'the valve sites directly upstream and downstream on the gas_flow layer'),
        ('Checks', 'rule met · neighbours flat · reading jumps back · line balance · clean after repair'),
        ('Conclusion', 'a loss nothing physical confirms is an instrument fault'),
    ]
    definition = {
        'appliesTo': {'assetType': 'mainline_valve'},
        'inputs': {'pressure': 'self.mlv_pressure_psig', 'roc': 'self.pressure_roc_psi_min',
                   'neighbours': 'gas_flow sources and targets of type mainline_valve',
                   'balance': ['parent[segment].seg_flow_mmscfd', 'next station downstream.station_flow_mmscfd']},
        'params': {'rule_drop_pct': 10.0, 'rule_window_min': 15, 'neighbour_max_pct': 2.0, 'jump_pct': 5.0,
                   'erratic_window_min': 30, 'balance_max_mmscfd': 30.0, 'steady_step_psi': 3.0, 'clean_min': 60},
        'checks': [
            {'id': 'rule', 'role': 'required', 'rule': '(max(pressure, rule_window_min before) − pressure) / max > rule_drop_pct'},
            {'id': 'alone', 'role': 'required', 'rule': 'every neighbour moved < neighbour_max_pct over the same window'},
            {'id': 'erratic', 'role': 'required', 'rule': 'a drop > jump_pct that came straight back within one scan, in erratic_window_min'},
            {'id': 'balance', 'role': 'supporting', 'independent': True, 'rule': '|segment inflow − downstream station flow| changed < balance_max_mmscfd'},
            {'id': 'roc', 'role': 'supporting', 'rule': 'rate of change swings both ways'},
            {'id': 'clean', 'role': 'supporting', 'independent': True, 'rule': 'no step > steady_step_psi for clean_min after the last excursion'},
        ],
        'confidence': {'medium': 'required checks + line balance', 'high': 'reading clean after the transmitter work'},
        'references': ['textbook: intermittent loop', 'variant: frozen/flatlined transmitter', 'look-alike: real rupture'],
    }

    def candidates(self, pack):
        return pack.of_type('mainline_valve')

    def _neighbours(self, pack, aid):
        up = [a for a in pack.sources(aid, 'gas_flow') if pack.asset(a)['assetType'] == 'mainline_valve']
        dn = [a for a in targets(pack, aid, 'gas_flow') if pack.asset(a)['assetType'] == 'mainline_valve']
        return up + dn

    def evaluate(self, pack, aid):
        p = self.p
        pr = pack.series(aid, 'mlv_pressure_psig')
        nbs = self._neighbours(pack, aid)
        if not nbs:
            return Finding(aid, False)
        w = pack.steps(p['rule_window_min'])
        ew = pack.steps(p['erratic_window_min'])
        nps = {a: pack.series(a, 'mlv_pressure_psig') for a in nbs}
        # jumps: a point well below both of its neighbours in time (it went down and straight back up)
        jumps = [False] * pack.n
        for k in range(1, pack.n - 1):
            ref = min(pr[k - 1], pr[k + 1])
            jumps[k] = (ref - pr[k]) / ref * 100 > p['jump_pct']
        for i in range(w, pack.n):
            top = max(pr[i - w:i])
            drop = (top - pr[i]) / top * 100
            if drop < p['rule_drop_pct']:
                continue
            moves = {a: (max(v[i - w:i + 1]) - min(v[i - w:i + 1])) / max(v[i - w:i + 1]) * 100 for a, v in nps.items()}
            if max(moves.values()) >= p['neighbour_max_pct']:
                continue
            # erratic: a drop in the last erratic window that came back within one scan (only past points count)
            back = [k for k in range(max(1, i - ew), i) if jumps[k]]
            if not back:
                continue
            return Finding(aid, True, i, pr=pr, nbs=nbs, nps=nps, jumps=jumps, first=i, drop=drop, top=top, moves=moves)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        vname = pack.name(aid).split(' (')[0]
        pr, nbs, nps, jumps, first = c['pr'], c['nbs'], c['nps'], c['jumps'], c['first']
        ex = [k for k, j in enumerate(jumps) if j]
        # the episode: jumps no more than 30 min apart, around the alert
        ep = [k for k in ex if abs(k - first) <= pack.steps(60)]
        e0, e1 = min(ep + [first]), max(ep + [first])
        w0, w1 = e0 - 1, min(now, e1 + 1)
        moves = {a: max(v[w0:w1 + 1]) - min(v[w0:w1 + 1]) for a, v in nps.items()}
        roc = pack.series(aid, 'pressure_roc_psi_min')
        r_lo, r_hi = min(roc[w0:w1 + 1]), max(roc[w0:w1 + 1])
        worst = min(range(w0, w1 + 1), key=lambda k: pr[k])
        # steady after the episode?
        st = pack.steps(p['clean_min'])
        clean_from = None
        for k in range(e1 + 1, pack.n - st + 1):
            if B.max_step(pr, k, k + st - 1) < p['steady_step_psi']:
                clean_from = k
                break
        fixes = maintenance_records(item, ts[e0], ['transmitter'])
        clean = clean_from is not None
        # line balance: segment inflow against the first station downstream
        seg = pack.parent(aid)
        stn = next((a for a in downstream_chain(pack, seg) if pack.asset(a)['assetType'] in STATION_TYPES), None)
        inflow = pack.series(seg, 'seg_flow_mmscfd')
        outflow = pack.series(stn, 'station_flow_mmscfd') if stn else None
        bal = [a - b for a, b in zip(inflow, outflow)] if outflow else None
        b_move = (max(bal[w0:w1 + 1]) - min(bal[w0:w1 + 1])) if bal else None
        balance_ok = bal is not None and b_move < p['balance_max_mmscfd']
        level = 'high' if clean else 'medium' if balance_ok else 'low'
        nb_names = [pack.name(a).split(' (')[0] for a in nbs]
        window = win(pack, e0 - 9, (clean_from or e1) + 12)
        pct = [(v - c['top']) / c['top'] * 100 for v in pr]
        y_p = dom(pr[e0 - 9:], *[v[e0 - 9:] for v in nps.values()], pad=0.05)

        checks = [
            check('rule', 'Met the potential-rupture rule', 'required', MATCH,
                  f'{num(pr[first], 1)} psig at {ts[first]}, against {num(c["top"], 1)} psig in the 15 minutes before: '
                  f'a {num(c["drop"], 0)} % loss. The rule is {num(p["rule_drop_pct"], 0)} % in {dur(p["rule_window_min"])}.',
                  'A rupture shows as a fast pressure loss. Rupture-mitigation valves must close within 30 minutes of it being '
                  'identified, so this rule gets acted on.',
                  spark(pct, dom(pct[e0 - 9:], [-p['rule_drop_pct'] * 1.2, 2]), threshold_value=-p['rule_drop_pct'], window=window)),
            check('alone', 'No other valve site saw it', 'required', MATCH,
                  ' and '.join(f'{n} moved {num(moves[a], 1)} psi' for n, a in zip(nb_names, nbs)) +
                  f' from {ts[w0]} to {ts[w1]}; this valve read down to {num(pr[worst], 1)} psig.',
                  'A real loss of this size pulls the neighbouring valve sites down within minutes.',
                  spark(nps[nbs[0]], y_p, window=window)),
            check('erratic', 'The reading jumped back between scans', 'required', MATCH,
                  f'{len(ep)} drops of {num(p["jump_pct"], 0)} % or more between {ts[e0]} and {ts[e1]}, each back to line '
                  f'pressure on the next scan.',
                  'A 36-inch line holds hundreds of MMscf of gas. Its pressure can\'t fall 100 psi and recover in 5 minutes; '
                  'a failing signal can.',
                  spark(pr, y_p, highlight=[ts[e0], ts[e1]], window=window)),
            check('balance', 'Line balance held', 'supporting', MATCH if balance_ok else NO_MATCH,
                  (f'{pack.name(seg).split(" (")[0]} inflow minus {short_name(pack, stn)} throughput moved '
                   f'{num(b_move, 0)} MMscf/d over the same window.') if bal else 'No downstream station to balance against.',
                  'A separate set of meters. A rupture opens a gap between gas in and gas out that no meter can hide.',
                  spark(bal, dom(bal, pad=0.2), window=window) if bal else None),
            check('roc', 'Rate of change swung both ways', 'supporting', MATCH if r_lo < -5 and r_hi > 5 else NO_MATCH,
                  f'From {num(r_lo, 1)} to {signed(r_hi, 1)} psi/min within {dur(pack.minutes_between(w0, w1))}.',
                  'A rupture only drives pressure down. A signal that swings up as fast as it falls is the instrument.',
                  spark(roc, dom(roc[e0 - 9:]), window=window)),
            check('clean', 'Clean once the transmitter was dealt with', 'supporting', MATCH if clean else PENDING,
                  (f'No step above {num(p["steady_step_psi"], 0)} psi since {ts[clean_from]}' +
                   (f'; {fixes[-1]["description"].rstrip(".").lower()} at {fixes[-1]["time"]}.' if fixes else '.'))
                  if clean else 'Still erratic.',
                  'Fixing the instrument fixed the reading, and nothing in the line changed.',
                  spark(pr, y_p, highlight=[ts[clean_from], ts[min(now, clean_from + st)]] if clean else None, window=window)),
        ]
        main = chart('psig', y_p,
                     [series(a, n, nps[a], 'peer', 1) for a, n in zip(nbs, nb_names)] +
                     [series('self', f'{vname} line pressure', pr, 'primary', 1)],
                     title='What we see',
                     caption=f'Pressure at {vname} against the valve sites either side of it on the same segment.',
                     markers=[marker(ts[first], 'Rupture-rule alert')] + ([marker(ts[clean_from], 'Reading clean')] if clean else []),
                     window=window)

        grid = minutes_grid(-30, 90, 5)
        r = Rng(222)
        spikes = {-5: -9.0, 5: -11.5, 10: 3.5, 25: -8.0, 35: -6.0}
        tb_p = [spikes.get(m, 0) + r.gauss(0.08) for m in grid]
        tb_n = [r.gauss(0.08) for m in grid]
        stuck = [(0 if m < 0 else 0.0) + (r.gauss(0.08) if m < 0 else 0.0) for m in grid]
        stuck_n = [(0 if m < 0 else -0.04 * m) + r.gauss(0.08) for m in grid]
        rup = [0 if m < 0 else -min(28, 1.1 * m) + r.gauss(0.3) for m in grid]
        rup_n = [0 if m < 3 else -min(20, 0.8 * (m - 3)) + r.gauss(0.3) for m in grid]
        n_top = {a: max(v[first - pack.steps(15):first]) for a, v in nps.items()}
        n_pct = [min((v[k] - n_top[a]) / n_top[a] * 100 for a, v in nps.items()) for k in range(pack.n)]
        lp = aligned(pct, first, pack.step_min, grid, 'min')
        ln = aligned(n_pct, first, pack.step_min, grid, 'min')
        live = f'{vname}, today'
        th = [threshold(-p['rule_drop_pct'], 'Rupture rule')]

        def pair(a, b):
            return [ref_chart('This valve: pressure change (%)', '%', dom(a, lp, [-p['rule_drop_pct'] * 1.2]), grid, 'min', a, lp, live, 1, th),
                    ref_chart('Neighbour valves: largest change (%)', '%', dom(b, ln, [-2, 1]), grid, 'min', b, ln,
                              'Neighbours, today', 1)]
        refs = [
            reference('loop', 'textbook', 'Textbook', 'Intermittent transmitter loop',
                      'Water or a loose termination opens the loop for a scan at a time. The reading drops and snaps back; '
                      'the valve sites either side stay flat.',
                      'match', 'Closest match', ['Same drops and recoveries', 'Neighbours flat, as here'], pair(tb_p, tb_n)),
            reference('stuck', 'variant', 'Variant', 'Frozen transmitter',
                      'The other way a transmitter fails: the reading freezes while the line moves. Nothing alarms, which '
                      'makes it the more dangerous one.',
                      'partial', 'Same cause family, opposite symptom',
                      ['Compare every valve site with its neighbours, not only the alarming one',
                       f'{vname} kept tracking the line between drops'], pair(stuck, stuck_n)),
            reference('rupture', 'lookalike', 'Look-alike', 'A real rupture',
                      'Pressure falls fast and keeps falling. The neighbouring valve sites follow within minutes, and gas in '
                      'stops matching gas out.',
                      'nomatch', 'Doesn\'t match',
                      [f'Here the neighbours fall too; beside {vname} they moved under {num(max(moves.values()), 0)} psi',
                       f'Here the loss stays; on {vname} it came back every scan'], pair(rup, rup_n)),
        ]
        ro = [
            ruled_out('A rupture or large leak', 'ruled out',
                      f'{join_names([f"{n} moved {num(moves[a], 1)} psi" for n, a in zip(nb_names, nbs)])}, the line balance '
                      f'held within {num(b_move, 0)} MMscf/d, and the reading returned to line pressure between drops.'
                      if bal else 'The neighbouring valve sites didn\'t move.'),
            ruled_out('A pressure transient in the line', 'ruled out',
                      'A compressor trip or valve movement sends a wave past every valve site on the segment. Only this one moved.'),
            ruled_out('The valve itself', 'ruled out',
                      f'Valve position stayed at {num(pack.series(aid, "valve_position_pct")[now], 0)} % throughout.'),
        ]
        return {
            'conclusion': conclusion('Cause' if clean else 'Most likely cause',
                                     f'A failing pressure transmitter at {vname}; the pipe was intact', level,
                                     'Confirmed: the reading is clean since the transmitter work' if clean
                                     else 'Nothing physical confirms the loss'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Two separate kinds of evidence, the neighbouring valve sites and the line balance, say the '
                                     'pressure never fell, and the reading has been clean since the transmitter was dealt with.'
                                     if clean else 'The neighbouring valve sites and the line balance say the pressure never fell.',
                                     None if clean else 'The transmitter hasn\'t been checked yet.',
                                     None if clean else 'A field check finds no release and a fault in the transmitter loop.',
                                     'Another valve site on the segment starts moving with it. Then treat it as a real loss.',
                                     'Clean reading after the transmitter work' if clean else None),
            'action': action(item, pack),
            'impact': 'A false rupture-valve closure here would have stopped the whole mainline flow through the segment.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Receipt loss cascading down the line — archetype 09 (cascade failure)
# ═════════════════════════════════════════════════════════════════════════
RECEIPT_KEYS = {'plant_receipt_station': ('receipt_flow_mmscfd', 'receipt_nominated_mmscfd'),
                'field_receipt_station': ('field_receipt_flow_mmscfd', 'field_receipt_nominated_mmscfd')}


class ReceiptLossCascade(Detector):
    id = 'pipeline.receipt_loss_cascade'
    name = 'Receipt loss cascading downstream'
    archetype = '09 Cascade failure'
    applies_to = 'receipt stations'
    summary = ('A receipt point drops well below its schedule in one interval, and the compressor stations '
               'downstream cut back one after another in flow order: one cause at the source, not separate problems.')
    pipeline = [
        ('Shortfall', 'receipt flow against its scheduled quantity; a sudden drop, not a drift'),
        ('Follow the gas', 'the facilities downstream on the gas_flow layer, in order'),
        ('Checks', 'shortfall · first station cuts back · each later station follows · line pack draws down · meters agree'),
        ('Conclusion', 'the loss is at the receipt; confirmed when receipts return and the line recovers'),
    ]
    definition = {
        'appliesTo': {'assetType': list(RECEIPT_KEYS)},
        'inputs': {'flow': 'self.receipt_flow (by type)', 'scheduled': 'self.receipt_nominated (by type)',
                   'meters': 'children[meter_run].meter_flow', 'stations': 'downstream gas_flow chain.station_flow_mmscfd',
                   'linePack': 'system.line_pack_change_mmscf_h'},
        'params': {'short_pct': 15.0, 'step_pct': 10.0, 'sustain_min': 15, 'station_dip_pct': 5.0,
                   'response_min': 30, 'drawdown_mmscf_h': -3.0, 'run_spread_pct': 5.0, 'restored_pct': 2.0},
        'checks': [
            {'id': 'short', 'role': 'required', 'rule': 'flow < scheduled × (1 − short_pct) for sustain_min, entered by a single step > step_pct'},
            {'id': 'first', 'role': 'required', 'rule': 'first station downstream cuts throughput > station_dip_pct within response_min'},
            {'id': 'order', 'role': 'supporting', 'independent': True, 'rule': 'each later station\'s low comes after the one upstream'},
            {'id': 'pack', 'role': 'supporting', 'rule': 'system line pack change < drawdown_mmscf_h during the shortfall'},
            {'id': 'meters', 'role': 'supporting', 'rule': 'every meter run fell by the same share (spread < run_spread_pct)'},
            {'id': 'restored', 'role': 'supporting', 'independent': True, 'rule': 'receipts back within restored_pct of schedule and stations recovered'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'receipts restored and the line recovered with them'},
    }

    def candidates(self, pack):
        return pack.of_type(*RECEIPT_KEYS)

    def evaluate(self, pack, aid):
        p = self.p
        fk, sk = RECEIPT_KEYS[pack.asset(aid)['assetType']]
        flow, sched = pack.series(aid, fk), pack.series(aid, sk)
        chain = downstream_chain(pack, aid)
        stations = [a for a in chain if pack.asset(a)['assetType'] in STATION_TYPES]
        if not stations:
            return Finding(aid, False)
        short = [f < s * (1 - p['short_pct'] / 100) for f, s in zip(flow, sched)]
        st1 = pack.series(stations[0], 'station_flow_mmscfd')
        for i in range(1, pack.n):
            s0 = B.sustained_since(short, i)
            if s0 is None or s0 == 0 or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            if (flow[s0 - 1] - flow[s0]) / sched[s0] * 100 < p['step_pct']:
                continue
            before = st1[s0 - 1]
            rw = pack.steps(p['response_min'])
            low = min(st1[s0:min(i, s0 + rw) + 1])
            if (before - low) / before * 100 < p['station_dip_pct']:
                continue
            return Finding(aid, True, i, fk=fk, flow=flow, sched=sched, start=s0, stations=stations, chain=chain)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, s0 = f.aid, c['start']
        rname = short_name(pack, aid)
        flow, sched, stations = c['flow'], c['sched'], c['stations']
        before = flow[s0 - 1]
        low = min(range(s0, pack.n), key=lambda k: flow[k] if k < s0 + pack.steps(120) else 1e9)
        ok = [v >= s * (1 - p['restored_pct'] / 100) for v, s in zip(flow, sched)]
        back = next((k for k in range(s0 + 1, pack.n) if all(ok[k:min(pack.n, k + 4)])), None)
        # each station: its low after the cut, and whether it came back
        horizon = (back or now) + pack.steps(60)
        lows, pct_series = {}, {}
        for st in stations:
            v = pack.series(st, 'station_flow_mmscfd')
            b = v[s0 - 1]
            k = min(range(s0, min(pack.n, horizon + 1)), key=lambda x: v[x])
            lows[st] = (k, v[k], b)
            pct_series[st] = [100 * x / b for x in v]
        order_ok = all(lows[a][0] < lows[b][0] for a, b in zip(stations, stations[1:]))
        rec = {st: next((k for k in range(lows[st][0], pack.n) if pct_series[st][k] >= 97), None) for st in stations}
        restored = back is not None and all(rec[st] is not None for st in stations)
        sysid = next(a['id'] for a in pack.assets if a['parentId'] is None)
        lpc = pack.series(sysid, 'line_pack_change_mmscf_h')
        lps = pack.series(sysid, 'system_line_pack_mmscf')
        lpc_min = min(lpc[s0:(back or now) + 1])
        drawn = lps[s0 - 1] - min(lps[s0:(back or now) + pack.steps(30)])
        pack_ok = lpc_min < p['drawdown_mmscf_h']
        runs = [m for m in pack.children[aid] if pack.asset(m)['assetType'].startswith('meter_run')]
        mkey = 'meter_flow_mmscfd' if runs and pack.has(runs[0], 'meter_flow_mmscfd') else 'small_meter_flow_mmscfd'
        # a meter fault hits one run; a real loss shows on every run by the same share
        run_drop = [(pack.series(m, mkey)[s0 - 1] - pack.series(m, mkey)[s0]) / pack.series(m, mkey)[s0 - 1] * 100 for m in runs]
        m_spread = (max(run_drop) - min(run_drop)) if run_drop else None
        meters_ok = bool(run_drop) and m_spread < p['run_spread_pct']
        st1 = stations[0]
        s1_low = lows[st1]
        s1_cut = next(k for k in range(s0, pack.n) if 100 - pct_series[st1][k] > p['station_dip_pct'])
        level = 'high' if restored else 'medium'
        window = win(pack, s0 - 6, horizon)
        names = [short_name(pack, s) for s in stations]
        drop_pct = (before - flow[low]) / sched[low] * 100

        checks = [
            check('short', f'Receipts fell {num(drop_pct, 0)} % below schedule in one interval', 'required', MATCH,
                  f'{num(before, 0)} MMscf/d at {ts[s0 - 1]}, {num(flow[s0], 0)} at {ts[s0]}, against {num(sched[s0], 0)} '
                  f'scheduled. Below schedule until {ts[back] if back else "now"}.',
                  'A step like this is the source stopping — a plant trip or a shut-in — not a shipper trimming a nomination.',
                  spark(flow, dom(flow, sched, pad=0.1), window=window)),
            check('first', f'{names[0]} cut back within {dur(pack.minutes_between(s0 - 1, s1_cut))}', 'required', MATCH,
                  f'{names[0]} throughput was {num(100 - pct_series[st1][s1_cut], 0)} % down by {ts[s1_cut]}, and bottomed at '
                  f'{num(s1_low[1], 0)} MMscf/d at {ts[s1_low[0]]}, from {num(s1_low[2], 0)} before.',
                  'The first station downstream runs on suction control. With less gas arriving, it has to move less, '
                  'or its suction pressure collapses.',
                  spark(pct_series[st1], dom(pct_series[st1], pad=0.1), window=window)),
            check('order', 'Each station followed the one upstream', 'supporting', MATCH if order_ok else NO_MATCH,
                  '; '.join(f'{n} low {num(lows[s][1], 0)} at {ts[lows[s][0]]}' for n, s in zip(names, stations)) + '.',
                  'Separate meters at each station. A problem that moves downstream in flow order, with the travel time '
                  'of the gas, has one cause at the top.',
                  None),
            check('pack', 'Line pack drew down', 'supporting', MATCH if pack_ok else NO_MATCH,
                  f'System line pack changed at {num(lpc_min, 1)} MMscf/h at worst and gave up {num(drawn, 1)} MMscf '
                  f'before the receipt came back.',
                  'Deliveries don\'t stop when a receipt does. The difference comes out of the gas stored in the pipe.',
                  spark(lpc, dom(lpc), threshold_value=p['drawdown_mmscf_h'], window=window)),
            check('meters', 'Every meter run saw it', 'supporting', MATCH if meters_ok else NO_MATCH,
                  (f'All {len(runs)} meter runs fell by {num(min(run_drop), 0)}' +
                   (f'–{num(max(run_drop), 0)}' if round(max(run_drop)) != round(min(run_drop)) else '') + ' % in the same interval, '
                   f'and {names[0]}\'s own meter fell with them.') if run_drop else 'No meter runs to compare.',
                  'Rules out a measurement fault at the receipt: the gas really stopped arriving.', None),
            check('restored', 'Receipts back, and the line followed', 'supporting', MATCH if restored else PENDING,
                  (f'Receipts back within {num(p["restored_pct"], 0)} % of schedule at {ts[back]}; '
                   + ', '.join(f'{n} by {ts[rec[s]]}' for n, s in zip(names, stations)) + '.') if restored
                  else 'Not restored yet.',
                  'When the cause clears and every station recovers in the same order, the chain is confirmed.',
                  spark(flow, dom(flow, sched, pad=0.1), highlight=[ts[low], ts[back]] if back else None, window=window)),
        ]
        main = chart('MMscf/d', dom(flow[s0 - 6:horizon], sched, pad=0.1),
                     [series('receipt', f'{rname} receipts', flow, 'primary', 1),
                      series('sched', 'Scheduled', sched, 'expected', 1)],
                     title='What we see',
                     caption=f'{rname} receipt flow against its scheduled quantity.',
                     shade_gap=['sched', 'receipt'],
                     markers=[marker(ts[s0], 'Receipts cut')] + ([marker(ts[back], 'Back on schedule')] if back else []),
                     window=window)
        cascade = chart('%', dom(*[pct_series[s][s0 - 6:horizon] for s in stations], [100], pad=0.1),
                        [series(s, n, pct_series[s], 'peer' if k else 'primary', 1) for k, (n, s) in enumerate(zip(names, stations))],
                        caption='Throughput at each compressor station, % of its level just before the cut, in flow order.',
                        window=window)

        grid = minutes_grid(-30, 210, 10)
        r = Rng(333)
        tb_r = [(100 if m < 0 else 70 if m < 45 else min(100, 70 + (m - 45) * 1.5)) + r.gauss(0.4) for m in grid]
        tb_s = [(100 if m < 25 else max(80, 100 - (m - 25) * 1.0) if m < 90 else min(100, 80 + (m - 90) * 0.5)) + r.gauss(0.5) for m in grid]
        lo_r = [(100 if m < 0 else 80) + r.gauss(0.4) for m in grid]
        lo_s = [(100 if m < 25 else max(84, 100 - (m - 25) * 0.4)) + r.gauss(0.5) for m in grid]
        mf_r = [(100 if m < 0 else 70) + r.gauss(0.4) for m in grid]
        mf_s = [100 + r.gauss(0.5) for m in grid]
        last = stations[-1]
        lr = aligned([100 * v / s for v, s in zip(flow, sched)], s0, pack.step_min, grid, 'min')
        ls = aligned(pct_series[last], s0, pack.step_min, grid, 'min')
        live = f'{rname}, today'

        def pair(a, b):
            return [ref_chart('Receipts (% of schedule)', '%', dom(a, lr, [100], pad=0.1), grid, 'min', a, lr, live, 0),
                    ref_chart(f'Last station downstream (% of before)', '%', dom(b, ls, [100], pad=0.1), grid, 'min', b, ls,
                              f'{names[-1]}, today', 0)]
        refs = [
            reference('trip', 'textbook', 'Textbook', 'Plant trip, restarted within the hour',
                      'Receipts fall by a third, the stations downstream back off one after another, and line pack carries '
                      'deliveries until the plant restarts.',
                      'match', 'Closest match', ['Same one-step cut and restart', 'Stations dipping in flow order'], pair(tb_r, tb_s)),
            reference('long', 'variant', 'Variant', 'Loss that lasts',
                      'A partial loss that isn\'t restored. Line pack keeps falling and the fix is commercial: '
                      'cut deliveries to match, or find make-up gas.',
                      'partial', 'Same start, no restart',
                      [f'{rname} came back after {dur(pack.minutes_between(s0, back)) if back else "—"}',
                       'Past a couple of hours, delivery pressures become the constraint'], pair(lo_r, lo_s)),
            reference('meter', 'lookalike', 'Look-alike', 'Receipt meter fault',
                      'The receipt meter reads low but the gas still arrives. Nothing downstream moves.',
                      'nomatch', 'Doesn\'t match',
                      [f'Stations downstream flat here; {names[0]} fell to {num(100 * s1_low[1] / s1_low[2], 0)} % today',
                       'The meter runs and the station meters agreed'], pair(mf_r, mf_s)),
        ]
        ro = [
            ruled_out('A receipt measurement fault', 'ruled out',
                      f'All {len(runs)} meter runs fell together, and {names[0]} measured the same shortfall on its own meter.'),
            ruled_out('Separate problems at each station', 'ruled out',
                      'Each station\'s dip came after the one upstream, in the order the gas flows:', cascade),
            ruled_out('Higher deliveries drawing the line down', 'ruled out',
                      f'Total deliveries held at {num(min(pack.series(sysid, "total_deliveries_mmscfd")[s0:back or now]), 0)}–'
                      f'{num(max(pack.series(sysid, "total_deliveries_mmscfd")[s0:back or now]), 0)} MMscf/d during the cut.'),
        ]
        return {
            'conclusion': conclusion('Cause' if restored else 'Most likely cause',
                                     f'Gas stopped arriving at {rname}; every station downstream followed it', level,
                                     'Confirmed: the line recovered when receipts came back' if restored
                                     else 'Stations are following the receipt loss in flow order'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The receipt fell in one step, three stations\' own meters followed it in flow order, and '
                                     'all of them recovered after receipts did.' if restored else
                                     'The receipt fell in one step and the stations downstream followed it in flow order.',
                                     None if restored else 'Receipts haven\'t come back yet.',
                                     None if restored else 'The stations recover in the same order once receipts return.',
                                     'A station stays low after receipts are back. Then look at that station on its own.',
                                     'Recovery after receipts returned' if restored else None),
            'action': action(item, pack),
            'impact': f'About {num(sum(max(0, s - v) for v, s in zip(flow[s0:(back or now) + 1], sched[s0:(back or now) + 1])) * pack.step_min / 1440, 1)} MMscf '
                      f'short against schedule, carried by line pack.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Regulator run icing from the heater upstream — archetype 07 (ghost signal)
# ═════════════════════════════════════════════════════════════════════════
class RegulatorIcingUpstream(Detector):
    id = 'pipeline.regulator_icing_upstream_heater'
    name = 'Regulator icing, caused by the line heater upstream'
    archetype = '07 Ghost signal'
    applies_to = 'regulator runs'
    summary = ('Gas leaving a city-gate regulator runs toward freezing, but the regulator is only doing its usual '
               'Joule-Thomson cut: the gas reached it cold because the line heater feeding it (gas_flow layer) lost heat first.')
    pipeline = [
        ('Symptom', 'regulator outlet gas temperature against its own morning level and a 40 °F icing line'),
        ('Follow the gas upstream', 'the asset feeding this run on the gas_flow layer — its line heater'),
        ('Expected value', 'heater outlet − 7 °F per 100 psi of pressure cut (Joule-Thomson): what the regulator should read'),
        ('Checks', 'cold · heater cooled first · burner off · regulator follows its expected value · sister run · recovery'),
        ('Conclusion', 'symptom at the regulator, cause at the heater; one item per city gate'),
    ]
    definition = {
        'appliesTo': {'assetType': 'regulator_run'},
        'inputs': {'outlet': 'self.reg_outlet_temp_f', 'travel': 'self.reg_travel_pct',
                   'heater': 'sources[layer=gas_flow].heater_outlet_temp_f', 'firing': 'sources[layer=gas_flow].burner_firing_pct',
                   'bath': 'sources[layer=gas_flow].bath_temp_f', 'pressures': ['parent.cg_inlet_pressure_psig', 'parent.cg_outlet_pressure_psig']},
        'expected': {'model': 'Joule-Thomson', 'target': 'outlet', 'formula': 'heater outlet − jt_f_per_100psi × (inlet − outlet) / 100'},
        'params': {'cold_f': 40.0, 'drop_f': 8.0, 'baseline_min': 60, 'sustain_min': 15, 'heater_drop_f': 8.0,
                   'firing_off_pct': 1.0, 'jt_f_per_100psi': 7.0, 'jt_band_f': 4.0, 'hunt_psi': 4.0, 'recover_f': 45.0},
        'checks': [
            {'id': 'cold', 'role': 'required', 'rule': 'outlet < cold_f for sustain_min and > drop_f below its baseline'},
            {'id': 'upstream', 'role': 'required', 'rule': 'heater outlet > heater_drop_f below its baseline, starting before the regulator left normal'},
            {'id': 'flame', 'role': 'supporting', 'independent': True, 'rule': 'burner firing < firing_off_pct at the start'},
            {'id': 'jt', 'role': 'supporting', 'rule': '|outlet − expected| < jt_band_f throughout'},
            {'id': 'sister', 'role': 'supporting', 'rule': 'the other run on the same heater cooled in step'},
            {'id': 'hunting', 'role': 'supporting', 'rule': 'station outlet pressure swings > hunt_psi while cold'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'outlet > recover_f after the heater fired again'},
        ],
        'confidence': {'medium': 'required checks + burner off', 'high': 'regulator recovered once the heater was relit'},
    }

    def candidates(self, pack):
        return pack.of_type('regulator_run')

    def group(self, pack, aid):
        return pack.parent(aid)

    def evaluate(self, pack, aid):
        p = self.p
        heaters = [a for a in pack.sources(aid, 'gas_flow') if pack.has(a, 'heater_outlet_temp_f')]
        if not heaters:
            return Finding(aid, False)
        htr = heaters[0]
        out = pack.series(aid, 'reg_outlet_temp_f')
        hout = pack.series(htr, 'heater_outlet_temp_f')
        nb = pack.steps(p['baseline_min'])
        base, hbase = B.mean(out[:nb]), B.mean(hout[:nb])
        cold = [v < p['cold_f'] and v < base - p['drop_f'] for v in out]
        hcool = [v < hbase - p['heater_drop_f'] for v in hout]
        for i in range(nb, pack.n):
            s0 = B.sustained_since(cold, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            h0 = B.sustained_since(hcool, i)
            if h0 is None or h0 > s0:
                continue
            return Finding(aid, True, i, htr=htr, out=out, hout=hout, base=base, hbase=hbase, cold_at=s0, hcool_at=h0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, htr = f.aid, c['htr']
        gate = pack.parent(aid)
        gname = short_name(pack, gate)
        rname = pack.name(aid)
        out, hout, base, hbase = c['out'], c['hout'], c['base'], c['hbase']
        cold_at, hcool_at = c['cold_at'], c['hcool_at']
        firing = pack.series(htr, 'burner_firing_pct')
        bath = pack.series(htr, 'bath_temp_f')
        off = next((k for k in range(hcool_at, -1, -1) if firing[k] >= p['firing_off_pct']), -1) + 1
        flame_ok = firing[off] < p['firing_off_pct']
        relit = next((k for k in range(off, pack.n) if firing[k] >= p['firing_off_pct']), None)
        rec = next((k for k in range(relit, pack.n) if out[k] > p['recover_f']), None) if relit is not None else None
        recovered = rec is not None
        pin = pack.series(gate, 'cg_inlet_pressure_psig')
        pout = pack.series(gate, 'cg_outlet_pressure_psig')
        cut = [a - b for a, b in zip(pin, pout)]
        exp = [h - p['jt_f_per_100psi'] * x / 100 for h, x in zip(hout, cut)]
        jt_res = [o - e for o, e in zip(out, exp)]
        jt_max = max(abs(v) for v in jt_res)
        jt_ok = jt_max < p['jt_band_f']
        low = min(range(pack.n), key=lambda k: out[k])
        sisters = [t for t in targets(pack, htr, 'gas_flow') if t != aid and pack.has(t, 'reg_outlet_temp_f')]
        sis = sisters[0] if sisters else None
        sis_out = pack.series(sis, 'reg_outlet_temp_f') if sis else None
        sis_ok = sis is not None and abs((sis_out[low] - B.mean(sis_out[:pack.steps(p['baseline_min'])])) - (out[low] - base)) < 3
        cold_end = next((k for k in range(cold_at, pack.n) if out[k] >= p['cold_f']), now)
        p_med = median(pout[:pack.steps(p['baseline_min'])])
        swing = max(abs(v - p_med) for v in pout[cold_at:cold_end + 1])
        hunt_ok = swing > p['hunt_psi']
        travel = pack.series(aid, 'reg_travel_pct')
        lead = pack.minutes_between(off, cold_at)
        level = 'high' if recovered else 'medium' if flame_ok else 'low'
        window = win(pack, off - 9, (rec or now) + 6)
        y_t = dom(out, hout, exp, [p['cold_f']], pad=0.05)
        drop_bath = bath[off] - min(bath[off:(relit or now) + 1])

        checks = [
            check('cold', 'Outlet gas near freezing', 'required', MATCH,
                  f'{rname} outlet gas {num(base, 0)} °F in the first hour, {num(out[low], 1)} °F at {ts[low]}. Below '
                  f'{num(p["cold_f"], 0)} °F from {ts[cold_at]} to {ts[cold_end]}.',
                  'Below about 40 °F, moisture in the gas can freeze on the pilot and the regulator starts to stick and hunt.',
                  spark(out, y_t, threshold_value=p['cold_f'], window=window)),
            check('upstream', 'The heater feeding it cooled first', 'required', MATCH,
                  f'Line heater outlet gas fell from {num(hbase, 0)} °F to {num(min(hout), 0)} °F. It started cooling at '
                  f'{ts[off]}, when its burner went out, {dur(lead)} before the regulator went under {num(p["cold_f"], 0)} °F.',
                  'The heater is upstream of this run on the gas_flow layer. A cause comes before its effect.',
                  spark(hout, y_t, highlight=[ts[off], ts[cold_at]], window=window)),
            check('flame', 'The heater burner was off', 'supporting', MATCH if flame_ok else NO_MATCH,
                  f'Burner firing {num(firing[off - 1], 0)} % at {ts[off - 1]}, {num(firing[off], 0)} % from {ts[off]}'
                  + (f' until {ts[relit]}' if relit is not None else '') + f'. Bath temperature fell {num(drop_bath, 0)} °F.',
                  'A separate signal. With no flame the water bath cools, and so does the gas passing through it.',
                  spark(firing, [0, 105], window=window)),
            check('jt', 'The regulator is only doing its normal cut', 'supporting', MATCH if jt_ok else NO_MATCH,
                  f'Outlet stayed within {num(jt_max, 1)} °F of heater outlet minus {num(p["jt_f_per_100psi"], 0)} °F per 100 psi '
                  f'of pressure cut ({num(min(cut), 0)}–{num(max(cut), 0)} psi today) all day.',
                  'Cutting pressure always chills gas (Joule-Thomson). If the regulator added cooling of its own, it would '
                  'drift below this line.',
                  spark(jt_res, dom(jt_res, [-p['jt_band_f'], p['jt_band_f']]), band_lo=[-p['jt_band_f']] * pack.n,
                        band_hi=[p['jt_band_f']] * pack.n)),
            check('sister', 'The other run cooled in step', 'supporting', MATCH if sis_ok else NO_MATCH,
                  (f'{pack.name(sis)} reached {num(sis_out[low], 1)} °F at {ts[low]}, the same drop from its own normal.')
                  if sis else 'No other run on this heater.',
                  'Two regulators failing at once is unlikely. Two runs fed by one heater cooling together points at the heater.',
                  spark(sis_out, y_t, window=window) if sis else None),
            check('hunting', 'Station outlet pressure started to swing', 'supporting', MATCH if hunt_ok else NO_MATCH,
                  f'Outlet pressure moved up to {num(swing, 1)} psi from its {num(p_med, 0)} psig setpoint while the gas was '
                  f'cold; {rname} travel ranged {num(min(travel[cold_at:cold_end + 1]), 0)}–'
                  f'{num(max(travel[cold_at:cold_end + 1]), 0)} %.',
                  'Ice on the pilot makes the regulator slow and jerky. The LDC sees it as outlet pressure swings.',
                  spark(pout, dom(pout[max(0, off - 9):]), window=window)),
            check('recovered', 'Warmed up once the heater was relit', 'supporting', MATCH if recovered else PENDING,
                  (f'Burner back at {ts[relit]}; outlet gas above {num(p["recover_f"], 0)} °F by {ts[rec]} and '
                   f'{num(out[now], 0)} °F now.') if recovered else 'The heater hasn\'t been relit yet.',
                  'Restoring the heat upstream cleared the symptom downstream, with nothing done to the regulator.',
                  spark(out, y_t, highlight=[ts[relit], ts[rec]] if recovered else None, window=window)),
        ]
        main = chart('°F', y_t,
                     [series('heater', 'Line heater outlet gas', hout, 'secondary', 1),
                      series('expected', 'Expected: heater outlet − pressure-cut chill', exp, 'expected', 1),
                      series('actual', f'{rname} outlet gas', out, 'primary', 1)],
                     title='What we see',
                     caption=f'{rname} outlet gas temperature, the line heater that feeds it, and what the pressure cut alone '
                             f'would give. The regulator tracked the heater all the way down.',
                     thresholds=[threshold(p['cold_f'], 'Icing risk')],
                     markers=[marker(ts[off], 'Heater flame out')] + ([marker(ts[relit], 'Relit')] if relit is not None else []))

        grid = minutes_grid(-30, 240, 10)
        r = Rng(444)

        def fall(m, depth, tau, back=None, tau_b=30.0):
            v = 0.0 if m < 0 else -depth * (1 - 2.718 ** (-m / tau))
            if back is not None and m >= back:
                v0 = -depth * (1 - 2.718 ** (-back / tau))
                v = v0 * 2.718 ** (-(m - back) / tau_b)
            return v
        tb_r = [fall(m, 26, 110, 115) + r.gauss(0.3) for m in grid]
        tb_h = [fall(m, 26, 110, 115) + r.gauss(0.3) for m in grid]
        un_r = [-0.05 * max(0, m) + r.gauss(0.3) for m in grid]
        un_h = [-0.05 * max(0, m) + r.gauss(0.3) for m in grid]
        hy_r = [(0 if m < 60 else -2.0) + r.gauss(0.3) for m in grid]
        hy_h = [r.gauss(0.3) for m in grid]
        lr = aligned([v - base for v in out], off, pack.step_min, grid, 'min')
        lh = aligned([v - hbase for v in hout], off, pack.step_min, grid, 'min')
        live = f'{gname} {rname}, today'

        def pair(a, b):
            return [ref_chart('Regulator outlet gas, change from normal', '°F', dom(a, lr, pad=0.05), grid, 'min', a, lr, live, 0),
                    ref_chart('Heater outlet gas, change from normal', '°F', dom(b, lh, pad=0.05), grid, 'min', b, lh,
                              'Heater, today', 0)]
        refs = [
            reference('flameout', 'textbook', 'Textbook', 'Heater flame-out, relit in time',
                      'The pilot goes out; the bath cools over a couple of hours and the regulator outlet follows it down, '
                      'then climbs back once the heater is relit.',
                      'match', 'Closest match', ['Heater and regulator fall together', 'Recovery as soon as the heater relights'],
                      pair(tb_r, tb_h)),
            reference('undersized', 'variant', 'Variant', 'Heater falling behind',
                      'The burner runs flat out but can\'t keep up with a cold day or high flow. Both temperatures sag slowly.',
                      'partial', 'Same path, different cause', ['Burner at 100 %, not 0 %', 'The fix is flow or heater capacity, '
                                                                'not a relight'], pair(un_r, un_h)),
            reference('hydrate', 'lookalike', 'Look-alike', 'Hydrates at the regulator',
                      'Wet gas forms hydrates inside the regulator. It hunts and sticks, but the gas upstream arrives warm.',
                      'nomatch', 'Doesn\'t match', [f'Heater outlet steady here; at {gname} it fell {num(hbase - min(hout), 0)} °F',
                                                    'Treat with drier gas or methanol, not the heater'], pair(hy_r, hy_h)),
        ]
        ro = [
            ruled_out(f'A fault in {rname}', 'ruled out',
                      f'Its outlet stayed within {num(jt_max, 1)} °F of what the heater and the pressure cut predict, and it '
                      f'recovered with no work on the regulator.' if recovered else
                      f'Its outlet stayed within {num(jt_max, 1)} °F of what the heater and the pressure cut predict.'),
            ruled_out('A bigger pressure cut', 'ruled out',
                      f'Inlet minus outlet pressure stayed at {num(min(cut), 0)}–{num(max(cut), 0)} psi: at most '
                      f'{num(p["jt_f_per_100psi"] * (max(cut) - min(cut)) / 100, 0)} °F of extra chill.'),
            ruled_out('Wet gas (hydrates)', 'unlikely',
                      f'Hydrates block a regulator without cooling the gas upstream of it. Here the heater outlet itself fell '
                      f'{num(hbase - min(hout), 0)} °F.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'{gname} line heater lost its flame; the regulators were fine', level,
                                     'Confirmed: outlet gas recovered once the heater was relit' if recovered
                                     else 'The heater cooled first, with its burner off'),
            'rootCauseAssetId': htr,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The heater lost its flame first, both runs followed the heater down by exactly the '
                                     'pressure-cut chill, and they warmed again once it was relit.' if recovered else
                                     'The heater lost its flame first, and both runs followed it down.',
                                     None if recovered else 'The heater hasn\'t been relit yet, so the loop isn\'t closed.',
                                     None if recovered else 'The outlet gas warms once the heater is relit.',
                                     'The outlet stays cold with the heater firing. Then look at the regulator and the gas '
                                     'moisture.', 'Recovery after the relight' if recovered else None),
            'action': action(item, pack),
            'grouped': [pack.name(aid)] + ([pack.name(sis)] if sis_ok else []),
            'model': {'target': 'reg_outlet_temp_f',
                      'formula': f'heater outlet − {num(p["jt_f_per_100psi"], 0)} °F × (inlet − outlet psi) / 100',
                      'fittedOn': 'Joule-Thomson rule of thumb (RESEARCH.md §4), not fitted'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Recip unit trips on a failing compressor valve — archetype 11 (hard block)
# ═════════════════════════════════════════════════════════════════════════
class RecipValveTrip(Detector):
    id = 'pipeline.recip_valve_trip'
    name = 'Recip unit trip from a failing compressor valve'
    archetype = '11 Hard block'
    applies_to = 'recip compressor units'
    summary = ('A reciprocating unit drops from full flow to zero in one interval, and in the hour before, its '
               'valve-cover temperatures climbed first and frame vibration followed: a mechanical failure inside a cylinder.')
    pipeline = [
        ('Trip', 'unit flow from running to zero in one interval, with other units on the station still running'),
        ('Look back', 'the hour before the trip on the unit\'s compressor frame (valve-cover temperature, vibration)'),
        ('Rule out the driver', 'engine exhaust and jacket water against the station\'s other engines'),
        ('Contain', 'station throughput after standby is started'),
        ('Conclusion', 'valve temperature first, then vibration, then trip → failed compressor valve; an inspection confirms'),
    ]
    definition = {
        'appliesTo': {'assetType': 'recip_compressor_unit'},
        'inputs': {'flow': 'self.recip_unit_flow_mmscfd', 'valveTemp': 'child[recip_compressor_frame].valve_temp_dev_f',
                   'vib': 'child[recip_compressor_frame].frame_vibration_ips',
                   'engine': ['child[gas_engine_driver].engine_exhaust_temp_f', 'child[gas_engine_driver].jacket_water_temp_f'],
                   'station': 'parent.station_flow_mmscfd'},
        'params': {'min_before_mmscfd': 50.0, 'down_mmscfd': 1.0, 'precursor_min': 60, 'baseline_min': 120,
                   'valve_rise_f': 10.0, 'valve_watch_f': 2.0, 'vib_ratio': 2.0, 'vib_watch_ratio': 1.3,
                   'engine_margin_f': 10.0, 'restored_pct': 3.0},
        'checks': [
            {'id': 'trip', 'role': 'required', 'rule': 'flow > min_before_mmscfd, then < down_mmscfd, another unit still running'},
            {'id': 'valve', 'role': 'required', 'rule': 'valve-cover deviation rose > valve_rise_f above its baseline in precursor_min before the trip'},
            {'id': 'vib', 'role': 'supporting', 'rule': 'frame vibration > vib_ratio × its baseline before the trip'},
            {'id': 'order', 'role': 'supporting', 'rule': 'valve temperature left normal before vibration did'},
            {'id': 'engine', 'role': 'supporting', 'rule': 'engine exhaust and jacket water within engine_margin_f of the other engines'},
            {'id': 'station', 'role': 'supporting', 'rule': 'station throughput back within restored_pct of before the trip'},
            {'id': 'inspect', 'role': 'supporting', 'independent': True, 'rule': 'valve damage found on inspection'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'valve damage found on inspection'},
    }

    def candidates(self, pack):
        return pack.of_type('recip_compressor_unit')

    def evaluate(self, pack, aid):
        p = self.p
        flow = pack.series(aid, 'recip_unit_flow_mmscfd')
        frame = pack.child_of_type(aid, 'recip_compressor_frame')
        vt = pack.series(frame, 'valve_temp_dev_f')
        others = [u for u in pack.children[pack.parent(aid)] if u != aid and pack.asset(u)['assetType'] == 'recip_compressor_unit']
        pw, bw = pack.steps(p['precursor_min']), pack.steps(p['baseline_min'])
        for i in range(1, pack.n):
            if not (flow[i - 1] > p['min_before_mmscfd'] and flow[i] < p['down_mmscfd']):
                continue
            if not any(pack.series(u, 'recip_unit_flow_mmscfd')[i] > p['min_before_mmscfd'] for u in others):
                continue
            base = median(vt[max(0, i - pw - bw):max(1, i - pw)])
            peak = max(vt[max(0, i - pw):i])
            if base is None or peak - base < p['valve_rise_f']:
                continue
            return Finding(aid, True, i, trip=i, flow=flow, frame=frame, vt=vt, vbase=base, others=others)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, c['trip']
        uname = unit_name(pack, aid)
        station = pack.parent(aid)
        sname = short_name(pack, station)
        flow, frame, vt, vbase = c['flow'], c['frame'], c['vt'], c['vbase']
        vib = pack.series(frame, 'frame_vibration_ips')
        pw = pack.steps(p['precursor_min'])
        vib_base = median(vib[max(0, i - pw - pack.steps(p['baseline_min'])):i - pw])
        vib_peak = max(vib[i - pw:i])
        vib_ok = vib_peak > p['vib_ratio'] * vib_base
        v_start = next(k for k in range(i - pw, i) if vt[k] > vbase + p['valve_watch_f'])
        b_start = next((k for k in range(i - pw, i) if vib[k] > p['vib_watch_ratio'] * vib_base), None)
        order_ok = b_start is not None and v_start < b_start
        eng = pack.child_of_type(aid, 'gas_engine_driver')
        others_run = [u for u in c['others'] if pack.series(u, 'recip_unit_flow_mmscfd')[i - 1] > p['min_before_mmscfd']]
        o_eng = [pack.child_of_type(u, 'gas_engine_driver') for u in others_run]
        ex = pack.series(eng, 'engine_exhaust_temp_f')
        jw = pack.series(eng, 'jacket_water_temp_f')
        ex_o = [pack.series(e, 'engine_exhaust_temp_f')[i - 1] for e in o_eng]
        jw_o = [pack.series(e, 'jacket_water_temp_f')[i - 1] for e in o_eng]
        m = p['engine_margin_f']
        eng_ok = min(ex_o) - m <= ex[i - 1] <= max(ex_o) + m and min(jw_o) - m <= jw[i - 1] <= max(jw_o) + m
        st = pack.series(station, 'station_flow_mmscfd')
        st_before = st[i - 1]
        st_low = min(st[i:])
        st_back = next((k for k in range(i + 1, pack.n) if abs(st[k] - st_before) / st_before * 100 < p['restored_pct']), None)
        standby = [u for u in c['others'] if pack.series(u, 'recip_unit_flow_mmscfd')[i - 1] < p['down_mmscfd']
                   and max(pack.series(u, 'recip_unit_flow_mmscfd')[i:]) > p['min_before_mmscfd']]
        sb = standby[0] if standby else None
        sb_flow = pack.series(sb, 'recip_unit_flow_mmscfd') if sb else None
        sb_start = next((k for k in range(i, pack.n) if sb_flow[k] > p['down_mmscfd']), None) if sb else None
        found = maintenance_records(item, ts[i], ['valve'])
        level = 'high' if found else 'medium'
        suction = pack.series(station, 'station_suction_pressure_psig')
        discharge = pack.series(station, 'station_discharge_pressure_psig')
        window = win(pack, i - pw - 6, i + 18)
        y_vt = dom(vt, [0], pad=0.05, floor=0)
        vt_o = {u: pack.series(pack.child_of_type(u, 'recip_compressor_frame'), 'valve_temp_dev_f') for u in others_run}
        vt_hi = [max(v[k] for v in vt_o.values()) for k in range(pack.n)]
        vt_lo = [min(v[k] for v in vt_o.values()) for k in range(pack.n)]

        checks = [
            check('trip', 'Tripped from full flow', 'required', MATCH,
                  f'{num(flow[i - 1], 0)} MMscf/d at {ts[i - 1]}, {num(flow[i], 0)} at {ts[i]}. The other '
                  f'{len(others_run)} running units stayed on line.',
                  'One unit dropping out while the rest of the station keeps running starts inside that unit.',
                  spark(flow, dom(flow, floor=0), window=window)),
            check('valve', 'Valve-cover temperatures climbed first', 'required', MATCH,
                  f'Largest valve-cover deviation {num(vbase, 1)} °F before, {num(max(vt[i - pw:i]), 1)} °F just before the trip. '
                  f'Other running units: {num(vt_lo[i - 1], 1)}–{num(vt_hi[i - 1], 1)} °F.',
                  'A broken or leaking valve lets hot discharge gas flow back through it, and its cover heats up. It\'s the '
                  'earliest sign of valve failure.',
                  spark(vt, y_vt, vt_lo, vt_hi, window=window)),
            check('vib', 'Frame vibration rose to the trip', 'supporting', MATCH if vib_ok else NO_MATCH,
                  f'{num(vib_base, 2)} in/s normally, {num(vib_peak, 2)} in/s at {ts[i - 1]} '
                  f'({num(vib_peak / vib_base, 1)}× normal).',
                  'Fragments and uneven gas loads knock the running gear. High-high vibration is what shut it down.',
                  spark(vib, dom(vib, floor=0), window=window)),
            check('order', 'Valve temperature before vibration', 'supporting', MATCH if order_ok else NO_MATCH,
                  (f'Valve temperature left normal at {ts[v_start]}, vibration at {ts[b_start]}, '
                   f'{dur(pack.minutes_between(v_start, b_start))} later.') if b_start else 'Vibration didn\'t move first.',
                  'The valve failed first and the mechanical damage followed. A running-gear fault would show vibration first.',
                  spark(vt, y_vt, highlight=[ts[v_start], ts[b_start or i]], window=window)),
            check('engine', 'The engine side was normal', 'supporting', MATCH if eng_ok else NO_MATCH,
                  f'Exhaust {num(ex[i - 1], 0)} °F and jacket water {num(jw[i - 1], 0)} °F just before the trip; the other '
                  f'running engines {num(min(ex_o), 0)}–{num(max(ex_o), 0)} °F and {num(min(jw_o), 0)}–{num(max(jw_o), 0)} °F.',
                  'Rules out the driver: the failure is on the compressor side of the unit.', None),
            check('station', 'Station throughput restored with standby', 'supporting', MATCH if st_back else PENDING,
                  (f'{sname} throughput fell from {num(st_before, 0)} to {num(st_low, 0)} MMscf/d'
                   + (f'; {pack.name(sb)} on line at {ts[sb_start]}' if sb_start else '')
                   + (f' and the station was back within {num(p["restored_pct"], 0)} % by {ts[st_back]}.' if st_back else '.')),
                  'Contains the event: the line gets its gas, while the tripped unit stays down for repair.',
                  spark(st, dom(st[i - 12:]), highlight=[ts[i], ts[st_back]] if st_back else None, window=window)),
            check('inspect', 'Valve damage found on inspection', 'supporting', MATCH if found else PENDING,
                  (f'{found[0]["time"]}: {found[0]["description"]}') if found else 'Not inspected yet.',
                  'Only opening the valve cap confirms which valve failed and how.', None),
        ]
        main = chart('°F', y_vt,
                     [series('vt', f'{uname} valve-cover deviation (max)', vt, 'primary', 1)],
                     title='What we see',
                     caption=f'{uname}\'s largest valve-cover temperature deviation against the other running units '
                             f'(shaded). It climbed for {dur(pack.minutes_between(v_start, i))} before the unit tripped.',
                     band=band('Other running units', vt_lo, vt_hi),
                     markers=[marker(ts[v_start], 'Valve temperature rising'), marker(ts[i], 'Trip')],
                     window=win(pack, i - pw - 12, i + 12))

        grid = minutes_grid(-90, 30, 5)
        r = Rng(555)
        tb_v = [(6 if m < -30 else 6 + (m + 30) * 0.8 if m < 0 else None) for m in grid]
        tb_v = [None if v is None else v + r.gauss(0.3) for v in tb_v]
        tb_b = [(0.21 if m < -10 else 0.21 + (m + 10) * 0.07 if m < 0 else None) for m in grid]
        tb_b = [None if v is None else v + r.gauss(0.008) for v in tb_b]
        sl_v = [6 + (m + 90) * 0.12 + r.gauss(0.3) for m in grid]
        sl_b = [0.21 + r.gauss(0.008) for m in grid]
        rg_v = [(6 if m < 0 else None) for m in grid]
        rg_v = [None if v is None else v + r.gauss(0.3) for v in rg_v]
        rg_b = [(0.21 if m < -40 else 0.21 + (m + 40) * 0.018 if m < 0 else None) for m in grid]
        rg_b = [None if v is None else v + r.gauss(0.008) for v in rg_b]
        lv = aligned(vt, i, pack.step_min, grid, 'min')
        lb = aligned(vib, i, pack.step_min, grid, 'min')
        lv = [v if m < 0 else None for v, m in zip(lv, grid)]
        lb = [v if m < 0 else None for v, m in zip(lb, grid)]
        live = f'{uname}, today'

        def pair(a, b):
            return [ref_chart('Valve-cover deviation (minutes to the trip)', '°F', dom(a, lv, pad=0.05, floor=0), grid, 'min', a, lv, live, 0),
                    ref_chart('Frame vibration', 'in/s', dom(b, lb, pad=0.05, floor=0), grid, 'min', b, lb, live, 2)]
        refs = [
            reference('plate', 'textbook', 'Textbook', 'Broken valve plate',
                      'A plate cracks and pieces flutter in the valve. The cover heats within minutes, vibration follows, '
                      'and the unit trips on high-high vibration.',
                      'match', 'Closest match', ['Temperature first, then vibration, then trip', 'About half an hour of warning'],
                      pair(tb_v, tb_b)),
            reference('leak', 'early', 'Early stage', 'Valve starting to leak',
                      'A worn seat or weak spring leaks a little. The cover warms slowly and capacity drops a little. '
                      'This is when to plan the valve change.',
                      'partial', 'Same cause, caught earlier',
                      ['Worth trending every cylinder\'s valve temperatures', f'{uname} went from this to a trip in minutes'],
                      pair(sl_v, sl_b)),
            reference('gear', 'lookalike', 'Look-alike', 'Running-gear problem',
                      'A loose crosshead or worn bearing trips the unit on vibration too, but the valves stay cool.',
                      'nomatch', 'Doesn\'t match',
                      ['Vibration without valve temperature here', f'On {uname} the valve cover moved first'], pair(rg_v, rg_b)),
        ]
        ro = [
            ruled_out('An engine problem', 'ruled out',
                      f'Exhaust ({num(ex[i - 1], 0)} °F) and jacket water ({num(jw[i - 1], 0)} °F) were in line with the other running '
                      f'engines right up to the trip.'),
            ruled_out('A station or line event', 'ruled out',
                      f'Suction {num(suction[i - 1], 0)} psig and discharge {num(discharge[i - 1], 0)} psig were steady before the '
                      f'trip, and the other units kept running.'),
            ruled_out('A running-gear fault', 'ruled out' if found else 'unlikely',
                      'The valve temperature moved before vibration did.' +
                      (f' The inspection at {found[0]["time"]} found it: "{found[0]["description"]}"' if found else '')),
        ]
        return {
            'conclusion': conclusion('Cause' if found else 'Most likely cause',
                                     f'A failed compressor valve on {uname}' if found else f'A failing compressor valve on {uname}',
                                     level, 'Confirmed by inspection' if found else 'Valve temperature led the trip; not inspected yet'),
            'rootCauseAssetId': frame,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The valve cover heated first, vibration followed, the engine side stayed normal, and the '
                                     'inspection found the broken valve.' if found else
                                     'The valve cover heated first, vibration followed, and the engine side stayed normal.',
                                     None if found else 'Nobody has opened the valve caps yet.',
                                     None if found else 'Pulling the valves finds a broken plate, spring or seat.',
                                     None if found else 'The valves are intact. Then look at the running gear and the trip log.',
                                     'Inspection' if found else None),
            'action': action(item, pack),
            'impact': (f'{sname} lost {num(st_before - st_low, 0)} MMscf/d of throughput until standby took over'
                       + (f' at {ts[st_back]}' if st_back else '') + '. The station now has no spare unit.') if sb else None,
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Growing discharge-pressure oscillation — archetype 10 (overcorrection loop)
# ═════════════════════════════════════════════════════════════════════════
def swings(values, i0, i1, dead):
    """Split the moves between i0 and i1 into alternating swings: runs of same-sign
    changes, with changes smaller than `dead` joining whichever run they fall in.
    Returns [(start, end, size)] with end the index where the swing peaked."""
    out = []
    for k in range(max(1, i0), i1 + 1):
        d = values[k] - values[k - 1]
        if out and (abs(d) < dead or (d > 0) == (out[-1][2] > 0)):
            s, _, size = out[-1]
            out[-1] = (s, k, size + d)
        elif abs(d) >= dead:
            out.append((k - 1, k, d))
    return out


class StationControlOscillation(Detector):
    id = 'pipeline.station_control_oscillation'
    name = 'Growing discharge-pressure oscillation'
    archetype = '10 Overcorrection loop'
    applies_to = 'compressor stations'
    summary = ('Station discharge pressure swinging up and down, each swing bigger than the last, with the units\' '
               'anti-surge recycle valves moving in step: control loops fighting each other, not a change in the line.')
    pipeline = [
        ('Swings', 'discharge pressure split into alternating up and down swings (moves under the dead band ignored)'),
        ('Growth', 'the last two full cycles: are the swings getting bigger?'),
        ('Mechanism', 'recycle valve commands on the station\'s units, and throughput'),
        ('Spread', 'the first valve site downstream on the gas_flow layer'),
        ('Conclusion', 'growing, regular swings with recycle in play → control-loop interaction'),
    ]
    definition = {
        'appliesTo': {'assetType': list(STATION_TYPES)},
        'inputs': {'discharge': 'self.station_discharge_pressure_psig', 'throughput': 'self.station_flow_mmscfd',
                   'recycle': 'children[turbine_compressor_unit].recycle_valve_pct',
                   'downstream': 'first mainline_valve downstream on gas_flow'},
        'params': {'window_min': 60, 'dead_psi': 1.5, 'swing_psi': 4.0, 'min_swings': 4, 'growth': 1.3,
                   'max_half_period_min': 20, 'recycle_move_pct': 5.0},
        'checks': [
            {'id': 'swinging', 'role': 'required', 'rule': '≥ min_swings alternating swings > swing_psi in window_min, each ≤ max_half_period_min'},
            {'id': 'growing', 'role': 'required', 'rule': 'last swing > growth × first swing'},
            {'id': 'recycle', 'role': 'supporting', 'independent': True, 'rule': 'recycle commands open and moving > recycle_move_pct'},
            {'id': 'flow', 'role': 'supporting', 'rule': 'throughput swinging with the pressure'},
            {'id': 'downstream', 'role': 'supporting', 'rule': 'first valve site downstream swings too, smaller'},
        ],
        'confidence': {'low': 'required checks', 'medium': 'recycle valves moving with it', 'high': 'swing stops after a control change'},
    }

    def candidates(self, pack):
        return pack.of_type(*STATION_TYPES)

    def _swings(self, pack, dis, i):
        p = self.p
        w = pack.steps(p['window_min'])
        sw = swings(dis, i - w, i, p['dead_psi'])
        # the last run of consecutive significant swings
        run = []
        for s in sw:
            ok = abs(s[2]) >= p['swing_psi'] and pack.minutes_between(s[0], s[1]) <= p['max_half_period_min']
            run = run + [s] if ok else []
        return run

    def evaluate(self, pack, aid):
        p = self.p
        dis = pack.series(aid, 'station_discharge_pressure_psig')
        for i in range(pack.steps(p['window_min']), pack.n):
            run = self._swings(pack, dis, i)
            if len(run) >= p['min_swings']:
                last = run[-p['min_swings']:]
                if abs(last[-1][2]) > p['growth'] * abs(last[0][2]):
                    return Finding(aid, True, i, dis=dis, run=run)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        sname = short_name(pack, aid)
        dis = c['dis']
        run_now = self._swings(pack, dis, now)
        first = run_now[0][0] if run_now else c['run'][0][0]
        sizes = [s[2] for s in run_now]
        half = [pack.minutes_between(a[1], b[1]) for a, b in zip(run_now, run_now[1:])]
        period = 2 * B.mean(half) if half else None
        last_lo = min(dis[run_now[-2][1]:now + 1]) if len(run_now) > 1 else min(dis[first:])
        last_hi = max(dis[run_now[-2][0]:now + 1]) if len(run_now) > 1 else max(dis[first:])
        units = [u for u in pack.children[aid] if pack.has(u, 'recycle_valve_pct')]
        rc = {u: pack.series(u, 'recycle_valve_pct') for u in units}
        rc_open = next((k for k in range(pack.n) if any(rc[u][k] > 1 for u in units)), None) if units else None
        rc_moves = {u: max(rc[u][first:now + 1]) - min(rc[u][max(first, rc_open or first):now + 1]) for u in units}
        recycle_ok = bool(units) and rc_open is not None and max(rc_moves.values()) > p['recycle_move_pct']
        thr = pack.series(aid, 'station_flow_mmscfd')
        t_sw = swings(thr, first, now, 2.0)
        t_amp = max(abs(s[2]) for s in t_sw) if t_sw else 0
        flow_ok = len(t_sw) >= p['min_swings']
        seg = next((a for a in downstream_chain(pack, aid) if pack.asset(a)['assetType'] == 'pipeline_segment'), None)
        mlvs = [m for m in pack.children.get(seg, []) if pack.asset(m)['assetType'] == 'mainline_valve']
        mlv = next((m for m in mlvs if not any(s in mlvs for s in pack.sources(m, 'gas_flow'))), None)
        mv = pack.series(mlv, 'mlv_pressure_psig') if mlv else None
        m_sw = swings(mv, first, now, 1.0) if mv else []
        m_amp = max(abs(s[2]) for s in m_sw[-2:]) if m_sw else 0
        d_amp = max(abs(s[2]) for s in run_now[-2:])
        down_ok = mv is not None and len(m_sw) >= 3 and m_amp < d_amp
        suction = pack.series(aid, 'station_suction_pressure_psig')
        up_seg = next((a for a in pack.sources(aid, 'gas_flow') if pack.asset(a)['assetType'] == 'pipeline_segment'), None)
        up_name = pack.name(up_seg).split(' (')[0] if up_seg else 'the segment upstream'
        mode = (pack.unit_status.get(aid) or {}).get('mode', '')
        moves = [w for w in item['detail'].get('whatChanged', []) if w.get('source') in ('Operator Action', 'Setpoint Change')
                 and w['time'] in pack.ts and tmin(w['time']) >= tmin(ts[max(0, first - 36)])]
        level = 'medium' if recycle_ok else 'low'
        window = win(pack, first - 12, now)
        y_d = dom(dis[first - 12:], pad=0.1)
        rc_all = [max(rc[u][k] for u in units) for k in range(pack.n)] if units else None

        checks = [
            check('swinging', f'{len(run_now)} swings in a row', 'required', MATCH,
                  f'Discharge pressure swung ' + ', '.join(signed(s, 0) for s in sizes) + f' psi since {ts[first]}, about '
                  f'every {dur(period / 2) if period else "—"}: a cycle of about {dur(period) if period else "—"}.',
                  'A controller that keeps overshooting drives regular up-and-down swings. A change in the line would move '
                  'pressure one way.',
                  spark(dis, y_d, highlight=[ts[first], ts[now]], window=window)),
            check('growing', 'Each swing bigger than the last', 'required', MATCH,
                  f'From {num(abs(sizes[0]), 0)} psi to {num(abs(sizes[-1]), 0)} psi. The last cycle ran '
                  f'{num(last_lo, 0)}–{num(last_hi, 0)} psig.',
                  'Growing swings mean the loop is feeding energy back in. Left alone they get bigger until something trips.',
                  spark(dis, y_d, window=window)),
            check('recycle', 'Recycle valves moving with it', 'supporting', MATCH if recycle_ok else NO_MATCH,
                  (f'Recycle opened at {ts[rc_open]} as the units reached minimum flow; since then they have moved '
                   f'{num(min(rc_moves.values()), 0)}–{num(max(rc_moves.values()), 0)} points, up to {num(max(rc_all[first:]), 0)} % open.')
                  if rc_open is not None else 'Recycle valves closed.',
                  'A separate signal. With the units at minimum flow, each recycle move shifts discharge pressure, and the '
                  'pressure controller answers it: two loops acting on the same gas.',
                  spark(rc_all, [0, max(40, max(rc_all) * 1.2)], window=window) if rc_all else None),
            check('flow', 'Throughput swinging too', 'supporting', MATCH if flow_ok else NO_MATCH,
                  f'Station throughput swung up to {num(t_amp, 0)} MMscf/d in step with the pressure.',
                  'The pressure swing is real gas moving, not a transmitter.',
                  spark(thr, dom(thr[first - 12:]), window=window)),
            check('downstream', 'Felt downstream, smaller', 'supporting', MATCH if down_ok else NO_MATCH,
                  (f'{pack.name(mlv).split(" (")[0]} swings up to {num(m_amp, 0)} psi against {num(d_amp, 0)} psi at the station.')
                  if mv else 'No valve site downstream.',
                  'The line damps the swing as it travels. It confirms the pressure is really moving, and shows how far it reaches.',
                  spark(mv, dom(mv[first - 12:]), window=window) if mv else None),
        ]
        main = chart('psig', y_d,
                     [series('dis', f'{sname} discharge pressure', dis, 'primary', 1)],
                     title='What we see',
                     caption=f'{sname} discharge pressure. Each swing is bigger than the one before.',
                     markers=([marker(ts[rc_open], 'Recycle opens')] if rc_open is not None else []) +
                             [marker(w['time'], 'Manual move' if w['source'] == 'Operator Action' else 'Setpoint change')
                              for w in moves] + [marker(ts[i], 'Flagged')],
                     window=window)

        grid = minutes_grid(-20, 90, 5)
        r = Rng(666)
        grow = [(0 if m < 0 else 4 * math.exp(m / 45) * math.sin(2 * math.pi * m / 20)) + r.gauss(0.5) for m in grid]
        grow_r = [(0 if m < 0 else 22 + 4 * math.exp(m / 45) * math.sin(2 * math.pi * m / 20 + math.pi)) + r.gauss(0.5)
                  for m in grid]
        lim = [(0 if m < 0 else 9 * math.sin(2 * math.pi * m / 20)) + r.gauss(0.5) for m in grid]
        lim_r = [(0 if m < 0 else 22 + 9 * math.sin(2 * math.pi * m / 20 + math.pi)) + r.gauss(0.5) for m in grid]
        damp = [(0 if m < 0 else 12 * math.exp(-m / 15) * math.sin(2 * math.pi * m / 20 + math.pi / 2)) + r.gauss(0.5) for m in grid]
        damp_r = [(0 if m < 0 else max(0, 8 * math.exp(-m / 15))) + r.gauss(0.3) for m in grid]
        base = B.mean(dis[first - 3:first + 1])
        ld = aligned([v - base for v in dis], first, pack.step_min, grid, 'min')
        lr = aligned(rc_all, first, pack.step_min, grid, 'min') if rc_all else [None] * len(grid)
        live = f'{sname}, today'

        def pair(a, b):
            return [ref_chart('Discharge pressure, change from before', 'psi', dom(a, ld, pad=0.05), grid, 'min', a, ld, live, 0),
                    ref_chart('Recycle valve (most open unit)', '%', dom(b, lr, [0], floor=0), grid, 'min', b, lr, live, 0)]
        refs = [
            reference('interact', 'textbook', 'Textbook', 'Pressure and anti-surge loops fighting',
                      'Units near minimum flow: recycle opens, pressure drops, the pressure controller pushes back, recycle '
                      'closes, and round again — each time a little bigger.',
                      'match', 'Closest match', ['Same growing swing on a ~20-minute cycle', 'Recycle moving in step'],
                      pair(grow, grow_r)),
            reference('limit', 'variant', 'Variant', 'Steady limit cycle',
                      'The same interaction settles at a fixed size. Annoying rather than dangerous, but it wears valves and '
                      'costs fuel.',
                      'partial', 'Same loops, not growing', [f'{sname}\'s swings are still growing', 'Same fix: stop one loop '
                                                              'from fighting the other'], pair(lim, lim_r)),
            reference('damped', 'lookalike', 'Look-alike', 'Settling after a setpoint change',
                      'One setpoint step rings for a cycle or two and dies away. Normal control behaviour.',
                      'nomatch', 'Doesn\'t match', ['Swings shrink here', f'On {sname} each swing is bigger'], pair(damp, damp_r)),
        ]
        ro = [
            ruled_out('A change in the line', 'ruled out',
                      f'Suction pressure kept rising as {up_name} packed ({num(suction[first], 0)} → {num(suction[now], 0)} psig) '
                      f'without swinging like the discharge. The swinging starts at the station.'),
            ruled_out('A pressure transmitter fault', 'ruled out',
                      'Throughput, recycle valves and the valve site downstream all move with the reading.'),
            ruled_out('Compressor surge', 'not yet checked',
                      'Both units are at minimum flow with recycle open, so anti-surge control is active. No surge event is '
                      'recorded yet; the unit surge logs would show one.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause',
                                     f'{sname}\'s discharge-pressure control and the units\' anti-surge recycle are fighting',
                                     level, 'Recycle moves in step with the swing' if recycle_ok else 'Pressure swing only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The swing is regular and growing, and the recycle valves, a separate signal, move with it '
                                     f'while the units sit at minimum flow{" (station on " + mode.lower().replace("_", " ") + ")" if mode else ""}.',
                                     'A control-loop interaction is a hypothesis until a control change stops the swing.',
                                     'Base-loading one unit, or going back to suction control, stops the swing within a cycle '
                                     'or two.',
                                     'The swing carries on with one unit base-loaded. Then look at the anti-surge valve '
                                     'positioners and the pressure transmitter.'),
            'action': action(item, pack),
            'impact': f'The last cycle reached {num(last_hi, 0)} psig; a bigger swing can surge-trip a unit or push the segment '
                      f'downstream toward MAOP.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. Segment packing behind a downstream restriction — archetype 04 (accumulation)
# ═════════════════════════════════════════════════════════════════════════
SCHEDULE_KEYS = [('ic_delivery_flow_mmscfd', 'ic_scheduled_flow_mmscfd'),
                 ('pp_delivery_flow_mmscfd', 'pp_scheduled_flow_mmscfd')]


def schedule_keys(pack, aid):
    for fk, sk in SCHEDULE_KEYS:
        if pack.has(aid, fk) and pack.has(aid, sk):
            return fk, sk
    return None


class SegmentPacking(Detector):
    id = 'pipeline.segment_packing'
    name = 'Segment packing behind a delivery shortfall'
    archetype = '04 Accumulation'
    applies_to = 'line segments'
    summary = ('A segment\'s line pack climbing steadily because a delivery it feeds is taking well under its schedule: '
               'gas is arriving faster than it can leave, and pressure creeps toward MAOP from the end of the line back.')
    pipeline = [
        ('Line pack', 'the segment\'s line pack and its trend over the last hour'),
        ('Outlets', 'the scheduled deliveries this segment feeds on the gas_flow layer, against their schedules'),
        ('Checks', 'packing · delivery short · pressure toward MAOP · inflow normal · turned after the inflow was cut'),
        ('Conclusion', 'the build is a downstream restriction; the fix is upstream flow, then receipts'),
    ]
    definition = {
        'appliesTo': {'assetType': 'pipeline_segment'},
        'inputs': {'pack': 'self.line_pack_mmscf', 'inlet': 'self.seg_inlet_pressure_psig', 'maop': 'self.maop_psig (static)',
                   'inflow': 'self.seg_flow_mmscfd', 'outlets': 'gas_flow targets with a scheduled quantity'},
        'params': {'slope_window_min': 60, 'pack_rise_mmscf_h': 1.5, 'sustain_min': 30, 'short_pct': 5.0,
                   'maop_watch_psi': 30.0, 'turn_min': 30, 'cut_pct': 10.0},
        'checks': [
            {'id': 'packing', 'role': 'required', 'rule': 'slope(line pack, slope_window_min) > pack_rise_mmscf_h for sustain_min'},
            {'id': 'short', 'role': 'required', 'rule': 'an outlet delivers < schedule × (1 − short_pct) through the same time'},
            {'id': 'pressure', 'role': 'supporting', 'independent': True, 'rule': 'inlet pressure rising, margin to MAOP < maop_watch_psi at its peak'},
            {'id': 'inflow', 'role': 'supporting', 'rule': 'inflow not above its morning level (the build is at the outlet)'},
            {'id': 'turned', 'role': 'supporting', 'independent': True, 'rule': 'line pack falling for turn_min after the peak (inflow cut = inflow < morning × (1 − cut_pct))'},
        ],
        'confidence': {'medium': 'required checks + pressure', 'high': 'line pack turned once the inflow was cut'},
    }

    def candidates(self, pack):
        return pack.of_type('pipeline_segment')

    def evaluate(self, pack, aid):
        p = self.p
        lp = pack.series(aid, 'line_pack_mmscf')
        outs = [t for t in targets(pack, aid, 'gas_flow') if schedule_keys(pack, t)]
        if not outs:
            return Finding(aid, False)
        sw = pack.steps(p['slope_window_min'])
        slope = [B.slope_per_hour(lp, k, sw, pack.step_min) if k >= sw - 1 else None for k in range(pack.n)]
        packing = B.gt(slope, p['pack_rise_mmscf_h'])
        for o in outs:
            fk, sk = schedule_keys(pack, o)
            fl, sc = pack.series(o, fk), pack.series(o, sk)
            short = [f < s * (1 - p['short_pct'] / 100) for f, s in zip(fl, sc)]
            for i in range(pack.n):
                s0 = B.sustained_since(packing, i)
                if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                    continue
                d0 = B.sustained_since(short, i)
                if d0 is None or d0 > s0:
                    continue
                return Finding(aid, True, i, lp=lp, slope=slope, outlet=o, fk=fk, sk=sk, fl=fl, sc=sc,
                               pack_start=s0, short_start=d0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        seg = pack.name(aid).split(' (')[0]
        lp, slope, o = c['lp'], c['slope'], c['outlet']
        oname = short_name(pack, o)
        fl, sc = c['fl'], c['sc']
        s0, d0 = c['pack_start'], c['short_start']
        nb = pack.steps(60)
        peak = max(range(d0, pack.n), key=lambda k: lp[k])
        tw = pack.steps(p['turn_min'])
        falling = [s is not None and s < 0 for s in slope]
        turned_at = next((k for k in range(peak, pack.n - tw + 1) if all(falling[k:k + tw])), None)
        turned = turned_at is not None
        short_avg = B.mean([s - v for v, s in zip(fl[d0:], sc[d0:])])
        short_pct = 100 * short_avg / B.mean(sc[d0:])
        inflow = pack.series(aid, 'seg_flow_mmscfd')
        in_base = B.mean(inflow[:nb])
        in_build = B.mean(inflow[d0:peak + 1])
        cut = in_base * (1 - p['cut_pct'] / 100)
        cut_at = next((k for k in range(d0, pack.n) if all(v < cut for v in inflow[k:k + 3])), None)
        inflow_ok = in_build <= in_base * 1.01
        up = next((a for a in pack.sources(aid, 'gas_flow') if pack.asset(a)['assetLevel'] == 'facility'), None)
        inlet = pack.series(aid, 'seg_inlet_pressure_psig')
        maop = pack.values.get(aid, {}).get('maop_psig', 1000.0)
        pk_in = max(range(d0, pack.n), key=lambda k: inlet[k])
        margin = maop - inlet[pk_in]
        press_ok = inlet[pk_in] - inlet[d0] > 10 and margin < p['maop_watch_psi']
        op = pack.series(o, 'ic_delivery_pressure_psig') if pack.has(o, 'ic_delivery_pressure_psig') else None
        # the gas didn't vanish: what is upstream doing now?
        up_seg = next((a for a in pack.sources(up, 'gas_flow') if pack.asset(a)['assetType'] == 'pipeline_segment'), None) if up else None
        up_lp = pack.series(up_seg, 'line_pack_mmscf') if up_seg else None
        sysid = next(a['id'] for a in pack.assets if a['parentId'] is None)
        sys_lp = pack.series(sysid, 'system_line_pack_mmscf')
        receipts = pack.series(sysid, 'total_receipts_mmscfd')
        rsched = [sum(pack.series(r, RECEIPT_KEYS[pack.asset(r)['assetType']][1])[k] for r in pack.of_type(*RECEIPT_KEYS))
                  for k in range(pack.n)]
        level = 'high' if turned else 'medium' if press_ok else 'low'
        window = win(pack, d0 - 12, now)
        y_lp = dom(lp, pad=0.1)

        checks = [
            check('packing', 'Line pack climbing', 'required', MATCH,
                  f'{num(lp[d0], 1)} MMscf at {ts[d0]}, {num(lp[peak], 1)} at {ts[peak]}: +{num(lp[peak] - lp[d0], 1)} MMscf. '
                  f'Rising faster than {num(p["pack_rise_mmscf_h"], 1)} MMscf/h from {ts[s0]}.',
                  'Line pack is gas stored in the pipe. It climbs whenever more arrives than leaves.',
                  spark(lp, y_lp, window=window)),
            check('short', f'{oname} taking {num(short_pct, 0)} % under schedule', 'required', MATCH,
                  f'{num(B.mean(fl[d0:]), 0)} MMscf/d on average since {ts[d0]} against {num(sc[d0], 0)} scheduled: '
                  f'{num(short_avg, 0)} MMscf/d that stays in the pipe.',
                  f'{oname} is the way out of {seg} on the gas_flow layer. When it takes less, the segment fills from the end back.',
                  spark(fl, dom(fl, sc, pad=0.1), window=window)),
            check('pressure', 'Pressure creeping toward MAOP', 'supporting', MATCH if press_ok else NO_MATCH,
                  f'Inlet pressure {num(inlet[d0], 0)} psig at {ts[d0]}, {num(inlet[pk_in], 0)} at {ts[pk_in]}: {num(margin, 0)} psi '
                  f'under the {num(maop, 0)} psig MAOP.' + (f' {oname} delivery pressure {num(op[d0], 0)} → {num(max(op), 0)} psig.' if op else ''),
                  'Separate pressure transmitters telling the same story as the flow meters.',
                  spark(inlet, dom(inlet, [maop], pad=0.05), threshold_value=maop, window=window)),
            check('inflow', 'Nothing extra coming in', 'supporting', MATCH if inflow_ok else NO_MATCH,
                  f'Inflow averaged {num(in_build, 0)} MMscf/d while it packed, against {num(in_base, 0)} in the first hour.',
                  'The build comes from the outlet, not from more gas arriving.',
                  spark(inflow, dom(inflow, pad=0.1), window=window)),
            check('turned', 'Easing since the inflow was cut', 'supporting', MATCH if turned else PENDING,
                  (f'{short_name(pack, up)} cut its throughput from {ts[cut_at]}; line pack peaked at {ts[peak]} and has fallen '
                   f'to {num(lp[now], 1)} MMscf.' if cut_at is not None else
                   f'Line pack peaked at {ts[peak]} and has fallen to {num(lp[now], 1)} MMscf.') if turned
                  else 'Still climbing.',
                  'Cutting the inflow stopped the build, which is what a downstream restriction predicts.',
                  spark(lp, y_lp, highlight=[ts[peak], ts[now]] if turned else None, window=window)),
        ]
        main = chart('MMscf', y_lp,
                     [series('lp', f'{seg} line pack', lp, 'primary', 2)],
                     title='What we see',
                     caption=f'{seg} line pack. It climbed while {oname} took less than scheduled, and eased once less gas '
                             f'was sent in.',
                     markers=[marker(ts[d0], f'{oname} restricted')] +
                             ([marker(ts[cut_at], 'Inflow cut')] if cut_at is not None else []) +
                             ([marker(ts[peak], 'Peak')] if turned and peak != cut_at else []))
        out_chart = chart('MMscf/d', dom(fl, sc, pad=0.1),
                          [series('flow', f'{oname} delivery', fl, 'primary', 0),
                           series('sched', 'Scheduled', sc, 'expected', 0)],
                          caption=f'{oname} delivery against its schedule.', shade_gap=['sched', 'flow'])

        grid = hours_grid(4, 0.25, -0.5)
        r = Rng(777)
        tb_l = [(0 if h < 0 else 4.0 * h if h < 2.4 else 9.6 - 2.2 * (h - 2.4)) + r.gauss(0.08) for h in grid]
        tb_d = [(100 if h < 0 else 83) + r.gauss(0.4) for h in grid]
        na_l = [(0 if h < 0 else 4.0 * h) + r.gauss(0.08) for h in grid]
        na_d = [(100 if h < 0 else 83) + r.gauss(0.4) for h in grid]
        pl_l = [(0 if h < 0 else 3.0 * h if h < 3 else 9) + r.gauss(0.08) for h in grid]
        pl_d = [100 + r.gauss(0.4) for h in grid]
        ll = aligned([v - lp[d0] for v in lp], d0, pack.step_min, grid)
        ld = aligned([100 * v / s for v, s in zip(fl, sc)], d0, pack.step_min, grid)
        live = f'{seg}, today'

        def pair(a, b):
            return [ref_chart('Line pack change since the start', 'MMscf', dom(a, ll, [0], pad=0.05), grid, 'h', a, ll, live, 1),
                    ref_chart('Delivery (% of schedule)', '%', dom(b, ld, [100], pad=0.1), grid, 'h', b, ld,
                              f'{oname}, today', 0)]
        refs = [
            reference('restrict', 'textbook', 'Textbook', 'Downstream restriction, held back upstream',
                      'The downstream pipeline cuts its take. The segment packs until the station upstream is held back, '
                      'then eases; receipts are cut at the next nomination cycle.',
                      'match', 'Closest match', ['Same build rate', 'Turned once the station was held back'], pair(tb_l, tb_d)),
            reference('noaction', 'variant', 'What to avoid', 'Nobody holds the station back',
                      'The same restriction with no action. Pack keeps climbing until the station reaches its discharge limit '
                      'and MAOP margin is gone.',
                      'nomatch', 'Avoided', ['Here the build never turns', 'The MAOP margin runs out within hours'], pair(na_l, na_d)),
            reference('planned', 'lookalike', 'Look-alike', 'Planned packing',
                      'Gas control packs the line on purpose ahead of an evening peak. Deliveries stay on schedule.',
                      'nomatch', 'Doesn\'t match', [f'Deliveries on schedule here; {oname} was {num(short_pct, 0)} % short',
                                                    'Planned packing stops at a target, it doesn\'t need a hold'], pair(pl_l, pl_d)),
        ]
        up_gain = (up_lp[now] - up_lp[now - nb]) if up_lp else None
        ro = [
            ruled_out('Receipts above schedule', 'ruled out',
                      f'Total receipts held at {num(min(receipts[d0:]), 0)}–{num(max(receipts[d0:]), 0)} MMscf/d against '
                      f'{num(rsched[now], 0)} scheduled.'),
            ruled_out(f'A {oname} meter error', 'ruled out',
                      f'A meter reading low while the gas still flowed wouldn\'t raise the pressure. {oname} delivery pressure went '
                      f'up {num(max(op) - op[d0], 0)} psi with the shortfall:' if op else
                      'The pressure rise says the gas really stayed in the pipe:', out_chart),
            ruled_out(f'A blockage or closed valve in {seg}', 'ruled out',
                      f'A restriction inside the segment would starve its far end. Instead pressure rose all the way to '
                      f'{oname}' + (f' ({num(op[d0], 0)} → {num(max(op), 0)} psig).' if op else '.')),
        ]
        return {
            'conclusion': conclusion('Cause' if turned else 'Most likely cause',
                                     f'{oname} is taking {num(short_pct, 0)} % under schedule, so gas is backing up into {seg}',
                                     level, 'Confirmed: the build turned once less gas was sent in' if turned
                                     else 'Delivery short and line pack climbing together'),
            'rootCauseAssetId': o,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     f'{oname} is short, {seg} packed while it was, pressure rose with it, and the build turned when '
                                     'the inflow was cut.' if turned else f'{oname} is short and {seg} is packing while it is.',
                                     None if turned else 'The inflow hasn\'t been cut yet to show the build stops.',
                                     None if turned else 'Holding the station upstream back turns the build.',
                                     f'{oname} returns to schedule and the segment still packs. Then look for a closed valve.',
                                     'Build turned after the inflow cut' if turned else None),
            'action': action(item, pack),
            'impact': f'About {num(short_avg * pack.minutes_between(d0, now) / 1440, 1)} MMscf not delivered to {oname} since '
                      f'{ts[d0]}. {seg} is easing, but the gas moved upstream rather than leaving: '
                      + (f'{pack.name(up_seg).split(" (")[0]} gained {num(up_gain, 1)} MMscf and ' if up_seg else '')
                      + f'the whole line {num(sys_lp[now] - sys_lp[now - nb], 1)} MMscf in the last hour. The line keeps packing '
                        f'until receipts are cut.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. Wet gas at a receipt — archetype 13 (quality drift)
# ═════════════════════════════════════════════════════════════════════════
class ReceiptWetGas(Detector):
    id = 'pipeline.receipt_wet_gas'
    name = 'Receipt gas getting wetter'
    archetype = '13 Quality drift'
    applies_to = 'gas quality analyzers'
    summary = ('Water content at a receipt climbing toward the tariff limit while flow stays on nomination and the '
               'separator it samples starts collecting liquid: the producer\'s dehydration is failing.')
    pipeline = [
        ('Trend', 'water content, its rise over its own first hour and its slope over the last hour'),
        ('Headroom', 'time to the 7 lb/MMscf tariff limit at the current rate'),
        ('Follow the sample', 'the filter/separator this analyzer samples (sample layer): is it collecting liquid?'),
        ('Checks', 'rising · heading for the limit · separator liquid · only water moving · flow on nomination · recovery'),
        ('Conclusion', 'water and separator liquid together → dehydrator carry-over'),
    ]
    definition = {
        'appliesTo': {'assetType': 'gas_quality_analyzer'},
        'inputs': {'water': 'self.water_content_lb_mmscf', 'h2s': 'self.h2s_gr_100scf', 'dewPoint': 'self.hc_dew_point_f',
                   'separator': 'sources[layer=sample].separator_liquid_level_pct', 'flow': 'parent receipt flow vs scheduled'},
        'params': {'baseline_min': 60, 'rise_lb': 1.0, 'slope_window_min': 60, 'min_slope_lb_h': 0.8,
                   'tariff_lb': 7.0, 'horizon_min': 120, 'liquid_above_pct': 10.0, 'h2s_band_gr': 0.02,
                   'dew_band_f': 2.0, 'flow_band_pct': 5.0, 'recovered_lb': 0.5},
        'checks': [
            {'id': 'rising', 'role': 'required', 'rule': 'water > baseline + rise_lb and slope > min_slope_lb_h'},
            {'id': 'limit', 'role': 'required', 'rule': 'projected to reach tariff_lb within horizon_min'},
            {'id': 'liquid', 'role': 'supporting', 'independent': True, 'rule': 'separator level > its first-hour max + liquid_above_pct'},
            {'id': 'only', 'role': 'supporting', 'rule': 'H₂S within ±h2s_band_gr and HC dew point within ±dew_band_f of their baselines'},
            {'id': 'flow', 'role': 'supporting', 'rule': 'receipt within flow_band_pct of its schedule'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'back within recovered_lb of baseline after the peak'},
        ],
        'confidence': {'medium': 'required checks + separator liquid', 'high': 'water back to normal after the producer acted'},
    }

    def candidates(self, pack):
        return pack.of_type('gas_quality_analyzer')

    def evaluate(self, pack, aid):
        p = self.p
        w = pack.series(aid, 'water_content_lb_mmscf')
        nb = pack.steps(p['baseline_min'])
        base = B.mean(w[:nb])
        sw = pack.steps(p['slope_window_min'])
        for i in range(nb, pack.n):
            sl = B.slope_per_hour(w, i, sw, pack.step_min)
            if sl is None or w[i] < base + p['rise_lb'] or sl < p['min_slope_lb_h']:
                continue
            eta = (p['tariff_lb'] - w[i]) / sl * 60
            if eta > p['horizon_min']:
                continue
            return Finding(aid, True, i, w=w, base=base, slope=sl, eta=eta, nb=nb)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        station = pack.parent(aid)
        rname = short_name(pack, station)
        w, base, nb = c['w'], c['base'], c['nb']
        onset = next(k for k in range(nb, i + 1) if all(v > base + 0.25 for v in w[k:i + 1]))
        peak = max(range(i, pack.n), key=lambda k: w[k])
        rec = next((k for k in range(peak, pack.n) if w[k] < base + p['recovered_lb']), None)
        recovered = rec is not None
        seps = [a for a in pack.sources(aid, 'sample') if pack.has(a, 'separator_liquid_level_pct')]
        sep = seps[0] if seps else None
        lvl = pack.series(sep, 'separator_liquid_level_pct') if sep else None
        l_norm = max(lvl[:nb]) if lvl else None
        l_peak_k = max(range(onset, (rec or now) + 1), key=lambda k: lvl[k]) if lvl else None
        liquid_ok = lvl is not None and lvl[l_peak_k] > l_norm + p['liquid_above_pct']
        dump = next((k for k in range(l_peak_k + 1, pack.n) if lvl[k] < lvl[k - 1] - 15), None) if lvl else None
        others = {}
        for key, band_key in (('h2s_gr_100scf', 'h2s_band_gr'), ('hc_dew_point_f', 'dew_band_f')):
            if pack.has(aid, key):
                v = pack.series(aid, key)
                b = B.mean(v[:nb])
                others[key] = (b, max(abs(x - b) for x in v[onset:(rec or now) + 1]), v, p[band_key])
        only_ok = all(dev <= lim for b, dev, _, lim in others.values())
        fk, sk = RECEIPT_KEYS[pack.asset(station)['assetType']]
        flow, sched = pack.series(station, fk), pack.series(station, sk)
        f_dev = max(abs(a - b) / b * 100 for a, b in zip(flow[onset:], sched[onset:]))
        flow_ok = f_dev < p['flow_band_pct']
        level = 'high' if recovered else 'medium' if liquid_ok else 'low'
        window = win(pack, onset - 12, (rec or now) + 12)
        y_w = dom(w, [p['tariff_lb']], pad=0.05, floor=0)
        eta_t = tmin(ts[i]) + c['eta']
        h2s = others.get('h2s_gr_100scf')
        dew = others.get('hc_dew_point_f')

        checks = [
            check('rising', 'Water content climbing', 'required', MATCH,
                  f'{num(base, 1)} lb/MMscf in the first hour, {num(w[i], 2)} at {ts[i]}, rising '
                  f'{num(c["slope"], 1)} lb/MMscf per hour. Peak {num(w[peak], 2)} at {ts[peak]}.',
                  'Gas leaving a working glycol dehydrator is dry and steady. A climb like this means the dehydrator is '
                  'losing its grip.',
                  spark(w, y_w, threshold_value=p['tariff_lb'], window=window)),
            check('limit', f'Heading for the {num(p["tariff_lb"], 0)} lb/MMscf tariff limit', 'required', MATCH,
                  f'At the {ts[i]} rate it would have crossed the limit at about {hhmm(eta_t)}, {dur(c["eta"])} later.',
                  'Above the tariff limit the receipt is non-conforming and can be refused. Wet gas forms hydrates at '
                  'city-gate regulators and corrodes the pipe.',
                  spark(w, y_w, threshold_value=p['tariff_lb'], highlight=[ts[onset], ts[i]], window=window)),
            check('liquid', 'The separator started collecting liquid', 'supporting', MATCH if liquid_ok else NO_MATCH,
                  (f'{pack.name(sep)} level peaked at {num(lvl[l_peak_k], 0)} % at {ts[l_peak_k]}; it normally cycles up to '
                   f'{num(l_norm, 0)} % between dumps.' + (f' It dumped at {ts[dump]}.' if dump else '')) if lvl
                  else 'No separator level on the sample point.',
                  'A separate sensor on the same gas. Glycol and water carried over from a failing dehydrator drop out in '
                  'the separator.',
                  spark(lvl, [0, 100], threshold_value=l_norm + p['liquid_above_pct'], window=window) if lvl else None),
            check('only', 'Only the water changed', 'supporting', MATCH if only_ok else NO_MATCH,
                  (f'H₂S {num(h2s[0], 2)} gr/100 scf (moved {num(h2s[1], 3)})' if h2s else '') +
                  (f', hydrocarbon dew point {num(dew[0], 0)} °F (moved {num(dew[1], 1)} °F)' if dew else '') + '.',
                  'A different gas source would change the whole composition. Losing dehydration only adds water.',
                  spark(h2s[2], dom(h2s[2], [0]), window=window) if h2s else None),
            check('flow', 'Flow on nomination', 'supporting', MATCH if flow_ok else NO_MATCH,
                  f'{rname} receipts stayed within {num(f_dev, 1)} % of the {num(sched[now], 0)} MMscf/d schedule.',
                  'The producer didn\'t change rate: more gas through the same dehydrator isn\'t the reason.',
                  spark(flow, dom(flow, sched, pad=0.3), window=window)),
            check('recovered', 'Back to normal after the producer acted', 'supporting', MATCH if recovered else PENDING,
                  f'Back under {num(base + p["recovered_lb"], 1)} lb/MMscf by {ts[rec]}; {num(w[now], 2)} now.' if recovered
                  else 'Still elevated.',
                  'Restoring glycol circulation dried the gas again, which confirms where the water came from.',
                  spark(w, y_w, highlight=[ts[peak], ts[rec]] if recovered else None, window=window)),
        ]
        main = chart('lb/MMscf', y_w,
                     [series('w', f'{rname} water content', w, 'primary', 2)],
                     title='What we see',
                     caption=f'Water content in the {rname} receipt gas, against the tariff limit.',
                     thresholds=[threshold(p['tariff_lb'], 'Tariff limit')],
                     markers=[marker(ts[onset], 'Rise begins'), marker(ts[i], 'Flagged')] +
                             ([marker(ts[rec], 'Back to normal')] if recovered else []))

        grid = hours_grid(5, 0.25, -0.5)
        r = Rng(888)
        up = lambda h, rate, top, fix: (0 if h < 0 else min(top, rate * h)) if (fix is None or h < fix) else \
            max(0, min(top, rate * fix) - 2.5 * (h - fix))
        tb_w = [base + up(h, 1.6, 3.6, 2.2) + r.gauss(0.05) for h in grid]
        tb_l = [(25 if h < 0.5 else min(65, 25 + 18 * (h - 0.5))) if h < 2.5 else 25 + r.gauss(1) for h in grid]
        sl_w = [base + (0 if h < 0 else 0.25 * h) + r.gauss(0.05) for h in grid]
        sl_l = [25 + 3 * r.gauss(1) for h in grid]
        sp_w = [base + (0 if h < 0 else 1.0 * (h < 3) + 1.0) + r.gauss(0.05) for h in grid]
        sp_l = [25 + r.gauss(1) for h in grid]
        lw = aligned(w, onset, pack.step_min, grid)
        ll = aligned(lvl, onset, pack.step_min, grid) if lvl else [None] * len(grid)
        live = f'{rname}, today'
        th = [threshold(p['tariff_lb'], 'Limit')]

        def pair(a, b):
            return [ref_chart('Water content', 'lb/MMscf', dom(a, lw, [p['tariff_lb']], pad=0.05, floor=0), grid, 'h', a, lw, live, 1, th),
                    ref_chart('Separator liquid level', '%', [0, 100], grid, 'h', b, ll, live, 0)]
        refs = [
            reference('glycol', 'textbook', 'Textbook', 'Glycol circulation lost',
                      'The contactor stops getting lean glycol. Water climbs within the hour and glycol carries over into '
                      'the separator. It clears once circulation is restored.',
                      'match', 'Closest match', ['Same climb rate', 'Separator liquid rising with it'], pair(tb_w, tb_l)),
            reference('degraded', 'early', 'Early stage', 'Glycol degrading',
                      'Contaminated or poorly regenerated glycol dries the gas less and less over days. No carry-over.',
                      'partial', 'Same equipment, slower', ['Worth a lab test on the glycol', 'Easy to miss inside the tariff limit'],
                      pair(sl_w, sl_l)),
            reference('analyzer', 'lookalike', 'Look-alike', 'Analyzer fault',
                      'The moisture analyzer steps up and sticks after a sample-system problem. The separator stays dry.',
                      'nomatch', 'Doesn\'t match', ['A step and a plateau, not a climb',
                                                    f'No liquid here; {rname}\'s separator filled'], pair(sp_w, sp_l)),
        ]
        ro = [
            ruled_out('A moisture analyzer fault', 'ruled out' if liquid_ok else 'unlikely',
                      'The separator, a separate sensor on the same gas, filled with liquid at the same time.'
                      if liquid_ok else 'The rise is gradual, not a step.'),
            ruled_out('A different gas source', 'ruled out',
                      'H₂S and hydrocarbon dew point stayed where they were. Only the water changed.'),
            ruled_out('More gas through the dehydrator', 'ruled out',
                      f'Receipts stayed within {num(f_dev, 1)} % of nomination throughout.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     f'The producer\'s glycol dehydrator upstream of {rname} lost circulation', level,
                                     'Confirmed: the water cleared once the producer acted' if recovered
                                     else 'Water and separator liquid rising together'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Water content and separator liquid, two separate sensors, rose together while nothing else '
                                     'in the gas changed, and it cleared when the producer fixed the dehydrator.' if recovered
                                     else 'Water content and separator liquid rose together while nothing else in the gas changed.',
                                     None if recovered else 'The producer hasn\'t confirmed the dehydrator problem yet.',
                                     None if recovered else 'The producer finds a glycol circulation or regeneration fault.',
                                     'The separator liquid sample comes back as hydrocarbon only. Then look for a second source.',
                                     'Recovery after the producer acted' if recovered else None),
            'action': action(item, pack),
            'impact': f'Peak {num(w[peak], 2)} lb/MMscf at {ts[peak]}, {num(p["tariff_lb"] - w[peak], 2)} under the tariff limit.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Hidden recycle: more fuel for the same throughput — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class HiddenRecycleFuel(Detector):
    id = 'pipeline.hidden_recycle_fuel'
    name = 'Hidden recycle: more fuel for the same throughput'
    archetype = '08 Throughput illusion'
    applies_to = 'turbine compressor stations'
    summary = ('The station meter says throughput is flat, but its units are compressing more gas than leaves the '
               'station with every recycle valve commanded shut, and fuel keeps rising: gas is going round a unit.')
    pipeline = [
        ('Headline', 'station throughput (the station meter) — what the flow KPIs show'),
        ('Unit balance', 'the sum of running units\' compressor flow against the station meter, with recycle commands'),
        ('Fuel', 'station fuel against where it was 2 hours earlier, at the same throughput'),
        ('Which unit', 'the unit whose flow and power sit above its sister\'s at the same load sharing'),
        ('Conclusion', 'uncommanded recirculation on one unit; the headline rate hides the loss'),
    ]
    definition = {
        'appliesTo': {'assetType': 'turbine_compressor_station'},
        'inputs': {'throughput': 'self.station_flow_mmscfd', 'fuel': 'self.station_fuel_mmscfd', 'ratio': 'self.compression_ratio',
                   'units': 'children[turbine_compressor_unit].{unit_flow_mmscfd, recycle_valve_pct, unit_power_hp, unit_fuel_mmscfd, unit_speed_pct}'},
        'params': {'excess_pct': 2.0, 'sustain_min': 30, 'closed_pct': 1.0, 'fuel_window_min': 120,
                   'fuel_rise_pct': 3.0, 'flat_pct': 2.0, 'power_gap_pct': 5.0},
        'checks': [
            {'id': 'hidden', 'role': 'required', 'rule': 'Σ unit flow − station flow > excess_pct of station flow for sustain_min, every recycle command < closed_pct'},
            {'id': 'fuel', 'role': 'required', 'rule': 'fuel up > fuel_rise_pct over fuel_window_min while throughput moved < flat_pct'},
            {'id': 'unit', 'role': 'supporting', 'rule': 'one unit carries most of the excess'},
            {'id': 'power', 'role': 'supporting', 'independent': True, 'rule': 'that unit\'s power > its sister\'s by power_gap_pct'},
            {'id': 'split', 'role': 'supporting', 'rule': 'fuel rise split into compression ratio and extra flow'},
        ],
        'confidence': {'low': 'required checks', 'medium': 'the suspect unit\'s power agrees', 'high': 'recycle valve found passing'},
    }

    def candidates(self, pack):
        return pack.of_type('turbine_compressor_station')

    def _ctx(self, pack, aid):
        units = [u for u in pack.children[aid] if pack.asset(u)['assetType'] == 'turbine_compressor_unit']
        st = pack.series(aid, 'station_flow_mmscfd')
        uf = {u: pack.series(u, 'unit_flow_mmscfd') for u in units}
        rc = {u: pack.series(u, 'recycle_valve_pct') for u in units}
        excess, closed = [], []
        for k in range(pack.n):
            run = [u for u in units if uf[u][k] > 1]
            excess.append(sum(uf[u][k] for u in run) - st[k])
            closed.append(all(rc[u][k] < self.p['closed_pct'] for u in run) and bool(run))
        return dict(units=units, st=st, uf=uf, rc=rc, excess=excess, closed=closed,
                    fuel=pack.series(aid, 'station_fuel_mmscfd'))

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        st, fuel = c['st'], c['fuel']
        hidden = [c['closed'][k] and c['excess'][k] > p['excess_pct'] / 100 * st[k] for k in range(pack.n)]
        fw = pack.steps(p['fuel_window_min'])
        for i in range(fw, pack.n):
            s0 = B.sustained_since(hidden, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            j = i - fw
            flat = abs(st[i] - st[j]) / st[j] * 100 < p['flat_pct']
            rise = (fuel[i] - fuel[j]) / fuel[j] * 100
            if flat and rise > p['fuel_rise_pct']:
                c.update(hidden_start=s0, ref=j, rise=rise)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        sname = short_name(pack, aid)
        st, uf, rc, excess, fuel = c['st'], c['uf'], c['rc'], c['excess'], c['fuel']
        h0, j = c['hidden_start'], c['ref']
        running = [u for u in c['units'] if uf[u][now] > 1]
        idle = [u for u in c['units'] if uf[u][now] <= 1]
        dev = {u: uf[u][now] - B.mean([uf[x][now] for x in running if x != u]) for u in running}
        sus = max(dev, key=dev.get)
        sib = [u for u in running if u != sus]
        sus_n, sib_n = unit_name(pack, sus), join_names([unit_name(pack, u) for u in sib])
        pct = [100 * e / s if s else None for e, s in zip(excess, st)]
        onset = h0
        while onset > 0 and c['closed'][onset - 1] and pct[onset - 1] is not None and pct[onset - 1] > 0.5:
            onset -= 1
        share = (uf[sus][now] - B.mean([uf[u][now] for u in sib])) / excess[now] * 100 if excess[now] > 0 else 0
        unit_ok = share > 60
        pw = {u: pack.series(u, 'unit_power_hp') for u in running}
        sp = {u: pack.series(u, 'unit_speed_pct') for u in running}
        uf_fuel = {u: pack.series(u, 'unit_fuel_mmscfd') for u in running}
        p_gap = (pw[sus][now] - B.mean([pw[u][now] for u in sib])) / B.mean([pw[u][now] for u in sib]) * 100
        power_ok = p_gap > p['power_gap_pct']
        sib_fuel = [B.mean([uf_fuel[u][k] for u in sib]) for k in range(pack.n)]
        like_sib = [fuel[k] - (uf_fuel[sus][k] - sib_fuel[k]) for k in range(pack.n)]
        extra_now = uf_fuel[sus][now] - sib_fuel[now]
        extra_then = uf_fuel[sus][j] - sib_fuel[j]
        from_flow = extra_now - extra_then
        from_ratio = (fuel[now] - fuel[j]) - from_flow
        cr = pack.series(aid, 'compression_ratio')
        rc_max = max(max(rc[u][onset:now + 1]) for u in running)
        level = 'medium' if power_ok else 'low'
        window = win(pack, onset - 18, now)
        y_f = dom(fuel[onset - 18:], like_sib[onset - 18:], pad=0.1)
        th_line = [p['excess_pct'] / 100 * s for s in st]
        y_x = dom(excess[onset - 18:], th_line[onset - 18:], [0], pad=0.1)
        gap_uf = [uf[sus][k] - B.mean([uf[u][k] for u in sib]) for k in range(pack.n)]
        p_gap_s = [(pw[sus][k] - B.mean([pw[u][k] for u in sib])) / max(1, B.mean([pw[u][k] for u in sib])) * 100
                   for k in range(pack.n)]
        fuel_cost = (fuel[now] - like_sib[now])
        rise_now = (fuel[now] - fuel[j]) / fuel[j] * 100

        checks = [
            check('hidden', 'Units compress more gas than leaves the station', 'required', MATCH,
                  f'Running units {num(sum(uf[u][now] for u in running), 0)} MMscf/d against {num(st[now], 0)} on the station '
                  f'meter: {num(excess[now], 0)} MMscf/d ({num(pct[now], 1)} %) going round. Every recycle valve is commanded '
                  f'{num(rc_max, 0)} % since {ts[onset]}.',
                  'Gas a unit compresses but the station never sends out has to be recirculating. With the recycle valves '
                  'commanded shut, something is passing.',
                  spark(excess, y_x, threshold_value=p['excess_pct'] / 100 * st[now], window=window)),
            check('fuel', f'Fuel up {num(rise_now, 0)} % at the same throughput', 'required', MATCH,
                  f'Station fuel {num(fuel[j], 2)} MMscf/d at {ts[j]}, {num(fuel[now], 2)} now. Throughput {num(st[j], 0)} '
                  f'then, {num(st[now], 0)} now.',
                  'Compressing extra gas takes extra horsepower, and horsepower burns fuel. The headline throughput doesn\'t '
                  'show it.',
                  spark(fuel, y_f, highlight=[ts[j], ts[now]], window=window)),
            check('unit', f'{sus_n} carries the extra flow', 'supporting', MATCH if unit_ok else NO_MATCH,
                  f'{sus_n} {num(uf[sus][now], 0)} MMscf/d, {sib_n} {num(B.mean([uf[u][now] for u in sib]), 0)}: '
                  f'{num(share, 0)} % of the excess is on {sus_n}.',
                  'Units that share load equally should move the same gas. One unit pulling ahead with its recycle shut '
                  'points at that unit\'s recycle valve.',
                  spark(gap_uf, dom(gap_uf[onset - 18:], [0]), window=window)),
            check('power', f'{sus_n} working harder too', 'supporting', MATCH if power_ok else NO_MATCH,
                  f'{num(pw[sus][now], 0)} hp against {num(B.mean([pw[u][now] for u in sib]), 0)} hp ({signed(p_gap, 0)} %), '
                  f'at {num(sp[sus][now], 1)} % against {num(B.mean([sp[u][now] for u in sib]), 1)} % speed.',
                  'A separate measurement. If only its flow meter read high, its power and fuel wouldn\'t be higher too.',
                  spark(p_gap_s, dom(p_gap_s[onset - 18:], [0, p['power_gap_pct']]), threshold_value=p['power_gap_pct'], window=window)),
            check('split', 'Where the extra fuel goes', 'supporting', MATCH,
                  f'Of the {signed(fuel[now] - fuel[j], 2)} MMscf/d rise since {ts[j]}, about {num(from_ratio, 2)} follows the '
                  f'higher compression ratio ({num(cr[j], 3)} → {num(cr[now], 3)}) as the line packs, and about '
                  f'{num(from_flow, 2)} is {sus_n} burning more than {sib_n}.',
                  'Separates the part the line is asking for from the part that is lost.', None),
        ]
        main = chart('MMscf/d', y_f,
                     [series('fuel', f'{sname} station fuel', fuel, 'primary', 3),
                      series('like', f'If {sus_n} burned what {sib_n} burns', like_sib, 'expected', 3)],
                     title='What we see',
                     caption=f'{sname} station fuel against what it would be if {sus_n} ran like its sister. The shaded gap '
                             f'is fuel spent on gas that goes round {sus_n} and never leaves the station.',
                     shade_gap=['fuel', 'like'],
                     markers=[marker(ts[onset], 'Units diverge'), marker(ts[i], 'Flagged')],
                     window=window)
        thr_chart = chart('MMscf/d', dom(st[onset:], pad=1.0),
                          [series('st', f'{sname} throughput', st, 'primary', 0)],
                          caption='The headline: station throughput, flat the whole time.', window=win(pack, onset, now))

        grid = hours_grid(3, 0.25, -0.5)
        r = Rng(999)
        tb_x = [(0 if h < 0 else 22 * h) + r.gauss(1.5) for h in grid]
        tb_f = [(0 if h < 0 else 4.0 * h) + r.gauss(0.3) for h in grid]
        st_x = [(0 if h < 0 else 40) + r.gauss(1.5) for h in grid]
        st_f = [(0 if h < 0 else 6.0) + r.gauss(0.3) for h in grid]
        mb_x = [(0 if h < 0 else 20 * h) + r.gauss(1.5) for h in grid]
        mb_f = [r.gauss(0.3) for h in grid]
        lx = aligned(excess, onset, pack.step_min, grid)
        lf = aligned([100 * (v - fuel[onset]) / fuel[onset] for v in fuel], onset, pack.step_min, grid)
        live = f'{sname}, today'

        def pair(a, b):
            return [ref_chart('Unit flow above the station meter', 'MMscf/d', dom(a, lx, [0], pad=0.05), grid, 'h', a, lx, live, 0),
                    ref_chart('Station fuel change', '%', dom(b, lf, [0], pad=0.05), grid, 'h', b, lf, live, 1)]
        refs = [
            reference('passing', 'textbook', 'Textbook', 'Recycle valve passing',
                      'Seat erosion or an actuator that stops short lets gas back to suction. The leak grows as the seat '
                      'wears, and fuel climbs with it.',
                      'match', 'Closest match', ['Same growing excess on one unit', 'Fuel rising at flat throughput'], pair(tb_x, tb_f)),
            reference('stuck', 'variant', 'Variant', 'Valve left cracked open',
                      'After a surge event or a stroke test the valve doesn\'t reseat. The excess appears in one step and '
                      'stays.',
                      'partial', 'Same place, different start', [f'{sname}\'s excess grew gradually', 'Same check: recycle '
                                                                  'line temperature and a stroke test'], pair(st_x, st_f)),
            reference('meter', 'lookalike', 'Look-alike', 'Unit flow meter reading high',
                      'The unit\'s flow meter drifts high. Unit flows add up to more than the station meter, but power and '
                      'fuel don\'t move.',
                      'nomatch', 'Doesn\'t match', [f'Fuel flat here; at {sname} it rose {num(rise_now, 0)} %',
                                                    f'{sus_n}\'s power is up {num(p_gap, 0)} % on its sister'], pair(mb_x, mb_f)),
        ]
        ro = [
            ruled_out('More throughput', 'ruled out',
                      f'Station throughput moved {num(min(st[onset:]), 0)}–{num(max(st[onset:]), 0)} MMscf/d the whole time:',
                      thr_chart),
            ruled_out('The line packing (higher compression ratio)', 'ruled out',
                      f'It explains about {num(from_ratio, 2)} of the {num(fuel[now] - fuel[j], 2)} MMscf/d rise, and it would '
                      f'raise both units alike. {sus_n} alone pulled ahead.'),
            ruled_out('A commanded recycle', 'ruled out', f'Every recycle command read {num(rc_max, 0)} % since {ts[onset]}.'),
            ruled_out(f'{sus_n} flow meter reading high', 'unlikely',
                      f'Its power ({signed(p_gap, 0)} %) and fuel are higher than {sib_n}\'s as well.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'Gas is recirculating through {sus_n}, most likely a passing '
                                     f'anti-surge recycle valve', level,
                                     'Flow, power and fuel agree on one unit' if power_ok else 'Flow balance only'),
            'rootCauseAssetId': sus,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': (f'Left out: {join_names([unit_name(pack, u) for u in idle])} (standby, not running).') if idle else None,
            'confidence': confidence(level,
                                     f'The station meter, the unit flow meters and {sus_n}\'s own power all say the same gas is '
                                     f'being compressed twice.',
                                     'Nobody has checked the valve. The recycle-line temperature and the valve\'s acoustic '
                                     'signature aren\'t in SCADA.',
                                     'The recycle line downstream of the valve is warm, or a stroke test shows it not seating.',
                                     'The recycle line is cold and the valve seats. Then check the unit flow meter calibration.'),
            'action': action(item, pack),
            'impact': f'About {num(fuel_cost, 2)} MMscf/d of fuel ({num(fuel_cost * 1e3 / 24, 0)} Mscf an hour) spent on gas '
                      f'that goes round {sus_n}, and a passing valve erodes further.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 10. Recurring engine detonation — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
def events_from_hourly_count(count, steps_per_hour):
    """Recover event times from a rolling one-hour count (window (t−60 min, t]):
    new events at k = count[k] − count[k−1] + events that left the window at k."""
    ev = []
    for k in range(len(count)):
        prev = count[k - 1] if k else 0
        left = sum(1 for e in ev if e == k - steps_per_hour)
        new = int(round(count[k] - prev + left))
        ev.extend([k] * max(0, new))
    return ev


class EngineDetonation(Detector):
    id = 'pipeline.engine_detonation'
    name = 'Engine detonation becoming frequent'
    archetype = '12 Recurring micro-events'
    applies_to = 'gas engines'
    summary = ('One engine\'s knock control keeps retarding timing and shedding load, several times an hour and '
               'more often as the afternoon goes on. Each event clears; together they are a pattern.')
    pipeline = [
        ('Events', 'detonation events recovered from the engine\'s rolling one-hour count'),
        ('Rate', 'events in the last hour against this engine\'s normal of 0–1'),
        ('Each event', 'the unit\'s power in that interval against the intervals either side'),
        ('Compare', 'the other engines on the station, and the engine\'s own cooling temperatures'),
        ('Conclusion', 'recurring, isolated, load-linked detonation; the cause needs per-cylinder data'),
    ]
    definition = {
        'appliesTo': {'assetType': 'gas_engine_driver'},
        'inputs': {'count': 'self.knock_events_1h', 'exhaust': 'self.engine_exhaust_temp_f', 'jacket': 'self.jacket_water_temp_f',
                   'power': 'parent.recip_unit_power_hp', 'rated': 'parent.recip_rated_power_hp (static)',
                   'peers': 'other gas_engine_driver on the same station'},
        'params': {'rate_hi': 3, 'normal_max': 1, 'min_events': 4, 'span_min': 180, 'dip_pct': 5.0,
                   'temp_margin_f': 10.0, 'high_load_pct': 75.0},
        'checks': [
            {'id': 'rate', 'role': 'required', 'rule': 'events in the last hour ≥ rate_hi'},
            {'id': 'recurring', 'role': 'required', 'rule': '≥ min_events events within span_min'},
            {'id': 'dips', 'role': 'supporting', 'independent': True, 'rule': 'unit power dips > dip_pct at every event'},
            {'id': 'closer', 'role': 'supporting', 'rule': 'later gaps shorter than earlier gaps'},
            {'id': 'isolated', 'role': 'supporting', 'rule': 'other engines on the station ≤ normal_max per hour'},
            {'id': 'cooling', 'role': 'supporting', 'rule': 'exhaust and jacket water within temp_margin_f of the other engines'},
            {'id': 'load', 'role': 'supporting', 'rule': 'unit load ≥ high_load_pct of rated between events'},
        ],
        'confidence': {'low': 'required checks', 'medium': 'power dips confirm each event', 'high': 'cause found in per-cylinder data'},
    }

    def candidates(self, pack):
        return pack.of_type('gas_engine_driver')

    def evaluate(self, pack, aid):
        p = self.p
        cnt = pack.series(aid, 'knock_events_1h')
        ev = events_from_hourly_count(cnt, pack.steps(60))
        sp = pack.steps(p['span_min'])
        for i in range(pack.n):
            if cnt[i] < p['rate_hi']:
                continue
            recent = [e for e in ev if i - sp < e <= i]
            if len(recent) >= p['min_events']:
                return Finding(aid, True, i, cnt=cnt, ev=ev)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        uid = pack.parent(aid)
        uname = unit_name(pack, uid)
        cnt, ev = c['cnt'], c['ev']
        first = ev[0]
        pw = pack.series(uid, 'recip_unit_power_hp')

        def dip(k):
            nb = [pw[k - 1]] + ([pw[k + 1]] if k + 1 < pack.n else [])
            return 100 * (pw[k] / B.mean(nb) - 1)
        dips = [dip(k) for k in ev]
        dips_ok = all(d < -p['dip_pct'] for d in dips)
        rel = [dip(k) if 0 < k else 0 for k in range(pack.n)]
        gaps = [pack.minutes_between(a, b) for a, b in zip(ev, ev[1:])]
        half = len(gaps) // 2
        closer = len(gaps) >= 4 and B.mean(gaps[half:]) < B.mean(gaps[:half])
        station = pack.parent(uid)
        o_units = [u for u in pack.children[station] if u != uid and pack.asset(u)['assetType'] == pack.asset(uid)['assetType']]
        o_eng = [pack.child_of_type(u, 'gas_engine_driver') for u in o_units]
        o_cnt = {e: pack.series(e, 'knock_events_1h') for e in o_eng}
        o_max = max(max(v[first:]) for v in o_cnt.values())
        o_worst = max(o_cnt, key=lambda e: max(o_cnt[e][first:]))
        isolated = o_max <= p['normal_max']
        o_hi = [max(v[k] for v in o_cnt.values()) for k in range(pack.n)]
        o_lo = [min(v[k] for v in o_cnt.values()) for k in range(pack.n)]
        running_o = [e for e, u in zip(o_eng, o_units) if pack.series(u, 'recip_unit_flow_mmscfd')[now] > 1]
        ex, jw = pack.series(aid, 'engine_exhaust_temp_f'), pack.series(aid, 'jacket_water_temp_f')
        quiet = [k for k in range(first, now + 1) if k not in ev]
        ex_q, jw_q = B.mean([ex[k] for k in quiet]), B.mean([jw[k] for k in quiet])
        o_run = {e: pack.series(pack.parent(e), 'recip_unit_flow_mmscfd') for e in running_o}
        ex_o = [B.mean([pack.series(e, 'engine_exhaust_temp_f')[k] for k in quiet if o_run[e][k] > 1]) for e in running_o]
        jw_o = [B.mean([pack.series(e, 'jacket_water_temp_f')[k] for k in quiet if o_run[e][k] > 1]) for e in running_o]
        m = p['temp_margin_f']
        cool_ok = min(ex_o) - m <= ex_q <= max(ex_o) + m and min(jw_o) - m <= jw_q <= max(jw_o) + m
        rated = pack.values.get(uid, {}).get('recip_rated_power_hp') or max(pw)
        load = [100 * v / rated for v in pw]
        load_q = B.mean([load[k] for k in quiet])
        load_am = B.mean([load[k] for k in range(0, pack.steps(60))])
        load_ok = load_q >= p['high_load_pct']
        n_hour = int(round(cnt[now]))
        level = 'medium' if dips_ok else 'low'
        window = win(pack, first - 12, now)
        y_c = [0, int(max(p['rate_hi'] + 2, max(cnt) + 1))]
        gcs = pack.of_type('gas_chromatograph')
        hhv = [pack.series(g, 'gas_hhv_btu_scf') for g in gcs]
        hhv_rng = max(max(v[first:]) - min(v[first:]) for v in hhv) if hhv else None

        checks = [
            check('rate', f'{n_hour} events in the last hour', 'required', MATCH,
                  f'{len(ev)} detonation events since {ts[first]}: ' + ', '.join(ts[k] for k in ev) + f'. Normal for this engine '
                  f'is {p["normal_max"]} an hour or less; the alert level is {p["rate_hi"]}.',
                  'Knock control retards timing and sheds load when a cylinder detonates. Now and then is normal; several '
                  'an hour is not.',
                  spark(cnt, y_c, threshold_value=p['rate_hi'], window=window)),
            check('recurring', 'A pattern, not a burst', 'required', MATCH,
                  f'Spread over {dur(pack.minutes_between(first, ev[-1]))}, with gaps of {join_names([dur(g) for g in gaps])}.',
                  'One bad minute can trip several events at once. Events spread over hours mean the engine keeps getting '
                  'back to the same condition.',
                  None),
            check('dips', 'Power dipped at every event', 'supporting', MATCH if dips_ok else NO_MATCH,
                  f'Unit power fell {num(-max(dips), 0)}–{num(-min(dips), 0)} % in each event interval against the intervals either side.',
                  'A separate measurement. If the knock sensor alone were wrong, the engine wouldn\'t lose load.',
                  spark(rel, dom(rel[first - 12:], [0, -p['dip_pct'] * 1.5]), threshold_value=-p['dip_pct'], window=window)),
            check('closer', 'Coming closer together', 'supporting', MATCH if closer else NO_MATCH,
                  f'Gaps averaged {dur(B.mean(gaps[:half]))} at first and {dur(B.mean(gaps[half:]))} lately.'
                  if len(gaps) >= 2 else 'Too few events to tell.',
                  'The engine reaches its knock limit more and more often. Left alone, the next step is a shutdown or damage.', None),
            check('isolated', 'Only this engine', 'supporting', MATCH if isolated else NO_MATCH,
                  f'The other engines at {short_name(pack, station)} peaked at {num(o_max, 0)} an hour '
                  f'({unit_name(pack, pack.parent(o_worst))}).',
                  'Every engine breathes the same air and burns the same gas. One engine knocking points at that engine.',
                  spark(cnt, y_c, o_lo, o_hi, window=window)),
            check('cooling', 'Cooling temperatures normal', 'supporting', MATCH if cool_ok else NO_MATCH,
                  f'Between events: exhaust {num(ex_q, 0)} °F and jacket water {num(jw_q, 0)} °F; the other running engines '
                  f'{num(min(ex_o), 0)}–{num(max(ex_o), 0)} °F and {num(min(jw_o), 0)}–{num(max(jw_o), 0)} °F.',
                  'Rules out a jacket-water cooling fault. Charge-air (aftercooler) temperature isn\'t measured, so that '
                  'stays open.', None),
            check('load', 'Running hard', 'supporting', MATCH if load_ok else NO_MATCH,
                  f'{num(load_q, 0)} % of its {num(rated, 0)} hp rating between events ({num(load_am, 0)} % in the cooler '
                  f'first hour, with no events).',
                  'Detonation margin shrinks with load and with intake-air temperature. Intake air isn\'t measured here, '
                  'so load alone doesn\'t explain the timing.',
                  spark(load, dom(load[first - 24:], [p['high_load_pct']]), threshold_value=p['high_load_pct'], window=window)),
        ]
        main = chart('events/h', y_c,
                     [series('cnt', f'{uname} detonation events (last hour)', cnt, 'primary', 0)],
                     title='What we see',
                     caption=f'{uname}\'s rolling one-hour count of detonation events, against the other engines at '
                             f'{short_name(pack, station)} (shaded).',
                     band=band('Other engines', o_lo, o_hi, 0),
                     thresholds=[threshold(p['rate_hi'], 'Alert')],
                     markers=[marker(ts[first], 'First event'), marker(ts[i], 'Flagged')],
                     window=win(pack, first - 24, now), decimals=0)

        grid = hours_grid(3, 1 / 12, -0.5)
        r = Rng(1010)

        def count(times, g):
            return [sum(1 for t in times if h - 1 < t <= h + 1e-9) for h in g]

        def dips_at(times, g, depth):
            return [(-depth if any(abs(h - t) < 0.02 for t in times) else 0) + r.gauss(0.6) for h in g]
        tb_t = [0.0, 0.75, 1.25, 1.6, 1.85, 2.1, 2.3, 2.5, 2.65, 2.8, 2.95]
        ea_t = [0.0, 1.4, 2.7]
        sf_t = [0.0, 0.1, 0.3, 0.4, 0.55, 0.9, 1.0, 1.2, 1.5, 1.6, 1.9, 2.0, 2.3, 2.6]
        lc = aligned(cnt, first, pack.step_min, grid)
        ld = aligned(rel, first, pack.step_min, grid)
        live = f'{uname}, today'

        def pair(times, depth):
            a, b = count(times, grid), dips_at(times, grid, depth)
            return [ref_chart('Events in the last hour', 'events/h', [0, max(8, max(a) + 1)], grid, 'h', a, lc, live, 0,
                              [threshold(p['rate_hi'], 'Alert')]),
                    ref_chart('Unit power vs the intervals either side', '%', dom(b, ld, pad=0.05), grid, 'h', b, ld, live, 0)]
        refs = [
            reference('hot', 'textbook', 'Textbook', 'Hot afternoon, high load',
                      'Warm charge air and high load take the engine to its knock limit. Events come closer together as '
                      'the afternoon heats up, until load is trimmed or it shuts down.',
                      'match', 'Closest match', ['Events closer and closer', 'A power dip at each one'], pair(tb_t, 9)),
            reference('early', 'early', 'Early stage', 'Occasional events',
                      'One event an hour or less. Normal on a hot day; worth watching if it keeps happening on one engine.',
                      'partial', f'Where {uname} was at first', ['Below the alert level', 'Same engine to watch first next time'],
                      pair(ea_t, 9)),
            reference('sensor', 'lookalike', 'Look-alike', 'Knock sensor fault',
                      'A cracked sensor or loose connector counts vibration as knock. Counts run high, but the engine never '
                      'loses load.',
                      'nomatch', 'Doesn\'t match', ['No power dips here', f'{uname} lost load at every event'], pair(sf_t, 0)),
        ]
        ro = [
            ruled_out('Fuel quality', 'ruled out',
                      f'Heating value at the gas chromatograph moved {num(hhv_rng, 1)} Btu/scf over the same time; every engine '
                      f'burns the same gas and the others stayed quiet.' if hhv else
                      'Every engine burns the same gas and the others stayed quiet.'),
            ruled_out('Jacket-water cooling', 'ruled out' if cool_ok else 'not yet checked',
                      f'Jacket water {num(jw_q, 0)} °F between events, in line with the other engines.'),
            ruled_out('A faulty knock sensor', 'unlikely' if dips_ok else 'not yet checked',
                      'Unit power dipped at every event. A sensor fault wouldn\'t cost load.'),
            ruled_out('Charge-air cooling, ignition wear or air/fuel drift', 'not yet checked',
                      'These are the usual causes. Per-cylinder knock data and the engine aftercooler temperature would '
                      'narrow it down; neither is in SCADA.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', f'{uname}\'s engine is running at its knock limit', level,
                                     'Power dips confirm each event; cause not yet diagnosed' if dips_ok else 'Event count only'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The knock count and the unit\'s power, two separate measurements, agree on every event, '
                                     'and only this engine is affected.',
                                     'The pattern is clear but the cause isn\'t: warm charge air, ignition wear and air/fuel drift '
                                     'all look the same from here.',
                                     'Per-cylinder knock data points at one cause, or a load trim brings events back to 0–1 an hour.',
                                     'Events carry on at low load. Then suspect ignition or the knock sensors themselves.'),
            'action': action(item, pack),
            'impact': f'{len(ev)} events so far, each costing about {num(-B.mean(dips), 0)} % of the unit\'s power for 5 minutes. '
                      f'The bigger risk is piston and head damage if it continues.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 11. Imbalance heading past the OFO tolerance — archetype 14 (plan / compliance at risk)
# ═════════════════════════════════════════════════════════════════════════
class OfoImbalanceAtRisk(Detector):
    id = 'pipeline.ofo_imbalance_at_risk'
    name = 'Imbalance will pass the OFO tolerance'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'power-plant deliveries'
    summary = ('A delivery taking above its schedule under an OFO: at the current rate its gas-day imbalance passes '
               'the tolerance before the next renomination can take effect. Time needed is more than time left.')
    pipeline = [
        ('Instruction', 'today\'s OFO tolerance (from the OFO notice) as a share of the scheduled daily quantity'),
        ('Now', 'gas-day imbalance and its rate over the last hour; when it reaches the tolerance'),
        ('Plan', 'the next nomination cycle still open, and when a renomination made in it takes effect'),
        ('Conclusion', 'a commercial deadline, not a diagnosis: act before the crossing'),
    ]
    definition = {
        'appliesTo': {'assetType': 'power_plant_delivery'},
        'inputs': {'imbalance': 'self.gas_day_imbalance_mmscf', 'flow': 'self.pp_delivery_flow_mmscfd',
                   'scheduled': 'self.pp_scheduled_flow_mmscfd', 'ofo': 'OFO notice (tolerancePct)',
                   'cycles': 'nomination calendar (deadline, effective)', 'task': 'work item for this asset'},
        'params': {'trend_min': 60, 'warn_lead_min': 90},
        'checks': [
            {'id': 'crossing', 'role': 'required', 'rule': 'imbalance reaches ± tolerance within warn_lead_min at the trend_min rate'},
            {'id': 'renom', 'role': 'required', 'rule': 'next open cycle takes effect after the crossing'},
            {'id': 'over', 'role': 'supporting', 'rule': 'delivery above schedule over the last hour'},
            {'id': 'task', 'role': 'supporting', 'rule': 'shipper call not yet done'},
        ],
        'confidence': {'n/a': 'a commercial deadline, not a diagnosis'},
    }

    def candidates(self, pack):
        return pack.of_type('power_plant_delivery')

    def _tolerance(self, pack, aid, i):
        return OFO['tolerancePct'] / 100 * pack.series(aid, 'pp_scheduled_flow_mmscfd')[i]

    def evaluate(self, pack, aid):
        p = self.p
        imb = pack.series(aid, 'gas_day_imbalance_mmscf')
        tw = pack.steps(p['trend_min'])
        g0 = next((k for k, t in enumerate(pack.ts) if tmin(t) >= tmin(GAS_DAY_START)), None)
        if g0 is None:
            return Finding(aid, False)
        for i in range(g0 + tw, pack.n):
            sl = B.slope_per_hour(imb, i, tw, pack.step_min)
            if not sl:
                continue
            tol = self._tolerance(pack, aid, i)
            lim = tol if sl > 0 else -tol
            left = (lim - imb[i]) / sl * 60
            if left < 0 or left > p['warn_lead_min']:
                continue
            cross = tmin(pack.ts[i]) + left
            nxt = next((c for c in NOMINATION_CYCLES if tmin(c['deadline']) > tmin(pack.ts[i])), None)
            if nxt is None or tmin(nxt['effective']) <= cross:
                continue
            return Finding(aid, True, i, imb=imb, slope=sl, tol=tol, cross=cross, nxt=nxt, g0=g0)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, f.at
        dname = short_name(pack, aid)
        imb, g0, nxt = c['imb'], c['g0'], c['nxt']
        tw = pack.steps(p['trend_min'])
        sl = B.slope_per_hour(imb, now, tw, pack.step_min)
        tol = self._tolerance(pack, aid, now)
        left = (tol - imb[now]) / sl * 60 if sl and sl > 0 else None
        cross = tmin(ts[now]) + left if left is not None else None
        flow = pack.series(aid, 'pp_delivery_flow_mmscfd')
        sched = pack.series(aid, 'pp_scheduled_flow_mmscfd')
        over = B.mean(flow[now - tw + 1:now + 1]) - sched[now]
        over_ok = over > 0
        sched_same = max(sched[g0:]) - min(sched[g0:]) < 0.01
        task = next((w for w in pack.work if w['assetId'] == aid and w['sourceType'] == 'situation'), None)
        task_open = bool(task) and not task['done']
        due = task['dueAt'][11:16] if task and task.get('dueAt') else None
        passed = [cy for cy in NOMINATION_CYCLES if tmin(cy['deadline']) <= tmin(ts[now])]
        need = tmin(nxt['effective']) - tmin(ts[now])
        window = [ts[g0], ts[now]]
        y_i = dom(imb[g0:], [tol, -0.5], pad=0.08)
        ramp = next((k for k in range(g0, pack.n) if all(v > sched[k] * 1.05 for v in flow[k:k + 3])), None)

        checks = [
            check('crossing', f'Passes the ±{num(tol, 1)} MMscf tolerance at about {hhmm(cross)}', 'required', MATCH,
                  f'Imbalance {signed(imb[now], 2)} MMscf now, growing {num(sl, 2)} MMscf per hour over the last '
                  f'{dur(p["trend_min"])}: {dur(left)} to the tolerance. Flagged at {ts[i]} with {dur(c["cross"] - tmin(ts[i]))} left.',
                  f'Today\'s OFO allows ±{num(OFO["tolerancePct"], 0)} % of the {num(sched[now], 0)} MMscf/d schedule. Past it, '
                  f'penalties apply.',
                  spark(imb, y_i, threshold_value=tol, window=window)),
            check('renom', f'A renomination can\'t take effect until {nxt["effective"]}', 'required', MATCH,
                  f'The next open cycle, {nxt["cycle"]}, closes at {nxt["deadline"]} and takes effect at {nxt["effective"]}: '
                  f'{dur(need)} from now, against {dur(left)} to the tolerance. ' +
                  (f'{join_names([cy["cycle"] for cy in passed])} passed' + (' with the scheduled quantity unchanged.' if sched_same else '.')
                   if passed else ''),
                  'Time needed is more than time left, so the nomination route alone can\'t fix it.', None),
            check('over', f'Taking {num(over, 1)} MMscf/d above schedule', 'supporting', MATCH if over_ok else NO_MATCH,
                  f'{num(B.mean(flow[now - tw + 1:now + 1]), 1)} MMscf/d over the last hour against {num(sched[now], 0)} scheduled'
                  + (f', since the plant\'s ramp at about {ts[ramp]}.' if ramp is not None else '.'),
                  'The plant\'s dispatch went up; its shipper\'s nomination didn\'t follow.',
                  spark(flow, dom(flow[g0:], sched, pad=0.1), window=window)),
            check('task', 'Shipper call not done yet', 'supporting', MATCH if task_open else NO_MATCH,
                  (f'Task "{task["text"]}" is open' + (f', due {due}.' if due else '.')) if task else 'No task yet.',
                  'An imbalance trade, a park-and-loan, or holding the take at schedule all need the shipper and the plant.',
                  None),
        ]
        main = chart('MMscf', y_i,
                     [series('imb', f'{dname} gas-day imbalance', imb, 'primary', 3)],
                     title='What we see',
                     caption=f'Gas-day imbalance since the {GAS_DAY_START} gas-day start, against today\'s OFO tolerance. At the '
                             f'current rate it reaches +{num(tol, 1)} MMscf at about {hhmm(cross)}.',
                     thresholds=[threshold(tol, 'OFO tolerance')],
                     markers=[marker(ts[g0], 'Gas day starts'), marker(ts[i], 'Flagged')],
                     window=[ts[max(0, g0 - 6)], ts[now]], decimals=2)

        grid = hours_grid(8, 0.25)
        r = Rng(1111)
        rate = sl or 0.4
        base = lambda h: 0 if h < 1.25 else rate * (h - 1.25)
        held_at = (tmin(ts[now]) - tmin(GAS_DAY_START)) / 60 + 0.5
        ok = [(base(h) if h < held_at else base(held_at)) + r.gauss(0.01) for h in grid]
        late = [base(h) + r.gauss(0.01) for h in grid]
        drop = [(base(h) if h < held_at else base(held_at) - 0.35 * (h - held_at)) + r.gauss(0.01) for h in grid]
        li = aligned(imb, g0, pack.step_min, grid)
        live = f'{dname}, today'
        th = [threshold(tol, 'Tolerance')]
        mk = lambda a: [ref_chart('Imbalance (hours from the gas-day start)', 'MMscf', dom(a, li, [tol, -0.5], pad=0.05),
                                  grid, 'h', a, li, live, 2, th)]
        refs = [
            reference('held', 'textbook', 'Textbook', 'Trade arranged in time',
                      'The shipper arranges an imbalance trade, or the plant holds its take at schedule, within the hour. The '
                      'imbalance stops growing short of the tolerance.',
                      'partial', 'On track, if done by ' + (due or 'the crossing'),
                      ['This is the target', 'Log the call and the agreed quantity'], mk(ok)),
            reference('late', 'variant', 'What to avoid', 'Nobody acts before the crossing',
                      'The take stays high until the next renomination takes effect. The imbalance runs past the tolerance for '
                      'hours.',
                      'nomatch', 'Avoid', [f'Would pass ±{num(tol, 1)} MMscf at about {hhmm(cross)}',
                                           f'Stays out of tolerance until {nxt["effective"]} or later'], mk(late)),
            reference('falls', 'lookalike', 'Look-alike', 'Plant ramps down on its own',
                      'The plant\'s dispatch drops after the peak and its take falls below schedule, pulling the imbalance '
                      'back. Only safe if the dispatch says so.',
                      'nomatch', 'Not today', [f'Take is still {num(over, 1)} MMscf/d over schedule',
                                               'Relying on it risks the penalty'], mk(drop)),
        ]
        return {
            'conclusion': conclusion('What\'s needed',
                                     f'Arrange a trade or hold {dname}\'s take at {num(sched[now], 0)} MMscf/d before about '
                                     f'{hhmm(cross)}', 'n/a', 'A commercial deadline, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': [], 'excluded': None,
            'confidence': confidence('n/a', 'This is a commercial deadline under today\'s OFO, not something the data had to '
                                            'diagnose.'),
            'action': action(item, pack),
            'impact': f'At {num(sl, 2)} MMscf/h, about {num(sl * max(0, (tmin(nxt["effective"]) - cross) / 60), 1)} MMscf past '
                      f'the tolerance by the time {nxt["cycle"]} takes effect at {nxt["effective"]}.',
        }



DETECTORS = [DryGasSealLeak(), MlvTransmitterFault(), ReceiptLossCascade(), RegulatorIcingUpstream(),
             RecipValveTrip(), StationControlOscillation(), SegmentPacking(), ReceiptWetGas(),
             HiddenRecycleFuel(), EngineDetonation(), OfoImbalanceAtRisk()]


def main():
    pack, out, report, path = run_pack(REPO, 'pipeline', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
