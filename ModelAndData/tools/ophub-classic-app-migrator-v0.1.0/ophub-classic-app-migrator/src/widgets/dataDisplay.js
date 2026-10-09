// Classic data-display widgets:
//   Table          -> DataGrid
//   Visualization  -> chartLine (or chartPie when it was a donut)
//   Graph          -> chartPie for pie/donut, chartLine otherwise
//   Bar Graph      -> gaugeLinear

import { manualBinding, queryBinding, toPluginBinding } from '../bindings.js';
import { SEVERITY } from '../report.js';
import { describeSource } from './common.js';

const LINE_MODES = { bar: 'bar', line: 'line', spline: 'spline', area: 'area', 'area-spline': 'splinearea', step: 'stepline', 'area-step': 'steparea' };

function flowName(ctx, flowInstanceId) {
  const f = ctx.flows.get(flowInstanceId);
  return f ? (f.alias || f.flow_metadata.name) : `query #${flowInstanceId}`;
}

/** Field names from classic table/visualization field entries ({data:{type:'flow', value:'FieldName'}}). */
function fieldNames(fields, notes) {
  const names = [];
  for (const f of fields || []) {
    const v = f?.data?.value;
    if (f?.data?.type === 'flow' && typeof v === 'string' && v) names.push(v);
    else if (f?.data?.type === 'formula') notes.push({ severity: SEVERITY.WARN, text: `Column/series "${f.displayName || ''}" was a formula; it was not carried over.` });
  }
  return names;
}

export function convertTable(classic, ctx) {
  const notes = [];
  const t = classic.data?.table || {};
  const flowId = t.flow?.flowInstanceId;
  const names = fieldNames(t.fields, notes);
  const renamed = (t.fields || []).filter((f) => f.displayName && f.displayName !== f.data?.value);
  if (renamed.length) {
    notes.push({ severity: SEVERITY.INFO, text: `Column headers renamed in classic (${renamed.map((f) => `${f.data.value} → ${f.displayName}`).join(', ')}); set captions in the DataGrid's Columns section.` });
  }
  if ((t.fields || []).some((f) => (f.actions || []).length)) {
    notes.push({ severity: SEVERITY.WARN, text: 'Column click actions are not carried over; use the DataGrid\'s Selected Items Changed event instead.' });
  }
  const paged = classic.pagination?.enabled;
  return {
    typeName: 'DataGrid',
    data: {
      input: flowId != null ? queryBinding(ctx, flowId, names, notes) : manualBinding(''),
      numberFormat: { useRawFormat: true },
      general: {
        scrollOrPage: paged ? 'Pages' : 'Scroll',
        pageSize: Number(classic.pagination?.pageSize) || 10,
        allowExport: !!classic.allowDownload,
        enableSearch: true,
        columnAutoWidth: true,
      },
      __commands: { selectedChanged: {}, editedUpdated: {} },
    },
    multiActions: { commands: [{ title: 'Selected Items Changed', id: 'selectedChanged' }, { title: 'Edited Rows Updated', id: 'editedUpdated' }] },
    size: { width: 640, height: 360 },
    label: flowId != null ? `Table of ${flowName(ctx, flowId)}` : 'Table',
    notes,
  };
}

function pieData(ctx, flowId, labelField, valueField, donut, title, notes) {
  return {
    typeName: 'chartPie',
    data: {
      pieMode: donut ? 'donut' : 'pie',
      inputValue: queryBinding(ctx, flowId, [labelField, valueField].filter(Boolean), notes),
      title: title || '',
      seriesColors: [],
      advanced: { palette: 'Material', showLabels: true, showTooltips: true, legend: { visible: true, posVert: 'bottom', posHor: 'center', textPos: 'bottom' } },
    },
    size: { width: 420, height: 320 },
  };
}

function lineData(ctx, flowId, xField, yFields, opts, notes) {
  return {
    typeName: 'chartLine',
    data: {
      lineMode: opts.lineMode || 'line',
      inputValue: queryBinding(ctx, flowId, [xField, ...yFields].filter(Boolean), notes),
      numberFormat: { useRawFormat: true },
      title: opts.title || '',
      xAxisTitle: opts.xTitle || '',
      yAxisTitle: opts.yTitle || '',
      xAxisDisplayMode: 'standard',
      xAxisRot: 0,
      xAxisDataFormat: opts.xIsDate ? 'date' : 'string',
      xAxisDateFormat: 'yyyy-MM-dd HH:mm:ss',
      seriesColors: [],
    },
    size: { width: 640, height: 360 },
  };
}

