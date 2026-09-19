#!/usr/bin/env python3
"""Convert a legacy four-level pack (water, wastewater) into the generic
8-file format described in INDUSTRY_PACK_SPEC.md §6.

Usage:
  python3 ModelAndData/tools/convert_legacy_to_generic.py <legacy-model> <new-model-id> [--repo PATH]

Writes public/data/<new-model-id>/ and prints the models.json entry to add.
The legacy folder is only read, never changed. Standard library only.

What it does, and the judgment calls it makes:
- Hierarchy: copied as-is (plant/train/stage/equipment). unitLevel = train.
- Values: plant ← plant-rollups, train ← line-rollups, stage ← station
  typed properties, equipment ← equipment-metrics. Text-valued rollups
  (bottleneck_station, best_train, worst_train) are dropped — the generic
  format is numeric-only.
- Telemetry: the matching legacy series, re-keyed by real asset id.
  Stage "universal" series (OEE, WIP…) are dropped; they were never shown
  as properties.
- Metadata: labels/categories/tiers/ranges merged into properties.json;
  units inferred from the key suffix; a missing range is derived from the
  data (padded 10%) and reported.
- Derivations: left empty. The legacy rollups only match their formulas at
  the final point (spec §12), so declaring them would fail validation.
- Unit status: line-status + operating-context, keyed by train asset id.
- Attention/work items: gain assetId/unitId (resolved from their labels)
  and primaryProperty (from the stage's legacy sparkline, when present).
  Labels switch to the generic form (starting at the unit, §3.2).
"""
import json, os, sys

SEP = ' · '
UNIT_SUFFIXES = [
    ('_pct', '%'), ('_mg_l', 'mg/L'), ('_ntu', 'NTU'), ('_psi', 'psi'), ('_gpm', 'gpm'),
    ('_scfm', 'scfm'), ('_rpm', 'rpm'), ('_mms', 'mm/s'), ('_temp_c', '°C'), ('_c', '°C'),
    ('_a', 'A'), ('_min', 'min'), ('_ft', 'ft'), ('_per_s', '1/s'), ('_per_day', '/day'),
    ('_per_week', '/week'), ('_per_hr', '/hr'), ('_hrs', 'h'), ('_days', 'days'),
    ('_gpd_ft', 'gpd/ft'), ('_svi', 'mL/g'), ('_ph', 'pH'),
]


