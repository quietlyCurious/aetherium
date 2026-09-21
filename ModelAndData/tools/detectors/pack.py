"""Read-only access to one generic industry pack, for detectors.

A detector only ever sees what the app sees: the 8 runtime files in
public/data/<model>/. It never reads a generator's scenario constants, so a
detector that fires is finding the problem in the data, not being told
where it is.

    pack = Pack.load(repo, 'wind')
    pack.series('BOREAS_F1_WTG05', 'active_power_kw')   # list of floats
    pack.child_of_type('BOREAS_F1_WTG05_DRIVETRAIN', 'gearbox')
"""
import json
import os

SEP = ' · '


class Pack:
    def __init__(self, repo, model, entry, files):
        self.repo = repo
        self.model = model
        self.entry = entry
        self.assets = files['assets']
        self.relationships = files['asset-relationships']
        props = files['properties']
        self.props = props.get('properties', {})
        self.type_labels = props.get('typeLabels', {})
        self.values = files['asset-values']
        tel = files['asset-telemetry']
        self.timeline = tel['timeline']
        self.ts = tel['timestamps']
        self._series = tel['series']
        self.unit_status = files['unit-status']
        self.attention = files['attention-items']
        self.work = files['work-items']
        self.by_id = {a['id']: a for a in self.assets}
        self.children = {}
        for a in self.assets:
            self.children.setdefault(a['parentId'], []).append(a['id'])
        self.unit_level = entry['unitLevel']
        self.step_min = self.timeline['stepMinutes']
        self.n = len(self.ts)
        self.now = self.n - 1

    # ── loading ──────────────────────────────────────────────────────────
    @classmethod
    def load(cls, repo, model, pack_dir=None):
        """pack_dir overrides public/data/<model>/ — used to run detectors on
        a regenerated copy of the pack (see robustness.py)."""
        data = os.path.join(repo, 'public', 'data')
        with open(os.path.join(data, 'models.json'), encoding='utf-8') as f:
            entry = next(m for m in json.load(f) if m['id'] == model)
        names = ['assets', 'asset-relationships', 'properties', 'asset-values', 'asset-telemetry',
                 'unit-status', 'attention-items', 'work-items']
        folder = pack_dir or os.path.join(data, model)
        files = {}
        for name in names:
            with open(os.path.join(folder, name + '.json'), encoding='utf-8') as f:
                files[name] = json.load(f)
        return cls(repo, model, entry, files)

    # ── time ─────────────────────────────────────────────────────────────
    def i(self, t):
        return self.ts.index(t)

    def steps(self, minutes):
        """Number of timeline steps in a duration."""
        return max(1, round(minutes / self.step_min))

    def minutes_between(self, i0, i1):
        return (i1 - i0) * self.step_min

    # ── data ─────────────────────────────────────────────────────────────
    def series(self, aid, key):
        return [float(v) for v in self._series[aid][key]]

    def has(self, aid, key):
        return key in self._series.get(aid, {})

    def meta(self, key):
        return self.props.get(key, {})

    def unit(self, key):
        return self.meta(key).get('unit', '')

    def label_of_key(self, key):
        return self.meta(key).get('label', key)

    # ── hierarchy ────────────────────────────────────────────────────────
    def asset(self, aid):
        return self.by_id[aid]

    def of_type(self, *types):
        return [a['id'] for a in self.assets if a['assetType'] in types]

    def parent(self, aid):
        return self.by_id[aid]['parentId']

    def ancestors(self, aid):
        out, p = [], self.parent(aid)
        while p:
            out.append(p)
            p = self.parent(p)
        return out

    def unit_of(self, aid):
        """The unit-level ancestor (or the asset itself), else None."""
        for x in [aid] + self.ancestors(aid):
            if self.by_id[x]['assetLevel'] == self.unit_level:
                return x
        return None

    def descendants(self, aid):
        out, stack = [], list(self.children.get(aid, []))
        while stack:
            x = stack.pop(0)
            out.append(x)
            stack.extend(self.children.get(x, []))
        return out

    def child_of_type(self, aid, atype):
        for c in self.children.get(aid, []):
            if self.by_id[c]['assetType'] == atype:
                return c
        return None

    def descendant_of_type(self, aid, atype):
        for c in self.descendants(aid):
            if self.by_id[c]['assetType'] == atype:
                return c
        return None

    def first_of_type(self, atype):
        ids = self.of_type(atype)
        return ids[0] if ids else None

    def sources(self, aid, layer):
        """Assets with a relationship edge INTO aid on the given layer."""
        return [e['sourceAssetId'] for e in self.relationships
                if e['targetAssetId'] == aid and e['layer'] == layer]

    def targets(self, aid, layer):
        """Assets that aid has a relationship edge INTO on the given layer."""
        return [e['targetAssetId'] for e in self.relationships
                if e['sourceAssetId'] == aid and e['layer'] == layer]

    # ── labels ───────────────────────────────────────────────────────────
    def name(self, aid):
        return self.by_id[aid]['name']

    def label(self, aid):
        """Display label per spec §3.2: names from the unit-level ancestor down."""
        chain = [aid] + self.ancestors(aid)
        u = self.unit_of(aid)
        if u is None:
            return self.name(aid)
        path = chain[:chain.index(u) + 1]
        return SEP.join(self.name(x) for x in reversed(path))

    def type_label(self, atype):
        return self.type_labels.get(atype) or atype.replace('_', ' ').title()

    # ── items ────────────────────────────────────────────────────────────
    def work_item(self, wid):
        return next((w for w in self.work if w['id'] == wid), None)

    def work_for_asset(self, aid):
        return [w for w in self.work if w['assetId'] == aid]
