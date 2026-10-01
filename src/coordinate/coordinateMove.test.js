// coordinate/coordinateMove.test.js
//   npx react-scripts test --watchAll=false src/coordinate

import {
  anchorsOf, bandBetween, moveStartOf, movedCoord, shiftedCoord, snapTargets, touchesBand,
} from './coordinateMove';

describe('anchorsOf', () => {
  it('reads which edges an item hangs from', () => {
    expect(anchorsOf({ left: 10, top: 5 })).toEqual({ x: 'left', y: 'top' });
    expect(anchorsOf({ left: '', right: 20, top: '', bottom: 4 })).toEqual({ x: 'right', y: 'bottom' });
    expect(anchorsOf({ left: 0, right: 0, top: 0, bottom: 0 })).toEqual({ x: 'both', y: 'both' });
    expect(anchorsOf({})).toEqual({ x: 'left', y: 'top' });
    expect(anchorsOf(null)).toEqual({ x: 'left', y: 'top' });
  });
});

describe('moveStartOf', () => {
  it('turns blanks into 0 and uses the measured box when given', () => {
    const s = moveStartOf({ left: '', right: 30, top: 12, bottom: '' }, { x: 200, y: 12, w: 80, h: 40 });
    expect(s).toMatchObject({ left: 0, right: 30, top: 12, bottom: 0, xAnchor: 'right', yAnchor: 'top', x: 200, y: 12, w: 80, h: 40 });
  });
  it('falls back to the stored left/top/size', () => {
    expect(moveStartOf({ left: 16, top: 24, width: 100, height: 50 })).toMatchObject({ x: 16, y: 24, w: 100, h: 50 });
  });
});

describe('movedCoord without snapping', () => {
  it('moves a left/top item by the mouse, rounded', () => {
    const start = moveStartOf({ left: 10, top: 10 });
    expect(movedCoord(start, 5.4, -2.6)).toEqual({ update: { left: 15, top: 7 }, delta: { x: 5, y: -3 }, guides: [] });
  });
  it('never goes negative', () => {
    const start = moveStartOf({ left: 10, top: 10 });
    expect(movedCoord(start, -50, -50).update).toEqual({ left: 0, top: 0 });
  });
  it('moves a right/bottom item by its own edges', () => {
    const start = moveStartOf({ left: '', right: 40, top: '', bottom: 40 });
    const { update, delta } = movedCoord(start, 10, 10);
    expect(update).toEqual({ right: 30, bottom: 30 });
    // Moving right/down is a positive delta in left/top terms, so the rest
    // of a group follows (this used to come out 0 for right-anchored items).
    expect(delta).toEqual({ x: 10, y: 10 });
  });
  it('moves both edges of a stretched item, keeping its size', () => {
    const start = moveStartOf({ left: 20, right: 20, top: 0, bottom: '' });
    expect(movedCoord(start, 8, 0).update).toEqual({ left: 28, right: 12, top: 0 });
  });
});

describe('movedCoord with snapping', () => {
  const box = { x: 0, y: 0, w: 100, h: 60 };
  it('rounds to the grid when nothing lines up', () => {
    const start = moveStartOf({ left: 0, top: 0 }, box);
    const { update, guides } = movedCoord(start, 13, 21, { snap: true, snapSize: 8, targets: snapTargets([]) });
    expect(update).toEqual({ left: 16, top: 24 });
    expect(guides).toEqual([]);
  });
  it('lines an edge up with a neighbour and reports a guide', () => {
    const neighbour = { x: 200, y: 100, w: 50, h: 50 };
    const start = moveStartOf({ left: 0, top: 0 }, box);
    // Its right edge (0+97+100 = 197) is 3px from the neighbour's left (200).
    const { update, guides, delta } = movedCoord(start, 97, 3, { snap: true, snapSize: 8, targets: snapTargets([neighbour]) });
    expect(update.left).toBe(100);
    expect(guides).toContainEqual({ type: 'v', position: 200 });
    expect(delta.x).toBe(100);
  });
  it('lines centres up', () => {
    const neighbour = { x: 0, y: 200, w: 100, h: 20 }; // centre y = 210
    const start = moveStartOf({ left: 300, top: 0 }, { x: 300, y: 0, w: 40, h: 40 });
    // Its centre (0+188+20 = 208) is 2px off.
    const { update, guides } = movedCoord(start, 0, 188, { snap: true, snapSize: 8, targets: snapTargets([neighbour]) });
    expect(update.top).toBe(190);
    expect(guides).toContainEqual({ type: 'h', position: 210 });
  });
  it('snaps to the container edges and centre', () => {
    const start = moveStartOf({ left: 0, top: 0 }, { x: 0, y: 0, w: 40, h: 40 });
    const targets = snapTargets([], { w: 400, h: 300 });
    // Centre x 20+178 = 198 → container centre 200.
    expect(movedCoord(start, 178, 0, { snap: true, snapSize: 8, targets }).update.left).toBe(180);
  });
});

describe('shiftedCoord', () => {
  it('moves each item in its own anchors', () => {
    expect(shiftedCoord(moveStartOf({ left: 10, top: 10 }), 5, 5)).toEqual({ left: 15, top: 15 });
    expect(shiftedCoord(moveStartOf({ right: 10, bottom: 10 }), 5, 5)).toEqual({ right: 5, bottom: 5 });
    expect(shiftedCoord(moveStartOf({ left: 2, right: 2, top: 0 }), -5, 0)).toEqual({ left: 0, right: 7, top: 0 });
  });
});

describe('box-select', () => {
  it('builds the band either way round, and tests overlap', () => {
    const band = bandBetween({ x: 50, y: 40 }, { x: 10, y: 0 });
    expect(band).toEqual({ x: 10, y: 0, w: 40, h: 40 });
    expect(touchesBand({ x: 45, y: 35, w: 20, h: 20 }, band)).toBe(true);
    expect(touchesBand({ x: 50, y: 0, w: 20, h: 20 }, band)).toBe(false);
  });
});
