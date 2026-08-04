// GalleryPreviewFrame.jsx
// Renders the shared widget gallery (see themeGalleryHtml.js) inside an isolated
// iframe. Both Theme workspace modes use this exact component:
//   - Data Palettes:   <GalleryPreviewFrame cssUrl={NEUTRAL} paletteName={selected} />
//   - Base UI Themes:  <GalleryPreviewFrame cssUrl={selected} paletteName={DEFAULT} />
// Only ONE of the two props changes per mode — the gallery itself, its layout, and
// its widget set live in exactly one place (themeGalleryHtml.js).

import React, { useMemo } from 'react';
import { buildGalleryPreviewHtml } from './themeGalleryHtml';

export default function GalleryPreviewFrame({ cssUrl, paletteName, frameKey }) {
  const html = useMemo(
    () => buildGalleryPreviewHtml({ cssUrl, paletteName }),
    [cssUrl, paletteName]
  );

  return (
    <iframe
      key={frameKey ?? `${cssUrl}::${paletteName}`}
      title="Widget gallery preview"
      srcDoc={html}
      style={{ width: '100%', height: '100%', border: 'none', display: 'block', flex: 1 }}
      sandbox="allow-scripts"
    />
  );
}
