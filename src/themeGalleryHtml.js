// themeGalleryHtml.js
// Single source of truth for the widget gallery shown inside the Theme workspace's
// live iframe preview — used by BOTH modes:
//   - Data Palettes:   base theme CSS held fixed, `paletteName` varies
//   - Base UI Themes:  `paletteName` held fixed, base theme CSS varies
// Editing the gallery layout/widgets here updates both modes at once — that's the
// whole point of centralizing it.
//
// Layout: left column (25% width) holds small editors, stacked vertically, each
// stretched to fill the column width. Right column (75% width) holds the larger
// visual widgets — progress, charts, gauges, data grid.

const CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/devextreme-dist/25.1.5';
export const DX_JS_URL = `${CDN_BASE}/js/dx.all.js`;
export const CDN_CSS_BASE = `${CDN_BASE}/css`;

// Neutral backdrop used for the Data Palettes mode, so the palette colors (not the
// base theme) are what draws the eye. Chosen because it's plain and uncontroversial.
export const DEFAULT_NEUTRAL_CSS_URL = `${CDN_CSS_BASE}/dx.light.css`;

// Default palette used for the Base UI Themes mode, so charts/gauges still look
// reasonable while the THEME (not the palette) is what's being evaluated.
export const DEFAULT_PALETTE_NAME = 'Material';

