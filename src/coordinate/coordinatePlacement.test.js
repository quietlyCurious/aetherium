// coordinate/coordinatePlacement.test.js
//   npx react-scripts test --watchAll=false src/coordinate

import { placeUnplaced } from './coordinatePlacement';

const at = (map, id) => map.get(id);

describe('placeUnplaced', () => {
  it('starts at the origin when nothing is placed', () => {
    expect(at(placeUnplaced([], [{ id: 'a', w: 100, h: 50 }]), 'a')).toEqual({ left: 0, top: 0 });
  });

  it('fills the row when there is room, then starts a new one', () => {
    // A row three wide with the last spot free.
    const placed = [
      { x: 0, y: 0, w: 100, h: 60 },
      { x: 116, y: 0, w: 100, h: 60 },
      { x: 232, y: 0, w: 100, h: 60 },
      { x: 0, y: 76, w: 100, h: 60 },
    ];
    const spots = placeUnplaced(placed, [{ id: 'a', w: 100, h: 60 }, { id: 'b', w: 100, h: 60 }, { id: 'c', w: 100, h: 60 }]);
    expect(at(spots, 'a')).toEqual({ left: 116, top: 76 });
    expect(at(spots, 'b')).toEqual({ left: 232, top: 76 });
    expect(at(spots, 'c')).toEqual({ left: 0, top: 152 });
  });

  it('never overlaps, and keeps within the arrangement width', () => {
    const placed = [{ x: 0, y: 0, w: 300, h: 40 }];
    const spot = at(placeUnplaced(placed, [{ id: 'a', w: 120, h: 40 }]), 'a');
    expect(spot).toEqual({ left: 0, top: 56 });
  });

  it('uses a gap in the middle of an arrangement', () => {
    const placed = [
      { x: 0, y: 0, w: 100, h: 60 },
      { x: 232, y: 0, w: 100, h: 60 },
    ];
    expect(at(placeUnplaced(placed, [{ id: 'a', w: 100, h: 60 }]), 'a')).toEqual({ left: 116, top: 0 });
  });

  it('places a wide item on its own row when it fits nowhere else', () => {
    const placed = [{ x: 0, y: 0, w: 100, h: 60 }];
    expect(at(placeUnplaced(placed, [{ id: 'a', w: 400, h: 60 }]), 'a')).toEqual({ left: 0, top: 76 });
  });
});
