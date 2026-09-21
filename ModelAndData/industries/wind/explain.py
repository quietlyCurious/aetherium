#!/usr/bin/env python3
"""Boreas Ridge — detectors and explanations (INDUSTRY_PACK_SPEC.md §14).

Runs every wind detector on every asset it applies to, using only the
pack's runtime files in public/data/wind/, and writes
public/data/wind/explanations.json: one explanation per attention item
(the checks, what was ruled out, reference examples, confidence), plus
each detector's definition and where it fired today.

    python3 ModelAndData/industries/wind/generate.py     # the data
    python3 ModelAndData/industries/wind/explain.py      # the explanations

Detectors never read generate.py's scenario constants. If a detector
misses a scenario, or fires where no attention item exists, the run report
says so and the exit code is 1 for a miss.

Standard library only.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'ModelAndData', 'tools'))

from detectors import blocks as B                     # noqa: E402
from detectors.build import (Detector, Finding, Rng, MATCH, NO_MATCH, PENDING, aligned, band, chart,  # noqa: E402
                           check, dur, marker, nice_domain, num, reference, ruled_out, run_pack, print_report,
                           series, signed, spark, threshold)

TURBINE_TYPES = ('wtg_geared', 'wtg_direct_drive')


# ── Shared wind context ──────────────────────────────────────────────────
def met(pack):
    return pack.first_of_type('met_mast')


def ambient(pack):
    return pack.series(met(pack), 'ambient_temp_c')


def running(pack, tid, min_kw=100, minutes=60):
    return B.running_mask(pack.series(tid, 'active_power_kw'), min_kw, pack.steps(minutes))


def thermal_features(pack, tau_min=40):
    """Load (smoothed for thermal lag) and ambient: what sets a component's normal temperature."""
    amb = ambient(pack)
    cache = {}

    def fn(aid):
        tid = pack.unit_of(aid)
        if tid not in cache:
            load = B.ema(pack.series(tid, 'active_power_kw'), pack.steps(tau_min))
            cache[tid] = [[l / 100.0, a] for l, a in zip(load, amb)]
        return cache[tid]
    return fn


def feeder_of(pack, tid):
    return pack.parent(tid)


def unit_note(pack, tid):
    st = pack.unit_status.get(tid, {})
    mode = (st.get('mode') or '').lower()
    return {'maintenance': 'planned maintenance', 'stopped': 'down'}.get(mode, st.get('state', 'stopped'))


def stopped_peers_note(pack, tids, i):
    """'WTG-02 (planned maintenance) and WTG-10 (down)' for peers not running at i."""
    out = []
    for t in tids:
        if not running(pack, t)[i]:
            out.append(f'{pack.name(t)} ({unit_note(pack, t)})')
    return out


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
    return chart(unit, y, [series('ref', 'Reference example', ref_values, 'reference', 2),
                           series('live', live_label, live_values, 'primary', 2)],
                 title=label, x={'unit': grid_unit, 'values': grid}, decimals=decimals, thresholds=thresholds)


