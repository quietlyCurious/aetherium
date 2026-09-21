// operator/operatorViews/explanation/ExplanationChart.jsx
// The charts inside an explanation (INDUSTRY_PACK_SPEC.md §14): one line
// chart that draws every chart spec in explanations.json — the main "What
// we see" chart, rule-out charts and the reference-example charts — plus
// the small sparkline beside each check, and the legend that goes with a
// chart. Plain SVG rather than a DevExtreme Chart: these are many small,
// dense charts with a fixed look (peer lines, shaded gaps, markers), and a
// single renderer keeps every one of them drawn the same way.
//
// A chart spec is { unit, y:[lo,hi], decimals, series:[{id,label,style,
// values}], band?, shadeGap?, thresholds?, markers?, window?, x? }. With no
// `x` the axis is the model timeline (CURRENT_TIMESTAMPS); with `x` it's a
// relative axis in hours or minutes from the case's onset.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Series style → stroke. "primary" is the asset being explained; the rest
// are context and deliberately recede.
export const SERIES_STYLES = {
  primary: { color: '#0078d4', width: 2 },
  expected: { color: '#4b5563', width: 1.6, dash: '5 4' },
  reference: { color: '#4b5563', width: 1.8 },
  secondary: { color: '#7a8699', width: 1.6 },
  peer: { color: '#c9ced6', width: 1.2 },
};
const DRAW_ORDER = ['peer', 'reference', 'expected', 'secondary', 'primary'];
const BAND_FILL = '#eef0f3';
const GAP_FILL = '#dbe9f8';
const THRESHOLD_COLOR = '#d64545';

function useElementWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth || fallback);
  }, [fallback]);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function formatNumber(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−');
}

// Round-number ticks inside [lo, hi].
function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => span / s <= count + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

function indexTicks(i0, i1, count) {
  const out = [];
  const step = Math.max(1, Math.round((i1 - i0) / count));
  for (let i = i0; i <= i1; i += step) out.push(i);
  return out;
}

function axisOf(spec, timestamps) {
  if (spec.x) {
    const u = spec.x.unit;
    return { values: spec.x.values, relative: true, label: v => (u === 'h' ? `${+Number(v).toFixed(2)}h` : `${v} min`) };
  }
  return { values: timestamps, relative: false, label: v => v };
}

function windowRange(spec, timestamps, n) {
  if (!spec.window || spec.x) return [0, n - 1];
  const a = timestamps.indexOf(spec.window[0]);
  const b = timestamps.indexOf(spec.window[1]);
  return [a < 0 ? 0 : a, b < 0 ? n - 1 : b];
}

// A closed area between two per-point series (hi above lo), split into
// separate shapes wherever either side has no value.
function areaPaths(hiVals, loVals, i0, i1, xs, ys, include = () => true) {
  const paths = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      let d = run.map((i, k) => `${k ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(hiVals[i]).toFixed(1)}`).join('');
      d += [...run].reverse().map(i => `L${xs(i).toFixed(1)},${ys(loVals[i]).toFixed(1)}`).join('');
      paths.push(`${d}Z`);
    }
    run = [];
  };
  for (let i = i0; i <= i1; i++) {
    if (hiVals[i] != null && loVals[i] != null && include(i)) run.push(i);
    else flush();
  }
  flush();
  return paths;
}