function manualText(label) {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label.type === 'manual' ? (label.manual ?? '') : '';
}

export function convertVisualization(classic, ctx) {
  const notes = [];
  const v = classic.data?.visualization || {};
  const flowId = v.flow?.flowInstanceId;
  const xField = typeof v.x?.data?.value === 'string' ? v.x.data.value : null;
  const series = (v.fields || []).filter((f) => f?.data?.type === 'flow');
  const yFields = fieldNames(series, notes);
  let result;
  if (v.hasDonut) {
    result = pieData(ctx, flowId, xField, yFields[0], true, v.donutTitle, notes);
    if (yFields.length > 1) notes.push({ severity: SEVERITY.WARN, text: `Donut had ${yFields.length} series; only "${yFields[0]}" was kept.` });
  } else {
    const modes = series.map((f) => LINE_MODES[f.type] || 'line');
    const counts = modes.reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {});
    const lineMode = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'line';
    if (Object.keys(counts).length > 1) {
      notes.push({ severity: SEVERITY.WARN, text: `Mixed series types (${Object.entries(counts).map(([k, n]) => `${n}× ${k}`).join(', ')}) drawn as "${lineMode}"; the line chart uses one mode for all series.` });
    }
    if (series.some((f) => f.stacked)) notes.push({ severity: SEVERITY.INFO, text: 'Some series were stacked; set Stacking under Advanced.' });
    if (v.y2?.enabled) notes.push({ severity: SEVERITY.WARN, text: 'Secondary Y axis not carried over.' });
    if (v.groupData?.enabled) notes.push({ severity: SEVERITY.WARN, text: `Data grouping by "${v.groupData.groupBy}" not carried over.` });
    result = lineData(ctx, flowId, xField, yFields, {
      lineMode,
      xTitle: manualText(v.x?.label),
      yTitle: manualText(v.y?.label),
      xIsDate: /date|time/i.test(v.x?.fieldType || ''),
    }, notes);
  }
  if (flowId == null) notes.push({ severity: SEVERITY.WARN, text: 'Chart had no query bound.' });
  return { ...result, label: flowId != null ? `Chart of ${flowName(ctx, flowId)}` : 'Chart', notes };
}

export function convertGraph(classic, ctx) {
  const notes = [];
  const g = classic.graphData || {};
  const xv = g.x?.data?.value;
  const yv = g.y?.data?.value;
  const flowId = xv?.flowInstanceId ?? yv?.flowInstanceId;
  let result;
  if (g.type === 'pie' || g.type === 'donut') {
    result = pieData(ctx, flowId, xv?.fieldName, yv?.fieldName, g.type === 'donut', classic.label, notes);
  } else {
    result = lineData(ctx, flowId, xv?.fieldName, [yv?.fieldName].filter(Boolean), {
      lineMode: LINE_MODES[g.type] || 'line', xTitle: g.x?.label, yTitle: g.y?.label,
    }, notes);
  }
  if (g.sort?.by) notes.push({ severity: SEVERITY.INFO, text: `Classic sorted by "${g.sort.by}" (${g.sort.order}); sort in the query if needed.` });
  if (g.groupData?.enabled) notes.push({ severity: SEVERITY.WARN, text: `Data grouping by "${g.groupData.groupBy}" not carried over.` });
  return { ...result, label: `${g.type || 'Graph'} of ${flowId != null ? flowName(ctx, flowId) : '?'}`, notes };
}

export function convertBarGraph(classic, ctx) {
  const notes = [];
  if ((classic.ranges || []).length) {
    notes.push({ severity: SEVERITY.WARN, text: `${classic.ranges.length} color range(s) not carried over; set Color Limits under Advanced.` });
  }
  if (classic.units) notes.push({ severity: SEVERITY.INFO, text: `Units "${classic.units}" not shown by the linear gauge; add a text widget if needed.` });
  return {
    typeName: 'gaugeLinear',
    data: {
      inputValue: toPluginBinding(ctx, classic.data?.source, notes),
      min: manualBinding(String(classic.minValue ?? 0)),
      max: manualBinding(String(classic.maxValue ?? 100)),
      numberFormat: { useRawFormat: true },
      advanced: { orientation: classic.gaugeType === 'vertical' ? 'vertical' : 'horizontal', showAnimation: false },
      autoBindStockProps: false,
    },
    size: { width: 320, height: 120 },
    label: `Gauge: ${describeSource(classic.data?.source)}`,
    notes,
  };
}
