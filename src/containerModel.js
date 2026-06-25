// Container data model — defaults, constants, factory functions

const DEFAULT_LAYOUT = {
  layoutType: 'flex',
  flexDirection: 'row',
  flexWrap: 'no wrap',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  gridColumns: 2,
  gridRows: 2,
  gridGap: '8px',
  gridCells: null,
  gridMergeDirection: 'horizontal', // 'horizontal' = merge side-by-side only, 'vertical' = merge top-bottom only
};

const DEFAULT_SLOT = {
  flexGrow: 0,
  flexShrink: 0,
  flexBasis: 'auto',
  alignSelf: 'auto',
  order: 0,
  width: '200px',
  height: '150px',
  minWidth: '',
  maxWidth: '',
  minHeight: '',
  maxHeight: '',
  // Box model
  paddingTop: '',
  paddingBottom: '',
  paddingLeft: '',
  paddingRight: '',
  marginTop: '',
  marginBottom: '',
  marginLeft: '',
  marginRight: '',
  borderWidth: '',
  borderStyle: '',
  borderColor: '',
  borderRadius: '',
  // Background
  backgroundColor: '',
  backgroundImage: '',
  backgroundSize: '',
  backgroundPosition: '',
  backgroundRepeat: '',
  // Typography
  color: '',
  fontSize: '',
  fontWeight: '',
  fontFamily: '',
  lineHeight: '',
  textAlign: '',
  letterSpacing: '',
};

// Compact default sizes per widget — swap out to taste
// Format: { width, height } in px
const WIDGET_DEFAULT_SIZES = {
  // Grids & Lists — need more height to show rows
  DataGrid:      { width: '400px', height: '250px' },
  TreeList:      { width: '400px', height: '250px' },
  List:          { width: '200px', height: '200px' },
  TreeView:      { width: '200px', height: '200px' },
  Gallery:       { width: '300px', height: '200px' },

  // Charts — square-ish by default
  Chart:         { width: '300px', height: '200px' },
  PieChart:      { width: '250px', height: '200px' },
  PolarChart:    { width: '250px', height: '200px' },
  Funnel:        { width: '250px', height: '200px' },
  Sankey:        { width: '300px', height: '200px' },
  TreeMap:       { width: '300px', height: '200px' },
  VectorMap:     { width: '300px', height: '200px' },
  Sparkline:     { width: '250px', height:  '60px' },
  Bullet:        { width: '250px', height:  '60px' },
  BarGauge:      { width: '250px', height: '200px' },
  LinearGauge:   { width: '100px', height: '220px' },
  CircularGauge: { width: '250px', height: '200px' },
  RangeSelector: { width: '300px', height: '200px' },
  PivotGrid:     { width: '400px', height: '250px' },

  // Editors — compact, inline-friendly
  TextBox:       { width: '250px', height:  '30px' },
  TextArea:      { width: '250px', height:  '80px' },
  NumberBox:     { width: '250px', height:  '30px' },
  CheckBox:      { width: '250px', height:  '30px' },
  SelectBox:     { width: '250px', height:  '30px' },
  TagBox:        { width: '250px', height:  '30px' },
  Lookup:        { width: '250px', height:  '30px' },
  Autocomplete:  { width: '250px', height:  '30px' },
  DropDownBox:   { width: '250px', height:  '30px' },
  DateBox:       { width: '250px', height:  '30px' },
  DateRangeBox:  { width: '300px', height:  '40px' },
  ColorBox:      { width: '250px', height:  '30px' },
  Slider:        { width: '250px', height:  '30px' },
  RangeSlider:   { width: '250px', height:  '30px' },
  Switch:        { width: '100px', height:  '36px' },
  RadioGroup:    { width: '250px', height: '100px' },
  ButtonGroup:   { width: '250px', height:  '36px' },
  Calendar:      { width: '260px', height: '240px' },
  HtmlEditor:    { width: '300px', height: '200px' },
  FileUploader:  { width: '300px', height: '100px' },
  Form:          { width: '300px', height: '200px' },

  // Scheduling
  Scheduler:     { width: '480px', height: '320px' },
  Gantt:         { width: '480px', height: '280px' },

  // Misc
  Button:        { width: '120px', height:  '36px' },
  Popup:         { width: '300px', height: '200px' },
};

const DEFAULT_WIDGET_SIZE = { width: '200px', height: '150px' };

function getWidgetDefaultSlot(widgetName) {
  const size = WIDGET_DEFAULT_SIZES[widgetName] || DEFAULT_WIDGET_SIZE;
  return { ...DEFAULT_SLOT, ...size, flexBasis: 'auto', flexGrow: 0, flexShrink: 0 };
}

const DEFAULT_COORD = {
  left: 0,
  top: 0,
  right: '',
  bottom: '',
  width: 150,
  height: 100,
  minWidth: '',
  maxWidth: '',
  minHeight: '',
  maxHeight: '',
  unit: 'px',
};

const CONTAINER_BASE_NAME = 'Container';

function getNextContainerName(containers) {
  // Collect all titles in the entire tree
  const allTitles = new Set();
  const collect = (nodes) => nodes.forEach(c => {
    allTitles.add(c.title);
    collect(c.children);
  });
  collect(containers);

  // Find the lowest available number
  let i = 1;
  while (true) {
    const candidate = `${CONTAINER_BASE_NAME}${String(i).padStart(2, '0')}`;
    if (!allTitles.has(candidate)) return candidate;
    i++;
  }
}

let nextContainerId = 2; // 1 is reserved for root
export function getNextId() { return nextContainerId++; }
const ROOT_CONTAINER_ID = 1;

function makeContainer(parentId = null, name = 'Container') {
  return {
    id: getNextId(),
    title: name,
    parentId,
    children: [],
    layout: { ...DEFAULT_LAYOUT },
    slot: { ...DEFAULT_SLOT, flexGrow: 1, flexShrink: 1, width: '', height: '', flexBasis: '0' },
    coord: { ...DEFAULT_COORD },
    locked: false,
  };
}

function makeRootContainer() {
  return {
    id: ROOT_CONTAINER_ID,
    title: 'Page',
    parentId: null,
    children: [],
    layout: { ...DEFAULT_LAYOUT },
    slot: { ...DEFAULT_SLOT },
    coord: { ...DEFAULT_COORD },
    pageType: 'fit',
    locked: false,
  };
}

const BASE_TIER_ID = 'desktop'; // default/base breakpoint tier

export {
  DEFAULT_LAYOUT, DEFAULT_SLOT, DEFAULT_COORD,
  WIDGET_DEFAULT_SIZES, DEFAULT_WIDGET_SIZE,
  CONTAINER_BASE_NAME, ROOT_CONTAINER_ID, BASE_TIER_ID,
  getWidgetDefaultSlot, getNextContainerName,
  makeContainer, makeRootContainer, toHtmlId,
};

function toHtmlId(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}


