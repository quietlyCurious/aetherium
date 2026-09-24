// designer/screens/screenRenderer.js
// Where anything that draws a saved screen *inside* something else gets
// ScreenView from: a repeater drawing a screen per asset, and a property
// tile drawing a property screen (operator/properties/PropertyScreenTile).
//
// Both of those sit underneath ScreenView in the render stack
// (ScreenView → ContainerCard → repeater → generated card → AssetCard →
// PropertyTile), so importing ScreenView from them would be a circle.
// ScreenView registers itself here when its module loads instead, and this
// file imports nothing.

let renderer = null;

export function registerScreenRenderer(component) {
  renderer = component;
}

// ScreenView, or null if nothing has loaded it yet.
export function getScreenRenderer() {
  return renderer;
}
