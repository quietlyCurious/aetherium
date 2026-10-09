import React from 'react';

// DevExtreme widget imports
import DataGrid from 'devextreme-react/data-grid';
import TreeList from 'devextreme-react/tree-list';
import { List } from 'devextreme-react/list';
import { TreeView } from 'devextreme-react/tree-view';
import Gallery from 'devextreme-react/gallery';
import Chart from 'devextreme-react/chart';
import PieChart from 'devextreme-react/pie-chart';
import PolarChart from 'devextreme-react/polar-chart';
import Funnel from 'devextreme-react/funnel';
import Sankey from 'devextreme-react/sankey';
import TreeMap from 'devextreme-react/tree-map';
import Sparkline from 'devextreme-react/sparkline';
import Bullet from 'devextreme-react/bullet';
import BarGauge from 'devextreme-react/bar-gauge';
import LinearGauge from 'devextreme-react/linear-gauge';
import CircularGauge from 'devextreme-react/circular-gauge';
import RangeSelector from 'devextreme-react/range-selector';
import PivotGrid from 'devextreme-react/pivot-grid';
import TextBox from 'devextreme-react/text-box';
import TextArea from 'devextreme-react/text-area';
import NumberBox from 'devextreme-react/number-box';
import CheckBox from 'devextreme-react/check-box';
import { SelectBox } from 'devextreme-react/select-box';
import TagBox from 'devextreme-react/tag-box';
import Lookup from 'devextreme-react/lookup';
import Autocomplete from 'devextreme-react/autocomplete';
import DropDownBox from 'devextreme-react/drop-down-box';
import DateBox from 'devextreme-react/date-box';
import DateRangeBox from 'devextreme-react/date-range-box';
import ColorBox from 'devextreme-react/color-box';
import Slider from 'devextreme-react/slider';
import RangeSlider from 'devextreme-react/range-slider';
import Switch from 'devextreme-react/switch';
import RadioGroup from 'devextreme-react/radio-group';
import ButtonGroup from 'devextreme-react/button-group';
import Calendar from 'devextreme-react/calendar';
import HtmlEditor from 'devextreme-react/html-editor';
import FileUploader from 'devextreme-react/file-uploader';
import Form from 'devextreme-react/form';
import Scheduler from 'devextreme-react/scheduler';
import Gantt from 'devextreme-react/gantt';
import CardView from 'devextreme-react/card-view';
import Menu from 'devextreme-react/menu';
import Accordion from 'devextreme-react/accordion';
import Tabs from 'devextreme-react/tabs';
import TabPanel from 'devextreme-react/tab-panel';
import MultiView from 'devextreme-react/multi-view';
import Toolbar from 'devextreme-react/toolbar';
import Pagination from 'devextreme-react/pagination';
import Stepper from 'devextreme-react/stepper';
import Button from 'devextreme-react/button';
import DropDownButton from 'devextreme-react/drop-down-button';
import ProgressBar from 'devextreme-react/progress-bar';
import LoadIndicator from 'devextreme-react/load-indicator';

import WIDGET_SAMPLE_DATA from './widgetSampleData';
import { CUSTOM_WIDGETS } from './customWidgets/customWidgets';

const WIDGET_COMPONENT_MAP = {
  DataGrid: (props) => <DataGrid {...props} />,
  TreeList: (props) => <TreeList {...props} />,
  List: (props) => <List {...props} />,
  TreeView: (props) => <TreeView {...props} />,
  Gallery: (props) => <Gallery {...props} />,
  Chart: (props) => <Chart {...props} />,
  PieChart: (props) => <PieChart {...props} />,
  PolarChart: (props) => <PolarChart {...props} />,
  Funnel: (props) => <Funnel {...props} />,
  Sankey: (props) => <Sankey {...props} />,
  TreeMap: (props) => <TreeMap {...props} />,
  Sparkline: (props) => <Sparkline {...props} />,
  Bullet: (props) => <Bullet {...props} />,
  BarGauge: (props) => <BarGauge {...props} />,
  LinearGauge: (props) => <LinearGauge {...props} />,
  CircularGauge: (props) => <CircularGauge {...props} />,
  RangeSelector: (props) => <RangeSelector {...props} />,
  PivotGrid: (props) => <PivotGrid {...props} />,
  TextBox: (props) => <TextBox {...props} />,
  TextArea: (props) => <TextArea {...props} />,
  NumberBox: (props) => <NumberBox {...props} />,
  CheckBox: (props) => <CheckBox {...props} />,
  SelectBox: (props) => <SelectBox {...props} />,
  TagBox: (props) => <TagBox {...props} />,
  Lookup: (props) => <Lookup {...props} />,
  Autocomplete: (props) => <Autocomplete {...props} />,
  DropDownBox: (props) => <DropDownBox {...props} />,
  DateBox: (props) => <DateBox {...props} />,
  DateRangeBox: (props) => <DateRangeBox {...props} />,
  ColorBox: (props) => <ColorBox {...props} />,
  Slider: (props) => <Slider {...props} />,
  RangeSlider: (props) => <RangeSlider {...props} />,
  Switch: (props) => <Switch {...props} />,
  RadioGroup: (props) => <RadioGroup {...props} />,
  ButtonGroup: (props) => <ButtonGroup {...props} />,
  Calendar: (props) => <Calendar {...props} />,
  HtmlEditor: (props) => <HtmlEditor {...props} />,
  FileUploader: (props) => <FileUploader {...props} />,
  Form: (props) => <Form {...props} />,
  Scheduler: (props) => <Scheduler {...props} />,
  Gantt: (props) => <Gantt {...props} />,
  CardView: (props) => <CardView {...props} />,
  Menu: (props) => <Menu {...props} />,
  Accordion: (props) => <Accordion {...props} />,
  Tabs: (props) => <Tabs {...props} />,
  TabPanel: (props) => <TabPanel {...props} />,
  MultiView: (props) => <MultiView {...props} />,
  Toolbar: (props) => <Toolbar {...props} />,
  Pagination: (props) => <Pagination {...props} />,
  Stepper: (props) => <Stepper {...props} />,
  Button: (props) => <Button {...props} />,
  DropDownButton: (props) => <DropDownButton {...props} />,
  ProgressBar: (props) => <ProgressBar {...props} />,
  LoadIndicator: (props) => <LoadIndicator {...props} />,
  // Aetherium's own widgets (customWidgets/customWidgets.js).
  ...Object.fromEntries(Object.entries(CUSTOM_WIDGETS).map(([name, { component: Component }]) => [name, (props) => <Component {...props} />])),
};

