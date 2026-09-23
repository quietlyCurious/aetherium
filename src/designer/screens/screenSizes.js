// designer/screens/screenSizes.js
// How big a screen is meant to be. Three fixed sizes, no custom numbers:
//
//   Tile  220×140   a number or two, at a glance
//   Card  360×280   one asset's summary — what a repeater draws by default
//   Page  fills     a whole screen, taking whatever room it's given
//
// The size is a screen-level setting, saved on the root container next to
// pageType as `pageSize`, so it saves and dirty-tracks like any other edit.
// It sits beside About rather than inside its context: clearing what a
// screen is about shouldn't forget how big it is.
//
// Why fixed sizes at all: a repeater asks for "the Card for this type" and
// has to know how much room to leave before it knows which screens it will
// find. Three named sizes make that a lookup rather than a negotiation —
// the same reason a type screen is found by type, not by name.
//
// For now one screen is one size, so a type with a Tile and a Card is two
// saved screens. If that turns out to be tedious, the tiers the canvas
// already has (breakpointOverrides) are where a single screen with three
// layouts would go — this file stays the vocabulary either way.

import { ROOT_CONTAINER_ID } from '../../containerModel';

export const SCREEN_SIZES = [
  {
    id: 'tile',
    label: 'Tile',
    width: 220,
    height: 140,
    fills: false,
    note: 'A number or two, at a glance',
  },
  {
    id: 'card',
    label: 'Card',
    width: 360,
    height: 280,
    fills: false,
    note: "One asset's summary — what a repeater draws by default",
  },
  {
    id: 'page',
    label: 'Page',
    // Page has no fixed box: it takes whatever room it's given. The
    // numbers are only what a repeater leaves for a Page-sized item, and
    // what the canvas shows when nothing else says otherwise.
    width: 960,
    height: 640,
    fills: true,
    note: 'A whole screen, taking whatever room it is given',
  },
];

export const DEFAULT_SCREEN_SIZE = 'page';

export function screenSize(sizeId) {
  return SCREEN_SIZES.find(s => s.id === sizeId) || SCREEN_SIZES.find(s => s.id === DEFAULT_SCREEN_SIZE);
}

export function sizeLabel(sizeId) {
  return screenSize(sizeId).label;
}

// The box a screen of this size occupies — always concrete, so a repeater
// can lay items out before it knows what it will find.
export function sizeBox(sizeId) {
  const size = screenSize(sizeId);
  return { width: size.width, height: size.height };
}

// Whether this size takes whatever room it's given rather than its own
// box. Only Page does; it's what the canvas checks before framing.
export function fillsFrame(sizeId) {
  return screenSize(sizeId).fills;
}

// A screen's size, from its container tree. Screens saved before sizes
// existed are Pages, which is what they were.
export function pageSizeOf(containers) {
  const root = (containers || []).find(c => c.id === ROOT_CONTAINER_ID);
  return root?.pageSize || DEFAULT_SCREEN_SIZE;
}

// For SelectBoxes.
export function sizeOptions() {
  return SCREEN_SIZES.map(s => ({ id: s.id, name: s.label, note: s.note }));
}

// "Card · 360×280", "Page · fills its space" — the one-liner under a size
// picker.
export function describeSize(sizeId) {
  const size = screenSize(sizeId);
  return size.fills ? `${size.label} · fills its space` : `${size.label} · ${size.width}×${size.height}`;
}
