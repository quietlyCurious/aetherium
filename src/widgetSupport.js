// widgetSupport.js
// The widgets the screen builder can't place yet, and why. A widget listed
// here is shown in the Visuals tree but marked and not draggable, so nobody
// drops something that renders as a placeholder — and so the gap stays
// visible rather than quietly missing.
//
// Read by the Visuals tree (designer/screens/ScreensLeftPanel) and the
// Widgets area's list. Everything NOT listed here is expected to have a
// component in WidgetPreview's WIDGET_COMPONENT_MAP; widgetCoverage.test.js
// keeps the two in step.
//
// These aren't permanent. Each kind describes what it would take:
//   overlay    screens need a trigger/action concept first — an overlay
//              draws nothing until something opens it
//   layout     these lay out children, and a widget is a leaf on a screen;
//              Aetherium's own containers already do this job
//   behaviour  not a visual at all — it adds dragging or resizing to
//              something else
//   service    needs a backend, an API key or data the app doesn't have
export const WIDGET_SUPPORT_KINDS = {
  overlay: 'Opens over the screen, so there’s nothing to draw until something triggers it — screens have no actions yet',
  layout: 'Lays out child elements; Aetherium’s own containers do that, and a widget can’t hold children',
  behaviour: 'Adds behaviour (dragging, resizing) to other elements rather than drawing anything itself',
  service: 'Needs a backend service, API key or map data the app doesn’t have',
};

export const UNSUPPORTED_WIDGETS = {
  // Dialogs & Notifications
  Popup: 'overlay',
  Popover: 'overlay',
  Tooltip: 'overlay',
  Toast: 'overlay',
  LoadPanel: 'overlay',
  ActionSheet: 'overlay',
  ContextMenu: 'overlay',
  // Layout
  Box: 'layout',
  ResponsiveBox: 'layout',
  Splitter: 'layout',
  ScrollView: 'layout',
  Resizable: 'behaviour',
  Draggable: 'behaviour',
  Sortable: 'behaviour',
  // Miscellaneous
  SpeedDialAction: 'overlay',
  Map: 'service',
  FileManager: 'service',
  Diagram: 'service',
  Chat: 'service',
  SpeechToText: 'service',
  VectorMap: 'service',
};

// null when the widget can be placed, else { kind, reason }.
export function widgetSupport(widgetName) {
  const kind = UNSUPPORTED_WIDGETS[widgetName];
  return kind ? { kind, reason: WIDGET_SUPPORT_KINDS[kind] } : null;
}

export function isWidgetPlaceable(widgetName) {
  return !UNSUPPORTED_WIDGETS[widgetName];
}
