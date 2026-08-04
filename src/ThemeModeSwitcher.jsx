// ThemeModeSwitcher.jsx
// Icon-only ButtonGroup toggling between the Theme workspace's two modes. Rendered
// anchored left, inline with each left-panel's search box (see DataListGrid's
// `toolbarExtra` prop) rather than as its own separate header row.
//
// Icon names below are placeholders — swap `icon:` for whatever fits once decided.

import React from 'react';
import { ButtonGroup } from 'devextreme-react/button-group';

const MODE_ITEMS = [
  { key: 'palettes',   icon: 'chart',       hint: 'Data Palettes'  },
  { key: 'baseThemes', icon: 'preferences', hint: 'Base UI Themes' },
];

export default function ThemeModeSwitcher({ mode, setMode }) {
  return (
    <ButtonGroup
      items={MODE_ITEMS}
      keyExpr="key"
      selectedItemKeys={[mode]}
      onSelectionChanged={(e) => {
        const key = e.addedItems?.[0]?.key;
        if (key) setMode(key);
      }}
      stylingMode="outlined"
    />
  );
}
