// designer/widgets/WidgetPropertiesPreview.jsx
// The open widget as a page builder will meet it: the widget itself (with
// its sample data) and, under it, its details panel — both drawn by the
// components the Screens editor uses (WidgetPreview, WidgetPropertyGrid,
// WidgetPropertyField), from the unsaved draft. Values typed into the
// details panel here only drive the preview; nothing is saved.

import { useState } from 'react';
import WidgetPreview from '../../WidgetPreview';
import { expandDotPaths } from '../screens/widgetBindings';
import { WidgetPropertyField, WidgetPropertyGrid } from './WidgetPropertyField';

export function WidgetPropertiesPreview({ widgetName, defs }) {
  // Try-out values, per widget, kept while the area is open.
  const [tryValues, setTryValues] = useState({});
  const values = tryValues[widgetName] || {};
  const setValue = (name, value) => setTryValues(all => ({ ...all, [widgetName]: { ...(all[widgetName] || {}), [name]: value } }));

  // Defaults, then anything tried. Collections ('data') are left out so the
  // widget keeps its sample rows — an empty default would blank it.
  const props = {};
  defs.forEach(d => {
    if (d.type === 'data') return;
    const v = d.name in values ? values[d.name] : d.default;
    if (v !== undefined) props[d.name] = v;
  });

  return (
    <div className="widgets-preview">
      <div className="widgets-panel-head">
        <span className="widgets-panel-title">Preview</span>
        {Object.keys(values).length > 0 && (
          <button className="focus-mode-btn" onClick={() => setTryValues(all => ({ ...all, [widgetName]: {} }))}>Clear values</button>
        )}
      </div>
      <div className="widgets-preview-widget">
        <WidgetPreview key={widgetName} widgetName={widgetName} widgetProps={expandDotPaths(props)} />
      </div>
      <div className="widgets-preview-details">
        <div className="widgets-preview-caption">Details panel — try values here; they aren’t saved</div>
        {defs.length > 0 ? (
          <WidgetPropertyGrid
            title={widgetName}
            defs={defs}
            renderControl={(def) => (
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%', minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <WidgetPropertyField def={def} value={values[def.name]} onChange={v => setValue(def.name, v)} />
                </div>
                {def.bindable !== false && (
                  <button className="binding-icon-btn" disabled title="Bindable on a screen">⚡</button>
                )}
              </div>
            )}
          />
        ) : (
          <div className="widgets-note">Nothing exposed — the Screens designer won’t show a {widgetName} tab.</div>
        )}
      </div>
    </div>
  );
}
