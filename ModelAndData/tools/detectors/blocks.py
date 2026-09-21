"""Signal building blocks that every detector is assembled from.

Each block does one small, explainable thing, so every check a detector
makes can be put in front of an operator in one sentence ("hotter than
expected for its load", "above the limit for 60 minutes"). Series are plain
lists aligned to the pack's timeline; None marks a point that doesn't count
(the asset wasn't running, for example). Standard library only, like the
rest of ModelAndData/tools.
"""
import math
import statistics


# ── Masks: which points count ────────────────────────────────────────────
def running_mask(power, min_kw, lookback_steps):
    """True where the asset has produced more than min_kw for the whole lookback.
    Stopped or just-restarted machines don't tell us what normal looks like."""
    out = []
    for i in range(len(power)):
        lo = max(0, i - lookback_steps + 1)
        out.append(min(power[lo:i + 1]) > min_kw)
    return out


def mask_values(values, mask):
    return [v if m else None for v, m in zip(values, mask)]


# ── Smoothing and trends ─────────────────────────────────────────────────
def ema(values, tau_steps):
    """Exponential moving average — a simple stand-in for thermal lag."""
    out, y = [], None
    a = 1.0 / max(1.0, tau_steps)
    for v in values:
        y = v if y is None else y + a * (v - y)
        out.append(y)
    return out


def rolling_mean(values, steps):
    out = []
    for i in range(len(values)):
        win = [v for v in values[max(0, i - steps + 1):i + 1] if v is not None]
        out.append(sum(win) / len(win) if win else None)
    return out


def slope_per_hour(values, i, window_steps, step_min):
    """Least-squares slope over the window ending at i, in units per hour."""
    pts = [(k, values[k]) for k in range(max(0, i - window_steps + 1), i + 1) if values[k] is not None]
    if len(pts) < 3:
        return None
    mx = sum(k for k, _ in pts) / len(pts)
    my = sum(v for _, v in pts) / len(pts)
    den = sum((k - mx) ** 2 for k, _ in pts)
    if den == 0:
        return None
    per_step = sum((k - mx) * (v - my) for k, v in pts) / den
    return per_step * 60.0 / step_min


def max_step(values, i0, i1):
    """Largest single-interval change between i0 and i1 — a sensor fault jumps, wear creeps."""
    best = 0.0
    for k in range(max(1, i0), i1 + 1):
        a, b = values[k - 1], values[k]
        if a is not None and b is not None:
            best = max(best, abs(b - a))
    return best


# ── Expected-value models ────────────────────────────────────────────────
def _solve(a, b):
    """Gaussian elimination for a small dense system a·x = b."""
    n = len(b)
    m = [row[:] + [b[r]] for r, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        if abs(m[c][c]) < 1e-12:
            raise ValueError('singular fit')
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[r][n] / m[r][r] for r in range(n)]


class LinearModel:
    """target ≈ c0 + c1·f1 + c2·f2 …, fitted by least squares on peers.

    'Expected for this load and weather' is always this: fit on the other
    assets of the same type (never on the asset being judged), then compare.
    """

    def __init__(self, coef, feature_names, n_points, peers):
        self.coef = coef
        self.feature_names = feature_names
        self.n_points = n_points
        self.peers = peers

    @classmethod
    def fit(cls, rows, feature_names, peers):
        """rows: list of (features list, target)."""
        if not rows:
            raise ValueError('no peer points to fit on')
        k = len(rows[0][0]) + 1
        ata = [[0.0] * k for _ in range(k)]
        atb = [0.0] * k
        for feats, y in rows:
            x = [1.0] + list(feats)
            for r in range(k):
                atb[r] += x[r] * y
                for c in range(k):
                    ata[r][c] += x[r] * x[c]
        return cls(_solve(ata, atb), feature_names, len(rows), peers)

    def predict(self, feats):
        return self.coef[0] + sum(c * f for c, f in zip(self.coef[1:], feats))


def fleet_expected(pack, target_aid, peer_aids, target_key, feature_fn, mask_fn, feature_names=()):
    """Fit target_key ~ features on every peer's counted points, then predict
    the target asset's own expected series. feature_fn(aid) -> list of
    feature lists per time point; mask_fn(aid) -> bool list of counted points."""
    rows = []
    used = []
    for p in peer_aids:
        if p == target_aid:
            continue
        y = pack.series(p, target_key)
        feats = feature_fn(p)
        m = mask_fn(p)
        n0 = len(rows)
        rows.extend((f, v) for f, v, ok in zip(feats, y, m) if ok)
        if len(rows) > n0:
            used.append(p)
    model = LinearModel.fit(rows, list(feature_names), used)
    feats = feature_fn(target_aid)
    expected = [model.predict(f) for f in feats]
    return model, expected


def residual(actual, expected, mask=None):
    out = []
    for k, (a, e) in enumerate(zip(actual, expected)):
        out.append(None if (mask is not None and not mask[k]) else a - e)
    return out


# ── Peer comparisons ─────────────────────────────────────────────────────
def peer_stats(pack, peer_aids, key, masks=None):
    """Per-point min / median / max across peers (only counted points)."""
    lo, med, hi = [], [], []
    for k in range(pack.n):
        vals = []
        for p in peer_aids:
            if masks is None or masks[p][k]:
                vals.append(pack.series(p, key)[k])
        if vals:
            lo.append(min(vals)); med.append(statistics.median(vals)); hi.append(max(vals))
        else:
            lo.append(None); med.append(None); hi.append(None)
    return lo, med, hi


# ── Episodes and events ──────────────────────────────────────────────────
def runs(mask):
    """[(start, end)] inclusive index ranges where mask is True."""
    out, s = [], None
    for k, m in enumerate(mask):
        if m and s is None:
            s = k
        if not m and s is not None:
            out.append((s, k - 1)); s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return out


def sustained_since(mask, i):
    """Index where the run of True ending at i started, or None if mask[i] is False."""
    if not mask[i]:
        return None
    k = i
    while k > 0 and mask[k - 1]:
        k -= 1
    return k


def first_true(mask, i0=0):
    for k in range(i0, len(mask)):
        if mask[k]:
            return k
    return None


def gt(values, threshold):
    return [v is not None and v > threshold for v in values]


def lt(values, threshold):
    return [v is not None and v < threshold for v in values]


# ── Small maths ──────────────────────────────────────────────────────────
def mean(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def stdev(values):
    vals = [v for v in values if v is not None]
    return statistics.pstdev(vals) if len(vals) > 1 else 0.0


def angle_diff(a, b):
    """Signed difference a − b in degrees, wrapped to [−180, 180)."""
    return ((a - b + 180.0) % 360.0) - 180.0


def cos_loss(offset_deg, exponent):
    return 1.0 - math.cos(math.radians(offset_deg)) ** exponent
