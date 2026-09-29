// viewport/fitViewportMath.test.js
//   npx react-scripts test --watchAll=false src/viewport

import { CONTROLS_ROOM, FIT_PAD, KEEP_VISIBLE, clampPan, fitFixed, fitReflow, zoomAround } from './fitViewportMath';

describe('fitFixed', () => {
  test('content that fits is left exactly as it is', () => {
    expect(fitFixed({ w: 800, h: 600 }, { w: 800, h: 600 })).toEqual({ zoom: 1, x: 0, y: 0, fits: true });
  });
  test('too big: shrinks to show all of it, leaving room for the controls, centred across', () => {
    const r = fitFixed({ w: 800, h: 600 }, { w: 1600, h: 600 });
    expect(r.fits).toBe(false);
    expect(r.zoom).toBeCloseTo((800 - FIT_PAD * 2) / 1600);
    expect(1600 * r.zoom).toBeLessThanOrEqual(800);
    expect(600 * r.zoom).toBeLessThanOrEqual(600 - CONTROLS_ROOM);
    expect(r.x).toBeCloseTo((800 - 1600 * r.zoom) / 2);
  });
});

describe('fitReflow', () => {
  // A wrapping row of 40 cards, 200×120 with 20px gaps: the narrower the
  // row, the taller the block.
  const cards = (width) => {
    const perRow = Math.max(1, Math.floor((width + 20) / 220));
    return Math.ceil(40 / perRow) * 140 - 20;
  };
  test('fits at full width: 100%, laid out at the view width', () => {
    expect(fitReflow({ w: 2400, h: 900 }, 'row', cards)).toMatchObject({ zoom: 1, size: 2400, fits: true });
  });
  test('too tall: zooms out and gives the rows more width, until the block fits', () => {
    const r = fitReflow({ w: 1000, h: 500 }, 'row', cards);
    expect(r.fits).toBe(false);
    expect(r.zoom).toBeLessThan(1);
    expect(cards(r.size) * r.zoom).toBeLessThanOrEqual(500 - FIT_PAD - CONTROLS_ROOM);
    expect(r.size * r.zoom).toBeCloseTo(1000 - FIT_PAD * 2);
    // Reflowing beats shrinking the narrow layout as-is.
    const shrunk = (500 - FIT_PAD - CONTROLS_ROOM) / cards(1000);
    expect(r.zoom).toBeGreaterThan(shrunk);
  });
});

test('zooming keeps the point under the cursor still', () => {
  const next = zoomAround({ zoom: 1, x: 0, y: 0 }, 2, 100, 50);
  // The content point that was at (100, 50) is still there.
  expect((100 - next.x) / next.zoom).toBeCloseTo(100);
  expect((50 - next.y) / next.zoom).toBeCloseTo(50);
});

test('panning can’t lose the content entirely', () => {
  const r = clampPan({ zoom: 1, x: -5000, y: 5000 }, { w: 800, h: 600 }, { w: 1000, h: 1000 });
  expect(r.x).toBe(KEEP_VISIBLE - 1000);
  expect(r.y).toBe(600 - KEEP_VISIBLE);
});