def infer_unit(key):
    for suf, unit in UNIT_SUFFIXES:
        if key.endswith(suf):
            return unit
    return ''


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__); sys.exit(2)
    src_model, dst_model = args[0], args[1]
    repo = args[args.index('--repo') + 1] if '--repo' in args else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    src = os.path.join(repo, 'public', 'data', src_model)
    dst = os.path.join(repo, 'public', 'data', dst_model)
    L = lambda n: json.load(open(os.path.join(src, n), encoding='utf-8'))

    A = L('water-asset-data.json')
    M = {a['id']: a for a in A}
    by = lambda lv: [a for a in A if a['assetLevel'] == lv]

    def station_id(s):
        t = M[s['parentId']]; p = M[t['parentId']]
        return f'{p["id"][:3]}_{t["name"]}_{s["assetType"].replace("_", "").upper()}'

    def line_id(t):
        p = M[t['parentId']]; return f'{p["id"]}_{p["id"][:3]}_{t["name"]}'

    st_of = {station_id(s): s['id'] for s in by('stage')}
    ln_of = {line_id(t): t['id'] for t in by('train')}

    ST = L('station-telemetry.json'); FP = L('station-full-properties.json')
    ET = L('equipment-telemetry.json'); EM = L('equipment-metrics.json')
    LT = L('line-telemetry.json'); LR = L('line-rollups.json')
    PT = L('plant-telemetry.json'); PR = L('plant-rollups.json')

    values, series = {}, {}
    num = lambda d: {k: v for k, v in d.items() if isinstance(v, (int, float))}
    for pid, v in PR.items():
        values[pid] = num(v); series[pid] = PT['refineries'][pid]
    for lid, v in LR.items():
        aid = ln_of[lid]; values[aid] = num(v); series[aid] = LT['lines'][lid]
    for sid, v in FP.items():
        aid = st_of[sid]; values[aid] = dict(v); series[aid] = ST['stations'][sid]['typed']
    for eid, v in EM.items():
        values[eid] = dict(v); series[eid] = ET['equipment'][eid]

    # properties.json
    lab, cat, tier, rng = L('property-labels.json'), L('property-categories.json'), L('property-tiers.json'), L('property-ranges.json')
    used = sorted({k for v in values.values() for k in v})
    props, derived_ranges = {}, []
    for k in used:
        r = rng.get(k)
        if not r:
            vals = [x for aid, s in series.items() if k in s for x in s[k]]
            lo, hi = min(vals), max(vals); pad = (hi - lo) * 0.1 or 1
            r = [round(max(0, lo - pad), 1), round(hi + pad, 1)]
            derived_ranges.append(k)
        props[k] = {'label': lab.get(k, k), 'unit': infer_unit(k), 'category': cat.get(k, 'Derived Metric'),
                    'tier': tier.get(k, 'P3'), 'range': r}

    # unit-status.json
    OC = L('operating-context.json')
    unit_status = {}
    for x in L('line-status.json'):
        aid = ln_of[x['id']]
        ctx = OC.get(x['id'], {})
        unit_status[aid] = {'state': x['state'], 'statusSinceMinutes': x.get('statusSinceMinutes'),
                            'mode': ctx.get('mode', 'STEADY'), 'product': ctx.get('product', '')}

    # labels (§3.2): names from the unit-level (train) ancestor down
    def unit_ancestor(aid):
        a = M[aid]
        while a and a['assetLevel'] != 'train':
            a = M.get(a['parentId'])
        return a

    def display_label(aid):
        u = unit_ancestor(aid)
        if not u:
            return M[aid]['name']
        path, a = [], M[aid]
        while a['id'] != u['id']:
            path.append(a['name']); a = M[a['parentId']]
        path.append(u['name'])
        return SEP.join(reversed(path))

    def label_to_id(lbl):
        cand = '_'.join(p.strip().upper().replace(' ', '_') for p in lbl.split(SEP))
        return cand if cand in M else None

    SP = L('station-sparklines.json')
    att = L('attention-items.json')
    for a in att:
        aid = label_to_id(a['asset'])
        a['assetId'] = aid
        u = unit_ancestor(aid) if aid else None
        a['unitId'] = u['id'] if u else label_to_id(a['line'])
        sid = next((s for s, x in st_of.items() if x == aid), None)
        a['primaryProperty'] = SP[sid]['property'] if sid in SP else None
        if aid: a['asset'] = display_label(aid)
        if a['unitId']: a['line'] = M[a['unitId']]['name']
    work = L('work-items.json')
    for w in work:
        lbl = w.get('assetLabel')
        aid = label_to_id(lbl) if lbl else None
        w['assetId'] = aid
        if aid: w['assetLabel'] = display_label(aid)
        w.setdefault('createdAt', w.get('plannedStart'))

    ts = ST['timestamps']
    telemetry = {'timeline': {'date': '2026-08-28', 'start': ts[0], 'end': ts[-1], 'stepMinutes': 5},
                 'timestamps': ts, 'series': series}

    os.makedirs(dst, exist_ok=True)
    out = {
        'assets.json': A,
        'asset-relationships.json': L('asset-relationships.json'),
        'properties.json': {'properties': props, 'derivations': []},
        'asset-values.json': values,
        'asset-telemetry.json': telemetry,
        'unit-status.json': unit_status,
        'attention-items.json': att,
        'work-items.json': work,
    }
    for name, data in out.items():
        with open(os.path.join(dst, name), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':') if name == 'asset-telemetry.json' else None,
                      indent=None if name == 'asset-telemetry.json' else 1)
    entry = {'id': dst_model, 'label': dst_model.title(), 'shape': 'generic',
             'levels': [{'id': 'plant', 'label': 'Plant'}, {'id': 'train', 'label': 'Train'},
                        {'id': 'stage', 'label': 'Stage'}, {'id': 'equipment', 'label': 'Equipment'}],
             'unitLevel': 'train'}
    print(f'Wrote {len(out)} files to public/data/{dst_model}/')
    if derived_ranges:
        print(f'Ranges derived from data (none in legacy pack): {derived_ranges}')
    unresolved = [a['id'] for a in att if not a['assetId']] + [w['id'] for w in work if w.get('assetLabel') and not w['assetId']]
    if unresolved:
        print(f'Items whose label did not resolve to an asset: {unresolved}')
    print('models.json entry:\n' + json.dumps(entry, indent=2))


if __name__ == '__main__':
    main()
