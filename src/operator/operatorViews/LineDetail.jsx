// operator/operatorViews/LineDetail.jsx
// The panel a line click opens: that line's rollups (throughput, OEE, WIP,
// bottleneck, health, flow efficiency, instability) plus a per-station
// breakdown. Stations with no real telemetry are tagged "baseline" rather
// than passing a generated healthy value off as measured.

import { LINE_ROLLUPS, STATION_METRICS, LINE_SPARKLINES, STATION_SPARKLINES } from '../model/modelData';
import { PropertyTile } from '../properties/PropertyTile';
import { MiniSparkline } from '../properties/sparklines';
import { HIGHLIGHT_FIELD_LABELS, SPARKLINE_PROPERTY_LABELS, STATION_TYPE_LABELS } from './statusVocabulary';

// Line-click detail panel — line rollups (throughput, OEE, WIP, bottleneck,
// health index, flow efficiency, instability) plus a per-station breakdown
// using each station's own type-specific highlights. Stations with no real
// telemetry (52 of 66 in this dataset) show a "baseline" tag rather than
// silently passing off a generated healthy guess as measured fact.
//
// Sparkline: only ever fed a REAL sampled time series — never used on the
// 52 baseline stations, since there's no real trend to show for those.
//
// Where no sparkline exists, LineDetail shows a "Normal Operation" badge in
// its place. That label is a deliberate demo simplification — what it
// actually means is "no real telemetry exists for this station, so a
// plausible healthy value was generated," not "we measured this and
// confirmed it's fine." Worth surfacing that distinction if anyone asks a
// follow-up question, even though the badge itself stays calm/simple.
export function LineDetail({ line, label, onClose }) {
  const rollup = LINE_ROLLUPS[line];
  if (!rollup) return null;
  const stationEntries = Object.keys(STATION_METRICS)
    .filter(sid => sid.startsWith(`${line}_`))
    .map(sid => [sid, STATION_METRICS[sid]]);

  return (
    <div className="op-linedetail">
      <div className="op-linedetail-header">
        <span className="op-linedetail-title">Line Detail — {label}</span>
        <button className="op-linedetail-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="op-linedetail-rollup-row">
        <PropertyTile label="Throughput" value={`${rollup.line_throughput}${rollup.line_target_rate ? ` / ${rollup.line_target_rate}` : ''}/min`} />
        {LINE_SPARKLINES[line] && LINE_SPARKLINES[line].length > 2 && (
          <div className="op-linedetail-stat">
            <span className="op-linedetail-stat-label">Throughput trend</span>
            <MiniSparkline values={LINE_SPARKLINES[line]} />
          </div>
        )}
        <PropertyTile label="OEE" value={`${rollup.line_oee}%`} />
        <PropertyTile label="Flow Efficiency" value={`${rollup.flow_efficiency}%`} />
        <PropertyTile label="Health Index" value={rollup.system_health_index} />
        <PropertyTile label="Instability" value={rollup.instability_index} />
        <PropertyTile label="Total WIP" value={rollup.total_wip} />
        <PropertyTile label="Bottleneck" value={STATION_TYPE_LABELS[rollup.bottleneck_station] || rollup.bottleneck_station} />
      </div>
      <div className="op-linedetail-stations">
        {stationEntries.map(([sid, s]) => {
          const spark = STATION_SPARKLINES[sid];
          const hasSpark = spark && spark.values.length > 2;
          return (
            <div key={sid} className="op-linedetail-station">
              <div className="op-linedetail-station-top">
                <span className="op-linedetail-station-type">{STATION_TYPE_LABELS[s.stationType]}</span>
              </div>
              <div className="op-linedetail-station-kpis">
                <PropertyTile label="Throughput" value={`${s.throughput}/min`} />
                <PropertyTile label="OEE" value={`${s.oee}%`} />
                {s.highlights.map(h => (
                  <PropertyTile key={h.label} label={HIGHLIGHT_FIELD_LABELS[h.label] || h.label} value={h.value} />
                ))}
              </div>
              {hasSpark ? (
                <div className="op-linedetail-station-spark">
                  <div className="op-linedetail-station-spark-label">
                    {SPARKLINE_PROPERTY_LABELS[spark.property] || spark.property} trend
                  </div>
                  <MiniSparkline values={spark.values} color="#fbbf24" />
                </div>
              ) : (
                <div className="op-linedetail-station-normal">
                  <span className="op-linedetail-station-normal-dot" />
                  Normal Operation
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
