// operator/operatorViews/evidenceWidgets.jsx
// The three read-only widgets that present an attention item's evidence:
// a comparison line chart (the property's series against its expected
// band), the evidence table, and the vertical event timeline.

import { useMemo, useState } from 'react';
import { Chart, CommonSeriesSettings, Series, Point, Aggregation, ArgumentAxis, Grid as ChartGrid, ValueAxis, Legend as ChartLegend, Tooltip as ChartTooltip, Export as ChartExport } from 'devextreme-react/chart';
import RangeSelector, { Size as RsSize, Chart as RsChart, ValueAxis as RsValueAxis, Series as RsSeries, Aggregation as RsAggregation, Scale as RsScale, Behavior as RsBehavior } from 'devextreme-react/range-selector';
import { minutesToShiftDate, timeStrToMinutes, CURRENT_TIMESTAMPS } from '../model/modelData';

// fullSeries: the item's primary-property series, one value per
// CURRENT_TIMESTAMPS entry — the whole-timeline trend, opening zoomed to
// the evidence window. Without one (an item that names no primary
// property), the chart plots just the evidence points.
export function ComparisonLineChart({ evidence, evidencePoints, color, fullSeries }) {
  const initialRange = useMemo(() => [
    minutesToShiftDate(timeStrToMinutes(evidencePoints[0].time)),
    minutesToShiftDate(timeStrToMinutes(evidencePoints[evidencePoints.length - 1].time)),
  ], [evidencePoints]);
  const [visualRange, setVisualRange] = useState(initialRange);
  const data = useMemo(() => (
    fullSeries
      ? fullSeries.map((value, i) => ({ time: minutesToShiftDate(timeStrToMinutes(CURRENT_TIMESTAMPS[i])), value }))
      : evidencePoints.map((p, i) => ({ time: minutesToShiftDate(timeStrToMinutes(p.time)), value: evidence[i] }))
  ), [evidencePoints, evidence, fullSeries]);
  return (
    <div className="op-evidence-chart-wrap op-evidence-chart-wrap--with-range">
      <div className="op-evidence-chart-main">
        <Chart dataSource={data} palette={[color]} height="100%">
          <CommonSeriesSettings argumentField="time" type="line" />
          <Series valueField="value">
            {/* Markers on every sample would crowd a full-timeline series;
                they stay on when only the evidence points are plotted. */}
            <Point visible={!fullSeries} size={7} />
            <Aggregation enabled={true} />
          </Series>
          <ArgumentAxis argumentType="datetime" visualRange={visualRange} valueMarginsEnabled={false}>
            <ChartGrid visible={false} />
          </ArgumentAxis>
          <ValueAxis>
            <ChartGrid visible={true} />
          </ValueAxis>
          <ChartLegend visible={false} />
          <ChartTooltip enabled={true} />
          <ChartExport enabled={false} />
        </Chart>
      </div>
      <div className="op-evidence-rangeselector">
        <RangeSelector dataSource={data} defaultValue={initialRange} onValueChanged={e => setVisualRange(e.value)}>
          <RsSize height={70} />
          <RsChart>
            <RsValueAxis visible={false} />
            <RsSeries type="line" valueField="value" argumentField="time">
              <RsAggregation enabled={true} />
            </RsSeries>
          </RsChart>
          <RsScale valueType="datetime" placeholderHeight={14} />
          <RsBehavior snapToTicks={false} valueChangeMode="onHandleMove" />
        </RangeSelector>
      </div>
    </div>
  );
}

// Fourth view option — the same evidence readings as a plain table instead
// of a chart or timeline. No fancy grid widget, just rows — this is meant
// to be the plainest possible way to look at the same numbers.
export function EvidenceTable({ evidencePoints }) {
  return (
    <table className="op-evidence-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Value</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {evidencePoints.map((p, i) => (
          <tr key={i} className={p.label ? 'op-evidence-table-row--notable' : undefined}>
            <td>{p.time}</td>
            <td>{p.value}</td>
            <td>{p.label || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VerticalTimeline({ items, maxItems }) {
  let shown = items;
  if (maxItems && items.length > maxItems) {
    // Prioritize highlighted (notable) entries so truncation drops routine
    // readings first — but keep the surviving entries in their original
    // chronological order, since this is a timeline, not a ranked list.
    const indexed = items.map((it, i) => ({ it, i }));
    const highlighted = indexed.filter(x => x.it.highlighted);
    const rest = indexed.filter(x => !x.it.highlighted);
    const keep = [...highlighted, ...rest].slice(0, maxItems);
    keep.sort((a, b) => a.i - b.i);
    shown = keep.map(x => x.it);
  }
  return (
    <div className="op-timeline">
      {shown.map((it, i) => (
        <div key={i} className="op-timeline-row">
          <span
            className={`op-timeline-dot${it.highlighted ? ' op-timeline-dot--highlighted' : ''}`}
            style={it.highlighted ? { background: it.color, boxShadow: `0 0 0 1px ${it.color}` } : undefined}
          />
          <div className="op-timeline-time">{it.time}</div>
          <div className="op-timeline-primary">{it.primary}</div>
          {it.secondary && <div className="op-timeline-secondary">{it.secondary}</div>}
        </div>
      ))}
    </div>
  );
}
