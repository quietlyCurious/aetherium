// operator/canvas/manualLayout.test.js
//   npx react-scripts test --watchAll=false src/operator/canvas

import { asCoordPositions } from './manualLayout';

describe('asCoordPositions', () => {
  it('reads old { x, y } saves, shifting clear of negative space', () => {
    expect(asCoordPositions({
      oilTemp: { x: -40, y: 20 },
      load: { x: 80, y: 20 },
      speed: { x: -40, y: 120 },
    })).toEqual({
      oilTemp: { left: 0, top: 20 },
      load: { left: 120, top: 20 },
      speed: { left: 0, top: 120 },
    });
  });

  it('leaves positive positions where they are, rounded', () => {
    expect(asCoordPositions({ a: { x: 10.4, y: 30.6 } })).toEqual({ a: { left: 10, top: 31 } });
  });

  it('passes the new form through unchanged', () => {
    const saved = { a: { left: 0, top: 8 }, b: { left: 200, top: 8 } };
    expect(asCoordPositions(saved)).toEqual(saved);
  });

  it('treats nothing as nothing', () => {
    expect(asCoordPositions(undefined)).toEqual({});
    expect(asCoordPositions({})).toEqual({});
    expect(asCoordPositions({ a: null })).toEqual({});
  });
});

describe('card widths', () => {
  it('keeps a saved width, and passes it through the shift', () => {
    expect(asCoordPositions({ a: { x: -10, y: 0, width: 312.4 }, b: { x: 10, y: 0 } })).toEqual({
      a: { left: 0, top: 0, width: 312 },
      b: { left: 20, top: 0 },
    });
  });
});