// Sample-data keys that describe the SHAPE of the sample dataset itself
// (which columns/series it has), not just cosmetic defaults. These only make
// sense paired with the sample's OWN dataSource — if a real, bound
// dataSource is present instead, keeping these causes real problems:
//  - DataGrid/TreeList stop auto-generating columns entirely once an
//    explicit `columns` prop is set, even a stale one from placeholder data,
//    so the real data's actual fields go unrepresented.
//  - Chart/PieChart/PolarChart: an explicit `series` array takes priority
//    over `seriesTemplate` whenever both are present — confirmed directly
//    against the real sample data, which hardcodes `series` referencing
//    fields (month/production/target) that don't exist in any real query
//    result. That silently blocked seriesTemplate from ever taking effect,
//    regardless of how correctly it was configured.
// Stripped out per-widget whenever real data exists, letting DevExtreme's
// own auto-generation/seriesTemplate take over instead.
const SHAPE_DEPENDENT_SAMPLE_KEYS = {
  DataGrid: ['columns'],
  TreeList: ['columns'],
  CardView: ['columns'],
  Chart: ['series'],
  PieChart: ['series'],
  PolarChart: ['series'],
  // The item-based widgets take EITHER items or dataSource, and `items`
  // wins in DevExtreme — so a sample's items would quietly hide a bound
  // dataSource, the same trap the grids' columns had.
  Menu: ['items'],
  Accordion: ['items'],
  Tabs: ['items'],
  TabPanel: ['items'],
  MultiView: ['items'],
  Toolbar: ['items'],
  Stepper: ['items'],
  DropDownButton: ['items'],
};

function hasRealCollectionData(value) {
  return Array.isArray(value) && value.length > 0;
}

function WidgetPreview({ widgetName, widgetProps, style }) {
  const renderFn = WIDGET_COMPONENT_MAP[widgetName];

  if (!renderFn) {
    return (
      <div className="widget-placeholder">
        <i className="dx-icon-datapie widget-placeholder-icon" />
      </div>
    );
  }

  const sampleData = WIDGET_SAMPLE_DATA[widgetName] || {};

  // If this widget's primary data prop has real, bound data (not just the
  // empty-array default), drop any sample keys that describe the sample's
  // own shape — they'd otherwise silently win the merge below, since
  // nothing in widgetProps ever explicitly overrides them.
  const shapeKeysToStrip = SHAPE_DEPENDENT_SAMPLE_KEYS[widgetName] || [];
  const usingRealData = hasRealCollectionData(widgetProps?.dataSource) || hasRealCollectionData(widgetProps?.values);
  const effectiveSampleData = usingRealData
    ? Object.fromEntries(Object.entries(sampleData).filter(([key]) => !shapeKeysToStrip.includes(key)))
    : sampleData;

  const mergedProps = { ...effectiveSampleData, ...widgetProps, width: '100%', height: '100%' };

  // Grids and lists key rows by 'id' (their sample data's, and their
  // property default). Real rows often have no 'id' column, and DevExtreme
  // then shows "E1046 – The 'id' key field is not found" over the data. With
  // real rows that lack the key field, key rows by the row object instead.
  const rows = mergedProps.dataSource;
  if (usingRealData && typeof mergedProps.keyExpr === 'string' && Array.isArray(rows)
      && rows[0] && typeof rows[0] === 'object' && !Object.prototype.hasOwnProperty.call(rows[0], mergedProps.keyExpr)) {
    delete mergedProps.keyExpr;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, flex: 1, ...style }}>
      {renderFn(mergedProps)}
    </div>
  );
}

export { WIDGET_COMPONENT_MAP };
export default WidgetPreview;
