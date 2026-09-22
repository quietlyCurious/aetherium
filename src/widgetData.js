// widgetData.js
// The widget catalog: every widget the designer offers, by category. The
// properties each one exposes live in widgetProperties.js.

const DX_WIDGET_DATA = [

{ id: 'grids', parentId: null, name: 'Grids & Lists', assetType: 'category', assetLevel: 'category' },
{ id: 'charts', parentId: null, name: 'Charts & Visualization', assetType: 'category', assetLevel: 'category' },
{ id: 'editors', parentId: null, name: 'Editors', assetType: 'category', assetLevel: 'category' },
{ id: 'navigation', parentId: null, name: 'Navigation', assetType: 'category', assetLevel: 'category' },
{ id: 'layout', parentId: null, name: 'Layout', assetType: 'category', assetLevel: 'category' },
{ id: 'dialogs', parentId: null, name: 'Dialogs & Notifications', assetType: 'category', assetLevel: 'category' },
{ id: 'scheduling', parentId: null, name: 'Scheduling', assetType: 'category', assetLevel: 'category' },
{ id: 'misc', parentId: null, name: 'Miscellaneous', assetType: 'category', assetLevel: 'category' },

// Grids & Lists
{ id: 'dx-datagrid', parentId: 'grids', name: 'DataGrid', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-treelist', parentId: 'grids', name: 'TreeList', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-cardview', parentId: 'grids', name: 'CardView', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-list', parentId: 'grids', name: 'List', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-treeview', parentId: 'grids', name: 'TreeView', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-gallery', parentId: 'grids', name: 'Gallery', assetType: 'widget', assetLevel: 'widget' },

// Charts & Visualization
{ id: 'dx-chart', parentId: 'charts', name: 'Chart', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-piechart', parentId: 'charts', name: 'PieChart', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-polarchart', parentId: 'charts', name: 'PolarChart', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-funnel', parentId: 'charts', name: 'Funnel', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-sankey', parentId: 'charts', name: 'Sankey', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-treemap', parentId: 'charts', name: 'TreeMap', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-vectormap', parentId: 'charts', name: 'VectorMap', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-sparkline', parentId: 'charts', name: 'Sparkline', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-bullet', parentId: 'charts', name: 'Bullet', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-bargauge', parentId: 'charts', name: 'BarGauge', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-lineargauge', parentId: 'charts', name: 'LinearGauge', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-circulargauge', parentId: 'charts', name: 'CircularGauge', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-rangeselector', parentId: 'charts', name: 'RangeSelector', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-pivotgrid', parentId: 'charts', name: 'PivotGrid', assetType: 'widget', assetLevel: 'widget' },

// Editors
{ id: 'dx-textbox', parentId: 'editors', name: 'TextBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-textarea', parentId: 'editors', name: 'TextArea', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-numberbox', parentId: 'editors', name: 'NumberBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-checkbox', parentId: 'editors', name: 'CheckBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-selectbox', parentId: 'editors', name: 'SelectBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-tagbox', parentId: 'editors', name: 'TagBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-lookup', parentId: 'editors', name: 'Lookup', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-autocomplete', parentId: 'editors', name: 'Autocomplete', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-dropdownbox', parentId: 'editors', name: 'DropDownBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-datebox', parentId: 'editors', name: 'DateBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-daterangebox', parentId: 'editors', name: 'DateRangeBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-colorbox', parentId: 'editors', name: 'ColorBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-slider', parentId: 'editors', name: 'Slider', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-rangeslider', parentId: 'editors', name: 'RangeSlider', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-switch', parentId: 'editors', name: 'Switch', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-radiogroup', parentId: 'editors', name: 'RadioGroup', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-buttongroup', parentId: 'editors', name: 'ButtonGroup', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-calendar', parentId: 'editors', name: 'Calendar', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-htmleditor', parentId: 'editors', name: 'HtmlEditor', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-fileuploader', parentId: 'editors', name: 'FileUploader', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-form', parentId: 'editors', name: 'Form', assetType: 'widget', assetLevel: 'widget' },

// Navigation
{ id: 'dx-menu', parentId: 'navigation', name: 'Menu', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-contextmenu', parentId: 'navigation', name: 'ContextMenu', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-accordion', parentId: 'navigation', name: 'Accordion', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-tabs', parentId: 'navigation', name: 'Tabs', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-tabpanel', parentId: 'navigation', name: 'TabPanel', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-multiview', parentId: 'navigation', name: 'MultiView', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-toolbar', parentId: 'navigation', name: 'Toolbar', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-pagination', parentId: 'navigation', name: 'Pagination', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-stepper', parentId: 'navigation', name: 'Stepper', assetType: 'widget', assetLevel: 'widget' },

// Layout
{ id: 'dx-box', parentId: 'layout', name: 'Box', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-responsivebox', parentId: 'layout', name: 'ResponsiveBox', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-splitter', parentId: 'layout', name: 'Splitter', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-scrollview', parentId: 'layout', name: 'ScrollView', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-resizable', parentId: 'layout', name: 'Resizable', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-draggable', parentId: 'layout', name: 'Draggable', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-sortable', parentId: 'layout', name: 'Sortable', assetType: 'widget', assetLevel: 'widget' },

// Dialogs & Notifications
{ id: 'dx-popup', parentId: 'dialogs', name: 'Popup', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-popover', parentId: 'dialogs', name: 'Popover', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-tooltip', parentId: 'dialogs', name: 'Tooltip', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-toast', parentId: 'dialogs', name: 'Toast', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-loadpanel', parentId: 'dialogs', name: 'LoadPanel', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-loadindicator', parentId: 'dialogs', name: 'LoadIndicator', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-progressbar', parentId: 'dialogs', name: 'ProgressBar', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-actionsheet', parentId: 'dialogs', name: 'ActionSheet', assetType: 'widget', assetLevel: 'widget' },

// Scheduling
{ id: 'dx-scheduler', parentId: 'scheduling', name: 'Scheduler', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-gantt', parentId: 'scheduling', name: 'Gantt', assetType: 'widget', assetLevel: 'widget' },

// Miscellaneous
{ id: 'dx-button', parentId: 'misc', name: 'Button', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-dropdownbutton', parentId: 'misc', name: 'DropDownButton', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-speeddialalction', parentId: 'misc', name: 'SpeedDialAction', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-map', parentId: 'misc', name: 'Map', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-filemanager', parentId: 'misc', name: 'FileManager', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-diagram', parentId: 'misc', name: 'Diagram', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-chat', parentId: 'misc', name: 'Chat', assetType: 'widget', assetLevel: 'widget' },
{ id: 'dx-speechtotext', parentId: 'misc', name: 'SpeechToText', assetType: 'widget', assetLevel: 'widget' },

];

export { DX_WIDGET_DATA };
