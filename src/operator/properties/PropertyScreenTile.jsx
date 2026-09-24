// operator/properties/PropertyScreenTile.jsx
// A property drawn with a custom tile: a saved screen about a property
// (designer/screens/screenProperty.jsx), built in the Screens area with
// ordinary DevExtreme widgets bound ⚡ → Property. PropertyTile hands off to
// this when a property's visual is 'screen:<pageId>', so everything that
// draws property tiles — AssetCard in every view, the Configurator's
// preview, the manual-layout canvases — can draw one with no changes of
// its own.
//
// The tile is boxed at its screen's size (Tile 220×140, Card 360×280), so
// layouts that estimate a tile's footprint before drawing it can ask
// propertyScreenTileBox. A Page-sized property screen has no box of its
// own, so it gets a Tile's.

import { getScreenRenderer } from '../../designer/screens/screenRenderer';
import { fillsFrame, pageSizeOf, sizeBox } from '../../designer/screens/screenSizes';
import { propertyScreenById } from './propertyScreens';

// The box a custom tile takes up, or null when its screen is missing (it
// then draws as the built-in All tile).
export function propertyScreenTileBox(pageId) {
  const page = propertyScreenById(pageId);
  if (!page) return null;
  const sizeId = pageSizeOf(page.containers);
  return sizeBox(fillsFrame(sizeId) ? 'tile' : sizeId);
}

// Whether a custom tile can be drawn: its screen still exists and is about
// a property, the screen renderer has loaded, and the host said which
// property of which asset this is.
export function canDrawPropertyScreen(pageId, assetId, propertyKey) {
  return !!(propertyScreenById(pageId) && getScreenRenderer() && assetId && propertyKey);
}

// `value` is the reading the tile's host is showing — usually the current
// value, or the scrubbed one while Investigate's time track is in use — and
// wins over the model's current value inside the screen. Draws nothing when
// canDrawPropertyScreen says no — PropertyTile checks first and falls back.
export function PropertyScreenTile({ pageId, assetId, propertyKey, value, label }) {
  if (!canDrawPropertyScreen(pageId, assetId, propertyKey)) return null;
  const page = propertyScreenById(pageId);
  const ScreenRenderer = getScreenRenderer();
  const box = propertyScreenTileBox(pageId);
  // canvas-no-gap: drawn the way the Launch view draws a screen, with no
  // editor gaps or drop zones between containers.
  return (
    <div
      className="op-property-tile op-property-tile--screen canvas-no-gap"
      style={{ width: box.width, height: box.height }}
      title={`${label ?? propertyKey} · ${page.name}`}
    >
      <ScreenRenderer
        containers={page.containers || []}
        assetId={assetId}
        property={{ propertyKey, value }}
      />
    </div>
  );
}
