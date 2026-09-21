// designer/WidgetsWorkspace.jsx
// The Widgets area: a reference browser for the widget catalog. Pick a
// widget on the left to see its full configuration (center) and the
// property definitions the Screens editor offers for it (right).
// Nothing here is saved. Moved out of App.js; the selection now belongs to
// this area, so it starts empty each time the area opens.

import { useState } from 'react';
import { Splitter, TabPanel } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import HierarchyTree from '../HierarchyTree';
import WidgetConfigPanel from '../WidgetConfigPanel';
import { DX_WIDGET_DATA, WIDGET_PROPERTIES } from '../widgetData';
import { WidgetTreeItemTemplate } from './screens/ScreensLeftPanel';

export function WidgetsWorkspace() {
  const [selectedWidgetName, setSelectedWidgetName] = useState(null);
  return (
    <Splitter orientation="horizontal" style={{ height: '100%' }}>
      <SplitterItem size="220px" minSize="120px" resizable={true}>
        <div className="app-panel">
          <TabPanel
            height="100%"
            animationEnabled={false}
            swipeEnabled={false}
          >
            <TabPanelItem title="Widgets">
              <div className="left-panel-tab-content">
                <HierarchyTree
                  dataSource={DX_WIDGET_DATA}
                  displayExpr="name"
                  itemRender={(item) => WidgetTreeItemTemplate(item, null)}
                  selectedId={selectedWidgetName}
                  onSelect={(id) => {
                    const item = DX_WIDGET_DATA.find(w => w.id === id);
                    setSelectedWidgetName(item?.assetLevel === 'widget' ? item.name : null);
                  }}
                />
              </div>
            </TabPanelItem>
          </TabPanel>
        </div>
      </SplitterItem>
      <SplitterItem resizable={true}>
        <div className="app-panel app-panel--center" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedWidgetName ? (
            <WidgetConfigPanel widgetName={selectedWidgetName} />
          ) : (
            <p className="step-instructions" style={{ padding: 16 }}>Select a widget to view its full configuration.</p>
          )}
        </div>
      </SplitterItem>
      <SplitterItem size="220px" minSize="120px" resizable={true}>
        <div className="app-panel details-panel aetherium-canvas-scroll">
          <p className="panel-label">Details</p>
          {selectedWidgetName ? (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 4px' }}>{selectedWidgetName}</p>
              {WIDGET_PROPERTIES[selectedWidgetName] ? (
                <pre style={{ fontSize: 11, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
                  {JSON.stringify(WIDGET_PROPERTIES[selectedWidgetName], null, 2)}
                </pre>
              ) : (
                <p style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No Entry</p>
              )}
            </>
          ) : (
            <p className="step-instructions">Select a widget to view its properties.</p>
          )}
        </div>
      </SplitterItem>
    </Splitter>
  );
}
