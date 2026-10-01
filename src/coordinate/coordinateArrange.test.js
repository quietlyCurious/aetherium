// coordinate/coordinateArrange.test.js
//   npx react-scripts test --watchAll=false src/coordinate

import { arrangedPositions, coordUpdateFor } from './coordinateArrange';

const items = [
  { id: 'a', x: 10, y: 10, w: 90, h: 30 },
  { id: 'b', x: 130, y: 22, w: 60, h: 20 },
  { id: 'c', x: 40, y: 80, w: 90, h: 40 },
];

test('align matches the selection’s own edges and centres', () => {
  const left = arrangedPositions(items, { type: 'align', mode: 'left' });
  expect([...left.values()].map(p => p.x)).toEqual([10, 10, 10]);
  const bottom = arrangedPositions(items, { type: 'align', mode: 'bottom' });
  expect(bottom.get('a').y + 30).toBe(120);
  expect(bottom.get('b').y + 20).toBe(120);
});

test('distribute evens the gaps and keeps the outer two where they are', () => {
  const d = arrangedPositions(items, { type: 'distribute', axis: 'horizontal' });
  // Sorted by left: a (10–100), c (40–130), b (130–190): span 180, sizes 240.
  expect(d.get('a').x).toBe(10);
  expect(d.get('b').x + 60).toBe(190);
  const gap1 = d.get('c').x - (d.get('a').x + 90);
  const gap2 = d.get('b').x - (d.get('c').x + 90);
  expect(gap1).toBeCloseTo(gap2);
});

test('arrange in grid packs in reading order into equal cells', () => {
  const g = arrangedPositions(items, { type: 'grid' });
  // Reading order a, b, c; 2 columns; cells 98 × 48 from (10, 10).
  expect(g.get('a')).toEqual({ x: 10, y: 10 });
  expect(g.get('b')).toEqual({ x: 108, y: 10 });
  expect(g.get('c')).toEqual({ x: 10, y: 58 });
});

test('too few items is no action', () => {
  expect(arrangedPositions(items.slice(0, 2), { type: 'distribute', axis: 'vertical' })).toBeNull();
  expect(arrangedPositions(items.slice(0, 1), { type: 'grid' })).toBeNull();
});

test('writes back through whichever edges the item is anchored by', () => {
  const parent = { w: 220, h: 140 };
  expect(coordUpdateFor({ left: 5, top: 5, right: '', bottom: '' }, { x: 20.4, y: 30 }, { w: 90, h: 30 }, parent)).toEqual({ left: 20, top: 30 });
  expect(coordUpdateFor({ left: '', top: '', right: 10, bottom: 10 }, { x: 100, y: 60 }, { w: 90, h: 30 }, parent)).toEqual({ right: 30, bottom: 50 });
  // Stretched across: both edges move together, keeping the width.
  expect(coordUpdateFor({ left: 10, right: 10, top: 0 }, { x: 30, y: 0 }, { w: 200, h: 30 }, parent)).toEqual({ left: 30, right: 0, top: 0 });
});
