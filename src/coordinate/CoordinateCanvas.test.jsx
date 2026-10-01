// coordinate/CoordinateCanvas.test.jsx
//   npx react-scripts test --watchAll=false src/coordinate
// What can be checked without a layout engine: where items are placed, and
// selection by click. Moving, snapping and box-select are the shared maths
// (coordinateMove.test.js) plus the browser.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { CoordinateCanvas } from './CoordinateCanvas';

const items = [
  { id: 'a', coord: { left: 10, top: 20 }, content: <span>A</span> },
  { id: 'b', coord: { left: '', right: 30, top: 40 }, content: <span>B</span> },
  { id: 3, coord: { left: 100, top: 0, width: 80, height: 50 }, content: <span>C</span> },
];

const itemEl = (container, id) => container.querySelector(`[data-coord-id="${id}"]`);

describe('CoordinateCanvas', () => {
  it('places items by their coords', () => {
    const { container } = render(<CoordinateCanvas items={items} />);
    expect(itemEl(container, 'a').style.left).toBe('10px');
    expect(itemEl(container, 'a').style.top).toBe('20px');
    expect(itemEl(container, 'a').style.width).toBe('');
    expect(itemEl(container, 'b').style.right).toBe('30px');
    expect(itemEl(container, '3').style.width).toBe('80px');
  });

  it('selects on click, adds with Shift, and clears on empty space', () => {
    const onSelectionChange = jest.fn();
    const { container, rerender } = render(<CoordinateCanvas items={items} selectedIds={[]} onSelectionChange={onSelectionChange} />);
    fireEvent.click(itemEl(container, 'a'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);

    rerender(<CoordinateCanvas items={items} selectedIds={['a']} onSelectionChange={onSelectionChange} />);
    fireEvent.click(itemEl(container, '3'), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 3]);
    expect(itemEl(container, 'a').className).toContain('coord-canvas-item--selected');

    fireEvent.click(container.querySelector('.coord-canvas'));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('keeps a multi-selection when one of its items is clicked', () => {
    const onSelectionChange = jest.fn();
    const { container } = render(<CoordinateCanvas items={items} selectedIds={['a', 'b']} onSelectionChange={onSelectionChange} />);
    fireEvent.click(itemEl(container, 'b'));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('does nothing when read-only', () => {
    const onSelectionChange = jest.fn();
    const onUpdateCoord = jest.fn();
    const { container } = render(<CoordinateCanvas items={items} readOnly onSelectionChange={onSelectionChange} onUpdateCoord={onUpdateCoord} />);
    fireEvent.mouseDown(itemEl(container, 'a'), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(document);
    fireEvent.click(itemEl(container, 'a'));
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onUpdateCoord).not.toHaveBeenCalled();
    expect(container.querySelector('.coord-canvas').className).toContain('coord-canvas--readonly');
  });

  it('moves an item with the mouse', () => {
    const onUpdateCoord = jest.fn();
    const { container } = render(<CoordinateCanvas items={items} snap={false} onUpdateCoord={onUpdateCoord} />);
    fireEvent.mouseDown(itemEl(container, 'a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 7, clientY: 9 });
    fireEvent.mouseUp(document);
    expect(onUpdateCoord).toHaveBeenLastCalledWith('a', { left: 17, top: 29 });
  });

  it('offers align / distribute / arrange through its ref', () => {
    const ref = createRef();
    render(<CoordinateCanvas ref={ref} items={items} />);
    expect(typeof ref.current.align).toBe('function');
    expect(typeof ref.current.distribute).toBe('function');
    expect(typeof ref.current.arrangeGrid).toBe('function');
  });
});

describe('CoordinateCanvas placement', () => {
  it('gives items without a position a spot, and reports it', async () => {
    const onAutoPlace = jest.fn();
    const { container } = render(
      <CoordinateCanvas
        items={[{ id: 'a', coord: { left: 0, top: 0 }, content: 'A' }, { id: 'n', coord: null, content: 'N' }]}
        onAutoPlace={onAutoPlace}
      />,
    );
    // jsdom has no layout (every size is 0), so where it lands says little
    // (the spot maths is coordinatePlacement.test.js) — what matters here
    // is that it's placed, shown and reported.
    await waitFor(() => expect(onAutoPlace).toHaveBeenCalledTimes(1));
    expect(onAutoPlace.mock.calls[0][0].get('n')).toEqual({ left: expect.any(Number), top: expect.any(Number) });
    await waitFor(() => expect(itemEl(container, 'n').style.visibility).toBe(''));
  });

  it('trims empty space before the first item', () => {
    const { container } = render(
      <CoordinateCanvas readOnly trim items={[{ id: 'a', coord: { left: 40, top: 30 }, content: 'A' }, { id: 'b', coord: { left: 140, top: 60 }, content: 'B' }]} />,
    );
    expect(itemEl(container, 'a').style.left).toBe('0px');
    expect(itemEl(container, 'a').style.top).toBe('0px');
    expect(itemEl(container, 'b').style.left).toBe('100px');
    expect(itemEl(container, 'b').style.top).toBe('30px');
  });
});
