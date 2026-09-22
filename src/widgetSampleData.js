// Widget sample data for live previews.
// To swap in your own data later, simply replace the arrays/objects below.
// Each key matches the widget name in DX_WIDGET_DATA (widgetData.js) / WIDGET_PROPERTIES (widgetProperties.js).

const WIDGET_SAMPLE_DATA = {

  DataGrid: {
    dataSource: [
      { id: 1, name: 'Alpha Station', type: 'intake', status: 'Running', value: 142 },
      { id: 2, name: 'Beta Station', type: 'refinement', status: 'Idle', value: 87 },
      { id: 3, name: 'Gamma Station', type: 'output', status: 'Running', value: 209 },
      { id: 4, name: 'Delta Station', type: 'buffer', status: 'Warning', value: 55 },
      { id: 5, name: 'Epsilon Station', type: 'inspection', status: 'Running', value: 176 },
    ],
    keyExpr: 'id',
    columns: ['name', 'type', 'status', 'value'],
  },

  TreeList: {
    dataSource: [
      { id: 1, parentId: 0, name: 'Aurelia Refinery', type: 'refinery' },
      { id: 2, parentId: 1, name: 'Line A1', type: 'line' },
      { id: 3, parentId: 2, name: 'Intake', type: 'station' },
      { id: 4, parentId: 2, name: 'Refinement', type: 'station' },
      { id: 5, parentId: 1, name: 'Line A2', type: 'line' },
      { id: 6, parentId: 5, name: 'Intake', type: 'station' },
    ],
    keyExpr: 'id',
    parentIdExpr: 'parentId',
    columns: ['name', 'type'],
  },

  List: {
    dataSource: ['Alpha Station', 'Beta Station', 'Gamma Station', 'Delta Station', 'Epsilon Station'],
  },

  TreeView: {
    items: [
      { id: 1, text: 'Aurelia Refinery', expanded: true, items: [
        { id: 2, text: 'Line A1', items: [
          { id: 3, text: 'Intake' },
          { id: 4, text: 'Refinement' },
        ]},
        { id: 5, text: 'Line A2', items: [
          { id: 6, text: 'Intake' },
        ]},
      ]},
    ],
  },

  Gallery: {
    dataSource: [
      { imageSrc: 'https://placehold.co/400x200/0078d4/white?text=Slide+1', imageAlt: 'Slide 1' },
      { imageSrc: 'https://placehold.co/400x200/00a651/white?text=Slide+2', imageAlt: 'Slide 2' },
      { imageSrc: 'https://placehold.co/400x200/d4380078/white?text=Slide+3', imageAlt: 'Slide 3' },
    ],
  },

  Chart: {
    dataSource: [
      { month: 'Jan', production: 420, target: 400 },
      { month: 'Feb', production: 380, target: 400 },
      { month: 'Mar', production: 460, target: 420 },
      { month: 'Apr', production: 490, target: 430 },
      { month: 'May', production: 510, target: 450 },
      { month: 'Jun', production: 475, target: 450 },
    ],
    series: [
      { argumentField: 'month', valueField: 'production', name: 'Production', type: 'bar' },
      { argumentField: 'month', valueField: 'target', name: 'Target', type: 'line' },
    ],
  },

  PieChart: {
    dataSource: [
      { category: 'Intake', value: 28 },
      { category: 'Refinement', value: 35 },
      { category: 'Inspection', value: 18 },
      { category: 'Buffer', value: 12 },
      { category: 'Output', value: 7 },
    ],
    series: [{ argumentField: 'category', valueField: 'value', name: 'Distribution' }],
  },

  PolarChart: {
    dataSource: [
      { arg: 0, val: 80 }, { arg: 45, val: 65 }, { arg: 90, val: 90 },
      { arg: 135, val: 55 }, { arg: 180, val: 75 }, { arg: 225, val: 40 },
      { arg: 270, val: 85 }, { arg: 315, val: 60 },
    ],
    series: [{ argumentField: 'arg', valueField: 'val', type: 'line', name: 'Signal' }],
  },

  Funnel: {
    dataSource: [
      { argument: 'Raw Input', value: 1000 },
      { argument: 'After Intake', value: 850 },
      { argument: 'After Refinement', value: 720 },
      { argument: 'After Inspection', value: 680 },
      { argument: 'Final Output', value: 640 },
    ],
    argumentField: 'argument',
    valueField: 'value',
  },

  Sankey: {
    dataSource: [
      { source: 'Raw', target: 'Intake', weight: 100 },
      { source: 'Intake', target: 'Refine A', weight: 60 },
      { source: 'Intake', target: 'Refine B', weight: 40 },
      { source: 'Refine A', target: 'Output', weight: 55 },
      { source: 'Refine B', target: 'Output', weight: 38 },
    ],
    sourceField: 'source',
    targetField: 'target',
    weightField: 'weight',
  },

  TreeMap: {
    dataSource: [
      { name: 'Aurelia', value: null, items: [
        { name: 'A1', value: 320 }, { name: 'A2', value: 280 },
        { name: 'A3', value: 410 }, { name: 'A4', value: 190 },
      ]},
      { name: 'Ferrum', value: null, items: [
        { name: 'F1', value: 540 }, { name: 'F2', value: 370 },
        { name: 'F3', value: 460 },
      ]},
    ],
    labelField: 'name',
    valueField: 'value',
    childrenField: 'items',
  },

  Sparkline: {
    dataSource: [
      { x: 1, y: 40 }, { x: 2, y: 55 }, { x: 3, y: 38 }, { x: 4, y: 70 },
      { x: 5, y: 62 }, { x: 6, y: 80 }, { x: 7, y: 65 }, { x: 8, y: 90 },
    ],
    argumentField: 'x',
    valueField: 'y',
  },

  Bullet: {
    value: 72,
    target: 85,
    startScaleValue: 0,
    endScaleValue: 100,
  },

  BarGauge: {
    values: [42, 68, 85],
    startValue: 0,
    endValue: 100,
  },

  LinearGauge: {
    value: 65,
    subvalues: [40, 80],
  },

  CircularGauge: {
    value: 73,
    subvalues: [55],
  },

  RangeSelector: {
    dataSource: [
      { x: '2024-01', y: 120 }, { x: '2024-02', y: 145 }, { x: '2024-03', y: 132 },
      { x: '2024-04', y: 178 }, { x: '2024-05', y: 165 }, { x: '2024-06', y: 190 },
    ],
    chart: { series: { argumentField: 'x', valueField: 'y' } },
    value: ['2024-02', '2024-05'],
  },

  PivotGrid: {
    // PivotGrid requires a PivotGridDataSource — stub with empty for now
    dataSource: { fields: [], store: [] },
  },

  // ─── Editors (value / placeholder data) ──────────────────────────────────

  SelectBox: {
    dataSource: ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta'],
    value: 'Option Alpha',
  },
  TagBox: {
    dataSource: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'],
    value: ['Alpha', 'Beta'],
  },
  Lookup: {
    dataSource: ['Alpha Station', 'Beta Station', 'Gamma Station'],
    value: null,
  },
  Autocomplete: {
    dataSource: ['Alpha Station', 'Beta Station', 'Gamma Station', 'Delta Station'],
    value: '',
  },
  RadioGroup: {
    items: ['Option A', 'Option B', 'Option C'],
    value: 'Option A',
  },
  ButtonGroup: {
    items: [
      { key: 'left', text: 'Left', icon: 'alignleft' },
      { key: 'center', text: 'Center', icon: 'aligncenter' },
      { key: 'right', text: 'Right', icon: 'alignright' },
    ],
    keyExpr: 'key',
    selectedItemKeys: ['left'],
  },
  Slider: { value: 40, min: 0, max: 100 },
  RangeSlider: { value: [20, 70], min: 0, max: 100 },
  Switch: { value: true },
  CheckBox: { value: true, text: 'Enable feature' },
  TextBox: { value: 'Sample text', placeholder: 'Enter value...' },
  TextArea: { value: 'Sample text content\nSecond line', placeholder: 'Enter text...' },
  NumberBox: { value: 42, min: 0, max: 100 },
  ColorBox: { value: '#0078d4' },
  DateBox: { value: new Date() },
  DateRangeBox: { value: [new Date(Date.now() - 7*24*60*60*1000), new Date()] },
  Calendar: { value: new Date() },
  HtmlEditor: { value: '<p>Sample <strong>rich text</strong> content</p>' },
  Scheduler: {
    dataSource: [
      { text: 'Morning Review', startDate: new Date(new Date().setHours(9,0)), endDate: new Date(new Date().setHours(10,0)) },
      { text: 'Shift Handover', startDate: new Date(new Date().setHours(14,0)), endDate: new Date(new Date().setHours(15,0)) },
    ],
  },
  Gantt: {
    tasks: { dataSource: [
      { id: 1, parentId: 0, title: 'Planning', start: new Date(2024,0,1), end: new Date(2024,0,10), progress: 100 },
      { id: 2, parentId: 0, title: 'Execution', start: new Date(2024,0,11), end: new Date(2024,1,28), progress: 60 },
      { id: 3, parentId: 2, title: 'Phase A', start: new Date(2024,0,11), end: new Date(2024,1,1), progress: 100 },
      { id: 4, parentId: 2, title: 'Phase B', start: new Date(2024,1,2), end: new Date(2024,1,28), progress: 20 },
    ]},
  },
};

export default WIDGET_SAMPLE_DATA;