# ═════════════════════════════════════════════════════════════════════════
# 1. HS bearing surface damage — archetype 05 (component degradation)
# ═════════════════════════════════════════════════════════════════════════
class HsBearingDamage(Detector):
    id = 'wind.hs_bearing_damage'
    name = 'HS bearing surface damage'
    archetype = '05 Component degradation'
    applies_to = 'HS bearings'
    summary = ('A gearbox high-speed bearing running hotter than its load and the weather explain, '
               'rising steadily, with oil debris or vibration moving with it.')
    pipeline = [
        ('Find peers', 'every other HS bearing on the site, counting only points where its turbine has produced '
                       'for the last 60 min'),
        ('Expected value', 'fit on the peers: bearing temperature ≈ c0 + c1 × load (40-min average) + c2 × ambient'),
        ('Residual', 'actual − expected: heat that load and weather don\'t explain'),
        ('Checks', 'threshold · trend shape · persistence · corroboration · locality'),
        ('Conclusion', 'all required checks → raise an item; independent supporting checks → confidence'),
    ]
    definition = {
        'appliesTo': {'assetType': 'hs_bearing'},
        'inputs': {
            'temp': 'self.bearing_temp_c', 'vib': 'self.vibration_mms',
            'load': 'unit.active_power_kw', 'ambient': 'met_mast.ambient_temp_c',
            'debris': 'sibling[gearbox].oil_particle_count',
            'otherBearings': ['sibling[main_bearing].bearing_temp_c', 'unit…generator_bearing.bearing_temp_c'],
        },
        'peers': {'same': 'assetType', 'count': 'unit running (active_power_kw > 100 kW for 60 min)'},
        'expected': {'model': 'linear', 'target': 'temp', 'features': ['ema(load, 40 min)', 'ambient'], 'fitOn': 'peers'},
        'params': {'hot_c': 5.0, 'watch_c': 2.0, 'min_slope_c_per_h': 0.5, 'slope_window_min': 120,
                   'max_step_c': 3.0, 'sustain_min': 60, 'debris_ratio': 2.0},
        'checks': [
            {'id': 'hot', 'role': 'required', 'rule': 'residual > hot_c'},
            {'id': 'gradual', 'role': 'required', 'rule': 'slope(residual, slope_window_min) > min_slope_c_per_h and maxStep(residual since onset) < max_step_c'},
            {'id': 'sustained', 'role': 'required', 'rule': 'residual > hot_c for sustain_min'},
            {'id': 'debris', 'role': 'supporting', 'independent': True, 'rule': 'debris > debris_ratio × peerMax(debris)'},
            {'id': 'vib', 'role': 'supporting', 'independent': True, 'rule': 'vib > peerMax(vib)'},
            {'id': 'local', 'role': 'supporting', 'rule': 'otherBearings within peer range'},
        ],
        'ruleOut': ['higher load', 'warmer weather', 'faulty sensor', 'drivetrain cooling or lubrication'],
        'confidence': {'low': 'required checks only', 'medium': '≥ 1 independent supporting check',
                       'high': 'confirmed by inspection or oil analysis'},
        'references': ['textbook: confirmed spalling', 'early stage', 'look-alike: sensor offset'],
    }

    def candidates(self, pack):
        return pack.of_type('hs_bearing')

    def _ctx(self, pack, aid):
        p = self.p
        peers = pack.of_type('hs_bearing')
        feats = thermal_features(pack)
        mask = lambda a: running(pack, pack.unit_of(a))
        model, exp = B.fleet_expected(pack, aid, peers, 'bearing_temp_c', feats, mask,
                                      ['load_per_100kw', 'ambient_c'])
        temp = pack.series(aid, 'bearing_temp_c')
        run = mask(aid)
        res = B.residual(temp, exp, run)
        return dict(peers=peers, model=model, exp=exp, temp=temp, run=run, res=res, mask=mask)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        res = c['res']
        hot = B.gt(res, p['hot_c'])
        sw = pack.steps(p['slope_window_min'])
        for i in range(pack.n):
            s0 = B.sustained_since(hot, i)
            if s0 is None or pack.minutes_between(s0, i) < p['sustain_min']:
                continue
            onset = s0
            watch = B.gt(res, p['watch_c'])
            while onset > 0 and watch[onset - 1]:
                onset -= 1
            slope = B.slope_per_hour(res, i, sw, pack.step_min)
            if slope is not None and slope > p['min_slope_c_per_h'] and B.max_step(res, onset, i) < p['max_step_c']:
                c.update(onset=onset, alert=s0)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, now = self.p, f.ctx, pack.now
        aid = f.aid
        tid = pack.unit_of(aid)
        tname = pack.name(tid)
        dt = pack.parent(aid)
        gb = pack.child_of_type(dt, 'gearbox')
        mb = pack.child_of_type(dt, 'main_bearing')
        gen = pack.descendant_of_type(tid, 'dfig_generator')
        gb_b = pack.child_of_type(gen, 'generator_bearing') if gen else None
        peers = [a for a in c['peers'] if a != aid]
        running_peers = [a for a in peers if c['mask'](a)[now]]
        masks = {a: c['mask'](a) for a in peers}
        res, temp, exp = c['res'], c['temp'], c['exp']
        onset, alert = c['onset'], c['alert']
        ts = pack.ts

        slope = B.slope_per_hour(res, now, pack.steps(p['slope_window_min']), pack.step_min)
        step = B.max_step(res, onset, now)
        watch_since = B.sustained_since(B.gt(res, p['watch_c']), now)

        debris = pack.series(gb, 'oil_particle_count')
        gbs = {a: pack.child_of_type(pack.parent(a), 'gearbox') for a in peers}
        d_lo, d_med, d_hi = [], [], []
        for k in range(pack.n):
            vals = [pack.series(gbs[a], 'oil_particle_count')[k] for a in peers if masks[a][k]]
            d_lo.append(min(vals)); d_med.append(sorted(vals)[len(vals) // 2]); d_hi.append(max(vals))
        v_lo, _, v_hi = B.peer_stats(pack, peers, 'vibration_mms', masks)
        vib = pack.series(aid, 'vibration_mms')
        mbs = {a: pack.child_of_type(pack.parent(a), 'main_bearing') for a in peers}
        m_vals = [pack.series(mbs[a], 'bearing_temp_c') for a in peers]
        m_lo = [min(v[k] for v, a in zip(m_vals, peers) if masks[a][k]) for k in range(pack.n)]
        m_hi = [max(v[k] for v, a in zip(m_vals, peers) if masks[a][k]) for k in range(pack.n)]
        mtemp = pack.series(mb, 'bearing_temp_c')
        gbt = pack.series(gb, 'gearbox_oil_temp_c')
        gbt_peer = [pack.series(gbs[a], 'gearbox_oil_temp_c')[now] for a in running_peers]
        gbt_med = sorted(gbt_peer)[len(gbt_peer) // 2]
        genb_ok = True
        if gb_b:
            gpeers = [pack.child_of_type(pack.descendant_of_type(pack.unit_of(a), 'dfig_generator'), 'generator_bearing')
                      for a in running_peers]
            gv = [pack.series(g, 'bearing_temp_c')[now] for g in gpeers]
            genb_ok = min(gv) - 1 <= pack.series(gb_b, 'bearing_temp_c')[now] <= max(gv) + 1

        debris_ok = debris[now] > p['debris_ratio'] * d_hi[now]
        vib_ok = vib[now] > v_hi[now]
        local_ok = m_lo[now] <= mtemp[now] <= m_hi[now] and genb_ok
        independent = sum([debris_ok, vib_ok])
        level = 'medium' if independent else 'low'

        feeder = feeder_of(pack, tid)
        mates = [t for t in pack.children[feeder] if t != tid and running(pack, t)[now]]
        mate_p = [pack.series(t, 'active_power_kw')[now] for t in mates]
        mate_bt = [pack.series(pack.descendant_of_type(t, 'hs_bearing'), 'bearing_temp_c')[now] for t in mates]
        power = pack.series(tid, 'active_power_kw')
        amb = ambient(pack)
        peer_res = {a: B.residual(pack.series(a, 'bearing_temp_c'),
                                  B.fleet_expected(pack, a, c['peers'], 'bearing_temp_c', thermal_features(pack),
                                                   c['mask'])[1], masks[a]) for a in peers}
        peer_max = max(abs(v) for r in peer_res.values() for v in r if v is not None)
        stopped = stopped_peers_note(pack, [pack.unit_of(a) for a in peers], now)
        pct = lambda a, b: abs(a - b) / b * 100
        m0, m1, m2 = c['model'].coef

        checks = [
            check('hot', 'Hotter than expected for its load', 'required', MATCH,
                  f'{signed(res[now])} °C above expected now. Alert level is +{num(p["hot_c"], 0)} °C.',
                  'Bearing damage adds friction heat that load and weather can\'t explain.',
                  spark(res, [-3, 16], threshold_value=p['hot_c'])),
            check('gradual', 'Rising steadily, not jumping', 'required', MATCH,
                  f'{signed(slope)} °C per hour over the last {dur(p["slope_window_min"])}. '
                  f'Largest 10-min step: {num(step)} °C.',
                  'Wear grows gradually. A sensor or wiring fault usually shows up as a sudden jump.',
                  spark(res, [-3, 16], highlight=[ts[onset], ts[now]])),
            check('sustained', 'Sustained, not a passing spike', 'required', MATCH,
                  f'Above +{num(p["hot_c"], 0)} °C since {ts[alert]} ({dur(pack.minutes_between(alert, now))}). '
                  f'Above +{num(p["watch_c"], 0)} °C since {ts[watch_since]}.',
                  f'Needs at least {dur(p["sustain_min"])} above the alert level, so gusts and restarts don\'t trigger it.',
                  spark(res, [-3, 16], threshold_value=p['hot_c'], highlight=[ts[alert], ts[now]])),
            check('debris', 'Oil debris rising', 'supporting', MATCH if debris_ok else NO_MATCH,
                  f'About {num(B.mean(debris[max(0, onset - pack.steps(180)):onset]), 0)} particles/h before {ts[onset]}, '
                  f'{num(debris[now], 0)} now. Other turbines: {num(d_lo[now], 0)}–{num(d_hi[now], 0)}.',
                  'A separate sensor. Metal flaking off a damaged bearing race ends up in the oil.',
                  spark(debris, [0, 30], d_lo, d_hi)),
            check('vib', 'Bearing vibration up', 'supporting', MATCH if vib_ok else NO_MATCH,
                  f'{num(vib[now], 2)} mm/s. Other turbines: {num(v_lo[now], 2)}–{num(v_hi[now], 2)} mm/s.',
                  'A damaged rolling surface makes the bearing run rougher.',
                  spark(vib, [1, 4], v_lo, v_hi)),
            check('local', 'Heat stays local to this bearing', 'supporting', MATCH if local_ok else NO_MATCH,
                  f'Main bearing {num(mtemp[now])} °C (fleet {num(m_lo[now])}–{num(m_hi[now])}). '
                  f'Generator bearing {"normal" if genb_ok else "also hot"}.',
                  'A cooling or lubrication problem would warm the whole drivetrain, not one bearing.',
                  spark(mtemp, [15, 45], m_lo, m_hi)),
        ]

        main = chart('°C', nice_domain(temp, exp, pad=0.05),
                     [series('actual', f'{tname} HS bearing', temp, 'primary', 1),
                      series('expected', 'Expected for this load & ambient', exp, 'expected', 1)],
                     title='What we see',
                     caption='HS bearing temperature against what we\'d expect for this turbine\'s load and today\'s '
                             'weather. The shaded gap is heat that load and weather don\'t explain.',
                     shade_gap=['actual', 'expected'],
                     markers=[marker(ts[onset], 'Divergence begins'), marker(ts[alert], f'Alert: +{num(p["hot_c"], 0)} °C')])

        peer_chart = chart('°C', [-4, 14],
                           [series(pack.name(pack.unit_of(a)), pack.name(pack.unit_of(a)), peer_res[a], 'peer', 1)
                            for a in running_peers] + [series('self', tname, res, 'primary', 1)],
                           thresholds=[threshold(p['hot_c'], 'Alert')],
                           caption=f'Unexplained heat: {tname} against {len(running_peers)} other turbines.')

        # Reference examples (hours since onset). Shapes follow the research brief.
        grid = hours_grid(14)
        r = Rng(101)
        tb = [0.0 if h == 0 else 1.25 * h + 0.035 * h * h + r.gauss(0.35) for h in grid]
        tb_d = [round(3 + 1.9 * h + 0.02 * h * h + r.gauss(1.0)) for h in grid]
        ea = [0.32 * h + r.gauss(0.35) for h in grid]
        ea_d = [round(3 + 0.35 * h + r.gauss(0.8)) for h in grid]
        so = [(11.0 if h >= 4 else 0.0) + r.gauss(0.35) for h in grid]
        so_d = [round(3 + r.gauss(1.0)) for h in grid]
        live_r = aligned(res, onset, pack.step_min, grid)
        live_d = aligned(debris, onset, pack.step_min, grid)
        live = f'{tname}, now'

        def pair(a, b):
            return [ref_chart('Unexplained heat', '°C', [-2, 26], grid, 'h', a, live_r, live),
                    ref_chart('Oil debris', 'particles/h', [0, 34], grid, 'h', b, live_d, live, 0)]
        refs = [
            reference('textbook', 'textbook', 'Textbook', 'Confirmed spalling',
                      'Fully developed case. Heat and debris climb together until the bearing is replaced.',
                      'match', 'Closest match',
                      ['Same gradual climb, at a similar rate', 'Debris rising alongside, as here'], pair(tb, tb_d)),
            reference('early', 'early', 'Early stage', 'Caught early',
                      'What it looks like while there is still plenty of time. Easy to miss, since it stays under '
                      'most alarm limits.',
                      'partial', 'Same shape, slower',
                      [f'{tname} has passed this stage', 'Shows what to watch for on other turbines'], pair(ea, ea_d)),
            reference('sensor', 'lookalike', 'Look-alike', 'Sensor offset, not damage',
                      'A loose connection makes the reading jump. The bearing itself is healthy.',
                      'nomatch', 'Doesn\'t match',
                      [f'This jumps in one step; {tname} climbs',
                       f'Debris stays flat here; on {tname} it rose '
                       f'{num(debris[now] / max(1, B.mean(debris[max(0, onset - pack.steps(180)):onset])), 0)}×'],
                      pair(so, so_d)),
        ]

        ro = [
            ruled_out('Higher load', 'ruled out',
                      f'{tname} is producing {num(power[now], 0)} kW. The other running {pack.name(feeder)} turbines are at '
                      f'{num(min(mate_p), 0)}–{num(max(mate_p), 0)} kW, and read {num(min(mate_bt), 0)}–{num(max(mate_bt), 0)} °C.'),
            ruled_out('Warmer weather', 'ruled out',
                      f'Ambient went from {num(min(amb))} to {num(amb[now])} °C today, but the expected-temperature model '
                      f'allows for it, and every other running turbine stayed within ±{num(peer_max)} °C of expected all day:',
                      peer_chart),
            ruled_out('Faulty temperature sensor', 'ruled out',
                      f'The rise is gradual (largest 10-min step {num(step)} °C), and two separate sensors, oil debris '
                      f'and vibration, moved with it.'),
            ruled_out('Drivetrain cooling or lubrication', 'unlikely',
                      f'Main and generator bearings read normal for the fleet. Gearbox oil is only '
                      f'{num(gbt[now] - gbt_med)} °C above the fleet median, which fits heat coming from one bearing '
                      f'rather than a cooler failure.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'Early HS bearing surface damage (spalling)', level,
                                     f'{independent} independent signals agree' if independent != 1
                                     else '1 independent signal agrees'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro,
            'excluded': (f'Left out of the comparison: {join_names(stopped)}. Turbines that are stopped don\'t tell us '
                         f'what "normal at this load" looks like.') if stopped else None,
            'confidence': confidence(level,
                                     'Heat and oil debris are measured by independent sensors and both point at this bearing.',
                                     'Nobody has inspected it yet. SCADA can\'t tell spalling from lubrication starvation at one bearing.',
                                     'The oil sample shows ferrous wear particles, or the borescope shows spalling on the HS race.',
                                     'The oil sample is clean. Then recheck the sensor and the bearing\'s lube supply.'),
            'action': action(item, pack),
            'model': {'target': 'bearing_temp_c', 'formula':
                      f'{num(m0)} + {num(m1 , 2)} × load/100 kW (40-min avg) + {num(m2, 2)} × ambient',
                      'fittedOn': f'{len(c["model"].peers)} HS bearings, running points today'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 2. Generator cooling lost — archetype 07 (symptom downstream, cause upstream)
# ═════════════════════════════════════════════════════════════════════════
class GeneratorCoolingLoss(Detector):
    id = 'wind.generator_cooling_loss'
    name = 'Generator cooling lost'
    archetype = '07 Ghost signal'
    applies_to = 'generators'
    summary = ('Generator windings running far hotter than load and weather explain, because whatever feeds '
               'it cooling air (on the cooling relationship layer) has stopped.')
    pipeline = [
        ('Find peers', 'every other generator of the same type, counting only points where its turbine has produced for 60 min'),
        ('Expected value', 'fit on the peers: winding temperature ≈ c0 + c1 × load (40-min average) + c2 × ambient'),
        ('Follow the cooling layer', 'the assets that feed this generator on the "cooling" relationship layer — its fan'),
        ('Checks', 'unexplained heat · cooling source stopped · which came first · recovery after restart'),
        ('Conclusion', 'the symptom is on the generator, the cause is on the asset feeding it'),
    ]
    definition = {
        'appliesTo': {'assetType': ['dfig_generator', 'pm_generator']},
        'inputs': {'winding': 'self.stator_winding_temp_c', 'load': 'unit.active_power_kw',
                   'ambient': 'met_mast.ambient_temp_c', 'fan': 'sources[layer=cooling].cooling_fan_current_a'},
        'expected': {'model': 'linear', 'target': 'winding', 'features': ['ema(load, 40 min)', 'ambient'], 'fitOn': 'peers of the same type'},
        'params': {'hot_c': 15.0, 'sustain_min': 20, 'fan_off_a': 1.0, 'producing_kw': 100, 'lead_max_min': 60,
                   'recover_within_min': 90},
        'checks': [
            {'id': 'hot', 'role': 'required', 'rule': 'residual > hot_c for sustain_min'},
            {'id': 'fan', 'role': 'required', 'rule': 'fan < fan_off_a while producing, starting before (or with) the heat'},
            {'id': 'first', 'role': 'supporting', 'rule': 'fan stop leads the residual crossing by ≤ lead_max_min'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'residual < hot_c within recover_within_min of the fan restarting'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'temperature recovered after the cooling source restarted'},
    }

    def candidates(self, pack):
        return pack.of_type('dfig_generator', 'pm_generator')

    def _ctx(self, pack, aid):
        atype = pack.asset(aid)['assetType']
        peers = pack.of_type(atype)
        mask = lambda a: running(pack, pack.unit_of(a))
        model, exp = B.fleet_expected(pack, aid, peers, 'stator_winding_temp_c', thermal_features(pack), mask)
        temp = pack.series(aid, 'stator_winding_temp_c')
        res = B.residual(temp, exp, mask(aid))
        fans = [a for a in pack.sources(aid, 'cooling') if pack.has(a, 'cooling_fan_current_a')]
        return dict(peers=peers, mask=mask, model=model, exp=exp, temp=temp, res=res, fans=fans)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        if not c['fans']:
            return Finding(aid, False)
        fan = c['fans'][0]
        fcur = pack.series(fan, 'cooling_fan_current_a')
        power = pack.series(pack.unit_of(aid), 'active_power_kw')
        off = [f < p['fan_off_a'] and pw > p['producing_kw'] for f, pw in zip(fcur, power)]
        hot = B.gt(c['res'], p['hot_c'])
        for i in range(pack.n):
            h0 = B.sustained_since(hot, i)
            if h0 is None or pack.minutes_between(h0, i) < p['sustain_min']:
                continue
            f0 = next((k for k in range(max(0, h0 - pack.steps(p['lead_max_min'])), h0 + 1) if off[k]), None)
            if f0 is None:
                continue
            fr = f0
            while fr + 1 < pack.n and off[fr + 1]:
                fr += 1
            c.update(fan=fan, fcur=fcur, off=off, fan_off=f0, fan_back=fr + 1 if fr + 1 < pack.n else None,
                     hot_start=h0, power=power)
            return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, tid = f.aid, pack.unit_of(f.aid)
        tname = pack.name(tid)
        res, temp, exp, fcur = c['res'], c['temp'], c['exp'], c['fcur']
        f0, fb, h0 = c['fan_off'], c['fan_back'], c['hot_start']
        hot = B.gt(res, p['hot_c'])
        h_end = h0
        while h_end + 1 < pack.n and hot[h_end + 1]:
            h_end += 1
        peak = max(range(h0, h_end + 1), key=lambda k: temp[k])
        before = B.mean(fcur[max(0, f0 - 6):f0])
        recovered = fb is not None and h_end + 1 < pack.n and pack.minutes_between(fb, h_end + 1) <= p['recover_within_min']
        rec_at = h_end + 1 if recovered else None
        lead = pack.minutes_between(f0, h0)
        peers = [a for a in c['peers'] if a != aid]
        masks = {a: c['mask'](a) for a in peers}
        power = c['power']
        amb = ambient(pack)
        level = 'high' if recovered else 'medium'

        checks = [
            check('hot', 'Windings far hotter than load explains', 'required', MATCH,
                  f'Peaked at {num(temp[peak])} °C at {ts[peak]}, {signed(res[peak], 0)} °C above expected for its load.',
                  'Load and weather set how much heat the generator makes. Heat beyond that points at cooling.',
                  spark(res, [-10, 70], threshold_value=p['hot_c'])),
            check('fan', 'Its cooling fan had stopped', 'required', MATCH,
                  f'Fan motor current fell from about {num(before)} A to {num(fcur[f0])} A at {ts[f0]}, '
                  f'with the turbine still producing.',
                  'The fan feeds this generator on the cooling layer. Without it, heat stays in the windings.',
                  spark(fcur, [0, 12], highlight=[ts[f0], ts[fb or now]])),
            check('first', 'The fan stopped first', 'supporting', MATCH,
                  f'The fan stopped at {ts[f0]}; the windings left normal {dur(lead) if lead else "in the same interval"}'
                  f'{" later" if lead else ""}, at {ts[h0]}.',
                  'A cause comes before its effect. If the windings had heated first, the fan would be a victim, not the cause.',
                  spark(res, [-10, 70], threshold_value=p['hot_c'], highlight=[ts[f0], ts[h0]])),
            check('recovered', 'Temperature fell once the fan restarted', 'supporting',
                  MATCH if recovered else (PENDING if fb is None else NO_MATCH),
                  (f'Fan back at {ts[fb]}; windings back within +{num(p["hot_c"], 0)} °C of expected by {ts[rec_at]}.'
                   if recovered else 'The fan hasn\'t restarted yet.' if fb is None else
                   f'Fan back at {ts[fb]}, but the windings are still hot.'),
                  'Restoring the cause and watching the symptom clear is the strongest confirmation there is.',
                  spark(temp, nice_domain(temp, exp), highlight=[ts[fb], ts[rec_at]] if recovered else None)),
        ]
        main = chart('°C', nice_domain(temp, exp, pad=0.05),
                     [series('actual', f'{tname} stator winding', temp, 'primary', 1),
                      series('expected', 'Expected for this load & ambient', exp, 'expected', 1)],
                     title='What we see',
                     caption='Stator winding temperature against what this load and today\'s weather would explain. '
                             'The shaded gap is heat the cooling system didn\'t remove.',
                     shade_gap=['actual', 'expected'],
                     markers=[marker(ts[f0], 'Fan stops')] + ([marker(ts[fb], 'Fan restarted')] if fb else []))

        grid = minutes_grid(-30, 180, 10)
        r = Rng(202)
        rise = lambda m, top, tau: 0.0 if m < 0 else top * (1 - 2.718 ** (-m / tau))
        tb_t = [(rise(m, 62, 45) if m < 100 else rise(100, 62, 45) * 2.718 ** (-(m - 100) / 25)) + r.gauss(1.2) for m in grid]
        tb_f = [(0.0 if 0 <= m < 100 else 8.5 + r.gauss(0.2)) for m in grid]
        ea_t = [rise(m, 16, 60) + r.gauss(1.2) for m in grid]
        ea_f = [(8.5 if m < 0 else 5.2) + r.gauss(0.2) for m in grid]
        la_t = [rise(m, 30, 90) + r.gauss(1.2) for m in grid]
        la_f = [8.6 + r.gauss(0.2) for m in grid]
        lr = aligned(res, f0, pack.step_min, grid, 'min')
        lf = aligned(fcur, f0, pack.step_min, grid, 'min')
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Unexplained winding heat', '°C', [-10, 75], grid, 'min', a, lr, live, 0),
                    ref_chart('Fan current', 'A', [0, 12], grid, 'min', b, lf, live)]
        refs = [
            reference('fan_trip', 'textbook', 'Textbook', 'Fan trip, reset in time',
                      'The fan motor protection trips; the windings climb until the fan is reset, then fall straight back.',
                      'match', 'Closest match', ['Fan current to zero, then the heat', 'Recovery as soon as the fan restarts'],
                      pair(tb_t, tb_f)),
            reference('blocked_filter', 'early', 'Early stage', 'Clogged air filter',
                      'The fan still runs but moves less air. The windings run a little warm for days before anyone notices.',
                      'partial', 'Same cause family, milder',
                      ['Fan current drops but not to zero', 'Worth checking filters at the next visit'], pair(ea_t, ea_f)),
            reference('insulation', 'lookalike', 'Look-alike', 'Winding hot spot, fan healthy',
                      'An internal winding fault makes heat the fan can\'t remove. The fan current stays normal throughout.',
                      'nomatch', 'Doesn\'t match', [f'Here the fan runs normally; on {tname} it stopped',
                                                    'A hot spot wouldn\'t clear when a fan restarts'], pair(la_t, la_f)),
        ]
        ro = [
            ruled_out('A generator fault', 'ruled out',
                      f'The heat input didn\'t change, the heat removal did: the windings came back to normal by '
                      f'{ts[rec_at]} once the fan restarted, with no repair to the generator.' if recovered else
                      'Not yet: the fan hasn\'t restarted, so a generator fault can\'t be excluded.'),
            ruled_out('Higher load', 'ruled out',
                      f'Output was {num(power[h0], 0)} kW when the heating began and {num(power[peak], 0)} kW at the peak. '
                      f'The expected-temperature line already allows for that, and the actual temperature ran '
                      f'{signed(res[peak], 0)} °C above it.'),
            ruled_out('Warmer weather', 'ruled out',
                      f'Ambient was {num(amb[h0])} °C when the heating began and {num(amb[peak])} °C at the peak.'),
            ruled_out('Faulty temperature sensor', 'ruled out',
                      'A second, independent signal — the fan current — explains the rise, and the reading fell exactly when '
                      'the fan came back.'),
        ]
        return {
            'conclusion': conclusion('Cause' if recovered else 'Most likely cause',
                                     'Cooling fan stopped; the generator itself was healthy',
                                     level, 'Confirmed: temperature fell as soon as the fan restarted' if recovered
                                     else 'Fan stopped before the windings heated'),
            'rootCauseAssetId': c['fan'],
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The fan stopped first, the windings heated, and they cooled again when it restarted.'
                                     if recovered else 'The fan stopped first, then the windings heated.',
                                     None if recovered else 'The fan hasn\'t restarted yet, so the loop isn\'t closed.',
                                     None if recovered else 'The windings cool once the fan is reset.',
                                     'The windings stay hot with the fan running. Then suspect the generator itself.',
                                     'Recovery after the fan restart' if recovered else None),
            'action': action(item, pack),
            'model': {'target': 'stator_winding_temp_c',
                      'formula': f'{num(c["model"].coef[0])} + {num(c["model"].coef[1], 2)} × load/100 kW (40-min avg) '
                                 f'+ {num(c["model"].coef[2], 2)} × ambient',
                      'fittedOn': f'{len(c["model"].peers)} generators of the same type, running points today'},
        }


# ═════════════════════════════════════════════════════════════════════════
# 3. Collector feeder trip — archetype 09 (cascade from one asset)
# ═════════════════════════════════════════════════════════════════════════
class FeederTrip(Detector):
    id = 'wind.feeder_trip'
    name = 'Collector feeder trip'
    archetype = '09 Cascade failure'
    applies_to = 'collector feeders'
    summary = ('A feeder loses all its turbines in one interval while the wind is fine; the detector then looks '
               'down the feeder for the one asset that was already misbehaving beforehand.')
    pipeline = [
        ('Trip', 'feeder output falls to near zero within one interval'),
        ('Common cause', 'every turbine on the feeder dropped in the same interval, and the wind was fine'),
        ('Look for the origin', 'each pad transformer on the feeder against a fleet model of oil temperature for its '
                                'load and ambient, over the hour before the trip'),
        ('Contain', 'other feeders unaffected; after restoration, which turbine stayed off'),
        ('Conclusion', 'upstream common point, origin named when one asset trended abnormally first'),
    ]
    definition = {
        'appliesTo': {'assetType': 'collector_feeder'},
        'inputs': {'feeder': 'self.feeder_power_kw', 'turbines': 'children.active_power_kw',
                   'wind': 'met_mast.met_wind_speed_ms', 'trafos': 'children…pad_transformer.transformer_oil_temp_c'},
        'params': {'min_before_kw': 2000, 'drop_to_frac': 0.02, 'wind_ok_ms': 4.0, 'origin_rise_c': 8.0,
                   'origin_window_min': 60},
        'checks': [
            {'id': 'trip', 'role': 'required', 'rule': 'feeder > min_before_kw, then < drop_to_frac × that in one interval'},
            {'id': 'common', 'role': 'required', 'rule': 'all child turbines ≈ 0 in the same interval'},
            {'id': 'wind', 'role': 'required', 'rule': 'met wind > wind_ok_ms'},
            {'id': 'origin', 'role': 'supporting', 'independent': True, 'rule': 'one pad transformer residual rose > origin_rise_c in origin_window_min before the trip'},
            {'id': 'others', 'role': 'supporting', 'rule': 'other feeders kept producing'},
            {'id': 'restored', 'role': 'supporting', 'independent': True, 'rule': 'feeder restored with the origin turbine left off'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'origin found and the feeder held once it was isolated'},
    }

    def candidates(self, pack):
        return pack.of_type('collector_feeder')

    def evaluate(self, pack, aid):
        p = self.p
        fp = pack.series(aid, 'feeder_power_kw')
        wind = pack.series(met(pack), 'met_wind_speed_ms')
        kids = [t for t in pack.children[aid] if pack.asset(t)['assetType'] in TURBINE_TYPES]
        for i in range(1, pack.n):
            if fp[i - 1] > p['min_before_kw'] and fp[i] < p['drop_to_frac'] * fp[i - 1] and wind[i] > p['wind_ok_ms']:
                if all(pack.series(t, 'active_power_kw')[i] < 1 for t in kids):
                    return Finding(aid, True, i, trip=i, kids=kids, fp=fp, wind=wind)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, i = f.aid, c['trip']
        fname = pack.name(aid)
        fp, wind, kids = c['fp'], c['wind'], c['kids']
        trafos = pack.of_type('pad_transformer')
        tmask = lambda a: running(pack, pack.unit_of(a))
        feats = thermal_features(pack)
        w = pack.steps(p['origin_window_min'])
        rises, resids = {}, {}
        for t in kids:
            tr = pack.child_of_type(t, 'pad_transformer')
            _, exp = B.fleet_expected(pack, tr, trafos, 'transformer_oil_temp_c', feats, tmask)
            oil = pack.series(tr, 'transformer_oil_temp_c')
            r = [o - e for o, e in zip(oil, exp)]
            resids[t] = r
            rises[t] = r[i - 1] - r[i - 1 - w]
        origin = max(rises, key=rises.get)
        found = rises[origin] > p['origin_rise_c']
        o_name = pack.name(origin)
        o_tr = pack.child_of_type(origin, 'pad_transformer')
        back = next((k for k in range(i + 1, pack.n) if fp[k] > 0.2 * fp[i - 1]), None)
        back_kids = [t for t in kids if back is not None and pack.series(t, 'active_power_kw')[min(back + 1, now)] > 1]
        stayed_off = [t for t in kids if t not in back_kids]
        restored = back is not None and stayed_off == [origin]
        others = [x for x in pack.of_type('collector_feeder') if x != aid]
        others_ok = all(pack.series(x, 'feeder_power_kw')[i] > 0.5 * pack.series(x, 'feeder_power_kw')[i - 1] for x in others)
        count = [sum(1 for t in kids if pack.series(t, 'active_power_kw')[k] > 1) for k in range(pack.n)]
        o_load = pack.series(o_tr, 'transformer_load_pct')
        level = 'high' if (found and restored) else 'medium'
        win = [ts[max(0, i - 18)], ts[min(now, i + 12)]]

        checks = [
            check('trip', 'Feeder output fell to zero in one interval', 'required', MATCH,
                  f'{num(fp[i - 1], 0)} kW at {ts[i - 1]}, {num(fp[i], 0)} kW at {ts[i]}.',
                  'Losing a whole feeder at once is a breaker opening, not turbines winding down.',
                  spark(fp, nice_domain(fp, floor=0), window=win)),
            check('common', f'All {len(kids)} turbines dropped together', 'required', MATCH,
                  f'{len(kids)} of {len(kids)} {fname} turbines lost power in the same 10-minute interval.',
                  'When every turbine stops at the same moment, the cause is the point they share — the feeder — '
                  'not each machine.',
                  spark(count, [0, len(kids) + 1], window=win)),
            check('wind', 'The wind was fine', 'required', MATCH,
                  f'{num(wind[i])} m/s at the met mast at {ts[i]} — well inside the operating range.',
                  'Rules out a calm or a storm shutdown.',
                  spark(wind, [0, 16], threshold_value=p['wind_ok_ms'])),
            check('origin', f'One asset was misbehaving first: {o_name} pad transformer', 'supporting',
                  MATCH if found else NO_MATCH,
                  f'Its oil ran {signed(rises[origin])} °C hotter than its load explains in the hour before the trip, '
                  f'at {num(o_load[i - 1], 0)} % load. The other transformers on {fname} stayed within '
                  f'{signed(max(v for t, v in rises.items() if t != origin))} °C.',
                  'A transformer heating with no extra load has an internal fault. If its own protection doesn\'t clear it, '
                  'the feeder breaker does — taking every turbine with it.',
                  spark(resids[origin], [-10, 30], highlight=[ts[i - 1 - w], ts[i - 1]], window=win)),
            check('others', 'Other feeders unaffected', 'supporting', MATCH if others_ok else NO_MATCH,
                  f'{join_names([pack.name(x) for x in others])} kept producing through {ts[i]}.',
                  'A substation or grid event would have hit every feeder.',
                  None),
            check('restored', f'Feeder held once {o_name} was left off', 'supporting',
                  MATCH if restored else (PENDING if back is None else NO_MATCH),
                  (f'Re-energised at {ts[back]} with {len(back_kids)} of {len(kids)} turbines; {o_name} stayed off.'
                   if back is not None else 'Not re-energised yet.'),
                  'If the feeder holds without the suspect, the suspect was the fault.',
                  spark(count, [0, len(kids) + 1], window=[ts[i - 1], ts[min(now, (back or i) + 6)]])),
        ]
        main = chart('kW', nice_domain(fp, floor=0),
                     [series('feeder', f'{fname} output', fp, 'primary', 0)],
                     title='What we see',
                     caption=f'{fname} output through the day. Everything on the feeder stopped at once, with the wind still blowing.',
                     markers=[marker(ts[i], 'Breaker trips')] + ([marker(ts[back], 'Re-energised')] if back else []))
        tr_chart = chart('°C', [-10, 30],
                         [series(pack.name(t), pack.name(t), resids[t], 'peer', 1) for t in kids if t != origin] +
                         [series('origin', o_name, resids[origin], 'primary', 1)],
                         caption=f'Pad transformer oil above what its load explains, every turbine on {fname}.',
                         window=[ts[max(0, i - 24)], ts[i]])
        grid = minutes_grid(-60, 60, 10)
        r = Rng(303)
        norm = lambda v: 100.0 * v / fp[i - 1]
        tb_p = [(100 + r.gauss(3) if m < 0 else (0 if m < 40 else 86 + r.gauss(3))) for m in grid]
        tb_o = [(max(0, (m + 50) * 0.4) if -50 <= m < 0 else (0 if m < -50 else None)) for m in grid]
        tb_o = [(v + r.gauss(0.6)) if v is not None else None for v in tb_o]
        ca_p = [(100 + r.gauss(3) if m < 0 else (0 if m < 50 else 100 + r.gauss(3))) for m in grid]
        ca_o = [(r.gauss(0.6) if m < 0 else None) for m in grid]
        st_p = [(max(0, 100 - max(0, m + 30) * 3.3) + r.gauss(2)) for m in grid]
        st_o = [r.gauss(0.6) if m < 0 else None for m in grid]
        lp = [norm(v) if v is not None else None for v in aligned(fp, i, pack.step_min, grid, 'min')]
        lo = aligned(resids[origin], i, pack.step_min, grid, 'min')
        lo = [v if (m < 0 and v is not None) else None for v, m in zip(lo, grid)]
        live = f'{fname}, today'

        def pair(a, b):
            return [ref_chart('Feeder output (% of before)', '%', [0, 120], grid, 'min', a, lp, live, 0),
                    ref_chart('Worst transformer, heat above expected', '°C', [-5, 30], grid, 'min', b, lo, live)]
        refs = [
            reference('trafo', 'textbook', 'Textbook', 'Pad transformer fault',
                      'One transformer heats for up to an hour, then faults. The feeder breaker clears it and the feeder '
                      'comes back without that turbine.',
                      'match', 'Closest match', ['A warning an hour ahead on one transformer', 'Back without the faulty turbine'],
                      pair(tb_p, tb_o)),
            reference('cable', 'variant', 'Variant', 'Cable or splice fault',
                      'Same trip, no warning: underground cable faults rarely show anything beforehand. The whole feeder '
                      'stays off until the fault is found.',
                      'partial', 'Same trip, different origin', [f'{fname} had a clear warning; a cable fault wouldn\'t',
                                                                 'Different follow-up: cable test, not transformer test'],
                      pair(ca_p, ca_o)),
            reference('storm', 'lookalike', 'Look-alike', 'Storm shutdown',
                      'Wind above cut-out speed: turbines stop one by one over half an hour. Nothing is broken.',
                      'nomatch', 'Doesn\'t match', ['Turbines stop one at a time, not together',
                                                    f'Today the wind was only {num(wind[i])} m/s'], pair(st_p, st_o)),
        ]
        ro = [
            ruled_out('Wind', 'ruled out', f'{num(wind[i])} m/s at the met mast when the feeder tripped.'),
            ruled_out('A substation or grid fault', 'ruled out',
                      f'{join_names([pack.name(x) for x in others])} kept producing; export fell only by {fname}\'s share.'),
            ruled_out('Separate faults on each turbine', 'ruled out',
                      f'All {len(kids)} stopped in the same interval — they share one breaker.'),
            ruled_out('Another turbine\'s transformer', 'ruled out' if found else 'not yet checked',
                      f'Only {o_name}\'s transformer ran hot beforehand:', tr_chart),
        ]
        return {
            'conclusion': conclusion('Cause' if level == 'high' else 'Most likely cause',
                                     f'Internal fault in {o_name}\'s pad transformer, cleared by the {fname} breaker',
                                     level, f'Confirmed: {fname} held once {o_name} was isolated' if level == 'high'
                                     else 'Origin found; restoration not yet confirmed'),
            'rootCauseAssetId': o_tr,
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     f'The whole feeder stopped at once with good wind, {o_name}\'s transformer was the only '
                                     f'asset trending abnormally beforehand, and the feeder held without it.',
                                     None if level == 'high' else 'The feeder hasn\'t been restored without the suspect yet.',
                                     None, 'A transformer test on ' + o_name + ' comes back clean. Then test the feeder cable.',
                                     'Feeder held after isolation' if level == 'high' else None),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 4. Nacelle anemometer fault — archetype 06 (instrument, not process)
# ═════════════════════════════════════════════════════════════════════════
class AnemometerFault(Detector):
    id = 'wind.anemometer_fault'
    name = 'Nacelle anemometer reading wrong'
    archetype = '06 Signal noise'
    applies_to = 'turbines'
    summary = ('A turbine\'s own wind reading disagrees with its neighbours, while everything the wind actually '
               'drives — power, rotor speed — agrees with them. The instrument is wrong, not the process.')
    pipeline = [
        ('Neighbours', 'the other turbines on the same feeder that are producing'),
        ('Compare', 'this turbine\'s wind reading and its power, each as a share of the neighbours\' median'),
        ('Checks', 'reading disagrees · power agrees · rotor speed agrees · icing weather'),
        ('Conclusion', 'nothing physical confirms the odd reading, so it\'s the sensor'),
    ]
    definition = {
        'appliesTo': {'assetType': list(TURBINE_TYPES)},
        'inputs': {'wind': 'self.wind_speed_ms', 'power': 'self.active_power_kw', 'rotor': 'child[rotor].rotor_speed_rpm',
                   'perf': 'self.power_curve_perf_pct', 'neighbours': 'siblings (same feeder, producing)',
                   'weather': ['met_mast.ambient_temp_c', 'met_mast.relative_humidity_pct']},
        'params': {'low_ratio': 0.75, 'clear_ratio': 0.9, 'power_band': [0.8, 1.25], 'sustain_min': 30, 'min_neighbours': 3,
                   'rotor_band_pct': 6, 'icing_temp_c': 0.0, 'icing_rh_pct': 90},
        'checks': [
            {'id': 'low', 'role': 'required', 'rule': 'wind / neighbourMedian(wind) < low_ratio for sustain_min'},
            {'id': 'power', 'role': 'required', 'rule': 'power / neighbourMedian(power) within power_band'},
            {'id': 'rotor', 'role': 'supporting', 'independent': True, 'rule': 'rotor within ±rotor_band_pct of neighbours'},
            {'id': 'perf', 'role': 'supporting', 'rule': 'performance computed from the reading > 120 %'},
            {'id': 'icing', 'role': 'supporting', 'rule': 'ambient < icing_temp_c and humidity ≥ icing_rh_pct at onset and for ≥ 75 % of the episode'},
            {'id': 'recovered', 'role': 'supporting', 'independent': True, 'rule': 'reading back within 10 % of neighbours'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'reading recovered after a sensor action'},
    }

    def candidates(self, pack):
        return pack.of_type(*TURBINE_TYPES)

    def _ratios(self, pack, tid):
        mates = [t for t in pack.children[pack.parent(tid)] if t != tid and pack.asset(t)['assetType'] in TURBINE_TYPES]
        own_run = running(pack, tid)
        mruns = {t: running(pack, t) for t in mates}
        wr, pr, rr, wmed = [], [], [], []
        own_w, own_p = pack.series(tid, 'wind_speed_ms'), pack.series(tid, 'active_power_kw')
        own_r = pack.series(pack.child_of_type(tid, 'rotor'), 'rotor_speed_rpm')
        for k in range(pack.n):
            ms = [t for t in mates if mruns[t][k]]
            if not own_run[k] or len(ms) < self.p['min_neighbours']:
                wr.append(None); pr.append(None); rr.append(None); wmed.append(None)
                continue
            med = lambda key, sub=None: sorted(pack.series(pack.child_of_type(t, sub) if sub else t, key)[k] for t in ms)[len(ms) // 2]
            mw, mp, mr = med('wind_speed_ms'), med('active_power_kw'), med('rotor_speed_rpm', 'rotor')
            wmed.append(mw)
            wr.append(own_w[k] / mw if mw else None)
            pr.append(own_p[k] / mp if mp > 50 else None)
            rr.append(own_r[k] / mr if mr else None)
        return dict(mates=mates, wr=wr, pr=pr, rr=rr, wmed=wmed, own_w=own_w, own_p=own_p)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ratios(pack, aid)
        lo, hi = p['power_band']
        bad = [w is not None and pw is not None and w < p['low_ratio'] and lo <= pw <= hi for w, pw in zip(c['wr'], c['pr'])]
        for i in range(pack.n):
            s = B.sustained_since(bad, i)
            if s is not None and pack.minutes_between(s, i) >= p['sustain_min']:
                low = [w is not None and w < p['clear_ratio'] for w in c['wr']]
                e = i
                while e + 1 < pack.n and low[e + 1]:
                    e += 1
                c.update(start=s, end=e)
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        tid, tname = f.aid, pack.name(f.aid)
        s, e = c['start'], c['end']
        wr, pr, rr, wmed, own_w, own_p = c['wr'], c['pr'], c['rr'], c['wmed'], c['own_w'], c['own_p']
        worst = min(range(s, e + 1), key=lambda k: wr[k])
        perf = pack.series(tid, 'power_curve_perf_pct')
        amb, rh = ambient(pack), pack.series(met(pack), 'relative_humidity_pct')
        rotor_dev = max(abs(rr[k] - 1) for k in range(s, e + 1) if rr[k] is not None) * 100
        perf_hi = min(perf[k] for k in range(s, e + 1))
        icy = [amb[k] < p['icing_temp_c'] and rh[k] >= p['icing_rh_pct'] for k in range(s, e + 1)]
        icing = icy[0] and sum(icy) >= 0.75 * len(icy)
        rec = next((k for k in range(e + 1, pack.n) if wr[k] is not None and abs(wr[k] - 1) < 0.1), None)
        level = 'high' if rec is not None else 'medium'
        mates = c['mates']
        mw_lo = [min((pack.series(t, 'wind_speed_ms')[k] for t in mates if running(pack, t)[k]), default=None) for k in range(pack.n)]
        mw_hi = [max((pack.series(t, 'wind_speed_ms')[k] for t in mates if running(pack, t)[k]), default=None) for k in range(pack.n)]
        pct = lambda v: None if v is None else 100 * v
        feeder = pack.name(pack.parent(tid))
        win = [ts[max(0, s - 6)], ts[min(now, (rec or e) + 6)]]
        met_w = pack.series(met(pack), 'met_wind_speed_ms')

        checks = [
            check('low', 'Its wind reading disagrees with its neighbours', 'required', MATCH,
                  f'{num(own_w[worst])} m/s at {ts[worst]}, against {num(wmed[worst])} m/s on the other {feeder} '
                  f'turbines ({signed(100 * (wr[worst] - 1), 0)} %). Low from {ts[s]} to {ts[e]}.',
                  'One reading out of line with every neighbour is either a local weather effect or a bad sensor.',
                  spark([pct(v) for v in wr], [30, 130], threshold_value=100 * p['low_ratio'], window=win)),
            check('power', 'Its power agrees with its neighbours', 'required', MATCH,
                  f'{num(own_p[worst], 0)} kW at {ts[worst]}, {signed(100 * (pr[worst] - 1), 0)} % against the neighbours\' median.',
                  'If the wind really were that low, the turbine couldn\'t make this much power.',
                  spark([pct(v) for v in pr], [30, 130], window=win)),
            check('rotor', 'Rotor speed agrees too', 'supporting', MATCH if rotor_dev < p['rotor_band_pct'] else NO_MATCH,
                  f'Within {num(rotor_dev, 0)} % of the neighbours throughout.',
                  'A second physical measurement of the same wind, from a different sensor.',
                  spark([pct(v) for v in rr], [30, 130], window=win)),
            check('perf', 'Its performance figure looks impossible', 'supporting', MATCH if perf_hi > 120 else NO_MATCH,
                  f'Power-curve performance, computed from its own wind reading, sat at {num(perf_hi, 0)} % or more.',
                  'A turbine can\'t beat its power curve by 30 %. The input to that calculation is wrong.',
                  spark(perf, [0, 135], window=win)),
            check('icing', 'Icing weather at the time', 'supporting', MATCH if icing else NO_MATCH,
                  f'Ambient {num(min(amb[s:e + 1]))} to {num(max(amb[s:e + 1]))} °C, humidity '
                  f'{num(min(rh[s:e + 1]), 0)}–{num(max(rh[s:e + 1]), 0)} % while it read low.',
                  'Freezing fog ices unheated cups and vanes — the usual reason a nacelle anemometer reads low.',
                  spark(amb, [-8, 4], threshold_value=0, window=win)),
            check('recovered', 'Reading recovered after the heater reset', 'supporting', MATCH if rec is not None else PENDING,
                  f'Back within 10 % of the neighbours at {ts[rec]}.' if rec is not None else 'Still reading low.',
                  'Fixing the sensor fixed the reading, and nothing else changed.',
                  spark([pct(v) for v in wr], [30, 130], highlight=[ts[e], ts[rec]] if rec else None, window=win)),
        ]
        main = chart('m/s', nice_domain(own_w[s - 6:(rec or e) + 6], mw_hi[s - 6:(rec or e) + 6], floor=0),
                     [series('own', f'{tname} nacelle wind', own_w, 'primary', 1),
                      series('mates', f'Other {feeder} turbines (median)', wmed, 'expected', 1)],
                     title='What we see',
                     caption=f'{tname}\'s own wind reading against the other {feeder} turbines. The shaded band is their range.',
                     band=band(f'Other {feeder} turbines', mw_lo, mw_hi),
                     markers=[marker(ts[s], 'Reading drops')] + ([marker(ts[rec], 'Back in line')] if rec else []),
                     window=win)
        grid = hours_grid(4, 1 / 6, -0.5)
        r = Rng(404)
        ice_w = [(100 if h < 0 else 58 + 8 * (h > 2)) + r.gauss(4) for h in grid]
        ice_p = [100 + r.gauss(5) for h in grid]
        brg_w = [(100 - max(0, h) * 7) + r.gauss(3) for h in grid]
        brg_p = [100 + r.gauss(5) for h in grid]
        lull_w = [(100 if h < 0 else 60) + r.gauss(4) for h in grid]
        lull_p = [(100 if h < 0 else 25) + r.gauss(4) for h in grid]
        lw = aligned([pct(v) for v in wr], s, pack.step_min, grid)
        lp = aligned([pct(v) for v in pr], s, pack.step_min, grid)
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Wind reading (% of neighbours)', '%', [0, 130], grid, 'h', a, lw, live, 0),
                    ref_chart('Power (% of neighbours)', '%', [0, 130], grid, 'h', b, lp, live, 0)]
        refs = [
            reference('iced', 'textbook', 'Textbook', 'Iced anemometer',
                      'The cups ice up in freezing fog and read 30–50 % low. Power and rotor speed carry on as normal.',
                      'match', 'Closest match', ['Wind reading drops, power doesn\'t', 'Freezing fog at the time'],
                      pair(ice_w, ice_p)),
            reference('bearing', 'variant', 'Variant', 'Worn anemometer bearing',
                      'The reading drifts low over days as the bearing drags. Same "power disagrees" signature, slower.',
                      'partial', 'Same signature, slower', ['Drop here is gradual, not a step',
                                                           'Replace the sensor rather than reset the heater'],
                      pair(brg_w, brg_p)),
            reference('lull', 'lookalike', 'Look-alike', 'Real local lull (wake)',
                      'A neighbour\'s wake really slows the wind at this turbine. Power falls with the reading.',
                      'nomatch', 'Doesn\'t match', [f'Power fell here; on {tname} it didn\'t',
                                                    'A wake depends on wind direction, not on icing weather'],
                      pair(lull_w, lull_p)),
        ]
        ro = [
            ruled_out('Genuinely low wind at this turbine', 'ruled out',
                      f'Power and rotor speed matched the neighbours, and the met mast read {num(met_w[worst])} m/s at {ts[worst]}.'),
            ruled_out('A turbine performance problem', 'ruled out',
                      'Output was normal for the wind the neighbours saw. The high performance figure comes from the bad reading.'),
            ruled_out('A wake from a neighbour', 'unlikely',
                      'A wake lowers power as well as the wind reading. Here power didn\'t drop.'),
        ]
        return {
            'conclusion': conclusion('Cause' if level == 'high' else 'Most likely cause',
                                     'Iced nacelle anemometer — the instrument was wrong, the turbine was fine'
                                     if icing else 'Faulty nacelle anemometer — the instrument is wrong, the turbine is fine',
                                     level, 'Confirmed: the reading recovered once the heater was reset' if rec is not None
                                     else 'Power and rotor speed contradict the reading'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'Two independent physical measurements, power and rotor speed, say the wind was normal.',
                                     None if level == 'high' else 'The sensor hasn\'t been reset or inspected yet.',
                                     None if level == 'high' else 'Resetting the anemometer heater brings the reading back in line.',
                                     'Power falls to match the reading. Then the wind really is lower at this turbine.',
                                     'Reading recovered after the heater reset' if level == 'high' else None),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 5. Converter trip after condensation — archetype 11 (hard block / trip)
# ═════════════════════════════════════════════════════════════════════════
class ConverterCondensationTrip(Detector):
    id = 'wind.converter_condensation_trip'
    name = 'Converter trip from condensation'
    archetype = '11 Hard block'
    applies_to = 'converters'
    summary = ('A turbine drops out on its own (its feeder stays up) with the converter cabinet unusually humid '
               'and the converter itself not hot: moisture, not heat, caused the trip.')
    pipeline = [
        ('Trip', 'the turbine goes from producing to zero in one interval while its feeder neighbours keep running'),
        ('Before the trip', 'cabinet humidity in the hour before, against every other converter on site'),
        ('Rule out heat', 'converter temperature at the trip against the fleet'),
        ('Context', 'hours of cold, low-load running beforehand — when condensation forms'),
        ('Conclusion', 'humid and not hot → condensation; confirmation needs an inspection'),
    ]
    definition = {
        'appliesTo': {'assetType': 'converter'},
        'inputs': {'humidity': 'self.cabinet_humidity_pct', 'temp': 'self.converter_temp_c',
                   'power': 'unit.active_power_kw', 'neighbours': 'unit siblings on the same feeder',
                   'ambient': 'met_mast.ambient_temp_c'},
        'params': {'min_before_kw': 300, 'humid_pct': 65, 'humid_window_min': 60, 'hot_margin_c': 2.0,
                   'low_load_frac': 0.4, 'context_window_h': 6},
        'checks': [
            {'id': 'trip', 'role': 'required', 'rule': 'unit power > min_before_kw, then ≈ 0, neighbours still producing'},
            {'id': 'humid', 'role': 'required', 'rule': 'max(humidity, humid_window_min before) > humid_pct'},
            {'id': 'cool', 'role': 'required', 'rule': 'temp at trip ≤ peerMax(temp) + hot_margin_c'},
            {'id': 'context', 'role': 'supporting', 'rule': 'ambient < 0 °C and load < low_load_frac for most of context_window_h'},
            {'id': 'outlier', 'role': 'supporting', 'rule': 'humidity above every other converter for the hours before'},
            {'id': 'restart', 'role': 'supporting', 'rule': 'restarted with humidity falling'},
            {'id': 'inspect', 'role': 'supporting', 'independent': True, 'rule': 'moisture tracking found on inspection'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'moisture confirmed on inspection'},
    }

    def candidates(self, pack):
        return pack.of_type('converter')

    def evaluate(self, pack, aid):
        p = self.p
        tid = pack.unit_of(aid)
        pw = pack.series(tid, 'active_power_kw')
        hum = pack.series(aid, 'cabinet_humidity_pct')
        temp = pack.series(aid, 'converter_temp_c')
        mates = [t for t in pack.children[pack.parent(tid)] if t != tid and pack.asset(t)['assetType'] in TURBINE_TYPES]
        convs = [c for c in pack.of_type('converter') if c != aid]
        w = pack.steps(p['humid_window_min'])
        for i in range(1, pack.n):
            if not (pw[i - 1] > p['min_before_kw'] and pw[i] < 1):
                continue
            if sum(1 for t in mates if pack.series(t, 'active_power_kw')[i] > 50) < max(1, len(mates) // 2):
                continue                                       # the feeder went down — not this detector's case
            if max(hum[max(0, i - w):i]) <= p['humid_pct']:
                continue
            peer_t = [pack.series(c, 'converter_temp_c')[i - 1] for c in convs if pack.series(pack.unit_of(c), 'active_power_kw')[i - 1] > 50]
            if temp[i - 1] > max(peer_t) + p['hot_margin_c']:
                continue
            return Finding(aid, True, i, trip=i, tid=tid, pw=pw, hum=hum, temp=temp, convs=convs)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, tid, i = f.aid, c['tid'], c['trip']
        tname = pack.name(tid)
        pw, hum, temp, convs = c['pw'], c['hum'], c['temp'], c['convs']
        run = [pack.series(pack.unit_of(x), 'active_power_kw') for x in convs]
        h_lo, h_hi, t_lo, t_hi = [], [], [], []
        for k in range(pack.n):
            hv = [pack.series(x, 'cabinet_humidity_pct')[k] for x, r in zip(convs, run) if r[k] > 50]
            tv = [pack.series(x, 'converter_temp_c')[k] for x, r in zip(convs, run) if r[k] > 50]
            h_lo.append(min(hv) if hv else None); h_hi.append(max(hv) if hv else None)
            t_lo.append(min(tv) if tv else None); t_hi.append(max(tv) if tv else None)
        w = pack.steps(p['humid_window_min'])
        hmax = max(hum[max(0, i - w):i])
        rated = pack.values[tid].get('rated_power_kw', max(pw))
        cw = pack.steps(p['context_window_h'] * 60)
        amb = ambient(pack)
        cold_low = sum(1 for k in range(max(0, i - cw), i) if amb[k] < 0 and pw[k] < p['low_load_frac'] * rated)
        context_ok = cold_low >= 0.5 * min(cw, i)
        above = [k for k in range(i) if h_hi[k] is not None and hum[k] > h_hi[k]]
        out_since = B.sustained_since([k in set(above) for k in range(i)], i - 1)
        back = next((k for k in range(i + 1, pack.n) if pw[k] > 50), None)
        falling = back is not None and hum[now] < hum[i]
        rh_at_restart = hum[back] if back is not None else None
        level = 'medium'
        win = [ts[max(0, i - 48)], ts[now]]

        checks = [
            check('trip', 'Tripped on its own', 'required', MATCH,
                  f'{num(pw[i - 1], 0)} kW at {ts[i - 1]}, 0 kW at {ts[i]}. The rest of its feeder kept producing.',
                  'A trip on one turbine, with its neighbours unaffected, starts inside that turbine.',
                  spark(pw, [0, rated * 1.1], window=[ts[i - 12], ts[now]])),
            check('humid', 'Cabinet humid before the trip', 'required', MATCH,
                  f'Humidity reached {num(hmax, 0)} % in the hour before. Other converters: '
                  f'{num(h_lo[i - 1], 0)}–{num(h_hi[i - 1], 0)} %.',
                  'Above about 65 %, moisture can condense on cold power electronics and track across them.',
                  spark(hum, [20, 100], h_lo, h_hi, p['humid_pct'], window=win)),
            check('cool', 'The converter wasn\'t hot', 'required', MATCH,
                  f'{num(temp[i - 1])} °C just before the trip. Other converters: {num(t_lo[i - 1])}–{num(t_hi[i - 1])} °C.',
                  'Rules out the usual thermal causes: overload, cooling failure, a failing module running hot.',
                  spark(temp, [20, 70], t_lo, t_hi, window=win)),
            check('context', 'A cold, low-load morning first', 'supporting', MATCH if context_ok else NO_MATCH,
                  f'{dur(cold_low * pack.step_min)} of the {p["context_window_h"]} h before the trip were below 0 °C '
                  f'at under {num(100 * p["low_load_frac"], 0)} % load.',
                  'At low load the converter makes little heat, so a cold cabinet cools below the dew point. '
                  'The trip then comes as load ramps up.',
                  spark(pw, [0, rated * 1.1], window=[ts[max(0, i - cw)], ts[i]])),
            check('outlier', 'More humid than every other converter', 'supporting', MATCH if out_since is not None else NO_MATCH,
                  f'Above the rest of the fleet continuously from {ts[out_since]} to the trip.' if out_since is not None
                  else 'Not consistently above the fleet.',
                  'The weather was the same for every turbine. Something local — a heater or a seal — let this one get damp.',
                  spark(hum, [20, 100], h_lo, h_hi, window=[ts[0], ts[i]])),
            check('restart', 'Restarted, humidity falling', 'supporting', MATCH if falling else PENDING,
                  f'Back at {ts[back]} after the cabinet heaters ran; humidity {num(rh_at_restart, 0)} % then, '
                  f'{num(hum[now], 0)} % now.' if falling else 'Not restarted yet.',
                  'Drying the cabinet let it run again. That fits condensation, though it doesn\'t prove it.',
                  spark(hum, [20, 100], threshold_value=p['humid_pct'], highlight=[ts[i], ts[now]], window=win)),
            check('inspect', 'Moisture found on the phase module', 'supporting', PENDING,
                  'Not inspected yet.',
                  'Only a look inside the cabinet (tracking marks, corrosion) confirms condensation.', None),
        ]
        main = chart('%', [20, 100],
                     [series('hum', f'{tname} cabinet humidity', hum, 'primary', 0)],
                     title='What we see',
                     caption='Converter cabinet humidity against every other converter on site (shaded).',
                     band=band('Other converters', h_lo, h_hi), thresholds=[threshold(p['humid_pct'], 'Risk')],
                     markers=[marker(ts[i], 'Trip')] + ([marker(ts[back], 'Restart')] if back else []))
        grid = hours_grid(2, 1 / 6, -8)
        r = Rng(505)
        tb_h = [min(95, 50 + 3.0 * (h + 8)) + r.gauss(1.5) if h < 0 else 72 - 12 * h + r.gauss(1.5) for h in grid]
        tb_t = [36 + 1.2 * max(0, h + 2) + r.gauss(0.6) if h < 0 else 30 + 5 * h + r.gauss(0.6) for h in grid]
        th_h = [42 + r.gauss(1.5) for h in grid]
        th_t = [48 + 3.0 * (h + 8) + r.gauss(0.6) if h < 0 else 50 - 8 * h + r.gauss(0.6) for h in grid]
        ok_h = [min(80, 50 + 3.0 * (h + 8)) - (12 * max(0, h + 3)) + r.gauss(1.5) for h in grid]
        ok_t = [36 + 1.0 * max(0, h + 3) + r.gauss(0.6) for h in grid]
        lh = aligned(hum, i, pack.step_min, grid)
        lt = aligned(temp, i, pack.step_min, grid)
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Cabinet humidity', '%', [20, 100], grid, 'h', a, lh, live, 0),
                    ref_chart('Converter temperature', '°C', [20, 80], grid, 'h', b, lt, live)]
        refs = [
            reference('condensation', 'textbook', 'Textbook', 'Condensation trip',
                      'Humidity creeps up through a cold, quiet night. The converter trips as load ramps up, running cool.',
                      'match', 'Closest match', ['Humid and cool at the trip', 'Came back once the heaters dried it out'],
                      pair(tb_h, tb_t)),
            reference('caught', 'early', 'Early stage', 'Heaters caught it',
                      'Same humid night, but the cabinet heater brought humidity down before load came back. No trip.',
                      'partial', 'Same conditions, no trip', ['What a correctly set heater looks like',
                                                              'Check the heater thermostat on ' + tname],
                      pair(ok_h, ok_t)),
            reference('thermal', 'lookalike', 'Look-alike', 'Thermal trip',
                      'A blocked cooling path or failing module runs hot and trips on temperature. Humidity is normal.',
                      'nomatch', 'Doesn\'t match', [f'Hot converter here; {tname}\'s was cool', 'Humidity normal here'],
                      pair(th_h, th_t)),
        ]
        ro = [
            ruled_out('Overheating', 'ruled out', f'Converter temperature was {num(temp[i - 1])} °C, inside the fleet range.'),
            ruled_out('A grid or feeder event', 'ruled out', 'The other turbines on the feeder kept producing through the trip.'),
            ruled_out('A failed phase module', 'not yet checked',
                      'The turbine restarted and is running, which a dead module wouldn\'t allow. Moisture damage can still '
                      'weaken it, so it needs a look at the next visit.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'Condensation in the converter cabinet tripped the phase module',
                                     level, 'Humid and cool at the trip; not inspected yet'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The cabinet was humid, the converter was cool, and it tripped on a load ramp after a cold, '
                                     'low-load morning — the pattern field studies link to condensation.',
                                     'Nobody has looked inside the cabinet yet.',
                                     'The inspection finds moisture tracking or corrosion on the phase module.',
                                     'The module is clean and dry. Then look at the module\'s own health and the trip log.'),
            'action': action(item, pack),
        }


# ═════════════════════════════════════════════════════════════════════════
# 6. Weak pitch battery — archetype 12 (recurring micro-events)
# ═════════════════════════════════════════════════════════════════════════
class PitchBatteryWeak(Detector):
    id = 'wind.pitch_battery_weak'
    name = 'Pitch backup battery failing'
    archetype = '12 Recurring micro-events'
    applies_to = 'pitch systems'
    summary = ('Short safety stops, each with the blades moving toward feather, repeating on one turbine while its '
               'pitch backup battery voltage sits below the fleet and keeps falling.')
    pipeline = [
        ('Find the stops', 'intervals where output falls by half against the intervals either side, with the blades '
                           'pitched toward feather and the wind steady'),
        ('Count them', 'how many in the last 3 hours, and whether they are getting closer together'),
        ('Battery', 'backup battery voltage against every other pitch system on site'),
        ('Rule out', 'grid events (other turbines didn\'t stop), gusts, pitch motor faults'),
        ('Conclusion', 'repeated battery-test stops → the pack can\'t guarantee a feather on grid loss'),
    ]
    definition = {
        'appliesTo': {'assetType': 'pitch_system'},
        'inputs': {'battery': 'self.pitch_battery_voltage_v', 'motor': 'self.pitch_motor_current_a',
                   'power': 'unit.active_power_kw', 'pitch': 'parent[rotor].blade_pitch_angle_deg',
                   'wind': 'met_mast.met_wind_speed_ms'},
        'params': {'drop_frac': 0.5, 'feather_deg': 30, 'window_min': 180, 'min_stops': 3,
                   'low_v': 215, 'below_fleet_v': 10, 'nominal_v': 238},
        'checks': [
            {'id': 'stops', 'role': 'required', 'rule': '≥ min_stops stops in window_min (output < drop_frac × neighbours in time, pitch > feather_deg)'},
            {'id': 'battery', 'role': 'required', 'rule': 'battery < low_v and < peerMin(battery) − below_fleet_v'},
            {'id': 'falling', 'role': 'supporting', 'rule': 'battery slope over 6 h < 0'},
            {'id': 'closer', 'role': 'supporting', 'rule': 'gaps between stops shrinking'},
            {'id': 'isolated', 'role': 'supporting', 'independent': True, 'rule': 'no other turbine stopped in the same intervals'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'every stop lines up with a feathering and the battery is below the test limit'},
    }

    def candidates(self, pack):
        return pack.of_type('pitch_system')

    def _stops(self, pack, aid):
        p = self.p
        rotor = pack.parent(aid)
        tid = pack.unit_of(aid)
        pw = pack.series(tid, 'active_power_kw')
        pitch = pack.series(rotor, 'blade_pitch_angle_deg')
        out = []
        for k in range(1, pack.n):
            nb = [pw[k - 1]] + ([pw[k + 1]] if k + 1 < pack.n else [])
            ref = sum(nb) / len(nb)
            if ref > 300 and pw[k] < p['drop_frac'] * ref and pw[k] > 0 and pitch[k] > p['feather_deg']:
                out.append(k)
        return out, pw, pitch, tid

    def evaluate(self, pack, aid):
        p = self.p
        stops, pw, pitch, tid = self._stops(pack, aid)
        batt = pack.series(aid, 'pitch_battery_voltage_v')
        peers = [x for x in pack.of_type('pitch_system') if x != aid]
        w = pack.steps(p['window_min'])
        for i in range(pack.n):
            recent = [k for k in stops if i - w < k <= i]
            if len(recent) < p['min_stops']:
                continue
            fleet_min = min(pack.series(x, 'pitch_battery_voltage_v')[i] for x in peers)
            if batt[i] < p['low_v'] and batt[i] < fleet_min - p['below_fleet_v']:
                return Finding(aid, True, i, stops=stops, pw=pw, pitch=pitch, tid=tid, batt=batt, peers=peers)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid, tid = f.aid, c['tid']
        tname = pack.name(tid)
        stops, pw, batt, peers = c['stops'], c['pw'], c['batt'], c['peers']
        b_lo, _, b_hi = B.peer_stats(pack, peers, 'pitch_battery_voltage_v')
        gaps = [pack.minutes_between(a, b) for a, b in zip(stops, stops[1:])]
        closer = len(gaps) >= 2 and all(b < a for a, b in zip(gaps, gaps[1:]))
        slope = B.slope_per_hour(batt, now, pack.steps(360), pack.step_min)
        others = [t for t in pack.of_type(*TURBINE_TYPES) if t != tid]
        coincide = []
        for k in stops:
            for t in others:
                q = pack.series(t, 'active_power_kw')
                if k + 1 < pack.n and q[k - 1] > 300 and q[k] < 0.5 * (q[k - 1] + q[k + 1]) / 2:
                    coincide.append((k, t))
        motor = pack.series(aid, 'pitch_motor_current_a')
        quiet = [k for k in range(stops[0], now + 1) if k not in stops and k - 1 not in stops]
        quiet_motor = B.mean([motor[k] for k in quiet])
        peer_motor = [B.mean([pack.series(x, 'pitch_motor_current_a')[k] for k in quiet]) for x in peers
                      if all(running(pack, pack.unit_of(x))[k] for k in quiet)]
        wind = pack.series(met(pack), 'met_wind_speed_ms')
        rated = pack.values[tid].get('rated_power_kw', max(pw))
        level = 'high' if (not coincide and batt[now] < p['low_v']) else 'medium'
        stop_times = [ts[k] for k in stops]
        first = stops[0]
        loss_kwh = sum((pw[k - 1] - pw[k]) for k in stops) * pack.step_min / 60

        checks = [
            check('stops', f'{len(stops)} safety stops since {ts[first]}', 'required', MATCH,
                  f'At {join_names(stop_times)}. Each cut that interval\'s output by about '
                  f'{num(100 * B.mean([1 - pw[k] / pw[k - 1] for k in stops]), 0)} %, with the blades pitched to '
                  f'{num(B.mean([c["pitch"][k] for k in stops]), 0)}° and the wind steady.',
                  'A pitch system tests its backup battery and feathers the blades when the test fails. Each one is small; '
                  'together they are a pattern.',
                  spark(pw, [0, rated * 1.1], highlight=[ts[first - 1], ts[now]], window=[ts[max(0, first - 18)], ts[now]])),
            check('battery', 'Backup battery below the fleet and the test limit', 'required', MATCH,
                  f'{num(batt[now])} V now (nominal about {p["nominal_v"]} V). Every other pitch system: '
                  f'{num(b_lo[now])}–{num(b_hi[now])} V.',
                  'The backup battery is what feathers the blades if the grid is lost. Below the limit, it may not be able to.',
                  spark(batt, [195, 245], b_lo, b_hi, p['low_v'])),
            check('falling', 'Voltage still falling', 'supporting', MATCH if (slope or 0) < 0 else NO_MATCH,
                  f'{signed(slope)} V per hour over the last 6 h; {num(batt[0])} V at {ts[0]}.',
                  'A pack that is losing capacity sags further as the cold soaks in. It won\'t recover on its own.',
                  spark(batt, [195, 245], b_lo, b_hi)),
            check('closer', 'Stops coming closer together', 'supporting', MATCH if closer else NO_MATCH,
                  f'{join_names([dur(g) for g in gaps])} apart.' if gaps else 'Only one stop so far.',
                  'Each test is failing sooner. The next step is a stop that doesn\'t restart, or a feather that doesn\'t happen.',
                  None),
            check('isolated', 'No other turbine stopped at those times', 'supporting', MATCH if not coincide else NO_MATCH,
                  f'The other {len(others)} turbines kept producing through all {len(stops)} stops.' if not coincide
                  else f'{len(coincide)} other turbines dipped at the same time.',
                  'A grid disturbance would stop many turbines at once. This is one machine.', None),
        ]
        main = chart('V', [195, 245],
                     [series('batt', f'{tname} pitch battery', batt, 'primary', 1)],
                     title='What we see',
                     caption='Pitch backup battery voltage against every other pitch system on site (shaded). '
                             'Markers are the safety stops.',
                     band=band('Other pitch systems', b_lo, b_hi), thresholds=[threshold(p['low_v'], 'Test limit')],
                     markers=[marker(ts[k], f'Stop {n + 1}') for n, k in enumerate(stops)])
        grid = hours_grid(3, 1 / 6, -9)
        r = Rng(606)
        stop_at = lambda h, times: any(abs(h - t) < 1 / 12 for t in times)
        tb_v = [233 - 2.8 * (h + 9) + r.gauss(0.4) for h in grid]
        tb_s = [-1.0, 0.0, 0.83, 1.5, 2.0]
        tb_p = [(35 if stop_at(h, tb_s) else 100) + r.gauss(2) for h in grid]
        ea_v = [231 - 0.8 * (h + 9) + r.gauss(0.4) for h in grid]
        ea_p = [100 + r.gauss(2) for h in grid]
        gr_v = [238 + r.gauss(0.6) for h in grid]
        gr_p = [(20 if stop_at(h, [-5.0, -1.5]) else 100) + r.gauss(2) for h in grid]
        lv = aligned(batt, first, pack.step_min, grid)
        rel = aligned([100 * pw[k] / max(1, max(pw[k - 1:k + 2])) if 0 < k < now else 100 for k in range(pack.n)],
                      first, pack.step_min, grid)
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Battery voltage (hours from the first stop)', 'V', [195, 245], grid, 'h', a, lv, live, 0, [threshold(p['low_v'], 'Limit')]),
                    ref_chart('Output (% of the intervals either side)', '%', [0, 120], grid, 'h', b, rel, live, 0)]
        refs = [
            reference('eol', 'textbook', 'Textbook', 'End-of-life pack in the cold',
                      'Voltage sags below the test limit; battery tests fail and stop the turbine, closer and closer together.',
                      'match', 'Closest match', ['Voltage under the limit and falling', 'Stops getting more frequent'],
                      pair(tb_v, tb_p)),
            reference('ageing', 'early', 'Early stage', 'Ageing pack, no stops yet',
                      'Voltage below the fleet and drifting down, but still above the limit. Nothing trips yet.',
                      'partial', f'Where {tname} was this morning', ['The time to plan a pack swap',
                                                                     'Worth checking other packs of the same age'],
                      pair(ea_v, ea_p)),
            reference('grid', 'lookalike', 'Look-alike', 'Grid voltage dips',
                      'Short stops caused by the grid. Many turbines stop at once, and batteries are normal.',
                      'nomatch', 'Doesn\'t match', ['Batteries healthy here', f'Only {tname} stopped today'],
                      pair(gr_v, gr_p)),
        ]
        ro = [
            ruled_out('Grid disturbances', 'ruled out', 'No other turbine stopped in the same intervals.'),
            ruled_out('Gusts or high-wind stops', 'ruled out',
                      f'Wind at the met mast was {num(min(wind[k] for k in stops))}–{num(max(wind[k] for k in stops))} m/s '
                      f'at the stops, far below cut-out.'),
            ruled_out('A pitch motor fault', 'unlikely',
                      f'Between stops the pitch motor drew {num(quiet_motor)} A on average; the other pitch systems drew '
                      f'{num(min(peer_motor))}–{num(max(peer_motor))} A over the same time. The drive works; the battery is the problem.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'Pitch backup battery pack at end of life', level,
                                     'Low voltage and repeated battery-test stops agree'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The battery is below the test limit and every stop is a feathering on this turbine alone.',
                                     None if level == 'high' else 'Another turbine dipped at the same time as a stop.',
                                     None, 'A new pack still fails the test. Then check the charger and wiring.'),
            'action': action(item, pack),
            'impact': f'About {num(loss_kwh, 0)} kWh lost to stops so far today; the bigger risk is safety, not energy.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 7. Static yaw misalignment — archetype 08 (throughput illusion)
# ═════════════════════════════════════════════════════════════════════════
class StaticYawMisalignment(Detector):
    id = 'wind.static_yaw_misalignment'
    name = 'Static yaw misalignment'
    archetype = '08 Throughput illusion'
    applies_to = 'turbines'
    summary = ('A turbine that never stops but steadily makes a few percent less than its neighbours, pointed a '
               'fixed angle off the wind that its own vane can\'t see.')
    pipeline = [
        ('Neighbours', 'the other turbines on the same feeder that are producing'),
        ('Performance gap', '6-hour average power-curve performance against the neighbours\' median'),
        ('Pointing', 'nacelle direction against the met-mast wind direction, averaged over the same 6 hours'),
        ('Checks', 'gap · always available · fixed offset · vane says 0° · cos-law size'),
        ('Conclusion', 'a steady offset the controller can\'t see explains the loss'),
    ]
    definition = {
        'appliesTo': {'assetType': list(TURBINE_TYPES)},
        'inputs': {'perf': 'self.power_curve_perf_pct', 'nacelle': 'child[yaw_system].nacelle_direction_deg',
                   'yawError': 'child[yaw_system].yaw_error_deg', 'windDir': 'met_mast.wind_direction_deg',
                   'neighbours': 'siblings (same feeder, producing)'},
        'params': {'window_h': 6, 'gap_pts': 3.0, 'offset_deg': 6.0, 'max_offset_sd_deg': 4.0,
                   'vane_ok_deg': 2.0, 'cos_exponent': 2.5},
        'checks': [
            {'id': 'gap', 'role': 'required', 'rule': 'mean(perf, window_h) < neighbourMedian − gap_pts'},
            {'id': 'available', 'role': 'required', 'rule': 'producing through the whole window'},
            {'id': 'offset', 'role': 'required', 'rule': '|mean(nacelle − windDir)| > offset_deg and sd < max_offset_sd_deg'},
            {'id': 'vane', 'role': 'supporting', 'rule': '|mean(yawError)| < vane_ok_deg'},
            {'id': 'size', 'role': 'supporting', 'independent': True, 'rule': 'gap ≈ 1 − cos^cos_exponent(offset)'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'vane alignment checked on site'},
    }

    def candidates(self, pack):
        return pack.of_type(*TURBINE_TYPES)

    def _ctx(self, pack, tid):
        p = self.p
        w = pack.steps(p['window_h'] * 60)
        mates = [t for t in pack.children[pack.parent(tid)] if t != tid and pack.asset(t)['assetType'] in TURBINE_TYPES]
        run = running(pack, tid)
        perf = B.mask_values(pack.series(tid, 'power_curve_perf_pct'), run)
        mruns = {t: running(pack, t) for t in mates}
        # A point under 70 % is a stop or a trip, not a performance level — it doesn't count.
        mperf = {t: [v if (r and v >= 70) else None for v, r in zip(pack.series(t, 'power_curve_perf_pct'), mruns[t])]
                 for t in mates}
        med = []
        for k in range(pack.n):
            vals = [mperf[t][k] for t in mates if mperf[t][k] is not None]
            med.append(sorted(vals)[len(vals) // 2] if len(vals) >= 3 else None)
        own_r, med_r = B.rolling_mean(perf, w), B.rolling_mean(med, w)
        yaw = pack.child_of_type(tid, 'yaw_system')
        wd = pack.series(met(pack), 'wind_direction_deg')
        off = [B.angle_diff(n, d) for n, d in zip(pack.series(yaw, 'nacelle_direction_deg'), wd)]
        err = pack.series(yaw, 'yaw_error_deg')
        return dict(w=w, mates=mates, run=run, perf=perf, med=med, own_r=own_r, med_r=med_r, off=off, err=err, yaw=yaw,
                    mperf=mperf)

    def evaluate(self, pack, aid):
        p = self.p
        c = self._ctx(pack, aid)
        w = c['w']
        for i in range(w - 1, pack.n):
            if not all(c['run'][i - w + 1:i + 1]):
                continue
            gap = c['own_r'][i] - c['med_r'][i] if c['med_r'][i] is not None else None
            offs = c['off'][i - w + 1:i + 1]
            if gap is not None and gap < -p['gap_pts'] and abs(B.mean(offs)) > p['offset_deg'] \
                    and B.stdev(offs) < p['max_offset_sd_deg']:
                return Finding(aid, True, i, **c)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        tid, tname = f.aid, pack.name(f.aid)
        w, i0 = c['w'], f.at
        feeder = pack.name(pack.parent(tid))
        gap_now = c['own_r'][now] - c['med_r'][now]
        day_gap = B.mean(c['perf']) - B.mean(c['med'])
        off_mean = B.mean(c['off'])
        off_sd = B.stdev(c['off'])
        err_mean = B.mean(c['err'])
        predicted = 100 * B.cos_loss(abs(off_mean), p['cos_exponent'])
        size_ok = abs(predicted - abs(day_gap)) < 2.0
        avail = pack.series(tid, 'availability_pct')[now]
        amb = ambient(pack)
        mates = c['mates']
        p_lo = [min((c['mperf'][t][k] for t in mates if c['mperf'][t][k] is not None), default=None) for k in range(pack.n)]
        p_hi = [max((c['mperf'][t][k] for t in mates if c['mperf'][t][k] is not None), default=None) for k in range(pack.n)]
        roll = lambda v: B.rolling_mean(v, pack.steps(60))
        own1, med1 = roll(c['perf']), roll(c['med'])
        lost_pct = abs(day_gap)
        pw = pack.series(tid, 'active_power_kw')
        lost_kwh = sum(pw) * pack.step_min / 60 * lost_pct / (100 - lost_pct)
        pitch = pack.series(pack.child_of_type(tid, 'rotor'), 'blade_pitch_angle_deg')

        checks = [
            check('gap', f'Steadily below its {feeder} neighbours', 'required', MATCH,
                  f'{num(B.mean(c["perf"]))} % of its power curve today, against {num(B.mean(c["med"]))} % for the other '
                  f'{feeder} turbines ({signed(day_gap)} points). The last 6 h: {signed(gap_now)} points.',
                  'Neighbours see nearly the same wind, so a steady gap is the turbine, not the weather.',
                  spark(own1, [85, 105], p_lo, p_hi)),
            check('available', 'Never stopped', 'required', MATCH,
                  f'Available {num(avail, 0)} % of the time today, with no fault codes.',
                  'This is why the loss hides: availability and alarms say everything is fine.',
                  None),
            check('offset', f'Pointed about {num(abs(off_mean), 0)}° off the wind', 'required', MATCH,
                  f'Nacelle direction averaged {signed(off_mean)}° from the met-mast wind direction all day '
                  f'(± {num(off_sd)}°). Its neighbours average within ±1°.',
                  'A rotor that isn\'t facing the wind catches less of it. A fixed offset like this is set up, not random.',
                  spark(c['off'], [-20, 10], threshold_value=-p['offset_deg'])),
            check('vane', 'Its own vane says it\'s aligned', 'supporting', MATCH if abs(err_mean) < p['vane_ok_deg'] else NO_MATCH,
                  f'Measured yaw error averaged {signed(err_mean)}°.',
                  'The controller steers by the vane. If the vane itself is offset, the controller can\'t see the error.',
                  spark(c['err'], [-20, 10])),
            check('size', 'The loss is the size the offset predicts', 'supporting', MATCH if size_ok else NO_MATCH,
                  f'A {num(abs(off_mean), 0)}° offset should cost about {num(predicted)} % (cos-law); '
                  f'the measured gap is {num(abs(day_gap))} points.',
                  'Two independent measurements — pointing and output — tell the same story in the same amount.',
                  None),
        ]
        main = chart('%', [80, 110],
                     [series('own', f'{tname} (1-h average)', own1, 'primary', 1),
                      series('mates', f'Other {feeder} turbines (median)', med1, 'expected', 1)],
                     title='What we see',
                     caption=f'Power-curve performance, 1-hour average, against the other {feeder} turbines (shaded: their '
                             f'10-minute range).',
                     band=band(f'Other {feeder} turbines', p_lo, p_hi), shade_gap=['mates', 'own'],
                     markers=[marker(ts[i0], 'Flagged')])
        grid = hours_grid(12, 0.5)
        r = Rng(707)
        roll_ref = lambda base, sd: [base + e for e in r.ar1(len(grid), sd, 0.7)]
        tb_g, tb_o = roll_ref(-4.8, 0.8), roll_ref(-11, 1.2)
        ea_g, ea_o = roll_ref(-1.0, 0.8), roll_ref(-4, 1.2)
        so_g, so_o = roll_ref(-4.0, 0.8), roll_ref(0, 1.2)
        gap_series = [None if a is None or b is None else a - b for a, b in zip(own1, med1)]
        lg = aligned(gap_series, 0, pack.step_min, grid)
        lo = aligned(c['off'], 0, pack.step_min, grid)
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Performance gap to neighbours', 'pts', [-10, 4], grid, 'h', a, lg, live),
                    ref_chart('Nacelle offset from the wind', '°', [-20, 10], grid, 'h', b, lo, live, 0)]
        refs = [
            reference('vane', 'textbook', 'Textbook', 'Vane offset after maintenance',
                      'A replaced or knocked vane leaves a fixed pointing error. Output sits 4–6 % low from that day on.',
                      'match', 'Closest match', ['Same steady gap', 'Same fixed offset, invisible to the vane'],
                      pair(tb_g, tb_o)),
            reference('small', 'early', 'Early stage', 'Small offset',
                      'A 4° offset costs about 1 % — lost in the noise of any single day, visible over a few weeks.',
                      'partial', 'Same cause, smaller', ['Why this is often found months later', 'Worth screening every turbine'],
                      pair(ea_g, ea_o)),
            reference('blades', 'lookalike', 'Look-alike', 'Blade soiling or erosion',
                      'Dirty or eroded leading edges cost a similar few percent, but the turbine points straight into the wind.',
                      'nomatch', 'Doesn\'t match', [f'No offset here; {tname} is {num(abs(off_mean), 0)}° off',
                                                    'Fix is a blade inspection, not a vane'], pair(so_g, so_o)),
        ]
        ro = [
            ruled_out('Blade icing', 'ruled out',
                      f'It was below freezing overnight, but the gap stayed the same after ambient rose to {num(amb[now])} °C, '
                      f'and its {feeder} neighbours weren\'t affected.'),
            ruled_out('Curtailment or a derate', 'ruled out',
                      f'No setpoint was active, and blade pitch followed the wind as normal (about {num(B.mean(pitch))}° on average).'),
            ruled_out('Blade soiling or damage', 'unlikely',
                      'It would cost output without any pointing error. The offset alone explains the size of the loss.'),
        ]
        return {
            'conclusion': conclusion('Most likely cause', 'Wind vane offset — the turbine points about '
                                     f'{num(abs(off_mean), 0)}° off the wind', 'medium',
                                     'Offset and output loss agree in size'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence('medium',
                                     'The nacelle points off the wind by a fixed angle, and the output loss is the size that '
                                     'angle predicts.',
                                     'Nobody has checked the vane on site yet, and the met mast is one reference for the whole site.',
                                     'The vane\'s north mark is found out of line with the nacelle axis.',
                                     'The vane is aligned. Then check the met-mast direction reference and the blades.'),
            'action': action(item, pack),
            'impact': f'About {num(lost_kwh / 1000, 1)} MWh lost today — about {num(lost_pct)} % of this turbine\'s output '
                      f'until the vane is corrected.',
        }


# ═════════════════════════════════════════════════════════════════════════
# 8. Blade icing — archetype 13 (output quality drifting with conditions)
# ═════════════════════════════════════════════════════════════════════════
class BladeIcing(Detector):
    id = 'wind.blade_icing'
    name = 'Blade icing'
    archetype = '13 Quality drift'
    applies_to = 'turbines'
    summary = ('Several turbines in one string lose power-curve performance together in freezing, saturated air, '
               'and recover as it warms: weather, not a machine fault.')
    pipeline = [
        ('Performance', '30-minute average power-curve performance on each producing turbine'),
        ('Weather', 'met-mast ambient temperature and humidity: icing needs both cold and moisture'),
        ('Shared', 'how many turbines on the same feeder are losing performance at the same time'),
        ('Checks', 'loss · icing weather · shared · no faults · recovery with warming'),
        ('Conclusion', 'shared, weather-timed loss → icing; one item per feeder, on the worst turbine'),
    ]
    definition = {
        'appliesTo': {'assetType': list(TURBINE_TYPES)},
        'inputs': {'perf': 'self.power_curve_perf_pct', 'ambient': 'met_mast.ambient_temp_c',
                   'humidity': 'met_mast.relative_humidity_pct', 'neighbours': 'siblings (same feeder)'},
        'params': {'avg_min': 30, 'low_pct': 90, 'sustain_min': 60, 'icing_temp_c': 0.0, 'icing_rh_pct': 90,
                   'min_shared': 3, 'recovered_pct': 95},
        'checks': [
            {'id': 'loss', 'role': 'required', 'rule': 'mean(perf, avg_min) < low_pct for sustain_min'},
            {'id': 'weather', 'role': 'required', 'rule': 'ambient < icing_temp_c and humidity > icing_rh_pct at detection'},
            {'id': 'shared', 'role': 'required', 'rule': '≥ min_shared turbines on the feeder below low_pct together'},
            {'id': 'nofault', 'role': 'supporting', 'rule': 'no stops through the episode'},
            {'id': 'others', 'role': 'supporting', 'rule': 'other feeders unaffected'},
            {'id': 'thaw', 'role': 'supporting', 'independent': True, 'rule': 'back above recovered_pct after ambient > 0 °C'},
        ],
        'confidence': {'medium': 'required checks', 'high': 'recovered with the thaw'},
    }

    def candidates(self, pack):
        return pack.of_type(*TURBINE_TYPES)

    def group(self, pack, aid):
        return pack.parent(aid)

    def _avg(self, pack, tid):
        run = running(pack, tid)
        return B.rolling_mean(B.mask_values(pack.series(tid, 'power_curve_perf_pct'), run), pack.steps(self.p['avg_min'])), run

    def evaluate(self, pack, aid):
        p = self.p
        amb, rh = ambient(pack), pack.series(met(pack), 'relative_humidity_pct')
        mates = [t for t in pack.children[pack.parent(aid)] if pack.asset(t)['assetType'] in TURBINE_TYPES]
        avgs = {t: self._avg(pack, t)[0] for t in mates}
        own = avgs[aid]
        low = B.lt(own, p['low_pct'])
        for i in range(pack.n):
            s = B.sustained_since(low, i)
            if s is None or pack.minutes_between(s, i) < p['sustain_min']:
                continue
            if not (amb[i] < p['icing_temp_c'] and rh[i] > p['icing_rh_pct']):
                continue
            shared = [t for t in mates if avgs[t][i] is not None and avgs[t][i] < p['low_pct']]
            if len(shared) >= p['min_shared']:
                return Finding(aid, True, i, avgs=avgs, mates=mates, start=s, shared=shared)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        tid, tname, i = f.aid, pack.name(f.aid), f.at
        feeder = pack.name(pack.parent(tid))
        avgs, mates = c['avgs'], c['mates']
        own = avgs[tid]
        low = B.lt(own, p['low_pct'])
        s = c['start']
        e = s
        while e + 1 < pack.n and (own[e + 1] is None or own[e + 1] < p['recovered_pct']):
            e += 1
        worst = min((k for k in range(s, e + 1) if own[k] is not None), key=lambda k: own[k])
        amb, rh = ambient(pack), pack.series(met(pack), 'relative_humidity_pct')
        thaw = next((k for k in range(s, pack.n) if amb[k] > 0), None)
        rec = e + 1 if e + 1 < pack.n else None
        thawed = rec is not None and thaw is not None and rec >= thaw - pack.steps(60)
        at_worst = {t: avgs[t][worst] for t in mates}
        shared_w = [t for t in mates if at_worst[t] is not None and at_worst[t] < p['low_pct']]
        others_w = [t for t in mates if t != tid]
        stops = sum(1 for k in range(s, (rec or now) + 1) if pack.series(tid, 'active_power_kw')[k] < 1)
        other_f = [x for x in pack.of_type('collector_feeder') if x != pack.parent(tid)]
        of_perf = []
        for x in other_f:
            for t in pack.children[x]:
                if pack.asset(t)['assetType'] in TURBINE_TYPES:
                    v = self._avg(pack, t)[0][worst]
                    if v is not None:
                        of_perf.append(v)
        of_med = sorted(of_perf)[len(of_perf) // 2]
        level = 'high' if thawed else 'medium'
        win = [ts[max(0, s - 12)], ts[min(now, (rec or now) + 12)]]

        checks = [
            check('loss', 'Output well under its power curve', 'required', MATCH,
                  f'{num(own[worst])} % of its power curve at {ts[worst]} (30-min average), under {p["low_pct"]} % from '
                  f'{ts[s]} to {ts[e]}.',
                  'Ice on the blades spoils their shape, so the same wind makes less power.',
                  spark(own, [60, 110], threshold_value=p['low_pct'], window=win)),
            check('weather', 'Icing weather', 'required', MATCH,
                  f'{num(amb[i])} °C and {num(rh[i], 0)} % humidity at the met mast when it was flagged.',
                  'Rime ice needs both: air below freezing and moisture to freeze.',
                  spark(amb, [-8, 4], threshold_value=0, window=win)),
            check('shared', f'{len(shared_w)} of {len(mates)} {feeder} turbines affected together', 'required', MATCH,
                  f'At {ts[worst]}: ' + ', '.join(f'{pack.name(t)} {num(at_worst[t], 0)} %' for t in mates if at_worst[t] is not None) + '.',
                  'A machine fault hits one turbine. A whole string losing output together is something they share — the weather.',
                  None),
            check('nofault', 'No stops, no fault codes', 'supporting', MATCH if stops == 0 else NO_MATCH,
                  f'{tname} kept running through the whole episode.' if stops == 0 else f'{stops} intervals stopped.',
                  'Icing costs output gradually. It doesn\'t trip the machine unless the controller detects heavy imbalance.',
                  None),
            check('others', 'Other feeders unaffected', 'supporting', MATCH if of_med > p['recovered_pct'] else NO_MATCH,
                  f'The other feeders\' turbines were at {num(of_med, 0)} % (median) at the same time.',
                  f'{feeder} is the exposed ridge-top string; the lower strings stayed clear.', None),
            check('thaw', 'Recovered as it warmed', 'supporting', MATCH if thawed else PENDING,
                  f'Ambient crossed 0 °C at {ts[thaw]}; {tname} was back above {p["recovered_pct"]} % by {ts[rec]}.' if thawed
                  else 'Still below freezing.',
                  'Ice sheds as the air warms. Recovery timed with the thaw is the confirmation.',
                  spark(own, [60, 110], highlight=[ts[thaw], ts[rec]] if thawed else None, window=win)),
        ]
        main = chart('%', [60, 110],
                     [series(pack.name(t), pack.name(t), avgs[t], 'peer', 1) for t in others_w] +
                     [series('own', f'{tname} (30-min average)', own, 'primary', 1)],
                     title='What we see',
                     caption=f'Power-curve performance for every {feeder} turbine. The loss starts together, deepens through '
                             f'the coldest hours and clears with the thaw.',
                     thresholds=[threshold(p['low_pct'], 'Flag')],
                     markers=[marker(ts[s], 'Loss begins')] + ([marker(ts[thaw], 'Ambient above 0 °C')] if thaw else []),
                     window=[ts[max(0, s - 18)], ts[min(now, (rec or now) + 18)]])
        grid = hours_grid(8, 0.5, -1)
        r = Rng(808)
        dip = lambda h, depth, t1, t2: 100 - (0 if h < 0 else depth * min(1, h / t1) if h < t1 else depth if h < t2
                                              else max(0, depth * (1 - (h - t2) / 1.5)))
        tb_p = [dip(h, 22, 3, 5) + r.gauss(1.5) for h in grid]
        tb_a = [-5 + 1.2 * max(0, h - 3) + r.gauss(0.2) for h in grid]
        ea_p = [dip(h, 6, 2, 5) + r.gauss(1.5) for h in grid]
        ea_a = [-2 + 0.5 * max(0, h - 3) + r.gauss(0.2) for h in grid]
        la_p = [dip(h, 18, 1, 9) + r.gauss(1.5) for h in grid]
        la_a = [6 + 0.3 * h + r.gauss(0.2) for h in grid]
        lp = aligned(own, s, pack.step_min, grid)
        la = aligned(amb, s, pack.step_min, grid)
        live = f'{tname}, today'

        def pair(a, b):
            return [ref_chart('Power-curve performance', '%', [60, 110], grid, 'h', a, lp, live, 0),
                    ref_chart('Ambient temperature', '°C', [-8, 10], grid, 'h', b, la, live, 0, [threshold(0, '0 °C')])]
        refs = [
            reference('rime', 'textbook', 'Textbook', 'Rime icing, cleared by the thaw',
                      'Freezing fog builds ice over a few hours; output falls 15–25 %, then recovers as the air goes above 0 °C.',
                      'match', 'Closest match', ['Same depth and timing', 'Recovery lined up with the thaw'], pair(tb_p, tb_a)),
            reference('light', 'early', 'Early stage', 'Light icing',
                      'A thin layer costs 5 % or so — easy to mistake for a poor wind day.',
                      'partial', 'Same cause, milder', ['The other ' + feeder + ' turbines looked like this',
                                                        'Worth an ice-throw check even at this level'], pair(ea_p, ea_a)),
            reference('fault', 'lookalike', 'Look-alike', 'One turbine\'s own fault',
                      'A pitch or yaw problem costs output on one machine, in any weather, and doesn\'t clear by itself.',
                      'nomatch', 'Doesn\'t match', ['Warm weather here', f'Here only one turbine; on {feeder} it was the whole string'],
                      pair(la_p, la_a)),
        ]
        ro = [
            ruled_out('A fault on ' + tname, 'ruled out',
                      f'{len(shared_w)} of {len(mates)} turbines on {feeder} lost output together, with no stops or fault codes.'),
            ruled_out('Curtailment', 'ruled out', 'No export limit was active until this afternoon\'s instruction.'),
            ruled_out('Anemometers icing (not the blades)', 'ruled out',
                      'An iced anemometer reads low and makes performance look high, not low.'),
        ]
        return {
            'conclusion': conclusion('Cause' if thawed else 'Most likely cause',
                                     f'Rime ice on the blades of the {feeder} string', level,
                                     'Confirmed: output recovered with the thaw' if thawed else 'Shared loss in icing weather'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': ro, 'excluded': None,
            'confidence': confidence(level,
                                     'The loss was shared across the string, happened only in freezing fog, and cleared as it warmed.',
                                     None if thawed else 'It hasn\'t thawed yet.',
                                     None if thawed else 'Output recovers as ambient goes above 0 °C.',
                                     'One turbine stays low after the thaw. Then look at that machine on its own.',
                                     'Recovery with the thaw' if thawed else None),
            'action': action(item, pack),
            'grouped': [pack.name(t) for t in shared_w],
        }


# ═════════════════════════════════════════════════════════════════════════
# 9. Curtailment compliance — archetype 14 (plan or compliance at risk)
# ═════════════════════════════════════════════════════════════════════════
# A dispatch instruction arrives from outside the plant (in production, from
# the grid operator's dispatch feed). It isn't telemetry, so it's an input here.
DISPATCH = [{'received': '13:45', 'capKw': 45000, 'from': '14:30', 'source': 'Grid operator'}]


class CurtailmentCompliance(Detector):
    id = 'wind.curtailment_compliance'
    name = 'Curtailment instruction at risk'
    archetype = '14 Plan or compliance at risk'
    applies_to = 'substations'
    summary = ('An export cap is coming, export is above it and rising with the wind, and the setpoint that would '
               'hold it isn\'t in yet.')
    pipeline = [
        ('Instruction', 'the grid operator\'s export cap and when it starts (from the dispatch feed)'),
        ('Now', 'export against the cap, and its trend over the last hour'),
        ('Plan', 'is the setpoint task done, and how long is left before the cap starts'),
        ('Conclusion', 'an action with a deadline, not a diagnosis'),
    ]
    definition = {
        'appliesTo': {'assetType': 'collector_substation'},
        'inputs': {'export': 'self.export_power_kw', 'instruction': 'dispatch feed (capKw, from)',
                   'setpoint task': 'work item for this asset from the instruction', 'wind': 'met_mast.met_wind_speed_ms'},
        'params': {'trend_min': 60, 'lead_min': 10},
        'checks': [
            {'id': 'over', 'role': 'required', 'rule': 'export > capKw while the cap is pending'},
            {'id': 'setpoint', 'role': 'required', 'rule': 'setpoint task not done'},
            {'id': 'rising', 'role': 'supporting', 'rule': 'slope(export, trend_min) > 0'},
            {'id': 'time', 'role': 'supporting', 'rule': 'minutes until the cap starts'},
        ],
        'confidence': {'n/a': 'an instruction, not a diagnosis'},
    }

    def candidates(self, pack):
        return pack.of_type('collector_substation')

    def _task(self, pack, aid):
        return next((w for w in pack.work if w['assetId'] == aid and w['sourceType'] == 'situation'), None)

    def evaluate(self, pack, aid):
        exp = pack.series(aid, 'export_power_kw')
        for ins in DISPATCH:
            rmin = int(ins['received'][:2]) * 60 + int(ins['received'][3:])
            i = next((k for k, t in enumerate(pack.ts) if int(t[:2]) * 60 + int(t[3:]) >= rmin), None)
            task = self._task(pack, aid)
            if i is not None and exp[pack.now] > ins['capKw'] and not (task and task['done']):
                return Finding(aid, True, i, ins=ins, exp=exp, task=task)
        return Finding(aid, False)

    def explain(self, pack, f, item):
        p, c, ts, now = self.p, f.ctx, pack.ts, pack.now
        aid = f.aid
        ins, exp, task = c['ins'], c['exp'], c['task']
        cap = ins['capKw']
        slope = B.slope_per_hour(exp, now, pack.steps(p['trend_min']), pack.step_min)
        cap_min = int(ins['from'][:2]) * 60 + int(ins['from'][3:])
        now_min = int(ts[now][:2]) * 60 + int(ts[now][3:])
        left = cap_min - now_min
        proj = exp[now] + (slope or 0) * left / 60
        wind = pack.series(met(pack), 'met_wind_speed_ms')
        due = task['dueAt'][11:16] if task and task.get('dueAt') else None
        win = [ts[max(0, now - 18)], ts[now]]
        checks = [
            check('over', 'Export is above the coming cap', 'required', MATCH,
                  f'{num(exp[now] / 1000, 1)} MW now; the cap is {num(cap / 1000, 1)} MW from {ins["from"]} '
                  f'({num((exp[now] - cap) / 1000, 1)} MW over).',
                  'Without a setpoint, the plant will keep exporting whatever the wind gives.',
                  spark([v / 1000 for v in exp], [40, 60], threshold_value=cap / 1000, window=win)),
            check('setpoint', 'The setpoint isn\'t in yet', 'required', MATCH,
                  f'Task "{task["text"]}" is open' + (f', due {due}.' if due else '.') if task else 'No setpoint task found.',
                  'The plant controller spreads a site setpoint across turbines automatically, once it\'s entered.', None),
            check('rising', 'Export rising with the wind', 'supporting', MATCH if (slope or 0) > 0 else NO_MATCH,
                  f'{signed((slope or 0) / 1000, 1)} MW per hour over the last hour; met-mast wind {num(wind[now])} m/s. '
                  f'At this rate, about {num(proj / 1000, 1)} MW by {ins["from"]}.',
                  'The gap to close is growing, not shrinking on its own.',
                  spark([v / 1000 for v in exp], [40, 60], window=win)),
            check('time', f'{dur(left)} until the cap starts', 'supporting', MATCH,
                  f'Instruction received {ins["received"]} from {ins["source"].lower()}.' +
                  (f' The setpoint task is due at {due}, leaving time to ramp down.' if due else ''),
                  'Turbines ramp down over minutes, so the setpoint has to go in before the cap starts, not at it.', None),
        ]
        w0 = max(0, now - pack.steps(120))
        main = chart('MW', nice_domain([v / 1000 for v in exp[w0:]], [cap / 1000], pad=0.15),
                     [series('export', 'Export', [v / 1000 for v in exp], 'primary', 2)],
                     title='What we see',
                     caption=f'Export at the point of interconnection against the {num(cap / 1000, 0)} MW cap that starts at '
                             f'{ins["from"]}.',
                     thresholds=[threshold(cap / 1000, f'Cap from {ins["from"]}')],
                     markers=[marker(ts[f.at], 'Instruction received')],
                     window=[ts[w0], ts[now]], decimals=1)
        grid = minutes_grid(-60, 60, 10)
        r = Rng(909)
        c_mw = cap / 1000
        ok = [(53 + 0.05 * (m + 60) if m < -20 else max(c_mw - 1.0, 53 - 0.5 * (m + 20))) + r.gauss(0.3) for m in grid]
        late = [(53 + 0.05 * (m + 60) if m < 10 else max(c_mw - 1.0, 55 - 0.5 * (m - 10))) + r.gauss(0.3) for m in grid]
        drop = [(53 - 0.12 * (m + 60)) + r.gauss(0.3) for m in grid]
        cap_start_idx = now + left / pack.step_min
        live_vals = [v / 1000 for v in exp]
        lv = []
        for m in grid:
            k = cap_start_idx + m / pack.step_min
            lv.append(live_vals[int(k)] if abs(k - round(k)) < 1e-6 and 0 <= k <= now else None)
        live = 'Export, today'
        th = [threshold(c_mw, 'Cap')]
        mk = lambda a: [ref_chart('Export (minutes from cap start)', 'MW', [38, 60], grid, 'min', a, lv, live, 1, th)]
        refs = [
            reference('ontime', 'textbook', 'Textbook', 'Setpoint in on time',
                      'Setpoint entered 20 minutes ahead; the plant ramps down and is under the cap before it starts.',
                      'partial', 'On track, if done by ' + (due or 'the deadline'),
                      ['This is the target', 'Confirm with the grid operator once it holds'], mk(ok)),
            reference('late', 'variant', 'What to avoid', 'Setpoint entered late',
                      'Entered at the start time: export stays over the cap for 15–20 minutes while turbines ramp down.',
                      'nomatch', 'Avoid', ['Non-compliance penalties apply to the overshoot',
                                           'Ramp-down takes minutes, not seconds'], mk(late)),
            reference('drop', 'lookalike', 'Look-alike', 'Wind drops on its own',
                      'The wind falls and export goes under the cap without any action. Only safe if the forecast says so.',
                      'nomatch', 'Not today', [f'Wind is rising: {num(wind[now])} m/s now',
                                               'Relying on it risks a penalty'], mk(drop)),
        ]
        return {
            'conclusion': conclusion('What\'s needed', f'Enter a {num(cap / 1000, 0)} MW export setpoint before {ins["from"]}',
                                     'n/a', 'An instruction, not a diagnosis'),
            'chart': main, 'checks': checks, 'references': refs, 'ruledOut': [], 'excluded': None,
            'confidence': confidence('n/a', 'This is an instruction from the grid operator, not something the data had to diagnose.'),
            'action': action(item, pack),
        }


DETECTORS = [HsBearingDamage(), GeneratorCoolingLoss(), FeederTrip(), AnemometerFault(),
             ConverterCondensationTrip(), PitchBatteryWeak(), StaticYawMisalignment(), BladeIcing(),
             CurtailmentCompliance()]


def main():
    pack, out, report, path = run_pack(REPO, 'wind', DETECTORS)
    return print_report(report, path, out)


if __name__ == '__main__':
    sys.exit(main())