function linePath(values, i0, i1, xs, ys) {
  let d = '';
  let pen = false;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (v == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function ExplanationChart({ spec, timestamps, height = 220, compact = false }) {
  const [ref, W] = useElementWidth();
  const [hover, setHover] = useState(null);
  const axis = axisOf(spec, timestamps);
  const n = axis.values.length;
  const [i0, i1] = windowRange(spec, timestamps, n);
  const thLen = Math.max(0, ...(spec.thresholds || []).map(t => String(t.label).length));
  const m = { l: compact ? 34 : 44, r: thLen ? Math.min(120, thLen * 6 + 10) : 12, t: compact ? 6 : 10, b: 20 };
  const H = height;
  const [y0, y1] = spec.y;
  const clampY = v => Math.max(y0, Math.min(y1, v));
  const xs = i => m.l + ((i - i0) / Math.max(1, i1 - i0)) * (W - m.l - m.r);
  const ys = v => m.t + (1 - (clampY(v) - y0) / (y1 - y0)) * (H - m.t - m.b);

  const yTicks = niceTicks(y0, y1, compact ? 3 : 5);
  const yDec = yTicks.length > 1 && yTicks[1] - yTicks[0] < 1 ? 1 : 0;
  const xTicks = axis.relative
    ? niceTicks(axis.values[i0], axis.values[i1], compact ? 3 : 6)
        .map(v => axis.values.findIndex(u => Math.abs(u - v) < 1e-6)).filter(i => i >= 0)
    : indexTicks(i0, i1, compact ? 3 : 6);

  const series = [...spec.series].sort((a, b) => DRAW_ORDER.indexOf(a.style) - DRAW_ORDER.indexOf(b.style));
  const gap = spec.shadeGap
    ? [spec.series.find(s => s.id === spec.shadeGap[0]), spec.series.find(s => s.id === spec.shadeGap[1])]
    : null;
  const primary = spec.series.filter(s => s.style === 'primary').pop();
  let lastPrimary = null;
  if (primary && !axis.relative) {
    for (let i = i1; i >= i0; i--) if (primary.values[i] != null) { lastPrimary = i; break; }
  }

  // Marker labels go on the first row where they don't overlap an earlier one.
  const markerRows = [];
  const markers = axis.relative ? [] : (spec.markers || []).map(mk => {
    const i = timestamps.indexOf(mk.time);
    if (i < i0 || i > i1) return null;
    const w = String(mk.label).length * 6 + 8;
    const right = xs(i) > W - m.r - w;
    const x0 = right ? xs(i) - 4 - w : xs(i) + 4;
    let row = markerRows.findIndex(end => end < x0);
    if (row < 0) { row = markerRows.length; markerRows.push(0); }
    markerRows[row] = x0 + w;
    return { ...mk, i, right, row };
  }).filter(Boolean);

  const handleMove = e => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    const i = Math.max(i0, Math.min(i1, Math.round(i0 + ((px - m.l) / (W - m.l - m.r)) * (i1 - i0))));
    setHover(i);
  };

  const decimals = spec.decimals ?? 1;
  const named = spec.series.filter(s => s.style !== 'peer');
  const peerVals = hover == null ? [] : spec.series.filter(s => s.style === 'peer').map(s => s.values[hover]).filter(v => v != null);

  return (
    <div className="op-explanation-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} width="100%">
        <g className="op-explanation-chart-axis">
          {yTicks.map(v => (
            <g key={`y${v}`}>
              <line x1={m.l} x2={W - m.r} y1={ys(v)} y2={ys(v)} className="op-explanation-chart-grid" />
              <text x={m.l - 6} y={ys(v) + 4} textAnchor="end">{formatNumber(v, yDec)}</text>
            </g>
          ))}
          {xTicks.map(i => (
            <text key={`x${i}`} x={xs(i)} y={H - 4} textAnchor="middle">{axis.label(axis.values[i])}</text>
          ))}
        </g>
        {spec.band && areaPaths(spec.band.hi, spec.band.lo, i0, i1, xs, ys).map((d, k) => <path key={`b${k}`} d={d} fill={BAND_FILL} />)}
        {gap && gap[0] && gap[1] && areaPaths(gap[0].values, gap[1].values, i0, i1, xs, ys, i => gap[0].values[i] > gap[1].values[i])
          .map((d, k) => <path key={`g${k}`} d={d} fill={GAP_FILL} />)}
        {(spec.thresholds || []).map(t => (
          <g key={`t${t.value}`}>
            <line x1={m.l} x2={W - m.r} y1={ys(t.value)} y2={ys(t.value)} stroke={THRESHOLD_COLOR} strokeWidth={1.2} strokeDasharray="4 3" />
            <text x={W - m.r + 4} y={ys(t.value) + 4} className="op-explanation-chart-note">{t.label}</text>
          </g>
        ))}
        {series.map(s => {
          const st = SERIES_STYLES[s.style] || SERIES_STYLES.primary;
          return <path key={`s-${s.style}-${s.id}`} d={linePath(s.values, i0, i1, xs, ys)} fill="none" stroke={st.color}
            strokeWidth={st.width} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {markers.map(mk => (
          <g key={`m${mk.time}${mk.label}`}>
            <line x1={xs(mk.i)} x2={xs(mk.i)} y1={m.t} y2={H - m.b} stroke="#b8bec6" strokeWidth={1} />
            <text x={mk.right ? xs(mk.i) - 4 : xs(mk.i) + 4} y={m.t + 11 + mk.row * 13} textAnchor={mk.right ? 'end' : 'start'}
              className="op-explanation-chart-note">{mk.label}</text>
          </g>
        ))}
        {lastPrimary != null && (
          <circle cx={xs(lastPrimary)} cy={ys(primary.values[lastPrimary])} r={3.5} fill={SERIES_STYLES.primary.color} stroke="#fff" strokeWidth={2} />
        )}
        {hover != null && <line x1={xs(hover)} x2={xs(hover)} y1={m.t} y2={H - m.b} stroke="#9aa1a9" strokeWidth={1} />}
        <rect x={m.l} y={0} width={Math.max(1, W - m.l - m.r)} height={H} fill="transparent"
          onMouseMove={handleMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="op-explanation-chart-tip" style={{ left: Math.max(0, Math.min(xs(hover) + 12, W - 220)) }}>
          <div className="op-explanation-chart-tip-title">{axis.label(axis.values[hover])}</div>
          {named.map(s => (
            <div key={s.id} className="op-explanation-chart-tip-row">
              <em>{s.label}</em>{s.values[hover] == null ? '—' : `${formatNumber(s.values[hover], decimals)} ${spec.unit}`}
            </div>
          ))}
          {peerVals.length > 0 && (
            <div className="op-explanation-chart-tip-row">
              <em>Others ({peerVals.length})</em>{formatNumber(Math.min(...peerVals), decimals)} to {formatNumber(Math.max(...peerVals), decimals)} {spec.unit}
            </div>
          )}
          {spec.band && spec.band.lo[hover] != null && (
            <div className="op-explanation-chart-tip-row">
              <em>{spec.band.label}</em>{formatNumber(spec.band.lo[hover], decimals)}–{formatNumber(spec.band.hi[hover], decimals)} {spec.unit}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Legend for a chart spec: named series, peers as one entry, band, gap.
export function ChartLegend({ spec }) {
  const peers = spec.series.filter(s => s.style === 'peer');
  return (
    <div className="op-explanation-legend">
      {spec.series.filter(s => s.style !== 'peer').map(s => {
        const st = SERIES_STYLES[s.style] || SERIES_STYLES.primary;
        return (
          <span key={s.id}>
            <i className={`op-explanation-swatch${st.dash ? ' op-explanation-swatch--dash' : ''}`} style={{ borderColor: st.color }} />
            {s.label}
          </span>
        );
      })}
      {peers.length > 0 && (
        <span><i className="op-explanation-swatch op-explanation-swatch--thin" style={{ borderColor: SERIES_STYLES.peer.color }} />
          {peers.length === 1 ? peers[0].label : `${peers.length} others`}</span>
      )}
      {spec.band && <span><i className="op-explanation-swatch op-explanation-swatch--area op-explanation-swatch--band" />{spec.band.label} (range)</span>}
      {spec.shadeGap && <span><i className="op-explanation-swatch op-explanation-swatch--area op-explanation-swatch--gap" />Gap</span>}
    </div>
  );
}

// The small chart beside a check: { values, y, band?, threshold?, highlight?, window? }.
export function ExplanationSpark({ spark, timestamps }) {
  const W = 150;
  const H = 40;
  const all = spark.values;
  let i0 = 0;
  let i1 = all.length - 1;
  if (spark.window) {
    const a = timestamps.indexOf(spark.window[0]);
    const b = timestamps.indexOf(spark.window[1]);
    if (a >= 0) i0 = a;
    if (b >= 0) i1 = b;
  }
  const [y0, y1] = spark.y;
  const xs = i => 2 + ((i - i0) / Math.max(1, i1 - i0)) * (W - 4);
  const ys = v => 3 + (1 - (Math.max(y0, Math.min(y1, v)) - y0) / (y1 - y0)) * (H - 6);
  let hl = null;
  if (spark.highlight) {
    const a = Math.max(i0, timestamps.indexOf(spark.highlight[0]));
    const b = Math.min(i1, timestamps.indexOf(spark.highlight[1]));
    if (b >= a) hl = [a, b];
  }
  return (
    <svg className="op-explanation-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      {hl && <rect x={xs(hl[0])} width={Math.max(1, xs(hl[1]) - xs(hl[0]))} y={0} height={H} fill={GAP_FILL} opacity={0.6} />}
      {spark.band && areaPaths(spark.band.hi, spark.band.lo, i0, i1, xs, ys).map((d, k) => <path key={k} d={d} fill="#e6e9ed" />)}
      {spark.threshold != null && (
        <line x1={0} x2={W} y1={ys(spark.threshold)} y2={ys(spark.threshold)} stroke={THRESHOLD_COLOR} strokeWidth={1} strokeDasharray="3 2" />
      )}
      <path d={linePath(all, i0, i1, xs, ys)} fill="none" stroke={SERIES_STYLES.primary.color} strokeWidth={1.6} />
    </svg>
  );
}
