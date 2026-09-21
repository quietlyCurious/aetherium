"""Explanation builders, the Detector base class, and the pack runner.

The runner is what makes a detector honest: it runs every detector on
EVERY asset it applies to (all 19 HS bearings, not just the one with a
story), writes an explanation for each attention item it can explain, and
reports where detectors fired with no attention item and which items no
detector explained. See INDUSTRY_PACK_SPEC.md §14 for the file this writes.
"""
import json
import math
import os

from .pack import Pack


# ── Formatting ───────────────────────────────────────────────────────────
def num(v, decimals=1):
    if v is None:
        return '—'
    s = f'{v:,.{decimals}f}'
    return s.replace('-', '−')


def signed(v, decimals=1):
    if v is None:
        return '—'
    return ('+' if v >= 0 else '−') + f'{abs(v):,.{decimals}f}'


def dur(minutes):
    minutes = int(round(minutes))
    h, m = divmod(minutes, 60)
    if h and m:
        return f'{h} h {m} min'
    if h:
        return f'{h} h'
    return f'{m} min'


def rnd(values, decimals):
    out = []
    for v in values:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out.append(None)
        else:
            out.append(round(v, decimals))
    return out


def nice_domain(*arrays, pad=0.08, floor=None, ceil=None):
    vals = [v for arr in arrays for v in arr if v is not None]
    lo, hi = min(vals), max(vals)
    if hi == lo:
        hi = lo + 1
    span = hi - lo
    lo, hi = lo - span * pad, hi + span * pad
    step = 10 ** math.floor(math.log10(span)) if span > 0 else 1
    for m in (1, 2, 5, 10):
        if span / (step * m) <= 6:
            step *= m
            break
    lo = math.floor(lo / step) * step
    hi = math.ceil(hi / step) * step
    if floor is not None:
        lo = max(lo, floor)
    if ceil is not None:
        hi = min(hi, ceil)
    return [lo, hi]


# ── Chart specs ──────────────────────────────────────────────────────────
# Series styles the UI knows how to draw:
#   primary   — the asset being explained (the accent line)
#   expected  — what it should read (dashed reference line)
#   reference — a reference example's own line
#   secondary — a second line on the same asset, muted
#   peer      — one of many comparison assets (thin, light)
def series(sid, label, values, style='primary', decimals=2):
    return {'id': sid, 'label': label, 'style': style, 'values': rnd(values, decimals)}


def chart(unit, y, series_list, caption=None, title=None, band=None, shade_gap=None,
          thresholds=None, markers=None, x=None, window=None, decimals=1):
    """A line chart spec. x=None means the pack timeline (timestamps);
    otherwise {'unit': 'h'|'min', 'values': [...]} for a relative axis."""
    out = {'unit': unit, 'y': y, 'decimals': decimals, 'series': series_list}
    if title: out['title'] = title
    if caption: out['caption'] = caption
    if band: out['band'] = band
    if shade_gap: out['shadeGap'] = shade_gap
    if thresholds: out['thresholds'] = thresholds
    if markers: out['markers'] = markers
    if x: out['x'] = x
    if window: out['window'] = window
    return out


def band(label, lo, hi, decimals=2):
    return {'label': label, 'lo': rnd(lo, decimals), 'hi': rnd(hi, decimals)}


def threshold(value, label):
    return {'value': value, 'label': label}


def marker(time, label):
    return {'time': time, 'label': label}


def spark(values, y, band_lo=None, band_hi=None, threshold_value=None, highlight=None, decimals=None, window=None):
    """The tiny chart beside a check: the evidence for that one check.
    decimals=None picks enough precision for the y-range, so small-scale
    signals (in/s, inHgA, ratios) don't flatten into steps."""
    if decimals is None:
        span = abs(y[1] - y[0]) or 1
        decimals = max(2, min(4, 2 - math.floor(math.log10(span)) + 1))
    out = {'values': rnd(values, decimals), 'y': y}
    if band_lo is not None:
        out['band'] = {'lo': rnd(band_lo, decimals), 'hi': rnd(band_hi, decimals)}
    if threshold_value is not None:
        out['threshold'] = threshold_value
    if highlight:
        out['highlight'] = highlight
    if window:
        out['window'] = window
    return out


# ── Checks, rule-outs, references ───────────────────────────────────────
MATCH, NO_MATCH, PENDING = 'match', 'nomatch', 'pending'


def check(cid, label, role, status, value, why, spark_spec=None):
    """role: 'required' (the detector only raises an item when all of these
    match) or 'supporting' (each one that matches raises confidence)."""
    out = {'id': cid, 'label': label, 'role': role, 'status': status, 'value': value, 'why': why}
    if spark_spec:
        out['spark'] = spark_spec
    return out


def ruled_out(cause, verdict, reason, chart_spec=None):
    """verdict: 'ruled out' | 'unlikely' | 'not yet checked'."""
    out = {'cause': cause, 'verdict': verdict, 'reason': reason}
    if chart_spec:
        out['chart'] = chart_spec
    return out


def reference(rid, kind, tag, title, description, verdict_kind, verdict_text, notes, charts):
    """kind: textbook | early | lookalike | variant.
    verdict_kind: match | partial | nomatch — how the live case compares."""
    return {'id': rid, 'kind': kind, 'tag': tag, 'title': title, 'description': description,
            'verdict': {'kind': verdict_kind, 'text': verdict_text}, 'notes': notes, 'charts': charts}


