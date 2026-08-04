// BaseThemeGallery.jsx
// Left-panel list of DevExtreme's named base UI themes (widget chrome) + the SHARED
// widget gallery preview (see themeGalleryHtml.js / GalleryPreviewFrame.jsx) with the
// base theme CSS swapped per selection and the palette held at a fixed default.

import React, { useState, useMemo } from 'react';
import DataListGrid from './DataListGrid';
import GalleryPreviewFrame from './GalleryPreviewFrame';
import ThemeModeSwitcher from './ThemeModeSwitcher';
import { CDN_CSS_BASE, DEFAULT_PALETTE_NAME } from './themeGalleryHtml';

// ─────────────────────────────────────────────────────────────────────────────
// Curated catalog — file names verified against cdnjs' devextreme-dist listing.
// Generic family drops the "generic" segment in the filename (dx.<scheme>.css).
// ─────────────────────────────────────────────────────────────────────────────

const BASE_THEME_DEFS = [
  { name: 'Generic Light',       family: 'Generic', file: 'dx.light.css' },
  { name: 'Generic Dark',        family: 'Generic', file: 'dx.dark.css' },
  { name: 'Generic Contrast',    family: 'Generic', file: 'dx.contrast.css' },
  { name: 'Generic Carmine',     family: 'Generic', file: 'dx.carmine.css' },
  { name: 'Generic Dark Moon',   family: 'Generic', file: 'dx.darkmoon.css' },
  { name: 'Generic Dark Violet', family: 'Generic', file: 'dx.darkviolet.css' },
  { name: 'Generic Green Mist',  family: 'Generic', file: 'dx.greenmist.css' },
  { name: 'Generic Soft Blue',   family: 'Generic', file: 'dx.softblue.css' },

  { name: 'Material Blue Light',   family: 'Material', file: 'dx.material.blue.light.css' },
  { name: 'Material Blue Dark',    family: 'Material', file: 'dx.material.blue.dark.css' },
  { name: 'Material Lime Light',   family: 'Material', file: 'dx.material.lime.light.css' },
  { name: 'Material Lime Dark',    family: 'Material', file: 'dx.material.lime.dark.css' },
  { name: 'Material Orange Light', family: 'Material', file: 'dx.material.orange.light.css' },
  { name: 'Material Orange Dark',  family: 'Material', file: 'dx.material.orange.dark.css' },
  { name: 'Material Purple Light', family: 'Material', file: 'dx.material.purple.light.css' },
  { name: 'Material Purple Dark',  family: 'Material', file: 'dx.material.purple.dark.css' },
  { name: 'Material Teal Light',   family: 'Material', file: 'dx.material.teal.light.css' },
  { name: 'Material Teal Dark',    family: 'Material', file: 'dx.material.teal.dark.css' },

  { name: 'Fluent Blue Light', family: 'Fluent', file: 'dx.fluent.blue.light.css' },
  { name: 'Fluent Blue Dark',  family: 'Fluent', file: 'dx.fluent.blue.dark.css' },
  { name: 'Fluent Saas Light', family: 'Fluent', file: 'dx.fluent.saas.light.css' },
  { name: 'Fluent Saas Dark',  family: 'Fluent', file: 'dx.fluent.saas.dark.css' },
];

// Every DevExtreme theme also ships a "Compact" density variant — smaller control
// sizes and spacing (dx.<theme>.compact.css). Mirrors the reference ThemeBuilder
// page, which lists each theme twice: normal and Compact.
function withCompactVariants(defs) {
  const out = [];
  defs.forEach(def => {
    out.push({ ...def, compact: false });
    out.push({
      ...def,
      name: `${def.name} Compact`,
      file: def.file.replace('.css', '.compact.css'),
      compact: true,
    });
  });
  return out;
}

const BASE_THEMES = withCompactVariants(BASE_THEME_DEFS);

const FAMILY_COLORS = { Generic: '#607d8b', Material: '#7b5fd1', Fluent: '#0078d4' };

function makeColumns() {
  const nameCellRender = (cellInfo) => {
    const theme = cellInfo.data;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: FAMILY_COLORS[theme.family], flexShrink: 0 }} />
        <span style={{ fontSize: 12 }}>{theme.name}</span>
      </div>
    );
  };
  return [
    { dataField: 'name',   caption: 'Theme',  cellRender: nameCellRender, minWidth: 160 },
    { dataField: 'family', caption: 'Family', width: 80 },
  ];
}

export default function BaseThemeGallery({ mode, setMode }) {
  const [selectedName, setSelectedName] = useState(BASE_THEMES[0].name);
  const columns = useMemo(() => makeColumns(), []);

  const selectedTheme = BASE_THEMES.find(t => t.name === selectedName) || BASE_THEMES[0];
  const cssUrl = `${CDN_CSS_BASE}/${selectedTheme.file}`;

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* ── Left: theme list ─────────────────────────────────────────────────── */}
      <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DataListGrid
            items={BASE_THEMES}
            columns={columns}
            keyExpr="name"
            selectedId={selectedName}
            onSelect={(id) => id && setSelectedName(id)}
            searchEnabled={true}
            noDataText="No themes."
            toolbarExtra={<ThemeModeSwitcher mode={mode} setMode={setMode} />}
          />
        </div>
      </div>

      {/* ── Right: shared gallery preview — theme varies, palette fixed ────────── */}
      <div style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <GalleryPreviewFrame cssUrl={cssUrl} paletteName={DEFAULT_PALETTE_NAME} frameKey={selectedName} />
      </div>

    </div>
  );
}