export function buildGalleryPreviewHtml({ cssUrl, paletteName }) {
  // Dark/contrast DevExtreme themes all carry "dark" or "contrast" in their file name
  // (dx.dark.css, dx.darkmoon.css, dx.material.blue.dark.css, dx.contrast.css, ...) —
  // cheap, reliable detection without needing a separate flag from the caller.
  const isDarkTheme = /dark|contrast/i.test(cssUrl);
  const bgColor = isDarkTheme ? 'rgb(31, 31, 31)' : '#fff';
  const labelColor = isDarkTheme ? '#bbb' : '#888';
  const sublabelColor = isDarkTheme ? '#999' : '#aaa';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${cssUrl}" />
<style>
  html, body { height:100%; margin:0; overflow:hidden; box-sizing:border-box; }
  body { padding:0; font-family: -apple-system, 'Segoe UI', sans-serif; background:${bgColor}; }
  .label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:${labelColor}; margin:0 0 4px; flex-shrink:0; }
  .sublabel { font-size:9px; color:${sublabelColor}; margin:0 0 3px; flex-shrink:0; }
  .err { padding:20px; color:#c0392b; font-size:12px; font-family:sans-serif; line-height:1.6; }

  #root { height:100%; box-sizing:border-box; }
  .gallery { display:flex; gap:16px; align-items:stretch; height:100%; width:100%; box-sizing:border-box; padding:18px; }

  .gallery-left { width:25%; flex-shrink:0; height:100%; box-sizing:border-box; display:flex; }
  .gallery-right { width:75%; min-width:0; height:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:10px; }

  /* Bordered grouping — light grey border, small radius, matches Aetherium's own
     container border styling on the page-building canvas. */
  .group-box { border:1px solid ${isDarkTheme ? '#4a4a4a' : '#d9d9d9'}; border-radius:4px; padding:10px; box-sizing:border-box; overflow:hidden; }

  .gallery-left .group-box { flex:1; display:flex; flex-direction:column; gap:6px; min-height:0; }
  .gallery-left .item { flex:1; min-height:0; display:flex; flex-direction:column; justify-content:center; overflow:hidden; }

  .gallery-right .group-box { flex:1; min-height:0; display:flex; flex-direction:column; }
  .gallery-right .row { flex:1; min-height:0; display:flex; align-items:stretch; gap:10px; flex-wrap:nowrap; overflow:hidden; }
  .viz-item { flex:1 1 0; min-width:0; height:100%; display:flex; flex-direction:column; overflow:hidden; }
  .viz-item > div:last-child { flex:1; min-height:0; width:100%; }
</style>
</head>
<body>
  <div id="root">
    <div class="gallery">

      <!-- ── Left column: editors, stacked, all sharing height equally ────────── -->
      <div class="gallery-left">
        <div class="group-box">
          <div class="item"><div class="label">Switch</div><div id="sw1"></div></div>
          <div class="item"><div class="label">Radio Group (Horizontal)</div><div id="radioH"></div></div>
          <div class="item"><div class="label">Button</div><div id="btnSingle"></div></div>
          <div class="item"><div class="label">Button Group</div><div id="btngroup1"></div></div>
          <div class="item"><div class="label">Slider</div><div id="slider1"></div></div>
          <div class="item"><div class="label">Range Slider</div><div id="rangeslider1"></div></div>
          <div class="item"><div class="label">Text Input</div><div id="txt1"></div></div>
          <div class="item"><div class="label">Date Box</div><div id="date1"></div></div>
          <div class="item"><div class="label">Tag Box</div><div id="tag1"></div></div>
        </div>
      </div>

      <!-- ── Right column: first two groups capped, third greedy, fourth hidden ── -->
      <div class="gallery-right">
        <div class="group-box" style="flex:0 0 auto; max-height:100px;">
          <div class="label">Gauges &amp; Indicators</div>
          <div class="row">
            <div class="viz-item"><div class="sublabel">Progress Indicator</div><div id="prog1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Bullet Chart</div><div id="bullet1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Linear Gauge</div><div id="lgauge1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Sparkline</div><div id="spark1" style="width:100%;height:100%"></div></div>
          </div>
        </div>

        <div class="group-box" style="flex:0 0 auto; max-height:200px;">
          <div class="label">Radial &amp; Circular</div>
          <div class="row">
            <div class="viz-item"><div class="sublabel">Circular Gauge</div><div id="cgauge1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Donut Chart</div><div id="donut1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Pie Chart</div><div id="pie1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Polar Chart</div><div id="polar1" style="width:100%;height:100%"></div></div>
          </div>
        </div>

        <div class="group-box">
          <div class="label">Charts</div>
          <div class="row">
            <div class="viz-item"><div class="sublabel">Point Chart (Scatter)</div><div id="scatter1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Line Chart</div><div id="line1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Bar Chart</div><div id="bar1" style="width:100%;height:100%"></div></div>
          </div>
        </div>

        <div class="group-box" style="display:none;">
          <div class="label">Grids</div>
          <div class="row">
            <div class="viz-item"><div class="sublabel">Data Grid</div><div id="grid1" style="width:100%;height:100%"></div></div>
            <div class="viz-item"><div class="sublabel">Pivot Grid</div><div id="pivot1" style="width:100%;height:100%"></div></div>
          </div>
        </div>
      </div>

    </div>
  </div>
  <script>
    function showError(msg) {
      document.getElementById('root').innerHTML = '<div class="err">' + msg + '</div>';
    }
    var s = document.createElement('script');
    s.src = '${DX_JS_URL}';
    s.onerror = function () {
      showError('Could not load DevExtreme from the CDN — check your internet connection and try again.');
    };
    s.onload = function () {
      try {
        var dx = window.DevExpress;
        var paletteName = '${paletteName}';
        var paletteColors = ['#1db2f5', '#f5564a', '#97c95c', '#ffc439', '#eb3573'];
        try {
          var p = dx.viz && dx.viz.getPalette && dx.viz.getPalette(paletteName);
          if (p && p.simpleSet) paletteColors = p.simpleSet;
          else if (Array.isArray(p)) paletteColors = p;
        } catch (ignored) {}

        // ── Left column editors ──────────────────────────────────────────────
        new dx.ui.dxSwitch(document.getElementById('sw1'), { value: true });
        new dx.ui.dxRadioGroup(document.getElementById('radioH'), {
          items: ['Auto', 'Manual'], value: 'Auto', layout: 'horizontal', width: '100%',
        });
        new dx.ui.dxButton(document.getElementById('btnSingle'), {
          text: 'Button', stylingMode: 'contained', type: 'default', width: '100%',
        });
        new dx.ui.dxButtonGroup(document.getElementById('btngroup1'), {
          items: [{ text: 'Day' }, { text: 'Week' }, { text: 'Month' }],
          keyExpr: 'text', selectedItemKeys: ['Week'], width: '100%',
        });
        new dx.ui.dxSlider(document.getElementById('slider1'), { min: 0, max: 100, value: 55, width: '100%' });
        new dx.ui.dxRangeSlider(document.getElementById('rangeslider1'), {
          min: 0, max: 100, start: 20, end: 70, width: '100%',
        });
        new dx.ui.dxTextBox(document.getElementById('txt1'), { placeholder: 'Text input', width: '100%' });
        new dx.ui.dxDateBox(document.getElementById('date1'), { type: 'date', placeholder: 'Date', width: '100%' });
        new dx.ui.dxTagBox(document.getElementById('tag1'), {
          items: ['Pumps', 'Compressors', 'Valves', 'Sensors', 'Motors'],
          value: ['Pumps'], placeholder: 'Select…', width: '100%',
        });

        // ── Right column: Gauges & Indicators ─────────────────────────────────
        new dx.ui.dxProgressBar(document.getElementById('prog1'), { min: 0, max: 100, value: 68, showStatus: true });
        new dx.viz.dxBullet(document.getElementById('bullet1'), {
          startScaleValue: 0, endScaleValue: 100,
          value: 72, target: 80,
          color: paletteColors[0],
        });
        new dx.viz.dxLinearGauge(document.getElementById('lgauge1'), {
          value: 45,
          scale: { startValue: 0, endValue: 100, tickInterval: 20 },
          valueIndicator: { color: paletteColors[1] },
        });
        new dx.viz.dxSparkline(document.getElementById('spark1'), {
          dataSource: [3, 6, 4, 8, 5, 9, 7, 10, 6],
          type: 'line',
          lineColor: paletteColors[0],
          winColor: paletteColors[2],
          lossColor: paletteColors[1],
        });

        // ── Right column: Radial & Circular ───────────────────────────────────
        new dx.viz.dxCircularGauge(document.getElementById('cgauge1'), {
          value: 72,
          scale: { startValue: 0, endValue: 100, tickInterval: 20 },
          rangeContainer: { ranges: [
            { startValue: 0, endValue: 60, color: paletteColors[2] },
            { startValue: 60, endValue: 85, color: paletteColors[3] },
            { startValue: 85, endValue: 100, color: paletteColors[1] },
          ]},
          valueIndicator: { color: paletteColors[0] },
        });
        new dx.viz.dxPieChart(document.getElementById('donut1'), {
          type: 'doughnut',
          dataSource: [
            { c: 'Pumps', v: 24 }, { c: 'Compressors', v: 18 }, { c: 'Valves', v: 31 },
            { c: 'Sensors', v: 12 }, { c: 'Motors', v: 27 },
          ],
          palette: paletteName,
          series: { argumentField: 'c', valueField: 'v' },
          legend: { visible: false },
        });
        new dx.viz.dxPieChart(document.getElementById('pie1'), {
          type: 'pie',
          dataSource: [
            { c: 'Pumps', v: 24 }, { c: 'Compressors', v: 18 }, { c: 'Valves', v: 31 },
            { c: 'Sensors', v: 12 }, { c: 'Motors', v: 27 },
          ],
          palette: paletteName,
          series: { argumentField: 'c', valueField: 'v' },
          legend: { visible: false },
        });
        new dx.viz.dxPolarChart(document.getElementById('polar1'), {
          dataSource: [
            { arg: 0, val: 5 }, { arg: 45, val: 9 }, { arg: 90, val: 6 },
            { arg: 135, val: 8 }, { arg: 180, val: 4 }, { arg: 225, val: 7 },
            { arg: 270, val: 5 }, { arg: 315, val: 9 },
          ],
          palette: paletteName,
          series: { argumentField: 'arg', valueField: 'val', type: 'line' },
          legend: { visible: false },
        });

        // ── Right column: Charts ──────────────────────────────────────────────
        new dx.viz.dxChart(document.getElementById('scatter1'), {
          dataSource: [
            { x: 1, y: 5 }, { x: 2, y: 9 }, { x: 3, y: 3 },
            { x: 4, y: 7 }, { x: 5, y: 6 }, { x: 6, y: 10 }, { x: 7, y: 4 },
          ],
          palette: paletteName,
          series: { argumentField: 'x', valueField: 'y', type: 'scatter' },
          legend: { visible: false },
        });
        new dx.viz.dxChart(document.getElementById('line1'), {
          dataSource: [
            { a: 'Pumps', v: 24 }, { a: 'Valves', v: 38 }, { a: 'Motors', v: 19 },
            { a: 'Tanks', v: 29 }, { a: 'Sensors', v: 33 }, { a: 'Filters', v: 21 },
          ],
          palette: paletteName,
          series: { argumentField: 'a', valueField: 'v', type: 'line' },
          legend: { visible: false },
        });
        new dx.viz.dxChart(document.getElementById('bar1'), {
          dataSource: [
            { a: 'Pumps', v: 24 }, { a: 'Valves', v: 38 }, { a: 'Motors', v: 19 },
            { a: 'Tanks', v: 29 }, { a: 'Sensors', v: 33 }, { a: 'Filters', v: 21 },
          ],
          palette: paletteName,
          series: { argumentField: 'a', valueField: 'v', type: 'bar' },
          legend: { visible: false },
        });

        // ── Right column: Grids ────────────────────────────────────────────────
        new dx.ui.dxDataGrid(document.getElementById('grid1'), {
          dataSource: [
            { asset: 'Pump 1', status: 'Running', throughput: 84.2 },
            { asset: 'Compressor 2', status: 'Fault', throughput: 0 },
            { asset: 'Valve 3', status: 'Running', throughput: 61.7 },
          ],
          showBorders: true,
          height: '100%',
          columns: ['asset', 'status', 'throughput'],
        });
        new dx.ui.dxPivotGrid(document.getElementById('pivot1'), {
          dataSource: new dx.data.PivotGridDataSource({
            store: [
              { plant: 'Refinery A', type: 'Pump', value: 24 },
              { plant: 'Refinery A', type: 'Valve', value: 31 },
              { plant: 'Refinery B', type: 'Pump', value: 19 },
              { plant: 'Refinery B', type: 'Valve', value: 27 },
            ],
            fields: [
              { caption: 'Plant', dataField: 'plant', area: 'row' },
              { caption: 'Type', dataField: 'type', area: 'column' },
              { caption: 'Value', dataField: 'value', area: 'data', summaryType: 'sum' },
            ],
          }),
          showBorders: true,
          height: '100%',
        });
      } catch (e) {
        showError('Preview failed to initialize: ' + e.message);
      }
    };
    document.head.appendChild(s);
  </script>
</body>
</html>`;
}
