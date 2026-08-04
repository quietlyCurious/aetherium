// ThemeWorkspace.jsx
// Top-level Theme workspace with two modes, sharing ONE widget gallery (see
// themeGalleryHtml.js / GalleryPreviewFrame.jsx) so both feel like the same
// experience and any layout change to the gallery only needs to happen once:
//
//   - Data Palettes   — base theme CSS held fixed (neutral), palette varies.
//                        Uses DevExtreme's DATA-VISUALIZATION series palettes,
//                        pulled at runtime via the real `getPalette` API.
//   - Base UI Themes  — palette held fixed, base theme CSS (widget chrome) varies.
//                        Rendered in an isolated iframe since these CSS files are
//                        globally-scoped and would otherwise collide with
//                        Aetherium's own chrome.

import React, { useState, useMemo } from 'react';
import DataListGrid from './DataListGrid';
import ThemeModeSwitcher from './ThemeModeSwitcher';
import GalleryPreviewFrame from './GalleryPreviewFrame';
import BaseThemeGallery from './BaseThemeGallery';
import { DEFAULT_NEUTRAL_CSS_URL } from './themeGalleryHtml';

let getPaletteFn = null;
try {
  // eslint-disable-next-line global-require
  getPaletteFn = require('devextreme/viz/palette').getPalette;
} catch {
  getPaletteFn = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette catalog — official DevExtreme data-viz palette names
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE_NAMES = [
  'Material', 'Soft Pastel', 'Harmony Light', 'Pastel', 'Bright', 'Soft',
  'Ocean', 'Office', 'Vintage', 'Violet', 'Carmine', 'Dark Moon', 'Soft Blue',
  'Dark Violet', 'Green Mist',
];

// Safety-net fallback if the runtime API is unavailable for some reason —
// approximate, only ever used if getPalette() throws or returns nothing.
const FALLBACK_COLORS = [
  '#1db2f5', '#f5564a', '#97c95c', '#ffc439', '#eb3573', '#a36aff', '#27d4c6', '#ff8746',
];

function getPaletteColors(name) {
  if (getPaletteFn) {
    try {
      const result = getPaletteFn(name);
      if (Array.isArray(result)) return result;
      if (result?.simpleSet && Array.isArray(result.simpleSet)) return result.simpleSet;
    } catch {
      // fall through to fallback
    }
  }
  return FALLBACK_COLORS;
}

// ─────────────────────────────────────────────────────────────────────────────
// List grid columns — palette name + live swatch strip
// ─────────────────────────────────────────────────────────────────────────────

function makePaletteColumns() {
  const nameCellRender = (cellInfo) => {
    const name = cellInfo.data.name;
    const colors = getPaletteColors(name);
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
        <span style={{ fontSize: 12, flexShrink: 0 }}>{name}</span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {colors.slice(0, 8).map((c, i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c, flexShrink: 0 }} />
          ))}
        </div>
      </div>
    );
  };
  return [
    { dataField: 'name', caption: 'Palette', cellRender: nameCellRender, minWidth: 220 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Palettes mode
// ─────────────────────────────────────────────────────────────────────────────

function DataPalettesMode({ mode, setMode }) {
  const [selectedName, setSelectedName] = useState(PALETTE_NAMES[0]);
  const items = useMemo(() => PALETTE_NAMES.map(name => ({ name })), []);
  const columns = useMemo(() => makePaletteColumns(), []);

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* ── Left: palette list ──────────────────────────────────────────────── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DataListGrid
            items={items}
            columns={columns}
            keyExpr="name"
            selectedId={selectedName}
            onSelect={(id) => id && setSelectedName(id)}
            searchEnabled={true}
            noDataText="No palettes."
            toolbarExtra={<ThemeModeSwitcher mode={mode} setMode={setMode} />}
          />
        </div>
      </div>

      {/* ── Right: SHARED gallery preview ───────────────────────────────────── */}
      <div style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <GalleryPreviewFrame cssUrl={DEFAULT_NEUTRAL_CSS_URL} paletteName={selectedName} frameKey={selectedName} />
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace component
// ─────────────────────────────────────────────────────────────────────────────

export default function ThemeWorkspace() {
  const [mode, setMode] = useState('palettes'); // 'palettes' | 'baseThemes'

  return (
    <div style={{ height: '100%' }}>
      {mode === 'baseThemes'
        ? <BaseThemeGallery mode={mode} setMode={setMode} />
        : <DataPalettesMode mode={mode} setMode={setMode} />}
    </div>
  );
}