def aligned(live, onset_index, step_min, grid, grid_unit='h'):
    """Resample a live series onto a reference example's relative grid, starting at onset."""
    out = []
    for g in grid:
        minutes = g * 60 if grid_unit == 'h' else g
        k = onset_index + minutes / step_min
        # grid values are rounded (1/6 h = 0.167 h), so allow a little slack
        if abs(k - round(k)) > 0.05 or round(k) >= len(live) or round(k) < 0:
            out.append(None)
        else:
            out.append(live[int(round(k))])
    return out


class Rng:
    """Tiny deterministic generator so reference examples are reproducible
    without depending on Python's random module internals across versions."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def u(self):
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s / 2 ** 32

    def gauss(self, sd):
        u1, u2 = max(self.u(), 1e-9), self.u()
        return sd * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)

    def ar1(self, n, sd, phi=0.8):
        out, e = [], 0.0
        for _ in range(n):
            e = phi * e + self.gauss(sd * math.sqrt(1 - phi * phi))
            out.append(e)
        return out


# ── Detector base ────────────────────────────────────────────────────────
class Finding:
    def __init__(self, aid, fired, at=None, **ctx):
        self.aid = aid
        self.fired = fired
        self.at = at            # timeline index where every required check first held
        self.ctx = ctx


class Detector:
    """Subclass per failure mode. The definition dict is the source of every
    threshold the code uses (read them from self.p), so what the engineer
    view shows and what the code does can't drift apart."""
    id = ''
    name = ''
    version = '0.1'
    archetype = ''
    applies_to = ''          # plural noun for the report: "HS bearings"
    summary = ''
    pipeline = []            # [(title, text)] — the engineer view's steps
    definition = {}

    @property
    def p(self):
        return self.definition['params']

    def candidates(self, pack):
        raise NotImplementedError

    def evaluate(self, pack, aid):
        raise NotImplementedError

    def explain(self, pack, finding, item):
        raise NotImplementedError

    def group(self, pack, aid):
        """Assets whose findings one attention item may cover (default: itself)."""
        return aid

    def describe(self):
        return {'id': self.id, 'name': self.name, 'version': self.version, 'archetype': self.archetype,
                'appliesTo': self.applies_to, 'summary': self.summary,
                'pipeline': [{'title': t, 'text': x} for t, x in self.pipeline],
                'definition': self.definition}


# ── Runner ───────────────────────────────────────────────────────────────
def run_pack(repo, model, detectors, extra=None, pack_dir=None, write=True):
    pack = Pack.load(repo, model, pack_dir)
    out = {'version': 1, 'model': model,
           'generatedBy': f'ModelAndData/industries/{model}/explain.py',
           'detectors': {}, 'items': {}}
    findings = {}
    report = {'errors': [], 'warnings': [], 'lines': []}
    for d in detectors:
        cands = d.candidates(pack)
        fired = []
        for aid in cands:
            f = d.evaluate(pack, aid)
            if f is not None and f.fired:
                findings.setdefault(aid, []).append((d, f))
                fired.append({'assetId': aid, 'label': pack.label(aid), 'at': pack.ts[f.at]})
        desc = d.describe()
        desc['run'] = {'evaluated': len(cands), 'fired': fired, 'date': pack.timeline['date']}
        out['detectors'][d.id] = desc
        names = ', '.join(x['label'] for x in fired) or 'none'
        report['lines'].append(f'{d.id:34} ran on {len(cands):3} {d.applies_to:<22} fired on {len(fired)}: {names}')

    covered = set()
    for item in pack.attention:
        hits = findings.get(item['assetId'], [])
        if not hits:
            report['errors'].append(f'{item["id"]}: no detector fired on {item["assetId"]}')
            continue
        d, f = hits[0]
        exp = d.explain(pack, f, item)
        exp['detectorId'] = d.id
        exp['detectedAt'] = pack.ts[f.at]
        out['items'][item['id']] = exp
        g = d.group(pack, item['assetId'])
        for aid, lst in findings.items():
            for d2, _ in lst:
                if d2 is d and d.group(pack, aid) == g:
                    covered.add((d.id, aid))
        lvl = exp.get('confidence', {}).get('level')
        if lvl and lvl != item['detail'].get('confidenceLevel'):
            report['warnings'].append(f'{item["id"]}: computed confidence {lvl!r} differs from the item\'s '
                                      f'{item["detail"].get("confidenceLevel")!r}')
    for aid, lst in findings.items():
        for d, f in lst:
            if (d.id, aid) not in covered:
                report['warnings'].append(f'{d.id} fired on {pack.label(aid)} at {pack.ts[f.at]} '
                                          f'but no attention item covers it')
    if extra:
        out.update(extra)
    path = os.path.join(pack_dir or os.path.join(repo, 'public', 'data', model), 'explanations.json')
    if write:
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    report['findings'] = {aid: [d.id for d, _ in lst] for aid, lst in findings.items()}
    return pack, out, report, path


def print_report(report, path, out):
    print(f'Wrote {path}  ({os.path.getsize(path) / 1024:.0f} KB, {len(out["items"])} explanations)')
    print()
    for line in report['lines']:
        print('  ' + line)
    print()
    for w in report['warnings']:
        print('WARN  ' + w)
    for e in report['errors']:
        print('ERROR ' + e)
    return 1 if report['errors'] else 0
